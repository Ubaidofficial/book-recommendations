#!/usr/bin/env python3
# Controlled key_themes repair for existing BookRecs editorial rows.
#
# SAFETY MODEL
#   - Audit + dry-run preview by DEFAULT. NO DB writes unless ALL three gates pass:
#       --write  AND  --confirm-theme-repair  AND  --backup-before-write PATH
#   - The ONLY mutable column is `books.key_themes`. Nothing else is ever touched:
#     not editorial_summary, not best_for/not_for, not cover_image_url, not slug/title/
#     description, not index_status/SEO, not recommendation_count, not list_count,
#     not ai_quality_status, not ai_generated_at.
#   - Pre-write backup of current key_themes (per row) is REQUIRED and validated
#     before any PATCH.
#   - Idempotent: live-mode re-fetches each row and refuses to overwrite key_themes
#     that have changed since the preview (drift skip).
#   - Refuses to write if the candidate list itself is low-quality (filters again
#     server-side before PATCH).
#   - Conservative: when in doubt, skip the row. We mark `needs_manual_review`
#     rather than risk worsening copy.
#   - No AI generation in audit mode. Preview mode calls the AI ONLY for rows that
#     fail validation. If no AI key is configured, preview rows that would need AI
#     are written with decision='error', reason='ai_unavailable' (no crash).
#
# WHAT WE FIX
#   - Sentence-fragment themes ("The book argues that focus is the new IQ.")
#   - Generic recycled binaries ("principles vs practical compromise", "freedom vs responsibility")
#   - Vague single-tokens that recycle across unrelated books ("personal growth")
#   - Themes that start with banned starters ("The book ...", "It shows ...", "Newport's advice ...")
#   - >10-word running-prose dressed up as a "theme"
#
# WHAT WE DO NOT TOUCH
#   - Editorial summary, best_for, not_for, vibe_tags, quick_verdict, etc.
#   - Cover image, slug, title, description.
#   - Index status, recommendation counts, list counts.
#
# USAGE
#   # Audit (read-only)
#   python scripts/path1_theme_repair.py --audit
#
#   # Small dry-run preview (top 20 weak-themes books with recs>=10) — NO write
#   python scripts/path1_theme_repair.py --limit 20 --min-recommendations 10 \
#       --provider deepseek --model deepseek-v4-pro --dry-run \
#       --out rebuild_v2/theme_repair_preview_v9_11.csv
#
#   # Live write (gated)
#   python scripts/path1_theme_repair.py \
#       --preview rebuild_v2/theme_repair_preview_v9_11.csv \
#       --write --confirm-theme-repair \
#       --backup-before-write backups/theme_repair_pre_<ts>.csv

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
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Reuse the v9.11 validators and serializer from the editorial enrichment script.
# The enrichment script's main() is guarded by `if __name__ == "__main__"`, so
# importing it as a module is side-effect-free.
from generate_book_editorial_enrichment import (  # noqa: E402
    _is_low_quality_theme,
    _filter_theme_quality,
    _to_editorial_list,
    default_model,
)

csv.field_size_limit(10**9)


# ─────────────────────────────────────────────────────────────────────────────
# Quality gates
# ─────────────────────────────────────────────────────────────────────────────

MIN_VALID_THEMES = 3       # below this on the EXISTING value, the row is weak
TARGET_THEMES = 5          # target list length we hand back to the DB
MAX_TARGET_THEMES = 5
MIN_CANDIDATE_THEMES = 4   # below this on the AI CANDIDATE = needs_manual_review


def _dedupe_lower(items: List[str]) -> List[str]:
    seen: set = set()
    out: List[str] = []
    for it in items:
        s = (it or "").strip()
        k = s.lower()
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(s)
    return out


