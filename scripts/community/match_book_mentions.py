#!/usr/bin/env python3
"""Find catalog books inside community comments (Reddit, Hacker News) and
aggregate them per book.

Input  : the folder written by arctic_shift_ingest.py / hn_ingest.py:
           <in>/<community>/<YYYY-MM>.posts.jsonl.gz      (threads)
           <in>/<community>/<YYYY-MM>.comments.jsonl.gz   (top-level replies)
         and a catalog JSON export of the books table
         (id, slug, title, author_name, recommendation_count, index_status).
Output : <out>/mentions.jsonl.gz   one row per (book, comment) match
         <out>/book_aggregates.jsonl one row per (book, source) — what the
                                    loader writes to book_community_mentions
         <out>/report.txt           top books + rule counts, for eyeballing

Matching is deliberately conservative — a wrong "recommended on Reddit"
claim on a book page is worse than a missed one:

  * The title is looked up as a whole phrase (leading "The/A/An" optional).
  * Author named in the same comment (surname, as a word)  -> accepted.
  * No author:
      - title must be written in Title Case or *formatted* in the comment, and
      - 3+ word titles: accepted when no other author shares the title;
      - 1-2 word titles: accepted only if, across the whole corpus, the phrase
        is almost always capitalised (so "Dune", "Circe", "Red Rising" pass,
        "Educated", "Home", "The Road" without McCarthy do not).
  * Titles shared by several authors with no author named -> skipped.
  * Each book counts once per thread (the best-scoring comment is kept).
"""
from __future__ import annotations

import argparse
import collections
import glob
import gzip
import json
import os
import re
import sys
import unicodedata
from multiprocessing import Pool

ARTICLES = {"the", "a", "an"}
SMALL = {"of", "the", "a", "an", "and", "in", "to", "for", "on", "with", "at", "by",
         "from", "or", "is", "it", "as", "into", "over", "but", "not", "no", "nor",
         "so", "up", "out", "my", "your", "our", "its", "his", "her", "their", "be", "&"}
# Titles that read as ordinary phrases in a sentence even when capitalised.
GENERIC = {
    "it", "us", "you", "me", "him", "her", "them", "this", "that", "now", "then",
    "love", "home", "life", "time", "work", "good", "bad", "yes", "no", "why",
    "the book", "book", "books", "the end", "the beginning", "what if", "one day",
    "i love you", "thank you", "the road", "the stand", "the shining", "the help",
    "the room", "the gift", "the game", "the list", "the plan", "the secret",
    "the way", "the truth", "the answer", "the one", "the others", "the boys",
    "the girls", "the family", "the house", "the city", "the war", "the fall",
    "the hunt", "the sun", "the moon", "the stars", "the sea", "the island",
    "the river", "the woods", "the forest", "the night", "the day", "the light",
    "the dark", "the darkness", "the edge", "the test", "the deal", "the choice",
    "the shift", "the change", "the hero", "the heroes", "the giver", "the reader",
    "the writer", "the teacher", "the student", "the master", "the guest",
    "the stranger", "the visitor", "the outsider", "the outsiders", "the wall",
    "the door", "the gate", "the bridge", "the tower", "the castle", "the crown",
    "the king", "the queen", "the prince", "the princess", "the witch", "the wolf",
    "the bear", "the lion", "the dog", "the cat", "the bird", "the horse",
    "the circle", "the bible", "the quran", "the odyssey", "the iliad",
    "how to", "why we", "what we", "who we", "the art", "the science",
    "the power", "the rules", "the law", "the system", "the process", "the trial",
    "the hours", "the years", "the past", "the future", "the present",
    "the last", "the first", "the next", "the other", "the new", "the old",
    "dark", "light", "night", "day", "summer", "winter", "spring", "autumn", "fall",
    "anything", "everything", "nothing", "something", "always", "never", "forever",
    "again", "tomorrow", "today", "yesterday", "more", "less", "enough",
    "free", "happy", "sad", "alone", "together", "friends", "family", "war",
    "peace", "money", "power", "grit", "focus", "habits", "drive", "quiet",
    "deep work", "start", "begin", "finish", "the end of", "the story", "story",
    "stories", "short stories", "the stories", "poems", "the poems", "essays",
    "fiction", "nonfiction", "fantasy", "horror", "romance", "history", "science",
    "philosophy", "psychology", "poetry", "the classics", "classics",
    "young adult", "the series", "series", "the trilogy", "trilogy", "the novel",
    "novel", "novels", "audiobook", "audiobooks", "kindle", "goodreads", "reddit",
    "netflix", "google", "amazon", "wikipedia", "youtube",
}
TOKEN = re.compile(r"[A-Za-z0-9]+(?:'[A-Za-z]+)?")
MAX_TITLE_TOKENS = 14
CASE_RATIO_SHORT = 0.85     # 1-2 word titles: share of corpus hits that are capitalised
CASE_MIN_HITS = 8           # ... and at least this many capitalised hits overall
SNIPPET = 280


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return (s.replace("’", "'").replace("‘", "'").replace("“", '"')
             .replace("”", '"').replace("&", " and "))


