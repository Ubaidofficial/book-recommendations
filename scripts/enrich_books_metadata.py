#!/usr/bin/env python3
"""
Enrich BookRecs book metadata from Google Books + Open Library.

Safe defaults:
- Dry-run by default.
- Small batches.
- Confidence scoring.
- No database writes unless --write is passed.

Environment variables for Supabase mode:
- SUPABASE_URL=https://your-project.supabase.co
- SUPABASE_SECRET_KEY=...        # required for --write; new Supabase server key
- SUPABASE_SERVICE_ROLE_KEY=...  # legacy fallback, if your project still has it
- SUPABASE_ANON_KEY=...          # okay for dry-run reads if RLS allows it
- GOOGLE_BOOKS_API_KEY=...       # optional, improves quota

Examples:
  python enrich_books_metadata.py --sample-title "Sapiens" --sample-author "Yuval Noah Harari"
  python enrich_books_metadata.py --limit 20 --dry-run
  python enrich_books_metadata.py --limit 1000 --write --min-score 0.78
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Optional, Tuple


GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes"
OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json"
DEFAULT_REPORT_PATH = "book_enrichment_report.csv"


def clean(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def normalize(value: Any) -> str:
    value = clean(value).lower()
    value = re.sub(r"[^\w\s]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def title_similarity(a: str, b: str) -> float:
    a_n = normalize(a)
    b_n = normalize(b)
    if not a_n or not b_n:
        return 0.0
    if a_n == b_n:
        return 1.0
    if a_n in b_n or b_n in a_n:
        return 0.88
    return SequenceMatcher(None, a_n, b_n).ratio()


def author_similarity(a: str, b: str) -> float:
    a_n = normalize(a)
    b_n = normalize(b)
    if not a_n or not b_n:
        return 0.0
    if a_n == b_n:
        return 1.0
    a_tokens = set(a_n.split())
    b_tokens = set(b_n.split())
    if not a_tokens or not b_tokens:
        return 0.0
    overlap = len(a_tokens & b_tokens) / max(len(a_tokens), len(b_tokens))
    seq = SequenceMatcher(None, a_n, b_n).ratio()
    return max(overlap, seq)


def http_json(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 20) -> Dict[str, Any]:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read().decode("utf-8")
    return json.loads(data)


def http_patch_json(url: str, payload: Dict[str, Any], headers: Dict[str, str], timeout: int = 30) -> Tuple[int, str]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="PATCH")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read().decode("utf-8")


def absolute_https(url: str) -> str:
    url = clean(url)
    if url.startswith("http://"):
        return "https://" + url[len("http://") :]
    return url


def google_books_search(title: str, author: str, api_key: str = "", max_results: int = 5) -> List[Dict[str, Any]]:
    query_parts = []
    if title:
        query_parts.append(f'intitle:"{title}"')
    if author:
        query_parts.append(f'inauthor:"{author}"')
    q = " ".join(query_parts) if query_parts else title
    params = {
        "q": q,
        "maxResults": str(max_results),
        "printType": "books",
    }
    if api_key:
        params["key"] = api_key
    url = GOOGLE_BOOKS_URL + "?" + urllib.parse.urlencode(params)
    try:
        data = http_json(url)
        return data.get("items", []) or []
    except Exception as exc:
        print(f"[warn] Google Books lookup failed for {title!r}: {exc}", file=sys.stderr)
        return []


def open_library_search(title: str, author: str, limit: int = 5) -> List[Dict[str, Any]]:
    params = {
        "title": title,
        "author": author,
        "language": "eng",
        "limit": str(limit),
    }
    url = OPEN_LIBRARY_SEARCH_URL + "?" + urllib.parse.urlencode(params)
    try:
        data = http_json(url)
        return data.get("docs", []) or []
    except Exception as exc:
        print(f"[warn] Open Library lookup failed for {title!r}: {exc}", file=sys.stderr)
        return []


def extract_google_candidate(item: Dict[str, Any], wanted_title: str, wanted_author: str) -> Dict[str, Any]:
    info = item.get("volumeInfo", {}) or {}
    title = clean(info.get("title"))
    subtitle = clean(info.get("subtitle"))
    authors = info.get("authors") or []
    author_text = ", ".join(clean(a) for a in authors if clean(a))

    identifiers = info.get("industryIdentifiers") or []
    isbn_10 = ""
    isbn_13 = ""
    for ident in identifiers:
        if ident.get("type") == "ISBN_10":
            isbn_10 = clean(ident.get("identifier"))
        if ident.get("type") == "ISBN_13":
            isbn_13 = clean(ident.get("identifier"))

    image_links = info.get("imageLinks") or {}
    cover_url = absolute_https(
        image_links.get("extraLarge")
        or image_links.get("large")
        or image_links.get("medium")
        or image_links.get("thumbnail")
        or image_links.get("smallThumbnail")
        or ""
    )

    t_score = title_similarity(wanted_title, title)
    a_score = author_similarity(wanted_author, author_text)
    score = (t_score * 0.68) + (a_score * 0.32 if wanted_author else 0.20)

    return {
        "source": "google_books",
        "source_id": clean(item.get("id")),
        "match_score": round(score, 4),
        "match_title_score": round(t_score, 4),
        "match_author_score": round(a_score, 4),
        "title": title,
        "subtitle": subtitle,
        "author": author_text,
        "description": clean(info.get("description")),
        "isbn_10": isbn_10,
        "isbn_13": isbn_13,
        "publisher": clean(info.get("publisher")),
        "published_date": clean(info.get("publishedDate")),
        "page_count": info.get("pageCount") if isinstance(info.get("pageCount"), int) else None,
        "language": clean(info.get("language")),
        "categories": " | ".join(clean(c) for c in (info.get("categories") or []) if clean(c)),
        "cover_url": cover_url,
    }


def extract_open_library_candidate(doc: Dict[str, Any], wanted_title: str, wanted_author: str) -> Dict[str, Any]:
    title = clean(doc.get("title"))
    authors = doc.get("author_name") or []
    author_text = ", ".join(clean(a) for a in authors if clean(a))
    isbn_list = [clean(x) for x in (doc.get("isbn") or []) if clean(x)]
    isbn_13 = next((x for x in isbn_list if len(re.sub(r"[^0-9Xx]", "", x)) == 13), "")
    isbn_10 = next((x for x in isbn_list if len(re.sub(r"[^0-9Xx]", "", x)) == 10), "")
    cover_url = ""
    if doc.get("cover_i"):
        cover_url = f"https://covers.openlibrary.org/b/id/{doc['cover_i']}-L.jpg"
    elif isbn_13:
        cover_url = f"https://covers.openlibrary.org/b/isbn/{urllib.parse.quote(isbn_13)}-L.jpg"
    elif isbn_10:
        cover_url = f"https://covers.openlibrary.org/b/isbn/{urllib.parse.quote(isbn_10)}-L.jpg"

    t_score = title_similarity(wanted_title, title)
    a_score = author_similarity(wanted_author, author_text)
    score = (t_score * 0.68) + (a_score * 0.32 if wanted_author else 0.20)

    languages = doc.get("language") or []
    if not isinstance(languages, list):
        languages = [languages]
    language = "eng" if "eng" in languages else clean(languages[0] if languages else "")

    return {
        "source": "open_library",
        "source_id": clean(doc.get("key")),
        "match_score": round(score, 4),
        "match_title_score": round(t_score, 4),
        "match_author_score": round(a_score, 4),
        "title": title,
        "subtitle": "",
        "author": author_text,
        "description": "",
        "isbn_10": isbn_10,
        "isbn_13": isbn_13,
        "publisher": clean((doc.get("publisher") or [""])[0] if isinstance(doc.get("publisher"), list) else doc.get("publisher")),
        "published_date": clean(doc.get("first_publish_year")),
        "page_count": None,
        "language": language,
        "categories": " | ".join(clean(s) for s in (doc.get("subject") or [])[:8] if clean(s)),
        "cover_url": cover_url,
    }


def pick_best_candidate(title: str, author: str, google_api_key: str = "") -> Optional[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []
    for item in google_books_search(title, author, api_key=google_api_key):
        candidates.append(extract_google_candidate(item, title, author))
    for doc in open_library_search(title, author):
        candidates.append(extract_open_library_candidate(doc, title, author))
    if not candidates:
        return None
    def candidate_rank(candidate: Dict[str, Any]) -> Tuple[float, int, int, int, int]:
        source_bonus = 1 if candidate.get("source") == "google_books" else 0
        english_bonus = 1 if candidate.get("language") in ("en", "eng") else 0
        description_bonus = 1 if candidate.get("description") else 0
        cover_bonus = 1 if candidate.get("cover_url") else 0
        return (
            float(candidate.get("match_score") or 0),
            english_bonus,
            source_bonus,
            description_bonus,
            cover_bonus,
        )

    candidates.sort(key=candidate_rank, reverse=True)
    best = candidates[0]

    # Merge useful fields from the best Google/OpenLibrary companion when same-ish book.
    for cand in candidates[1:]:
        if cand["match_score"] < 0.70:
            continue
        for field in ["cover_url", "description", "isbn_10", "isbn_13", "publisher", "published_date", "page_count", "language", "categories"]:
            if not best.get(field) and cand.get(field):
                best[field] = cand[field]
    return best


def supabase_headers(key: str) -> Dict[str, str]:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def supabase_read_key() -> str:
    return (
        os.environ.get("SUPABASE_SECRET_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_ANON_KEY")
        or ""
    )


def supabase_write_key() -> str:
    return os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""


def fetch_books_from_supabase(limit: int, offset: int = 0) -> List[Dict[str, Any]]:
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = supabase_read_key()
    if not supabase_url or not key:
        raise SystemExit("Missing SUPABASE_URL and SUPABASE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ANON_KEY.")

    select_cols = ",".join(
        [
            "id",
            "title",
            "author_name",
            "description",
            "cover_image_url",
            "isbn_10",
            "isbn_13",
            "publisher",
            "page_count",
            "language",
            "google_books_id",
            "open_library_id",
            "recommendation_count",
            "quality_score",
        ]
    )
    params = {
        "select": select_cols,
        "order": "recommendation_count.desc.nullslast,quality_score.desc.nullslast,title.asc",
        "limit": str(limit),
        "offset": str(offset),
    }
    url = f"{supabase_url}/rest/v1/books?" + urllib.parse.urlencode(params)
    return http_json(url, headers=supabase_headers(key))


def build_update_payload(book: Dict[str, Any], candidate: Dict[str, Any], overwrite: bool = False) -> Dict[str, Any]:
    payload: Dict[str, Any] = {}

    def maybe_set(db_col: str, candidate_field: str) -> None:
        new_value = candidate.get(candidate_field)
        if new_value in ("", None, []):
            return
        current = book.get(db_col)
        if overwrite or current in ("", None):
            payload[db_col] = new_value

    maybe_set("description", "description")
    maybe_set("cover_image_url", "cover_url")
    maybe_set("isbn_10", "isbn_10")
    maybe_set("isbn_13", "isbn_13")
    maybe_set("publisher", "publisher")
    maybe_set("page_count", "page_count")
    maybe_set("language", "language")

    if candidate.get("source") == "google_books" and candidate.get("source_id") and (overwrite or not book.get("google_books_id")):
        payload["google_books_id"] = candidate["source_id"]
    if candidate.get("source") == "open_library" and candidate.get("source_id") and (overwrite or not book.get("open_library_id")):
        payload["open_library_id"] = candidate["source_id"]
    elif candidate.get("source_id", "").startswith("/works/") and (overwrite or not book.get("open_library_id")):
        payload["open_library_id"] = candidate["source_id"]

    payload["last_enriched_at"] = dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    return payload


def update_book_in_supabase(book_id: str, payload: Dict[str, Any]) -> None:
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = supabase_write_key()
    if not supabase_url or not key:
        raise SystemExit("Writes require SUPABASE_URL and SUPABASE_SECRET_KEY or legacy SUPABASE_SERVICE_ROLE_KEY.")
    url = f"{supabase_url}/rest/v1/books?id=eq.{urllib.parse.quote(book_id)}"
    http_patch_json(url, payload, headers=supabase_headers(key))


def report_row(book: Dict[str, Any], candidate: Optional[Dict[str, Any]], payload: Dict[str, Any], status: str) -> Dict[str, Any]:
    candidate = candidate or {}
    return {
        "status": status,
        "book_id": book.get("id", ""),
        "book_title": book.get("title", ""),
        "book_author": book.get("author_name", ""),
        "source": candidate.get("source", ""),
        "source_id": candidate.get("source_id", ""),
        "match_score": candidate.get("match_score", ""),
        "matched_title": candidate.get("title", ""),
        "matched_author": candidate.get("author", ""),
        "cover_url": candidate.get("cover_url", ""),
        "isbn_10": candidate.get("isbn_10", ""),
        "isbn_13": candidate.get("isbn_13", ""),
        "fields_to_update": " | ".join(sorted(payload.keys())),
    }


def write_report(rows: List[Dict[str, Any]], path: str) -> None:
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def run_sample(title: str, author: str, min_score: float) -> int:
    print(f"Sample lookup: {title} / {author}")
    candidate = pick_best_candidate(title, author, os.environ.get("GOOGLE_BOOKS_API_KEY", ""))
    if not candidate:
        print("No candidate found.")
        return 1
    print(json.dumps(candidate, indent=2, ensure_ascii=False))
    if candidate["match_score"] < min_score:
        print(f"LOW CONFIDENCE: {candidate['match_score']} < {min_score}")
        return 2
    print("Sample verification passed.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Enrich BookRecs books with Google Books/Open Library metadata.")
    parser.add_argument("--limit", type=int, default=20, help="Number of Supabase books to process.")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--min-score", type=float, default=0.76, help="Minimum match score required to update.")
    parser.add_argument("--sleep", type=float, default=0.15, help="Delay between books to be polite to APIs.")
    parser.add_argument("--write", action="store_true", help="Actually update Supabase. Default is dry-run.")
    parser.add_argument("--dry-run", action="store_true", help="Explicit dry-run flag for clarity.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing DB fields. Default only fills missing fields.")
    parser.add_argument("--report", default=DEFAULT_REPORT_PATH)
    parser.add_argument("--sample-title", default="", help="Run a single public API lookup without Supabase.")
    parser.add_argument("--sample-author", default="")
    args = parser.parse_args()

    if args.sample_title:
        return run_sample(args.sample_title, args.sample_author, args.min_score)

    write_enabled = bool(args.write)
    if not write_enabled:
        print("[mode] DRY RUN. No database writes. Pass --write to update Supabase.")

    books = fetch_books_from_supabase(args.limit, args.offset)
    print(f"Fetched {len(books)} books from Supabase.")

    report_rows: List[Dict[str, Any]] = []
    updated = 0
    skipped = 0
    low_confidence = 0
    no_match = 0

    for i, book in enumerate(books, start=1):
        title = clean(book.get("title"))
        author = clean(book.get("author_name"))
        print(f"[{i}/{len(books)}] {title} — {author}")
        if not title:
            skipped += 1
            report_rows.append(report_row(book, None, {}, "skipped_no_title"))
            continue

        candidate = pick_best_candidate(title, author, os.environ.get("GOOGLE_BOOKS_API_KEY", ""))
        if not candidate:
            no_match += 1
            report_rows.append(report_row(book, None, {}, "no_match"))
            time.sleep(args.sleep)
            continue

        payload = build_update_payload(book, candidate, overwrite=args.overwrite)
        if candidate["match_score"] < args.min_score:
            low_confidence += 1
            report_rows.append(report_row(book, candidate, payload, "low_confidence"))
            time.sleep(args.sleep)
            continue

        if not payload or set(payload.keys()) == {"last_enriched_at"}:
            skipped += 1
            report_rows.append(report_row(book, candidate, payload, "no_missing_fields"))
            time.sleep(args.sleep)
            continue

        if write_enabled:
            update_book_in_supabase(book["id"], payload)
            status = "updated"
        else:
            status = "dry_run_update"
        updated += 1
        report_rows.append(report_row(book, candidate, payload, status))
        time.sleep(args.sleep)

    write_report(report_rows, args.report)
    print(
        json.dumps(
            {
                "processed": len(books),
                "candidate_updates": updated,
                "skipped": skipped,
                "low_confidence": low_confidence,
                "no_match": no_match,
                "write_enabled": write_enabled,
                "report": args.report,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
