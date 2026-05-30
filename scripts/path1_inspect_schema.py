#!/usr/bin/env python3
# Path-1 migration: READ-ONLY production schema inspection.
# Makes NO writes. Only SELECT/HEAD-count requests against Supabase REST.
# If credentials are absent, prints the documented schema from DATABASE.md and exits 0.
#
# Env (read-only): SUPABASE_URL + (SUPABASE_SECRET_KEY | SUPABASE_SERVICE_ROLE_KEY | NEXT_PUBLIC_SUPABASE_ANON_KEY)
#
# Usage:
#   python scripts/path1_inspect_schema.py

from __future__ import annotations
import json
import os
import re
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional


def creds():
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    key = (os.environ.get("SUPABASE_SECRET_KEY")
           or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or "")
    return url.rstrip("/"), key


def headers(key: str, prefer: Optional[str] = None) -> Dict[str, str]:
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    if prefer:
        h["Prefer"] = prefer
    return h


def rest(url: str, key: str, params: Dict[str, str], prefer: Optional[str] = None):
    full = f"{url}/rest/v1/" + params.pop("_table") + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(full, headers=headers(key, prefer), method="GET")
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read().decode("utf-8")
        content_range = resp.headers.get("Content-Range", "")
    data = json.loads(body) if body else []
    return data, content_range


def count_of(url, key, table) -> Optional[int]:
    try:
        _, cr = rest(url, key, {"_table": table, "select": "*", "limit": "1"}, prefer="count=exact")
        if cr and "/" in cr:
            return int(cr.split("/")[-1])
    except Exception as e:
        print(f"    [warn] count {table}: {e}")
    return None


def columns_of(url, key, table) -> List[str]:
    try:
        data, _ = rest(url, key, {"_table": table, "select": "*", "limit": "1"})
        if data:
            return list(data[0].keys())
    except Exception as e:
        print(f"    [warn] columns {table}: {e}")
    return []


def id_type(sample: Any) -> str:
    s = str(sample)
    if re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", s):
        return "uuid"
    if re.fullmatch(r"\d+", s):
        return "integer"
    return "text/other"


DOCUMENTED = """\
[no live DB access in this session — documented schema from DATABASE.md]

lists:        id(uuid), slug(text, unique), title, description, book_count(int),
              curator, index_status, created_at
book_lists:   id(uuid), book_id(uuid -> books.id), list_id(uuid -> lists.id), rank(int)
books:        id(uuid), slug(text), title, subtitle, author, author_slug, cover_url,
              description, rating, recommendation_count, series, series_slug,
              index_status, meta_title, meta_description, created_at
              (PLUS editorial AI fields: editorial_summary, best_for, not_for, key_themes,
               difficulty_level, recommendation_context, source_quality_note,
               ai_generated_at, ai_quality_status)

Join model: book_lists uses book_id + list_id (UUIDs), NOT slugs.
"""


def main() -> int:
    url, key = creds()
    print("== Path-1 READ-ONLY schema inspection ==")
    if not url or not key:
        print("No Supabase credentials in environment. Cannot inspect live DB.")
        print(DOCUMENTED)
        print("To inspect live (read-only), set SUPABASE_URL + a key and re-run.")
        return 0

    print(f"Connected target: {url}")
    for table in ["lists", "book_lists", "books"]:
        cols = columns_of(url, key, table)
        cnt = count_of(url, key, table)
        print(f"\n[{table}] count={cnt}")
        print(f"  columns: {cols}")
        # id type from a sample
        try:
            data, _ = rest(url, key, {"_table": table, "select": "*", "limit": "1"})
            if data:
                if "id" in data[0]:
                    print(f"  id type: {id_type(data[0]['id'])}")
                if table == "book_lists":
                    has_ids = "book_id" in data[0] and "list_id" in data[0]
                    print(f"  uses book_id/list_id (UUID join): {has_ids}")
                if table == "lists" and "slug" in data[0]:
                    print(f"  sample slug: {data[0]['slug']}")
        except Exception as e:
            print(f"  [warn] sample: {e}")

    # slug uniqueness on lists (paginate slugs, check dupes)
    try:
        seen, dupes, offset = set(), set(), 0
        while True:
            data, _ = rest(url, key, {"_table": "lists", "select": "slug",
                                      "order": "slug.asc", "limit": "1000", "offset": str(offset)})
            if not data:
                break
            for r in data:
                s = (r.get("slug") or "").strip()
                if s in seen:
                    dupes.add(s)
                seen.add(s)
            offset += len(data)
            if len(data) < 1000:
                break
        print(f"\n[lists slug uniqueness] distinct={len(seen)} duplicate_slugs={len(dupes)}")
        if dupes:
            print(f"  examples: {list(dupes)[:10]}")
    except Exception as e:
        print(f"  [warn] slug uniqueness check: {e}")

    print("\nInspection complete. No writes performed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
