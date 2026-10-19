#!/usr/bin/env python3
"""
Propose `book_series.position` values from a parsed Wikipedia bibliography.

READ-ONLY. Fetches a series' books with the public anon key, matches them to
the entries produced by wikipedia_bibliography.py, and writes a CSV of
proposed positions for review. It never writes to the database; applying a
reviewed CSV is a separate, explicit step.

Order = first-publication year, then the order Wikipedia lists the entries in
(stable within a year). Only books matched to a Wikipedia entry get a
position; unmatched books stay NULL rather than being guessed at.

Usage:
    python3 scripts/data/build_series_order.py \
        --series-slug enid-blyton-books-in-order \
        --wiki scratch/Enid_Blyton_wiki.json \
        --out scratch/enid_blyton_order.csv
"""
import argparse
import csv
import difflib
import json
import re
import unicodedata
import urllib.parse
import urllib.request

SUPABASE_URL = "https://ghpdpvatfmvsahzsqgpp.supabase.co"
# Public publishable key — the same one committed in src/app/sitemap.ts.
ANON_KEY = "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z"
FUZZY_MIN = 0.93


def rest(path: str):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}", headers={"apikey": ANON_KEY, "Accept": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def norm(title: str) -> str:
    s = unicodedata.normalize("NFKD", title or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"^(the|a|an)\s+", "", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def norm_loose(title: str) -> str:
    """Drop a trailing subtitle / parenthetical, e.g. 'X: A Novel' or 'X (Book 2)'."""
    s = re.split(r"[:(\[]", title or "", maxsplit=1)[0]
    return norm(s)


def fetch_books(series_slug: str):
    series = rest(f"series?select=id,slug&slug=eq.{urllib.parse.quote(series_slug)}")
    if not series:
        raise SystemExit(f"No series with slug {series_slug}")
    sid = series[0]["id"]
    rows, offset = [], 0
    while True:
        chunk = rest(
            f"book_series?select=book_id,books(id,title,slug,author_name)&series_id=eq.{sid}"
            f"&order=book_id&limit=1000&offset={offset}"
        )
        rows += chunk
        if len(chunk) < 1000:
            break
        offset += 1000
    books = [r["books"] for r in rows if r.get("books")]
    return sid, books


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--series-slug", required=True)
    ap.add_argument("--wiki", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--allow-fuzzy", action="store_true", help="also accept >=0.93 similar titles (review by hand)")
    a = ap.parse_args()

    wiki = json.load(open(a.wiki))
    by_norm, by_loose = {}, {}
    for e in wiki:
        for t in (e["title"], e.get("alt_title") or ""):
            if not t:
                continue
            by_norm.setdefault(norm(t), e)
            by_loose.setdefault(norm_loose(t), e)
    wiki_keys = list(by_norm)

    sid, books = fetch_books(a.series_slug)
    matched, unmatched = [], []
    for b in books:
        e, how, score = by_norm.get(norm(b["title"])), "exact", 1.0
        if not e:
            e, how = by_loose.get(norm_loose(b["title"])), "subtitle"
        if not e and a.allow_fuzzy:
            # Off by default: near-identical titles are often different books
            # ("Brave Little Noddy" vs "Be Brave, Little Noddy!", "The Keys of
            # Love" vs "The Key of Love"), and a wrong position is worse than none.
            close = difflib.get_close_matches(norm(b["title"]), wiki_keys, n=1, cutoff=FUZZY_MIN)
            if close:
                e, how = by_norm[close[0]], "fuzzy"
                score = difflib.SequenceMatcher(None, norm(b["title"]), close[0]).ratio()
        if e:
            matched.append((b, e, how, score))
        else:
            unmatched.append(b)

    matched.sort(key=lambda m: (m[1]["year"], m[1]["ord"], m[0]["title"]))
    with open(a.out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["series_id", "book_id", "book_slug", "db_title", "wiki_title", "year", "match", "score", "position"])
        for pos, (b, e, how, score) in enumerate(matched, 1):
            w.writerow([sid, b["id"], b["slug"], b["title"], e["title"], e["year"], how, f"{score:.2f}", pos])

    by_how = {}
    for _, _, how, _ in matched:
        by_how[how] = by_how.get(how, 0) + 1
    print(f"{a.series_slug}: {len(books)} books in DB, {len(matched)} matched {by_how}, {len(unmatched)} unmatched")
    print("unmatched sample:", [b["title"] for b in unmatched[:15]])
    print(f"-> {a.out}")


if __name__ == "__main__":
    main()
