#!/usr/bin/env python3
"""
Plan NEW recommendations (and the new books they need) from the coverage gap
(scripts/rtt_gap_finder.py → reports/rtt_gap_pairs.csv). DRY RUN by default:
nothing is written to the database; --emit-sql only writes SQL files.

POLICY
  * A recommendation is planned only if its cited source passes the SAME tests
    as scripts/find_primary_sources.py / rtt_primary_sources.py (fps.evaluate_card):
    the primary source belongs to the person and names the book or holds the quote.
    Strong (confidence 80) and, with --include-medium, medium (60). Weak is reported only.
  * source_url is always the PRIMARY url (tweet, podcast, interview, blog, video).
    Never an outside-index url; no outside-index text, no credit. A quote is stored
    only if verified verbatim at the primary source.
  * A new BOOK is added only when at least one verified recommendation attaches to
    it, and only when Open Library confirms it (title >= 0.85, author >= 0.60).
    New books are index_status='noindex' (house convention, import_author_works.py):
    they do not publish until the normal enrichment + publish pipeline picks them up.
    Facts only come from Open Library (cover, isbn, id); descriptions are not copied.
  * People we do not have are skipped here (see gap_plan_new_people.py).

OUTPUT   reports/gap_new_recs_candidates.csv   strong / medium / weak, with notes
         reports/gap_new_recs_plan.csv         what would be written
         reports/gap_new_recs_summary.json
SQL      --emit-sql DIR [--include-medium --batch-size 50 --pilot 10]
         One guarded statement per batch (payload md5 check, pair-not-exists check,
         ledger rows in public.added_rows_20261114 so every row can be removed again).

  python3 -I scripts/gap_plan_new_recs.py --include-medium
  python3 -I scripts/gap_plan_new_recs.py --offline --include-medium --emit-sql reports/gap_write_batches
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import threading
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import find_primary_sources as fps  # noqa: E402
import rtt_primary_sources as rtt  # noqa: E402
from enrich_books_metadata import extract_open_library_candidate, open_library_search  # noqa: E402

SOURCES = {  # outside index → (pairs csv from its gap finder, person-slug column, output suffix)
    "rtt": ("rtt_gap_pairs.csv", "rtt_person_slug", ""),
    "mrb": ("mrb_gap_pairs.csv", "mrb_person_slug", "_mrb"),
}
STAMP = "20261114"
LEDGER = f"public.added_rows_{STAMP}"
NOTE = "added 2026-11-14: coverage gap, verified recommendation"
OL_MIN_TITLE, OL_MIN_AUTHOR = 0.85, 0.60


def book_slug(title: str, author: str) -> str:
    """Same convention as scripts/import_author_works.py: slugify(title + ' ' + author), accents folded."""
    t = unicodedata.normalize("NFKD", f"{title} {author}").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")


def sql_lit(s) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def enrich_new_book(title: str, author: str) -> dict | None:
    """Open Library facts for a book we do not have; None if no confident match."""
    best = None
    for doc in open_library_search(title, author, limit=5):
        c = extract_open_library_candidate(doc, title, author)
        if c["match_title_score"] >= OL_MIN_TITLE and (not author or c["match_author_score"] >= OL_MIN_AUTHOR):
            if best is None or c["match_score"] > best["match_score"]:
                best = c
    return best


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--source", choices=tuple(SOURCES), default="rtt", help="which outside index's gap pairs to verify")
    ap.add_argument("--offline", action="store_true", help="cache only (index pages and primary sources), no network")
    ap.add_argument("--include-medium", action="store_true")
    ap.add_argument("--max-verify", type=int, default=8000)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--no-wayback", action="store_true")
    ap.add_argument("--no-enrich", action="store_true", help="skip Open Library lookups (new books are then not planned)")
    ap.add_argument("--status", choices=("missing_pair", "missing_book", "all"), default="all",
                    help="missing_pair: the book is already ours (lowest risk); missing_book: a new book is needed")
    ap.add_argument("--max-pairs", type=int, default=100000, help="cap on gap pairs verified, published people first")
    ap.add_argument("--emit-sql", metavar="DIR")
    ap.add_argument("--batch-size", type=int, default=50)
    ap.add_argument("--pilot", type=int, default=10)
    args = ap.parse_args()

    handle_map, handle_deny, domain_map, alias_groups, interview_hosts = fps.load_house_maps()
    pairs_name, slug_col, suffix = SOURCES[args.source]
    OUT_CANDS = fps.REPORTS / f"gap_new_recs_candidates{suffix}.csv"
    OUT_PLAN = fps.REPORTS / f"gap_new_recs_plan{suffix}.csv"
    OUT_SUMMARY = fps.REPORTS / f"gap_new_recs_summary{suffix}.json"
    pairs = [r for r in fps.csv_rows(fps.REPORTS / pairs_name) if r["matched_slug"] and r["pointer_url"]]
    fps.log(f"gap pairs with a matched person and a cited source: {len(pairs)}")

    people = fps.sb_read_all("people", "id,slug,name,twitter_handle,index_status")
    people_by_slug = {p["slug"]: p for p in people}
    if args.status != "all":
        pairs = [r for r in pairs if r["status"] == args.status]
    # published people first (their pages are the ones readers see), then by name for a stable order
    pairs.sort(key=lambda r: (people_by_slug[r["matched_slug"]]["index_status"] not in ("published", "approved", "indexed", "index"), r[slug_col]))
    pairs = pairs[: args.max_pairs]
    fps.log(f"verifying {len(pairs)} pairs (status={args.status})")
    books = {b["slug"]: b for b in fps.sb_read_all("books", "id,slug,title,subtitle,author_name,first_published_year")}
    own = fps.Ownership(people_by_slug, handle_map, handle_deny, domain_map, alias_groups, interview_hosts)

    R = rtt.RttFetcher(offline=True)  # RTT person pages were collected by rtt_gap_finder.py
    F = rtt.SourceFetcher(args.offline)
    wb_stats = Counter()
    pages = {}
    by_person = defaultdict(list)
    for r in pairs:
        by_person[r[slug_col]].append(r)
    for rslug in by_person:
        if args.source == "rtt":
            res = R.get(f"{rtt.RTT}/person/{rslug}")
            pg = rtt.parse_rtt_person(res.get("text", ""), rslug) if res.get("status") == 200 else None
            if pg:
                pg["profile_handles"] = {pg["twitter"]} if pg["twitter"] else set()
        else:  # MRB person pages were collected by mrb_gap_finder.py (cached; a miss is fetched politely)
            res = F.get(f"{fps.MRB}/people/{rslug}-recommended-books", "mrb")
            pg = fps.parse_mrb_person(res["text"]) if res.get("status") == 200 else None
        if pg:
            pages[rslug] = pg

    collected = {}

    def verify_collect(url, stype):
        collected.setdefault(url, stype)
        return {"fetched": False, "why": "collect_pass"}

    tweet_verifier = None if args.no_wayback else rtt.make_wayback_tweet_verifier(F, wb_stats)
    verify = fps.make_verifier(F, False, tweet_verifier)

    def process(verify_fn):
        out, rejected, stats = [], [], Counter()
        for rslug, rows in sorted(by_person.items()):
            pg = pages.get(rslug)
            if not pg:
                stats["no_cached_page"] += len(rows)
                continue
            person = people_by_slug[rows[0]["matched_slug"]]
            idx = defaultdict(list)
            for c in pg["cards"]:
                if args.source == "rtt":  # this index lists the person's own list: its quote is attributed to them
                    c["quote_attrib"] = person["name"]
                    if c["quote"] and rtt.third_person_quote(c["quote"], person["name"]):
                        c["quote"], c["has_context_only"] = None, True
                idx[fps.norm_title(c["title"])].append(c)
            for r in rows:
                if r["our_book_slug"] and r["our_book_slug"] in books:
                    book, is_new = books[r["our_book_slug"]], False
                else:
                    book = {"id": None, "slug": book_slug(r["book_title"], r["book_author"]), "title": r["book_title"],
                            "subtitle": None, "author_name": r["book_author"], "first_published_year": None}
                    is_new = True
                hits = fps.book_hits(idx, book)
                if not hits:
                    stats["book_not_on_cached_page"] += 1
                    continue
                base = {"person_slug": person["slug"], "person_status": person["index_status"], "book_slug": book["slug"],
                        "book_title": book["title"], "book_author": book.get("author_name") or "", "is_new_book": is_new,
                        "status": r["status"], "rec_id": "", "site": rtt.SITE_LABEL,
                        "_person_id": person["id"], "_book_id": book["id"]}
                best = None
                for card in hits:
                    sdy = {fps.clean_url(u): card["source_year"] for u in card["links"]} if card.get("source_year") else None
                    cand = fps.evaluate_card(card, base, slug=person["slug"], person=person, book=book, rebooked=False, own=own,
                                             profile_handles=pg["profile_handles"],
                                             verify_fn=verify_fn, rejected=rejected, source_date_years=sdy)
                    if cand and (best is None or fps.candidate_rank(cand) < fps.candidate_rank(best)):
                        best = cand
                if best:
                    out.append(best)
                    stats[best["evidence_strength"]] += 1
                else:
                    stats["no_usable_source"] += 1
        return out, rejected, stats

    try:
        process(verify_collect)
        tweets = [u for u, s in collected.items() if s == "tweet"]
        t = None
        if tweets and tweet_verifier and not args.offline:
            t = threading.Thread(target=lambda: [verify(u, "tweet") for u in tweets[: args.max_verify]])
            t.start()
        fps.prefetch_primary(F, collected, args.max_verify, args.workers, args.offline, skip_types=("tweet",))
        if t:
            t.join()
        out, rejected, stats = process(verify)
    except fps.StopRun as e:
        sys.exit(f"STOPPED: {e}")

    fps.finalize_candidates(out)
    for c in out:
        # Hand check 2026-11-14: a book that merely appears on a podcast/interview page (tim.blog "Selected Links",
        # a host-compiled resource list) is not an endorsement by the guest: 3 of 5 medium candidates were of
        # that kind. For these source types medium therefore needs the person's own words found at the source;
        # tweets are exempt because the tweet text is itself the person's words.
        if (c["evidence_strength"] == "medium" and not c["quote_verified_at_primary"]
                and c["primary_source_type"] in ("podcast", "interview", "blog", "other")):
            c["evidence_strength"] = "weak"
            c["notes"] += ";show_notes_or_link_list(persons_words_not_found_at_source)"
    for c in out:  # hard rules
        u = c["primary_source_url"].lower()
        assert "readthistwice" not in u and "mostrecommendedbooks" not in u and not fps.is_blocked_site(u)
        assert c["_quote_to_write"] is None or c["quote_verified_at_primary"]

    # keep one candidate per (person, book); new books need an Open Library match
    use = ("strong", "medium") if args.include_medium else ("strong",)
    plan, seen = [], set()
    ol_cache, no_ol = {}, 0
    for c in sorted(out, key=fps.candidate_rank):
        if c["evidence_strength"] not in use:
            continue
        key = (c["person_slug"], c["book_slug"])
        if key in seen:
            continue
        seen.add(key)
        row = dict(c)
        if c["is_new_book"]:
            if args.no_enrich:
                continue
            k = c["book_slug"]
            if k not in ol_cache:
                ol_cache[k] = enrich_new_book(c["book_title"], c["book_author"])
            ol = ol_cache[k]
            if not ol:
                no_ol += 1
                continue
            row["_ol"] = ol
        plan.append(row)

    cols = ["person_slug", "person_status", "book_slug", "book_title", "book_author", "status", "is_new_book", "primary_source_url",
            "primary_source_type", "quote_text", "quote_verified_at_primary", "evidence_strength", "notes"]
    fps.REPORTS.mkdir(parents=True, exist_ok=True)
    with OUT_CANDS.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(out)
    with OUT_PLAN.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols + ["ol_id", "ol_cover", "ol_isbn13"], extrasaction="ignore")
        w.writeheader()
        for r in plan:
            ol = r.get("_ol") or {}
            w.writerow({**r, "ol_id": ol.get("source_id", ""), "ol_cover": ol.get("cover_url", ""), "ol_isbn13": ol.get("isbn_13", "")})
    summary = {"pairs_in": len(pairs), "stats": dict(stats), "candidates_by_strength": dict(Counter(c["evidence_strength"] for c in out)),
               "planned": len(plan), "planned_new_books": len({r["book_slug"] for r in plan if r["is_new_book"]}),
               "planned_existing_books": sum(1 for r in plan if not r["is_new_book"]), "new_book_without_open_library_match": no_ol,
               "wayback": dict(wb_stats), "network_requests": sum(F.network_requests.values())}
    OUT_SUMMARY.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    fps.log(json.dumps(summary, indent=2))

    if args.emit_sql:
        emit_sql(plan, Path(args.emit_sql), args.batch_size, args.pilot)


def emit_sql(plan: list[dict], out_dir: Path, batch_size: int, pilot: int):
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("batch_*.sql"):
        old.unlink()
    (out_dir / "000_ledger.sql").write_text(
        f"create table if not exists {LEDGER} (table_name text not null, row_id uuid not null, batch text not null, "
        f"added_at timestamptz not null default now(), primary key (table_name, row_id));\n"
        f"alter table {LEDGER} enable row level security;\n"
        f"comment on table {LEDGER} is 'Rows added by scripts/gap_plan_new_recs.py on 2026-11-14. To undo a batch: delete the listed "
        f"book_recommendations rows, then the listed books rows (only if they have no other recommendations), then recompute recommendation_count.';\n",
        encoding="utf-8")
    chunks = []
    todo = list(plan)
    if pilot:
        chunks.append(todo[:pilot])
        todo = todo[pilot:]
    chunks += [todo[i:i + batch_size] for i in range(0, len(todo), batch_size)]
    manifest = []
    for n, chunk in enumerate(chunks):
        if not chunk:
            continue
        name = f"batch_{n:03d}{'_pilot' if pilot and n == 0 else ''}"
        items = []
        for c in chunk:
            ol = c.get("_ol") or {}
            items.append({
                "pid": c["_person_id"], "bid": c["_book_id"], "bslug": c["book_slug"], "btitle": c["book_title"] if c["is_new_book"] else None,
                "bauthor": (ol.get("author") or c["book_author"]).split(",")[0].strip() if c["is_new_book"] else None,
                "bcover": ol.get("cover_url") or None, "bolid": (ol.get("source_id") or "").replace("/works/", "") or None,
                "bisbn13": ol.get("isbn_13") or None, "bisbn10": ol.get("isbn_10") or None, "new": bool(c["is_new_book"]),
                "su": c["primary_source_url"], "sn": c["_source_name"], "q": c["_quote_to_write"], "cs": c["_confidence"], "ev": c["evidence_strength"],
            })
        payload = json.dumps(items, ensure_ascii=False, separators=(",", ":"))
        checksum = hashlib.md5(payload.encode("utf-8")).hexdigest()
        sql = f"""with p as (select {sql_lit(payload)}::text t),
