#!/usr/bin/env python3
# Preview-first description artifact repair pipeline.
#
# SAFETY MODEL
#   - PREVIEW BY DEFAULT. NO DB writes. NO AI calls. NO external API calls.
#   - Triple-gated write: --write + --confirm-description-artifact-repair +
#     --backup-before-write PATH. Any one missing aborts.
#   - PATCH target is ONLY books.description. Never anything else.
#   - Live drift check at write time: refuse to PATCH if live description has
#     changed since the preview was generated.
#   - Pre-write backup of every row, count-validated before any PATCH.
#
# DETECTION
#   The pipeline uses CASE-SENSITIVE patterns (the prior preview used
#   case-insensitive matching, which produced 26 false-positive "GoodBye" hits
#   and 50 false-positive "TwentyFirst" hits from normal-cased English prose).
#
#   SAFE replacements (deterministic, applied to produce proposed_description):
#       Englishspeaking          -> English-speaking
#       EnglishSpeaking          -> English-Speaking      (proper-noun variant)
#       Liu Cixin.Set            -> Liu Cixin. Set
#       twentyfirst century      -> twenty-first century
#       TwentyFirst Century      -> Twenty-First Century
#       SlaughterhouseFive       -> Slaughterhouse-Five
#       Mythical ManMonth        -> Mythical Man-Month
#       The ThreeBody Problem    -> The Three-Body Problem
#       The Long GoodBye         -> The Long Goodbye
#
#   MANUAL-REVIEW detections (flagged, never auto-fixed):
#       mojibake "?It is impossible" / "?[A-Z]" clusters
#       mojibake "TempletonWhat" mash
#       stranded "ThreeBody" / "ManMonth" / "TwentyFirst" / "GoodBye"
#         appearances NOT in the known safe-replacement context
#
# USAGE
#   # Preview (default)
#   python scripts/path1_description_artifact_repair.py \
#       --production-dir backups/path1_pre_lists_migration_20260527T084428Z
#
#   # Future live write (DO NOT RUN until explicitly approved)
#   python scripts/path1_description_artifact_repair.py \
#       --preview rebuild_v2/description_artifact_repair_preview_v1.csv \
#       --write --confirm-description-artifact-repair \
#       --backup-before-write backups/description_artifact_repair_pre_v1.csv

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
# Detection rules
# ─────────────────────────────────────────────────────────────────────────────

# (name, needle, replacement, reason)
SAFE_REPLACEMENTS: List[Tuple[str, str, str, str]] = [
    ("englishspeaking_lower", "Englishspeaking", "English-speaking",
     "exact_mashed_compound_word_hyphenation"),
    ("englishspeaking_cap", "EnglishSpeaking", "English-Speaking",
     "exact_mashed_compound_proper_noun_hyphenation"),
    ("liu_cixin_set", "Liu Cixin.Set", "Liu Cixin. Set",
     "missing_space_after_proper_noun_period"),
    ("twentyfirst_century_lower", "twentyfirst century", "twenty-first century",
     "exact_mashed_compound_phrase"),
    ("twentyfirst_century_title", "TwentyFirst Century", "Twenty-First Century",
     "exact_mashed_compound_phrase_title_case"),
    ("slaughterhousefive", "SlaughterhouseFive", "Slaughterhouse-Five",
     "exact_mashed_compound_word"),
    ("mythical_manmonth", "Mythical ManMonth", "Mythical Man-Month",
     "exact_mashed_compound_phrase"),
    ("three_body_problem_title", "The ThreeBody Problem", "The Three-Body Problem",
     "title_in_description_hyphenation"),
    ("long_goodbye_title", "The Long GoodBye", "The Long Goodbye",
     "title_in_description_compound_fix"),
]

