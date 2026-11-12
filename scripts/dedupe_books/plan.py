"""Dry-run duplicate plan for books. Writes plan.csv / plan.json next to this file.

Pairwise "same book" test inside each normalised-title group, union-find into
clusters, then a complete-linkage check: every pair in a cluster must be free of
conflicts, else the cluster goes to REVIEW.
"""
import sys, os, re, csv, json, itertools, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

HON = {"dr", "prof", "professor", "sir", "dame", "general", "gen", "rev", "reverend", "mr", "mrs", "ms",
       "phd", "md", "jr", "sr", "ii", "iii", "iv", "esq", "lord", "lady", "saint", "st", "captain", "capt",
       "admiral", "colonel", "col", "major", "lt", "sgt", "president", "rabbi", "father", "pastor", "bishop",
       "the", "et", "al", "editor", "editors", "ed", "eds", "edited", "by", "translated", "translator", "trans",
       "foreword", "introduction", "illustrated", "illustrator", "mba", "cfa", "rn", "dds", "dvm", "psyd", "edd"}
# Pen names / transliterations treated as the same author (surname keys).
ALIASES = [
    {"rowling", "galbraith"},
    {"seuss", "lesieg", "geisel"},
    {"king", "bachman"},
    {"twain", "clemens"},
    {"orwell", "blair"},
    {"carroll", "dodgson"},
    {"dostoevsky", "dostoyevsky", "dostoevski", "dostoievski"},
    {"tolstoy", "tolstoi"},
    {"chekhov", "tchekhov", "chekov"},
    {"laozi", "tzu", "tse", "lao"},
    {"tzu", "sunzi", "sun"},
]
GENERIC_SUB = {"a novel", "novel", "a memoir", "a thriller", "a mystery", "a biography", "stories", "a novella",
               "a love story", "a romance", "poems", "essays", "a play"}
EDITION_WORDS = {"edition", "ed", "revised", "expanded", "updated", "anniversary", "new", "second", "third",
                 "fourth", "fifth", "sixth", "seventh", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th",
                 "9th", "10th", "20th", "25th", "30th", "40th", "50th", "and", "the", "paperback", "hardcover",
                 "kindle", "deluxe", "classics", "classic", "vintage", "penguin", "international", "reprint",
                 "unabridged", "mass", "market", "special", "tenth", "twentieth", "an", "a", "of", "in", "with",
                 "anniversary", "commemorative"}
STOP = {"the", "a", "an", "of", "and", "to", "in", "for", "on", "with", "how", "why", "what", "your", "you", "is",
        "from", "at", "by", "its", "it", "that", "this", "or", "as", "be", "are", "my", "our"}
# Words that mark a different product/work (adaptation, companion, format) when only one side has them.
MARKERS = ["graphic", "workbook", "summary", "study guide", "journal", "young readers", "young adult edition",
           "for kids", "for teens", "illustrated edition", "abridged", "sparknotes", "cliffsnotes",
           "summary and analysis", "box set", "boxed set", "omnibus", "coloring", "action guide",
           "discussion guide", "reader s guide", "readers guide", "teacher s guide", "teachers guide",
           "student edition", "answer key", "solutions manual", "complete works", "collected works",
           "selected works", "anthology", "sequel", "notebook", "planner", "screenplay", "the movie",
           "picture book", "adapted", "adaptation", "manga edition", "quotes", "deck", "card deck",
           "companion to", "a companion", "book two", "book three", "book four"]
SERIES_RE = re.compile(r"^(.*?)[,\s]*(?:book|volume|vol|part|no|#)\s*(\d+)\s*$")
GENERIC_TITLES = re.compile(r"^(vol|volume|book|part|no|issue|chapter|untitled)?\d*$")


def asin(u):
    m = re.search(r"/dp/([A-Z0-9]{10})", u or "")
    return m.group(1) if m else None


