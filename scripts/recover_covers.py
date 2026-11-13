#!/usr/bin/env python3
# Cover recovery for SHOWN books whose cover is missing, broken, or a placeholder.
#
# SAFETY MODEL
#   - DRY-RUN BY DEFAULT. Reads Supabase with the publishable key, downloads
#     images only to measure them, writes a CSV report. No DB writes. No storage
#     uploads. Ever, unless the write gates below all pass.
#   - Write path (NOT run by default) needs ALL of:
#       --write  AND  --confirm  AND  SUPABASE_SECRET_KEY in the environment.
#     It reads the reviewed dry-run CSV (--from-csv), writes a JSON backup of the
#     live prior values FIRST, re-checks every row's live value before its PATCH
#     (drift check), re-validates the candidate image, and only touches
#     books.cover_image_url. confidence=high rows only; medium needs the extra
#     --include-medium flag.
#   - Precision over recall (taste rule: never show a cover that does not match
#     the book). Candidates need an exact or near-exact title match AND an author
#     surname match AND an image that passes validation; anything else is skipped.
#
# WHAT "SHOWN" MEANS
#   books.index_status='published'
#   UNION books on lists with lists.index_status='published'      (book_lists)
#   UNION books recommended by people with people.index_status='published'
#                                                       (book_recommendations)
#
# CURRENT COVER STATES
#   ok             URL downloads and looks like a real cover
#   bare_filename  cover_image_url is not a URL (e.g. "The Power of Less.png");
#                  the frontend cannot render it
#   empty          null / blank
#   placeholder    URL is broken or serves a placeholder: HTTP error, not an
#                  image, tiny (<100px wide, e.g. Amazon's 1x1 gif), a thin
#                  "preview unavailable" strip, a near-uniform (flat grey) image,
#                  or Google's "image not available" (matched by average-hash)
#   The image downloads fine, but (re-sourced; replaced only by a HIGH candidate):
#   google           any Google Books URL. zoom=3 often serves a scanned title or
#                    praise page or Google's grey "no cover" art. The detail column
#                    notes the text-page heuristic below.
#   foreign          a non-English edition: Amazon /images/P/<ISBN-10> outside
#                    group 0/1 (2=French, 3=German, 84=Spain, 88=Italy, 7=China...),
#                    an OL /b/isbn/ outside 978-0/978-1, or an OL /b/id/ cover whose
#                    edition (covers.openlibrary.org/b/id/<id>.json -> olid ->
#                    /books/<olid>.json) has languages without eng
#   maybe_not_cover  OL cover imported from an Internet Archive title-page scan
#                    (source_url .../page/title.jpg); with --text-page-all also
#                    the text-page heuristic (HSV saturation < 0.03, >= 70% near-
#                    white) on OL/storage covers. Flag only: never replaced unless a
#                    high-confidence replacement exists.
#
# CANDIDATE SOURCES (in order). ENGLISH EDITIONS ONLY.
#   1. supabase_storage   bare filename that DOES exist in the book-covers bucket
#   2. openlibrary_cover  Open Library search.json (title+author) -> work ->
#                         /works/<key>/editions.json (50 per page, up to 3 pages) ->
#                         covers of editions whose languages include eng (or that
#                         list no language and carry only group-0/1 ISBNs) AND whose
#                         own title matches the book. Editions with an English ISBN
#                         first, then the work's own cover. Covers that OL imported
#                         from an Internet Archive title-page scan are rejected.
#   3. amazon_isbn        ISBN-10s in group 0/1 (978-0 / 978-1) from those English
#                         editions, then from the matched OL doc -> Amazon large image
#   4. db_isbn            the book's own ISBN if group 0/1 (OL cover by ISBN, then
#                         Amazon); capped at medium because the title is not re-verified
#   5. google_books       optional (--google-fallback); language unverified, so
#                         medium at most; disabled for the run on the first HTTP 429
#
# CONFIDENCE
#   high    exact normalized title (subtitle/punctuation/case/leading article
#           stripped) + author surname match + valid image
#   medium  title similarity >= 0.9, or a word-prefix match of >= 3 words,
#           + author surname match + valid image; or db_isbn
#   none    nothing safe found (reason column says why)
#
# Candidate image validation: HTTP 200, decodable, width >= 180,
# height/width in [1.2, 1.8], not near-uniform, not a known placeholder hash.
#
# USAGE
#   # Census of the whole shown set (classification only, cached)
#   python3 -I scripts/recover_covers.py --census
#
#   # Dry-run, most-viewed non-ok books first
#   python3 -I scripts/recover_covers.py --priority --limit 400
#   # Whole missing/placeholder backlog, resumable (keeps rows already in <out>.partial)
#   python3 -I scripts/recover_covers.py --priority --no-suspect \
#       --only-state bare_filename,empty,placeholder --out reports/cover_recovery_full.csv --resume
#   # Re-source Google / foreign-edition / title-page-scan covers
#   python3 -I scripts/recover_covers.py --priority --only-state google,foreign,maybe_not_cover
#   python3 -I scripts/recover_covers.py --only-state bare_filename,empty --limit 50
#   python3 -I scripts/recover_covers.py --slug atomic-habits-james-clear
#
#   # Future live write (DO NOT RUN until the CSV has been reviewed)
#   SUPABASE_SECRET_KEY=... python3 -I scripts/recover_covers.py \
#       --write --confirm --from-csv reports/cover_recovery_dryrun.csv
#
# Caches (gitignored): reports/cover_recovery_cache/  (image metadata + OL JSON).
# Delete the directory to force fresh lookups.

from __future__ import annotations

import argparse
import concurrent.futures as cf
import csv
import difflib
import hashlib
import io
import json
import os
import random
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from path1_match import fold as _fold, strip_subtitle as _strip_subtitle  # noqa: E402

try:
    from PIL import Image, ImageStat
except ImportError:  # pragma: no cover
    raise SystemExit("Pillow is required: pip install Pillow")

csv.field_size_limit(10**9)

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUPABASE_URL = "https://ghpdpvatfmvsahzsqgpp.supabase.co"
READ_KEY = "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z"  # same as upgrade_cover_resolution.js
BUCKET = "book-covers"
USER_AGENT = "BookMentions-CoverRecovery/1.0 (read-only cover audit; python-urllib)"

DEFAULT_OUT = os.path.join(PROJECT, "reports", "cover_recovery_dryrun.csv")
CENSUS_OUT = os.path.join(PROJECT, "reports", "cover_census.csv")
CACHE_DIR = os.path.join(PROJECT, "reports", "cover_recovery_cache")
CENSUS_PATH = {"p": CENSUS_OUT}
BACKUP_DIR = os.path.join(PROJECT, "backups")

MAX_WORKERS = 3
MIN_CAND_WIDTH = 180
MIN_RATIO, MAX_RATIO = 1.2, 1.8
UNIFORM_STD = 3.0          # grayscale stddev on a 32x32 thumbnail
AHASH_MAX_DIST = 6         # Hamming distance (of 64 bits) to a known placeholder
FUZZY_MIN = 0.90
MAX_IMAGE_TRIES = 8     # candidate image downloads per book

# Average-hashes (8x8 grayscale, LANCZOS, bit=pixel>=mean) of known placeholder art.
KNOWN_PLACEHOLDER_HASHES = {
    # books.google.com/books/content?id=tVX00AEACAAJ&...&zoom=3 ("image not available", 575x750)
    "google_image_not_available": 0xFFDF81E7E700FFFF,
}

