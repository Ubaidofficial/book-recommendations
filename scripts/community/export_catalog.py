#!/usr/bin/env python3
"""Export the books catalog and people names that match_book_mentions.py needs.

Both tables are public-read, so the anon/publishable key is enough.
Env: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and NEXT_PUBLIC_SUPABASE_ANON_KEY
(or SUPABASE_SECRET_KEY).

Writes <out>/catalog.json and <out>/people_names.json.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request


def fetch_all(base: str, key: str, table: str, select: str) -> list[dict]:
    rows, off = [], 0
    while True:
        url = f"{base}/rest/v1/{table}?select={select}&order=id&limit=1000&offset={off}"
        req = urllib.request.Request(url, headers={"apikey": key})
        page = json.load(urllib.request.urlopen(req, timeout=60))
        rows += page
        off += 1000
        if len(page) < 1000:
            return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    base = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_SECRET_KEY") or ""
    if not base or not key:
        print("set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY", file=sys.stderr)
        return 2
    os.makedirs(a.out, exist_ok=True)
    books = fetch_all(base, key, "books",
                      "id,slug,title,subtitle,author_name,recommendation_count,index_status,first_published_year")
    json.dump(books, open(os.path.join(a.out, "catalog.json"), "w"))
    people = fetch_all(base, key, "people", "id,name")
    names = sorted({p["name"] for p in people if p.get("name")})
    json.dump(names, open(os.path.join(a.out, "people_names.json"), "w"))
    print(f"{len(books)} books, {len(names)} people names -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
