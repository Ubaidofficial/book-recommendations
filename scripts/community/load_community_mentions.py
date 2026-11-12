#!/usr/bin/env python3
"""Upsert book_aggregates.jsonl (from match_book_mentions.py) into
public.book_community_mentions via Supabase REST.

Dry run by default. --write to upsert. --replace additionally deletes rows of
the loaded sources that this run did not produce (books that no longer match).

Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SECRET_KEY.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import os
import sys
import urllib.parse
import urllib.request

TABLE = "book_community_mentions"
COLS = ("book_id", "source", "thread_count", "comment_count", "upvotes", "first_year",
        "last_year", "by_year", "communities", "top_comments", "top_threads", "source_rank")


def req(method: str, url: str, key: str, body=None, prefer: str | None = None):
    headers = {"apikey": key, "Content-Type": "application/json"}
    if not key.startswith("sb_") and key not in ("proxy-injected",):
        headers["Authorization"] = f"Bearer {key}"  # legacy service_role JWT
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(r, timeout=120) as resp:
        return resp.status, resp.read()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aggregates", required=True)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--replace", action="store_true")
    ap.add_argument("--min-threads", type=int, default=2,
                    help="skip books recommended in fewer threads than this (default 2)")
    ap.add_argument("--batch", type=int, default=200)
    a = ap.parse_args()

    base = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not base or not key:
        print("SUPABASE_URL and SUPABASE_SECRET_KEY are required", file=sys.stderr)
        return 2

    rows = []
    for line in open(a.aggregates, encoding="utf-8"):
        r = json.loads(line)
        if r["thread_count"] < a.min_threads:
            continue
        rows.append({c: r.get(c) for c in COLS})
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    for r in rows:
        r["computed_at"] = now
    by_source = collections.Counter(r["source"] for r in rows)
    print(f"{len(rows)} rows to upsert: {dict(by_source)}")
    if not a.write:
        print("dry run — pass --write to upsert")
        return 0

    url = f"{base}/rest/v1/{TABLE}?on_conflict=book_id,source"
    skipped = 0
    for i in range(0, len(rows), a.batch):
        batch = rows[i:i + a.batch]
        # books can be merged/deleted between the catalog export and this load
        ids = ",".join(sorted({r["book_id"] for r in batch}))
        _, body = req("GET", f"{base}/rest/v1/books?select=id&id=in.({ids})", key)
        live = {r["id"] for r in json.loads(body)}
        keep = [r for r in batch if r["book_id"] in live]
        skipped += len(batch) - len(keep)
        if keep:
            status, _ = req("POST", url, key, keep, prefer="resolution=merge-duplicates,return=minimal")
            print(f"  upserted {min(i + a.batch, len(rows))}/{len(rows)} (http {status})", flush=True)
    if skipped:
        print(f"  skipped {skipped} rows whose book no longer exists")

    if a.replace:
        for source in by_source:
            q = urllib.parse.urlencode({"source": f"eq.{source}", "computed_at": f"lt.{now}"})
            status, _ = req("DELETE", f"{base}/rest/v1/{TABLE}?{q}", key, prefer="return=minimal")
            print(f"  removed stale {source} rows (http {status})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
