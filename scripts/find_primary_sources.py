#!/usr/bin/env python3
"""
Find a PRIMARY source for "orphaned" recommendations, using a third-party
recommendation index only as a pointer.  DRY RUN by default.

BACKGROUND

scripts/reattribute_quotes.js planned 6,505 ORPHANED_OWNER rows: the
recommendation's stored source_url/quote aggregate belongs entirely to other
people, so after that script's write the row would carry source_url=NULL,
quote=NULL, confidence 30. This script looks the same (person, book) pair up on
mostrecommendedbooks.com (MRB), reads the ORIGINAL source MRB cites (the
person's tweet, blog, podcast, interview, video), checks that source belongs to
the person, and where possible fetches that source to confirm the book / quote
is really there.

WHAT WE TAKE FROM THE THIRD-PARTY SITE — AND WHAT WE DO NOT

  * Only the cited primary URL (a fact pointer) and, for display in the CSV,
    the person's own quoted words MRB shows. MRB's own editorial text
    ("X mentioned this book on ... podcast") is never stored.
  * source_url written to our table is ALWAYS the primary URL, never an MRB or
    readthistwice.com URL.
  * A quote is written only if it was found at the primary source
    (quote_verified_at_primary=True). Otherwise the CSV marks it
    quote_from_third_party_unverified and the write path stores quote=NULL.

SITE POLICY (checked 2026-11-12, see reports/third_party_cache/_policy/)

  mostrecommendedbooks.com  robots.txt: "User-Agent: * / Disallow: /api,
                            /search, /admin, /go/" — person pages
                            (/people/<slug>-recommended-books) are allowed.
                            ToS has no automated-access clause; §4 forbids
                            reproducing MRB-created text. We fetch HTML person
                            pages only; never /api, /search, /go/.
                            NOTE: /developers offers a free JSON API at
                            /api/v1/people/{slug} ("data is free to use ...
                            please cite mostrecommendedbooks.com"), but
                            robots.txt disallows /api, so it is NOT used here.
  readthistwice.com         ToS (Terms of Use, last updated 2020-02-16): "you
                            will not access the Site through automated or
                            non-human means, whether through a bot, script, or
                            otherwise" — NOT FETCHED. Hard-blocked below.
                            (The owner authorised one separate collection on
                            2026-11-12 in scripts/rtt_primary_sources.py, which
                            imports this module; the block here stays.)

POLITENESS
  Generic User-Agent, >= 1.1 s between requests to the same host, every
  response cached under reports/third_party_cache/ (gitignored), robots.txt
  honoured for every host before fetching, page caps (--max-person-pages,
  --max-verify).

MATCHING (precision over recall)
  person  our slug / slugified name / alias → MRB sitemap entry; the MRB page
          <title> name must equal our person's name (squashed) or the person is
          skipped.
  book    normalized main title equal (subtitle dropped, leading article
          dropped) AND our author's surname among MRB's author tokens.
  owner   tweet/x/medium/facebook handle known for the person (people.twitter_handle,
          HANDLE_MAP, handle == slug squashed — maps are read from
          scripts/reattribute_quotes.js so evidence lives in one place),
          or a DOMAIN_MAP personal domain           → strong-eligible
          tweet whose oEmbed display name == person name   → medium cap
          interview/podcast page whose path names the person (whole tokens)
          or YouTube video whose title/channel names the person → medium cap
          third-party article, MRB shows the person's own quote, and the page
          fetched contains the person's name + book title  → weak
          bookstore / goodreads / wikipedia / MRB / readthistwice / other
          accounts' tweets / no evidence → rejected (reports/primary_source_rejected.csv)
  strong  = strong-eligible owner AND the primary text (tweet oEmbed or page)
            names the book or contains the quote.

TIGHTENED AFTER THE 2026-11-12 HAND CHECK (all-scope run, 6,505 rows)
  * medium needs the book named, or the person's quote found, AT the primary.
    X (publish.twitter.com, syndication, x.com), Facebook and Instagram all
    disallow automated access in robots.txt, and YouTube oEmbed gives only a
    title, so those candidates rest on the pointer site alone → weak (CSV).
  * on a general news host (not INTERVIEW_HOSTS) a path naming the person is
    often a story ABOUT them → medium needs their quoted words on the page.
  * interview path that also names the book's author (a co-guest's own book)
    → weak.  Readers' comments and the tim.blog Audible sponsor read are
    stripped before looking for the book.
  * a source dated (tweet snowflake id, /YYYY/ in the path) 2+ years before
    the book's first_published_year is rejected.
  * a quote is stored only if verified at the primary AND verbatim: quotes the
    pointer site edited with [brackets] or ellipses are not stored.
  * person match also accepts a squashed slug ("j-k-rowling" ~ "jk-rowling")
    and our name with extra middle names; the page name may equal any name in
    the person's ALIAS_GROUPS group.
  * plan rows are re-resolved against the live tables: rows whose book was
    merged onto a different-title book, or whose (person, book) pair now has
    two rows, are skipped.
  * redirects are followed by hand and every hop is checked against
    BLOCKED_SITES and robots.txt; a 429 (or 403 from MRB) stops the run.

OUTPUT
  reports/primary_source_candidates.csv  (strong/medium/weak)
  reports/primary_source_rejected.csv    (audit: matched book, unusable source)
  reports/primary_source_summary.json

SCOPE
  --scope published (default) | all   (--include-draft = all)

WRITE
  Guarded SQL batches for the Supabase SQL editor / MCP execute_sql:
    python3 -I scripts/find_primary_sources.py --scope all --include-medium \
        --emit-sql reports/primary_source_write_batches_20261112 [--batch-size 200 --pilot 10]
  000_backup_table.sql creates public.bak_recs_primary_sources_20261112 (RLS on,
  restore SQL in the table comment). Each batch_NNN.sql carries its payload's
  md5; a row is backed up and updated only if its live person_id, book_id and
  md5(source_url, quote) still equal the dry-run snapshot, and only once (the
  backup insert is ON CONFLICT DO NOTHING). Rows that already carry their
  primary URL are left out.
  Or via REST: SUPABASE_SECRET_KEY=... ... --write --confirm [--include-medium]
  (same snapshot guard, JSON backup in backups/).
  Updates only source_url, quote (verified + verbatim, else NULL), source_name,
  confidence_score (strong 80, medium 60). Weak is never written.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import os
import re
import sys
import threading
import time
import unicodedata
import urllib.parse
import urllib.robotparser
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import requests

SUPABASE_URL = "https://ghpdpvatfmvsahzsqgpp.supabase.co"
READ_KEY = "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z"
ROOT = Path(__file__).resolve().parent.parent
REPORTS = ROOT / "reports"
BACKUPS = ROOT / "backups"
CACHE = REPORTS / "third_party_cache"
PLAN_CSV = REPORTS / "quote_reattribution_plan.csv"
HOUSE_SCRIPT = ROOT / "scripts" / "reattribute_quotes.js"

USER_AGENT = "BookSourceVerifier/0.1 (+primary-source lookup for a book-recommendation index; polite, cached)"
MIN_INTERVAL = 1.1  # seconds between requests to one host
MRB = "https://mostrecommendedbooks.com"
BLOCKED_SITES = {"readthistwice.com": "Terms of Use forbid access 'through automated or non-human means, whether through a bot, script, or otherwise'"}
MRB_FORBIDDEN_PREFIXES = ("/api", "/search", "/admin", "/go/")

HIGH_CONFIDENCE = 80
MEDIUM_CONFIDENCE = 60

REJECT_HOSTS = (
    "amazon.", "amzn.", "goodreads.", "openlibrary.", "books.google.", "bookshop.org", "barnesandnoble.",
    "audible.", "wikipedia.org", "mostrecommendedbooks.com", "readthistwice.com", "bit.ly",
    "indiebound.", "booksamillion.", "thriftbooks.", "abebooks.", "blinkist.", "scribd.",
)
SOCIAL_HANDLE_HOSTS = {"twitter.com", "x.com", "mobile.twitter.com", "facebook.com", "instagram.com", "threads.net", "linkedin.com"}
PODCAST_HINTS = ("podcast", "episode", "/ep-", "/ep/", "knowledge-project", "show-notes", "transcript")
PODCAST_HOSTS = ("open.spotify.com", "podcasts.apple.com", "overcast.fm", "podbean.com", "libsyn.com", "simplecast.com",
                 "tim.blog", "fs.blog", "lexfridman.com", "joerogan", "investorfieldguide.com", "art19.com", "megaphone.fm")


LUKEWARM = re.compile(r"gave up|give up|didn.t need to be|good luck finishing|overrated|didn.t (?:like|enjoy|finish)|not worth|disappoint|boring|couldn.t finish|meh\b|too long|skim|the meat was in the beginning|hated", re.I)

# Podcast sponsor read on tim.blog episode pages: "brought to you by Audible ... I have two to recommend: The
# Graveyard Book ... Vagabonding ... go to Audible.com/Tim" — the HOST's ad, not the guest's recommendation.
SPONSOR_AD = re.compile(r"brought to you by\W+audible\b.{0,700}?audible\.com/tim", re.I | re.S)

LISTICLE_TOKENS = {"book", "books", "reading", "recommendations", "recommends", "recommended", "favorite",
                   "favourite", "favorites", "favourites", "picks", "list", "reads", "summer"}

# ─── Helpers ────────────────────────────────────────────────────────────────

def squash(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


def tokens(s: str) -> list[str]:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return [t for t in re.split(r"[^a-z0-9]+", s) if t]


def slugify(s: str) -> str:
    return "-".join(tokens(s))


def norm_title(t: str) -> str:
    t = html.unescape(str(t or ""))
    t = re.split(r"\s*[:(\[]\s*|\s+[-–—]\s+", t)[0]
    toks = tokens(t.replace("&", " and "))
    if toks and toks[0] in ("the", "a", "an"):
        toks = toks[1:]
    return " ".join(toks)


NAME_SUFFIX = {"jr", "sr", "ii", "iii", "iv", "phd", "md", "dr", "prof", "sir"}


def surname(author: str) -> str | None:
    first_author = re.split(r",|;|\band\b|&", str(author or ""))[0]
    toks = [t for t in tokens(first_author) if t not in NAME_SUFFIX]
    return toks[-1] if toks else None


def norm_text(s: str) -> str:
    s = html.unescape(str(s or ""))
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return " ".join(tokens(s))


def quote_fragments(q: str) -> list[str]:
    """MRB edits quotes with [this book] and ellipses: verify the person's words fragment by fragment."""
    parts = re.split(r"\[[^\]]*\]|\.\.\.|…", q or "")
    return [norm_text(p) for p in parts if len(tokens(p)) >= 3]


