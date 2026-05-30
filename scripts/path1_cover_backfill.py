#!/usr/bin/env python3
# Safe cover backfill for high-priority missing/placeholder book covers.
#
# SAFETY MODEL
#   - Dry-run / preview by DEFAULT. NO DB writes unless ALL three gates pass:
#       --write  AND  --confirm-cover-backfill  AND  --backup-before-write PATH
#   - The ONLY mutable field is `books.cover_image_url`. Nothing else is ever touched.
#   - Pre-write backup is REQUIRED and validated before any PATCH.
#   - Idempotency: live-mode re-fetches each row and refuses to overwrite a cover that's
#     no longer missing/placeholder (unless --include-existing is explicitly passed).
#   - Conservative scoring: for famous books, a wrong cover is worse than no cover.
#     Low-confidence candidates are skipped, not written.
#
# DATA SOURCES (public, no auth required)
#   - Google Books volumes API (https://www.googleapis.com/books/v1/volumes)
#   - Open Library search API (https://openlibrary.org/search.json) + cover server
#   No scraping. Only well-known JSON endpoints.
#
# USAGE
#   # Audit (read-only)
#   python scripts/path1_cover_backfill.py --audit
#
#   # Dry-run preview (top 100 missing-cover books with recs>=10)
#   python scripts/path1_cover_backfill.py --limit 100 --min-recommendations 10
#
#   # Live write (gated)
#   python scripts/path1_cover_backfill.py \
#       --preview rebuild_v2/cover_backfill_preview_<ts>.csv \
#       --write --confirm-cover-backfill \
#       --backup-before-write backups/cover_backfill_pre_<ts>.csv \
#       --score-threshold 0.82

from __future__ import annotations
import argparse
import csv
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from path1_match import fold as _fold, strip_subtitle as _strip_subtitle  # noqa: E402

csv.field_size_limit(10**9)


# ────────────────────────────────────────────────────────────────────────────
# Missing-cover detection
# ────────────────────────────────────────────────────────────────────────────

PLACEHOLDER_PATTERNS = [
    re.compile(r"^\s*$"),
    re.compile(r"^\s*null\s*$", re.I),
    re.compile(r"^\s*none\s*$", re.I),
    re.compile(r"^\s*coming\s+soon\s*$", re.I),
    re.compile(r"^\s*placeholder", re.I),
    re.compile(r"no[-\s]?cover", re.I),
    re.compile(r"cover[-\s]?unavailable", re.I),
    re.compile(r"^\s*(file|data):", re.I),                # invalid scheme
]


def is_missing_or_placeholder(cover: Any) -> bool:
    if cover is None:
        return True
    if not isinstance(cover, str):
        return True
    s = cover.strip()
    if not s:
        return True
    for pat in PLACEHOLDER_PATTERNS:
        if pat.search(s):
            return True
    # require http(s)
    if not re.match(r"^https?://", s, re.I):
        return True
    return False


# ────────────────────────────────────────────────────────────────────────────
# Title/author normalization (extends path1_match helpers with article stripping)
# ────────────────────────────────────────────────────────────────────────────

_LEADING_ARTICLES = ("the ", "a ", "an ")


def soft_title(t: Any) -> str:
    """Folded title with subtitle stripped and leading article removed."""
    s = _fold(_strip_subtitle(t))
    for art in _LEADING_ARTICLES:
        if s.startswith(art):
            s = s[len(art):]
            break
    return s.strip()


def soft_author(a: Any) -> str:
    """Folded author, keeps full name."""
    return _fold(a)


def author_last_token(a: Any) -> str:
    f = soft_author(a)
    if not f:
        return ""
    return f.split()[-1]


# ────────────────────────────────────────────────────────────────────────────
# Supabase helpers (read + PATCH-only-cover)
# ────────────────────────────────────────────────────────────────────────────

def _creds() -> Tuple[str, str]:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    key = (os.environ.get("SUPABASE_SECRET_KEY")
           or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or "")
    return url.rstrip("/"), key


def _req(method: str, url: str, headers: Dict[str, str], payload: Optional[dict] = None, timeout: int = 30) -> Tuple[Any, Dict[str, str]]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
        rh = {k: v for k, v in resp.headers.items()}
    return (json.loads(body) if body else None), rh


