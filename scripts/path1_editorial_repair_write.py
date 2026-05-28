#!/usr/bin/env python3
# Repair the 5 production rows whose `best_for` / `not_for` were stored
# character-by-character (text[] column + string write). Reconstructs the original
# items from the preview CSV and updates ONLY those two columns.
#
# SAFETY MODEL
#   - Dry-run by DEFAULT. Live write requires BOTH --write AND --confirm-editorial-repair.
#   - Touches ONLY `best_for` and `not_for`. Nothing else (no AI fields, no SEO, no
#     index_status, no slug, no editorial_summary, no key_themes).
#   - Validates each preview row has EXACTLY 3 reconstructed items before applying.
#   - Verifies the production row currently looks corrupted (defensive — won't
#     overwrite a row that already has clean data).
#   - Writes a timestamped backup of the affected rows BEFORE any update.
#   - Emits a before/after audit CSV.
#
# Usage:
#   # DRY-RUN (default)
#   python scripts/path1_editorial_repair_write.py \
#       --preview rebuild_v2/editorial_repair_preview.csv
#
#   # LIVE WRITE (requires creds + both gates)
#   python scripts/path1_editorial_repair_write.py \
#       --preview rebuild_v2/editorial_repair_preview.csv \
#       --write --confirm-editorial-repair
#
#   # POST-WRITE AUDIT (read-only)
#   python scripts/path1_editorial_repair_write.py --audit \
#       --preview rebuild_v2/editorial_repair_preview.csv

from __future__ import annotations
import argparse
import csv
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

csv.field_size_limit(10**9)

ALLOWED_FIELDS = {"best_for", "not_for"}
EXPECTED_ITEM_COUNT = 3   # all 5 corrupted rows have exactly 3 reconstructed items


# ─────────────────────────── helpers ───────────────────────────

def creds() -> Tuple[str, str]:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    key = (os.environ.get("SUPABASE_SECRET_KEY")
           or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or "")
    return url.rstrip("/"), key


def _req(method: str, url: str, key: str, payload: Optional[dict] = None, prefer: Optional[str] = None) -> Tuple[Any, str]:
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
            cr = resp.headers.get("Content-Range", "")
        return (json.loads(body) if body else None), cr
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode("utf-8")
        except Exception:
            err_body = ""
        print(f"  [HTTP {e.code}] {method} {url}")
        print(f"    payload: {json.dumps(payload)[:300] if payload else '<none>'}")
        print(f"    response: {err_body[:400]}")
        raise


def get_book(url: str, key: str, book_id: str) -> Optional[Dict[str, Any]]:
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode({
        "select": "id,slug,title,best_for,not_for,ai_quality_status",
        "id": f"eq.{book_id}",
        "limit": "1",
    })
    data, _ = _req("GET", full, key)
    return data[0] if data else None


def is_char_corrupted(v: Any) -> bool:
    """Mirrors the preview-script detection: many items, mostly length ≤ 1."""
    if v is None:
        return False
    if isinstance(v, list):
        if len(v) < 10:
            return False
        short = sum(1 for x in v if isinstance(x, str) and len(x) <= 1)
        return short / len(v) > 0.5
    if not isinstance(v, str):
        return False
    parts = [p.strip() for p in v.split("|")]
    if len(parts) < 10:
        return False
    short = sum(1 for p in parts if len(p) <= 1)
    return short / len(parts) > 0.5


def split_preview_items(joined: str) -> List[str]:
    """Preview CSV joins reconstructed items with ' ||| '. Split & strip."""
    if not joined:
        return []
    return [s.strip() for s in joined.split("|||") if s.strip()]


# ─────────────────────────── main pipeline ───────────────────────────

