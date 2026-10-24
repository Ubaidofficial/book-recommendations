#!/usr/bin/env python3
"""Build a ranked, resumable submission tracker for one project.

Merges two public registries (fetched at run time, cached locally) with the
project's own niche list, scores each destination against the project
profile, and writes a CSV tracker. Re-running keeps the status columns of
rows already in the tracker, so it doubles as a refresh.

Sources:
  - Submitlist catalog (CC0): alvinunreal/awesome-submitlist data/destinations.json
  - list-my-startup registry (MIT): Fh-Ndiritu/list-my-startup-skill directories.csv

Stdlib only. Usage:
  python3 build_shortlist.py --profile path/to/profile.json --out path/to/tracker.csv
"""

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.request
from urllib.parse import urlparse

SUBMITLIST_URL = "https://raw.githubusercontent.com/alvinunreal/awesome-submitlist/main/data/destinations.json"
REGISTRY_URL = "https://raw.githubusercontent.com/Fh-Ndiritu/list-my-startup-skill/main/directories.csv"
CACHE_MAX_AGE = 7 * 24 * 3600

# Columns the person (or the submit phase) fills in; preserved across re-runs.
STATUS_COLUMNS = ["status", "submitted_on", "listing_url", "notes"]
COLUMNS = [
    "rank", "fit_score", "name", "type", "domain", "submission_url",
    "domain_rating", "monthly_traffic", "pricing", "link_type", "login",
    "registry_recommendation", "matched_terms", "eligibility", "registry_notes",
    "source",
] + STATUS_COLUMNS


