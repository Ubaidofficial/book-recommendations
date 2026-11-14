#!/usr/bin/env python3
"""
2026-11-14 pilot: publish draft people who fill an empty BookAuthority-style category (see
docs/people/category-gaps-2026-11-14.md). Dry run unless --apply.

Each person gets a short factual role and bio written from the person's Wikipedia lead (own wording), the Wikipedia
page as source_url, and a portrait whose licence was read from its Wikimedia Commons file page. Then
index_status becomes 'published'.

Every change first writes a row to public.bak_seo_changes_20261114 (old and new values), so it can be undone:
  update people set <old_values> where id = row_id
"""
from __future__ import annotations

import argparse
import json
from collections import Counter

import requests

BASE = "https://ghpdpvatfmvsahzsqgpp.supabase.co/rest/v1"
H = {"apikey": "dummy", "Authorization": "Bearer dummy", "Content-Type": "application/json"}
BATCH = "people_publish_20261114"
THUMB = "https://upload.wikimedia.org/wikipedia/commons/thumb/"
COMMONS = "https://commons.wikimedia.org/wiki/File:"

PEOPLE = {
    "sam-harris": {
        "role": "Neuroscientist, philosopher and author; podcast host",
        "bio": "Sam Harris is an American neuroscientist, philosopher and author, and the host of a podcast. His writing and conversations cover rationality, religion, ethics, free will, neuroscience, meditation and politics.",
        "source_url": "https://en.wikipedia.org/wiki/Sam_Harris",
        "avatar_url": THUMB + "1/16/Sam_Harris_2016_%28cropped%29.jpg/330px-Sam_Harris_2016_%28cropped%29.jpg",
        "avatar_source_url": COMMONS + "Sam_Harris_2016_(cropped).jpg",
        "avatar_license": "CC BY-SA 4.0",
        "avatar_attribution": COMMONS + "Sam_Harris_2016_(cropped).jpg (CC BY-SA 4.0)",
        "avatar_author": "Cmichel67 (Christopher Michel)",
        "index_status": "published",
    },
    "michael-pollan": {
        "role": "American journalist and author; professor of journalism",
        "bio": "Michael Pollan is an American journalist and author who specialises in food. He is a professor of journalism and the first Lewis K. Chan Arts Lecturer at Harvard University.",
        "source_url": "https://en.wikipedia.org/wiki/Michael_Pollan",
        "avatar_url": THUMB + "9/92/Michael_Pollan_in_2025.jpg/330px-Michael_Pollan_in_2025.jpg",
        "avatar_source_url": COMMONS + "Michael_Pollan_in_2025.jpg",
        "avatar_license": "CC BY-SA 4.0",
        "avatar_attribution": COMMONS + "Michael_Pollan_in_2025.jpg (CC BY-SA 4.0)",
        "avatar_author": "Cmichel67",
        "index_status": "published",
    },
    "david-heinemeier-hansson": {
        "role": "Programmer and entrepreneur; creator of Ruby on Rails",
        "bio": "David Heinemeier Hansson, known as DHH, is a Danish programmer, writer, entrepreneur and racing driver. He created Ruby on Rails, a web framework written in Ruby.",
        "source_url": "https://en.wikipedia.org/wiki/David_Heinemeier_Hansson",
        "avatar_url": THUMB + "d/d6/David_Heinemeier_Hansson_Driver_of_Abu_Dhabi_Proton_Racing%27s_Porsche_911_RSR_%2827225732035%29_%28cropped%29.jpg/330px-David_Heinemeier_Hansson_Driver_of_Abu_Dhabi_Proton_Racing%27s_Porsche_911_RSR_%2827225732035%29_%28cropped%29.jpg",
        "avatar_source_url": COMMONS + "David_Heinemeier_Hansson_Driver_of_Abu_Dhabi_Proton_Racing%27s_Porsche_911_RSR_(27225732035)_(cropped).jpg",
        "avatar_license": "CC BY 2.0",
        "avatar_attribution": COMMONS + "David_Heinemeier_Hansson_Driver_of_Abu_Dhabi_Proton_Racing%27s_Porsche_911_RSR_(27225732035)_(cropped).jpg (CC BY 2.0)",
        "avatar_author": "David Merrett from Daventry, England",
        "index_status": "published",
    },
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    stats = Counter()
    for slug, new in PEOPLE.items():
        rows = requests.get(f"{BASE}/people", params={"select": "id,slug," + ",".join(new), "slug": f"eq.{slug}"}, headers=H, timeout=60).json()
        if not rows:
            stats["missing"] += 1
            print("  missing:", slug)
            continue
        row = rows[0]
        if row["index_status"] != "draft":
            stats["not_draft_skipped"] += 1
            print("  not a draft, skipped:", slug, row["index_status"])
            continue
        old = {k: row.get(k) for k in new}
        stats["would_change"] += 1
        if not args.apply:
            continue
        b = requests.post(f"{BASE}/bak_seo_changes_20261114", headers={**H, "Prefer": "return=minimal"}, timeout=60,
                          json={"table_name": "people", "row_id": row["id"], "slug": slug, "old_values": old, "new_values": new, "batch": BATCH})
        if b.status_code not in (200, 201):
            stats["backup_failed"] += 1
            print("  BACKUP FAILED, not changing", slug, b.status_code, b.text[:150])
            continue
        u = requests.patch(f"{BASE}/people", params={"id": f"eq.{row['id']}"}, headers={**H, "Prefer": "return=minimal"}, json=new, timeout=60)
        if u.status_code not in (200, 204):
            stats["update_failed"] += 1
            print("  UPDATE FAILED", slug, u.status_code, u.text[:150])
            continue
        stats["changed"] += 1
    print(json.dumps({"mode": "APPLY" if args.apply else "DRY RUN", **stats}))


if __name__ == "__main__":
    main()