OUT_COLUMNS = [
    "book_id", "slug", "title", "author", "current_state", "current_url",
    "candidate_url", "candidate_source", "match_title", "match_author",
    "title_score", "confidence", "width", "height", "reason",
    "recommendation_count",
]
CENSUS_COLUMNS = [
    "book_id", "slug", "title", "author", "recommendation_count", "host",
    "current_state", "detail", "width", "height", "current_url",
]

_print_lock = threading.Lock()


def log(*a: Any) -> None:
    with _print_lock:
        print(*a, flush=True)


# ────────────────────────────────────────────────────────────────────────────
# HTTP (polite: generic UA, one retry with backoff, bounded body size)
# ────────────────────────────────────────────────────────────────────────────

class Fetch:
    __slots__ = ("status", "body", "final_url", "ctype", "error")

    def __init__(self, status: int, body: bytes = b"", final_url: str = "", ctype: str = "", error: str = ""):
        self.status, self.body, self.final_url, self.ctype, self.error = status, body, final_url, ctype, error


def http_get(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 25,
             max_bytes: int = 15 * 1024 * 1024, retries: int = 1) -> Fetch:
    h = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    h.update(headers or {})
    last = Fetch(0, error="not attempted")
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=h, method="GET")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read(max_bytes + 1)
                if len(body) > max_bytes:
                    return Fetch(resp.status, b"", resp.geturl(), resp.headers.get("Content-Type", ""), "body too large")
                return Fetch(resp.status, body, resp.geturl(), resp.headers.get("Content-Type", ""))
        except urllib.error.HTTPError as e:
            last = Fetch(e.code, b"", url, "", f"HTTP {e.code}")
            if e.code not in (429, 500, 502, 503, 504):
                return last
            wait = 2.0 * (attempt + 1)
            ra = e.headers.get("Retry-After") if e.headers else None
            if ra and ra.isdigit():
                wait = min(float(ra), 10.0)
        except Exception as e:  # timeouts, resets, DNS
            last = Fetch(0, b"", url, "", f"{type(e).__name__}: {str(e)[:100]}")
            wait = 2.0 * (attempt + 1)
        if attempt < retries:
            time.sleep(wait + random.random())
    return last


def is_transient(f: Fetch) -> bool:
    return f.status == 0 or f.status == 429 or f.status >= 500


# ────────────────────────────────────────────────────────────────────────────
# Disk cache (metadata only; atomic per-file writes so threads are safe)
# ────────────────────────────────────────────────────────────────────────────

def _cache_path(kind: str, key: str) -> str:
    h = hashlib.sha1(key.encode("utf-8")).hexdigest()
    return os.path.join(CACHE_DIR, kind, h[:2], h + ".json")


def cache_get(kind: str, key: str) -> Optional[Any]:
    p = _cache_path(kind, key)
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def cache_put(kind: str, key: str, value: Any) -> None:
    p = _cache_path(kind, key)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = f"{p}.{threading.get_ident()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(value, f)
    os.replace(tmp, p)


# ────────────────────────────────────────────────────────────────────────────
# Image measurement + placeholder detection
# ────────────────────────────────────────────────────────────────────────────

def ahash(im: "Image.Image") -> int:
    g = im.convert("L").resize((8, 8), Image.Resampling.LANCZOS)
    px = list(g.tobytes())
    mean = sum(px) / len(px)
    v = 0
    for p in px:
        v = (v << 1) | (1 if p >= mean else 0)
    return v


META_VERSION = 3  # bump when analyze_bytes gains features; older cache entries are re-measured


def coming_soon_features(im: "Image.Image") -> Dict[str, Any]:
    """Amazon's generated "COVER COMING SOON" art: a navy book shape (~#213B60) on white,
    with the title typeset in white. The text varies per title, so an average-hash does
    not catch it; dominant-navy share + white corners does."""
    small = im.resize((70, 100))
    px = list(zip(*[iter(small.tobytes())] * 3))
    navy = sum(1 for r, g, b in px if abs(r - 31) < 22 and abs(g - 57) < 22 and abs(b - 93) < 26)
    w, h = small.size
    corners = [small.getpixel((1, 1)), small.getpixel((1, h - 2))]  # left edge: page block is white
    return {"navy_frac": round(navy / len(px), 3),
            "corners_white": all(min(c) >= 235 for c in corners)}


def analyze_bytes(body: bytes) -> Dict[str, Any]:
    out: Dict[str, Any] = {"bytes": len(body), "v": META_VERSION}
    try:
        im = Image.open(io.BytesIO(body))
        out["width"], out["height"] = im.size
        out["format"] = im.format or ""
        im.draft("RGB", (256, 256))  # fast JPEG decode at reduced scale
        im = im.convert("RGB")
        out["ahash"] = f"{ahash(im):016x}"
        out["std"] = round(ImageStat.Stat(im.convert("L").resize((32, 32))).stddev[0], 2)
        out.update(coming_soon_features(im))
        out["decodable"] = True
    except Exception as e:
        out["decodable"] = False
        out["decode_error"] = f"{type(e).__name__}: {str(e)[:80]}"
    return out


def measure_image(url: str, use_cache: bool = True) -> Dict[str, Any]:
    """Download + measure. Definitive results (2xx/4xx) are cached; transient errors are not."""
    if use_cache:
        hit = cache_get("img", url)
        if hit is not None and (hit.get("v") == META_VERSION or not hit.get("decodable")):
            return hit
    f = http_get(url)
    meta: Dict[str, Any] = {"url": url, "status": f.status, "final_url": f.final_url,
                            "ctype": f.ctype, "error": f.error}
    if f.status == 200 and f.body:
        meta.update(analyze_bytes(f.body))
    elif f.status == 200:
        meta.update({"bytes": 0, "decodable": False})
    if not is_transient(f):
        cache_put("img", url, meta)
    return meta


def _hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def placeholder_reason(meta: Dict[str, Any]) -> Optional[str]:
    """None if the image looks like a real cover; else a short reason tag."""
    st = meta.get("status")
    if st != 200:
        return f"http_{st}" if st else f"fetch_error ({meta.get('error', '')[:60]})"
    if not meta.get("decodable"):
        return "not_an_image"
    w, h = int(meta.get("width") or 0), int(meta.get("height") or 0)
    if w < 100 or h < 100 or int(meta.get("bytes") or 0) < 500:
        return f"tiny_{w}x{h}"
    if h / max(1, w) < 0.5:
        return f"strip_{w}x{h}"
    if float(meta.get("std") or 0) < UNIFORM_STD:
        return f"near_uniform (std={meta.get('std')})"
    if ("amazon" in (meta.get("url") or "") and float(meta.get("navy_frac") or 0) >= 0.45
            and meta.get("corners_white")):
        return "known_placeholder:amazon_cover_coming_soon"
    ah = meta.get("ahash")
    if ah:
        v = int(ah, 16)
        for name, known in KNOWN_PLACEHOLDER_HASHES.items():
            if _hamming(v, known) <= AHASH_MAX_DIST:
                return f"known_placeholder:{name}"
    return None


def validate_candidate(meta: Dict[str, Any]) -> Optional[str]:
    """None if acceptable as a NEW cover; else rejection reason."""
    r = placeholder_reason(meta)
    if r:
        return r
    w, h = int(meta["width"]), int(meta["height"])
    if w < MIN_CAND_WIDTH:
        return f"too_small_{w}x{h}"
    ratio = h / w
    if not (MIN_RATIO <= ratio <= MAX_RATIO):
        return f"bad_aspect_{ratio:.2f}"
    return None


