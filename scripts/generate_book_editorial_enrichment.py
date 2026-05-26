#!/usr/bin/env python3
# Version: v9.6 — format-hallucination priority, theme_tensions debug scope, vibe/fact calibration
"""
Generate AI editorial enrichment for top BookRecs books.

This is for user-value content, not generic copied descriptions.

Writes these fields on books:
- editorial_summary
- best_for
- not_for
- key_themes
- difficulty_level
- recommendation_context
- source_quality_note
- ai_generated_at
- ai_quality_status

Safe defaults:
- Dry-run by default.
- Uses only existing DB facts as input.
- Does not invent recommenders, source URLs, ratings, or recommendation proof.
- Validates the AI JSON before writing.

Environment variables:
- SUPABASE_URL=https://your-project.supabase.co
- SUPABASE_SECRET_KEY=sb_secret_...
- DEEPSEEK_API_KEY=...      # preferred if you want DeepSeek
- OPENAI_API_KEY=...        # optional fallback

Examples:
  python generate_book_editorial_enrichment.py --limit 20 --dry-run --provider deepseek --model deepseek-v4-flash
  python generate_book_editorial_enrichment.py --limit 20 --write --provider deepseek --model deepseek-v4-flash --quality-status draft
  python generate_book_editorial_enrichment.py --limit 100 --offset 20 --write --provider deepseek --model deepseek-v4-flash --quality-status draft
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import socket
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


DEFAULT_REPORT = "book_editorial_enrichment_v7_report.csv"
ALLOWED_DIFFICULTY = {"easy", "medium", "hard", "unknown"}
GENERIC_BANNED_PHRASES = [
    # Source/proof/social overclaims
    "source-backed",
    "verified",
    "proof",
    "proven",
    "endorsement",
    "endorsements",
    "endorsed",
    "recommended by",
    "widely recommended",
    "personal recommendation",
    "personal recommendations",
    "passed along",
    "passed among",
    "passed between",
    "circulates",
    "circulate through",
    "shared among",
    "word of mouth",
    "word-of-mouth",
    "cited by",
    "cited in",
    "widely cited",
    "frequently cited",
    "heavy citation",
    "staple",
    "staple status",
    "rite-of-passage",
    "canonical",
    "cultural phenomenon",
    "beloved",
    "famous",
    "influential",
    "quoted endorsement",
    "quote coverage",
    "comes with a quote",
    "comes with a quoted",
    "every sampled recommendation",
    "all sampled recommendation",
    "all sampled recommendations",
    "each recommendation includes",
    "each signal includes",
    "verified endorsement",
    "verified proof",
    "source-backed recommendation",
    "source-backed recommendations",
    "backed by source",
    "backed by sources",
    "passed from person to person",
    "passed between colleagues",
    "passed along",
    "reading circles",
    "nearly unavoidable",
    "widely shared",
    "beloved by",
    "championed by",
    "endorsed by",
    "public figures",
    "all sampled",
    "all recommendation signals",
    "all recommendations",
    "each with source urls",
    "each recommendation",
    "each signal",
    "extraordinary recommendation breadth",
    "influenced generations",
    "persistent appeal",
    "the sampled recommendation data includes",
    # Publisher/AI hype
    "worldview-shattering",
    "mind bomb",
    "mind-blowing",
    "TED Talk",
    "must-read",
    "unforgettable",
    "page-turner",
    "landmark",
    "foundational",
    "masterpiece",
    "life-changing",
    "compelling read",
    "powerful book",
    "seminal",
    "game-changer",
    "beautifully written",
    "explores themes of",
    "human condition",
    "broad appeal",
    "beautifully rendered",
    "timeless classic",
    "thought-provoking read",
    "seminal work",
]

FACT_RISK_PHRASES = [
    "world's largest",
    "worlds largest",
    "largest hedge fund",
    "bestselling",
    "best-selling",
    "million copy",
    "millions of copies",
    "nobel laureate",
    "co-founder",
    "cofounder",
    "stanford lectures",
    "published in",
    "predicted the",
    "landmark work",
    "classic self-help",
    "foundational text",
    "new york times bestseller",
    "world's most successful",
    "worlds most successful",
    "most successful hedge fund",
]

# v7.5.1 — unsupported proof/prestige claim phrases
UNSUPPORTED_PROOF_PHRASES = [
    "decades of research",
    "decades of psychology research",
    "years of research",
    "research-backed",
    "evidence-based",
    "studies show",
    "research shows",
    "proven",
    "scientifically proven",
    "definitive",
    "landmark",
    "landmark work",
    "seminal",
    "foundational",
    "foundational text",
    "classic",
    "classic self-help",
    "canonical",
    "masterpiece",
    "time-tested",
    "award-winning",
    "bestseller",
    "bestselling",
    "influential",
    "widely influential",
    "world-changing",
    "widely regarded",
    "celebrated classic",
    "celebrated work",
    "celebrated book",
    "celebrated author",
    "widely celebrated",
    "highly celebrated",
    "iconic",
    "must-read",
]

# v7.5.1 — unsupported format claims (workbook/companion/interactive)
# v8 — generic copy phrases (warn for 1, reject if multiple)
GENERIC_COPY_PHRASES = [
    "readers gain",
    "readers come away",
    "readers who engage honestly",
    "the book explores",
    "the book examines",
    "compelling look",
    "powerful meditation",
    "masterful account",
    "remains relevant",
    "mental toolbox",
    "signature accessible skepticism",
    "vocabulary to spot",
    "persuasive lecture",
    "rigorous architecture",
    "durable framework",
    "paradigm shift",
    "rich tapestry",
    "sweeping narrative",
    "timely reminder",
]

# v8 — required DNF/mismatch tokens for not_for
DNF_TOKENS = [
    "slow", "dense", "repetitive", "dated", "ideological",
    "abstract", "tactical", "shallow", "emotionally heavy",
    "disturbing", "graphic", "meandering", "academic", "anecdotal",
    "workbook", "no step-by-step", "not a how-to", "likely dnf",
    "bounce off", "dnf",
]

# v7.5.1 — unsupported format claims (workbook/companion/interactive)
UNSUPPORTED_FORMAT_PHRASES = [
    "workbook",
    "interactive companion",
    "guided journal",
    "journaling prompts",
    "fill-in-the-blank",
    "exercises",
    "companion guide",
    # v9.2 — "templates" only when paired with format/claim words
    "workbook templates",
    "fill-in templates",
    "downloadable templates",
    "exercises and templates",
    "worksheets and templates",
    "practical templates",
    "step-by-step templates",
    "ready-to-use templates",
    "business templates included",
    "includes templates",
    "the book includes templates",
    # v9.5 — format hallucination terms (Atomic Habits-style)
    "workbook format",
    "workbook-style",
    "guided prompts",
    "worksheet",
    "tracking sheets",
    "fill-in prompts",
    "companion workbook",
    "downloadable worksheets",
    "planner",
    "course book",
    "exercise book",
]

# v9.2 — abstract/critical "templates" uses that should NOT be rejected
TEMPLATE_ABSTRACT_PATTERNS = [
    "case-study templates",
    "narrative templates",
    "genre templates",
    "thinking templates",
    "generic templates",
    "tired templates",
    "tired case-study templates",
    "case-study patterns",
    "template-style",
]

# v8.5 — unsupported medical/research claims (hard reject)

# v9.2 — unsupported medical/research claims (hard reject)
UNSUPPORTED_MEDICAL_PHRASES = [
    "well-researched",
    "grounded in research",
    "clinical evidence",
    "therapeutic potential",
    "treat depression",
    "treat addiction",
    "treat anxiety",
    "mental health treatment",
    "neuroscience proves",
    "studies prove",
    "research confirms",
    "evidence shows",
    "scientifically supported",
    "backed by science",
    "proven to treat",
    "clinically proven",
    "medically reviewed",
    "published research",
    "peer-reviewed",
    "double-blind",
    # v9.2 — mental health / therapy / psychedelic research claims
    "psychedelic research for mental health",
    "psychedelics and mental health",
    "mental health",
    "clinical rigor",
    "clinical data",
    "therapeutic context",
    "therapists and patients",
    "patients",
    "client",
    "therapy",
    "neuroscience",
    "scientific dive",
]
PUBLISHER_SWEEPING_PHRASES = [
    "sweeping narrative",
    "sweeping portrait",
    "sweeping masterpiece",
    "sweeping account",
    "sweeping epic",
]

# v8.4 — low-risk style phrases: sanitize, don't reject
LOW_RISK_STYLE_REPLACEMENTS = {
    "fans of": "readers who like",
    "Fans of": "Readers who like",
    "sweeping assertions": "broad, forceful claims",
    "sweeping claims": "broad claims",
    "sweeping generalizations": "broad generalizations",
    "intellectually stimulating": "idea-heavy",
    "Intellectually stimulating": "Idea-heavy",
    "thought-provoking": "discussion-friendly",
    "Thought-provoking": "Discussion-friendly",
    "the main value is": "what works best is",
    "The main value is": "What works best is",
    "main value is": "useful part is",
    "compelling": "strong",
    "Compelling": "Strong",
    "powerful": "direct",
    "Powerful": "Direct",
}

PUBLIC_FIELDS = [
    "quick_verdict",
    "editorial_summary",
    "best_for",
    "not_for",
    "theme_tensions",
    "key_themes",
    "emotional_journey",
    "reading_pace_profile",
    "vibe_tags",
    "difficulty_level",
    "recommendation_context",
    "discussion_potential",
    "comparable_experience",
]

COMMON_SINGLE_WORD_EXCEPTIONS = {
    "history",
    "science",
    "business",
    "finance",
    "psychology",
    "philosophy",
    "leadership",
    "education",
    "technology",
    "investing",
    "writing",
}

BAD_DESCRIPTION_MARKERS = [
    "goodreads",
    "tanggal terbit",
    "informasi lainnya",
    "penerbit",
    "jumlah halaman",
    "isbn",
    "sinopsis",
    "el libro",
    "traducido",
    "vendidos",
]

REPORT_FIELDS = [
    "status",
    "reason",
    "book_id",
    "slug",
    "title",
    "author",
    "quick_verdict",
    "editorial_summary",
    "best_for",
    "not_for",
    "theme_tensions",
    "key_themes",
    "emotional_journey",
    "reading_pace_profile",
    "vibe_tags",
    "difficulty_level",
    "recommendation_context",
    "discussion_potential",
    "comparable_experience",
    "source_quality_note",
    "context_recommender_names",
    "context_recommender_roles",
    "context_list_names",
    "context_source_url_count",
    "context_sampled_recommendation_count",
    "write_quality_status",
    "quality_warnings",
    "raw_output",
]

LIST_CACHE: Optional[Dict[str, Dict[str, Any]]] = None
SERIES_CACHE: Optional[Dict[str, Dict[str, Any]]] = None


def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def scrub_name_from_text(text: str, recommender_names: List[str], allowed_names: set) -> str:
    """Remove recommender names from text. Does not scrub book author or title words."""
    result = text
    for name in recommender_names:
        name = name.strip()
        if not name or len(name) <= 3:
            continue
        name_lower = name.lower()
        if any(an in name_lower for an in allowed_names):
            continue
        pattern = re.compile(re.escape(name), re.IGNORECASE)
        result = pattern.sub("[a recommendation signal]", result)
    return result


def _is_negated_context(text: str, phrase: str) -> bool:
    """Check if a format phrase appears only in negated/mismatch context."""
    text_lower = text.lower()
    phrase_lower = phrase.lower()
    negators = [" not ", " no ", " without ", " doesn't ", " does not "]
    mismatch_patterns = [
        "skip if you want",
        "not for readers who want",
        "readers seeking",
        "this is not a",
        "doesn't offer",
        "don't expect",
        "won't find",
        "isn't a",
        "is not a",
        # v9.3 — workbook/exercises negated/mismatch context
        "readers who want a workbook",
        "if you want exercises",
        "not a workbook",
        "this stays in explanation mode",
        "skip if you need hands-on exercises",
        "not for readers wanting fill-in exercises",
        "if you want a workbook",
        "if you want hands-on exercises",
        "skip if you want exercises",
        "not an exercise book",
        "not a practical workbook",
        "this is not a how-to workbook",
        "does not include exercises",
        "no exercises",
        "lacks exercises",
        # v9.5 — more negated format patterns
        "if you want a guided journal",
        "if you want a workbook",
        "not a step-by-step guide",
        "not a planner",
        "did not write this as a workbook",
        "skip if you want a workbook",
        "readers seeking a workbook",
    ]
    pos = text_lower.find(phrase_lower)
    if pos == -1:
        return False
    window_start = max(0, pos - 60)
    window_end = min(len(text_lower), pos + len(phrase_lower) + 60)
    window = text_lower[window_start:window_end]
    if any(n in window for n in negators):
        return True
    if any(mp in window for mp in mismatch_patterns):
        return True
    return False


def safe_description_for_ai(value: Any) -> str:
    description = clean(value)
    if len(description) < 80:
        return ""
    lowered = description.lower()
    if any(marker in lowered for marker in BAD_DESCRIPTION_MARKERS):
        return ""
    return description[:900]


def supabase_base() -> Tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key:
        raise SystemExit("Missing SUPABASE_URL and SUPABASE_SECRET_KEY.")
    return url, key


def validate_supabase_env() -> None:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url:
        raise SystemExit("Missing or invalid SUPABASE_URL")
    if not url.startswith("https://"):
        raise SystemExit("SUPABASE_URL must start with https://")
    if not key:
        raise SystemExit("Missing SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY")


def supabase_headers(prefer: str = "return=representation") -> Dict[str, str]:
    _, key = supabase_base()
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def _is_network_error(error: Exception) -> bool:
    if isinstance(error, urllib.error.URLError):
        return True
    if isinstance(error, socket.gaierror):
        return True
    if isinstance(error, TimeoutError):
        return True
    if isinstance(error, ConnectionError):
        return True
    if isinstance(error, OSError):
        return True
    return False


def _short_error(error: Exception) -> str:
    msg = str(error)
    return msg[:120] if len(msg) > 120 else msg


def supabase_fetch(url: str, method: str = "GET", payload: Optional[Dict[str, Any]] = None, headers: Optional[Dict[str, str]] = None, timeout: int = 90, max_attempts: int = 3) -> Any:
    """Robust Supabase fetch with retry and backoff."""
    last_error = None
    for attempt in range(1, max_attempts + 1):
        try:
            return http_json(url, method=method, payload=payload, headers=headers, timeout=timeout)
        except (urllib.error.URLError, socket.gaierror, TimeoutError, ConnectionError, OSError) as exc:
            last_error = exc
            if attempt < max_attempts:
                delay = 2 ** (attempt - 1)
                print(f"[supabase] fetch attempt {attempt}/{max_attempts} failed: {_short_error(exc)}")
                print(f"[supabase] retrying in {delay}s...")
                time.sleep(delay)
            else:
                print(f"[supabase] fetch attempt {attempt}/{max_attempts} failed: {_short_error(exc)}")
        except Exception:
            raise
    raise last_error  # type: ignore


def http_json(url: str, method: str = "GET", payload: Optional[Dict[str, Any]] = None, headers: Optional[Dict[str, str]] = None, timeout: int = 90) -> Any:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw) if raw else None


def fetch_books(limit: int, offset: int, only_missing: bool = True, fetch_retries: int = 3) -> List[Dict[str, Any]]:
    url, _ = supabase_base()
    params = {
        "select": "id,slug,title,author_name,description,recommendation_count,editorial_summary,ai_quality_status",
        "order": "recommendation_count.desc.nullslast,title.asc",
        "limit": str(limit),
        "offset": str(offset),
    }
    if only_missing:
        params["editorial_summary"] = "is.null"
    full_url = f"{url}/rest/v1/books?" + urllib.parse.urlencode(params)
    return supabase_fetch(full_url, headers=supabase_headers(), max_attempts=fetch_retries) or []


def safe_get(endpoint: str, params: Dict[str, str]) -> List[Dict[str, Any]]:
    url, _ = supabase_base()
    try:
        return supabase_fetch(f"{url}/rest/v1/{endpoint}?" + urllib.parse.urlencode(params), headers=supabase_headers(), max_attempts=3) or []
    except Exception as exc:
        print(f"[warn] {endpoint} query failed: {exc}")
        return []


def fetch_table_cache(endpoint: str, limit: int = 6000) -> Dict[str, Dict[str, Any]]:
    rows = safe_get(
        endpoint,
        {
            "select": "*",
            "limit": str(limit),
        },
    )
    return {clean(row.get("id")): row for row in rows if clean(row.get("id"))}


def get_list_cache() -> Dict[str, Dict[str, Any]]:
    global LIST_CACHE
    if LIST_CACHE is None:
        LIST_CACHE = fetch_table_cache("lists", limit=1000)
        print(f"[context] Loaded {len(LIST_CACHE)} lists into local cache.")
    return LIST_CACHE


def get_series_cache() -> Dict[str, Dict[str, Any]]:
    global SERIES_CACHE
    if SERIES_CACHE is None:
        SERIES_CACHE = fetch_table_cache("series", limit=6000)
        print(f"[context] Loaded {len(SERIES_CACHE)} series into local cache.")
    return SERIES_CACHE


def first_present(row: Dict[str, Any], keys: List[str]) -> Any:
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return value
    return ""


def normalize_list_or_series(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "name": clean(first_present(row, ["name", "title", "display_name", "category_name"])),
        "slug": clean(row.get("slug")),
        "description": clean(first_present(row, ["description", "summary", "intro", "meta_description"])),
        "book_count": first_present(row, ["book_count", "books_count", "count"]),
    }


def fetch_recommendations(book_id: str, limit: int = 12) -> List[Dict[str, Any]]:
    rows = safe_get(
        "book_recommendations",
        {
            "select": "source_url,source_name,quote,confidence_score,people(name,role)",
            "book_id": f"eq.{book_id}",
            "limit": str(limit),
            "order": "confidence_score.desc.nullslast",
        },
    )
    out = []
    for row in rows:
        person = row.get("people") or {}
        out.append(
            {
                "person_name": clean(person.get("name")),
                "person_role": clean(person.get("role")),
                "source_url": clean(row.get("source_url")),
                "source_name": clean(row.get("source_name")),
                "quote": clean(row.get("quote"))[:350],
                "confidence_score": row.get("confidence_score"),
            }
        )
    return out


def useful_role(role: str) -> str:
    role = clean(role)
    if not role:
        return ""
    lowered = role.lower()
    bad_markers = [
        "http",
        "@",
        ".com",
        "unknown",
        "n/a",
        "none",
    ]
    if any(marker in lowered for marker in bad_markers):
        return ""
    if len(role) < 3 or len(role) > 80:
        return ""
    return role


def summarize_roles(recommendations: List[Dict[str, Any]], max_roles: int = 8) -> List[str]:
    roles: List[str] = []
    for rec in recommendations:
        role = useful_role(rec.get("person_role", ""))
        if not role:
            continue
        normalized = role.lower()
        if normalized not in [r.lower() for r in roles]:
            roles.append(role)
        if len(roles) >= max_roles:
            break
    return roles


def public_recommendation_signals(recommendations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # Never send person names to the LLM. Names stay only in CSV report columns for human audit.
    signals = []
    for rec in recommendations:
        signals.append(
            {
                "has_source_url": clean(rec.get("source_url", "")).startswith("http"),
                "source_name": clean(rec.get("source_name")),
                "has_quote": len(clean(rec.get("quote"))) >= 50,
                "confidence_score": rec.get("confidence_score"),
                "person_role": useful_role(rec.get("person_role", "")),
            }
        )
    return signals


def fetch_lists(book_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    # Two-step fetch avoids PostgREST nested relationship errors when FK
    # relationship names differ from table names.
    links = safe_get(
        "book_lists",
        {
            "select": "list_id",
            "book_id": f"eq.{book_id}",
            "limit": str(limit),
        },
    )
    list_ids = [clean(r.get("list_id")) for r in links if clean(r.get("list_id"))]
    if not list_ids:
        return []
    by_id = get_list_cache()
    return [normalize_list_or_series(by_id[list_id]) for list_id in list_ids if list_id in by_id][:limit]


def fetch_series(book_id: str, limit: int = 5) -> List[Dict[str, Any]]:
    links = safe_get(
        "book_series",
        {
            "select": "series_id",
            "book_id": f"eq.{book_id}",
            "limit": str(limit),
        },
    )
    series_ids = [clean(r.get("series_id")) for r in links if clean(r.get("series_id"))]
    if not series_ids:
        return []
    by_id = get_series_cache()
    return [normalize_list_or_series(by_id[series_id]) for series_id in series_ids if series_id in by_id][:limit]


def build_context(book: Dict[str, Any]) -> Dict[str, Any]:
    book_id = book["id"]
    recommendations = fetch_recommendations(book_id)
    lists = fetch_lists(book_id)
    series = fetch_series(book_id)
    source_backed_count = sum(1 for r in recommendations if r.get("source_url", "").startswith("http"))
    recommender_names = [r["person_name"] for r in recommendations if r.get("person_name")]
    role_summary = summarize_roles(recommendations)
    public_signals = public_recommendation_signals(recommendations)
    context = {
        "content_boundary": {
            "allowed_general_knowledge": "You may use broad, high-confidence book knowledge for content framing only.",
            "not_allowed": "Do not add awards, sales numbers, credentials, company facts, publication facts, edition facts, source proof, recommender names, or quotes unless provided here.",
            "description_note": "book.description is omitted when missing, too short, non-English, or likely scraped metadata.",
        },
        "book": {
            "title": book.get("title"),
            "author_name": book.get("author_name"),
            "recommendation_count": book.get("recommendation_count"),
            "description": safe_description_for_ai(book.get("description")),
        },
        "context_quality": {
            "has_book_description": bool(safe_description_for_ai(book.get("description"))),
            "sampled_recommendations": len(recommendations),
            "sampled_source_backed_recommendations": source_backed_count,
            "sampled_lists": len(lists),
            "sampled_series": len(series),
            "recommender_roles_in_sample": role_summary,
            "public_copy_rule": "Do not name individual recommenders in public editorial fields. Use role/category patterns only.",
        },
        "recommendation_signals_sample": public_signals,
        "lists": [{"name": clean(l.get("name")), "book_count": l.get("book_count"), "description": clean(l.get("description"))[:220]} for l in lists],
        "series": [{"name": clean(s.get("name")), "book_count": s.get("book_count"), "description": clean(s.get("description"))[:220]} for s in series],
        "source_backed_recommendation_count_in_sample": source_backed_count,
        "sampled_recommendation_count": len(recommendations),
    }
    context["_report_flat"] = {
        "context_recommender_names": " | ".join(recommender_names[:12]),
        "context_recommender_roles": " | ".join(role_summary),
        "context_list_names": " | ".join(clean(l.get("name")) for l in lists if clean(l.get("name"))),
        "context_source_url_count": source_backed_count,
        "context_sampled_recommendation_count": len(recommendations),
    }
    return context


GLOBAL_CONTRACT_TEXT: Optional[str] = None


def load_editorial_contract(path: str) -> Optional[str]:
    """Load compact editorial contract from markdown file. Returns text or None."""
    import pathlib as pl
    if not pl.Path(path).exists():
        print(f"[contract] File not found: {path}. Using hardcoded prompt.")
        return None
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    stale_markers = [
        "Current v8", "not yet implemented", "Future (recommended)",
        "not yet implemented in v8",
    ]
    for marker in stale_markers:
        if marker.lower() in text.lower():
            print(f"[contract] WARNING: stale text found in {path}: '{marker}'. Falling back to hardcoded prompt.")
            return None
    # Extract the production prompt skeleton section (after ## Production Prompt Skeleton)
    skeleton_start = text.find("## Production Prompt Skeleton")
    if skeleton_start >= 0:
        text = text[skeleton_start:]
    # Extract the code block between ``` markers
    code_start = text.find("```")
    if code_start >= 0:
        code_end = text.find("```", code_start + 3)
        if code_end >= 0:
            contract_text = text[code_start + 3:code_end].strip()
            # Remove leading/trailing ``` markers if present
            contract_text = contract_text.replace("```", "")
            print(f"[contract] Loaded compact contract from {path} ({len(contract_text.split())} words).")
            return contract_text
    # Fallback: return entire text trimmed
    print(f"[contract] Loaded full contract from {path}.")
    return text.strip()


def system_prompt(contract_text: Optional[str] = None) -> str:
    if contract_text:
        # Inject the contract + trailing rules
        return (
            contract_text + "\n\n"
            "Return strict JSON only. No markdown. No commentary. Do not include recommendation_context in your response."
        )
    return (
        "You generate internal draft editorial guidance for a book recommendation site. "
        "Your target is 5/5 reader-fit quality, not just acceptable copy. A safe but generic answer is a failure. "
        "Your job is NOT to summarize the book. Your job is to help a Reddit-style book discovery user decide whether this book fits their taste, mood, life-state, and patience level. "
        "The reader is deciding whether to spend 8-15 hours on this book. They are asking: will I like this? When should I read it? What mood or life-state fits it? What will annoy me? Where might I DNF? "
        "Write like a sharp, honest reader-fit recommender. Do NOT write like a publisher, professor, literary critic, MBA consultant, marketer, or Wikipedia summary. "
        "Every field must help a reader decide whether this book fits their taste, mood, patience, and life-state. Do not summarize the book unless the summary directly supports a reader-fit decision. "
        "Use concrete mismatch language. The best output should prevent the wrong reader from wasting 8-15 hours. "
        "Before output, silently reject your own draft if it sounds like a publisher blurb, critic paragraph, business-school note, or generic AI summary. "
        "ABSOLUTE RULES: "
        "Do not mention recommenders, list creators, celebrities, curators, influencers, source names, or public figures. Only mention the book author or people explicitly present in safe book metadata. "
        "Do not claim awards, sales, bestseller status, translation counts, publication years, institutional affiliations, public influence, or research authority unless explicitly present in SAFE FACTS. "
        "Do not use prestige/proof phrases: classic, canonical, landmark, seminal, definitive, masterpiece, research-backed, evidence-based, proven, time-tested, decades of research, studies show, research shows, widely regarded, influential, world-changing. "
        "Do not claim any medical, therapeutic, clinical, or scientific efficacy: do not say treats depression, treats addiction, treats anxiety, therapeutic potential, clinical evidence, neuroscience proves, studies prove, research confirms, evidence shows, scientifically supported, well-researched, grounded in research. "
        "You may say a book discusses psychedelic therapy or reports on research — but never claim the book proves efficacy or provides clinical evidence. "
        "Do not say recommended by. Do not say must-read. Do not use explores themes of. Do not say page-turner. "
        "Do not describe the book as a workbook, companion, guided journal, templates, exercises, course, worksheet, or planner unless SAFE FACTS explicitly say that. "
        "Do not call a book a workbook, journal, companion, planner, course, or exercise book unless the title or metadata explicitly includes those words. Never infer workbook format from practical content. If the reader wants exercises but the book is not a workbook, say it lacks exercises instead of calling it a workbook. "
        "FIELD JOBS: "
        "quick_verdict: One blunt read-if + skip-if sentence. Must answer: When is this the right book? When is this the wrong book? What makes someone bounce? Bad: 'Read if you want a thought-provoking book about history.' Good: 'Read when you want a short, combative startup manifesto from someone who actually built a monopoly; skip if you need evidence, nuance, or steps you can apply Monday morning.' "
        "editorial_summary: 70-95 words. Must include reading experience, useful part, and annoying/limiting part. Must not be a neutral book report. Must not overstate factual claims. Answer: What is this book like to actually read? What will grating or rewarding about the experience? "
        "best_for: Three specific reader situations. Each MUST include at least 2 of: concrete reader identity, concrete life/work situation, concrete reading mood, concrete problem they are trying to solve, concrete reason this book fits now. Bad: 'a curious non-historian who wants a big narrative.' Good: 'a reader who loves big-history podcasts but wants a sharper argument to debate, not a careful academic survey'; 'someone in a grief or burnout season who wants a short, severe book about meaning without motivational softness'; 'a PM inside a legacy company trying to explain why a low-margin competitor matters before leadership takes it seriously.' "
        "not_for: Three specific mismatch warnings. At least one must identify a likely DNF point. Name the friction: slow, repetitive, ideological, abstract, dated, dense, anecdote-heavy, emotionally heavy. Be blunt. Bad: 'readers who want a how-to guide.' Good: 'the case studies are all from 1980s manufacturing — likely DNF point around chapter 3 if you work in software and need examples that feel current.' "
        "theme_tensions: 4-5 tensions with friction or tradeoffs that create real discussion. "
        "emotional_journey: Describe how it feels to move through the book. MUST include start feeling, mid-book friction, ending aftertaste, and wrong-reader emotional reaction. Bad: 'engaging and thought-provoking.' Good: 'starts like a jolt of clarity, gets irritating when the author's certainty hardens, and ends either as a useful provocation or an overconfident sermon depending on whether you bought in.' "
        "reading_pace_profile: Tell the reader how this physically reads — skimmable, dense, one-sitting, read in chunks, works as a slow reflective read, early chapters are the hurdle, etc. "
        "vibe_tags: 5-8 lowercase hyphenated tags. No cringe, hype, prestige, or status tags. "
        "discussion_potential: Name what people will actually argue about. Bad: 'great for discussion.' Good: 'people will argue whether the book is empowering or just repackaged individualism.' "
        "comparable_experience: Compare reading experience, not status. No prestige comparisons. "
        "STYLE: Prefer reader-fit language: 'useful if...' 'likely to lose you when...' 'best when you want...' 'annoying if...' 'better as a slow read than a skim...' 'this helps most when...' 'the tricky part is...' "
        "Avoid critic/MBA wording: 'framework' 'mental model' 'concept' 'theory' 'strategy students' 'intellectually stimulating' 'main value is' 'structure' 'architecture' 'paradigm'. "
        "Avoid: 'Readers gain...' 'Readers come away...' 'The book explores...' 'A compelling look...' 'A powerful meditation...' 'A masterful account...' 'mental toolbox' 'rigorous architecture' 'durable framework' 'decades of research'. "
        "Before output, ask: Could this describe ten other books? Did I invent a factual claim? Did I mention a forbidden person? Did I use prestige/medical language? Did I include concrete fit and mismatch? Would this help someone decide whether to spend 8-15 hours? Is each best_for item naming a specific person in a specific situation, not a demographic label? Am I describing the emotional arc with start/mid/end, not just adjectives? "
        "Return strict JSON only. No markdown. No commentary. Do not include recommendation_context in your response."
    )


def context_for_llm(context: Dict[str, Any]) -> Dict[str, Any]:
    safe = {key: value for key, value in context.items() if not key.startswith("_")}
    if "recommendation_signals_sample" in safe:
        cleaned_signals = []
        for sig in safe["recommendation_signals_sample"]:
            cleaned = {}
            for k, v in sig.items():
                if k in ("has_source_url", "has_quote", "confidence_score"):
                    cleaned[k] = v
            cleaned_signals.append(cleaned)
        safe["recommendation_signals_sample"] = cleaned_signals
    return safe


def user_prompt(context: Dict[str, Any]) -> str:
    safe_context = context_for_llm(context)
    book_info = safe_context.get("book", {})
    lists_info = safe_context.get("lists", [])
    safe_book_context = f"Title: {book_info.get('title','')}. Author: {book_info.get('author_name','')}. "
    if book_info.get("description"):
        safe_book_context += f"Description: {book_info['description'][:500]}. "
    list_names = [clean(l.get("name")) for l in lists_info if clean(l.get("name"))][:5]
    if list_names:
        safe_book_context += f"Categories: {', '.join(list_names)}."
    return f"""
