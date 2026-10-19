#!/usr/bin/env python3
"""
Parse an author's Wikipedia bibliography into (title, first-publication year).

Why this exists: `book_series.position` is NULL for every one of ~87k rows, so
no series page can honestly claim a reading order. For author-wide "<author>
books in order" pages the order people mean is first-publication order, and
Wikipedia's bibliography tables carry that with a citable year. The output is
a candidate list to match against our `books` rows; it writes NOTHING to the
database.

Usage:
    python3 scripts/data/wikipedia_bibliography.py Enid_Blyton_bibliography \
        --out scratch/blyton_wiki.json
    python3 scripts/data/wikipedia_bibliography.py Barbara_Cartland_bibliography \
        --out scratch/cartland_wiki.json --sql scratch/cartland_values.sql

`--sql` additionally emits a `values (...)` body (norm_title, year, ord,
title) for pasting into a read-only matching query.
"""
import argparse
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request

UA = "BookMentionsResearch/1.0 (https://bookmentions.net; imubaid93@gmail.com)"


def fetch_wikitext(page: str) -> str:
    qs = urllib.parse.urlencode(
        {"action": "parse", "page": page, "prop": "wikitext", "format": "json", "redirects": 1}
    )
    req = urllib.request.Request(f"https://en.wikipedia.org/w/api.php?{qs}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)
    if "error" in data:
        raise SystemExit(f"Wikipedia error for {page}: {data['error'].get('info')}")
    return data["parse"]["wikitext"]["*"]


def clean(cell: str) -> str:
    s = re.sub(r"<ref[^>]*?/>|<ref[^>]*?>.*?</ref>", "", cell, flags=re.S)
    s = re.sub(r"<br\s*/?>", " ", s)
    s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", s)  # [[a|b]] -> b
    s = s.replace("'''", "").replace("''", "")
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", s).strip()


def normalise(title: str) -> str:
    s = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    s = s.lower()
    s = re.sub(r"^(the|a|an)\s+", "", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def split_cells(row: str):
    """A wikitable row is either `| a || b || c` on one line or one `| x` per line."""
    cells = []
    for line in row.strip().splitlines():
        line = line.strip()
        if not line.startswith("|") or line.startswith("|}") or line.startswith("|+"):
            continue
        body = line[1:]
        # Strip cell attributes: `| style="..." | text`
        parts = [p for p in re.split(r"\|\|", body)]
        for p in parts:
            if "|" in p and "[[" not in p.split("|", 1)[0]:
                p = p.split("|", 1)[1]
            cells.append(p)
    return cells


def parse_tables(wikitext: str):
    entries = []
    order = 0
    for table in re.findall(r"\{\|.*?\n\|\}", wikitext, flags=re.S):
        rows = re.split(r"\n\|-[^\n]*\n", table)
        header = None
        for row in rows:
            if row.lstrip().startswith("!") or "\n!" in row:
                heads = [clean(h).lower() for h in re.split(r"!!|\n!", row.replace("{|", "")) if h.strip()]
                heads = [re.sub(r"^[^a-z]*", "", h) for h in heads]
                if any("title" in h for h in heads):
                    header = heads
                continue
            if header is None:
                continue
            cells = [clean(c) for c in split_cells(row)]
            if not cells:
                continue
            try:
                t_idx = next(i for i, h in enumerate(header) if "title" in h and "alt" not in h)
                y_idx = next(i for i, h in enumerate(header) if "year" in h or "date" in h)
            except StopIteration:
                continue
            if t_idx >= len(cells) or y_idx >= len(cells):
                continue
            m = re.search(r"\b(1[89]\d\d|20\d\d)\b", cells[y_idx])
            title = cells[t_idx]
            if not m or not title:
                continue
            series = ""
            for i, h in enumerate(header):
                if h.startswith("series") and i < len(cells):
                    series = cells[i]
            alt = ""
            for i, h in enumerate(header):
                if "alt" in h and i < len(cells):
                    alt = cells[i]
            order += 1
            entries.append(
                {"title": title, "year": int(m.group(1)), "series": series, "alt_title": alt, "ord": order}
            )
    return entries


def parse_year_lists(wikitext: str, start_order: int = 0):
    """Bulleted lists under `===1944===`-style year headings (Blyton's 1920s-1950s)."""
    entries = []
    year = None
    order = start_order
    for line in wikitext.splitlines():
        h = re.match(r"^={2,4}\s*(1[89]\d\d|20\d\d)\s*={2,4}\s*$", line)
        if h:
            year = int(h.group(1))
            continue
        if re.match(r"^={2,4}", line):
            year = None  # decade / other headings end the year context
            continue
        if year is None:
            continue
        m = re.match(r"^\*\s*(''.+?''|\[\[.+?\]\])(.*)$", line)
        if not m:
            continue
        title = clean(m.group(1))
        if not title:
            continue
        order += 1
        entries.append(
            {"title": title, "year": year, "series": clean(m.group(2)).lstrip(", ").strip(), "alt_title": "", "ord": order}
        )
    return entries


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("page")
    ap.add_argument("--out", required=True)
    ap.add_argument("--sql")
    ap.add_argument(
        "--cached-json",
        help="Parse a previously saved action=parse API response instead of fetching "
        "(Wikipedia returns 429 when the egress IP is shared).",
    )
    a = ap.parse_args()

    if a.cached_json:
        with open(a.cached_json) as f:
            wikitext = json.load(f)["parse"]["wikitext"]["*"]
    else:
        wikitext = fetch_wikitext(a.page)
    entries = parse_year_lists(wikitext)
    entries += [dict(e, ord=e["ord"] + len(entries)) for e in parse_tables(wikitext)]
    if not entries:
        sys.exit("No bibliography rows parsed — page structure may have changed.")
    for e in entries:
        e["norm"] = normalise(e["title"])
    with open(a.out, "w") as f:
        json.dump(entries, f, indent=1, ensure_ascii=False)
    print(f"{len(entries)} rows, years {min(e['year'] for e in entries)}-{max(e['year'] for e in entries)} -> {a.out}")
    if a.sql:
        def q(s):
            return "'" + s.replace("'", "''") + "'"
        with open(a.sql, "w") as f:
            f.write(",\n".join(f"({q(e['norm'])},{e['year']},{e['ord']},{q(e['title'])})" for e in entries))
        print(f"VALUES body -> {a.sql}")


if __name__ == "__main__":
    main()
