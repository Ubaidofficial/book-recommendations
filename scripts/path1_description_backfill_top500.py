#!/usr/bin/env python3
# Gated description backfill for the top-500 bad-description bucket.
#
# SAFETY MODEL
#   - PREVIEW BY DEFAULT. NO DB writes. NO AI writing. NO image downloads.
#   - Triple-gated write: --write + --confirm-description-backfill +
#     --backup-before-write PATH. Any one missing aborts.
#   - PATCH target is ONLY books.description. Never anything else.
#   - Live drift check at write time: live description must STILL equal the
#     preview's current_description before any PATCH.
#   - Pre-write backup is required and count-validated.
#
# DIFFERENCES FROM path1_description_backfill.py
#   This top500-focused script is STRICTER than its general counterpart on
#   two axes the user surfaced in this batch:
#
#     1. Religious / classical / anthology source books always route to
#        needs_manual_review, even when title+author match is high. Editions
#        and translations matter for these books and a generic candidate
#        description can be subtly wrong.
#
#     2. Candidate descriptions that look like marketing/shipping/catalog
#        boilerplate ("Ships from USA", "Free shipping", "Print on demand",
#        "Library binding", standalone format labels, etc.) are rejected
#        even at high match scores.
#
#   All other classification rules match the general script:
#     - current=empty OR current=junk required (do not overwrite decent text)
#     - candidate length >= 180
#     - score >= 0.82
#     - confidence=high
#
# INPUT
#   rebuild_v2/live_missing_description_top500_audit_v1.csv
#   Columns: id, slug, title, author, recs, desc_len, description.
#
# OUTPUT
#   Preview : rebuild_v2/description_backfill_top500_preview_v1.csv
#   Write   : rebuild_v2/description_backfill_top500_write_v1.csv
#
# USAGE
#   python scripts/path1_description_backfill_top500.py
#
#   # Future live write (DO NOT RUN until explicitly approved)
#   python scripts/path1_description_backfill_top500.py \
#       --preview rebuild_v2/description_backfill_top500_preview_v1.csv \
#       --write --confirm-description-backfill \
#       --backup-before-write backups/description_backfill_top500_pre_v1.csv

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
csv.field_size_limit(10**9)

# Reuse the title+author scoring + search helpers from the cover-backfill script.
# (Only JSON endpoints — no image bytes are ever fetched.)
from path1_cover_backfill import (  # noqa: E402
    google_books_search,
    open_library_search,
    score_candidate,
)


PREVIEW_COLUMNS = [
    "book_id", "slug", "title", "author", "recs",
    "current_description",
    "candidate_description", "candidate_source",
    "candidate_title", "candidate_author",
    "score", "confidence", "action", "reason",
]
WRITE_REPORT_COLUMNS = [
    "book_id", "slug", "title", "status", "reason",
    "description_before", "description_after",
    "candidate_source", "score",
]
BACKUP_COLUMNS = ["book_id", "slug", "title", "description_before"]

SCORE_HIGH_THRESHOLD = 0.82
CANDIDATE_MIN_LEN = 180
DECENT_CURRENT_MIN_LEN = 100
CANDIDATE_MAX_LEN = 4000


# ─────────────────────────────────────────────────────────────────────────────
# Religious / classical / anthology source-book detector
# (route to manual review even when scoring is high)
# ─────────────────────────────────────────────────────────────────────────────

# Religious-text titles. Match whole-word, case-insensitive.
_RELIGIOUS_TITLE_RE = re.compile(
    r"\b(?:holy bible|the bible|^bible$|new testament|old testament|"
    r"quran|qur'an|koran|the torah|talmud|midrash|hadith|"
    r"bhagavad gita|dhammapada|tao te ching|i ching|"
    r"upanishads?|vedas?|mahabharata|ramayana|"
    r"book of mormon|tipitaka|sutras?|"
    r"book of common prayer|the lotus sutra|"
    r"the diamond sutra)\b",
    re.IGNORECASE,
)

