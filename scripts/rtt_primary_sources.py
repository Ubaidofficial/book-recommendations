#!/usr/bin/env python3
"""
Second pointer index for orphaned recommendations: readthistwice.com (RTT).
DRY RUN by default. Same rules as scripts/find_primary_sources.py, whose
matching and verification code this script imports (it does not copy it).

WHY THIS SCRIPT EXISTS / AUTHORISATION

find_primary_sources.py hard-blocks readthistwice.com because RTT's Terms of
Use (last updated 2020-02-16) forbid automated access. On 2026-11-12 the
project owner decided, knowing that, to collect RTT's sitemap, /people and the
person pages once, for this task only: the site has not been in use for about
four years and its robots.txt is "User-agent: *" with no Disallow. That
exception lives ONLY in this script's RttFetcher. find_primary_sources.py keeps
its block, and RTT stays in BLOCKED_SITES / REJECT_HOSTS here too, so no RTT URL
is ever fetched as, or accepted as, a primary source.

RTT LIMITS (RttFetcher)
  generic User-Agent (fps.USER_AGENT), one connection, >= 2 s between requests,
  every response cached under reports/third_party_cache/readthistwice/
  (gitignored), only robots.txt, sitemap.xml, /people and /person/<slug> HTML
  pages (no /api, no /_next/data JSON), stop on the first 429 or 403.

WHAT IS STORED: NOTHING FROM RTT
  source_url is always the primary URL (tweet, podcast, interview, video,
  blog). No RTT URL, no RTT-written text, no mention of RTT, no credit in any
  column. A quote is stored only if its exact words were found at the primary
  source (for tweets: in a Wayback Machine snapshot of the tweet) and it is
  verbatim (no [brackets] or ellipses — RTT truncates long tweets with "…").

PIPELINE
  1. scope   ORPHANED_OWNER rows of reports/quote_reattribution_plan.csv, minus
             the ids in --exclude-ids (rows already written to
             public.bak_recs_primary_sources_20261112, including the one
             reverted on purpose), re-resolved against the live tables
             (fps.resolve_row: merged-book and duplicate-pair rows skipped).
  2. people  RTT sitemap /person/<slug> URLs (+ person links on /people) →
             fps.find_person_page (slug, slugified name, ALIAS_GROUPS, unique
             squashed slug) → page fetched → its person name must pass
             fps.page_names_person (strict name rule, alias names allowed).
  3. books   the page's embedded Next.js state (__NEXT_DATA__: the person's
             list, listBooks with sourceLink / sourceQuote / sourceDate, and
             book title + author) → fps.book_hits (normalized main title equal
             AND our author's surname among RTT's author tokens).
  4. verify  fps.evaluate_card for every cited source — same tiers
             (strong / medium / weak), blocklists, page clean-up (comments,
             sponsor reads), co-guest rule, news-story rule, date rule. RTT's
             sourceDate is used only to REJECT a source dated 2+ years before
             the book's first published year, never to accept one.
             Tweets: never fetched from x.com / twitter.com (refused in
             SourceFetcher). archive.org/wayback/available finds a snapshot,
             then the snapshot is read from web.archive.org (id_ form, no
             toolbar). Only the permalink tweet's own text, display name and
             handle are used (replies on the page are ignored).
  5. outputs reports/rtt_primary_source_candidates.csv (strong/medium/weak),
             rtt_primary_source_rejected.csv, rtt_primary_source_summary.json,
             rtt_weak_candidates.csv, rtt_handcheck.csv (context snippets for
             the hand check: every strong row + --sample-medium random medium).
  6. write   --emit-sql DIR [--include-medium]: guarded batches built by
             fps.emit_sql_batches (payload md5, snapshot guard on
             person_id/book_id/md5(source_url,quote), backup insert ON
             CONFLICT DO NOTHING; strong 80, medium 60), --pilot 10 then
             --batch-size 50. Run them with the Supabase MCP execute_sql.

  python3 -I scripts/rtt_primary_sources.py --exclude-ids reports/already_written_ids_20261112.json
  python3 -I scripts/rtt_primary_sources.py --offline --exclude-ids ... --include-medium \
      --emit-sql reports/rtt_write_batches_20261112 --batch-size 50 --pilot 10
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import re
import sys
import threading
import time
import urllib.parse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import find_primary_sources as fps  # noqa: E402  (shared matching + verification code)

RTT = "https://www.readthistwice.com"
RTT_HOST = "readthistwice.com"
RTT_CACHE = fps.CACHE / "readthistwice"
RTT_MIN_INTERVAL = 2.0
RTT_ALLOWED_PATH = re.compile(r"^/(robots\.txt|sitemap\.xml|people|person/[a-z0-9-]+)$")
SITE_LABEL = "outside index (not stored)"

NEVER_FETCH_HOSTS = ("twitter.com", "x.com", "t.co")
ARCHIVE_HOSTS = ("archive.org", "web.archive.org")
ARCHIVE_MIN_INTERVAL = 1.5
TRANSIENT_ERRORS = {"ConnectionError", "Timeout", "ReadTimeout", "ConnectTimeout", "ChunkedEncodingError", "SSLError"}

OUT_CANDS = fps.REPORTS / "rtt_primary_source_candidates.csv"
OUT_REJ = fps.REPORTS / "rtt_primary_source_rejected.csv"
OUT_SUMMARY = fps.REPORTS / "rtt_primary_source_summary.json"
OUT_WEAK = fps.REPORTS / "rtt_weak_candidates.csv"
OUT_HAND = fps.REPORTS / "rtt_handcheck.csv"
PREV_MRB_SUMMARY = fps.REPORTS / "prev_mrb_run" / "primary_source_summary.json"


class RttStop(RuntimeError):
    """RTT answered 429/403: stop, do not retry."""


class RttFetcher:
    """The one owner-authorised exception to BLOCKED_SITES: one connection, >= 2 s apart, cached, HTML pages only."""

    def __init__(self, offline=False):
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": fps.USER_AGENT, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
                               "Accept-Language": "en"})
        self.last = 0.0
        self.offline = offline
        self.requests = 0
        self.status = Counter()

    @staticmethod
    def cache_path(url):
        return RTT_CACHE / f"{hashlib.sha1(url.encode()).hexdigest()}.json"

    def get(self, url):
        p = urllib.parse.urlsplit(url)
        if fps.host_of(url) != RTT_HOST or p.query or not RTT_ALLOWED_PATH.match(p.path):
            raise ValueError(f"RttFetcher only fetches robots/sitemap/people/person HTML pages: {url}")
        cp = self.cache_path(url)
        if cp.exists():
            return json.loads(cp.read_text(encoding="utf-8"))
        if self.offline:
            return {"status": None, "error": "offline_not_cached", "text": ""}
        dt = time.time() - self.last
        if dt < RTT_MIN_INTERVAL:
            time.sleep(RTT_MIN_INTERVAL - dt)
        self.requests += 1
        try:
            r = self.s.get(url, timeout=30, allow_redirects=False)
            res = {"status": r.status_code, "url": url, "content_type": r.headers.get("content-type", ""),
                   "location": r.headers.get("location"), "text": r.text, "fetched_at": datetime.now(timezone.utc).isoformat()}
        except requests.RequestException as e:
            res = {"status": None, "url": url, "error": type(e).__name__, "text": ""}
        finally:
            self.last = time.time()
        self.status[str(res.get("status") or res.get("error"))] += 1
        if res.get("status") in (429, 403):
            raise RttStop(f"readthistwice answered {res['status']} for {url}: stopping")
        if res.get("status") is not None and res["status"] < 500:
            cp.parent.mkdir(parents=True, exist_ok=True)
            cp.write_text(json.dumps(res), encoding="utf-8")
        return res


class SourceFetcher(fps.Fetcher):
    """fps.Fetcher (cache, robots.txt, per-host >= 1.1 s, redirects checked hop by hop) plus:
    x.com / twitter.com / t.co are never requested (tweets are read from the Wayback Machine),
    archive hosts get >= 1.5 s, and transient network errors are not cached."""

    def __init__(self, offline):
        super().__init__(offline)
        self.consecutive_fail = Counter()
        self.host_locks = defaultdict(threading.Lock)

    def _one(self, url, max_bytes):
        h = fps.host_of(url)
        if any(h == x or h.endswith("." + x) for x in NEVER_FETCH_HOSTS):
            return {"status": None, "error": "never_fetch_x_or_twitter", "text": "", "_nocache": True}
        if self.consecutive_fail[h] >= 5:  # 5 resets/timeouts in a row: host unreachable for this run
            return {"status": None, "error": "ConnectionError", "text": "", "_nocache": True}
        with self.host_locks[h]:  # one connection per host even if two threads share it
            res = super()._one(url, max_bytes)
        self.consecutive_fail[h] = self.consecutive_fail[h] + 1 if res.get("error") in TRANSIENT_ERRORS else 0
        return res

    def _wait(self, host):
        if host in ARCHIVE_HOSTS:
            dt = time.time() - self.last.get(host, 0)
            if dt < ARCHIVE_MIN_INTERVAL:
                time.sleep(ARCHIVE_MIN_INTERVAL - dt)
            self.last[host] = time.time()
        else:
            super()._wait(host)

    def _raw(self, url, kind, max_bytes=6_000_000, check_robots=False):
        cp = self._cache_path(url, kind)
        if cp.exists():
            cached = json.loads(cp.read_text(encoding="utf-8"))
            if cached.get("status") is None and cached.get("error") in TRANSIENT_ERRORS and not self.offline:
                cp.unlink()  # a reset / timeout is not an answer: try again
        res = super()._raw(url, kind, max_bytes, check_robots)
        if res.get("status") is None and res.get("error") in TRANSIENT_ERRORS and cp.exists():
            cp.unlink()
        return res


# ─── Tweets via the Wayback Machine ─────────────────────────────────────────

TWEET_RE = re.compile(r"(?:twitter|x)\.com/([A-Za-z0-9_]{1,15})/status(?:es)?/(\d+)", re.I)


def tweet_ts(tid: str) -> str:
    t = int(tid)
    if t <= 2 ** 32:
        return ""
    return datetime.fromtimestamp(((t >> 22) + fps.TWITTER_EPOCH_MS) / 1000, timezone.utc).strftime("%Y%m%d")


def _attr(tag: str, name: str) -> str | None:
    m = re.search(rf'\b{name}="([^"]*)"', tag)
    return fps.html.unescape(m.group(1)) if m else None


def parse_tweet_snapshot(page: str, tid: str) -> dict | None:
    """The archived tweet's own text, display name and handle — never the replies around it."""
    # 2010-2020 twitter.com layout: the permalink tweet carries data-tweet-id / data-screen-name / data-name
    for m in re.finditer(r"<div[^>]+class=\"[^\"]*(?:permalink-tweet|tweet)[^\"]*\"[^>]*>", page):
        tag = m.group(0)
        if _attr(tag, "data-tweet-id") != tid:
            continue
        rest = page[m.end(): m.end() + 60000]
        tm = re.search(r"<p[^>]+class=\"[^\"]*js-tweet-text[^\"]*\"[^>]*>(.*?)</p>", rest, re.S)
        if tm:
            return {"text": fps.strip_tags(tm.group(1)), "author_name": _attr(tag, "data-name") or "",
                    "author_handle": (_attr(tag, "data-screen-name") or "").lower(), "how": "permalink"}
    # og: meta tags describe the page's own tweet ("Tom Hanks on Twitter" / “text”)
    def meta(prop):
        for t in re.findall(r"<meta[^>]+>", page):
            if _attr(t, "property") == prop or _attr(t, "name") == prop:
                return _attr(t, "content")
        return None
    desc, title = meta("og:description"), meta("og:title")
    canon = re.search(r'<link[^>]+rel="canonical"[^>]+href="[^"]*(?:twitter|x)\.com/([A-Za-z0-9_]{1,15})/status/(\d+)', page)
    if desc and title and re.search(r" on (?:Twitter|X)\s*$", title) and (not canon or canon.group(2) == tid):
        return {"text": desc.strip().strip("“”\""), "author_name": re.sub(r" on (?:Twitter|X)\s*$", "", title).strip(),
                "author_handle": canon.group(1).lower() if canon else "", "how": "og_meta"}
    return None


