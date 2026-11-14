#!/usr/bin/env python3
"""
Screen tweet-sourced recommendations for text that is NOT an endorsement: the person says they have not read
the book, will read it, or dislikes it. Reads the archived tweet text the verifier cached
(reports/third_party_cache/primary/web.archive.org). Read-only; prints flagged rows and, with --write-rejects,
appends them to the reject file used by scripts/gap_apply.py.

  python3 -I scripts/gap_screen_tweets.py --plans reports/gap_new_recs_plan_mrb_pairs_fresh.csv --write-rejects reports/gap_rejects.txt
  python3 -I scripts/gap_screen_tweets.py --written          # the rows already in the database (ledger) — lists only
"""
from __future__ import annotations

import argparse
import csv
import glob
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import find_primary_sources as fps  # noqa: E402
import rtt_primary_sources as rtt  # noqa: E402

HEDGE = re.compile(r"haven.t (?:yet )?(?:read|finished)|have not (?:yet )?read|not (?:yet )?read (?:it|this)|yet to read|not a blurb|"
                   r"on my (?:to.?read|reading|tbr) list|want to read|going to read|plan(?:ning)? to read|can.t wait to read|"
                   r"will (?:be )?read|about to read|just started|looking forward to reading|psyched for|excited (?:for|to read)|pre-?order", re.I)
NEG = re.compile(r"not worth|overrated|disappoint\w*|boring|\bhated?\b|worst|didn.t (?:like|enjoy|finish)|couldn.t finish|"
                 r"wouldn.t recommend|do not recommend|don.t recommend|waste of|\bavoid\b|skip (?:it|this)", re.I)


def snapshots():
    out = []
    for f in glob.glob(str(fps.CACHE / "primary" / "web.archive.org" / "*.json")):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        if d.get("text"):
            out.append(d["text"])
    return out


def tweet_text(url: str, pages: list[str]):
    m = re.search(r"/status(?:es)?/(\d+)", url or "")
    if not m:
        return None
    tid = m.group(1)
    page = next((t for t in pages if f"/status/{tid}" in t or f"/statuses/{tid}" in t), None)
    tw = rtt.parse_tweet_snapshot(page, tid) if page else None
    return tw["text"] if tw else None


def flag(text: str | None):
    if not text:
        return None
    m = HEDGE.search(text) or NEG.search(text)
    return m.group(0) if m else None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--plans")
    ap.add_argument("--write-rejects")
    ap.add_argument("--written", action="store_true", help="screen rows already written (ledger); lists ids to review")
    args = ap.parse_args()
    pages = snapshots()
    fps.log(f"archived tweet snapshots: {len(pages)}")
    flagged = []
    if args.plans:
        for f in args.plans.split(","):
            for r in csv.DictReader(open(f, encoding="utf-8")):
                if r["primary_source_type"] != "tweet":
                    continue
                t = tweet_text(r["primary_source_url"], pages)
                w = flag(t)
                if w:
                    flagged.append((f"{r['person_slug']}|{r['book_slug']}", w, (t or "")[:170]))
    if args.written:
        import requests
        H = {"apikey": "dummy", "Authorization": "Bearer dummy"}
        led = requests.get(f"{fps.SUPABASE_URL}/rest/v1/added_rows_20261114", headers=H, params={"select": "row_id", "table_name": "eq.book_recommendations", "limit": "2000"}).json()
        for i in range(0, len(led), 60):
            ids = ",".join(x["row_id"] for x in led[i:i + 60])
            for r in requests.get(f"{fps.SUPABASE_URL}/rest/v1/book_recommendations", headers=H,
                                  params={"select": "id,source_url,people(slug),books(slug)", "id": f"in.({ids})"}).json():
                t = tweet_text(r["source_url"], pages)
                w = flag(t)
                if w:
                    flagged.append((f"{r['id']}|{r['people']['slug']}|{r['books']['slug']}", w, (t or "")[:170]))
    for k, w, t in flagged:
        print(f"- {k}  [{w}]\n    {t!r}")
    print(f"\nflagged: {len(flagged)}")
    if args.write_rejects and flagged:
        with open(args.write_rejects, "a") as f:
            f.write("\n# screened tweets (hedge / negative)\n" + "\n".join(k for k, _, _ in flagged if k.count("|") == 1) + "\n")


if __name__ == "__main__":
    main()