# Classical-era and pre-1900 authors whose works exist in many editions /
# translations. We bias toward manual review for these regardless of score.
_CLASSICAL_AUTHOR_RE = re.compile(
    r"\b(?:"
    # Ancient Greek / Roman
    r"homer|hesiod|sappho|aesop|plato|aristotle|socrates|"
    r"marcus aurelius|seneca(?:\s+the\s+younger)?|lucius seneca|epictetus|"
    r"cicero|virgil|ovid|horace|catullus|"
    r"plutarch|tacitus|livy|sun\s*-?\s*tzu|"
    r"sophocles|euripides|aeschylus|aristophanes|thucydides|herodotus|"
    # Eastern classical
    r"confucius|lao\s*-?\s*tzu|chuang\s*-?\s*tzu|zhuangzi|laozi|mencius|"
    r"siddhartha gautama|gautama buddha|"
    # Medieval / Renaissance
    r"saint augustine|augustine of hippo|aquinas|thomas aquinas|"
    r"dante alighieri|dante|chaucer|geoffrey chaucer|"
    r"shakespeare|william shakespeare|"
    r"machiavelli|niccol[oò] machiavelli|"
    # Early modern (pre-1900)
    r"john milton|john locke|david hume|adam smith|john stuart mill|"
    r"voltaire|rousseau|jean-jacques rousseau|"
    r"immanuel kant|kant|hegel|schopenhauer|kierkegaard|"
    r"friedrich nietzsche|nietzsche|"
    r"karl marx|engels|"
    r"charles darwin|darwin|alfred russel wallace|"
    r"sigmund freud|carl jung|"
    r"emily dickinson|walt whitman|edgar allan poe|"
    r"jane austen|charles dickens|charlotte bront[eë]|emily bront[eë]|"
    r"leo tolstoy|fyodor dostoevsky|anton chekhov|nikolai gogol|"
    r"henry david thoreau|ralph waldo emerson|"
    r"mark twain|herman melville|nathaniel hawthorne|"
    r"victor hugo|honor[eé] de balzac|gustave flaubert|"
    r"oscar wilde|robert louis stevenson|joseph conrad"
    r")\b",
    re.IGNORECASE,
)

# Anthology / collected-works style titles.
_ANTHOLOGY_TITLE_RE = re.compile(
    r"\b(?:complete works|collected works|selected works|"
    r"anthology|the essential|the portable|"
    r"complete poems|collected poems|selected poems|"
    r"collected stories|complete stories|selected stories|"
    r"omnibus|treasury)\b",
    re.IGNORECASE,
)


def classify_source_book(title: str, author: str) -> Tuple[bool, List[str]]:
    """Return (is_edition_sensitive, reasons). When true the row routes to
    needs_manual_review regardless of candidate score."""
    reasons: List[str] = []
    if title and _RELIGIOUS_TITLE_RE.search(title):
        reasons.append("religious_text_title")
    if title and _ANTHOLOGY_TITLE_RE.search(title):
        reasons.append("anthology_or_collected_works_title")
    if author and _CLASSICAL_AUTHOR_RE.search(author):
        reasons.append("classical_or_pre1900_author")
    return (bool(reasons), reasons)


# ─────────────────────────────────────────────────────────────────────────────
# Current-description junk detector (same rules as the general script,
# tightened in the previous task to handle apostrophes inside double-quoted
# blurbs and to recognize blog-post / catalog-prefix patterns)
# ─────────────────────────────────────────────────────────────────────────────