Create internal draft editorial guidance for a book recommendation site.

Your job is to help a reader decide whether this book fits their taste.

SAFE FACTS YOU MAY USE:
{safe_book_context}

UNSAFE CONTEXT:
You are not given recommender names. Do not mention or allude to recommenders, list creators, celebrities, influencers, public figures, source names, curators, or recommendation sources.

Return JSON with:
{{
  "quick_verdict": "1-2 sentences: read-if + skip-if.",
  "editorial_summary": "70-95 words. Reading experience, main value, main limitation.",
  "best_for": ["3 reader-fit cases"],
  "not_for": ["3 mismatch warnings, at least one DNF point"],
  "theme_tensions": ["4-5 tensions with friction"],
  "emotional_journey": "how it feels to move through the book",
  "reading_pace_profile": "how it reads (dense, skippable, one-sitting, etc)",
  "vibe_tags": ["5-8 lowercase hyphenated tags, no hype"],
  "difficulty_level": "easy|medium|hard|unknown",
  "discussion_potential": "what readers will argue about",
  "comparable_experience": "compare reading experience, not status"
}}
"""


def call_llm(provider: str, model: str, messages: List[Dict[str, str]], temperature: float = 0.1) -> str:
    if provider == "deepseek":
        key = os.environ.get("DEEPSEEK_API_KEY", "")
        if not key:
            raise SystemExit("Missing DEEPSEEK_API_KEY.")
        endpoint = "https://api.deepseek.com/chat/completions"
    elif provider == "openai":
        key = os.environ.get("OPENAI_API_KEY", "")
        if not key:
            raise SystemExit("Missing OPENAI_API_KEY.")
        endpoint = "https://api.openai.com/v1/chat/completions"
    else:
        raise SystemExit("provider must be deepseek or openai.")

    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "response_format": {"type": "json_object"},
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    data = http_json(endpoint, method="POST", payload=payload, headers=headers, timeout=120)
    return data["choices"][0]["message"]["content"]


def _is_provider_network_error(exc: Exception) -> bool:
    """Check if an exception is a provider/network timeout or connectivity error."""
    msg = str(exc).lower()
    if isinstance(exc, TimeoutError):
        return True
    if "timed out" in msg or "read timed out" in msg or "the read operation timed out" in msg:
        return True
    if hasattr(exc, "reason") and str(exc.reason).lower() == "timed out":
        return True
    if isinstance(exc, (urllib.error.URLError, socket.gaierror, ConnectionError, OSError)):
        return True
    return False


def _make_provider_error_row(book: Dict[str, Any], report_flat: Dict[str, Any], error_msg: str) -> Dict[str, Any]:
    """Build an error row for provider network failures."""
    return {
        "status": "error",
        "reason": "provider_network_error_timeout",
        "book_id": clean(book.get("id")),
        "slug": clean(book.get("slug")),
        "title": clean(book.get("title")),
        "author": clean(book.get("author", book.get("author_name", ""))),
        **report_flat,
        "raw_output": error_msg[:1000],
        "quality_warnings": "provider_network_error",
        "reject_debug_field": "provider",
        "reject_debug_matched_text": "timeout",
        "reject_debug_snippet": error_msg[:180],
        "reject_debug_source": "provider_network",
        "reject_debug_attempt": "",
        "recommended_action": "retry_provider",
        "reader_fit_specificity": "",
        "dnf_warning_quality": "",
        "emotional_fit_quality": "",
        "pacing_expectation_quality": "",
        "best_for_specificity": "",
        "not_for_specificity": "",
        "generic_ai_safety": "",
        "fact_minimal_safety": "",
        "vibe_quality": "",
        "overall_icp_score": "",
        "evaluator_notes": "",
    }


def repair_prompt(context: Dict[str, Any], bad_output: Dict[str, Any], reason: str) -> str:
    safe_context = context_for_llm(context)
    targeted_instruction = _retry_instruction(reason)
    # v8.3 — for name-leak failures, do NOT include the previous raw output AND scrub context
    rl = reason.lower()
    is_name_leak = "public_recommender_name_leak" in rl or "unsafe_prompt_contains_recommender_name" in rl
    include_bad_json = not is_name_leak
    bad_json_str = json.dumps(bad_output, ensure_ascii=False, indent=2) if include_bad_json else "{...omitted due to recommender-name leak...}"
    # Scrub recommender names from repair context
    scrubbed_context = safe_context
    if is_name_leak:
        recommender_names_list = []
        flat = context.get("_report_flat") or {}
        raw_names = flat.get("context_recommender_names", "")
        recommender_names_list = [n.strip() for n in raw_names.split("|") if n.strip() and len(n.strip()) > 3]
        if recommender_names_list:
            allowed = set()
            book = context.get("book", {})
            for f in ("title", "author_name"):
                v = clean(book.get(f, "") or "")
                if v:
                    for p in v.split():
                        if len(p) > 2:
                            allowed.add(p.lower())
            context_json = json.dumps(safe_context, ensure_ascii=False)
            scrubbed_json = scrub_name_from_text(context_json, recommender_names_list, allowed)
            try:
                scrubbed_context = json.loads(scrubbed_json)
            except json.JSONDecodeError:
                scrubbed_context = safe_context
    return f"""
Your previous JSON failed validation for this reason: {reason}

{targeted_instruction}

Context:
{json.dumps(scrubbed_context, ensure_ascii=False, indent=2)}

{"Bad JSON to repair:" if include_bad_json else "Previous output omitted due to recommender-name leak in response:"}
{bad_json_str}