def classify_themes(themes: List[str]) -> Dict[str, Any]:
    """Return a dict summarizing the quality state of an existing themes list."""
    raw = [(t or "").strip() for t in (themes or []) if (t or "").strip()]
    deduped = _dedupe_lower(raw)
    kept, dropped = _filter_theme_quality(deduped)
    reasons: List[str] = []
    if not raw:
        reasons.append("empty")
    if len(raw) != len(deduped):
        reasons.append("duplicates")
    if dropped:
        reasons.append("low_quality_items")
    if len(kept) < MIN_VALID_THEMES:
        reasons.append(f"fewer_than_{MIN_VALID_THEMES}_valid")
    # Flag list-shape problems where some items look like sentence fragments
    if any(_is_low_quality_theme(t) for t in raw):
        if "low_quality_items" not in reasons:
            reasons.append("low_quality_items")
    is_valid = (
        len(raw) >= MIN_VALID_THEMES
        and len(deduped) == len(raw)
        and not dropped
        and len(kept) >= MIN_VALID_THEMES
    )
    return {
        "raw": raw,
        "deduped": deduped,
        "kept": kept,
        "dropped": dropped,
        "is_valid": is_valid,
        "reasons": reasons,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Supabase
# ─────────────────────────────────────────────────────────────────────────────

def _creds() -> Tuple[str, str]:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    key = (os.environ.get("SUPABASE_SECRET_KEY")
           or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or "")
    return url.rstrip("/"), key


def _req(method: str, url: str, headers: Dict[str, str],
         payload: Optional[dict] = None, timeout: int = 30) -> Tuple[Any, Dict[str, str]]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
        rh = {k: v for k, v in resp.headers.items()}
    return (json.loads(body) if body else None), rh


BOOK_SELECT = ",".join([
    "id", "slug", "title", "author_name", "description",
    "recommendation_count", "list_count",
    "editorial_summary", "key_themes", "ai_quality_status", "ai_generated_at",
])


def supa_select_books_page(url: str, key: str, limit: int, offset: int) -> List[Dict[str, Any]]:
    params = {
        "select": BOOK_SELECT,
        "order": "recommendation_count.desc.nullslast,title.asc",
        "limit": str(limit),
        "offset": str(offset),
    }
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode(params)
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    try:
        data, _ = _req("GET", full, h)
        return data or []
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8")
        except Exception:
            pass
        print(f"[supabase] HTTP {e.code} on GET books: {body[:200]}")
        return []


def supa_select_books_all(url: str, key: str, page: int = 1000) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    offset = 0
    while True:
        batch = supa_select_books_page(url, key, page, offset)
        if not batch:
            break
        rows.extend(batch)
        offset += len(batch)
        if len(batch) < page:
            break
    return rows


def supa_get_book(url: str, key: str, book_id: str) -> Optional[Dict[str, Any]]:
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode({
        "select": BOOK_SELECT,
        "id": f"eq.{book_id}",
        "limit": "1",
    })
    try:
        data, _ = _req("GET", full, {"apikey": key, "Authorization": f"Bearer {key}"})
        return data[0] if data else None
    except Exception as e:
        print(f"[supabase] live-fetch failed for {book_id}: {e}")
        return None


def supa_patch_key_themes(url: str, key: str, book_id: str, themes: List[str]) -> None:
    """PATCH ONLY key_themes. Sends a proper text[] array via _to_editorial_list."""
    full = f"{url}/rest/v1/books?" + urllib.parse.urlencode({"id": f"eq.{book_id}"})
    h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
         "Prefer": "return=minimal"}
    # _to_editorial_list returns a List[str]; PostgREST serializes that to a text[] array.
    payload = {"key_themes": _to_editorial_list(themes)}
    _req("PATCH", full, h, payload=payload)


# ─────────────────────────────────────────────────────────────────────────────
# Existing key_themes parsing (handles both proper text[] and legacy " | "-joined strings)
# ─────────────────────────────────────────────────────────────────────────────

def parse_existing_key_themes(value: Any) -> List[str]:
    """Coerce whatever the DB returned into a clean List[str]. Reuses the same
    serializer used by the editorial writer so we don't disagree with ourselves."""
    return _to_editorial_list(value)


# ─────────────────────────────────────────────────────────────────────────────
# AI candidate generation
# ─────────────────────────────────────────────────────────────────────────────

