#!/usr/bin/env python3
"""
2026-11-25: restore punctuation the source sheets stripped from book text. DRY RUN unless `apply`.

The import sheets (staging_master_books) lost hyphens and curly apostrophes before the data reached us:
"RealWorld Cryptography", "Antoine de SaintExupéry", "a ThirteenYearOld", "selfcontained recipes",
"If you?re browsing". Pages show these as-is. This script puts the punctuation back.

SAFETY RULE: a proposed value must contain exactly the same letters and digits, in the same order and
the same case, as the stored value. Only hyphens, spaces and apostrophes may differ (`same_letters`).
So a name such as "McCarthy" or "JavaScript" can never be rewritten into something else, and no word
is ever changed. Every change is checked against that rule again right before it is written.

PHASES
  titles     Books whose title, subtitle or author contains a joined token (RealWorld, 72Hour,
             SaintExupéry) are looked up on Open Library (search API, ~3 requests/s). A field is
             changed only when an Open Library record has the same letters with the punctuation back.
             -> reports/punct_titles_plan.csv
  map        Builds a joined-word -> hyphenated-word map for descriptions from text that kept its
             hyphens (editorial fields, descriptions with hyphens, quotes, the title fixes above).
             A joined form that ever appears as a plain word in that clean text is never mapped
             (protects "online", "nonfiction", "everyday"). -> reports/punct_token_map.csv
             REVIEW THIS FILE: set the `ok` column to 0 for any wrong row before the next phase.
  desc       Applies the reviewed map (rows with ok=1) and the contraction rule
             (you?re -> you’re, Engle?s -> Engle’s) to descriptions, titles and subtitles.
             -> reports/punct_desc_plan.csv
  apply      `apply --plan FILE` writes a plan. Each row first goes to public.bak_seo_changes_20261114
             (old and new values, batch below); a row whose stored value changed since the plan was
             made is skipped. Undo: update books set <field> = old_values-><field> where id = row_id
             for the rows with this batch.

  python3 -I scripts/punctuation_repair.py titles --visible-only   # books on published pages first
  python3 -I scripts/punctuation_repair.py titles                  # then the rest (resumes, skips checked ids)
  python3 -I scripts/punctuation_repair.py map
  python3 -I scripts/punctuation_repair.py desc
  python3 -I scripts/punctuation_repair.py apply --plan reports/punct_titles_plan.csv
"""
from __future__ import annotations

import argparse
import collections
import csv
import json
import os
import re
import sys
import time
import urllib.parse

import requests

BASE = "https://ghpdpvatfmvsahzsqgpp.supabase.co/rest/v1"
H = {"apikey": "dummy", "Authorization": "Bearer dummy", "Content-Type": "application/json"}
BATCH = "punctuation_repair_20261125"
REPORTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "reports")
UA = {"User-Agent": "BookMentions-data-repair/1.0"}
FIELDS = ("title", "subtitle", "author_name", "description")

# ── the safety rule ──────────────────────────────────────────────────────────
PUNCT = re.compile(r"[\s\-‐‑–—'’]")


def same_letters(a: str, b: str) -> bool:
    """True when a and b differ only in hyphens, spaces and apostrophes."""
    return PUNCT.sub("", a or "") == PUNCT.sub("", b or "")


HYPHEN_APOS = re.compile(r"[\-\u2010\u2011\u2013\u2014'\u2019]")


def adds_only_hyphens(new: str, old: str) -> bool:
    """Stricter rule for Open Library fixes: only hyphens or apostrophes may be added; spacing must match.
    Space-only differences are refused because Open Library sometimes splits a real name
    ("StrengthsFinder" -> "Strengths Finder") and a space where a hyphen belongs is no better."""
    return new != old and HYPHEN_APOS.sub("", new or "") == HYPHEN_APOS.sub("", old or "")


# ── detection ────────────────────────────────────────────────────────────────
TOKEN = re.compile(r"[\wÀ-ɏ']+", re.UNICODE)
JOINED = re.compile(r"[a-zß-ÿ][A-ZÀ-Þ]|[0-9][A-Z][a-z]")
# Surname prefixes and given-name forms that are CamelCase on purpose (McBain, DeMille, LaVyrle,
# JoAnn, VanLiere, O'Brian). Skipping them only saves lookups; same_letters would protect them anyway.
NAME_LIKE = re.compile(r"^(Mc|Mac|De|Di|Da|Du|Le|La|Lo|Van|Von|Ter|St|Jo|Rae|Mary|Le|Ka|Ja|Ann|Lee|Bo|O'|D')[A-Z]")


