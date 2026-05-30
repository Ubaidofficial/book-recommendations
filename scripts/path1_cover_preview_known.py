#!/usr/bin/env python3
# Preview-only cover backfill report for KNOWN slugs (plus optional broad scan).
#
# SAFETY MODEL
#   - READ-ONLY. NO DB writes. NO image uploads.
#   - Reuses Google Books + Open Library JSON endpoints already used by
#     scripts/path1_cover_backfill.py. The downloads are JSON only — never images.
#   - Verifies author + title match against the live book row before proposing
#     a candidate. The conservative scoring inherited from path1_cover_backfill
#     refuses to propose when there isn't a clean author+title overlap.
#   - For the known-broken-edition case (The Outsiders has *two* unrelated books:
#     Thorndike's CEO book vs. S.E. Hinton's novel), the score-threshold + author
#     match guard against accidentally picking the wrong cover.
#
# USAGE
#   python scripts/path1_cover_preview_known.py \
#     --production-dir backups/path1_pre_lists_migration_20260527T084428Z \
#     --out rebuild_v2/cover_backfill_preview_v1.csv
#
#   # Live (when creds available):
#   python scripts/path1_cover_preview_known.py \
#     --out rebuild_v2/cover_backfill_preview_v1.csv

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
csv.field_size_limit(10**9)

# Reuse the cover-backfill helpers (no DB writes, no image downloads — only JSON).
from path1_cover_backfill import (  # noqa: E402
    is_missing_or_placeholder,
    best_candidate,
)


# Always include these slugs regardless of broad-scan filters.
DEFAULT_KNOWN_SLUGS = [
    "the-outsiders-william-n-thorndike",
    "the-threebody-problem-cixin-liu",
]


# ─────────────────────────────────────────────────────────────────────────────
# Source loading (live Supabase OR offline backup)
# ─────────────────────────────────────────────────────────────────────────────

def _creds() -> Tuple[str, str]:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    key = (os.environ.get("SUPABASE_SECRET_KEY")
           or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or "")
    return url.rstrip("/"), key


def _req(method: str, url: str, headers: Dict[str, str]) -> Any:
    req = urllib.request.Request(url, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body) if body else None


_LIVE_SELECT = "id,slug,title,author_name,cover_image_url,recommendation_count,list_count,isbn_10,isbn_13"


def fetch_books_live(url: str, key: str, slugs: List[str], page: int = 1000) -> List[Dict[str, Any]]:
    """If specific slugs are requested, fetch them directly via slug.in.(...).
    Otherwise paginate all books."""
    rows: List[Dict[str, Any]] = []
    if slugs:
        in_list = ",".join(f'"{s}"' for s in slugs)
        params = {
            "select": _LIVE_SELECT,
            "slug": f"in.({in_list})",
            "limit": str(max(len(slugs), 10)),
        }
        full = f"{url}/rest/v1/books?" + urllib.parse.urlencode(params)
        h = {"apikey": key, "Authorization": f"Bearer {key}"}
        try:
            return _req("GET", full, h) or []
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8")
            except Exception:
                pass
            print(f"[supabase] HTTP {e.code} on GET books by slug: {body[:200]}")
            return rows
    # broad-scan path
    offset = 0
    while True:
        params = {
            "select": _LIVE_SELECT,
            "order": "recommendation_count.desc.nullslast,title.asc",
            "limit": str(page), "offset": str(offset),
        }
        full = f"{url}/rest/v1/books?" + urllib.parse.urlencode(params)
        h = {"apikey": key, "Authorization": f"Bearer {key}"}
        try:
            batch = _req("GET", full, h) or []
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8")
            except Exception:
                pass
            print(f"[supabase] HTTP {e.code}: {body[:200]}")
            return rows
        if not batch:
            break
        rows.extend(batch)
        offset += len(batch)
        if len(batch) < page:
            break
    return rows