def name_parts(author):
    """Split an author string into a list of token lists, one per person."""
    s = strip_accents(author or "").lower()
    s = re.sub(r"\bet\.?\s*al\.?", " ", s)
    s = re.sub(r"\bph\.?\s?d\.?", " ", s)
    s = re.sub(r"\bm\.d\.", " ", s)
    s = s.replace("’", "'")
    parts = re.split(r"\s*(?:&|;|,|\band\b|\bwith\b|/|\+)\s*", s)
    out = []
    for p in parts:
        # collapse "j. r. r." -> "jrr"
        p = re.sub(r"\b([a-z])\.\s*(?=[a-z]\.)", r"\1", p)
        p = re.sub(r"\b([a-z])\s+(?=[a-z]\b)", r"\1", p) if re.search(r"\b[a-z]\s+[a-z]\b", p) else p
        toks = [t for t in re.split(r"[^a-z0-9']+", p) if t]
        toks = [t.replace("'", "") for t in toks]
        toks = [t for t in toks if t and t not in HON and not t.isdigit() and not re.fullmatch(r"\d+(st|nd|rd|th)", t)]
        if toks:
            out.append(toks)
    return out


def lev(a, b):
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def alias(a, b):
    return any(a in s and b in s for s in ALIASES)


def person_match(x, y):
    """Return 'strong', 'weak' or None for two token lists."""
    if "".join(x) == "".join(y) or set(x) == set(y):
        return "strong"
    sx, sy = x[-1], y[-1]
    gx, gy = x[:-1], y[:-1]
    sur_eq = sx == sy or (len(sx) >= 6 and len(sy) >= 6 and lev(sx, sy) <= (2 if min(len(sx), len(sy)) >= 9 else 1))
    # surname concatenated with hyphenated part (akenine moller / akeninemoller)
    if not sur_eq and ("".join(x).endswith(sy) or "".join(y).endswith(sx)) and min(len(sx), len(sy)) >= 5:
        sur_eq = True
    # surname typo with identical given name ("Pat Flynn"/"Pat Fynn", "Joel Fuhrman"/"Joel Furhman")
    if not sur_eq and gx and gy and gx[0] == gy[0] and len(gx[0]) >= 3 and min(len(sx), len(sy)) >= 4 \
            and (lev(sx, sy) <= 1 or sorted(sx) == sorted(sy)):
        return "strong"
    if not sur_eq:
        # "Zeratsky Jake Knapp" vs "Jake Knapp": all tokens of the shorter in the longer
        small, big = (x, y) if len(x) <= len(y) else (y, x)
        if len(small) >= 2 and set(small) <= set(big):
            return "strong"
        # reversed order "Moore Richard"
        if len(x) == 2 and len(y) == 2 and x == y[::-1]:
            return "strong"
        if alias(sx, sy):
            return "alias"
        return None
    if not gx or not gy:
        return "strong"  # one side surname-only ("General Mattis" -> "mattis")
    fx, fy = gx[0], gy[0]
    if fx == fy or fx.startswith(fy) or fy.startswith(fx):
        return "strong"
    if fx[0] == fy[0]:
        return "strong" if (len(fx) <= 3 or len(fy) <= 3 or lev(fx, fy) <= 2) else "weak"
    # token subset either way ("William Daniel Hillis" vs "Daniel Hillis")
    if set(gx) <= set(gy) or set(gy) <= set(gx):
        return "strong"
    if any(t in gy for t in gx if len(t) > 2):
        return "strong"
    return "weak"


def author_match(a, b):
    pa, pb = name_parts(a), name_parts(b)
    if not pa or not pb:
        return None, "missing author"
    best = None
    rank = {"strong": 3, "alias": 2, "weak": 1}
    for x in pa:
        for y in pb:
            m = person_match(x, y)
            if m and (best is None or rank[m] > rank[best]):
                best = m
    if best is None:
        # "Dalai Lama" vs "14th Dalai Lama" style: whole-string token subset
        ta = {t for p in pa for t in p}
        tb = {t for p in pb for t in p}
        if len(ta) >= 2 and len(tb) >= 2 and (ta <= tb or tb <= ta):
            best = "strong"
    return best, None


def norm_words(s):
    return [w for w in ntoks(s)]


def sub_info(sub):
    s = " ".join(norm_words(re.sub(r"\(.*?\)", " ", sub or "")))
    s = s.strip()
    if not s:
        return ("none", "", None)
    if s in GENERIC_SUB:
        return ("generic", s, None)
    m = SERIES_RE.match(s)
    if m:
        return ("series", m.group(1).strip(), int(m.group(2)))
    words = [w for w in s.split() if w not in EDITION_WORDS]
    if not words:
        return ("generic", s, None)
    return ("desc", s, None)