def norm_tokens(s: str) -> list[str]:
    return [t.lower().replace("'", "") for t in TOKEN.findall(fold(s))]


def title_key(title: str) -> tuple[str, ...]:
    # drop subtitle / (Series #1); a colon only splits when followed by a space ("4:50 From Paddington")
    t = title.strip()
    # a bracket in the MIDDLE of a title is dropped, not cut at: otherwise
    # "Discworld (Reformed) Vampyre's Diary 2003" would collect every "Discworld"
    t = re.sub(r"\s*[(\[][^)\]]*[)\]]\s*(?=\S)", " ", t)
    t = re.split(r"\s*:\s+|\s*[(\[]|\s+-\s+", t)[0]
    toks = norm_tokens(t)
    while toks and toks[0] in ARTICLES and len(toks) > 1:
        toks = toks[1:]
    return tuple(toks)


def surname(author: str) -> str | None:
    toks = [t for t in norm_tokens(author or "") if t not in {"jr", "sr", "ii", "iii", "phd", "md", "dr"}]
    if not toks:
        return None
    s = toks[-1]
    return s if len(s) >= 3 else None


# ----------------------------------------------------------------- catalog

def needs_author_keys(books, people_names=()) -> set[str]:
    """Title keys that must not count unless the book's author is named:
    titles made only of numbers ("24", "99", "1984"), and titles that are a
    person's name that is also an author in the catalog ("Marcus Aurelius")."""
    authors = {" ".join(norm_tokens(b.get("author_name") or "")) for b in books}
    authors |= {" ".join(norm_tokens(n)) for n in people_names}  # "Elon Musk" the biography
    out = set()
    for b in books:
        k = " ".join(title_key(b.get("title") or ""))
        if not k:
            continue
        if all(t.isdigit() for t in k.split()) or k in authors:
            out.add(k)
    return out


def load_catalog(path: str):
    books = json.load(open(path))
    by_key: dict[tuple, list[dict]] = collections.defaultdict(list)
    for b in books:
        k = title_key(b.get("title") or "")
        if not k or len(k) > MAX_TITLE_TOKENS or all(t in SMALL for t in k):
            continue
        if " ".join(k) in GENERIC:
            # still allow with an author named; marked generic
            pass
        b["_surname"] = surname(b.get("author_name") or "")
        by_key[k].append(b)
    first: dict[str, set[int]] = collections.defaultdict(set)
    for k in by_key:
        first[k[0]].add(len(k))
    # collapse duplicate editions: keep the strongest row per (key, surname)
    groups = {}
    for k, bs in by_key.items():
        best: dict[str | None, dict] = {}
        for b in bs:
            s = b["_surname"]
            cur = best.get(s)
            rank = ((b.get("recommendation_count") or 0), b.get("index_status") == "published",
                    -len(b.get("slug") or ""))
            if cur is None or rank > cur["_rank"]:
                b["_rank"] = rank
                best[s] = b
        groups[k] = [{"id": b["id"], "slug": b["slug"], "title": b["title"],
                      "author": b.get("author_name"), "surname": b["_surname"]}
                     for b in best.values()]
    return groups, {k: sorted(v, reverse=True) for k, v in first.items()}


# ----------------------------------------------------------------- matching