def quote_in(q: str, text_norm: str) -> bool:
    frags = quote_fragments(q)
    return bool(frags) and all(f in text_norm for f in frags)


TWITTER_EPOCH_MS = 1288834974657


def source_year(url: str) -> int | None:
    """Year a source was published, when the URL says so: tweet snowflake id, or /YYYY/ in a path."""
    if source_type(url) == "tweet":
        m = re.search(r"/status(?:es)?/(\d{6,})", url)
        if m and int(m.group(1)) > 2 ** 32:  # snowflake ids only (from late 2010)
            return datetime.fromtimestamp(((int(m.group(1)) >> 22) + TWITTER_EPOCH_MS) / 1000, timezone.utc).year
        return None
    m = re.search(r"/((?:19[89]|20[0-3])\d)/(?:[01]?\d/)?", urllib.parse.urlsplit(url).path)
    return int(m.group(1)) if m else None


def quote_is_verbatim(q: str) -> bool:
    """A quote with [editorial insertions] or ellipses is the pointer site's edit, not the person's words."""
    return bool(q) and not re.search(r"[\[\]…]|\.\.\.", q)


def title_in(title_norm: str, text_norm: str) -> bool:
    if not title_norm:
        return False
    if len(title_norm.split()) == 1 and len(title_norm) < 5:
        return False  # too short to be evidence ("it", "dune")
    return f" {title_norm} " in f" {text_norm} "


def name_in_tokens(name: str, toks: list[str]) -> bool:
    nt = [t for t in tokens(name) if t not in NAME_SUFFIX and len(t) > 1]
    if len(nt) < 2:
        return False
    s = set(toks)
    return nt[0] in s and nt[-1] in s


def host_of(url: str) -> str:
    h = urllib.parse.urlsplit(url).hostname or ""
    return h[4:] if h.startswith("www.") else h