def jacc(a, b):
    A = {w for w in a.split() if w not in STOP}
    B = {w for w in b.split() if w not in STOP}
    if not A or not B:
        return 0.0
    return len(A & B) / len(A | B)


ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10,
         "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
         "first": 1, "second": 2, "third": 3}
VOL_RE = re.compile(r"\b(?:volume|vol|part|tome|bk)\s+([0-9]+|[ivx]+|one|two|three|four|five|six|seven|eight|nine|ten)\b")


def vol_numbers(b):
    """Volume/part numbers named in the title (not series 'Book N' metadata)."""
    s = " ".join(ntoks((b["title"] or "") + " " + (b.get("subtitle") or "")))
    out = set()
    for m in VOL_RE.finditer(s):
        t = m.group(1)
        out.add(int(t) if t.isdigit() else ROMAN.get(t, -1))
    # "Book One" in the title itself (series metadata "X, Book 2" lives in the subtitle field)
    for m in re.finditer(r"\bbook\s+([0-9]+|one|two|three|four|five|six|seven|eight|nine|ten)\b", " ".join(ntoks(b["title"] or ""))):
        t = m.group(1)
        out.add(int(t) if t.isdigit() else ROMAN.get(t, -1))
    return out


def title_conflict(a, b):
    ma, sa = split_title(a)
    mb, sb = split_title(b)
    fa = " " + " ".join(norm_words(ma + " " + sa + " " + (a.get("subtitle") or ""))) + " "
    fb = " " + " ".join(norm_words(mb + " " + sb + " " + (b.get("subtitle") or ""))) + " "
    for m in MARKERS:
        k = " " + m + " "
        if (k in fa) != (k in fb):
            return f"marker '{m}' on one side"
    # kids / junior editions are flagged in the author string too ("Lonely Planet Kids")
    xa = " " + " ".join(norm_words(a["author_name"])) + " "
    xb = " " + " ".join(norm_words(b["author_name"])) + " "
    for m in (" kids ", " junior "):
        if (m in xa) != (m in xb):
            return f"marker '{m.strip()}' on one side"
    # volume / part / book numbers anywhere in title + subtitle field
    va, vb = vol_numbers(a), vol_numbers(b)
    if va != vb and (va or vb) and not (va <= {1} and vb <= {1}):
        return f"volume numbers differ ({sorted(va)} vs {sorted(vb)})"
    ia, ib = sub_info(sa), sub_info(sb)
    if ia[0] == "series" and ib[0] == "series":
        if ia[2] != ib[2]:
            return f"series numbers differ ({ia[2]} vs {ib[2]})"
        if jacc(ia[1], ib[1]) < 0.34 and ia[1] and ib[1]:
            return "different series"
    if ia[0] == "desc" and ib[0] == "desc":
        x, y = ia[1], ib[1]
        xs = " ".join(w for w in x.split() if w not in EDITION_WORDS)
        ys = " ".join(w for w in y.split() if w not in EDITION_WORDS)
        xw, yw = x.split(), y.split()
        prefix = xw[:len(yw)] == yw or yw[:len(xw)] == xw
        if not (prefix or jacc(x, y) >= 0.4 or not xs or not ys):
            return f"different subtitles ('{sa.strip()[:40]}' vs '{sb.strip()[:40]}')"
    return None


def year_conflict(a, b):
    ya, yb = a["first_published_year"], b["first_published_year"]
    if ya and yb and abs(ya - yb) > 3:
        return f"years {ya} vs {yb}"
    return None


