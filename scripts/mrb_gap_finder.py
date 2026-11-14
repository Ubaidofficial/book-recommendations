#!/usr/bin/env python3
"""
Coverage gap against mostrecommendedbooks.com (MRB): people, books and series
it lists that we do not. DRY RUN, READ-ONLY (public key; reports/ only).

Same limits as scripts/find_primary_sources.py: its Fetcher (robots.txt honoured,
never /api /search /admin /go/, >= 1.1 s per host, cached under
reports/third_party_cache/, stop on 429). MRB's terms have no automated-access
clause and forbid reproducing MRB-written text, so only FACTS are kept: person,
book title/author, series name/slug and the cited primary-source URL as a pointer.

OUTPUT
  reports/mrb_gap_people.csv     one row per MRB person: matched to ours or not, covered / missing_pair / missing_book
  reports/mrb_gap_pairs.csv      one row per (person, book) we lack, with the cited source as a pointer
  reports/mrb_series_featured.csv  series MRB shows on pages of people we have, vs our `series` table:
                                 same_slug / same_name / missing, and how many of our people feature it
  reports/mrb_gap_summary.json

  python3 -I scripts/mrb_gap_finder.py [--max-pages N] [--offline]
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
from mrb_series_gap import name_key  # noqa: E402

OUT_PEOPLE = fps.REPORTS / "mrb_gap_people.csv"
OUT_PAIRS = fps.REPORTS / "mrb_gap_pairs.csv"
OUT_SERIES = fps.REPORTS / "mrb_series_featured.csv"
OUT_SUMMARY = fps.REPORTS / "mrb_gap_summary.json"


def pointer_of(card: dict) -> tuple[str, str]:
    for u in card.get("links") or []:
        u = fps.clean_url(u)
        h = fps.host_of(u)
        if not h or h.endswith("mostrecommendedbooks.com") or fps.is_blocked_site(u) or any(x in h for x in fps.REJECT_HOSTS):
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
    ap.add_argument("--max-pages", type=int, default=100000)
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args()

    people = fps.sb_read_all("people", "id,slug,name,index_status")
    books = fps.sb_read_all("books", "id,slug,title,author_name")
    recs = fps.sb_read_all("book_recommendations", "id,person_id,book_id")
    series = fps.sb_read_all("series", "id,slug,title,book_count,index_status")
    fps.log(f"ours: {len(people)} people, {len(books)} books, {len(recs)} recs, {len(series)} series")

    by_slug = {p["slug"]: p for p in people}
    by_squash = defaultdict(list)
    for p in people:
        by_squash[fps.squash(p["slug"])].append(p)
        by_squash[fps.squash(p["name"])].append(p)
    book_idx = defaultdict(list)
    for b in books:
        book_idx[cm.title_key(b["title"])].append(b)
    shelf = defaultdict(set)
    for r in recs:
        shelf[r["person_id"]].add(r["book_id"])
    s_by_slug = {s["slug"]: s for s in series}
    s_by_key = defaultdict(list)
    for s in series:
        for k in {name_key(s["slug"]), name_key(s.get("title") or "")}:
            if k:
                s_by_key[k].append(s)

    def match_person(mslug: str, page_name: str):
        cands = [by_slug.get(mslug)] + by_squash.get(fps.squash(mslug), []) + by_squash.get(fps.squash(page_name), [])
        seen, uniq = set(), []
        for p in cands:
            if p and p["id"] not in seen and fps.person_name_matches(page_name, p["name"]):
                seen.add(p["id"])
                uniq.append(p)
        return uniq[0] if len(uniq) == 1 else None

    def our_books_for(card: dict) -> list[dict]:
        return [b for b in book_idx.get(cm.title_key(card["title"]), []) if cm.author_matches(card.get("author"), b.get("author_name"))]

    F = fps.Fetcher(args.offline)
    sm = F.get(f"{fps.MRB}/people/sitemap.xml", "mrb")
    urls = sorted(set(re.findall(r"<loc>(https://mostrecommendedbooks\.com/people/[^<]+-recommended-books)</loc>", sm.get("text", ""))))
    fps.log(f"MRB person pages: {len(urls)}")

    people_rows, pair_rows = [], []
    feat = defaultdict(lambda: {"name": "", "books": 0, "people": set()})
    totals, fetched = Counter(), 0
    try:
        for i, url in enumerate(urls):
            mslug = url.rsplit("/", 1)[1][: -len("-recommended-books")]
            if fetched >= args.max_pages and not F._cache_path(url, "mrb").exists():
                totals["skipped_page_cap"] += 1
                continue
            res = F.get(url, "mrb")
            fetched += 1
            if res.get("status") != 200:
                totals[f"fetch_{res.get('status') or res.get('error')}"] += 1
                continue
            page = fps.parse_mrb_person(res["text"])
            if not page["name"]:
                totals["unparseable"] += 1
                continue
            mine = match_person(mslug, page["name"])
            st, seen_pairs = Counter(), set()
            for c in page["cards"]:
                if c.get("series") and c["series"]["position"] is None:
                    continue  # the whole-series card is not a book
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
                    pair_rows.append({"mrb_person_slug": mslug, "person_name": page["name"], "matched_slug": mine["slug"] if mine else "",
                                      "status": status, "book_title": c["title"], "book_author": c["author"],
                                      "our_book_slug": cands[0]["slug"] if cands else "", "pointer_url": ptr, "pointer_type": ptype,
                                      "pointer_has_quote": bool(c.get("quote")), "series": (c.get("series") or {}).get("name", "")})
            if mine:  # series MRB shows on a page of someone we have
                for s in page["series"]:
                    f = feat[s["slug"]]
                    f["name"], f["books"] = s["name"], max(f["books"], s.get("books") or 0)
                    f["people"].add(mine["slug"])
            people_rows.append({"mrb_person_slug": mslug, "person_name": page["name"], "matched_slug": mine["slug"] if mine else "",
                                "our_status": (mine or {}).get("index_status", "not_in_our_db"), "our_recs": len(shelf[mine["id"]]) if mine else 0,
                                "mrb_books": sum(st.values()), "mrb_claimed": page["claimed_books"] or 0,
                                "covered": st["covered"], "missing_pair": st["missing_pair"], "missing_book": st["missing_book"]})
            totals["persons"] += 1
            totals["persons_matched" if mine else "persons_unmatched"] += 1
            for k in ("covered", "missing_pair", "missing_book"):
                totals[f"books_{k}"] += st[k]
            if i and i % 50 == 0:
                fps.log(f"  {i}/{len(urls)} persons, {sum(F.network_requests.values())} requests")
    except fps.StopRun as e:
        fps.log(f"STOPPED: {e}")
        totals["stopped"] = 1

    series_rows = []
    for slug, f in sorted(feat.items(), key=lambda kv: -len(kv[1]["people"])):
        if slug in s_by_slug:
            status, o = "same_slug", s_by_slug[slug]
        else:
            hits = s_by_key.get(name_key(slug), []) or s_by_key.get(name_key(f["name"]), [])
            status, o = ("same_name", hits[0]) if len(hits) == 1 else (("ambiguous", hits[0]) if hits else ("missing", None))
        series_rows.append({"mrb_series_slug": slug, "name": f["name"], "mrb_books": f["books"], "our_people_featuring": len(f["people"]),
                            "status": status, "our_slug": o["slug"] if o else "", "our_book_count": (o or {}).get("book_count", ""),
                            "our_index_status": (o or {}).get("index_status", "")})

    write_csv(OUT_PEOPLE, people_rows, ["mrb_person_slug", "person_name", "matched_slug", "our_status", "our_recs", "mrb_books", "mrb_claimed", "covered", "missing_pair", "missing_book"])
    write_csv(OUT_PAIRS, pair_rows, ["mrb_person_slug", "person_name", "matched_slug", "status", "book_title", "book_author", "our_book_slug", "pointer_url", "pointer_type", "pointer_has_quote", "series"])
    write_csv(OUT_SERIES, series_rows, ["mrb_series_slug", "name", "mrb_books", "our_people_featuring", "status", "our_slug", "our_book_count", "our_index_status"])
    summary = {"mrb_person_urls": len(urls), "network_requests": sum(F.network_requests.values()), "totals": dict(totals),
               "pairs_with_pointer": sum(1 for r in pair_rows if r["pointer_url"]),
               "series_featured_on_our_people": len(series_rows), "series_status": dict(Counter(r["status"] for r in series_rows))}
    OUT_SUMMARY.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    fps.log(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
