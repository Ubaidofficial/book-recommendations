#!/usr/bin/env python3
"""
Second matching pass for Reddit Reads entries that scripts/reddit_reads_match.py could not tie to a book
(reports/reddit_reads_unmatched.csv, why = no_key_match: the card's ISBN/ASIN is a different edition from the one we
hold, e.g. How to Win Friends and Influence People, 1,879 users in total, was unmatched).

METHOD (precision over recall). For each unmatched entry whose normalized main title exists in our catalogue:
  1. look the card's ISBN-13 (else ASIN, when it is an ISBN-10) up in Open Library (batched, cached);
  2. require Open Library's title to normalize to the same key as ours AND one of its authors to match the book's
     author (catalog_match.author_matches on a real author; no author on either side = no match);
  3. require exactly ONE of our books to pass; otherwise skip (duplicates or ambiguity).
Rows are written to public.book_reddit_mentions with match_method = 'title_author' (the table's check allows
asin | isbn | title_author). An existing (book, subreddit) row is never overwritten; the larger count of two editions wins
only within this pass.

DRY RUN unless --apply. Output: reports/reddit_reads_ol_matches.csv (what would be / was written),
reports/reddit_reads_ol_skipped.csv (why not). Undo an applied run: delete from book_reddit_mentions where
created_at >= '<run start printed by --apply>' and match_method = 'title_author' and (book_id, subreddit) in the CSV.

  python3 -I scripts/reddit_reads_match_ol.py [--limit-isbns N] [--apply]
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import find_primary_sources as fps  # noqa: E402
import catalog_match as cm  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
UNMATCHED = ROOT / "reports" / "reddit_reads_unmatched.csv"
CACHE = ROOT / "reports" / "third_party_cache" / "openlibrary_isbn.json"
OUT = ROOT / "reports" / "reddit_reads_ol_matches.csv"
SKIP = ROOT / "reports" / "reddit_reads_ol_skipped.csv"
BASE = fps.SUPABASE_URL + "/rest/v1"
H = {"apikey": "dummy", "Authorization": "Bearer dummy", "Content-Type": "application/json"}
UA = "BookMentionsResearch/1.0 (own-site enrichment)"
BATCH = 40


def isbn10_to_13(isbn10: str) -> str | None:
    s = "".join(c for c in isbn10 if c.isalnum()).upper()
    if len(s) != 10:
        return None
    core = "978" + s[:9]
    if not core.isdigit():
        return None
    check = (10 - sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(core)) % 10) % 10
    return core + str(check)


def lookup(isbns: list[str]) -> dict[str, dict | None]:
    """ISBN-13 -> {title, authors} from Open Library, cached on disk (None = Open Library has no record)."""
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    cache: dict[str, dict | None] = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    todo = [i for i in isbns if i not in cache]
    s = requests.Session()
    s.headers["User-Agent"] = UA
    for i in range(0, len(todo), BATCH):
        chunk = todo[i : i + BATCH]
        for attempt in range(4):
            r = s.get("https://openlibrary.org/api/books", params={"bibkeys": ",".join("ISBN:" + x for x in chunk), "format": "json", "jscmd": "data"}, timeout=60)
            if r.status_code == 429:
                time.sleep(10 * (attempt + 1))
                continue
            r.raise_for_status()
            break
        else:
            print("  rate limited, stopping lookups; re-run to continue (cache kept)")
            break
        data = r.json()
        for x in chunk:
            v = data.get("ISBN:" + x)
            cache[x] = {"title": v.get("title", ""), "authors": [a.get("name", "") for a in v.get("authors", [])]} if v else None
        CACHE.write_text(json.dumps(cache))
        print(f"  looked up {min(i + BATCH, len(todo))}/{len(todo)}", flush=True)
        time.sleep(1.2)
    return {i: cache.get(i) for i in isbns}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit-isbns", type=int, default=0, help="only the N ISBNs with the most users (0 = all)")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    books = fps.sb_read_all("books", "id,slug,title,author_name")
    by_title: dict[str, list[dict]] = defaultdict(list)
    for b in books:
        by_title[cm.title_key(b["title"])].append(b)

    existing = set()
    off = 0
    while True:
        r = requests.get(BASE + "/book_reddit_mentions", params={"select": "book_id,subreddit", "order": "book_id,subreddit", "offset": off, "limit": 1000}, headers=H, timeout=60)
        r.raise_for_status()
        c = r.json()
        existing |= {(x["book_id"], x["subreddit"]) for x in c}
        if len(c) < 1000:
            break
        off += 1000
    print(f"existing mention rows: {len(existing)}")

    entries = list(csv.DictReader(open(UNMATCHED, encoding="utf-8")))
    per_isbn: dict[str, dict] = {}
    for e in entries:
        isbn = (e["isbn13"] or "").strip() or (isbn10_to_13(e["asin"]) if e["asin"] else None)
        if not isbn or cm.title_key(e["title"]) not in by_title:
            continue
        d = per_isbn.setdefault(isbn, {"title": e["title"], "rows": [], "max": 0})
        d["rows"].append((e["sub"], int(e["users"] or 0)))
        d["max"] = max(d["max"], int(e["users"] or 0))
    order = sorted(per_isbn, key=lambda i: -per_isbn[i]["max"])
    if args.limit_isbns:
        order = order[: args.limit_isbns]
    print(f"unmatched ISBNs whose title is in our catalogue: {len(per_isbn)}; looking up {len(order)}")
    ol = lookup(order)

    matched: dict[tuple[str, str], dict] = {}
    skipped = []
    for isbn in order:
        d = per_isbn[isbn]
        rec = ol.get(isbn)
        if not rec:
            skipped.append((isbn, d["title"], "no_open_library_record"))
            continue
        if cm.title_key(rec["title"]) != cm.title_key(d["title"]):
            skipped.append((isbn, d["title"], f"ol_title_differs:{rec['title'][:40]}"))
            continue
        # catalog_match.author_matches treats "no comparable surname" as a match, which would let a name in
        # another script (五味太郎) match any book. Only authors with a Latin surname count here.
        authors = [a for a in rec["authors"] if a and fps.surname(a) is not None]
        if not authors:
            skipped.append((isbn, d["title"], "ol_no_comparable_author"))
            continue
        ok = [b for b in by_title[cm.title_key(d["title"])] if b["author_name"] and any(cm.author_matches(a, b["author_name"]) for a in authors)]
        if len(ok) != 1:
            skipped.append((isbn, d["title"], f"candidates={len(ok)}"))
            continue
        book = ok[0]
        for sub, users in d["rows"]:
            key = (book["id"], sub)
            if key in existing:
                continue
            cur = matched.get(key)
            if cur is None or users > cur["users"]:
                matched[key] = {"book_id": book["id"], "slug": book["slug"], "title": book["title"], "subreddit": sub, "users": users, "isbn13": isbn, "ol_authors": "; ".join(authors)[:80]}

    rows = sorted(matched.values(), key=lambda r: (-r["users"], r["slug"]))
    OUT.parent.mkdir(exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else ["book_id"])
        w.writeheader()
        w.writerows(rows)
    with SKIP.open("w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows([("isbn13", "title", "why"), *skipped])
    print(f"new (book, subreddit) rows: {len(rows)} for {len({r['book_id'] for r in rows})} books; skipped ISBNs: {len(skipped)}")

    if not args.apply:
        print("DRY RUN: nothing written")
        return
    start = datetime.now(timezone.utc).isoformat()
    print("apply run start:", start)
    ok = 0
    for i in range(0, len(rows), 500):
        chunk = [{"book_id": r["book_id"], "subreddit": r["subreddit"], "users": r["users"], "match_method": "title_author"} for r in rows[i : i + 500]]
        r = requests.post(BASE + "/book_reddit_mentions", params={"on_conflict": "book_id,subreddit"}, headers={**H, "Prefer": "resolution=ignore-duplicates,return=minimal"}, json=chunk, timeout=120)
        if r.status_code not in (200, 201, 204):
            print("  WRITE FAILED", r.status_code, r.text[:200])
            break
        ok += len(chunk)
    print(f"written: {ok}")


if __name__ == "__main__":
    main()