def make_wayback_tweet_verifier(F: SourceFetcher, stats: Counter):
    def verify_tweet(url):
        m = TWEET_RE.search(url)
        if not m:
            return {"fetched": False, "why": "tweet_url_unparsed"}
        handle, tid = m.group(1), m.group(2)
        snap = None
        for target in (f"twitter.com/{handle}/status/{tid}", f"x.com/{handle}/status/{tid}"):
            ts = tweet_ts(tid)
            api = "https://archive.org/wayback/available?url=" + urllib.parse.quote(target, safe="/") + (f"&timestamp={ts}" if ts else "")
            res = F.get(api, "primary")
            if res.get("status") != 200:
                stats[f"wayback_api_{res.get('status') or res.get('error')}"] += 1
                return {"fetched": False, "why": f"wayback_api_{res.get('status') or res.get('error')}"}
            try:
                closest = (json.loads(res["text"]).get("archived_snapshots") or {}).get("closest") or {}
            except ValueError:
                closest = {}
            if closest.get("available") and str(closest.get("status")) == "200" and closest.get("url"):
                snap = closest["url"]
                break
        if not snap:
            stats["wayback_no_snapshot"] += 1
            return {"fetched": False, "why": "wayback_no_snapshot"}
        snap = re.sub(r"^https?://web\.archive\.org/web/(\d+)(?:id_)?/", r"https://web.archive.org/web/\1id_/", snap)
        if not snap.startswith("https://web.archive.org/web/"):
            return {"fetched": False, "why": "wayback_unexpected_snapshot_url"}
        res = F.get(snap, "primary")
        if res.get("status") != 200 or not res.get("text"):
            stats[f"wayback_snapshot_{res.get('status') or res.get('error')}"] += 1
            return {"fetched": False, "why": f"wayback_snapshot_{res.get('status') or res.get('error')}"}
        tw = parse_tweet_snapshot(res["text"], tid)
        if not tw:
            stats["wayback_snapshot_unparsed"] += 1
            return {"fetched": False, "why": "wayback_snapshot_unparsed"}
        stats[f"wayback_ok_{tw['how']}"] += 1
        return {"fetched": True, "text_norm": fps.norm_text(tw["text"]), "author_name": tw["author_name"],
                "author_handle": tw["author_handle"] or None, "title": "", "snapshot": snap, "raw_text": tw["text"]}
    return verify_tweet