def supa_select_books(url: str, key: str, select: str, order: str = "recommendation_count.desc.nullslast",
                      limit: int = 1000, offset: int = 0) -> List[Dict[str, Any]]:
    params = {"select": select, "order": order, "limit": str(limit), "offset": str(offset)}
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode(params)
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    try:
        data, _ = _req("GET", full, h)
        return data or []
    except urllib.error.HTTPError as e:
        body = ""
        try: body = e.read().decode("utf-8")
        except Exception: pass
        print(f"[supabase] HTTP {e.code} on GET books: {body[:200]}")
        return []


def supa_get_book(url: str, key: str, book_id: str) -> Optional[Dict[str, Any]]:
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode({
        "select": "id,slug,title,author_name,cover_image_url",
        "id": f"eq.{book_id}", "limit": "1",
    })
    try:
        data, _ = _req("GET", full, {"apikey": key, "Authorization": f"Bearer {key}"})
        return data[0] if data else None
    except Exception as e:
        print(f"[supabase] live-fetch failed for {book_id}: {e}")
        return None


def supa_patch_cover(url: str, key: str, book_id: str, cover_url: str) -> None:
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode({"id": f"eq.{book_id}"})
    h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
         "Prefer": "return=minimal"}
    _req("PATCH", full, h, payload={"cover_image_url": cover_url})


# ────────────────────────────────────────────────────────────────────────────
# Source: Google Books
# ────────────────────────────────────────────────────────────────────────────

def google_books_search(title: str, author: str, max_results: int = 5, timeout: int = 15) -> List[Dict[str, Any]]:
    """Return raw volumeInfo items. Empty list on any error."""
    parts: List[str] = []
    if title:
        parts.append(f'intitle:"{title}"')
    if author:
        parts.append(f'inauthor:"{author}"')
    if not parts:
        return []
    q = "+".join(parts)
    qs = urllib.parse.urlencode({"q": q, "maxResults": str(max_results), "printType": "books"})
    url = f"https://www.googleapis.com/books/v1/volumes?{qs}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "bookrecs-cover-backfill/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        items = data.get("items", []) or []
        return items[:max_results]
    except Exception as e:
        print(f"  [google_books] error for '{title}' / '{author}': {type(e).__name__}: {str(e)[:100]}")
        return []


def google_books_pick_image(item: Dict[str, Any]) -> Optional[str]:
    vi = item.get("volumeInfo") or {}
    links = vi.get("imageLinks") or {}
    # Prefer larger sizes when present
    for k in ("extraLarge", "large", "medium", "small", "thumbnail", "smallThumbnail"):
        u = links.get(k)
        if u:
            return u.replace("http://", "https://")
    return None


def google_books_extract_isbns(item: Dict[str, Any]) -> List[str]:
    vi = item.get("volumeInfo") or {}
    out: List[str] = []
    for ident in (vi.get("industryIdentifiers") or []):
        v = (ident or {}).get("identifier")
        if isinstance(v, str) and v:
            out.append(v)
    return out


# ────────────────────────────────────────────────────────────────────────────
# Source: Open Library
# ────────────────────────────────────────────────────────────────────────────

def open_library_search(title: str, author: str, max_results: int = 5, timeout: int = 15) -> List[Dict[str, Any]]:
    params: Dict[str, str] = {"limit": str(max_results)}
    if title: params["title"] = title
    if author: params["author"] = author
    if not params.get("title") and not params.get("author"):
        return []
    qs = urllib.parse.urlencode(params)
    url = f"https://openlibrary.org/search.json?{qs}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "bookrecs-cover-backfill/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return (data.get("docs") or [])[:max_results]
    except Exception as e:
        print(f"  [open_library] error for '{title}' / '{author}': {type(e).__name__}: {str(e)[:100]}")
        return []


