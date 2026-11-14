#!/usr/bin/env node
/**
 * Amazon tag audit. Every Amazon URL ANYWHERE in a page's source must carry
 * exactly one `tag=bookmention09-20` and no other Associates parameter.
 *
 * scripts/qa/amazon_monetization_crawl.js only follows /books and /lists links and only reads href="…".
 * This audit also reads JSON-LD, inline scripts and the embedded client data (so the books a person page
 * only renders after "Show more" are covered too), and takes an explicit list of paths:
 *
 *   QA_BASE_URL=http://localhost:3000 node scripts/qa/amazon_tag_audit.js paths.txt
 *
 * paths.txt: one path per line (/people/naval-ravikant, /books/sapiens-yuval-noah-harari, ...).
 * Exit code 1 if any URL is untagged, wrongly tagged, or a short link that cannot be tagged.
 */
const fs = require("fs");
const http = require("http");
const https = require("https");

const BASE = process.env.QA_BASE_URL || "http://localhost:3000";
const TAG = "bookmention09-20";
const OTHER = ["ascsubtag", "linkcode", "linkid", "creative", "creativeasin", "camp"];

function get(path) {
  return new Promise((resolve, reject) => {
    (BASE.startsWith("https") ? https : http)
      .get(BASE + path, { headers: { "Cache-Control": "no-cache" } }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      })
      .on("error", reject);
  });
}

// The page source holds URLs as plain text, HTML-escaped, and JSON-escaped (&, \/).
function normalise(s) {
  // The server streams page data in chunks: a URL can be cut by `"])</script><script>self.__next_f.push([1,"`.
  return s
    .replace(/"\]\)<\/script><script>self\.__next_f\.push\(\[1,"/g, "")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    .replace(/&quot;/g, '"');
}

function isPurchaseHost(host) {
  host = host.toLowerCase();
  if (host.includes("images-amazon.com") || host.includes("media-amazon.com") || host.includes("ssl-images-amazon")) return false;
  if (["amzn.to", "amzn.com", "a.co"].includes(host)) return true;
  return /(^|\.)amazon(\.[a-z]{2,3}){1,2}$/.test(host);
}

(async () => {
  const file = process.argv[2];
  if (!file) throw new Error("usage: amazon_tag_audit.js paths.txt");
  const paths = fs.readFileSync(file, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
  let pages = 0, urls = 0, bad = 0, non200 = 0;
  const unique = new Set(), problems = [];
  for (const path of paths) {
    let r;
    try { r = await get(path); } catch (e) { non200++; problems.push({ path, error: e.message }); continue; }
    if (r.status !== 200) { non200++; problems.push({ path, status: r.status }); continue; }
    pages++;
    const text = normalise(r.body);
    const found = text.match(/https?:\/\/[^\s"'<>\\)]*(?:amazon\.|amzn\.|\/\/a\.co)[^\s"'<>\\)]*/gi) || [];
    for (const raw of found) {
      let u;
      try { u = new URL(raw.replace(/[.,;]+$/, "")); } catch { continue; }
      if (!isPurchaseHost(u.hostname)) continue;
      urls++;
      unique.add(u.href);
      const tags = [...u.searchParams.entries()].filter(([k]) => k.toLowerCase() === "tag").map(([, v]) => v);
      const other = [...u.searchParams.keys()].some((k) => OTHER.includes(k.toLowerCase()));
      const short = ["amzn.to", "amzn.com", "a.co"].includes(u.hostname.toLowerCase());
      if (short || tags.length !== 1 || tags[0] !== TAG || other) {
        bad++;
        if (problems.length < 25) problems.push({ path, url: u.href.slice(0, 140), tags, short });
      }
    }
  }
  console.log(JSON.stringify({ base: BASE, pagesChecked: pages, pagesNotOk: non200, amazonUrlsFound: urls, distinctUrls: unique.size, violations: bad, result: bad === 0 && non200 === 0 ? "PASS" : "FAIL", problems }, null, 2));
  process.exit(bad === 0 && non200 === 0 ? 0 : 1);
})();