def load_books(args: argparse.Namespace, pinned_slugs: List[str]) -> Tuple[List[Dict[str, Any]], str]:
    if args.production_dir:
        path = os.path.join(args.production_dir, "books.csv")
        if not os.path.exists(path):
            raise SystemExit(f"backup books.csv not found: {path}")
        with open(path, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        return rows, f"BACKUP {args.production_dir}"
    url, key = _creds()
    if not url or not key:
        raise SystemExit(
            "No Supabase credentials in env and no --production-dir.\n"
            "Export SUPABASE_URL + SUPABASE_SECRET_KEY (or pass --production-dir backups/...)."
        )
    # If only known slugs are requested, fetch JUST them.
    slugs_to_fetch = pinned_slugs if not args.broad_scan else []
    rows = fetch_books_live(url, key, slugs_to_fetch)
    return rows, f"LIVE {url}"


# ─────────────────────────────────────────────────────────────────────────────
# Output schema
# ─────────────────────────────────────────────────────────────────────────────

PREVIEW_COLUMNS = [
    "book_id", "slug", "title",
    "current_cover_url", "current_cover_status",
    "candidate_cover_url", "candidate_source",
    "candidate_reason", "confidence", "action",
]


def classify_current(cover: Any) -> str:
    if cover is None:
        return "null"
    if not isinstance(cover, str):
        return f"non_string({type(cover).__name__})"
    s = cover.strip()
    if not s:
        return "empty"
    if not s.lower().startswith(("http://", "https://")):
        return f"placeholder_or_relative_path({s[:60]})"
    return "ok"


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--production-dir", default="",
                    help="Optional offline books.csv source. Uses backup if creds absent.")
    ap.add_argument("--out", default="rebuild_v2/cover_backfill_preview_v1.csv")
    ap.add_argument("--slugs", default=",".join(DEFAULT_KNOWN_SLUGS),
                    help="Comma-separated slugs to ALWAYS include.")
    ap.add_argument("--broad-scan", action="store_true",
                    help="Also scan top books with missing covers (recs>=min-recs).")
    ap.add_argument("--min-recommendations", type=int, default=20)
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--score-threshold", type=float, default=0.82)
    ap.add_argument("--source", choices=["google_books", "open_library", "both"], default="both")
    ap.add_argument("--max-results-per-source", type=int, default=5)
    ap.add_argument("--sleep", type=float, default=0.2)
    args = ap.parse_args()

    pinned = [s.strip() for s in args.slugs.split(",") if s.strip()]
    print("== Cover backfill PREVIEW (READ-ONLY) ==")
    print(f"pinned slugs           : {pinned}")
    print(f"broad scan             : {args.broad_scan}")
    if args.broad_scan:
        print(f"  min-recommendations  : {args.min_recommendations}")
        print(f"  limit                : {args.limit}")
    print(f"score-threshold        : {args.score_threshold}")
    print(f"sources                : {args.source}")

    books, src = load_books(args, pinned)
    print(f"source                 : {src}")
    print(f"books loaded           : {len(books)}")

    # Targets: pinned slugs that exist + (optionally) top missing-cover books
    by_slug = {(b.get("slug") or "").strip(): b for b in books}
    targets: List[Dict[str, Any]] = []
    seen_ids: set = set()
    for s in pinned:
        b = by_slug.get(s)
        if b is None:
            print(f"  [WARN] pinned slug not found in source: {s}")
            continue
        targets.append(b)
        seen_ids.add(b.get("id"))

    if args.broad_scan:
        broad = [
            b for b in books
            if b.get("id") not in seen_ids
            and is_missing_or_placeholder(b.get("cover_image_url"))
            and int(b.get("recommendation_count") or 0) >= args.min_recommendations
            and (b.get("title") or "").strip()
        ]
        broad.sort(key=lambda b: -int(b.get("recommendation_count") or 0))
        broad = broad[: max(0, args.limit - len(targets))]
        targets.extend(broad)
        print(f"broad-scan extras      : {len(broad)}")

    print(f"total targets          : {len(targets)}")
    print()

    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    rows_out: List[Dict[str, Any]] = []
    for i, b in enumerate(targets, 1):
        slug = (b.get("slug") or "").strip()
        title = (b.get("title") or "").strip()
        author = (b.get("author_name") or b.get("author") or "").strip()
        cover = b.get("cover_image_url")
        status = classify_current(cover)

        print(f"[{i}/{len(targets)}] {slug}  (author={author!r}, status={status})")
        cand = best_candidate(b, args.source, args.max_results_per_source, args.sleep)
        row: Dict[str, Any] = {
            "book_id": b.get("id", ""),
            "slug": slug,
            "title": title,
            "current_cover_url": (cover or "") or "",
            "current_cover_status": status,
            "candidate_cover_url": "",
            "candidate_source": "",
            "candidate_reason": "",
            "confidence": "",
            "action": "",
        }
        if cand is None:
            row["candidate_reason"] = "no_result_from_any_source"
            row["confidence"] = "low"
            row["action"] = "needs_manual_cover"
        else:
            score = float(cand.get("score") or 0.0)
            row["candidate_cover_url"] = cand["image"]
            row["candidate_source"] = cand["source"]
            row["candidate_reason"] = (
                f"score={score:.3f}; method={cand['method']}; "
                f"cand_title={cand['cand_title']!r}; cand_author={cand['cand_author']!r}; "
                f"identifier={cand['identifier']!r}"
            )
            if score >= args.score_threshold:
                row["confidence"] = "high"
                row["action"] = "would_backfill"
            elif score >= 0.6:
                row["confidence"] = "medium"
                row["action"] = "needs_manual_cover"
                row["candidate_reason"] += "; below_threshold_review_required"
            else:
                row["confidence"] = "low"
                row["action"] = "needs_manual_cover"
                row["candidate_reason"] += "; below_safe_floor"
        rows_out.append(row)

    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=PREVIEW_COLUMNS)
        w.writeheader()
        for r in rows_out:
            w.writerow(r)

    n_back = sum(1 for r in rows_out if r["action"] == "would_backfill")
    n_manual = sum(1 for r in rows_out if r["action"] == "needs_manual_cover")
    print()
    print(f"rows in preview        : {len(rows_out)}")
    print(f"  would_backfill       : {n_back}")
    print(f"  needs_manual_cover   : {n_manual}")
    print(f"output csv             : {args.out}")
    print()
    print("Per-row summary:")
    for r in rows_out:
        print(f"  {r['action']:20s} {r['confidence']:6s}  {r['slug']}")
        print(f"      current_cover_url    : {r['current_cover_url']!r}")
        print(f"      current_cover_status : {r['current_cover_status']}")
        if r["candidate_cover_url"]:
            print(f"      candidate_cover_url  : {r['candidate_cover_url']}")
            print(f"      candidate_source     : {r['candidate_source']}")
        print(f"      candidate_reason     : {r['candidate_reason']}")
    print()
    print("NO DB WRITES. NO IMAGES DOWNLOADED OR UPLOADED.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
