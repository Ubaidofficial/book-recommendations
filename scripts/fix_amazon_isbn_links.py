#!/usr/bin/env python3
"""Repair `books.amazon_url` rows whose Amazon product is shared by different titles.

Why: imported rows often carry the product id of one book pasted onto every title in a series (one id on 675 books,
38 of 38 on a Tami Hoag page). "View on Amazon" then opens the wrong book. A print book's Amazon product id is its
ISBN-10, so the fix is to look up each book's real ISBN.

Source: Open Library (title + author + first-publication year -> work -> a standard English print edition). Strict
by design: a book is only resolved when the title and author match and the year is within 2; large-print, audio,
ebook, library-binding and non-English editions are skipped; anything ambiguous is left alone and the site falls
back to an Amazon title+author search (see amazonCtaUrl in src/lib/dataQuality.ts). Amazon availability of the
chosen edition is NOT verified. Open Library asks for at most one request per second; this script keeps to that.

Usage (public Supabase anon key in SUPA_KEY is enough for the read-only steps; writes go through the SQL it prints):
  SUPA_KEY=... python3 scripts/fix_amazon_isbn_links.py targets  OUT.jsonl [series|lists]
  python3 scripts/fix_amazon_isbn_links.py resolve  TARGETS.jsonl RESULTS.jsonl [--limit N] [--offset N]   # resumable
  python3 scripts/fix_amazon_isbn_links.py apply-sql RESULTS.jsonl APPLIED.txt BATCH_SIZE BACKUP_TABLE       # prints one guarded UPDATE
  SUPA_KEY=... python3 scripts/fix_amazon_isbn_links.py stage RESULTS.jsonl APPLIED.txt                   # preferred for >100 rows

Preferred write path ("stage"): hand-copying hundreds of ids into SQL loses rows to typos. Instead create a temporary
table `tmp_amz_stage (id uuid primary key, isbn10 text)` with RLS on and an INSERT-only policy for anon, run `stage`
to load the rows straight from the results file, compare md5(string_agg(replace(id::text,'-','')||':'||isbn10, ','
order by 1)) in SQL with the fingerprint `stage` prints, then run the guarded UPDATE joining the staging table and the
backup table, and drop the staging table. 2,160 books were repaired this way with every row checked.
Before applying, back up the affected rows into BACKUP_TABLE (id, amazon_url). The UPDATE only touches a row that
still equals its backed-up value, and never touches updated_at (page "Last updated" dates are built from it).
After each batch, compare md5(string_agg(id || ':' || asin ...)) in SQL with the same hash of the results file.
"""
import concurrent.futures as cf, json, os, re, sys, threading, time, urllib.parse, urllib.request, urllib.error, collections

SUPA = "https://ghpdpvatfmvsahzsqgpp.supabase.co/rest/v1"
KEY = os.environ.get("SUPA_KEY", "")
UA = "BookMentionsISBNLookup/1.0"
_last = [0.0]
_lock = threading.Lock()


def throttle(gap=1.05):
    """At most one Open Library request per `gap` seconds, whatever the call site."""
    with _lock:
        wait = _last[0] + gap - time.time()
        if wait > 0: time.sleep(wait)
        _last[0] = time.time()