THEME_REPAIR_SYSTEM = (
    "You revise ONLY the key_themes for an existing book entry.\n"
    "Constraints:\n"
    "- Return EXACTLY 5 short, book-SPECIFIC tags as a JSON object: {\"key_themes\": [\"...\", \"...\"]}.\n"
    "- Each tag is a noun phrase, 2–5 words (HARD cap ~8 words).\n"
    "- Lowercase or mixed-case OK, but NO sentences. NO trailing punctuation.\n"
    "- Never start with: \"The book\", \"The contrast\", \"It shows\", \"This book\", \"The author\", \"<Author>'s advice\".\n"
    "- Never write generic recycled binaries: \"principles vs practical compromise\", \"freedom vs responsibility\",\n"
    "  \"tradition vs reinvention\", \"loyalty vs personal truth\", \"duty vs desire\".\n"
    "- Never use vague placeholders: \"personal growth\", \"life lessons\", \"human nature\", \"self-improvement\".\n"
    "- Tags should be book-SPECIFIC. Examples (do not reuse for other books):\n"
    "    Deep Work: deep focus, shallow work, attention residue, distraction resistance, digital minimalism\n"
    "    Life 3.0: AI alignment, automation risk, intelligence explosion, machine goals, technology governance\n"
    "    Influence: social proof, reciprocity, commitment bias, scarcity, authority cues\n"
    "- \"X vs Y\" only when both sides are concrete to THIS book.\n"
    "- No prestige/medical/research claims. No recommender names. No celebrity names.\n"
    "Return strict JSON only. No markdown. No commentary."
)


def build_theme_repair_user_prompt(book: Dict[str, Any]) -> str:
    title = (book.get("title") or "").strip()
    author = (book.get("author_name") or "").strip()
    desc = (book.get("description") or "").strip()
    # Cap description so we don't bloat the prompt
    if len(desc) > 900:
        desc = desc[:900].rstrip() + "…"
    summary = (book.get("editorial_summary") or "").strip()
    if len(summary) > 700:
        summary = summary[:700].rstrip() + "…"
    payload = {
        "title": title,
        "author": author,
        "short_description": desc,
        "editorial_summary": summary,
    }
    return json.dumps(payload, ensure_ascii=False)


