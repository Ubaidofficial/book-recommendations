#!/usr/bin/env python3
# Read-only cover-backfill analysis.
# Compares production books missing cover_image_url against rebuild_v2/books.csv.
# Emits candidates CSV. DOES NOT WRITE TO THE DB and DOES NOT INSERT BOOKS.
#
# Inputs:
#   --production-dir  backups/path1_pre_lists_migration_<ts>   (CSV exports of live tables)
#   --rebuild-dir     rebuild_v2                                (rebuilt source-of-truth)
#   --out             rebuild_v2/cover_backfill_candidates.csv
#
# Match layers (same as path1_match):
#   1) slug match
#   2) NFKD-folded title + author
#   3) NFKD-folded title (subtitle stripped) + author
# Layers 2/3 only match when the folded key resolves to exactly ONE production book.
#
# Output columns:
#   production_book_id, slug, title, current_cover_image_url,
#   rebuild_cover_image_url, match_method, confidence,
#   in_best_fashion_books, in_most_recommended_books

from __future__ import annotations
import argparse
import csv
import os
import sys
from collections import Counter
from typing import Dict, List, Optional

sys.path.insert(0, os.path.dirname(__file__))
from path1_match import build_book_index, resolve_book  # noqa: E402

csv.field_size_limit(10**9)


