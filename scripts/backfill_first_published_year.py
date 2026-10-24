#!/usr/bin/env python3
"""
Backfill books.first_published_year from Open Library, for series pages.

Series pages can only claim "<author> books in order" when every book carries
its own first-publication year. books.publish_date can't be used for that: for
series books it holds one year per author/series (every Harry Potter book reads
1997). See migrations/003_books_first_published_year.sql.

For each book in the chosen series this queries Open Library's search API by
title + author, keeps the work-level matches whose title and author both match
closely, and takes first_publish_year from the match with the most editions
(the canonical work rather than an omnibus or a reprint record).

Safe defaults:
- Dry-run by default: writes a CSV report, touches nothing.
- --write only sets first_published_year where the match score clears
  --min-score, and never overwrites an existing value unless --overwrite.
- Requires migration 003 to have been applied before --write.

Environment variables (same as enrich_books_metadata.py):
- SUPABASE_URL=https://your-project.supabase.co
- SUPABASE_SECRET_KEY=...        # required for --write
- SUPABASE_ANON_KEY=...          # enough for dry-run reads if RLS allows it

Examples:
  python scripts/backfill_first_published_year.py --sample-title "Mockingjay" --sample-author "Suzanne Collins"
  python scripts/backfill_first_published_year.py --series john-grisham-books-in-order --series dune-books-in-order
  python scripts/backfill_first_published_year.py --top 50 --max-books 300
  python scripts/backfill_first_published_year.py --top 50 --write --min-score 0.9
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
import time
import urllib.parse
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from enrich_books_metadata import (  # noqa: E402
    OPEN_LIBRARY_SEARCH_URL,
    author_similarity,
    clean,
    http_json,
    http_patch_json,
    supabase_headers,
    supabase_read_key,
    supabase_write_key,
    title_similarity,
)

DEFAULT_REPORT_PATH = "first_published_year_report.csv"
SOURCE_LABEL = "openlibrary:first_publish_year"
# A match below these is treated as a different work (an omnibus, a study
# guide, a same-titled book by someone else) and left NULL.
MIN_TITLE_SIMILARITY = 0.85
MIN_AUTHOR_SIMILARITY = 0.8


def open_library_docs(title: str, author: str, retries: int = 3) -> List[Dict[str, Any]]:
    params = {
        "title": title,
        "author": author,
        "fields": "key,title,author_name,first_publish_year,publish_year,edition_count",
        "limit": "10",
    }
    url = OPEN_LIBRARY_SEARCH_URL + "?" + urllib.parse.urlencode(params)
    for attempt in range(retries):
        try:
            return http_json(url, headers={"User-Agent": "BookMentions/1.0 (first-published-year backfill)"}).get("docs", []) or []
        except Exception as exc:  # network resets happen; back off and retry
            if attempt == retries - 1:
                print(f"[warn] Open Library lookup failed for {title!r}: {exc}", file=sys.stderr)
                return []
            time.sleep(2 ** attempt)
    return []


def corroborated_year(first_year: int, edition_years: List[int]) -> int:
    """Earliest edition year that another edition backs up within two years.

    Open Library's work-level first_publish_year is the minimum over every
    edition record, so one mis-dated edition drags it decades early (Lee
    Child's "Bad Luck and Trouble", 2007, reads 1984 there because of stray
    1984 and 1998 records). A real first edition is followed by reprints and
    paperbacks within a year or two; a stray record usually is not.
    """
    years = sorted(set(y for y in edition_years if isinstance(y, int)))
    if len(years) < 3:
        return first_year
    for i in range(len(years) - 1):
        if years[i + 1] - years[i] <= 2:
            return years[i]
    return first_year


def best_year(title: str, author: str) -> Optional[Dict[str, Any]]:
    """The first-publication year of the closest matching work, or None."""
    candidates = []
    for doc in open_library_docs(title, author):
        year = doc.get("first_publish_year")
        if not isinstance(year, int):
            continue
        t_sim = title_similarity(title, clean(doc.get("title")))
        a_sim = max((author_similarity(author, a) for a in doc.get("author_name") or []), default=0.0)
        if t_sim < MIN_TITLE_SIMILARITY or a_sim < MIN_AUTHOR_SIMILARITY:
            continue
        corroborated = corroborated_year(year, doc.get("publish_year") or [])
        candidates.append({
            "year": year,
            # When the corroborated year disagrees, the true year is uncertain:
            # report it, but never write it.
            "suspect": corroborated != year,
            "corroborated_year": corroborated,
            "score": round(min(t_sim, a_sim), 3),
            "editions": int(doc.get("edition_count") or 0),
            "ol_title": clean(doc.get("title")),
            "ol_key": clean(doc.get("key")),
        })
    if not candidates:
        return None
    # Exact-title matches beat near matches; then the canonical work (most
    # editions) beats one-off reprint records, which carry later years.
    candidates.sort(key=lambda c: (c["score"], c["editions"]), reverse=True)
    return candidates[0]


def supabase_get(path: str, params: Dict[str, str]) -> Any:
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = supabase_read_key()
    if not supabase_url or not key:
        raise SystemExit("Missing SUPABASE_URL and SUPABASE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ANON_KEY.")
    url = f"{supabase_url}/rest/v1/{path}?" + urllib.parse.urlencode(params)
    return http_json(url, headers=supabase_headers(key))


def fetch_series(slugs: List[str], top: int) -> List[Dict[str, Any]]:
    if slugs:
        quoted = ",".join(f'"{s}"' for s in slugs)
        return supabase_get("series", {"select": "id,slug,book_count", "slug": f"in.({quoted})"})
    return supabase_get("series", {
        "select": "id,slug,book_count",
        "order": "book_count.desc",
        "limit": str(top),
    })


def fetch_series_books(series_id: str, with_year_column: bool) -> List[Dict[str, Any]]:
    cols = "id,title,author_name" + (",first_published_year" if with_year_column else "")
    rows = supabase_get("book_series", {"select": f"books({cols})", "series_id": f"eq.{series_id}", "limit": "2000"})
    return [r["books"] for r in rows if r.get("books")]


def year_column_exists() -> bool:
    try:
        supabase_get("books", {"select": "first_published_year", "limit": "1"})
        return True
    except Exception:
        return False


def write_year(book_id: str, year: int) -> None:
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = supabase_write_key()
    if not supabase_url or not key:
        raise SystemExit("Writes require SUPABASE_URL and SUPABASE_SECRET_KEY or legacy SUPABASE_SERVICE_ROLE_KEY.")
    url = f"{supabase_url}/rest/v1/books?id=eq.{urllib.parse.quote(book_id)}"
    http_patch_json(url, {"first_published_year": year, "first_published_year_source": SOURCE_LABEL}, headers=supabase_headers(key))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--series", action="append", default=[], help="Series slug (repeatable).")
    parser.add_argument("--top", type=int, default=20, help="Without --series: the N largest series.")
    parser.add_argument("--max-books", type=int, default=500, help="Stop after this many Open Library lookups.")
    parser.add_argument("--min-score", type=float, default=0.9, help="Minimum match score to write.")
    parser.add_argument("--write", action="store_true", help="Write matches to Supabase (default: dry-run).")
    parser.add_argument("--overwrite", action="store_true", help="Replace an existing first_published_year.")
    parser.add_argument("--delay", type=float, default=0.5, help="Seconds between Open Library requests.")
    parser.add_argument("--report", default=DEFAULT_REPORT_PATH)
    parser.add_argument("--skip-ids-file", help="File of book ids (one per line) already looked up; they are not re-queried.")
    parser.add_argument("--sample-title")
    parser.add_argument("--sample-author", default="")
    args = parser.parse_args()

    if args.sample_title:
        print(best_year(args.sample_title, args.sample_author))
        return 0

    has_column = year_column_exists()
    if args.write and not has_column:
        raise SystemExit("books.first_published_year does not exist yet: apply migrations/003_books_first_published_year.sql first.")

    skip_ids = set()
    if args.skip_ids_file:
        skip_ids = {line.strip() for line in open(args.skip_ids_file) if line.strip()}

    rows: List[Dict[str, Any]] = []
    lookups = written = 0
    for series in fetch_series(args.series, args.top):
        for book in fetch_series_books(series["id"], has_column):
            if lookups >= args.max_books:
                break
            if book["id"] in skip_ids:
                continue
            existing = book.get("first_published_year")
            if existing and not args.overwrite:
                rows.append({"series": series["slug"], "book_id": book["id"], "title": book["title"],
                             "author": book.get("author_name") or "", "year": existing, "status": "kept_existing"})
                continue
            lookups += 1
            match = best_year(book["title"], book.get("author_name") or "")
            status = "no_match"
            if match:
                status = (
                    "suspect_year" if match["suspect"]
                    else "match" if match["score"] >= args.min_score
                    else "below_min_score"
                )
                if args.write and status == "match":
                    write_year(book["id"], match["year"])
                    written += 1
                    status = "written"
            rows.append({
                "series": series["slug"], "book_id": book["id"], "title": book["title"],
                "author": book.get("author_name") or "", "year": match["year"] if match else "",
                "score": match["score"] if match else "", "editions": match["editions"] if match else "",
                "corroborated_year": match["corroborated_year"] if match else "",
                "ol_title": match["ol_title"] if match else "", "ol_key": match["ol_key"] if match else "",
                "status": status,
            })
            time.sleep(args.delay)

    fields = ["series", "book_id", "title", "author", "year", "corroborated_year", "score", "editions", "ol_title", "ol_key", "status"]
    with open(args.report, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    matched = sum(1 for r in rows if r["status"] in ("match", "written", "kept_existing"))
    print(f"{len(rows)} books, {lookups} lookups, {matched} with a year, {written} written. Report: {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
