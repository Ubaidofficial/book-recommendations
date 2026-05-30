#!/usr/bin/env python3
# Preview-only description cleanup for SPECIFIC known slugs.
#
# SAFETY MODEL
#   - READ-ONLY. NO DB writes. NO AI calls. NO external API calls.
#   - Per-slug deterministic rules ONLY. No generated prose.
#   - When the deterministic rule cannot produce a safe full description
#     (e.g. The Outsiders mojibake — `?` could be `"`, `'`, `—`, or `…`),
#     action = needs_manual_review with proposed_description = "" and
#     reason listing every broken token found.
#
# WHAT WE TOUCH IN A FUTURE LIVE WRITE
#   - ONLY books.description. Nothing else.
#
# USAGE
#   python scripts/path1_description_targeted_preview.py \
#     --production-dir backups/path1_pre_lists_migration_20260527T084428Z

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

csv.field_size_limit(10**9)


# ─────────────────────────────────────────────────────────────────────────────
# Per-slug deterministic substitution rules.
#
# Each rule: (needle, replacement, reason).
# All matching rules apply in order; only EXACT substrings are replaced.
# ─────────────────────────────────────────────────────────────────────────────

PER_SLUG_RULES: Dict[str, List[Tuple[str, str, str]]] = {
    "the-threebody-problem-cixin-liu": [
        ("The ThreeBody Problem", "The Three-Body Problem",
         "known_title_in_description_hyphenation_fix"),
    ],
    # No deterministic auto-fix for the-outsiders-william-n-thorndike — handled
    # below via mojibake diagnosis only (action = needs_manual_review).
}


DEFAULT_KNOWN_SLUGS = [
    "the-outsiders-william-n-thorndike",
    "the-threebody-problem-cixin-liu",
]


# ─────────────────────────────────────────────────────────────────────────────
# Mojibake / spacing diagnostics — surface but never auto-fix
# ─────────────────────────────────────────────────────────────────────────────

MOJIBAKE_QUESTION_BEFORE_CAP = re.compile(r"\?[A-Za-z]")
MOJIBAKE_APOSTROPHE_S = re.compile(r"\b[A-Za-z]+\?s\b")
MOJIBAKE_PUNCT_QUESTION = re.compile(r"[a-z]\.\?")
MASHED_WORDS = re.compile(r"\b[A-Za-z]*[a-z][A-Z][a-z]+[A-Za-z]*\b")
MISSING_SPACE_AFTER_PERIOD = re.compile(r"[a-z]\.[A-Z][a-z]")
SOCALLED = re.compile(r"\bsocalled\b")
ALLOW_CAMEL = {
    "iphone", "ipad", "youtube", "javascript", "typescript", "github",
    "openai", "deepseek", "facebook", "instagram", "linkedin",
    "harpercollins", "simonschuster", "penguinrandomhouse",
}


def diagnose_description(desc: str) -> List[str]:
    findings: List[str] = []
    if MOJIBAKE_QUESTION_BEFORE_CAP.search(desc) and len(MOJIBAKE_QUESTION_BEFORE_CAP.findall(desc)) >= 1:
        findings.append("mojibake_question_before_capital")
    if MOJIBAKE_APOSTROPHE_S.search(desc):
        findings.append("mojibake_apostrophe_s")
    if MOJIBAKE_PUNCT_QUESTION.search(desc):
        findings.append("mojibake_period_question")
    if SOCALLED.search(desc):
        findings.append("missing_hyphen_socalled")
    if MISSING_SPACE_AFTER_PERIOD.search(desc):
        findings.append("missing_space_after_period")
    mashes = [t for t in MASHED_WORDS.findall(desc) if t.lower() not in ALLOW_CAMEL]
    if mashes:
        findings.append(f"mashed_words({','.join(sorted(set(mashes))[:5])})")
    return findings


# ─────────────────────────────────────────────────────────────────────────────
# Source loading
# ─────────────────────────────────────────────────────────────────────────────

def _creds() -> Tuple[str, str]:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    key = (os.environ.get("SUPABASE_SECRET_KEY")
           or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or "")
    return url.rstrip("/"), key


def _req(method: str, url: str, headers: Dict[str, str]) -> Any:
    req = urllib.request.Request(url, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body) if body else None


_LIVE_SELECT = "id,slug,title,description"


def fetch_books_live(url: str, key: str, slugs: List[str]) -> List[Dict[str, Any]]:
    if not slugs:
        return []
    in_list = ",".join(f'"{s}"' for s in slugs)
    params = {
        "select": _LIVE_SELECT,
        "slug": f"in.({in_list})",
        "limit": str(max(len(slugs), 10)),
    }
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode(params)
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    try:
        return _req("GET", full, h) or []
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8")
        except Exception:
            pass
        print(f"[supabase] HTTP {e.code} on GET books by slug: {body[:200]}")
        return []