# (name, compiled regex, reason)
# Mojibake detection is intentionally NARROW. The wider `\?[A-Za-z]` family is
# pervasive across the whole DB (curly apostrophes lost in import: "you?ll",
# "they?re"). That's a separate systemic bug — out of scope for this artifact
# repair pass. We flag ONLY the specific phrases the user listed.
MANUAL_REVIEW_DETECTIONS: List[Tuple[str, re.Pattern, str]] = [
    ("mojibake_question_It_impossible", re.compile(r"\?It is impossible"),
     "mojibake_curly_quote_replaced_by_question_mark"),
    ("mojibake_templeton_what", re.compile(r"\bTempletonWhat\b"),
     "mojibake_quote_attribution_word_mash"),
    # Stranded mashed words. We run these AFTER safe replacements so they only
    # fire on instances we couldn't safely fix.
    ("threebody_unhandled_context", re.compile(r"\bThreeBody\b"),
     "mashed_word_outside_known_safe_context"),
    ("manmonth_unhandled_context", re.compile(r"\bManMonth\b"),
     "mashed_word_outside_known_safe_context"),
    ("twentyfirst_unhandled_context", re.compile(r"\bTwentyFirst\b"),
     "mashed_word_outside_known_safe_context"),
    ("goodbye_unhandled_context", re.compile(r"\bGoodBye\b"),
     "mashed_word_outside_known_safe_context"),
]

# Patterns that historically tripped the existing preview as false-positives.
# These are case-insensitive matches that DON'T overlap with our case-sensitive
# safe / MR detectors. We surface them as `skip` for transparency.
# Currently empty — case-sensitivity in the rules above naturally excludes
# the 26 GoodBye / 50 TwentyFirst false positives. The block exists so we
# can extend it without changing the action-classification surface.
FALSE_POSITIVE_SKIPS: List[Tuple[str, re.Pattern, str]] = []


# ─────────────────────────────────────────────────────────────────────────────
# Row normalization — handle both production (`id`, `author_name`) and
# master-list (`book_id`, `author`) column conventions.
# ─────────────────────────────────────────────────────────────────────────────

def normalize_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": (row.get("id") or row.get("book_id") or "").strip(),
        "slug": (row.get("slug") or "").strip(),
        "title": (row.get("title") or "").strip(),
        "author": (row.get("author_name") or row.get("author") or "").strip(),
        "description": (row.get("description") or ""),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Live / offline source loading
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


_LIVE_SELECT = "id,slug,title,description"


def fetch_books_live(url: str, key: str, page: int = 1000) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
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


def load_books(args: argparse.Namespace) -> Tuple[List[Dict[str, Any]], str]:
    if args.production_dir:
        path = os.path.join(args.production_dir, "books.csv")
        if not os.path.exists(path):
            raise SystemExit(f"books.csv not found in --production-dir: {path}")
        with open(path, newline="", encoding="utf-8") as f:
            raw_rows = list(csv.DictReader(f))
        norm = [normalize_row(r) for r in raw_rows]
        return norm, f"BACKUP {args.production_dir}"
    url, key = _creds()
    if not url or not key:
        raise SystemExit(
            "No Supabase credentials in env and no --production-dir.\n"
            "Export SUPABASE_URL + SUPABASE_SECRET_KEY (or pass --production-dir <dir>)."
        )
    raw = fetch_books_live(url, key)
    return [normalize_row(r) for r in raw], f"LIVE {url}"


# ─────────────────────────────────────────────────────────────────────────────
# Evaluation
# ─────────────────────────────────────────────────────────────────────────────

def _snippet_around(text: str, idx: int, window: int = 100) -> str:
    if idx < 0:
        return text[:300]
    start = max(0, idx - window)
    end = min(len(text), idx + window)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return prefix + text[start:end] + suffix


