#!/usr/bin/env python3
# Preview-only title (and subtitle) normalization for BookRecs books.
#
# SAFETY MODEL
#   - READ-ONLY. NO DB writes. NO AI calls.
#   - The script proposes deterministic fixes for KNOWN broken titles by slug.
#     Anything else surfaces as needs_manual_review with a reason listing the
#     suspicious tokens — it never invents a fix.
#   - Default output: rebuild_v2/title_normalization_preview_v1.csv
#   - Source: live Supabase if SUPABASE_URL + SUPABASE_SECRET_KEY are set,
#     otherwise --production-dir backups/path1_pre_lists_migration_<ts>/ for offline.
#
# WHAT WE WOULD NEVER TOUCH
#   - books.slug
#   - books.author_name
#   - books.description / editorial fields / covers
#   - lists / categories / series / recommendations
#
# WHAT WE WOULD TOUCH IN A FUTURE LIVE WRITE
#   - ONLY books.title (and books.subtitle when present + obviously broken)
#
# USAGE
#   python scripts/path1_title_normalization_preview.py \
#       --production-dir backups/path1_pre_lists_migration_20260527T084428Z
#
#   # Live (when creds available):
#   python scripts/path1_title_normalization_preview.py

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

csv.field_size_limit(10**9)


# ─────────────────────────────────────────────────────────────────────────────
# Known deterministic title fixes — keyed by slug. Each is a list of
# (needle, replacement, reason). Both title and (optional) subtitle are scanned
# for the same needles; only the EXACT substring is replaced.
# ─────────────────────────────────────────────────────────────────────────────

KNOWN_TITLE_FIXES: Dict[str, List[Tuple[str, str, str]]] = {
    "the-threebody-problem-cixin-liu": [
        ("ThreeBody", "Three-Body", "known_title_spacing_hyphenation_fix"),
    ],
}


# ─────────────────────────────────────────────────────────────────────────────
# Broad-scan detection of suspicious title patterns. Matches "mashed words"
# like "ThreeBody" / "EnglishSpeaking" — anything that looks like two adjacent
# words missing a space or hyphen. Allowlist legitimate camelCase brand names.
# ─────────────────────────────────────────────────────────────────────────────

MASHED_WORD_RE = re.compile(r"\b[A-Za-z]*[a-z][A-Z][a-z]+[A-Za-z]*\b")
MASHED_ALLOW = {
    "iphone", "ipad", "imac", "ipod", "macbook", "youtube", "linkedin",
    "wikipedia", "javascript", "typescript", "github", "gitlab", "openai",
    "deepmind", "deepseek", "tiktok", "snapchat", "whatsapp", "facebook",
    "instagram", "ebay", "powerpoint", "wordpress",
    "mcdonald", "mcdonalds",          # MacDonald-style proper nouns
    "tedtalk", "tedtalks",
}


def detect_mashed_tokens(text: str) -> List[str]:
    if not text:
        return []
    out: List[str] = []
    for m in MASHED_WORD_RE.finditer(text):
        tok = m.group(0)
        if tok.lower() in MASHED_ALLOW:
            continue
        out.append(tok)
    # de-dup preserving order
    seen = set()
    dedup: List[str] = []
    for t in out:
        if t not in seen:
            seen.add(t)
            dedup.append(t)
    return dedup


# ─────────────────────────────────────────────────────────────────────────────
# Live / backup source loading
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


# Defensive: we only ever read the subset of columns we need. The script never
# writes, so column-set drift on other columns has no effect.
_LIVE_SELECT = "id,slug,title,subtitle,author_name,recommendation_count"