def suspect_tokens(text: str) -> list[str]:
    out = []
    for t in TOKEN.findall(text or ""):
        if JOINED.search(t) and not NAME_LIKE.match(t):
            out.append(t)
    return out


CONTRACTION = re.compile(r"(?<=[A-Za-z])\?(?=(?:s|re|ve|ll|d|t|m)\b)")


def fix_contractions(text: str) -> str:
    return CONTRACTION.sub("’", text)


# ── supabase ─────────────────────────────────────────────────────────────────
def fetch_all(params: dict, page: int = 1000) -> list[dict]:
    rows, off = [], 0
    while True:
        r = requests.get(f"{BASE}/books", params={**params, "order": "id.asc", "offset": off, "limit": page}, headers=H, timeout=120)
        r.raise_for_status()
        batch = r.json()
        rows += batch
        if len(batch) < page:
            return rows
        off += page


def write_csv(path: str, rows: list[dict], cols: list[str]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {len(rows)} rows -> {path}")


# ── phase: titles ────────────────────────────────────────────────────────────
def ol_search(title: str, author: str) -> list[dict]:
    spaced = re.sub(r"([a-z])([A-Z])", r"\1 \2", title)
    spaced = re.sub(r"([0-9])([A-Z])", r"\1 \2", spaced)
    q = {"title": spaced, "fields": "title,subtitle,author_name", "limit": 10}
    if author:
        q["author"] = re.sub(r"([a-z])([A-Z])", r"\1 \2", author)
    for attempt in range(3):
        try:
            r = requests.get("https://openlibrary.org/search.json?" + urllib.parse.urlencode(q), headers=UA, timeout=30)
            if r.status_code == 200:
                return r.json().get("docs", [])
            time.sleep(2 + attempt * 3)
        except requests.RequestException:
            time.sleep(2 + attempt * 3)
    return []


def pick(ours: str, candidates: list[str]) -> str | None:
    """The first candidate with the same letters as ours but different punctuation."""
    for c in candidates:
        c = (c or "").strip()
        if c and adds_only_hyphens(c, ours):
            return c
    return None


def fetch_ids(table: str, select: str, params: dict) -> list[dict]:
    rows, off = [], 0
    while True:
        r = requests.get(f"{BASE}/{table}", params={"select": select, **params, "offset": off, "limit": 1000}, headers=H, timeout=120)
        r.raise_for_status()
        batch = r.json()
        rows += batch
        if len(batch) < 1000:
            return rows
        off += 1000


def visible_book_ids() -> set[str]:
    """Books that appear on a published page: published books, and books on published lists, people and series."""
    ids = {r["id"] for r in fetch_ids("books", "id", {"index_status": "eq.published"})}
    for parent, junction, fk in (("lists", "book_lists", "list_id"), ("people", "book_recommendations", "person_id"),
                                 ("series", "book_series", "series_id")):
        pids = [r["id"] for r in fetch_ids(parent, "id", {"index_status": "eq.published"})]
        for i in range(0, len(pids), 60):
            chunk = ",".join(pids[i:i + 60])
            ids |= {r["book_id"] for r in fetch_ids(junction, "book_id", {fk: f"in.({chunk})"})}
    return ids


def fixes_for(r: dict, docs: list[dict]) -> list[dict]:
    out = []
    for field, cands in (
        ("title", [d.get("title") for d in docs]),
        ("subtitle", [d.get("subtitle") for d in docs]),
        ("author_name", [a for d in docs for a in (d.get("author_name") or [])]),
    ):
        ours = r.get(field) or ""
        if not ours or not suspect_tokens(ours):
            continue
        new = pick(ours, cands)
        if new:
            out.append({"id": r["id"], "slug": r["slug"], "field": field, "old": ours, "new": new, "how": "open_library"})
    return out


def phase_titles(args) -> None:
    from concurrent.futures import ThreadPoolExecutor

    rows = fetch_all({
        "select": "id,slug,title,subtitle,author_name",
        "or": "(title.match.[a-z][A-Z],subtitle.match.[a-z][A-Z],author_name.match.[a-z][A-Z],"
              "title.match.[0-9][A-Z][a-z],subtitle.match.[0-9][A-Z][a-z])",
    })
    todo = [r for r in rows if any(suspect_tokens(r.get(f) or "") for f in ("title", "subtitle", "author_name"))]
    if args.visible_only:
        vis = visible_book_ids()
        todo = [r for r in todo if r["id"] in vis]
        print(f"{len(vis)} books are on published pages")
    out_path = os.path.join(REPORTS, args.out)
    done_ids: set[str] = set()
    if os.path.exists(out_path + ".checked"):       # resume: skip books already looked up
        with open(out_path + ".checked", encoding="utf-8") as fh:
            done_ids = {line.strip() for line in fh if line.strip()}
    todo = [r for r in todo if r["id"] not in done_ids]
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(rows)} rows match the pattern; {len(todo)} non-name joined tokens left to look up on Open Library")

    os.makedirs(REPORTS, exist_ok=True)
    new_file = not os.path.exists(out_path)
    cols = ["id", "slug", "field", "old", "new", "how"]
    with open(out_path, "a", newline="", encoding="utf-8") as out, open(out_path + ".checked", "a", encoding="utf-8") as chk:
        w = csv.DictWriter(out, fieldnames=cols)
        if new_file:
            w.writeheader()

        def work(r: dict):
            docs = ol_search(r["title"], r.get("author_name") or "")
            time.sleep(1.0)                          # with 4 workers: at most ~4 requests/s to Open Library
            return r, docs

        found = 0
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for i, (r, docs) in enumerate(pool.map(work, todo), 1):
                fx = fixes_for(r, docs)
                w.writerows(fx)
                found += len(fx)
                chk.write(r["id"] + "\n")
                if i % 50 == 0:
                    out.flush(); chk.flush()
                    print(f"  {i}/{len(todo)} looked up, {found} fixes", flush=True)
    print(f"done: {found} fixes appended -> {out_path}")