_DOUBLE_QUOTE_ATTR_RE = re.compile(
    r"""^\s*["“]"""
    r"""[^"“”]{3,600}"""
    r"""["”]\s*[-–—]\s*[A-Z]"""
)
_SINGLE_QUOTE_ATTR_RE = re.compile(
    r"""^\s*[‘']"""
    r"""[^‘’]{3,600}"""
    r"""[’']\s*[-–—]\s*[A-Z]"""
)
_RECOMMENDATION_RE = re.compile(
    r"\b(?:"
    r"goodreads\s+(?:profile|shelf|list|account|page)|"
    r"books\s+read|"
    r"covered\s+this\s+book|"
    r"(?:recommended|mentioned|cited|featured)\s+(?:by|this|on)|"
    r"on\s+(?:his|her|their|\w+'?s)\s+(?:reading|book)\s+list|"
    r"reading\s+list|"
    r"blog\s+post|"
    r"selected books|manual for civilization|"
    r"podcast\s*(?:ep(?:isode|\.)?)?\s*\#?\d|"
    r"(?:jocko|huberman|rogan|ferriss)\s+podcast|"
    r"(?:twitter|x\.com)\s+(?:post|thread|tweet)"
    r")\b",
    re.IGNORECASE,
)
_BLURB_ONLY_DOUBLE_RE = re.compile(r"""^\s*["“][^"“”]{3,400}["”]\s*$""")
_BLURB_ONLY_SINGLE_RE = re.compile(r"""^\s*[‘'][^‘’]{3,400}[’']\s*$""")
_CATALOG_NOTE_RE = re.compile(
    r"^\s*(?:account of|based on|description of|study of|story of|guide to|"
    r"introduction to|overview of)\b",
    re.I,
)
# Shipping / availability / fulfillment text that books picked up from
# marketplace metadata. ("Ships from USA. Will take 25-35 days." — Buffett.)
_SHIPPING_NOTE_RE = re.compile(
    r"\b(?:ships?\s+from|free\s+shipping|fast\s+shipping|"
    r"will\s+take\s+\d+|in\s+stock|out\s+of\s+stock|delivery\s+time|"
    r"sold\s+by|print\s+on\s+demand|library\s+binding|"
    r"binding\s*type|format[:\s]+(?:paperback|hardcover|kindle))\b",
    re.I,
)


def classify_current(desc: str) -> Tuple[str, List[str]]:
    """Return (class, reasons). class in {empty, junk, decent}."""
    if desc is None:
        return "empty", ["null"]
    s = desc.strip()
    if not s:
        return "empty", ["empty_after_strip"]
    reasons: List[str] = []
    if _DOUBLE_QUOTE_ATTR_RE.match(s) or _SINGLE_QUOTE_ATTR_RE.match(s):
        reasons.append("quote_attribution")
    if _BLURB_ONLY_DOUBLE_RE.match(s) or _BLURB_ONLY_SINGLE_RE.match(s):
        reasons.append("blurb_only")
    m = _RECOMMENDATION_RE.search(s)
    if m:
        reasons.append(f"recommendation_keyword:{m.group(0)[:30]}")
    if _CATALOG_NOTE_RE.match(s) and len(s) < 200:
        reasons.append("catalog_metadata_prefix")
    if _SHIPPING_NOTE_RE.search(s):
        reasons.append("shipping_or_marketplace_note")
    if len(s) < DECENT_CURRENT_MIN_LEN:
        reasons.append(f"too_short({len(s)})")
    if reasons:
        return "junk", reasons
    return "decent", []


# ─────────────────────────────────────────────────────────────────────────────
# Candidate quality flags — stricter than the general script
# ─────────────────────────────────────────────────────────────────────────────

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WS_COLLAPSE_RE = re.compile(r"\s+")


def normalize_candidate_text(s: str) -> str:
    if not s:
        return ""
    s = _HTML_TAG_RE.sub(" ", s)
    s = s.replace("\r", " ").replace("\n", " ")
    s = _WS_COLLAPSE_RE.sub(" ", s).strip()
    return s


