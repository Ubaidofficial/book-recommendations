#!/usr/bin/env python3
"""
Build data-grounded descriptions for draft lists that have none.

READ-ONLY: queries with the public anon key and writes a review CSV plus
chunked UPDATE statements. It never writes to the database.

Why: the tiered publisher refuses a list without a description (>= 30 chars),
and 441 of the 457 draft lists with 15+ books have none, so they never reach
the sitemap. Each description is built only from facts the database holds:

  sentence 1  "<Topic>, including titles recommended by <A>, <B> and <C>."
              A-C = the people with the most recommendations among the list's
              books (full names only, published profiles preferred).
  sentence 2  "Most recommended here: <T1>, <T2> and <T3>."
              T1-T3 = the list's most-recommended titles.

Rules carried over from scripts/write_list_descriptions.js:
  - NO BOOK COUNTS in the stored text (the number shown on a page can change).
  - Sentence one stands alone under 160 chars; clampDescription() cuts there.
A list is skipped, not padded, when the data cannot support a sentence one
(fewer than 2 named recommenders).

Usage:
    python3 scripts/data/build_list_descriptions.py --out scratch/list_desc
"""
import argparse
import collections
import csv
import json
import os
import re
import time
import urllib.parse
import urllib.request

SB = "https://ghpdpvatfmvsahzsqgpp.supabase.co/rest/v1/"
# Public publishable key — the same one committed in src/app/sitemap.ts.
KEY = "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z"
PUBLISHED = {"published", "approved", "indexed", "index"}
MIN_RECOMMENDERS_TO_PUBLISH = 20  # mirrors MIN_LIST_RECOMMENDERS in publish_batch_pages.js


def rest(path):
    for attempt in range(4):
        try:
            req = urllib.request.Request(SB + path, headers={"apikey": KEY})
            return json.load(urllib.request.urlopen(req, timeout=60))
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit(f"request failed: {path[:120]}")


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def topic_phrase(slug, title):
    s = slug
    m = re.match(r"^best-books-(for|about|on)-(.+)$", s)
    if m:
        obj = m.group(2).replace("-", " ")
        # "about <place/subject>" is usually a proper noun (Denmark, San Francisco).
        return f"Books {m.group(1)} {obj.title() if m.group(1) == 'about' else obj}"
    m = re.match(r"^best-(.+)-books$", s)
    if m:
        return f"{m.group(1).replace('-', ' ').title()} books"
    if s == "best-cookbooks":
        return "Cookbooks"
    if s == "best-autobiographies":
        return "Autobiographies"
    t = re.sub(r"(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])", " ", title or "").strip()
    t = re.sub(r"\s+", " ", t)
    if not t or t in {".", "-"}:
        return ""
    return t if re.search(r"book", t, re.I) else f"{t} books"


def join_names(names):
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + " and " + names[-1]