# ── phase: map ───────────────────────────────────────────────────────────────
WORD = re.compile(r"[A-Za-z]+(?:-[A-Za-z]+)*")


def phase_map(args) -> None:
    clean_texts: list[str] = []
    for f in ("editorial_summary", "best_for", "not_for", "key_themes"):
        clean_texts += [str(r[f]) for r in fetch_all({"select": f"id,{f}", f: "not.is.null"})]
    clean_texts += [r["description"] for r in fetch_all({"select": "id,description", "description": "match.[a-z]-[a-z]"})]
    q = requests.get(f"{BASE}/book_recommendations", params={"select": "quote", "quote": "match.[a-z]-[a-z]", "limit": 5000}, headers=H, timeout=120).json()
    clean_texts += [r["quote"] for r in q]
    title_plan = os.path.join(REPORTS, "punct_titles_plan.csv")
    if os.path.exists(title_plan):
        with open(title_plan, encoding="utf-8") as fh:
            clean_texts += [r["new"] for r in csv.DictReader(fh)]

    hyph, plain = collections.Counter(), collections.Counter()
    for t in clean_texts:
        for w in WORD.findall(t):
            lw = w.lower()
            if "-" in lw:
                parts = lw.split("-")
                if 2 <= len(parts) <= 4 and all(len(p) >= 2 for p in parts):
                    hyph[lw] += 1
            else:
                plain[lw] += 1

    # How often each joined form appears in the descriptions we would change.
    joined_of = {h.replace("-", ""): h for h in hyph}
    dirty = collections.Counter()
    for r in fetch_all({"select": "id,description", "description": "not.is.null"}):
        for w in re.findall(r"[A-Za-z]+", r["description"]):
            lw = w.lower()
            if lw in joined_of:
                dirty[lw] += 1

    out = []
    for joined, hy in joined_of.items():
        if plain.get(joined):          # a real single word in clean text: never split it
            continue
        if len(joined) < 7 or not dirty.get(joined):
            continue
        out.append({"ok": 1, "joined": joined, "hyphenated": hy, "in_descriptions": dirty[joined], "seen_hyphenated": hyph[hy]})
    out.sort(key=lambda r: -r["in_descriptions"])
    write_csv(os.path.join(REPORTS, "punct_token_map.csv"), out, ["ok", "joined", "hyphenated", "in_descriptions", "seen_hyphenated"])


# ── phase: desc ──────────────────────────────────────────────────────────────
def load_map() -> dict[str, str]:
    path = os.path.join(REPORTS, "punct_token_map.csv")
    with open(path, encoding="utf-8") as fh:
        return {r["joined"]: r["hyphenated"] for r in csv.DictReader(fh) if r["ok"].strip() == "1"}


def apply_map(text: str, m: dict[str, str]) -> str:
    def sub(mo: re.Match) -> str:
        w = mo.group(0)
        hy = m.get(w.lower())
        if not hy:
            return w
        if w.islower():
            return hy
        if w[0].isupper() and w[1:].islower():          # Recordbreaking -> Record-breaking
            return hy[0].upper() + hy[1:]
        if w.isupper():
            return hy.upper()
        # CamelCase (RecordBreaking): keep the stored capitals, add the hyphens where the map puts them.
        out, i = [], 0
        for part in hy.split("-"):
            out.append(w[i:i + len(part)])
            i += len(part)
        return "-".join(out)
    return re.sub(r"[A-Za-z]+", sub, text)


