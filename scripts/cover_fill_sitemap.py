#!/usr/bin/env python3
"""
Give every book that the live sitemap puts in front of a reader a real cover image, in resumable batches.

WHAT "PUBLISHED VIA SITEMAP" MEANS HERE
  The script downloads https://bookmentions.net/sitemap.xml and works only from what is listed there:
    tier 1  /books/<slug>      books that are themselves in the sitemap
    tier 2  /series/<slug>     books shown on those series pages   (book_series)
    tier 3  /lists/<slug>      books shown on those list pages     (book_lists)
    tier 4  /people/<slug>     books those people recommend        (book_recommendations)
  Tiers are processed in that order, so the pages Google can see are fixed before anything else.
  A book in several tiers is handled once, at its lowest tier number.

WHAT COUNTS AS "NEEDS A COVER"
  empty        cover_image_url is null or blank
  bare         not an http(s) URL (e.g. "Starlight.png"; BookCard cannot render these, so the card shows "No cover")
  shared_url   the same cover URL is held by two or more books of DIFFERENT titles inside the scope (e.g. five Debbie
               Macomber books all pointing at the cover of "16 Lighthouse Road"). Each is a wrong cover for all but one.

HOW A REPLACEMENT IS CHOSEN (precision over recall: no cover is better than a wrong one)
  Open Library search by title + author. A hit is accepted only if its normalised title equals ours AND an author
  surname matches (catalog_match). The image (covers.openlibrary.org/b/id/<cover_i>-L.jpg, default=false) must then
  download, be at least MIN_W px wide, and be portrait-shaped. Anything else is left alone and reported as unmatched.

SAFETY
  * Dry run unless --apply.
  * Before each write the old value goes to public.bak_seo_changes_20261114 (batch name = --batch), and the PATCH only
    matches the row if cover_image_url still holds the value that was read (drift check).
  * Resumable: rows already fixed no longer qualify, so re-running continues where the last run stopped.
  * Undo a batch:  update books b set cover_image_url = x.old_values->>'cover_image_url'
                   from bak_seo_changes_20261114 x where x.row_id = b.id and x.batch = '<batch>' and x.table_name = 'books';

Usage
  python3 -I scripts/cover_fill_sitemap.py --plan                    # count what is in scope, per tier and state
  python3 -I scripts/cover_fill_sitemap.py --limit 100               # dry run, first 100 candidates
  python3 -I scripts/cover_fill_sitemap.py --limit 100 --apply --batch cover_sitemap_20261116_b01
  python3 -I scripts/cover_fill_sitemap.py --series debbie-macomber-books-in-order --apply --batch ...   # one series only
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import catalog_match as cm  # noqa: E402
import find_primary_sources as fps  # noqa: E402

try:
    from PIL import Image
except ImportError:  # image checks degrade to size-only
    Image = None

SITEMAP = "https://bookmentions.net/sitemap.xml"
BASE = fps.SUPABASE_URL + "/rest/v1"
READ = {"apikey": fps.READ_KEY, "Authorization": f"Bearer {fps.READ_KEY}"}
# Writes go through the agent proxy, which swaps this dummy for the real key.
WRITE = {"apikey": "dummy", "Authorization": "Bearer dummy", "Content-Type": "application/json"}
UA = "BookMentionsResearch/1.0 (own-site enrichment)"
MIN_W = 120          # px; real covers Open Library only holds small (128 wide) still beat "No cover"
MIN_BYTES = 4000
S = requests.Session()
S.headers["User-Agent"] = UA
REPORTS = Path(__file__).resolve().parent.parent / "reports"


def is_url(u) -> bool:
    return bool(u) and str(u).strip().lower().startswith(("http://", "https://"))


def get(table, params):
    r = requests.get(f"{BASE}/{table}", params=params, headers=READ, timeout=60)
    r.raise_for_status()
    return r.json()


def get_all(table, params, page=1000):
    out = []
    for i in range(500):
        chunk = get(table, {**params, "offset": i * page, "limit": page})
        out += chunk
        if len(chunk) < page:
            return out
    raise RuntimeError("pagination bound hit")


def chunks(seq, n):
    seq = list(seq)
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def sitemap_slugs() -> dict[str, list[str]]:
    xml = S.get(SITEMAP, timeout=120).text
    urls = re.findall(r"<loc>([^<]+)</loc>", xml)
    out: dict[str, list[str]] = defaultdict(list)
    for u in urls:
        m = re.match(r"https://bookmentions\.net/(books|series|lists|people)/([^/?#]+)$", u)
        if m:
            out[m.group(1)].append(m.group(2))
    return out


def ids_for(table, slugs):
    ids = {}
    for c in chunks(slugs, 40):
        quoted = ",".join('"' + s.replace('"', '') + '"' for s in c)
        for r in get(table, {"select": "id,slug", "slug": f"in.({quoted})"}):
            ids[r["slug"]] = r["id"]
    return ids


def book_ids_via(junction, fk, parent_ids):
    found = set()
    for c in chunks(parent_ids, 30):
        for r in get_all(junction, {"select": "book_id", fk: "in.(" + ",".join(c) + ")", "order": f"book_id,{fk}"}):
            found.add(r["book_id"])
    return found


def load_scope(series_only: str | None):
    sm = sitemap_slugs()
    print({k: len(v) for k, v in sm.items()}, flush=True)
    tiers: list[tuple[int, set]] = []
    if series_only:
        sid = ids_for("series", [series_only])
        tiers.append((2, book_ids_via("book_series", "series_id", list(sid.values()))))
    else:
        bid = ids_for("books", sm["books"])
        tiers.append((1, set(bid.values())))
        tiers.append((2, book_ids_via("book_series", "series_id", list(ids_for("series", sm["series"]).values()))))
        tiers.append((3, book_ids_via("book_lists", "list_id", list(ids_for("lists", sm["lists"]).values()))))
        tiers.append((4, book_ids_via("book_recommendations", "person_id", list(ids_for("people", sm["people"]).values()))))
    tier_of: dict[str, int] = {}
    for n, ids in tiers:
        for i in ids:
            tier_of.setdefault(i, n)
    books = []
    for c in chunks(tier_of, 100):
        books += get("books", {"select": "id,slug,title,author_name,cover_image_url,recommendation_count,index_status",
                               "id": "in.(" + ",".join(c) + ")"})
    return tier_of, books


def classify(books):
    """-> {book_id: state} for books whose current cover cannot be trusted."""
    state = {}
    by_url = defaultdict(list)
    for b in books:
        u = (b["cover_image_url"] or "").strip()
        if not u:
            state[b["id"]] = "empty"
        elif not is_url(u):
            state[b["id"]] = "bare"
        else:
            by_url[u].append(b)
    for u, group in by_url.items():
        if len({cm.title_key(b["title"]) for b in group}) > 1:
            # Keep the cover for the book it genuinely belongs to when we can tell (ISBN-based Amazon URLs carry no
            # title, so we cannot): every holder is re-sourced.
            for b in group:
                state[b["id"]] = "shared_url"
    return state


def ol_candidate(b):
    """Return (url, note) for a safe Open Library cover, else (None, reason)."""
    title, author = b["title"], b["author_name"] or ""
    if not author.strip():
        return None, "no_author"
    for attempt in range(3):
        try:
            r = S.get("https://openlibrary.org/search.json", timeout=40,
                      params={"title": title, "author": author, "limit": 8, "fields": "title,author_name,cover_i,language"})
            if r.status_code == 200:
                docs = r.json().get("docs", [])
                break
            time.sleep(3 * (attempt + 1))
        except Exception:  # noqa: BLE001
            time.sleep(3 * (attempt + 1))
    else:
        return None, "lookup_error"
    want = cm.title_key(title)
    reason = "no_safe_match"
    for d in docs:
        if not d.get("cover_i") or cm.title_key(d.get("title", "")) != want:
            continue
        if not any(cm.author_matches(a, author) for a in (d.get("author_name") or [])[:3]):
            continue
        langs = d.get("language") or []
        if langs and "eng" not in langs:
            continue
        url = f"https://covers.openlibrary.org/b/id/{d['cover_i']}-L.jpg"
        ok, why = image_ok(url + "?default=false")
        if ok:
            return url, "ol_title_author"
        reason = why
    return None, reason


def image_ok(url):
    try:
        r = S.get(url, timeout=40)
    except Exception:  # noqa: BLE001
        return False, "image_error"
    if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
        return False, f"image_http_{r.status_code}"
    if len(r.content) < MIN_BYTES:
        return False, "image_tiny"
    if Image is not None:
        try:
            im = Image.open(io.BytesIO(r.content))
            w, h = im.size
            hsv = im.convert("RGB").resize((64, 96)).convert("HSV")
        except Exception:  # noqa: BLE001
            return False, "image_unreadable"
        if w < MIN_W or h < w:
            return False, f"image_shape_{w}x{h}"
        # Open Library sometimes holds an Internet Archive title-page scan (white page, black text) as the "cover".
        # Real covers have colour: such scans have <3% saturated pixels and are mostly light.
        sat, val = (list(hsv.getdata(band)) for band in (1, 2))
        n = len(sat)
        if sum(v > 64 for v in sat) / n < 0.03 and sum(v > 191 for v in val) / n > 0.7:
            return False, "title_page_scan"
    return True, "ok"


def apply_row(b, url, batch):
    old = b["cover_image_url"]
    bk = requests.post(f"{BASE}/bak_seo_changes_20261114", headers={**WRITE, "Prefer": "return=minimal"}, timeout=60,
                       json={"table_name": "books", "row_id": b["id"], "slug": b["slug"],
                             "old_values": {"cover_image_url": old}, "new_values": {"cover_image_url": url}, "batch": batch})
    if bk.status_code not in (200, 201):
        return "backup_failed"
    guard = {"id": f"eq.{b['id']}", "cover_image_url": "is.null" if old is None else f"eq.{old}"}
    r = requests.patch(f"{BASE}/books", params=guard, headers={**WRITE, "Prefer": "return=representation"},
                       json={"cover_image_url": url}, timeout=60)
    if r.status_code not in (200, 204):
        return "update_failed"
    return "filled" if r.status_code == 204 or r.json() else "drifted_skipped"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--plan", action="store_true", help="only count the scope and exit")
    ap.add_argument("--limit", type=int, default=100, help="candidates per batch")
    ap.add_argument("--batch", default="cover_sitemap_dryrun")
    ap.add_argument("--series", help="restrict to one series slug (tier 2 only)")
    ap.add_argument("--tier", type=int, help="restrict to one tier (1-4)")
    ap.add_argument("--skip", type=int, default=0, help="skip the first N candidates")
    ap.add_argument("--all", action="store_true", help="work through every candidate in batches of --limit (batch names get _NN)")
    ap.add_argument("--retry", action="store_true", help="also retry slugs remembered as unmatched")
    args = ap.parse_args()

    tier_of, books = load_scope(args.series)
    state = classify(books)
    todo = [b for b in books if b["id"] in state and (not args.tier or tier_of[b["id"]] == args.tier)]
    todo.sort(key=lambda b: (tier_of[b["id"]], -(b["recommendation_count"] or 0), b["slug"]))
    plan = Counter((tier_of[b["id"]], state[b["id"]]) for b in todo)
    print(f"scope: {len(books)} books; needing a cover: {len(todo)}")
    for k in sorted(plan):
        print(f"  tier {k[0]} {k[1]:<11} {plan[k]}")
    if args.plan:
        return
    REPORTS.mkdir(exist_ok=True)
    seen = REPORTS / "cover_fill_unmatched.txt"   # slugs already tried without a safe match; skipped on later runs
    tried = set(seen.read_text().split()) if seen.exists() and not args.retry else set()
    todo = [b for b in todo if b["slug"] not in tried][args.skip:]
    if args.all:
        chunk_list = list(chunks(todo, args.limit))
    else:
        chunk_list = [todo[: args.limit]]
    print(f"{len(todo)} candidates; {len(chunk_list)} batch(es) of up to {args.limit} "
          f"({'APPLY ' + args.batch if args.apply else 'DRY RUN'})", flush=True)

    total = Counter()
    for bi, part in enumerate(chunk_list, 1):
        name = f"{args.batch}_{bi:02d}" if args.all else args.batch
        stats, rows = Counter(), []
        for n, b in enumerate(part, 1):
            time.sleep(1.0)
            url, note = ol_candidate(b)
            outcome = note
            if url:
                outcome = apply_row(b, url, name) if args.apply else "would_fill"
            stats[outcome] += 1
            if outcome not in ("filled", "would_fill") and outcome != "lookup_error":
                with seen.open("a") as f:
                    f.write(b["slug"] + "\n")
            rows.append({"tier": tier_of[b["id"]], "state": state[b["id"]], "slug": b["slug"], "title": b["title"],
                         "author": b["author_name"], "old": b["cover_image_url"], "new": url or "", "outcome": outcome})
            if n % 50 == 0:
                print(f"  [{name}] {n}/{len(part)}", dict(stats), flush=True)
        out = REPORTS / f"{name}.csv"
        with out.open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]) if rows else ["slug"])
            w.writeheader()
            w.writerows(rows)
        total.update(stats)
        print(json.dumps({"mode": "APPLY" if args.apply else "DRY RUN", "batch": name, **stats}), flush=True)
    print(json.dumps({"TOTAL": dict(total)}))
    print("report:", REPORTS)


if __name__ == "__main__":
    main()