_CANDIDATE_REJECTS = [
    # "Praise for X" / "Advance praise for X" followed by `:`, `.`, `,`, or
    # whitespace+quote-char (OL often writes the heading without a separating
    # colon — `Praise for X "If you want..."`).
    (re.compile(
        r"\b(?:advance\s+)?praise for\s+[A-Z][^:\"'‘’“”]{2,80}"
        r"(?:[:\.\,]|\s+[\"'‘’“”])",
        re.I,
    ), "embedded_praise_block"),
    (re.compile(r"\bnational\s+(?:#\s*\d+\s+)?bestseller\b", re.I),
     "marketing_national_bestseller_phrase"),
    (re.compile(r"\*{3,}"), "decorative_asterisk_blob"),
    (re.compile(r"\bgoodreads\s+(?:profile|shelf|page|account)\b", re.I),
     "goodreads_source_note"),
    # Embedded attribution: closing quote + 1-3 dashes + capitalized name.
    (re.compile(
        r"[\"'‘’“”]\s*[-–—]{1,3}\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b",
        re.M,
    ), "embedded_attribution_quote"),
    # NEW (top500): shipping / fulfillment / format-only metadata
    (_SHIPPING_NOTE_RE, "shipping_or_format_metadata"),
    # NEW (top500): a candidate that is JUST a quoted blurb with no body
    (re.compile(r"""^\s*["“][^"“”]{3,400}["”]\s*$"""), "candidate_is_blurb_only"),
    # NEW (top500): catalog-stub starts like "Account of …" without enough body
    (re.compile(
        r"^\s*(?:account of|description of|study of|guide to|"
        r"introduction to|overview of|based on)\b",
        re.I,
    ), "candidate_is_catalog_stub"),
]


def candidate_quality_flags(text: str) -> List[str]:
    flags: List[str] = []
    if not text:
        return ["empty"]
    if len(text) < CANDIDATE_MIN_LEN:
        flags.append(f"too_short({len(text)}<{CANDIDATE_MIN_LEN})")
    for pat, name in _CANDIDATE_REJECTS:
        if pat.search(text):
            flags.append(name)
    if text.lstrip().startswith(("*", "***")):
        flags.append("leading_asterisks")
    # De-duplicate while preserving order
    seen = set()
    dedup: List[str] = []
    for f in flags:
        if f not in seen:
            seen.add(f)
            dedup.append(f)
    return dedup


# ─────────────────────────────────────────────────────────────────────────────
# Open Library work-level description follow-up
# ─────────────────────────────────────────────────────────────────────────────

def _ol_work_description(work_key: str, timeout: int = 15) -> str:
    if not work_key or not work_key.startswith("/works/"):
        return ""
    url = f"https://openlibrary.org{work_key}.json"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "bookrecs-desc-backfill/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        desc = data.get("description")
        if isinstance(desc, dict):
            desc = desc.get("value", "")
        return desc if isinstance(desc, str) else ""
    except Exception as e:
        print(f"  [open_library] work-desc fetch failed for {work_key}: "
              f"{type(e).__name__}: {str(e)[:80]}")
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# Best description candidate
# ─────────────────────────────────────────────────────────────────────────────

def best_description_candidate(book: Dict[str, Any], source: str,
                               max_results: int, sleep: float) -> Optional[Dict[str, Any]]:
    title = (book.get("title") or "").strip()
    author = (book.get("author") or book.get("author_name") or "").strip()
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
            full_title = (f"{cand_title}: {cand_subtitle}"
                          if cand_subtitle else cand_title)
            cand_authors = ", ".join(vi.get("authors") or [])
            desc = normalize_candidate_text(vi.get("description") or "")
            score, method = score_candidate(title, author, full_title, cand_authors, False)
            ident_list = [ii.get("identifier", "")
                          for ii in (vi.get("industryIdentifiers") or [])]
            identifier = next((i for i in ident_list if i), "")
            candidates.append({
                "source": "google_books", "score": score, "method": method,
                "description": desc,
                "cand_title": full_title, "cand_author": cand_authors,
                "identifier": identifier, "work_key": "",
            })

    if source in ("open_library", "both"):
        docs = open_library_search(title, author, max_results=max_results)
        if sleep > 0:
            time.sleep(sleep)
        for d in docs:
            cand_title = d.get("title") or ""
            cand_authors = ", ".join(d.get("author_name") or [])
            work_key = d.get("key") or ""
            score, method = score_candidate(title, author, cand_title, cand_authors, False)
            candidates.append({
                "source": "open_library", "score": score, "method": method,
                "description": "",   # deferred follow-up
                "cand_title": cand_title, "cand_author": cand_authors,
                "identifier": work_key, "work_key": work_key,
            })

    if not candidates:
        return None
    candidates.sort(key=lambda c: c["score"], reverse=True)

    # Top-2 OL follow-ups for description body
    ol_followups = 0
    for c in candidates:
        if ol_followups >= 2:
            break
        if c["source"] == "open_library" and not c["description"] and c["work_key"]:
            ol_desc = _ol_work_description(c["work_key"])
            if ol_desc:
                c["description"] = normalize_candidate_text(ol_desc)
            ol_followups += 1
            if sleep > 0:
                time.sleep(sleep)

    for c in candidates:
        if c["description"]:
            return c
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Input loading
# ─────────────────────────────────────────────────────────────────────────────

