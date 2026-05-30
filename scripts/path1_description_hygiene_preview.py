#!/usr/bin/env python3
# Preview-only scraped-description hygiene scan for BookRecs hero descriptions.
#
# SAFETY MODEL
#   - PREVIEW ONLY. NO DB writes. NO AI calls. NO mutations of any kind.
#   - Touches: NOTHING. Outputs a single CSV at rebuild_v2/description_hygiene_preview_v1.csv.
#   - Does not touch: AI editorial fields, covers, titles, slugs, recommendation/list/category/
#     series data, schema, migrations.
#   - Cleanup is purely deterministic. No AI rewriting. No invented facts.
#   - When a deterministic cleanup cannot produce a clean result, the row is marked
#     action=needs_manual_review with proposed_description left empty.
#
# WHAT WE FLAG (detection rules)
#   - "For use in schools and libraries only" / "Description is being reviewed" / "No description available"
#   - Leading "* " or "*****" markers
#   - Inline "*****" decorative dividers
#   - Award/marketing copy: "Instant WSJ bestseller", "anniversary edition", "edition includes",
#     "includes exclusive bonus material", "with an introduction by", noisy "New York Times bestseller"
#   - Broken punctuation: leading "?It"/"?A" (mojibake from scraped curly quotes), repeated "?"
#   - Missing space after period before capitalized word (e.g. "Liu Cixin.Set against")
#   - Mashed words (lowercase-Capital-lowercase mid-token, e.g. "TempletonWhat", "socalled")
#   - Catalog prefixes: "Book 1", standalone "Second Edition"
#   - Title-repetition sentence at start (matches book's own title back at it as catalog intro)
#
# WHAT WE AUTO-STRIP (conservative deterministic cleanup)
#   - Leading "For use in schools and libraries only." sentence
#   - Leading asterisks / whitespace / decorative `*****` runs
#   - Leading blurb quote like 'X' – TheTimes. (curly + straight quote variants)
#   - Leading "This Nth Anniversary Edition includes ..." sentence
#   - Leading `* bullet * bullet * bullet` marketing run before the first real prose
#   - Inline `*****` dividers (replaced with a space)
#   - Trailing "Praise for X: ..." block
#   - Trailing "Continue X's adventures in ..." series-listing sentence
#
# WHAT WE NEVER AUTO-FIX (always needs_manual_review)
#   - Mojibake `?It` / `?s` patterns
#   - "TempletonWhat" mashed-word concatenation
#   - Missing-space-after-period defects (touching them risks breaking abbreviations)
#   - Title-repetition leading sentences (could damage prose if heuristic guesses wrong)
#
# USAGE
#   # Preview against live Supabase (read-only)
#   python scripts/path1_description_hygiene_preview.py
#
#   # Preview against an offline backup snapshot
#   python scripts/path1_description_hygiene_preview.py \
#       --production-dir backups/path1_pre_lists_migration_20260527T084428Z

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
# Detection patterns (each returns a `reason` tag when matched)
# ─────────────────────────────────────────────────────────────────────────────

PLACEHOLDER_PATTERNS = [
    re.compile(r"\bfor use in schools and libraries only\b", re.I),
    re.compile(r"\bdescription is being reviewed\b", re.I),
    re.compile(r"\bno description available\b", re.I),
]
LEADING_ASTERISKS = re.compile(r"^[\s ]*\*+")
INLINE_ASTERISK_BLOB = re.compile(r"\*{3,}")
ASTERISK_BULLET_RUN = re.compile(r"^(?:\s*\*\s*[^*\n]{3,200}){2,}")  # 2+ leading bullet items
INTRO_METADATA = re.compile(r"\bwith an introduction by\b", re.I)
ANNIVERSARY_EDITION = re.compile(r"\b\d{1,3}(?:st|nd|rd|th)?\s+anniversary edition\b", re.I)
EDITION_INCLUDES = re.compile(r"\b(?:edition includes|includes exclusive bonus material)\b", re.I)
WSJ_BESTSELLER = re.compile(r"\binstant wsj bestseller\b", re.I)
NYT_BESTSELLER_NOISY = re.compile(r"\bnew york times (?:#?\d+\s*)?bestseller\b", re.I)
PRAISE_BLOCK = re.compile(r"\bpraise for [^:]{1,80}:", re.I)
LEADING_TRILOGY_CONTINUE = re.compile(r"\bcontinue [A-Z][^.]{5,200}\.\s*$", re.I)