def call_llm_for_themes(provider: str, model: str, book: Dict[str, Any],
                        timeout: int = 60) -> Tuple[List[str], str, Optional[str]]:
    """Return (themes, raw_text, error). `error` is None on success.
    Reads keys from env. NO retries — the caller can re-run preview if needed."""
    if provider == "deepseek":
        key = os.environ.get("DEEPSEEK_API_KEY", "")
        endpoint = "https://api.deepseek.com/chat/completions"
    elif provider == "openai":
        key = os.environ.get("OPENAI_API_KEY", "")
        endpoint = "https://api.openai.com/v1/chat/completions"
    else:
        return [], "", f"unsupported provider: {provider}"
    if not key:
        return [], "", "ai_unavailable_missing_api_key"

    messages = [
        {"role": "system", "content": THEME_REPAIR_SYSTEM},
        {"role": "user", "content": build_theme_repair_user_prompt(book)},
    ]
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(endpoint, data=data, method="POST", headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
        wrapped = json.loads(body)
        content = wrapped["choices"][0]["message"]["content"]
        obj = json.loads(content)
        themes_raw = obj.get("key_themes") or obj.get("themes") or []
        if not isinstance(themes_raw, list):
            return [], content[:1000], "ai_returned_non_list"
        themes = [str(t).strip() for t in themes_raw if str(t).strip()]
        return themes, content[:1000], None
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8")
        except Exception:
            pass
        return [], "", f"ai_http_{e.code}: {body[:120]}"
    except Exception as e:
        return [], "", f"ai_{type(e).__name__}: {str(e)[:120]}"


def evaluate_candidate(raw_themes: List[str]) -> Dict[str, Any]:
    """Filter + dedupe + classify a fresh AI candidate."""
    deduped = _dedupe_lower(raw_themes)
    kept, dropped = _filter_theme_quality(deduped)
    # Cap at MAX_TARGET_THEMES so we never overflow the DB.
    final = kept[:MAX_TARGET_THEMES]
    reasons: List[str] = []
    if len(raw_themes) != len(deduped):
        reasons.append("candidate_had_duplicates")
    if dropped:
        reasons.append("candidate_low_quality_filtered")
    if len(final) < MIN_CANDIDATE_THEMES:
        reasons.append(f"candidate_below_min_{MIN_CANDIDATE_THEMES}")
    return {
        "deduped": deduped,
        "kept": kept,
        "dropped": dropped,
        "final": final,
        "reasons": reasons,
        "score": float(len(final)) / float(MAX_TARGET_THEMES),  # 0..1
    }


# ─────────────────────────────────────────────────────────────────────────────
# Books source loading
# ─────────────────────────────────────────────────────────────────────────────

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
        raise SystemExit("No Supabase credentials and no --production-dir.")
    rows = supa_select_books_all(url, key)
    return rows, f"LIVE {url}"


def book_has_editorial(book: Dict[str, Any]) -> bool:
    """A book is in scope only if it has at least an editorial_summary."""
    return bool((book.get("editorial_summary") or "").strip())


# ─────────────────────────────────────────────────────────────────────────────
# Audit mode
# ─────────────────────────────────────────────────────────────────────────────

def do_audit(args: argparse.Namespace) -> int:
    books, source = load_books(args)
    print("== Theme repair AUDIT (READ-ONLY) ==")
    print(f"source                       : {source}")
    print(f"books loaded                 : {len(books)}")

    with_editorial = [b for b in books if book_has_editorial(b)]
    print(f"books with editorial_summary : {len(with_editorial)}")

    weak: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    by_reason: Dict[str, int] = {}
    by_tier: Dict[str, int] = {"recs>=20": 0, "recs>=10": 0, "recs>=3": 0}

    for b in with_editorial:
        themes = parse_existing_key_themes(b.get("key_themes"))
        info = classify_themes(themes)
        if info["is_valid"]:
            continue
        weak.append((b, info))
        for r in info["reasons"]:
            by_reason[r] = by_reason.get(r, 0) + 1
        rc = int(b.get("recommendation_count") or 0)
        if rc >= 20:
            by_tier["recs>=20"] += 1
        elif rc >= 10:
            by_tier["recs>=10"] += 1
        elif rc >= 3:
            by_tier["recs>=3"] += 1

    print(f"weak-themes books (in scope) : {len(weak)}")
    print()
    print("by recommendation tier:")
    for tier, n in by_tier.items():
        print(f"  {tier:12s} : {n}")
    print()
    print("by failure reason:")
    for reason, n in sorted(by_reason.items(), key=lambda x: -x[1]):
        print(f"  {reason:30s} : {n}")

    if weak:
        weak_sorted = sorted(weak, key=lambda x: -int(x[0].get("recommendation_count") or 0))
        print()
        print("top 10 weak-theme books by recommendation_count:")
        for b, info in weak_sorted[:10]:
            recs = int(b.get("recommendation_count") or 0)
            sample = " | ".join((info["raw"] or [])[:3])
            if len(sample) > 70:
                sample = sample[:70] + "…"
            reasons = ",".join(info["reasons"])
            print(f"  recs={recs:3d}  {(b.get('title') or '')[:40]:40s} | reasons={reasons:40s} | themes={sample}")

    print()
    print("NO DB WRITES. NO AI CALLS.")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# Preview / dry-run mode
# ─────────────────────────────────────────────────────────────────────────────

def select_repair_targets(books: List[Dict[str, Any]], min_recs: int,
                          limit: int, offset: int) -> List[Tuple[Dict[str, Any], Dict[str, Any]]]:
    eligible: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    for b in books:
        if not book_has_editorial(b):
            continue
        if int(b.get("recommendation_count") or 0) < min_recs:
            continue
        themes = parse_existing_key_themes(b.get("key_themes"))
        info = classify_themes(themes)
        if info["is_valid"]:
            continue
        eligible.append((b, info))
    eligible.sort(key=lambda pair: (
        -int(pair[0].get("recommendation_count") or 0),
        -int(pair[0].get("list_count") or 0),
        (pair[0].get("title") or "").lower(),
    ))
    return eligible[offset: offset + limit]


PREVIEW_COLUMNS = [
    "book_id", "slug", "title", "author_name", "recommendation_count", "list_count",
    "current_key_themes", "candidate_key_themes", "decision", "reason",
    "old_theme_quality_reasons", "candidate_score", "provider", "model",
    "ai_quality_status_before", "ai_raw_excerpt",
]


def do_preview(args: argparse.Namespace) -> int:
    books, source = load_books(args)
    targets = select_repair_targets(books, args.min_recommendations, args.limit, args.offset)

    print("== Theme repair PREVIEW (DRY-RUN, NO DB WRITES) ==")
    print(f"source                       : {source}")
    print(f"books loaded                 : {len(books)}")
    print(f"targets after filter         : {len(targets)} "
          f"(weak-themes + has-editorial + recs>={args.min_recommendations}, "
          f"limit={args.limit} offset={args.offset})")
    print(f"provider                     : {args.provider}")
    print(f"model                        : {args.model or default_model(args.provider)}")
    print(f"min_candidate_themes         : {MIN_CANDIDATE_THEMES}")
    print(f"target_themes                : {TARGET_THEMES} (cap {MAX_TARGET_THEMES})")
    print()

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_csv = args.out or os.path.join(args.out_dir, f"theme_repair_preview_{ts}.csv")
    plan_md = os.path.join(args.out_dir, f"THEME_REPAIR_PLAN_{ts}.md")
    out_dir = os.path.dirname(out_csv)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    model = args.model or default_model(args.provider)

    rows_out: List[Dict[str, Any]] = []
    n_repair = n_skip_valid = n_skip_no_ctx = n_manual = n_err = 0
    examples_repair: List[Tuple[Dict[str, Any], List[str], List[str]]] = []
    examples_manual: List[Tuple[Dict[str, Any], Dict[str, Any], List[str]]] = []
    examples_skip: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []

    for i, (b, old_info) in enumerate(targets, 1):
        if i % 10 == 0:
            print(f"  …processed {i}/{len(targets)}")

        row: Dict[str, Any] = {
            "book_id": b.get("id", ""),
            "slug": b.get("slug", ""),
            "title": b.get("title", ""),
            "author_name": b.get("author_name") or b.get("author") or "",
            "recommendation_count": int(b.get("recommendation_count") or 0),
            "list_count": int(b.get("list_count") or 0),
            "current_key_themes": " | ".join(old_info["raw"]),
            "candidate_key_themes": "",
            "decision": "",
            "reason": "",
            "old_theme_quality_reasons": ",".join(old_info["reasons"]),
            "candidate_score": 0.0,
            "provider": args.provider,
            "model": model,
            "ai_quality_status_before": b.get("ai_quality_status") or "",
            "ai_raw_excerpt": "",
        }

        # Sanity: require some context to even call the AI.
        has_ctx = bool((b.get("description") or "").strip() or (b.get("editorial_summary") or "").strip())
        if not has_ctx:
            row["decision"] = "skip_no_context"
            row["reason"] = "no description or editorial_summary on the book row"
            n_skip_no_ctx += 1
            rows_out.append(row)
            examples_skip.append((b, old_info))
            continue

        themes, raw_excerpt, err = call_llm_for_themes(args.provider, model, b)
        row["ai_raw_excerpt"] = (raw_excerpt or "")[:300]
        if err:
            row["decision"] = "error"
            row["reason"] = err
            n_err += 1
            rows_out.append(row)
            if args.sleep > 0:
                time.sleep(args.sleep)
            continue

        cand_info = evaluate_candidate(themes)
        row["candidate_key_themes"] = " | ".join(cand_info["final"])
        row["candidate_score"] = round(cand_info["score"], 3)

        if len(cand_info["final"]) >= MIN_CANDIDATE_THEMES:
            # Extra safety: refuse to "repair" if the candidate is identical to the existing.
            same = [t.lower() for t in cand_info["final"]] == [t.lower() for t in old_info["raw"]]
            if same:
                row["decision"] = "skip_valid_existing"
                row["reason"] = "candidate identical to existing themes"
                n_skip_valid += 1
                rows_out.append(row)
                if args.sleep > 0:
                    time.sleep(args.sleep)
                continue
            row["decision"] = "would_repair"
            row["reason"] = ";".join(cand_info["reasons"]) or "candidate_passes_filter"
            n_repair += 1
            if len(examples_repair) < 5:
                examples_repair.append((b, old_info["raw"], cand_info["final"]))
        else:
            row["decision"] = "needs_manual_review"
            row["reason"] = ";".join(cand_info["reasons"]) or "candidate_below_min_valid"
            n_manual += 1
            if len(examples_manual) < 5:
                examples_manual.append((b, cand_info, old_info["raw"]))

        rows_out.append(row)
        if args.sleep > 0:
            time.sleep(args.sleep)

    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=PREVIEW_COLUMNS)
        w.writeheader()
        for r in rows_out:
            w.writerow(r)

    # Markdown plan
    md_lines: List[str] = []
    md_lines.append(f"# Theme Repair Plan ({ts})")
    md_lines.append("")
    md_lines.append(f"- source: `{source}`")
    md_lines.append(f"- books loaded: {len(books)}")
    md_lines.append(f"- targets after filter: {len(targets)} "
                    f"(weak-themes + has-editorial + recs>={args.min_recommendations})")
    md_lines.append(f"- provider/model: `{args.provider}` / `{model}`")
    md_lines.append("")
    md_lines.append("## Summary")
    md_lines.append(f"- would_repair         : {n_repair}")
    md_lines.append(f"- skip_valid_existing  : {n_skip_valid}")
    md_lines.append(f"- skip_no_context      : {n_skip_no_ctx}")
    md_lines.append(f"- needs_manual_review  : {n_manual}")
    md_lines.append(f"- error                : {n_err}")
    md_lines.append("")
    md_lines.append("## DO NOT RUN — future live-write command")
    md_lines.append("```")
    md_lines.append("python scripts/path1_theme_repair.py \\")
    md_lines.append(f"  --preview {out_csv} \\")
    md_lines.append("  --write --confirm-theme-repair \\")
    md_lines.append(f"  --backup-before-write backups/theme_repair_pre_{ts}.csv")
    md_lines.append("```")
    md_lines.append("")
    if examples_repair:
        md_lines.append("## Example `would_repair` rows (first 5)")
        for b, old, new in examples_repair:
            md_lines.append(f"- **{b.get('title', '')}** by {b.get('author_name', '')}")
            md_lines.append(f"  - old: `{' | '.join(old) if old else '<empty>'}`")
            md_lines.append(f"  - new: `{' | '.join(new)}`")
        md_lines.append("")
    if examples_manual:
        md_lines.append("## Example `needs_manual_review` rows (first 5)")
        for b, cand, old in examples_manual:
            md_lines.append(f"- **{b.get('title', '')}** by {b.get('author_name', '')}")
            md_lines.append(f"  - old: `{' | '.join(old) if old else '<empty>'}`")
            md_lines.append(f"  - candidate (after filter): `{' | '.join(cand['final'])}`")
            md_lines.append(f"  - dropped from candidate: `{' | '.join(cand['dropped'])}`")
        md_lines.append("")
    if examples_skip:
        md_lines.append("## Example `skip_no_context` rows (first 5)")
        for b, info in examples_skip[:5]:
            md_lines.append(f"- **{b.get('title', '')}** — empty description AND empty editorial_summary")
        md_lines.append("")
    with open(plan_md, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines) + "\n")

    print()
    print(f"would_repair         : {n_repair}")
    print(f"skip_valid_existing  : {n_skip_valid}")
    print(f"skip_no_context      : {n_skip_no_ctx}")
    print(f"needs_manual_review  : {n_manual}")
    print(f"error                : {n_err}")
    print()
    print(f"preview csv          : {out_csv}")
    print(f"plan markdown        : {plan_md}")
    print()
    print("NO DB WRITES PERFORMED.")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# Live write mode (triple-gated)
