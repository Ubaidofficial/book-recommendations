#!/usr/bin/env python3
"""
Candidate portraits for people who have none (people.avatar_url is empty), from Wikipedia + Wikimedia Commons.
READ-ONLY: writes reports/people_avatar_candidates.csv for a human to review before anything is applied.

For each person (full name, >= --min-recs recommendations, ordered by recommendations):
  1. Wikipedia (exact title, redirects followed): lead image, short description, disambiguation flag;
  2. Commons file page: licence, author, credit. Only free licences are kept (CC BY / CC BY-SA / CC0 / public domain).
The thumbnail URL is the 330px upload.wikimedia.org thumbnail, the form already used for the other portraits.

IDENTITY IS NOT CHECKED HERE. A name can match a different person (a fictional character, a politician with the same
name). The CSV carries the Wikipedia description so each row can be checked by eye; only reviewed rows are applied
(scripts/people_avatar_apply.py).

Polite: batches of 15 titles, >= 3 s between calls, backs off on 429, resumable (cache in reports/third_party_cache).

  python3 -I scripts/people_avatar_candidates.py [--min-recs 8] [--limit 400]
"""
from __future__ import annotations

import argparse
import csv
import html
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path
from urllib.parse import quote, unquote

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import find_primary_sources as fps  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "people_avatar_candidates.csv"
CACHE = ROOT / "reports" / "third_party_cache" / "people_avatar_wiki.json"
UA = "BookMentionsResearch/1.0 (own-site enrichment)"
FREE = re.compile(r"^(cc[ -]by|cc0|public domain|pd|attribution)", re.I)
S = requests.Session()
S.headers["User-Agent"] = UA


def api(host: str, params: dict) -> dict:
    for attempt in range(6):
        time.sleep(3.2)
        r = S.get(f"https://{host}/w/api.php", params={**params, "format": "json", "formatversion": 2}, timeout=60)
        if r.status_code == 429:
            time.sleep(15 * (attempt + 1))
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError("rate limited")


def thumb(original: str, width: int = 330) -> str | None:
    m = re.match(r"^(https://upload\.wikimedia\.org/wikipedia/commons)/([0-9a-f]/[0-9a-f]{2})/([^/]+)$", original)
    if not m or re.search(r"\.(svg|tif|tiff|gif)$", m.group(3), re.I):
        return None
    return f"{m.group(1)}/thumb/{m.group(2)}/{m.group(3)}/{width}px-{m.group(3)}"


def strip(v: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", v or "")).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-recs", type=int, default=8)
    ap.add_argument("--limit", type=int, default=400)
    args = ap.parse_args()

    people = fps.sb_read_all("people", "id,slug,name,avatar_url,index_status")
    recs = Counter(r["person_id"] for r in fps.sb_read_all("book_recommendations", "person_id"))
    todo = [p for p in people if not (p.get("avatar_url") or "").strip() and len((p["name"] or "").split()) >= 2 and recs[p["id"]] >= args.min_recs]
    todo.sort(key=lambda p: -recs[p["id"]])
    todo = todo[: args.limit]
    print(f"people without a portrait, >= {args.min_recs} recs, full name: {len(todo)}", flush=True)

    CACHE.parent.mkdir(parents=True, exist_ok=True)
    cache: dict = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    names = [p["name"] for p in todo if p["name"] not in cache]
    for i in range(0, len(names), 15):
        chunk = names[i : i + 15]
        d = api("en.wikipedia.org", {"action": "query", "prop": "pageimages|description|pageprops", "piprop": "original", "ppprop": "disambiguation", "redirects": 1, "titles": "|".join(chunk)})
        q = d["query"]
        norm = {n["from"]: n["to"] for n in q.get("normalized", [])}
        red = {n["from"]: n["to"] for n in q.get("redirects", [])}
        pages = {pg["title"]: pg for pg in q["pages"]}
        for n in chunk:
            t = red.get(norm.get(n, n), norm.get(n, n))
            pg = pages.get(t)
            if not pg or pg.get("missing"):
                cache[n] = {"status": "no_page"}
            elif "pageprops" in pg and "disambiguation" in pg["pageprops"]:
                cache[n] = {"status": "disambiguation"}
            else:
                cache[n] = {"status": "ok", "title": pg["title"], "description": pg.get("description", ""), "original": (pg.get("original") or {}).get("source", "").split("?")[0]}
        CACHE.write_text(json.dumps(cache))
        print(f"  wikipedia {min(i + 15, len(names))}/{len(names)}", flush=True)

    # licences for the lead images
    for c in cache.values():
        if isinstance(c, dict) and c.get("original"):
            c["original"] = c["original"].split("?")[0]  # the API adds ?utm_... to image URLs
    cache["_licence"] = {k: v for k, v in cache.get("_licence", {}).items() if v.get("license")}
    files = sorted({unquote(c["original"].rsplit("/", 1)[-1]) for k, c in cache.items() if k != "_licence" and c.get("original")})
    lic = cache.setdefault("_licence", {})
    need = [f for f in files if f not in lic]
    for i in range(0, len(need), 30):
        chunk = need[i : i + 30]
        d = api("commons.wikimedia.org", {"action": "query", "prop": "imageinfo", "iiprop": "extmetadata", "titles": "|".join("File:" + f.replace("_", " ") for f in chunk)})
        by = {pg["title"].replace("File:", "").replace(" ", "_"): pg for pg in d["query"]["pages"]}
        for f in chunk:
            pg = by.get(f.replace(" ", "_"))
            md = ((pg or {}).get("imageinfo") or [{}])[0].get("extmetadata", {})
            lic[f] = {"license": strip(md.get("LicenseShortName", {}).get("value")), "artist": strip(md.get("Artist", {}).get("value"))[:80], "credit": strip(md.get("Credit", {}).get("value"))[:80]}
        CACHE.write_text(json.dumps(cache))
        print(f"  commons {min(i + 30, len(need))}/{len(need)}", flush=True)

    rows, skipped = [], Counter()
    for p in todo:
        c = cache.get(p["name"], {})
        c["original"] = (c.get("original") or "").split("?")[0]
        if c.get("status") != "ok":
            skipped[c.get("status", "none")] += 1
            continue
        if not c.get("original"):
            skipped["no_lead_image"] += 1
            continue
        f = unquote(c["original"].rsplit("/", 1)[-1])
        L = lic.get(f, {})
        t = thumb(c["original"])
        if not t:
            skipped["unusable_file_type"] += 1
            continue
        if not FREE.match(L.get("license", "")):
            skipped[f"not_free:{L.get('license', '?')[:20]}"] += 1
            continue
        rows.append({
            "slug": p["slug"], "name": p["name"], "status": p["index_status"], "recs": recs[p["id"]],
            "wiki_title": c["title"], "wiki_description": c["description"], "file": f, "license": L["license"], "author": L["artist"],
            "thumb_url": t, "commons_url": "https://commons.wikimedia.org/wiki/File:" + quote(f),
        })
    with OUT.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()) if rows else ["slug"])
        w.writeheader()
        w.writerows(rows)
    print(f"candidates with a free-licence portrait: {len(rows)}; skipped: {dict(skipped)}")


if __name__ == "__main__":
    main()
