#!/usr/bin/env python3
"""Download Reddit book-recommendation threads and their top-level replies
from the Arctic Shift archive (https://github.com/ArthurHeitmann/arctic_shift).

Why Arctic Shift and not Reddit's API / PRAW: Reddit stopped taking new Data
API applications on 2026-10-31, its listings stop at 1,000 items, and it
rejects unauthenticated requests from cloud IPs. Arctic Shift is a public
archive with date filters, so a 2015-onwards history is reachable.

What is kept: for every thread, id/title/score/num_comments/created_utc; for
every TOP-LEVEL reply (the answer to "suggest me a book"), id/link_id/score/
created_utc and the body. Usernames are dropped after filtering bots — they
are not needed and we do not want to store them.

Two subreddit modes:
  all       every thread is a recommendation request (r/suggestmeabook).
            Top-level comments are pulled subreddit-wide per month, which is
            ~1 request per 100-1000 comments.
  filtered  general discussion subs (r/books, r/Fantasy ...). Only threads whose
            title reads like a recommendation request are kept, and their
            top-level comments are fetched thread by thread.

Output: <out>/<subreddit>/<YYYY-MM>.posts.jsonl.gz and .comments.jsonl.gz.
A month whose .done marker exists is skipped, so the job is resumable.
Months run newest first, so an interrupted run still has the recent years.

Be considerate: this is a free service. Default pacing is ~1 request/second
with backoff on "slow down" / 429 responses.

Usage:
  python3 scripts/community/arctic_shift_ingest.py --out DIR \
      [--subreddits suggestmeabook,books] [--since 2015-01] [--until 2026-11]
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://arctic-shift.photon-reddit.com/api"
UA = "bookrecs-community-ingest/1.0 (research; low rate)"

SUBREDDITS: dict[str, str] = {
    # every thread is a request for recommendations
    "suggestmeabook": "all",
    "booksuggestions": "all",
    # general / genre discussion: keep only request-shaped threads
    "books": "filtered",
    "Fantasy": "filtered",
    "printSF": "filtered",
    "horrorlit": "filtered",
    "nonfictionbooks": "filtered",
    "literature": "filtered",
    "sciencefiction": "filtered",
    "booksthatfeelgood": "filtered",
}

REQUEST_TITLE = re.compile(
    r"\b(recommend\w*|suggest\w*|rec\b|recs\b|looking for|what (book|should i read|to read)|"
    r"best (book|novel|fantasy|sci-?fi|horror|nonfiction|non-fiction)\w*|"
    r"books? (like|similar|about|that|for|to read)|favou?rite (book|novel)s?|"
    r"must[- ]reads?|reading list|what are you reading|"
    r"(book|novel)s? (that|which) (changed|made|stuck|blew)|"
    r"read next|next read|help me (find|choose|pick))",
    re.I,
)

BOT_AUTHORS = {"automoderator", "goodreads-bot", "booksuggestions-bot", "remindmebot",
               "sneakpeekbot", "wikitextbot", "[deleted]"}
DEAD_BODIES = {"[deleted]", "[removed]", ""}
MIN_THREAD_COMMENTS = 3
BODY_MAX = 2000


class ApiError(Exception):
    pass


def get(path: str, params: dict, pause: float, tries: int = 14) -> list:
    """GET with retries.

    The server answers both overload and its own throttling with HTTP 422
    {"error": "Timeout. Maybe slow down a bit"}, often within half a second and
    often succeeding on an immediate retry. So: short jittered retries for 422,
    alternating the page size, and honour X-RateLimit-Reset only on a real 429.
    """
    sizes = ["auto", 100] if params.get("limit") == "auto" else [params.get("limit")]
    wait = 3.0
    for attempt in range(tries):
        if sizes[0] is not None:
            params = {**params, "limit": sizes[attempt % len(sizes)]}
        url = f"{API}{path}?{urllib.parse.urlencode(params)}"
        time.sleep(pause)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                payload = json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                reset = e.headers.get("X-RateLimit-Reset") if e.headers else None
                delay = float(reset or 30) + 1
                log(f"  429 on {path}; sleeping {delay:.0f}s")
                time.sleep(delay)
                continue
            delay = wait + random.uniform(0, wait)
            if attempt >= 3:
                log(f"  http {e.code} on {path} (try {attempt + 1}); sleeping {delay:.0f}s")
            time.sleep(delay)
            wait = min(wait * 1.5, 60)
            continue
        except Exception as e:  # network blips, client timeouts, bad JSON
            log(f"  {type(e).__name__} on {path}: {e}; sleeping {wait:.0f}s")
            time.sleep(wait)
            wait = min(wait * 1.5, 60)
            continue
        if payload.get("error"):
            delay = wait + random.uniform(0, wait)
            if attempt >= 3:
                log(f"  api error on {path}: {payload['error']} (try {attempt + 1}); sleeping {delay:.0f}s")
            time.sleep(delay)
            wait = min(wait * 1.5, 60)
            continue
        return payload.get("data") or []
    raise ApiError(f"gave up on {url}")


def log(msg: str) -> None:
    print(f"{dt.datetime.now().strftime('%H:%M:%S')} {msg}", flush=True)


def month_range(since: str, until: str) -> list[tuple[int, int, str]]:
    y, m = map(int, since.split("-"))
    uy, um = map(int, until.split("-"))
    out = []
    while (y, m) <= (uy, um):
        start = dt.datetime(y, m, 1, tzinfo=dt.timezone.utc)
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        end = dt.datetime(ny, nm, 1, tzinfo=dt.timezone.utc)
        out.append((int(start.timestamp()), int(end.timestamp()), f"{y:04d}-{m:02d}"))
        y, m = ny, nm
    return list(reversed(out))  # newest first


def paginate(path: str, base: dict, start: int, end: int, pause: float, tries: int = 14) -> list:
    """Walk a time window in ascending created_utc order, deduping by id."""
    seen: set[str] = set()
    rows: list = []
    cursor = start
    while cursor < end:
        page = get(path, {**base, "after": cursor, "before": end, "sort": "asc", "limit": "auto"}, pause, tries)
        fresh = [r for r in page if r["id"] not in seen]
        for r in fresh:
            seen.add(r["id"])
        rows.extend(fresh)
        if not page:
            break
        last = int(page[-1]["created_utc"])
        # no progress (a page full of one timestamp): step past it
        cursor = last if fresh and last > cursor else cursor + 1
        if len(page) < 100:
            break
    return rows


def clean_comment(c: dict) -> dict | None:
    body = (c.get("body") or "").strip()
    if body in DEAD_BODIES:
        return None
    if (c.get("author") or "").lower() in BOT_AUTHORS:
        return None
    if (c.get("distinguished") or "") == "moderator":
        return None
    return {
        "id": c["id"],
        "link_id": (c.get("link_id") or "").removeprefix("t3_"),
        "score": c.get("score"),
        "created_utc": int(c["created_utc"]),
        "body": body[:BODY_MAX],
    }


def write_gz(path: str, rows: list) -> None:
    tmp = path + ".tmp"
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


POST_FIELDS = "id,title,score,num_comments,created_utc,link_flair_text,over_18"
COMMENT_FIELDS = "id,link_id,parent_id,body,score,created_utc,author,distinguished"


def tree_top_level(link_id: str, pause: float) -> list:
    data = get("/comments/tree", {"link_id": link_id, "limit": 9999,
                                   "start_depth": 1, "start_breadth": 9999}, pause)
    return [n["data"] for n in data if n.get("kind") == "t1"]


def run_month(sub: str, mode: str, start: int, end: int, label: str, out: str, pause: float) -> None:
    d = os.path.join(out, sub)
    os.makedirs(d, exist_ok=True)
    done = os.path.join(d, f"{label}.done")
    if os.path.exists(done):
        return
    t0 = time.time()
    posts = paginate("/posts/search", {"subreddit": sub, "fields": POST_FIELDS}, start, end, pause)
    posts = [p for p in posts if not p.get("over_18")]
    if mode == "filtered":
        posts = [p for p in posts if REQUEST_TITLE.search(p.get("title") or "")]
    posts = [p for p in posts if (p.get("num_comments") or 0) >= MIN_THREAD_COMMENTS]
    keep = {p["id"] for p in posts}

    comments: list = []
    fallback_threads = posts
    if mode == "all":
        # Pull top-level replies subreddit-wide one week at a time (replies can
        # land up to 2 weeks after the thread). A week the server will not
        # serve falls back to fetching its threads one by one.
        fallback_threads = []
        wk = 7 * 86400
        stop = end + 14 * 86400
        seen_ids: set[str] = set()
        for lo in range(start, stop, wk):
            hi = min(lo + wk, stop)
            try:
                # few, quick tries: a week the server will not serve in bulk is
                # cheaper to fetch thread by thread than to wait out 15 minutes
                # of backoff
                raw = paginate("/comments/search", {"subreddit": sub, "parent_id": "",
                                                    "fields": COMMENT_FIELDS}, lo, hi, pause, tries=5)
            except ApiError:
                fallback_threads += [p for p in posts if lo <= p["created_utc"] < hi]
                log(f"  {sub} {label}: week {dt.datetime.fromtimestamp(lo, dt.timezone.utc):%m-%d} "
                    f"falling back to per-thread fetch")
                continue
            for c in raw:
                if c["id"] in seen_ids:
                    continue
                seen_ids.add(c["id"])
                if (c.get("link_id") or "").removeprefix("t3_") in keep:
                    cc = clean_comment(c)
                    if cc:
                        comments.append(cc)
    if fallback_threads:
        for p in fallback_threads:
            try:
                top = tree_top_level(p["id"], pause)
            except ApiError:
                log(f"  {sub} {label}: thread {p['id']} skipped")
                continue
            for c in top:
                c.setdefault("link_id", "t3_" + p["id"])
                cc = clean_comment(c)
                if cc:
                    comments.append(cc)

    slim_posts = [{"id": p["id"], "title": p.get("title"), "score": p.get("score"),
                   "num_comments": p.get("num_comments"), "created_utc": int(p["created_utc"]),
                   "flair": p.get("link_flair_text")} for p in posts]
    write_gz(os.path.join(d, f"{label}.posts.jsonl.gz"), slim_posts)
    write_gz(os.path.join(d, f"{label}.comments.jsonl.gz"), comments)
    open(done, "w").close()
    log(f"{sub} {label}: {len(slim_posts)} threads, {len(comments)} top-level replies ({time.time()-t0:.0f}s)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--subreddits", default=",".join(SUBREDDITS))
    ap.add_argument("--since", default="2015-01")
    ap.add_argument("--until", default=dt.date.today().strftime("%Y-%m"))
    ap.add_argument("--pause", type=float, default=1.0, help="seconds between requests")
    a = ap.parse_args()

    months = month_range(a.since, a.until)
    for sub in [s.strip() for s in a.subreddits.split(",") if s.strip()]:
        mode = SUBREDDITS.get(sub, "filtered")
        log(f"== r/{sub} ({mode}), {len(months)} months")
        for start, end, label in months:
            try:
                run_month(sub, mode, start, end, label, a.out, a.pause)
            except ApiError as e:
                log(f"{sub} {label}: skipped after retries ({e}); rerun to fill the gap")
    return 0


if __name__ == "__main__":
    sys.exit(main())
