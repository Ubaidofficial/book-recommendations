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

Parsers (one per site layout; add more as needed):
  wordpress-strong  <strong>Title</strong><br>by Author      (jamesclear.com/best-books/*)
  sivers            <h3><a href="/book/Slug">Title - by Author</a>  (sivers.org/book)
                    -> per-book URL https://sivers.org/book/Slug
  amazon-list       <li><a href="amazon.com/dp/...">Title</a>      (patrickcollison.com/bookshelf)

A row is only proposed when the normalised title matches AND, when the list
gives an author, the author's surname matches too. Rows whose current source
is already on the same site are reported but left alone.

Usage:
    python3 scripts/data/resource_from_own_list.py \
        --person-slug derek-sivers --parser sivers \
        --page https://sivers.org/book --out scratch/sivers_resource.csv
"""
import argparse
import csv
import html
import json
import re
import unicodedata
import urllib.parse
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


def squash(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"^(the|a|an)\s+", "", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def norm_loose(s):
    return norm(re.split(r"[:(\[]", s or "", maxsplit=1)[0])


def surname_key(author):
    parts = re.split(r"\s+", (author or "").strip())
    return squash(parts[-1]) if parts and parts[-1] else ""


def clean(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def parse_wordpress_strong(page_html, page_url):
    # Title must be a plain text run: `.*?` here would swallow neighbouring
    # <p> blocks whenever one pick lacks an author line.
    return [
        (html.unescape(m.group(1)).strip(), html.unescape(m.group(2)).strip(), page_url)
        for m in re.finditer(r"<strong>([^<]+)</strong><br\s*/?>\s*by\s+([^<]+)<", page_html)
    ]


def parse_sivers(page_html, page_url):
    out = []
    for m in re.finditer(r'<h3><a href="(/book/[^"]+)">(.*?)</a></h3>', page_html, flags=re.S):
        label = clean(m.group(2))
        title, _, author = label.rpartition(" - by ")
        if not title:
            title, author = label, ""
        out.append((title.strip(), author.strip(), urllib.parse.urljoin(page_url, m.group(1))))
    return out


def parse_amazon_list(page_html, page_url):
    return [
        (clean(m.group(1)), "", page_url)
        for m in re.finditer(r'<li>(?:<[bi]>)?<a href="https?://(?:www\.)?amazon\.[^"]+">(.*?)</a>', page_html, flags=re.S)
        if clean(m.group(1))
    ]


PARSERS = {
    "wordpress-strong": parse_wordpress_strong,
    "sivers": parse_sivers,
    "amazon-list": parse_amazon_list,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--person-slug", required=True)
    ap.add_argument("--parser", choices=sorted(PARSERS), default="wordpress-strong")
    ap.add_argument("--page", action="append", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    listed = {}  # norm key -> list of (title, author, url)
    for page in a.page:
        picks = PARSERS[a.parser](get(page), page)
        print(f"{page}: {len(picks)} picks")
        for title, author, url in picks:
            listed.setdefault(norm_loose(title), []).append((title, author, url))
    if not listed:
        raise SystemExit("Parsed 0 picks — page layout may have changed; refusing to continue.")
    own_hosts = {urllib.parse.urlparse(u).hostname.replace("www.", "") for v in listed.values() for _, _, u in v}

    pid = rest(f"people?select=id&slug=eq.{a.person_slug}")[0]["id"]
    rows = rest(
        f"book_recommendations?select=id,book_id,source_url,books(title,slug,author_name)&person_id=eq.{pid}&limit=1000"
    )

    proposed, already_own, no_match, author_mismatch = [], [], [], 0
    for r in rows:
        b = r.get("books")
        if not b:
            continue
        cands = listed.get(norm_loose(b["title"]))
        hit = None
        for title, author, url in cands or []:
            if not author or not b.get("author_name") or surname_key(author) == surname_key(b["author_name"]):
                hit = (title, author, url)
                break
        if cands and not hit:
            author_mismatch += 1
        if not hit:
            no_match.append(b["title"])
            continue
        old = r["source_url"] or ""
        if any(h in old for h in own_hosts):
            already_own.append(b["title"])
            continue
        proposed.append((r, b, hit, old))

    with open(a.out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["rec_id", "book_slug", "db_title", "listed_title", "old_source_url", "new_source_url"])
        for r, b, hit, old in proposed:
            w.writerow([r["id"], b["slug"], b["title"], hit[0], old, hit[2]])

    seen = {norm_loose(b["title"]) for _, b, _, _ in proposed} | {norm_loose(t) for t in already_own}
    print(f"{a.person_slug}: {len(rows)} recs in DB, {len(listed)} distinct books on own list(s)")
    print(f"  proposed re-source:                  {len(proposed)} -> {a.out}")
    print(f"  already cite their own site (kept):  {len(already_own)}")
    print(f"  not on their own list (left alone):  {len(no_match)}  (title found but author differs: {author_mismatch})")
    print(f"  on their list, no recommendation row: {len([k for k in listed if k not in seen])}")


if __name__ == "__main__":
    main()