def supa(path):
    req = urllib.request.Request(SUPA + path, headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
    return json.load(urllib.request.urlopen(req, timeout=120))


def asin_of(url):
    m = re.search(r"/(?:dp|gp/product)/([^/?#]+)", url or "")
    if not m: return None
    c = m.group(1)
    if re.fullmatch(r"[A-Za-z0-9]{10}", c): return c.upper()
    if len(c) == 22 and re.match(r"[A-Za-z0-9]{10}", c): return c[:10].upper()
    return None


def norm(s): return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def main_title(t):
    t = re.split(r"\s*[:–—]\s*|\s+-\s+|\s*\(", t or "")[0]
    return t.strip()


def strip_article(k):
    for a in ("the", "a", "an"):
        if k.startswith(a) and len(k) > len(a) + 3: return k[len(a):]
    return k


def tkey(t): return strip_article(norm(main_title(t)))


# ---------------------------------------------------------------- targets
def targets(out, mode):
    groups = []
    if mode == "series":
        rows = supa("/series?select=id,slug,index_status,publish_ready&or=(index_status.eq.published,and(publish_ready.eq.true,index_status.eq.draft))&limit=1000")
        groups = [("series", r["slug"], r["id"]) for r in rows]
    else:
        rows = supa("/lists?select=id,slug&index_status=eq.published&limit=1000")
        groups = [("lists", r["slug"], r["id"]) for r in rows]
    seen, n_books = {}, 0
    for kind, slug, gid in groups:
        if kind == "series":
            rs = supa(f"/book_series?select=books(id,title,author_name,first_published_year,amazon_url,slug)&series_id=eq.{gid}&limit=1000")
        else:
            rs = supa(f"/book_lists?select=books(id,title,author_name,first_published_year,amazon_url,slug)&list_id=eq.{gid}&limit=1000")
        books = [r["books"] for r in rs if r.get("books")]
        by_asin = collections.defaultdict(set)
        for b in books:
            a = asin_of(b.get("amazon_url"))
            if a: by_asin[a].add(tkey(b["title"]))
        shared = {a for a, ks in by_asin.items() if len(ks) >= 2}
        for b in books:
            a = asin_of(b.get("amazon_url"))
            if a in shared and b["id"] not in seen:
                seen[b["id"]] = {"id": b["id"], "slug": b["slug"], "title": b["title"], "author": b.get("author_name"),
                                 "fpy": b.get("first_published_year"), "old_asin": a, "group": f"{kind}:{slug}"}
        n_books += len(books)
    with open(out, "w") as f:
        for v in seen.values(): f.write(json.dumps(v) + "\n")
    print(f"groups={len(groups)} book rows={n_books} distinct bad books={len(seen)}")


# ---------------------------------------------------------------- isbn helpers
def isbn10_ok(s):
    if not re.fullmatch(r"\d{9}[\dXx]", s or ""): return False
    t = sum((10 - i) * (10 if c in "Xx" else int(c)) for i, c in enumerate(s))
    return t % 11 == 0


def isbn13_to_10(s):
    if not re.fullmatch(r"978\d{10}", s or ""): return None
    t = s[3:12]
    tot = sum((10 - i) * int(c) for i, c in enumerate(t))
    chk = (11 - tot % 11) % 11
    r = t + ("X" if chk == 10 else str(chk))
    return r if isbn10_ok(r) else None


def pick_isbn10(isbns):
    for i in isbns or []:
        i = i.replace("-", "").strip()
        if isbn10_ok(i): return i.upper()
    for i in isbns or []:
        c = isbn13_to_10(i.replace("-", "").strip())
        if c: return c
    return None


# ---------------------------------------------------------------- resolver
def ol_search(title, author):
    q = urllib.parse.urlencode({"title": main_title(title), "author": author or "", "limit": 8,
                                "fields": "key,title,author_name,first_publish_year,edition_count,isbn,editions",
                                "editions.fields": "key,title,isbn,language,publish_date"})
    url = "https://openlibrary.org/search.json?" + q
    for attempt in range(5):
        try:
            throttle()
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60))
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503, 504):
                time.sleep(30 * (attempt + 1)); continue
            raise
        except Exception:
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("search failed after retries")


def author_ok(ours, theirs):
    toks = re.findall(r"[a-z0-9]+", (ours or "").lower())
    if len(toks) < 1: return False
    last, first = toks[-1], toks[0]
    for a in theirs or []:
        t = re.findall(r"[a-z0-9]+", a.lower())
        if t and t[-1] == last and (len(toks) == 1 or t[0][:1] == first[:1]): return True
    return False