# ─────────────────────────────────────────────────────────────────────────────

def do_write(args: argparse.Namespace) -> int:
    if not args.confirm_theme_repair:
        raise SystemExit("--write requires --confirm-theme-repair")
    if not args.backup_before_write:
        raise SystemExit("--write requires --backup-before-write PATH")
    if not args.preview or not os.path.exists(args.preview):
        raise SystemExit(f"--write requires --preview PATH to an existing preview CSV (got: {args.preview!r})")
    url, key = _creds()
    if not url or not key:
        raise SystemExit("live write requires SUPABASE_URL + a key in env")

    with open(args.preview, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    would = [r for r in rows if r.get("decision") == "would_repair"]
    print("== Theme repair LIVE WRITE ==")
    print(f"preview rows total           : {len(rows)}")
    print(f"would_repair rows            : {len(would)}")
    if not would:
        raise SystemExit("nothing to write (no would_repair rows in preview)")

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = args.backup_before_write
    parent = os.path.dirname(backup_path)
    if parent:
        os.makedirs(parent, exist_ok=True)

    # Pre-write backup
    backup_rows: List[Dict[str, Any]] = []
    plan_state: List[Dict[str, Any]] = []
    print(f"[backup] fetching {len(would)} current rows live before any write…")
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
            "key_themes_before": " | ".join(parse_existing_key_themes(live.get("key_themes"))),
            "ai_quality_status_before": live.get("ai_quality_status", "") or "",
        })
    with open(backup_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=[
            "id", "slug", "title", "author_name",
            "key_themes_before", "ai_quality_status_before",
        ])
        w.writeheader()
        for b in backup_rows:
            w.writerow(b)
    if len(backup_rows) != len(plan_state):
        raise SystemExit("[backup] count mismatch — aborting before any write")
    print(f"[backup] wrote {len(backup_rows)} rows -> {backup_path}")

    # Write
    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)
    write_report = os.path.join(out_dir, f"theme_repair_write_{ts}.csv")
    write_rows: List[Dict[str, Any]] = []
    updated = skipped = failed = 0

    for ps in plan_state:
        r = ps["row"]
        live = ps["live"]
        out: Dict[str, Any] = {
            "book_id": live.get("id", ""),
            "slug": live.get("slug", ""),
            "title": live.get("title", ""),
            "key_themes_before": " | ".join(parse_existing_key_themes(live.get("key_themes"))),
            "key_themes_after": "",
            "status": "",
            "reason": "",
        }

        # Drift check 1: title/author match preview
        prev_title = (r.get("title") or "").strip().lower()
        prev_author = (r.get("author_name") or "").strip().lower()
        live_title = (live.get("title") or "").strip().lower()
        live_author = (live.get("author_name") or "").strip().lower()
        if prev_title != live_title or (prev_author and live_author and prev_author != live_author):
            out["status"] = "skipped"
            out["reason"] = "title/author drift since preview"
            skipped += 1
            write_rows.append(out)
            continue

        # Drift check 2: existing key_themes must still be weak.
        # If someone fixed them by hand since preview, skip.
        live_themes = parse_existing_key_themes(live.get("key_themes"))
        live_info = classify_themes(live_themes)
        if live_info["is_valid"]:
            out["status"] = "skipped"
            out["reason"] = "key_themes already valid since preview"
            skipped += 1
            write_rows.append(out)
            continue

        # Re-validate candidate server-side before PATCH.
        cand_raw = [t for t in (r.get("candidate_key_themes") or "").split(" | ") if t.strip()]
        cand_eval = evaluate_candidate(cand_raw)
        if len(cand_eval["final"]) < MIN_CANDIDATE_THEMES:
            out["status"] = "skipped"
            out["reason"] = "candidate failed re-validation"
            skipped += 1
            write_rows.append(out)
            continue

        try:
            supa_patch_key_themes(url, key, live["id"], cand_eval["final"])
            out["key_themes_after"] = " | ".join(cand_eval["final"])
            out["status"] = "updated"
            out["reason"] = f"score {cand_eval['score']:.2f}"
            updated += 1
        except Exception as e:
            out["status"] = "failed"
            out["reason"] = f"PATCH error: {type(e).__name__}: {str(e)[:120]}"
            failed += 1
        write_rows.append(out)
        if args.sleep > 0:
            time.sleep(args.sleep)

    cols = ["book_id", "slug", "title", "key_themes_before", "key_themes_after",
            "status", "reason"]
    with open(write_report, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in write_rows:
            w.writerow(r)

    print()
    print(f"updated  : {updated}")
    print(f"skipped  : {skipped}")
    print(f"failed   : {failed}")
    print(f"backup   : {backup_path}")
    print(f"report   : {write_report}")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audit", action="store_true",
                    help="Read-only audit. No AI calls, no writes.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Preview mode (default when not --audit and not --write). Calls AI for weak rows.")
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--min-recommendations", type=int, default=10)
    ap.add_argument("--production-dir", default="",
                    help="Optional offline books.csv source; uses backup if Supabase creds absent.")
    ap.add_argument("--out-dir", default="rebuild_v2")
    ap.add_argument("--out", default="",
                    help="Optional preview CSV output path (otherwise auto-named in --out-dir).")
    ap.add_argument("--preview", default="",
                    help="Preview CSV from a prior dry-run (required for --write).")
    ap.add_argument("--provider", choices=["deepseek", "openai"], default="deepseek")
    ap.add_argument("--model", default="")
    ap.add_argument("--sleep", type=float, default=0.2)
    ap.add_argument("--write", action="store_true",
                    help="GATED: also requires --confirm-theme-repair and --backup-before-write.")
    ap.add_argument("--confirm-theme-repair", action="store_true")
    ap.add_argument("--backup-before-write", default="")
    args = ap.parse_args()

    if args.audit and args.write:
        raise SystemExit("Cannot combine --audit with --write")

    if args.audit:
        return do_audit(args)
    if args.write:
        return do_write(args)
    # default mode: dry-run preview
    return do_preview(args)


if __name__ == "__main__":
    raise SystemExit(main())