def load_books(args: argparse.Namespace, slugs: List[str]) -> Tuple[List[Dict[str, Any]], str]:
    if args.production_dir:
        path = os.path.join(args.production_dir, "books.csv")
        if not os.path.exists(path):
            raise SystemExit(f"backup books.csv not found: {path}")
        slug_set = set(slugs)
        with open(path, newline="", encoding="utf-8") as f:
            rows = [r for r in csv.DictReader(f) if r.get("slug") in slug_set]
        return rows, f"BACKUP {args.production_dir}"
    url, key = _creds()
    if not url or not key:
        raise SystemExit(
            "No Supabase credentials in env and no --production-dir.\n"
            "Export SUPABASE_URL + SUPABASE_SECRET_KEY (or pass --production-dir backups/...)."
        )
    return fetch_books_live(url, key, slugs), f"LIVE {url}"


# ─────────────────────────────────────────────────────────────────────────────
# Per-row evaluation
# ─────────────────────────────────────────────────────────────────────────────

def evaluate_book(book: Dict[str, Any]) -> Dict[str, Any]:
    slug = (book.get("slug") or "").strip()
    title = (book.get("title") or "").strip()
    desc = (book.get("description") or "")
    rules = PER_SLUG_RULES.get(slug, [])

    reasons_applied: List[str] = []
    new_desc = desc
    if rules:
        for needle, repl, reason in rules:
            if needle in new_desc:
                new_desc = new_desc.replace(needle, repl)
                reasons_applied.append(reason)

    diag = diagnose_description(desc)

    if reasons_applied and new_desc != desc:
        # Per the task rules: a deterministic substitution rule that fires for a
        # known slug proposes ONLY that targeted change. Residual defects elsewhere
        # in the description are noted in the reason (for transparency) but do not
        # downgrade the action — we are explicitly NOT rewriting the description.
        residual_after_fix = diagnose_description(new_desc)
        full_reasons = list(reasons_applied)
        for r in residual_after_fix:
            full_reasons.append(f"unchanged_residual:{r}")
        return {
            "book_id": book.get("id", ""),
            "slug": slug,
            "title": title,
            "current_description": desc,
            "proposed_description": new_desc,
            "reason": ";".join(full_reasons),
            "confidence": "high",
            "action": "would_clean",
        }

    # No deterministic rule fired (either no rule for this slug, or rule didn't match).
    # If there are mojibake/mashed signals, mark needs_manual_review.
    if diag:
        return {
            "book_id": book.get("id", ""),
            "slug": slug,
            "title": title,
            "current_description": desc,
            "proposed_description": "",
            "reason": ";".join(diag),
            "confidence": "low",
            "action": "needs_manual_review",
        }
    # Clean: no rule needed
    return {
        "book_id": book.get("id", ""),
        "slug": slug,
        "title": title,
        "current_description": desc,
        "proposed_description": "",
        "reason": "no_known_issue_detected",
        "confidence": "",
        "action": "skip",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

PREVIEW_COLUMNS = [
    "book_id", "slug", "title",
    "current_description", "proposed_description",
    "reason", "confidence", "action",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--production-dir", default="",
                    help="Optional offline books.csv source. Uses backup if creds absent.")
    ap.add_argument("--out", default="rebuild_v2/description_manual_review_known_preview_v1.csv")
    ap.add_argument("--slugs", default=",".join(DEFAULT_KNOWN_SLUGS))
    args = ap.parse_args()

    slugs = [s.strip() for s in args.slugs.split(",") if s.strip()]
    print("== Description targeted PREVIEW (READ-ONLY) ==")
    print(f"slugs                  : {slugs}")
    books, src = load_books(args, slugs)
    print(f"source                 : {src}")
    print(f"books loaded           : {len(books)}")

    rows_out: List[Dict[str, Any]] = []
    by_slug = {(b.get("slug") or "").strip(): b for b in books}
    for s in slugs:
        b = by_slug.get(s)
        if b is None:
            print(f"  [WARN] slug not found: {s}")
            continue
        rows_out.append(evaluate_book(b))

    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=PREVIEW_COLUMNS)
        w.writeheader()
        for r in rows_out:
            w.writerow(r)

    n_clean = sum(1 for r in rows_out if r["action"] == "would_clean")
    n_manual = sum(1 for r in rows_out if r["action"] == "needs_manual_review")
    n_skip = sum(1 for r in rows_out if r["action"] == "skip")
    print()
    print(f"rows in preview        : {len(rows_out)}")
    print(f"  would_clean          : {n_clean}")
    print(f"  needs_manual_review  : {n_manual}")
    print(f"  skip                 : {n_skip}")
    print(f"output csv             : {args.out}")
    print()
    for r in rows_out:
        print("=" * 70)
        print(f"  {r['action']:22s} {r['confidence']:6s}  {r['slug']}")
        print(f"     reason   : {r['reason']}")
        cd = r["current_description"]
        print(f"     current  ({len(cd)} chars):")
        print(f"       {cd[:240] + '...' if len(cd) > 240 else cd}")
        if r["proposed_description"]:
            pd = r["proposed_description"]
            print(f"     proposed ({len(pd)} chars):")
            print(f"       {pd[:300] + '...' if len(pd) > 300 else pd}")
        else:
            print(f"     proposed : <empty — needs manual review>")
    print()
    print("NO DB WRITES. NO AI CALLS. NO MIGRATION. NO SCHEMA CHANGES.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
