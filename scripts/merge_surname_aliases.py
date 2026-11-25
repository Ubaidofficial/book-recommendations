#!/usr/bin/env python3
"""
2026-11-25: merge recommendations filed under a bare surname ("Kutcher", "Mullenweg") into the named person.
DRY RUN unless `apply --write`.

WHY. 541 people rows are a single word with no role, bio or portrait (lib/dataQuality.ts
isProfilelessSurnameAlias). They hold 4,629 recommendation rows. Pages already hide them as recommenders, but
books.recommendation_count still counts them, so "Recommended by 52 people" counted "Abdaal" next to Ali Abdaal.

RULES. A surname-only person ("alias") is matched only against named people with the same last name.
  person_match   The alias's books overlap one candidate's books on at least half of them (and at least 2), and no
                 other candidate overlaps on 20% or more: the alias is that person's list imported twice. Rows on
                 books the person already has are duplicates (deleted); the rest move to the person.
  same_book_dup  No person-level match, but the same book is already recommended by exactly one named person with
                 that surname: that row is a duplicate (deleted). Nothing else of that alias moves.
  Everything else is left as it is (still hidden on pages, still counted). Nobody is merged on a surname alone.

When a duplicate is deleted and the kept row has no source (or no quote) but the duplicate has one, the source
(or quote) is copied onto the kept row first, so no evidence is lost.

SAFETY. Every changed row is written to public.bak_seo_changes_20261114 first (batch below). Before each change
the row is re-read; it is skipped unless it still belongs to the alias. books.recommendation_count is lowered by
exactly the number of rows deleted for that book (never recomputed, so other counting rules are left alone).
Undo: re-insert deleted rows from old_values, set person_id back for reassigned rows, and restore
recommendation_count, all from the rows with this batch.

  python3 -I scripts/merge_surname_aliases.py plan
  python3 -I scripts/merge_surname_aliases.py apply                 # dry run: counts only
  python3 -I scripts/merge_surname_aliases.py apply --write
"""
from __future__ import annotations

import argparse
import collections
import csv
import json
import os
import re
import sys

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

BASE = "https://ghpdpvatfmvsahzsqgpp.supabase.co/rest/v1"
H = {"apikey": "dummy", "Authorization": "Bearer dummy", "Content-Type": "application/json"}
BATCH = "surname_alias_merge_20261125"
REPORTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "reports")
PLAN = os.path.join(REPORTS, "alias_merge_plan.csv")
# Retry dropped connections and 5xx (the 2026-11-25 run died on a proxy reset); writes are guarded by re-reads.
_S = requests.Session()
_S.mount("https://", HTTPAdapter(max_retries=Retry(total=6, connect=6, read=3, backoff_factor=1.5,
                                                   status_forcelist=(429, 500, 502, 503, 504),
                                                   allowed_methods=frozenset({"GET", "POST", "PATCH", "DELETE"}))))
requests = _S  # noqa: F811 - module-level calls below use the retrying session

COLS = ["action", "reason", "rec_id", "book_id", "alias_id", "alias_name", "target_id", "target_name", "target_rec_id"]


def all_rows(table: str, select: str, extra: dict | None = None) -> list[dict]:
    out, off = [], 0
    while True:
        r = requests.get(f"{BASE}/{table}", params={"select": select, "order": "id.asc", "offset": off, "limit": 1000, **(extra or {})},
                         headers=H, timeout=120)
        r.raise_for_status()
        b = r.json()
        out += b
        if len(b) < 1000:
            return out
        off += 1000


def blank(v) -> bool:
    return not (v or "").strip()


def is_alias(p: dict) -> bool:
    n = (p.get("name") or "").strip()
    return bool(n) and " " not in n and blank(p.get("role")) and blank(p.get("bio")) and blank(p.get("avatar_url"))


def surname(name: str) -> str:
    n = (name or "").strip()
    return re.sub(r"[^a-zà-ɏ'-]", "", n.split()[-1].lower()) if n else ""