def csv_rows(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def log(*a):
    print(*a, flush=True)


# ─── House evidence maps (single source of truth: reattribute_quotes.js) ────

def load_house_maps():
    js = HOUSE_SCRIPT.read_text(encoding="utf-8")

    def block(name, open_ch, close_ch):
        i = js.index(f"const {name} =")
        j = js.index(open_ch, i)
        depth = 0
        for k in range(j, len(js)):
            if js[k] == open_ch:
                depth += 1
            elif js[k] == close_ch:
                depth -= 1
                if depth == 0:
                    return js[j:k + 1]
        raise ValueError(name)

    handle_map = dict(re.findall(r'^\s*([a-z0-9_]+):\s*"([a-z0-9-]+)"', block("HANDLE_MAP", "{", "}"), re.M))
    handle_deny = set(re.findall(r'"([a-z0-9_]+)"', block("HANDLE_DENY", "[", "]")))
    domain_map = re.findall(r'\["([^"]+)",\s*"([a-z0-9-]+)"\]', block("DOMAIN_MAP", "[", "]"))
    alias_groups = [re.findall(r'"([a-z0-9-]+)"', g) for g in re.findall(r"\[([^\[\]]+)\]", block("ALIAS_GROUPS", "[", "]")[1:-1])]
    interview_hosts = set(re.findall(r'"([a-z0-9.-]+)"', block("INTERVIEW_HOSTS", "[", "]")))
    return handle_map, handle_deny, domain_map, alias_groups, interview_hosts


# ─── Polite cached fetcher ──────────────────────────────────────────────────

class StopRun(RuntimeError):
    """The pointer site rate-limited or blocked us: stop, do not retry."""


def is_blocked_site(url: str) -> str | None:
    h = host_of(url)
    for blocked, why in BLOCKED_SITES.items():
        if h == blocked or h.endswith("." + blocked):
            return why
    return None


class Fetcher:
    """Cached, robots-honouring, per-host rate-limited GET.

    Redirects are followed by hand (max 5 hops) so that every hop is checked
    against BLOCKED_SITES and that host's robots.txt: a primary URL that
    redirects to readthistwice.com or to an MRB /go/ link is never requested.
    A 429 (or 403 from MRB) is not cached: MRB raises StopRun, any other host
    is marked blocked for the rest of the run. Safe for one thread per host.
    """

    def __init__(self, offline: bool):
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "en"})
        self.last = {}
        self.robots = {}
        self.offline = offline
        self.network_requests = Counter()
        self.status_by_host = defaultdict(Counter)
        self.blocked_hosts = {}
        self._lock = threading.Lock()

    def _cache_path(self, url: str, kind: str) -> Path:
        h = hashlib.sha1(url.encode()).hexdigest()
        return CACHE / kind / host_of(url) / f"{h}.json"

    def _wait(self, host):
        dt = time.time() - self.last.get(host, 0)
        if dt < MIN_INTERVAL:
            time.sleep(MIN_INTERVAL - dt)
        self.last[host] = time.time()

    def _one(self, url: str, max_bytes: int) -> dict:
        host = host_of(url)
        why = is_blocked_site(url)
        if why:
            raise RuntimeError(f"refusing to fetch {url}: {why}")
        if host in self.blocked_hosts:
            return {"status": None, "error": f"host_blocked_this_run:{self.blocked_hosts[host]}", "text": "", "_nocache": True}
        self._wait(host)
        with self._lock:
            self.network_requests[host] += 1
        try:
            r = self.s.get(url, timeout=25, allow_redirects=False, stream=True)
            body = b""
            for chunk in r.iter_content(65536):
                body += chunk
                if len(body) > max_bytes:
                    break
            ctype = r.headers.get("content-type", "")
            text = body.decode(r.encoding or "utf-8", errors="replace") if ("text" in ctype or "json" in ctype or "xml" in ctype) else ""
            res = {"status": r.status_code, "final_url": url, "content_type": ctype, "text": text,
                   "location": r.headers.get("location"), "fetched_at": datetime.now(timezone.utc).isoformat()}
        except requests.RequestException as e:
            res = {"status": None, "error": type(e).__name__, "text": ""}
        with self._lock:
            self.status_by_host[host][str(res.get("status") or res.get("error"))] += 1
        if res.get("status") == 429 or (res.get("status") == 403 and host == host_of(MRB)):
            res["_nocache"] = True
            if host == host_of(MRB):
                raise StopRun(f"{host} answered {res['status']} for {url}: stopping")
            self.blocked_hosts[host] = res["status"]
        return res

    def _raw(self, url: str, kind: str, max_bytes=6_000_000, check_robots=False) -> dict:
        cp = self._cache_path(url, kind)
        if cp.exists():
            return json.loads(cp.read_text(encoding="utf-8"))
        if self.offline:
            return {"status": None, "error": "offline_not_cached", "text": ""}
        cur = url
        for _hop in range(6):
            if check_robots and not self.allowed(cur):
                res = {"status": None, "error": "robots_disallowed" + ("" if cur == url else "_after_redirect"), "text": "", "final_url": cur}
                break
            res = self._one(cur, max_bytes)
            if res.get("status") in (301, 302, 303, 307, 308) and res.get("location"):
                nxt = urllib.parse.urljoin(cur, res["location"])
                if is_blocked_site(nxt):
                    res = {"status": None, "error": "redirect_to_blocked_site", "text": "", "final_url": nxt}
                    break
                cur = nxt
                continue
            break
        else:
            res = {"status": None, "error": "too_many_redirects", "text": ""}
        if res.pop("_nocache", False):
            return res
        cp.parent.mkdir(parents=True, exist_ok=True)
        cp.write_text(json.dumps(res), encoding="utf-8")
        return res

    def allowed(self, url: str) -> bool:
        if is_blocked_site(url):
            return False
        parts = urllib.parse.urlsplit(url)
        base = f"{parts.scheme}://{parts.netloc}"
        if base not in self.robots:
            res = self._raw(base + "/robots.txt", "robots")
            rp = urllib.robotparser.RobotFileParser()
            st = res.get("status")
            if st and 200 <= st < 300:
                rp.parse(res["text"].splitlines())
            elif st in (401, 403):
                rp.disallow_all = True
            else:
                rp.allow_all = True  # 404 / unreachable robots → no restrictions declared
            self.robots[base] = rp
        return self.robots[base].can_fetch(USER_AGENT, url)

    def get(self, url: str, kind="pages") -> dict:
        if host_of(url) == host_of(MRB) and any(urllib.parse.urlsplit(url).path.startswith(p) for p in MRB_FORBIDDEN_PREFIXES):
            return {"status": None, "error": "mrb_forbidden_path", "text": ""}
        return self._raw(url, kind, check_robots=True)


# ─── MRB parsing ────────────────────────────────────────────────────────────

CARD_H3 = re.compile(r'<h3 class="text-sm sm:text-base font-semibold[^>]*>(.*?)</h3>', re.S)
MAIN_BQ = re.compile(r'<blockquote class="mt-4 border-l-2[^"]*">(.*?)</blockquote>', re.S)
QUOTE_RE = re.compile(r'^\s*["“](.+)["”]\s*[-–—]\s*(.+?)\s*(?:\(Source\)\s*)+$', re.S)


def strip_tags(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s))


def parse_mrb_person(page: str) -> dict:
    title_m = re.search(r"<title>\s*\d*\s*(.+?) Recommended Books", page)
    claimed = re.search(r"has recommended (\d+) books", page)
    body = page[: page.find("self.__next_f.push")] if "self.__next_f.push" in page else page
    ms = list(CARD_H3.finditer(body))
    first_card = ms[0].start() if ms else len(body)
    profile_handles = set(h.lower() for h in re.findall(r'href="https://(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})"', body[:first_card]))
    cards = []
    for k, m in enumerate(ms):
        seg = body[m.end(): ms[k + 1].start() if k + 1 < len(ms) else len(body)]
        sub = re.match(r'\s*<p class="text-xs font-medium[^>]*>(.*?)</p>', seg, re.S)
        au = re.search(r'title="by ([^"]*)"', seg)
        bq = MAIN_BQ.search(seg)
        text, links = "", []
        if bq:
            links = [html.unescape(u) for u in re.findall(r'href="([^"]+)"', bq.group(1))]
            text = " ".join(strip_tags(bq.group(1)).split())
        qm = QUOTE_RE.match(text) if text else None
        cards.append({
            "title": strip_tags(m.group(1)).strip(),
            "subtitle": strip_tags(sub.group(1)).strip() if sub else "",
            "author": html.unescape(au.group(1)) if au else "",
            "links": links,
            "quote": qm.group(1).strip() if qm else None,
            "quote_attrib": qm.group(2).strip() if qm else None,
            "has_context_only": bool(text) and not qm,
        })
    return {"name": html.unescape(title_m.group(1)).strip() if title_m else None,
            "claimed_books": int(claimed.group(1)) if claimed else None,
            "profile_handles": profile_handles, "cards": cards}


# ─── Source classification ──────────────────────────────────────────────────

def source_type(url: str) -> str:
    h, p = host_of(url), urllib.parse.urlsplit(url).path.lower()
    if h in ("twitter.com", "x.com", "mobile.twitter.com") and "/status" in p:
        return "tweet"
    if "youtube.com" in h or h == "youtu.be":
        return "youtube"
    if any(x in h for x in PODCAST_HOSTS) or any(x in p for x in PODCAST_HINTS):
        return "podcast"
    if any(x in h for x in REJECT_HOSTS):
        return "book" if "amazon." in h else "other"
    return "other"


TRACKING_PARAMS = re.compile(r"^(utm_[a-z]+|s|ref|ref_src|fbclid|gclid|igshid|si|feature)$")


def clean_url(url: str) -> str:
    """Drop tracking params (x.com ?s=, utm_*, fbclid...). YouTube t= is kept."""
    p = urllib.parse.urlsplit(url.strip())
    q = [(k, v) for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True)
         if not TRACKING_PARAMS.match(k) and not (k == "t" and host_of(url) in ("x.com", "twitter.com"))]
    return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path, urllib.parse.urlencode(q), p.fragment))


def handle_of(url: str) -> str | None:
    h = host_of(url)
    if h in SOCIAL_HANDLE_HOSTS or h == "medium.com":
        seg = [s for s in urllib.parse.urlsplit(url).path.split("/") if s]
        if seg:
            return seg[0].lstrip("@").lower()
    return None