def load_preview(path: str) -> Dict[str, Dict[str, List[str]]]:
    """Return {book_id: {'slug':…, 'title':…, 'status':…, 'best_for':[...], 'not_for':[...]}}."""
    if not os.path.exists(path):
        raise SystemExit(f"preview CSV not found: {path}")
    by_book: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"slug": "", "title": "", "status": ""})
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            bid = r.get("book_id") or ""
            if not bid:
                continue
            slot = by_book[bid]
            slot["slug"] = r.get("slug") or slot["slug"]
            slot["title"] = r.get("title") or slot["title"]
            slot["status"] = r.get("ai_quality_status") or slot["status"]
            field = (r.get("field") or "").strip()
            if field not in ALLOWED_FIELDS:
                continue
            slot[field] = split_preview_items(r.get("reconstructed_items_joined_by_|||") or "")
    return by_book


def validate_plan(plan: Dict[str, Dict[str, Any]]) -> List[str]:
    """Return a list of human-readable errors (empty = ok)."""
    errs: List[str] = []
    for bid, slot in plan.items():
        bf = slot.get("best_for", [])
        nf = slot.get("not_for", [])
        if not bf and not nf:
            errs.append(f"{bid}: no best_for / not_for in preview")
            continue
        for field, items in (("best_for", bf), ("not_for", nf)):
            if not isinstance(items, list):
                errs.append(f"{bid}/{field}: not a list")
                continue
            if len(items) != EXPECTED_ITEM_COUNT:
                errs.append(f"{bid}/{field}: expected {EXPECTED_ITEM_COUNT} items, got {len(items)}")
            if any((not isinstance(x, str)) or len(x) < 8 for x in items):
                errs.append(f"{bid}/{field}: contains too-short / non-string items")
    return errs


def backup_rows(url: str, key: str, book_ids: List[str], out_path: str) -> None:
    if not book_ids:
        return
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode({
        "select": "id,slug,title,best_for,not_for,key_themes,editorial_summary,recommendation_context,source_quality_note,ai_quality_status,ai_generated_at",
        "id": f"in.({','.join(book_ids)})",
    })
    data, _ = _req("GET", full, key)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    cols = ["id", "slug", "title", "best_for", "not_for", "key_themes",
            "editorial_summary", "recommendation_context", "source_quality_note",
            "ai_quality_status", "ai_generated_at"]
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in (data or []):
            row = []
            for c in cols:
                v = r.get(c)
                row.append(json.dumps(v) if isinstance(v, (list, dict)) else (v if v is not None else ""))
            w.writerow(row)
    print(f"  [backup] wrote {len(data or [])} pre-repair rows -> {out_path}")