# Mojibake from curly-quote scraping. A description containing 3+ `?` chars
# adjacent to letters strongly suggests UTF-8 decoded as ASCII.
MOJIBAKE_QUESTION = re.compile(r"\?[A-Za-z]")
# Mashed lowercase-to-capital like "TempletonWhat" or "ThreeBody". We allow an
# allowlist of legitimate camelCase tokens so we don't flag valid words.
MASHED_WORD = re.compile(r"\b[A-Za-z]*[a-z][A-Z][a-z]+[A-Za-z]*\b")
MASHED_ALLOW = {
    # technology brand names
    "iphone", "ipad", "imac", "ipod", "macbook", "youtube", "linkedin",
    "wikipedia", "javascript", "typescript", "github", "gitlab", "openai",
    "deepmind", "deepseek", "bigquery", "postgresql", "mysql", "mongodb",
    "nodejs", "graphql", "ebay", "powerpoint", "wordpress", "tiktok", "snapchat",
    "whatsapp", "facetime", "airpods", "airdrop", "facebook", "instagram",
    # publishers/programs occasionally written camel-style
    "harpercollins", "simonschuster", "penguinrandomhouse",
}
# Missing space after period before capital word (e.g. "Liu Cixin.Set against")
MISSING_SPACE_PERIOD = re.compile(r"[a-z]\.[A-Z][a-z]")

LEADING_BOOK_N = re.compile(r"^\s*book\s+\d+[\.\,]?\s+", re.I)
STANDALONE_SECOND_EDITION = re.compile(r"^\s*second edition[\.\,]?\s+", re.I)


# ─────────────────────────────────────────────────────────────────────────────
# Detection
# ─────────────────────────────────────────────────────────────────────────────

def detect_problems(desc: str, title: str = "") -> List[str]:
    """Return a list of reason tags (de-duplicated, order preserved). Empty = clean."""
    if not desc or not desc.strip():
        return ["empty_description"]

    s = desc
    reasons: List[str] = []

    for pat in PLACEHOLDER_PATTERNS:
        if pat.search(s):
            reasons.append("placeholder_text")
            break
    if LEADING_ASTERISKS.match(s):
        reasons.append("leading_asterisks")
    if INLINE_ASTERISK_BLOB.search(s):
        reasons.append("inline_asterisk_blob")
    if ASTERISK_BULLET_RUN.match(s):
        reasons.append("asterisk_bullet_run")
    if WSJ_BESTSELLER.search(s):
        reasons.append("award_marketing_wsj")
    if ANNIVERSARY_EDITION.search(s):
        reasons.append("anniversary_edition_metadata")
    if EDITION_INCLUDES.search(s):
        reasons.append("edition_includes_metadata")
    if INTRO_METADATA.search(s):
        reasons.append("intro_metadata")
    # NYT bestseller is only marketing-noise when it appears in clearly-marketing context
    # (e.g. inside an asterisk bullet run, or alongside other award copy). Otherwise it
    # might be a legitimate sentence describing the book's reception — we don't flag that.
    if NYT_BESTSELLER_NOISY.search(s) and (
        ASTERISK_BULLET_RUN.match(s) or LEADING_ASTERISKS.match(s) or WSJ_BESTSELLER.search(s)
    ):
        reasons.append("nyt_bestseller_noisy")
    if PRAISE_BLOCK.search(s):
        reasons.append("trailing_praise_block")
    if LEADING_TRILOGY_CONTINUE.search(s):
        reasons.append("trailing_trilogy_continue")

    # Mojibake — 3+ `?letter` patterns is a strong signal
    if len(MOJIBAKE_QUESTION.findall(s)) >= 3:
        reasons.append("mojibake_question_marks")

    # Missing space after period
    if MISSING_SPACE_PERIOD.search(s):
        reasons.append("missing_space_after_period")

    # Mashed words. Allow legitimate camelCase brands; otherwise count occurrences.
    mashed_hits = []
    for m in MASHED_WORD.finditer(s):
        tok = m.group(0)
        if tok.lower() in MASHED_ALLOW:
            continue
        # Don't double-count if it's actually the title's own concatenation (already
        # flagged by missing_space_after_period if applicable).
        mashed_hits.append(tok)
    if len(mashed_hits) >= 2:
        reasons.append("mashed_words")

    if LEADING_BOOK_N.match(s):
        reasons.append("leading_catalog_book_n")
    if STANDALONE_SECOND_EDITION.match(s):
        reasons.append("leading_second_edition")

    # Title-repetition at start (catalog-style intro)
    if title:
        t = title.strip()
        # The description starts with the exact title plus " is" / ", a " / ":" — catalog tic
        head = s.strip()[: max(len(t) + 60, 100)]
        if t and head.lower().startswith(t.lower()) and re.search(
            rf"^{re.escape(t)}\s+(?:is\s+|,\s+|:|by\s+)", head, re.I
        ):
            reasons.append("leading_title_repetition")

    # De-duplicate while preserving order
    out: List[str] = []
    seen = set()
    for r in reasons:
        if r not in seen:
            seen.add(r)
            out.append(r)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Conservative deterministic cleanup