Return corrected JSON only with the exact required keys.
"""


def _retry_instruction(reason: str) -> str:
    rl = reason.lower()
    if "source_overclaim" in rl or "proof" in rl or "verification" in rl or "source-backed" in rl or "proven" in rl:
        return "Remove proof/verification/source-strength language. Use cautious reader-fit wording only. Do not claim anything is verified, proven, or source-backed."
    if "public_recommender_name_leak" in rl:
        # v8.5 — use placeholder never literal name; extract leaking field
        parts = reason.split("_")
        leak_field = "public_text"
        for fname in PUBLIC_FIELDS:
            if reason.endswith("_" + fname):
                leak_field = fname
                break
        return f"A forbidden recommender name appeared in your response, especially in the '{leak_field}' field. Remove all recommender, curator, celebrity, influencer, founder, list-creator, or public-figure names from your response. Do not mention any real people who might have recommended this book. Use only the book author and the book title as name-references."
    if "publisher_hype" in rl or "banned_phrase" in rl:
        # v8.4 — extract the specific term from the reason for targeted retry
        hype_term = ""
        parts = reason.split("_")
        for i, p in enumerate(parts):
            if p in ("publisher", "hype", "banned", "phrase"):
                continue
            candidate = " ".join(parts[i:]).replace("_", " ")
            if len(candidate) >= 4:
                hype_term = candidate
                break
        if hype_term:
            return f"Replace '{hype_term}' with plain reader-fit language. Use 'readers who like', 'broad claims', 'useful if', 'likely to lose you', 'best when you want', or 'annoying if' instead. Do not invent new claims — just rephrase the issue."
        return "Remove hyped promotional language. Avoid publisher-blurb-style phrasing. Use calm, concrete reader-advisory language. Prefer 'useful if', 'likely to lose you when', 'best when you want', 'annoying if'."
    if "vibe_tag" in rl:
        return "Replace weak or banned vibe tags with concrete reader-experience tags and include a safe pace/intensity tag such as idea-dense, slow-burn, patience-demanding, or high-friction."
    if "summary_length" in rl:
        return "Ensure the editorial summary is 70-95 words. Trim or expand as needed."
    if "internal_language" in rl:
        return "Remove any internal pipeline language such as database row, raw output, dry run, csv, json field, or spreadsheet row."
    if "unsupported_proof" in rl or "unsupported_format" in rl:
        return "Remove claims of research authority, prestige, proof, evidence, or book format unless explicitly provided in the safe context. Do not say research-backed, evidence-based, proven, decades of research, studies show, workbook, or interactive companion."
    if "not_for_lacks" in rl:
        return "Add at least one specific DNF point or mismatch warning to not_for. Use tokens like: slow, dense, repetitive, dated, ideological, abstract, shallow, likely dnf, bounce off."
    if "generic_ai_or_publisher_copy" in rl or "fields_not_distinct" in rl:
        return "Rewrite with specific reader-fit language. Make each field distinct. Avoid publisher-copy phrases. Sound like a human recommender, not a summary bot."
    # v9.4 — score-driver targeted retry for weak dimensions
    if "quality_below_retry_threshold" in rl or "quality_below_accept_threshold" in rl or "not_enough_elite_specificity" in rl or "score_drivers" in rl:
        # Check if reason includes specific dimension scores
        dim_guidance = []
        rl_lower = reason.lower()
        if "emotional_fit_quality" in rl_lower or "emotional" in rl_lower:
            dim_guidance.append("emotional_journey: MUST include start feeling, mid-book friction, ending aftertaste, AND wrong-reader emotional reaction. Bad: 'thought-provoking and inspiring.' Good: 'starts like a jolt, gets irritating when the author's certainty hardens, and ends either as a useful provocation or an overconfident sermon.'")
        if "best_for_specificity" in rl_lower or "best_for" in rl_lower:
            dim_guidance.append("best_for: EVERY item MUST include concrete person + specific situation + why this book fits NOW. Bad: 'a curious reader' or 'business leaders.' Good: 'a PM inside a legacy company trying to explain why a low-margin competitor matters before leadership dismisses it.'")
        if "reader_fit_specificity" in rl_lower or "reader_fit" in rl_lower:
            dim_guidance.append("quick_verdict: MUST answer when this is the right book, when it is wrong, what patience/taste it demands, what makes someone bounce — all in one blunt sentence. editorial_summary: MUST describe the actual reading experience with a specific useful part AND a specific annoying/limiting part.")
        if "fact_minimal_safety" in rl_lower or "fact_minimal" in rl_lower:
            dim_guidance.append("Replace unsupported/proofy framing with attribution: 'the book argues...', 'the author frames...', 'the book presents...' Never say proven, evidence shows, research-backed, clinical, or peer-reviewed. Never add new facts.")
        if not dim_guidance:
            dim_guidance.append("Rewrite only the weakest fields for higher specificity. best_for: each item must name a concrete person in a specific situation. emotional_journey: include start feeling, mid-book friction, ending aftertaste. Do NOT add facts. Do NOT hallucinate format.")
        instruction = " ".join(dim_guidance)
        return f"Rewrite only the WEAKEST fields. Do NOT rewrite fields that are already strong. Do NOT hallucinate book formats. Do NOT add new facts or claims. {instruction}"
    return "Fix the issue described in the error reason. Use ONLY the provided context. Do not add outside facts. Return valid JSON only."


def parse_json_object(text: str) -> Dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.S)
        if not match:
            raise
        return json.loads(match.group(0))


def parse_ai_json(raw: Optional[str]) -> Dict[str, Any]:
    """Robust AI JSON extraction. Never raises — returns error dict on failure."""
    if not raw or not raw.strip():
        return {"_parse_error": "ai_empty_response"}
    text = raw.strip()
    # Strip markdown fences
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        text = text.strip()
    # Extract largest JSON object
    match = re.search(r"\{.*\}", text, flags=re.S)
    if not match:
        # Try harder — look for partial JSON
        if "{" in text:
            start = text.index("{")
            truncated = text[start:]
            # Try to close unclosed braces
            open_braces = truncated.count("{") - truncated.count("}")
            if open_braces > 0:
                truncated += "}" * open_braces
                try:
                    return json.loads(truncated)
                except json.JSONDecodeError:
                    pass
        return {"_parse_error": "ai_json_parse_failed"}
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return {"_parse_error": "ai_json_parse_failed"}


def normalize_name_parts(name: str) -> List[str]:
    name = clean(name)
    tokens = [t.lower() for t in re.findall(r"[A-Za-z][A-Za-z.'-]{2,}", name)]
    parts = []
    if len(tokens) >= 2:
        parts.append(" ".join(tokens))
        last = tokens[-1].strip(".-'")
        if len(last) >= 4 and last not in COMMON_SINGLE_WORD_EXCEPTIONS:
            parts.append(last)
    elif len(tokens) == 1:
        only = tokens[0].strip(".-'")
        if len(only) >= 4 and only not in COMMON_SINGLE_WORD_EXCEPTIONS:
            parts.append(only)
    return sorted(set(parts), key=len, reverse=True)


def contains_recommender_name(public_text: str, recommender_names: List[str], allowed_names: List[str]) -> Optional[str]:
    haystack = f" {public_text.lower()} "
    allowed = {a.lower() for a in allowed_names if a}
    for name in recommender_names:
        if not name or name.lower() in allowed:
            continue
        for part in normalize_name_parts(name):
            if re.search(rf"(?<![a-z]){re.escape(part)}(?![a-z])", haystack):
                return name
    return None


def unsupported_fact_risk(public_text: str, source_context: str) -> Optional[str]:
    lowered = public_text.lower()
    source_lowered = source_context.lower()
    for phrase in FACT_RISK_PHRASES:
        if phrase in lowered and phrase not in source_lowered:
            return phrase
    return None


def deterministic_source_quality_note(context: Dict[str, Any]) -> str:
    report = context.get("_report_flat", {})
    source_count = int(report.get("context_source_url_count") or 0)
    signal_count = int(report.get("context_sampled_recommendation_count") or 0)
    if signal_count <= 0:
        return "No reviewed recommendation signals are available yet; source reliability still needs review before any recommendation is treated as confirmed source evidence."
    if source_count <= 0:
        return f"0 of {signal_count} reviewed recommendation signals include source URLs; source reliability still needs review before any recommendation is treated as confirmed source evidence."
    return f"{source_count} of {signal_count} reviewed recommendation signals include source URLs; source reliability still needs review before they are used as confirmed source evidence."


def _deterministic_difficulty_level(reading_pace: str, category_names: List[str]) -> str:
    """Determine difficulty level from pace and category signals. Returns easy|medium|hard."""
    pace_lower = reading_pace.lower()
    cat_lower = [c.lower() for c in category_names]
    hard_signals = ["dense", "academic", "technical", "reference-like", "slow", "patience"]
    easy_signals = ["light", "fast", "accessible", "quick", "bingeable", "skimmable", "one-sitting"]
    if any(s in cat_lower for s in ["philosophy", "social sciences", "literature"]) and any(s in pace_lower for s in hard_signals):
        return "hard"
    if any(s in pace_lower for s in hard_signals):
        return "hard"
    if any(s in pace_lower for s in easy_signals):
        return "easy"
    return "medium"


def _normalize_category_name(name: str) -> str:
    """Normalize category aliases. Preserve known multi-word names."""
    n = clean(name)
    ALIASES = {
        "nonfiction": "NonFiction", "non fiction": "NonFiction", "non-fiction": "NonFiction",
        "sci fi": "Science Fiction", "sci-fi": "Science Fiction", "sciencefiction": "Science Fiction",
        "self help": "Self Help", "self-help": "Self Help",
        "socialsciences": "Social Sciences",
        "personaldevelopment": "Personal Development",
        "pop science": "Popular Science", "popularscience": "Popular Science",
    }
    key = n.lower().replace(" ", "")
    if key in ALIASES:
        return ALIASES[key]
    key = n.lower()
    if key in ALIASES:
        return ALIASES[key]
    return n


def _clean_category_names(list_names_raw: List[str]) -> List[str]:
    """Dedupe, normalize aliases, split only known merged names."""
    PRESERVED_MULTIWORD = {
        "nonfiction", "non fiction", "non-fiction",
        "science fiction", "sci-fi", "sci fi",
        "personal development",
        "social sciences",
        "self help", "self-help",
        "popular science",
        "cognitive science",
    }
    KNOWN_MERGES = {
        "WritingPersonal Development": "Writing Personal Development",
        "BusinessPersonal Development": "Business Personal Development",
        "ScienceNonFiction": "Science NonFiction",
    }
    list_names: List[str] = []
    seen: set[str] = set()
    for ln in list_names_raw:
        original = ln
        for old, replacement in KNOWN_MERGES.items():
            if old in original:
                original = original.replace(old, replacement)
        # Try whitespace-split parts, building multi-word combos
        parts = original.split()
        i = 0
        while i < len(parts):
            found = False
            # Try longest multi-word match first
            for span in range(min(3, len(parts) - i), 0, -1):
                candidate = " ".join(parts[i:i+span])
                cl = candidate.lower().replace(" ", "")
                if cl in PRESERVED_MULTIWORD or candidate.lower() in PRESERVED_MULTIWORD:
                    normalized = _normalize_category_name(candidate)
                    if normalized.lower() not in seen:
                        seen.add(normalized.lower())
                        list_names.append(normalized)
                    i += span
                    found = True
                    break
            if not found:
                normalized = _normalize_category_name(parts[i])
                if normalized.lower() not in seen and len(normalized) > 1:
                    seen.add(normalized.lower())
                    list_names.append(normalized)
                i += 1
    return list_names


def deterministic_recommendation_context(context: Dict[str, Any]) -> str:
    lists = context.get("lists", [])
    list_names_raw = [clean(l.get("name")) for l in lists if clean(l.get("name"))]
    list_names = _clean_category_names(list_names_raw)
    # v7.5.1 — priority order: Creative/Writing > Psychology/Social Sciences > Fiction > Business > Philosophy > Dev > History/Science/NonFiction
    ln_lower = [ln.lower() for ln in list_names]
    def _has(group: set) -> bool:
        return any(g in ln_lower for g in group for ln_cat in ln_lower if g == ln_cat or g in ln_cat)
    is_creative = _has({"writing", "art", "creativity", "design"})
    is_psych = _has({"psychology", "social sciences", "sociology", "neuroscience", "cognitive science", "behavioral economics"})
    is_fiction = _has({"fiction", "dystopian", "science fiction", "fantasy", "literature", "novel", "sci-fi", "sf", "speculative", "classics"})
    is_business = _has({"business", "entrepreneurship", "finance", "leadership", "management", "startup", "economics", "investing"})
    is_philosophy = _has({"philosophy", "spirituality", "religion", "ethics"})
    is_dev = _has({"personal development", "self help", "self-help", "productivity", "habits"})
    title_lower = (context.get("book", {}).get("title", "") or "").lower()
    is_bus_title = any(w in title_lower for w in ["business", "startup", "entrepreneur", "management", "leadership", "founder", "venture", "investing"])
    if is_creative:
        reader_need = "creative discipline, craft, or artistic motivation"
    elif is_psych and not is_bus_title:
        reader_need = "decision-making, behavior, or human motivation"
    elif is_fiction:
        reader_need = "imaginative storytelling, atmosphere, or character-driven reflection"
    elif is_business:
        reader_need = "business judgment, leadership, or practical strategy"
    elif is_philosophy:
        reader_need = "meaning, ethics, or reflective life questions"
    elif is_dev:
        reader_need = "self-improvement and practical behavior change"
    elif _has({"history", "science", "nonfiction", "popular science", "biology", "physics", "technology"}):
        reader_need = "big-picture nonfiction and accessible learning"
    else:
        reader_need = "reader-fit discovery across adjacent interests"
    if list_names:
        joined_names = ", ".join(list_names[:5])
        return f"Available recommendation signals cluster around {joined_names} lists, suggesting this book may fit readers looking for {reader_need}. Treat this as discovery context, not a quality guarantee."
    return "Available recommendation signals suggest this title has discovery traction, but there is not enough safe category context to make a stronger reader-fit claim."


def repair_vibe_tags(vibe_tags: List[str], reading_pace_profile: str, difficulty_level: str) -> List[str]:
    """Clean and repair vibe tags before validation. Ensures pace tag is present."""
    vibe_reject_exact = {
        "brain-tickler", "conversation-starter", "worldview-shattering",
        "mind-blowing", "accessible-scholarship", "cult-classic-energy",
        "global-perspective", "thought-jolt", "classic", "foundational",
        "startup-canon", "hype-fueled", "tech-bro", "edgelord-prophet",
        "founder-gospel", "big-idea-nonfiction", "big-idea-novel",
        "controversial-read", "myth-busting", "no-fluff",
        "ceo-canon", "cult-favorite", "dinner-party-ammo",
        "big-idea-fiction", "edgy", "edgelord", "timeless-quest",
        "canonical", "masterpiece",
    }
    # v7.5.1 — banned vibe tag tokens (reject compound tags containing these)
    vibe_banned_tokens = {
        "classic", "canonical", "masterpiece", "cult", "hype",
        "edgy", "edgelord", "bro", "canon", "gospel", "ammo",
        "prophet", "definitive", "seminal",
    }
    vibe_reject_suffixes = ["-hum", "-vib", "-emo", "-int"]
    PACES = {
        "slow-burn", "fast-but-dense", "idea-dense", "patience-demanding",
        "quick-but-heavy", "dense-read", "light-but-sharp", "one-sitting", "high-friction",
    }

    cleaned_tags: List[str] = []
    seen: set[str] = set()
    for tag in vibe_tags:
        tag_lower = clean(tag).lower().strip().replace(" ", "-").replace("_", "-")
        if not tag_lower or len(tag_lower) < 3:
            continue
        if tag_lower in vibe_reject_exact:
            continue
        # v7.5.1 — check compound tags for banned tokens
        tag_parts = set(tag_lower.split("-"))
        if tag_parts & vibe_banned_tokens:
            continue
        if any(tag_lower.endswith(s) for s in vibe_reject_suffixes):
            continue
        if tag_lower not in seen:
            seen.add(tag_lower)
            cleaned_tags.append(tag_lower)

    has_pace = any(t in PACES for t in cleaned_tags)

    if not has_pace:
        pace = "idea-dense"
        rpp_lower = reading_pace_profile.lower()
        if "one sitting" in rpp_lower:
            pace = "one-sitting"
        elif "slow" in rpp_lower or "patience" in rpp_lower:
            pace = "patience-demanding"
        elif ("quick" in rpp_lower or "short" in rpp_lower) and ("heavy" in rpp_lower or "dense" in rpp_lower):
            pace = "quick-but-heavy"
        elif "fast" in rpp_lower and "dense" in rpp_lower:
            pace = "fast-but-dense"
        elif "dense" in rpp_lower:
            pace = "idea-dense"
        elif difficulty_level == "hard":
            pace = "high-friction"
        cleaned_tags.append(pace)

    safe_fallbacks = ["reflective-nonfiction", "practical-framework", "argument-heavy", "emotionally-heavy", "systems-thinking"]
    while len(cleaned_tags) < 5 and safe_fallbacks:
        fb = safe_fallbacks.pop(0)
        if fb not in seen:
            seen.add(fb)
            cleaned_tags.append(fb)

    # Trim to 8, preserving the pace tag if possible
    if len(cleaned_tags) > 8:
        pace_tag = next((t for t in cleaned_tags if t in PACES), None)
        cleaned_tags = cleaned_tags[:8]
        if pace_tag and pace_tag not in cleaned_tags:
            cleaned_tags[-1] = pace_tag

    return cleaned_tags


def clean_list(value: Any, min_items: int, max_items: int, field_name: str) -> Tuple[bool, List[str]]:
    if not isinstance(value, list):
        return False, []
    items: List[str] = []
    for item in value[:max_items]:
        text = clean(item)
        if text and text not in items:
            items.append(text)
    if len(items) < min_items:
        return False, items
    return True, items


def _sanitize_low_risk_phrases(cleaned: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """Replace low-risk formulaic phrases with reader-fit alternatives. Returns (cleaned, warnings)."""
    warnings: List[str] = []
    text_fields = [
        "quick_verdict", "editorial_summary", "discussion_potential",
        "comparable_experience", "reading_pace_profile", "emotional_journey",
    ]
    for field in text_fields:
        text = cleaned.get(field, "")
        if not isinstance(text, str):
            continue
        for old, new in LOW_RISK_STYLE_REPLACEMENTS.items():
            if old in text:
                text = text.replace(old, new)
                if "formulaic_phrase_sanitized" not in warnings:
                    warnings.append("formulaic_phrase_sanitized")
        cleaned[field] = text
    # Also sanitize list fields (best_for, not_for)
    for list_field in ["best_for", "not_for"]:
        items = cleaned.get(list_field, [])
        if not isinstance(items, list):
            continue
        sanitized = []
        for item in items:
            s = str(item)
            for old, new in LOW_RISK_STYLE_REPLACEMENTS.items():
                if old in s:
                    s = s.replace(old, new)
                    if "formulaic_phrase_sanitized" not in warnings:
                        warnings.append("formulaic_phrase_sanitized")
            sanitized.append(s)
        cleaned[list_field] = sanitized
    # v9.2 — sanitize abstract/critical "templates" uses (warn, don't reject)
    for field in text_fields + ["best_for", "not_for"]:
        if field in ("best_for", "not_for"):
            items = cleaned.get(field, [])
            if not isinstance(items, list):
                continue
            new_items = []
            for item in items:
                s = str(item)
                for pat in TEMPLATE_ABSTRACT_PATTERNS:
                    if pat.lower() in s.lower():
                        if "formulaic_phrase_sanitized" not in warnings:
                            warnings.append("formulaic_phrase_sanitized")
                new_items.append(s)
            cleaned[field] = new_items
        else:
            text = cleaned.get(field, "")
            if not isinstance(text, str):
                continue
            for pat in TEMPLATE_ABSTRACT_PATTERNS:
                if pat.lower() in text.lower():
                    if "formulaic_phrase_sanitized" not in warnings:
                        warnings.append("formulaic_phrase_sanitized")
    return cleaned, warnings


def _find_reject_debug(cleaned: Dict[str, Any], reason: str, public_text: str) -> Tuple[str, str, str]:
    """Find field, matched text, and snippet for a rejection reason."""
    matched = ""
    field = ""
    snippet = ""
    rl = reason.lower()

    # Handle name-leak reasons: public_recommender_name_leak_<name>_<field>
    if "public_recommender_name_leak" in rl:
        # v8.8 — prefer snippet captured at detection time over re-search
        if cleaned.get("_name_leak_snippet"):
            field = cleaned.get("_name_leak_field", "public_text")
            matched = cleaned.get("_name_leak_name", "")
            snippet = cleaned["_name_leak_snippet"]
            return field, matched, snippet
        prefix = "public_recommender_name_leak_"
        rest = reason[len(prefix):]
        for fname in PUBLIC_FIELDS:
            if rest.endswith("_" + fname) or rest == fname:
                field = fname
                name_part = rest[:-(len(fname)+1)] if rest.endswith("_" + fname) else rest
                matched = name_part
                break
        if not field:
            field = "public_text"
            matched = rest
        fv = cleaned.get(field, "")
        if isinstance(fv, list):
            fv = " ".join(str(x) for x in fv)
        fv = str(fv)
        if matched and matched.lower() in fv.lower():
            idx = fv.lower().find(matched.lower())
            start = max(0, idx - 60)
            end = min(len(fv), idx + len(matched) + 90)
            snippet = fv[start:end]
        else:
            snippet = "matched text not found in stored public fields"
        return field, matched, snippet

    # Handle other reason formats: prefix_<term>
    # v9.6 — field-specific override: only scan the named field, not all PUBLIC_FIELDS
    search_fields = PUBLIC_FIELDS
    if "bad_list" in rl:
        # Extract the specific field name from theme_tensions_bad_list, best_for_bad_list, etc.
        parts = reason.split("_")
        field_part = reason.replace("_bad_list", "").strip()
        if field_part in PUBLIC_FIELDS:
            search_fields = [field_part]
    reason_parts = reason.split("_")
    skip_prefixes = {"publisher", "hype", "banned", "unsupported", "format", "claim", "overclaim", "source", "medical", "or", "research", "proof", "prestige"}
    for i, part in enumerate(reason_parts):
        if part in skip_prefixes:
            continue
        # Try underscore-joined
        candidate = "_".join(reason_parts[i:])
        if candidate.lower() in public_text.lower():
            matched = candidate
            break
        # Also try space-joined (for phrases like "clinical evidence")
        candidate_spaced = " ".join(reason_parts[i:])
        if candidate_spaced.lower() in public_text.lower():
            matched = candidate_spaced
            break
    if not matched and len(reason_parts) >= 2:
        # Try last meaningful segment as the matched term
        for j in range(len(reason_parts) - 1, 0, -1):
            candidate = "_".join(reason_parts[j:])
            if len(candidate) >= 4 and candidate.lower() in public_text.lower():
                matched = candidate
                break
    if not matched:
        # Fallback: try common phrases
        for phrase in ["sweeping", "fans of", "compelling", "powerful", "concept", "theory"]:
            if phrase in public_text.lower():
                matched = phrase
                break
    # Find which field and build snippet
    for fname in search_fields:
        fv = cleaned.get(fname, "")
        if isinstance(fv, list):
            fv = " ".join(str(x) for x in fv)
        fv = str(fv)
        if matched and matched.lower() in fv.lower():
            field = fname
            idx = fv.lower().find(matched.lower())
            start = max(0, idx - 60)
            end = min(len(fv), idx + len(matched) + 90)
            snippet = fv[start:end]
            break
    if not snippet and public_text:
        snippet = public_text[:180]
    return field, matched, snippet


# v9.5 — title/format mismatch pre-validation
FORMAT_TITLE_TERMS = [
    "workbook", "journal", "companion", "planner", "course",
    "exercise", "exercises", "prompt", "prompts", "guided",
]

FORMAT_CLAIM_TERMS = [
    "workbook", "companion workbook", "guided journal", "journal",
    "planner", "course", "exercise book", "guided prompts",
    "prompts", "exercises", "tracking sheets", "filling prompts",
    "fill-in", "worksheet", "worksheets", "workbook format",
    "workbook-style", "downloadable worksheets", "step-by-step workbook",
    "interactive workbook", "write-in book",
    # v9.6 — probe-observed hallucinated format terms
    "interactive guide", "reflective prompts", "hands-on exercises",
    "tracking system", "practice exercises", "guided exercises",
    "step-by-step exercises", "prompts and exercises",
    "writing prompts", "reflection prompts", "journal prompts",
    "self-assessment exercises", "completion exercises",
    "end-to-end exercises", "practical exercises",
    "habit tracker", "habit tracking", "daily tracker",
]

# v9.5 — words containing "journal" that are NOT format claims
FORMAT_JOURNAL_SAFE = [
    "journalist", "journalism", "journal article", "journal articles",
    "academic journal", "science journal", "medical journal",
]


def _title_supports_format_claim(title: str) -> bool:
    """Check if the book title explicitly contains a format word allowing format claims."""
    title_lower = (title or "").lower()
    for term in FORMAT_TITLE_TERMS:
        if term in title_lower:
            return True
    return False


def _check_title_format_mismatch(public_text: str, title: str) -> Optional[str]:
    """If title doesn't claim a format, reject any format-claiming language. Returns error reason or None."""
    if _title_supports_format_claim(title):
        return None
    text_lower = public_text.lower()
    for term in FORMAT_CLAIM_TERMS:
        term_lower = term.lower()
        if term_lower in text_lower:
            # v9.5 — skip safe journal/journalism words
            is_journal_safe = term_lower == "journal" and any(
                safe_word in text_lower for safe_word in FORMAT_JOURNAL_SAFE
            )
            if is_journal_safe:
                continue
            # v9.5 — also check for "journal of X" pattern (academic)
            if term_lower == "journal" and re.search(r'journal\s+of\s+\w+', text_lower):
                continue
            if not _is_negated_context(public_text, term):
                return f"unsupported_format_claim_{term.replace(' ', '_')}"
    return None


def validate_output(data: Dict[str, Any], context: Dict[str, Any], quality_warnings: Optional[List[str]] = None) -> Tuple[bool, str, Dict[str, Any]]:
    required = [
        "quick_verdict",
        "editorial_summary",
        "best_for",
        "not_for",
        "theme_tensions",
        "emotional_journey",
        "reading_pace_profile",
        "vibe_tags",
        "discussion_potential",
        "comparable_experience",
    ]
    for key in required:
        if key not in data:
            return False, f"missing_{key}", data

    cleaned = {
        "quick_verdict": clean(data["quick_verdict"]),
        "editorial_summary": clean(data["editorial_summary"]),
        "best_for": data["best_for"],
        "not_for": data["not_for"],
        "theme_tensions": data["theme_tensions"],
        "key_themes": data["theme_tensions"],
        "emotional_journey": clean(data["emotional_journey"]),
        "reading_pace_profile": clean(data["reading_pace_profile"]),
        "vibe_tags": data["vibe_tags"],
        "difficulty_level": _deterministic_difficulty_level(
            clean(data.get("reading_pace_profile", "")),
            [clean(l.get("name", "")) for l in context.get("lists", []) if clean(l.get("name", ""))]
        ),
        "discussion_potential": clean(data["discussion_potential"]),
        "comparable_experience": clean(data["comparable_experience"]),
        "recommendation_context": deterministic_recommendation_context(context),
        "source_quality_note": deterministic_source_quality_note(context),
    }

    # v7.3 — repair vibe tags before list validation
    cleaned["vibe_tags"] = repair_vibe_tags(
        cleaned["vibe_tags"],
        cleaned["reading_pace_profile"],
        cleaned["difficulty_level"],
    )

    if not 55 <= len(cleaned["editorial_summary"].split()) <= 110:
        return False, "summary_length_out_of_range", cleaned
    if len(cleaned["quick_verdict"].split()) > 55:
        return False, "quick_verdict_too_long", cleaned
    if cleaned["difficulty_level"] not in ALLOWED_DIFFICULTY:
        cleaned["difficulty_level"] = "unknown"

    # v9.6 — build public_text_early FIRST so format mismatch check runs BEFORE list validation
    public_text_early = " ".join(cleaned[field] if isinstance(cleaned[field], str) else " ".join(str(x) for x in (cleaned[field] or [])) for field in PUBLIC_FIELDS)
    title_for_check = clean(context.get("book", {}).get("title", ""))
    format_mismatch = _check_title_format_mismatch(public_text_early, title_for_check)
    if format_mismatch:
        return False, format_mismatch, cleaned

    # v9.6 — list field validation runs AFTER format check, so format hallucination never masked
    for field_name, min_items, max_items in [
        ("best_for", 3, 4),
        ("not_for", 3, 4),
        ("theme_tensions", 3, 5),
        ("vibe_tags", 5, 8),
    ]:
        ok, items = clean_list(cleaned[field_name], min_items, max_items, field_name)
        if not ok:
            return False, f"{field_name}_bad_list", cleaned
        cleaned[field_name] = items
    cleaned["key_themes"] = cleaned["theme_tensions"]

    # v7.3 — vibe tags are already repaired. Final safety check.

    # v8.4 — sanitize low-risk style phrases before hard validation
    if quality_warnings is not None:
        cleaned, sanitize_warnings = _sanitize_low_risk_phrases(cleaned)
        for w in sanitize_warnings:
            if w not in quality_warnings:
                quality_warnings.append(w)

    PACES = {
        "slow-burn", "fast-but-dense", "idea-dense", "patience-demanding",
        "quick-but-heavy", "dense-read", "light-but-sharp", "one-sitting", "high-friction",
    }
    if not any(t.lower().strip() in PACES for t in cleaned["vibe_tags"]):
        return False, "vibe_tag_missing_pace", cleaned

    joined = " ".join(str(v).lower() for v in cleaned.values())
    public_text = " ".join(cleaned[field] if isinstance(cleaned[field], str) else " ".join(str(x) for x in (cleaned[field] or [])) for field in PUBLIC_FIELDS)
    recommender_names_raw = context.get("_report_flat", {}).get("context_recommender_names", "")
    recommender_names = [name.strip() for name in recommender_names_raw.split("|") if name.strip()]
    allowed_names = [clean(context.get("book", {}).get("author_name")), clean(context.get("book", {}).get("title"))]
    source_lowered = json.dumps(context, ensure_ascii=False).lower()

    # ── v9.5: Trust/safety checks prioritize format > medical > name leak > proof > source > style ──

    # v9.1 — unsupported medical/research claims MUST check before name-leak for health/science categories
    medical_categories = {
        "health", "psychology", "science", "social sciences",
        "medical", "medicine", "neuroscience",
    }
    list_names_lower = [clean(l.get("name", "")).lower() for l in context.get("lists", []) if clean(l.get("name", ""))]
    has_medical_category = any(mc in list_names_lower for mc in medical_categories)
    if has_medical_category:
        for phrase in UNSUPPORTED_MEDICAL_PHRASES:
            if phrase in public_text.lower() and phrase not in source_lowered:
                return False, f"unsupported_medical_or_research_claim_{phrase.replace(' ', '_')}", cleaned

    # v8.3 — recommender name leak (hard reject) + snippet capture at detection time
    leaked_name = contains_recommender_name(public_text, recommender_names, allowed_names)
    if leaked_name:
        leak_field = "public_text"
        snippet_verified = False
        for field in PUBLIC_FIELDS:
            fv = cleaned.get(field, "")
            if isinstance(fv, list):
                fv = " ".join(str(x) for x in fv)
            field_text = str(fv)
            if contains_recommender_name(field_text, [leaked_name], allowed_names):
                leak_field = field
                # v9.1 — capture exact snippet at detection time; must contain the name to be verified
                idx = field_text.lower().find(leaked_name.lower())
                if idx >= 0:
                    start = max(0, idx - 60)
                    end = min(len(field_text), idx + len(leaked_name) + 90)
                    leaked_snippet = field_text[start:end]
                    if leaked_name.lower() in leaked_snippet.lower():
                        cleaned["_name_leak_snippet"] = leaked_snippet
                        cleaned["_name_leak_field"] = leak_field
                        cleaned["_name_leak_name"] = leaked_name
                        snippet_verified = True
                break
        if snippet_verified:
            return False, f"public_recommender_name_leak_{leaked_name}_{leak_field}", cleaned
        else:
            # v9.1 — detected name but cannot produce snippet; downgrade to possible false positive
            cleaned["_name_leak_snippet"] = "matched name not found in stored public field snapshot"
            cleaned["_name_leak_field"] = leak_field
            cleaned["_name_leak_name"] = leaked_name
            return False, f"possible_public_recommender_name_leak_debug_mismatch_{leak_field}", cleaned

    # Overclaims verification (trust)
    if "verified proof" in public_text.lower() or "verified endorsement" in public_text.lower():
        return False, "overclaims_verification", cleaned
    if "confirmed source evidence" in public_text.lower():
        return False, "source_evidence_phrase_in_ai_field", cleaned

    # Unsupported fact risk (trust)
    risky_phrase = unsupported_fact_risk(public_text, json.dumps(context, ensure_ascii=False))
    if risky_phrase:
        return False, f"unsupported_fact_risk_{risky_phrase}", cleaned

    # v7.5.1 — unsupported proof/prestige claims (trust)
    for phrase in UNSUPPORTED_PROOF_PHRASES:
        if phrase in public_text.lower() and phrase not in source_lowered:
            return False, f"unsupported_proof_or_prestige_claim_{phrase.replace(' ', '_')}", cleaned

    # v9.1 — unsupported medical/research claims for ALL categories (not just medical)
    for phrase in UNSUPPORTED_MEDICAL_PHRASES:
        if phrase in public_text.lower() and phrase not in source_lowered:
            return False, f"unsupported_medical_or_research_claim_{phrase.replace(' ', '_')}", cleaned

    # v8 — unsupported format claims (trust) — secondary catch for format terms not in title-based check
    for phrase in UNSUPPORTED_FORMAT_PHRASES:
        if phrase in public_text.lower() and phrase not in source_lowered:
            # v9.5 — skip safe journal/journalism words
            if phrase == "journal" and any(safe_word in public_text.lower() for safe_word in FORMAT_JOURNAL_SAFE):
                continue
            if phrase == "journal" and re.search(r'journal\s+of\s+\w+', public_text.lower()):
                continue
            if not _is_negated_context(public_text, phrase):
                return False, f"unsupported_format_claim_{phrase.replace(' ', '_')}", cleaned

    # ── v8.6: Endorsement overclaim (trust, narrow match) ──
    for phrase in ["endorsed by", "recommended by", "praised by"]:
        if phrase in public_text.lower() and phrase not in source_lowered:
            return False, f"source_overclaim_{phrase.replace(' ', '_')}", cleaned

    # ── Style checks (lower priority, after trust) ──
    for phrase in GENERIC_BANNED_PHRASES:
        if phrase in joined:
            safe_phrase = phrase.replace(" ", "_")
            if phrase in [
                "source-backed", "verified", "proof", "proven", "endorsement", "endorsements", "endorsed",
                "recommended by", "widely recommended", "personal recommendation", "personal recommendations",
                "passed along", "passed among", "passed between", "circulates", "circulate through",
                "shared among", "word of mouth", "word-of-mouth", "cited", "widely cited",
                "frequently cited", "heavy citation", "staple", "staple status", "rite-of-passage",
                "canonical", "cultural phenomenon", "beloved", "famous", "influential",
                "quoted endorsement", "quote coverage", "comes with a quote", "comes with a quoted",
                "every sampled recommendation", "all sampled recommendation", "all sampled recommendations",
                "each recommendation includes", "each signal includes", "verified endorsement", "verified proof",
                "source-backed recommendation", "source-backed recommendations", "backed by source", "backed by sources",
                "passed from person to person", "passed between colleagues", "reading circles", "nearly unavoidable",
                "widely shared", "beloved by", "championed by", "endorsed by", "public figures",
            ]:
                return False, f"source_overclaim_{safe_phrase}", cleaned
            if phrase in [
                "must-read", "unforgettable", "page-turner", "sweeping", "landmark", "foundational",
                "masterpiece", "life-changing", "compelling read", "powerful book", "seminal",
                "game-changer", "beautifully written", "explores themes of", "human condition",
                "broad appeal", "beautifully rendered", "fans of", "timeless classic",
                "thought-provoking read", "seminal work", "worldview-shattering", "mind bomb",
                "mind-blowing", "TED Talk", "persistent appeal", "extraordinary recommendation breadth",
                "influenced generations",
            ]:
                return False, f"publisher_hype_{safe_phrase}", cleaned
            return False, f"banned_phrase_{safe_phrase}", cleaned

    # v8.4 — publisher-sweeping (hype use of "sweeping") still rejects
    for phrase in PUBLISHER_SWEEPING_PHRASES:
        if phrase in joined:
            return False, f"publisher_hype_{phrase.replace(' ', '_')}", cleaned
    # v8 — DNF/mismatch specificity check on not_for
    not_for_joined = " ".join(str(x).lower() for x in cleaned.get("not_for", []))
    if not any(token in not_for_joined for token in DNF_TOKENS):
        return False, "not_for_lacks_specific_dnf_warning", cleaned
    # v8 — generic copy guard
    generic_count = 0
    for phrase in GENERIC_COPY_PHRASES:
        if phrase in public_text.lower():
            generic_count += 1
    if generic_count >= 2:
        return False, "generic_ai_or_publisher_copy", cleaned
    # v8 — field distinctness guard
    quick_text = cleaned.get("quick_verdict", "").lower()
    summary_text = cleaned.get("editorial_summary", "").lower()
    best_for_text = " ".join(str(x).lower() for x in cleaned.get("best_for", []))
    words_quick = set(quick_text.split())
    words_summary = set(summary_text.split())
    words_best = set(best_for_text.split())
    overlap_qs = len(words_quick & words_summary)
    overlap_qb = len(words_quick & words_best)
    if overlap_qs > 15 and overlap_qb > 5:
        return False, "fields_not_distinct_enough", cleaned
    # v7.2 — validate deterministic recommendation_context too
    rc_lower = cleaned["recommendation_context"].lower()
    rc_risky = ["source-backed", "verified", "proof", "proven", "endorsement", "endorsed",
                "recommended by", "passed", "shared", "cited", "popular", "famous",
                "influential", "canonical", "staple", "rite-of-passage"]
    for term in rc_risky:
        if term in rc_lower:
            return False, f"recommendation_context_risky_{term}", cleaned
    # v7.1 — narrow internal language detection (avoids false positives on normal words)
    internal_terms = [
        "sampled data",
        "database row",
        "database rows",
        "database field",
        "database fields",
        "json field",
        "json fields",
        "csv row",
        "csv rows",
        "spreadsheet row",
        "spreadsheet rows",
        "raw output",
        "dry run",
        "dry-run",
        "supabase",
        "llm ",
        " llm",
        "prompt template",
        "prompt instruction",
        "ai_generated",
        "ai-quality",
    ]
    for term in internal_terms:
        if term in public_text.lower():
            return False, f"internal_language_{term.strip().replace(' ', '_')}", cleaned

    return True, "ok", cleaned


