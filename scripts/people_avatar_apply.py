#!/usr/bin/env python3
"""
Apply REVIEWED portraits from reports/people_avatar_candidates.csv (scripts/people_avatar_candidates.py). Dry run unless --apply.

Review (2026-11-15, by hand against each row's Wikipedia description): rows whose Wikipedia page is a different person with the
same name, or whose match I could not stand behind, are excluded below; so are alias/duplicate people rows (a bare surname, a
second spelling of the same person), which need merging rather than a second portrait. Only people with no avatar_url are touched.

Writes avatar_url (330px Commons thumbnail), avatar_source_url (Commons file page), avatar_license, avatar_attribution, avatar_author.
Each change is first copied to public.bak_seo_changes_20261114 (batch below); undo with
  update people set avatar_url = null, avatar_source_url = null, avatar_license = null, avatar_attribution = null, avatar_author = null
  where id = <row_id from the backup rows of the batch>.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://ghpdpvatfmvsahzsqgpp.supabase.co/rest/v1"
H = {"apikey": "dummy", "Authorization": "Bearer dummy", "Content-Type": "application/json"}
BATCH = "people_avatars_20261115"

EXCLUDE = {
    # wrong person with the same name, or Wikipedia page is something else
    "Sahil Lavingia", "Andrew Wilkinson", "Tim Urban", "Ryan Shea", "Chris Messina", "Steve Burns",
    # could not confirm it is the person we track (a plausible but unverified match)
    "Dave Elitch", "Alexander Stubb", "Bianca Belair", "Aaron Rodgers", "Maria Sharapova", "Tianna Bartoletta", "Eric Alper",
    "Devon Sawa", "Ana Fabrega",
    # alias / duplicate rows: need merging, not a second portrait
    "deGrasse Tyson", "Ngozi Adichie", "Alexandria OcasioCortez", "Tobi Lütke",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    rows = [r for r in csv.DictReader(open(ROOT / "reports" / "people_avatar_candidates.csv", encoding="utf-8")) if r["name"] not in EXCLUDE]
    stats = Counter()
    for r in rows:
        cur = requests.get(f"{BASE}/people", params={"select": "id,slug,avatar_url,avatar_source_url,avatar_license,avatar_attribution,avatar_author", "slug": f"eq.{r['slug']}"}, headers=H, timeout=60).json()
        if not cur:
            stats["missing"] += 1
            continue
        row = cur[0]
        if (row.get("avatar_url") or "").strip():
            stats["already_has_avatar"] += 1
            continue
        new = {
            "avatar_url": r["thumb_url"],
            "avatar_source_url": r["commons_url"],
            "avatar_license": r["license"],
            "avatar_attribution": f"{r['commons_url']} ({r['license']})",
            "avatar_author": (r["author"] or "")[:120] or None,
        }
        stats["would_change"] += 1
        if not args.apply:
            continue
        old = {k: row.get(k) for k in new}
        b = requests.post(f"{BASE}/bak_seo_changes_20261114", headers={**H, "Prefer": "return=minimal"}, timeout=60,
                          json={"table_name": "people", "row_id": row["id"], "slug": r["slug"], "old_values": old, "new_values": new, "batch": BATCH})
        if b.status_code not in (200, 201):
            stats["backup_failed"] += 1
            continue
        u = requests.patch(f"{BASE}/people", params={"id": f"eq.{row['id']}"}, headers={**H, "Prefer": "return=minimal"}, json=new, timeout=60)
        stats["changed" if u.status_code in (200, 204) else "update_failed"] += 1
    print(json.dumps({"mode": "APPLY" if args.apply else "DRY RUN", "excluded": len(EXCLUDE), **stats}))


if __name__ == "__main__":
    main()
