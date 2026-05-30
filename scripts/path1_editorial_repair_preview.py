#!/usr/bin/env python3
# READ-ONLY repair preview for the per-character corruption in
# `books.best_for` and `books.not_for`.
#
# Root cause (confirmed via backup inspection):
#   The editorial writer in scripts/generate_book_editorial_enrichment.py sends
#   `best_for` and `not_for` as STRINGS (pipe-joined "item1 | item2 | item3").
#   These columns in production are `text[]`, so Postgres iterated each character
#   of the string and stored each char as a separate array element. When read back,
#   the value looks like:  "A |   | f | i | r | s | t | - | t | i | m | e | …"
#
#   `key_themes` survived because the writer sends it as a Python list
#   (`(...).split("|")`) which JSON-serialises to a proper array on the wire.
#   `editorial_summary`, `recommendation_context`, `source_quality_note` survived
#   because those columns are `text`, not `text[]`.
#
# This script:
#   - Walks the production backup books.csv read-only.
#   - Detects rows whose best_for / not_for is char-corrupted.
#   - Reconstructs the clean items by joining every array element (no separator)
#     to recover the original pipe-joined string, then splitting on " | ".
#   - Writes a preview CSV with current vs reconstructed values for human review.
#
# DOES NOT WRITE TO THE DB. DOES NOT MODIFY THE AI GENERATION SCRIPT.

from __future__ import annotations
import argparse
import csv
import os
from typing import List, Optional, Tuple

csv.field_size_limit(10**9)


def is_char_corrupted(v: Optional[str]) -> bool:
    """True when a stored text[] value has clearly been serialised char-by-char."""
    if not v or not isinstance(v, str):
        return False
    parts = [p.strip() for p in v.split("|")]
    if len(parts) < 10:
        return False
    short = sum(1 for p in parts if len(p) <= 1)
    return short / len(parts) > 0.5


def reconstruct_items(stored: str) -> List[str]:
    """Recover the original pipe-joined items from a per-character-serialised text[] value.

    Mechanism:
      Postgres serialised array `["A", " ", "f", "i", "r", "s", "t", " ", "|", " ", "A", " ", "P", "M"]`
      back to a display string by joining with " | ".  So splitting on " | " yields
      each original element (including " " spaces and the literal "|" item).  Joining
      every element with no separator reconstructs the original input string —
      "A first-time founder ... | A senior marketer ..." — which we then split on
      " | " to get the intended items.
    """
    if not stored:
        return []
    elements = stored.split(" | ")
    original = "".join(elements)
    # Now split on " | " (the writer's join separator)
    items = [s.strip() for s in original.split(" | ")]
    return [s for s in items if s]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--production-dir", default="backups/path1_pre_lists_migration_20260527T084428Z")
    ap.add_argument("--out", default="rebuild_v2/editorial_repair_preview.csv")
    args = ap.parse_args()

    books_path = os.path.join(args.production_dir, "books.csv")
    if not os.path.exists(books_path):
        print(f"[fatal] missing {books_path}")
        return 1
    with open(books_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    print(f"== Editorial repair PREVIEW (READ-ONLY) ==")
    print(f"source: {books_path}  rows={len(rows)}")

    # 1) Identify affected rows
    affected: List[dict] = []
    for r in rows:
        bf = r.get("best_for") or ""
        nf = r.get("not_for") or ""
        if is_char_corrupted(bf) or is_char_corrupted(nf):
            affected.append(r)
    print(f"affected rows (char-corrupted best_for or not_for): {len(affected)}")

    # 2) Build preview rows
    out_rows: List[List[str]] = []
    for r in affected:
        bf = r.get("best_for") or ""
        nf = r.get("not_for") or ""
        bf_clean = reconstruct_items(bf) if is_char_corrupted(bf) else []
        nf_clean = reconstruct_items(nf) if is_char_corrupted(nf) else []
        out_rows.append([
            r.get("id", ""), r.get("slug", ""), r.get("title", ""),
            r.get("ai_quality_status", ""),
            "best_for",
            bf[:120],
            len(bf.split("|")),
            " ||| ".join(bf_clean),
            len(bf_clean),
        ])
        out_rows.append([
            r.get("id", ""), r.get("slug", ""), r.get("title", ""),
            r.get("ai_quality_status", ""),
            "not_for",
            nf[:120],
            len(nf.split("|")),
            " ||| ".join(nf_clean),
            len(nf_clean),
        ])

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            "book_id", "slug", "title", "ai_quality_status",
            "field", "current_value_first_120_chars", "current_split_pipe_count",
            "reconstructed_items_joined_by_|||", "reconstructed_item_count",
        ])
        w.writerows(out_rows)

    print(f"\n-> wrote {args.out}")
    print(f"")
    print(f"== sample reconstructions ==")
    for r in affected[:3]:
        bf = r.get("best_for") or ""
        nf = r.get("not_for") or ""
        print(f"\n  {r.get('slug')}  ({r.get('title')})")
        if is_char_corrupted(bf):
            items = reconstruct_items(bf)
            print(f"    best_for current chars : {len(bf.split('|'))} elements")
            print(f"    best_for reconstructed : {len(items)} items")
            for i, it in enumerate(items[:4], 1):
                print(f"      {i}. {it[:110]}{'…' if len(it) > 110 else ''}")
        if is_char_corrupted(nf):
            items = reconstruct_items(nf)
            print(f"    not_for  current chars : {len(nf.split('|'))} elements")
            print(f"    not_for  reconstructed : {len(items)} items")
            for i, it in enumerate(items[:4], 1):
                print(f"      {i}. {it[:110]}{'…' if len(it) > 110 else ''}")

    print(f"\nNO DB WRITES PERFORMED. This is analysis + preview only.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