def evaluate_reader_fit_quality(cleaned: Dict[str, Any], book: Dict[str, Any], categories: List[str], report_flat: Dict[str, Any]) -> Dict[str, Any]:
    """v8.5 — deterministic heuristic quality evaluator. Scores 1-5 across dimensions."""
    scores: Dict[str, float] = {}
    notes: List[str] = []

    public_text = " ".join(
        str(cleaned.get(f, "")) if not isinstance(cleaned.get(f), list) else " ".join(str(x) for x in (cleaned.get(f) or []))
        for f in PUBLIC_FIELDS if f in cleaned
    )
    text_lower = public_text.lower()
    quick_lower = cleaned.get("quick_verdict", "").lower()
    summary_lower = cleaned.get("editorial_summary", "").lower()
    not_for_items = [str(x).lower() for x in cleaned.get("not_for", [])]
    not_for_text = " ".join(not_for_items)
    best_for_items = [str(x).lower() for x in cleaned.get("best_for", [])]
    best_for_text = " ".join(best_for_items)
    emotional = cleaned.get("emotional_journey", "").lower()
    pace = cleaned.get("reading_pace_profile", "").lower()
    discussion = cleaned.get("discussion_potential", "").lower()
    comparable = cleaned.get("comparable_experience", "").lower()

    # --- 1. reader_fit_specificity ---
    spec_score = 3.0
    concrete_signals = 0
    if any(w in quick_lower for w in ["read when", "skip if", "read if", "good if", "useful if", "best when"]):
        concrete_signals += 1
    if any(w in best_for_text for w in ["you are", "you want", "you need", "you have", "you enjoy", "you prefer"]):
        concrete_signals += 1
    if any(w in summary_lower for w in ["useful part", "annoying", "limitation", "tradeoff", "weakest", "strongest", "bounce", "dnf"]):
        concrete_signals += 1
    # v8.7 — reward concrete role/use-case nouns
    concrete_nouns = [
        "founder", "product manager", "teacher", "parent", "student", "manager",
        "strategist", "engineer", "designer", "leader", "clinician", "therapist",
        "analyst", "entrepreneur", "investor", "coach", "executive", "researcher",
    ]
    if any(n in best_for_text or n in quick_lower for n in concrete_nouns):
        concrete_signals += 1
    # v8.7 — reward concrete mismatch metaphors
    mismatch_metaphors = [
        "allergic to", "not a manual", "not a playbook", "not a how-to",
        "light on practical steps", "mental irritant", "dense case study",
        "slow read", "no step-by-step",
    ]
    if any(m in not_for_text or m in summary_lower for m in mismatch_metaphors):
        concrete_signals += 1
    # v8.7 — reward specific category fit
    category_fit_words = [
        "startup", "corporate", "parenting", "classroom", "product",
        "strategy", "product thinking", "silicon valley", "enterprise",
    ]
    if any(c in best_for_text or c in quick_lower or c in summary_lower for c in category_fit_words):
        concrete_signals += 1
    if concrete_signals >= 4:
        spec_score = 4.8
    elif concrete_signals >= 3:
        spec_score = 4.5
    elif concrete_signals >= 2:
        spec_score = 3.5
    elif concrete_signals == 1:
        spec_score = 2.5
    else:
        spec_score = 1.5
    # Penalize generic audience words
    generic_audience = ["people who", "readers of", "those interested in", "anyone who"]
    if sum(1 for g in generic_audience if g in best_for_text) >= 2:
        spec_score = max(1.0, spec_score - 2.0)
        notes.append("best_for_too_generic")
    if not quick_lower or len(quick_lower) < 20:
        spec_score = max(1.0, spec_score - 1.5)
    scores["reader_fit_specificity"] = spec_score

    # --- 2. dnf_warning_quality ---
    dnf_score = 3.0
    dnf_signals = ["likely dnf", "bounce off", "dnf point", "may stop reading", "may quit", "hard to finish"]
    has_explicit_dnf = any(s in not_for_text for s in dnf_signals)
    has_friction_token = any(t in not_for_text for t in DNF_TOKENS)
    if has_explicit_dnf and has_friction_token:
        dnf_score = 4.5
    elif has_explicit_dnf or has_friction_token:
        dnf_score = 3.5
    else:
        dnf_score = 1.5
        notes.append("dnf_warning_weak")
    # Check if not_for items are too brief/vague
    if any(len(item.split()) < 8 for item in not_for_items):
        dnf_score = max(1.0, dnf_score - 1.0)
    scores["dnf_warning_quality"] = dnf_score

    # --- 3. emotional_fit_quality ---
    # v9.5 — strengthened: requires opening + friction + aftertaste + wrong-reader reaction
    emo_score = 3.0
    emo_signals = ["starts", "moves", "ends", "shifts", "builds", "unfolds", "grows", "turns", "feels like", "feels"]
    emo_count = sum(1 for s in emo_signals if s in emotional)
    # v9.5 — reward 3-beat arc structure (opening/middle/ending) + wrong-reader reaction
    has_opening = any(w in emotional for w in ["start", "begins", "opens", "first", "early", "initial"])
    has_friction = any(w in emotional for w in ["gets", "becomes", "shifts", "turns", "then", "plateaus", "irritating", "annoying", "frustrat", "drags", "difficult", "hardens", "repetitive", "loses", "wears off", "grating"])
    has_ending = any(w in emotional for w in ["ends", "leaves", "finishes", "aftertaste", "closes", "last", "final", "leaves you", "depart", "lingers", "settles"])
    has_wrong_reader = any(w in emotional for w in ["wrong", "lectured", "not for", "may feel", "if you", "some readers", "not everyone", "bounce", "skip if"])
    arc_bonus = 0
    if has_opening: arc_bonus += 1.0
    if has_friction: arc_bonus += 1.5
    if has_ending: arc_bonus += 1.0
    if has_wrong_reader: arc_bonus += 1.0
    emo_count += int(arc_bonus)
    if emo_count >= 6:
        emo_score = 5.0
    elif emo_count >= 4:
        emo_score = 4.8
    elif emo_count >= 3:
        emo_score = 4.5
    elif emo_count >= 2:
        emo_score = 3.5
    elif emo_count >= 1:
        emo_score = 2.5
    else:
        emo_score = 1.5
        notes.append("emotional_journey_weak")
    # v9.5 — strongly penalize generic praise-only emotional journeys
    generic_emo = ["inspiring", "thought-provoking", "engaging", "fascinating", "compelling", "powerful", "wonderful", "moving", "emotional", "beautiful"]
    generic_hits = sum(1 for g in generic_emo if g in emotional)
    if generic_hits >= 2 and emo_count < 3:
        emo_score = max(1.0, emo_score - 2.0)
        notes.append("emotional_journey_weak")
    elif any(g in emotional for g in generic_emo) and emo_count < 2:
        emo_score = max(1.0, emo_score - 1.5)
        notes.append("emotional_journey_weak")
    if len(emotional.split()) < 10:
        emo_score = max(1.0, emo_score - 1.5)
    scores["emotional_fit_quality"] = emo_score

    # --- 4. pacing_expectation_quality ---
    # v9.5 — strengthened: requires structure + skim advice + drag point + DNF tied to pace
    pace_score = 3.0
    pace_signals = [
        "one sitting", "slow", "chunks", "dense", "skim", "skimmable", "binge",
        "reference", "weeks", "returning to", "reread",
        "couple of sittings", "back half loses momentum", "early chapters",
        "middle chapters", "read in chunks", "not a one-sitting read",
        "loses momentum", "front-loaded", "drags", "pace",
        "slow read", "repetitive", "not one sitting",
        "settle in", "slog", "momentum", "accelerates",
    ]
    pace_count = sum(1 for s in pace_signals if s in pace)
    # v9.5 — reward structural pacing language with higher weight
    has_structure = any(w in pace for w in ["front half", "back half", "first half", "second half", "first third", "middle third", "core chapters", "opening chapters", "later chapters", "early on", "after the midpoint"])
    has_skim_advice = any(w in pace for w in ["skim", "skim the", "skip the", "read closely", "read carefully", "read slowly", "read fast", "browse", "dip into", "consult", "reference"])
    has_drag_point = any(w in pace for w in ["drags", "loses momentum", "repetitive", "repetition", "slows", "plateaus", "fast then", "slog", "bogged down", "grinds", "dense section"])
    has_dnf_pacing = any(w in pace for w in ["dnf", "bounce", "quit", "stop reading", "hardest to get through", "tempted to skip"])
    struct_bonus = 0
    if has_structure: struct_bonus += 1.5
    if has_skim_advice: struct_bonus += 1.5
    if has_drag_point: struct_bonus += 1.5
    if has_dnf_pacing: struct_bonus += 1.0
    pace_count += int(struct_bonus)
    if pace_count >= 5:
        pace_score = 5.0
    elif pace_count >= 4:
        pace_score = 4.8
    elif pace_count >= 3:
        pace_score = 4.5
    elif pace_count >= 2:
        pace_score = 3.5
    elif pace_count >= 1:
        pace_score = 2.5
    else:
        pace_score = 1.5
        notes.append("pacing_profile_weak")
    # v9.5 — penalize generic pacing (fast-paced only)
    generic_pace = ["fast-paced", "easy read", "reads quickly", "engaging throughout", "accessible"]
    generic_pace_hits = sum(1 for g in generic_pace if g in pace)
    if generic_pace_hits >= 2 and pace_count < 3:
        pace_score = max(1.0, pace_score - 2.0)
        notes.append("pacing_profile_weak")
    elif generic_pace_hits == 1 and pace_count < 2:
        pace_score = max(1.0, pace_score - 1.5)
        notes.append("pacing_profile_weak")
    if len(pace.split()) < 10:
        pace_score = max(1.0, pace_score - 1.5)
    scores["pacing_expectation_quality"] = pace_score

    # --- 5. best_for_specificity ---
    bf_score = 3.0
    bf_concrete = 0
    concrete_roles = [
        "founder", "product manager", "teacher", "parent", "student", "coach",
        "manager", "strategist", "executive", "entrepreneur", "engineer", "designer",
        "leader", "researcher", "analyst", "investor",
    ]
    concrete_situations = [
        "stuck", "wrestling with", "trapped", "anxious", "early career",
        "inside a large company", "classroom", "parenting", "product role",
        "watching their company", "side project", "new role",
    ]
    concrete_use_cases = [
        "trying to decide", "needs language for", "wants to understand",
        "seeking a lens", "deciding whether", "evaluating", "thinking about starting",
    ]
    for item in best_for_items:
        if any(w in item for w in ["when you", "you are", "you want", "if you", "you have", "you enjoy", "you prefer", "you need"]):
            bf_concrete += 1
        if any(r in item.lower() for r in concrete_roles):
            bf_concrete += 1.5
        if any(s in item.lower() for s in concrete_situations):
            bf_concrete += 1.5
        if any(u in item.lower() for u in concrete_use_cases):
            bf_concrete += 1.5
        if len(item.split()) >= 10:
            bf_concrete += 0.5
    # v8.8 — recalibrated scoring: 3 concrete items enough for a high score
    if bf_concrete >= 6:
        bf_score = 4.8
    elif bf_concrete >= 4:
        bf_score = 4.5
    elif bf_concrete >= 2.5:
        bf_score = 3.5
    elif bf_concrete >= 1.5:
        bf_score = 3.0
    else:
        bf_score = 1.5
        notes.append("best_for_too_generic")
    scores["best_for_specificity"] = bf_score

    # --- 6. not_for_specificity ---
    nf_concrete = 0
    nf_mismatch_signals = [
        "skip if", "dnf", "likely dnf", "not a manual", "not a playbook",
        "not a how-to", "no step-by-step", "step-by-step", "evidence",
        "nuance", "repetitive", "dated", "dense", "clinical data",
        "slow", "abstract", "ideology", "dogma", "practical steps",
        "one idea stretched", "bounce off", "not for", "frustrat", "annoy",
    ]
    for item in not_for_items:
        if any(w in item for w in ["if you", "you want", "you need", "you expect", "you prefer"]):
            nf_concrete += 1
        if any(m in item.lower() for m in nf_mismatch_signals):
            nf_concrete += 1.5
        if len(item.split()) >= 10:
            nf_concrete += 0.5
    if nf_concrete >= 6:
        nf_score = 4.8
    elif nf_concrete >= 4:
        nf_score = 4.5
    elif nf_concrete >= 2.5:
        nf_score = 3.5
    elif nf_concrete >= 1.5:
        nf_score = 3.0
    else:
        nf_score = 1.5
        notes.append("not_for_too_generic")
    scores["not_for_specificity"] = nf_score

    # --- 7. generic_ai_safety ---
    ga_score = 5.0
    generic_phrases = [
        "readers gain", "readers come away", "the book explores", "the book examines",
        "compelling look", "powerful meditation", "masterful account", "a must-read",
        "this book is", "this book provides", "this book offers", "this book explores",
        "in conclusion", "ultimately", "overall",
    ]
    generic_hits = sum(1 for g in generic_phrases if g in text_lower)
    if generic_hits >= 3:
        ga_score = 1.5
        notes.append("generic_reader_fit_copy")
    elif generic_hits >= 2:
        ga_score = 2.5
    elif generic_hits == 1:
        ga_score = 4.0
    scores["generic_ai_safety"] = ga_score

    # --- 8. fact_minimal_safety ---
    # v9.6 — strengthened attribution: multi-sentence removal, don't penalize ordinary business words
    fm_score = 5.0
    attribution_prefixes = [
        "the author argues", "the book argues", "the book frames",
        "the book discusses", "the book presents", "the author frames",
        "the author discusses", "the author presents",
        "the author contends", "the book contends",
        "the author describes", "the book describes",
        "the author claims", "the book claims",
        "the author explores", "the book explores",
    ]
    # Build a version of text_lower with attributed spans removed — use non-greedy up to period
    text_without_attribution = text_lower
    for prefix in attribution_prefixes:
        escaped = re.escape(prefix)
        # Match the prefix + everything until the next period (up to 3 sentence boundaries)
        text_without_attribution = re.sub(
            escaped + r'[^.!?]*[.!?]', ' ', text_without_attribution, flags=re.IGNORECASE
        )
    # v9.6 — split into proof/prestige (hard penalize) vs ordinary context words (softer)
    hard_proof_signals = [
        "proven", "evidence shows", "data-driven", "studies prove",
        "research proves", "validated", "demonstrated", "peer-reviewed",
        "definitive", "classic", "bestseller", "best-selling",
        "backed by research", "research-backed", "evidence-based",
        "scientifically proven", "grounded in research",
        "clinical", "trial", "published", "journal",
        "doctors", "scientists", "researchers",
    ]
    soft_context_signals = [
        "research shows", "statistics",
        "experts", "startup", "startups", "company",
        "founder", "product", "case study", "case studies",
    ]
    hard_hits = sum(1 for f in hard_proof_signals if f in text_without_attribution)
    soft_hits = sum(1 for f in soft_context_signals if f in text_without_attribution)
    total_hits = hard_hits + int(soft_hits * 0.3)
    if total_hits >= 5:
        fm_score = 1.5
        notes.append("fact_minimal_risk")
    elif total_hits >= 3:
        fm_score = 2.5
    elif total_hits >= 2:
        fm_score = 3.5
    elif total_hits >= 1:
        fm_score = 4.0
    # v9.6 — extra penalty for direct proof/prestige claims
    if hard_hits >= 2:
        fm_score = max(1.5, fm_score - 1.0)
    scores["fact_minimal_safety"] = fm_score

    # --- 9. vibe_quality ---
    # v9.6 — start at 5.0, only penalize for actual problems
    vq_score = 5.0
    vibe_tags = cleaned.get("vibe_tags", [])
    vibe_hype_exact = {"insightful", "engaging", "fascinating", "excellent", "brilliant", "amazing", "great", "wonderful", "fun", "nice", "thought-provoking", "inspiring", "compelling", "powerful", "beautiful", "moving"}
    hype_count = sum(1 for v in vibe_tags if v.lower().strip() in vibe_hype_exact)
    if hype_count >= 2:
        vq_score = 2.0
        notes.append("vibe_quality")
    elif hype_count == 1:
        vq_score = 3.5
        notes.append("vibe_quality")
    if len(vibe_tags) < 5:
        vq_score = max(2.0, vq_score - 1.0)
        notes.append("vibe_quality")
    # v9.6 — reward presence of pace/intensity tag
    has_pace_tag = any(t.lower().strip() in {"slow-burn", "fast-but-dense", "idea-dense", "patience-demanding", "quick-but-heavy", "dense-read", "light-but-sharp", "one-sitting", "high-friction"} for t in vibe_tags)
    if not has_pace_tag and len(vibe_tags) >= 5:
        vq_score = max(2.5, vq_score - 1.0)
    scores["vibe_quality"] = vq_score

    # --- 10. summary_book_report check ---
    summary_words = summary_lower.split()
    report_signals = ["explores", "examines", "discusses", "covers", "describes", "traces", "chronicles"]
    report_hits = sum(1 for s in report_signals if s in summary_lower)
    if report_hits >= 2 and len(summary_words) > 60:
        notes.append("summary_too_book_report_like")
        # Reduce fact_minimal safety if it reads like a factual report
        scores["fact_minimal_safety"] = max(1.5, scores["fact_minimal_safety"] - 1.0)

    # --- overall_icp_score ---
    dimensions = [
        "reader_fit_specificity", "dnf_warning_quality", "emotional_fit_quality",
        "pacing_expectation_quality", "best_for_specificity", "not_for_specificity",
        "generic_ai_safety", "fact_minimal_safety", "vibe_quality",
    ]
    overall = sum(scores[d] for d in dimensions) / len(dimensions)
    overall = round(overall, 2)
    scores["overall_icp_score"] = overall

    # --- recommended_action ---
    if overall >= 4.7:
        action = "accept_candidate"
    elif overall >= 4.3:
        action = "keep_pending"
    elif overall >= 4.0:
        action = "needs_retry"
    else:
        action = "reject"

    # v9.0 — evaluator_notes must not be "ok" when action is not accept_candidate
    if action != "accept_candidate" and not notes:
        # Generate notes from lowest dimension scores
        weak_dims: List[str] = []
        for d in dimensions:
            if scores[d] <= 3.0:
                weak_dims.append(f"{d.replace('_', ' ')}={scores[d]}")
        if weak_dims:
            notes = ["score_drivers: " + " | ".join(weak_dims[:3])]
        else:
            notes = ["not_enough_elite_specificity"]

    return {
        **scores,
        "evaluator_notes": " | ".join(notes) if notes else "ok",
        "recommended_action": action,
    }


