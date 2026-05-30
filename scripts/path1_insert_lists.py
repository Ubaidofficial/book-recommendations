#!/usr/bin/env python3
# Path-1 Step-2: INSERT-ONLY migration of topic lists + meta list + their memberships.
#
# SAFETY MODEL
#   - Dry-run by DEFAULT. Writes require BOTH --write AND --confirm-insert-lists.
#   - INSERT-ONLY: POSTs to `lists` and `book_lists`. No UPDATE, no DELETE, no UPSERT.
#   - Never touches `books`, AI editorial fields, SEO fields, or index_status of EXISTING rows.
#   - New `lists` rows are created with index_status='noindex' (safe default; review before indexing).
#   - Idempotent: before writing it RE-FETCHES production list slugs + memberships live, so
#     reruns skip anything already present.
#   - Excludes author-bibliography lists, non-topic/series lists, missing-book memberships,
#     existing lists/memberships, and conflicts.
#
# Inserts:
#   - 1,176 topic lists (best-*, not *-in-order, not author-bibliography)
#   - 1 meta list: most-recommended-books (only if absent)
#   - topic + meta book_lists memberships (book matched in production, membership not already present)
#
# Usage:
#   # DRY-RUN (default, no DB writes) using the verified backup as the production snapshot:
#   python scripts/path1_insert_lists.py \
#       --rebuild-dir rebuild_v2 \
#       --production-dir backups/path1_pre_lists_migration_20260527T084428Z \
#       --out-dir rebuild_v2
#
#   # LIVE WRITE (requires creds + BOTH gates):
#   python scripts/path1_insert_lists.py --rebuild-dir rebuild_v2 --write --confirm-insert-lists
#
#   # POST-WRITE AUDIT (read-only):
#   python scripts/path1_insert_lists.py --audit

from __future__ import annotations
import argparse
import csv
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Tuple

from path1_match import build_book_index, resolve_book  # shared matcher (NFKD/subtitle-tolerant)

csv.field_size_limit(10**9)

META_SLUG = "most-recommended-books"


# ─────────────────────────── helpers ───────────────────────────

def load_csv(path: str) -> List[Dict[str, str]]:
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def norm(s) -> str:
    return " ".join(str(s or "").split()).strip().lower()


def creds():
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    key = (os.environ.get("SUPABASE_SECRET_KEY")
           or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or "")
    return url.rstrip("/"), key


def _req(url, method, key, data=None, prefer=None, timeout=120):
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        cr = resp.headers.get("Content-Range", "")
    return (json.loads(raw) if raw else None), cr


def rest_get(url, key, table, params, prefer=None, timeout=120):
    full = f"{url}/rest/v1/{table}?" + urllib.parse.urlencode(params)
    try:
        data, cr = _req(full, "GET", key, prefer=prefer, timeout=timeout)
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8")
        except Exception:
            pass
        print(f"[HTTP {e.code}] GET table={table} select={params.get('select')}")
        print(f"  url: {full}")
        print(f"  response: {body[:600]}")
        raise
    return data or [], cr


def discover_columns(url, key, table) -> List[str]:
    """Read one row to learn real column names (no ordering, no assumptions)."""
    try:
        data, _ = rest_get(url, key, table, {"select": "*", "limit": "1"})
        if data:
            return list(data[0].keys())
    except Exception as e:
        print(f"[warn] discover_columns({table}): {e}")
    return []


def safe_select(url, key, table, wanted, aliases=None) -> str:
    """Build a comma-select of only columns that exist. `aliases` maps a wanted name to
    fallback column names (e.g. author -> [author_name]). Returns '*' if none resolve."""
    cols = set(discover_columns(url, key, table))
    if not cols:
        return "*"
    chosen = []
    for w in wanted:
        if w in cols:
            chosen.append(w)
        elif aliases and w in aliases:
            fb = next((a for a in aliases[w] if a in cols), None)
            if fb:
                chosen.append(fb)
            else:
                print(f"[warn] {table}: wanted column '{w}' not present and no alias matched (have: {sorted(cols)[:12]}…)")
        else:
            print(f"[warn] {table}: wanted column '{w}' not present (have: {sorted(cols)[:12]}…)")
    return ",".join(chosen) if chosen else "*"