G = {}


def _init(catalog_path: str):
    G["groups"], G["first"] = load_catalog(catalog_path)


def formatted(raw: str, start: int, end: int) -> bool:
    before = raw[max(0, start - 2):start]
    after = raw[end:end + 2]
    return any(m in before for m in "*_\"'") and any(m in after for m in "*_\"'")


def capitalised(orig: list[str]) -> bool:
    words = [w for w in orig if w.lower() not in SMALL]
    if not words:
        return False
    caps = sum(1 for w in words if w[0].isupper() or w[0].isdigit())
    return caps / len(words) >= 0.75


def isolated(raw: str, spans, first: int, after: int) -> bool:
    """A short capitalised title must not sit inside a longer capitalised run."""
    if after < len(spans):
        nxt = spans[after][0]
        gap = raw[spans[after - 1][2]:spans[after][1]]
        if nxt[0].isupper() and nxt.lower() != "by" and not re.search(r"[.!?;:,()\n/-]", gap):
            return False
    if first > 0:
        prev = spans[first - 1][0]
        gap = raw[spans[first - 1][2]:spans[first][1]]
        before_prev = raw[max(0, spans[first - 1][1] - 3):spans[first - 1][1]]
        sentence_start = first - 1 == 0 or bool(re.search(r"[.!?\n]\s*$", before_prev))
        if prev[0].isupper() and not sentence_start and not re.search(r"[.!?;:,()\n/-]", gap):
            return False
    return True


def surname_used(sn: str, toks, spans, raw: str) -> bool:
    """The surname must end a name: "Nicholas" in "Nassim Nicholas Taleb" does not
    count, but "Frank Herbert\nNeuromancer" or "Herbert. Then" does."""
    for j, t in enumerate(toks):
        if t != sn:
            continue
        if j + 1 >= len(toks) or not spans[j + 1][0][0].isupper():
            return True
        gap = raw[spans[j][2]:spans[j + 1][1]]
        if re.search(r"[.!?;:,()\n/*_\"-]", gap) or spans[j + 1][0].lower() in SMALL:
            return True
    return False


def match_comment(body: str):
    groups, first = G["groups"], G["first"]
    raw = fold(body)
    spans = [(m.group(0), m.start(), m.end()) for m in TOKEN.finditer(raw)]
    toks = [s[0].lower().replace("'", "") for s in spans]
    tokset = set(toks)
    out = []
    i, n = 0, len(toks)
    while i < n:
        lens = first.get(toks[i])
        hit = None
        if lens:
            for L in lens:  # longest first
                if i + L <= n and tuple(toks[i:i + L]) in groups:
                    hit = (L, tuple(toks[i:i + L]))
                    break
        if not hit:
            i += 1
            continue
        L, key = hit
        # include a leading article in the original span if present
        s0 = i - 1 if i > 0 and toks[i - 1] in ARTICLES else i
        orig = [s[0] for s in spans[s0:i + L]]
        cstart, cend = spans[s0][1], spans[i + L - 1][2]
        cands = groups[key]
        named = [b for b in cands if b["surname"] and b["surname"] in tokset
                 and b["surname"] not in key  # the surname must not just be part of the title
                 and surname_used(b["surname"], toks, spans, raw)]
        is_cap = capitalised(orig)
        is_fmt = formatted(raw, cstart, cend)
        if is_cap and not is_fmt and len(key) <= 2 and not isolated(raw, spans, s0, i + L):
            is_cap = False  # "James Herriot", "Madeline Miller": part of a longer name
        if is_cap and len(key) == 1 and len(orig[-1]) <= 5 and orig[-1].isupper():
            is_cap = False  # acronyms: "VC", "AI", "IT"
        if named and (len(key) >= 3 or is_cap or is_fmt) and " ".join(key) not in {"it", "us", "you", "me"}:
            b = named[0]
            rule = "author"
        elif len({b["surname"] for b in cands}) == 1:
            b = cands[0]
            rule = f"title{min(len(key), 3)}"
        else:
            b, rule = None, "ambiguous"
        out.append({"book_id": b["id"] if b else None, "key": " ".join(key), "rule": rule,
                    "cap": is_cap or is_fmt, "pos": cstart})
        i += L
    return out


