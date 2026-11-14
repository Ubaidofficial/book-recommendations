#!/usr/bin/env python3
"""
Collect redditreads.com's per-subreddit "books most mentioned" lists.
Read-only. Writes only to reports/ (gitignored).

SOURCE. redditreads.com counts, per subreddit, how many users linked a book
(Amazon / Goodreads / Google Books / O'Reilly links in comments; a user counts
once per book per subreddit, via their top-voted comment). Its data ends
2023-03-31. It is NOT a vote count: the figure is "N users". We store and show
it as that, with the date, and credit the source.
Its robots.txt is "User-agent: * / Disallow: /r/random" and its pages carry no
terms of use or scraping clause (checked 2026-11-14 on / and /about).

POLITENESS. Generic User-Agent, one connection, >= 1.5 s between requests,
every response cached under reports/third_party_cache/redditreads/ so a re-run
is free, robots.txt honoured for every path, stop on the first 429/403.
Pages fetched: /subreddits, then /r/<sub> (all-time view) for each subreddit
listed there. Each page shows only its top 100 books.

OUTPUT  reports/reddit_reads_books.jsonl  one line per (subreddit, book):
        {sub, rank, title, users, isbn13, asin, goodreads_id, href}

  python3 -I scripts/reddit_reads_collect.py [--max-pages N] [--offline]
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.robotparser
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://www.redditreads.com"
CACHE = ROOT / "reports" / "third_party_cache" / "redditreads"
OUT = ROOT / "reports" / "reddit_reads_books.jsonl"
UA = "BookSourceVerifier/0.1 (+book-recommendation index; polite, cached)"
MIN_INTERVAL = 1.5

CARD = re.compile(
    r'<a class="book" ([^>]*)>.*?<div class="book-title">(.*?)</div>\s*<div class="book-score">\s*([\d,]+)\s*users?\s*</div>',
    re.S,
)


class Stop(RuntimeError):
    pass


class Fetcher:
    def __init__(self, offline: bool):
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": UA, "Accept": "text/html,application/xml;q=0.9", "Accept-Language": "en"})
        self.offline, self.last, self.requests = offline, 0.0, 0
        self.rp = urllib.robotparser.RobotFileParser()
        txt = self._get(f"{BASE}/robots.txt", check=False).get("text", "")
        self.rp.parse(txt.splitlines())

    @staticmethod
    def _cp(url):
        return CACHE / f"{hashlib.sha1(url.encode()).hexdigest()}.json"

    def _get(self, url, check=True):
        if urllib.parse.urlsplit(url).netloc != "www.redditreads.com":
            raise ValueError(url)
        if check and not self.rp.can_fetch(UA, url):
            return {"status": None, "error": "robots_disallow", "text": ""}
        cp = self._cp(url)
        if cp.exists():
            return json.loads(cp.read_text(encoding="utf-8"))
        if self.offline:
            return {"status": None, "error": "offline_not_cached", "text": ""}
        wait = MIN_INTERVAL - (time.time() - self.last)
        if wait > 0:
            time.sleep(wait)
        self.requests += 1
        try:
            r = self.s.get(url, timeout=30, allow_redirects=False)
            res = {"status": r.status_code, "url": url, "text": r.text, "fetched_at": datetime.now(timezone.utc).isoformat()}
        except requests.RequestException as e:
            res = {"status": None, "url": url, "error": type(e).__name__, "text": ""}
        finally:
            self.last = time.time()
        if res["status"] in (429, 403):
            raise Stop(f"{res['status']} for {url}")
        if res["status"] is not None and res["status"] < 500:
            cp.parent.mkdir(parents=True, exist_ok=True)
            cp.write_text(json.dumps(res), encoding="utf-8")
        return res

    def get(self, url):
        return self._get(url)


def parse_cards(page: str, sub: str) -> list[dict]:
    out = []
    for rank, m in enumerate(CARD.finditer(page), 1):
        attrs = m.group(1)
        hm = re.search(r'href="([^"]+)"', attrs)
        im = re.search(r'data-isbn="([0-9Xx]*)"', attrs)
        href = html.unescape(hm.group(1)) if hm else ""
        asin = re.search(r"/dp/([0-9A-Z]{10})", href)
        gr = re.search(r"goodreads\.com/book/show/(\d+)", href)
        out.append({
            "sub": sub, "rank": rank, "title": html.unescape(m.group(2)).strip(), "users": int(m.group(3).replace(",", "")),
            "isbn13": (im.group(1).upper() if im and im.group(1) else None), "asin": asin.group(1) if asin else None,
            "goodreads_id": gr.group(1) if gr else None, "href": href.split("?")[0],
        })
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--max-pages", type=int, default=100000)
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args()
    F = Fetcher(args.offline)
    idx = F.get(f"{BASE}/subreddits")
    subs = sorted({s for s in re.findall(r'href="/r/([^"?/]+)"', idx.get("text", "")) if s.lower() != "random"}, key=str.lower)
    if "all" not in subs:
        subs.insert(0, "all")
    print(f"subreddits listed: {len(subs)}", flush=True)
    rows, pages, failed = [], 0, []
    try:
        for i, sub in enumerate(subs):
            url = f"{BASE}/r/{urllib.parse.quote(sub)}"
            if pages >= args.max_pages and not F._cp(url).exists():
                continue
            res = F.get(url)
            if res.get("status") != 200:
                failed.append((sub, res.get("status") or res.get("error")))
                continue
            pages += 1
            cards = parse_cards(res["text"], sub)
            if not cards:
                failed.append((sub, "no_cards"))
            rows += cards
            if i and i % 100 == 0:
                print(f"  {i}/{len(subs)} subs, {len(rows)} rows, {F.requests} requests", flush=True)
    except Stop as e:
        print("STOPPED:", e, flush=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(json.dumps({"subreddits": len(subs), "pages": pages, "rows": len(rows), "failed": failed[:15], "failed_n": len(failed),
                      "network_requests": F.requests}, indent=1), flush=True)


if __name__ == "__main__":
    main()