chk as (select md5(t)='{checksum}' good from p),
v as (select x.* from p, jsonb_to_recordset(p.t::jsonb) as x(pid uuid,bid uuid,bslug text,btitle text,bauthor text,bcover text,bolid text,bisbn13 text,bisbn10 text,new boolean,su text,sn text,q text,cs int,ev text) where (select good from chk)),
nb as (insert into public.books(slug,title,author_name,cover_image_url,open_library_id,isbn_13,isbn_10,index_status,source_quality_note)
  select distinct on (bslug) bslug,btitle,bauthor,bcover,bolid,bisbn13,bisbn10,'noindex','{NOTE}' from v where new and bid is null
  on conflict (slug) do nothing returning id,slug),
b as (select v.*, coalesce(v.bid, nb.id, (select e.id from public.books e where e.slug=v.bslug)) book_id from v left join nb on nb.slug=v.bslug),
rc as (insert into public.book_recommendations(person_id,book_id,source_url,source_name,quote,confidence_score)
  select pid,book_id,su,sn,q,cs from b
  where book_id is not null and not exists (select 1 from public.book_recommendations r where r.person_id=b.pid and r.book_id=b.book_id)
  returning id,book_id),
l1 as (insert into {LEDGER}(table_name,row_id,batch) select 'books',id,'{name}' from nb on conflict do nothing returning 1),
l2 as (insert into {LEDGER}(table_name,row_id,batch) select 'book_recommendations',id,'{name}' from rc on conflict do nothing returning 1),
up as (update public.books k set recommendation_count=coalesce(k.recommendation_count,0)+(select count(*) from rc where rc.book_id=k.id)
  where k.id in (select book_id from rc) returning k.id)
select (select good from chk) checksum_ok,(select count(*) from v) given,(select count(*) from nb) new_books,(select count(*) from rc) new_recs,(select count(*) from up) counts_updated;
"""
        (out_dir / f"{name}.sql").write_text(sql, encoding="utf-8")
        manifest.append({"file": f"{name}.sql", "rows": len(chunk), "checksum": checksum})
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    fps.log(f"wrote {len(manifest)} batch files to {out_dir}")


if __name__ == "__main__":
    main()
