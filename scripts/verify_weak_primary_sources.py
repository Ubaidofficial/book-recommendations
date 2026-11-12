#!/usr/bin/env python3
"""
Verify the WEAK primary-source candidates from scripts/find_primary_sources.py
at the source itself (or an archived copy of it), and emit guarded SQL batches
for the confirmed ones.  DRY RUN: this script never writes to the database; it
writes CSVs, a review file and SQL batches for execute_sql.

WHY THESE WERE WEAK (see find_primary_sources.py docstring, CHANGELOG
"Primary sources for orphaned recommendations")
  tweet    X / publish.twitter.com / syndication disallow automated reading in
           robots.txt, so the tweet text was never read.
  youtube  only the oEmbed title had been read, not the description.
  others   third-party article, a list ABOUT the person, a news story, or a
           page where the book was not found.

RULES (precision over recall)
  tweet    Wayback Machine only: archive.org/wayback/available?url=<tweet>,
           then the snapshot (raw "id_" mode) on web.archive.org, after
           web.archive.org/robots.txt answered 200 and allows the path.
           x.com, twitter.com, publish.twitter.com and syndication hosts are
           NEVER fetched (hard-blocked below).
           confirmed if  the archived tweet's author handle == URL handle and
                         that handle is the person's (people.twitter_handle,
                         HANDLE_MAP in scripts/reattribute_quotes.js, or the
                         archived profile name == the person's name)
                    and  the tweet text names the book (normalized main title,
                         or author surname + most of the title's words)
                    and  tweet year >= first_published_year - 1.
  youtube  www.youtube.com/watch page (robots allows /watch): title, channel,
           description, publish date.
           confirmed if  channel name/handle is the person's, or the person is
                         the NAMED guest in the title ("Name: ...", "Name on",
                         "with Name", "| Name", "#123 - Name", "ft. Name")
                    and  the book title is in the video title or description
                         (sponsor reads stripped)
                    and  the book is not the guest's / a co-guest's own book
                         unless the person wrote it
                    and  publish year >= first_published_year - 1.
           A redirect to google.com/sorry (bot check, answers 429) stops
           YouTube for the run; the oEmbed title + channel cached by
           find_primary_sources.py is then used, and a book not named in
           that title is "unreachable" (description unread), not rejected.
  other   the page (cache, or a polite fetch) with scripts, comments,
           sponsor reads, nav/aside/footer and related-post blocks removed.
           Every title hit is shown with its paragraph, the page byline and the
           nearest speaker label; confirmation needs the person to be the
           author (byline / own domain) or the speaker of the paragraph naming
           the book.  Pages that need a reader's judgement go through
           reports/weak_review_decisions.json (rec_id -> confirm/reject +
           reason), filled by hand from reports/weak_review.txt.
  quote    written only if the pointer site's quote is verbatim (no [..] or
           ellipses) AND found word for word in the person's own text (the
           archived tweet text, the video description of the person's own
           channel, or the person's own paragraph).  Else NULL.

POLITENESS  generic User-Agent, >= 1.1 s per host, robots.txt honoured for
            every host and hop, everything cached under
            reports/third_party_cache/, a 429 stops that host for the run.
            find_primary_sources.BLOCKED_SITES and the outside index are
            never fetched.

USAGE
  python3 -I scripts/verify_weak_primary_sources.py fetch      # network + cache
  python3 -I scripts/verify_weak_primary_sources.py review     # weak_review.txt
  python3 -I scripts/verify_weak_primary_sources.py decide --emit-sql DIR [--pilot 10 --batch-size 60]
"""
from __future__ import annotations

import argparse
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
from find_primary_sources import (  # noqa: E402
    norm_text, norm_title, quote_in, quote_is_verbatim, squash, surname, title_in, tokens, name_in_tokens, host_of,
)

ROOT = Path(__file__).resolve().parent.parent
NEVER_FETCH = ("x.com", "twitter.com", "mobile.twitter.com", "publish.twitter.com", "syndication.twitter.com",
               "cdn.syndication.twimg.com", "syndication.x.com")
STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def log(*a):
    print(*a, flush=True)


# ─── Fetcher: the house fetcher + hard blocks for X and a strict robots rule ──