def host_label(url: str) -> str:
    u = (url or "").lower()
    if not u.strip():
        return "none"
    if not re.match(r"^https?://", u):
        return "bare"
    if "books.google" in u or "googleusercontent" in u or "googleapis" in u:
        return "google"
    if "amazon" in u or "media-amazon" in u:
        return "amazon"
    if "openlibrary" in u or "archive.org" in u:
        return "openlibrary"
    if "supabase.co/storage" in u:
        return "supabase"
    return "other"


def page_features(url: str) -> Dict[str, Any]:
    """Cheap "is this a scanned title/praise page rather than cover art" signals
    (cached): mean HSV saturation, share of near-white pixels, and a text-likeness
    score (share of dark pixels in a mostly-white image)."""
    hit = cache_get("feat", url)
    if hit is not None:
        return hit
    f = http_get(url)
    out: Dict[str, Any] = {"status": f.status}
    if f.status == 200 and f.body:
        try:
            im = Image.open(io.BytesIO(f.body))
            im.draft("RGB", (256, 256))
            im = im.convert("RGB").resize((100, 150))
            hsv = list(im.convert("HSV").getdata())
            rgb = list(im.getdata())
            n = len(rgb)
            out["sat"] = round(sum(p[1] for p in hsv) / n / 255, 3)
            out["white"] = round(sum(1 for r, g, b in rgb if min(r, g, b) >= 225) / n, 3)
            out["dark"] = round(sum(1 for r, g, b in rgb if max(r, g, b) <= 90) / n, 3)
        except Exception as e:
            out["error"] = f"{type(e).__name__}"
    if not is_transient(f):
        cache_put("feat", url, out)
    return out


def looks_like_text_page(feat: Dict[str, Any]) -> bool:
    """Very low saturation + a large white area + some dark (text) pixels: a scanned
    title page or praise page. Flag only; never replaced on this signal alone."""
    return ("sat" in feat and feat["sat"] < 0.03 and feat["white"] >= 0.70
            and feat["dark"] <= 0.25)


TEXT_PAGE_ALL = {"on": False}  # --text-page-all: also run the text-page heuristic on OL/storage covers

_AMZ_P = re.compile(r"/images/P/([0-9A-Za-z]{10})\.", re.I)
_OL_ID = re.compile(r"covers\.openlibrary\.org/b/id/(\d+)", re.I)
_OL_ISBN = re.compile(r"covers\.openlibrary\.org/b/isbn/([0-9Xx-]+)", re.I)
_OL_OLID = re.compile(r"covers\.openlibrary\.org/b/olid/(OL\d+M)", re.I)


def suspect_reason(url: str, check_ol: bool = True, check_text_page: bool = True) -> Tuple[str, str]:
    """For a cover that downloads fine ("ok"): ('google'|'foreign'|'maybe_not_cover'|'', detail).
    google           any Google Books URL (zoom=3 often serves a title/praise page or grey art)
    foreign          Amazon ISBN-10 outside group 0/1, or an OL cover whose edition is not English
    maybe_not_cover  heuristic text-page signal on an OL/storage cover (flag only)"""
    host = host_label(url)
    if host == "google":
        det = "google books url"
        if check_text_page:
            ft = page_features(url)
            if looks_like_text_page(ft):
                det += f"; looks like text page (sat={ft['sat']} white={ft['white']})"
        return "google", det
    if host == "amazon":
        m = _AMZ_P.search(url)
        if m and isbn_is_english(m.group(1)) is False:
            return "foreign", f"amazon isbn10 {m.group(1)} group {isbn_group(m.group(1))}"
        return "", ""
    if host == "openlibrary":
        m = _OL_ISBN.search(url)
        if m and isbn_is_english(m.group(1)) is False:
            return "foreign", f"ol isbn {m.group(1)} group {isbn_group(m.group(1))}"
        m = _OL_ID.search(url)
        if m and check_ol:
            ed = ol_cover_edition(int(m.group(1)))
            if ed and not edition_is_english(ed) and (ed.get("langs") or ed.get("isbn")):
                lab = ",".join(ed.get("langs") or []) or "isbn " + ",".join(isbn_group(i) for i in ed.get("isbn") or [])
                return "foreign", f"ol cover {m.group(1)} from {ed.get('olid')} ({lab}): {str(ed.get('title'))[:40]}"
            if ol_cover_scan_reason(int(m.group(1))):
                return "maybe_not_cover", f"ol cover {m.group(1)} is an Internet Archive title-page scan"
    if check_text_page and TEXT_PAGE_ALL["on"] and host in ("openlibrary", "supabase"):
        ft = page_features(url)
        if looks_like_text_page(ft):
            return "maybe_not_cover", f"text-page heuristic sat={ft['sat']} white={ft['white']} dark={ft['dark']}"
    return "", ""


def classify(book: Dict[str, Any]) -> Tuple[str, str, Dict[str, Any]]:
    """(state, detail, image_meta)."""
    u = (book.get("cover_image_url") or "").strip()
    if not u or u.lower() in ("null", "none"):
        return "empty", "", {}
    if not re.match(r"^https?://", u, re.I):
        return "bare_filename", "not a URL (bare storage filename)", {}
    meta = measure_image(u)
    r = placeholder_reason(meta)
    if r:
        return "placeholder", r, meta
    if SUSPECT_CHECK["on"]:
        st, det = suspect_reason(u)
        if st:
            return st, det, meta
    return "ok", "", meta


SUSPECT_CHECK = {"on": True}  # --no-suspect turns off the google/foreign/text-page checks


# ────────────────────────────────────────────────────────────────────────────
# Supabase reads (publishable key; every query bounded + paginated)
# ────────────────────────────────────────────────────────────────────────────

def rest_get(table: str, params: Dict[str, str], key: str = READ_KEY) -> List[Dict[str, Any]]:
    url = f"{SUPABASE_URL}/rest/v1/{table}?" + urllib.parse.urlencode(params, safe="(),.*")
    f = http_get(url, headers={"apikey": key, "Authorization": f"Bearer {key}",
                               "Accept": "application/json"}, timeout=60)
    if f.status != 200:
        raise SystemExit(f"[supabase] GET {table} failed: {f.status} {f.error} {f.body[:200]!r}")
    return json.loads(f.body.decode("utf-8") or "[]")


def rest_paged(table: str, select: str, filters: Dict[str, str], order: str, page: int = 1000,
               hard_cap: int = 500_000) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    offset = 0
    while offset < hard_cap:
        params = {"select": select, "order": order, "limit": str(page), "offset": str(offset)}
        params.update(filters)
        batch = rest_get(table, params)
        out.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return out


def chunks(seq: List[Any], n: int) -> Iterable[List[Any]]:
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


BOOK_SELECT = ("id,slug,title,author_name,cover_image_url,isbn_13,isbn_10,"
               "index_status,recommendation_count")


SHOWN_CACHE_TTL = 2 * 3600


def load_shown_books(fresh: bool = False) -> List[Dict[str, Any]]:
    """Shown set, cached on disk for SHOWN_CACHE_TTL seconds (--fresh to bypass)."""
    path = os.path.join(CACHE_DIR, "shown_books.json")
    if not fresh:
        try:
            if time.time() - os.path.getmtime(path) < SHOWN_CACHE_TTL:
                with open(path, encoding="utf-8") as f:
                    books = json.load(f)
                log(f"shown set: {len(books)} books (cached {(time.time() - os.path.getmtime(path)) / 60:.0f} min ago; --fresh to reload)")
                return books
        except (OSError, ValueError):
            pass
    books = _load_shown_books_live()
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(books, f)
    os.replace(path + ".tmp", path)
    return books


