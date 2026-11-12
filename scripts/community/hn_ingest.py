#!/usr/bin/env python3
"""Download Hacker News "Ask HN"-style book threads (2015 onwards) and their
top-level replies, via the public Algolia HN API (https://hn.algolia.com/api).

Writes the same layout as arctic_shift_ingest.py so match_book_mentions.py
can read both:  <out>/hackernews/<YYYY-MM>.posts.jsonl.gz / .comments.jsonl.gz

Thread discovery: Algolia full-text search on story titles for a set of
book-request phrasings, restricted to created_at >= --since and at least
--min-comments comments, then filtered by a title regex so "Show HN: my
e-book reader" style posts are dropped. Usernames are not stored.

Usage: python3 scripts/community/hn_ingest.py --out DIR [--since 2015-01-01]
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import gzip
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

API = "https://hn.algolia.com/api/v1"
UA = "bookrecs-community-ingest/1.0 (research; low rate)"
QUERIES = ["books", "book", "reading list", "read", "novels", "fiction",
           "textbook", "favorite book", "book recommendations"]
TITLE_OK = re.compile(
    r"\b(books?|novels?|reading|read|textbooks?|fiction|sci-?fi|memoirs?|biograph\w+)\b", re.I)
TITLE_REQUEST = re.compile(
    r"^(ask hn|tell hn)|\b(recommend\w*|suggest\w*|what (books?|are you reading|should i read|to read)|"
    r"best|favou?rite|must[- ]read|changed|reading list|which books?|good books?)\b", re.I)
BODY_MAX = 4000


def get(path: str, params: dict | None = None, pause: float = 0.5) -> dict:
    url = f"{API}{path}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
    wait = 5
    for _ in range(6):
        time.sleep(pause)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())
        except Exception as e:
            print(f"  {type(e).__name__} on {path}: {e}; sleeping {wait}s", flush=True)
            time.sleep(wait)
            wait = min(wait * 2, 120)
    raise RuntimeError(f"gave up on {url}")


def strip_html(s: str) -> str:
    s = re.sub(r"<p>", "\n\n", s or "")
    s = re.sub(r"<i>(.*?)</i>", r"*\1*", s, flags=re.S)  # keep emphasis as a title signal
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s).strip()


def discover(since: int, min_comments: int) -> dict[str, dict]:
    stories: dict[str, dict] = {}
    # Algolia stops paginating at 1,000 hits per query, so walk one year at a time
    now = int(time.time())
    windows = []
    lo = since
    while lo < now:
        windows.append((lo, lo + 365 * 86400))
        lo += 365 * 86400
    for q in QUERIES:
      for lo, hi in windows:
        page = 0
        while True:
            d = get("/search", {"query": q, "tags": "story", "restrictSearchableAttributes": "title",
                                "numericFilters": f"created_at_i>{lo},created_at_i<={hi},"
                                                  f"num_comments>={min_comments}",
                                "hitsPerPage": 1000, "page": page})
            for h in d.get("hits", []):
                t = h.get("title") or ""
                if TITLE_OK.search(t) and TITLE_REQUEST.search(t) and not t.lower().startswith("show hn"):
                    stories[h["objectID"]] = {"id": h["objectID"], "title": t,
                                              "score": h.get("points") or 0,
                                              "num_comments": h.get("num_comments") or 0,
                                              "created_utc": h["created_at_i"]}
            page += 1
            if page >= d.get("nbPages", 0):
                break
        print(f"query {q!r}: {len(stories)} threads so far", flush=True)
    return stories


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--since", default="2015-01-01")
    ap.add_argument("--min-comments", type=int, default=20)
    a = ap.parse_args()
    since = int(dt.datetime.fromisoformat(a.since).replace(tzinfo=dt.timezone.utc).timestamp())
    d = os.path.join(a.out, "hackernews")
    os.makedirs(d, exist_ok=True)

    cache_path = os.path.join(d, "_threads.json")
    stories = discover(since, a.min_comments)
    json.dump(stories, open(cache_path, "w"))
    done_path = os.path.join(d, "_fetched.jsonl")
    fetched = {}
    if os.path.exists(done_path):
        for line in open(done_path, encoding="utf-8"):
            r = json.loads(line)
            fetched[r["thread"]] = r["comments"]

    with open(done_path, "a", encoding="utf-8") as log:
        for i, sid in enumerate(sorted(stories)):
            if sid in fetched:
                continue
            item = get(f"/items/{sid}")
            comments = []
            for c in item.get("children") or []:
                body = strip_html(c.get("text") or "")
                if not body or c.get("type") != "comment":
                    continue
                comments.append({"id": str(c["id"]), "link_id": sid,
                                 # Algolia items carry no per-comment score; use reply count as weight
                                 "score": len(c.get("children") or []),
                                 "created_utc": c.get("created_at_i") or stories[sid]["created_utc"],
                                 "body": body[:BODY_MAX]})
            fetched[sid] = comments
            log.write(json.dumps({"thread": sid, "comments": comments}, ensure_ascii=False) + "\n")
            if i % 25 == 0:
                print(f"{i}/{len(stories)} threads fetched", flush=True)

    by_month_p, by_month_c = collections.defaultdict(list), collections.defaultdict(list)
    for sid, s in stories.items():
        m = dt.datetime.fromtimestamp(s["created_utc"], dt.timezone.utc).strftime("%Y-%m")
        by_month_p[m].append(s)
        by_month_c[m].extend(fetched.get(sid, []))
    for m in by_month_p:
        for name, rows in (("posts", by_month_p[m]), ("comments", by_month_c[m])):
            with gzip.open(os.path.join(d, f"{m}.{name}.jsonl.gz"), "wt", encoding="utf-8") as f:
                for r in rows:
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"done: {len(stories)} threads, {sum(len(v) for v in fetched.values())} top-level replies")
    return 0


if __name__ == "__main__":
    sys.exit(main())
