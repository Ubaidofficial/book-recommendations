#!/usr/bin/env python3
# READ-ONLY priority report for cover-backfill candidates.
#
# Walks the production backup books.csv + book_lists.csv + lists.csv and produces a
# ranked CSV of HIGH-PRIORITY books that need a cover. Priority signals:
#   - high recommendation_count
#   - appears in the "most-recommended-books" meta list
#   - missing / placeholder cover_image_url
# Also records possible external identifiers (ISBN-10/13, OpenLibrary id, Google Books id)
# so a future enrichment pass can look them up.
#
# NO DB WRITES. NO EXTERNAL API CALLS.
#
# Usage:
#   python scripts/path1_cover_backfill_priority.py
#   python scripts/path1_cover_backfill_priority.py --min-recs 10 --top 200

from __future__ import annotations
import argparse
import csv
import os
import re
from typing import Any, Dict, List, Optional, Set

csv.field_size_limit(10**9)

PLACEHOLDER_PATTERNS = [
    re.compile(r"^\s*$"),
    re.compile(r"^\s*null\s*$", re.IGNORECASE),
    re.compile(r"^\s*none\s*$", re.IGNORECASE),
    re.compile(r"^\s*coming soon\s*$", re.IGNORECASE),
    re.compile(r"^\s*placeholder", re.IGNORECASE),
]


def _to_int(v: Any) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _is_missing_or_placeholder(cover: Any) -> bool:
    if cover is None:
        return True
    if not isinstance(cover, str):
        return True
    s = cover.strip()
    if not s:
        return True
    for pat in PLACEHOLDER_PATTERNS:
        if pat.match(s):
            return True
    if not s.lower().startswith(("http://", "https://")):
        return True
    return False


def load_csv(path: str) -> List[Dict[str, str]]:
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--production-dir", default="backups/path1_pre_lists_migration_20260527T084428Z")
    ap.add_argument("--out", default="rebuild_v2/cover_backfill_priority_v1.csv")
    ap.add_argument("--min-recs", type=int, default=3, help="Minimum recommendation_count for a book to qualify (default 3).")
    ap.add_argument("--top", type=int, default=500, help="Cap output to top-N by priority score (default 500).")
    args = ap.parse_args()

    print(f"== Cover backfill PRIORITY report (READ-ONLY) ==")
    print(f"production: {args.production_dir}")

    books_path = os.path.join(args.production_dir, "books.csv")
    lists_path = os.path.join(args.production_dir, "lists.csv")
    book_lists_path = os.path.join(args.production_dir, "book_lists.csv")
    books = load_csv(books_path)
    if not books:
        raise SystemExit(f"books.csv not found or empty: {books_path}")
    lists = load_csv(lists_path)
    bl = load_csv(book_lists_path)
    print(f"  books        : {len(books)}")
    print(f"  lists        : {len(lists)}")
    print(f"  book_lists   : {len(bl)}")

    # Identify the most-recommended-books list id (if present)
    meta_list_id: Optional[str] = None
    for l in lists:
        if (l.get("slug") or "").lower() == "most-recommended-books":
            meta_list_id = l.get("id")
            break
    in_meta: Set[str] = set()
    if meta_list_id:
        for r in bl:
            if r.get("list_id") == meta_list_id:
                bid = r.get("book_id")
                if bid:
                    in_meta.add(bid)
    print(f"  most-recommended-books id: {meta_list_id or '<absent>'}")
    print(f"  books in most-recommended-books: {len(in_meta)}")

    # Walk books, filter to missing-cover, score by priority.
    candidates: List[Dict[str, Any]] = []
    for b in books:
        cover = b.get("cover_image_url")
        if not _is_missing_or_placeholder(cover):
            continue
        rec_count = _to_int(b.get("recommendation_count"))
        is_meta = b.get("id") in in_meta
        if not (rec_count >= args.min_recs or is_meta):
            continue
        # Priority score: 100×meta_flag + recommendation_count
        score = (100 if is_meta else 0) + rec_count
        reasons: List[str] = []
        if is_meta:
            reasons.append("most-recommended-books")
        if rec_count >= 10:
            reasons.append(f"high_recs({rec_count})")
        elif rec_count >= args.min_recs:
            reasons.append(f"recs({rec_count})")
        if not cover:
            reasons.append("cover_null")
        elif not (cover or "").strip():
            reasons.append("cover_empty")
        else:
            reasons.append("cover_placeholder")
        candidates.append({
            "priority_score": score,
            "book_id": b.get("id", ""),
            "slug": b.get("slug", ""),
            "title": b.get("title", ""),
            "author": b.get("author_name", "") or b.get("author", ""),
            "recommendation_count": rec_count,
            "in_most_recommended_books": "true" if is_meta else "false",
            "current_cover_image_url": (cover or "").strip(),
            "isbn_10": (b.get("isbn_10") or "").strip(),
            "isbn_13": (b.get("isbn_13") or "").strip(),
            "open_library_id": (b.get("open_library_id") or "").strip(),
            "google_books_id": (b.get("google_books_id") or "").strip(),
            "reason": " | ".join(reasons),
        })

    candidates.sort(key=lambda x: (-x["priority_score"], -x["recommendation_count"]))
    truncated = candidates[: args.top]

    parent_dir = os.path.dirname(args.out)
    if parent_dir:
        os.makedirs(parent_dir, exist_ok=True)
    cols = ["priority_score", "book_id", "slug", "title", "author",
            "recommendation_count", "in_most_recommended_books",
            "current_cover_image_url", "isbn_10", "isbn_13",
            "open_library_id", "google_books_id", "reason"]
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in truncated:
            w.writerow(r)

    print(f"\n== RESULT ==")
    print(f"  candidates (missing-cover + meta or recs>={args.min_recs}): {len(candidates)}")
    print(f"  written to {args.out} (capped at {len(truncated)})")
    if truncated:
        with_meta = sum(1 for r in truncated if r["in_most_recommended_books"] == "true")
        with_ids = sum(1 for r in truncated if r["isbn_13"] or r["isbn_10"] or r["open_library_id"] or r["google_books_id"])
        print(f"  in most-recommended-books    : {with_meta}")
        print(f"  with at least one identifier : {with_ids}")
        print(f"\n  top 10 priorities:")
        for r in truncated[:10]:
            print(f"    {r['priority_score']:4d}  {r['title'][:48]:48s} | recs={r['recommendation_count']:3d} | {r['reason']}")
    print(f"\nNO DB WRITES PERFORMED. NO EXTERNAL API CALLS.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