class Ownership:
    def __init__(self, people_by_slug, handle_map, handle_deny, domain_map, alias_groups, interview_hosts):
        self.handle_deny = handle_deny
        self.domain_map = domain_map
        self.interview_hosts = interview_hosts
        self.alias = defaultdict(set)
        for g in alias_groups:
            for s in g:
                self.alias[s] |= set(g)
        self.names = {p["slug"]: p["name"] for p in people_by_slug.values()}
        self.handles = defaultdict(set)  # slug → known handles
        for p in people_by_slug.values():
            h = (p.get("twitter_handle") or "").strip().lstrip("@").lower()
            if h:
                self.handles[p["slug"]].add(h)
        for h, slug in handle_map.items():
            self.handles[slug].add(h)

    def group(self, slug):
        return self.alias.get(slug, {slug}) | {slug}

    def known_handle(self, slug, person, h) -> bool:
        if not h or h in self.handle_deny:
            return False
        for s in self.group(slug):
            if h in self.handles.get(s, ()):
                return True
        # handle == slug squashed (multi-token slug, clean rendering of the name) — same rule as house script
        return "-" in slug and h.replace("_", "") == slug.replace("-", "") and squash(person["name"]) == slug.replace("-", "")

    @staticmethod
    def name_domain(url, name) -> bool:
        """host label == person's full name squashed (austenallred.com, patrickcollison.com)."""
        labels = host_of(url).split(".")
        return len(labels) == 2 and len(tokens(name)) >= 2 and labels[0] == squash(name)

    def personal_domain(self, slug, url) -> bool:
        hp = (host_of(url) + urllib.parse.urlsplit(url).path).lower()
        if self.name_domain(url, self.names.get(slug, "")):
            return True
        return any(hp.startswith(prefix) and s in self.group(slug) for prefix, s in self.domain_map)


# ─── Main pipeline ──────────────────────────────────────────────────────────

def sb_get(table, params, key=READ_KEY):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", params=params,
                     headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=60)
    r.raise_for_status()
    return r.json()


def sb_read_all(table, cols, page=1000):
    out = []
    for i in range(200):
        chunk = sb_get(table, {"select": cols, "order": "id", "offset": i * page, "limit": page})
        out += chunk
        if len(chunk) < page:
            return out
    raise RuntimeError("pagination bound hit")


def sb_read_ids(table, cols, ids, key=READ_KEY):
    out, ids = [], list(ids)
    for i in range(0, len(ids), 100):
        out += sb_get(table, {"select": cols, "id": "in.(" + ",".join(ids[i:i + 100]) + ")"}, key)
    return out


def fingerprint(r):
    return hashlib.sha1(json.dumps([r.get("source_url"), r.get("quote")]).encode()).hexdigest()[:16]


def snapshot_md5(source_url, quote) -> str:
    """Same as SQL md5(coalesce(source_url,'<null>')||chr(31)||coalesce(quote,'<null>'))."""
    s = ("<null>" if source_url is None else source_url) + "\x1f" + ("<null>" if quote is None else quote)
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def person_name_matches(page_name: str, person_name: str) -> bool:
    """MRB page <title> name vs ours: squashed equal, or ours only adds middle names/initials
    ("Balaji S. Srinivasan" ~ "Balaji Srinivasan"). Never a surname-only or one-token match."""
    if not page_name or not person_name:
        return False
    if squash(page_name) == squash(person_name):
        return True
    pt, ot = tokens(page_name), tokens(person_name)
    return len(pt) >= 2 and len(ot) > len(pt) and pt[0] == ot[0] and pt[-1] == ot[-1] and set(pt) <= set(ot)


BACKUP_TABLE = "public.bak_recs_primary_sources_20261112"
SOURCE_NAMES = {"tweet": "X (Twitter)", "youtube": "YouTube"}


def sql_lit(s: str) -> str:
    tag = "$p$"
    assert tag not in s
    return f"{tag}{s}{tag}"


def emit_sql_batches(todo: list[dict], out_dir: Path, batch_size: int, pilot: int, stamp: str):
    """One guarded statement per batch: payload checksum → snapshot guard → backup insert → update.

    A row is updated only if (a) the payload's md5 equals the value baked into the statement,
    (b) its live person_id, book_id and md5(source_url, quote) still equal the planning snapshot,
    and (c) its backup row was inserted in the same statement (ON CONFLICT DO NOTHING means a row
    already backed up — i.e. already written once — is never overwritten again).
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("batch_*.sql"):
        old.unlink()
    chunks = []
    if pilot:
        chunks.append(todo[:pilot])
        rest = todo[pilot:]
    else:
        rest = todo
    chunks += [rest[i:i + batch_size] for i in range(0, len(rest), batch_size)]
    manifest = []
    for n, chunk in enumerate(chunks):
        name = f"batch_{n:03d}{'_pilot' if pilot and n == 0 else ''}"
        payload = json.dumps([{
            "id": c["rec_id"], "pid": c["_person_id"], "bid": c["_book_id"], "snap": c["_snapshot"],
            "su": c["primary_source_url"], "sn": c["_source_name"], "q": c["_quote_to_write"],
            "cs": c["_confidence"], "ev": c["evidence_strength"],
        } for c in chunk], ensure_ascii=False, separators=(",", ":"))
        checksum = hashlib.md5(payload.encode("utf-8")).hexdigest()
        sql = f"""with p as (select {sql_lit(payload)}::text t),
chk as (select md5(t)='{checksum}' good from p),
v as (select x.* from p, jsonb_to_recordset(p.t::jsonb) as x(id uuid,pid uuid,bid uuid,snap text,su text,sn text,q text,cs int,ev text) where (select good from chk)),
cur as (select r.*,v.su,v.sn new_sn,v.q,v.cs,v.ev from public.book_recommendations r join v on r.id=v.id
  where r.person_id=v.pid and r.book_id=v.bid and md5(coalesce(r.source_url,'<null>')||chr(31)||coalesce(r.quote,'<null>'))=v.snap),
ins as (insert into {BACKUP_TABLE}(id,book_id,person_id,source_url,source_name,quote,confidence_score,new_source_url,new_source_name,new_quote,new_confidence_score,evidence_strength,batch)
  select id,book_id,person_id,source_url,source_name,quote,confidence_score,su,new_sn,q,cs,ev,'{stamp}/{name}' from cur on conflict (id) do nothing returning id),
upd as (update public.book_recommendations r set source_url=cur.su,source_name=cur.new_sn,quote=cur.q,confidence_score=cur.cs
  from cur where r.id=cur.id and r.id in (select id from ins) returning r.id,cur.q is not null has_q,cur.ev)
select (select good from chk) checksum_ok,(select count(*) from v) given,(select count(*) from cur) snapshot_ok,(select count(*) from ins) backed_up,
 (select count(*) from upd) updated,(select count(*) from upd where ev='strong') strong,(select count(*) from upd where ev='medium') medium,(select count(*) from upd where has_q) quotes;
"""
        (out_dir / f"{name}.sql").write_text(sql, encoding="utf-8")
        manifest.append({"file": f"{name}.sql", "rows": len(chunk), "checksum": checksum,
                         "rec_ids": [c["rec_id"] for c in chunk]})
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return manifest


BACKUP_DDL = f"""create table if not exists {BACKUP_TABLE} (
  id uuid primary key, book_id uuid, person_id uuid, source_url text, source_name text, quote text, confidence_score int,
  new_source_url text, new_source_name text, new_quote text, new_confidence_score int, evidence_strength text,
  batch text, backed_up_at timestamptz not null default now());