def load_input_csv(path: str) -> List[Dict[str, Any]]:
    if not os.path.exists(path):
        raise SystemExit(f"input CSV not found: {path}")
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    out: List[Dict[str, Any]] = []
    for r in rows:
        out.append({
            "book_id": (r.get("id") or r.get("book_id") or "").strip(),
            "slug": (r.get("slug") or "").strip(),
            "title": (r.get("title") or "").strip(),
            "author": (r.get("author") or r.get("author_name") or "").strip(),
            "recs": int(r.get("recs") or r.get("recommendation_count") or 0),
            "current_description": (r.get("description") or ""),
            "isbn_10": (r.get("isbn_10") or "").strip(),
            "isbn_13": (r.get("isbn_13") or "").strip(),
        })
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Supabase access
# ─────────────────────────────────────────────────────────────────────────────

def _creds() -> Tuple[str, str]:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    key = (os.environ.get("SUPABASE_SECRET_KEY")
           or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or "")
    return url.rstrip("/"), key


def _req(method: str, url: str, headers: Dict[str, str],
         payload: Optional[Dict[str, Any]] = None) -> Any:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body) if body else None


def _supa_get_book(url: str, key: str, book_id: str) -> Optional[Dict[str, Any]]:
    params = {"select": "id,slug,title,description", "id": f"eq.{book_id}", "limit": "1"}
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode(params)
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    try:
        data = _req("GET", full, h) or []
        return data[0] if data else None
    except Exception as e:
        print(f"[supabase] fetch failed for {book_id}: {type(e).__name__}: {str(e)[:120]}")
        return None


def _supa_patch_description(url: str, key: str, book_id: str, description: str) -> None:
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode({"id": f"eq.{book_id}"})
    h = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    _req("PATCH", full, h, payload={"description": description})


# ─────────────────────────────────────────────────────────────────────────────
# Action classifier
# ─────────────────────────────────────────────────────────────────────────────

def classify_action(score: float, candidate_text: str, current_class: str,
                    candidate_flags: List[str],
                    edition_sensitive: bool,
                    edition_sensitive_reasons: List[str]) -> Tuple[str, str, str]:
    """Return (action, confidence, reason). Strict: would_backfill requires all
    of: source not edition-sensitive, candidate has no flags, candidate length
    sufficient, score >= threshold, current is eligible."""
    score_ok = score >= SCORE_HIGH_THRESHOLD
    length_ok = len(candidate_text) >= CANDIDATE_MIN_LEN
    eligible_current = current_class in ("empty", "junk")
    candidate_clean = not candidate_flags

    if (score_ok and length_ok and candidate_clean
            and eligible_current and not edition_sensitive):
        return "would_backfill", "high", (
            f"score {score:.3f} >= {SCORE_HIGH_THRESHOLD}; "
            f"candidate_len={len(candidate_text)} >= {CANDIDATE_MIN_LEN}; "
            f"current_class={current_class}; candidate_clean=True"
        )

    parts: List[str] = [
        f"score={score:.3f}",
        f"candidate_len={len(candidate_text)}",
        f"current_class={current_class}",
    ]
    if not score_ok:
        parts.append(f"below_high_threshold({SCORE_HIGH_THRESHOLD})")
    if not length_ok:
        parts.append(f"candidate_too_short(<{CANDIDATE_MIN_LEN})")
    if candidate_flags:
        parts.append("flags=" + ",".join(candidate_flags))
    if not eligible_current:
        parts.append("current_description_is_decent_skip_backfill")
    if edition_sensitive:
        parts.append("edition_sensitive=" + ",".join(edition_sensitive_reasons))
    confidence = "medium" if score >= 0.6 else "low"
    return "needs_manual_review", confidence, "; ".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# Preview mode