class Fetcher(fps.Fetcher):
    def _one(self, url, max_bytes):
        h = host_of(url)
        if any(h == b or h.endswith("." + b) for b in NEVER_FETCH):
            raise RuntimeError(f"refusing to fetch {url}: robots.txt / terms disallow automated access")
        if h == host_of(fps.MRB):
            raise RuntimeError("the outside index is not fetched by this script")
        res = super()._one(url, max_bytes)
        loc = res.get("location") or ""
        if res.get("status") in (301, 302, 303, 307, 308) and re.search(r"//(?:www\.)?google\.[a-z.]+/sorry/", loc):
            # YouTube's bot check: a redirect to google.com/sorry (which answers 429) is a rate limit for THIS host
            self.blocked_hosts[h] = "429(google_sorry_redirect)"
            return {"status": 429, "error": "bot_check_redirect", "text": "", "_nocache": True}
        return res

    def robots_ok(self, base: str) -> bool:
        """Strict: the host's robots.txt must have been READ (HTTP 2xx or 404), not merely unreachable."""
        res = self._raw(base + "/robots.txt", "robots")
        return bool(res.get("status")) and (200 <= res["status"] < 300 or res["status"] == 404)


# ─── Inputs ──────────────────────────────────────────────────────────────────

def load_inputs(args):
    cands = [r for r in fps.csv_rows(Path(args.candidates)) if r["evidence_strength"] == "weak"]
    people = {p["id"]: p for p in fps.sb_read_ids("people", "id,slug,name,twitter_handle", {r["_person_id"] for r in cands})}
    books = {b["id"]: b for b in fps.sb_read_ids("books", "id,slug,title,author_name,first_published_year", {r["_book_id"] for r in cands})}
    return cands, people, books


def ownership():
    handle_map, handle_deny, domain_map, alias_groups, interview_hosts = fps.load_house_maps()
    allp = fps.sb_read_all("people", "id,slug,name,twitter_handle,index_status")
    return fps.Ownership({p["slug"]: p for p in allp}, handle_map, handle_deny, domain_map, alias_groups, interview_hosts)


# ─── Tweets via the Wayback Machine ─────────────────────────────────────────

TWEET_RE = re.compile(r"^https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status(?:es)?/(\d+)")


def tweet_parts(url):
    m = TWEET_RE.match(url)
    return (m.group(1).lower(), m.group(2)) if m else (None, None)


def tweet_year(tid: str):
    return fps.source_year(f"https://twitter.com/x/status/{tid}")


def wayback_lookup(F, url):
    """archive.org availability API, for the x.com and twitter.com spellings; returns (snapshot_url|None, tried)."""
    handle, tid = tweet_parts(url)
    variants = [f"twitter.com/{handle}/status/{tid}", f"x.com/{handle}/status/{tid}"]
    for v in variants:
        res = F.get("https://archive.org/wayback/available?url=" + urllib.parse.quote(v, safe=""), "wayback")
        if res.get("status") == 429 or "host_blocked" in str(res.get("error")) or res.get("error") == "offline_not_cached":
            return None, "not_looked_up(archive.org_answered_429,run_stopped)"
        if res.get("status") != 200:
            continue
        try:
            snap = json.loads(res["text"]).get("archived_snapshots", {}).get("closest") or {}
        except ValueError:
            continue
        if snap.get("available") and str(snap.get("status", "200")).startswith(("2", "3")):
            return snap["url"], v
    return None, variants


def raw_snapshot_url(snap_url: str) -> str:
    m = re.match(r"^https?://web\.archive\.org/web/(\d+)(?:[a-z_]+)?/(.+)$", snap_url)
    return f"https://web.archive.org/web/{m.group(1)}id_/{m.group(2)}" if m else snap_url


