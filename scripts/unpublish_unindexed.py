#!/usr/bin/env python3
"""
Take published LISTS and SERIES pages that Google is not indexing out of the sitemap (index_status -> 'draft'). Dry run unless --apply.

RULE (2026-11-15, from Search Console via SEOConsole):
  unpublish a list/series when ALL of
    * it has been published for at least 14 days (younger pages are "too new to judge"),
    * it earned no impression in the last 90 days (get_top_pages), and
    * Google is not known to have it indexed (get_sitemap_coverage).
  Never touched: people and books (the core entity pages, re-templated on 2026-11-14), the hub-linked "books-recommended-by-*" lists, and
  anything with impressions or an indexed state. Compare pages are handled in code (src/lib/compareIndexable.ts).
A draft page leaves the sitemap and answers noindex; the data stays. Each change is copied to public.bak_seo_changes_20261114 first
(batch below); undo with  update <table> set index_status = 'published' where id = row_id  (old_values holds the previous status).
The daily indexing-gated task (ops/scheduled-tasks/indexing-gated-publish.md) re-publishes pages one or two at a time, best first.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timedelta, timezone

import requests

BASE = "https://ghpdpvatfmvsahzsqgpp.supabase.co/rest/v1"
H = {"apikey": "dummy", "Authorization": "Bearer dummy", "Content-Type": "application/json"}
BATCH = "unpublish_unindexed_20261115"

# get_top_pages(bookmentions.net, 90 days): lists and series with impressions.
SHOWN_LISTS = set("""childrens-fiction best-cryptography-books fiction travel history action-adventure nonfiction teen-young-adult memoirs politics science
best-productivity-books sports books-recommended-by-elon-musk best-marketing-books best-survival-books best-growth-hacking-books health best-young-adult-books
best-sailing-books best-sports-biographies-books best-human-resources-books best-time-travel-books best-project-management-books best-meditation-books physics
social-sciences books-recommended-by-ceos science-fiction thriller-suspense food design best-books-on-vietnam-war books-recommended-by-founders finance buddhism
architecture children-s best-childrens-books parenting humor best-startup-books most-recommended-books best-neuroscience-books best-books-for-10-year-olds
foodhobbies best-books-for-2-year-olds best-math-books technology best-negotiation-books best-cognitive-psychology-books photography environment best-filmmaking-books
best-social-psychology-books best-business-plan-books best-fashion-books books-recommended-by-investors best-apocalyptic-books best-coffee-table-books art
best-true-crime-books hobbies leadership mystery-crime programming""".split())
SHOWN_SERIES = {f"{s}-books-in-order" for s in """enid-blyton barbara-cartland harry-potter joel-c-rosenberg rebecca-yarros freida-mcfadden sarah-j-maas mick-herron j-a-jance tana-french""".split()}
# get_sitemap_coverage: known indexed.
INDEXED_LISTS = {"best-world-war-2-books", "best-cryptocurrency-books", "best-stoicism-books", "best-artificial-intelligence-books"}
INDEXED_SERIES = {"c-j-box-books-in-order", "jack-carr-books-in-order"}
PROTECT_PREFIX = "books-recommended-by-"
MIN_AGE_DAYS = 14


def get(table, params):
    r = requests.get(f"{BASE}/{table}", params=params, headers=H, timeout=60)
    r.raise_for_status()
    return r.json()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=MIN_AGE_DAYS)).isoformat()
    stats = Counter()
    plan = []
    for table, shown, indexed in (("lists", SHOWN_LISTS, INDEXED_LISTS), ("series", SHOWN_SERIES, INDEXED_SERIES)):
        rows = get(table, {"select": "id,slug,published_at,index_status", "index_status": "eq.published", "limit": 1000})
        for r in rows:
            s = r["slug"]
            if s in shown or s in indexed or s.startswith(PROTECT_PREFIX):
                stats[f"{table}_kept_shown_or_indexed_or_protected"] += 1
            elif not r.get("published_at") or r["published_at"] > cutoff:
                stats[f"{table}_kept_too_new"] += 1
            else:
                plan.append((table, r))
                stats[f"{table}_to_unpublish"] += 1
    print(json.dumps(dict(stats), indent=1))
    if not args.apply:
        print("DRY RUN; first 12:", [(t, r["slug"]) for t, r in plan[:12]])
        return
    done = 0
    for table, r in plan:
        b = requests.post(f"{BASE}/bak_seo_changes_20261114", headers={**H, "Prefer": "return=minimal"}, timeout=60,
                          json={"table_name": table, "row_id": r["id"], "slug": r["slug"], "old_values": {"index_status": "published", "published_at": r["published_at"]}, "new_values": {"index_status": "draft"}, "batch": BATCH})
        if b.status_code not in (200, 201):
            print("backup failed", r["slug"], b.status_code)
            continue
        u = requests.patch(f"{BASE}/{table}", params={"id": f"eq.{r['id']}"}, headers={**H, "Prefer": "return=minimal"}, json={"index_status": "draft"}, timeout=60)
        done += u.status_code in (200, 204)
    print("unpublished:", done)


if __name__ == "__main__":
    main()
