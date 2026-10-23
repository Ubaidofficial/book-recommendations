#!/usr/bin/env python3
"""
Flag "<author> books in order" series that are missing an author's major works.

A reading-order page that silently skips books answers its query wrongly (the
harry-potter series held 5 of the 7 novels on 2026-10-23), so a series should
not be published until it holds the author's well-known books.

For each series this finds the series' dominant author, asks Open Library for
that author's works sorted by edition count, keeps the "major" ones (at least
--min-editions editions, the author listed first), and reports which of them
the series does not contain. Read-only: writes a CSV and changes nothing.

Character-named series ("jack-reacher", "harry-potter") are compared against
the same author list, which includes the author's other books, so their
"missing" column needs a human read. The report marks them `character`.

  python scripts/series_completeness_check.py --series lee-child-books-in-order
  python scripts/series_completeness_check.py --series-file slugs.txt --report out.csv
"""

from __future__ import annotations

import argparse
import collections
import csv
import os
import re
import sys
import time
import urllib.parse
from typing import Any, Dict, List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from enrich_books_metadata import OPEN_LIBRARY_SEARCH_URL, author_similarity, http_json, normalize, title_similarity  # noqa: E402
from backfill_first_published_year import supabase_get  # noqa: E402


def series_books(slug: str) -> List[Dict[str, Any]]:
    rows = supabase_get("series", {"select": "id", "slug": f"eq.{slug}"})
    if not rows:
        return []
    links = supabase_get("book_series", {"select": "books(title,author_name)", "series_id": f"eq.{rows[0]['id']}", "limit": "2000"})
    return [r["books"] for r in links if r.get("books")]


def major_works(author: str, min_editions: int) -> List[Dict[str, Any]]:
    params = {"author": author, "sort": "editions", "limit": "100",
              "fields": "title,author_name,edition_count,first_publish_year"}
    url = OPEN_LIBRARY_SEARCH_URL + "?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            docs = http_json(url, headers={"User-Agent": "BookMentions/1.0 (series completeness check)"}).get("docs", [])
            break
        except Exception:
            time.sleep(2 ** attempt)
    else:
        return []
    works, seen = [], set()
    for d in docs:
        names = d.get("author_name") or []
        if not names or author_similarity(author, names[0]) < 0.8:
            continue
        if int(d.get("edition_count") or 0) < min_editions:
            continue
        key = normalize(re.sub(r"\(.*?\)", "", d.get("title") or ""))
        if key and key not in seen:
            seen.add(key)
            works.append(d)
    return works


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--series", action="append", default=[])
    parser.add_argument("--series-file")
    parser.add_argument("--min-editions", type=int, default=30)
    parser.add_argument("--report", default="series_completeness_report.csv")
    parser.add_argument("--delay", type=float, default=0.5)
    args = parser.parse_args()

    slugs = list(args.series)
    if args.series_file:
        slugs += [l.strip() for l in open(args.series_file) if l.strip()]

    out = []
    for slug in slugs:
        books = series_books(slug)
        if not books:
            out.append({"series": slug, "kind": "", "author": "", "books": 0, "major_works": 0, "missing_count": 0, "missing": "series not found"})
            continue
        author = collections.Counter(b.get("author_name") or "" for b in books).most_common(1)[0][0]
        base = slug.replace("-books-in-order", "").replace("-", " ")
        kind = "author" if author_similarity(base, author) >= 0.8 else "character"
        works = major_works(author, args.min_editions)
        titles = [b["title"] for b in books]
        missing = [w["title"] for w in works if max((title_similarity(w["title"], t) for t in titles), default=0) < 0.85]
        out.append({"series": slug, "kind": kind, "author": author, "books": len(books),
                    "major_works": len(works), "missing_count": len(missing), "missing": " | ".join(missing[:15])})
        time.sleep(args.delay)

    with open(args.report, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["series", "kind", "author", "books", "major_works", "missing_count", "missing"])
        w.writeheader()
        w.writerows(out)
    print(f"{len(out)} series checked. Report: {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