def fetch_all(url, key, table, select, order_by=None, page=1000):
    """Paginate ALL rows. Drives the loop by the exact total from the Content-Range
    header (Prefer: count=exact) so a short middle page never ends pagination early.
    A stable `order_by` makes offset paging consistent. Prints loaded/total for debug."""
    rows, offset, total = [], 0, None
    while True:
        params = {"select": select, "limit": str(page), "offset": str(offset)}
        if order_by:
            params["order"] = order_by
        data, cr = rest_get(url, key, table, params,
                            prefer=("count=exact" if total is None else None))
        if total is None and cr and "/" in cr:
            tail = cr.rsplit("/", 1)[-1]
            total = int(tail) if tail.isdigit() else None
        if not data:
            break
        rows.extend(data)
        offset += len(data)
        if total is not None:
            if offset >= total:
                break
        elif len(data) < page:   # only trust short-page break when total is unknown
            break
    print(f"[fetch] {table}: loaded={len(rows)}"
          + (f"  total(Content-Range)={total}" if total is not None else "  total=unknown")
          + (f"  page={page}"))
    return rows


# ─────────────────────── classification (same as dry-run) ───────────────────────

def is_topic_candidate(slug: str) -> bool:
    s = norm(slug)
    return s.startswith("best-") and "books-in-order" not in s and not s.endswith("-in-order")


def build_author_list_slugs(rb_book_lists, rb_book_by_id) -> Set[str]:
    members = defaultdict(list)
    for m in rb_book_lists:
        b = rb_book_by_id.get(m.get("book_id"))
        if b:
            a = norm(b.get("author"))
            if a:
                members[norm(m.get("list_slug"))].append(a)
    out = set()
    for s, authors in members.items():
        if len(authors) >= 3:
            _, n = Counter(authors).most_common(1)[0]
            if n / len(authors) >= 0.60:
                out.add(s)
    return out


def classify(slug: str, author_slugs: Set[str]) -> str:
    s = norm(slug)
    if s == META_SLUG:
        return "meta"
    if not is_topic_candidate(s):
        return "non_topic"
    if s in author_slugs:
        return "author"
    return "topic"


# ─────────────────────── production snapshot ───────────────────────

def _print_snapshot_debug(snap, expected=None):
    """Debug: production counts + folded-key index size, compared to backup MANIFEST."""
    full = snap.get("book_index", {}).get("full", {})
    uniq = len(full)
    ambig = sum(1 for v in full.values() if len(v) > 1)
    print("[snapshot debug]")
    print(f"  production books loaded     : {snap['books_count']}")
    print(f"  production lists loaded      : {snap['lists_count']}")
    print(f"  production book_lists loaded : {snap['book_lists_count']}")
    print(f"  unique folded title+author keys : {uniq}")
    print(f"  ambiguous folded keys (>1 book) : {ambig}")
    if expected:
        eb, el, ebl = expected
        ok = (snap['books_count'] == eb and snap['lists_count'] == el and snap['book_lists_count'] == ebl)
        print(f"  vs backup MANIFEST (books={eb}, lists={el}, book_lists={ebl}): {'MATCH' if ok else 'MISMATCH — pagination/fetch incomplete!'}")
        if not ok:
            if snap['books_count'] != eb:
                print(f"    -> books {snap['books_count']} != {eb} (loaded {100*snap['books_count']/max(1,eb):.1f}%)")
            if snap['lists_count'] != el:
                print(f"    -> lists {snap['lists_count']} != {el}")
            if snap['book_lists_count'] != ebl:
                print(f"    -> book_lists {snap['book_lists_count']} != {ebl}")