# ─── RTT parsing ────────────────────────────────────────────────────────────

def rtt_person_urls(R: RttFetcher) -> dict:
    sm = R.get(f"{RTT}/sitemap.xml")
    urls = set(re.findall(r"<loc>(https://www\.readthistwice\.com/person/[a-z0-9-]+)</loc>", sm.get("text", "")))
    n_sitemap = len(urls)
    pp = R.get(f"{RTT}/people")
    urls |= {RTT + p for p in re.findall(r'href="(/person/[a-z0-9-]+)"', pp.get("text", ""))}
    return {"slug_url": {u.rsplit("/", 1)[1]: u for u in urls}, "n_sitemap": n_sitemap, "n_total": len(urls)}


def parse_rtt_person(page_html: str, slug: str) -> dict | None:
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', page_html, re.S)
    if not m:
        return None
    st = json.loads(m.group(1))["props"]["pageProps"]["initialState"]
    me = next((p for p in st["person"]["persons"].values() if p.get("slug") == slug), None)
    if not me:
        return None
    books = st["book"]["books"]
    lists = [l for l in st["list"]["lists"].values() if l.get("personId") == me["personId"]]
    cards, dates = [], []
    for l in lists:
        dates += [l.get("createdAt"), l.get("updatedAt")]
        for lb in l.get("listBooks") or []:
            if lb.get("personId") not in (None, me["personId"]):
                continue
            dates.append(lb.get("createdAt"))
            b = books.get(lb.get("bookId"))
            if not b:
                continue
            link = (lb.get("sourceLink") or "").strip()
            sy = None
            if lb.get("sourceDate"):
                try:
                    sy = int(lb["sourceDate"][:4])
                except ValueError:
                    sy = None
            cards.append({"title": b.get("title") or "", "author": b.get("author") or "", "links": [link] if link else [],
                          "quote": (lb.get("sourceQuote") or "").strip() or None, "quote_attrib": None,
                          "has_context_only": False, "source_year": sy})
    claimed = sum(int((l.get("stats") or {}).get("books") or 0) for l in lists)
    return {"name": me.get("name"), "twitter": (me.get("twitterUsername") or "").lower(), "cards": cards,
            "claimed_books": claimed, "dates": [d for d in dates if d], "person_created": me.get("createdAt")}