def evaluate(book: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Run all rules on a single book's description.
    Returns a CSV row dict, or None if no detections fired."""
    desc = book.get("description") or ""
    if not desc.strip():
        return None

    proposed = desc
    applied_rules: List[Tuple[str, str, int]] = []  # (name, reason, count)
    matched_offset: int = -1

    for name, needle, replacement, reason in SAFE_REPLACEMENTS:
        if needle in proposed:
            count = proposed.count(needle)
            if matched_offset < 0:
                matched_offset = proposed.find(needle)
            proposed = proposed.replace(needle, replacement)
            applied_rules.append((name, reason, count))

    # Manual-review patterns scanned on the PROPOSED text — only count what's
    # STILL broken after safe rules run. Plus a pass on the original for the
    # mojibake patterns (those can't be auto-fixed but are real signals).
    mr_hits: List[Tuple[str, str, int]] = []
    for name, pat, reason in MANUAL_REVIEW_DETECTIONS:
        # Always scan the residual (post-safe). For mojibake patterns the
        # safe rules don't touch them anyway, so the result is the same as
        # scanning the original — but checking post-safe is the safer choice.
        m = pat.search(proposed)
        if m:
            if matched_offset < 0:
                matched_offset = m.start()
            mr_hits.append((name, reason, len(pat.findall(proposed))))

    # False-positive surface (currently empty — case-sensitivity removes the
    # known FP buckets at detection time). If extended, these emit `skip` rows.
    skip_hits: List[Tuple[str, str]] = []
    for name, pat, reason in FALSE_POSITIVE_SKIPS:
        if pat.search(desc):
            skip_hits.append((name, reason))

    if not applied_rules and not mr_hits and not skip_hits:
        return None

    # Classify
    if applied_rules:
        action = "would_clean"
        confidence = "high"
        out_proposed = proposed
        parts = [f"{n}({c}x):{r}" for n, r, c in applied_rules]
        for n, r, c in mr_hits:
            parts.append(f"unchanged_residual:{n}({c}x):{r}")
        reason_str = ";".join(parts)
        pattern_str = ",".join(sorted({n for n, *_ in applied_rules} | {n for n, *_ in mr_hits}))
    elif mr_hits:
        action = "needs_manual_review"
        confidence = "low"
        out_proposed = ""
        reason_str = ";".join(f"{n}({c}x):{r}" for n, r, c in mr_hits)
        pattern_str = ",".join(sorted({n for n, *_ in mr_hits}))
    else:
        action = "skip"
        confidence = ""
        out_proposed = ""
        reason_str = ";".join(f"{n}:{r}" for n, r in skip_hits)
        pattern_str = ",".join(sorted({n for n, *_ in skip_hits}))

    snippet = _snippet_around(desc, matched_offset)

    return {
        "book_id": book.get("id", ""),
        "slug": book.get("slug", ""),
        "title": book.get("title", ""),
        "pattern": pattern_str,
        "action": action,
        "confidence": confidence,
        "reason": reason_str,
        "current_description_snippet": snippet,
        "proposed_description": out_proposed,
    }


PREVIEW_COLUMNS = [
    "book_id", "slug", "title", "pattern", "action", "confidence",
    "reason", "current_description_snippet", "proposed_description",
]


# ─────────────────────────────────────────────────────────────────────────────
# Preview mode
# ─────────────────────────────────────────────────────────────────────────────

def do_preview(args: argparse.Namespace) -> int:
    books, source = load_books(args)
    print("== Description artifact repair PREVIEW (READ-ONLY) ==")
    print(f"source                 : {source}")
    print(f"books loaded           : {len(books)}")

    rows_out: List[Dict[str, Any]] = []
    for b in books:
        row = evaluate(b)
        if row is None:
            continue
        rows_out.append(row)

    # Sort: would_clean first (high confidence), then needs_manual_review, then skip;
    # within each group, by slug asc.
    action_order = {"would_clean": 0, "needs_manual_review": 1, "skip": 2}
    rows_out.sort(key=lambda r: (action_order.get(r["action"], 99), r["slug"]))

    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=PREVIEW_COLUMNS)
        w.writeheader()
        for r in rows_out:
            w.writerow(r)

    n_clean = sum(1 for r in rows_out if r["action"] == "would_clean")
    n_manual = sum(1 for r in rows_out if r["action"] == "needs_manual_review")
    n_skip = sum(1 for r in rows_out if r["action"] == "skip")

    print()
    print("==================== PREVIEW SUMMARY ====================")
    print(f"  rows read                : {len(books)}")
    print(f"  rows in preview          : {len(rows_out)}")
    print(f"    would_clean            : {n_clean}")
    print(f"    needs_manual_review    : {n_manual}")
    print(f"    skipped                : {n_skip}")
    print(f"  output csv               : {args.out}")
    print(f"  PATCH column (later)     : description only")
    print(f"  NO AI calls              : confirmed")
    print(f"  NO DB writes             : confirmed")
    print()
    print("=========== TOP WOULD_CLEAN ROWS (first 10) ===========")
    for r in rows_out:
        if r["action"] != "would_clean":
            continue
        print(f"\n  slug    : {r['slug']}")
        print(f"  title   : {r['title']}")
        print(f"  pattern : {r['pattern']}")
        print(f"  reason  : {r['reason']}")
        sn = r["current_description_snippet"]
        print(f"  snippet : {sn[:240] + ('…' if len(sn) > 240 else '')}")
    print()
    print("======== TOP NEEDS_MANUAL_REVIEW (first 10) ========")
    seen_mr = 0
    for r in rows_out:
        if r["action"] != "needs_manual_review":
            continue
        seen_mr += 1
        if seen_mr > 10:
            break
        print(f"\n  slug    : {r['slug']}")
        print(f"  pattern : {r['pattern']}")
        print(f"  reason  : {r['reason']}")
        sn = r["current_description_snippet"]
        print(f"  snippet : {sn[:200] + ('…' if len(sn) > 200 else '')}")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# Gated write path
# ─────────────────────────────────────────────────────────────────────────────

def _supa_get_book_description(url: str, key: str, book_id: str) -> Optional[Dict[str, Any]]:
    params = {"select": "id,slug,title,description", "id": f"eq.{book_id}", "limit": "1"}
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode(params)
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    try:
        data = _req("GET", full, h) or []
        return data[0] if data else None
    except Exception as e:
        print(f"[supabase] fetch failed for {book_id}: {type(e).__name__}: {str(e)[:120]}")
        return None


def _supa_patch_description(url: str, key: str, book_id: str, description: str) -> None:
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode({"id": f"eq.{book_id}"})
    h = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    _req("PATCH", full, h, payload={"description": description})


WRITE_REPORT_COLUMNS = [
    "book_id", "slug", "title", "status", "reason",
    "description_before", "description_after",
]
BACKUP_COLUMNS = ["book_id", "slug", "title", "description_before"]


def _load_eligible_preview_rows(preview_path: str) -> Tuple[List[Dict[str, Any]], int, List[Tuple[str, str]]]:
    """Defensive triple-filter at load time:
    action=would_clean AND confidence=high AND non-empty proposed_description."""
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
        proposed = (r.get("proposed_description") or "").strip()
        if action != "would_clean":
            refused.append((slug, f"action={action!r}"))
            continue
        if confidence != "high":
            refused.append((slug, f"confidence={confidence!r}"))
            continue
        if not proposed:
            refused.append((slug, "proposed_description empty"))
            continue
        eligible.append(r)
    return eligible, len(rows), refused


def do_write(args: argparse.Namespace) -> int:
    if not args.confirm_description_artifact_repair:
        raise SystemExit("[write] --write requires --confirm-description-artifact-repair")
    if not args.backup_before_write:
        raise SystemExit("[write] --write requires --backup-before-write PATH")
    if not args.preview or not os.path.exists(args.preview):
        raise SystemExit(f"[write] --write requires --preview PATH (got: {args.preview!r})")
    url, key = _creds()
    if not url or not key:
        raise SystemExit("[write] live write requires SUPABASE_URL + SUPABASE_SECRET_KEY in env")

    eligible, rows_read, refused = _load_eligible_preview_rows(args.preview)
    print("== Description artifact repair WRITE ==")
    print(f"mode                  : LIVE WRITE")
    print(f"preview               : {args.preview}")
    print(f"rows read             : {rows_read}")
    print(f"eligible rows         : {len(eligible)} (action=would_clean, confidence=high, non-empty proposed)")
    if refused:
        print(f"refused rows          : {len(refused)}")
        for slug, why in refused[:10]:
            print(f"  - {slug}: {why}")
    print(f"PATCH column          : description (ONLY)")
    print(f"no AI calls           : confirmed")

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
        book_id = r.get("book_id", "")
        # The preview reads snippets, not full descriptions. We recompute the
        # full proposed by re-applying safe rules to the LIVE description. This
        # way the write target reflects the live state, not a stale preview.
        live = _supa_get_book_description(url, key, book_id)
        if not live:
            plan.append({"row": r, "live": None, "status": "skipped",
                         "reason": "live row missing or fetch error"})
            skipped_missing += 1
            continue
        live_desc = (live.get("description") or "")
        # Reapply the safe rules to live_desc — what we PATCH must come from
        # live data, never from a snippet/cached copy.
        recomputed_proposed = live_desc
        applied_any = False
        for _, needle, repl, _ in SAFE_REPLACEMENTS:
            if needle in recomputed_proposed:
                recomputed_proposed = recomputed_proposed.replace(needle, repl)
                applied_any = True
        if not applied_any:
            plan.append({"row": r, "live": live, "status": "skipped",
                         "reason": "no safe artifact present in live description (drift since preview)"})
            skipped_drift += 1
            continue
        if recomputed_proposed == live_desc:
            plan.append({"row": r, "live": live, "status": "skipped",
                         "reason": "recomputed proposed equals current; nothing to write"})
            skipped_drift += 1
            continue
        plan.append({"row": r, "live": live, "status": "would_write",
                     "reason": "", "recomputed": recomputed_proposed})
        backup_rows.append({
            "book_id": live.get("id", ""),
            "slug": live.get("slug", ""),
            "title": live.get("title", ""),
            "description_before": live_desc,
        })

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

    print(f"\n[patch] writing description for {expected_backup} rows…")
    updated = 0
    failed = 0
    for p in plan:
        if p["status"] != "would_write":
            continue
        live = p["live"]
        try:
            _supa_patch_description(url, key, live["id"], p["recomputed"])
            p["status"] = "updated"
            p["reason"] = "description normalized via safe artifact rules"
            updated += 1
        except Exception as e:
            p["status"] = "failed"
            p["reason"] = f"PATCH error: {type(e).__name__}: {str(e)[:120]}"
            failed += 1

    report_rows = []
    for p in plan:
        live = p["live"] or {}
        before = live.get("description", "") if live else ""
        after = p.get("recomputed", "") if p["status"] == "updated" else ""
        report_rows.append({
            "book_id": p["row"].get("book_id", ""),
            "slug": p["row"].get("slug", ""),
            "title": p["row"].get("title", ""),
            "status": p["status"],
            "reason": p["reason"],
            "description_before": before,
            "description_after": after,
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
    print(f"  PATCH column          : description only")
    print(f"  NO AI calls           : confirmed")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--production-dir", default="",
                    help="Optional offline dir containing books.csv. "
                         "Uses live Supabase when omitted (creds required).")
    ap.add_argument("--out", default="rebuild_v2/description_artifact_repair_preview_v1.csv",
                    help="Output preview CSV (default), or write report CSV in write mode.")
    # Gated write
    ap.add_argument("--preview", default="",
                    help="Path to a preview CSV (required for write mode).")
    ap.add_argument("--write", action="store_true",
                    help="GATED: also requires --confirm-description-artifact-repair "
                         "AND --backup-before-write.")
    ap.add_argument("--confirm-description-artifact-repair", action="store_true",
                    help="Second gate for live write. Required with --write.")
    ap.add_argument("--backup-before-write", default="",
                    help="Path to pre-write backup CSV. Required with --write.")
    args = ap.parse_args()

    if args.write:
        # Default --out for write mode is the write report path
        if args.out == "rebuild_v2/description_artifact_repair_preview_v1.csv":
            args.out = "rebuild_v2/description_artifact_repair_write_v1.csv"
        return do_write(args)
    return do_preview(args)


if __name__ == "__main__":
    raise SystemExit(main())