def update_book(book_id: str, enrichment: Dict[str, Any], status: str = "draft") -> None:
    url, _ = supabase_base()
    payload = {
        "editorial_summary": enrichment["editorial_summary"],
        "best_for": " | ".join(enrichment["best_for"]),
        "not_for": " | ".join(enrichment["not_for"]),
        "key_themes": enrichment["key_themes"],
        "difficulty_level": enrichment["difficulty_level"],
        "recommendation_context": enrichment["recommendation_context"],
        "source_quality_note": enrichment["source_quality_note"],
        "ai_generated_at": datetime.now(timezone.utc).isoformat(),
        "ai_quality_status": status,
    }
    req_url = f"{url}/rest/v1/books?" + urllib.parse.urlencode({"id": f"eq.{book_id}"})
    http_json(req_url, method="PATCH", payload=payload, headers=supabase_headers("return=minimal"))


def write_report(path: str, rows: List[Dict[str, Any]]) -> None:
    if not rows:
        return
    extra_fields = []
    for row in rows:
        for key in row.keys():
            if key not in REPORT_FIELDS and key not in extra_fields:
                extra_fields.append(key)
    fieldnames = REPORT_FIELDS + extra_fields
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def default_model(provider: str) -> str:
    return "deepseek-v4-flash" if provider == "deepseek" else "gpt-4o-mini"