def pair(a, b):
    """Return (verdict, reason). verdict in SAME / CONFLICT / DIFFERENT / UNSURE."""
    tc = title_conflict(a, b)
    am, _ = author_match(a["author_name"], b["author_name"])
    same_asin = asin(a["amazon_url"]) and asin(a["amazon_url"]) == asin(b["amazon_url"])
    same_isbn = a["isbn_13"] and a["isbn_13"] == b["isbn_13"]
    yc = year_conflict(a, b)
    if tc:
        return ("DIFFERENT" if not am else "TITLE_CONFLICT", tc)
    if am is None:
        if same_asin and not yc:
            ma, sa = split_title(a)
            mb, sb = split_title(b)
            ia, ib = sub_info(sa), sub_info(sb)
            if ntoks(ma) == ntoks(mb) and ia[0] == "desc" and ib[0] == "desc":
                xw, yw = ia[1].split(), ib[1].split()
                short = xw if len(xw) <= len(yw) else yw
                long_ = yw if short is xw else xw
                if len(short) >= 3 and long_[:len(short)] == short:
                    ra, rb = len(recs_by[a["id"]]), len(recs_by[b["id"]])
                    sha, shb = a["id"] in shown, b["id"] in shown
                    if (ra, sha) != (rb, shb):
                        trusted = a if (ra, sha) > (rb, shb) else b
                        return ("SAME_PRODUCT", "same ASIN + identical title/subtitle; author on the other row looks wrong",
                                trusted["id"])
        if same_asin or same_isbn:
            return ("UNSURE", "authors differ but same Amazon product/ISBN")
        return ("DIFFERENT", "different authors")
    if yc:
        return ("UNSURE", yc)
    if not (same_asin or same_isbn):
        ma, sa = split_title(a)
        mb, sb = split_title(b)
        atoks = set(ntoks(a["author_name"])) | set(ntoks(b["author_name"]))
        if len(ntoks(ma)) == 1 and ntoks(ma)[0] in atoks and (sub_info(sa)[0] != "desc" or sub_info(sb)[0] != "desc"):
            return ("UNSURE", "eponymous one-word title (" + ma.strip() + ") without full subtitles or shared ASIN/ISBN")
    ev = []
    if same_asin:
        ev.append("same ASIN")
    if same_isbn:
        ev.append("same ISBN13")
    if am == "strong":
        return ("SAME", "author match" + ("; " + ", ".join(ev) if ev else ""))
    if am == "alias":
        return ("SAME", "known pen-name/transliteration" + ("; " + ", ".join(ev) if ev else ""))
    if am == "weak" and ev:
        return ("SAME", "surname match; " + ", ".join(ev))
    return ("UNSURE", "surname matches but given names differ, no shared ASIN/ISBN")


