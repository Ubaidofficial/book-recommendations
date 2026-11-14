#!/usr/bin/env python3
"""
Series coverage gap: which series does mostrecommendedbooks.com (MRB) list that
our `series` table does not? DRY RUN, READ-ONLY (public key, reports/ only).

Uses the same Fetcher as scripts/find_primary_sources.py: robots.txt honoured,
>= 1.1 s between requests, responses cached under reports/third_party_cache/.
Only MRB's three /series/sitemap/N.xml files are fetched (3 requests). Nothing
from MRB is stored but the series slug, which is a name, not editorial text.

Status per MRB series
  same_slug      our `series` has the same slug
  same_name      different slug, same normalized name ("The Expanse" ~ "expanse-books-in-order")
  missing        no match: a candidate series to add (needs the books checked first)

  python3 -I scripts/mrb_series_gap.py
"""
from __future__ import annotations

import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import find_primary_sources as fps  # noqa: E402

OUT = fps.REPORTS / "series_gap.csv"
OUT_SUMMARY = fps.REPORTS / "series_gap_summary.json"
SUFFIX = re.compile(r"\s+(?:books\s+in\s+order|books|series|in\s+order)$", re.I)


def name_key(text: str) -> str:
    """'douglas-adams-books-in-order' / 'Douglas Adams Books in Order' → 'douglasadams'."""
    t = re.sub(r"[-_]+", " ", text or "").strip()
    while True:  # strip stacked suffixes ("... series books in order")
        n = SUFFIX.sub("", t)
        if n == t:
            break
        t = n
    toks = fps.tokens(t)
    if toks and toks[0] == "the":
        toks = toks[1:]
    return "".join(toks)


def main():
    F = fps.Fetcher(offline=False)
    mrb = {}
    for n in range(0, 12):  # the index lists 0..2 today; stop at the first missing file
        res = F.get(f"{fps.MRB}/series/sitemap/{n}.xml", "mrb")
        if res.get("status") != 200:
            break
        for u in re.findall(r"<loc>https://mostrecommendedbooks\.com/series/([^<]+)</loc>", res.get("text", "")):
            mrb[u] = u
        fps.log(f"series sitemap {n}: total so far {len(mrb)}")

    ours = fps.sb_read_all("series", "id,slug,title,book_count,index_status")
    by_slug = {s["slug"]: s for s in ours}
    by_key = defaultdict(list)
    for s in ours:
        for k in {name_key(s["slug"]), name_key(s.get("title") or "")}:
            if k:
                by_key[k].append(s)
    fps.log(f"ours: {len(ours)} series; MRB: {len(mrb)} series")

    rows = []
    for slug in sorted(mrb):
        if slug in by_slug:
            status, o = "same_slug", by_slug[slug]
        else:
            hits = by_key.get(name_key(slug), [])
            status, o = ("same_name", hits[0]) if len(hits) == 1 else (("ambiguous", hits[0]) if hits else ("missing", None))
        rows.append({"mrb_slug": slug, "status": status, "our_slug": o["slug"] if o else "",
                     "our_title": (o or {}).get("title", ""), "our_book_count": (o or {}).get("book_count", ""),
                     "our_index_status": (o or {}).get("index_status", "")})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    mrb_keys = {name_key(s) for s in mrb}
    ours_only = [s for s in ours if name_key(s["slug"]) not in mrb_keys and s["slug"] not in mrb]
    summary = {"mrb_series": len(mrb), "our_series": len(ours), "status": dict(Counter(r["status"] for r in rows)),
               "ours_not_on_mrb": len(ours_only),
               "our_published": sum(1 for s in ours if s.get("index_status") in ("published", "approved", "indexed", "index")),
               "network_requests": sum(F.network_requests.values())}
    OUT_SUMMARY.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    fps.log(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
