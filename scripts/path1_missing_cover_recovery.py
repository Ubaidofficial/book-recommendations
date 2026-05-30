#!/usr/bin/env python3
# Gated missing-cover recovery driven by a curated input CSV.
#
# SAFETY MODEL
#   - PREVIEW BY DEFAULT. NO DB writes. NO image uploads. NO image downloads.
#   - Triple-gated write: --write + --confirm-cover-backfill +
#     --backup-before-write PATH. Any one missing aborts.
#   - PATCH target is ONLY the cover-image URL column. Nothing else.
#   - Live drift check at write time: refuse to PATCH if the live row's cover
#     is no longer empty (a book that got a cover via some other path stays
#     untouched here).
#   - Reuses scoring helpers from scripts/path1_cover_backfill.py (Google Books
#     + Open Library JSON endpoints; no image bytes are ever fetched).
#
# INPUT
#   rebuild_v2/missing_cover_priority_v1.csv with columns:
#     recs, slug, title, author, cover_image
#
# OUTPUT
#   Preview : rebuild_v2/missing_cover_priority_preview_v1.csv
#   Write   : rebuild_v2/missing_cover_priority_write_v1.csv
#
# COLUMN NAME NOTE
#   The input CSV uses the master-list convention `cover_image`. The live
#   Supabase column is `cover_image_url`. The script reads the input's
#   `cover_image` and PATCHes the live `cover_image_url`. Override with
#   --live-column-name if your DB uses a different column name.
#
# USAGE
#   # Preview (default — no writes, only JSON lookups)
#   python scripts/path1_missing_cover_recovery.py
#
#   # Future live write (DO NOT RUN until explicitly approved)
#   python scripts/path1_missing_cover_recovery.py \
#       --preview rebuild_v2/missing_cover_priority_preview_v1.csv \
#       --write --confirm-cover-backfill \
#       --backup-before-write backups/missing_cover_priority_pre_v1.csv

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

# Reuse scoring helpers from the existing cover backfill script.
# Only the JSON-lookup + scoring path — no DB or image-byte code is imported.
from path1_cover_backfill import (  # noqa: E402
    best_candidate,
    is_missing_or_placeholder,
)


PREVIEW_COLUMNS = [
    "slug", "title", "author", "recs",
    "current_cover_image",
    "candidate_cover_url", "candidate_source",
    "candidate_title", "candidate_author",
    "score", "confidence", "action", "reason",
]
WRITE_REPORT_COLUMNS = [
    "slug", "title", "status", "reason",
    "cover_image_before", "cover_image_after",
    "candidate_source", "score",
]
BACKUP_COLUMNS = ["book_id", "slug", "title", "cover_image_before"]

SCORE_HIGH_THRESHOLD = 0.82
SCORE_MEDIUM_FLOOR = 0.60


# ─────────────────────────────────────────────────────────────────────────────
# Supabase access (live only — never used in preview)
# ─────────────────────────────────────────────────────────────────────────────

def _creds() -> Tuple[str, str]:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    key = (os.environ.get("SUPABASE_SECRET_KEY")
           or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or "")
    return url.rstrip("/"), key


def _req(method: str, url: str, headers: Dict[str, str],
         payload: Optional[Dict[str, Any]] = None) -> Any:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body) if body else None


def _supa_get_by_slug(url: str, key: str, slug: str, live_col: str) -> Optional[Dict[str, Any]]:
    params = {
        "select": f"id,slug,title,{live_col}",
        "slug": f"eq.{slug}",
        "limit": "1",
    }
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode(params)
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    try:
        data = _req("GET", full, h) or []
        return data[0] if data else None
    except Exception as e:
        print(f"[supabase] fetch failed for slug={slug!r}: {type(e).__name__}: {str(e)[:120]}")
        return None


def _supa_patch_cover(url: str, key: str, book_id: str, cover_url: str, live_col: str) -> None:
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode({"id": f"eq.{book_id}"})
    h = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    # PATCH payload is dict-literal with ONE column. No dynamic fan-out.
    _req("PATCH", full, h, payload={live_col: cover_url})


# ─────────────────────────────────────────────────────────────────────────────
# Input loading
# ─────────────────────────────────────────────────────────────────────────────

