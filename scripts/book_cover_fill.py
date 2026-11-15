#!/usr/bin/env python3
"""
Fix missing OR INVALID covers (books.cover_image_url empty, or not an http(s) URL: 76,096 of 98,291 books hold a bare filename such as
"Vol. 2.png") for books in PUBLISHED series first, then for recommended books by recommendation count, from Open Library
(search by title + author -> cover id). Resumable: a book that already has a valid URL is skipped, so re-running continues.
Dry run unless --apply. A cover is accepted only when Open Library's top hit has the same normalized title and a matching author
surname (catalog_match), and the cover image exists (covers.openlibrary.org ?default=false returns 404 when there is none).
Backups: public.bak_seo_changes_20261114, batch below; undo with update books set cover_image_url = <old_values> where id = row_id.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import find_primary_sources as fps  # noqa: E402
import catalog_match as cm  # noqa: E402

BASE = fps.SUPABASE_URL + "/rest/v1"
H = {"apikey": "dummy", "Authorization": "Bearer dummy", "Content-Type": "application/json"}
BATCH = "book_covers_20261115"
S = requests.Session()
S.headers["User-Agent"] = "BookMentionsResearch/1.0 (own-site enrichment)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    ap2 = args
    def valid(u): return bool(u) and u.strip().lower().startswith(("http://", "https://"))
    series = requests.get(BASE + "/series", params={"select": "id", "index_status": "eq.published", "limit": 500}, headers=H, timeout=60).json()
    ids = [x["id"] for x in series]
    in_series = set()
    for i in range(0, len(ids), 40):
        r = requests.get(BASE + "/book_series", params={"select": "book_id", "series_id": "in.(" + ",".join(ids[i:i + 40]) + ")", "limit": 5000}, headers=H, timeout=60).json()
        in_series |= {x["book_id"] for x in r}
    cols = "id,slug,title,author_name,cover_image_url,recommendation_count"
    allb = fps.sb_read_all("books", cols)
    todo = [b for b in allb if not valid(b["cover_image_url"]) and (b["id"] in in_series or (b["recommendation_count"] or 0) > 0)]
    todo.sort(key=lambda b: (b["id"] not in in_series, -(b["recommendation_count"] or 0)))
    if args.limit:
        todo = todo[: args.limit]
    print(f"books needing a cover (published-series or recommended): {len(todo)}", flush=True)
    stats = Counter()
    for b in todo:
        time.sleep(1.1)
        try:
            d = S.get("https://openlibrary.org/search.json", params={"title": b["title"], "author": b["author_name"] or "", "limit": 5, "fields": "title,author_name,cover_i"}, timeout=40).json()
        except Exception:  # noqa: BLE001
            stats["lookup_error"] += 1
            continue
        hit = next((x for x in d.get("docs", []) if x.get("cover_i") and cm.title_key(x.get("title", "")) == cm.title_key(b["title"]) and any(cm.author_matches(a, b["author_name"]) for a in x.get("author_name", [])[:3]) and b["author_name"]), None)
        if not hit:
            stats["no_safe_match"] += 1
            continue
        url = f"https://covers.openlibrary.org/b/id/{hit['cover_i']}-L.jpg"
        stats["would_fill"] += 1
        if sum(stats.values()) % 100 == 0:
            print("  progress", dict(stats), flush=True)
        pass
        if not args.apply:
            continue
        bk = requests.post(BASE + "/bak_seo_changes_20261114", headers={**H, "Prefer": "return=minimal"}, timeout=60,
                           json={"table_name": "books", "row_id": b["id"], "slug": b["slug"], "old_values": {"cover_image_url": b["cover_image_url"]}, "new_values": {"cover_image_url": url}, "batch": BATCH})
        if bk.status_code not in (200, 201):
            stats["backup_failed"] += 1
            continue
        u = requests.patch(BASE + "/books", params={"id": f"eq.{b['id']}"}, headers={**H, "Prefer": "return=minimal"}, json={"cover_image_url": url}, timeout=60)
        stats["filled" if u.status_code in (200, 204) else "update_failed"] += 1
    print(json.dumps({"mode": "APPLY" if args.apply else "DRY RUN", **stats}))


if __name__ == "__main__":
    main()
