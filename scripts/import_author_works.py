#!/usr/bin/env python3
"""
Import an author's main works from Open Library and attach them to their
"<author> books in order" series.

Used to fill the series pages competitors rank for that BookMentions cannot
build yet, because the author's books are not in the books table at all
(Freida McFadden, Rebecca Yarros, ...) or a major work is missing (Stephen
King's story collections).

For each author it takes Open Library works where the author is listed first,
the work has at least --min-editions editions, the title is English (or
untagged) and is not a box set or omnibus. Each work becomes a books row with:
title, author_name, first_published_year (only when another edition
corroborates it, see backfill_first_published_year.corroborated_year), a
covers.openlibrary.org cover, and open_library_id. New rows are created as
index_status='noindex': they appear on series pages but are not published as
book pages until the normal enrichment + publish pipeline picks them up.

A book that already exists (same normalised title and author) is linked, not
duplicated.

Output is SQL (writes go through the Supabase SQL editor / MCP here, where no
service key is available). Nothing is written by this script itself.

  python scripts/import_author_works.py --author "Freida McFadden" --sql out.sql
  python scripts/import_author_works.py --author "Stephen King" --series stephen-king-books-in-order --min-editions 30 --sql king.sql
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
import unicodedata
import urllib.parse
from typing import Any, Dict, List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from enrich_books_metadata import OPEN_LIBRARY_SEARCH_URL, http_json, normalize  # noqa: E402
from backfill_first_published_year import corroborated_year, supabase_get  # noqa: E402
from series_completeness_check import same_author  # noqa: E402

SKIP_TITLE_RE = re.compile(
    r"(box(ed)? set|boxset|omnibus|collection set|books? \d+\s*[-–&]\s*\d+|trilogy set|"
    r"\bsampler\b|study guide|summary of|coloring book|\bvol(ume)?\.? \d+ ?- ?\d+)",
    re.I,
)


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def sql_str(value: Any) -> str:
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


def title_key(title: str) -> str:
    return re.sub(r"[^a-z0-9]", "", normalize(re.sub(r"\(.*?\)|:.*$", "", title)))


def author_works(author: str, min_editions: int) -> List[Dict[str, Any]]:
    params = {"author": author, "sort": "editions", "limit": "200",
              "fields": "key,title,author_name,first_publish_year,publish_year,edition_count,cover_i,language"}
    url = OPEN_LIBRARY_SEARCH_URL + "?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            docs = http_json(url, headers={"User-Agent": "BookMentions/1.0 (author works import)"}).get("docs", [])
            break
        except Exception:
            time.sleep(2 ** attempt)
    else:
        return []
    works, seen = [], set()
    for d in docs:
        names = d.get("author_name") or []
        title = (d.get("title") or "").strip()
        if not names or not same_author(author, names[0]) or not title:
            continue
        if int(d.get("edition_count") or 0) < min_editions or SKIP_TITLE_RE.search(title):
            continue
        langs = d.get("language") or []
        if langs and "eng" not in langs:
            continue
        if not re.search(r"[A-Za-z]", title):
            continue
        key = title_key(title)
        if not key or key in seen:
            continue
        seen.add(key)
        year = d.get("first_publish_year")
        verified = year if isinstance(year, int) and corroborated_year(year, d.get("publish_year") or []) == year else None
        works.append({
            "title": title,
            "key": key,
            "year": verified,
            "cover": f"https://covers.openlibrary.org/b/id/{d['cover_i']}-L.jpg" if d.get("cover_i") else None,
            "ol_key": (d.get("key") or "").replace("/works/", ""),
        })
    return works


def existing_books(author: str) -> Dict[str, str]:
    """title_key -> id for books already stored under this author's name."""
    # author_catalog_slug is indexed (migration 002); a name ILIKE scans all
    # ~99k books and times out.
    rows = supabase_get("books", {"select": "id,title,author_name", "author_catalog_slug": f"eq.{slugify(author)}", "limit": "2000"})
    return {title_key(r["title"]): r["id"] for r in rows if same_author(author, r.get("author_name") or "")}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--author", required=True)
    parser.add_argument("--series", help="Series slug; defaults to '<author>-books-in-order'. Created if missing.")
    parser.add_argument("--min-editions", type=int, default=5)
    parser.add_argument("--sql", required=True, help="Where to write the SQL.")
    args = parser.parse_args()

    author = args.author
    series_slug = args.series or f"{slugify(author)}-books-in-order"
    works = author_works(author, args.min_editions)
    have = existing_books(author)

    new = [w for w in works if w["key"] not in have]
    linked = [have[w["key"]] for w in works if w["key"] in have]

    stmts = [
        f"insert into series (slug, title, index_status, book_count) select {sql_str(series_slug)}, "
        f"{sql_str(author + ' Books in Order')}, 'draft', 0 where not exists (select 1 from series where slug={sql_str(series_slug)});"
    ]
    for w in new:
        stmts.append(
            "insert into books (slug, title, author_name, first_published_year, first_published_year_source, "
            "publish_date, cover_image_url, open_library_id, index_status) values ("
            f"{sql_str(slugify(w['title'] + ' ' + author))}, {sql_str(w['title'])}, {sql_str(author)}, "
            f"{w['year'] if w['year'] else 'null'}, {sql_str('openlibrary:first_publish_year') if w['year'] else 'null'}, "
            f"{sql_str(w['year'])}, {sql_str(w['cover'])}, {sql_str(w['ol_key'])}, 'noindex') "
            "on conflict (slug) do nothing;"
        )
    slugs = [slugify(w["title"] + " " + author) for w in new]
    ids_clause = " or ".join(filter(None, [
        f"b.slug in ({','.join(sql_str(s) for s in slugs)})" if slugs else "",
        f"b.id in ({','.join(sql_str(i) for i in linked)})" if linked else "",
    ]))
    if ids_clause:
        stmts.append(
            "insert into book_series (book_id, series_id) select b.id, s.id from books b, series s "
            f"where s.slug={sql_str(series_slug)} and ({ids_clause}) "
            "and not exists (select 1 from book_series x where x.book_id=b.id and x.series_id=s.id);"
        )
    stmts.append(
        f"update series s set book_count=(select count(*) from book_series x where x.series_id=s.id), updated_at=now() where s.slug={sql_str(series_slug)};"
    )
    with open(args.sql, "w", encoding="utf-8") as fh:
        fh.write("\n".join(stmts) + "\n")
    dated = sum(1 for w in works if w["year"])
    print(f"{author}: {len(works)} works ({dated} with a verified year), {len(new)} new, {len(linked)} already stored. SQL: {args.sql}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
