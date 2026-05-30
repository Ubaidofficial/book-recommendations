#!/usr/bin/env python3
# Path-1 migration: READ-ONLY backup of current production tables to CSV.
# Makes NO writes to Supabase. Only paginated SELECT reads. Output is local CSV files.
#
# Backs up: books, lists, book_lists, people, book_recommendations, series,
#           book_series, book_authors
#
# Output dir: backups/path1_pre_lists_migration_<timestamp>/<table>.csv
#
# Env (read-only): SUPABASE_URL + (SUPABASE_SECRET_KEY | SUPABASE_SERVICE_ROLE_KEY | NEXT_PUBLIC_SUPABASE_ANON_KEY)
#
# Usage:
#   python scripts/path1_backup_tables.py
#   python scripts/path1_backup_tables.py --out-dir backups/my_backup --page-size 1000

from __future__ import annotations
import argparse
import csv
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Dict, List, Optional

TABLES = ["books", "lists", "book_lists", "people", "book_recommendations",
          "series", "book_series", "book_authors"]


def creds():
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    key = (os.environ.get("SUPABASE_SECRET_KEY")
           or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or "")
    return url.rstrip("/"), key


# Preferred stable ordering keys per table when an `id` column is absent
# (junction tables typically use a composite PK on the FK pair, no `id`).
COMPOSITE_ORDER = {
    "book_lists": ["book_id", "list_id"],
    "book_series": ["book_id", "series_id"],
    "book_authors": ["book_id", "person_id"],
}


def _get(url, key, table, params):
    full = f"{url}/rest/v1/{table}?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(full, headers={"apikey": key, "Authorization": f"Bearer {key}"}, method="GET")
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body) if body else []


def discover_columns(url, key, table) -> List[str]:
    """Read one row WITHOUT ordering to learn the real columns. Empty table -> []."""
    try:
        data = _get(url, key, table, {"select": "*", "limit": "1"})
        if data:
            return list(data[0].keys())
    except Exception as e:
        print(f"    [warn] discover_columns({table}): {e}")
    return []


def choose_order(table: str, cols: List[str]) -> Optional[str]:
    """Pick a stable order key that actually exists. Avoids hardcoding `id`."""
    if "id" in cols:
        return "id.asc"
    avail = [c for c in COMPOSITE_ORDER.get(table, []) if c in cols]
    if avail:
        return ",".join(f"{c}.asc" for c in avail)
    # generic fallback: order by the first 1-2 columns that exist
    if cols:
        return ",".join(f"{c}.asc" for c in cols[:2])
    return None


def fetch_page(url, key, table, offset, limit, order_by: Optional[str]) -> List[Dict]:
    params = {"select": "*", "limit": str(limit), "offset": str(offset)}
    if order_by:
        params["order"] = order_by
    for attempt in range(1, 4):
        try:
            return _get(url, key, table, params)
        except urllib.error.HTTPError as e:
            # 400 from a bad order column -> retry this page once with NO ordering
            if e.code == 400 and order_by is not None:
                print(f"    [warn] {table}: order='{order_by}' rejected (HTTP 400); retrying page without ordering")
                params.pop("order", None)
                order_by = None
                continue
            if attempt == 3:
                raise
            print(f"    [retry {attempt}/3] {table} offset={offset}: HTTP {e.code}")
            time.sleep(2 ** attempt)
        except Exception as e:
            if attempt == 3:
                raise
            print(f"    [retry {attempt}/3] {table} offset={offset}: {e}")
            time.sleep(2 ** attempt)
    return []


def backup_table(url, key, table, out_dir, page_size) -> int:
    # 1) discover real columns (no ordering) so we never order by a missing `id`
    cols = discover_columns(url, key, table)
    order_by = choose_order(table, cols)
    print(f"    {table}: columns={cols or '(empty/unknown)'}  order_by={order_by or '(none)'}")

    rows: List[Dict] = []
    offset = 0
    while True:
        page = fetch_page(url, key, table, offset, page_size, order_by)
        if not page:
            break
        rows.extend(page)
        offset += len(page)
        print(f"    {table}: {offset} rows…")
        if len(page) < page_size:
            break
    # union of all keys for header stability
    keys: List[str] = []
    seen = set()
    for r in rows:
        for k in r.keys():
            if k not in seen:
                seen.add(k)
                keys.append(k)
    path = os.path.join(out_dir, f"{table}.csv")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r.get(k) is None else (json.dumps(r[k]) if isinstance(r[k], (list, dict)) else r[k])) for k in keys})
    print(f"  wrote {path} ({len(rows)} rows, {len(keys)} cols)")
    return len(rows)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default="")
    ap.add_argument("--page-size", type=int, default=1000)
    args = ap.parse_args()

    url, key = creds()
    if not url or not key:
        print("No Supabase credentials in environment. Cannot back up.")
        print("Set SUPABASE_URL + a key (SECRET/SERVICE_ROLE preferred) and re-run.")
        return 1

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = args.out_dir or os.path.join("backups", f"path1_pre_lists_migration_{ts}")
    os.makedirs(out_dir, exist_ok=True)
    print(f"== Path-1 READ-ONLY backup -> {out_dir} ==")
    print(f"Target: {url}")

    manifest = {"timestamp": ts, "target": url, "tables": {}}
    for t in TABLES:
        print(f"[backup] {t}")
        try:
            n = backup_table(url, key, t, out_dir, args.page_size)
            manifest["tables"][t] = n
        except Exception as e:
            print(f"  [ERROR] {t}: {e}")
            manifest["tables"][t] = f"ERROR: {e}"
    with open(os.path.join(out_dir, "MANIFEST.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print(f"\n[backup] complete. Manifest: {os.path.join(out_dir, 'MANIFEST.json')}")
    print("No writes were made to Supabase.")
    print(f"\nNext: feed this dir to the dry-run as --production-dir {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