def phase_desc(args) -> None:
    m = load_map()
    print(f"{len(m)} reviewed map entries")
    plan = []
    for r in fetch_all({"select": "id,slug,title,subtitle,description"}):
        for field in ("title", "subtitle", "description"):
            ours = r.get(field)
            if not ours:
                continue
            new = apply_map(fix_contractions(ours), m)
            if new != ours and same_letters(new, fix_contractions(ours)):
                plan.append({"id": r["id"], "slug": r["slug"], "field": field, "old": ours, "new": new, "how": "map+contractions"})
    write_csv(os.path.join(REPORTS, "punct_desc_plan.csv"), plan, ["id", "slug", "field", "old", "new", "how"])


# ── phase: apply ─────────────────────────────────────────────────────────────
def _current_rows(ids: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for i in range(0, len(ids), 100):
        chunk = ",".join(ids[i:i + 100])
        r = requests.get(f"{BASE}/books", params={"select": "id,slug," + ",".join(FIELDS), "id": f"in.({chunk})"}, headers=H, timeout=120)
        r.raise_for_status()
        out.update({row["id"]: row for row in r.json()})
    return out


def _allowed(p: dict) -> bool:
    if p["how"] == "open_library":
        return adds_only_hyphens(p["new"], p["old"])
    return same_letters(p["new"], fix_contractions(p["old"]))


def phase_apply(args) -> None:
    from concurrent.futures import ThreadPoolExecutor

    with open(args.plan, encoding="utf-8") as fh:
        plan = list(csv.DictReader(fh))
    by_id: dict[str, list[dict]] = collections.defaultdict(list)
    for p in plan:
        if p["field"] not in FIELDS:
            sys.exit(f"refusing field {p['field']}")
        by_id[p["id"]].append(p)
    current = _current_rows(list(by_id))

    # Decide every row before touching anything.
    jobs, skipped = [], 0
    for rid, changes in by_id.items():
        cur = current.get(rid)
        old_v, new_v = {}, {}
        for p in changes if cur else []:
            f = p["field"]
            if (cur.get(f) or "") != p["old"] or not _allowed(p):
                continue                      # changed since the plan was made, or fails the safety rule
            old_v[f], new_v[f] = p["old"], p["new"]
        if new_v:
            jobs.append((rid, cur["slug"], old_v, new_v))
        else:
            skipped += 1
    print(f"{len(jobs)} rows to change, {skipped} skipped (stale or refused)")
    if not args.write:
        print(json.dumps({"mode": "DRY RUN", "rows_changed": 0, "would_change": len(jobs), "skipped": skipped, "batch": BATCH}))
        return

    def write(job) -> str:
        rid, slug, old_v, new_v = job
        b = requests.post(f"{BASE}/bak_seo_changes_20261114", headers={**H, "Prefer": "return=minimal"}, timeout=60,
                          json={"table_name": "books", "row_id": rid, "slug": slug, "old_values": old_v, "new_values": new_v, "batch": BATCH})
        if b.status_code not in (200, 201):
            return f"BACKUP FAILED {slug} {b.status_code} {b.text[:120]}"   # never patch without a backup row
        u = requests.patch(f"{BASE}/books", params={"id": f"eq.{rid}"}, headers={**H, "Prefer": "return=minimal"}, json=new_v, timeout=60)
        return "ok" if u.status_code in (200, 204) else f"FAILED {slug} {u.status_code} {u.text[:120]}"

    done = failed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for n, res in enumerate(pool.map(write, jobs), 1):
            if res == "ok":
                done += 1
            else:
                failed += 1
                print("  ", res)
            if n % 500 == 0:
                print(f"  {n}/{len(jobs)}", flush=True)
    print(json.dumps({"mode": "WRITE", "rows_changed": done, "skipped": skipped, "failed": failed, "batch": BATCH}))


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="phase", required=True)
    t = sub.add_parser("titles")
    t.add_argument("--limit", type=int, default=0)
    t.add_argument("--visible-only", action="store_true", help="only books that appear on a published page")
    t.add_argument("--workers", type=int, default=4)
    t.add_argument("--out", default="punct_titles_plan.csv", help="plan file under reports/ (appended to; resumable)")
    sub.add_parser("map")
    sub.add_parser("desc")
    a = sub.add_parser("apply")
    a.add_argument("--plan", required=True)
    a.add_argument("--write", action="store_true", help="without this, only counts what would change")
    a.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()
    {"titles": phase_titles, "map": phase_map, "desc": phase_desc, "apply": phase_apply}[args.phase](args)


if __name__ == "__main__":
    main()