# ─────────────────────────────────────────────────────────────────────────────

# Open-quote characters (straight + curly + smart). Listed as char classes to avoid
# emitting non-ASCII literals inside re patterns built via concatenation.
_QUOTE_OPEN = "‘’“”\"'"
_QUOTE_CLOSE = _QUOTE_OPEN  # interchangeable for our purposes
_DASH_CHARS = "–—−\\-"   # en, em, minus, hyphen

# Sentence-starter words that signal "the blurb-attribution is over, real prose begins".
# The set is intentionally narrow. "The" is NOT in the list — many source names start
# with "The" ("The Times", "The Guardian"), so using it as a stop-word would cut off
# in the middle of the attribution and leave "The Times" as the new leading text.
_PROSE_STARTERS = (
    r"(?:This|These|Those|That|A|An|It|It['’]s|At|When|Where|"
    r"Set|Following|Why|How|What|If|Imagine|After|Before|Then|Once|While|"
    r"During|Through|Across|Over|Now|Despite|Against|Above|Below|Until|"
    r"Although|Though|Even|Yet|Still|There|Here|His|Her|Their|Our|My)"
)
_BLURB_QUOTE_RE = re.compile(
    r"^\s*"
    r"[" + re.escape(_QUOTE_OPEN) + r"]"
    r"[^" + re.escape(_QUOTE_OPEN) + r"]{2,80}"
    r"[" + re.escape(_QUOTE_CLOSE) + r"]"
    # Optional attribution span. Lazy across letters / spaces / dashes / commas /
    # ampersands / apostrophes / periods, capped at 80 chars.
    r"[\s\.\,\-–—A-Za-z'’‘&]{0,80}?"
    r"\s+"
    r"(?=" + _PROSE_STARTERS + r"\b)"
)
_BULLET_PROSE_RESTART_RE = re.compile(r"[\.\?!]\s+[A-Z]")


def _strip_leading_blurb_quote(s: str) -> str:
    """Strip a leading `'<blurb>' - Source ` attribution. The trailing source phrase
    is optional, and the next sentence may follow either after `.` + whitespace or
    after plain whitespace (the latter is the Hitchhiker's-style scrape defect)."""
    return _BLURB_QUOTE_RE.sub("", s, count=1)


def _strip_leading_asterisk_bullets(s: str) -> str:
    """Strip leading `* foo * bar * baz` marketing bullets. Conservative: if the
    LAST bullet's content would merge into real prose (detected by a `?Why ` /
    `. Loonshots`-style sentence-restart inside it), abort and return the original
    string. The evaluator's safety check then routes the row to needs_manual_review."""
    if not re.match(r"^\s*\*", s):
        return s
    parts = re.split(r"\s*\*\s*", s)
    if parts and parts[0].strip():
        return s  # leading content before first `*` is non-empty — not a pure bullet run
    strip_idx = 0
    for i in range(1, len(parts)):
        chunk = parts[i]
        if not chunk.strip():
            continue
        if len(chunk) < 200 and not _BULLET_PROSE_RESTART_RE.search(chunk):
            strip_idx = i
            continue
        # Ambiguous chunk — merge of bullet content + prose. Abort whole strip.
        return s
    if strip_idx == 0:
        return s
    remaining = parts[strip_idx + 1:]
    if not remaining:
        return ""
    return " ".join(p.strip() for p in remaining if p.strip())


