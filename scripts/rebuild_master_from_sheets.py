#!/usr/bin/env python3
# Rebuild a clean, normalized master list from the 6/7-tab source workbook.
# READ-ONLY on inputs. Writes only into the output directory. No DB writes.
#
# Inputs : a multi-tab .xlsx with tabs:
#   All Books, Lists, People, People More, People Written Books, Series, MRB Recommendations
# Outputs (in --out dir):
#   books.csv, lists.csv, book_lists.csv, series.csv, book_series.csv,
#   people.csv, book_recommendations.csv, book_authors.csv, categories.csv,
#   master_list_clean.csv, REBUILD_REPORT.md
#
# Usage:
#   python scripts/rebuild_master_from_sheets.py \
#       --workbook "/path/to/lists.xlsx" \
#       --out rebuild_v1

from __future__ import annotations

import argparse
import csv
import os
import re
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional, Tuple

import openpyxl


# ─────────────────────────────────────────────────────────────────────────────
# Cleanup rules (documented; emitted into REBUILD_REPORT.md)
# ─────────────────────────────────────────────────────────────────────────────

# Known multi-word categories: normalized key (lower, no separators) -> canonical
KNOWN_MULTIWORD = {
    "nonfiction": "Nonfiction",
    "sciencefiction": "Science Fiction",
    "socialsciences": "Social Sciences",
    "personaldevelopment": "Personal Development",
    "personalfinance": "Personal Finance",
    "historicalfiction": "Historical Fiction",
    "historicalromance": "Historical Romance",
    "contemporaryromance": "Contemporary Romance",
    "mystery&crime": "Mystery & Crime",
    "thriller&suspense": "Thriller & Suspense",
    "relationships&family": "Relationships & Family",
    "teen&young": "Teen & Young Adult",
    "teen&youngadult": "Teen & Young Adult",
    "action&adventure": "Action & Adventure",
    "americanhistory": "American History",
    "arthistory": "Art History",
    "epicfantasy": "Epic Fantasy",
    "urbanfantasy": "Urban Fantasy",
    "alternatehistory": "Alternate History",
    "mentalhealth": "Mental Health",
    "paranormalromance": "Paranormal Romance",
    "timetravel": "Time Travel",
    "spaceopera": "Space Opera",
    "artificialintelligence": "Artificial Intelligence",
    "romanticsuspense": "Romantic Suspense",
    "newadult": "New Adult",
    "legalthriller": "Legal Thriller",
    "cozymysteries": "Cozy Mysteries",
    "christianfiction": "Christian Fiction",
    "historicalmysteries": "Historical Mysteries",
    # v2: NeuroScience merged form -> canonical Neuroscience
    "neuroscience": "Neuroscience",
}

# Truncation / typo fixes applied to single tokens
TOKEN_FIXES = {
    "ificial intelligence": "Artificial Intelligence",
    "ificialintelligence": "Artificial Intelligence",
    "non fiction": "Nonfiction",
    "non-fiction": "Nonfiction",
    "nonfiction": "Nonfiction",
    # v2: orphan "Neuro" left after camel-splitting "NeuroScience" -> Neuroscience
    "neuro": "Neuroscience",
}

# Parent classification (all values are categories actually present in the data)
FICTION_CATS = {
    "Fiction", "Historical Fiction", "Science Fiction", "Fantasy", "Romance",
    "Mystery & Crime", "Thriller & Suspense", "Action & Adventure", "Dystopian",
    "Paranormal", "Horror", "Comics", "Manga", "Poetry", "Time Travel", "Space Opera",
    "Steampunk", "Urban Fantasy", "Epic Fantasy", "Alternate History", "Christian Fiction",
    "New Adult", "Historical Romance", "Contemporary Romance", "Paranormal Romance",
    "Romantic Suspense", "Legal Thriller", "Cozy Mysteries", "Historical Mysteries",
}
NONFICTION_CATS = {
    "Nonfiction", "Business", "Personal Development", "Psychology", "Science", "History",
    "Philosophy", "Art", "Politics", "Finance", "Personal Finance", "Spirituality",
    "Health", "Mental Health", "Nutrition", "Sports", "Programming", "Technology",
    "Artificial Intelligence", "Travel", "Humor", "Parenting", "Relationships & Family",
    "Leadership", "Management", "Entrepreneurship", "Writing", "Design", "Nature",
    "Sociology", "Social Sciences", "Math", "Physics", "Biology", "Astronomy",
    "Photography", "Film", "Music", "Architecture", "Fashion", "Gardening", "Environment",
    "Education", "Hobbies", "Buddhism", "American History", "Art History", "Law",
    "Espionage", "Food", "Chess", "Baseball", "Military", "Neuroscience",
}
CROSSCUT_CATS = {"Children's", "Teen & Young Adult", "Adult", "LGBTQ"}