def snippet(body: str, pos: int) -> str:
    text = re.sub(r"\s+", " ", fold(body)).strip()
    if len(text) <= SNIPPET:
        return text
    start = max(0, min(pos - 80, len(text) - SNIPPET))
    cut = text[start:start + SNIPPET]
    if start > 0:
        cut = "…" + cut[cut.find(" ") + 1:]
    return cut.rsplit(" ", 1)[0] + "…"


def process_file(args):
    path, community, source = args
    threads = {}
    pposts = path.replace(".comments.", ".posts.")
    if os.path.exists(pposts):
        with gzip.open(pposts, "rt", encoding="utf-8") as f:
            for line in f:
                p = json.loads(line)
                threads[p["id"]] = p
    rows, case_stats = [], collections.Counter()
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            c = json.loads(line)
            if c.get("link_id") not in threads:
                continue
            for m in match_comment(c.get("body") or ""):
                if m["rule"] in ("title1", "title2"):
                    case_stats[(m["key"], m["cap"])] += 1
                if m["book_id"] is None:
                    continue
                if m["rule"] != "author" and not m["cap"]:
                    continue
                t = threads[c["link_id"]]
                rows.append({
                    "book_id": m["book_id"], "key": m["key"], "rule": m["rule"],
                    "source": source, "community": community,
                    "thread_id": c["link_id"], "thread_title": t.get("title"),
                    "thread_comments": t.get("num_comments"),
                    "comment_id": c["id"], "score": c.get("score") or 0,
                    "created_utc": c["created_utc"],
                    "snippet": snippet(c.get("body") or "", m["pos"]),
                })
    return rows, case_stats


# ----------------------------------------------------------------- aggregate

def _year(ts: int) -> int:
    import datetime
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).year