def open_library_pick_image(doc: Dict[str, Any]) -> Optional[str]:
    cover_i = doc.get("cover_i")
    if isinstance(cover_i, int):
        return f"https://covers.openlibrary.org/b/id/{cover_i}-L.jpg"
    isbns = doc.get("isbn") or []
    if isbns:
        # take the first that looks like ISBN-13
        for v in isbns:
            if isinstance(v, str) and len(v) in (10, 13):
                return f"https://covers.openlibrary.org/b/isbn/{v}-L.jpg"
    return None


# ────────────────────────────────────────────────────────────────────────────
# Candidate scoring
# ────────────────────────────────────────────────────────────────────────────

def score_candidate(book_title: str, book_author: str,
                    cand_title: str, cand_authors: str, isbn_match: bool) -> Tuple[float, str]:
    """Returns (score in [0,1], match_method)."""
    bt_full = _fold(book_title)
    bt_core = soft_title(book_title)
    ba = soft_author(book_author)
    ba_last = author_last_token(book_author)

    ct_full = _fold(cand_title)
    ct_core = soft_title(cand_title)
    ca = soft_author(cand_authors)
    ca_last = author_last_token(cand_authors)

    title_full_eq = bool(bt_full) and bt_full == ct_full
    title_core_eq = bool(bt_core) and bt_core == ct_core
    title_full_in = bool(bt_full) and bt_full in ct_full or (bool(ct_full) and ct_full in bt_full)
    author_full_eq = bool(ba) and ba == ca
    author_last_eq = bool(ba_last) and ba_last in (ca, ca_last) and len(ba_last) >= 4

    if isbn_match:
        return 1.00, "isbn"
    if title_full_eq and author_full_eq:
        return 0.97, "title_full_eq + author_full_eq"
    if title_core_eq and author_full_eq:
        return 0.93, "title_core_eq + author_full_eq"
    if title_full_eq and author_last_eq:
        return 0.90, "title_full_eq + author_last_eq"
    if title_core_eq and author_last_eq:
        return 0.87, "title_core_eq + author_last_eq"
    if title_full_eq and not ca:
        return 0.65, "title_full_eq (no author)"
    if title_core_eq and ca and not author_last_eq:
        return 0.40, "title_core_eq + author_mismatch"
    if title_full_in and author_last_eq:
        return 0.55, "title_partial + author_last_eq"
    if title_full_in and not ca:
        return 0.30, "title_partial (no author)"
    if title_core_eq:
        return 0.50, "title_core_eq only"
    return 0.15, "fuzzy"


def best_candidate(book: Dict[str, Any], source: str, max_results: int, sleep: float) -> Optional[Dict[str, Any]]:
    title = (book.get("title") or "").strip()
    author = (book.get("author_name") or book.get("author") or "").strip()
    isbn10 = (book.get("isbn_10") or "").strip()
    isbn13 = (book.get("isbn_13") or "").strip()
    known_isbns = {x for x in (isbn10, isbn13) if x}

    if not title:
        return None

    candidates: List[Dict[str, Any]] = []

    if source in ("google_books", "both"):
        items = google_books_search(title, author, max_results=max_results)
        if sleep > 0:
            time.sleep(sleep)
        for it in items:
            vi = it.get("volumeInfo") or {}
            cand_title = vi.get("title") or ""
            cand_subtitle = vi.get("subtitle") or ""
            if cand_subtitle:
                cand_title = f"{cand_title}: {cand_subtitle}"
            cand_authors = ", ".join(vi.get("authors") or [])
            img = google_books_pick_image(it)
            if not img:
                continue
            cand_isbns = set(google_books_extract_isbns(it))
            isbn_match = bool(known_isbns & cand_isbns)
            score, method = score_candidate(title, author, cand_title, cand_authors, isbn_match)
            ident = next(iter(cand_isbns), "") or (vi.get("industryIdentifiers") or [{}])[0].get("identifier", "")
            candidates.append({
                "source": "google_books", "score": score, "method": method,
                "image": img, "cand_title": cand_title, "cand_author": cand_authors,
                "identifier": ident,
                "payload_summary": f"gb:{vi.get('title','')[:40]} / {cand_authors[:30]}",
            })

    if source in ("open_library", "both"):
        docs = open_library_search(title, author, max_results=max_results)
        if sleep > 0:
            time.sleep(sleep)
        for d in docs:
            img = open_library_pick_image(d)
            if not img:
                continue
            cand_title = d.get("title") or ""
            cand_authors = ", ".join(d.get("author_name") or [])
            cand_isbns = set(d.get("isbn") or [])
            isbn_match = bool(known_isbns & cand_isbns)
            score, method = score_candidate(title, author, cand_title, cand_authors, isbn_match)
            ident = ""
            if d.get("cover_i"):
                ident = f"ol_cover:{d.get('cover_i')}"
            elif cand_isbns:
                ident = f"isbn:{next(iter(cand_isbns))}"
            candidates.append({
                "source": "open_library", "score": score, "method": method,
                "image": img, "cand_title": cand_title, "cand_author": cand_authors,
                "identifier": ident,
                "payload_summary": f"ol:{cand_title[:40]} / {cand_authors[:30]}",
            })

    if not candidates:
        return None
    candidates.sort(key=lambda c: c["score"], reverse=True)
    return candidates[0]