def parent_of(cat: str) -> str:
    if cat in FICTION_CATS:
        return "Fiction"
    if cat in NONFICTION_CATS:
        return "Nonfiction"
    if cat in CROSSCUT_CATS:
        return "Cross-cut"
    return "Other"


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def clean(v: Any) -> str:
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v)).strip()


def slugify(text: str) -> str:
    text = (text or "").strip().lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[''`]", "", text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text


def split_camel(text: str) -> List[str]:
    text = text.strip()
    if not text:
        return []
    return [p.strip() for p in re.split(r"(?<=[a-z])(?=[A-Z])", text) if p.strip()]


def canon_token(tok: str) -> Optional[str]:
    """Canonicalize a single category token. Returns None to drop it."""
    t = clean(tok).strip(",.").strip()
    if not t or t == "." or len(t) < 2:
        return None
    low = t.lower()
    if low in TOKEN_FIXES:
        return TOKEN_FIXES[low]
    key = low.replace(" ", "").replace("-", "")
    if key in KNOWN_MULTIWORD:
        return KNOWN_MULTIWORD[key]
    # Title-case but preserve apostrophes/ampersands as written
    return t


def clean_categories(raw: str) -> List[str]:
    """Parse a raw category string into a list of canonical categories.
    Handles comma-separated AND merged-word (camelCase) AND dotted (Comics.) forms."""
    out: List[str] = []
    seen = set()
    if not raw:
        return out
    raw = str(raw)
    # First split on commas and dots
    pieces: List[str] = []
    for chunk in re.split(r"[,•]", raw):
        chunk = chunk.strip()
        if not chunk:
            continue
        # dotted forms: "Comics.Fiction" -> ["Comics","Fiction"]
        for sub in chunk.split("."):
            sub = sub.strip()
            if sub:
                pieces.append(sub)
    # Then split merged camelCase, preserving known multiwords first
    for p in pieces:
        # try to extract known multiwords embedded inside merged tokens
        resolved = resolve_merged(p)
        for r in resolved:
            c = canon_token(r)
            if c and c.lower() not in seen:
                seen.add(c.lower())
                out.append(c)
    return out


def resolve_merged(text: str) -> List[str]:
    """Split a possibly-merged token like 'ManagementLeadership' or
    'BuddhismSpirituality' into parts, preserving known multiword phrases."""
    t = text.strip()
    if not t:
        return []
    # v2: split a leading all-caps "LGBTQ" acronym from the following Capitalized word(s).
    # camelCase splitting only breaks lower->upper, so "LGBTQFiction" (upper->upper) slips
    # through. Peel "LGBTQ" off and resolve the remainder. -> ["LGBTQ", "Fiction"].
    if re.match(r'^LGBTQ[A-Z]', t):
        return ["LGBTQ"] + resolve_merged(t[5:])
    key = t.lower().replace(" ", "").replace("-", "")
    if key in KNOWN_MULTIWORD:
        return [KNOWN_MULTIWORD[key]]
    # locate known multiword phrases inside the string (case-insensitive)
    found: List[Tuple[int, int, str]] = []
    work = t
    for norm_key, canon in sorted(KNOWN_MULTIWORD.items(), key=lambda x: -len(x[1])):
        phrase = canon
        pat = re.compile(re.escape(phrase), re.IGNORECASE)
        m = pat.search(work)
        while m:
            found.append((m.start(), m.end(), canon))
            work = work[:m.start()] + ("\x00" * (m.end() - m.start())) + work[m.end():]
            m = pat.search(work)
    pieces: List[str] = []
    found.sort()
    pos = 0
    while pos < len(t):
        nxt = next((sp for sp in found if sp[0] >= pos), None)
        if nxt is None:
            pieces.extend(split_camel(t[pos:]))
            break
        if nxt[0] > pos:
            pieces.extend(split_camel(t[pos:nxt[0]]))
        pieces.append(nxt[2])
        pos = nxt[1]
    # v2: peel a leading "LGBTQ" from any piece — camelCase splitting cannot break the
    # upper→upper boundary in tokens like "LGBTQAdult" that arrive mid-string
    # (e.g. source cell "RomanceLGBTQAdult" → "Romance" + "LGBTQAdult").
    expanded: List[str] = []
    for p in pieces:
        pp = p.strip()
        if re.match(r'^LGBTQ[A-Z]', pp):
            expanded.append("LGBTQ")
            expanded.extend(split_camel(pp[5:]))
        elif pp:
            expanded.append(pp)
    return [p for p in expanded if p.strip()]


RATING_RE = re.compile(r"([0-9]+(?:\.[0-9]+)?)\s*\((\d[\d,]*)\)")


def parse_rating(raw: str) -> Tuple[Optional[float], Optional[int]]:
    """'3.8 (369)' -> (3.8, 369). Handles leading newline. Returns (None, None) if absent."""
    if not raw:
        return None, None
    s = str(raw).strip()
    m = RATING_RE.search(s)
    if m:
        try:
            rating = float(m.group(1))
            count = int(m.group(2).replace(",", ""))
            if 0 < rating <= 5:
                return rating, count
        except ValueError:
            return None, None
    # bare number
    m2 = re.match(r"^\s*([0-9]+(?:\.[0-9]+)?)\s*$", s)
    if m2:
        try:
            r = float(m2.group(1))
            if 0 < r <= 5:
                return r, None
        except ValueError:
            pass
    return None, None


def split_source_urls(raw: str) -> List[str]:
    """v2: split a recommendation source cell into clean individual URLs.
    Handles:
      - ' | ' separated
      - ',%20'/', '/',' separated (when followed by http)
      - adjacent concatenated 'http...http...' with no separator
    Does NOT split:
      - web.archive.org URLs (the embedded http:// is part of the archive path)
      - encoded params like '?ref_url=https%3A%2F%2F...' (no literal '://', so untouched)
    Returns deduped list of validated http(s) URLs (may be empty)."""
    if not raw:
        return []
    s = str(raw).strip()
    if not s:
        return []
    # 1) explicit separators: pipe, or comma(+optional %20/space) immediately before http
    chunks = re.split(r'\s*\|\s*|,\s*(?:%20)?\s*(?=https?://)', s)
    out: List[str] = []
    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
        # 2) archive.org legitimately embeds a second http:// — keep whole
        if "web.archive.org" in chunk:
            out.append(chunk)
            continue
        # 3) adjacent concatenation: boundary before a literal http(s):// preceded by non-space.
        #    encoded '%2F%2F' params never contain a literal '://', so they are safe.
        for sub in re.split(r'(?<=\S)(?=https?://)', chunk):
            sub = sub.strip()
            if sub:
                out.append(sub)
    # validate + normalize + dedupe
    seen = set()
    final: List[str] = []
    for u in out:
        u = u.strip().strip(",").strip()
        while u.endswith("%20"):
            u = u[:-3].strip()
        if not u.lower().startswith("http"):
            continue
        if u not in seen:
            seen.add(u)
            final.append(u)
    return final


def clean_slug_field(raw: str) -> List[str]:
    """Parse the URL column (list slug). May be pipe-joined. Canonicalize comma-junk slugs."""
    out = []
    seen = set()
    if not raw:
        return out
    for piece in str(raw).split("|"):
        piece = piece.strip()
        if not piece:
            continue
        # canonicalize: lowercase, commas/spaces -> hyphen
        s = piece.lower().replace(",", " ")
        s = re.sub(r"[^a-z0-9]+", "-", s)
        s = re.sub(r"-{2,}", "-", s).strip("-")
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def title_from_slug(slug: str) -> str:
    """best-leadership-books -> Leadership ; best-books-on-writing -> Writing"""
    s = slug
    s = re.sub(r"^best-", "", s)
    s = re.sub(r"^books-on-", "", s)
    s = re.sub(r"-books$", "", s)
    s = re.sub(r"^books-", "", s)
    s = s.replace("-", " ").strip()
    # Title case, keep small words lower except first
    if not s:
        return slug
    return " ".join(w.capitalize() for w in s.split())


def norm_person_name(raw: str) -> str:
    n = clean(raw)
    for prefix in ["books recommended by ", "Books Written by ", "books written by ",
                   "Books Recommended by ", "Book Recommended by "]:
        if n.lower().startswith(prefix.lower()):
            n = n[len(prefix):].strip()
            break
    return n


def book_key(title: str, author: str) -> str:
    return slugify(title) + "::" + slugify(author)


# ─────────────────────────────────────────────────────────────────────────────
# Workbook reading
# ─────────────────────────────────────────────────────────────────────────────

def header_index(header: Tuple, *names: str) -> Optional[int]:
    low = [str(h).strip().lower() if h is not None else "" for h in header]
    for nm in names:
        for i, h in enumerate(low):
            if h == nm.lower():
                return i
    return None


def iter_tab(wb, tab_name: str):
    ws = wb[tab_name]
    it = ws.iter_rows(values_only=True)
    header = next(it, None)
    return header, it


# ─────────────────────────────────────────────────────────────────────────────
# Main rebuild
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workbook", required=True)
    ap.add_argument("--out", default="rebuild_v1")
    ap.add_argument("--limit", type=int, default=0, help="Debug: cap rows per tab (0 = all).")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    print(f"[rebuild] reading {args.workbook}")
    wb = openpyxl.load_workbook(args.workbook, read_only=True, data_only=True)

    # Book registry: key -> book dict
    books: Dict[str, Dict[str, Any]] = {}
    book_order: List[str] = []
    # Memberships
    book_list_memberships: List[Tuple[str, str, Optional[int]]] = []  # (book_key, list_slug, rank)
    list_titles: Dict[str, str] = {}
    book_series_memberships: List[Tuple[str, str, Optional[int]]] = []  # (book_key, series_slug, pos)
    series_titles: Dict[str, str] = {}
    # People
    people: Dict[str, Dict[str, Any]] = {}  # name -> profile
    recommendations: List[Dict[str, Any]] = []  # book_key, person, source_url, comment, date
    authorships: List[Tuple[str, str]] = []  # (book_key, person)
    # category co-membership for parent inference
    book_categories: Dict[str, set] = defaultdict(set)

    stats: Counter = Counter()

    def upsert_book(title, subtitle, author, description, rating_raw, rating_link,
                    publish_date, image, amazon):
        title = clean(title)
        author = clean(author)
        if not title:
            return None
        k = book_key(title, author)
        b = books.get(k)
        rating, rcount = parse_rating(rating_raw)
        if b is None:
            b = {
                "key": k,
                "title": title,
                "subtitle": clean(subtitle),
                "author": author,
                "description": clean(description),
                "rating": rating,
                "ratings_count": rcount,
                "rating_link": clean(rating_link),
                "publish_date": clean(publish_date),
                "image": clean(image),
                "amazon": clean(amazon),
            }
            books[k] = b
            book_order.append(k)
        else:
            # enrich missing fields, keep best rating (most votes)
            if not b["subtitle"] and clean(subtitle):
                b["subtitle"] = clean(subtitle)
            if not b["description"] and clean(description):
                b["description"] = clean(description)
            if not b["image"] and clean(image):
                b["image"] = clean(image)
            if not b["amazon"] and clean(amazon):
                b["amazon"] = clean(amazon)
            if not b["publish_date"] and clean(publish_date):
                b["publish_date"] = clean(publish_date)
            if rating is not None:
                if b["rating"] is None or (rcount or 0) > (b["ratings_count"] or 0):
                    b["rating"] = rating
                    b["ratings_count"] = rcount
                    if clean(rating_link):
                        b["rating_link"] = clean(rating_link)
        return k

    def cap(it):
        if args.limit <= 0:
            return it
        def g():
            for i, row in enumerate(it):
                if i >= args.limit:
                    break
                yield row
        return g()

    # ---- All Books ----
    print("[rebuild] All Books")
    hdr, it = iter_tab(wb, "All Books")
    ix = {n: header_index(hdr, n) for n in
          ["Title", "Sub-title", "URL", "Author", "Book Repeating in Category",
           "Description", "Rating", "Rating_link", "Publish Date", "Image", "Amazon"]}
    for row in cap(it):
        def g(name):
            i = ix[name]
            return row[i] if i is not None and i < len(row) else None
        k = upsert_book(g("Title"), g("Sub-title"), g("Author"), g("Description"),
                        g("Rating"), g("Rating_link"), g("Publish Date"), g("Image"), g("Amazon"))
        if not k:
            stats["allbooks_skipped_no_title"] += 1
            continue
        stats["allbooks_rows"] += 1
        for slug in clean_slug_field(g("URL")):
            book_list_memberships.append((k, slug, None))
            list_titles.setdefault(slug, title_from_slug(slug))
        for c in clean_categories(g("Book Repeating in Category")):
            book_categories[k].add(c)

    # ---- Lists ----
    print("[rebuild] Lists")
    hdr, it = iter_tab(wb, "Lists")
    ix = {n: header_index(hdr, n) for n in
          ["Title", "Sub-title", "URL", "Author", "Books Repeating in",
           "Description", "Rating", "Rating_link", "Publish Date", "Image", "Amazon"]}
    for row in cap(it):
        def g(name):
            i = ix[name]
            return row[i] if i is not None and i < len(row) else None
        k = upsert_book(g("Title"), g("Sub-title"), g("Author"), g("Description"),
                        g("Rating"), g("Rating_link"), g("Publish Date"), g("Image"), g("Amazon"))
        if not k:
            continue
        stats["lists_rows"] += 1
        for slug in clean_slug_field(g("URL")):
            book_list_memberships.append((k, slug, None))
            list_titles.setdefault(slug, title_from_slug(slug))
        for c in clean_categories(g("Books Repeating in")):
            book_categories[k].add(c)

    # ---- Series ----
    print("[rebuild] Series")
    hdr, it = iter_tab(wb, "Series")
    ix = {n: header_index(hdr, n) for n in
          ["heading", "title", "sub_title", "Series", "author", "Description",
           "rating", "rating_link", "published", "image", "amazon"]}
    for row in cap(it):
        def g(name):
            i = ix[name]
            return row[i] if i is not None and i < len(row) else None
        k = upsert_book(g("title"), g("sub_title"), g("author"), g("Description"),
                        g("rating"), g("rating_link"), g("published"), g("image"), g("amazon"))
        if not k:
            continue
        stats["series_rows"] += 1
        series_name = clean(g("Series")) or clean(g("heading"))
        if series_name:
            sslug = slugify(series_name)
            book_series_memberships.append((k, sslug, None))
            series_titles.setdefault(sslug, series_name)

    # ---- People + People More (recommendations) ----
    for tab in ["People", "People More"]:
        print(f"[rebuild] {tab}")
        hdr, it = iter_tab(wb, tab)
        ix = {n: header_index(hdr, n) for n in
              ["person_name", "about", "twitter", "facebook", "linkedin", "instagram",
               "website", "youtube", "Title", "title", "sub_title", "author", "Author",
               "Book Repeating in", "Description", "rating", "Rating_link", "published",
               "image", "amazon", "commentDate", "Recommendation Comment", "comment", "source"]}
        for row in cap(it):
            def g(*names):
                for nm in names:
                    i = ix.get(nm)
                    if i is not None and i < len(row) and row[i] not in (None, ""):
                        return row[i]
                return None
            pname = norm_person_name(g("person_name"))
            if pname and pname not in people:
                people[pname] = {
                    "name": pname,
                    "bio": clean(g("about")),
                    "twitter": clean(g("twitter")),
                    "facebook": clean(g("facebook")),
                    "linkedin": clean(g("linkedin")),
                    "instagram": clean(g("instagram")),
                    "website": clean(g("website")),
                    "youtube": clean(g("youtube")),
                }
            k = upsert_book(g("Title", "title"), g("sub_title"), g("author", "Author"),
                            g("Description"), g("rating"), g("Rating_link"),
                            g("published"), g("image"), g("amazon"))
            if not k:
                continue
            stats[f"{tab}_rows"] += 1
            for c in clean_categories(g("Book Repeating in")):
                book_categories[k].add(c)
            src = clean(g("source"))
            comment = clean(g("Recommendation Comment", "comment"))
            rec_at = clean(g("commentDate"))
            # v2: split joined source cells into one clean URL per recommendation row.
            urls = split_source_urls(src)
            if urls:
                for u in urls:
                    recommendations.append({
                        "book_key": k, "person": pname, "source_url": u,
                        "comment": comment, "recommended_at": rec_at,
                    })
            else:
                recommendations.append({
                    "book_key": k, "person": pname, "source_url": "",
                    "comment": comment, "recommended_at": rec_at,
                })

    # ---- People Written Books ----
    print("[rebuild] People Written Books")
    hdr, it = iter_tab(wb, "People Written Books")
    ix = {n: header_index(hdr, n) for n in
          ["person_name", "about", "twitter", "facebook", "linkedin", "instagram",
           "website", "youtube", "title", "sub_title", "Author", "Description",
           "rating", "published", "image", "amazon"]}
    for row in cap(it):
        def g(*names):
            for nm in names:
                i = ix.get(nm)
                if i is not None and i < len(row) and row[i] not in (None, ""):
                    return row[i]
            return None
        pname = norm_person_name(g("person_name"))
        if pname and pname not in people:
            people[pname] = {
                "name": pname, "bio": clean(g("about")), "twitter": clean(g("twitter")),
                "facebook": clean(g("facebook")), "linkedin": clean(g("linkedin")),
                "instagram": clean(g("instagram")), "website": clean(g("website")),
                "youtube": clean(g("youtube")),
            }
        k = upsert_book(g("title"), g("sub_title"), g("Author"), g("Description"),
                        g("rating"), None, g("published"), g("image"), g("amazon"))
        if not k:
            continue
        stats["written_rows"] += 1
        if pname:
            authorships.append((k, pname))

    # ---- MRB Recommendations (curated list, no person) ----
    print("[rebuild] MRB Recommendations")
    hdr, it = iter_tab(wb, "MRB Recommendations ")
    ix = {n: header_index(hdr, n) for n in
          ["Title", "Sub-title", "Category", "Author", "Description", "Rating",
           "Rating_link", "Publish Date", "Image", "Amazon", "Recommendation Comment"]}
    MRB_SLUG = "most-recommended-books"
    list_titles.setdefault(MRB_SLUG, "Most Recommended Books")
    for row in cap(it):
        def g(name):
            i = ix[name]
            return row[i] if i is not None and i < len(row) else None
        k = upsert_book(g("Title"), g("Sub-title"), g("Author"), g("Description"),
                        g("Rating"), g("Rating_link"), g("Publish Date"), g("Image"), g("Amazon"))
        if not k:
            continue
        stats["mrb_rows"] += 1
        book_list_memberships.append((k, MRB_SLUG, None))
        for c in clean_categories(g("Category")):
            book_categories[k].add(c)

    wb.close()

    # ── Assign IDs + slugs ──
    print("[rebuild] assigning ids/slugs")
    used_slugs: set = set()
    for i, k in enumerate(book_order, 1):
        b = books[k]
        b["book_id"] = f"book_{i:06d}"
        base = slugify(b["title"]) or f"book-{i}"
        s = base
        n = 2
        while s in used_slugs:
            s = f"{base}-{n}"
            n += 1
        used_slugs.add(s)
        b["slug"] = s
        b["author_slug"] = slugify(b["author"]) if b["author"] else ""
        # primary type from categories
        cats = book_categories.get(k, set())
        parents = Counter(parent_of(c) for c in cats if parent_of(c) in ("Fiction", "Nonfiction"))
        b["primary_type"] = parents.most_common(1)[0][0] if parents else "Unknown"
        b["categories"] = sorted(cats)

    bk2id = {k: books[k]["book_id"] for k in book_order}
    bk2slug = {k: books[k]["slug"] for k in book_order}

    # ── People ids/slugs ──
    person_slug: Dict[str, str] = {}
    used_pslug: set = set()
    for i, (name, prof) in enumerate(sorted(people.items()), 1):
        base = slugify(name) or f"person-{i}"
        s = base
        n = 2
        while s in used_pslug:
            s = f"{base}-{n}"
            n += 1
        used_pslug.add(s)
        prof["slug"] = s
        prof["person_id"] = f"person_{i:06d}"
        person_slug[name] = s

    # ── List rows (dedupe memberships, compute counts + parent) ──
    list_member_set = set()
    list_books: Dict[str, set] = defaultdict(set)
    for (k, slug, rank) in book_list_memberships:
        if (k, slug) in list_member_set:
            continue
        list_member_set.add((k, slug))
        list_books[slug].add(k)
    # list parent = majority parent of member books' categories
    list_parent: Dict[str, str] = {}
    for slug, members in list_books.items():
        pc = Counter()
        for k in members:
            for c in book_categories.get(k, set()):
                p = parent_of(c)
                if p in ("Fiction", "Nonfiction"):
                    pc[p] += 1
        list_parent[slug] = pc.most_common(1)[0][0] if pc else "Unknown"

    # ── Series rows ──
    series_member_set = set()
    series_books: Dict[str, set] = defaultdict(set)
    for (k, sslug, pos) in book_series_memberships:
        if (k, sslug) in series_member_set:
            continue
        series_member_set.add((k, sslug))
        series_books[sslug].add(k)

    # ── recommendation counts per book ──
    rec_people_per_book: Dict[str, set] = defaultdict(set)
    for r in recommendations:
        if r["person"]:
            rec_people_per_book[r["book_key"]].add(r["person"])

    # ─────────────────────────────────────────────────────────────────────
    # Write outputs
    # ─────────────────────────────────────────────────────────────────────
    out = args.out
    print(f"[rebuild] writing CSVs to {out}/")

    def w(path, header, rows):
        with open(os.path.join(out, path), "w", newline="", encoding="utf-8") as f:
            cw = csv.writer(f)
            cw.writerow(header)
            cw.writerows(rows)

    # books.csv
    w("books.csv",
      ["book_id", "slug", "title", "subtitle", "author", "author_slug", "primary_type",
       "categories", "rating", "ratings_count", "cover_image", "amazon_url",
       "goodreads_url", "publish_date", "recommendation_count", "description"],
      [[b["book_id"], b["slug"], b["title"], b["subtitle"], b["author"], b["author_slug"],
        b["primary_type"], " | ".join(b["categories"]),
        b["rating"] if b["rating"] is not None else "",
        b["ratings_count"] if b["ratings_count"] is not None else "",
        b["image"], b["amazon"], b["rating_link"], b["publish_date"],
        len(rec_people_per_book.get(k, set())), b["description"]]
       for k in book_order for b in [books[k]]])

    # lists.csv
    w("lists.csv",
      ["list_id", "slug", "title", "parent_category", "book_count"],
      [[f"list_{i:05d}", slug, list_titles.get(slug, title_from_slug(slug)),
        list_parent.get(slug, "Unknown"), len(list_books[slug])]
       for i, slug in enumerate(sorted(list_books.keys()), 1)])

    # book_lists.csv
    list_slug2id = {slug: f"list_{i:05d}" for i, slug in enumerate(sorted(list_books.keys()), 1)}
    w("book_lists.csv",
      ["book_id", "list_id", "list_slug", "rank"],
      [[bk2id[k], list_slug2id[slug], slug, ""]
       for (k, slug) in sorted(list_member_set)])

    # series.csv
    series_slug2id = {slug: f"series_{i:05d}" for i, slug in enumerate(sorted(series_books.keys()), 1)}
    w("series.csv",
      ["series_id", "slug", "title", "book_count"],
      [[series_slug2id[slug], slug, series_titles.get(slug, slug), len(series_books[slug])]
       for slug in sorted(series_books.keys())])

    # book_series.csv
    w("book_series.csv",
      ["book_id", "series_id", "series_slug", "position"],
      [[bk2id[k], series_slug2id[slug], slug, ""]
       for (k, slug) in sorted(series_member_set)])

    # people.csv
    w("people.csv",
      ["person_id", "slug", "name", "bio", "twitter", "facebook", "linkedin",
       "instagram", "website", "youtube"],
      [[prof["person_id"], prof["slug"], prof["name"], prof["bio"], prof["twitter"],
        prof["facebook"], prof["linkedin"], prof["instagram"], prof["website"], prof["youtube"]]
       for name, prof in sorted(people.items())])

    # book_recommendations.csv (one row per recommendation, own source_url)
    seen_rec = set()
    rec_rows = []
    for r in recommendations:
        pslug = person_slug.get(r["person"], "")
        sig = (r["book_key"], r["person"], r["source_url"])
        if sig in seen_rec:
            continue
        seen_rec.add(sig)
        rec_rows.append([bk2id[r["book_key"]], bk2slug[r["book_key"]],
                         r["person"], pslug, r["source_url"], r["recommended_at"], r["comment"]])
    w("book_recommendations.csv",
      ["book_id", "book_slug", "person_name", "person_slug", "source_url", "recommended_at", "quote"],
      rec_rows)

    # book_authors.csv
    seen_auth = set()
    auth_rows = []
    for (k, pname) in authorships:
        sig = (k, pname)
        if sig in seen_auth:
            continue
        seen_auth.add(sig)
        auth_rows.append([bk2id[k], person_slug.get(pname, ""), pname])
    w("book_authors.csv", ["book_id", "person_slug", "person_name"], auth_rows)

    # categories.csv (the derived taxonomy)
    cat_counts: Counter = Counter()
    for k in book_order:
        for c in books[k]["categories"]:
            cat_counts[c] += 1
    w("categories.csv",
      ["category", "parent", "book_count"],
      [[c, parent_of(c), n] for c, n in cat_counts.most_common()])

    # master_list_clean.csv (flat, enrichment columns — same spirit as old master)
    book_lists_by_book: Dict[str, List[str]] = defaultdict(list)
    for (k, slug) in sorted(list_member_set):
        book_lists_by_book[k].append(slug)
    book_series_by_book: Dict[str, List[str]] = defaultdict(list)
    for (k, slug) in sorted(series_member_set):
        book_series_by_book[k].append(series_titles.get(slug, slug))
    recs_by_book: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in recommendations:
        recs_by_book[r["book_key"]].append(r)
    authors_by_book: Dict[str, List[str]] = defaultdict(list)
    for (k, pname) in authorships:
        authors_by_book[k].append(pname)

    w("master_list_clean.csv",
      ["book_id", "slug", "title", "subtitle", "author", "primary_type", "categories",
       "rating", "ratings_count", "cover_image", "amazon_url", "goodreads_url", "publish_date",
       "list_slugs", "list_count", "series_names", "series_count",
       "recommended_by_people", "recommendation_count", "recommendation_sources",
       "written_by_people", "description"],
      [[b["book_id"], b["slug"], b["title"], b["subtitle"], b["author"], b["primary_type"],
        " | ".join(b["categories"]),
        b["rating"] if b["rating"] is not None else "",
        b["ratings_count"] if b["ratings_count"] is not None else "",
        b["image"], b["amazon"], b["rating_link"], b["publish_date"],
        " | ".join(book_lists_by_book.get(k, [])), len(book_lists_by_book.get(k, [])),
        " | ".join(sorted(set(book_series_by_book.get(k, [])))), len(set(book_series_by_book.get(k, []))),
        " | ".join(sorted(rec_people_per_book.get(k, set()))),
        len(rec_people_per_book.get(k, set())),
        " | ".join(sorted({r["source_url"] for r in recs_by_book.get(k, []) if r["source_url"]})),
        " | ".join(sorted(set(authors_by_book.get(k, [])))),
        b["description"]]
       for k in book_order for b in [books[k]]])

    # ── Report ──
    fic = sum(1 for k in book_order if books[k]["primary_type"] == "Fiction")
    non = sum(1 for k in book_order if books[k]["primary_type"] == "Nonfiction")
    unk = sum(1 for k in book_order if books[k]["primary_type"] == "Unknown")
    with_rating = sum(1 for k in book_order if books[k]["rating"] is not None)
    with_image = sum(1 for k in book_order if books[k]["image"])
    rec_src = sum(1 for r in rec_rows if r[4])

    report = []
    report.append("# Rebuild Report\n")
    report.append(f"Source workbook: `{os.path.basename(args.workbook)}`\n")
    report.append("## Output tables\n")
    report.append(f"- books.csv — **{len(book_order):,}** unique books (dedup by normalized title+author)")
    report.append(f"- lists.csv — **{len(list_books):,}** distinct lists (fine-grained taxonomy)")
    report.append(f"- book_lists.csv — **{len(list_member_set):,}** book→list memberships")
    report.append(f"- series.csv — **{len(series_books):,}** series; book_series.csv — {len(series_member_set):,} memberships")
    report.append(f"- people.csv — **{len(people):,}** distinct people (with social profiles)")
    report.append(f"- book_recommendations.csv — **{len(rec_rows):,}** recommendations; {rec_src:,} with a real source URL ({100*rec_src/max(1,len(rec_rows)):.1f}%)")
    report.append(f"- book_authors.csv — {len(auth_rows):,} authorships")
    report.append(f"- categories.csv — {len(cat_counts):,} clean categories")
    report.append(f"- master_list_clean.csv — flat denormalized master with enrichment columns\n")
    report.append("## Coverage\n")
    report.append(f"- Books with rating: **{with_rating:,}** ({100*with_rating/max(1,len(book_order)):.1f}%)")
    report.append(f"- Books with cover image: **{with_image:,}** ({100*with_image/max(1,len(book_order)):.1f}%)")
    report.append(f"- primary_type: Fiction **{fic:,}** / Nonfiction **{non:,}** / Unknown {unk:,}\n")
    report.append("## Cleanup rules applied\n")
    report.append("1. Category case-fold: `NonFiction`/`Nonfiction`/`Non Fiction`/`non-fiction` → **Nonfiction**.")
    report.append("2. Trailing/leading commas and lone `.` categories dropped.")
    report.append("3. Merged-word categories split on lowercase→uppercase boundary, preserving known multiword names (Science Fiction, Social Sciences, etc.). e.g. `ManagementLeadership` → Management + Leadership.")
    report.append("4. Dotted forms (`Comics.Fiction`) split on `.`.")
    report.append("5. Truncated `ificial Intelligence` → **Artificial Intelligence**.")
    report.append("6. Rating `3.8 (369)` parsed into rating=3.8 + ratings_count=369.")
    report.append("7. List slug junk canonicalized: `best-Adult,-coloring-books` → `best-adult-coloring-books`.")
    report.append("8. Person-name prefixes stripped: `books recommended by X` / `Books Written by X` → X.")
    report.append("9. Books deduped by normalized (title, author); fields merged, highest-vote rating kept.")
    report.append("10. Per-recommendation source URLs preserved one-per-row (NOT pipe-joined).")
    report.append("11. [v2] Leading `LGBTQ` acronym split from following genre: `LGBTQFiction` → LGBTQ + Fiction (etc.).")
    report.append("12. [v2] `NeuroScience`/orphan `Neuro` → **Neuroscience** (classified Nonfiction).")
    report.append("13. [v2] Source cells split on `,%20`, `,`, and adjacent `http` boundaries into one clean URL per row; `web.archive.org` paths and `ref_url=` params are NOT split.\n")
    report.append("## Stats (raw rows read per tab)\n")
    for k, v in sorted(stats.items()):
        report.append(f"- {k}: {v:,}")
    with open(os.path.join(out, "REBUILD_REPORT.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")

    print("\n".join(report))
    print(f"\n[rebuild] DONE -> {out}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
