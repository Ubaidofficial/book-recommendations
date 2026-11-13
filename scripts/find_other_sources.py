#!/usr/bin/env python3
"""
Find the person's OWN source for doubtful recommendations, outside the two
recommendation indexes that were already checked (2026-11-13).

SCOPE
  Rows of reports/orphan_recheck_20261113.csv with category
  person_on_site_book_not_listed: the person has a page on an outside index,
  but no index lists this book for them, and the stored source is a
  pipe-joined list that belongs to other people. Rows already in
  public.bak_recs_primary_sources_20261112 are skipped (the write guard
  re-checks this).

WHERE WE LOOK (precision over recall)
  1. the person's own site / blog / newsletter (DOMAIN_MAP in
     scripts/reattribute_quotes.js, or a host named after the person)  → strong 80
  2. podcast transcripts where the person is guest or host, interviews and
     Q&As (Five Books, "books that changed my life") in the person's own
     quoted words                                                        → medium 60
  Pages are found with a few web searches per person (done by the operator,
  logged in reports/other_sources/searches.jsonl) and fetched here.
  The two outside indexes and bookselects.com are never fetched or stored,
  and neither are x.com, twitter.com, reddit.com or search-engine URLs.

FETCHING
  Fetcher from find_primary_sources.py: generic User-Agent, robots.txt
  honoured on every hop, >= 1.1 s per host, cached under
  reports/third_party_cache/other/ (gitignored); a 429 blocks that host
  for the rest of the run.

STEPS (run from the repo root with python3 -I)
  load                       fresh rows, books and people → reports/other_sources/scope.json
  check SLUG URL [URL ...]   fetch pages, list every in-scope book of SLUG the page names,
                             with context; appends to reports/other_sources/candidates.jsonl
  sitesearch SLUG BASE [TERM ...]
                             WordPress REST search of the person's own site for each of
                             their in-scope titles (pointer only, never stored)
  transcripts BASE SLUG [SLUG ...]
                             podcast site (WordPress) search for the person's name; fetch their
                             transcripts; keep mentions under the person's own speaker label
  decide REC_ID URL accept|reject STRENGTH REASON [--quote TEXT]
                             record the hand check in reports/other_sources/decisions.jsonl
                             (a quote is kept only if it is verbatim on the fetched page and
                             at least 50 characters)
  emit OUTDIR [--size N]     guarded SQL batches (pilot 10, then up to N<=100) for execute_sql
  unresolved                 reports/doubtful_unresolved_20261113.csv
  stats                      counts for the report
"""
from __future__ import annotations

import base64
import csv
import hashlib
import json
import re
import sys
import urllib.parse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import find_primary_sources as fps  # noqa: E402
from find_primary_sources import (Fetcher, Ownership, norm_text, norm_title, page_text,  # noqa: E402
                                  quote_in, surname, title_in, tokens, host_of)

ROOT = fps.ROOT
REPORTS = fps.REPORTS
ORPHAN_CSV = REPORTS / "orphan_recheck_20261113.csv"
WORK = REPORTS / "other_sources"
SCOPE = WORK / "scope.json"
CANDS = WORK / "candidates.jsonl"
DECISIONS = WORK / "decisions.jsonl"
SEARCHES = WORK / "searches.jsonl"
UNRESOLVED_CSV = REPORTS / "doubtful_unresolved_20261113.csv"
CATEGORY = "person_on_site_book_not_listed"
CACHE_KIND = "other"  # → reports/third_party_cache/other/<host>/
BACKUP_TABLE = fps.BACKUP_TABLE
BATCH_PREFIX = "other_sources_20261113"
STRONG, MEDIUM = fps.HIGH_CONFIDENCE, fps.MEDIUM_CONFIDENCE

# never fetched, never stored
NEVER_HOSTS = ("mostrecommendedbooks.com", "readthistwice.com", "bookselects.com", "x.com", "twitter.com",
               "mobile.twitter.com", "reddit.com", "old.reddit.com", "google.com", "bing.com", "duckduckgo.com",
               "search.yahoo.com", "goodreads.com", "amazon.com")


def never(url: str) -> bool:
    h = host_of(url)
    return any(h == n or h.endswith("." + n) for n in NEVER_HOSTS)


