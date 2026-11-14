#!/usr/bin/env python3
"""
Apply planned recommendations (and the new books they need) to the database.
DRY RUN unless --apply is given. Writes go through the Supabase REST endpoint
with the session's credentials, one guarded step per row:

  1. skip a row listed in --reject ("person_slug|book_slug" per line)
  2. skip if the (person, book) pair already exists (book_recommendations has no
     unique constraint, so this check IS the guard against duplicates)
  3. a new book is created only if no book with that slug exists (noindex, with
     Open Library facts only; it publishes through the normal pipeline)
  4. insert the recommendation: confidence 80 strong / 60 medium; strong is capped
     to 60 for a non-tweet source whose person's own words were not found there
     (a list of sources or a post ABOUT the book is not an endorsement)
  5. record every row in public.added_rows_20261114 (so it can be removed)
  6. books.recommendation_count += 1 (distinct recommenders)

A quote is stored only if verified verbatim at the primary source. Source urls
are the primary url, never an outside index.

  python3 -I scripts/gap_apply.py --plans reports/gap_new_recs_plan_mrb_missing_pair.csv --reject reports/gap_rejects.txt --pilot 10
  python3 -I scripts/gap_apply.py --plans ... --reject ... --pilot 10 --apply
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import find_primary_sources as fps  # noqa: E402
import catalog_match as cm  # noqa: E402

BASE = fps.SUPABASE_URL + "/rest/v1"
H = {"apikey": "dummy", "Authorization": "Bearer dummy", "Content-Type": "application/json"}
LEDGER = "added_rows_20261114"
NOTE = "added 2026-11-14: coverage gap, verified recommendation"
NON_TWEET = ("blog", "podcast", "interview", "other", "youtube")


def get(table, params):
    r = requests.get(f"{BASE}/{table}", params=params, headers=H, timeout=60)
    r.raise_for_status()
    return r.json()


_catalogue = None


def existing_duplicate(title: str, author: str):
    """A book we already hold under a hyphen/spacing variant of this title and author, else None.
    Loads the whole catalogue once (it is cheap next to the cost of a duplicate book page)."""
    global _catalogue
    if _catalogue is None:
        _catalogue = {}
        for b in fps.sb_read_all("books", "id,slug,title,author_name"):
            _catalogue.setdefault(cm.title_key(b["title"]), []).append(b)
    hits = [b for b in _catalogue.get(cm.title_key(title), []) if cm.author_matches(author, b.get("author_name"))]
    return hits[0] if hits else None


def confidence(row) -> int:
    if row["evidence_strength"] == "strong":
        if row["primary_source_type"] in NON_TWEET and row["quote_verified_at_primary"] != "True":
            return 60
        return 80
    return 60


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--plans", required=True, help="comma-separated plan csv files (reports/gap_new_recs_plan*.csv)")
    ap.add_argument("--reject", help="file of person_slug|book_slug lines to skip")
    ap.add_argument("--pilot", type=int, default=0, help="only the first N rows (0 = all)")
    ap.add_argument("--batch", default="batch", help="label stored in the ledger")
    ap.add_argument("--apply", action="store_true", help="write (default: dry run)")
    args = ap.parse_args()

    rejects = set()
    if args.reject and Path(args.reject).exists():
        rejects = {l.strip() for l in Path(args.reject).read_text().splitlines() if l.strip() and not l.startswith("#")}
    rows, seen = [], set()
    for f in args.plans.split(","):
        for r in csv.DictReader(open(f, encoding="utf-8")):
            k = (r["person_slug"], r["book_slug"])
            if k in seen:
                continue
            seen.add(k)
            rows.append(r)
    if args.pilot:
        rows = rows[: args.pilot]
    stats = Counter()
    people = {p["slug"]: p["id"] for p in get("people", {"select": "id,slug", "slug": "in.(" + ",".join(sorted({r['person_slug'] for r in rows})) + ")"})} if rows else {}
    for r in rows:
        key = f"{r['person_slug']}|{r['book_slug']}"
        if key in rejects:
            stats["rejected"] += 1
            continue
        pid = people.get(r["person_slug"])
        if not pid:
            stats["person_missing"] += 1
            continue
        is_new = r["is_new_book"] == "True"
        bk = get("books", {"select": "id,recommendation_count", "slug": f"eq.{r['book_slug']}"})
        bid = bk[0]["id"] if bk else None
        if is_new and not bid:
            dup = existing_duplicate(r["book_title"], r["book_author"])
            if dup:  # we already hold this book under a hyphen/spacing variant: attach to it, never create a second
                bid = dup["id"]
                bk = get("books", {"select": "id,recommendation_count", "id": f"eq.{bid}"})
                stats["new_book_was_duplicate_attached_to_existing"] += 1
        if is_new and not bid and not r.get("ol_id"):
            stats["new_book_no_open_library"] += 1
            continue
        if not is_new and not bid:
            stats["book_missing"] += 1
            continue
        if bid and get("book_recommendations", {"select": "id", "person_id": f"eq.{pid}", "book_id": f"eq.{bid}"}):
            stats["pair_exists"] += 1
            continue
        q = r["quote_text"] if r["quote_verified_at_primary"] == "True" and fps.quote_is_verbatim(r["quote_text"]) else None
        cs = confidence(r)
        stats[f"would_add_{'new_book' if not bid else 'existing_book'}_cs{cs}"] += 1
        if not args.apply:
            continue
        if not bid:
            ol_id = (r.get("ol_id") or "").replace("/works/", "") or None
            nb = requests.post(f"{BASE}/books?on_conflict=slug", headers={**H, "Prefer": "resolution=ignore-duplicates,return=representation"},
                               json={"slug": r["book_slug"], "title": r["book_title"], "author_name": r["book_author"] or None,
                                     "cover_image_url": r.get("ol_cover") or None, "open_library_id": ol_id,
                                     "isbn_13": r.get("ol_isbn13") or None, "index_status": "noindex", "source_quality_note": NOTE}, timeout=60)
            if nb.status_code not in (200, 201):
                stats["book_insert_failed"] += 1
                print("book insert failed", nb.status_code, nb.text[:200])
                continue
            created = nb.json()
            if created:
                bid = created[0]["id"]
                requests.post(f"{BASE}/{LEDGER}", headers={**H, "Prefer": "return=minimal"},
                              json={"table_name": "books", "row_id": bid, "batch": args.batch}, timeout=60)
                stats["books_created"] += 1
            else:  # the slug exists after all: attach to it
                bid = get("books", {"select": "id", "slug": f"eq.{r['book_slug']}"})[0]["id"]
        rc = requests.post(f"{BASE}/book_recommendations", headers={**H, "Prefer": "return=representation"},
                           json={"person_id": pid, "book_id": bid, "source_url": r["primary_source_url"],
                                 "source_name": fps.SOURCE_NAMES.get(r["primary_source_type"], fps.host_of(r["primary_source_url"])),
                                 "quote": q, "confidence_score": cs}, timeout=60)
        if rc.status_code != 201:
            stats["rec_insert_failed"] += 1
            print("rec insert failed", rc.status_code, rc.text[:200])
            continue
        requests.post(f"{BASE}/{LEDGER}", headers={**H, "Prefer": "return=minimal"},
                      json={"table_name": "book_recommendations", "row_id": rc.json()[0]["id"], "batch": args.batch}, timeout=60)
        cur = get("books", {"select": "recommendation_count", "id": f"eq.{bid}"})[0]["recommendation_count"] or 0
        requests.patch(f"{BASE}/books", params={"id": f"eq.{bid}"}, headers={**H, "Prefer": "return=minimal"},
                       json={"recommendation_count": cur + 1}, timeout=60)
        stats["recommendations_added"] += 1
    print(json.dumps({"mode": "APPLY" if args.apply else "DRY RUN", "rows_in": len(rows), **stats}, indent=1))


if __name__ == "__main__":
    main()