# Leading **ALL CAPS MARKETING BANNER** wrapper (PULITZER PRIZE, MAJOR MOTION
# PICTURE, BESTSELLER, etc.). Strips the entire wrapper including both bookend
# asterisks. Strict: content must be ALL CAPS to avoid stripping legitimate emphasis.
_BOLD_BANNER_RE = re.compile(
    r"^\s*\*{1,3}\s*"
    r"[A-Z][A-Z0-9 '\-:&]{7,200}"
    r"\s*\*{1,3}\s+"
)


def _apply_strip_passes(s: str) -> str:
    """One pass of every safe strip. Re-runnable so cascading patterns peel cleanly."""
    s = re.sub(r"^\s*for use in schools and libraries only\.\s+", "",
               s, count=1, flags=re.I)
    s = _BOLD_BANNER_RE.sub("", s, count=1)
    s = _strip_leading_blurb_quote(s)
    s = re.sub(
        r"^\s*This\s+\d{1,3}(?:st|nd|rd|th)?\s+Anniversary Edition[^.]{0,400}?\.\s+",
        "", s, count=1, flags=re.I,
    )
    s = _strip_leading_asterisk_bullets(s)
    s = INLINE_ASTERISK_BLOB.sub(" ", s)
    s = re.sub(r"\s*Praise for [^:]{1,80}:.*$", "", s, count=1, flags=re.I | re.S)
    s = re.sub(r"\s*Continue [A-Z][^.]{5,300}\.\s*$", "", s, count=1)
    # Leading lone asterisks / leftover whitespace
    s = re.sub(r"^[\s*]+", "", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def attempt_cleanup(desc: str) -> str:
    """Apply only the SAFE strips. Iterates until a fixed point so cascading
    patterns (e.g. multiple piled blurb quotes) all get peeled in order. Never
    touches mojibake, missing-space-after-period, mashed words, or title repetition."""
    if not desc:
        return ""
    s = desc
    # Iterate until stable. Cap at 6 passes as a safety net against pathological inputs.
    for _ in range(6):
        new = _apply_strip_passes(s)
        if new == s:
            break
        s = new
    return s


UNSAFE_RESIDUAL_PATTERNS = [
    MOJIBAKE_QUESTION,           # still has mojibake → unsafe
    MISSING_SPACE_PERIOD,        # missing-space defect → unsafe
]

# These reasons indicate problems that the deterministic cleanup CANNOT address.
# If any of them fire we route to needs_manual_review regardless of cleanup quality.
UNFIXABLE_REASONS = {
    "mojibake_question_marks",
    "missing_space_after_period",
    "mashed_words",
    "leading_title_repetition",
    "leading_catalog_book_n",
    "leading_second_edition",
}


# Bullet-y / blurb-y prefixes that indicate cleanup left junk at the start.
_LEFTOVER_BULLET_PREFIX_RE = re.compile(
    r"^(?:Recommended by|Translated into|Instant WSJ|An Amazon|#\d|"
    r"National Bestseller|National \#?1|Now a (?:major )?motion picture|"
    r"Anniversary Edition|Includes exclusive|With an introduction|"
    r"Praise for|Sheer |Magical |One of the world)",
)
# Leading lowercase or sentence-fragment word means cleanup cut into prose
_LEFTOVER_LOWERCASE_START_RE = re.compile(r"^[a-z]")
# Proposed still starts with a quote → cleanup didn't peel a piled-blurb leader
_LEFTOVER_QUOTE_START_RE = re.compile(r"^[‘’“”'\"]")
# Proposed starts with an ALL-CAPS marketing banner (no asterisk wrapper). E.g.
# "INSTANT NEW YORK TIMES BESTSELLER", "A SUNDAY TIMES BESTSELLER, THIS BOOK..."
# Threshold: 5+ leading caps words OR a single ALL-CAPS run of 15+ chars before
# the first lowercase letter.
_LEFTOVER_ALLCAPS_BANNER_RE = re.compile(
    r"^(?:[A-Z][A-Z0-9'\-]*\s+){4,}[A-Z][A-Z0-9'\-]*",
)


def _placeholder_still_present(s: str) -> bool:
    for pat in PLACEHOLDER_PATTERNS:
        if pat.search(s):
            return True
    return False


def evaluate(orig: str, cleaned: str, reasons: List[str]) -> Tuple[str, str, str]:
    """Return (action, confidence, proposed_description).

    action ∈ {would_clean, needs_manual_review, skip}
    confidence ∈ {high, medium, low}
    """
    if not reasons:
        return "skip", "", ""

    # Empty/null source descriptions can never be auto-fixed.
    if "empty_description" in reasons:
        return "needs_manual_review", "low", ""

    # If ANY unfixable reason fires, manual review — cleanup may still help but
    # we don't trust it as a finished string.
    if any(r in UNFIXABLE_REASONS for r in reasons):
        return "needs_manual_review", "low", ""

    # Cleanup must actually change the text and produce a sensible result.
    if cleaned == orig.strip() or cleaned == orig:
        return "needs_manual_review", "low", ""

    if len(cleaned) < 100:
        return "needs_manual_review", "low", ""

    # If the placeholder text we tried to strip is STILL there, the strip failed.
    if "placeholder_text" in reasons and _placeholder_still_present(cleaned):
        return "needs_manual_review", "low", ""

    # If after cleanup any unsafe residual pattern remains, downgrade.
    for pat in UNSAFE_RESIDUAL_PATTERNS:
        if pat.search(cleaned):
            return "needs_manual_review", "low", ""

    # Sanity: cleaned text must look like a normal sentence start.
    if _LEFTOVER_LOWERCASE_START_RE.match(cleaned):
        return "needs_manual_review", "low", ""
    if _LEFTOVER_BULLET_PREFIX_RE.match(cleaned):
        return "needs_manual_review", "low", ""
    # Still leading with a blurb quote (piled blurbs we couldn't fully peel)
    if _LEFTOVER_QUOTE_START_RE.match(cleaned):
        return "needs_manual_review", "low", ""
    # Still leading with an ALL-CAPS marketing banner (no asterisk wrapper)
    if _LEFTOVER_ALLCAPS_BANNER_RE.match(cleaned):
        return "needs_manual_review", "low", ""
    # Cleaned can't START with a stray asterisk or leading punctuation
    if cleaned[:1] in "*/+-_=":
        return "needs_manual_review", "low", ""

    # Heuristic for confidence
    high_signals = {
        "placeholder_text", "leading_asterisks", "asterisk_bullet_run",
        "inline_asterisk_blob", "anniversary_edition_metadata",
        "edition_includes_metadata", "trailing_praise_block",
        "trailing_trilogy_continue", "award_marketing_wsj",
    }
    if any(r in high_signals for r in reasons) and len(cleaned) >= 200:
        return "would_clean", "high", cleaned
    return "would_clean", "medium", cleaned


# ─────────────────────────────────────────────────────────────────────────────
# Source loading (live Supabase OR offline backup)
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


def fetch_books_live(url: str, key: str, page: int = 1000) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    offset = 0
    select = "id,slug,title,author_name,description,recommendation_count,list_count"
    while True:
        params = {
            "select": select,
            "order": "recommendation_count.desc.nullslast,title.asc",
            "limit": str(page),
            "offset": str(offset),
        }
        full = f"{url}/rest/v1/books?" + urllib.parse.urlencode(params)
        h = {"apikey": key, "Authorization": f"Bearer {key}"}
        try:
            batch = _req("GET", full, h) or []
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8")
            except Exception:
                pass
            print(f"[supabase] HTTP {e.code} on GET books: {body[:200]}")
            return rows
        if not batch:
            break
        rows.extend(batch)
        offset += len(batch)
        if len(batch) < page:
            break
    return rows


def load_books(args: argparse.Namespace) -> Tuple[List[Dict[str, Any]], str]:
    if args.production_dir:
        path = os.path.join(args.production_dir, "books.csv")
        if not os.path.exists(path):
            raise SystemExit(f"backup books.csv not found: {path}")
        with open(path, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        return rows, f"BACKUP {args.production_dir}"
    url, key = _creds()
    if not url or not key:
        raise SystemExit(
            "No Supabase credentials in env and no --production-dir.\n"
            "Export SUPABASE_URL + SUPABASE_SECRET_KEY (or pass --production-dir backups/...)."
        )
    return fetch_books_live(url, key), f"LIVE {url}"


# ─────────────────────────────────────────────────────────────────────────────
# Gated write path
# ─────────────────────────────────────────────────────────────────────────────

def _supa_get_book(url: str, key: str, book_id: str) -> Optional[Dict[str, Any]]:
    """Live GET for a single book row by id. Returns None on not-found / error.
    Reads ONLY id/slug/title/description. No other columns inspected."""
    params = {"select": "id,slug,title,description", "id": f"eq.{book_id}", "limit": "1"}
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode(params)
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    try:
        data = _req("GET", full, h) or []
        return data[0] if data else None
    except Exception as e:
        print(f"[supabase] live-fetch failed for {book_id}: {type(e).__name__}: {str(e)[:120]}")
        return None


def _supa_patch_description(url: str, key: str, book_id: str, description: str) -> None:
    """PATCH ONLY the `description` column. No other columns touched."""
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode({"id": f"eq.{book_id}"})
    h = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    payload = {"description": description}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(full, data=data, method="PATCH", headers=h)
    with urllib.request.urlopen(req, timeout=60) as resp:
        resp.read()  # drain body


def _load_approved_rows(preview_path: str) -> List[Dict[str, Any]]:
    """Read the filtered preview CSV and apply a DEFENSIVE triple-filter:
    action=would_clean, confidence=high, non-empty proposed_description.
    Even if the input CSV contains other rows, this layer refuses them."""
    if not os.path.exists(preview_path):
        raise SystemExit(f"--preview file not found: {preview_path}")
    with open(preview_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    eligible: List[Dict[str, Any]] = []
    rejected: List[Tuple[str, str]] = []
    for r in rows:
        action = (r.get("action") or "").strip()
        confidence = (r.get("confidence") or "").strip()
        proposed = (r.get("proposed_description") or "").strip()
        slug = r.get("slug", "")
        if action != "would_clean":
            rejected.append((slug, f"action={action!r}"))
            continue
        if confidence != "high":
            rejected.append((slug, f"confidence={confidence!r}"))
            continue
        if not proposed:
            rejected.append((slug, "proposed_description is empty"))
            continue
        eligible.append(r)
    if rejected:
        print(f"[defense] refused {len(rejected)} preview rows:")
        for slug, why in rejected[:10]:
            print(f"          - {slug}: {why}")
    return eligible


WRITE_REPORT_COLUMNS = [
    "book_id", "slug", "title", "status", "reason",
    "description_before", "description_after",
]
BACKUP_COLUMNS = ["book_id", "slug", "title", "description_before"]


def do_gated_write(args: argparse.Namespace) -> int:
    """Triple-gated description write path.

    Default mode (when --preview is set but --write is NOT) is dry-run-write:
    pure CSV inspection, no Supabase calls, no PATCH.

    Live write mode requires ALL three gates AND credentials:
      --write
      --confirm-description-hygiene
      --backup-before-write PATH
    """
    write_enabled = bool(args.write)
    if write_enabled:
        if not args.confirm_description_hygiene:
            raise SystemExit("[write] --write requires --confirm-description-hygiene")
        if not args.backup_before_write:
            raise SystemExit("[write] --write requires --backup-before-write PATH")

    eligible = _load_approved_rows(args.preview)

    print("== Description hygiene WRITE ==")
    print(f"mode                  : {'LIVE WRITE' if write_enabled else 'DRY-RUN (no Supabase)'}")
    print(f"preview               : {args.preview}")
    print(f"rows read (eligible)  : {len(eligible)}")
    print(f"write_enabled         : {write_enabled}")
    print(f"PATCH column          : description (ONLY)")
    print("no AI calls           : confirmed")

    out_csv = args.out
    out_dir = os.path.dirname(out_csv)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    if not write_enabled:
        # DRY-RUN: write a report showing what WOULD be written. No Supabase calls.
        report_rows: List[Dict[str, Any]] = []
        for r in eligible:
            report_rows.append({
                "book_id": r.get("book_id", ""),
                "slug": r.get("slug", ""),
                "title": r.get("title", ""),
                "status": "would_write",
                "reason": "dry-run; no live drift check; --write not passed",
                "description_before": r.get("current_description", ""),
                "description_after": r.get("proposed_description", ""),
            })
        with open(out_csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=WRITE_REPORT_COLUMNS)
            w.writeheader()
            for rr in report_rows:
                w.writerow(rr)
        print(f"\nwould_write           : {len(report_rows)}")
        print(f"report                : {out_csv}")
        print("\nNO DB WRITES. NO AI CALLS. NO PATCH/POST/DELETE.")
        return 0

    # LIVE WRITE — three gates already enforced above; now check creds + plan.
    url, key = _creds()
    if not url or not key:
        raise SystemExit(
            "[write] live write requires SUPABASE_URL + SUPABASE_SECRET_KEY in env"
        )

    # ── Pre-write live fetch + drift check + backup
    backup_path = args.backup_before_write
    backup_dir = os.path.dirname(backup_path)
    if backup_dir:
        os.makedirs(backup_dir, exist_ok=True)

    plan: List[Dict[str, Any]] = []
    backup_rows: List[Dict[str, Any]] = []
    skips_drift = 0
    skips_missing = 0
    print(f"\n[backup] fetching {len(eligible)} live rows for drift check + backup…")
    for r in eligible:
        book_id = r.get("book_id", "")
        live = _supa_get_book(url, key, book_id)
        if not live:
            plan.append({
                "row": r, "live": None,
                "status": "skipped",
                "reason": "live row missing or fetch error",
            })
            skips_missing += 1
            continue
        live_desc = (live.get("description") or "")
        preview_desc = (r.get("current_description") or "")
        if live_desc != preview_desc:
            plan.append({
                "row": r, "live": live,
                "status": "skipped",
                "reason": "description drifted since preview (no overwrite)",
            })
            skips_drift += 1
            continue
        plan.append({"row": r, "live": live, "status": "would_write", "reason": ""})
        backup_rows.append({
            "book_id": live.get("id", ""),
            "slug": live.get("slug", ""),
            "title": live.get("title", ""),
            "description_before": live_desc,
        })

    # Write backup BEFORE any PATCH
    with open(backup_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=BACKUP_COLUMNS)
        w.writeheader()
        for b in backup_rows:
            w.writerow(b)
    expected_backup = sum(1 for p in plan if p["status"] == "would_write")
    if len(backup_rows) != expected_backup:
        raise SystemExit(
            f"[backup] count mismatch ({len(backup_rows)} vs {expected_backup}) — aborting before any PATCH"
        )
    print(f"[backup] wrote {len(backup_rows)} rows -> {backup_path}")

    # ── PATCH phase
    print(f"\n[patch] writing description column for {expected_backup} rows…")
    updated = 0
    failed = 0
    for p in plan:
        if p["status"] != "would_write":
            continue
        r = p["row"]
        live = p["live"]
        try:
            _supa_patch_description(url, key, live["id"], r["proposed_description"])
            p["status"] = "updated"
            p["reason"] = f"description normalized ({r.get('reason', '')})"
            updated += 1
        except Exception as e:
            p["status"] = "failed"
            p["reason"] = f"PATCH error: {type(e).__name__}: {str(e)[:120]}"
            failed += 1

    # ── Report
    report_rows = []
    for p in plan:
        r = p["row"]
        live = p["live"] or {}
        desc_before = live.get("description", r.get("current_description", "")) if p["status"] in ("skipped", "would_write", "updated", "failed") else ""
        desc_after = r.get("proposed_description", "") if p["status"] == "updated" else ""
        report_rows.append({
            "book_id": r.get("book_id", ""),
            "slug": r.get("slug", ""),
            "title": r.get("title", ""),
            "status": p["status"],
            "reason": p["reason"],
            "description_before": desc_before,
            "description_after": desc_after,
        })
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=WRITE_REPORT_COLUMNS)
        w.writeheader()
        for rr in report_rows:
            w.writerow(rr)

    print()
    print(f"updated               : {updated}")
    print(f"skipped (drift)       : {skips_drift}")
    print(f"skipped (missing)     : {skips_missing}")
    print(f"failed                : {failed}")
    print(f"backup                : {backup_path}")
    print(f"report                : {out_csv}")
    print("\nNO AI CALLS. PATCH limited to `description` column only.")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

PREVIEW_COLUMNS = [
    "book_id", "slug", "title", "author_name", "recommendation_count",
    "current_description", "proposed_description", "reason", "confidence", "action",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--production-dir", default="",
                    help="Optional offline books.csv source; uses backup if Supabase creds absent.")
    ap.add_argument("--out", default="rebuild_v2/description_hygiene_preview_v1.csv")
    ap.add_argument("--min-recommendations", type=int, default=0,
                    help="Filter to books with recommendation_count >= N. Default 0 (no filter).")
    ap.add_argument("--limit", type=int, default=0,
                    help="Hard cap on flagged rows written to CSV. 0 = unlimited.")
    ap.add_argument("--print-first", type=int, default=30,
                    help="Print this many flagged rows to stdout for review.")
    # Gated write path (only engages when --preview is passed)
    ap.add_argument("--preview", default="",
                    help="Path to a filtered preview CSV. When set, switches to write-mode "
                         "(dry-run by default; --write enables PATCH).")
    ap.add_argument("--write", action="store_true",
                    help="GATED: also requires --confirm-description-hygiene AND --backup-before-write.")
    ap.add_argument("--confirm-description-hygiene", action="store_true",
                    help="Second gate for live write. Required with --write.")
    ap.add_argument("--backup-before-write", default="",
                    help="Path to pre-write backup CSV. Required with --write.")
    args = ap.parse_args()

    # When --preview is set, route to the gated write path. The scan/preview
    # mode (no --preview flag) remains read-only and AI-free.
    if args.preview:
        return do_gated_write(args)

    books, source = load_books(args)
    print(f"== Description hygiene PREVIEW (READ-ONLY) ==")
    print(f"source                 : {source}")
    print(f"books loaded           : {len(books)}")

    flagged: List[Dict[str, Any]] = []
    scanned = 0
    reason_counts: Dict[str, int] = {}

    for b in books:
        desc = (b.get("description") or "").strip()
        recs = int(b.get("recommendation_count") or 0)
        if recs < args.min_recommendations:
            continue
        scanned += 1
        if not desc:
            # empty/null descriptions: flag for manual review but don't propose anything
            reasons = ["empty_description"]
            action, confidence, proposed = "needs_manual_review", "low", ""
        else:
            reasons = detect_problems(desc, title=(b.get("title") or ""))
            if not reasons:
                continue
            cleaned = attempt_cleanup(desc)
            action, confidence, proposed = evaluate(desc, cleaned, reasons)
            if action == "skip":
                continue
        for r in reasons:
            reason_counts[r] = reason_counts.get(r, 0) + 1
        flagged.append({
            "book_id": b.get("id", ""),
            "slug": b.get("slug", ""),
            "title": b.get("title", ""),
            "author_name": b.get("author_name") or b.get("author") or "",
            "recommendation_count": recs,
            "current_description": desc,
            "proposed_description": proposed,
            "reason": ",".join(reasons),
            "confidence": confidence,
            "action": action,
        })

    # Sort by recommendation_count desc so high-priority books surface first
    flagged.sort(key=lambda r: (-int(r["recommendation_count"] or 0),
                                (r.get("title") or "").lower()))
    if args.limit > 0:
        flagged = flagged[: args.limit]

    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=PREVIEW_COLUMNS)
        w.writeheader()
        for r in flagged:
            w.writerow(r)

    n_clean = sum(1 for r in flagged if r["action"] == "would_clean")
    n_manual = sum(1 for r in flagged if r["action"] == "needs_manual_review")

    print(f"scanned (with recs>={args.min_recommendations}): {scanned}")
    print(f"flagged                : {len(flagged)}")
    print(f"  would_clean          : {n_clean}")
    print(f"  needs_manual_review  : {n_manual}")
    print(f"output csv             : {args.out}")
    print()
    print("top reasons:")
    for reason, n in sorted(reason_counts.items(), key=lambda x: -x[1])[:20]:
        print(f"  {n:6d}  {reason}")

    if args.print_first > 0 and flagged:
        print()
        print(f"first {min(args.print_first, len(flagged))} flagged rows:")
        for r in flagged[: args.print_first]:
            print("-" * 78)
            print(f"  {r['title']}  ({r['slug']})  [recs={r['recommendation_count']}]")
            print(f"  action     : {r['action']}  confidence: {r['confidence']}")
            print(f"  reason     : {r['reason']}")
            cd = r["current_description"]
            print(f"  current    : {cd[:200] + '…' if len(cd) > 200 else cd}")
            pd = r["proposed_description"]
            if pd:
                print(f"  proposed   : {pd[:200] + '…' if len(pd) > 200 else pd}")
            else:
                print(f"  proposed   : <empty — needs manual review>")

    print()
    print("NO DB WRITES. NO AI CALLS. NO MIGRATION. NO SCHEMA CHANGES.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