def clean_title(t):
    t = re.sub(r"\s+", " ", (t or "").strip().strip('"“”'))
    # "1984.0" / "1491.0": a spreadsheet import saved the number as a float.
    return re.sub(r"^(\d+)\.0$", r"\1", t)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="output prefix (writes .csv and _NN.sql)")
    ap.add_argument("--chunk", type=int, default=110)
    a = ap.parse_args()

    lists = []
    for status in ("draft", "noindex"):
        off = 0
        while True:
            rows = rest(
                f"lists?select=id,slug,title,book_count,description&index_status=eq.{status}"
                f"&book_count=gte.15&order=book_count.desc&limit=1000&offset={off}"
            )
            lists += rows
            if len(rows) < 1000:
                break
            off += 1000
    lists = [l for l in lists if len((l.get("description") or "").strip()) < 30 and l["slug"]]
    # Not written automatically: adult-content topics, and imports whose title
    # lost its first letters ("ificial Intelligence").
    # Also not written: lists whose contents do not match their name (reviewed by
    # hand against each list's top titles), so they do not look publishable.
    SKIP = re.compile(
        r"porn|sex|erotic|^ificial|while-high|"
        r"^best-(personal-trainers|real-estate|vocabulary-building|law|movies|christian-fiction|short|english|storytelling|pirate)(-books)?$|"
        r"^best-books-on-introverts$|^best-weightlifting",
        re.I,
    )
    lists = [l for l in lists if not SKIP.search(l["slug"]) and not SKIP.search(l["title"] or "")]
    print(f"{len(lists)} candidate lists (15+ books, no usable description)")

    out_rows, skipped = [], collections.Counter()
    people_cache = {}
    for n, l in enumerate(lists, 1):
        topic = topic_phrase(l["slug"], l["title"])
        if not topic:
            skipped["no topic"] += 1
            continue
        links = rest(f"book_lists?select=book_id&list_id=eq.{l['id']}&limit=300")
        ids = [x["book_id"] for x in links]
        if not ids:
            skipped["no books"] += 1
            continue
        books = {}
        for ch in chunks(ids, 80):
            for b in rest(f"books?select=id,title,recommendation_count&id=in.({','.join(ch)})"):
                books[b["id"]] = b
        top_books = sorted(books.values(), key=lambda b: -(b["recommendation_count"] or 0))
        top_titles, seen_t = [], set()
        for b in top_books:
            ct = clean_title(b["title"])
            looks_like_date = re.match(r"^\d{4}-\d{2}-\d{2}", ct)
            if (b["recommendation_count"] or 0) >= 1 and ct.lower() not in seen_t and not looks_like_date:
                seen_t.add(ct.lower())
                top_titles.append(ct)
            if len(top_titles) == 3:
                break

        per_person = collections.Counter()
        distinct = set()
        for ch in chunks(ids, 80):
            for r in rest(f"book_recommendations?select=person_id&book_id=in.({','.join(ch)})&limit=5000"):
                per_person[r["person_id"]] += 1
                distinct.add(r["person_id"])
        need = [p for p, _ in per_person.most_common(25) if p not in people_cache]
        for ch in chunks(need, 60):
            for p in rest(f"people?select=id,name,index_status&id=in.({','.join(ch)})"):
                people_cache[p["id"]] = p

        named = []
        for pid, cnt in per_person.most_common(25):
            p = people_cache.get(pid)
            if not p:
                continue
            name = (p["name"] or "").strip()
            if len(name.split()) < 2 or not re.match(r"^[A-Za-z][A-Za-z.'’ \-]+$", name):
                continue
            named.append((0 if p["index_status"] in PUBLISHED else 1, -cnt, name))
        named.sort()
        top_names = [x[2] for x in named[:3]]
        if len(top_names) < 2 or len(top_titles) < 2:
            skipped["too little data for a sentence"] += 1
            continue

        # "including titles recommended by" is deliberate: the people named
        # recommended books that are IN this list, which is not the same as
        # recommending them *for* this topic (e.g. a list for 7 year olds).
        s1 = f"{topic}, including titles recommended by {join_names(top_names)}."
        s2 = f"Most recommended here: {join_names(top_titles)}."
        if len(s1) > 158:
            s1 = f"{topic}, including titles recommended by {join_names(top_names[:2])}."
        desc = f"{s1} {s2}"
        out_rows.append(
            {
                "list_id": l["id"], "slug": l["slug"], "title": l["title"], "book_count": l["book_count"],
                "distinct_recommenders": len(distinct),
                "clears_publish_depth_gate": len(distinct) >= MIN_RECOMMENDERS_TO_PUBLISH,
                "old_description": l.get("description") or "", "new_description": desc,
            }
        )
        if n % 40 == 0:
            print(f"  ...{n}/{len(lists)}")

    seen = collections.Counter(r["new_description"] for r in out_rows)
    dupes = [d for d, c in seen.items() if c > 1]
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out + ".csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out_rows[0].keys()))
        w.writeheader()
        w.writerows(out_rows)

    def q(s):
        return "'" + s.replace("'", "''") + "'"

    for i, ch in enumerate(chunks(out_rows, a.chunk), 1):
        vals = ",".join(f"({q(r['list_id'])},{q(r['new_description'])})" for r in ch)
        sql = (
            "update lists l set description=v.d, updated_at=now() "
            f"from (values {vals}) as v(id,d) where l.id=v.id::uuid "
            "and length(coalesce(l.description,''))<30 returning l.slug;"
        )
        with open(f"{a.out}_{i:02d}.sql", "w") as f:
            f.write(sql)

    gate = sum(1 for r in out_rows if r["clears_publish_depth_gate"])
    print(f"built {len(out_rows)} descriptions; skipped {dict(skipped)}; identical-text duplicates: {len(dupes)}")
    print(f"{gate} of them clear the publisher's depth gate ({MIN_RECOMMENDERS_TO_PUBLISH}+ distinct recommenders)")
    print(f"-> {a.out}.csv and {(len(out_rows) + a.chunk - 1)//a.chunk} sql chunk(s)")


if __name__ == "__main__":
    main()