def _load_shown_books_live() -> List[Dict[str, Any]]:
    ids: set = set()
    pub = rest_paged("books", "id", {"index_status": "eq.published"}, "id")
    ids.update(r["id"] for r in pub)
    lists = rest_paged("lists", "id", {"index_status": "eq.published"}, "id")
    for ch in chunks([r["id"] for r in lists], 40):
        rows = rest_paged("book_lists", "book_id,list_id", {"list_id": f"in.({','.join(map(str, ch))})"},
                          "list_id,book_id")
        ids.update(r["book_id"] for r in rows)
    people = rest_paged("people", "id", {"index_status": "eq.published"}, "id")
    for ch in chunks([r["id"] for r in people], 40):
        rows = rest_paged("book_recommendations", "book_id,person_id",
                          {"person_id": f"in.({','.join(map(str, ch))})"}, "person_id,book_id")
        ids.update(r["book_id"] for r in rows if r.get("book_id"))
    log(f"shown-set sources: published books={len(pub)}  published lists={len(lists)}  "
        f"published people={len(people)}  -> distinct book ids={len(ids)}")
    books: List[Dict[str, Any]] = []
    for ch in chunks(sorted(ids), 100):
        books.extend(rest_get("books", {"select": BOOK_SELECT, "id": f"in.({','.join(ch)})",
                                        "limit": str(len(ch))}))
    return books


def load_books_by_slug(slugs: List[str]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for s in slugs:
        out.extend(rest_get("books", {"select": BOOK_SELECT, "slug": f"eq.{s}", "limit": "1"}))
    return out


# ────────────────────────────────────────────────────────────────────────────
# Title / author matching
# ────────────────────────────────────────────────────────────────────────────

_ARTICLES = ("the ", "a ", "an ")
_NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "phd", "md", "dr", "mr", "mrs", "ms", "prof"}


def norm_title(t: Any) -> str:
    s = _fold(_strip_subtitle(str(t or "").replace("&", " and ")))
    for art in _ARTICLES:
        if s.startswith(art):
            s = s[len(art):]
            break
    return s.strip()


def author_surnames(name: Any) -> List[str]:
    out: List[str] = []
    for part in re.split(r",|;|&|\band\b|\bwith\b|\bed\.|\beditors?\b", str(name or ""), flags=re.I):
        toks = [t for t in _fold(part).split() if t not in _NAME_SUFFIXES]
        if toks:
            out.append(toks[-1])
    return out


def author_match(db_author: str, cand_authors: List[str]) -> bool:
    db = set(author_surnames(db_author))
    if not db:
        return False
    cand_tokens: set = set()
    for a in cand_authors:
        cand_tokens.update(t for t in _fold(a).split() if t not in _NAME_SUFFIXES)
    return bool(db & cand_tokens)


def title_match(db_title: str, cand_title: str) -> Tuple[str, float]:
    """('exact'|'prefix'|'fuzzy'|'none', score)."""
    a, b = norm_title(db_title), norm_title(cand_title)
    if not a or not b:
        return "none", 0.0
    if a == b:
        # Both sides carry a subtitle that disagrees ("Sapiens: A Graphic History"
        # vs "Sapiens: A Brief History") -> different books; demote to fuzzy on the
        # full titles.
        fa, fb = _fold(db_title.replace("&", " and ")), _fold(cand_title.replace("&", " and "))
        both_sub = _strip_subtitle(db_title) != db_title and _strip_subtitle(cand_title) != cand_title
        if both_sub and fa != fb:
            full = difflib.SequenceMatcher(None, fa, fb).ratio()
            return ("fuzzy" if full >= FUZZY_MIN else "none"), round(full, 3)
        return "exact", 1.0
    score = difflib.SequenceMatcher(None, a, b).ratio()
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    if longer.startswith(shorter + " ") and len(shorter.split()) >= 3:
        return "prefix", round(score, 3)
    if score >= FUZZY_MIN:
        return "fuzzy", round(score, 3)
    return "none", round(score, 3)


# ────────────────────────────────────────────────────────────────────────────
# ISBN helpers
# ────────────────────────────────────────────────────────────────────────────

def isbn13_to_10(s: str) -> Optional[str]:
    s = re.sub(r"[^0-9Xx]", "", s or "")
    if len(s) == 10:
        return s.upper()
    if len(s) != 13 or not s.startswith("978"):
        return None
    core = s[3:12]
    total = sum((10 - i) * int(c) for i, c in enumerate(core))
    chk = (11 - total % 11) % 11
    return core + ("X" if chk == 10 else str(chk))


def english_isbn10s(isbns: Iterable[str], cap: int) -> List[str]:
    """ISBN-10s in registration groups 0/1 (English-language), deduped, capped."""
    seen: List[str] = []
    for raw in isbns or []:
        i10 = isbn13_to_10(raw)
        if i10 and i10[0] in "01" and i10 not in seen:
            seen.append(i10)
        if len(seen) >= cap:
            break
    return seen


def isbn_is_english(raw: str) -> Optional[bool]:
    """True for registration group 0/1 (ISBN-13 978-0/978-1), False for another group,
    None when it is not a parseable ISBN (e.g. an Amazon ASIN like B00DF58I56).
    979-8 (US, English) also counts as English."""
    s = re.sub(r"[^0-9Xx]", "", raw or "")
    if len(s) == 13:
        if s.startswith("9798"):
            return True
        if not s.startswith("978"):
            return False if s.startswith("979") else None
        return s[3] in "01"
    if len(s) == 10 and s[:9].isdigit():
        return s[0] in "01"
    return None


def isbn_group(raw: str) -> str:
    """Short registration-group label for reports (e.g. '2', '3', '84', '88', '7')."""
    s = isbn13_to_10(raw) or ""
    if not s:
        return "?"
    return s[0] if s[0] in "01234567" else s[:2]


def amazon_url(isbn10: str) -> str:
    # The `_SX300_` variant the DB uses actually serves ~106x160; LZZZZZZZ serves the large image.
    return f"https://images-na.ssl-images-amazon.com/images/P/{isbn10}.01.LZZZZZZZ.jpg"


# ────────────────────────────────────────────────────────────────────────────
# Sources
# ────────────────────────────────────────────────────────────────────────────

OL_FIELDS = "key,title,author_name,cover_i,isbn,first_publish_year"


def ol_search(title: str, author: str) -> Optional[List[Dict[str, Any]]]:
    """Docs list, or None on a transient failure (not cached)."""
    params = {"title": title, "fields": OL_FIELDS, "limit": "5"}
    if author:
        params["author"] = author
    url = "https://openlibrary.org/search.json?" + urllib.parse.urlencode(params)
    hit = cache_get("ol", url)
    if hit is not None:
        return hit
    f = http_get(url, headers={"Accept": "application/json"}, timeout=40, retries=2)
    if f.status != 200:
        return None if is_transient(f) else []
    try:
        docs = (json.loads(f.body.decode("utf-8")).get("docs") or [])[:5]
    except ValueError:
        return None
    # keep the cache small: at most 25 ISBNs per doc
    for d in docs:
        if isinstance(d.get("isbn"), list):
            d["isbn"] = d["isbn"][:25]
    cache_put("ol", url, docs)
    return docs


def _ol_json(url: str, kind: str) -> Optional[Dict[str, Any]]:
    """GET an Open Library JSON document (cached). None on a transient failure,
    {} when it does not exist."""
    hit = cache_get(kind, url)
    if hit is not None:
        return hit
    f = http_get(url, headers={"Accept": "application/json"}, retries=2)
    if f.status != 200:
        if is_transient(f):
            return None
        cache_put(kind, url, {})
        return {}
    try:
        data = json.loads(f.body.decode("utf-8"))
    except ValueError:
        return None
    return data