def third_person_quote(quote: str, name: str) -> bool:
    """A sentence that names the person, or opens with he/she/his/her/they, is written ABOUT them."""
    qt = set(fps.tokens(quote))
    nt = [t for t in fps.tokens(name) if t not in fps.NAME_SUFFIX and len(t) > 2]
    return bool(nt and (nt[0] in qt or nt[-1] in qt)) or bool(re.match(r"\W*(he|she|his|her|they|their)\b", quote, re.I))


# ─── Hand-check context ─────────────────────────────────────────────────────

def context_snippet(text_norm: str, title_norm: str, quote: str, width=220) -> str:
    keys = [title_norm] + (fps.quote_fragments(quote)[:1] if quote else [])
    for k in keys:
        i = f" {text_norm} ".find(f" {k} ") if k else -1
        if i >= 0:
            return text_norm[max(0, i - width): i + len(k) + width]
    return ""


def main():
    ap = argparse.ArgumentParser(description="Primary sources for orphaned recommendations via an outside index (dry run by default)")
    ap.add_argument("--exclude-ids", required=True, help="JSON list of rec ids already written (backup table ids)")
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--max-person-pages", type=int, default=2000)
    ap.add_argument("--max-verify", type=int, default=8000)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--no-wayback", action="store_true", help="do not look tweets up in the Wayback Machine")
    ap.add_argument("--sample-medium", type=int, default=40)
    ap.add_argument("--seed", type=int, default=20261112)
    ap.add_argument("--emit-sql", metavar="DIR")
    ap.add_argument("--include-medium", action="store_true")
    ap.add_argument("--batch-size", type=int, default=50)
    ap.add_argument("--pilot", type=int, default=10)
    args = ap.parse_args()

    handle_map, handle_deny, domain_map, alias_groups, interview_hosts = fps.load_house_maps()
    exclude = set(json.loads(Path(args.exclude_ids).read_text()))

    # 1. scope, re-resolved against the live tables
    plan = [r for r in fps.csv_rows(fps.PLAN_CSV) if r["action"] == "ORPHANED_OWNER"]
    people = fps.sb_read_all("people", "id,slug,name,twitter_handle,index_status")
    people_by_slug = {p["slug"]: p for p in people}
    plan = [r for r in plan if r["owner_slug"] in people_by_slug]
    want = [r for r in plan if r["row_id"] not in exclude]
    fps.log(f"plan ORPHANED_OWNER rows: {len(plan)} · already written (excluded): {len(plan) - len(want)} · in scope: {len(want)}")
    recs = {r["id"]: r for r in fps.sb_read_ids("book_recommendations", "id,book_id,person_id,source_url,source_name,quote,confidence_score", [r["row_id"] for r in want])}
    books = {b["id"]: b for b in fps.sb_read_ids("books", "id,slug,title,subtitle,author_name,first_published_year", {r["book_id"] for r in recs.values()})}
    pair_count = Counter((r["person_id"], r["book_id"]) for r in fps.sb_read_all("book_recommendations", "id,person_id,book_id"))
    own = fps.Ownership(people_by_slug, handle_map, handle_deny, domain_map, alias_groups, interview_hosts)

    R = RttFetcher(args.offline)
    F = SourceFetcher(args.offline)
    wb_stats = Counter()

    try:
        lst = rtt_person_urls(R)
    except RttStop as e:
        sys.exit(f"STOPPED: {e}")
    slug_url = lst["slug_url"]
    squash_url = defaultdict(list)
    for s, u in slug_url.items():
        squash_url[fps.squash(s)].append(u)
    fps.log(f"outside-index person URLs: sitemap {lst['n_sitemap']}, with /people {lst['n_total']}")

    rows_all = defaultdict(list)
    for r in plan:
        rows_all[r["owner_slug"]].append(r)
    rows_by_person = defaultdict(list)
    for r in want:
        rows_by_person[r["owner_slug"]].append(r)

    # 2. person pages (sequential, >= 2 s apart): every person with orphaned rows that has a candidate page
    pages, page_status = {}, {}
    fetched_pages = 0
    try:
        for slug in sorted(rows_all, key=lambda s: -len(rows_all[s])):
            person = people_by_slug[slug]
            url = fps.find_person_page(slug, person, own, slug_url, squash_url)
            if not url:
                page_status[slug] = "no_page"
                continue
            if fetched_pages >= args.max_person_pages and not R.cache_path(url).exists():
                page_status[slug] = "page_cap"
                continue
            res = R.get(url)
            fetched_pages += 1
            if res.get("status") != 200:
                page_status[slug] = f"fetch_failed:{res.get('status') or res.get('error')}"
                continue
            pg = parse_rtt_person(res["text"], url.rsplit("/", 1)[1])
            if not pg:
                page_status[slug] = "page_unparsed"
                continue
            if not fps.page_names_person(pg["name"], slug, person, own, people_by_slug):
                page_status[slug] = "name_mismatch"
                fps.log(f"  skip {slug}: page name {pg['name']!r} != {person['name']!r}")
                continue
            pg["url"] = url
            pages[slug] = pg
            page_status[slug] = "matched"
    except RttStop as e:
        fps.log(f"\nSTOPPED: {e}  (requests {R.requests}, statuses {dict(R.status)})")
        sys.exit(2)

    collected = {}

    def verify_collect(url, stype):
        collected.setdefault(url, stype)
        return {"fetched": False, "why": "collect_pass"}

    tweet_verifier = None if args.no_wayback else make_wayback_tweet_verifier(F, wb_stats)
    verify = fps.make_verifier(F, False, tweet_verifier)

    def process(verify_fn):
        out, rejected, person_stats = [], [], {}
        for slug, rows in sorted(rows_by_person.items(), key=lambda kv: -len(kv[1])):
            person = people_by_slug[slug]
            st = person_stats[slug] = Counter(rows=len(rows))
            pg = pages.get(slug)
            if not pg:
                st["page_" + page_status.get(slug, "no_page").split(":")[0]] = len(rows)
                continue
            st["cards_rendered"] = len(pg["cards"])
            st["books_claimed"] = pg["claimed_books"]
            idx = defaultdict(list)
            for c in pg["cards"]:
                c["quote_attrib"] = person["name"]  # listBooks of the person's own list
                if c["quote"] and third_person_quote(c["quote"], person["name"]):
                    # Hand check: this index's "quote" is sometimes the article's sentence ABOUT the person
                    # ("His primary book source on management technique is ..."), not their words: drop it, so
                    # it can neither be stored nor satisfy the news-story rule.
                    c["quote"], c["has_context_only"] = None, True
                idx[fps.norm_title(c["title"])].append(c)
            for r in rows:
                why, rec, book, rebooked = fps.resolve_row(r, person, recs, books, pair_count)
                if why:
                    st[why] += 1
                    continue
                hits = fps.book_hits(idx, book)
                if not hits:
                    st["book_not_on_page"] += 1
                    continue
                base = {
                    "rec_id": r["row_id"], "person_slug": slug, "person_status": person["index_status"],
                    "book_slug": book["slug"], "book_title": book["title"], "book_author": book.get("author_name") or "",
                    "site": SITE_LABEL, "site_page_url": pg["url"],
                    "_book_id": rec["book_id"], "_person_id": rec["person_id"], "_fingerprint": fps.fingerprint(rec),
                    "_snapshot": fps.snapshot_md5(rec.get("source_url"), rec.get("quote")), "_rebooked": rebooked,
                }
                best = None
                for card in hits:
                    sdy = {fps.clean_url(u): card["source_year"] for u in card["links"]} if card["source_year"] else None
                    cand = fps.evaluate_card(card, base, slug=slug, person=person, book=book, rebooked=rebooked, own=own,
                                             profile_handles={pg["twitter"]} if pg["twitter"] else set(),
                                             verify_fn=verify_fn, rejected=rejected, source_date_years=sdy)
                    if cand and (best is None or fps.candidate_rank(cand) < fps.candidate_rank(best)):
                        best = cand
                if best:
                    out.append(best)
                    st[best["evidence_strength"]] += 1
                else:
                    st["matched_book_no_usable_source"] += 1
        return out, rejected, person_stats

    try:
        process(verify_collect)
        tweets = [u for u, s in collected.items() if s == "tweet"]
        t = None
        if tweets and tweet_verifier and not args.offline:
            # Wayback lookups run in their own thread (archive hosts only); other hosts one thread each
            t = threading.Thread(target=lambda: [verify(u, "tweet") for u in tweets[: args.max_verify]])
            t.start()
        fps.prefetch_primary(F, collected, args.max_verify, args.workers, args.offline, skip_types=("tweet",))
        if t:
            t.join()
        out, rejected, person_stats = process(verify)
    except fps.StopRun as e:
        fps.log(f"\nSTOPPED: {e}")
        sys.exit(2)

    fps.finalize_candidates(out)
    for c in out:  # hard rules
        u = c["primary_source_url"].lower()
        assert "readthistwice" not in u and "mostrecommendedbooks" not in u and not fps.is_blocked_site(u)
        assert c["_quote_to_write"] is None or c["quote_verified_at_primary"]
        assert "readthistwice" not in (c["_quote_to_write"] or "").lower() and "readthistwice" not in c["_source_name"].lower()

    # 3. outputs
    cols = ["rec_id", "person_slug", "person_status", "book_slug", "book_title", "book_author", "site", "site_page_url",
            "primary_source_url", "primary_source_type", "quote_text", "quote_verified_at_primary", "evidence_strength", "notes"]
    with open(OUT_CANDS, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols + ["_fingerprint", "_snapshot", "_person_id", "_book_id"], extrasaction="ignore")
        w.writeheader()
        w.writerows(out)
    with open(OUT_WEAK, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(c for c in out if c["evidence_strength"] == "weak")
    with open(OUT_REJ, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["rec_id", "person_slug", "book_slug", "book_title", "primary_source_url", "reason"], extrasaction="ignore")
        w.writeheader()
        w.writerows(rejected)

    # hand-check sheet: all strong + a seeded random sample of medium, with the primary text around the book
    rnd = random.Random(args.seed)
    med = sorted((c for c in out if c["evidence_strength"] == "medium"), key=lambda c: c["rec_id"])
    sample = rnd.sample(med, min(args.sample_medium, len(med)))
    with open(OUT_HAND, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["evidence_strength", "rec_id", "person_slug", "book_title", "book_author", "primary_source_url",
                                          "primary_source_type", "quote_to_write", "notes", "context"])
        w.writeheader()
        for c in [c for c in out if c["evidence_strength"] == "strong"] + sample:
            v = verify(c["primary_source_url"], fps.source_type(c["primary_source_url"]))
            w.writerow({"evidence_strength": c["evidence_strength"], "rec_id": c["rec_id"], "person_slug": c["person_slug"],
                        "book_title": c["book_title"], "book_author": c["book_author"], "primary_source_url": c["primary_source_url"],
                        "primary_source_type": c["primary_source_type"], "quote_to_write": c["_quote_to_write"] or "", "notes": c["notes"],
                        "context": v.get("raw_text") or context_snippet(v.get("text_norm", ""), fps.norm_title(c["book_title"]), c["quote_text"])})

    tot = Counter()
    for s in person_stats.values():
        tot.update(s)
    by_strength = Counter(c["evidence_strength"] for c in out)
    # coverage over the whole plan (6,505 rows / their owners), and over the people the earlier index lacked
    matched_people = {s for s, v in page_status.items() if v == "matched"}
    prev_no_page = set()
    if PREV_MRB_SUMMARY.exists():
        prev = json.loads(PREV_MRB_SUMMARY.read_text())
        prev_no_page = {s for s, v in prev["per_person"].items() if v.get("no_mrb_page")}
    all_dates = sorted(d for p in pages.values() for d in p["dates"])
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "plan_rows": len(plan), "plan_people": len(rows_all), "excluded_already_written": len(plan) - len(want),
        "rows_in_scope": len(want), "people_in_scope": len(rows_by_person),
        "index_person_urls": {"sitemap": lst["n_sitemap"], "with_people_page": lst["n_total"]},
        "person_pages_requested": fetched_pages,
        "page_status_people": dict(Counter(v.split(":")[0] for v in page_status.values())),
        "plan_owners_with_page": len(matched_people),
        "plan_rows_whose_owner_has_page": sum(len(rows_all[s]) for s in matched_people),
        "prev_index_no_page_people": len(prev_no_page),
        "prev_index_no_page_people_covered_here": len(prev_no_page & matched_people),
        "prev_index_no_page_rows_covered_here": sum(len(rows_all[s]) for s in prev_no_page & matched_people),
        "index_latest_dates": all_dates[-5:],
        "index_dates_by_year": dict(Counter(d[:4] for d in all_dates)),
        "rows_with_candidate": len(out), "by_strength": dict(by_strength),
        "by_strength_and_type": {k: dict(Counter(c["primary_source_type"] for c in out if c["evidence_strength"] == k)) for k in ("strong", "medium", "weak")},
        "quote_verified_at_primary": dict(Counter(c["evidence_strength"] for c in out if c["quote_verified_at_primary"])),
        "quote_to_write": dict(Counter(c["evidence_strength"] for c in out if c["_quote_to_write"])),
        "unmatched_breakdown": {k: v for k, v in tot.items() if k not in ("rows", "strong", "medium", "weak", "cards_rendered", "books_claimed")},
        "rejected_sources_by_reason": dict(Counter(re.sub(r":.*$", "", x["reason"]) for x in rejected)),
        "wayback": dict(wb_stats),
        "index_requests_this_run": R.requests, "index_status_this_run": dict(R.status),
        "network_requests_this_run": dict(F.network_requests),
        "http_status_by_host_this_run": {h: dict(c) for h, c in F.status_by_host.items()},
        "hosts_blocked_this_run": F.blocked_hosts,
        "per_person": {k: dict(v) for k, v in sorted(person_stats.items(), key=lambda kv: -kv[1]["rows"])},
    }
    OUT_SUMMARY.write_text(json.dumps(summary, indent=1), encoding="utf-8")
    for k in ("plan_owners_with_page", "plan_rows_whose_owner_has_page", "prev_index_no_page_people", "prev_index_no_page_people_covered_here",
              "prev_index_no_page_rows_covered_here", "page_status_people", "index_latest_dates", "rows_with_candidate", "by_strength",
              "by_strength_and_type", "quote_verified_at_primary", "quote_to_write", "unmatched_breakdown", "rejected_sources_by_reason",
              "wayback", "index_requests_this_run", "index_status_this_run", "hosts_blocked_this_run"):
        fps.log(f"{k}: {summary[k]}")
    fps.log(f"wrote {OUT_CANDS.name}, {OUT_REJ.name}, {OUT_WEAK.name}, {OUT_HAND.name}, {OUT_SUMMARY.name}")

    # 4. guarded SQL batches
    levels = {"strong"} | ({"medium"} if args.include_medium else set())
    already = [c for c in out if recs[c["rec_id"]].get("source_url") == c["primary_source_url"]]
    todo = sorted((c for c in out if c["evidence_strength"] in levels and recs[c["rec_id"]].get("source_url") != c["primary_source_url"]),
                  key=lambda c: (c["evidence_strength"] != "strong", c["person_status"] != "published", c["person_slug"], c["rec_id"]))
    fps.log(f"{len(already)} candidate rows already carry that primary source: skipped")
    if args.emit_sql:
        stamp = "src2-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        man = fps.emit_sql_batches(todo, Path(args.emit_sql), args.batch_size, args.pilot, stamp)
        for b in man:  # nothing from the outside index may reach the database
            sql = (Path(args.emit_sql) / b["file"]).read_text(encoding="utf-8").lower()
            assert "readthistwice" not in sql and "mostrecommendedbooks" not in sql, b["file"]
        fps.log(f"emitted {len(man)} guarded batches for {len(todo)} rows ({dict(Counter(c['evidence_strength'] for c in todo))}) → {args.emit_sql}")
    else:
        fps.log("DRY RUN — nothing written.")


if __name__ == "__main__":
    main()