def resolve(b):
    try:
        d = ol_search(b["title"], b["author"])
    except Exception as e:
        return {"status": "error", "reason": str(e)[:120]}
    cands = []
    for doc in d.get("docs", []):
        if tkey(doc.get("title")) != tkey(b["title"]): continue
        if not author_ok(b["author"], doc.get("author_name")): continue
        y = doc.get("first_publish_year")
        if b["fpy"] and y and abs(int(y) - int(b["fpy"])) > 2: continue
        cands.append(doc)
    if not cands: return {"status": "no_match", "reason": f"{len(d.get('docs', []))} docs, none matched title+author+year"}
    cands.sort(key=lambda x: -(x.get("edition_count") or 0))
    if len(cands) > 1:
        a, c = cands[0].get("edition_count") or 0, cands[1].get("edition_count") or 0
        years = {x.get("first_publish_year") for x in cands[:2]}
        if not (a >= 2 * c and a >= 2) and len(years) > 1 and not b["fpy"]:
            return {"status": "ambiguous", "reason": f"{len(cands)} candidate works"}
    for best in cands[:3]:
        pick = best_edition(best.get("key"))
        if pick:
            return {"status": "ok", "isbn10": pick["isbn10"], "work": best.get("key"), "ol_title": best.get("title"),
                    "ol_author": (best.get("author_name") or [None])[0], "ol_year": best.get("first_publish_year"),
                    "fmt": pick["fmt"], "publisher": pick["publisher"], "ed_year": pick["year"], "n_cands": len(cands)}
    return {"status": "no_good_edition", "reason": f"{len(cands)} matching works, no standard English print edition with an ISBN"}


BAD_FMT = re.compile(r"electronic|audio|\bcd\b|cassette|mp3|large print|large type|library|playaway|kindle|ebook|e-book|digital|spiral|board|calendar|comic", re.I)
BAD_PUB = re.compile(r"tandem library|perma-?bound|turtleback|bound to stay|sagebrush|econo-?clad|demco|rebound|thorndike|brilliance|audible|recorded books|blackstone|playaway|gale|chivers|isis|wheeler|large print|audio|tantor|bolinda|listening library|macmillan audio|harpercollins audio|hachette audio|simon & schuster audio|random house audio|penguin audio|findaway|dreamscape|gardners|center point|g\.?k\.? hall|story ?tel", re.I)
BAD_PREFIX = ("07862", "14104", "07927", "07540", "07838", "08161")  # Thorndike / Gale / Chivers large-print ranges
GOOD_FMT = re.compile(r"paperback|hardcover|hardback|mass market|trade|softcover|hard cover|paper back", re.I)


def best_edition(work_key):
    """Choose a standard English print edition (with an ISBN) of this work, or None."""
    url = f"https://openlibrary.org{work_key}/editions.json?limit=100"
    d = None
    for attempt in range(4):
        try:
            throttle()
            d = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60)); break
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503, 504): time.sleep(30 * (attempt + 1)); continue
            return None
        except Exception:
            time.sleep(5 * (attempt + 1))
    if not d: return None
    best, best_score = None, None
    for e in d.get("entries", []):
        isbns = (e.get("isbn_10") or []) + (e.get("isbn_13") or [])
        i10 = pick_isbn10(isbns)
        if not i10: continue
        if i10.startswith(BAD_PREFIX): continue
        if i10[0] not in "01": continue  # English-language ISBN groups only (0, 1); 3=German, 2=French, ...
        fmt = (e.get("physical_format") or "")
        pubs = " ".join(e.get("publishers") or [])
        if BAD_FMT.search(fmt) or BAD_PUB.search(pubs): continue
        langs = [l.get("key", "").split("/")[-1] for l in e.get("languages", [])]
        if langs and "eng" not in langs: continue
        m = re.search(r"(1[5-9]\d\d|20\d\d)", e.get("publish_date") or "")
        year = int(m.group(1)) if m else 0
        if year > 2026: continue
        score = (1 if GOOD_FMT.search(fmt) else 0, 1 if (e.get("isbn_13") or []) else 0, year)
        if best_score is None or score > best_score:
            best_score, best = score, {"isbn10": i10, "fmt": fmt or "unknown", "publisher": (e.get("publishers") or [""])[0], "year": year}
    return best