def _slim_edition(e: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "key": e.get("key") or "",
        "title": e.get("title") or "",
        "langs": [str((l or {}).get("key") or "").rsplit("/", 1)[-1] for l in (e.get("languages") or [])],
        "covers": [c for c in (e.get("covers") or []) if isinstance(c, int) and c > 0][:3],
        "isbn": (list(e.get("isbn_10") or []) + list(e.get("isbn_13") or []))[:6],
    }


EDITION_PAGE = 50
EDITION_MAX_PAGES = 3


def ol_work_editions(work_key: str, page: int) -> Optional[List[Dict[str, Any]]]:
    """One page (50) of a work's editions, slimmed. None on a transient failure."""
    url = (f"https://openlibrary.org{work_key}/editions.json?limit={EDITION_PAGE}"
           f"&offset={page * EDITION_PAGE}")
    hit = cache_get("oled", url)
    if hit is not None:
        return hit
    data = _ol_json(url, "oled_raw_unused")
    if data is None:
        return None
    eds = [_slim_edition(e) for e in (data.get("entries") or [])]
    cache_put("oled", url, eds)
    return eds


def edition_is_english(ed: Dict[str, Any]) -> bool:
    """English edition: its languages include eng; or it lists no language at all and
    every ISBN it carries is in group 0/1 (and it has at least one)."""
    if ed.get("langs"):
        return "eng" in ed["langs"]
    flags = [isbn_is_english(i) for i in ed.get("isbn") or []]
    flags = [f for f in flags if f is not None]
    return bool(flags) and all(flags)


def english_edition_choices(doc: Dict[str, Any], db_title: str) -> Optional[Tuple[List[Tuple[int, str]], List[str], int]]:
    """For an OL search doc (a work): (cover ids from English editions whose own title
    matches the book, best first, as (cover_id, edition_key)), English ISBN-10s from those
    editions, editions scanned). None on a transient failure."""
    wk = doc.get("key") or ""
    if not wk.startswith("/works/"):
        return [], [], 0
    work_cover = doc.get("cover_i") if isinstance(doc.get("cover_i"), int) else None
    picks: List[Tuple[Tuple, int, str]] = []
    isbns: List[str] = []
    scanned = 0
    for page in range(EDITION_MAX_PAGES):
        eds = ol_work_editions(wk, page)
        if eds is None:
            return None
        scanned += len(eds)
        for ed in eds:
            if not edition_is_english(ed):
                continue
            if title_match(db_title, ed.get("title") or "")[0] == "none":
                continue  # translated / retitled / omnibus edition
            eng_isbn = any(isbn_is_english(i) for i in ed.get("isbn") or [])
            for i in ed.get("isbn") or []:
                if isbn_is_english(i):
                    i10 = isbn13_to_10(i)
                    if i10 and i10 not in isbns:
                        isbns.append(i10)
            for c in ed.get("covers") or []:
                # Retail editions (English ISBN) first: OL's work-level cover and ISBN-less
                # editions are often library scans of plain cloth / leather bindings.
                rank = (0 if eng_isbn else 1, 0 if c == work_cover else 1, len(picks))
                picks.append((rank, c, ed.get("key") or ""))
        if picks or len(eds) < EDITION_PAGE:
            break
    picks.sort(key=lambda x: x[0])
    seen: set = set()
    out: List[Tuple[int, str]] = []
    for _, c, k in picks:
        if c not in seen:
            seen.add(c)
            out.append((c, k))
    return out, isbns, scanned


def ol_cover_meta(cover_id: int) -> Optional[Dict[str, Any]]:
    """{"olid", "src"} for an OL cover id ({} if unknown; None on a transient failure).
    src is the image the cover was imported from, e.g. an Internet Archive scan."""
    url = f"https://covers.openlibrary.org/b/id/{cover_id}.json"
    hit = cache_get("olcov", url)
    if hit is not None and (not hit or "src" in hit):
        return hit
    f = http_get(url, headers={"Accept": "application/json"}, retries=2)
    if f.status != 200:
        if is_transient(f):
            return None
        cache_put("olcov", url, {})
        return {}
    try:
        meta = json.loads(f.body.decode("utf-8"))
    except ValueError:
        return None
    out = {"olid": meta.get("olid") or "", "src": meta.get("source_url") or ""}
    cache_put("olcov", url, out)
    return out


def ol_cover_scan_reason(cover_id: int) -> Optional[str]:
    """Internet Archive imports sometimes use the scanned TITLE PAGE as the cover
    (source_url .../page/title.jpg). Reject those. None = fine (or unknown)."""
    m = ol_cover_meta(cover_id)
    src = (m or {}).get("src") or ""
    if re.search(r"/page/(title|n\d+)[^/]*\.jpg", src):
        return "ia_title_page_scan"
    return None


def ol_cover_edition(cover_id: int) -> Optional[Dict[str, Any]]:
    """The edition an OL cover id was uploaded for: {"olid", "langs", "isbn", "title"} or {}
    when unknown. None on a transient failure."""
    meta = ol_cover_meta(cover_id)
    if meta is None:
        return None
    olid = (meta or {}).get("olid") or ""
    if not olid or not olid.endswith("M"):
        return {}
    url = f"https://openlibrary.org/books/{olid}.json"
    hit = cache_get("olbook", url)
    if hit is None:
        data = _ol_json(url, "olbook_raw_unused")
        if data is None:
            return None
        hit = _slim_edition(data) if data else {}
        cache_put("olbook", url, hit)
    return dict(hit, olid=olid) if hit else {}


_google_state = {"enabled": True}
_google_lock = threading.Lock()


def google_search(title: str, author: str) -> List[Dict[str, Any]]:
    with _google_lock:
        if not _google_state["enabled"]:
            return []
    q = f'intitle:"{title}"' + (f' inauthor:"{author}"' if author else "")
    url = "https://www.googleapis.com/books/v1/volumes?" + urllib.parse.urlencode(
        {"q": q, "maxResults": "5", "printType": "books"})
    hit = cache_get("gb", url)
    if hit is not None:
        return hit
    f = http_get(url, retries=0)
    if f.status == 429 or f.status == 403:
        with _google_lock:
            if _google_state["enabled"]:
                log(f"  [google_books] HTTP {f.status}: disabling Google fallback for the rest of this run")
            _google_state["enabled"] = False
        return []
    if f.status != 200:
        return []
    try:
        items = (json.loads(f.body.decode("utf-8")).get("items") or [])[:5]
    except ValueError:
        return []
    cache_put("gb", url, items)
    return items


# ────────────────────────────────────────────────────────────────────────────
# Per-book recovery
# ────────────────────────────────────────────────────────────────────────────

_TIER_RANK = {"exact": 0, "prefix": 1, "fuzzy": 1}


def _row(book: Dict[str, Any], state: str, detail: str) -> Dict[str, Any]:
    return {
        "book_id": book["id"], "slug": book.get("slug") or "", "title": book.get("title") or "",
        "author": book.get("author_name") or "", "current_state": state,
        "current_url": book.get("cover_image_url") or "", "candidate_url": "",
        "candidate_source": "", "match_title": "", "match_author": "", "title_score": "",
        "confidence": "none", "width": "", "height": "", "reason": detail,
        "recommendation_count": book.get("recommendation_count") or 0,
    }