alter table {BACKUP_TABLE} enable row level security;
comment on table {BACKUP_TABLE} is 'Pre-write copy of book_recommendations rows given a primary source on 2026-11-12 (scripts/find_primary_sources.py). RESTORE: update public.book_recommendations r set source_url=b.source_url, source_name=b.source_name, quote=b.quote, confidence_score=b.confidence_score from {BACKUP_TABLE} b where r.id=b.id and r.source_url is not distinct from b.new_source_url;';
"""


# ─── Shared pipeline steps (also imported by scripts/rtt_primary_sources.py) ──

def find_person_page(slug: str, person: dict, own: "Ownership", slug_url: dict, squash_url: dict) -> str | None:
    """Pointer-site person page for one of our people: our slug, slugified name or an ALIAS_GROUPS slug;
    else a squashed slug ("j-k-rowling" ~ "jk-rowling", "dominic-d-agostino" ~ "dominic-dagostino"), unique hit only."""
    cands = [slug, slugify(person["name"])] + sorted(own.group(slug) - {slug})
    url = next((slug_url[c] for c in cands if c in slug_url), None)
    if not url:
        sq_hits = {u for c in (slug, slugify(person["name"])) for u in squash_url.get(squash(c), [])}
        url = next(iter(sq_hits)) if len(sq_hits) == 1 and len(tokens(person["name"])) >= 2 else None
    return url


def page_names_person(page_name: str, slug: str, person: dict, own: "Ownership", people_by_slug: dict) -> bool:
    """ALIAS_GROUPS (house script) lists duplicate stubs of one human ("o-shaughnessy" = "patrick-o-shaughnessy"):
    the page may carry the full name of any member of the group."""
    alias_names = [person["name"]] + [people_by_slug[s]["name"] for s in sorted(own.group(slug) - {slug}) if s in people_by_slug]
    return any(person_name_matches(page_name, n) for n in alias_names)


def resolve_row(r: dict, person: dict, recs: dict, books: dict, pair_count: Counter):
    """Plan row → (skip_reason | None, live rec, live book, rebooked). Books were merged after planning."""
    rec = recs.get(r["row_id"])
    if not rec:
        return "row_missing_in_db", None, None, False
    if rec["person_id"] != person["id"]:
        return "row_person_changed", rec, None, False
    book = books.get(rec["book_id"])
    if not book:
        return "row_book_missing", rec, None, False
    rebooked = book["slug"] != r["book_slug"]
    if rebooked and norm_title(book["title"]) != norm_title(r["book_title"]):
        return "row_rebooked_ambiguous", rec, book, rebooked  # merged onto a book with a different title: skip
    if pair_count[(rec["person_id"], rec["book_id"])] > 1:
        return "row_duplicate_pair_ambiguous", rec, book, rebooked
    return None, rec, book, rebooked


def book_hits(idx: dict, book: dict) -> list[dict]:
    """Cards whose normalized main title equals ours AND whose authors include our author's surname."""
    sn = surname(book.get("author_name"))
    return [c for c in idx.get(norm_title(book["title"]), []) if (sn is None or sn in tokens(c["author"]))]


def oembed_url(url, stype):
    if stype == "tweet":
        tw = re.sub(r"^https?://(www\.|mobile\.)?(x|twitter)\.com", "https://twitter.com", url.split("?")[0])
        return "https://publish.twitter.com/oembed?omit_script=1&url=" + urllib.parse.quote(tw, safe="")
    if stype == "youtube":
        return "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(url, safe="")
    return url