def write_audit(path: str, audit_rows: List[Dict[str, Any]]) -> None:
    cols = ["book_id", "slug", "title", "field",
            "before_corrupted", "before_item_count_pipe_split",
            "after_item_count", "after_items_joined_by_|||",
            "action", "reason"]
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in audit_rows:
            w.writerow({k: r.get(k, "") for k in cols})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", required=True, help="rebuild_v2/editorial_repair_preview.csv (from path1_editorial_repair_preview.py)")
    ap.add_argument("--write", action="store_true", help="Apply the update (requires --confirm-editorial-repair)")
    ap.add_argument("--confirm-editorial-repair", action="store_true", help="Second required gate")
    ap.add_argument("--audit", action="store_true", help="Read-only: compare current production rows to the preview plan and emit audit only")
    ap.add_argument("--backup-dir", default="", help="Directory for the pre-write backup CSV (auto-generated if blank)")
    ap.add_argument("--audit-out", default="", help="Path for the before/after audit CSV (auto-generated if blank)")
    args = ap.parse_args()

    plan = load_preview(args.preview)
    print(f"== Editorial repair {'AUDIT' if args.audit else ('DRY-RUN' if not (args.write and args.confirm_editorial_repair) else 'LIVE WRITE')} ==")
    print(f"preview rows: {len(plan)} books, each with up to 2 fields")

    errs = validate_plan(plan)
    if errs:
        print("Preview validation FAILED:")
        for e in errs:
            print(f"  - {e}")
        if args.write:
            raise SystemExit("Refusing to write with preview validation errors.")
        else:
            print("  (dry-run continues for inspection)")
    else:
        print("Preview validation: OK (every targeted field has exactly 3 readable items)")

    is_live = args.write and args.confirm_editorial_repair
    if args.audit or args.write:
        url, key = creds()
        if not url or not key:
            raise SystemExit("Live audit / write requires SUPABASE_URL + a key (read-only for audit, write for the repair).")
    else:
        url, key = "", ""

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    audit_path = args.audit_out or f"rebuild_v2/editorial_repair_audit_{ts}.csv"

    audit_rows: List[Dict[str, Any]] = []
    book_ids = list(plan.keys())

    # ── Backup BEFORE any write ──
    if is_live:
        backup_path = args.backup_dir or f"backups/editorial_repair_pre_{ts}.csv"
        if args.backup_dir and os.path.isdir(args.backup_dir):
            backup_path = os.path.join(args.backup_dir, f"editorial_repair_pre_{ts}.csv")
        backup_rows(url, key, book_ids, backup_path)

    # ── Per-row inspection + write ──
    for bid, slot in plan.items():
        slug = slot.get("slug", "")
        title = slot.get("title", "")
        live_row = get_book(url, key, bid) if url and key else None
        for field in ("best_for", "not_for"):
            new_items: List[str] = slot.get(field, []) or []
            cur_val = live_row.get(field) if live_row else None
            cur_corrupt = is_char_corrupted(cur_val)
            pipe_count = len((cur_val or "").split("|")) if isinstance(cur_val, str) else (len(cur_val) if isinstance(cur_val, list) else 0)
            row_audit: Dict[str, Any] = {
                "book_id": bid, "slug": slug, "title": title, "field": field,
                "before_corrupted": cur_corrupt,
                "before_item_count_pipe_split": pipe_count,
                "after_item_count": len(new_items),
                "after_items_joined_by_|||": " ||| ".join(new_items),
                "action": "noop",
                "reason": "",
            }

            if not new_items:
                row_audit["action"] = "skip"
                row_audit["reason"] = "no reconstructed items in preview"
                audit_rows.append(row_audit)
                continue
            if len(new_items) != EXPECTED_ITEM_COUNT:
                row_audit["action"] = "skip"
                row_audit["reason"] = f"expected {EXPECTED_ITEM_COUNT} items, got {len(new_items)}"
                audit_rows.append(row_audit)
                continue
            if live_row is not None and not cur_corrupt:
                row_audit["action"] = "skip"
                row_audit["reason"] = "production row not currently corrupted — refusing to overwrite"
                audit_rows.append(row_audit)
                continue

            if is_live:
                # Targeted PATCH — touches ONLY this one column.
                patch_url = f"{url}/rest/v1/books?id=eq.{bid}"
                _req("PATCH", patch_url, key, payload={field: new_items}, prefer="return=minimal")
                row_audit["action"] = "updated"
                row_audit["reason"] = "wrote text[] array of reconstructed items"
            else:
                row_audit["action"] = "would_update"
                row_audit["reason"] = "dry-run preview only"
            audit_rows.append(row_audit)

    write_audit(audit_path, audit_rows)

    # ── Summary ──
    counts: Dict[str, int] = defaultdict(int)
    for r in audit_rows:
        counts[r["action"]] += 1
    print(f"\n== summary ==")
    for k, v in sorted(counts.items()):
        print(f"  {k:14s}: {v}")
    print(f"  audit CSV    : {audit_path}")
    if is_live:
        print("\nLIVE WRITE COMPLETE. Re-run with --audit to verify.")
    elif args.audit:
        print("\nAUDIT COMPLETE. No DB writes.")
    else:
        print("\nDRY-RUN COMPLETE. No DB writes. Re-run with --write --confirm-editorial-repair to apply.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