def _accept(row: Dict[str, Any], url: str, source: str, meta: Dict[str, Any], conf: str,
            mt: str, ma: str, score: float, why: str) -> Dict[str, Any]:
    row.update({"candidate_url": url, "candidate_source": source, "match_title": mt,
                "match_author": ma, "title_score": f"{score:.3f}", "confidence": conf,
                "width": meta.get("width", ""), "height": meta.get("height", ""),
                "reason": f"[{row['reason']}] {why}" if row["reason"] else why})
    return row


def recover_one(book: Dict[str, Any], state: str, detail: str, google_fallback: bool) -> Dict[str, Any]:
    row = _row(book, state, detail)
    title = (book.get("title") or "").strip()
    author = (book.get("author_name") or "").strip()
    rejections: List[str] = []

    # 1. Bare filename that actually exists in storage -> trust the uploaded file.
    cur = (book.get("cover_image_url") or "").strip()
    if state == "bare_filename":
        su = (f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/"
              + urllib.parse.quote(cur, safe="/"))
        m = measure_image(su)
        if not placeholder_reason(m):
            return _accept(row, su, "supabase_storage", m, "high", title, author, 1.0,
                           "bare filename exists in storage bucket (URL sync fix)")
        rejections.append(f"storage:{placeholder_reason(m)}")

    if not title:
        row["reason"] = f"[{detail}] no title" if detail else "no title"
        return row
    if not author:
        row["reason"] = (f"[{detail}] " if detail else "") + "no author_name; refusing title-only match"
        return row

    # 2/3. Open Library search -> cover_i, then English ISBN -> Amazon.
    docs = ol_search(title, author)
    if docs is None:
        row["reason"] = (f"[{detail}] " if detail else "") + "openlibrary search failed (transient); rerun"
        return row
    core = _strip_subtitle(title).strip()
    if not docs and core and core != title:
        docs = ol_search(core, author) or []

    scored: List[Tuple[Tuple, Dict[str, Any], str, float]] = []
    for d in docs:
        tier, score = title_match(title, d.get("title") or "")
        if tier == "none":
            rejections.append(f"title<{FUZZY_MIN}:{(d.get('title') or '')[:30]!r}({score:.2f})")
            continue
        if not author_match(author, d.get("author_name") or []):
            rejections.append(f"author_mismatch:{', '.join(d.get('author_name') or [])[:30]!r}")
            continue
        key = (_TIER_RANK[tier], -score, 0 if d.get("cover_i") else 1)
        scored.append((key, d, tier, score))
    scored.sort(key=lambda x: x[0])

    attempts = 0
    cur_norm = cur.split("?")[0]
    for _, d, tier, score in scored[:3]:
        conf = "high" if tier == "exact" else "medium"
        mt, ma = d.get("title") or "", ", ".join(d.get("author_name") or [])
        why = f"OL {d.get('key', '')} title={tier}"
        # English-edition rule: the cover must belong to an English edition of the
        # work whose own title matches the book (no translations / retitled editions).
        choice = english_edition_choices(d, title)
        if choice is None:
            row["reason"] = (f"[{detail}] " if detail else "") + "openlibrary editions failed (transient); rerun"
            return row
        covers, eng_isbns, scanned = choice
        if not covers and not eng_isbns:
            rejections.append(f"no_english_edition({scanned} eds)")
        # Candidate order: OL covers that came from a retailer/publisher image, then
        # Amazon by English ISBN-10 (English editions' ISBNs first, then the work's
        # other group-0/1 ISBNs), then OL covers photographed from Internet Archive
        # library copies (often plain cloth/leather bindings) as a last resort.
        retail: List[Tuple[str, Any, str]] = []
        scans: List[Tuple[str, Any, str]] = []
        for cid, ekey in covers[:4]:
            u = f"https://covers.openlibrary.org/b/id/{cid}-L.jpg?default=false"
            if u.split("?")[0] == cur_norm:
                rejections.append("same_as_current")
                continue
            scan = ol_cover_scan_reason(cid)  # cheap JSON
            if scan:
                rejections.append(f"ol_cover:{scan}")
                continue
            src = ((ol_cover_meta(cid) or {}).get("src") or "")
            item = ("openlibrary_cover", u, f" eng_edition={ekey.rsplit('/', 1)[-1]}")
            (scans if "archive.org" in src else retail).append(item)
        amz = [("amazon_isbn", amazon_url(i10), f" isbn10={i10}")
               for i10 in (eng_isbns + english_isbn10s(d.get("isbn") or [], cap=4))[:6]]
        for source, u, extra in retail + amz + scans:
            if attempts >= MAX_IMAGE_TRIES:
                break
            if u == cur:
                continue
            m = measure_image(u)
            attempts += 1
            bad = validate_candidate(m)
            if not bad:
                return _accept(row, u, source, m, conf, mt, ma, score, why + extra)
            rejections.append(f"{source.split('_')[0]}:{bad}")
        if attempts >= MAX_IMAGE_TRIES:
            break

    # 4. The book's own ISBN (title not re-verified -> medium at most; English group only).
    i13 = re.sub(r"[^0-9Xx]", "", book.get("isbn_13") or "")
    i10 = isbn13_to_10(book.get("isbn_10") or "") or isbn13_to_10(i13)
    db_urls = []
    if (i13 or i10) and isbn_is_english(i13 or i10):
        db_urls.append(f"https://covers.openlibrary.org/b/isbn/{i13 or i10}-L.jpg?default=false")
    if i10 and isbn_is_english(i10):
        db_urls.append(amazon_url(i10))
    for u in db_urls:
        if u == cur:
            continue
        m = measure_image(u)
        bad = validate_candidate(m)
        if not bad:
            return _accept(row, u, "db_isbn", m, "medium", "", "", 0.0,
                           f"book's own ISBN {i13 or i10}; title not re-verified")
        rejections.append(f"db_isbn:{bad}")

    # 5. Optional Google Books (rate-limited; degrades to nothing).
    if google_fallback:
        for it in google_search(title, author):
            vi = it.get("volumeInfo") or {}
            tier, score = title_match(title, vi.get("title") or "")
            if tier == "none" or not author_match(author, vi.get("authors") or []):
                continue
            vid = it.get("id")
            if not vid:
                continue
            u = f"https://books.google.com/books/content?id={vid}&printsec=frontcover&img=1&zoom=3&source=gbs_api"
            m = measure_image(u)
            bad = validate_candidate(m)
            if not bad:
                # language of a Google volume is not verified -> never high
                return _accept(row, u, "google_books", m, "medium",
                               vi.get("title") or "", ", ".join(vi.get("authors") or []), score,
                               f"GB {vid} title={tier}")
            rejections.append(f"google:{bad}")

    pre = f"[{detail}] " if detail else ""
    if not docs:
        row["reason"] = pre + "no openlibrary results" + (f"; {'; '.join(rejections[:4])}" if rejections else "")
    else:
        row["reason"] = pre + "no safe candidate: " + "; ".join(rejections[:6])
    return row


# ────────────────────────────────────────────────────────────────────────────
# Orchestration
# ────────────────────────────────────────────────────────────────────────────

def order_books(books: List[Dict[str, Any]], priority: bool) -> List[Dict[str, Any]]:
    if priority:
        return sorted(books, key=lambda b: (-(b.get("recommendation_count") or 0), b.get("slug") or ""))
    return sorted(books, key=lambda b: b.get("slug") or "")