def jl_read(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def jl_append(path: Path, obj: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


# ─── load ───────────────────────────────────────────────────────────────────

def cmd_load():
    rows = [r for r in fps.csv_rows(ORPHAN_CSV) if r["category"] == CATEGORY]
    fresh = {r["id"]: r for r in fps.sb_read_ids("book_recommendations",
                                                  "id,person_id,book_id,source_url,quote,confidence_score,source_name",
                                                  [r["rec_id"] for r in rows])}
    books = {b["id"]: b for b in fps.sb_read_ids("books", "id,title,author_name,first_published_year",
                                                  list({f["book_id"] for f in fresh.values()}))}
    people = {p["id"]: p for p in fps.sb_read_ids("people", "id,slug,name,twitter_handle",
                                                   list({f["person_id"] for f in fresh.values()}))}
    out = []
    for r in rows:
        f = fresh.get(r["rec_id"])
        if not f:
            continue
        b, p = books[f["book_id"]], people[f["person_id"]]
        out.append({"rec_id": r["rec_id"], "slug": p["slug"], "person": p["name"], "person_status": r["person_status"],
                    "book_id": b["id"], "title": b["title"], "author": b["author_name"],
                    "year": b.get("first_published_year"), "source_url": f["source_url"], "quote": f["quote"],
                    "confidence": f["confidence_score"],
                    "snap": hashlib.md5(((f["source_url"] or "") + "|" + (f["quote"] or "")).encode("utf-8")).hexdigest()})
    WORK.mkdir(parents=True, exist_ok=True)
    SCOPE.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"scope rows {len(out)} (csv {len(rows)}), people {len({o['slug'] for o in out})}")


def scope() -> list[dict]:
    return json.loads(SCOPE.read_text(encoding="utf-8"))


def ownership(sc) -> Ownership:
    hm, hd, dm, ag, ih = fps.load_house_maps()
    people = {o["slug"]: {"slug": o["slug"], "name": o["person"]} for o in sc}
    return Ownership(people, hm, hd, dm, ag, ih)


def fix_mojibake(t: str) -> str:
    """Pages served without a charset are decoded as Latin-1 by requests: undo that for UTF-8 text."""
    if "â\x80" in t or "Ã" in t or "â€" in t:
        try:
            return t.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return t


def cached_text(url: str) -> tuple[str, str]:
    res = Fetcher(offline=True).get(url, kind=CACHE_KIND)
    return page_text(fix_mojibake(res.get("text") or ""))


# ─── check ──────────────────────────────────────────────────────────────────

GUEST_POST = re.compile(r"guest (?:post|article|essay|contributor)|this (?:post|article) (?:is|was) (?:written )?by", re.I)
# transcript speaker labels: "Tim Ferriss: ..." (tim.blog) or "Lex Fridman (00:01:23) ..." (lexfridman.com)
SPEAKER = re.compile(r"(?:^|\s)([A-Z][A-Za-z.'\-]+(?: [A-Z][A-Za-z.'\-]+){0,3})(?::\s| \(\d{1,2}:\d{2}(?::\d{2})?\))")


def contexts(text: str, title: str, width=260, n=3) -> list[tuple[str, str]]:
    """(speaker, raw-text window) around each mention of the title. speaker is the nearest
    transcript label ("Tim Ferriss: ...") before the mention, or '' when the page has none."""
    t = re.split(r"\s*[:(\[]\s*|\s+[-–—]\s+", title)[0].strip()
    t = re.sub(r"^(the|a|an)\s+", "", t, flags=re.I)
    pat = r"\W+".join(re.escape(w) for w in re.findall(r"[A-Za-z0-9']+", t))
    out = []
    for m in re.finditer(pat, text, re.I):
        before = text[max(0, m.start() - 4000): m.start()]
        sp = [x.group(1) for x in SPEAKER.finditer(before)]
        out.append((sp[-1] if sp else "", text[max(0, m.start() - width): m.end() + width]))
        if len(out) >= n:
            break
    return out


# personal sites confirmed by hand in this run (in addition to DOMAIN_MAP in reattribute_quotes.js)
OWN_SITES = {"tim.blog": "tim-ferriss", "nirandfar.com": "nir-eyal", "aliabdaal.com": "ali-abdaal",
             "feld.com": "brad-feld", "andrewchen.com": "andrew-chen", "jamesclear.com": "james-clear"}


def source_kind(url: str, slug: str, own: Ownership) -> str:
    if own.personal_domain(slug, url) or OWN_SITES.get(host_of(url)) == slug:
        return "own_site"
    t = fps.source_type(url)
    if t == "podcast" or "transcript" in url.lower():
        return "podcast"
    if "fivebooks.com" in host_of(url):
        return "interview"
    return "interview_or_article"


def speaker_is(sp: str, name: str) -> bool:
    st, nt = tokens(sp), tokens(name)
    return bool(st) and bool(nt) and st[-1] == nt[-1] and (len(st) == 1 or st[0] == nt[0])


def cmd_check(slug: str, urls: list[str], speaker: str | None = None):
    sc = [o for o in scope() if o["slug"] == slug]
    if not sc:
        sys.exit(f"no scope rows for {slug}")
    own = ownership(scope())
    F = Fetcher(offline=False)
    for url in urls:
        if never(url):
            print(f"SKIP never-fetch host: {url}")
            continue
        try:
            res = F.get(url, kind=CACHE_KIND)
        except fps.StopRun as e:
            sys.exit(str(e))
        st = res.get("status")
        if st == 429:
            sys.exit(f"429 from {host_of(url)}: stopping")
        if not st or st >= 400 or not res.get("text"):
            print(f"FAIL {url}: {st or res.get('error')}")
            continue
        ptitle, text = page_text(fix_mojibake(res["text"]))
        tn = norm_text(text)
        kind = source_kind(url, slug, own)
        name_on_page = fps.name_in_tokens(sc[0]["person"], tn.split())
        guest = bool(GUEST_POST.search(text[:4000]))  # a guest author's post on the person's own site is not their words
        print(f"\n== {url}\n   [{kind}] title={ptitle[:100]!r} person_named={name_on_page} len={len(text)}"
              f"{'  GUEST_POST' if guest else ''}")
        for o in sc:
            tnorm = norm_title(o["title"])
            if not title_in(tnorm, tn):
                continue
            sn = surname(o["author"])
            author_on = bool(sn and sn in tn.split())
            sy = fps.source_year(url)
            too_old = bool(sy and o["year"] and sy < int(o["year"]) - 1)
            ctx = contexts(text, o["title"], n=12)
            if speaker:
                ctx = [c for c in ctx if speaker_is(c[0], speaker)]
                if not ctx:
                    continue
            print(f"   HIT {o['rec_id'][:8]} {o['title']!r} / {o['author']} author_on_page={author_on} year={o['year']} src_year={sy}{' TOO_OLD' if too_old else ''}")
            for sp, c in ctx[:3]:
                print(f"      [{sp}] …" + c.replace("\n", " ") + "…")
            jl_append(CANDS, {"rec_id": o["rec_id"], "slug": slug, "url": url, "kind": kind, "author_on_page": author_on,
                              "too_old": too_old, "guest_post": guest, "page_title": ptitle[:200], "context": [list(c) for c in ctx[:3]],
                              "at": datetime.now(timezone.utc).isoformat()})


def cmd_sitesearch(slug: str, base: str, terms: list[str]):
    """WordPress REST search on the person's own site (a pointer only; never stored)."""
    sc = [o for o in scope() if o["slug"] == slug]
    F = Fetcher(offline=False)
    titles = terms or [re.split(r"\s*[:(]", o["title"])[0] for o in sc]
    found = defaultdict(list)
    for t in titles:
        u = base.rstrip("/") + "/wp-json/wp/v2/search?per_page=20&search=" + urllib.parse.quote('"' + t + '"' if " " in t else t)
        res = F.get(u, kind=CACHE_KIND)
        if res.get("status") != 200:
            print(f"FAIL {t}: {res.get('status') or res.get('error')}")
            continue
        try:
            hits = json.loads(res["text"])
        except ValueError:
            print(f"FAIL {t}: not json")
            continue
        print(f"{t!r}: {len(hits)}")
        for h in hits[:20]:
            found[h.get("url")].append(t)
            print("    ", h.get("url"), "|", (h.get("title") or "")[:90])
    return found


def cmd_transcripts(slugs: list[str], base="https://tim.blog", max_pages=6):
    """For each person: WordPress search of a podcast site for their name, fetch up to max_pages
    transcript pages, and keep only mentions spoken under the person's own transcript label."""
    sc = scope()
    for slug in slugs:
        rows = [o for o in sc if o["slug"] == slug]
        name = rows[0]["person"]
        F = Fetcher(offline=False)
        u = base.rstrip("/") + "/wp-json/wp/v2/search?per_page=40&search=" + urllib.parse.quote('"' + name + '"')
        res = F.get(u, kind=CACHE_KIND)
        try:
            hits = json.loads(res.get("text") or "[]")
        except ValueError:
            hits = []
        urls = [h["url"] for h in hits if "transcript" in h.get("url", "")
                and set(tokens(name)[-1:]) <= set(tokens(h.get("url", "") + " " + h.get("title", "")))][:max_pages]
        print(f"## {slug}: {len(hits)} results, {len(urls)} transcripts with the name in url/title")
        if not urls:
            continue
        cmd_check(slug, urls, speaker=name)


def cmd_rosetta(slug: str, urls: list[str]):
    """A video's own words, read from a transcript copy (rosetta.to). Only the transcript part of the
    page is searched (its machine summary is not the person's words); the stored URL is the video."""
    sc = [o for o in scope() if o["slug"] == slug]
    F = Fetcher(offline=False)
    for url in urls:
        res = F.get(url, kind=CACHE_KIND)
        if res.get("status") != 200:
            print(f"FAIL {url}: {res.get('status') or res.get('error')}")
            continue
        h = fix_mojibake(res["text"])
        vids = set(re.findall(r'(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|"videoId":")([A-Za-z0-9_-]{11})', h))
        date = (re.findall(r'"uploadDate":"(\d{4})', h) or [None])[0]
        text = page_text(h)[1]
        i = text.find("Full transcript")
        if i < 0 or len(vids) != 1:
            print(f"SKIP {url}: transcript={i >= 0} videos={len(vids)}")
            continue
        tr = text[i:]
        trn = norm_text(tr)
        video = "https://www.youtube.com/watch?v=" + vids.pop()
        print(f"\n== {url} → {video} ({date})")
        for o in sc:
            if not title_in(norm_title(o["title"]), trn):
                continue
            ctx = contexts(tr, o["title"], width=220, n=3)
            too_old = bool(date and o["year"] and int(date) < int(o["year"]) - 1)
            print(f"   HIT {o['rec_id'][:8]} {o['title']!r}{' TOO_OLD' if too_old else ''}")
            for _sp, c in ctx[:2]:
                print("      …" + c + "…")
            jl_append(CANDS, {"rec_id": o["rec_id"], "slug": slug, "url": video, "via": url, "kind": "video_transcript",
                              "author_on_page": True, "too_old": too_old, "guest_post": False, "page_title": "",
                              "context": [list(c) for c in ctx], "at": datetime.now(timezone.utc).isoformat()})


# ─── decide ─────────────────────────────────────────────────────────────────

def page_norm(url: str) -> str:
    return norm_text(cached_text(url)[1])


def cmd_decide(rec_id, url, verdict, strength, reason, quote=None):
    sc = {o["rec_id"]: o for o in scope()}
    m = [r for r in sc if r.startswith(rec_id)]
    assert len(m) == 1, rec_id
    rec_id = m[0]
    assert verdict in ("accept", "reject")
    assert strength in ("strong", "medium", "none")
    assert url == "-" or not never(url), url  # "-": rejected without a page
    assert verdict == "reject" or url != "-"
    if quote is not None:
        if len(quote) < 50 or not fps.quote_is_verbatim(quote) or not quote_in(quote, page_norm(url)):
            print(f"quote dropped for {rec_id[:8]} (not verbatim on page or < 50 chars)")
            quote = None
    jl_append(DECISIONS, {"rec_id": rec_id, "url": url, "verdict": verdict, "strength": strength, "reason": reason,
                          "quote": quote, "at": datetime.now(timezone.utc).isoformat()})


def decisions() -> dict:
    d = {}
    for x in jl_read(DECISIONS):
        d[x["rec_id"]] = x  # last decision wins
    return d


# ─── emit ───────────────────────────────────────────────────────────────────

def lit(s: str) -> str:
    """base64 keeps the statement pure ASCII."""
    return "convert_from(decode('" + base64.b64encode(s.encode("utf-8")).decode() + "','base64'),'UTF8')"


def batch_sql(rows: list[dict], batch: str) -> str:
    vals = ",\n".join(f"('{r['rec_id']}'::uuid,'{r['snap']}',{lit(r['url'])},{lit(r['host'])},"
                      f"{lit(r['quote']) if r['quote'] else 'null::text'},{r['conf']},'{r['ev']}')" for r in rows)
    chk = hashlib.md5(",".join(f"{r['rec_id']}|{r['snap']}|{hashlib.md5(r['url'].encode()).hexdigest()}|"
                               f"{hashlib.md5((r['quote'] or '').encode()).hexdigest()}|{r['conf']}"
                               for r in sorted(rows, key=lambda r: r["rec_id"])).encode()).hexdigest()
    return f"""with v(id,snap,nu,nh,nq,nc,ev) as (values
{vals}),
chk as (select md5(string_agg(id::text||'|'||snap||'|'||md5(nu)||'|'||md5(coalesce(nq,''))||'|'||nc::text, ',' order by id::text collate "C"))='{chk}' good from v),
ok as (select r.*, v.nu, v.nh, v.nq, v.nc, v.ev from public.book_recommendations r join v on v.id=r.id
       where (select good from chk) and md5(coalesce(r.source_url,'')||'|'||coalesce(r.quote,''))=v.snap
       and not exists (select 1 from {BACKUP_TABLE} b where b.id=r.id)),
ins as (insert into {BACKUP_TABLE}(id,book_id,person_id,source_url,source_name,quote,confidence_score,new_source_url,new_source_name,new_quote,new_confidence_score,evidence_strength,batch,backed_up_at)
        select id,book_id,person_id,source_url,source_name,quote,confidence_score,nu,nh,nq,nc,ev,'{batch}',now() from ok on conflict (id) do nothing returning id),
upd as (update public.book_recommendations r set source_url=ok.nu, source_name=ok.nh, quote=ok.nq, confidence_score=ok.nc
        from ok where r.id=ok.id and r.id in (select id from ins) returning r.id)
select (select good from chk) checksum_ok,(select count(*) from v) given,(select count(*) from ok) matched,(select count(*) from ins) backed_up,(select count(*) from upd) updated;"""


def accepted(strong_only=False) -> list[dict]:
    sc = {o["rec_id"]: o for o in scope()}
    out = []
    for rid, d in decisions().items():
        if d["verdict"] != "accept" or (strong_only and d["strength"] != "strong"):
            continue
        o = sc[rid]
        out.append({"rec_id": rid, "snap": o["snap"], "url": d["url"], "host": host_of(d["url"]),
                    "quote": d.get("quote"), "conf": STRONG if d["strength"] == "strong" else MEDIUM,
                    "ev": f"other_source:{d['strength']}"})
    return sorted(out, key=lambda r: r["rec_id"])


def cmd_emit(outdir: str, strong_only=False, size=100):
    rows = accepted(strong_only)
    for r in rows:
        assert not never(r["url"]) and r["url"].isascii(), r["url"]
    od = Path(outdir)
    od.mkdir(parents=True, exist_ok=True)
    chunks = ([rows[:10]] + [rows[i:i + size] for i in range(10, len(rows), size)]) if rows else []
    for n, ch in enumerate(chunks):
        s = batch_sql(ch, f"{BATCH_PREFIX}_b{n:02d}")
        assert s.isascii()
        (od / f"b{n:02d}.sql").write_text(s, encoding="ascii")
    print("rows", len(rows), "batches", [len(c) for c in chunks],
          Counter(r["conf"] for r in rows), "quotes", sum(bool(r["quote"]) for r in rows))


# ─── unresolved / stats ─────────────────────────────────────────────────────

NOT_WRITTEN = WORK / "not_written.json"  # {rec_id: reason} for verified rows the write guard skipped


def cmd_unresolved():
    """Every in-scope row without a written own source, with the reason."""
    dec = decisions()
    not_written = json.loads(NOT_WRITTEN.read_text()) if NOT_WRITTEN.exists() else {}
    cands = defaultdict(list)
    for c in jl_read(CANDS):
        cands[c["rec_id"]].append(c)
    searched = defaultdict(int)
    for x in jl_read(SEARCHES):
        searched[x["slug"]] += 1
    checked_hosts = defaultdict(set)  # pages actually fetched for the person
    for c in jl_read(CANDS):
        checked_hosts[c["slug"]].add(host_of(c.get("via") or c["url"]))
    n = Counter()
    with open(UNRESOLVED_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["rec_id", "person", "person_slug", "person_status", "book", "author", "reason", "checked_urls"])
        for o in scope():
            d = dec.get(o["rec_id"])
            if d and d["verdict"] == "accept" and o["rec_id"] not in not_written:
                continue
            if o["rec_id"] in not_written:
                reason = not_written[o["rec_id"]]
            elif d:
                reason = d["reason"]
            elif o["rec_id"] in cands:
                reason = "a checked page names the title, but not as the person's own recommendation (hand check)"
            else:
                where = "tim.blog and lexfridman.com transcript search"
                if searched[o["slug"]]:
                    where += f", {searched[o['slug']]} web search(es) and the pages they led to"
                if checked_hosts[o["slug"]]:
                    where += ", pages on " + ", ".join(sorted(checked_hosts[o["slug"]]))
                reason = "no own source found (" + where + ")"
            urls = sorted(({c["url"] for c in cands.get(o["rec_id"], [])} | ({d["url"]} if d else set())) - {"-"})
            w.writerow([o["rec_id"], o["person"], o["slug"], o["person_status"], o["title"], o["author"], reason, " ".join(urls)])
            n[reason.split(" (")[0][:60]] += 1
    print("unresolved rows", sum(n.values()), "->", UNRESOLVED_CSV)
    for k, v in n.most_common(20):
        print(f"  {v:4d}  {k}")


def cmd_stats():
    sc = scope()
    dec = decisions()
    srch = jl_read(SEARCHES)
    acc = [d for d in dec.values() if d["verdict"] == "accept"]
    kinds = Counter()
    cand_kind = {}
    for c in jl_read(CANDS):
        cand_kind[(c["rec_id"], c["url"])] = c["kind"]
    for d in acc:
        kinds[cand_kind.get((d["rec_id"], d["url"]), "?")] += 1
    print(json.dumps({"rows_in_scope": len(sc), "people": len({o['slug'] for o in sc}),
                      "searches": len(srch), "people_searched": len({s['slug'] for s in srch}),
                      "candidate_rows": len({c['rec_id'] for c in jl_read(CANDS)}),
                      "decided": len(dec), "accepted": len(acc),
                      "accepted_by_strength": Counter(d["strength"] for d in acc),
                      "accepted_by_kind": kinds, "quotes": sum(bool(d.get("quote")) for d in acc)}, indent=1, default=dict))


def main(argv):
    if not argv:
        sys.exit(__doc__)
    cmd, args = argv[0], argv[1:]
    if cmd == "load":
        cmd_load()
    elif cmd == "check":
        cmd_check(args[0], args[1:])
    elif cmd == "show":  # show URL TITLE [WIDTH]: longer context from the cached page, for the hand check
        for sp, c in contexts(cached_text(args[0])[1], args[1], int(args[2]) if len(args) > 2 else 700, n=6):
            print(f"--- [{sp}]\n{c}\n")
    elif cmd == "transcripts":  # transcripts BASE SLUG [SLUG ...]
        cmd_transcripts(args[1:], base=args[0])
    elif cmd == "review":  # review SLUG [WIDTH]: undecided candidates, one best context per page
        w = int(args[1]) if len(args) > 1 else 200
        sc = {o["rec_id"]: o for o in scope()}
        dec = decisions()
        seen = set()
        for c in jl_read(CANDS):
            if c["slug"] != args[0] or c["rec_id"] in dec or (c["rec_id"], c["url"]) in seen:
                continue
            seen.add((c["rec_id"], c["url"]))
            o = sc[c["rec_id"]]
            for sp, ctx in c["context"][:1]:
                mid = len(ctx) // 2
                print(f"{c['rec_id'][:8]} {o['title'][:40]!r} {c['url']}{' GUEST' if c.get('guest_post') else ''}\n    [{sp}] {ctx[max(0, mid - w):mid + w]}")
    elif cmd == "rosetta":  # rosetta SLUG URL [URL ...]
        cmd_rosetta(args[0], args[1:])
    elif cmd == "sitesearch":  # sitesearch SLUG BASE_URL [TERM ...]
        cmd_sitesearch(args[0], args[1], args[2:])
    elif cmd == "decide":
        q = None
        if "--quote" in args:
            i = args.index("--quote")
            q = args[i + 1]
            args = args[:i] + args[i + 2:]
        cmd_decide(args[0], args[1], args[2], args[3], " ".join(args[4:]), q)
    elif cmd == "search":  # log one web search: search SLUG QUERY...
        jl_append(SEARCHES, {"slug": args[0], "query": " ".join(args[1:]), "at": datetime.now(timezone.utc).isoformat()})
    elif cmd == "emit":
        cmd_emit(args[0], "--strong-only" in args, int(args[args.index("--size") + 1]) if "--size" in args else 100)
    elif cmd == "unresolved":
        cmd_unresolved()
    elif cmd == "stats":
        cmd_stats()
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