def fetch_books_live(url: str, key: str, page: int = 1000) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    offset = 0
    while True:
        params = {
            "select": _LIVE_SELECT,
            "order": "recommendation_count.desc.nullslast,title.asc",
            "limit": str(page),
            "offset": str(offset),
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
            print(f"[supabase] HTTP {e.code} on GET books: {body[:200]}")
            return rows
        if not batch:
            break
        rows.extend(batch)
        offset += len(batch)
        if len(batch) < page:
            break
    return rows


def load_books(args: argparse.Namespace) -> Tuple[List[Dict[str, Any]], str]:
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
    return fetch_books_live(url, key), f"LIVE {url}"


# ─────────────────────────────────────────────────────────────────────────────
# Gated write path
# ─────────────────────────────────────────────────────────────────────────────

def _supa_get_book_title_state(url: str, key: str, book_id: str) -> Optional[Dict[str, Any]]:
    """Live GET for ONE book by id. Reads id/slug/title/subtitle only."""
    params = {
        "select": "id,slug,title,subtitle",
        "id": f"eq.{book_id}",
        "limit": "1",
    }
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode(params)
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    try:
        data = _req("GET", full, h) or []
        return data[0] if data else None
    except Exception as e:
        print(f"[supabase] live-fetch failed for {book_id}: {type(e).__name__}: {str(e)[:120]}")
        return None


def _supa_patch_title_subtitle(url: str, key: str, book_id: str,
                                title: str, subtitle: Optional[str]) -> None:
    """PATCH ONLY title (and subtitle when subtitle is not None). No other columns touched."""
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode({"id": f"eq.{book_id}"})
    h = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    payload: Dict[str, Any] = {"title": title}
    if subtitle is not None:
        payload["subtitle"] = subtitle
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(full, data=data, method="PATCH", headers=h)
    with urllib.request.urlopen(req, timeout=60) as resp:
        resp.read()  # drain


def _load_approved_title_rows(preview_path: str) -> Tuple[List[Dict[str, Any]], int, List[Tuple[str, str]]]:
    """Read the preview CSV and apply a DEFENSIVE double-filter:
    action=would_update AND confidence=high AND non-empty proposed_title.
    Returns (eligible_rows, total_rows_read, refused_rows[(slug, reason), ...]).
    """
    if not os.path.exists(preview_path):
        raise SystemExit(f"--preview file not found: {preview_path}")
    with open(preview_path, newline="", encoding="utf-8") as f:
        all_rows = list(csv.DictReader(f))
    eligible: List[Dict[str, Any]] = []
    refused: List[Tuple[str, str]] = []
    for r in all_rows:
        action = (r.get("action") or "").strip()
        confidence = (r.get("confidence") or "").strip()
        proposed = (r.get("proposed_title") or "").strip()
        slug = r.get("slug", "")
        if action != "would_update":
            refused.append((slug, f"action={action!r}"))
            continue
        if confidence != "high":
            refused.append((slug, f"confidence={confidence!r}"))
            continue
        if not proposed:
            refused.append((slug, "proposed_title is empty"))
            continue
        eligible.append(r)
    return eligible, len(all_rows), refused


WRITE_REPORT_COLUMNS = [
    "book_id", "slug", "status", "reason",
    "title_before", "title_after",
    "subtitle_before", "subtitle_after",
]
BACKUP_COLUMNS = ["book_id", "slug", "title_before", "subtitle_before"]


def do_gated_write(args: argparse.Namespace) -> int:
    """Triple-gated title (+ subtitle) write path.

    Default mode (--preview is set but --write is NOT) is dry-run-write:
    pure CSV inspection, no Supabase calls, no PATCH.

    Live write mode requires ALL three gates:
      --write
      --confirm-title-normalization
      --backup-before-write PATH
    """
    write_enabled = bool(args.write)
    if write_enabled:
        if not args.confirm_title_normalization:
            raise SystemExit("[write] --write requires --confirm-title-normalization")
        if not args.backup_before_write:
            raise SystemExit("[write] --write requires --backup-before-write PATH")

    eligible, rows_read, refused = _load_approved_title_rows(args.preview)

    print("== Title normalization WRITE ==")
    print(f"mode                  : {'LIVE WRITE' if write_enabled else 'DRY-RUN (no Supabase)'}")
    print(f"preview               : {args.preview}")
    print(f"rows read             : {rows_read}")
    print(f"eligible rows         : {len(eligible)} (action=would_update, confidence=high, non-empty proposed_title)")
    if refused:
        print(f"refused rows          : {len(refused)}")
        for slug, why in refused[:10]:
            print(f"  - {slug}: {why}")
    print(f"write_enabled         : {write_enabled}")
    print(f"PATCH columns         : title, subtitle (ONLY)")
    print("no AI calls           : confirmed")

    out_csv = args.out
    out_dir = os.path.dirname(out_csv)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    if not write_enabled:
        # DRY-RUN: just report what WOULD be written. No Supabase calls.
        report_rows: List[Dict[str, Any]] = []
        for r in eligible:
            cur_sub = (r.get("current_subtitle") or "")
            new_sub = (r.get("proposed_subtitle") or "")
            report_rows.append({
                "book_id": r.get("book_id", ""),
                "slug": r.get("slug", ""),
                "status": "would_write",
                "reason": "dry-run; no live drift check; --write not passed",
                "title_before": r.get("current_title", ""),
                "title_after": r.get("proposed_title", ""),
                "subtitle_before": cur_sub,
                "subtitle_after": new_sub,
            })
        with open(out_csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=WRITE_REPORT_COLUMNS)
            w.writeheader()
            for rr in report_rows:
                w.writerow(rr)
        print(f"\nwould_write           : {len(report_rows)}")
        print(f"report                : {out_csv}")
        print("\nNO DB WRITES. NO AI CALLS. NO PATCH/POST/DELETE.")
        return 0

    # ── LIVE WRITE — gates already enforced; check creds + drift + backup
    url, key = _creds()
    if not url or not key:
        raise SystemExit(
            "[write] live write requires SUPABASE_URL + SUPABASE_SECRET_KEY in env"
        )

    backup_path = args.backup_before_write
    backup_dir = os.path.dirname(backup_path)
    if backup_dir:
        os.makedirs(backup_dir, exist_ok=True)

    plan: List[Dict[str, Any]] = []
    backup_rows: List[Dict[str, Any]] = []
    skips_drift = 0
    skips_missing = 0
    print(f"\n[backup] fetching {len(eligible)} live rows for drift check + backup…")
    for r in eligible:
        book_id = r.get("book_id", "")
        live = _supa_get_book_title_state(url, key, book_id)
        if not live:
            plan.append({
                "row": r, "live": None,
                "status": "skipped",
                "reason": "live row missing or fetch error",
            })
            skips_missing += 1
            continue
        live_title = (live.get("title") or "")
        live_sub = (live.get("subtitle") or "")
        prev_title = (r.get("current_title") or "")
        prev_sub = (r.get("current_subtitle") or "")
        if live_title != prev_title:
            plan.append({
                "row": r, "live": live,
                "status": "skipped",
                "reason": f"title drifted since preview (live={live_title!r} vs preview={prev_title!r})",
            })
            skips_drift += 1
            continue
        if prev_sub and live_sub != prev_sub:
            plan.append({
                "row": r, "live": live,
                "status": "skipped",
                "reason": f"subtitle drifted since preview (live={live_sub!r} vs preview={prev_sub!r})",
            })
            skips_drift += 1
            continue
        plan.append({"row": r, "live": live, "status": "would_write", "reason": ""})
        backup_rows.append({
            "book_id": live.get("id", ""),
            "slug": live.get("slug", ""),
            "title_before": live_title,
            "subtitle_before": live_sub,
        })

    # Write backup BEFORE any PATCH
    with open(backup_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=BACKUP_COLUMNS)
        w.writeheader()
        for b in backup_rows:
            w.writerow(b)
    expected_backup = sum(1 for p in plan if p["status"] == "would_write")
    if len(backup_rows) != expected_backup:
        raise SystemExit(
            f"[backup] count mismatch ({len(backup_rows)} vs {expected_backup}) — aborting before any PATCH"
        )
    print(f"[backup] wrote {len(backup_rows)} rows -> {backup_path}")

    # ── PATCH phase
    print(f"\n[patch] writing title + subtitle for {expected_backup} rows…")
    updated = 0
    failed = 0
    for p in plan:
        if p["status"] != "would_write":
            continue
        r = p["row"]
        live = p["live"]
        proposed_title = r.get("proposed_title", "")
        # Only PATCH subtitle when the preview's proposed_subtitle differs from current
        cur_sub = r.get("current_subtitle", "")
        new_sub = r.get("proposed_subtitle", "")
        send_subtitle = new_sub if new_sub and new_sub != cur_sub else None
        try:
            _supa_patch_title_subtitle(url, key, live["id"], proposed_title, send_subtitle)
            p["status"] = "updated"
            p["reason"] = f"title normalized ({r.get('reason', '')})"
            updated += 1
        except Exception as e:
            p["status"] = "failed"
            p["reason"] = f"PATCH error: {type(e).__name__}: {str(e)[:120]}"
            failed += 1

    # ── Report
    report_rows = []
    for p in plan:
        r = p["row"]
        live = p["live"] or {}
        title_before = live.get("title", r.get("current_title", "")) if p["live"] else r.get("current_title", "")
        sub_before = live.get("subtitle", r.get("current_subtitle", "")) if p["live"] else r.get("current_subtitle", "")
        title_after = r.get("proposed_title", "") if p["status"] == "updated" else ""
        sub_after = r.get("proposed_subtitle", "") if p["status"] == "updated" else ""
        report_rows.append({
            "book_id": r.get("book_id", ""),
            "slug": r.get("slug", ""),
            "status": p["status"],
            "reason": p["reason"],
            "title_before": title_before,
            "title_after": title_after,
            "subtitle_before": sub_before,
            "subtitle_after": sub_after,
        })
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=WRITE_REPORT_COLUMNS)
        w.writeheader()
        for rr in report_rows:
            w.writerow(rr)

    print()
    print(f"updated               : {updated}")
    print(f"skipped (drift)       : {skips_drift}")
    print(f"skipped (missing)     : {skips_missing}")
    print(f"failed                : {failed}")
    print(f"backup                : {backup_path}")
    print(f"report                : {out_csv}")
    print("\nNO AI CALLS. PATCH limited to `title` and `subtitle` columns only.")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# Detection / proposal