def fetch(url, cache_dir, name):
    path = os.path.join(cache_dir, name)
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < CACHE_MAX_AGE:
        with open(path, encoding="utf-8") as f:
            return f.read()
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            body = resp.read().decode("utf-8")
    except Exception as exc:  # fall back to a stale cache rather than failing
        if os.path.exists(path):
            print(f"warn: {url} unreachable ({exc}); using stale cache", file=sys.stderr)
            with open(path, encoding="utf-8") as f:
                return f.read()
        raise
    os.makedirs(cache_dir, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    return body


def domain_of(url):
    if not url:
        return ""
    host = urlparse(url if "://" in url else "https://" + url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def as_int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def load_submitlist(text):
    rows = []
    for d in json.loads(text)["destinations"]:
        rows.append({
            "name": d["name"],
            "type": d["type"],
            "domain": domain_of(d.get("website_url") or d.get("submission_url")),
            "submission_url": d.get("submission_url") or d.get("website_url") or "",
            "domain_rating": d.get("domain_rating"),
            "monthly_traffic": d.get("monthly_traffic"),
            "pricing": d.get("pricing") or "unknown",
            "link_type": d.get("link_type") or "unknown",
            "eligibility": d.get("eligibility") or "",
            "text": " ".join(str(d.get(k) or "") for k in ("name", "description", "audience", "eligibility"))
                    + " " + " ".join(d.get("categories") or []),
            "source": "submitlist",
        })
    return rows


def load_registry(text):
    rows = []
    for r in csv.DictReader(text.splitlines()):
        rows.append({
            "name": r["Site"],
            "type": r.get("Category", ""),
            "domain": domain_of(r.get("Homepage")),
            "submission_url": r.get("Submit/Edit URL") or r.get("Homepage") or "",
            "pricing": "paid" if r.get("Paid", "").lower().startswith("yes") else "unknown",
            "login": r.get("Login", ""),
            "registry_recommendation": r.get("Recommendation", ""),
            "registry_notes": r.get("Notes", ""),
            "reciprocal": r.get("Reciprocal Badge", "").lower().startswith("yes"),
            "text": " ".join(r.get(k, "") for k in ("Site", "Category", "Notes")),
            "source": "list-my-startup",
        })
    return rows


def load_extra(path):
    """Project-specific niche destinations, same column names as the tracker."""
    if not path or not os.path.exists(path):
        return []
    rows = []
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if not r.get("name"):
                continue
            r = {k: v for k, v in r.items() if v not in (None, "")}
            r.setdefault("domain", domain_of(r.get("submission_url")))
            r.setdefault("type", "niche")
            r["text"] = " ".join(str(v) for v in r.values())
            r["source"] = "project"
            rows.append(r)
    return rows


def merge(groups):
    """Merge by domain; earlier groups win on conflicting fields, later ones fill gaps."""
    merged, order = {}, []
    for group in groups:
        for row in group:
            key = row.get("domain") or row["name"].lower()
            if key not in merged:
                merged[key] = dict(row)
                order.append(key)
                continue
            cur = merged[key]
            for k, v in row.items():
                if k == "text":
                    cur["text"] = cur.get("text", "") + " " + v
                elif k == "source":
                    cur["source"] = cur["source"] + "+" + v
                elif cur.get(k) in (None, "", "unknown"):
                    cur[k] = v
    return [merged[k] for k in order]


def term_hits(terms, text):
    found = []
    for t in terms:
        if re.search(r"\b" + re.escape(t.lower()), text):
            found.append(t)
    return found


def score(row, profile):
    """Return (score, matched_terms, reason_excluded or None)."""
    text = row.get("text", "").lower()
    rec = (row.get("registry_recommendation") or "").lower()
    allow = profile.get("allow", {})

    if row.get("type") in profile.get("exclude_types", []):
        return 0, [], "excluded type"
    if rec.startswith("skip") and not allow.get("registry_skips"):
        return 0, [], "registry: " + row.get("registry_recommendation", "")
    if row.get("pricing") == "paid" and not allow.get("paid"):
        return 0, [], "paid"
    if row.get("reciprocal") and not allow.get("reciprocal_badge"):
        return 0, [], "reciprocal badge"
    blocked = term_hits(profile.get("exclude_terms", []), text)
    if blocked:
        return 0, [], "exclude term: " + ", ".join(blocked)

    core = term_hits(profile.get("core_keywords", []), text)
    context = term_hits(profile.get("context_keywords", []), text)
    matched = core + context
    pts = 25 * len(core) + 5 * len(context)
    pts += profile.get("type_weights", {}).get(row.get("type"), 0)
    if row.get("source") == "project":
        pts += profile.get("niche_bonus", 25)
    dr = as_int(row.get("domain_rating"))
    if dr:
        pts += dr / 10
    if row.get("link_type") == "dofollow":
        pts += 3
    if row.get("pricing") == "free":
        pts += 2
    if rec.startswith("do"):
        pts += 5
    elif rec.startswith(("blocked", "conditional")):
        pts -= 3
    return round(pts, 1), matched, None


def load_existing(path):
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return {(r.get("domain") or r["name"].lower()): r for r in csv.DictReader(f)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--profile", required=True)
    ap.add_argument("--out", required=True, help="tracker CSV (created or refreshed in place)")
    ap.add_argument("--cache", default=os.path.join(os.path.expanduser("~"), ".cache", "directory-submissions"))
    ap.add_argument("--excluded", help="optional CSV listing what was dropped and why")
    args = ap.parse_args()

    with open(args.profile, encoding="utf-8") as f:
        profile = json.load(f)
    base = os.path.dirname(os.path.abspath(args.profile))
    extra_path = profile.get("extra_destinations")
    if extra_path and not os.path.isabs(extra_path):
        extra_path = os.path.join(base, extra_path)

    rows = merge([
        load_extra(extra_path),
        load_submitlist(fetch(SUBMITLIST_URL, args.cache, "destinations.json")),
        load_registry(fetch(REGISTRY_URL, args.cache, "directories.csv")),
    ])

    own = domain_of(profile.get("url"))
    kept, dropped = [], []
    min_score = profile.get("min_score", 1)
    for row in rows:
        if own and row.get("domain") == own:
            continue
        pts, matched, why = score(row, profile)
        if why is None and pts < min_score:
            why = f"score {pts} below {min_score}"
        if why:
            dropped.append({"name": row["name"], "domain": row.get("domain", ""), "reason": why})
            continue
        row["fit_score"] = pts
        row["matched_terms"] = "; ".join(matched)
        kept.append(row)

    kept.sort(key=lambda r: (-r["fit_score"], -(as_int(r.get("domain_rating")) or 0)))
    kept = kept[: profile.get("max_rows", 60)]

    existing = load_existing(args.out)
    for i, row in enumerate(kept, 1):
        row["rank"] = i
        prev = existing.pop(row.get("domain") or row["name"].lower(), None)
        for col in STATUS_COLUMNS:
            row[col] = (prev or {}).get(col) or ("todo" if col == "status" else "")
    # Rows that fell out of the ranking but were already worked on stay in the tracker.
    carried = [r for r in existing.values() if (r.get("status") or "todo") != "todo"]

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        w.writerows(kept + carried)

    if args.excluded:
        with open(args.excluded, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["name", "domain", "reason"])
            w.writeheader()
            w.writerows(dropped)

    print(f"{len(rows)} destinations merged, {len(kept)} kept, {len(carried)} carried over, {len(dropped)} dropped")
    print(f"tracker: {args.out}")


if __name__ == "__main__":
    main()