def load_fixture_books(fixture_path: str) -> List[Dict[str, Any]]:
    with open(fixture_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    books = data.get("books", [])
    if not isinstance(books, list) or len(books) == 0:
        raise SystemExit(f"Fixture file {fixture_path} has no books array.")
    return books


def build_fixture_context(fixture_book: Dict[str, Any]) -> Dict[str, Any]:
    recommendations = fixture_book.get("recommendations", []) or []
    lists_raw = fixture_book.get("lists", []) or []
    series_raw = fixture_book.get("series", []) or []
    source_backed_count = sum(1 for r in recommendations if r.get("source_url", "").startswith("http"))
    recommender_names = [r.get("person_name", "") for r in recommendations if r.get("person_name")]
    recommendations_full = []
    for r in recommendations:
        recommendations_full.append({
            "person_name": clean(r.get("person_name", "")),
            "person_role": clean(r.get("person_role", "")),
            "source_url": clean(r.get("source_url", "")),
            "source_name": clean(r.get("source_name", "")),
            "quote": clean(r.get("quote", ""))[:350],
            "confidence_score": r.get("confidence_score"),
        })
    role_summary = summarize_roles(recommendations_full)
    public_signals = public_recommendation_signals(recommendations_full)
    lists = [{"name": clean(name) if isinstance(name, str) else clean(name.get("name", "")), "book_count": 0} for name in lists_raw]
    series = [{"name": clean(name) if isinstance(name, str) else clean(name.get("name", "")), "book_count": 0} for name in series_raw]
    context = {
        "content_boundary": {
            "allowed_general_knowledge": "You may use broad, high-confidence book knowledge for content framing only.",
            "not_allowed": "Do not add awards, sales numbers, credentials, company facts, publication facts, edition facts, source proof, recommender names, or quotes unless provided here.",
            "description_note": "book.description is omitted when missing, too short, non-English, or likely scraped metadata.",
        },
        "book": {
            "title": fixture_book.get("title"),
            "author_name": fixture_book.get("author"),
            "recommendation_count": fixture_book.get("recommendation_count", 0),
            "description": safe_description_for_ai(fixture_book.get("description", "")),
        },
        "context_quality": {
            "has_book_description": bool(safe_description_for_ai(fixture_book.get("description", ""))),
            "sampled_recommendations": len(recommendations),
            "sampled_source_backed_recommendations": source_backed_count,
            "sampled_lists": len(lists),
            "sampled_series": len(series),
            "recommender_roles_in_sample": role_summary,
            "public_copy_rule": "Do not name individual recommenders in public editorial fields. Use role/category patterns only.",
        },
        "recommendation_signals_sample": public_signals,
        "lists": lists,
        "series": series,
        "source_backed_recommendation_count_in_sample": source_backed_count,
        "sampled_recommendation_count": len(recommendations),
    }
    context["_report_flat"] = {
        "context_recommender_names": " | ".join(recommender_names[:12]),
        "context_recommender_roles": " | ".join(role_summary),
        "context_list_names": " | ".join(clean(l.get("name")) for l in lists if clean(l.get("name"))),
        "context_source_url_count": source_backed_count,
        "context_sampled_recommendation_count": len(recommendations),
    }
    context["_fixture_meta"] = {
        "expected_status": fixture_book.get("expected_status", ""),
        "expected_reason_contains": fixture_book.get("expected_reason_contains", ""),
    }
    return context


def check_fixture_expectations(rows: List[Dict[str, Any]], fixture_books: List[Dict[str, Any]]) -> Tuple[int, int, List[str]]:
    matched = 0
    mismatched = 0
    errors: List[str] = []
    for fb in fixture_books:
        expected_status = fb.get("expected_status", "")
        expected_reason = fb.get("expected_reason_contains", "")
        if not expected_status:
            continue
        book_id = fb.get("id", "")
        row = next((r for r in rows if r.get("book_id") == book_id), None)
        if not row:
            mismatched += 1
            errors.append(f"{fb.get('title', book_id)}: expected {expected_status} but no row found")
            continue
        actual_status = row.get("status", "")
        actual_reason = row.get("reason", "")
        status_ok = False
        if expected_status == "pass" and actual_status in ("dry_run_update", "updated"):
            status_ok = True
        elif expected_status == "fail" and actual_status == "rejected":
            status_ok = True
        reason_ok = True
        if expected_reason:
            reason_ok = expected_reason.lower() in actual_reason.lower()
        if status_ok and reason_ok:
            matched += 1
        else:
            mismatched += 1
            errors.append(
                f"{fb.get('title', book_id)}: expected status={expected_status} reason_contains='{expected_reason}', "
                f"got status={actual_status} reason='{actual_reason}'"
            )
    return matched, mismatched, errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--provider", choices=["deepseek", "openai"], default="deepseek")
    parser.add_argument("--model", default="")
    parser.add_argument(
        "--quality-status",
        default="draft",
        help="Value written to ai_quality_status on --write. Keep as draft/needs_review; do not use approved before human QA.",
    )
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--include-existing", action="store_true", help="Regenerate even if editorial_summary already exists.")
    parser.add_argument("--sleep", type=float, default=0.4)
    parser.add_argument("--report", default=DEFAULT_REPORT)
    parser.add_argument("--fixture-file", default="", help="Path to fixture JSON. Bypasses Supabase. Use with --mock-ai.")
    parser.add_argument("--mock-ai", action="store_true", help="Use fixture mock_ai_output instead of calling AI provider. Requires --fixture-file.")
    parser.add_argument("--concurrency", type=int, default=1, help="Number of concurrent books for dry-run/no-write mode.")
    parser.add_argument("--only-failed-from-report", default="", help="Rerun only books that failed in a previous CSV report.")
    parser.add_argument("--only-actions-from-report", default="", help="Format: REPORT.csv:action1,action2 (e.g. report.csv:needs_retry,keep_pending,reject).")
    parser.add_argument("--book-ids-file", default="", help="File with one book_id or slug per line to rerun.")
    parser.add_argument("--debug-failed-only-selection", action="store_true", help="Print each selected row during --only-failed-from-report parsing.")
    parser.add_argument("--debug-prompt-safety", action="store_true", help="Debug recommender-name leakage into AI prompts.")
    parser.add_argument("--max-retries", type=int, default=1, help="Max retry attempts for validation/JSON failures (3 max).")
    parser.add_argument("--checkpoint-every", type=int, default=5, help="Write report every N completed rows during dry run.")
    parser.add_argument("--supabase-fetch-retries", type=int, default=3, help="Max retry attempts for Supabase fetch calls (6 max).")
    parser.add_argument("--audit-ai-fields-from-report", default="", help="Read report CSV and produce audit of current DB AI field state.")
    parser.add_argument("--backup-ai-fields-from-report", default="", help="Read report CSV and backup current DB AI fields to a CSV.")
    parser.add_argument("--restore-ai-fields-from-report", default="", help="Restore/clear AI fields for rows in a report. Default preview only.")
    parser.add_argument("--restore-needs-review-ai-fields-from-report", default="", help="Restore/clear AI fields for needs_review rows in a report. Preview only unless confirmed.")
    parser.add_argument("--restore-ai-fields-from-backup", default="", help="Restore AI fields from a backup CSV. Default preview only.")
    parser.add_argument("--restore-backup-file", default="", help="Backup CSV path required when confirming restore.")
    parser.add_argument("--confirm-restore-ai-fields", action="store_true", help="Required to actually clear/restore AI fields.")
    parser.add_argument("--backup-before-write", default="", help="Backup CSV path required when --write is used.")
    # v8.6 — report analysis tooling
    parser.add_argument("--analyze-report", default="", help="Analyze a dry-run CSV report and print summary. No DB or AI calls.")
    parser.add_argument("--emit-learning-pack", default="", help="Output directory for learning pack files. Requires --analyze-report.")
    parser.add_argument("--compare-reports", nargs=2, default=[], metavar=("OLD", "NEW"), help="Compare two dry-run CSVs and print delta.")
    parser.add_argument("--promote-regression-cases", default="", help="Read regression_case_candidates.json and print copy-paste fixture skeletons.")
    # v9.4 — compact contract loader
    parser.add_argument("--editorial-contract-file", default="docs/ai-editorial/COMPACT_PROMPT_CONTRACT.md", help="Path to compact prompt contract markdown (default: docs/ai-editorial/COMPACT_PROMPT_CONTRACT.md).")
    args = parser.parse_args()

    if args.mock_ai and not args.fixture_file:
        raise SystemExit("--mock-ai requires --fixture-file")
    if args.concurrency > 1 and args.write:
        raise SystemExit("--concurrency > 1 is only allowed for dry-run/no-write mode")
    if args.max_retries > 3:
        raise SystemExit("--max-retries cannot exceed 3")
    if args.supabase_fetch_retries > 6:
        raise SystemExit("--supabase-fetch-retries cannot exceed 6")
    if args.only_failed_from_report and args.book_ids_file:
        raise SystemExit("Cannot use both --only-failed-from-report and --book-ids-file together")
    if args.only_actions_from_report and args.book_ids_file:
        raise SystemExit("Cannot use both --only-actions-from-report and --book-ids-file together")
    if args.only_failed_from_report and args.only_actions_from_report:
        raise SystemExit("Cannot use both --only-failed-from-report and --only-actions-from-report together")
    if args.write and not args.backup_before_write:
        raise SystemExit("--write requires --backup-before-write PATH so AI fields can be restored safely")
    # v7.5.2 — restore safety gates
    needs_restore = args.restore_ai_fields_from_report or args.restore_needs_review_ai_fields_from_report or args.restore_ai_fields_from_backup
    if args.confirm_restore_ai_fields and not args.restore_backup_file and needs_restore:
        raise SystemExit("--confirm-restore-ai-fields requires --restore-backup-file PATH")
    if args.confirm_restore_ai_fields and args.restore_backup_file:
        import pathlib
        if not pathlib.Path(args.restore_backup_file).exists():
            raise SystemExit(f"Backup file not found: {args.restore_backup_file}")

    model = args.model or default_model(args.provider)
    write_enabled = bool(args.write)
    fixture_mode = bool(args.fixture_file)
    mock_ai = bool(args.mock_ai)

    # v9.4 — load compact editorial contract once at startup
    if args.editorial_contract_file:
        global GLOBAL_CONTRACT_TEXT
        GLOBAL_CONTRACT_TEXT = load_editorial_contract(args.editorial_contract_file)
    else:
        print("[contract] No contract file specified. Using hardcoded prompt.")

    # v8.6 — report analysis tooling (exits after completion, no generation)
    if args.analyze_report:
        if args.emit_learning_pack and not args.analyze_report:
            raise SystemExit("--emit-learning-pack requires --analyze-report")
        return _run_analyze_report(args.analyze_report, args.emit_learning_pack)
    if args.compare_reports:
        return _run_compare_reports(args.compare_reports[0], args.compare_reports[1])
    if args.promote_regression_cases:
        return _run_promote_regression_cases(args.promote_regression_cases)

    if fixture_mode:
        if mock_ai:
            print("[mode] FIXTURE + MOCK AI. No Supabase or AI calls.")
        else:
            print("[mode] FIXTURE MODE. No Supabase calls. AI calls still live unless --mock-ai.")
        return _run_fixture(args, model, write_enabled, mock_ai)

    # v7.5.2 — DB audit/restore tooling
    if args.audit_ai_fields_from_report:
        return _run_audit(args)
    if args.backup_ai_fields_from_report:
        return _run_backup(args)
    if args.restore_needs_review_ai_fields_from_report:
        return _run_restore_needs_review(args)
    if args.restore_ai_fields_from_report:
        return _run_restore_from_report(args.restore_ai_fields_from_report, args.confirm_restore_ai_fields)
    if args.restore_ai_fields_from_backup:
        return _run_restore_from_backup(args.restore_ai_fields_from_backup, args.confirm_restore_ai_fields)

    if args.dry_run and not write_enabled:
        print("[mode] LIVE DRY RUN. No database writes. Pass --write to update Supabase.")
    elif write_enabled:
        print("[mode] LIVE WRITE. Database updates enabled.")
    else:
        print("[mode] LIVE NO-WRITE. No database writes. Pass --write to update Supabase.")
    if args.concurrency > 1:
        print(f"[mode] concurrency={args.concurrency}")

    return _run_live(args, model, write_enabled)


# v9.5 — surgical retry for weak score-driver dimensions
SCORE_DRIVER_DIMS = [
    "emotional_fit_quality", "pacing_expectation_quality",
    "best_for_specificity", "reader_fit_specificity",
    "fact_minimal_safety",
]


def _surgical_retry_prompt(current_output: Dict[str, Any], quality_eval: Dict[str, Any]) -> Optional[str]:
    """Build a surgical retry prompt targeting only the weakest dimensions. Returns None if no retry needed."""
    low_dims = []
    for dim in SCORE_DRIVER_DIMS:
        score = quality_eval.get(dim, 5.0)
        if score <= 3.5:
            low_dims.append((dim, score))
    if not low_dims:
        return None
    low_dims.sort(key=lambda x: x[1])
    target = low_dims[0][0]

    instructions = {
        "emotional_fit_quality": (
            "Rewrite ONLY emotional_journey. It must include exactly: 1) opening feeling, "
            "2) mid-book friction or annoyance, 3) ending aftertaste, 4) wrong-reader emotional reaction. "
            "Bad: 'thought-provoking and inspiring.' "
            "Good: 'Starts like a jolt, gets irritating when the author's certainty hardens, "
            "and ends either as a useful provocation or an overconfident sermon. "
            "Wrong reader reaction: you may feel lectured rather than helped.' "
            "Do NOT change any other field."
        ),
        "pacing_expectation_quality": (
            "Rewrite ONLY reading_pace_profile. It must include: 1) reading speed, "
            "2) where momentum changes (front half/back half/first third/middle chapters), "
            "3) skim or slow-read advice, 4) likely drag point. "
            "Good: 'Front half moves fast while the core idea is fresh; middle case studies drag; "
            "skim repeated examples after the concept lands; read in chunks if you dislike business anecdotes.' "
            "Do NOT change any other field."
        ),
        "best_for_specificity": (
            "Rewrite ONLY best_for. Each item must include: 1) concrete reader identity (PM, teacher, parent, founder), "
            "2) specific life/work situation, 3) concrete reason this book fits NOW. "
            "Bad: 'business professionals looking for new ideas.' "
            "Good: 'a PM inside a legacy company trying to explain why a low-margin competitor matters before leadership takes it seriously.'"
            "Do NOT change any other field."
        ),
        "reader_fit_specificity": (
            "Rewrite ONLY quick_verdict and editorial_summary. quick_verdict must answer: "
            "when is this the right book, when is wrong, what makes someone bounce. "
            "editorial_summary must describe actual reading experience + useful part + annoying part in 70-95 words. "
            "Do NOT change best_for, not_for, or other fields."
        ),
        "fact_minimal_safety": (
            "Rewrite ONLY fields containing unsupported/proofy claims. Use attribution: "
            "'the book argues...', 'the author frames...', 'the book presents...', 'the book discusses...' "
            "Remove: proven, evidence shows, data-driven, studies prove, research-backed, validated, demonstrated, peer-reviewed. "
            "Do NOT add new facts. Do NOT change other fields."
        ),
    }

    instr = instructions.get(target, f"Rewrite ONLY the weakest field ({target}). Do NOT change other fields.")
    output_json = json.dumps(current_output, ensure_ascii=False, indent=2)
    return (
        f"Your output scored low on {target} ({low_dims[0][1]:.1f}/5).\n\n"
        f"{instr}\n\n"
        f"Current output to repair:\n{output_json}\n\n"
        "Return strict JSON with the same keys. Only rewrite the target field. Keep all other fields unchanged."
    )


def _final_polish_prompt(current_output: Dict[str, Any], quality_eval: Dict[str, Any]) -> Optional[str]:
    """Build a final polish prompt for near-threshold rows (4.3-4.69). Only targets lowest 2 dims."""
    dims_with_scores = [(dim, quality_eval.get(dim, 5.0)) for dim in SCORE_DRIVER_DIMS]
    dims_with_scores.sort(key=lambda x: x[1])
    weakest = [d for d, s in dims_with_scores if s < 4.5][:2]
    if not weakest:
        return None
    dim_list = ", ".join(weakest)
    output_json = json.dumps(current_output, ensure_ascii=False, indent=2)
    return (
        f"Your output scored below the 4.7 threshold. Only rewrite these fields: {dim_list}.\n\n"
        "Make each field more specific and concrete. Do NOT add facts. Do NOT change format claims. "
        "Do NOT add new claims about awards, research, or prestige. "
        "For emotional_journey: include opening feeling, friction, aftertaste, wrong-reader reaction. "
        "For pacing: include front/back half structure, skim advice, drag point. "
        "For best_for: name concrete person + situation + reason this book fits now.\n\n"
        f"Current output to polish:\n{output_json}\n\n"
        "Return strict JSON. Preserve all unchanged fields exactly."
    )


def process_book(book: Dict[str, Any], context: Dict[str, Any], provider: str, model: str, write_enabled: bool, quality_status: str, mock_ai_output: Optional[Dict[str, Any]] = None, max_retries: int = 1, debug_prompt_safety: bool = False) -> Dict[str, Any]:
    """Process one book through the enrichment pipeline. Returns a results dict."""
    report_flat = context.get("_report_flat", {})
    quality_warnings: List[str] = []

    def _dedupe_warnings():
        nonlocal quality_warnings
        seen: List[str] = []
        for w in quality_warnings:
            if w not in seen:
                seen.append(w)
        quality_warnings = seen

    def _add_warning(w: str):
        if w not in quality_warnings:
            quality_warnings.append(w)

    if mock_ai_output is not None:
        raw = json.dumps(mock_ai_output, ensure_ascii=False)
        parsed = mock_ai_output
    else:
        # v8.3 — hard scrub recommender names from all prompt text before safety assertion
        safe_recommender_names = context.get("_report_flat", {}).get("context_recommender_names", "")
        recommender_names_list = [n.strip() for n in safe_recommender_names.split("|") if n.strip() and len(n.strip()) > 3]
        allowed_names_for_scrub = set()
        book_info_for_scrub = context.get("book", {})
        author_raw = clean(book_info_for_scrub.get("author_name", "") or "")
        title_raw = clean(book_info_for_scrub.get("title", "") or "")
        for val in [author_raw, title_raw]:
            if val:
                for part in val.split():
                    if len(part) > 2:
                        allowed_names_for_scrub.add(part.lower())
        sys_prompt = system_prompt(GLOBAL_CONTRACT_TEXT)
        usr_prompt = user_prompt(context)
        # Scrub before safety check
        scrubbed_sys = scrub_name_from_text(sys_prompt, recommender_names_list, allowed_names_for_scrub)
        scrubbed_usr = scrub_name_from_text(usr_prompt, recommender_names_list, allowed_names_for_scrub)
        prompt_text = scrubbed_sys + scrubbed_usr
        debug_prompt_safety_active = debug_prompt_safety
        for name in recommender_names_list:
            name = name.strip()
            if not name or len(name) <= 3:
                continue
            name_lower = name.lower()
            if any(an in name_lower for an in allowed_names_for_scrub):
                continue
            if name_lower in prompt_text.lower():
                section = "unknown"
                snippet = ""
                if name_lower in scrubbed_sys.lower():
                    section = "system_prompt"
                    idx = scrubbed_sys.lower().find(name_lower)
                    snippet = scrubbed_sys[max(0,idx-30):idx+len(name)+30]
                elif name_lower in scrubbed_usr.lower():
                    section = "user_prompt"
                    idx = scrubbed_usr.lower().find(name_lower)
                    snippet = scrubbed_usr[max(0,idx-30):idx+len(name)+30]
                reason = f"unsafe_prompt_contains_recommender_name_{name}_{section}"
                if debug_prompt_safety_active:
                    slug = clean(book.get("slug", book.get("id", "unknown")))
                    debug_path = f"prompt_safety_debug_{slug}.txt"
                    sections_checked = ["system_prompt", "user_prompt", "safe_book_context", "retry_prompt"]
                    debug_lines = [
                        f"offending_name: {name}",
                        f"section: {section}",
                        f"redacted_snippet: ...{snippet}..." if snippet else f"redacted_snippet: <not available>",
                        f"sections_checked: {', '.join(sections_checked)}",
                    ]
                    with open(debug_path, "w", encoding="utf-8") as df:
                        df.write("\n".join(debug_lines) + "\n")
                    print(f"[debug-prompt-safety] wrote {debug_path}")
                return _make_rejected_row(book, report_flat, reason, "", quality_warnings)
        try:
            raw = call_llm(
                provider, model,
                [{"role": "system", "content": scrubbed_sys}, {"role": "user", "content": scrubbed_usr}],
            )
        except Exception as exc:
            if _is_provider_network_error(exc):
                return _make_provider_error_row(book, report_flat, str(exc))
            raise
        parsed = parse_ai_json(raw)
    if parsed.get("_parse_error"):
        if mock_ai_output is not None:
            return _make_rejected_row(book, report_flat, parsed["_parse_error"], raw[:1000], quality_warnings)
        for attempt in range(max_retries):
            _add_warning(f"retry_used_{parsed['_parse_error']}")
            try:
                repair_raw = call_llm(
                    provider, model,
                    [{"role": "system", "content": system_prompt(GLOBAL_CONTRACT_TEXT)},
                     {"role": "user", "content": f"Your previous response could not be parsed as JSON. Return ONLY valid JSON with the required fields. Original error: {parsed['_parse_error']}"}],
                )
            except Exception as exc:
                if _is_provider_network_error(exc):
                    return _make_provider_error_row(book, report_flat, str(exc))
                raise
            parsed = parse_ai_json(repair_raw)
            raw = repair_raw
            if not parsed.get("_parse_error"):
                break
        if parsed.get("_parse_error"):
            reason = f"ai_json_repair_failed_{parsed['_parse_error']}"
            return _make_rejected_row(book, report_flat, reason, raw[:1000], quality_warnings)
    # recommendation_context is always deterministic
    parsed.pop("recommendation_context", None)
    ok, reason, cleaned = validate_output(parsed, context, quality_warnings)
    if not ok and mock_ai_output is None:
        # v8.4 — targeted retry for style failures
        is_style_failure = "publisher_hype" in reason.lower() or "generic_ai" in reason.lower() or "fields_not_distinct" in reason.lower()
        for attempt in range(max_retries):
            _add_warning("retry_used")
            try:
                repair_raw = call_llm(
                    provider, model,
                    [{"role": "system", "content": system_prompt(GLOBAL_CONTRACT_TEXT)}, {"role": "user", "content": repair_prompt(context, parsed, reason)}],
                )
            except Exception as exc:
                if _is_provider_network_error(exc):
                    return _make_provider_error_row(book, report_flat, str(exc))
                raise
            repair_parsed = parse_ai_json(repair_raw)
            if repair_parsed.get("_parse_error"):
                if attempt + 1 >= max_retries:
                    return _make_rejected_row(book, report_flat, f"{reason}; repair_json_failed", repair_raw[:1000], quality_warnings)
                parsed = repair_parsed
                reason = repair_parsed["_parse_error"]
                continue
            repair_ok, repair_reason, repair_cleaned = validate_output(repair_parsed, context, quality_warnings)
            if repair_ok:
                raw = repair_raw
                parsed = repair_parsed
                ok = repair_ok
                reason = "ok_after_retry"
                cleaned = repair_cleaned
                break
            else:
                raw = repair_raw
                parsed = repair_parsed
                reason = repair_reason
        if not ok:
            # v8.7 — try previous retry raw outputs for name-leak debug if cleaned doesn't contain it
            rl = reason.lower()
            attempt_label = f"retry_{max_retries}"
            public_text_for_debug = " ".join(
                str(cleaned.get(f, "")) if not isinstance(cleaned.get(f), list) else " ".join(str(x) for x in (cleaned.get(f) or []))
                for f in PUBLIC_FIELDS if f in cleaned
            )
            debug_field, debug_matched, debug_snippet = _find_reject_debug(cleaned, reason, public_text_for_debug)
            source_label = "retry_output"
            if "public_recommender_name_leak" in rl and (not debug_matched or debug_matched.lower() not in debug_snippet.lower()):
                raw_text = raw[:2000] if raw else ""
                if debug_matched and debug_matched.lower() in raw_text.lower():
                    idx = raw_text.lower().find(debug_matched.lower())
                    debug_snippet = raw_text[max(0, idx - 60): idx + len(debug_matched) + 90]
                    debug_field = "retry_raw_output"
                else:
                    debug_snippet = "matched text not found in stored public fields"
                    _add_warning("reject_debug_incomplete")
                    _add_warning("possible_name_leak_debug_mismatch")
                    source_label = "debug_mismatch"
            reject_debug = {"field": debug_field, "matched": debug_matched, "snippet": debug_snippet, "source": source_label, "attempt": attempt_label}
            return _make_rejected_row(book, report_flat, f"{reason}; max_retries_exhausted", raw[:1000], quality_warnings, reject_debug)
    if not ok:
        rl = reason.lower()
        attempt_label = "first_attempt"
        public_text_for_debug = " ".join(
            str(cleaned.get(f, "")) if not isinstance(cleaned.get(f), list) else " ".join(str(x) for x in (cleaned.get(f) or []))
            for f in PUBLIC_FIELDS if f in cleaned
        )
        debug_field, debug_matched, debug_snippet = _find_reject_debug(cleaned, reason, public_text_for_debug)
        source_label = "first_attempt_output"
        if "public_recommender_name_leak" in rl and (not debug_matched or debug_matched.lower() not in debug_snippet.lower()):
            raw_text = raw[:2000] if raw else ""
            if debug_matched and debug_matched.lower() in raw_text.lower():
                idx = raw_text.lower().find(debug_matched.lower())
                debug_snippet = raw_text[max(0, idx - 60): idx + len(debug_matched) + 90]
                debug_field = "raw_output"
            else:
                debug_snippet = "matched text not found in stored public fields"
                _add_warning("reject_debug_incomplete")
                _add_warning("possible_name_leak_debug_mismatch")
                source_label = "debug_mismatch"
        reject_debug = {"field": debug_field, "matched": debug_matched, "snippet": debug_snippet, "source": source_label, "attempt": attempt_label}
        return _make_rejected_row(book, report_flat, reason, raw[:1000], quality_warnings, reject_debug)
    cleaned = sanitize_public_copy(cleaned)
    # Check for near-limit word count
    wc = len(cleaned["editorial_summary"].split())
    # v7.5.1 — quality_warnings deduplication
    seen_warnings: List[str] = []
    for w in quality_warnings:
        if w not in seen_warnings:
            seen_warnings.append(w)
    quality_warnings = seen_warnings

    # v8.5 — quality evaluator
    categories = [clean(l.get("name", "")) for l in context.get("lists", []) if clean(l.get("name", ""))]
    quality_eval = evaluate_reader_fit_quality(cleaned, book, categories, report_flat)
    overall_score = quality_eval.get("overall_icp_score", 0)
    recommended_action = quality_eval.get("recommended_action", "reject")
    eval_notes = quality_eval.get("evaluator_notes", "")

    # v9.5 — surgical retry for weak score-driver dimensions
    best_candidate = cleaned
    best_quality_eval = quality_eval
    best_raw = raw
    best_score = overall_score
    best_status = "generated_but_weak"
    best_reason = f"quality_below_accept_threshold; score={overall_score}"

    if mock_ai_output is None and overall_score < 4.7 and overall_score >= 4.0:
        surgical_prompt = _surgical_retry_prompt(cleaned, quality_eval)
        if surgical_prompt:
            for retry_attempt in range(max(1, max_retries)):
                _add_warning("surgical_retry_used")
                try:
                    surgical_raw = call_llm(
                        provider, model,
                        [{"role": "system", "content": system_prompt(GLOBAL_CONTRACT_TEXT)},
                         {"role": "user", "content": surgical_prompt}],
                    )
                except Exception as exc:
                    if _is_provider_network_error(exc):
                        break
                    raise
                surgical_parsed = parse_ai_json(surgical_raw)
                if surgical_parsed.get("_parse_error"):
                    continue
                surgical_parsed.pop("recommendation_context", None)
                surg_ok, surg_reason, surg_cleaned = validate_output(surgical_parsed, context, quality_warnings)
                if not surg_ok:
                    continue
                surg_cleaned = sanitize_public_copy(surg_cleaned)
                surgical_eval = evaluate_reader_fit_quality(surg_cleaned, book, categories, report_flat)
                surgical_score = surgical_eval.get("overall_icp_score", 0)
                if surgical_score > best_score:
                    best_candidate = surg_cleaned
                    best_quality_eval = surgical_eval
                    best_raw = surgical_raw
                    best_score = surgical_score
                    quality_warnings.append(f"surgical_retry_improved_{best_score:.2f}")
                if surgical_score >= best_score:
                    break

    # v9.5 — final polish for near-threshold rows (4.3-4.69)
    if mock_ai_output is None and best_score >= 4.3 and best_score < 4.7 and max_retries > 0:
        polish_prompt = _final_polish_prompt(best_candidate, best_quality_eval)
        if polish_prompt:
            for polish_attempt in range(1):
                _add_warning("final_polish_attempt")
                try:
                    polish_raw = call_llm(
                        provider, model,
                        [{"role": "system", "content": system_prompt(GLOBAL_CONTRACT_TEXT)},
                         {"role": "user", "content": polish_prompt}],
                    )
                except Exception as exc:
                    if _is_provider_network_error(exc):
                        break
                    raise
                polish_parsed = parse_ai_json(polish_raw)
                if polish_parsed.get("_parse_error"):
                    break
                polish_parsed.pop("recommendation_context", None)
                pol_ok, pol_reason, pol_cleaned = validate_output(polish_parsed, context, quality_warnings)
                if not pol_ok:
                    break
                pol_cleaned = sanitize_public_copy(pol_cleaned)
                polish_eval = evaluate_reader_fit_quality(pol_cleaned, book, categories, report_flat)
                polish_score = polish_eval.get("overall_icp_score", 0)
                if polish_score > best_score:
                    best_candidate = pol_cleaned
                    best_quality_eval = polish_eval
                    best_raw = polish_raw
                    best_score = polish_score
                    quality_warnings.append(f"final_polish_improved_{best_score:.2f}")

    # v9.5 — use best candidate for final status
    cleaned = best_candidate
    quality_eval = best_quality_eval
    overall_score = best_score
    raw = best_raw

    # v8.9 — graded quality thresholds with distinct reason strings
    if mock_ai_output is None:
        if overall_score >= 4.7:
            status = "updated" if write_enabled else "dry_run_update"
            reason = "ok"
        elif overall_score >= 4.3:
            quality_warnings.append(f"quality_below_accept_threshold_{overall_score}")
            status = "generated_but_weak"
            reason = f"quality_below_accept_threshold; score={overall_score}"
            # Build candidate snapshot for generated_but_weak rows
            candidate_json = json.dumps({
                "quick_verdict": cleaned.get("quick_verdict", ""),
                "editorial_summary": cleaned.get("editorial_summary", ""),
                "best_for": cleaned.get("best_for", []),
                "not_for": cleaned.get("not_for", []),
            }, ensure_ascii=False)
        elif overall_score >= 4.0:
            quality_warnings.append(f"quality_below_retry_threshold_{overall_score}")
            status = "generated_but_weak"
            # v9.0 — 4.0-4.29 defaults to needs_retry even when evaluator_notes=ok
            eval_notes = quality_eval.get("evaluator_notes", "")
            if eval_notes == "ok":
                scores = {}
                for d in SCORE_DRIVER_DIMS:
                    scores[d] = quality_eval.get(d, 0)
                weak_dims = [d for d in SCORE_DRIVER_DIMS if scores[d] <= 3.0]
                if weak_dims:
                    notes_for_eval = [f"{d.replace('_', ' ')}={scores[d]}" for d in weak_dims[:3]]
                    eval_notes = "score_drivers: " + " | ".join(notes_for_eval)
                else:
                    eval_notes = "not_enough_elite_specificity"
            reason = f"quality_below_retry_threshold; score={overall_score}; needs_retry"
            recommended_action = "needs_retry"
            candidate_json = json.dumps({
                "quick_verdict": cleaned.get("quick_verdict", ""),
                "editorial_summary": cleaned.get("editorial_summary", ""),
                "best_for": cleaned.get("best_for", []),
                "not_for": cleaned.get("not_for", []),
            }, ensure_ascii=False)
        else:
            quality_warnings.append(f"quality_below_threshold_{overall_score}")
            eval_notes = quality_eval.get("evaluator_notes", "")
            if "reader_fit_too_generic" not in quality_warnings and eval_notes:
                quality_warnings.append("reader_fit_too_generic")
            status = "rejected"
            reason = f"quality_below_threshold; score={overall_score}"
            candidate_json = json.dumps({
                "quick_verdict": cleaned.get("quick_verdict", ""),
                "editorial_summary": cleaned.get("editorial_summary", ""),
                "best_for": cleaned.get("best_for", []),
                "not_for": cleaned.get("not_for", []),
            }, ensure_ascii=False)
            reject_debug = {"field": "overall", "matched": f"score_{overall_score}", "snippet": f"Quality evaluation returned score {overall_score}. {eval_notes}", "source": "evaluator"}
            rj_row = _make_rejected_row(book, report_flat, reason, candidate_json[:1000], quality_warnings, reject_debug)
            rj_row["reader_fit_specificity"] = quality_eval.get("reader_fit_specificity", "")
            rj_row["dnf_warning_quality"] = quality_eval.get("dnf_warning_quality", "")
            rj_row["emotional_fit_quality"] = quality_eval.get("emotional_fit_quality", "")
            rj_row["pacing_expectation_quality"] = quality_eval.get("pacing_expectation_quality", "")
            rj_row["best_for_specificity"] = quality_eval.get("best_for_specificity", "")
            rj_row["not_for_specificity"] = quality_eval.get("not_for_specificity", "")
            rj_row["generic_ai_safety"] = quality_eval.get("generic_ai_safety", "")
            rj_row["fact_minimal_safety"] = quality_eval.get("fact_minimal_safety", "")
            rj_row["vibe_quality"] = quality_eval.get("vibe_quality", "")
            rj_row["overall_icp_score"] = overall_score
            rj_row["evaluator_notes"] = eval_notes
            rj_row["recommended_action"] = recommended_action
            return rj_row
    else:
        # Fixture/mock mode: keep original status, add scores advisory
        if overall_score < 4.7:
            quality_warnings.append(f"quality_would_be_below_elite_{overall_score}")
        status = "dry_run_update"
        reason = "ok"

    row = {
        "status": status,
        "book_id": clean(book.get("id")),
        "slug": clean(book.get("slug")),
        "title": clean(book.get("title")),
        "author": clean(book.get("author", book.get("author_name", ""))),
        "reason": reason,
        "quick_verdict": cleaned["quick_verdict"],
        "editorial_summary": cleaned["editorial_summary"],
        "best_for": " | ".join(cleaned["best_for"]),
        "not_for": " | ".join(cleaned["not_for"]),
        "theme_tensions": " | ".join(cleaned["theme_tensions"]),
        "key_themes": "|".join(cleaned["key_themes"]),
        "emotional_journey": cleaned["emotional_journey"],
        "reading_pace_profile": cleaned["reading_pace_profile"],
        "vibe_tags": " | ".join(cleaned["vibe_tags"]),
        "difficulty_level": cleaned["difficulty_level"],
        "recommendation_context": cleaned["recommendation_context"],
        "discussion_potential": cleaned["discussion_potential"],
        "comparable_experience": cleaned["comparable_experience"],
        "source_quality_note": cleaned["source_quality_note"],
        **report_flat,
        "write_quality_status": quality_status if write_enabled else "",
        "quality_warnings": " | ".join(quality_warnings),
        # v8.5 — quality evaluator columns
        "reader_fit_specificity": quality_eval.get("reader_fit_specificity", ""),
        "dnf_warning_quality": quality_eval.get("dnf_warning_quality", ""),
        "emotional_fit_quality": quality_eval.get("emotional_fit_quality", ""),
        "pacing_expectation_quality": quality_eval.get("pacing_expectation_quality", ""),
        "best_for_specificity": quality_eval.get("best_for_specificity", ""),
        "not_for_specificity": quality_eval.get("not_for_specificity", ""),
        "generic_ai_safety": quality_eval.get("generic_ai_safety", ""),
        "fact_minimal_safety": quality_eval.get("fact_minimal_safety", ""),
        "vibe_quality": quality_eval.get("vibe_quality", ""),
        "overall_icp_score": quality_eval.get("overall_icp_score", ""),
        "evaluator_notes": quality_eval.get("evaluator_notes", ""),
        "recommended_action": quality_eval.get("recommended_action", ""),
        # v9.2 — candidate snapshot for generated_but_weak/needs_retry rows
        "raw_output": raw[:1000] if mock_ai_output is None else (json.dumps({"quick_verdict": cleaned.get("quick_verdict", ""), "editorial_summary": cleaned.get("editorial_summary", ""), "best_for": cleaned.get("best_for", []), "not_for": cleaned.get("not_for", [])}, ensure_ascii=False)[:1000] if status == "generated_but_weak" or status == "updated" else raw[:1000]),
    }
    return row


def _make_rejected_row(book: Dict[str, Any], report_flat: Dict[str, Any], reason: str, raw: str, quality_warnings: Optional[List[str]] = None, reject_debug: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    debug_matched = (reject_debug or {}).get("matched", "")
    debug_snippet = (reject_debug or {}).get("snippet", "")
    # v8.6 — ensure snippet contains matched text or use fallback
    if debug_matched and debug_matched.lower() not in debug_snippet.lower():
        debug_snippet = f"matched text not found in stored public fields (term: {debug_matched})"

    row = {
        "status": "rejected",
        "reason": reason,
        "book_id": clean(book.get("id")),
        "slug": clean(book.get("slug")),
        "title": clean(book.get("title")),
        "author": clean(book.get("author", book.get("author_name", ""))),
        **report_flat,
        "raw_output": raw[:1000],
        "quality_warnings": " | ".join(quality_warnings or []),
        "reject_debug_field": (reject_debug or {}).get("field", ""),
        "reject_debug_matched_text": debug_matched,
        "reject_debug_snippet": debug_snippet,
        "reject_debug_source": (reject_debug or {}).get("source", "cleaned_output"),
        "reject_debug_attempt": (reject_debug or {}).get("attempt", ""),
        # v8.7 — evaluator columns always in CSV, blank when no candidate
        "reader_fit_specificity": "",
        "dnf_warning_quality": "",
        "emotional_fit_quality": "",
        "pacing_expectation_quality": "",
        "best_for_specificity": "",
        "not_for_specificity": "",
        "generic_ai_safety": "",
        "fact_minimal_safety": "",
        "vibe_quality": "",
        "overall_icp_score": "",
        "evaluator_notes": "",
        "recommended_action": "",
    }
    return row


def sanitize_public_copy(cleaned: Dict[str, Any]) -> Dict[str, Any]:
    """Apply conservative string replacements for low-risk hype phrases. Does not weaken safety checks."""
    replacements = [
        ("the payoff is", "what works best is"),
        ("the main payoff is", "what works best is"),
        ("main payoff", "main value"),
        ("the reading experience is", "it reads as"),
        ("the reading experience feels", "it can feel"),
        ("trade-off", "limitation"),
        ("tradeoff", "limitation"),
        ("you'll walk away", "you may leave"),
        ("you'll come away", "you may leave"),
        ("masterclass", "careful study"),
        ("masterful", "careful"),
        ("grand narrative", "broad narrative"),
        ("iconic", "well-known"),
        ("go-to", "common"),
        ("must-read", "notable"),
        ("page-turner", "engaging"),
        ("sweeping", "broad"),
        ("unforgettable", "memorable"),
        ("landmark", "notable"),
        ("brilliant", "sharp"),
        ("deeply researched", "research-heavy"),
        ("fans of", "readers who liked"),
        ("time-tested", "older"),
        ("definitive", "strongly argued"),
    ]
    for field in ["editorial_summary", "quick_verdict", "discussion_potential", "comparable_experience"]:
        text = cleaned.get(field, "")
        if isinstance(text, str):
            for old, new in replacements:
                pattern = re.compile(re.escape(old), re.IGNORECASE)
                text = pattern.sub(lambda m: _preserve_case(m.group(), new), text)
            cleaned[field] = text
    return cleaned


def _preserve_case(original: str, replacement: str) -> str:
    if original.istitle():
        return replacement.title()
    if original.isupper():
        return replacement.upper()
    return replacement.lower() if original.islower() else replacement


def _run_fixture(args: argparse.Namespace, model: str, write_enabled: bool, mock_ai: bool) -> int:
    fixture_books = load_fixture_books(args.fixture_file)
    print(f"Loaded {len(fixture_books)} fixture books.")
    rows: List[Dict[str, Any]] = []
    for idx, fb in enumerate(fixture_books, 1):
        title = clean(fb.get("title", ""))
        author = clean(fb.get("author", ""))
        print(f"[{idx}/{len(fixture_books)}] {title} — {author}")
        try:
            context = build_fixture_context(fb)
            mock_output = fb.get("mock_ai_output") if mock_ai else None
            row = process_book(
                fb, context,
                provider=args.provider, model=model,
                write_enabled=write_enabled, quality_status=args.quality_status,
                mock_ai_output=mock_output, max_retries=args.max_retries,
                debug_prompt_safety=args.debug_prompt_safety,
            )
            rows.append(row)
        except Exception as exc:
            rows.append({
                "status": "error",
                "reason": str(exc),
                "book_id": clean(fb.get("id", "")),
                "slug": clean(fb.get("slug", "")),
                "title": title,
                "author": author,
            })
    write_report(args.report, rows)
    total = len(fixture_books)
    pass_count = sum(1 for fb in fixture_books if fb.get("expected_status") == "pass")
    fail_count = sum(1 for fb in fixture_books if fb.get("expected_status") == "fail")
    matched, mismatched, errors = check_fixture_expectations(rows, fixture_books)
    print(f"\n[fixture] total rows: {total}")
    print(f"[fixture] expected pass: {pass_count}, expected fail: {fail_count}")
    print(f"[fixture] matched: {matched}, mismatched: {mismatched}")
    if mismatched > 0:
        for err in errors:
            print(f"[fixture] mismatch: {err}")
        return 1
    print("[fixture] All expected outcomes matched.")
    return 0


def _select_failed_book_slugs(report_path: str, debug: bool = False) -> List[str]:
    """Select only failed book slugs/IDs from a report CSV."""
    FAILED_STATUSES = {"rejected", "failed", "error", "json_error", "validation_failed", "empty_response"}
    FAILED_REASON_TOKENS = ["max_retries_exhausted", "retry_failed", "public_recommender_name_leak", "source_overclaim", "unsupported_"]
    SUCCESS_STATUSES = {"dry_run_update", "updated", "ok", "ok_after_retry", "skipped", "skipped_existing"}
    selected = []
    seen: set[str] = set()
    total = 0
    with open(report_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            total += 1
            status = (row.get("status") or "").strip()
            reason = (row.get("reason") or "").strip()
            if status in SUCCESS_STATUSES:
                continue
            is_failed = status in FAILED_STATUSES or any(t in reason.lower() for t in FAILED_REASON_TOKENS)
            if not is_failed:
                continue
            key = (row.get("book_id") or row.get("slug") or "").strip()
            if not key or key in seen:
                continue
            seen.add(key)
            selected.append(key)
            if debug:
                title = row.get("title", "") or ""
                print(f"[failed-only] selected: {title} | status={status} | reason={reason}")
    print(f"[failed-only] selected {len(selected)} failed rows from {total} report rows")
    return selected


def _select_books_by_actions(report_path: str, actions_str: str, debug: bool = False) -> List[str]:
    """Select books from a report CSV whose recommended_action matches the action list."""
    target_actions = set(a.strip().lower() for a in actions_str.split(",") if a.strip())
    selected: List[str] = []
    seen: set[str] = set()
    total = 0
    with open(report_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            total += 1
            action = (row.get("recommended_action") or "").strip().lower()
            status = (row.get("status") or "").strip()
            # Match by action column; also match generated_but_weak rows with blank action 
            # when target includes needs_retry or keep_pending
            matches = action in target_actions
            if not matches and status == "generated_but_weak":
                inferred_action = (row.get("recommended_action") or "").strip().lower()
                if not inferred_action and ("needs_retry" in target_actions or "keep_pending" in target_actions):
                    matches = True
            if not matches:
                continue
            key = (row.get("book_id") or row.get("slug") or "").strip()
            if not key or key in seen:
                continue
            seen.add(key)
            selected.append(key)
            if debug:
                title = row.get("title", "") or ""
                print(f"[actions-only] selected: {title} | action={action} | status={status}")
    print(f"[actions-only] selected {len(selected)} rows by action(s) '{actions_str}' from {total} report rows")
    return selected


def _fetch_books_by_slugs(slugs: List[str], fetch_retries: int = 3) -> List[Dict[str, Any]]:
    """Fetch books by slug or ID from Supabase."""
    validate_supabase_env()
    url, _ = supabase_base()
    results = []
    for slug in slugs:
        params = {
            "select": "id,slug,title,author_name,description,recommendation_count,editorial_summary,ai_quality_status",
            "or": f"(id.eq.{urllib.parse.quote(slug)},slug.eq.{urllib.parse.quote(slug)})",
            "limit": "1",
        }
        full_url = f"{url}/rest/v1/books?" + urllib.parse.urlencode(params)
        try:
            rows = supabase_fetch(full_url, headers=supabase_headers(), max_attempts=fetch_retries) or []
        except Exception as exc:
            if _is_network_error(exc):
                print(f"[error] Supabase fetch failed after {fetch_retries} attempts: {_short_error(exc)}")
                raise SystemExit(1) from exc
            raise
        if rows:
            results.append(rows[0])
    return results


def _run_live(args: argparse.Namespace, model: str, write_enabled: bool) -> int:
    if args.only_actions_from_report:
        if ":" not in args.only_actions_from_report:
            raise SystemExit("--only-actions-from-report requires REPORT.csv:action1,action2 format (e.g. report.csv:needs_retry,keep_pending)")
        report_path, actions_str = args.only_actions_from_report.split(":", 1)
        slugs = _select_books_by_actions(report_path, actions_str, debug=args.debug_failed_only_selection)
        if not slugs:
            raise SystemExit("No rows found in report for those actions.")
        books = _fetch_books_by_slugs(slugs, fetch_retries=args.supabase_fetch_retries)
    elif args.only_failed_from_report:
        failed_slugs = _select_failed_book_slugs(args.only_failed_from_report, debug=args.debug_failed_only_selection)
        if not failed_slugs:
            raise SystemExit("No failed rows found in report.")
        books = _fetch_books_by_slugs(failed_slugs, fetch_retries=args.supabase_fetch_retries)
    elif args.book_ids_file:
        with open(args.book_ids_file, "r", encoding="utf-8") as f:
            slugs = [line.strip() for line in f if line.strip()]
        books = _fetch_books_by_slugs(slugs, fetch_retries=args.supabase_fetch_retries)
    else:
        books = fetch_books(args.limit, args.offset, only_missing=not args.include_existing, fetch_retries=args.supabase_fetch_retries)
    total = len(books)
    print(f"Fetched {total} books for editorial enrichment.")

    if args.concurrency > 1 and total > 0:
        get_list_cache()
        get_series_cache()

    concurrency = max(1, min(args.concurrency, total)) if total > 0 else 1

    if concurrency == 1:
        return _run_live_sequential(args, model, write_enabled, books)
    return _run_live_parallel(args, model, write_enabled, books, concurrency)


def _run_live_sequential(args: argparse.Namespace, model: str, write_enabled: bool, books: List[Dict[str, Any]]) -> int:
    total = len(books)
    rows: List[Dict[str, Any]] = []
    generated = failed = 0
    checkpoint = max(1, args.checkpoint_every)

    for idx, book in enumerate(books, 1):
        title = clean(book.get("title"))
        author = clean(book.get("author_name"))
        print(f"[{idx}/{total}] {title} — {author}")
        try:
            context = build_context(book)
            row = process_book(book, context, provider=args.provider, model=model, write_enabled=write_enabled, quality_status=args.quality_status, max_retries=args.max_retries)
            rows.append(row)
            if row["status"] in ("dry_run_update", "updated"):
                generated += 1
                if write_enabled:
                    _write_book_update(book, row, args.quality_status)
            else:
                failed += 1
        except Exception as exc:
            failed += 1
            rows.append({
                "status": "error",
                "reason": str(exc),
                "book_id": book.get("id"),
                "slug": book.get("slug"),
                "title": title,
                "author": author,
            })
        if not write_enabled and idx % checkpoint == 0 and idx < total:
            _write_checkpoint(args.report, rows, total)

    return _finish_live_run(args, rows, total, generated, failed, model, write_enabled)


def _process_book_task(book: Dict[str, Any], provider: str, model: str, write_enabled: bool, quality_status: str, max_retries: int) -> Tuple[int, Dict[str, Any]]:
    idx = book["_idx"]
    title = clean(book.get("title"))
    try:
        context = build_context(book)
        row = process_book(book, context, provider=provider, model=model, write_enabled=write_enabled, quality_status=quality_status, max_retries=max_retries)
        return idx, row
    except Exception as exc:
        return idx, {
            "status": "error",
            "reason": str(exc),
            "book_id": book.get("id"),
            "slug": book.get("slug"),
            "title": title,
            "author": clean(book.get("author_name", "")),
        }


def _run_live_parallel(args: argparse.Namespace, model: str, write_enabled: bool, books: List[Dict[str, Any]], concurrency: int) -> int:
    total = len(books)
    indexed_results: Dict[int, Dict[str, Any]] = {}
    checkpoint = max(1, args.checkpoint_every)

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {}
        for i, book in enumerate(books):
            book["_idx"] = i
            futures[executor.submit(_process_book_task, book, args.provider, model, write_enabled, args.quality_status, args.max_retries)] = i

        completed = 0
        for future in as_completed(futures):
            idx, row = future.result()
            indexed_results[idx] = row
            completed += 1
            title = row.get("title", "")
            status = row.get("status", "error")
            print(f"[done {idx+1}/{total}] {title} — {status}")
            if not write_enabled and completed % checkpoint == 0 and completed < total:
                ordered = [indexed_results[i] for i in sorted(indexed_results.keys())]
                _write_checkpoint(args.report, ordered, total)

    rows = [indexed_results[i] for i in range(total)]
    generated = sum(1 for r in rows if r["status"] in ("dry_run_update", "updated"))
    failed = sum(1 for r in rows if r["status"] not in ("dry_run_update", "updated"))

    return _finish_live_run(args, rows, total, generated, failed, model, write_enabled)


def _write_checkpoint(path: str, rows: List[Dict[str, Any]], total: int) -> None:
    """Write partial checkpoint CSV."""
    write_report(path, rows)
    print(f"[checkpoint] {len(rows)}/{total} rows written to {path}")


def _finish_live_run(args: argparse.Namespace, rows: List[Dict[str, Any]], total: int, generated: int, failed: int, model: str, write_enabled: bool) -> int:
    write_report(args.report, rows)
    print(json.dumps({
        "processed": total,
        "generated": generated,
        "failed": failed,
        "write_enabled": write_enabled,
        "provider": args.provider,
        "model": model,
        "quality_status": args.quality_status if write_enabled else "",
        "report": args.report,
    }, indent=2))
    return 0


def _write_book_update(book: Dict[str, Any], row: Dict[str, Any], quality_status: str) -> None:
    cleaned_data = {
        "editorial_summary": clean(row.get("editorial_summary", "")),
        "best_for": row.get("best_for", ""),
        "not_for": row.get("not_for", ""),
        "key_themes": (row.get("key_themes", "") or "").split("|"),
        "difficulty_level": row.get("difficulty_level", "unknown"),
        "recommendation_context": clean(row.get("recommendation_context", "")),
        "source_quality_note": clean(row.get("source_quality_note", "")),
    }
    update_book(book["id"], cleaned_data, status=quality_status)


def _run_audit(args: argparse.Namespace) -> int:
    """Audit current DB AI fields against a previous report CSV."""
    try:
        url, key = supabase_base()
    except SystemExit:
        print("[audit] Supabase credentials not available. Cannot run audit.")
        return 1
    report_path = args.audit_ai_fields_from_report
    try:
        with open(report_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            report_rows = list(reader)
    except Exception as exc:
        print(f"[audit] Could not read report: {exc}")
        return 1
    audit_rows = []
    for rr in report_rows:
        book_id = rr.get("book_id", "") or rr.get("id", "")
        slug = rr.get("slug", "")
        title = rr.get("title", "")
        if not book_id and slug:
            params = {"select": "id,slug,title,editorial_summary,best_for,not_for,key_themes,difficulty_level,recommendation_context,source_quality_note,ai_generated_at,ai_quality_status", "slug": f"eq.{slug}", "limit": "1"}
            rows = safe_get("books", params)
            book_id = rows[0]["id"] if rows else ""
        if not book_id:
            audit_rows.append({
                "book_id": "", "slug": slug, "title": title,
                "current_ai_quality_status": "not_found", "current_ai_generated_at": "",
                "has_editorial_summary": "false", "restore_risk": "no_ai_content_found", "reason": "book not found in DB",
            })
            continue
        params = {"select": "id,slug,title,editorial_summary,best_for,not_for,key_themes,difficulty_level,recommendation_context,source_quality_note,ai_generated_at,ai_quality_status", "id": f"eq.{book_id}", "limit": "1"}
        rows = safe_get("books", params)
        if not rows:
            audit_rows.append({"book_id": book_id, "slug": slug, "title": title, "restore_risk": "no_ai_content_found", "reason": "book not accessible"})
            continue
        b = rows[0]
        status = b.get("ai_quality_status", "") or ""
        has_es = "true" if (b.get("editorial_summary") or "").strip() else "false"
        has_any = has_es == "true" or any((b.get(f) or "").strip() for f in ["best_for", "not_for", "recommendation_context", "source_quality_note"])
        risk = "no_ai_content_found"
        reason = ""
        if status == "approved":
            risk = "skip_approved"
            reason = "ai_quality_status is approved"
        elif status in ("needs_review", "draft"):
            risk = "needs_manual_review"
            reason = f"ai_quality_status is {status}, likely AI-generated"
        elif status == "pending" and has_any:
            risk = "needs_manual_review"
            reason = "pending status but AI fields present"
        elif status == "pending" and not has_any:
            risk = "safe_to_clear"
            reason = "pending status, no AI content"
        elif has_any:
            risk = "needs_manual_review"
            reason = "AI fields present, manual review required"
        else:
            risk = "safe_to_clear"
            reason = "no AI content present"
        audit_rows.append({
            "book_id": b.get("id", ""), "slug": b.get("slug", ""), "title": b.get("title", ""),
            "current_ai_quality_status": status,
            "current_ai_generated_at": b.get("ai_generated_at", "") or "",
            "has_editorial_summary": has_es, "has_best_for": "true" if (b.get("best_for") or "").strip() else "false",
            "has_not_for": "true" if (b.get("not_for") or "").strip() else "false",
            "has_key_themes": "true" if (b.get("key_themes") or []) else "false",
            "has_difficulty_level": "true" if (b.get("difficulty_level") or "").strip() else "false",
            "has_recommendation_context": "true" if (b.get("recommendation_context") or "").strip() else "false",
            "has_source_quality_note": "true" if (b.get("source_quality_note") or "").strip() else "false",
            "likely_written_by_ai_script": "true" if has_any else "false",
            "restore_risk": risk, "reason": reason,
        })
    audit_path = args.report if args.report else "audit_ai_fields.csv"
    write_report(audit_path, audit_rows)
    print(f"[audit] Audit complete. {len(audit_rows)} rows written to {audit_path}")
    return 0


def _run_backup(args: argparse.Namespace) -> int:
    """Backup current DB AI fields for rows in a report CSV."""
    try:
        url, key = supabase_base()
    except SystemExit:
        print("[backup] Supabase credentials not available. Cannot run backup.")
        return 1
    report_path = args.backup_ai_fields_from_report
    try:
        with open(report_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            report_rows = list(reader)
    except Exception as exc:
        print(f"[backup] Could not read report: {exc}")
        return 1
    backup_rows = []
    for rr in report_rows:
        book_id = rr.get("book_id", "") or rr.get("id", "")
        slug = rr.get("slug", "")
        title = rr.get("title", "")
        if not book_id and slug:
            params = {"select": "id,slug,title,editorial_summary,best_for,not_for,key_themes,difficulty_level,recommendation_context,source_quality_note,ai_generated_at,ai_quality_status", "slug": f"eq.{slug}", "limit": "1"}
            rows = safe_get("books", params)
            book_id = rows[0]["id"] if rows else ""
        if not book_id:
            backup_rows.append({"book_id": "", "slug": slug, "title": title, "status": "not_found"})
            continue
        params = {"select": "id,slug,title,editorial_summary,best_for,not_for,key_themes,difficulty_level,recommendation_context,source_quality_note,ai_generated_at,ai_quality_status", "id": f"eq.{book_id}", "limit": "1"}
        rows = safe_get("books", params)
        if not rows:
            backup_rows.append({"book_id": book_id, "slug": slug, "title": title, "status": "inaccessible"})
            continue
        b = rows[0]
        backup_rows.append({
            "book_id": b.get("id", ""), "slug": b.get("slug", ""), "title": b.get("title", ""),
            "editorial_summary": b.get("editorial_summary", "") or "",
            "best_for": b.get("best_for", "") or "",
            "not_for": b.get("not_for", "") or "",
            "key_themes": " | ".join(b.get("key_themes") or []),
            "difficulty_level": b.get("difficulty_level", "") or "",
            "recommendation_context": b.get("recommendation_context", "") or "",
            "source_quality_note": b.get("source_quality_note", "") or "",
            "ai_generated_at": b.get("ai_generated_at", "") or "",
            "ai_quality_status": b.get("ai_quality_status", "") or "",
        })
    backup_path = args.report if args.report else "ai_fields_backup.csv"
    write_report(backup_path, backup_rows)
    print(f"[backup] {len(backup_rows)} rows backed up to {backup_path}")
    return 0


def _run_restore_needs_review(args: argparse.Namespace) -> int:
    """Restore/clear AI fields for needs_review rows from a report. Requires backup + confirm."""
    report_path = args.restore_needs_review_ai_fields_from_report
    confirmed = bool(args.confirm_restore_ai_fields)
    backup_file = args.restore_backup_file
    if not confirmed:
        print("Restore preview only. Re-run with --confirm-restore-ai-fields --restore-backup-file PATH to apply.")
    if confirmed and not backup_file:
        raise SystemExit("--confirm-restore-ai-fields requires --restore-backup-file PATH")
    try:
        with open(report_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            report_rows = list(reader)
    except Exception as exc:
        print(f"[restore] Could not read report: {exc}")
        return 1
    # Preview mode: build rows from CSV only, no Supabase
    if not confirmed:
        restore_rows = _build_restore_preview_rows(report_rows)
        output_path = args.report if args.report else "restore_preview.csv"
        write_report(output_path, restore_rows)
        would = sum(1 for r in restore_rows if r["action"] == "would_clear")
        print(f"[restore preview] {len(restore_rows)} rows written to {output_path}, {would} would be cleared")
        return 0
    # Confirmed mode: hit Supabase
    try:
        url, key = supabase_base()
    except SystemExit:
        print("[restore] Supabase credentials not available.")
        return 1
    import pathlib
    if not pathlib.Path(backup_file).exists():
        raise SystemExit(f"Backup file not found: {backup_file}")
    AI_SELECT = "id,slug,title,editorial_summary,best_for,not_for,key_themes,difficulty_level,recommendation_context,source_quality_note,ai_generated_at,ai_quality_status"
    restore_rows = []
    for rr in report_rows:
        book_id = rr.get("book_id", "") or rr.get("id", "")
        slug = rr.get("slug", "")
        title = rr.get("title", "")
        if not book_id and slug:
            params = {"select": AI_SELECT, "slug": f"eq.{slug}", "limit": "1"}
            rows = safe_get("books", params)
            book_id = rows[0]["id"] if rows else ""
        if not book_id:
            restore_rows.append({"book_id": "", "slug": slug, "title": title, "action": "skipped_no_ai_fields", "previous_ai_quality_status": "", "previous_ai_generated_at": "", "had_ai_fields": "false", "reason": "not found"})
            continue
        params = {"select": AI_SELECT, "id": f"eq.{book_id}", "limit": "1"}
        rows = safe_get("books", params)
        if not rows:
            restore_rows.append({"book_id": book_id, "slug": slug, "title": title, "action": "skipped_no_ai_fields", "previous_ai_quality_status": "", "previous_ai_generated_at": "", "had_ai_fields": "false", "reason": "inaccessible"})
            continue
        b = rows[0]
        status = b.get("ai_quality_status", "") or ""
        has_any = bool((b.get("editorial_summary") or "").strip()) or any(
            (b.get(f) or "").strip() for f in ["best_for", "not_for", "recommendation_context", "source_quality_note"])
        prev_status = status
        prev_at = b.get("ai_generated_at", "") or ""
        if status == "approved":
            restore_rows.append({"book_id": book_id, "slug": slug, "title": title, "action": "skipped_approved", "previous_ai_quality_status": prev_status, "previous_ai_generated_at": prev_at, "had_ai_fields": "true" if has_any else "false", "reason": "approved status"})
            continue
        if not has_any:
            restore_rows.append({"book_id": book_id, "slug": slug, "title": title, "action": "skipped_no_ai_fields", "previous_ai_quality_status": prev_status, "previous_ai_generated_at": prev_at, "had_ai_fields": "false", "reason": "no AI fields"})
            continue
        if status not in ("needs_review", "pending", "draft"):
            restore_rows.append({"book_id": book_id, "slug": slug, "title": title, "action": "skipped_needs_manual_review", "previous_ai_quality_status": prev_status, "previous_ai_generated_at": prev_at, "had_ai_fields": "true" if has_any else "false", "reason": f"unexpected status: {status}"})
            continue
        payload = {"editorial_summary": None, "best_for": None, "not_for": None, "key_themes": None, "difficulty_level": None, "recommendation_context": None, "source_quality_note": None, "ai_generated_at": None, "ai_quality_status": "pending"}
        req_url = f"{url}/rest/v1/books?id=eq.{urllib.parse.quote(book_id)}"
        try:
            http_json(req_url, method="PATCH", payload=payload, headers=supabase_headers("return=minimal"), timeout=30)
            restore_rows.append({"book_id": book_id, "slug": slug, "title": title, "action": "cleared", "previous_ai_quality_status": prev_status, "previous_ai_generated_at": prev_at, "had_ai_fields": "true", "reason": ""})
        except Exception as exc:
            restore_rows.append({"book_id": book_id, "slug": slug, "title": title, "action": "skipped_needs_manual_review", "previous_ai_quality_status": prev_status, "previous_ai_generated_at": prev_at, "had_ai_fields": "true", "reason": str(exc)[:100]})
    output_path = args.report if args.report else "restore_report.csv"
    write_report(output_path, restore_rows)
    cleared = sum(1 for r in restore_rows if r["action"] == "cleared")
    print(f"[restore] Applied. {len(restore_rows)} rows, {cleared} cleared. Wrote: {output_path}")
    return 0


def _build_restore_preview_rows(report_rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Build restore preview rows from audit CSV without hitting Supabase."""
    result = []
    for rr in report_rows:
        book_id = rr.get("book_id", "") or rr.get("id", "")
        slug = rr.get("slug", "")
        title = rr.get("title", "")
        status = rr.get("current_ai_quality_status", "") or rr.get("ai_quality_status", "") or ""
        has_any = rr.get("has_editorial_summary", "") == "true" or rr.get("likely_written_by_ai_script", "") == "true"
        prev_at = rr.get("current_ai_generated_at", "") or rr.get("ai_generated_at", "") or ""
        if not book_id:
            result.append({"book_id": "", "slug": slug, "title": title, "action": "skipped_no_ai_fields", "previous_ai_quality_status": status, "previous_ai_generated_at": prev_at, "had_ai_fields": "false", "reason": "no book_id"})
        elif status == "approved":
            result.append({"book_id": book_id, "slug": slug, "title": title, "action": "skipped_approved", "previous_ai_quality_status": status, "previous_ai_generated_at": prev_at, "had_ai_fields": "true" if has_any else "false", "reason": "approved"})
        elif not has_any:
            result.append({"book_id": book_id, "slug": slug, "title": title, "action": "skipped_no_ai_fields", "previous_ai_quality_status": status, "previous_ai_generated_at": prev_at, "had_ai_fields": "false", "reason": "no AI fields"})
        elif status in ("needs_review", "pending", "draft"):
            result.append({"book_id": book_id, "slug": slug, "title": title, "action": "would_clear", "previous_ai_quality_status": status, "previous_ai_generated_at": prev_at, "had_ai_fields": "true", "reason": f"{status} with AI fields"})
        else:
            result.append({"book_id": book_id, "slug": slug, "title": title, "action": "skipped_needs_manual_review", "previous_ai_quality_status": status, "previous_ai_generated_at": prev_at, "had_ai_fields": "true" if has_any else "false", "reason": f"ambiguous: {status}"})
    return result


def _run_restore_from_report(report_path: str, confirmed: bool) -> int:
    if not confirmed:
        print("Restore preview only. Re-run with --confirm-restore-ai-fields --restore-backup-file PATH to apply.")
        return 0
    try:
        url, key = supabase_base()
    except SystemExit:
        print("[restore] Supabase credentials not available. Cannot run restore.")
        return 1
    try:
        with open(report_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            report_rows = list(reader)
    except Exception as exc:
        print(f"[restore] Could not read report: {exc}")
        return 1
    headers = supabase_headers("return=minimal")
    restore_rows = []
    for rr in report_rows:
        book_id = rr.get("book_id", "") or rr.get("id", "")
        if not book_id:
            restore_rows.append({"book_id": "", "action": "skipped", "skip_reason": "no book_id"})
            continue
        params = {"select": "ai_quality_status", "id": f"eq.{book_id}", "limit": "1"}
        rows = safe_get("books", params)
        if not rows or rows[0].get("ai_quality_status") == "approved":
            restore_rows.append({"book_id": book_id, "action": "skipped", "skip_reason": "approved or not found", "previous_ai_quality_status": rows[0].get("ai_quality_status", "") if rows else "", "previous_ai_generated_at": ""})
            continue
        payload = {
            "editorial_summary": None, "best_for": None, "not_for": None, "key_themes": None,
            "difficulty_level": None, "recommendation_context": None, "source_quality_note": None,
            "ai_generated_at": None, "ai_quality_status": "pending",
        }
        req_url = f"{url}/rest/v1/books?id=eq.{urllib.parse.quote(book_id)}"
        try:
            http_json(req_url, method="PATCH", payload=payload, headers=headers, timeout=30)
            restore_rows.append({"book_id": book_id, "action": "restored", "skip_reason": "", "previous_ai_quality_status": rows[0].get("ai_quality_status", ""), "previous_ai_generated_at": ""})
        except Exception as exc:
            restore_rows.append({"book_id": book_id, "action": "skipped", "skip_reason": str(exc)[:100], "previous_ai_quality_status": rows[0].get("ai_quality_status", "") if rows else ""})
    restore_path = "restore_report.csv"
    write_report(restore_path, restore_rows)
    print(f"[restore] {len(restore_rows)} rows processed. Report: {restore_path}")
    return 0


def _run_restore_from_backup(backup_path: str, confirmed: bool) -> int:
    if not confirmed:
        print("Restore preview only. Re-run with --confirm-restore-ai-fields --restore-backup-file PATH to apply.")
        return 0
    try:
        url, key = supabase_base()
    except SystemExit:
        print("[restore] Supabase credentials not available. Cannot run restore.")
        return 1
    return 0  # Placeholder — full backup restore needs more logic


# ═══════════════════════════════════════════════════
# v8.6 — Report Analysis & Learning Pack Tooling
# ═══════════════════════════════════════════════════

def _read_report_rows(path: str) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows


def _safe_float(val: str, default: float = 0.0) -> float:
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def _run_analyze_report(report_path: str, learning_pack_dir: str) -> int:
    import collections, statistics, pathlib

    if not pathlib.Path(report_path).exists():
        print(f"[analyze] Report not found: {report_path}")
        return 1

    rows = _read_report_rows(report_path)
    if not rows:
        print("[analyze] Report is empty.")
        return 1

    total = len(rows)
    status_counts: Dict[str, int] = collections.Counter()
    reason_counts: Dict[str, int] = collections.Counter()
    action_counts: Dict[str, int] = collections.Counter()
    warning_counts: Dict[str, int] = collections.Counter()
    matched_text_counts: Dict[str, int] = collections.Counter()
    scores: List[float] = []
    recovered_from_reason_total = 0
    eval_dim_scores: Dict[str, List[float]] = {}
    context_list_names: Dict[str, int] = collections.Counter()

    QUALITY_DIMS = [
        "reader_fit_specificity", "dnf_warning_quality", "emotional_fit_quality",
        "pacing_expectation_quality", "best_for_specificity", "not_for_specificity",
        "generic_ai_safety", "fact_minimal_safety", "vibe_quality",
    ]

    for row in rows:
        status = (row.get("status") or "").strip()
        reason = (row.get("reason") or "").strip()
        action = (row.get("recommended_action") or "").strip()
        score_str = (row.get("overall_icp_score") or "").strip()
        matched = (row.get("reject_debug_matched_text") or "").strip()
        lists_str = (row.get("context_list_names") or "").strip()

        status_counts[status or "unknown"] += 1
        if reason:
            # Shorten long reasons
            short_reason = reason[:80]
            reason_counts[short_reason] += 1
        if action:
            action_counts[action] += 1

        # Warnings
        warnings_str = (row.get("quality_warnings") or "").strip()
        for w in warnings_str.split("|"):
            w = w.strip()
            if w:
                warning_counts[w] += 1

        # Matched text
        if matched:
            matched_text_counts[matched] += 1

        # Scores
        recovered_from_reason = 0
        if score_str:
            s = _safe_float(score_str, -1)
            if s >= 0:
                scores.append(s)
        else:
            # v8.7 — recover score from quality_below_threshold reason
            if reason and "quality_below_threshold; score=" in reason:
                try:
                    score_part = reason.split("score=")[-1].split(";")[0].strip()
                    s = float(score_part)
                    scores.append(s)
                    recovered_from_reason += 1
                except (ValueError, IndexError):
                    pass

        # Dimension scores — on non-rejected rows AND quality-rejected rows that have them
        if status not in ("rejected", "error", "") or "quality_below_threshold" in reason.lower():
            for dim in QUALITY_DIMS:
                dv = _safe_float(row.get(dim, ""), -1)
                if dv >= 0:
                    if dim not in eval_dim_scores:
                        eval_dim_scores[dim] = []
                    eval_dim_scores[dim].append(dv)

        # Context lists
        for ln in lists_str.split("|"):
            ln = ln.strip()
            if ln and len(ln) > 1:
                context_list_names[ln] += 1

    # --- Print Summary ---
    print("=" * 60)
    print("  REPORT ANALYSIS")
    print("=" * 60)
    print(f"\n  total rows: {total}")
    print(f"\n  STATUS COUNTS:")
    for s, c in sorted(status_counts.items(), key=lambda x: -x[1]):
        print(f"    {s:25s} {c:4d}")

    print(f"\n  TOP REJECT REASONS:")
    for r, c in sorted(reason_counts.items(), key=lambda x: -x[1])[:15]:
        print(f"    {r[:65]:65s} {c:4d}")

    if action_counts:
        print(f"\n  RECOMMENDED ACTIONS:")
        for a, c in sorted(action_counts.items(), key=lambda x: -x[1]):
            print(f"    {a:25s} {c:4d}")

    if warning_counts:
        print(f"\n  TOP WARNINGS:")
        for w, c in sorted(warning_counts.items(), key=lambda x: -x[1])[:15]:
            print(f"    {w[:60]:60s} {c:4d}")

    # v8.6-fix — initialize buckets unconditionally to avoid crash on old reports without scores
    buckets = {"4.8+": 0, "4.7-4.79": 0, "4.3-4.69": 0, "4.0-4.29": 0, "<4.0": 0, "missing": 0}
    missing_score_count = total

    if scores:
        if recovered_from_reason_total > 0:
            print(f"    recovered_from_reason: {recovered_from_reason_total} score(s) recovered from quality_below_threshold reason")
        avg_score = statistics.mean(scores)
        print(f"\n  SCORES (n={len(scores)}):")
        print(f"    average:  {avg_score:.2f}")
        print(f"    median:   {statistics.median(scores):.2f}")
        print(f"    min/max:  {min(scores):.2f} / {max(scores):.2f}")

        # Distribution buckets
        missing_score_count = total - len(scores)
        buckets["missing"] = missing_score_count
        for s in scores:
            if s >= 4.8:
                buckets["4.8+"] += 1
            elif s >= 4.7:
                buckets["4.7-4.79"] += 1
            elif s >= 4.3:
                buckets["4.3-4.69"] += 1
            elif s >= 4.0:
                buckets["4.0-4.29"] += 1
            else:
                buckets["<4.0"] += 1
    else:
        buckets["missing"] = total
        print(f"\n  SCORES: none available in this report")

    if scores:
        print(f"    distribution:")
        for bucket, count in buckets.items():
            bar = "█" * max(1, count) if count > 0 else "·"
            print(f"      {bucket:12s} {count:4d} {bar}")

    if eval_dim_scores:
        print(f"\n  DIMENSION AVERAGES (non-rejected rows):")
        for dim in QUALITY_DIMS:
            if dim in eval_dim_scores and eval_dim_scores[dim]:
                d_avg = statistics.mean(eval_dim_scores[dim])
                d_label = dim.replace("_", " ")[:35]
                print(f"      {d_label:35s} {d_avg:.2f}")

    if matched_text_counts:
        print(f"\n  TOP MATCHED TEXT (reject_debug_matched_text):")
        for m, c in sorted(matched_text_counts.items(), key=lambda x: -x[1])[:15]:
            print(f"    {m[:55]:55s} {c:4d}")

    if context_list_names:
        print(f"\n  TOP CATEGORIES (context_list_names):")
        for ln, c in sorted(context_list_names.items(), key=lambda x: -x[1])[:10]:
            print(f"    {ln[:40]:40s} {c:4d}")

    # --- Learning pack ---
    if learning_pack_dir:
        out_dir = pathlib.Path(learning_pack_dir)
        out_dir.mkdir(parents=True, exist_ok=True)

        # run_summary.json
        run_summary = {
            "total_rows": total,
            "status_counts": dict(status_counts),
            "top_reasons": dict(sorted(reason_counts.items(), key=lambda x: -x[1])[:20]),
            "action_counts": dict(action_counts),
            "top_warnings": dict(sorted(warning_counts.items(), key=lambda x: -x[1])[:20]),
            "average_score": statistics.mean(scores) if scores else None,
            "missing_score_count": missing_score_count,
            "score_distribution": buckets,
        }
        with open(out_dir / "run_summary.json", "w", encoding="utf-8") as f:
            json.dump(run_summary, f, indent=2)
        print(f"\n[lpack] wrote run_summary.json")

        # failure_clusters.json
        failure_rows = [r for r in rows if (r.get("status") or "").strip() in ("rejected", "error", "generated_but_weak")]
        failure_clusters = []
        for r in failure_rows:
            failure_clusters.append({
                "book_id": r.get("book_id", ""),
                "title": r.get("title", ""),
                "reason": (r.get("reason") or "")[:120],
                "status": (r.get("status") or ""),
                "reject_debug_field": r.get("reject_debug_field", ""),
                "reject_debug_matched_text": r.get("reject_debug_matched_text", ""),
                "reject_debug_snippet": (r.get("reject_debug_snippet") or "")[:200],
                "list_context": (r.get("context_list_names") or ""),
            })
        with open(out_dir / "failure_clusters.json", "w", encoding="utf-8") as f:
            json.dump(failure_clusters, f, indent=2)
        print(f"[lpack] wrote failure_clusters.json ({len(failure_clusters)} failures)")

        # quality_distribution.json
        quality_dist = {dim: (statistics.mean(vals) if vals else None) for dim, vals in eval_dim_scores.items()}
        quality_dist["score_distribution"] = buckets
        with open(out_dir / "quality_distribution.json", "w", encoding="utf-8") as f:
            json.dump(quality_dist, f, indent=2)
        print(f"[lpack] wrote quality_distribution.json")

        # v8.7 — rejected_candidates.jsonl for auditability
        with open(out_dir / "rejected_candidates.jsonl", "w", encoding="utf-8") as jl:
            for r in rows:
                if (r.get("status") or "").strip() not in ("rejected", "generated_but_weak"):
                    continue
                raw_str = (r.get("raw_output") or "").strip()
                clean_dict = {}
                if raw_str and raw_str.startswith("{"):
                    try:
                        clean_dict = json.loads(raw_str)
                    except json.JSONDecodeError:
                        clean_dict = {"raw": raw_str[:500]}
                scores_dict = {}
                for dim in QUALITY_DIMS:
                    scores_dict[dim] = r.get(dim, "")
                record = {
                    "title": r.get("title", ""),
                    "slug": r.get("slug", ""),
                    "status": r.get("status", ""),
                    "reason": (r.get("reason") or "")[:120],
                    "raw_candidate_output": raw_str[:2000],
                    "sanitized_candidate_output": clean_dict,
                    "evaluator_scores": scores_dict,
                    "evaluator_notes": r.get("evaluator_notes", ""),
                    "reject_debug": {
                        "field": r.get("reject_debug_field", ""),
                        "matched_text": r.get("reject_debug_matched_text", ""),
                        "snippet": (r.get("reject_debug_snippet") or "")[:300],
                        "source": r.get("reject_debug_source", ""),
                        "attempt": r.get("reject_debug_attempt", ""),
                    },
                }
                jl.write(json.dumps(record, ensure_ascii=False) + "\n")
        print(f"[lpack] wrote rejected_candidates.jsonl")

        # warning_clusters.json
        warning_clusters = dict(sorted(warning_counts.items(), key=lambda x: -x[1]))
        with open(out_dir / "warning_clusters.json", "w", encoding="utf-8") as f:
            json.dump(warning_clusters, f, indent=2)
        print(f"[lpack] wrote warning_clusters.json")

        # false_positive_candidates.md
        fp_candidates = []
        for r in rows:
            raw_output = (r.get("raw_output") or "").strip()
            status = (r.get("status") or "").strip()
            reason = (r.get("reason") or "")
            snippet = (r.get("reject_debug_snippet") or "")[:200]
            # Include generated_but_weak and rejected rows with plausible output
            if raw_output and status in ("rejected", "generated_but_weak"):
                if "publisher_hype" in reason.lower() or "generic" in reason.lower():
                    fp_candidates.append(
                        f"### {r.get('title', 'unknown')}\n"
                        f"- reason: {reason[:100]}\n"
                        f"- snippet: {snippet}\n"
                        f"- raw: {raw_output[:300]}\n"
                    )
            # v9.2 — negated format claims as likely false positive
            if "unsupported_format_claim" in reason.lower():
                rl = reason.lower()
                snippet_lower = snippet.lower()
                if any(p in snippet_lower for p in ["want hands-on", "not a workbook", "if you want exercises", "this stays in explanation mode", "want exercises", "not a practical"]):
                    fp_candidates.append(
                        f"### {r.get('title', 'unknown')} — negated format claim\n"
                        f"- reason: {reason[:100]}\n"
                        f"- snippet: {snippet}\n"
                        f"- classification: likely false positive — negated/mismatch format language should not hard reject\n"
                    )
        fp_md = "# False Positive Candidates\n\nRows that may be incorrectly rejected (style not trust, or negated format claims).\n\n"
        fp_md += "\n".join(fp_candidates) if fp_candidates else "No clear false positive candidates found.\n"
        with open(out_dir / "false_positive_candidates.md", "w", encoding="utf-8") as f:
            f.write(fp_md)
        print(f"[lpack] wrote false_positive_candidates.md")

        # validator_patch_suggestions.md
        vp_lines = ["# Validator Patch Suggestions\n", "Evidence only. Do not auto-apply.\n\n"]
        vp_lines.append("## Classification Categories\n\n")
        vp_lines.append("- **likely false positive**: validator rejecting safe content\n")
        vp_lines.append("- **real trust failure**: correct rejection of unsafe content\n")
        vp_lines.append("- **evaluator calibration issue**: score doesn't match visible quality\n")
        vp_lines.append("- **prompt quality issue**: output quality problem, not validator problem\n")
        vp_lines.append("- **report/auditability issue**: debug or CSV column data missing\n\n")
        top_reasons = sorted(reason_counts.items(), key=lambda x: -x[1])[:10]
        for rsn, cnt in top_reasons:
            vp_lines.append(f"## {rsn}\n")
            vp_lines.append(f"- count: {cnt}\n")
            rl = rsn.lower()
            if "public_recommender_name_leak" in rl or "unsafe_prompt" in rl:
                vp_lines.append("- **classification**: real trust failure — correct rejection\n")
            elif "unsupported_proof" in rl or "unsupported_format" in rl or "unsupported_medical" in rl:
                vp_lines.append("- **classification**: real trust failure — correct rejection\n")
            elif "unsupported_format" in rl and "template" in rl.lower():
                vp_lines.append("- **classification**: likely false positive — abstract/critical template use should not reject\n")
            elif "publisher_hype" in rl or "generic_ai" in rl:
                vp_lines.append("- **classification**: likely false positive — consider moving to sanitizer\n")
            elif "quality_below_threshold" in rl and "quality_below_accept" not in rl and "quality_below_retry" not in rl:
                vp_lines.append("- **classification**: hard reject — score below 4.0, evaluate manually\n")
            elif "quality_below_accept_threshold" in rl:
                vp_lines.append("- **classification**: borderline keep_pending — score 4.3-4.69, consider retry or accept\n")
            elif "quality_below_retry_threshold" in rl:
                vp_lines.append("- **classification**: needs_retry — score 4.0-4.29 with fixable issues\n")
            elif "source_overclaim" in rl:
                vp_lines.append("- **classification**: review manually — may be real trust failure or narrow false positive\n")
            else:
                vp_lines.append("- **classification**: review manually\n")
            vp_lines.append(f"- suggestion: review for false positive potential and calibration\n")
        with open(out_dir / "validator_patch_suggestions.md", "w", encoding="utf-8") as f:
            f.write("".join(vp_lines))
        print(f"[lpack] wrote validator_patch_suggestions.md")

        # prompt_patch_suggestions.md
        pp_lines = ["# Prompt Patch Suggestions\n", "Evidence only. Do not auto-apply.\n\n"]
        dim_avgs = {}
        for dim, vals in eval_dim_scores.items():
            if vals:
                dim_avgs[dim] = statistics.mean(vals)
        # Check dimension averages for concrete prompt suggestions
        dim_thresholds = {
            "best_for_specificity": ("best_for_specificity", "prompt should require each best_for item to name a concrete person in a specific life/work situation, not a demographic label. Require at least 2 of: reader identity, life/work situation, reading mood, specific problem, reason this book fits now."),
            "reader_fit_specificity": ("reader_fit_specificity", "prompt should explicitly ask: when is this the right book? when is this the wrong book? what likely makes someone bounce? Use the quick_verdict and editorial_summary to answer these."),
            "emotional_fit_quality": ("emotional_fit_quality", "prompt should require emotional_journey to describe start feeling, mid-book friction, ending aftertaste, and wrong-reader emotional reaction. Avoid adjective-only descriptions."),
            "not_for_specificity": ("not_for_specificity", "prompt should require each not_for item to name a specific friction (slow, dense, repetitive, dated, ideological) and a likely DNF point, not just abstract mismatch."),
            "dnf_warning_quality": ("dnf_warning_quality", "prompt should emphasize that at least one not_for item must identify a specific likely DNF point with the friction mechanism."),
        }
        weak_found = False
        for dim, (label, suggestion) in dim_thresholds.items():
            avg = dim_avgs.get(dim)
            if avg is not None and avg < 4.0:
                weak_found = True
                pp_lines.append(f"## {label} average {avg:.2f}: below threshold\n")
                pp_lines.append(f"- {suggestion}\n\n")
        if weak_found:
            pp_lines.append("## General specificity guidance\n\n")
            pp_lines.append("- Avoid generic reader labels: 'a curious non-historian,' 'someone seeking meaning,' 'business readers.'\n")
            pp_lines.append("- Prefer concrete situations: 'a founder who feels trapped,' 'a parent in a difficult season,' 'a PM inside a legacy company.'\n")
            pp_lines.append("- Each best_for item should name who, what situation, why now.\n")
        elif "best_for_too_generic" in warning_counts or "not_for_too_generic" in warning_counts:
            pp_lines.append("## Specificity issues detected\n")
            pp_lines.append("- best_for and not_for items are too generic. Consider stronger prompt examples.\n")
        if "emotional_journey_weak" in warning_counts:
            pp_lines.append("## Emotional journey weakness\n")
            pp_lines.append("- emotional_journey fields are vague. Add more concrete examples to prompt.\n")
        if "pacing_profile_weak" in warning_counts:
            pp_lines.append("## Pacing profile weakness\n")
            pp_lines.append("- reading_pace_profile fields lack concrete signals. Emphasize physical reading patterns.\n")
        if not weak_found and not any(k in warning_counts for k in ["best_for_too_generic", "emotional_journey_weak", "pacing_profile_weak"]):
            pp_lines.append("No clear prompt improvement signals detected from warning clusters.\n")
        with open(out_dir / "prompt_patch_suggestions.md", "w", encoding="utf-8") as f:
            f.write("".join(pp_lines))
        print(f"[lpack] wrote prompt_patch_suggestions.md")

        # regression_case_candidates.json
        reg_cases = []
        for r in failure_rows:
            reg_cases.append({
                "title": r.get("title", ""),
                "reason": (r.get("reason") or "")[:120],
                "matched_text": r.get("reject_debug_matched_text", ""),
                "snippet": (r.get("reject_debug_snippet") or "")[:200],
                "expected_outcome": "fail",
                "why_it_matters": f"Regressed or newly failing. Status: {r.get('status', '')}",
            })
        with open(out_dir / "regression_case_candidates.json", "w", encoding="utf-8") as f:
            json.dump(reg_cases, f, indent=2)
        print(f"[lpack] wrote regression_case_candidates.json ({len(reg_cases)} candidates)")

        print(f"\n[lpack] Learning pack written to {out_dir}/")

    return 0


def _run_compare_reports(old_path: str, new_path: str) -> int:
    import collections, statistics, pathlib

    for p in (old_path, new_path):
        if not pathlib.Path(p).exists():
            print(f"[compare] Report not found: {p}")
            return 1

    old_rows = _read_report_rows(old_path)
    new_rows = _read_report_rows(new_path)

    old_status: Dict[str, int] = collections.Counter()
    new_status: Dict[str, int] = collections.Counter()
    old_reasons: Dict[str, int] = collections.Counter()
    new_reasons: Dict[str, int] = collections.Counter()
    old_actions: Dict[str, int] = collections.Counter()
    new_actions: Dict[str, int] = collections.Counter()
    old_warnings: Dict[str, int] = collections.Counter()
    new_warnings: Dict[str, int] = collections.Counter()
    old_scores: List[float] = []
    new_scores: List[float] = []

    for rows, status_c, reason_c, action_c, warn_c, score_l in [
        (old_rows, old_status, old_reasons, old_actions, old_warnings, old_scores),
        (new_rows, new_status, new_reasons, new_actions, new_warnings, new_scores),
    ]:
        for r in rows:
            s = (r.get("status") or "").strip()
            status_c[s or "unknown"] += 1
            reason = (r.get("reason") or "").strip()
            if reason:
                reason_c[reason[:80]] += 1
            action = (r.get("recommended_action") or "").strip()
            if action:
                action_c[action] += 1
            for w in (r.get("quality_warnings") or "").split("|"):
                w = w.strip()
                if w:
                    warn_c[w] += 1
            sc = _safe_float(r.get("overall_icp_score", ""), -1)
            if sc >= 0:
                score_l.append(sc)

    print("=" * 60)
    print("  REPORT COMPARISON")
    print("=" * 60)
    print(f"  OLD: {old_path} ({len(old_rows)} rows)")
    print(f"  NEW: {new_path} ({len(new_rows)} rows)")

    print(f"\n  STATUS DELTA:")
    all_statuses = set(old_status.keys()) | set(new_status.keys())
    for s in sorted(all_statuses):
        o = old_status.get(s, 0)
        n = new_status.get(s, 0)
        delta = n - o
        sign = "+" if delta > 0 else ""
        print(f"    {s:25s} old={o:4d} new={n:4d} ({sign}{delta:+d})")

    # Newly introduced failures
    new_only_reasons = set(new_reasons.keys()) - set(old_reasons.keys())
    resolved_reasons = set(old_reasons.keys()) - set(new_reasons.keys())

    if new_only_reasons:
        print(f"\n  NEWLY INTRODUCED FAILURE REASONS:")
        for r in sorted(new_only_reasons):
            print(f"    + {r[:65]:65s} ({new_reasons[r]})")

    if resolved_reasons:
        print(f"\n  RESOLVED FAILURE REASONS:")
        for r in sorted(resolved_reasons):
            print(f"    - {r[:65]:65s} ({old_reasons[r]})")

    # Reason deltas
    print(f"\n  REASON DELTA (top changes):")
    all_reasons = set(old_reasons.keys()) | set(new_reasons.keys())
    reason_deltas = []
    for r in all_reasons:
        o = old_reasons.get(r, 0)
        n = new_reasons.get(r, 0)
        reason_deltas.append((abs(n - o), r, o, n))
    for _, r, o, n in sorted(reason_deltas, reverse=True)[:15]:
        delta = n - o
        if delta == 0:
            continue
        sign = "+" if delta > 0 else ""
        print(f"    {r[:50]:50s} {o:4d} → {n:4d} ({sign}{delta:+d})")

    # Warning delta
    print(f"\n  WARNING DELTA (top changes):")
    all_warnings = set(old_warnings.keys()) | set(new_warnings.keys())
    warn_deltas = []
    for w in all_warnings:
        o = old_warnings.get(w, 0)
        n = new_warnings.get(w, 0)
        if n != o:
            warn_deltas.append((abs(n - o), w, o, n))
    for _, w, o, n in sorted(warn_deltas, reverse=True)[:15]:
        sign = "+" if n > o else ""
        print(f"    {w[:50]:50s} {o:4d} → {n:4d} ({sign}{n-o:+d})")

    # Score delta
    if old_scores and new_scores:
        old_avg = statistics.mean(old_scores)
        new_avg = statistics.mean(new_scores)
        print(f"\n  SCORE DELTA:")
        print(f"    old avg: {old_avg:.2f} (n={len(old_scores)})")
        print(f"    new avg: {new_avg:.2f} (n={len(new_scores)})")
        print(f"    delta:   {new_avg - old_avg:+.2f}")

    # Action delta
    all_actions = set(old_actions.keys()) | set(new_actions.keys())
    if all_actions:
        print(f"\n  ACTION DELTA:")
        for a in sorted(all_actions):
            o = old_actions.get(a, 0)
            n = new_actions.get(a, 0)
            sign = "+" if n > o else ""
            print(f"    {a:25s} {o:4d} → {n:4d} ({sign}{n-o:+d})")

    return 0


def _run_promote_regression_cases(json_path: str) -> int:
    import pathlib

    if not pathlib.Path(json_path).exists():
        print(f"[promote] File not found: {json_path}")
        return 1

    with open(json_path, "r", encoding="utf-8") as f:
        cases = json.load(f)

    if not isinstance(cases, list):
        print("[promote] regression_case_candidates.json should be a list.")
        return 1

    print("=" * 60)
    print("  REGRESSION CASE CANDIDATES (copy-paste fixture skeletons)")
    print("=" * 60)
    print(f"  Total candidates: {len(cases)}\n")

    for idx, case in enumerate(cases, 1):
        title = case.get("title", "Unknown")
        reason = case.get("reason", "")
        matched = case.get("matched_text", "")
        snippet = case.get("snippet", "")
        expected = case.get("expected_outcome", "fail")
        why = case.get("why_it_matters", "")
        book_id_slug = re.sub(r"[^a-z0-9-]", "", title.lower().replace(" ", "-"))[:50]

        print(f"// --- Candidate {idx}: {title} ---")
        print(f"// reason: {reason}")
        print(f"// matched_text: {matched}")
        print(f"// snippet: {snippet[:120]}")
        print(f"// why it matters: {why}")
        print(f'  {{')
        print(f'    "id": "fixture-reg-{book_id_slug}",')
        print(f'    "slug": "{book_id_slug}",')
        print(f'    "title": "{title}",')
        print(f'    "author": "FIXTURE_AUTHOR",')
        print(f'    "description": "Regression case: {reason[:80]}",')
        print(f'    "recommendation_count": 1,')
        print(f'    "lists": ["FIXTURE_CATEGORY"],')
        print(f'    "series": [],')
        print(f'    "recommendations": [{{"source_url": "https://example.com/reg-rec-{idx}", "quote": "Fixture-only."}}],')
        print(f'    "expected_status": "{expected}",')
        print(f'    "expected_reason_contains": "{reason[:60]}",')
        print(f'    "mock_ai_output": {{}}')
        print(f'  }},')
        print()

    print("// To use: copy the above blocks into the fixture JSON books array.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
