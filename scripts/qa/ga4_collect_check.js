#!/usr/bin/env node
/**
 * Does the live site actually send GA4 hits?
 *
 * Loads a few pages in a real browser and looks at the outgoing requests:
 *   PASS  = at least one request to google-analytics.com/g/collect (or analytics.google.com/g/collect)
 *           carrying the expected measurement ID.
 *   FAIL  = no collect request, or a gtag/js request whose id is not a bare G-XXXX value
 *           (what a pasted <script> snippet in the GTM "Tag ID" field produces).
 *
 * Usage: node scripts/qa/ga4_collect_check.js [https://bookmentions.net] [G-PCTSPWJHR2]
 * Needs `playwright` to be resolvable (global install is fine: NODE_PATH=$(npm root -g)).
 * Read-only: it only loads public pages. Note it sends real page views to GA4, like any visitor.
 */
const { chromium } = require("playwright");
const base = (process.argv[2] || "https://bookmentions.net").replace(/\/$/, "");
const wantId = process.argv[3] || "G-PCTSPWJHR2";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const collect = [], gtagJs = [];
  page.on("request", (r) => {
    const u = r.url();
    if (/(google-analytics|analytics\.google)\.com\/g\/collect/.test(u)) collect.push(u);
    if (/googletagmanager\.com\/gtag\/js/.test(u)) gtagJs.push(decodeURIComponent((u.split("id=")[1] || "")));
  });
  for (const path of ["/", "/lists/best-self-help-books"]) {
    await page.goto(base + path, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(4000);
  }
  await browser.close();

  const malformed = gtagJs.filter((id) => !/^G-[A-Z0-9]+$/.test(id.split("&")[0]));
  const matching = collect.filter((u) => u.includes("tid=" + wantId));
  console.log(`gtag/js ids requested: ${JSON.stringify([...new Set(gtagJs)]).slice(0, 300)}`);
  console.log(`g/collect requests: ${collect.length} (with tid=${wantId}: ${matching.length})`);
  if (malformed.length) console.log(`MALFORMED gtag id (a pasted snippet in the GTM Tag ID field?): ${malformed[0].slice(0, 80)}...`);
  const ok = matching.length > 0 && malformed.length === 0;
  console.log(ok ? "PASS" : "FAIL");
  process.exit(ok ? 0 : 1);
})();
