#!/usr/bin/env python3
"""
Coverage gap finder: what does readthistwice.com (RTT) list that we do not?
DRY RUN, READ-ONLY. Nothing is written to the database.

AUTHORISATION. RTT's Terms of Use forbid automated access. On 2026-11-14 the
project owner asked for a full-site collection, knowing that, on top of the
earlier one-off decision recorded in scripts/rtt_primary_sources.py. The
politeness limits of that script's RttFetcher are kept unchanged: one
connection, >= 2 s between requests, HTML pages only (sitemap, /people,
/person/<slug>), every response cached under reports/third_party_cache/
readthistwice/ (gitignored, so a re-run or a resume costs no requests), stop on
the first 429 or 403. robots.txt is "User-agent: *" with no Disallow.

WHAT COMES OUT
  Facts only: which person recommends which book (title, author), whether we
  already hold that pair, and the cited primary-source URL as a pointer. No RTT
  description, no RTT-written text, and the quote is kept only as a yes/no flag:
  the words themselves stay in the cache, to be checked verbatim at the primary
  source (scripts/rtt_primary_sources.py) before anything is stored.

  reports/rtt_gap_people.csv   one row per RTT person: matched to one of ours or not,
                               books listed, covered / missing_pair / missing_book
  reports/rtt_gap_pairs.csv    one row per (person, book) we lack, with the pointer
  reports/rtt_gap_summary.json totals

  status per RTT book
    covered        we hold this (person, book) pair
    missing_pair   we have the book, not this person's recommendation of it
    missing_book   the book is not in our catalogue (no title + author-surname match)
  Persons with no match in our people table are listed with matched_slug empty
  (new profiles to consider).

  python3 -I scripts/rtt_gap_finder.py --max-pages 0      # size the job, fetch only the sitemap
  python3 -I scripts/rtt_gap_finder.py                    # full crawl (resumable)
  python3 -I scripts/rtt_gap_finder.py --offline          # analyse the cache only
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import find_primary_sources as fps  # noqa: E402
import catalog_match as cm  # noqa: E402
import rtt_primary_sources as rtt  # noqa: E402

OUT_PEOPLE = fps.REPORTS / "rtt_gap_people.csv"
OUT_PAIRS = fps.REPORTS / "rtt_gap_pairs.csv"
OUT_SUMMARY = fps.REPORTS / "rtt_gap_summary.json"


def pointer_of(card: dict) -> tuple[str, str]:
    """The cited source, if it can be a primary pointer: never a bookstore, wiki, tracker or RTT/MRB itself."""
    for u in card.get("links") or []:
        u = fps.clean_url(u)
        h = fps.host_of(u)
        if not h or fps.is_blocked_site(u) or any(x in h for x in fps.REJECT_HOSTS):
            continue
        return u, fps.source_type(u)
    return "", ""


def write_csv(path: Path, rows: list[dict], cols: list[str]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--max-pages", type=int, default=100000, help="cap on person pages fetched (0 = sitemap only)")
    ap.add_argument("--offline", action="store_true", help="cache only, no network")
    ap.add_argument("--people", help="comma-separated RTT person slugs to restrict to")
    args = ap.parse_args()

    # ── our side (public read key, same as the other scripts) ──────────────────
    people = fps.sb_read_all("people", "id,slug,name,index_status")
    books = fps.sb_read_all("books", "id,slug,title,author_name")
    recs = fps.sb_read_all("book_recommendations", "id,person_id,book_id")
    fps.log(f"ours: {len(people)} people, {len(books)} books, {len(recs)} recommendations")

    by_slug = {p["slug"]: p for p in people}
    by_squash = defaultdict(list)
    for p in people:
        by_squash[fps.squash(p["slug"])].append(p)
        by_squash[fps.squash(p["name"])].append(p)
    book_idx = defaultdict(list)  # normalized main title → our books
    for b in books:
        book_idx[cm.title_key(b["title"])].append(b)
    shelf = defaultdict(set)  # person id → book ids
    for r in recs:
        shelf[r["person_id"]].add(r["book_id"])

    def match_person(rtt_slug: str, page_name: str):
        cands = [by_slug.get(rtt_slug)] + by_squash.get(fps.squash(rtt_slug), []) + by_squash.get(fps.squash(page_name), [])
        seen, uniq = set(), []
        for p in cands:
            if p and p["id"] not in seen and fps.person_name_matches(page_name, p["name"]):
                seen.add(p["id"])
                uniq.append(p)
        return uniq[0] if len(uniq) == 1 else None  # ambiguous or none → treat as no match

    def our_books_for(card: dict) -> list[dict]:
        return [b for b in book_idx.get(cm.title_key(card["title"]), []) if cm.author_matches(card.get("author"), b.get("author_name"))]

    # ── RTT side ───────────────────────────────────────────────────────────────
    R = rtt.RttFetcher(args.offline)
    lst = rtt.rtt_person_urls(R)
    fps.log(f"RTT person URLs: sitemap {lst['n_sitemap']}, with /people {lst['n_total']}")
    slug_url = lst["slug_url"]
    if args.people:
        keep = set(args.people.split(","))
        slug_url = {s: u for s, u in slug_url.items() if s in keep}

    people_rows, pair_rows = [], []
    totals = Counter()
    fetched = 0
    try:
        for i, (slug, url) in enumerate(sorted(slug_url.items())):
            if fetched >= args.max_pages and not R.cache_path(url).exists():
                totals["skipped_page_cap"] += 1
                continue
            res = R.get(url)
            if not R.cache_path(url).exists() or res.get("status") != 200:
                totals[f"fetch_{res.get('status') or res.get('error')}"] += 1
                continue
            fetched += 1
            if i and i % 50 == 0:
                fps.log(f"  {i}/{len(slug_url)} persons processed, {R.requests} requests, {dict(R.status)}")
            page = rtt.parse_rtt_person(res["text"], slug)
            if not page:
                totals["unparseable"] += 1
                continue
            mine = match_person(slug, page["name"] or "")
            st = Counter()
            seen_pairs = set()
            for c in page["cards"]:
                key = (fps.norm_title(c["title"]), fps.surname(c["author"]))
                if key in seen_pairs:
                    continue
                seen_pairs.add(key)
                cands = our_books_for(c)
                if mine and any(b["id"] in shelf[mine["id"]] for b in cands):
                    status = "covered"
                elif cands:
                    status = "missing_pair"
                else:
                    status = "missing_book"
                st[status] += 1
                if status != "covered":
                    ptr, ptype = pointer_of(c)
                    pair_rows.append({
                        "rtt_person_slug": slug, "person_name": page["name"], "matched_slug": mine["slug"] if mine else "",
                        "status": status, "book_title": c["title"], "book_author": c["author"],
                        "our_book_slug": cands[0]["slug"] if cands else "",
                        "pointer_url": ptr, "pointer_type": ptype,
                        "pointer_has_quote": bool(c.get("quote")), "source_year": c.get("source_year") or "",
                    })
            people_rows.append({
                "rtt_person_slug": slug, "person_name": page["name"], "matched_slug": mine["slug"] if mine else "",
                "our_status": (mine or {}).get("index_status", "not_in_our_db"), "our_recs": len(shelf[mine["id"]]) if mine else 0,
                "rtt_books": sum(st.values()), "rtt_claimed": page["claimed_books"],
                "covered": st["covered"], "missing_pair": st["missing_pair"], "missing_book": st["missing_book"],
            })
            totals["persons"] += 1
            totals["persons_matched" if mine else "persons_unmatched"] += 1
            for k in ("covered", "missing_pair", "missing_book"):
                totals[f"books_{k}"] += st[k]
    except rtt.RttStop as e:
        fps.log(f"STOPPED: {e}")
        totals["stopped_by_rtt"] = 1

    write_csv(OUT_PEOPLE, people_rows, ["rtt_person_slug", "person_name", "matched_slug", "our_status", "our_recs", "rtt_books",
                                        "rtt_claimed", "covered", "missing_pair", "missing_book"])
    write_csv(OUT_PAIRS, pair_rows, ["rtt_person_slug", "person_name", "matched_slug", "status", "book_title", "book_author",
                                     "our_book_slug", "pointer_url", "pointer_type", "pointer_has_quote", "source_year"])
    summary = {"rtt_person_urls": lst["n_total"], "network_requests": R.requests, "http_status": dict(R.status),
               "totals": dict(totals), "pairs_with_pointer": sum(1 for r in pair_rows if r["pointer_url"]),
               "pointer_types": dict(Counter(r["pointer_type"] for r in pair_rows if r["pointer_url"]))}
    OUT_SUMMARY.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    fps.log(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