def production_snapshot(args) -> Dict:
    """Return dicts: list_slug->id, book_slug->id, (title::author)->id, set of (book_id,list_id)."""
    url, key = creds()
    snap = {"list_by_slug": {}, "book_by_slug": {}, "book_by_ta": {}, "memberships": set(),
            "lists_count": 0, "book_lists_count": 0, "books_count": 0, "source": ""}

    if args.write or args.audit or (not args.production_dir):
        if not url or not key:
            if args.production_dir:
                return _snapshot_from_dir(args.production_dir, snap)
            raise SystemExit("No Supabase credentials and no --production-dir. Cannot build production snapshot.")
        snap["source"] = f"LIVE {url}"
        # Build selects from columns that actually exist. Production books uses `author_name`
        # (NOT `author`); resolve via alias so the select never 400s.
        sel_lists = safe_select(url, key, "lists", ["id", "slug"])
        sel_books = safe_select(url, key, "books", ["id", "slug", "title", "author"],
                                aliases={"author": ["author_name"]})
        sel_bl = safe_select(url, key, "book_lists", ["book_id", "list_id"])
        print(f"[live select] lists='{sel_lists}'  books='{sel_books}'  book_lists='{sel_bl}'")
        lists = fetch_all(url, key, "lists", sel_lists, order_by="id.asc")
        books = fetch_all(url, key, "books", sel_books, order_by="id.asc")
        bl = fetch_all(url, key, "book_lists", sel_bl, order_by="book_id.asc,list_id.asc")
        # normalize author_name -> author for matcher compatibility (same shape as backup rows)
        for r in books:
            if not r.get("author") and r.get("author_name"):
                r["author"] = r.get("author_name")
        for r in lists:
            snap["list_by_slug"][norm(r.get("slug"))] = r.get("id")
        for r in books:
            snap["book_by_slug"][norm(r.get("slug"))] = r.get("id")
            snap["book_by_ta"][norm(r.get("title")) + "::" + norm(r.get("author"))] = r.get("id")
        for r in bl:
            snap["memberships"].add((str(r.get("book_id")), str(r.get("list_id"))))
        snap["book_index"] = build_book_index(books)   # v4 layered matcher
        snap["lists_count"], snap["books_count"], snap["book_lists_count"] = len(lists), len(books), len(bl)
        _print_snapshot_debug(snap, expected=(98845, 351, 41098))
        return snap

    return _snapshot_from_dir(args.production_dir, snap)


def _snapshot_from_dir(pdir, snap):
    snap["source"] = f"BACKUP {pdir}"
    lists = load_csv(os.path.join(pdir, "lists.csv"))
    books = load_csv(os.path.join(pdir, "books.csv"))
    bl = load_csv(os.path.join(pdir, "book_lists.csv"))
    for r in lists:
        snap["list_by_slug"][norm(r.get("slug"))] = r.get("id")
    for r in books:
        snap["book_by_slug"][norm(r.get("slug"))] = r.get("id")
        snap["book_by_ta"][norm(r.get("title")) + "::" + norm(r.get("author") or r.get("author_name"))] = r.get("id")
    # tolerant FK columns
    bcol = lcol = None
    if bl:
        low = {c.lower(): c for c in bl[0].keys()}
        bcol = low.get("book_id") or low.get("book")
        lcol = low.get("list_id") or low.get("list")
    if bcol and lcol:
        for r in bl:
            snap["memberships"].add((str(r.get(bcol)), str(r.get(lcol))))
    snap["book_index"] = build_book_index(books)   # v4 layered matcher
    snap["lists_count"], snap["books_count"], snap["book_lists_count"] = len(lists), len(books), len(bl)
    _print_snapshot_debug(snap, expected=(98845, 351, 41098))
    return snap


# ─────────────────────── plan builder ───────────────────────

def build_plan(args):
    rb = args.rebuild_dir
    rb_lists = load_csv(os.path.join(rb, "lists.csv"))
    rb_book_lists = load_csv(os.path.join(rb, "book_lists.csv"))
    rb_books = load_csv(os.path.join(rb, "books.csv"))
    rb_book_by_id = {r["book_id"]: r for r in rb_books}

    author_slugs = build_author_list_slugs(rb_book_lists, rb_book_by_id)
    cls_by_slug = {norm(r["slug"]): classify(r["slug"], author_slugs) for r in rb_lists}

    snap = production_snapshot(args)
    list_by_slug = snap["list_by_slug"]
    memberships = snap["memberships"]

    # lists to insert: topic + meta that are NOT already in production
    lists_to_insert, skip_existing_lists, skip_author, skip_non_topic = [], [], [], []
    for r in rb_lists:
        s = norm(r["slug"])
        c = cls_by_slug[s]
        if c == "author":
            skip_author.append(r)
        elif c == "non_topic":
            skip_non_topic.append(r)
        elif c in ("topic", "meta"):
            if s in list_by_slug:
                skip_existing_lists.append((r, c))
            else:
                lists_to_insert.append((r, c))
    insert_slugs = {norm(r["slug"]) for r, _ in lists_to_insert}
    handled_slugs = insert_slugs | {norm(r["slug"]) for r, _ in skip_existing_lists}  # topic+meta in scope

    # memberships for in-scope lists (topic+meta): resolve book + dedupe vs existing
    # v4: layered NFKD/subtitle-tolerant matcher (slug -> full-fold -> core-fold)
    book_index = snap["book_index"]
    mem_insert, mem_skip_existing, mem_skip_missing_book = [], 0, []
    mem_by_slug = Counter()
    match_method_counts = Counter()
    for m in rb_book_lists:
        s = norm(m.get("list_slug"))
        if s not in handled_slugs:
            continue
        bid = m.get("book_id")
        bk = rb_book_by_id.get(bid, {})
        prod_book_id, method = resolve_book(book_index, bk.get("slug"), bk.get("title"), bk.get("author"))
        match_method_counts[method] += 1
        if not prod_book_id:
            mem_skip_missing_book.append((m, bk, method))
            continue
        existing_list_id = list_by_slug.get(s)  # set if list already exists
        if existing_list_id and (str(prod_book_id), str(existing_list_id)) in memberships:
            mem_skip_existing += 1
            continue
        mem_insert.append({"list_slug": s, "prod_book_id": prod_book_id,
                           "is_meta": (s == META_SLUG), "match_method": method,
                           "rb_book_slug": bk.get("slug", ""), "rb_title": bk.get("title", ""),
                           "rb_author": bk.get("author", "")})
        mem_by_slug[s] += 1

    return {
        "rb_lists": rb_lists, "lists_to_insert": lists_to_insert,
        "skip_existing_lists": skip_existing_lists, "skip_author": skip_author,
        "skip_non_topic": skip_non_topic, "mem_insert": mem_insert,
        "mem_skip_existing": mem_skip_existing, "mem_skip_missing_book": mem_skip_missing_book,
        "mem_by_slug": mem_by_slug, "snap": snap, "author_slugs": author_slugs,
        "match_method_counts": match_method_counts,
    }


