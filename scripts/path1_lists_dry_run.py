#!/usr/bin/env python3
# Path-1 migration: lists + book_lists DRY-RUN diff. Produces CSVs + a report.
# Makes NO DB writes and NO Supabase mutations. Reads only local CSVs.
#
# Production side comes from a --production-dir of CSV exports (produced by
# scripts/path1_backup_tables.py): expects lists.csv, book_lists.csv, books.csv there.
# If --production-dir is omitted, runs in OFFLINE CANDIDATE mode: production is treated
# as unknown, every topic list/membership is a candidate insert flagged "production_unverified".
#
# Topic-list filter (Step-2 scope):
#   include slug starting with "best-"
#   exclude slug containing "books-in-order" or ending "-in-order"
#
# Usage:
#   python scripts/path1_lists_dry_run.py --rebuild-dir rebuild_v2 --out-dir rebuild_v2
#   python scripts/path1_lists_dry_run.py --rebuild-dir rebuild_v2 --production-dir backups/path1_pre_lists_migration_XXXX --out-dir rebuild_v2

from __future__ import annotations
import argparse
import csv
import os
import re
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Set, Tuple

from path1_match import build_book_index, resolve_book, fold, strip_subtitle  # shared matcher

csv.field_size_limit(10**9)


def load_csv(path: str) -> List[Dict[str, str]]:
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def is_topic_slug(slug: str) -> bool:
    s = (slug or "").strip().lower()
    if not s.startswith("best-"):
        return False
    if "books-in-order" in s or s.endswith("-in-order"):
        return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild-dir", default="rebuild_v2")
    ap.add_argument("--production-dir", default="")
    ap.add_argument("--out-dir", default="rebuild_v2")
    args = ap.parse_args()

    rb = args.rebuild_dir
    out = args.out_dir
    os.makedirs(out, exist_ok=True)

    rb_lists = load_csv(os.path.join(rb, "lists.csv"))
    rb_book_lists = load_csv(os.path.join(rb, "book_lists.csv"))
    rb_books = load_csv(os.path.join(rb, "books.csv"))

    # ---- production side ----
    prod_mode = bool(args.production_dir)
    prod_lists = load_csv(os.path.join(args.production_dir, "lists.csv")) if prod_mode else []
    prod_books = load_csv(os.path.join(args.production_dir, "books.csv")) if prod_mode else []
    prod_book_lists = load_csv(os.path.join(args.production_dir, "book_lists.csv")) if prod_mode else []

    prod_list_by_slug: Dict[str, Dict] = {}
    for r in prod_lists:
        s = norm(r.get("slug"))
        if s:
            prod_list_by_slug[s] = r
    # OLD-style maps (lowercase+whitespace only) kept for before/after comparison
    prod_book_by_slug: Dict[str, Dict] = {}
    prod_book_by_titleauthor: Dict[str, Dict] = {}
    for r in prod_books:
        s = norm(r.get("slug"))
        if s:
            prod_book_by_slug[s] = r
        ta = norm(r.get("title")) + "::" + norm(r.get("author") or r.get("author_name"))
        prod_book_by_titleauthor[ta] = r
    # v4: NFKD/diacritic/subtitle-tolerant index (layered slug -> full-fold -> core-fold)
    book_index = build_book_index(prod_books)
    # tolerant detection of the FK column names in production book_lists
    def _find_key(rows: List[Dict[str, str]], candidates: List[str]) -> Optional[str]:
        if not rows:
            return None
        cols = {c.lower(): c for c in rows[0].keys()}
        for cand in candidates:
            if cand in cols:
                return cols[cand]
        return None

    bl_book_key = _find_key(prod_book_lists, ["book_id", "book", "bookid", "book_uuid"])
    bl_list_key = _find_key(prod_book_lists, ["list_id", "list", "listid", "list_uuid"])
    if prod_mode and prod_book_lists and (not bl_book_key or not bl_list_key):
        print(f"[warn] could not detect book/list FK columns in production book_lists "
              f"(headers: {list(prod_book_lists[0].keys())}). Membership skip-detection disabled.")
    prod_membership: Set[Tuple[str, str]] = set()
    if bl_book_key and bl_list_key:
        for r in prod_book_lists:
            prod_membership.add((str(r.get(bl_book_key)), str(r.get(bl_list_key))))

    rb_book_by_id = {r["book_id"]: r for r in rb_books}

    # ---- v3: classify every rebuild list into topic / author / meta / non_topic ----
    # author-bibliography detection: >=60% of a list's members share one author, >=3 members
    list_member_authors: Dict[str, List[str]] = defaultdict(list)
    for m in rb_book_lists:
        s = norm(m.get("list_slug"))
        b = rb_book_by_id.get(m.get("book_id"))
        if b:
            a = norm(b.get("author"))
            if a:
                list_member_authors[s].append(a)
    author_list_slugs: Dict[str, Tuple[str, float, int]] = {}
    for s, authors in list_member_authors.items():
        if len(authors) >= 3:
            top, n = Counter(authors).most_common(1)[0]
            share = n / len(authors)
            if share >= 0.60:
                author_list_slugs[s] = (top, share, len(authors))

    META_SLUG = "most-recommended-books"

    def classify_list(slug: str) -> str:
        s = norm(slug)
        if s == META_SLUG:
            return "meta"
        if not s.startswith("best-"):
            return "non_topic"
        if "books-in-order" in s or s.endswith("-in-order"):
            return "non_topic"
        if s in author_list_slugs:
            return "author"
        return "topic"

    cls_by_slug = {norm(r["slug"]): classify_list(r["slug"]) for r in rb_lists}
    topic_lists = [r for r in rb_lists if cls_by_slug.get(norm(r["slug"])) == "topic"]
    author_lists = [r for r in rb_lists if cls_by_slug.get(norm(r["slug"])) == "author"]
    meta_lists = [r for r in rb_lists if cls_by_slug.get(norm(r["slug"])) == "meta"]
    non_topic_lists = [r for r in rb_lists if cls_by_slug.get(norm(r["slug"])) == "non_topic"]
    topic_slugs = {norm(r["slug"]) for r in topic_lists}
    meta_slugs = {norm(r["slug"]) for r in meta_lists}
    insertable_slugs = topic_slugs | meta_slugs  # author + non_topic are excluded from inserts

    # =====================================================================
    # Task 3 — lists dry-run
    # =====================================================================
    list_rows = []
    counts = Counter()
    planned_list_id = {}
    for i, r in enumerate(topic_lists + meta_lists, 1):
        planned_list_id[norm(r["slug"])] = f"PLANNED_list_{i:05d}"

    for r in rb_lists:
        slug = norm(r.get("slug"))
        cls = cls_by_slug.get(slug)
        base = [r.get("list_id", ""), r.get("slug", ""), r.get("title", ""),
                r.get("parent_category", ""), r.get("book_count", "")]

        if cls == "non_topic":
            counts["skip_non_topic"] += 1
            list_rows.append(["skip_non_topic"] + base + ["", "", "non-topic (series/*-in-order page or non-best-* list)"])
            continue
        if cls == "author":
            top, share, members = author_list_slugs[slug]
            counts["skip_author_list"] += 1
            list_rows.append(["skip_author_list"] + base + ["", "",
                              f"author-bibliography list excluded from first topic migration (dominant author~{int(share*100)}% over {members} members) — belongs under author/person pages"])
            continue

        p = prod_list_by_slug.get(slug) if prod_mode else None
        if cls == "meta":
            if p:
                counts["skip_existing_meta"] += 1
                list_rows.append(["skip_existing_meta"] + base + [p.get("id", ""), p.get("slug", ""),
                                  "curated meta-list already exists in production — only missing memberships will be added"])
            else:
                counts["insert_meta_list"] += 1
                list_rows.append(["insert_meta_list"] + base + ["", planned_list_id.get(slug, ""),
                                  "curated/meta list (NOT a Fiction/Nonfiction subcategory) — manual include per decision"])
            continue

        # cls == "topic"
        if prod_mode:
            if p:
                if norm(p.get("title")) != norm(r.get("title")):
                    counts["conflict"] += 1
                    list_rows.append(["conflict"] + base + [p.get("id", ""), p.get("slug", ""),
                                      f"slug exists; production title='{p.get('title')}' differs — prefer production, do not auto-overwrite"])
                else:
                    counts["skip_existing"] += 1
                    list_rows.append(["skip_existing"] + base + [p.get("id", ""), p.get("slug", ""), "slug already in production"])
            else:
                counts["insert_list"] += 1
                list_rows.append(["insert_list"] + base + ["", planned_list_id.get(slug, ""), "topic list not in production — safe insert"])
        else:
            counts["insert_list"] += 1
            list_rows.append(["insert_list"] + base + ["", planned_list_id.get(slug, ""),
                              "candidate insert — production NOT accessed this session"])

    with open(os.path.join(out, "migration_dry_run_lists_v2.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["action", "rebuild_list_id", "rebuild_slug", "rebuild_name",
                    "rebuild_parent", "rebuild_book_count", "production_list_id",
                    "production_slug", "reason"])
        w.writerows(list_rows)

    # =====================================================================
    # Task 4 — book_lists dry-run (topic + meta memberships)
    # =====================================================================
    bl_rows = []
    bl_counts = Counter()
    topic_membership_count = Counter()   # per topic list slug
    meta_membership_inserts = 0
    # v4: matching instrumentation (before vs after)
    match_method_counts = Counter()      # slug / full_fold / core_fold / *_ambiguous / missing
    old_missing = 0                      # would-be missing under OLD lowercase-only matcher
    new_missing = 0                      # missing under NEW layered matcher
    ambiguous_rows = []                  # refused due to >1 candidate
    ambiguous_total = 0                  # all memberships refused as ambiguous by NEW matcher
    ambiguous_old_blind = 0              # ambiguous now-refused that OLD matcher blindly accepted
    recovered_books = Counter()          # title -> times recovered (new match where old failed)

    for m in rb_book_lists:
        slug = norm(m.get("list_slug"))
        bid = m.get("book_id", "")
        cls = cls_by_slug.get(slug)
        if cls == "non_topic":
            bl_counts["skip_non_topic_list"] += 1   # renamed from skip_missing_list
            continue
        if cls == "author":
            bl_counts["skip_author_list"] += 1       # excluded author-bibliography membership
            continue
        # cls in (topic, meta) -> in scope for this migration
        is_meta = (cls == "meta")
        if not is_meta:
            topic_membership_count[slug] += 1
        bk = rb_book_by_id.get(bid, {})
        rb_slug = bk.get("slug", "")
        rb_title = bk.get("title", "")
        rb_author = bk.get("author", "")
        insert_action = "insert_meta_membership" if is_meta else "insert_membership"
        if not bk:
            bl_counts["skip_missing_book"] += 1
            bl_rows.append(["skip_missing_book", bid, rb_slug, rb_title, rb_author, "",
                            slug, "", "rebuild book_id not found in books.csv"])
            continue
        if prod_mode:
            pl = prod_list_by_slug.get(slug)
            plist_id = (pl or {}).get("id", planned_list_id.get(slug, ""))
            # OLD matcher result (lowercase+whitespace only) — for before/after delta
            old_pb = prod_book_by_slug.get(norm(rb_slug)) or prod_book_by_titleauthor.get(norm(rb_title) + "::" + norm(rb_author))
            old_hit = bool(old_pb)
            # NEW layered matcher
            new_id, method = resolve_book(book_index, rb_slug, rb_title, rb_author)
            match_method_counts[method] += 1
            if not old_hit:
                old_missing += 1
            if not new_id:
                new_missing += 1
                if "ambiguous" in method:
                    ambiguous_total += 1
                    if old_hit:
                        ambiguous_old_blind += 1   # old matcher blindly accepted this; new refuses
                    if len(ambiguous_rows) < 50:
                        ambiguous_rows.append((rb_title, rb_author, slug, method))
                bl_counts["skip_missing_book"] += 1
                bl_rows.append(["skip_missing_book", bid, rb_slug, rb_title, rb_author, "",
                                slug, plist_id, f"no production book match ({method})"])
                continue
            if not old_hit:   # NEW matcher recovered a book the OLD one missed
                recovered_books[rb_title] += 1
            if pl and (str(new_id), str(pl.get("id"))) in prod_membership:
                bl_counts["skip_existing"] += 1
                bl_rows.append(["skip_existing", bid, rb_slug, rb_title, rb_author, new_id,
                                slug, plist_id, f"membership already exists in production ({method})"])
            else:
                bl_counts[insert_action] += 1
                if is_meta:
                    meta_membership_inserts += 1
                bl_rows.append([insert_action, bid, rb_slug, rb_title, rb_author, new_id,
                                slug, plist_id, f"new {'meta' if is_meta else 'topic'} membership ({method})"])
        else:
            bl_counts[insert_action] += 1
            if is_meta:
                meta_membership_inserts += 1
            bl_rows.append([insert_action, bid, rb_slug, rb_title, rb_author, "",
                            slug, planned_list_id.get(slug, ""),
                            "candidate membership — production NOT accessed this session"])

    with open(os.path.join(out, "migration_dry_run_book_lists_v2.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["action", "rebuild_book_id", "rebuild_book_slug", "rebuild_book_title",
                    "rebuild_book_author", "production_book_id", "rebuild_list_slug",
                    "production_or_planned_list_id", "reason"])
        w.writerows(bl_rows)

    # =====================================================================
    # Task 5 — report
    # =====================================================================
    shoe = next((b for b in rb_books if norm(b.get("slug")) == "shoe-dog"), None)
    shoe_lists = []
    if shoe:
        sid = shoe["book_id"]
        for m in rb_book_lists:
            if m.get("book_id") == sid and norm(m.get("list_slug")) in topic_slugs:
                shoe_lists.append(m.get("list_slug"))

    top30 = topic_membership_count.most_common(30)
    parent_split = Counter(r.get("parent_category", "Unknown") for r in topic_lists)
    topic_insert = counts.get("insert_list", 0)
    meta_insert = counts.get("insert_meta_list", 0)

    rep = []
    rep.append("# Path-1 Lists Dry-Run Report (Step-0 backup + Step-2 lists) — topic-only v3\n")
    rep.append(f"Source: `{rb}/` (rebuild_v2). Production: "
               + (f"`{args.production_dir}`" if prod_mode else "**NOT ACCESSED — offline candidate mode**") + "\n")
    rep.append("## Production counts\n")
    if prod_mode:
        rep.append(f"- production lists: {len(prod_lists)}")
        rep.append(f"- production book_lists: {len(prod_book_lists)}")
        rep.append(f"- production books: {len(prod_books)}\n")
    else:
        rep.append("- production: **unknown** (no DB access this session)\n")
    rep.append("## rebuild_v2 list classification\n")
    rep.append(f"- total rebuild lists: {len(rb_lists)}")
    rep.append(f"- **topic lists (insertable): {len(topic_lists)}**")
    rep.append(f"- author-bibliography lists (SKIPPED this migration): {len(author_lists)}")
    rep.append(f"- meta/curated lists (most-recommended-books): {len(meta_lists)}")
    rep.append(f"- non-topic/series lists (SKIPPED): {len(non_topic_lists)}")
    rep.append(f"- topic parent split: {dict(parent_split)}\n")
    rep.append("## Lists diff (migration_dry_run_lists_v2.csv)\n")
    for k, v in counts.most_common():
        rep.append(f"- {k}: {v}")
    rep.append("")
    rep.append("## book_lists diff (migration_dry_run_book_lists_v2.csv)\n")
    for k, v in bl_counts.most_common():
        rep.append(f"- {k}: {v}")
    rep.append(f"- (of inserts above, meta memberships = {meta_membership_inserts}; "
               f"topic memberships = {bl_counts.get('insert_membership', 0)})")
    rep.append("")
    if prod_mode:
        recovered_gross = sum(recovered_books.values())
        net = old_missing - new_missing
        rep.append("## Book-matching improvement (v4: NFKD/diacritic/subtitle-tolerant)\n")
        rep.append(f"- skip_missing_book BEFORE (lowercase-only matcher): **{old_missing}** in-scope failures")
        rep.append(f"- skip_missing_book AFTER (layered matcher): **{new_missing}** (CSV total incl. no-rebuild-book rows may differ slightly)")
        rep.append(f"- **gross memberships recovered by folding (diacritics/subtitle/punctuation): {recovered_gross}**")
        rep.append(f"- ambiguous matches NEWLY REFUSED for safety (NEW refuses; OLD blindly accepted a possibly-wrong book): {ambiguous_old_blind} of {ambiguous_total} total ambiguous")
        rep.append(f"- net change in missing: {old_missing} → {new_missing} ({'+' if net<0 else '-'}{abs(net)}) "
                   f"= recovered {recovered_gross} minus newly-refused-ambiguous {ambiguous_old_blind}")
        rep.append(f"- match method breakdown: {dict(match_method_counts)}")
        rep.append("- NOTE: ambiguous = production has DUPLICATE book rows for that title+author; refusing avoids a wrong link. Resolve after a production book-dedupe pass.")
        if ambiguous_rows:
            rep.append("- sample ambiguous (refused):")
            for t, a, sl, meth in ambiguous_rows[:10]:
                rep.append(f"   - '{t}' / {a}  (list={sl})")
        rep.append("- top recovered books (matched by NEW matcher, missed by OLD):")
        for title, n in recovered_books.most_common(15):
            rep.append(f"   - {n:3d}×  {title}")
        rep.append("")
    rep.append("## Clear separation of buckets\n")
    rep.append(f"### A) Topic lists INSERTED: {topic_insert}")
    rep.append(f"### B) Author-bibliography lists SKIPPED: {len(author_lists)}")
    sample_auth = sorted(author_lists, key=lambda r: -author_list_slugs.get(norm(r['slug']), ('',0,0))[2])[:10]
    for r in sample_auth:
        top, share, members = author_list_slugs[norm(r["slug"])]
        rep.append(f"   - {r['slug']}  (author~{int(share*100)}%, {members} members)")
    rep.append(f"### C) Meta/curated lists INCLUDED: {len(meta_lists)} "
               + ("(insert)" if meta_insert else "(already in production — memberships only)"))
    for r in meta_lists:
        rep.append(f"   - {r['slug']} ({r.get('book_count','')} books) — NOT a Fiction/Nonfiction subcategory")
    rep.append(f"### D) Non-topic/series lists SKIPPED: {len(non_topic_lists)}\n")
    rep.append("## Top 30 topic lists by membership count\n")
    for slug, n in top30:
        title = next((r["title"] for r in topic_lists if norm(r["slug"]) == slug), slug)
        parent = next((r["parent_category"] for r in topic_lists if norm(r["slug"]) == slug), "")
        rep.append(f"- {n:5d}  {slug}  ({title} / {parent})")
    rep.append("")
    rep.append("## Shoe Dog — expected Appears In after migration (topic lists)\n")
    if shoe:
        rep.append(f"- book: {shoe['title']} (slug shoe-dog, {shoe.get('primary_type')})")
        rep.append(f"- topic list memberships ({len(shoe_lists)}): {sorted(shoe_lists)}")
    else:
        rep.append("- Shoe Dog not found")
    rep.append("")
    rep.append("## Risks / blockers\n")
    rep.append("- Production side " + ("verified against export." if prod_mode else "NOT verified this session."))
    rep.append("- Author-list detection is a >=60%-single-author heuristic; cross-check flagged slugs against people names before final exclusion.")
    rep.append("- `skip_non_topic_list` (renamed from skip_missing_list) = memberships whose list is a series/order/non-best-* page; intentionally out of scope.")
    rep.append("- skip_missing_book are slug/title-match misses (e.g. diacritics, subtitles); fix matcher to recover high-traffic ones; do NOT insert new books here.")
    rep.append("- No deletes, no overwrites, no AI/SEO/slug/index_status changes are part of this plan.\n")
    rep.append("## Go / No-Go checklist before live list migration\n")
    rep.append("1. [ ] Backup verified (MANIFEST counts sane for all 8 tables, incl. junctions).")
    rep.append("2. [ ] conflict == 0 in lists diff.")
    rep.append(f"3. [ ] topic insert count reviewed ({topic_insert}); author lists excluded ({len(author_lists)}).")
    rep.append("4. [ ] meta list (most-recommended-books) include/skip confirmed.")
    rep.append("5. [ ] book_lists insert count + skip_missing_book rate acceptable.")
    rep.append("6. [ ] Approve INSERT-ONLY write script (no update/delete/overwrite).")
    rep.append("7. [ ] Verify Shoe Dog Appears In on staging before/after.\n")

    with open(os.path.join(out, "PATH1_LISTS_DRY_RUN_REPORT.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(rep) + "\n")

    print("== DRY-RUN COMPLETE (no DB writes) ==")
    print(f"mode: {'PRODUCTION-DIFF' if prod_mode else 'OFFLINE CANDIDATE'}")
    print(f"classification: topic={len(topic_lists)} author={len(author_lists)} meta={len(meta_lists)} non_topic={len(non_topic_lists)}")
    print(f"lists diff: {dict(counts)}")
    print(f"book_lists diff: {dict(bl_counts)}")
    print(f"  (meta memberships={meta_membership_inserts}, topic memberships={bl_counts.get('insert_membership',0)})")
    print(f"Shoe Dog topic lists: {sorted(shoe_lists)}")
    print(f"wrote: {out}/migration_dry_run_lists_v2.csv")
    print(f"wrote: {out}/migration_dry_run_book_lists_v2.csv")
    print(f"wrote: {out}/PATH1_LISTS_DRY_RUN_REPORT.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
