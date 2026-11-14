#!/usr/bin/env python3
"""
Match reports/reddit_reads_books.jsonl (scripts/reddit_reads_collect.py) to our
books and emit guarded SQL for public.book_reddit_mentions. DRY RUN: reads our
tables with the public key, writes only under reports/.

MATCHING (precision over recall; an entry that is ambiguous is skipped)
  asin          card's Amazon ASIN == ASIN in our books.amazon_url or books.isbn_10
  isbn          card's ISBN-13 == our isbn_13, or == the ISBN-13 form of our ASIN/isbn_10
  title_author  exactly ONE of our books has the same normalized main title, AND
                that book's author surname appears in the card's Amazon link text
                (Goodreads links carry no text, so they never take this tier)
  Any key that maps to more than one of our books is ambiguous and skipped.
  Two entries (editions) landing on one (book, subreddit): the larger count wins.

OUTPUT   reports/reddit_reads_matches.csv       one row per (book, subreddit)
         reports/reddit_reads_unmatched.csv     entries with no safe match
         reports/reddit_reads_summary.json
         reports/reddit_write_batches/NNN.sql   --emit-sql: INSERT ... ON CONFLICT
                                                (book_id, subreddit) DO UPDATE SET users = GREATEST(...)

  python3 -I scripts/reddit_reads_match.py [--emit-sql --batch-size 1500 --min-recs 0]
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import urllib.parse
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import find_primary_sources as fps  # noqa: E402

IN = fps.REPORTS / "reddit_reads_books.jsonl"
OUT = fps.REPORTS / "reddit_reads_matches.csv"
OUT_UN = fps.REPORTS / "reddit_reads_unmatched.csv"
OUT_SUMMARY = fps.REPORTS / "reddit_reads_summary.json"
BATCH_DIR = fps.REPORTS / "reddit_write_batches"
ASIN_IN_URL = re.compile(r"/dp/([0-9A-Z]{10})")
PRIORITY = {"asin": 0, "isbn": 1, "title_author": 2}


def isbn10_to_13(s: str) -> str | None:
    if not re.fullmatch(r"\d{9}[\dX]", s or ""):
        return None
    core = "978" + s[:9]
    chk = (10 - sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(core)) % 10) % 10
    return core + str(chk)


def title_agrees(card_title: str, our_title: str) -> bool:
    """Guard for every tier: the source title and ours must be the same book's title, ignoring punctuation,
    spacing, a leading article and a subtitle. An ASIN/ISBN can point at the wrong book in our table; a title that
    disagrees means the key cannot be trusted."""
    a, b = fps.squash(fps.norm_title(card_title)), fps.squash(fps.norm_title(our_title))
    if not a or not b:
        return False
    if a == b or (min(len(a), len(b)) >= 6 and (a in b or b in a)):
        return True
    ta, tb = set(fps.tokens(fps.norm_title(card_title))), set(fps.tokens(fps.norm_title(our_title)))
    return bool(ta and tb) and len(ta & tb) / len(ta | tb) >= 0.6


def sql_lit(v) -> str:
    return "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--emit-sql", action="store_true")
    ap.add_argument("--batch-size", type=int, default=1500)
    ap.add_argument("--min-recs", type=int, default=0, help="only books with at least this many recommenders")
    args = ap.parse_args()

    cards = [json.loads(l) for l in IN.open(encoding="utf-8")]
    fps.log(f"cards: {len(cards)} rows from {len({c['sub'] for c in cards})} subreddits")
    books = fps.sb_read_all("books", "id,slug,title,author_name,amazon_url,isbn_10,isbn_13,recommendation_count")
    fps.log(f"our books: {len(books)}")

    by_asin, by_isbn13, by_title = defaultdict(set), defaultdict(set), defaultdict(set)
    meta = {}
    for b in books:
        meta[b["id"]] = b
        asins = set(ASIN_IN_URL.findall(b.get("amazon_url") or ""))
        if b.get("isbn_10"):
            asins.add(b["isbn_10"].strip().upper())
        for a in asins:
            by_asin[a].add(b["id"])
            i13 = isbn10_to_13(a)
            if i13:
                by_isbn13[i13].add(b["id"])
        if b.get("isbn_13"):
            by_isbn13[re.sub(r"\D", "", b["isbn_13"])].add(b["id"])
        by_title[fps.norm_title(b["title"])].add(b["id"])

    def link_text(href: str) -> list[str]:
        parts = [p for p in urllib.parse.urlsplit(href).path.split("/") if p]
        return fps.tokens(" ".join(parts[:1])) if parts and parts[0] not in ("dp", "gp") else []

    best = {}  # (book_id, sub) → row
    unmatched, stats = [], Counter()
    for c in cards:
        method, ids = None, set()
        if c["asin"] and len(by_asin.get(c["asin"], ())) >= 1:
            method, ids = "asin", by_asin[c["asin"]]
        elif c["isbn13"] and by_isbn13.get(c["isbn13"]):
            method, ids = "isbn", by_isbn13[c["isbn13"]]
        else:
            cand = by_title.get(fps.norm_title(c["title"]), set())
            toks = link_text(c["href"])
            if len(cand) == 1 and toks:
                b = meta[next(iter(cand))]
                sn = fps.surname(b.get("author_name"))
                if sn and sn in toks:
                    method, ids = "title_author", cand
        if method is None:
            stats["unmatched"] += 1
            unmatched.append({"sub": c["sub"], "title": c["title"], "users": c["users"], "asin": c["asin"] or "", "isbn13": c["isbn13"] or "", "why": "no_key_match"})
            continue
        if len(ids) != 1:
            stats["ambiguous"] += 1
            unmatched.append({"sub": c["sub"], "title": c["title"], "users": c["users"], "asin": c["asin"] or "", "isbn13": c["isbn13"] or "", "why": f"ambiguous_{len(ids)}"})
            continue
        bid = next(iter(ids))
        if not title_agrees(c["title"], meta[bid]["title"]):
            stats["title_disagree"] += 1
            unmatched.append({"sub": c["sub"], "title": c["title"], "users": c["users"], "asin": c["asin"] or "", "isbn13": c["isbn13"] or "", "why": f"title_disagree({method}):{meta[bid]['title'][:40]}"})
            continue
        if (meta[bid].get("recommendation_count") or 0) < args.min_recs:
            stats["below_min_recs"] += 1
            continue
        stats[f"matched_{method}"] += 1
        key = (bid, c["sub"])
        row = {"book_id": bid, "book_slug": meta[bid]["slug"], "title": meta[bid]["title"], "subreddit": c["sub"],
               "users": c["users"], "rank": c["rank"], "match_method": method}
        old = best.get(key)
        if not old or c["users"] > old["users"] or (c["users"] == old["users"] and PRIORITY[method] < PRIORITY[old["match_method"]]):
            best[key] = row

    rows = sorted(best.values(), key=lambda r: (r["book_slug"], r["subreddit"]))
    for path, data in ((OUT, rows), (OUT_UN, unmatched)):
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list((data or [{"x": 0}])[0].keys()))
            w.writeheader()
            w.writerows(data)

    summary = {"cards": len(cards), "stats": dict(stats), "mention_rows": len(rows), "books_with_mentions": len({r["book_id"] for r in rows}),
               "subreddits_with_matches": len({r["subreddit"] for r in rows}),
               "by_method": dict(Counter(r["match_method"] for r in rows)),
               "top_books": [(r["title"], r["subreddit"], r["users"]) for r in sorted(rows, key=lambda r: -r["users"])[:8]]}
    OUT_SUMMARY.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    fps.log(json.dumps(summary, indent=2))

    if args.emit_sql:
        BATCH_DIR.mkdir(parents=True, exist_ok=True)
        for old in BATCH_DIR.glob("*.sql"):
            old.unlink()
        for n, i in enumerate(range(0, len(rows), args.batch_size), 1):
            chunk = rows[i:i + args.batch_size]
            vals = ",\n".join(
                f"({sql_lit(r['book_id'])}::uuid,{sql_lit(r['subreddit'])},{int(r['users'])},{int(r['rank'])},{sql_lit(r['match_method'])})" for r in chunk)
            (BATCH_DIR / f"{n:03d}.sql").write_text(
                "INSERT INTO public.book_reddit_mentions (book_id, subreddit, users, rank, match_method)\nVALUES\n" + vals +
                "\nON CONFLICT (book_id, subreddit) DO UPDATE SET users = GREATEST(public.book_reddit_mentions.users, EXCLUDED.users),"
                " rank = EXCLUDED.rank, match_method = EXCLUDED.match_method;\n", encoding="utf-8")
        fps.log(f"wrote {len(list(BATCH_DIR.glob('*.sql')))} batch files to {BATCH_DIR}")


if __name__ == "__main__":
    main()