def load_csv(path: str) -> List[Dict[str, str]]:
    if not os.path.exists(path):
        print(f"[warn] missing: {path}")
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def is_present(s) -> bool:
    """Return True only when a value is a non-empty, non-junk cover URL/filename."""
    if s is None:
        return False
    t = str(s).strip()
    if not t:
        return False
    if t.lower() in ("null", "none", "nan"):
        return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--production-dir", default="backups/path1_pre_lists_migration_20260527T084428Z")
    ap.add_argument("--rebuild-dir", default="rebuild_v2")
    ap.add_argument("--out", default="rebuild_v2/cover_backfill_candidates.csv")
    args = ap.parse_args()

    print(f"== Cover backfill analysis (READ-ONLY) ==")
    print(f"production: {args.production_dir}")
    print(f"rebuild:    {args.rebuild_dir}")

    # ── Load production ──
    prod_books = load_csv(os.path.join(args.production_dir, "books.csv"))
    prod_lists = load_csv(os.path.join(args.production_dir, "lists.csv"))
    prod_bl = load_csv(os.path.join(args.production_dir, "book_lists.csv"))
    print(f"  production books:      {len(prod_books)}")
    print(f"  production lists:      {len(prod_lists)}")
    print(f"  production book_lists: {len(prod_bl)}")

    # The production books from the pre-migration snapshot use `cover_image_url`.
    missing_cover = [b for b in prod_books if not is_present(b.get("cover_image_url"))]
    print(f"  production books MISSING cover_image_url: {len(missing_cover)}")
    if not prod_books:
        print("[fatal] no production books — check --production-dir path")
        return 1

    # ── Load rebuild ──
    rb_books = load_csv(os.path.join(args.rebuild_dir, "books.csv"))
    rb_bl = load_csv(os.path.join(args.rebuild_dir, "book_lists.csv"))
    print(f"  rebuild books:         {len(rb_books)}")
    print(f"  rebuild book_lists:    {len(rb_bl)}")
    # The rebuild books.csv uses `cover_image` (filename or URL depending on source).
    rb_with_cover = [b for b in rb_books if is_present(b.get("cover_image"))]
    print(f"  rebuild books with non-empty cover_image: {len(rb_with_cover)}")

    # Build an index of REBUILD books, keyed for matching against production-row shape.
    # build_book_index reads (id, slug, title, author/author_name); our rebuild rows have
    # `book_id` (string) and `author`. Adapt: copy book_id into `id` for the matcher.
    rb_adapted = []
    for r in rb_books:
        rb_adapted.append({
            "id": r.get("book_id"),
            "slug": r.get("slug"),
            "title": r.get("title"),
            "author": r.get("author"),
        })
    rb_idx = build_book_index(rb_adapted)
    rb_cover_by_id: Dict[str, str] = {}
    for r in rb_books:
        bid = r.get("book_id")
        cov = (r.get("cover_image") or "").strip()
        if bid and cov:
            rb_cover_by_id[bid] = cov

    # ── Membership lookup for the two highlighted lists ──
    # Use the REBUILD book_lists to know which rebuild books are in best-fashion-books
    # and most-recommended-books. We then map rebuild→production via the matcher.
    rb_lists_by_slug: Dict[str, str] = {}
    rb_list_rows = load_csv(os.path.join(args.rebuild_dir, "lists.csv"))
    for l in rb_list_rows:
        s = (l.get("slug") or "").lower()
        if s:
            rb_lists_by_slug[s] = l.get("list_id") or ""
    fashion_list_id = rb_lists_by_slug.get("best-fashion-books")
    meta_list_id = rb_lists_by_slug.get("most-recommended-books")
    rb_fashion_book_ids = {m.get("book_id") for m in rb_bl if m.get("list_id") == fashion_list_id and fashion_list_id}
    rb_meta_book_ids = {m.get("book_id") for m in rb_bl if m.get("list_id") == meta_list_id and meta_list_id}
    print(f"  rebuild books in best-fashion-books:    {len(rb_fashion_book_ids)}")
    print(f"  rebuild books in most-recommended-books: {len(rb_meta_book_ids)}")

    # ── Walk production missing-cover books and find rebuild candidates ──
    method_counts: Counter = Counter()
    rows_out: List[List[str]] = []
    fashion_examples: List[List[str]] = []
    meta_examples: List[List[str]] = []

    for pb in missing_cover:
        rb_id, method = resolve_book(rb_idx, pb.get("slug"), pb.get("title"), pb.get("author_name") or pb.get("author"))
        method_counts[method] += 1
        if not rb_id:
            continue
        rb_cover = rb_cover_by_id.get(rb_id)
        if not rb_cover:
            continue   # rebuild also has no cover for this book
        conf = {"slug": "high", "full_fold": "high", "core_fold": "medium"}.get(method, "low")
        in_fashion = "true" if rb_id in rb_fashion_book_ids else "false"
        in_meta = "true" if rb_id in rb_meta_book_ids else "false"
        row = [
            pb.get("id", ""), pb.get("slug", ""), pb.get("title", ""),
            pb.get("cover_image_url", "") or "",
            rb_cover, method, conf, in_fashion, in_meta,
        ]
        rows_out.append(row)
        if in_fashion == "true" and len(fashion_examples) < 10:
            fashion_examples.append(row)
        if in_meta == "true" and len(meta_examples) < 10:
            meta_examples.append(row)

    # ── Write CSV ──
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            "production_book_id", "slug", "title",
            "current_cover_image_url", "rebuild_cover_image_url",
            "match_method", "confidence",
            "in_best_fashion_books", "in_most_recommended_books",
        ])
        w.writerows(rows_out)

    # ── Console report ──
    print()
    print(f"== RESULT ==")
    print(f"  production books missing cover:           {len(missing_cover)}")
    print(f"  production missing covers WITH rebuild candidate: {len(rows_out)} "
          f"({100*len(rows_out)/max(1,len(missing_cover)):.1f}%)")
    print(f"  match method counts: {dict(method_counts)}")
    print(f"  -> wrote {args.out}")
    print()
    print(f"== Top candidates in best-fashion-books (up to 10) ==")
    for r in fashion_examples:
        print(f"  {r[2][:40]:40s} | rebuild_cover={r[4][:50]}  match={r[5]}")
    print()
    print(f"== Top candidates in most-recommended-books (up to 10) ==")
    for r in meta_examples:
        print(f"  {r[2][:40]:40s} | rebuild_cover={r[4][:50]}  match={r[5]}")
    print()
    print("NO DB WRITES PERFORMED. This is analysis only.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
