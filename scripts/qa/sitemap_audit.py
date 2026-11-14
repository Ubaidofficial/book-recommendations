#!/usr/bin/env python3
"""Crawl every URL in the live sitemap and report what Search Console cannot.

Checks, per page kind (books / people / lists / series / compare / ...):
  - non-200 responses, redirects, canonical mismatches
  - noindex (meta or X-Robots-Tag) on a URL that is listed in the sitemap
  - missing or duplicate titles and descriptions, H1 count, word count, JSON-LD types
  - internal link graph: pages no other sitemap page links to (followed links only),
    and how many internal book links carry rel="nofollow"
  - Amazon links missing rel="sponsored"

Usage:  python3 -I scripts/qa/sitemap_audit.py [--base https://bookmentions.net] [--limit N] [--json out.json]
Needs only the Python standard library. If outbound HTTPS needs a custom CA bundle,
set CA_BUNDLE=/path/to/bundle.crt. Read-only: it only issues GET requests (8 at a time).
"""
import argparse, collections, json, os, re, ssl, statistics, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="https://bookmentions.net")
ap.add_argument("--limit", type=int, default=0, help="only crawl the first N sitemap URLs (smoke test)")
ap.add_argument("--json", default="", help="write the raw per-page results here")
args = ap.parse_args()
BASE = args.base.rstrip("/")

ctx = ssl.create_default_context(cafile=os.environ.get("CA_BUNDLE") or None)
opener = urllib.request.build_opener(urllib.request.ProxyHandler(), urllib.request.HTTPSHandler(context=ctx))


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (sitemap-audit)"})
    try:
        with opener.open(req, timeout=60) as r:
            return r.status, r.read().decode("utf-8", "replace"), r.geturl(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, "", url, {}
    except Exception as e:  # network error: report as status 0
        return 0, "", url, {"err": str(e)}


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""; self.in_title = False; self.meta = {}; self.canon = None
        self.h1 = 0; self.links = []; self.ld_types = []; self.text = []
        self._skip = 0; self._ld = False; self._buf = ""

    def handle_starttag(self, tag, a):
        a = dict(a)
        if tag == "title": self.in_title = True
        elif tag == "meta" and (a.get("name") or a.get("property")):
            self.meta[(a.get("name") or a.get("property")).lower()] = a.get("content", "")
        elif tag == "link" and a.get("rel") == "canonical": self.canon = a.get("href")
        elif tag == "h1": self.h1 += 1
        elif tag == "a" and a.get("href"): self.links.append((a["href"], a.get("rel", "")))
        if tag in ("script", "style", "noscript"):
            self._skip += 1
            if tag == "script" and a.get("type") == "application/ld+json":
                self._ld = True; self._buf = ""

    def handle_endtag(self, tag):
        if tag == "title": self.in_title = False
        if tag in ("script", "style", "noscript"):
            self._skip = max(0, self._skip - 1)
            if tag == "script" and self._ld:
                self._ld = False
                try:
                    j = json.loads(self._buf)
                    for item in (j if isinstance(j, list) else j.get("@graph", [j])):
                        self.ld_types.append(str(item.get("@type")))
                except Exception:
                    self.ld_types.append("INVALID")

    def handle_data(self, d):
        if self.in_title: self.title += d
        if self._ld: self._buf += d
        if not self._skip and d.strip(): self.text.append(d.strip())


def kind(url):
    parts = urllib.parse.urlparse(url).path.strip("/").split("/")
    return parts[0] or "home"


def audit(url):
    status, html, final, headers = get(url)
    p = Page(); p.feed(html)
    return dict(url=url, status=status, final=final, xrobots=headers.get("x-robots-tag"),
                title=p.title.strip(), desc=p.meta.get("description"), robots=p.meta.get("robots"),
                canon=p.canon, h1=p.h1, words=len(" ".join(p.text).split()), ld=p.ld_types, links=p.links)


sitemap = get(f"{BASE}/sitemap.xml")[1]
urls = re.findall(r"<loc>([^<]+)</loc>", sitemap)
if args.limit: urls = urls[: args.limit]
with ThreadPoolExecutor(8) as ex:
    pages = list(ex.map(audit, urls))
if args.json: json.dump(pages, open(args.json, "w"))

by = collections.defaultdict(list)
for p in pages: by[kind(p["url"])].append(p)
rel_path = lambda u: u.replace(BASE, "")
print(f"{len(pages)} sitemap URLs:", {k: len(v) for k, v in by.items()})
print("non-200:", [(rel_path(p["url"]), p["status"]) for p in pages if p["status"] != 200][:20])
print("redirected:", [(rel_path(p["url"]), rel_path(p["final"])) for p in pages if p["final"].rstrip("/") != p["url"].rstrip("/")][:20])
print("canonical mismatch:", [(rel_path(p["url"]), p["canon"]) for p in pages if p["canon"] and p["canon"].rstrip("/") != p["url"].rstrip("/")][:20])
noindex = [p for p in pages if "noindex" in ((p["robots"] or "") + (p["xrobots"] or "")).lower()]
print(f"noindex pages listed in the sitemap: {len(noindex)}", [rel_path(p["url"]) for p in noindex][:20])
for label, key in (("duplicate titles", "title"), ("duplicate descriptions", "desc")):
    c = collections.Counter(p[key] for p in pages if p[key])
    print(f"{label}:", [(t[:60], n) for t, n in c.items() if n > 1][:10])
print("per kind: missing title / missing desc / H1 != 1 / title > 60 / words (median, min) / pages without JSON-LD")
for k, v in by.items():
    w = [p["words"] for p in v]
    print(f"  {k:8} {sum(not p['title'] for p in v):3} {sum(not p['desc'] for p in v):3} {sum(p['h1'] != 1 for p in v):3} "
          f"{sum(len(p['title']) > 60 for p in v):3}  {statistics.median(w):7.0f} {min(w):5}  {sum(not p['ld'] for p in v):3}")

known = {p["url"].rstrip("/") for p in pages}
inbound = collections.Counter(); book_links = nofollow_book_links = bad_amazon = 0
for p in pages:
    seen = set()
    for href, rel in p["links"]:
        target = urllib.parse.urljoin(p["url"], href).split("#")[0].split("?")[0].rstrip("/")
        if "amazon." in href and "sponsored" not in rel: bad_amazon += 1
        if not target.startswith(BASE): continue
        if "/books/" in target:
            book_links += 1
            nofollow_book_links += "nofollow" in rel
        if target in known and target != p["url"].rstrip("/") and target not in seen and "nofollow" not in rel:
            inbound[target] += 1; seen.add(target)
orphans = [p["url"] for p in pages if inbound[p["url"].rstrip("/")] == 0 and kind(p["url"]) != "home"]
print(f"orphans (no followed link from any other sitemap page): {len(orphans)}", [rel_path(u) for u in orphans][:25])
print(f"internal /books/ links: {book_links}, of which rel=nofollow: {nofollow_book_links}")
print(f"Amazon links without rel=sponsored: {bad_amazon}")
