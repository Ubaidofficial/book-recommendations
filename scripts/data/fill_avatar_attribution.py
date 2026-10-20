#!/usr/bin/env python3
"""
Add Wikimedia Commons credit fields to an enrich_people_metadata.js proposal.

READ-ONLY toward the database. Reads scratch/people_enrichment_proposal.json,
looks up each license-safe avatar on Commons, and writes a CSV with the fields
the people page renders as a photo credit:

    avatar_source_url   https://commons.wikimedia.org/wiki/File:<name>
    avatar_license      e.g. "CC BY-SA 4.0"
    avatar_author       the photographer (HTML stripped)
    avatar_attribution  a pre-composed credit line

CC BY / CC BY-SA photos legally require this credit; enrich_people_metadata.js
only stores avatar_url, so without this step the photos would be used unattributed.

Usage:
    python3 scripts/data/fill_avatar_attribution.py \
        --proposal scratch/people_enrichment_proposal.json \
        --out scratch/people_attribution.csv
"""
import argparse
import csv
import html
import json
import re
import time
import urllib.parse
import urllib.request

UA = "BookMentionsEnrichmentBot/1.0 (+https://bookmentions.net; contact: team@bookmentions.net)"


def strip(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def commons_batch(filenames):
    """Look up many files in one request (Commons allows up to 50 titles per call)."""
    qs = urllib.parse.urlencode(
        {"action": "query", "titles": "|".join(f"File:{f}" for f in filenames), "prop": "imageinfo",
         "iiprop": "extmetadata|url", "format": "json", "formatversion": 2}
    )
    for attempt in range(6):
        try:
            req = urllib.request.Request(f"https://commons.wikimedia.org/w/api.php?{qs}", headers={"User-Agent": UA})
            data = json.load(urllib.request.urlopen(req, timeout=40))["query"]
            norm = {n["from"]: n["to"] for n in data.get("normalized", [])}
            pages = {p["title"]: p for p in data["pages"]}
            out = {}
            for f in filenames:
                t = norm.get(f"File:{f}", f"File:{f}")
                ii = ((pages.get(t) or {}).get("imageinfo") or [{}])[0]
                out[f] = (ii.get("extmetadata") or {}, ii.get("descriptionurl"))
            return out
        except Exception:
            time.sleep(5 * (attempt + 1))
    return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--proposal", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    rows = [r for r in json.load(open(a.proposal)) if r.get("proposed_avatar_url") and str(r.get("is_safe_avatar")) == "true"]
    print(f"{len(rows)} license-safe avatars to credit")
    out, missing = [], 0
    jobs = []
    for r in rows:
        m = re.search(r"/commons/(?:thumb/)?[0-9a-f]/[0-9a-f]{2}/([^/]+)", r["proposed_avatar_url"])
        if not m:
            missing += 1
            continue
        jobs.append((r, urllib.parse.unquote(m.group(1))))
    info = {}
    for i in range(0, len(jobs), 40):
        info.update(commons_batch([f for _, f in jobs[i : i + 40]]))
        print(f"  ...{min(i + 40, len(jobs))}/{len(jobs)}", flush=True)
        time.sleep(1.5)
    for r, fname in jobs:
        url = r["proposed_avatar_url"]
        ext, page_url = info.get(fname, ({}, None))
        v = lambda k: strip((ext.get(k) or {}).get("value", ""))
        lic, author, credit = v("LicenseShortName") or r.get("license", ""), v("Artist"), v("Credit")
        source = page_url or f"https://commons.wikimedia.org/wiki/File:{urllib.parse.quote(fname)}"
        if lic.lower().startswith("public domain") or lic.lower() in {"pd", "cc0"}:
            attribution = f"Photo: {author or 'Wikimedia Commons'} (public domain)"
        else:
            attribution = f"Photo: {author or credit or 'Wikimedia Commons'}, {lic}, via Wikimedia Commons"
        out.append(
            {"id": r["id"], "slug": r["slug"], "name": r["name"], "avatar_url": url,
             "avatar_source_url": source, "avatar_license": lic, "avatar_author": author[:200],
             "avatar_attribution": attribution[:300]}
        )

    with open(a.out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    no_author = sum(1 for o in out if not o["avatar_author"])
    print(f"wrote {len(out)} credits to {a.out} (url unparseable: {missing}; no author name found: {no_author})")


if __name__ == "__main__":
    main()