# ────────────────────────────────────────────────────────────────────────────
# Data loading
# ────────────────────────────────────────────────────────────────────────────

def load_books_source(args: argparse.Namespace) -> Tuple[List[Dict[str, Any]], str]:
    """Return (books, source_label)."""
    if args.production_dir:
        path = os.path.join(args.production_dir, "books.csv")
        if not os.path.exists(path):
            raise SystemExit(f"backup books.csv not found: {path}")
        with open(path, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        return rows, f"BACKUP {args.production_dir}"
    url, key = _creds()
    if not url or not key:
        raise SystemExit("No Supabase credentials AND no --production-dir. Provide one.")
    rows: List[Dict[str, Any]] = []
    offset = 0
    page = 1000
    select = "id,slug,title,author_name,cover_image_url,recommendation_count,list_count,isbn_10,isbn_13"
    while True:
        batch = supa_select_books(url, key, select, limit=page, offset=offset)
        if not batch:
            break
        rows.extend(batch)
        offset += len(batch)
        if len(batch) < page:
            break
    return rows, f"LIVE {url}"


# ────────────────────────────────────────────────────────────────────────────
# Audit mode
# ────────────────────────────────────────────────────────────────────────────

def do_audit(args: argparse.Namespace) -> int:
    books, source = load_books_source(args)
    total = len(books)
    missing = [b for b in books if is_missing_or_placeholder(b.get("cover_image_url"))]
    print(f"== Cover audit (READ-ONLY) ==")
    print(f"source                       : {source}")
    print(f"total books                  : {total}")
    print(f"missing/placeholder covers   : {len(missing)} ({100*len(missing)/max(1,total):.1f}%)")
    # By recommendation tier
    def tier(books, top_n):
        s = sorted(books, key=lambda b: int(b.get("recommendation_count") or 0), reverse=True)[:top_n]
        m = sum(1 for b in s if is_missing_or_placeholder(b.get("cover_image_url")))
        return m, len(s)
    for tn in (100, 500, 1000):
        m, n = tier(books, tn)
        print(f"top {tn:5d} by recs — missing  : {m}/{n} ({100*m/max(1,n):.1f}%)")
    if missing:
        miss_sorted = sorted(missing, key=lambda b: int(b.get("recommendation_count") or 0), reverse=True)
        print("")
        print("top 10 missing-cover by recommendation_count:")
        for b in miss_sorted[:10]:
            print(f"  recs={int(b.get('recommendation_count') or 0):3d}  {(b.get('title') or '')[:50]:50s} | {(b.get('author_name') or b.get('author') or '')[:25]}")
    return 0


# ────────────────────────────────────────────────────────────────────────────
# Plan / dry-run mode
# ────────────────────────────────────────────────────────────────────────────

def select_targets(books: List[Dict[str, Any]], min_recs: int, limit: int, offset: int) -> List[Dict[str, Any]]:
    eligible = [
        b for b in books
        if is_missing_or_placeholder(b.get("cover_image_url"))
        and int(b.get("recommendation_count") or 0) >= min_recs
        and (b.get("title") or "").strip()
    ]
    eligible.sort(key=lambda b: (
        -int(b.get("recommendation_count") or 0),
        -int(b.get("list_count") or 0),
        (b.get("title") or "").lower(),
    ))
    return eligible[offset: offset + limit]


def do_plan(args: argparse.Namespace) -> int:
    if args.write:
        raise RuntimeError("do_plan should not be called in write mode")
    books, source = load_books_source(args)
    targets = select_targets(books, args.min_recommendations, args.limit, args.offset)

    print(f"== Cover backfill PLAN (DRY-RUN) ==")
    print(f"source                       : {source}")
    print(f"books loaded                 : {len(books)}")
    print(f"targets after filter         : {len(targets)} "
          f"(missing-cover + recs>={args.min_recommendations}, limit={args.limit} offset={args.offset})")
    print(f"sources                      : {args.source}")
    print(f"score-threshold              : {args.score_threshold}")
    print()

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)
    preview_path = os.path.join(out_dir, f"cover_backfill_preview_{ts}.csv")
    plan_md_path = os.path.join(out_dir, f"COVER_BACKFILL_PLAN_{ts}.md")

    rows_out: List[Dict[str, Any]] = []
    for i, b in enumerate(targets, 1):
        if i % 25 == 0:
            print(f"  …processed {i}/{len(targets)}")
        cand = best_candidate(b, args.source, args.max_results_per_source, args.sleep)
        row: Dict[str, Any] = {
            "book_id": b.get("id", ""),
            "slug": b.get("slug", ""),
            "title": b.get("title", ""),
            "author_name": b.get("author_name") or b.get("author") or "",
            "recommendation_count": int(b.get("recommendation_count") or 0),
            "list_count": int(b.get("list_count") or 0),
            "current_cover_image_url": (b.get("cover_image_url") or "") or "",
            "candidate_cover_url": "",
            "candidate_source": "",
            "candidate_title": "",
            "candidate_author": "",
            "candidate_identifier": "",
            "candidate_score": 0.0,
            "decision": "",
            "reason": "",
            "match_method": "",
            "source_payload_summary": "",
        }
        if cand is None:
            row["decision"] = "skip_no_candidate"
            row["reason"] = "no result from any source"
        else:
            row["candidate_cover_url"] = cand["image"]
            row["candidate_source"] = cand["source"]
            row["candidate_title"] = cand["cand_title"]
            row["candidate_author"] = cand["cand_author"]
            row["candidate_identifier"] = cand["identifier"]
            row["candidate_score"] = round(cand["score"], 3)
            row["match_method"] = cand["method"]
            row["source_payload_summary"] = cand["payload_summary"]
            if cand["score"] >= args.score_threshold:
                row["decision"] = "would_update"
                row["reason"] = f"score {cand['score']:.2f} >= threshold {args.score_threshold}"
            else:
                row["decision"] = "skip_low_confidence"
                row["reason"] = f"score {cand['score']:.2f} < threshold {args.score_threshold}"
        rows_out.append(row)

    cols = ["book_id", "slug", "title", "author_name", "recommendation_count", "list_count",
            "current_cover_image_url", "candidate_cover_url", "candidate_source",
            "candidate_title", "candidate_author", "candidate_identifier", "candidate_score",
            "decision", "reason", "match_method", "source_payload_summary"]
    with open(preview_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in rows_out:
            w.writerow(r)

    # Summary
    import collections
    decision_counts = collections.Counter(r["decision"] for r in rows_out)
    would = [r for r in rows_out if r["decision"] == "would_update"]
    low = [r for r in rows_out if r["decision"] == "skip_low_confidence"]
    no_cand = [r for r in rows_out if r["decision"] == "skip_no_candidate"]

    # Markdown report
    L: List[str] = []
    L.append(f"# Cover backfill plan — {ts}\n")
    L.append(f"Source: **{source}**")
    L.append(f"Books loaded: {len(books):,}")
    L.append(f"Targets scanned (limit/offset filter): **{len(targets)}**")
    L.append(f"Sources: `{args.source}`  Score threshold: `{args.score_threshold}`\n")
    L.append("## Decisions\n")
    for k, v in sorted(decision_counts.items(), key=lambda x: -x[1]):
        L.append(f"- {k}: {v}")
    L.append("")
    L.append(f"## Top {min(25, len(would))} would_update (high-confidence) examples\n")
    L.append("| score | recs | title | author | source | identifier |")
    L.append("|------:|-----:|---|---|---|---|")
    for r in sorted(would, key=lambda r: -float(r["candidate_score"]))[:25]:
        L.append(f"| {r['candidate_score']:.2f} | {r['recommendation_count']} | {r['title']} | {r['author_name']} | {r['candidate_source']} | {r['candidate_identifier']} |")
    L.append("")
    L.append(f"## Top {min(25, len(low))} skip_low_confidence (needs manual review)\n")
    L.append("| score | recs | title | author | candidate title | candidate author | method |")
    L.append("|------:|-----:|---|---|---|---|---|")
    for r in sorted(low, key=lambda r: (-float(r["candidate_score"]), -r["recommendation_count"]))[:25]:
        L.append(f"| {r['candidate_score']:.2f} | {r['recommendation_count']} | {r['title']} | {r['author_name']} | {r['candidate_title']} | {r['candidate_author']} | {r['match_method']} |")
    L.append("")
    L.append("## Live write command (review preview first; DO NOT RUN UNTIL APPROVED)\n")
    L.append("```")
    L.append(f"python scripts/path1_cover_backfill.py \\")
    L.append(f"  --preview {preview_path} \\")
    L.append("  --write \\")
    L.append("  --confirm-cover-backfill \\")
    L.append(f"  --backup-before-write backups/cover_backfill_pre_{ts}.csv \\")
    L.append(f"  --score-threshold {args.score_threshold}")
    L.append("```")
    L.append("")
    with open(plan_md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")

    print()
    print("== summary ==")
    print(f"  scanned                  : {len(rows_out)}")
    for k, v in sorted(decision_counts.items(), key=lambda x: -x[1]):
        print(f"  {k:24s}: {v}")
    print(f"  preview CSV              : {preview_path}")
    print(f"  plan report (markdown)   : {plan_md_path}")
    print()
    print("NO DB WRITES. Review the preview, then run the live write command in the plan markdown.")
    return 0


# ────────────────────────────────────────────────────────────────────────────
# Write mode
# ────────────────────────────────────────────────────────────────────────────

def do_write(args: argparse.Namespace) -> int:
    # Gates
    if not args.confirm_cover_backfill:
        raise SystemExit("--write requires --confirm-cover-backfill")
    if not args.backup_before_write:
        raise SystemExit("--write requires --backup-before-write PATH")
    if not args.preview or not os.path.exists(args.preview):
        raise SystemExit(f"--write requires --preview PATH to an existing preview CSV (got: {args.preview!r})")
    url, key = _creds()
    if not url or not key:
        raise SystemExit("live write requires SUPABASE_URL + a key in env")

    with open(args.preview, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    would = [r for r in rows if r.get("decision") == "would_update" and float(r.get("candidate_score") or 0) >= args.score_threshold]
    print(f"== Cover backfill LIVE WRITE ==")
    print(f"preview rows total           : {len(rows)}")
    print(f"would_update at score >= {args.score_threshold} : {len(would)}")
    if not would:
        raise SystemExit("nothing to write at the given threshold (re-run plan with a different threshold).")

    # Pre-write backup of CURRENT cover_image_url for every target
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = args.backup_before_write
    parent = os.path.dirname(backup_path)
    if parent:
        os.makedirs(parent, exist_ok=True)

    backup_rows: List[Dict[str, Any]] = []
    print(f"[backup] fetching {len(would)} current rows live before any write…")
    plan_state: List[Dict[str, Any]] = []
    for r in would:
        live = supa_get_book(url, key, r["book_id"])
        if not live:
            r["_skip_reason"] = "live row missing"
            continue
        plan_state.append({"row": r, "live": live})
        backup_rows.append({
            "id": live.get("id", ""),
            "slug": live.get("slug", ""),
            "title": live.get("title", ""),
            "author_name": live.get("author_name", ""),
            "cover_image_url_before": live.get("cover_image_url", "") or "",
        })
    with open(backup_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["id", "slug", "title", "author_name", "cover_image_url_before"])
        w.writeheader()
        for b in backup_rows:
            w.writerow(b)
    if len(backup_rows) != len(plan_state):
        raise SystemExit("[backup] count mismatch — aborting before any write")
    print(f"[backup] wrote {len(backup_rows)} rows -> {backup_path}")

    # Write
    write_report_path = os.path.join(args.out_dir, f"cover_backfill_write_{ts}.csv")
    os.makedirs(args.out_dir, exist_ok=True)
    write_rows: List[Dict[str, Any]] = []
    updated = skipped = failed = 0
    for ps in plan_state:
        r = ps["row"]; live = ps["live"]
        out = {
            "book_id": live.get("id", ""),
            "slug": live.get("slug", ""),
            "title": live.get("title", ""),
            "cover_before": live.get("cover_image_url", "") or "",
            "cover_after": "",
            "candidate_score": r.get("candidate_score", ""),
            "candidate_source": r.get("candidate_source", ""),
            "match_method": r.get("match_method", ""),
            "status": "",
            "reason": "",
        }
        cur_cover = live.get("cover_image_url")
        if not is_missing_or_placeholder(cur_cover) and not args.include_existing:
            out["status"] = "skipped"
            out["reason"] = "current cover is no longer missing/placeholder; pass --include-existing to overwrite"
            skipped += 1
            write_rows.append(out)
            continue
        # Defensive title/author drift check vs preview
        prev_title = (r.get("title") or "").strip().lower()
        prev_author = (r.get("author_name") or "").strip().lower()
        live_title = (live.get("title") or "").strip().lower()
        live_author = (live.get("author_name") or "").strip().lower()
        if prev_title != live_title or (prev_author and live_author and prev_author != live_author):
            out["status"] = "skipped"
            out["reason"] = f"title/author drift since preview (was '{prev_title}' / '{prev_author}', now '{live_title}' / '{live_author}')"
            skipped += 1
            write_rows.append(out)
            continue
        try:
            supa_patch_cover(url, key, live["id"], r["candidate_cover_url"])
            out["cover_after"] = r["candidate_cover_url"]
            out["status"] = "updated"
            out["reason"] = f"score {r.get('candidate_score', '')}"
            updated += 1
        except Exception as e:
            out["status"] = "failed"
            out["reason"] = f"PATCH error: {type(e).__name__}: {str(e)[:120]}"
            failed += 1
        write_rows.append(out)
        if args.sleep > 0:
            time.sleep(args.sleep)

    cols = ["book_id", "slug", "title", "cover_before", "cover_after",
            "candidate_score", "candidate_source", "match_method", "status", "reason"]
    with open(write_report_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in write_rows:
            w.writerow(r)
    print()
    print(f"updated  : {updated}")
    print(f"skipped  : {skipped}")
    print(f"failed   : {failed}")
    print(f"backup   : {backup_path}")
    print(f"report   : {write_report_path}")
    return 0


# ────────────────────────────────────────────────────────────────────────────
# main
# ────────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--min-recommendations", type=int, default=10)
    ap.add_argument("--production-dir", default="", help="Optional offline books.csv source; uses backup if Supabase creds absent.")
    ap.add_argument("--out-dir", default="rebuild_v2")
    ap.add_argument("--preview", default="", help="Preview CSV from a prior dry-run (required for --write).")
    ap.add_argument("--source", choices=["google_books", "open_library", "both"], default="both")
    ap.add_argument("--score-threshold", type=float, default=0.82)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--confirm-cover-backfill", action="store_true")
    ap.add_argument("--backup-before-write", default="")
    ap.add_argument("--audit", action="store_true")
    ap.add_argument("--sleep", type=float, default=0.2)
    ap.add_argument("--max-results-per-source", type=int, default=5)
    ap.add_argument("--include-existing", action="store_true")
    args = ap.parse_args()

    if args.audit:
        return do_audit(args)
    if args.write:
        return do_write(args)
    return do_plan(args)


if __name__ == "__main__":
    raise SystemExit(main())
