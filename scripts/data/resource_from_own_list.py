#!/usr/bin/env python3
"""
Re-source one person's recommendations from their OWN published book lists.

READ-ONLY: writes a CSV of proposed `book_recommendations.source_url` values
and prints a summary. It never writes to the database; applying the reviewed
CSV is a separate, explicit step.

Why: source_url on many recommendation rows is a pool of every URL ever found
for that book (pipe-joined), so a person's page can cite other people's
tweets and interviews. When the person publishes their own list, that page is
the strongest source there is for the books on it.

Currently parses the WordPress markup of jamesclear.com/best-books/*, where
each pick is `<p><strong>Title</strong><br>by Author<br>...`.

Usage:
    python3 scripts/data/resource_from_own_list.py \
        --person-slug james-clear \
        --page https://jamesclear.com/best-books/nonfiction \
        --page https://jamesclear.com/best-books/fiction \
        --page https://jamesclear.com/best-books/wisdom \
        --out scratch/james_clear_resource.csv
"""
import argparse
import csv
import html
import json
import re
import unicodedata
import urllib.request

SUPABASE_URL = "https://ghpdpvatfmvsahzsqgpp.supabase.co/rest/v1/"
# Public publishable key — the same one committed in src/app/sitemap.ts.
ANON_KEY = "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z"
UA = "Mozilla/5.0 (compatible; BookMentionsResearch/1.0)"


def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def rest(path):
    return json.loads(get(SUPABASE_URL + path, {"apikey": ANON_KEY}))


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"^(the|a|an)\s+", "", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def norm_loose(s):
    return norm(re.split(r"[:(\[]", s or "", maxsplit=1)[0])


def parse_picks(page_html):
    picks = []
    # Title must be a plain text run: `.*?` here would swallow neighbouring
    # <p> blocks whenever one pick lacks an author line.
    for m in re.finditer(r"<strong>([^<]+)</strong><br\s*/?>\s*by\s+([^<]+)<", page_html):
        title = html.unescape(m.group(1)).strip()
        author = html.unescape(m.group(2)).strip()
        if title:
            picks.append((title, author))
    return picks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--person-slug", required=True)
    ap.add_argument("--page", action="append", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    listed = {}  # norm key -> (title, author, page)
    for page in a.page:
        picks = parse_picks(get(page))
        print(f"{page}: {len(picks)} picks")
        for title, author in picks:
            listed.setdefault(norm_loose(title), (title, author, page))

    pid = rest(f"people?select=id&slug=eq.{a.person_slug}")[0]["id"]
    rows = rest(f"book_recommendations?select=id,book_id,source_url,books(title,slug)&person_id=eq.{pid}&limit=500")

    matched, unmatched = [], []
    for r in rows:
        b = r.get("books")
        if not b:
            continue
        hit = listed.get(norm_loose(b["title"]))
        (matched if hit else unmatched).append((r, b, hit))

    with open(a.out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["rec_id", "book_slug", "db_title", "listed_title", "old_source_url", "new_source_url"])
        for r, b, hit in matched:
            w.writerow([r["id"], b["slug"], b["title"], hit[0], r["source_url"] or "", hit[2]])

    seen = {norm_loose(b["title"]) for _, b, _ in matched}
    missing = [v[0] for k, v in listed.items() if k not in seen]
    print(f"{a.person_slug}: {len(rows)} recs in DB, {len(listed)} books on own lists")
    print(f"  matched {len(matched)} -> {a.out}")
    print(f"  not on their own lists (source left alone): {len(unmatched)}")
    print(f"  on their lists but no recommendation row here: {missing}")


if __name__ == "__main__":
    main()