def permalink(source: str, community: str, thread_id: str, comment_id: str | None) -> str:
    if source == "reddit":
        base = f"https://www.reddit.com/r/{community}/comments/{thread_id}/"
        return base + (f"_/{comment_id}/" if comment_id else "")
    if source == "hackernews":
        return f"https://news.ycombinator.com/item?id={comment_id or thread_id}"
    return ""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="inp", action="append", required=True,
                    help="source=folder, e.g. reddit=data/reddit (repeatable)")
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--people", help="JSON list of people names; titles equal to a name need the author named")
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    jobs = []
    for spec in a.inp:
        source, folder = spec.split("=", 1)
        for p in sorted(glob.glob(os.path.join(folder, "*", "*.comments.jsonl.gz"))):
            jobs.append((p, os.path.basename(os.path.dirname(p)), source))
    print(f"{len(jobs)} comment files", flush=True)

    all_rows, case = [], collections.Counter()
    with Pool(a.workers, initializer=_init, initargs=(a.catalog,)) as pool:
        for k, (rows, cs) in enumerate(pool.imap_unordered(process_file, jobs, chunksize=4)):
            all_rows.extend(rows)
            case.update(cs)
            if k % 50 == 0:
                print(f"  {k}/{len(jobs)} files, {len(all_rows)} raw matches", flush=True)

    # corpus-level case test for 1-2 word titles without an author named
    def short_ok(key: str) -> bool:
        if key in GENERIC:
            return False
        capn, lown = case[(key, True)], case[(key, False)]
        return capn >= CASE_MIN_HITS and capn / max(1, capn + lown) >= CASE_RATIO_SHORT

    people = json.load(open(a.people)) if a.people else []
    needs_author = needs_author_keys(json.load(open(a.catalog)), people)
    kept = [r for r in all_rows
            if r["rule"] == "author"
            or (r["key"] not in needs_author and (
                (r["rule"] == "title3" and r["key"] not in GENERIC)
                or (r["rule"] in ("title1", "title2") and short_ok(r["key"]))))]

    # A title matched without its author must also be matched WITH its author
    # somewhere in the corpus. "Dune by Frank Herbert" appears often enough to
    # vouch for bare "Dune"; "Japan by <cookbook author>" never appears, so
    # mentions of the country do not count for the cookbook.
    with_author = collections.Counter(r["book_id"] for r in kept if r["rule"] == "author")
    bare = collections.Counter(r["book_id"] for r in kept if r["rule"] != "author")

    def vouched(r) -> bool:
        if r["rule"] == "author":
            return True
        need = 1 if r["rule"] == "title3" else max(2, int(0.03 * bare[r["book_id"]]))
        return with_author[r["book_id"]] >= need

    kept = [r for r in kept if vouched(r)]

    # one count per (book, thread): keep the best-scoring comment
    best: dict[tuple, dict] = {}
    for r in kept:
        k = (r["book_id"], r["source"], r["thread_id"])
        if k not in best or r["score"] > best[k]["score"]:
            best[k] = r

    with gzip.open(os.path.join(a.out, "mentions.jsonl.gz"), "wt", encoding="utf-8") as f:
        for r in best.values():
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    agg: dict[tuple, dict] = {}
    comments_per_book = collections.Counter((r["book_id"], r["source"]) for r in kept)
    for r in best.values():
        k = (r["book_id"], r["source"])
        a_ = agg.setdefault(k, {"book_id": r["book_id"], "source": r["source"], "thread_count": 0,
                                "upvotes": 0, "years": collections.Counter(),
                                "communities": collections.Counter(), "rows": []})
        a_["thread_count"] += 1
        a_["upvotes"] += max(0, r["score"])
        year = _year(r["created_utc"])
        a_["years"][year] += 1
        a_["communities"][r["community"]] += 1
        a_["rows"].append(r)

    out_rows = []
    for (book_id, source), a_ in agg.items():
        rows = a_["rows"]
        top_c = sorted(rows, key=lambda r: -r["score"])[:5]
        top_t = sorted(rows, key=lambda r: -(r.get("thread_comments") or 0))[:5]
        out_rows.append({
            "book_id": book_id, "source": source,
            "thread_count": a_["thread_count"],
            "comment_count": comments_per_book[(book_id, source)],
            "upvotes": a_["upvotes"],
            "first_year": min(a_["years"]), "last_year": max(a_["years"]),
            "by_year": {str(y): c for y, c in sorted(a_["years"].items())},
            "communities": dict(a_["communities"].most_common(8)),
            "top_comments": [{
                "community": r["community"], "score": r["score"], "year":
                    _year(r["created_utc"]),
                "thread_title": r["thread_title"], "snippet": r["snippet"],
                "url": permalink(r["source"], r["community"], r["thread_id"], r["comment_id"]),
            } for r in top_c],
            "top_threads": [{
                "community": r["community"], "title": r["thread_title"],
                "comments": r.get("thread_comments"),
                "year": _year(r["created_utc"]),
                "url": permalink(r["source"], r["community"], r["thread_id"], None),
            } for r in top_t],
        })
    # rank within each source by threads, then upvotes
    for source in {r["source"] for r in out_rows}:
        ranked = sorted((r for r in out_rows if r["source"] == source),
                        key=lambda r: (-r["thread_count"], -r["upvotes"]))
        for i, r in enumerate(ranked, 1):
            r["source_rank"] = i
    with open(os.path.join(a.out, "book_aggregates.jsonl"), "w", encoding="utf-8") as f:
        for r in out_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    titles = {b["id"]: f'{b["title"]} — {b.get("author_name")}' for b in json.load(open(a.catalog))}
    with open(os.path.join(a.out, "report.txt"), "w", encoding="utf-8") as f:
        f.write(f"raw matches {len(all_rows)}, kept {len(kept)}, book-thread pairs {len(best)}, "
                f"books {len({r['book_id'] for r in out_rows})}\n")
        f.write(f"rules kept: {collections.Counter(r['rule'] for r in kept)}\n\n")
        for source in sorted({r["source"] for r in out_rows}):
            f.write(f"== {source}\n")
            for r in sorted((r for r in out_rows if r["source"] == source),
                            key=lambda r: r["source_rank"])[:150]:
                f.write(f'{r["source_rank"]:4d} {r["thread_count"]:6d} threads {r["upvotes"]:7d} up  '
                        f'{titles.get(r["book_id"], r["book_id"])}\n')
    print(open(os.path.join(a.out, "report.txt")).read()[:3000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