def run_resolve(tpath, rpath, limit, offset, workers=4):
    """Several workers overlap Open Library's latency; throttle() still caps the combined rate at ~1 request/second."""
    items = [json.loads(l) for l in open(tpath)]
    done = set()
    if os.path.exists(rpath): done = {json.loads(l)["id"] for l in open(rpath)}
    items = items[offset:offset + limit] if limit else items[offset:]
    items = [b for b in items if b["id"] not in done]
    out = open(rpath, "a")
    t0 = time.time(); n = 0

    def work(b):
        r = resolve(b)
        r.update({"id": b["id"], "title": b["title"], "author": b["author"], "fpy": b["fpy"], "old_asin": b["old_asin"]})
        return r

    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for r in ex.map(work, items):
            out.write(json.dumps(r) + "\n"); out.flush(); n += 1
            if n % 50 == 0: print(f"{n} done, {time.time() - t0:.0f}s", flush=True)
    print("finished", n)



def apply_sql(res, applied_path, n, backup):
    R = [json.loads(l) for l in open(res)]
    applied = set(open(applied_path).read().split()) if os.path.exists(applied_path) else set()
    ok = [r for r in R if r["status"] == "ok"]
    counts = collections.Counter(r["isbn10"] for r in ok)
    dupes = {i for i, c in counts.items() if c > 1}
    todo = [r for r in ok if r["id"] not in applied and r["isbn10"] not in dupes][:n]
    rows = ",".join(f"('{r['id'].replace('-', '')}','{r['isbn10']}')" for r in todo)
    print(f"-- {len(todo)} rows; ok total {len(ok)}; duplicate ISBNs withheld: {len(dupes)}; already applied: {len(applied)}")
    print("update books b set amazon_url = 'https://www.amazon.com/dp/' || v.i "
          f"from (values {rows}) as v(id,i), {backup} k "
          "where b.id = v.id::uuid and k.id = b.id and b.amazon_url = k.amazon_url returning 1;")


def stage(res, applied_path):
    """Load resolved rows into public.tmp_amz_stage with plain inserts and print a fingerprint to compare in SQL."""
    import hashlib
    key = KEY
    url = SUPA + "/tmp_amz_stage"
    R = [json.loads(l) for l in open(res)]
    applied = set(open(applied_path).read().split()) if os.path.exists(applied_path) else set()
    ok = [r for r in R if r["status"] == "ok"]
    cnt = collections.Counter(r["isbn10"] for r in ok)
    todo = [r for r in ok if r["id"] not in applied and cnt[r["isbn10"]] == 1]
    for i in range(0, len(todo), 400):
        body = json.dumps([{"id": r["id"], "isbn10": r["isbn10"]} for r in todo[i:i + 400]]).encode()
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json", "Prefer": "return=minimal"})
        urllib.request.urlopen(req, timeout=120).read()
    rows = sorted((r["id"].replace("-", ""), r["isbn10"]) for r in todo)
    print(f"staged {len(rows)} rows; fingerprint {hashlib.md5(','.join(f'{a}:{b}' for a, b in rows).encode()).hexdigest()}")


if __name__ == "__main__":
    a = sys.argv
    if a[1] == "targets": targets(a[2], a[3] if len(a) > 3 else "series")
    elif a[1] == "stage": stage(a[2], a[3])
    elif a[1] == "apply-sql": apply_sql(a[2], a[3], int(a[4]), a[5])
    elif a[1] == "resolve":
        lim = int(a[a.index("--limit") + 1]) if "--limit" in a else 0
        off = int(a[a.index("--offset") + 1]) if "--offset" in a else 0
        run_resolve(a[2], a[3], lim, off)