def page_text(html_text: str) -> tuple[str, str]:
    """(title, body text) of a fetched page with scripts, readers' comments and the tim.blog sponsor read removed."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html_text, "html.parser")
    for t in soup(["script", "style", "noscript"]):
        t.decompose()
    # readers' comments are not the person's words ("Who recommends The War of Art audiobook?")
    for t in soup.select("#comments, .comments, .comments-area, .comment-list, .commentlist, #disqus_thread, #wpdcom, .wp-block-comments-wpdiscuz"):
        t.decompose()
    ptitle = soup.title.get_text(" ", strip=True) if soup.title else ""
    return ptitle, SPONSOR_AD.sub(" ", " ".join(soup.get_text(" ").split()))


def make_verifier(F: "Fetcher", no_verify: bool = False, tweet_verifier=None):
    """verify(url, stype) → dict(fetched, text_norm, author_name, title[, author_handle]) from the primary source.
    tweet_verifier(url), when given, replaces the publish.twitter.com oEmbed lookup for tweets."""
    verify_cache = {}

    def verify(url, stype):
        if no_verify:
            return {"fetched": False, "why": "no_verify"}
        if url in verify_cache:
            return verify_cache[url]
        if stype == "tweet" and tweet_verifier is not None:
            v = tweet_verifier(url)
        elif stype == "tweet":
            res = F.get(oembed_url(url, stype), "primary")
            if res.get("status") == 200:
                try:
                    j = json.loads(res["text"])
                    body = re.sub(r"&mdash;.*$", "", j.get("html", ""), flags=re.S)
                    v = {"fetched": True, "text_norm": norm_text(strip_tags(body)), "author_name": j.get("author_name", ""),
                         "author_handle": (j.get("author_url", "").rstrip("/").rsplit("/", 1)[-1]).lower(), "title": ""}
                except ValueError:
                    v = {"fetched": False, "why": "oembed_bad_json"}
            else:
                v = {"fetched": False, "why": f"oembed_{res.get('status') or res.get('error')}"}
        elif stype == "youtube":
            res = F.get(oembed_url(url, stype), "primary")
            if res.get("status") == 200:
                try:
                    j = json.loads(res["text"])
                    v = {"fetched": True, "text_norm": "", "title": j.get("title", ""), "author_name": j.get("author_name", "")}
                except ValueError:
                    v = {"fetched": False, "why": "oembed_bad_json"}
            else:
                v = {"fetched": False, "why": f"oembed_{res.get('status') or res.get('error')}"}
        else:
            res = F.get(url, "primary")
            if res.get("status") == 200 and res.get("text"):
                ptitle, body_text = page_text(res["text"])
                v = {"fetched": True, "text_norm": norm_text(body_text), "title": ptitle, "author_name": "",
                     "final_url": res.get("final_url")}
            else:
                v = {"fetched": False, "why": str(res.get("status") or res.get("error") or "non_text")}
        verify_cache[url] = v
        return v

    return verify


def evaluate_card(card: dict, base: dict, *, slug: str, person: dict, book: dict, rebooked: bool, own: "Ownership",
                  profile_handles: set, verify_fn, rejected: list, source_date_years: dict | None = None):
    """Classify every source the pointer site cites for one (person, book) card; return the best candidate or None.

    card: title, author, links, quote, quote_attrib, has_context_only (pointer-site data, never stored).
    source_date_years: optional {url: year} the pointer site gives for a source, used only to REJECT a
    source that predates the book (never to accept one). Rejections are appended to `rejected`."""
    nt = norm_title(book["title"])
    sn = surname(book.get("author_name"))
    quote_is_persons = bool(card["quote"]) and squash(card["quote_attrib"]) == squash(person["name"])
    mrb_quote = card["quote"] if quote_is_persons else ""
    best = None
    for url in dict.fromkeys(clean_url(u) for u in card["links"]):
        notes = ["rebooked_after_merge(same_title)"] if rebooked else []
        if sn is None:
            notes.append("author_unknown_title_only_match")
        if not url.lower().startswith(("http://", "https://")):
            rejected.append({**base, "primary_source_url": url, "reason": "not_http_url"})
            continue
        h = host_of(url)
        stype = source_type(url)
        pth = urllib.parse.urlsplit(url).path
        if any(x in h for x in REJECT_HOSTS) or is_blocked_site(url):
            rejected.append({**base, "primary_source_url": url, "reason": "bookstore_or_index_or_aggregator_host"})
            continue
        # chronology: a source dated 2+ years before the book's first publication cannot be about it
        sy, fpy = source_year(url), book.get("first_published_year")
        if not sy and source_date_years:
            sy = source_date_years.get(url)
        if sy and fpy and sy < int(fpy) - 1:
            rejected.append({**base, "primary_source_url": url, "reason": f"source_predates_book:{sy}<{fpy}"})
            continue
        # ownership
        cap, basis = None, None
        hd = handle_of(url)
        if hd and own.known_handle(slug, person, hd):
            cap, basis = "strong", f"handle:{hd}"
        elif own.personal_domain(slug, url):
            cap, basis = "strong", "personal_domain"
        v = verify_fn(url, stype)
        if stype == "tweet" and v.get("fetched") and hd and v.get("author_handle") and v["author_handle"] != hd:
            rejected.append({**base, "primary_source_url": url, "reason": f"tweet_author_differs:{hd}->{v['author_handle']}"})
            continue
        if not cap and stype == "tweet":
            if v.get("fetched") and squash(v.get("author_name")) == squash(person["name"]) and hd in profile_handles:
                cap, basis = "medium", f"tweet_display_name+mrb_profile:{hd}"
            else:
                rejected.append({**base, "primary_source_url": url, "reason": f"tweet_by_unverified_account:{hd}"})
                continue
        if not cap and hd and stype != "tweet":
            rejected.append({**base, "primary_source_url": url, "reason": f"social_profile_not_known:{hd}"})
            continue
        if not cap and stype == "youtube":
            if v.get("fetched") and squash(v.get("author_name")) == squash(person["name"]):
                cap, basis = "medium", "youtube_channel_is_person"
            elif v.get("fetched") and name_in_tokens(person["name"], tokens(v.get("title"))):
                # title names the person, but it may be ABOUT them (another speaker) — spot-check found
                # "Ryan Holiday: Peter Thiel and the Gawker conspiracy", "Marc Benioff on ... Steve Jobs"
                cap, basis = "weak", "youtube_title_names_person(speaker_unconfirmed)"
            else:
                rejected.append({**base, "primary_source_url": url, "reason": "youtube_no_person_evidence" if v.get("fetched") else f"youtube_unverifiable:{v.get('why')}"})
                continue
        if not cap:
            path_toks = tokens(urllib.parse.unquote(pth))
            if name_in_tokens(person["name"], path_toks) or (("-" in slug) and slug in pth.lower()):
                if LISTICLE_TOKENS & set(path_toks) and h not in own.interview_hosts:
                    # "emma-watsons-book-recommendations", "adam-grant-picks-20-leadership-books": a list ABOUT them
                    cap, basis = "weak", "third_party_list_article_names_person"
                else:
                    cap = "medium"
                    basis = "interview_path_names_person" + ("(interview_host)" if h in own.interview_hosts else "")
            elif v.get("fetched") and mrb_quote and name_in_tokens(person["name"], v["text_norm"].split()) \
                    and (title_in(nt, v["text_norm"]) or quote_in(mrb_quote, v["text_norm"])):
                cap, basis = "weak", "third_party_article_quotes_person"
            else:
                rejected.append({**base, "primary_source_url": url, "reason": "no_ownership_evidence" + ("" if v.get("fetched") else f"(primary_unfetched:{v.get('why')})")})
                continue
        # verification at primary
        verified_quote = bool(mrb_quote) and v.get("fetched") and quote_in(mrb_quote, v.get("text_norm", ""))
        book_named = v.get("fetched") and (title_in(nt, v.get("text_norm", "")) or title_in(nt, norm_text(v.get("title", ""))))
        strength = cap
        if cap == "strong":
            if not v.get("fetched"):
                strength = "medium"; notes.append(f"primary_unfetched:{v.get('why')}")
            elif not (verified_quote or book_named):
                strength = "medium"; notes.append("book_not_named_in_primary_text")
        elif cap == "medium" and v.get("fetched") and stype not in ("youtube",) and not (verified_quote or book_named):
            strength = "weak"; notes.append("book_not_found_on_primary_page")
        elif cap == "medium" and not v.get("fetched"):
            notes.append(f"primary_unfetched:{v.get('why')}")
        if strength == "medium" and not (verified_quote or book_named):
            # Hand check (2026-11-12): with the primary text unreadable (X/Facebook disallow automated
            # access; YouTube oEmbed gives only a title) the book mention rests on the pointer site
            # alone, and it was wrong there (a 2015 tweet "everything by [this author]" cited for a
            # 2020 book). Medium therefore needs the book named, or the quote found, AT the primary.
            strength = "weak"; notes.append("book_mention_unverified_at_primary")
        if strength == "medium" and basis == "interview_path_names_person" and not verified_quote:
            # Hand check: on a general news host a path naming the person is often a story ABOUT them
            # ("microsoft-satya-nadella-nonviolent-communication", a Variety profile listing a reading
            # list) — not their own words. Outside the known interview hosts, medium needs the
            # person's quoted words found on that page.
            strength = "weak"; notes.append("news_article_about_person(persons_words_not_found)")
        if strength in ("strong", "medium") and (basis or "").startswith("interview_path") \
                and name_in_tokens(book.get("author_name") or "", tokens(urllib.parse.unquote(pth))) \
                and not name_in_tokens(book.get("author_name") or "", tokens(person["name"])):
            # "reid-hoffman-plus-michael-mccullough" cited for Hoffman's own The Start-up of You: the
            # book is the co-guest's own work, listed for that reason (house rule path_names_book_author)
            strength = "weak"; notes.append("path_names_book_author(co_guests_own_book)")
        if sn is None and strength == "strong":
            strength = "medium"
        if basis == "personal_domain" and len([x for x in pth.split("/") if x]) <= 1 and not title_in(nt, norm_text(pth.replace("-", " "))):
            notes.append("owner_index_page(reading-list/bookshelf, not a per-book recommendation)")
            if strength == "strong":
                strength = "medium"
        if mrb_quote and LUKEWARM.search(mrb_quote):
            notes.append("lukewarm_or_negative_quote_review")
            if strength == "strong":
                strength = "medium"
        if stype == "tweet" and not v.get("fetched") and "robots" in str(v.get("why")):
            notes.append("tweet_text_unverifiable(publish.twitter.com robots disallows /oembed)")
        if not mrb_quote and card["quote"]:
            notes.append("site_quote_attributed_to_other_name")
        if not mrb_quote and card["has_context_only"]:
            notes.append("site_shows_editorial_context_only(not_stored)")
        if mrb_quote and not verified_quote:
            notes.append("quote_from_third_party_unverified")
        if book_named:
            notes.append("book_named_at_primary")
        notes.append(f"owner_basis={basis}")
        cand = {**base, "primary_source_url": url, "primary_source_type": stype if stype != "other" else ("blog" if basis == "personal_domain" else ("interview" if "interview" in (basis or "") else "other")),
                "quote_text": mrb_quote, "quote_verified_at_primary": bool(verified_quote), "evidence_strength": strength,
                "notes": ";".join(notes), "_book_named": bool(book_named), "_primary_fetched": bool(v.get("fetched"))}
        if best is None or candidate_rank(cand) < candidate_rank(best):
            best = cand
    return best


def candidate_rank(c: dict) -> tuple:
    """Lower is better: strength first, then a quote verified at the primary."""
    return ({"strong": 0, "medium": 1, "weak": 2}[c["evidence_strength"]], not c["quote_verified_at_primary"])


def prefetch_primary(F: "Fetcher", collected: dict, max_verify: int, workers: int, offline: bool, skip_types=()):
    """Fetch every uncached primary URL gathered by a collect pass, one thread per host (per-host rate limit)."""
    todo_urls = [(oembed_url(u, s), u, s) for u, s in collected.items() if s not in skip_types]
    uncached = [t for t in todo_urls if not F._cache_path(t[0], "primary").exists()]
    if len(uncached) > max_verify:
        log(f"verify cap: {len(uncached)} uncached primary URLs, fetching first {max_verify}")
        uncached = uncached[:max_verify]
    by_host = defaultdict(list)
    for fu, _u, _s in uncached:
        by_host[host_of(fu)].append(fu)
    log(f"primary verification: {len(todo_urls)} URLs, {len(uncached)} uncached across {len(by_host)} hosts")

    def run_host(item):
        _h, urls = item
        for fu in urls:
            F.get(fu, "primary")

    from concurrent.futures import ThreadPoolExecutor
    if not offline:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            list(ex.map(run_host, sorted(by_host.items(), key=lambda kv: -len(kv[1]))))


def finalize_candidates(out: list[dict]):
    """List-URL spot-check, quote to write (verified AND verbatim), confidence and source_name."""
    # Spot-check: one "list" URL cited for many books is where the site's errors cluster (Obama's 2019-12-28
    # year-end tweet is cited for 20 books, several of which were on his earlier summer list instead).
    url_books = Counter(c["primary_source_url"] for c in out)
    for c in out:
        n = url_books[c["primary_source_url"]]
        if n >= 5:
            c["notes"] += f";same_url_cited_for_{n}_books(check_book_is_on_it)"
            if c["evidence_strength"] == "strong" and not c["_book_named"]:
                c["evidence_strength"] = "medium"
    for c in out:
        # store only the person's own verbatim words: verified at the primary AND free of the pointer site's
        # [bracketed] substitutions and ellipses (those edits are the site's text, not the person's)
        c["_quote_to_write"] = c["quote_text"] if c["quote_verified_at_primary"] and quote_is_verbatim(c["quote_text"]) else None
        if c["quote_verified_at_primary"] and not c["_quote_to_write"]:
            c["notes"] += ";quote_verified_but_site_edited(not_stored)"
        c["_confidence"] = HIGH_CONFIDENCE if c["evidence_strength"] == "strong" else MEDIUM_CONFIDENCE
        c["_source_name"] = SOURCE_NAMES.get(c["primary_source_type"], host_of(c["primary_source_url"]))



def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--scope", choices=("published", "all"), default="published",
                    help="published: rows of published people only (default); all: every ORPHANED_OWNER row")
    ap.add_argument("--include-draft", action="store_true", help="same as --scope all")
    ap.add_argument("--people", help="comma-separated person slugs to restrict to")
    ap.add_argument("--max-person-pages", type=int, default=2000)
    ap.add_argument("--max-verify", type=int, default=8000, help="cap on uncached primary-source verification fetches")
    ap.add_argument("--workers", type=int, default=8, help="hosts fetched in parallel during verification (one thread per host)")
    ap.add_argument("--no-verify", action="store_true")
    ap.add_argument("--offline", action="store_true", help="use cache only, no network")
    ap.add_argument("--emit-sql", metavar="DIR", help="write guarded SQL batches (strong, + medium with --include-medium) for execute_sql")
    ap.add_argument("--batch-size", type=int, default=200)
    ap.add_argument("--pilot", type=int, default=10, help="first --emit-sql batch holds this many rows (0 = no pilot)")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--confirm", action="store_true")
    ap.add_argument("--include-medium", action="store_true", help="--write/--emit-sql also apply medium evidence (default strong only)")
    args = ap.parse_args()
    scope_all = args.scope == "all" or args.include_draft

    if args.write and (not os.environ.get("SUPABASE_SECRET_KEY") or not args.confirm):
        sys.exit("--write requires SUPABASE_SECRET_KEY in the environment and --confirm.")

    handle_map, handle_deny, domain_map, alias_groups, interview_hosts = load_house_maps()

    # 1. Orphaned rows from the plan, re-resolved against the LIVE tables (books were merged after planning)
    plan = [r for r in csv_rows(PLAN_CSV) if r["action"] == "ORPHANED_OWNER"]
    log(f"plan ORPHANED_OWNER rows: {len(plan)}")
    people = sb_read_all("people", "id,slug,name,twitter_handle,index_status")
    people_by_slug = {p["slug"]: p for p in people}
    want = [r for r in plan if people_by_slug.get(r["owner_slug"]) and
            (scope_all or people_by_slug[r["owner_slug"]]["index_status"] == "published")]
    if args.people:
        keep = set(args.people.split(","))
        want = [r for r in want if r["owner_slug"] in keep]
    recs = {r["id"]: r for r in sb_read_ids("book_recommendations", "id,book_id,person_id,source_url,source_name,quote,confidence_score", [r["row_id"] for r in want])}
    books = {b["id"]: b for b in sb_read_ids("books", "id,slug,title,subtitle,author_name,first_published_year", {r["book_id"] for r in recs.values()})}
    # (person, book) pairs held by more than one live row are ambiguous after the merge
    pair_count = Counter((r["person_id"], r["book_id"]) for r in sb_read_all("book_recommendations", "id,person_id,book_id"))
    log(f"in scope ({'all' if scope_all else 'published'}): {len(want)} rows, {len({r['owner_slug'] for r in want})} people; rows still in DB: {len(recs)}")

    own = Ownership(people_by_slug, handle_map, handle_deny, domain_map, alias_groups, interview_hosts)
    F = Fetcher(args.offline)

    # 2. MRB person pages (sitemap → URL; robots honoured; never /api, /search, /admin, /go/)
    sm = F.get(f"{MRB}/people/sitemap.xml", "mrb")
    mrb_urls = set(re.findall(r"<loc>(https://mostrecommendedbooks\.com/people/[^<]+-recommended-books)</loc>", sm.get("text", "")))
    mrb_slug_url = {u.rsplit("/", 1)[1][: -len("-recommended-books")]: u for u in mrb_urls}
    mrb_squash_url = defaultdict(list)
    for s, u in mrb_slug_url.items():
        mrb_squash_url[squash(s)].append(u)
    log(f"MRB sitemap person pages: {len(mrb_slug_url)}")

    rows_by_person = defaultdict(list)
    for r in want:
        rows_by_person[r["owner_slug"]].append(r)

    collected = {}  # url → stype, filled by the collect pass

    def verify_collect(url, stype):
        collected.setdefault(url, stype)
        return {"fetched": False, "why": "collect_pass"}

    verify = make_verifier(F, args.no_verify)

    def process(verify_fn):
        out, rejected, person_stats = [], [], {}
        pages_fetched = 0
        for slug, rows in sorted(rows_by_person.items(), key=lambda kv: -len(kv[1])):
            person = people_by_slug[slug]
            st = person_stats[slug] = Counter(rows=len(rows))
            mrb_url = find_person_page(slug, person, own, mrb_slug_url, mrb_squash_url)
            if not mrb_url:
                st["no_mrb_page"] = len(rows)
                continue
            if any(urllib.parse.urlsplit(mrb_url).path.startswith(p) for p in MRB_FORBIDDEN_PREFIXES):
                continue
            if pages_fetched >= args.max_person_pages and not F._cache_path(mrb_url, "mrb").exists():
                st["page_cap"] = len(rows)
                continue
            res = F.get(mrb_url, "mrb")
            pages_fetched += 1
            if res.get("status") != 200:
                st["mrb_fetch_failed"] = len(rows)
                continue
            page = parse_mrb_person(res["text"])
            if not page_names_person(page["name"], slug, person, own, people_by_slug):
                st["mrb_name_mismatch"] = len(rows)
                log(f"  skip {slug}: MRB page name {page['name']!r} != {person['name']!r}")
                continue
            st["mrb_cards_rendered"] = len(page["cards"])
            st["mrb_books_claimed"] = page["claimed_books"] or 0
            idx = defaultdict(list)
            for c in page["cards"]:
                idx[norm_title(c["title"])].append(c)

            for r in rows:
                why, rec, book, rebooked = resolve_row(r, person, recs, books, pair_count)
                if why:
                    st[why] += 1
                    continue
                hits = book_hits(idx, book)
                if not hits:
                    st["unmatched_not_on_mrb_page"] += 1
                    continue
                card = next((c for c in hits if c["quote"]), hits[0])
                base = {
                    "rec_id": r["row_id"], "person_slug": slug, "person_status": person["index_status"],
                    "book_slug": book["slug"], "book_title": book["title"], "book_author": book.get("author_name") or "",
                    "site": "mostrecommendedbooks.com", "site_page_url": mrb_url,
                    "_book_id": rec["book_id"], "_person_id": rec["person_id"], "_fingerprint": fingerprint(rec),
                    "_snapshot": snapshot_md5(rec.get("source_url"), rec.get("quote")),
                    "_rebooked": rebooked,
                }
                best = evaluate_card(card, base, slug=slug, person=person, book=book, rebooked=rebooked, own=own,
                                     profile_handles=page["profile_handles"], verify_fn=verify_fn, rejected=rejected)
                if best:
                    out.append(best)
                    st[best["evidence_strength"]] += 1
                else:
                    st["matched_book_no_usable_source"] += 1
        return out, rejected, person_stats

    # 3a. Collect pass: MRB pages fetched (sequential, MRB rate limit), primary URLs gathered
    try:
        if not args.no_verify:
            process(verify_collect)
            prefetch_primary(F, collected, args.max_verify, args.workers, args.offline)
        # 3b. Real pass over cached data
        out, rejected, person_stats = process(verify)
    except StopRun as e:
        log(f"\nSTOPPED: {e}\nnetwork requests: {dict(F.network_requests)}")
        sys.exit(2)

    finalize_candidates(out)

    # 4. Outputs
    cols = ["rec_id", "person_slug", "person_status", "book_slug", "book_title", "book_author", "site", "site_page_url",
            "primary_source_url", "primary_source_type", "quote_text", "quote_verified_at_primary", "evidence_strength", "notes"]
    REPORTS.mkdir(exist_ok=True)
    with open(REPORTS / "primary_source_candidates.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols + ["_fingerprint", "_snapshot", "_person_id", "_book_id"], extrasaction="ignore")
        w.writeheader()
        w.writerows(out)
    with open(REPORTS / "primary_source_rejected.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["rec_id", "person_slug", "book_slug", "book_title", "primary_source_url", "reason"], extrasaction="ignore")
        w.writeheader()
        w.writerows(rejected)

    tot = Counter()
    for s in person_stats.values():
        tot.update(s)
    by_strength = Counter(c["evidence_strength"] for c in out)
    unmatched_keys = ("no_mrb_page", "mrb_name_mismatch", "unmatched_not_on_mrb_page", "matched_book_no_usable_source", "page_cap",
                      "mrb_fetch_failed", "row_missing_in_db", "row_person_changed", "row_book_missing", "row_rebooked_ambiguous",
                      "row_duplicate_pair_ambiguous")
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": "all" if scope_all else "published",
        "rows_in_scope": len(want), "rows_still_in_db": len(recs), "people_in_scope": len(rows_by_person),
        "rows_with_candidate": len(out), "by_strength": dict(by_strength),
        "by_strength_and_type": {k: dict(Counter(c["primary_source_type"] for c in out if c["evidence_strength"] == k)) for k in ("strong", "medium", "weak")},
        "quote_verified_at_primary": dict(Counter(c["evidence_strength"] for c in out if c["quote_verified_at_primary"])),
        "by_type": dict(Counter(c["primary_source_type"] for c in out)),
        "rebooked_after_merge_with_candidate": sum(1 for c in out if c["_rebooked"]),
        "unmatched_breakdown": {k: tot[k] for k in unmatched_keys if tot[k]},
        "rejected_sources_by_reason": dict(Counter(re.sub(r":.*$", "", x["reason"]) for x in rejected)),
        "network_requests_this_run": dict(F.network_requests),
        "http_status_by_host_this_run": {h: dict(c) for h, c in F.status_by_host.items()},
        "hosts_blocked_this_run": F.blocked_hosts,
        "sites": {"mostrecommendedbooks.com": "html person pages only (robots: /api,/search,/admin,/go/ disallowed)",
                  "readthistwice.com": "NOT FETCHED — " + BLOCKED_SITES["readthistwice.com"]},
        "per_person": {k: dict(v) for k, v in sorted(person_stats.items(), key=lambda kv: -kv[1]["rows"])},
    }
    (REPORTS / "primary_source_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")

    log(f"\nrows in scope {len(want)} (still in DB {len(recs)}) · with candidate {len(out)} · strong {by_strength['strong']} · medium {by_strength['medium']} · weak {by_strength['weak']} · unmatched {len(want) - len(out)}")
    log(f"  quote verified at primary: {summary['quote_verified_at_primary']}   types: {summary['by_strength_and_type']}")
    log(f"  unmatched breakdown: {summary['unmatched_breakdown']}")
    log(f"  rejected source links: {summary['rejected_sources_by_reason']}")
    log(f"  network requests this run: {summary['network_requests_this_run']}  blocked: {F.blocked_hosts}")
    log("\ntop 15 people (rows | strong medium weak | unmatched | MRB cards rendered/claimed):")
    for slug, s in list(sorted(person_stats.items(), key=lambda kv: -kv[1]["rows"]))[:15]:
        un = s["rows"] - s["strong"] - s["medium"] - s["weak"]
        extra = "no MRB page" if s["no_mrb_page"] else ("name mismatch" if s["mrb_name_mismatch"] else f"{s['mrb_cards_rendered']}/{s['mrb_books_claimed']}")
        log(f"  {slug:28s} {s['rows']:4d} | {s['strong']:3d} {s['medium']:3d} {s['weak']:3d} | {un:3d} | {extra}")
    log(f"\nwrote reports/primary_source_candidates.csv, primary_source_rejected.csv, primary_source_summary.json")

    levels = {"strong"} | ({"medium"} if args.include_medium else set())
    already = sum(1 for c in out if recs[c["rec_id"]].get("source_url") == c["primary_source_url"])
    if already:
        log(f"{already} candidate rows already carry their primary source (written earlier): skipped")
    todo = sorted((c for c in out if c["evidence_strength"] in levels and recs[c["rec_id"]].get("source_url") != c["primary_source_url"]),
                  key=lambda c: (c["evidence_strength"] != "strong", c["person_status"] != "published", c["person_slug"], c["rec_id"]))
    for c in todo:  # hard rules, re-checked at the last moment
        assert not is_blocked_site(c["primary_source_url"]) and "mostrecommendedbooks" not in c["primary_source_url"].lower()
        assert c["_quote_to_write"] is None or c["quote_verified_at_primary"]

    if args.emit_sql:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        d = Path(args.emit_sql)
        (d).mkdir(parents=True, exist_ok=True)
        (d / "000_backup_table.sql").write_text(BACKUP_DDL, encoding="utf-8")
        man = emit_sql_batches(todo, d, args.batch_size, args.pilot, stamp)
        log(f"emitted {len(man)} guarded batches for {len(todo)} rows ({dict(Counter(c['evidence_strength'] for c in todo))}) → {d}")

    if not args.write:
        return log("\nDRY RUN — nothing written to the database. See header for the --write command.")

    # 5. WRITE via REST (never runs without SUPABASE_SECRET_KEY + --confirm)
    key = os.environ["SUPABASE_SECRET_KEY"]
    current = {r["id"]: r for r in sb_read_ids("book_recommendations", "*", [c["rec_id"] for c in todo], key)}
    BACKUPS.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = BACKUPS / f"primary_sources_pre_write_{stamp}.json"
    backup.write_text(json.dumps({"rows": list(current.values()), "planned": todo}, indent=1, default=str), encoding="utf-8")
    log(f"backup: {backup.relative_to(ROOT)} ({len(current)} rows)")
    ok = skipped = failed = 0
    for c in todo:
        cur = current.get(c["rec_id"])
        if not cur or cur["person_id"] != c["_person_id"] or cur["book_id"] != c["_book_id"] or snapshot_md5(cur.get("source_url"), cur.get("quote")) != c["_snapshot"]:
            skipped += 1
            continue
        patch = {"source_url": c["primary_source_url"], "quote": c["_quote_to_write"], "source_name": c["_source_name"],
                 "confidence_score": c["_confidence"]}
        r = requests.patch(f"{SUPABASE_URL}/rest/v1/book_recommendations", params={"id": f"eq.{c['rec_id']}"}, json=patch,
                           headers={"apikey": key, "Authorization": f"Bearer {key}", "Prefer": "return=minimal"}, timeout=60)
        if r.ok:
            ok += 1
        else:
            failed += 1
            log(f"  FAILED {c['rec_id']}: {r.status_code} {r.text[:200]}")
    log(f"updated {ok}/{len(todo)} (skipped {skipped} changed since plan, failed {failed})")


if __name__ == "__main__":
    main()
