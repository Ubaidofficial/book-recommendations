import json, os, re, collections, unicodedata
# Inputs and outputs live in the gitignored reports/ folder.
HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "reports", "dedupe_20261112")


def L(t):
    return json.load(open(os.path.join(HERE, "data", t + ".json")))


books = L("books")
recs = L("book_recommendations")
bl = L("book_lists")
bs = L("book_series")
ba = L("book_authors")
people = L("people")
lists = L("lists")
byid = {b["id"]: b for b in books}
pub_people = {p["id"] for p in people if p["index_status"] == "published"}
pub_lists = {l["id"] for l in lists if l["index_status"] == "published"}
shown = {b["id"] for b in books if b["index_status"] == "published"}
shown |= {r["book_id"] for r in recs if r["person_id"] in pub_people}
shown |= {r["book_id"] for r in bl if r["list_id"] in pub_lists}
recs_by = collections.defaultdict(list)
for r in recs:
    recs_by[r["book_id"]].append(r)
lists_by = collections.defaultdict(list)
for r in bl:
    lists_by[r["book_id"]].append(r)
series_by = collections.defaultdict(list)
for r in bs:
    series_by[r["book_id"]].append(r)
authors_by = collections.defaultdict(list)
for r in ba:
    authors_by[r["book_id"]].append(r)


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def nt(t):
    """Normalised main title (before ':'), as in the measurement."""
    t = strip_accents(t or "").split(":")[0].lower()
    return re.sub(r"[^a-z0-9]", "", t)


def split_title(b):
    t = strip_accents(b["title"] or "")
    main, _, sub = t.partition(":")
    sub2 = strip_accents(b.get("subtitle") or "")
    if not sub.strip() and sub2.strip():
        sub = sub2
    return main, sub


def ntoks(s):
    s = strip_accents(s or "").lower().replace("&", " and ")
    return [w for w in re.split(r"[^a-z0-9]+", s) if w]


def g(b):
    return b.get
