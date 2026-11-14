#!/usr/bin/env python3
"""
On-page and technical SEO audit of every URL in the live sitemap.

Reads the sitemap, fetches each page (polite: 4 workers, ~0.25 s apart), and records for each:
status, redirect, TTFB, robots meta, canonical, <title>, meta description, Open Graph / Twitter tags,
H1 count + text, H2 count, visible-text word count, JSON-LD types (and whether each block parses),
internal / external link counts, images without alt. Read-only: nothing is changed.

  python3 -I scripts/qa/seo_audit.py [--base https://bookmentions.net] [--limit N]
  → reports/seo_audit_pages.csv and reports/seo_audit_summary.json
"""
from __future__ import annotations

import argparse
import csv
import html
import json
import re
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import requests

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports" / "seo_audit_pages.csv"
SUMMARY = ROOT / "reports" / "seo_audit_summary.json"
UA = "BookMentionsSEOAudit/1.0 (own-site audit)"
lock = threading.Lock()
last = [0.0]


def get(url: str):
    with lock:  # ~0.25 s between request starts across workers
        wait = 0.25 - (time.time() - last[0])
        if wait > 0:
            time.sleep(wait)
        last[0] = time.time()
    t0 = time.time()
    r = requests.get(url, headers={"User-Agent": UA}, timeout=60, allow_redirects=False)
    return r, time.time() - t0


def attr(tag: str, name: str):
    m = re.search(rf'{name}\s*=\s*"([^"]*)"', tag, re.I) or re.search(rf"{name}\s*=\s*'([^']*)'", tag, re.I)
    return html.unescape(m.group(1)) if m else None


def meta(page: str, key: str, by="name"):
    for m in re.finditer(r"<meta\b[^>]*>", page, re.I):
        tag = m.group(0)
        if (attr(tag, by) or "").lower() == key:
            return attr(tag, "content")
    return None


def visible_text(page: str) -> str:
    body = re.search(r"<body\b.*</body>", page, re.S | re.I)
    t = body.group(0) if body else page
    t = re.sub(r"<(script|style|noscript|svg)\b.*?</\1>", " ", t, flags=re.S | re.I)
    t = re.sub(r"<(header|footer|nav)\b.*?</\1>", " ", t, flags=re.S | re.I)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    return " ".join(t.split())


def audit(url: str, base: str):
    row = {"url": url, "path": urlsplit(url).path or "/"}
    try:
        r, ttfb = get(url)
    except Exception as e:  # noqa: BLE001
        row.update(status="ERR", error=type(e).__name__)
        return row
    row.update(status=r.status_code, ttfb_s=round(ttfb, 2), redirect=r.headers.get("location", "") if 300 <= r.status_code < 400 else "")
    if r.status_code != 200:
        return row
    p = r.text
    row["cache_control"] = r.headers.get("cache-control", "")
    row["x_robots"] = r.headers.get("x-robots-tag", "")
    t = re.search(r"<title[^>]*>(.*?)</title>", p, re.S | re.I)
    row["title"] = html.unescape(" ".join(t.group(1).split())) if t else ""
    row["title_len"] = len(row["title"])
    d = meta(p, "description") or ""
    row["description"] = d
    row["description_len"] = len(d)
    row["robots"] = meta(p, "robots") or ""
    can = re.search(r'<link\b[^>]*rel="canonical"[^>]*>', p, re.I)
    row["canonical"] = attr(can.group(0), "href") if can else ""
    row["canonical_self"] = int(bool(row["canonical"]) and urlsplit(row["canonical"]).path.rstrip("/") == urlsplit(url).path.rstrip("/"))
    row["og_title"] = int(bool(meta(p, "og:title", "property")))
    row["og_description"] = int(bool(meta(p, "og:description", "property")))
    row["og_image"] = int(bool(meta(p, "og:image", "property")))
    row["twitter_card"] = int(bool(meta(p, "twitter:card")))
    h1 = re.findall(r"<h1\b[^>]*>(.*?)</h1>", p, re.S | re.I)
    row["h1_count"] = len(h1)
    row["h1"] = html.unescape(" ".join(re.sub(r"<[^>]+>", " ", h1[0]).split())) if h1 else ""
    row["h2_count"] = len(re.findall(r"<h2\b", p, re.I))
    row["words"] = len(visible_text(p).split())
    ld_types, ld_bad = [], 0
    for m in re.finditer(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', p, re.S | re.I):
        try:
            j = json.loads(html.unescape(m.group(1)))
            for node in (j if isinstance(j, list) else [j]):
                ld_types.append(str(node.get("@type")))
        except Exception:  # noqa: BLE001
            ld_bad += 1
    row["jsonld_types"] = "|".join(ld_types)
    row["jsonld_invalid"] = ld_bad
    host = urlsplit(base).netloc
    links = [urljoin(url, h) for h in re.findall(r'<a\b[^>]*href="([^"#]+)"', p, re.I)]
    row["links_internal"] = sum(1 for l in links if urlsplit(l).netloc == host)
    row["links_external"] = sum(1 for l in links if urlsplit(l).netloc not in (host, ""))
    imgs = re.findall(r"<img\b[^>]*>", p, re.I)
    row["images"] = len(imgs)
    row["images_no_alt"] = sum(1 for i in imgs if attr(i, "alt") is None)
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://bookmentions.net")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    sm = requests.get(args.base + "/sitemap.xml", headers={"User-Agent": UA}, timeout=120).text
    # Fetch every sitemap path from --base, so a local build (whose sitemap names its own build-time origin)
    # can be audited the same way as production.
    urls = [args.base.rstrip("/") + (urlsplit(u).path or "/") for u in re.findall(r"<loc>([^<]+)</loc>", sm)]
    if args.limit:
        urls = urls[: args.limit]
    print(f"sitemap urls: {len(urls)}", flush=True)
    with ThreadPoolExecutor(4) as ex:
        rows = list(ex.map(lambda u: audit(u, args.base), urls))
    cols = ["url", "path", "status", "redirect", "ttfb_s", "robots", "x_robots", "canonical", "canonical_self", "title", "title_len",
            "description", "description_len", "og_title", "og_description", "og_image", "twitter_card", "h1_count", "h1", "h2_count",
            "words", "jsonld_types", "jsonld_invalid", "links_internal", "links_external", "images", "images_no_alt", "cache_control", "error"]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    ok = [r for r in rows if r.get("status") == 200]
    SUMMARY.write_text(json.dumps({"urls": len(rows), "status": dict(Counter(str(r.get("status")) for r in rows)), "ok": len(ok)}, indent=1))
    print(json.dumps({"urls": len(rows), "ok": len(ok), "status": dict(Counter(str(r.get("status")) for r in rows))}))


if __name__ == "__main__":
    main()
