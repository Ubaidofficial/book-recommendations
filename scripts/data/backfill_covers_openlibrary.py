#!/usr/bin/env python3
"""
Find Open Library covers for books that are shown up front on lists that are
published or queued to publish. READ-ONLY toward the database: it writes a
CSV of matches and chunked UPDATE statements; apply them separately.

Scope is deliberate: only books a visitor sees first on a list that is ready
to go live (2+ recommendations, or in the list's top 12), not the whole table.

Why a cover can be missing: `books.cover_image_url` holds a bare filename
("Stoicism.png") for most rows, which is not a URL and does not resolve.

A match is accepted only when the Open Library result's title equals the
book's title (ignoring case, punctuation and a leading "the") AND the author's
last name appears among the result's authors. No fuzzy guessing: a wrong cover
is worse than "No cover".

The stored URL ends in ?default=false so a missing image returns 404 and the
site's own "No cover" fallback shows, instead of Open Library's blank pixel.

Usage:
    python3 scripts/data/backfill_covers_openlibrary.py --slugs-file scratch/cover_slugs.txt \
        --out scratch/covers --limit 5000
"""
import argparse
import csv
import json
import os
import re
import time
import urllib.parse
import urllib.request

SB = "https://ghpdpvatfmvsahzsqgpp.supabase.co/rest/v1/"
KEY = "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z"  # public publishable key, as in src/app/sitemap.ts
UA = "BookMentionsCoverBot/1.0 (+https://bookmentions.net)"


def rest(path):
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(SB + path, headers={"apikey": KEY}), timeout=60))
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit(f"request failed: {path[:100]}")


def norm(s):
    s = re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower())
    s = re.sub(r"\b(the|a|an)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def last_name(a):
    parts = re.sub(r"[^A-Za-z\s'\-]", " ", a or "").split()
    return parts[-1].lower() if parts else ""


def ol_search(title, author):
    qs = urllib.parse.urlencode(
        {"title": title, "author": author, "limit": 8, "fields": "key,title,author_name,cover_i"}
    )
    for attempt in range(4):
        try:
            req = urllib.request.Request("https://openlibrary.org/search.json?" + qs, headers={"User-Agent": UA})
            return json.load(urllib.request.urlopen(req, timeout=40)).get("docs", [])
        except Exception:
            time.sleep(3 * (attempt + 1))
    return None


def find_cover(title, author):
    docs = ol_search(title, author)
    if docs is None:
        return None, "error"
    want, ln = norm(title), last_name(author)
    for d in docs:
        if not d.get("cover_i"):
            continue
        if norm(d.get("title")) != want:
            continue
        authors = " ".join(d.get("author_name") or []).lower()
        if ln and ln not in authors:
            continue
        return d, "ok"
    return None, "no_match"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slugs-file", required=True, help="one list slug per line, in priority order")
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=100000)
    ap.add_argument("--sleep", type=float, default=0.7)
    a = ap.parse_args()

    slugs = [l.strip() for l in open(a.slugs_file) if l.strip()]
    lists = {}
    for i in range(0, len(slugs), 25):
        q = ",".join(urllib.parse.quote(s) for s in slugs[i : i + 25])
        for r in rest(f"lists?select=id,slug&slug=in.({q})"):
            lists[r["slug"]] = r["id"]

    targets, seen = [], set()
    for slug in slugs:
        lid = lists.get(slug)
        if not lid:
            continue
        ids = [x["book_id"] for x in rest(f"book_lists?select=book_id&list_id=eq.{lid}&limit=300")]
        books = []
        for i in range(0, len(ids), 80):
            ch = ",".join(ids[i : i + 80])
            books += rest(f"books?select=id,title,author_name,cover_image_url,recommendation_count&id=in.({ch})")
        books.sort(key=lambda b: -(b["recommendation_count"] or 0))
        for rank, b in enumerate(books):
            front = (b["recommendation_count"] or 0) >= 2 or rank < 12
            has = (b.get("cover_image_url") or "").startswith("http")
            if front and not has and b["id"] not in seen:
                seen.add(b["id"])
                targets.append(b)
    print(f"{len(targets)} books need a cover across {len(lists)} lists")

    done = {}
    if os.path.exists(a.out + ".csv"):
        for r in csv.DictReader(open(a.out + ".csv")):
            done[r["id"]] = r
    rows = list(done.values())
    todo = [b for b in targets if b["id"] not in done][: a.limit]
    print(f"{len(done)} already searched; {len(todo)} to go")
    for n, b in enumerate(todo, 1):
        d, status = find_cover((b["title"] or "").split(":")[0], b["author_name"] or "")
        rows.append(
            {"id": b["id"], "title": b["title"], "author": b["author_name"], "status": status,
             "ol_key": (d or {}).get("key", "").replace("/works/", ""),
             "cover_url": f"https://covers.openlibrary.org/b/id/{d['cover_i']}-L.jpg?default=false" if d else ""}
        )
        if n % 50 == 0:
            with open(a.out + ".csv", "w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=["id", "title", "author", "status", "ol_key", "cover_url"])
                w.writeheader()
                w.writerows(rows)
            ok = sum(1 for r in rows if r["status"] == "ok")
            print(f"  ...{n}/{len(todo)}  matched so far: {ok}", flush=True)
        time.sleep(a.sleep)
    with open(a.out + ".csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["id", "title", "author", "status", "ol_key", "cover_url"])
        w.writeheader()
        w.writerows(rows)

    q = lambda s: "'" + (s or "").replace("'", "''") + "'"
    ok = [r for r in rows if r["status"] == "ok"]
    for i in range(0, len(ok), 150):
        ch = ok[i : i + 150]
        vals = ",".join(f"('{r['id']}',{q(r['cover_url'])},{q(r['ol_key'])})" for r in ch)
        sql = (
            "update books b set cover_image_url=v.u, open_library_id=coalesce(nullif(b.open_library_id,''),v.k), updated_at=now() "
            f"from (values {vals}) as v(id,u,k) where b.id=v.id::uuid and (b.cover_image_url is null or b.cover_image_url !~ '^https?://') returning b.id;"
        )
        open(f"{a.out}_{i // 150 + 1:02d}.sql", "w").write(sql)
    print(f"matched {len(ok)} of {len(rows)} searched -> {a.out}.csv and {(len(ok) + 149) // 150} sql chunk(s)")


if __name__ == "__main__":
    main()