# ─────────────────────────────────────────────────────────────────────────────

def do_preview(args: argparse.Namespace) -> int:
    rows = load_input_csv(args.input)
    print("== Description backfill TOP500 PREVIEW (READ-ONLY) ==")
    print(f"input csv             : {args.input}")
    print(f"rows in input         : {len(rows)}")
    print(f"sources               : {args.source}")
    print(f"score-threshold       : {SCORE_HIGH_THRESHOLD}")
    print(f"candidate min length  : {CANDIDATE_MIN_LEN}")
    print()

    out_rows: List[Dict[str, Any]] = []
    for i, b in enumerate(rows, 1):
        current = b.get("current_description", "")
        current_class, current_reasons = classify_current(current)

        # Skip if existing description is decent — never overwrite.
        if current_class == "decent":
            out_rows.append({
                "book_id": b["book_id"], "slug": b["slug"], "title": b["title"],
                "author": b["author"], "recs": b["recs"],
                "current_description": current,
                "candidate_description": "", "candidate_source": "",
                "candidate_title": "", "candidate_author": "",
                "score": "", "confidence": "",
                "action": "skip",
                "reason": "current_description_is_decent; refusing to overwrite",
            })
            continue

        # Edition-sensitivity gate on the source book BEFORE we even try to score
        # a candidate. Religious / classical / anthology titles always go to manual.
        edition_sensitive, edition_reasons = classify_source_book(
            b["title"], b["author"]
        )

        print(f"[{i}/{len(rows)}] {b['slug']}  "
              f"(current={current_class}, edition_sensitive={edition_sensitive})")
        cand = best_description_candidate(
            b, args.source, args.max_results_per_source, args.sleep,
        )
        if cand is None:
            reason_bits = [
                f"current_class={current_class}",
                f"current_reasons={','.join(current_reasons)}",
                "no_candidate_with_description_from_any_source",
            ]
            if edition_sensitive:
                reason_bits.append("edition_sensitive=" + ",".join(edition_reasons))
            out_rows.append({
                "book_id": b["book_id"], "slug": b["slug"], "title": b["title"],
                "author": b["author"], "recs": b["recs"],
                "current_description": current,
                "candidate_description": "", "candidate_source": "",
                "candidate_title": "", "candidate_author": "",
                "score": 0.0, "confidence": "none",
                "action": "needs_manual_review",
                "reason": "; ".join(reason_bits),
            })
            continue

        cand_desc = cand.get("description", "")[:CANDIDATE_MAX_LEN]
        cand_flags = candidate_quality_flags(cand_desc)
        score = float(cand.get("score") or 0.0)
        action, confidence, reason_tag = classify_action(
            score, cand_desc, current_class, cand_flags,
            edition_sensitive, edition_reasons,
        )
        out_rows.append({
            "book_id": b["book_id"], "slug": b["slug"], "title": b["title"],
            "author": b["author"], "recs": b["recs"],
            "current_description": current,
            "candidate_description": cand_desc,
            "candidate_source": cand["source"],
            "candidate_title": cand["cand_title"],
            "candidate_author": cand["cand_author"],
            "score": round(score, 3),
            "confidence": confidence,
            "action": action,
            "reason": (
                f"current_reasons={','.join(current_reasons)}; "
                f"method={cand['method']}; identifier={cand['identifier']!r}; "
                f"{reason_tag}"
            ),
        })

    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=PREVIEW_COLUMNS)
        w.writeheader()
        for r in out_rows:
            w.writerow(r)

    n_back = sum(1 for r in out_rows if r["action"] == "would_backfill")
    n_manual = sum(1 for r in out_rows if r["action"] == "needs_manual_review")
    n_skip = sum(1 for r in out_rows if r["action"] == "skip")

    print()
    print("==================== TOP500 PREVIEW SUMMARY ====================")
    print(f"  rows in input          : {len(rows)}")
    print(f"  rows in preview        : {len(out_rows)}")
    print(f"    would_backfill       : {n_back}")
    print(f"    needs_manual_review  : {n_manual}")
    print(f"    skip                 : {n_skip}")
    print(f"  output csv             : {args.out}")
    print(f"  PATCH column (later)   : description only")
    print(f"  NO AI calls            : confirmed")
    print(f"  NO DB writes           : confirmed")

    if n_back > 0:
        print()
        print("=========== would_backfill rows ===========")
        for r in out_rows:
            if r["action"] != "would_backfill":
                continue
            cd = r["candidate_description"]
            print(f"  {r['slug']:55s}  score={str(r['score']):>5s}  cand_len={len(cd):>5d}  recs={r['recs']:>3}")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# Gated write mode
