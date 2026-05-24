#!/usr/bin/env python3
"""
Sync BookRecs cover_image_url values to Supabase Storage public URLs.

What this script does:
- Lists actual uploaded files in a Supabase Storage bucket.
- Builds public URLs using exact uploaded object paths.
- Updates only books whose current cover_image_url exactly equals an uploaded filename.
- Skips rows already using http/https URLs.
- Writes CSV reports so failed/unmatched rows are not lost.

Environment variables:
- SUPABASE_URL=https://your-project.supabase.co
- SUPABASE_SECRET_KEY=sb_secret_...        # preferred
- SUPABASE_SERVICE_ROLE_KEY=...            # legacy fallback

Examples:
  python sync_storage_cover_urls.py --dry-run
  python sync_storage_cover_urls.py --write --bucket book-covers
  python sync_storage_cover_urls.py --write --bucket book-covers --prefix "Books Images"
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterable, List, Optional, Tuple


DEFAULT_BUCKET = "book-covers"
DEFAULT_REPORT = "storage_cover_sync_report.csv"
DEFAULT_UNMATCHED_REPORT = "storage_cover_unmatched_files.csv"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def supabase_url() -> str:
    value = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not value:
        raise SystemExit("Missing SUPABASE_URL.")
    return value


def supabase_key() -> str:
    value = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not value:
        raise SystemExit("Missing SUPABASE_SECRET_KEY or legacy SUPABASE_SERVICE_ROLE_KEY.")
    return value


def headers(prefer: str = "return=minimal") -> Dict[str, str]:
    key = supabase_key()
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def http_json(url: str, method: str = "GET", payload: Optional[Dict[str, Any]] = None, prefer: str = "return=minimal") -> Any:
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers(prefer=prefer), method=method)
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")
    if not raw:
        return None
    return json.loads(raw)


def object_public_url(bucket: str, object_path: str) -> str:
    encoded_path = urllib.parse.quote(object_path, safe="/")
    return f"{supabase_url()}/storage/v1/object/public/{urllib.parse.quote(bucket)}/{encoded_path}"


def file_basename(object_path: str) -> str:
    return object_path.split("/")[-1]


def is_image_file(name: str) -> bool:
    lower = name.lower()
    return any(lower.endswith(ext) for ext in IMAGE_EXTENSIONS)


def list_storage_page(bucket: str, prefix: str, limit: int, offset: int) -> List[Dict[str, Any]]:
    url = f"{supabase_url()}/storage/v1/object/list/{urllib.parse.quote(bucket)}"
    payload = {
        "limit": limit,
        "offset": offset,
        "prefix": prefix.strip("/"),
        "sortBy": {"column": "name", "order": "asc"},
    }
    result = http_json(url, method="POST", payload=payload)
    return result or []


def list_storage_objects(bucket: str, prefix: str = "", page_size: int = 1000) -> List[str]:
    """Return object paths from a bucket, recursively handling folders."""
    found: List[str] = []
    queue: List[str] = [prefix.strip("/")]

    while queue:
        current_prefix = queue.pop(0)
        offset = 0
        while True:
            page = list_storage_page(bucket, current_prefix, page_size, offset)
            if not page:
                break

            for item in page:
                name = clean(item.get("name"))
                if not name:
                    continue

                object_path = f"{current_prefix}/{name}".strip("/")
                metadata = item.get("metadata")
                object_id = item.get("id")

                # Supabase returns folders as entries without object metadata/id.
                if not object_id and not metadata:
                    queue.append(object_path)
                    continue

                if is_image_file(object_path):
                    found.append(object_path)

            if len(page) < page_size:
                break
            offset += page_size

    return sorted(set(found))


def fetch_books_by_filename(filename: str, limit: int = 1000) -> List[Dict[str, Any]]:
    params = {
        "select": "id,title,author_name,cover_image_url",
        "cover_image_url": f"eq.{filename}",
        "limit": str(limit),
    }
    url = f"{supabase_url()}/rest/v1/books?" + urllib.parse.urlencode(params)
    result = http_json(url, method="GET", prefer="return=representation")
    return result or []


def fetch_local_cover_books(page_size: int = 1000) -> List[Dict[str, Any]]:
    """Fetch books that still have local filename-style cover values.

    This avoids querying Supabase once per weird filename. Some filenames contain
    punctuation that can trigger PostgREST filter parsing issues, so we fetch the
    small fields we need and match locally in Python.
    """
    rows: List[Dict[str, Any]] = []
    offset = 0
    while True:
        params = {
            "select": "id,title,author_name,cover_image_url",
            "cover_image_url": "not.is.null",
            "limit": str(page_size),
            "offset": str(offset),
            "order": "title.asc",
        }
        url = f"{supabase_url()}/rest/v1/books?" + urllib.parse.urlencode(params)
        page = http_json(url, method="GET", prefer="return=representation") or []
        if not page:
            break

        for row in page:
            cover_value = clean(row.get("cover_image_url"))
            if cover_value and not re.match(r"^https?://", cover_value, flags=re.IGNORECASE) and is_image_file(cover_value):
                rows.append(row)

        if len(page) < page_size:
            break
        offset += page_size
        if offset % 10000 == 0:
            print(f"Fetched {offset} book rows from DB...")

    return rows


def update_books_for_filename(filename: str, public_url: str) -> int:
    params = {
        "cover_image_url": f"eq.{filename}",
    }
    url = f"{supabase_url()}/rest/v1/books?" + urllib.parse.urlencode(params)
    payload = {"cover_image_url": public_url}
    http_json(url, method="PATCH", payload=payload, prefer="return=minimal")
    return 1


def write_csv(path: str, rows: List[Dict[str, Any]]) -> None:
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync exact uploaded Supabase Storage covers to books.cover_image_url.")
    parser.add_argument("--bucket", default=DEFAULT_BUCKET)
    parser.add_argument("--prefix", default="", help="Optional folder/prefix inside the bucket.")
    parser.add_argument("--write", action="store_true", help="Actually update Supabase. Default is dry-run.")
    parser.add_argument("--dry-run", action="store_true", help="Explicit dry-run flag for clarity.")
    parser.add_argument("--limit-files", type=int, default=0, help="Optional max files to process for testing.")
    parser.add_argument("--report", default=DEFAULT_REPORT)
    parser.add_argument("--unmatched-report", default=DEFAULT_UNMATCHED_REPORT)
    args = parser.parse_args()

    write_enabled = bool(args.write)
    if not write_enabled:
        print("[mode] DRY RUN. No database writes. Pass --write to update Supabase.")

    print(f"Listing uploaded image objects from bucket={args.bucket!r}, prefix={args.prefix!r}...")
    object_paths = list_storage_objects(args.bucket, args.prefix)
    if args.limit_files:
        object_paths = object_paths[: args.limit_files]
    print(f"Found {len(object_paths)} uploaded image objects.")

    print("Fetching local filename cover values from books table...")
    local_cover_books = fetch_local_cover_books()
    books_by_filename: Dict[str, List[Dict[str, Any]]] = {}
    for book in local_cover_books:
        books_by_filename.setdefault(clean(book.get("cover_image_url")), []).append(book)
    print(f"Found {len(local_cover_books)} book rows with local image filenames.")

    report_rows: List[Dict[str, Any]] = []
    unmatched_rows: List[Dict[str, Any]] = []
    matched_files = 0
    matched_book_rows = 0
    updated_files = 0

    for index, object_path in enumerate(object_paths, start=1):
        filename = file_basename(object_path)
        public_url = object_public_url(args.bucket, object_path)
        books = books_by_filename.get(filename, [])

        if not books:
            unmatched_rows.append(
                {
                    "object_path": object_path,
                    "filename": filename,
                    "public_url": public_url,
                    "status": "no_matching_book_filename",
                }
            )
            continue

        matched_files += 1
        matched_book_rows += len(books)
        status = "dry_run_match"

        if write_enabled:
            update_books_for_filename(filename, public_url)
            updated_files += 1
            status = "updated"

        for book in books:
            report_rows.append(
                {
                    "status": status,
                    "object_path": object_path,
                    "filename": filename,
                    "public_url": public_url,
                    "book_id": book.get("id", ""),
                    "book_title": book.get("title", ""),
                    "book_author": book.get("author_name", ""),
                    "old_cover_image_url": book.get("cover_image_url", ""),
                }
            )

        if index % 100 == 0:
            print(f"Processed {index}/{len(object_paths)} files...")

    write_csv(args.report, report_rows)
    write_csv(args.unmatched_report, unmatched_rows)

    print(
        json.dumps(
            {
                "uploaded_image_objects": len(object_paths),
                "matched_files": matched_files,
                "matched_book_rows": matched_book_rows,
                "updated_files": updated_files,
                "write_enabled": write_enabled,
                "report": args.report,
                "unmatched_report": args.unmatched_report,
                "unmatched_uploaded_files": len(unmatched_rows),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