def load_input_csv(path: str) -> List[Dict[str, Any]]:
    if not os.path.exists(path):
        raise SystemExit(f"input CSV not found: {path}")
    with open(path, newline="", encoding="utf-8") as f:
        rdr = csv.DictReader(f)
        rows = list(rdr)
    out: List[Dict[str, Any]] = []
    for r in rows:
        out.append({
            "slug": (r.get("slug") or "").strip(),
            "title": (r.get("title") or "").strip(),
            "author": (r.get("author") or r.get("author_name") or "").strip(),
            "recs": int(r.get("recs") or r.get("recommendation_count") or 0),
            "cover_image": (r.get("cover_image") or r.get("cover_image_url") or "").strip(),
            # Pass-through fields used by best_candidate scorer
            "id": (r.get("book_id") or r.get("id") or "").strip(),
            "isbn_10": (r.get("isbn_10") or "").strip(),
            "isbn_13": (r.get("isbn_13") or "").strip(),
            # author_name is the canonical key used inside best_candidate
            "author_name": (r.get("author") or r.get("author_name") or "").strip(),
        })
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Preview mode — no Supabase, JSON lookups only
# ─────────────────────────────────────────────────────────────────────────────

def classify(score: float) -> Tuple[str, str, str]:
    """Return (confidence, action, reason_tag) per the requested rule:
    action=would_backfill iff confidence=high AND score>=0.82."""
    if score >= SCORE_HIGH_THRESHOLD:
        return "high", "would_backfill", f"score {score:.3f} >= high_threshold {SCORE_HIGH_THRESHOLD}"
    if score >= SCORE_MEDIUM_FLOOR:
        return "medium", "needs_manual_cover", f"score {score:.3f} below high_threshold {SCORE_HIGH_THRESHOLD}"
    return "low", "needs_manual_cover", f"score {score:.3f} below safe floor {SCORE_MEDIUM_FLOOR}"


def do_preview(args: argparse.Namespace) -> int:
    rows = load_input_csv(args.input)
    print("== Missing-cover recovery PREVIEW (READ-ONLY) ==")
    print(f"input csv             : {args.input}")
    print(f"rows in input         : {len(rows)}")
    print(f"sources               : {args.source}")
    print(f"score-threshold       : {SCORE_HIGH_THRESHOLD}")
    print()

    out_rows: List[Dict[str, Any]] = []
    for i, b in enumerate(rows, 1):
        # Defensive: skip rows where cover_image is non-empty (input is supposed
        # to be only missing-cover rows, but we won't trust blindly).
        current_cover = b.get("cover_image", "")
        if not is_missing_or_placeholder(current_cover):
            out_rows.append({
                "slug": b["slug"], "title": b["title"], "author": b["author"],
                "recs": b["recs"], "current_cover_image": current_cover,
                "candidate_cover_url": "", "candidate_source": "",
                "candidate_title": "", "candidate_author": "",
                "score": "", "confidence": "",
                "action": "needs_manual_cover",
                "reason": "input row already has a cover; refusing to overwrite at preview time",
            })
            continue

        print(f"[{i}/{len(rows)}] {b['slug']}  (title={b['title']!r}, author={b['author']!r})")
        cand = best_candidate(
            b, args.source, args.max_results_per_source, args.sleep,
        )
        if cand is None:
            out_rows.append({
                "slug": b["slug"], "title": b["title"], "author": b["author"],
                "recs": b["recs"], "current_cover_image": current_cover,
                "candidate_cover_url": "", "candidate_source": "",
                "candidate_title": "", "candidate_author": "",
                "score": 0.0, "confidence": "none",
                "action": "needs_manual_cover",
                "reason": "no result from any source",
            })
            continue

        score = float(cand.get("score") or 0.0)
        conf, action, reason_tag = classify(score)
        out_rows.append({
            "slug": b["slug"], "title": b["title"], "author": b["author"],
            "recs": b["recs"], "current_cover_image": current_cover,
            "candidate_cover_url": cand["image"],
            "candidate_source": cand["source"],
            "candidate_title": cand["cand_title"],
            "candidate_author": cand["cand_author"],
            "score": round(score, 3),
            "confidence": conf,
            "action": action,
            "reason": (
                f"{reason_tag}; method={cand['method']}; "
                f"identifier={cand['identifier']!r}"
            ),
        })

    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=PREVIEW_COLUMNS)
        w.writeheader()
        for r in out_rows:
            w.writerow(r)

    n_back = sum(1 for r in out_rows if r["action"] == "would_backfill")
    n_manual = sum(1 for r in out_rows if r["action"] == "needs_manual_cover")

    print()
    print("==================== PREVIEW SUMMARY ====================")
    print(f"  rows in input          : {len(rows)}")
    print(f"  rows in preview        : {len(out_rows)}")
    print(f"    would_backfill       : {n_back}")
    print(f"    needs_manual_cover   : {n_manual}")
    print(f"  output csv             : {args.out}")
    print(f"  PATCH column (later)   : {args.live_column_name} only")
    print(f"  NO AI calls            : confirmed")
    print(f"  NO image downloads     : confirmed (JSON metadata only)")
    print(f"  NO DB writes           : confirmed")
    print()
    print("Per-row summary:")
    for r in out_rows:
        print(f"  {r['action']:22s} {r['confidence']:6s}  score={r['score']!s:5s}  {r['slug']}")
        if r["candidate_cover_url"]:
            print(f"      candidate         : {r['candidate_cover_url']}")
            print(f"      candidate_title   : {r['candidate_title']!r}")
            print(f"      candidate_author  : {r['candidate_author']!r}")
        print(f"      reason            : {r['reason']}")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# Gated write mode