def parse_archived_tweet(page: str, tid: str) -> dict:
    """Old (server-rendered) and newer (bot-rendered) twitter.com / x.com snapshots."""
    import html as _h
    out = {"text": "", "author_handle": None, "author_name": None, "how": None}
    # 1. permalink tweet container (2014-2020 layout)
    m = re.search(r'<div[^>]+class="[^"]*permalink-tweet[^"]*"[^>]*data-tweet-id="%s"[^>]*>' % tid, page) or \
        re.search(r'<div[^>]+data-tweet-id="%s"[^>]*class="[^"]*permalink-tweet[^"]*"[^>]*>' % tid, page)
    if m:
        seg = page[m.start(): m.start() + 60000]
        sn = re.search(r'data-screen-name="([A-Za-z0-9_]+)"', m.group(0)) or re.search(r'data-screen-name="([A-Za-z0-9_]+)"', seg)
        nm = re.search(r'data-name="([^"]*)"', m.group(0)) or re.search(r'data-name="([^"]*)"', seg)
        tx = re.search(r'<p class="[^"]*js-tweet-text[^"]*"[^>]*>(.*?)</p>', seg, re.S)
        if tx:
            body = tx.group(1)
            # expanded links: keep the expanded URL text (a link to the book page is a reference)
            body = re.sub(r'<a[^>]*data-expanded-url="([^"]*)"[^>]*>.*?</a>', r" \1 ", body, flags=re.S)
            out.update(text=" ".join(fps.strip_tags(body).split()), author_handle=sn.group(1).lower() if sn else None,
                       author_name=_h.unescape(nm.group(1)) if nm else None, how="permalink")
            return out
    # 2. <title>Name on Twitter: "text"</title> / og tags (also bot-rendered x.com pages)
    t = re.search(r"<title>(.*?)</title>", page, re.S)
    ogd = re.search(r'<meta[^>]+property="og:description"[^>]+content="([^"]*)"', page) or \
        re.search(r'<meta[^>]+content="([^"]*)"[^>]+property="og:description"', page)
    ogt = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]*)"', page) or \
        re.search(r'<meta[^>]+content="([^"]*)"[^>]+property="og:title"', page)
    canon = re.search(r'<link[^>]+rel="canonical"[^>]+href="https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/([A-Za-z0-9_]+)/status/(\d+)', page)
    title = _h.unescape(" ".join(t.group(1).split())) if t else ""
    tm = re.match(r"^(.*?) on (?:Twitter|X): [\"“](.*)[\"”]\s*(?:/ X|/ Twitter)?$", title, re.S)
    if tm:
        out.update(text=tm.group(2), author_name=tm.group(1), how="title")
    elif ogd and ogt and re.search(r"on (Twitter|X)$", _h.unescape(ogt.group(1))):
        out.update(text=_h.unescape(ogd.group(1)).strip("“”\""), author_name=re.sub(r"\s+on (Twitter|X)$", "", _h.unescape(ogt.group(1))), how="og")
    if canon and canon.group(2) == tid:
        out["author_handle"] = canon.group(1).lower()
    return out


def fetch_tweet(F, url, wb_ok):
    handle, tid = tweet_parts(url)
    if not tid:
        return {"state": "unreachable", "why": "not_a_status_url"}
    snap, tried = wayback_lookup(F, url)
    if not snap:
        return {"state": "unreachable", "why": tried if isinstance(tried, str) else "no_wayback_snapshot"}
    if not wb_ok:
        return {"state": "unreachable", "why": "web.archive.org_unreachable(robots.txt_not_readable)", "snapshot": snap}
    raw = raw_snapshot_url(snap)
    if not F.allowed(raw):
        return {"state": "unreachable", "why": "web.archive.org_robots_disallows", "snapshot": snap}
    res = F.get(raw, "wayback")
    final = res.get("final_url") or raw
    if res.get("status") != 200 or not res.get("text"):
        return {"state": "unreachable", "why": f"snapshot_{res.get('status') or res.get('error')}", "snapshot": snap}
    p = parse_archived_tweet(res["text"], tid)
    m = re.search(r"/web/\d+[a-z_]*/(.+)$", final)
    final_handle = tweet_parts(m.group(1))[0] if m and TWEET_RE.match(m.group(1)) else None
    return {"state": "fetched", "snapshot": snap, "final": final, "final_handle": final_handle, **p}


# ─── YouTube watch pages ────────────────────────────────────────────────────

def yt_id(url):
    p = urllib.parse.urlsplit(url)
    if host_of(url) == "youtu.be":
        return p.path.strip("/").split("/")[0]
    q = dict(urllib.parse.parse_qsl(p.query))
    return q.get("v")


def _json_str(page, key):
    m = re.search(r'"%s":("(?:[^"\\]|\\.)*")' % key, page)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except ValueError:
        return None


def fetch_youtube(F, url):
    vid = yt_id(url)
    if not vid:
        return {"state": "unreachable", "why": "no_video_id"}
    res = F.get(f"https://www.youtube.com/watch?v={vid}", "primary") if "youtube.com" not in F.blocked_hosts else \
        {"status": None, "error": "host_blocked_this_run"}
    if res.get("status") != 200 or not res.get("text"):
        # fall back to the oEmbed answer find_primary_sources.py cached earlier (title + channel, no description);
        # no new request is made for it
        oe = F._cache_path("https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(url, safe=""), "primary")
        j = json.loads(oe.read_text(encoding="utf-8")) if oe.exists() else {}
        if j.get("status") == 200:
            try:
                o = json.loads(j["text"])
                return {"state": "fetched", "how": "cached_oembed(title+channel only)", "title": o.get("title", ""),
                        "channel": o.get("author_name", ""), "owner_url": o.get("author_url", ""), "description": "",
                        "year": None, "watch_page": f"{res.get('status') or res.get('error')}"}
            except ValueError:
                pass
        return {"state": "unreachable", "why": f"watch_{res.get('status') or res.get('error')}"}
    page = res["text"]
    vd = page.find('"videoDetails"')
    seg = page[vd: vd + 200000] if vd >= 0 else ""
    title = _json_str(seg, "title")
    if not title:
        st = re.search(r'"playabilityStatus":\{"status":"([A-Z_]+)"', page)
        return {"state": "unreachable", "why": f"video_{st.group(1).lower() if st else 'no_details'}"}
    pd = re.search(r'"publishDate":"(\d{4})', page) or re.search(r'"uploadDate":"(\d{4})', page)
    return {"state": "fetched", "how": "watch_page", "title": title, "channel": _json_str(seg, "author") or _json_str(page, "ownerChannelName"),
            "owner_url": _json_str(page, "ownerProfileUrl"), "description": _json_str(seg, "shortDescription") or "",
            "year": int(pd.group(1)) if pd else None}


# ─── Other pages ────────────────────────────────────────────────────────────

SPONSOR_PARA = re.compile(r"brought to you by|sponsored by|this episode is (?:also )?(?:sponsored|supported)|promo code|use (?:the )?code\b|"
                          r"affiliate link|we may earn|commission|try it free|free trial|go to [a-z0-9.-]+\.com/", re.I)
DROP_SEL = ("nav, aside, footer, header, form, #comments, .comments, .comments-area, .comment-list, .commentlist, "
            "#disqus_thread, #wpdcom, .wp-block-comments-wpdiscuz, [class*=related], [id*=related], [class*=sidebar], "
            "[id*=sidebar], [class*=newsletter], [class*=share], [class*=recommend-], [class*=promo], [class*=advert], "
            "[class*=sponsor], [class*=footer], [class*=menu]")


def clean_page(html_text):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html_text, "html.parser")
    meta_auth = []
    for sel in ('meta[name=author]', 'meta[property="article:author"]', 'meta[name="parsely-author"]', 'meta[name="sailthru.author"]',
                'meta[name="twitter:creator"]'):
        for m in soup.select(sel):
            if m.get("content"):
                meta_auth.append(m["content"])
    for s in soup.select('script[type="application/ld+json"]'):
        for m in re.finditer(r'"author"\s*:\s*(\[[^\]]*\]|\{[^}]*\})', s.get_text() or ""):
            meta_auth += re.findall(r'"name"\s*:\s*"([^"]+)"', m.group(1))
    bylines = [" ".join(e.get_text(" ").split())[:120] for e in soup.select('[rel=author], [class*=byline], [class*=author-name], [class*="author"] a, .author')][:8]
    ptitle = soup.title.get_text(" ", strip=True) if soup.title else ""
    for t in soup(["script", "style", "noscript", "svg", "iframe"]):
        t.decompose()
    for t in soup.select(DROP_SEL):
        if t.name not in ("body", "html", "main", "article"):
            t.decompose()
    lines = [" ".join(x.split()) for x in soup.get_text("\n").split("\n")]
    lines = [x for x in lines if x and not SPONSOR_PARA.search(x)]
    lines = [fps.SPONSOR_AD.sub(" ", x) for x in lines]
    return {"title": ptitle, "meta_authors": meta_auth, "bylines": bylines, "lines": lines}


SPEAKER = re.compile(r"^(?:\*\*)?([A-Z][A-Za-z.'’\- ]{1,40}?|[A-Z]{1,3})\s*(?:\([^)]{0,20}\))?\s*[:：]\s")
QA_Q = re.compile(r"^(?:Q[:.]|Question[:.])\s", re.I)


def title_hits(nt, lines, author):
    """Paragraphs (lines) whose normalized text names the book; with the nearest speaker label above them."""
    hits = []
    sn = surname(author)
    for i, ln in enumerate(lines):
        n = norm_text(ln)
        if title_in(nt, n):
            spk, qa = None, None
            for j in range(i, max(-1, i - 40), -1):
                m = SPEAKER.match(lines[j])
                if m:
                    spk = m.group(1).strip()
                    break
                if QA_Q.match(lines[j]):
                    qa = "Q"
                    break
            hits.append({"i": i, "para": ln[:700], "speaker": spk, "qa": qa,
                         "author_named": bool(sn and sn in n.split())})
    return hits


def fetch_other(F, url):
    res = F.get(url, "primary")
    if res.get("status") != 200 or not res.get("text"):
        return {"state": "unreachable", "why": str(res.get("status") or res.get("error") or "non_text")}
    pg = clean_page(res["text"])
    return {"state": "fetched", **pg}


# ─── Commands ───────────────────────────────────────────────────────────────

def cmd_fetch(args):
    cands, people, books = load_inputs(args)
    F = Fetcher(offline=args.offline)
    for h in filter(None, (args.skip_hosts or "").split(",")):
        F.blocked_hosts[h] = "skipped(rate_limited_earlier_this_session)"
    out = {}
    wb_ok = F.robots_ok("https://web.archive.org")  # offline: answered from the cache
    log(f"web.archive.org robots.txt readable: {wb_ok}")
    by_url = defaultdict(list)
    for c in cands:
        by_url[(c["primary_source_type"], c["primary_source_url"])].append(c)
    order = sorted(by_url, key=lambda k: {"tweet": 0, "youtube": 1}.get(k[0], 2))
    if args.types:
        order = [k for k in order if (k[0] if k[0] in ("tweet", "youtube") else "other") in args.types.split(",")]
    for n, (st, url) in enumerate(order, 1):
        try:
            if st == "tweet":
                v = fetch_tweet(F, url, wb_ok)
            elif st == "youtube":
                v = fetch_youtube(F, url)
            else:
                v = fetch_other(F, url)
        except fps.StopRun as e:
            log(f"STOP: {e}")
            break
        except RuntimeError as e:
            v = {"state": "unreachable", "why": f"refused:{e}"}
        out[url] = v
        if n % 25 == 0:
            log(f"  {n}/{len(order)} urls")
    if Path(args.evidence).exists():  # merge with an earlier / parallel run for other types
        out = {**json.loads(Path(args.evidence).read_text(encoding="utf-8")), **out}
    Path(args.evidence).write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    stats = {"network_requests": dict(F.network_requests), "status_by_host": {h: dict(c) for h, c in F.status_by_host.items()},
             "blocked_hosts": F.blocked_hosts}
    Path(args.evidence).with_suffix(f".requests.{args.types or 'all'}.json").write_text(json.dumps(stats, indent=1), encoding="utf-8")
    log(json.dumps(stats["network_requests"], indent=0)[:3000])
    log(f"states: {Counter(v['state'] for v in out.values())}")


# ─── Rules ──────────────────────────────────────────────────────────────────

GUEST_PATTERNS = [
    r"^\s*(?:#?\d+\s*[-–—:|.]\s*)?{n}\s*(?:[:|–—\-]|on\b|in conversation\b|interview\b|talks\b|explains\b|discusses\b|shares\b|reveals\b|reads\b|answers\b)",
    r"\b(?:with|ft\.?|feat\.?|featuring|guest|interview(?:ing|s)?|meets|w/)\s+(?:dr\.?\s+|professor\s+)?{n}\b",
    r"[|:–—\-]\s*(?:dr\.?\s+)?{n}\s*(?:$|[|(\[]|#|\bon\b|\bep)",
    r"\b{n}'s?\s+(?:interview|book recommendations|favou?rite books|reading list|story|advice)",
    r"\b(?:i'm|i am|my name is)\s+{n}\b",
]


def person_is_named_guest(name, title):
    toks = [t for t in tokens(name) if t not in fps.NAME_SUFFIX]
    if len(toks) < 2:
        return False
    n = r"(?:" + r"\s+(?:[a-z]\.?\s+)?".join(map(re.escape, toks)) + r")"
    t = " ".join(re.sub(r"[“”\"]", "", title.lower()).replace("’", "'").split())
    t = unicodedata_fold(t)
    return any(re.search(p.replace("{n}", n), t) for p in GUEST_PATTERNS)


def unicodedata_fold(s):
    import unicodedata
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()


def book_named(nt, author, text):
    """Normalized main title in the text; or author surname + >= 75% of the title's words (>= 2 words)."""
    tn = norm_text(text)
    if title_in(nt, tn):
        return True
    sn = surname(author)
    words = [w for w in nt.split() if w not in ("of", "the", "a", "an", "and", "to", "in", "on", "for")]
    tw = set(tn.split())
    return bool(sn and sn in tw and len(words) >= 2 and sum(w in tw for w in words) / len(words) >= 0.75)


def decide_tweet(c, v, person, book, own):
    url = c["primary_source_url"]
    hd, tid = tweet_parts(url)
    if v["state"] != "fetched":
        return "unreachable", v.get("why"), None
    if not v.get("text"):
        return "unreachable", "snapshot_has_no_tweet_text(js_shell_or_login_wall)", None
    ah = v.get("author_handle") or v.get("final_handle")
    if ah and ah != hd:
        return "rejected", f"archived_author_differs:{hd}->{ah}", None
    if not ah:
        return "unreachable", "archived_author_handle_not_found", None
    if not (own.known_handle(person["slug"], person, ah) or squash(v.get("author_name")) == squash(person["name"])):
        return "rejected", f"handle_not_persons:{ah}", None
    ty, fpy = tweet_year(tid), book.get("first_published_year")
    if ty and fpy and ty < int(fpy) - 1:
        return "rejected", f"tweet_predates_book:{ty}<{fpy}", None
    if not book_named(norm_title(book["title"]), book.get("author_name"), v["text"]):
        return "rejected", "book_not_named_in_tweet_text", None
    q = c["quote_text"]
    quote = q if (q and quote_is_verbatim(q) and quote_in(q, norm_text(v["text"]))) else None
    return "confirmed", f"archived_tweet({v.get('how')}):{v['snapshot']}", quote


def decide_youtube(c, v, person, book, own):
    if v["state"] != "fetched":
        return "unreachable", v.get("why"), None
    name = person["name"]
    if v.get("how", "").startswith("cached_oembed") and not book_named(norm_title(book["title"]), book.get("author_name"), v["title"]):
        # watch page (description) not readable this run: the title alone cannot settle it either way
        return "unreachable", f"description_unreadable(watch_page:{v.get('watch_page')}),book_not_in_title", None
    ch = v.get("channel") or ""
    ch_handle = (v.get("owner_url") or "").rstrip("/").rsplit("/", 1)[-1].lstrip("@").lower()
    channel_is_person = squash(ch) == squash(name) or (ch_handle and (own.known_handle(person["slug"], person, ch_handle) or ch_handle == squash(name)))
    guest = person_is_named_guest(name, v["title"])
    if not (channel_is_person or guest):
        why = "person_named_in_title_but_not_as_speaker" if name_in_tokens(name, tokens(v["title"])) else "channel_and_title_not_persons"
        return "rejected", why, None
    fy, fpy = v.get("year"), book.get("first_published_year")
    if fy and fpy and fy < int(fpy) - 1:
        return "rejected", f"video_predates_book:{fy}<{fpy}", None
    nt = norm_title(book["title"])
    desc = fps.SPONSOR_AD.sub(" ", v.get("description") or "")
    desc = "\n".join(ln for ln in desc.split("\n") if not SPONSOR_PARA.search(ln))
    in_title = book_named(nt, book.get("author_name"), v["title"])
    in_desc = book_named(nt, book.get("author_name"), desc)
    if not (in_title or in_desc):
        return "rejected", "book_not_named_in_video_title_or_description", None
    an = book.get("author_name") or ""
    if name_in_tokens(an, tokens(v["title"])) and not name_in_tokens(an, tokens(name)) and squash(an) != squash(name):
        return "rejected", "book_author_is_named_in_title(guest_or_co_guest_own_book)", None
    q = c["quote_text"]
    quote = q if (channel_is_person and q and quote_is_verbatim(q) and quote_in(q, norm_text(desc))) else None
    return "confirmed", ("own_channel" if channel_is_person else "named_guest") + (":title" if in_title else ":description"), quote


def other_evidence(c, v, person, book, own):
    """Machine-readable facts for an 'other' page; decide_other() and the review file use them."""
    nt = norm_title(book["title"])
    hits = title_hits(nt, v["lines"], book.get("author_name"))
    text_norm = norm_text(" ".join(v["lines"]))
    name = person["name"]
    by = [a for a in v["meta_authors"] + v["bylines"] if name_in_tokens(name, tokens(a)) or squash(a) == squash(name)]
    own_domain = own.personal_domain(person["slug"], c["primary_source_url"]) or "owner_basis=personal_domain" in c["notes"]
    first, last = tokens(name)[0], tokens(name)[-1]
    initials = "".join(t[0] for t in tokens(name)).upper()

    def is_person_label(s):
        if not s:
            return False
        tk = tokens(s)
        return s.strip().upper() == initials or (len(tk) <= 4 and (first in tk or last in tk))

    for h in hits:
        h["speaker_is_person"] = is_person_label(h["speaker"])
    q = c["quote_text"]
    q_ok = bool(q) and quote_in(q, text_norm)
    return {"hits": hits, "byline_person": by, "own_domain": bool(own_domain), "name_on_page": name_in_tokens(name, text_norm.split()),
            "quote_on_page": q_ok, "quote_verbatim": bool(q) and quote_is_verbatim(q)}


def decide_other(c, v, person, book, own, manual):
    rid = c["rec_id"]
    if v["state"] != "fetched":
        return "unreachable", v.get("why"), None, None
    ev = other_evidence(c, v, person, book, own)
    if rid in manual:
        d = manual[rid]
        quote = c["quote_text"] if (d["decision"] == "confirmed" and d.get("quote_ok") and ev["quote_on_page"] and ev["quote_verbatim"]) else None
        return d["decision"], "hand:" + d["reason"], quote, ev
    if not ev["hits"]:
        return "rejected", "book_not_on_page" + ("" if ev["name_on_page"] else "(person_not_named_either)"), None, ev
    if not (ev["own_domain"] or ev["byline_person"] or ev["name_on_page"]):
        return "rejected", "person_not_on_page", None, ev
    return "review", "needs_hand_check", None, ev


# ─── review / decide ────────────────────────────────────────────────────────

def cmd_review(args):
    cands, people, books = load_inputs(args)
    own = ownership()
    ev = json.loads(Path(args.evidence).read_text(encoding="utf-8"))
    manual = json.loads(Path(args.decisions).read_text()) if Path(args.decisions).exists() else {}
    lines = []
    cnt = Counter()
    for c in cands:
        if c["primary_source_type"] in ("tweet", "youtube"):
            continue
        p, b = people[c["_person_id"]], books[c["_book_id"]]
        v = ev.get(c["primary_source_url"], {"state": "unreachable", "why": "not_fetched"})
        d, why, _q, e = decide_other(c, v, p, b, own, {} if args.all else manual)
        cnt[d] += 1
        if d != "review" and not args.all:
            continue
        lines.append(f"=== {c['rec_id']} | {p['name']} | {b['title']} / {b.get('author_name')} | {c['primary_source_url']}")
        lines.append(f"    notes={c['notes']}")
        lines.append(f"    page_title={v.get('title','')[:150]!r} byline_person={e['byline_person'][:2]} own_domain={e['own_domain']} quote_on_page={e['quote_on_page']}")
        if c["quote_text"]:
            lines.append(f"    site_quote={c['quote_text'][:220]!r}")
        for h in e["hits"][:4]:
            lines.append(f"    [{h['i']}] speaker={h['speaker']!r} person={h['speaker_is_person']} qa={h['qa']} :: {h['para'][:args.width]}")
    Path(args.review).write_text("\n".join(lines), encoding="utf-8")
    log(f"review rows: {cnt}; written {args.review}")


def cmd_decide(args):
    cands, people, books = load_inputs(args)
    own = ownership()
    ev = json.loads(Path(args.evidence).read_text(encoding="utf-8"))
    manual = json.loads(Path(args.decisions).read_text()) if Path(args.decisions).exists() else {}
    rows, todo = [], []
    for c in cands:
        p, b = people[c["_person_id"]], books[c["_book_id"]]
        v = ev.get(c["primary_source_url"], {"state": "unreachable", "why": "not_fetched"})
        st = c["primary_source_type"]
        if st == "tweet":
            d, why, q = decide_tweet(c, v, p, b, own)
        elif st == "youtube":
            d, why, q = decide_youtube(c, v, p, b, own)
        else:
            d, why, q, _e = decide_other(c, v, p, b, own, manual)
        if c["rec_id"] in manual and st in ("tweet", "youtube"):
            md = manual[c["rec_id"]]
            if md["decision"] != "confirmed" or d == "confirmed":
                d, why = md["decision"], "hand:" + md["reason"]
                q = q if d == "confirmed" else None
        if d == "review":
            d, why = "rejected", "not_hand_confirmed"
        rows.append({"rec_id": c["rec_id"], "person_slug": c["person_slug"], "book_title": b["title"], "book_author": b.get("author_name") or "",
                     "primary_source_type": st, "primary_source_url": c["primary_source_url"], "decision": d, "reason": why,
                     "quote_written": q or ""})
        if d == "confirmed":
            todo.append({**c, "_source_name": fps.SOURCE_NAMES.get(st, host_of(c["primary_source_url"])), "_quote_to_write": q,
                         "_confidence": fps.MEDIUM_CONFIDENCE, "evidence_strength": "weak_verified"})
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "weak_candidates_decisions.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    with open(out / "weak_candidates_unconfirmed.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0])[:-1])
        w.writeheader()
        w.writerows({k: r[k] for k in list(rows[0])[:-1]} for r in rows if r["decision"] != "confirmed")
    summ = defaultdict(Counter)
    for r in rows:
        summ[r["primary_source_type"]][r["decision"]] += 1
    reasons = Counter(re.sub(r":.*$", "", r["reason"] or "") for r in rows if r["decision"] != "confirmed")
    log(json.dumps({k: dict(v) for k, v in summ.items()}, indent=1))
    log(json.dumps(reasons.most_common(), indent=0))
    log(f"confirmed {len(todo)}, with quote {sum(1 for t in todo if t['_quote_to_write'])}")
    if args.emit_sql:
        man = fps.emit_sql_batches(todo, Path(args.emit_sql), args.batch_size, args.pilot, STAMP)
        log(f"emitted {len(man)} batches into {args.emit_sql}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("cmd", choices=("fetch", "review", "decide"))
    ap.add_argument("--candidates", default=str(ROOT / "reports" / "primary_source_candidates.csv"))
    ap.add_argument("--cache", default=str(ROOT / "reports" / "third_party_cache"))
    ap.add_argument("--evidence", default=str(ROOT / "reports" / "weak_evidence.json"))
    ap.add_argument("--decisions", default=str(ROOT / "reports" / "weak_review_decisions.json"))
    ap.add_argument("--review", default=str(ROOT / "reports" / "weak_review.txt"))
    ap.add_argument("--out-dir", default=str(ROOT / "reports"))
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--types", help="fetch: comma list of tweet,youtube,other (default all)")
    ap.add_argument("--skip-hosts", help="fetch: hosts not to request at all this run (e.g. a host that answered 429 earlier)")
    ap.add_argument("--all", action="store_true", help="review: list every fetched 'other' row, not only undecided ones")
    ap.add_argument("--width", type=int, default=420)
    ap.add_argument("--emit-sql", metavar="DIR")
    ap.add_argument("--batch-size", type=int, default=60)
    ap.add_argument("--pilot", type=int, default=10)
    args = ap.parse_args()
    fps.CACHE = Path(args.cache)
    {"fetch": cmd_fetch, "review": cmd_review, "decide": cmd_decide}[args.cmd](args)


if __name__ == "__main__":
    main()