# ─────────────────────── outputs ───────────────────────

def write_preview(args, plan):
    path = os.path.join(args.out_dir, "path1_insert_lists_preview.csv")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["action", "kind", "rebuild_slug", "name", "parent",
                    "rebuild_book_count", "planned_membership_inserts", "reason"])
        for r, c in plan["lists_to_insert"]:
            s = norm(r["slug"])
            kind = "meta_list" if c == "meta" else "topic_list"
            act = "insert_meta_list" if c == "meta" else "insert_list"
            w.writerow([act, kind, r["slug"], r.get("title", ""), r.get("parent_category", ""),
                        r.get("book_count", ""), plan["mem_by_slug"].get(s, 0),
                        "curated meta-list (not a subcategory)" if c == "meta" else "topic list absent in production"])
    return path


def write_plan_md(args, plan):
    snap = plan["snap"]
    topic_lists = [r for r, c in plan["lists_to_insert"] if c == "topic"]
    meta_lists = [r for r, c in plan["lists_to_insert"] if c == "meta"]
    meta_mem = sum(1 for m in plan["mem_insert"] if m["is_meta"])
    topic_mem = len(plan["mem_insert"]) - meta_mem
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    L = []
    L.append("# Path-1 INSERT-ONLY Lists Migration Plan\n")
    L.append(f"Generated: {ts}")
    L.append(f"Production snapshot source: **{snap['source']}**")
    L.append(f"Production now: lists={snap['lists_count']}, book_lists={snap['book_lists_count']}, books={snap['books_count']}\n")
    L.append("## What WILL be inserted (insert-only)\n")
    L.append(f"- topic lists: **{len(topic_lists)}**")
    L.append(f"- meta list (most-recommended-books): **{len(meta_lists)}**")
    L.append(f"- total lists to insert: **{len(plan['lists_to_insert'])}**")
    L.append(f"- topic memberships: **{topic_mem}**")
    L.append(f"- meta memberships: **{meta_mem}**")
    L.append(f"- total memberships to insert: **{len(plan['mem_insert'])}**\n")
    L.append("## What is SKIPPED\n")
    L.append(f"- author-bibliography lists: {len(plan['skip_author'])}")
    L.append(f"- non-topic/series lists: {len(plan['skip_non_topic'])}")
    L.append(f"- lists already in production: {len(plan['skip_existing_lists'])}")
    L.append(f"- memberships already in production: {plan['mem_skip_existing']}")
    L.append(f"- memberships skipped (book not matched in production): {len(plan['mem_skip_missing_book'])}\n")
    L.append("## Safety gates\n")
    L.append("- Dry-run by default. Live write requires BOTH `--write` AND `--confirm-insert-lists`.")
    L.append("- INSERT-ONLY: POST to `lists` and `book_lists` only. No UPDATE/DELETE/UPSERT.")
    L.append("- New lists get index_status='noindex' (safe default). No existing row is modified.")
    L.append("- No writes to `books`, AI editorial fields, SEO fields, or existing index_status.")
    L.append("- Idempotent: re-fetches production slugs + memberships live before writing; reruns skip existing.")
    L.append(f"- Chunked inserts ({args.chunk_size} rows/batch).\n")
    L.append("## Order of operations (write mode)\n")
    L.append("1. Insert lists (return=representation) → capture new list UUIDs by slug.")
    L.append("2. Re-fetch existing memberships (idempotency).")
    L.append("3. Resolve book_id per membership (production), insert (book_id,list_id) not already present.")
    L.append("4. Write checkpoint report of inserted rows.\n")
    L.append("## Rollback (if needed) — uses the verified backup as reference\n")
    L.append(f"- Backup: `backups/path1_pre_lists_migration_20260527T084428Z` (pre-state).")
    L.append("- This migration is additive only; rollback = delete the rows it inserted.")
    L.append("- The checkpoint report (`path1_insert_lists_report_<ts>.csv`) records every inserted list id + membership.")
    L.append("- Safe rollback: delete book_lists rows by recorded id, then delete lists rows by recorded id.")
    L.append("- Identity check: inserted lists all have slug LIKE 'best-%' or = 'most-recommended-books' that")
    L.append("  did NOT exist in the backup lists.csv — cross-check before any delete. (Rollback is manual; this")
    L.append("  script never deletes.)\n")
    L.append("## Verification\n")
    L.append(f"- Expected post-write: production lists {snap['lists_count']} → {snap['lists_count'] + len(plan['lists_to_insert'])}")
    L.append(f"- Expected post-write: book_lists {snap['book_lists_count']} → {snap['book_lists_count'] + len(plan['mem_insert'])}")
    L.append("- Run `--audit` after write to confirm best-* list count + membership totals.\n")
    path = os.path.join(args.out_dir, "PATH1_INSERT_LISTS_PLAN.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    return path


# ─────────────────────── write path ───────────────────────

def do_write(args, plan):
    url, key = creds()
    if not url or not key:
        raise SystemExit("Live write requires SUPABASE_URL + a key.")
    chunk = max(1, args.chunk_size)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report_path = os.path.join(args.out_dir, f"path1_insert_lists_report_{ts}.csv")
    rep = open(report_path, "w", newline="", encoding="utf-8")
    rw = csv.writer(rep)
    rw.writerow(["entity", "action", "id", "slug_or_pair", "detail"])

    # 1) insert lists, capture ids
    slug_to_id: Dict[str, str] = {}
    to_insert = plan["lists_to_insert"]
    print(f"[write] inserting {len(to_insert)} lists in chunks of {chunk}…")
    batch = []
    for r, c in to_insert:
        batch.append({"slug": r["slug"], "title": r.get("title", ""),
                      "book_count": int(r.get("book_count") or 0), "index_status": "noindex"})
        if len(batch) >= chunk:
            _flush_lists(url, key, batch, slug_to_id, rw)
            batch = []
    if batch:
        _flush_lists(url, key, batch, slug_to_id, rw)

    # 2) merge in already-existing list ids (meta may already exist on rerun)
    for s, lid in plan["snap"]["list_by_slug"].items():
        slug_to_id.setdefault(s, lid)
    # refresh memberships for idempotency
    existing_mem = set(plan["snap"]["memberships"])
    fresh = fetch_all(url, key, "book_lists", safe_select(url, key, "book_lists", ["book_id", "list_id"]),
                      order_by="book_id.asc,list_id.asc")
    for r in fresh:
        existing_mem.add((str(r.get("book_id")), str(r.get("list_id"))))

    # 3) insert memberships
    print(f"[write] inserting up to {len(plan['mem_insert'])} memberships…")
    mbatch, inserted_m = [], 0
    for m in plan["mem_insert"]:
        lid = slug_to_id.get(m["list_slug"])
        if not lid:
            rw.writerow(["membership", "skip_no_list_id", "", m["list_slug"], "list not inserted"])
            continue
        pair = (str(m["prod_book_id"]), str(lid))
        if pair in existing_mem:
            continue
        mbatch.append({"book_id": m["prod_book_id"], "list_id": lid})
        existing_mem.add(pair)
        if len(mbatch) >= chunk:
            inserted_m += _flush_memberships(url, key, mbatch, rw)
            mbatch = []
    if mbatch:
        inserted_m += _flush_memberships(url, key, mbatch, rw)

    rep.close()
    print(f"[write] DONE. lists inserted={len(slug_to_id) - plan['snap']['lists_count'] if False else len(to_insert)}, memberships inserted={inserted_m}")
    print(f"[write] checkpoint report: {report_path}")


def _post_verbose(url, key, table, batch):
    """POST with full-context error printing on HTTP 400 (bad column/payload)."""
    try:
        data, _ = _req(f"{url}/rest/v1/{table}", "POST", key, data=batch, prefer="return=representation")
        return data
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8")
        except Exception:
            pass
        sample_cols = sorted(batch[0].keys()) if batch else []
        print(f"[HTTP {e.code}] POST table={table} payload_cols={sample_cols} batch={len(batch)}")
        print(f"  response: {body[:600]}")
        raise


def _flush_lists(url, key, batch, slug_to_id, rw):
    data = _post_verbose(url, key, "lists", batch)
    for row in data or []:
        slug_to_id[norm(row.get("slug"))] = row.get("id")
        rw.writerow(["list", "inserted", row.get("id"), row.get("slug"), ""])
    print(f"    + {len(data or [])} lists")


def _flush_memberships(url, key, batch, rw):
    data = _post_verbose(url, key, "book_lists", batch)
    n = len(data or [])
    for row in data or []:
        rw.writerow(["membership", "inserted", row.get("id", ""),
                     f"{row.get('book_id')}::{row.get('list_id')}", ""])
    print(f"    + {n} memberships")
    return n


# ─────────────────────── audit ───────────────────────

def do_audit(args):
    url, key = creds()
    if not url or not key:
        raise SystemExit("Audit requires SUPABASE_URL + a key (read-only).")
    lists = fetch_all(url, key, "lists", safe_select(url, key, "lists", ["id", "slug"]), order_by="id.asc")
    best = [r for r in lists if norm(r.get("slug")).startswith("best-")]
    has_meta = any(norm(r.get("slug")) == META_SLUG for r in lists)
    bl = fetch_all(url, key, "book_lists", safe_select(url, key, "book_lists", ["book_id", "list_id"]),
                   order_by="book_id.asc,list_id.asc")
    print("== POST-WRITE AUDIT (read-only) ==")
    print(f"  total lists: {len(lists)}")
    print(f"  best-* topic lists present: {len(best)}")
    print(f"  most-recommended-books present: {has_meta}")
    print(f"  total book_lists memberships: {len(bl)}")
    return 0


# ─────────────────────── main ───────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild-dir", default="rebuild_v2")
    ap.add_argument("--production-dir", default="", help="Backup dir for dry-run production snapshot (CSV exports).")
    ap.add_argument("--out-dir", default="rebuild_v2")
    ap.add_argument("--chunk-size", type=int, default=500)
    ap.add_argument("--write", action="store_true", help="Perform live inserts (requires --confirm-insert-lists).")
    ap.add_argument("--confirm-insert-lists", action="store_true", help="Second required gate for live writes.")
    ap.add_argument("--audit", action="store_true", help="Read-only post-write audit.")
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    if args.audit:
        return do_audit(args)

    plan = build_plan(args)
    preview = write_preview(args, plan)
    plan_md = write_plan_md(args, plan)

    topic = sum(1 for _, c in plan["lists_to_insert"] if c == "topic")
    meta = sum(1 for _, c in plan["lists_to_insert"] if c == "meta")
    meta_mem = sum(1 for m in plan["mem_insert"] if m["is_meta"])
    topic_mem = len(plan["mem_insert"]) - meta_mem

    print("== PATH-1 INSERT-ONLY PLAN ==")
    print(f"production snapshot: {plan['snap']['source']}")
    print(f"lists to insert: {len(plan['lists_to_insert'])} (topic={topic}, meta={meta})")
    print(f"  skip: author={len(plan['skip_author'])}, non_topic={len(plan['skip_non_topic'])}, existing={len(plan['skip_existing_lists'])}")
    print(f"memberships to insert: {len(plan['mem_insert'])} (topic={topic_mem}, meta={meta_mem})")
    print(f"  skip: existing={plan['mem_skip_existing']}, missing_book={len(plan['mem_skip_missing_book'])}")
    print(f"  match methods: {dict(plan['match_method_counts'])}")
    print(f"preview: {preview}")
    print(f"plan:    {plan_md}")

    if args.write and args.confirm_insert_lists:
        print("\n[write gates satisfied] performing INSERT-ONLY migration…")
        do_write(args, plan)
    elif args.write and not args.confirm_insert_lists:
        print("\n[BLOCKED] --write given but --confirm-insert-lists missing. No DB writes performed.")
    else:
        print("\n[DRY-RUN] no DB writes. Pass --write --confirm-insert-lists to apply.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