def classify_many(books: List[Dict[str, Any]], label: str) -> List[Tuple[Dict[str, Any], str, str, Dict[str, Any]]]:
    out: List[Any] = [None] * len(books)
    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futs = {ex.submit(classify, b): i for i, b in enumerate(books)}
        for n, fut in enumerate(cf.as_completed(futs), 1):
            i = futs[fut]
            st, det, meta = fut.result()
            out[i] = (books[i], st, det, meta)
            if n % 500 == 0:
                el = time.time() - t0
                log(f"  [{label}] classified {n}/{len(books)}  ({el:.0f}s, eta {el / n * (len(books) - n):.0f}s)")
    return out


def summarize_states(classified: List[Tuple[Dict[str, Any], str, str, Dict[str, Any]]]) -> None:
    st = Counter(c[1] for c in classified)
    print("\n== Current cover state (measured) ==")
    for k in ("ok", "bare_filename", "empty", "placeholder", "google", "foreign", "maybe_not_cover"):
        print(f"  {k:<14} {st.get(k, 0):>7}")
    print(f"  {'TOTAL':<14} {len(classified):>7}")
    by_host = Counter((host_label(c[0].get("cover_image_url") or ""), c[1]) for c in classified)
    print("\n  host x state:")
    for (h, s), n in sorted(by_host.items()):
        print(f"    {h:<12} {s:<14} {n:>7}")
    fg = Counter(re.sub(r"from OL\d+M \(([^)]*)\).*", r"\1", re.sub(r"isbn10 \w+ ", "", c[2]))
                 for c in classified if c[1] == "foreign")
    if fg:
        print("\n  foreign detail:")
        for r, n in fg.most_common(15):
            print(f"    {n:>6}  {r}")
    print(f"\n  google flagged as text page: {sum(1 for c in classified if c[1] == 'google' and 'text page' in c[2])}")
    reasons = Counter(re.sub(r"\d+x\d+|std=[\d.]+", "#", c[2]) for c in classified if c[1] == "placeholder")
    if reasons:
        print("\n  placeholder reasons:")
        for r, n in reasons.most_common(12):
            print(f"    {n:>6}  {r}")
    lowres = sum(1 for c in classified if c[1] == "ok" and int(c[3].get("width") or 0) < MIN_CAND_WIDTH)
    print(f"\n  ok but low-res (<{MIN_CAND_WIDTH}px wide, not targeted): {lowres}")


