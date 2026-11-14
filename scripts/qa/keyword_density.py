#!/usr/bin/env python3
"""
How often does each page use its target phrases? Counts occurrences in the page's visible text (header, footer and
navigation excluded) plus the <title>, meta description and H1/H2 separately.

Target phrases per page type are built from the page's own subject:
  people  "<name> book recommendations", "books recommended by <name>", "<name> reading list", "<name> recommended books"
  lists   "<topic> books", "best <topic> books", "top <topic> books", "<topic> books to read"
  series  "<name> books in order", "<name> books", "order of <name> books", "<name> reading order"
  books   "<title> recommended by", "books like <title>", "who recommended <title>", "<title> by <author>"

  python3 -I scripts/qa/keyword_density.py [--base https://bookmentions.net] [--n 8]
"""
from __future__ import annotations
import argparse, html, re, subprocess, sys, statistics as st
from urllib.parse import urlsplit

def fetch(url):
    return subprocess.run(["curl", "-s", "-m", "120", url], capture_output=True, text=True).stdout

def norm(s):
    return re.sub(r"\s+", " ", html.unescape(s).replace("’", "'").replace("‘", "'")).lower().strip()

def visible(page):
    page = re.sub(r"<!--.*?-->", "", page, flags=re.S)  # React's text-node markers would split phrases
    body = re.search(r"<body\b.*</body>", page, re.S | re.I)
    t = body.group(0) if body else page
    t = re.sub(r"<(script|style|noscript|svg)\b.*?</\1>", " ", t, flags=re.S | re.I)
    t = re.sub(r"<(header|footer|nav)\b.*?</\1>", " ", t, flags=re.S | re.I)
    return norm(re.sub(r"<[^>]+>", " ", t))

def parts(page):
    t = re.search(r"<title[^>]*>(.*?)</title>", page, re.S | re.I)
    d = re.search(r'<meta name="description" content="([^"]*)"', page, re.I)
    h1 = re.findall(r"<h1\b[^>]*>(.*?)</h1>", page, re.S | re.I)
    h2 = re.findall(r"<h2\b[^>]*>(.*?)</h2>", page, re.S | re.I)
    strip = lambda x: norm(re.sub(r"<[^>]+>", " ", x))
    return norm(t.group(1)) if t else "", norm(d.group(1)) if d else "", [strip(x) for x in h1], [strip(x) for x in h2]

def phrases(kind, subject, extra):
    s = norm(subject)
    if kind == "people":
        return {"book recommendations": f"{s} book recommendations", "books recommended by": f"books recommended by {s}",
                "reading list": f"{s} reading list", "recommended books": f"{s} recommended books"}
    if kind == "lists":
        t = re.sub(r"^best\s+|\s+books?$|\s*\(\d{4}\).*$", "", s).strip()
        return {"best X books": f"best {t} books", "X books": f"{t} books", "top X books": f"top {t} books", "X books to read": f"{t} books to read"}
    if kind == "series":
        n = re.sub(r"\s+books?(\s+in order)?(:.*)?$", "", s).strip()
        return {"X books in order": f"{n} books in order", "X books": f"{n} books", "order of X books": f"order of {n} books", "X reading order": f"{n} reading order"}
    return {"X recommended by": f"{s} recommended by", "books like X": f"books like {s}", "who recommended X": f"who recommended {s}", "X by author": f"{s} by {norm(extra)}"}

def count(text, phrase, subject=""):
    """Occurrences of a phrase. "James Clear's book recommendations" counts for "james clear book recommendations":
    a possessive is the same phrase to a reader and to a search engine."""
    n = len(re.findall(re.escape(phrase), text))
    if subject and phrase.startswith(subject + " "):
        n += len(re.findall(re.escape(subject + "'s" + phrase[len(subject):]), text))
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://bookmentions.net")
    ap.add_argument("--n", type=int, default=8)
    ap.add_argument("--paths", help="comma-separated paths to use instead of the default sample")
    a = ap.parse_args()
    sm = fetch(a.base + "/sitemap.xml")
    paths = [urlsplit(u).path for u in re.findall(r"<loc>([^<]+)</loc>", sm)]
    pick = lambda pre: [p for p in paths if p.startswith(pre)]
    sample = a.paths.split(",") if a.paths else []
    if not sample:
        for pre in ("/people/", "/lists/", "/series/", "/books/"):
            c = pick(pre); step = max(1, len(c) // a.n); sample += c[::step][: a.n]
    summary = {}
    for p in sample:
        kind = p.strip("/").split("/")[0]
        page = fetch(a.base + p)
        title, desc, h1, h2 = parts(page)
        vis = visible(page)
        subject = h1[0] if h1 else ""
        if kind == "people":
            subject = re.sub(r"\s*(recommended books|book recommendations)$", "", subject)
        author = ""
        ph = phrases(kind, subject if kind != "lists" else (h1[0] if h1 else ""), author)
        if kind == "books":
            m = re.search(r" by (.+?)(?::| \||$)", title); author = m.group(1) if m else ""
            ph = phrases(kind, subject, author)
        row = {}
        for k, phrase in ph.items():
            row[k] = (count(vis, phrase, norm(subject)), count(title, phrase, norm(subject)) + count(desc, phrase, norm(subject)), count(" ".join(h1 + h2), phrase, norm(subject)))
        summary.setdefault(kind, []).append((p, row))
    for kind, rows in summary.items():
        print(f"\n== {kind}: occurrences per page = body text + title + description ({len(rows)} pages)")
        for k in rows[0][1].keys():
            vals = [r[1][k][0] + r[1][k][1] for r in rows]
            print(f"   {k:24} median {st.median(vals):.0f}  min {min(vals)}  max {max(vals)}   (in the 3-5 target: {sum(1 for v in vals if 3 <= v <= 5)}/{len(vals)}, over 5: {sum(1 for v in vals if v > 5)})")


if __name__ == "__main__":
    main()