# REVIEW groups hand-checked on 2026-11-12 and confirmed to be one book.
# (ids to merge, ids that must not become canonical because their author field is wrong)
MANUAL = [
    (["037fbfd3-a9cf-4587-af48-a9db8818624d", "668404b8-18ac-4d64-a88a-171b094cb607"], ["037fbfd3-a9cf-4587-af48-a9db8818624d"]),  # The Living Gita
    (["05cc5226-4a01-4e5f-a9c1-b6d4585f5ae7", "a0d8b0bd-088a-4552-aeba-701070024819", "de5c9c18-7842-42c6-97f4-451229fdc45a"], []),  # Essays of Warren Buffett
    (["0bdc9c96-bf61-4121-b957-98fbefbbe9ea", "45041cae-6a7b-40e4-87f8-ce5154c8ad5a", "a7773211-0da9-4a6c-b97b-160ba05ff3dd"], []),  # Future Is Faster (Diamandis & Kotler)
    (["10c08c8c-5728-4650-ad43-60a2c4bdbcca", "256da89b-9b79-4ee5-ab1c-dcd853c537b5", "48056c1a-12c5-4204-a0dc-03a4ee68b040"], []),  # First, Break All the Rules
    (["1761c5e3-90d0-40af-aa12-9a0808d11f06", "7fa34615-b2de-4f7c-943d-b93f4ff186e8"], ["1761c5e3-90d0-40af-aa12-9a0808d11f06"]),  # Fluent Forever (Wyner)
    (["2975af79-bfcf-43fa-9ec0-6cf10cd388f3", "a8f2bdbe-d58a-4f45-9a7f-d43ea45af0bf", "cc16a48c-67ca-4a7e-b84f-7c5018af22b7"], ["2975af79-bfcf-43fa-9ec0-6cf10cd388f3"]),  # Hooked
    (["231642dc-4af4-43b5-9540-551aac5c76ae", "887d2c99-de9c-417f-956e-f44369b454e3", "c086c25d-a189-4892-b5a2-66f4ea701bff"], []),  # Forks Over Knives Plan
    (["2cdb1195-673e-4330-ad96-5f0d4de59dfa", "b0a5d258-676b-4f32-89c8-2f5c565ef7a4"], []),  # Flight or Fright (King & Vincent, eds.)
    (["46455457-9c0c-4063-8b83-b2b4ca866731", "cdd720df-ee83-41f8-9499-d9b21aa14d9c"], ["cdd720df-ee83-41f8-9499-d9b21aa14d9c"]),  # Bhagavad Gita (Easwaran)
    (["4f2ffb11-dcbf-4f29-918a-e0c99717c43b", "aff1e2e8-5569-412d-be5a-c49f2f8a3ac8"], []),  # The Difference Engine (Gibson & Sterling)
    (["5e4473f2-2e68-4c4f-94e9-f1693c739937", "f9dd245b-bf5b-4cc3-817a-e6c516e69e0e"], ["5e4473f2-2e68-4c4f-94e9-f1693c739937"]),  # Red Sorghum (Mo Yan; Goldblatt translator)
    (["6b531257-7797-4ac5-a367-1612bf951e80", "de593295-62b1-4938-8b3d-5f259ddad589", "ede01f7c-280b-4e88-98b0-afd5bef2d213"], []),  # Billion Dollar Whale
    (["83cf40a5-c705-4caf-ab24-e91f1af705ec", "9aa97fb4-8fcc-4975-a205-090553216d73"], []),  # The Red Knight (Miles Cameron = Christian Cameron)
    (["840184b4-8ae1-41d1-9cde-8069f00f7ef1", "bf894d6b-91c2-45c3-adc6-5a32f057ba7e"], []),  # When the Game Was Ours (Bird & Johnson)
    (["b9584d8d-57f2-4200-b965-b86b2d6b0adf", "baf9c98d-42dc-4baf-b952-f89495b8117a"], []),  # The Age of Faith (Durant)
    (["bfcc477a-b5e2-4d58-866d-f3b1255d737c", "fea9560d-7f1e-4a37-ae78-2d3f6e116a80"], []),  # Wooden Leg (Marquis)
    (["d3207f54-2b85-41df-b1b6-df40a4f57077", "f83b0fec-933a-4ba2-9788-27bb492bb2a5"], []),  # The Kabir Book (Bly)
    (["d385195a-5a04-456f-a559-dc7183bf1126", "ef8c15b0-13dd-42bf-971c-7aa5c86a3e55"], []),  # The Baby Book (Sears)
    (["def6bc10-01b7-4c94-8e2e-7eda501422f8", "fca503c8-4ac0-4b9a-9fc4-ce21b0e789fc", "fdcfea1e-0479-4df0-875d-8a021745f322"], []),  # A Rap on Race
    (["e3c68b0d-b50b-4c80-82b8-286ec9d0461a", "f91cd202-a9b6-4589-bfd2-a115643cb28a"], ["e3c68b0d-b50b-4c80-82b8-286ec9d0461a"]),  # Tuxedo Park (Conant)
]
MANUAL_OF = {i: k for k, (ids, _) in enumerate(MANUAL) for i in ids}
MANUAL_UNTRUSTED = {i for _, u in MANUAL for i in u}