def write_csv(path: str, cols: List[str], rows: List[Dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, path)


def do_census(args: argparse.Namespace) -> int:
    books = order_books(load_shown_books(args.fresh), True)
    log(f"shown books: {len(books)}  (classifying with {MAX_WORKERS} workers; cached under {os.path.relpath(CACHE_DIR, PROJECT)})")
    classified = classify_many(books, "census")
    write_census(classified)
    return 0


def write_census(classified: List[Tuple[Dict[str, Any], str, str, Dict[str, Any]]]) -> None:
    rows = [{"book_id": b["id"], "slug": b.get("slug"), "title": b.get("title"),
             "author": b.get("author_name"), "recommendation_count": b.get("recommendation_count") or 0,
             "host": host_label(b.get("cover_image_url") or ""), "current_state": st, "detail": det,
             "width": m.get("width", ""), "height": m.get("height", ""),
             "current_url": b.get("cover_image_url") or ""} for b, st, det, m in classified]
    write_csv(CENSUS_PATH["p"], CENSUS_COLUMNS, rows)
    summarize_states(classified)
    print(f"\ncensus CSV: {os.path.relpath(CENSUS_PATH['p'], PROJECT)}\n", flush=True)


def do_dry_run(args: argparse.Namespace) -> int:
    print("== Cover recovery DRY RUN (read-only: no DB writes, no uploads) ==")
    if args.slug:
        books = load_books_by_slug(args.slug)
    else:
        books = load_shown_books(args.fresh)
    books = order_books(books, args.priority)
    only = set(s.strip() for s in (args.only_state or "").split(",") if s.strip())
    want = args.offset + args.limit if args.limit else None

    # Classify lazily in priority order until enough non-ok targets are collected
    # (the census mode classifies everything).
    targets: List[Tuple[Dict[str, Any], str, str]] = []
    classified_all: List[Any] = []
    step = 300
    for i in range(0, len(books), step):
        part = classify_many(books[i:i + step], "classify")
        classified_all.extend(part)
        for b, st, det, _m in part:
            if st == "ok" and not args.slug:
                continue
            if only and st not in only:
                continue
            targets.append((b, st, det))
        if want is not None and len(targets) >= want:
            break
    targets = targets[args.offset:]
    if args.limit:
        targets = targets[:args.limit]
    done_rows: List[Dict[str, Any]] = []
    if args.resume and os.path.exists(args.out + ".partial"):
        with open(args.out + ".partial", newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if "(transient)" not in (r.get("reason") or ""):
                    done_rows.append(r)
        done_ids = {r["book_id"] for r in done_rows}
        before = len(targets)
        targets = [t for t in targets if t[0]["id"] not in done_ids]
        print(f"resume: {len(done_rows)} rows already in {os.path.relpath(args.out + '.partial', PROJECT)}; "
              f"{before - len(targets)} targets skipped")
    if not args.slug and len(classified_all) == len(books):
        write_census(classified_all)  # everything was classified anyway; keep the census
    cs = Counter(c[1] for c in classified_all)
    print(f"candidates considered: {len(books)}  classified: {len(classified_all)} {dict(cs)}")
    print(f"targets this run: {len(targets)}  (offset={args.offset}, limit={args.limit or 'all'}, "
          f"only_state={','.join(sorted(only)) or 'any non-ok'})\n")

    out_path = args.out
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    partial = out_path + ".partial"
    rows: List[Dict[str, Any]] = []
    t0 = time.time()
    with open(partial, "w", newline="", encoding="utf-8") as pf:
        pw = csv.DictWriter(pf, fieldnames=OUT_COLUMNS, extrasaction="ignore")
        pw.writeheader()
        for r in done_rows:
            pw.writerow(r)
        pf.flush()
        with cf.ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
            futs = [ex.submit(recover_one, b, st, det, args.google_fallback) for b, st, det in targets]
            for n, fut in enumerate(cf.as_completed(futs), 1):
                try:
                    r = fut.result()
                except Exception as e:  # never let one book kill the run
                    log(f"  [error] {type(e).__name__}: {e}")
                    continue
                rows.append(r)
                pw.writerow(r)
                pf.flush()
                if args.verbose or len(targets) <= 25:
                    log(f"  {r['confidence']:<6} {r['current_state']:<13} {r['slug'][:50]:<50} "
                        f"{r['candidate_source'] or '-':<17} {r['reason'][:70]}")
                if n % 50 == 0:
                    el = time.time() - t0
                    oc = Counter(x["confidence"] for x in rows)
                    log(f"  [{n}/{len(targets)}] {el:.0f}s  eta {el / n * (len(targets) - n):.0f}s  "
                        f"high={oc['high']} medium={oc['medium']} none={oc['none']}")
    rows.extend(done_rows)
    rows.sort(key=lambda r: (-int(r.get("recommendation_count") or 0), r["slug"]))
    write_csv(out_path, OUT_COLUMNS, rows)
    os.remove(partial)

    print("\n== Summary ==")
    print("by current_state:")
    for k, n in Counter(r["current_state"] for r in rows).most_common():
        print(f"  {k:<14} {n:>6}")
    print("by outcome (confidence):")
    for k in ("high", "medium", "none"):
        print(f"  {k:<14} {sum(1 for r in rows if r['confidence'] == k):>6}")
    print("by current_state x outcome:")
    for (s, c), n in sorted(Counter((r["current_state"], r["confidence"]) for r in rows).items()):
        print(f"  {s:<14} {c:<7} {n:>6}")
    print("by candidate_source:")
    for k, n in Counter(r["candidate_source"] or "-" for r in rows).most_common():
        print(f"  {k:<18} {n:>6}")
    print(f"\nelapsed: {time.time() - t0:.0f}s for {len(rows)} books")
    print(f"report: {os.path.relpath(out_path, PROJECT)}")
    print("DRY RUN: nothing was written to the database.")
    return 0


# ────────────────────────────────────────────────────────────────────────────
# Write path (gated; never runs without --write --confirm + secret key)
# ────────────────────────────────────────────────────────────────────────────

def do_write(args: argparse.Namespace) -> int:
    secret = os.environ.get("SUPABASE_SECRET_KEY") or ""
    if not args.confirm:
        raise SystemExit("--write requires --confirm")
    if not secret:
        raise SystemExit("--write requires SUPABASE_SECRET_KEY in the environment")
    if not os.path.exists(args.from_csv):
        raise SystemExit(f"--from-csv not found: {args.from_csv} (run the dry run first)")
    allowed = {"high"} | ({"medium"} if args.include_medium else set())
    with open(args.from_csv, newline="", encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r.get("confidence") in allowed and r.get("candidate_url")]
    if args.max_writes:
        rows = rows[:args.max_writes]
    print(f"== Cover recovery WRITE ==\nsource csv: {args.from_csv}\nconfidence: {sorted(allowed)}\nrows: {len(rows)}")
    if not rows:
        return 0

    hdr = {"apikey": secret, "Authorization": f"Bearer {secret}", "Accept": "application/json"}

    def live(book_id: str) -> Optional[Dict[str, Any]]:
        url = f"{SUPABASE_URL}/rest/v1/books?" + urllib.parse.urlencode(
            {"select": "id,slug,cover_image_url", "id": f"eq.{book_id}", "limit": "1"})
        f = http_get(url, headers=hdr, timeout=30)
        if f.status != 200:
            return None
        data = json.loads(f.body.decode("utf-8") or "[]")
        return data[0] if data else None

    # Backup of live prior values FIRST.
    backup = []
    for r in rows:
        lv = live(r["book_id"])
        backup.append({"id": r["book_id"], "slug": r["slug"],
                       "cover_image_url": (lv or {}).get("cover_image_url"),
                       "found": lv is not None})
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    bpath = os.path.join(BACKUP_DIR, f"cover_recovery_pre_write_{stamp}.json")
    with open(bpath, "w", encoding="utf-8") as f:
        json.dump(backup, f, indent=1)
    print(f"backup written: {os.path.relpath(bpath, PROJECT)} ({len(backup)} rows)")

    ok = skipped = failed = 0
    report = []
    for r in rows:
        lv = live(r["book_id"])
        before = (lv or {}).get("cover_image_url") or ""
        if lv is None:
            status = "skip_missing_row"
        elif before != (r.get("current_url") or ""):
            status = "skip_drift"  # someone changed it since the dry run
        else:
            bad = validate_candidate(measure_image(r["candidate_url"], use_cache=False))
            if bad:
                status = f"skip_candidate_invalid:{bad}"
            else:
                url = f"{SUPABASE_URL}/rest/v1/books?" + urllib.parse.urlencode(
                    {"id": f"eq.{r['book_id']}", "cover_image_url": f"eq.{before}"} if before
                    else {"id": f"eq.{r['book_id']}"})
                req = urllib.request.Request(
                    url, method="PATCH",
                    data=json.dumps({"cover_image_url": r["candidate_url"]}).encode("utf-8"),
                    headers={**hdr, "Content-Type": "application/json", "Prefer": "return=representation",
                             "User-Agent": USER_AGENT})
                try:
                    with urllib.request.urlopen(req, timeout=30) as resp:
                        n = len(json.loads(resp.read().decode("utf-8") or "[]"))
                    status = "updated" if n == 1 else f"patched_rows={n}"
                except Exception as e:
                    status = f"failed:{type(e).__name__}: {str(e)[:80]}"
        if status == "updated":
            ok += 1
        elif status.startswith("failed") or status.startswith("patched_rows"):
            failed += 1
        else:
            skipped += 1
        report.append({"book_id": r["book_id"], "slug": r["slug"], "status": status,
                       "before": before, "after": r["candidate_url"]})
        print(f"  {status:<24} {r['slug']}")
    rpath = os.path.join(PROJECT, "reports", f"cover_recovery_write_{stamp}.csv")
    write_csv(rpath, ["book_id", "slug", "status", "before", "after"], report)
    print(f"\nupdated={ok} skipped={skipped} failed={failed}\nwrite report: {os.path.relpath(rpath, PROJECT)}")
    return 0 if failed == 0 else 1


# ────────────────────────────────────────────────────────────────────────────

def main() -> int:
    global MAX_WORKERS, SHOWN_CACHE_TTL
    ap = argparse.ArgumentParser(description="Find correct covers for shown books with missing/broken/placeholder covers (dry-run by default).")
    ap.add_argument("--census", action="store_true", help="classify every shown book's current cover and exit")
    ap.add_argument("--limit", type=int, default=0, help="max non-ok target books (0 = all)")
    ap.add_argument("--offset", type=int, default=0, help="skip the first N non-ok targets")
    ap.add_argument("--only-state", default="", help="comma list of bare_filename,empty,placeholder")
    ap.add_argument("--priority", action="store_true", help="order by recommendation_count desc")
    ap.add_argument("--slug", action="append", help="process specific slug(s), ignoring the shown-set filter")
    ap.add_argument("--google-fallback", action="store_true", help="try Google Books last (auto-disables on 429)")
    ap.add_argument("--out", default=DEFAULT_OUT, help="dry-run CSV path")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--fresh", action="store_true", help="reload the shown set from Supabase instead of the 2h disk cache")
    ap.add_argument("--resume", action="store_true", help="keep the rows already in <out>.partial and only process the rest")
    ap.add_argument("--workers", type=int, default=MAX_WORKERS, help="concurrent requests (max 3)")
    ap.add_argument("--census-out", default=CENSUS_OUT, help="census CSV path")
    ap.add_argument("--text-page-all", action="store_true",
                    help="run the text-page heuristic on every OL/storage cover too (slow: downloads each)")
    ap.add_argument("--no-suspect", action="store_true", help="skip the google/foreign/text-page checks on ok covers")
    ap.add_argument("--shown-ttl-hours", type=float, default=2.0, help="max age of the cached shown set")
    # write path
    ap.add_argument("--write", action="store_true", help="apply a reviewed dry-run CSV (gated)")
    ap.add_argument("--confirm", action="store_true", help="required with --write")
    ap.add_argument("--from-csv", default=DEFAULT_OUT, help="dry-run CSV to apply with --write")
    ap.add_argument("--include-medium", action="store_true", help="also write confidence=medium rows")
    ap.add_argument("--max-writes", type=int, default=0, help="cap the number of rows written")
    args = ap.parse_args()

    SUSPECT_CHECK["on"] = not args.no_suspect
    TEXT_PAGE_ALL["on"] = args.text_page_all
    MAX_WORKERS = max(1, min(3, args.workers))
    CENSUS_PATH["p"] = args.census_out
    SHOWN_CACHE_TTL = args.shown_ttl_hours * 3600
    if args.write:
        return do_write(args)
    if args.census:
        return do_census(args)
    return do_dry_run(args)


if __name__ == "__main__":
    sys.exit(main())