# ─────────────────────────────────────────────────────────────────────────────

def evaluate_book(book: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Return a CSV row dict, or None to skip entirely."""
    slug = (book.get("slug") or "").strip()
    title = (book.get("title") or "").strip()
    subtitle = (book.get("subtitle") or "").strip()

    fixes = KNOWN_TITLE_FIXES.get(slug)
    if fixes:
        new_title = title
        new_subtitle = subtitle
        reasons_applied: List[str] = []
        for needle, repl, reason in fixes:
            if needle in new_title or needle in new_subtitle:
                new_title = new_title.replace(needle, repl)
                new_subtitle = new_subtitle.replace(needle, repl)
                reasons_applied.append(reason)
        if not reasons_applied:
            # broken pattern not present in the live row → user wants action=skip
            return {
                "book_id": book.get("id", ""),
                "slug": slug,
                "current_title": title,
                "proposed_title": "",
                "current_subtitle": subtitle,
                "proposed_subtitle": "",
                "reason": "already_clean_or_drifted",
                "confidence": "",
                "action": "skip",
            }
        return {
            "book_id": book.get("id", ""),
            "slug": slug,
            "current_title": title,
            "proposed_title": new_title,
            "current_subtitle": subtitle,
            "proposed_subtitle": new_subtitle,
            "reason": ";".join(reasons_applied),
            "confidence": "high",
            "action": "would_update",
        }

    # Broad-scan: surface suspicious titles for manual review only — no fix proposed
    mashed = detect_mashed_tokens(title)
    if mashed:
        return {
            "book_id": book.get("id", ""),
            "slug": slug,
            "current_title": title,
            "proposed_title": "",
            "current_subtitle": subtitle,
            "proposed_subtitle": "",
            "reason": f"mashed_words_in_title:{','.join(mashed[:5])}",
            "confidence": "low",
            "action": "needs_manual_review",
        }
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

PREVIEW_COLUMNS = [
    "book_id", "slug", "current_title", "proposed_title",
    "current_subtitle", "proposed_subtitle",
    "reason", "confidence", "action",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--production-dir", default="",
                    help="Optional offline books.csv source. Uses backup if Supabase creds absent.")
    ap.add_argument("--out", default="rebuild_v2/title_normalization_preview_v1.csv")
    ap.add_argument("--min-recommendations", type=int, default=3,
                    help="Filter the broad scan to books with recs>=N. Known-slug rules always fire regardless.")
    ap.add_argument("--slugs", default="",
                    help="Comma-separated slugs to ALWAYS include in the preview (even if recs filter excludes them).")
    # Gated write path (engages only when --preview is passed)
    ap.add_argument("--preview", default="",
                    help="Path to a preview CSV. When set, switches to write-mode "
                         "(dry-run by default; --write enables PATCH).")
    ap.add_argument("--write", action="store_true",
                    help="GATED: also requires --confirm-title-normalization AND --backup-before-write.")
    ap.add_argument("--confirm-title-normalization", action="store_true",
                    help="Second gate for live write. Required with --write.")
    ap.add_argument("--backup-before-write", default="",
                    help="Path to pre-write backup CSV. Required with --write.")
    args = ap.parse_args()

    # When --preview is set, route to the gated write path. The default
    # scan/preview mode (no --preview flag) remains read-only and AI-free.
    if args.preview:
        return do_gated_write(args)

    books, source = load_books(args)
    print("== Title normalization PREVIEW (READ-ONLY) ==")
    print(f"source                 : {source}")
    print(f"books loaded           : {len(books)}")

    pinned = {s.strip() for s in args.slugs.split(",") if s.strip()}
    # Always pin every known-fixes slug — these are the explicit targets
    pinned |= set(KNOWN_TITLE_FIXES.keys())

    flagged: List[Dict[str, Any]] = []
    scanned = 0
    for b in books:
        recs = int(b.get("recommendation_count") or 0)
        slug = (b.get("slug") or "").strip()
        if slug not in pinned and recs < args.min_recommendations:
            continue
        scanned += 1
        row = evaluate_book(b)
        if row is None:
            continue
        flagged.append(row)

    # Sort known-slug rows first, then by recs desc
    def sort_key(r: Dict[str, Any]) -> Tuple[int, int, str]:
        is_known = 0 if r["slug"] in KNOWN_TITLE_FIXES else 1
        return (is_known, 0, r["slug"])
    flagged.sort(key=sort_key)

    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=PREVIEW_COLUMNS)
        w.writeheader()
        for r in flagged:
            w.writerow(r)

    n_update = sum(1 for r in flagged if r["action"] == "would_update")
    n_skip = sum(1 for r in flagged if r["action"] == "skip")
    n_manual = sum(1 for r in flagged if r["action"] == "needs_manual_review")
    print(f"scanned                : {scanned}")
    print(f"rows in preview        : {len(flagged)}")
    print(f"  would_update         : {n_update}")
    print(f"  skip                 : {n_skip}")
    print(f"  needs_manual_review  : {n_manual}")
    print(f"output csv             : {args.out}")

    if flagged:
        print()
        print("known-slug + first 10 manual-review rows:")
        for r in flagged[:20]:
            print(f"  [{r['action']:20s} {r['confidence']:5s}] {r['slug']}")
            print(f"      current_title    : {r['current_title']!r}")
            if r["proposed_title"]:
                print(f"      proposed_title   : {r['proposed_title']!r}")
            if r["current_subtitle"]:
                print(f"      current_subtitle : {r['current_subtitle']!r}")
            if r["proposed_subtitle"]:
                print(f"      proposed_subtitle: {r['proposed_subtitle']!r}")
            print(f"      reason           : {r['reason']}")
    print()
    print("NO DB WRITES. NO AI CALLS. NO MIGRATION. NO SCHEMA CHANGES.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