def main():
    groups = collections.defaultdict(list)
    for b in books:
        k = nt(b["title"])
        if k:
            groups[k].append(b)
    out_rows = []
    clusters = []
    stats = collections.Counter()
    for key, members in groups.items():
        if len(members) < 2 or not any(m["id"] in shown for m in members):
            if len(members) >= 2:
                stats["groups_not_touching_shown"] += 1
            continue
        stats["groups"] += 1
        generic = bool(GENERIC_TITLES.fullmatch(key)) or len(key) <= 2
        n = len(members)
        parent = list(range(n))

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        verdicts = {}
        for i, j in itertools.combinations(range(n), 2):
            v = pair(members[i], members[j])
            if generic and v[0] in ("SAME", "SAME_PRODUCT"):
                v = ("UNSURE", "generic title (" + key + ")")
            mi, mj = MANUAL_OF.get(members[i]["id"]), MANUAL_OF.get(members[j]["id"])
            if mi is not None and mi == mj:
                v = ("SAME", "hand-checked REVIEW group (co-author/translator/pen-name/edition)")
            verdicts[(i, j)] = v
            if v[0] in ("SAME", "SAME_PRODUCT"):
                parent[find(i)] = find(j)
        comp = collections.defaultdict(list)
        for i in range(n):
            comp[find(i)].append(i)
        group_has_merge = group_has_review = False
        for root, idx in comp.items():
            cl = [members[i] for i in idx]
            if len(idx) == 1:
                # singleton: did it have an UNSURE edge with anything?
                i = idx[0]
                uns = [verdicts[tuple(sorted((i, j)))] for j in range(n) if j != i and verdicts[tuple(sorted((i, j)))][0] == "UNSURE"]
                decision = "REVIEW" if uns else "KEEP_SEPARATE"
                reason = uns[0][1] if uns else "; ".join(sorted({verdicts[tuple(sorted((i, j)))][1] for j in range(n) if j != i}))[:300]
            else:
                bad = [(i, j, verdicts[(min(i, j), max(i, j))]) for i, j in itertools.combinations(idx, 2)
                       if verdicts[(min(i, j), max(i, j))][0] in ("DIFFERENT", "TITLE_CONFLICT")
                       or (verdicts[(min(i, j), max(i, j))][0] == "UNSURE" and "years" in verdicts[(min(i, j), max(i, j))][1])]
                if bad:
                    decision = "REVIEW"
                    reason = "chained cluster with internal conflict: " + bad[0][2][1]
                else:
                    decision = "MERGE"
                    reason = "; ".join(sorted({verdicts[(min(i, j), max(i, j))][1] for i, j in itertools.combinations(idx, 2) if verdicts[(min(i, j), max(i, j))][0] in ("SAME", "SAME_PRODUCT")}))
                if decision == "MERGE" and not any(m["id"] in shown for m in cl):
                    decision = "SKIP_NOT_SHOWN"
            if decision == "MERGE":
                group_has_merge = True
            if decision == "REVIEW":
                group_has_review = True
            cid = f"{key}#{len(clusters)}"
            untrusted = {members[i if v[2] != members[i]["id"] else j]["id"] for (i, j), v in verdicts.items() if v[0] == "SAME_PRODUCT" and i in idx and j in idx}
            canon = pick_canonical(cl, untrusted | MANUAL_UNTRUSTED) if decision == "MERGE" else None
            clusters.append({"cluster": cid, "key": key, "decision": decision, "reason": reason,
                             "ids": [m["id"] for m in cl], "canonical": canon["id"] if canon else None})
            for m in cl:
                out_rows.append({
                    "group_key": key, "cluster": cid, "decision": decision,
                    "role": ("canonical" if canon and m["id"] == canon["id"] else ("duplicate" if canon else "")),
                    "shown": int(m["id"] in shown), "index_status": m["index_status"], "id": m["id"], "slug": m["slug"],
                    "title": m["title"], "subtitle": m["subtitle"], "author_name": m["author_name"],
                    "year": m["first_published_year"], "asin": asin(m["amazon_url"]), "isbn_13": m["isbn_13"],
                    "recs": len(recs_by[m["id"]]), "lists": len(lists_by[m["id"]]), "reason": reason,
                })
        stats["groups_with_merge" if group_has_merge else ("groups_review_only" if group_has_review else "groups_keep_separate")] += 1
    for c in clusters:
        stats["clusters_" + c["decision"]] += 1
        if c["decision"] == "MERGE":
            stats["rows_to_delete"] += len(c["ids"]) - 1
    with open(os.path.join(HERE, "plan.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out_rows[0].keys()))
        w.writeheader()
        w.writerows(out_rows)
    json.dump(clusters, open(os.path.join(HERE, "plan.json"), "w"), indent=1)
    for k, v in sorted(stats.items()):
        print(k, v)


def valid_cover(u):
    return bool(u) and u.startswith("http")


def useful(s):
    return bool(s) and len(s.strip()) >= 80


def pick_canonical(cl, untrusted=frozenset()):
    def key(b):
        return (
            b["index_status"] == "published",
            b["id"] in shown,  # keep the URL that is already linked/indexed
            len(recs_by[b["id"]]),
            valid_cover(b["cover_image_url"]),
            useful(b["description"]) + bool(b["editorial_summary"]) + bool(b["best_for"]),
            -_ts(b["created_at"]),
        )
    return max([b for b in cl if b["id"] not in untrusted] or cl, key=key)


def _ts(s):
    import datetime
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() if s else 0


if __name__ == "__main__":
    main()