# ─────────────────────────────────────────────────────────────────────────────

def _load_eligible_preview_rows(preview_path: str) -> Tuple[List[Dict[str, Any]], int, List[Tuple[str, str]]]:
    """Defensive triple-filter at load time:
    action=would_backfill AND confidence=high AND non-empty candidate_cover_url."""
    if not os.path.exists(preview_path):
        raise SystemExit(f"--preview file not found: {preview_path}")
    with open(preview_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    eligible: List[Dict[str, Any]] = []
    refused: List[Tuple[str, str]] = []
    for r in rows:
        slug = r.get("slug", "")
        action = (r.get("action") or "").strip()
        confidence = (r.get("confidence") or "").strip()
        candidate_url = (r.get("candidate_cover_url") or "").strip()
        try:
            score = float(r.get("score") or 0)
        except (TypeError, ValueError):
            score = 0.0
        if action != "would_backfill":
            refused.append((slug, f"action={action!r}"))
            continue
        if confidence != "high":
            refused.append((slug, f"confidence={confidence!r}"))
            continue
        if not candidate_url:
            refused.append((slug, "candidate_cover_url empty"))
            continue
        if score < SCORE_HIGH_THRESHOLD:
            refused.append((slug, f"score {score} below threshold {SCORE_HIGH_THRESHOLD}"))
            continue
        eligible.append(r)
    return eligible, len(rows), refused


def do_write(args: argparse.Namespace) -> int:
    if not args.confirm_cover_backfill:
        raise SystemExit("[write] --write requires --confirm-cover-backfill")
    if not args.backup_before_write:
        raise SystemExit("[write] --write requires --backup-before-write PATH")
    if not args.preview or not os.path.exists(args.preview):
        raise SystemExit(f"[write] --write requires --preview PATH (got: {args.preview!r})")
    url, key = _creds()
    if not url or not key:
        raise SystemExit("[write] live write requires SUPABASE_URL + SUPABASE_SECRET_KEY in env")

    eligible, rows_read, refused = _load_eligible_preview_rows(args.preview)
    print("== Missing-cover recovery WRITE ==")
    print(f"mode                  : LIVE WRITE")
    print(f"preview               : {args.preview}")
    print(f"rows read             : {rows_read}")
    print(f"eligible rows         : {len(eligible)} (action=would_backfill, confidence=high, score>={SCORE_HIGH_THRESHOLD})")
    if refused:
        print(f"refused rows          : {len(refused)}")
        for slug, why in refused[:10]:
            print(f"  - {slug}: {why}")
    print(f"PATCH column          : {args.live_column_name} (ONLY)")
    print(f"no AI calls           : confirmed")
    print(f"no image downloads    : confirmed")

    backup_path = args.backup_before_write
    backup_dir = os.path.dirname(backup_path)
    if backup_dir:
        os.makedirs(backup_dir, exist_ok=True)

    plan: List[Dict[str, Any]] = []
    backup_rows: List[Dict[str, Any]] = []
    skipped_drift = 0
    skipped_missing = 0
    print(f"\n[backup] fetching {len(eligible)} live rows for drift check + backup…")
    for r in eligible:
        slug = r.get("slug", "")
        live = _supa_get_by_slug(url, key, slug, args.live_column_name)
        if not live:
            plan.append({"row": r, "live": None, "status": "skipped",
                         "reason": f"slug {slug!r} not found in live DB"})
            skipped_missing += 1
            continue
        live_cover = live.get(args.live_column_name)
        # Drift check: live cover must STILL be missing/placeholder. If something
        # else gave the book a cover since the preview, do not overwrite.
        if not is_missing_or_placeholder(live_cover):
            plan.append({"row": r, "live": live, "status": "skipped",
                         "reason": f"live cover is no longer empty (={live_cover!r})"})
            skipped_drift += 1
            continue
        plan.append({"row": r, "live": live, "status": "would_write", "reason": ""})
        backup_rows.append({
            "book_id": live.get("id", ""),
            "slug": live.get("slug", ""),
            "title": live.get("title", ""),
            "cover_image_before": live_cover or "",
        })

    with open(backup_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=BACKUP_COLUMNS)
        w.writeheader()
        for b in backup_rows:
            w.writerow(b)
    expected = sum(1 for p in plan if p["status"] == "would_write")
    if len(backup_rows) != expected:
        raise SystemExit(
            f"[backup] count mismatch ({len(backup_rows)} vs {expected}) — aborting before any PATCH"
        )
    print(f"[backup] wrote {len(backup_rows)} rows -> {backup_path}")

    print(f"\n[patch] writing {args.live_column_name} for {expected} rows…")
    updated = 0
    failed = 0
    for p in plan:
        if p["status"] != "would_write":
            continue
        r = p["row"]
        live = p["live"]
        cover_url = (r.get("candidate_cover_url") or "").strip()
        try:
            _supa_patch_cover(url, key, live["id"], cover_url, args.live_column_name)
            p["status"] = "updated"
            p["reason"] = f"score {r.get('score', '')} from {r.get('candidate_source', '')}"
            updated += 1
        except Exception as e:
            p["status"] = "failed"
            p["reason"] = f"PATCH error: {type(e).__name__}: {str(e)[:120]}"
            failed += 1

    report_rows = []
    for p in plan:
        r = p["row"]
        live = p["live"] or {}
        before = live.get(args.live_column_name, "") if live else ""
        after = r.get("candidate_cover_url", "") if p["status"] == "updated" else ""
        report_rows.append({
            "slug": r.get("slug", ""),
            "title": r.get("title", "") or live.get("title", ""),
            "status": p["status"],
            "reason": p["reason"],
            "cover_image_before": before or "",
            "cover_image_after": after,
            "candidate_source": r.get("candidate_source", ""),
            "score": r.get("score", ""),
        })
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=WRITE_REPORT_COLUMNS)
        w.writeheader()
        for rr in report_rows:
            w.writerow(rr)

    print()
    print("==================== WRITE SUMMARY ====================")
    print(f"  rows read             : {rows_read}")
    print(f"  eligible              : {len(eligible)}")
    print(f"  updated               : {updated}")
    print(f"  skipped_drift         : {skipped_drift}")
    print(f"  skipped_missing       : {skipped_missing}")
    print(f"  failed                : {failed}")
    print(f"  backup                : {backup_path}")
    print(f"  report                : {args.out}")
    print(f"  PATCH column          : {args.live_column_name} only")
    print(f"  NO AI calls           : confirmed")
    print(f"  NO image downloads    : confirmed")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="rebuild_v2/missing_cover_priority_v1.csv",
                    help="Input CSV. Default: rebuild_v2/missing_cover_priority_v1.csv")
    ap.add_argument("--out", default="rebuild_v2/missing_cover_priority_preview_v1.csv",
                    help="Output preview CSV (default) or write report CSV.")
    ap.add_argument("--source", choices=["google_books", "open_library", "both"], default="both")
    ap.add_argument("--max-results-per-source", type=int, default=5)
    ap.add_argument("--sleep", type=float, default=0.2)
    ap.add_argument("--live-column-name", default="cover_image_url",
                    help="Live DB column name to PATCH (default: cover_image_url).")
    # Gated write
    ap.add_argument("--preview", default="",
                    help="Path to a preview CSV (required for --write).")
    ap.add_argument("--write", action="store_true",
                    help="GATED: also requires --confirm-cover-backfill AND --backup-before-write.")
    ap.add_argument("--confirm-cover-backfill", action="store_true",
                    help="Second gate for live write.")
    ap.add_argument("--backup-before-write", default="",
                    help="Path to pre-write backup CSV. Required with --write.")
    args = ap.parse_args()

    if args.write:
        # Default --out in write mode is the write-report path
        if args.out == "rebuild_v2/missing_cover_priority_preview_v1.csv":
            args.out = "rebuild_v2/missing_cover_priority_write_v1.csv"
        return do_write(args)
    return do_preview(args)


if __name__ == "__main__":
    raise SystemExit(main())