# ─────────────────────────────────────────────────────────────────────────────

def _load_eligible_preview_rows(preview_path: str) -> Tuple[List[Dict[str, Any]], int, List[Tuple[str, str]]]:
    """Defensive filter at load time: action=would_backfill AND confidence=high
    AND candidate length >= 180 AND score >= 0.82."""
    if not os.path.exists(preview_path):
        raise SystemExit(f"--preview file not found: {preview_path}")
    with open(preview_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    eligible: List[Dict[str, Any]] = []
    refused: List[Tuple[str, str]] = []
    for r in rows:
        slug = r.get("slug", "")
        action = (r.get("action") or "").strip()
        confidence = (r.get("confidence") or "").strip()
        cand = (r.get("candidate_description") or "")
        try:
            score = float(r.get("score") or 0)
        except (TypeError, ValueError):
            score = 0.0
        if action != "would_backfill":
            refused.append((slug, f"action={action!r}"))
            continue
        if confidence != "high":
            refused.append((slug, f"confidence={confidence!r}"))
            continue
        if not cand or len(cand) < CANDIDATE_MIN_LEN:
            refused.append((slug, f"candidate_len={len(cand)} below {CANDIDATE_MIN_LEN}"))
            continue
        if score < SCORE_HIGH_THRESHOLD:
            refused.append((slug, f"score {score} below threshold"))
            continue
        eligible.append(r)
    return eligible, len(rows), refused


def do_write(args: argparse.Namespace) -> int:
    if not args.confirm_description_backfill:
        raise SystemExit("[write] --write requires --confirm-description-backfill")
    if not args.backup_before_write:
        raise SystemExit("[write] --write requires --backup-before-write PATH")
    if not args.preview or not os.path.exists(args.preview):
        raise SystemExit(f"[write] --write requires --preview PATH (got: {args.preview!r})")
    url, key = _creds()
    if not url or not key:
        raise SystemExit("[write] live write requires SUPABASE_URL + SUPABASE_SECRET_KEY in env")

    eligible, rows_read, refused = _load_eligible_preview_rows(args.preview)
    print("== Description backfill TOP500 WRITE ==")
    print(f"mode                  : LIVE WRITE")
    print(f"preview               : {args.preview}")
    print(f"rows read             : {rows_read}")
    print(f"eligible rows         : {len(eligible)}")
    if refused:
        print(f"refused rows          : {len(refused)}")
        for slug, why in refused[:10]:
            print(f"  - {slug}: {why}")
    print(f"PATCH column          : description (ONLY)")
    print(f"no AI calls           : confirmed")

    backup_path = args.backup_before_write
    backup_dir = os.path.dirname(backup_path)
    if backup_dir:
        os.makedirs(backup_dir, exist_ok=True)

    plan: List[Dict[str, Any]] = []
    backup_rows: List[Dict[str, Any]] = []
    skipped_drift = 0
    skipped_missing = 0
    print(f"\n[backup] fetching {len(eligible)} live rows for drift check + backup…")
    for r in eligible:
        book_id = r.get("book_id", "")
        if not book_id:
            plan.append({"row": r, "live": None, "status": "skipped",
                         "reason": "missing book_id in preview row"})
            skipped_missing += 1
            continue
        live = _supa_get_book(url, key, book_id)
        if not live:
            plan.append({"row": r, "live": None, "status": "skipped",
                         "reason": "live row missing or fetch error"})
            skipped_missing += 1
            continue
        live_desc = (live.get("description") or "")
        preview_desc = (r.get("current_description") or "")
        if live_desc != preview_desc:
            plan.append({"row": r, "live": live, "status": "skipped",
                         "reason": "description drifted since preview"})
            skipped_drift += 1
            continue
        plan.append({"row": r, "live": live, "status": "would_write", "reason": ""})
        backup_rows.append({
            "book_id": live.get("id", ""),
            "slug": live.get("slug", ""),
            "title": live.get("title", ""),
            "description_before": live_desc,
        })

    with open(backup_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=BACKUP_COLUMNS)
        w.writeheader()
        for b in backup_rows:
            w.writerow(b)
    expected = sum(1 for p in plan if p["status"] == "would_write")
    if len(backup_rows) != expected:
        raise SystemExit(
            f"[backup] count mismatch ({len(backup_rows)} vs {expected}) — aborting before any PATCH"
        )
    print(f"[backup] wrote {len(backup_rows)} rows -> {backup_path}")

    print(f"\n[patch] writing description for {expected} rows…")
    updated = 0
    failed = 0
    for p in plan:
        if p["status"] != "would_write":
            continue
        r = p["row"]
        live = p["live"]
        cand = (r.get("candidate_description") or "")
        try:
            _supa_patch_description(url, key, live["id"], cand)
            p["status"] = "updated"
            p["reason"] = f"score {r.get('score', '')} from {r.get('candidate_source', '')}"
            updated += 1
        except Exception as e:
            p["status"] = "failed"
            p["reason"] = f"PATCH error: {type(e).__name__}: {str(e)[:120]}"
            failed += 1

    report_rows = []
    for p in plan:
        r = p["row"]
        live = p["live"] or {}
        before = live.get("description", "") if live else ""
        after = r.get("candidate_description", "") if p["status"] == "updated" else ""
        report_rows.append({
            "book_id": r.get("book_id", ""),
            "slug": r.get("slug", ""),
            "title": r.get("title", "") or live.get("title", ""),
            "status": p["status"],
            "reason": p["reason"],
            "description_before": before,
            "description_after": after,
            "candidate_source": r.get("candidate_source", ""),
            "score": r.get("score", ""),
        })
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=WRITE_REPORT_COLUMNS)
        w.writeheader()
        for rr in report_rows:
            w.writerow(rr)

    print()
    print("==================== TOP500 WRITE SUMMARY ====================")
    print(f"  rows read             : {rows_read}")
    print(f"  eligible              : {len(eligible)}")
    print(f"  updated               : {updated}")
    print(f"  skipped_drift         : {skipped_drift}")
    print(f"  skipped_missing       : {skipped_missing}")
    print(f"  failed                : {failed}")
    print(f"  backup                : {backup_path}")
    print(f"  report                : {args.out}")
    print(f"  PATCH column          : description only")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input",
                    default="rebuild_v2/live_missing_description_top500_audit_v1.csv",
                    help="Input CSV.")
    ap.add_argument("--out",
                    default="rebuild_v2/description_backfill_top500_preview_v1.csv",
                    help="Output preview CSV (default) or write report CSV in write mode.")
    ap.add_argument("--source", choices=["google_books", "open_library", "both"], default="both")
    ap.add_argument("--max-results-per-source", type=int, default=5)
    ap.add_argument("--sleep", type=float, default=0.3)
    # Gated write
    ap.add_argument("--preview", default="",
                    help="Path to a preview CSV. Required for --write.")
    ap.add_argument("--write", action="store_true",
                    help="GATED: also requires --confirm-description-backfill "
                         "AND --backup-before-write.")
    ap.add_argument("--confirm-description-backfill", action="store_true",
                    help="Second gate for live write.")
    ap.add_argument("--backup-before-write", default="",
                    help="Path to pre-write backup CSV. Required with --write.")
    args = ap.parse_args()

    if args.write:
        if args.out == "rebuild_v2/description_backfill_top500_preview_v1.csv":
            args.out = "rebuild_v2/description_backfill_top500_write_v1.csv"
        return do_write(args)
    return do_preview(args)


if __name__ == "__main__":
    raise SystemExit(main())