# ── plan ─────────────────────────────────────────────────────────────────────
def phase_plan(_args) -> None:
    people = all_rows("people", "id,name,role,bio,avatar_url")
    recs = all_rows("book_recommendations", "id,book_id,person_id")
    P = {p["id"]: p for p in people}
    alias = {i for i, p in P.items() if is_alias(p)}
    by_sn: dict[str, set] = collections.defaultdict(set)
    for i, p in P.items():
        if " " in (p.get("name") or "").strip():
            by_sn[surname(p["name"])].add(i)
    books_of: dict[str, set] = collections.defaultdict(set)
    rows_of_book_person: dict[tuple, list] = collections.defaultdict(list)
    alias_rows: dict[str, list] = collections.defaultdict(list)
    for r in recs:
        books_of[r["person_id"]].add(r["book_id"])
        rows_of_book_person[(r["book_id"], r["person_id"])].append(r["id"])
        if r["person_id"] in alias:
            alias_rows[r["person_id"]].append(r)

    plan, stats = [], collections.Counter()
    for a, rows in alias_rows.items():
        A = books_of[a]
        n = len(A)
        cands = by_sn.get(surname(P[a]["name"]), set())
        overlap = sorted(((len(A & books_of[c]), c) for c in cands), reverse=True)
        best_n, best = overlap[0] if overlap else (0, None)
        second = overlap[1][0] if len(overlap) > 1 else 0
        person_match = best is not None and best_n >= max(2, 0.5 * n) and second < max(1, 0.2 * n)
        moved_to: set = set()  # books this alias already moved to the target in this plan (two alias rows, one book)
        for r in rows:
            base = {"rec_id": r["id"], "book_id": r["book_id"], "alias_id": a, "alias_name": P[a]["name"]}
            if person_match:
                tgt_rows = rows_of_book_person.get((r["book_id"], best), [])
                if tgt_rows or r["book_id"] in moved_to:
                    plan.append({**base, "action": "delete_dup", "reason": "person_match", "target_id": best,
                                 "target_name": P[best]["name"], "target_rec_id": tgt_rows[0] if tgt_rows else ""})
                    stats["person_match delete_dup"] += 1
                else:
                    plan.append({**base, "action": "reassign", "reason": "person_match", "target_id": best,
                                 "target_name": P[best]["name"], "target_rec_id": ""})
                    moved_to.add(r["book_id"])
                    stats["person_match reassign"] += 1
                continue
            same = [c for c in cands if rows_of_book_person.get((r["book_id"], c))]
            if len(same) == 1:
                t = same[0]
                plan.append({**base, "action": "delete_dup", "reason": "same_book_dup", "target_id": t,
                             "target_name": P[t]["name"], "target_rec_id": rows_of_book_person[(r["book_id"], t)][0]})
                stats["same_book_dup delete_dup"] += 1
            else:
                stats["left as is"] += 1
    os.makedirs(REPORTS, exist_ok=True)
    with open(PLAN, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerows(plan)
    print(json.dumps({"alias_people": len(alias), "alias_rows": sum(len(v) for v in alias_rows.values()), **stats}, indent=1))
    print(f"wrote {len(plan)} actions -> {PLAN}")


# ── apply ────────────────────────────────────────────────────────────────────
REC_FIELDS = "id,book_id,person_id,source_url,source_name,quote,confidence_score,recommended_at,created_at"


def get_rec(rec_id: str) -> dict | None:
    r = requests.get(f"{BASE}/book_recommendations", params={"select": REC_FIELDS, "id": f"eq.{rec_id}"}, headers=H, timeout=60)
    r.raise_for_status()
    rows = r.json()
    return rows[0] if rows else None


def backup(table: str, row_id: str, slug: str, old: dict, new: dict) -> bool:
    b = requests.post(f"{BASE}/bak_seo_changes_20261114", headers={**H, "Prefer": "return=minimal"}, timeout=60,
                      json={"table_name": table, "row_id": row_id, "slug": slug, "old_values": old, "new_values": new, "batch": BATCH})
    return b.status_code in (200, 201)


def apply_one(p: dict, write: bool) -> tuple[str, str]:
    """Returns (outcome, book_id). outcome: deleted | reassigned | skipped:<why> | failed:<why>."""
    cur = get_rec(p["rec_id"])
    if not cur or cur["person_id"] != p["alias_id"]:
        return "skipped:changed", p["book_id"]
    tag = f"{p['alias_name']}->{p['target_name']}"
    action = p["action"]
    target_row = None
    if action == "reassign":
        # Someone may have added the named person's row since the plan: then it is a duplicate after all.
        r = requests.get(f"{BASE}/book_recommendations", params={"select": REC_FIELDS, "book_id": f"eq.{cur['book_id']}",
                                                                    "person_id": f"eq.{p['target_id']}"}, headers=H, timeout=60).json()
        if r:
            action, target_row = "delete_dup", r[0]
    elif action == "delete_dup":
        if p["target_rec_id"]:
            target_row = get_rec(p["target_rec_id"])
        else:  # duplicate of a row this run moved to the target
            r = requests.get(f"{BASE}/book_recommendations", params={"select": REC_FIELDS, "book_id": f"eq.{cur['book_id']}",
                                                                        "person_id": f"eq.{p['target_id']}"}, headers=H, timeout=60).json()
            target_row = r[0] if r else None
        if not target_row or target_row["person_id"] != p["target_id"] or target_row["book_id"] != cur["book_id"]:
            return "skipped:target_missing", p["book_id"]
    if not write:
        return ("deleted" if action == "delete_dup" else "reassigned"), p["book_id"]

    if action == "reassign":
        if not backup("book_recommendations", cur["id"], tag, cur, {"person_id": p["target_id"]}):
            return "failed:backup", p["book_id"]
        u = requests.patch(f"{BASE}/book_recommendations", params={"id": f"eq.{cur['id']}", "person_id": f"eq.{p['alias_id']}"},
                           headers={**H, "Prefer": "return=minimal"}, json={"person_id": p["target_id"]}, timeout=60)
        return ("reassigned" if u.status_code in (200, 204) else f"failed:patch {u.status_code}"), p["book_id"]

    # delete_dup: keep the evidence first.
    carry = {}
    if blank(target_row.get("source_url")) and not blank(cur.get("source_url")):
        carry["source_url"] = cur["source_url"]
        if blank(target_row.get("source_name")) and not blank(cur.get("source_name")):
            carry["source_name"] = cur["source_name"]
    if blank(target_row.get("quote")) and not blank(cur.get("quote")):
        carry["quote"] = cur["quote"]
    if carry:
        if not backup("book_recommendations", target_row["id"], tag, {k: target_row.get(k) for k in carry}, carry):
            return "failed:backup", p["book_id"]
        u = requests.patch(f"{BASE}/book_recommendations", params={"id": f"eq.{target_row['id']}"},
                           headers={**H, "Prefer": "return=minimal"}, json=carry, timeout=60)
        if u.status_code not in (200, 204):
            return f"failed:carry {u.status_code}", p["book_id"]
    if not backup("book_recommendations", cur["id"], tag, cur, {"deleted": True, "duplicate_of": target_row["id"]}):
        return "failed:backup", p["book_id"]
    d = requests.delete(f"{BASE}/book_recommendations", params={"id": f"eq.{cur['id']}", "person_id": f"eq.{p['alias_id']}"},
                        headers={**H, "Prefer": "return=minimal"}, timeout=60)
    return ("deleted" if d.status_code in (200, 204) else f"failed:delete {d.status_code}"), p["book_id"]


def lower_counts(write: bool) -> tuple[int, int]:
    """Lower books.recommendation_count once per book, by the rows this batch deleted and that are really gone.

    Read from the backup table, not from this run's memory, so rows deleted by an earlier, interrupted run of the
    same batch are counted too. A book that already has a count backup in this batch is never lowered again.
    """
    bak = []
    off = 0
    while True:
        r = requests.get(f"{BASE}/bak_seo_changes_20261114", params={"select": "table_name,row_id,old_values,new_values",
                         "batch": f"eq.{BATCH}", "order": "id.asc", "offset": off, "limit": 1000}, headers=H, timeout=120)
        r.raise_for_status()
        b = r.json()
        bak += b
        if len(b) < 1000:
            break
        off += 1000
    done_books = {x["row_id"] for x in bak if x["table_name"] == "books"}
    deleted = {x["row_id"]: x["old_values"]["book_id"] for x in bak
               if x["table_name"] == "book_recommendations" and (x["new_values"] or {}).get("deleted")}
    still_there: set = set()
    ids = list(deleted)
    for i in range(0, len(ids), 100):
        chunk = ",".join(ids[i:i + 100])
        r = requests.get(f"{BASE}/book_recommendations", params={"select": "id", "id": f"in.({chunk})"}, headers=H, timeout=120)
        r.raise_for_status()
        still_there |= {x["id"] for x in r.json()}
    per_book = collections.Counter(book for rid, book in deleted.items() if rid not in still_there)
    updated = removed = 0
    for book_id, k in per_book.items():
        if book_id in done_books:
            continue
        r = requests.get(f"{BASE}/books", params={"select": "id,slug,recommendation_count", "id": f"eq.{book_id}"}, headers=H, timeout=60).json()
        if not r:
            continue
        old = r[0]["recommendation_count"] or 0
        new = max(0, old - k)
        if not write:
            updated += 1
            removed += k
            continue
        if not backup("books", book_id, r[0]["slug"], {"recommendation_count": old}, {"recommendation_count": new}):
            print("  count backup failed", book_id)
            continue
        u = requests.patch(f"{BASE}/books", params={"id": f"eq.{book_id}"}, headers={**H, "Prefer": "return=minimal"},
                           json={"recommendation_count": new}, timeout=60)
        if u.status_code in (200, 204):
            updated += 1
            removed += k
        else:
            print("  count update failed", book_id, u.status_code)
    print(f"  backup rows: {len(deleted)} deletions, {len(still_there)} of them still present (not counted)")
    return updated, removed


def phase_apply(args) -> None:
    from concurrent.futures import ThreadPoolExecutor

    with open(PLAN, encoding="utf-8") as fh:
        plan = list(csv.DictReader(fh))
    # Rows of one alias on one book must run in plan order (a reassign before its duplicate), so group per book.
    by_book: dict[str, list] = collections.defaultdict(list)
    for p in plan:
        by_book[p["book_id"]].append(p)

    def run_book(items):
        return [apply_one(p, args.write) for p in items]

    outcomes = collections.Counter()
    deleted_per_book = collections.Counter()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for n, results in enumerate(pool.map(run_book, by_book.values()), 1):
            for outcome, book_id in results:
                outcomes[outcome.split(" ")[0]] += 1
                if outcome == "deleted":
                    deleted_per_book[book_id] += 1
            if n % 500 == 0:
                print(f"  {n}/{len(by_book)} books", flush=True)

    count_updates, removed = lower_counts(args.write) if args.write else (len(deleted_per_book), sum(deleted_per_book.values()))
    print(json.dumps({"mode": "WRITE" if args.write else "DRY RUN", **outcomes, "book_counts_lowered": count_updates,
                      "rows_removed_from_counts": removed, "batch": BATCH}, indent=1))


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="phase", required=True)
    sub.add_parser("plan")
    a = sub.add_parser("apply")
    a.add_argument("--write", action="store_true")
    a.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()
    {"plan": phase_plan, "apply": phase_apply}[args.phase](args)


if __name__ == "__main__":
    main()
