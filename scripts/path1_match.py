#!/usr/bin/env python3
# Shared production book-matching for Path-1 migration (dry-run + insert).
# READ-ONLY logic. No DB access, no writes. Pure functions.
#
# Matching layers (priority order):
#   1. slug match (strongest)
#   2. full normalized title+author  (NFKD fold, diacritics stripped, punctuation normalized)
#   3. core title+author (subtitle stripped after :/;/ spaced-dash) + author
# Layers 2/3 only match when the normalized key maps to exactly ONE production book
# (ambiguous keys are refused to avoid wrong matches).

from __future__ import annotations
import re
import unicodedata
from collections import defaultdict
from typing import Dict, List, Optional, Set, Tuple


def norm_slug(s) -> str:
    return " ".join(str(s or "").split()).strip().lower()


def fold(s) -> str:
    """NFKD-normalize, strip diacritics, lowercase, normalize punctuation, collapse ws."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))   # drop accents
    s = s.lower()
    s = s.replace("’", "'").replace("‘", "'").replace("`", "'")  # curly apostrophes
    s = s.replace("–", "-").replace("—", "-").replace("‒", "-")  # en/em dashes
    s = re.sub(r"[^a-z0-9]+", " ", s)   # all punctuation -> space (also hyphens)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def strip_subtitle(title) -> str:
    """Cut a trailing subtitle. Splits on ':' ';' or a SPACED dash only.
    Never splits a bare hyphen (so 'Moby-Dick', 'Spider-Man' stay intact)."""
    t = str(title or "")
    cut = len(t)
    for sep in [":", ";", " - ", " — ", " – "]:
        i = t.find(sep)
        if i > 0:
            cut = min(cut, i)
    return t[:cut]


def build_book_index(prod_books: List[Dict[str, str]]) -> Dict:
    """Build slug + full-fold + core-fold lookup indices from production books."""
    by_slug: Dict[str, str] = {}
    full: Dict[str, Set[str]] = defaultdict(set)
    core: Dict[str, Set[str]] = defaultdict(set)
    id_title: Dict[str, str] = {}
    for r in prod_books:
        bid = r.get("id")
        if bid is None:
            continue
        bid = str(bid)
        slug = norm_slug(r.get("slug"))
        if slug:
            by_slug[slug] = bid
        title = r.get("title")
        author = r.get("author") if r.get("author") not in (None, "") else r.get("author_name")
        fa = fold(author)
        ft = fold(title)
        if ft:
            full[ft + "::" + fa].add(bid)
        ct = fold(strip_subtitle(title))
        if ct:
            core[ct + "::" + fa].add(bid)
        id_title[bid] = str(title or "")
    return {"by_slug": by_slug, "full": full, "core": core, "id_title": id_title}


def resolve_book(idx: Dict, rb_slug, rb_title, rb_author) -> Tuple[Optional[str], str]:
    """Return (production_book_id|None, method).
    method in: slug | full_fold | core_fold | full_fold_ambiguous | core_fold_ambiguous | missing
    """
    s = norm_slug(rb_slug)
    if s and s in idx["by_slug"]:
        return idx["by_slug"][s], "slug"
    fa = fold(rb_author)
    fk = fold(rb_title) + "::" + fa
    c = idx["full"].get(fk)
    if c:
        if len(c) == 1:
            return next(iter(c)), "full_fold"
        return None, "full_fold_ambiguous"
    ck = fold(strip_subtitle(rb_title)) + "::" + fa
    c = idx["core"].get(ck)
    if c:
        if len(c) == 1:
            return next(iter(c)), "core_fold"
        return None, "core_fold_ambiguous"
    return None, "missing"
