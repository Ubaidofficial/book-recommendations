const https = require("https");
const http = require("http");
const { URL } = require("url");

const BASE = process.env.QA_BASE_URL || "https://bookmentions.net";
const EXPECTED_TAG = "bookmention09-20";

// Verify only these URLs (comma-separated paths or full URLs) instead of
// crawling. This is the post-publish check: run it on exactly the pages that
// went live today. Any 404, untagged or wrongly tagged Amazon link fails it.
//   QA_PATHS=/lists/best-books-about-japan,/series/dune-books-in-order node scripts/qa/amazon_monetization_crawl.js
const onlyPaths = (process.env.QA_PATHS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((p) => (/^https?:\/\//i.test(p) ? new URL(p).pathname : p));

// Full crawls also walk /sitemap.xml, so series, people, compare and every
// other published page is checked, not only what /books and /lists link to.
// Set QA_SITEMAP=0 to skip.
const useSitemap = process.env.QA_SITEMAP !== "0";

const baseSeedPaths = [
  "/",
  "/books",
  "/lists",
  "/people",
  "/series",
  "/lists/most-recommended-books",
  "/lists/best-business-books",
  "/lists/personal-development",
  "/lists/sports",
];

function fetchPath(path) {
  return new Promise((resolve, reject) => {
    const client = BASE.startsWith("https") ? https : http;
    client.get(BASE + path, { headers: { "Cache-Control": "no-cache" } }, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => resolve({ path, status: res.statusCode, body }));
    }).on("error", reject);
  });
}

function decodeHtml(s) {
  return s.replace(/&amp;/g, "&").replace(/&#x2F;/g, "/").replace(/&quot;/g, '"');
}

// Every outbound Amazon link must carry the tag, not just product/search
// links: storefronts, short links (amzn.to, a.co) and anything else included.
// Image/CDN hosts are assets, not links, so they are exempt.
function isPurchaseAmazonUrl(href) {
  try {
    const u = new URL(href);
    const host = u.hostname.toLowerCase();
    if (host.includes("images-amazon.com")) return false;
    if (host === "amzn.to" || host === "amzn.com" || host === "a.co") return true;
    return /(^|\.)amazon(\.[a-z]{2,3}){1,2}$/.test(host);
  } catch {
    return false;
  }
}

// Associates params other than `tag` itself that tie a click to some account.
const OTHER_ASSOCIATE_PARAMS = ["ascsubtag", "linkcode", "linkid", "creative", "creativeasin", "camp"];

(async () => {
  console.log("Fetching /lists to dynamically discover valid list seeds...");
  let sciFiSeed = "/lists/best-science-fiction-books";
  try {
    const { status: listsStatus, body: listsBody } = await fetchPath("/lists");
    if (listsStatus === 200) {
      const discoveredListPaths = [...listsBody.matchAll(/href="(\/lists\/[^"#?]+)"/g)].map(m => m[1]);
      const matchedSciFi = discoveredListPaths.find(p => p.includes("sci-fi") || p.includes("science-fiction"));
      if (matchedSciFi) {
        sciFiSeed = matchedSciFi;
        console.log(`Discovered sci-fi seed: ${sciFiSeed}`);
      } else {
        console.warn(`Sci-fi list link not found in /lists, falling back to ${sciFiSeed}`);
      }
    } else {
      console.warn(`Failed to fetch /lists (status: ${listsStatus}), falling back to ${sciFiSeed}`);
    }
  } catch (e) {
    console.error("Error discovering lists:", e.message);
  }

  const seedPaths = onlyPaths.length ? [] : [...baseSeedPaths, sciFiSeed];
  const discovered = new Set(seedPaths);
  onlyPaths.forEach((p) => discovered.add(p));

  if (!onlyPaths.length && useSitemap) {
    try {
      const { status, body } = await fetchPath("/sitemap.xml");
      if (status === 200) {
        const base = new URL(BASE);
        for (const m of body.matchAll(/<loc>([^<]+)<\/loc>/g)) {
          try {
            const u = new URL(decodeHtml(m[1]));
            if (u.host === base.host) discovered.add(u.pathname || "/");
          } catch {}
        }
        console.log(`Sitemap added paths; ${discovered.size} so far.`);
      } else {
        console.warn(`Sitemap returned status ${status}; crawling seeds only.`);
      }
    } catch (e) {
      console.error("Error reading sitemap:", e.message);
    }
  }

  console.log(`Starting crawl with ${seedPaths.length} seed paths...`);
  for (const path of seedPaths) {
    try {
      const { status, body } = await fetchPath(path);
      if (status !== 200) {
        console.warn(`Seed path ${path} returned status ${status}`);
        continue;
      }
      for (const m of body.matchAll(/href="(\/books\/[^"#?]+|\/lists\/[^"#?]+)"/g)) {
        discovered.add(m[1]);
        if (discovered.size >= 80) break;
      }
    } catch (e) {
      console.error(`Error fetching seed path ${path}:`, e.message);
    }
  }

  console.log(`Crawl discovered ${discovered.size} total paths. Verifying paths...`);

  let failed = false;
  let checked = 0;
  let purchaseLinks = 0;
  let missingTagCount = 0;
  let wrongTagCount = 0;
  let badFallbackCount = 0;
  let notFoundCount = 0;
  const notFoundPaths = [];

  for (const path of discovered) {
    try {
      const { status, body } = await fetchPath(path);
      checked++;

      if (status === 404) {
        notFoundCount++;
        notFoundPaths.push(path);
      }

      const badFallback =
        /["']fb-1["']/.test(body) ||
        /\/books\/fb-1\b/.test(body) ||
        /BookRecs/.test(body) ||
        /bookmentions-bookmentions-logo\.png/.test(body);

      if (badFallback) {
        badFallbackCount++;
      }

      const emptyHref = /href=""|src=""/.test(body);

      // Check what a visitor or crawler is actually given: rendered links and
      // JSON-LD (e.g. Book.sameAs). Next.js's streamed-data <script> blocks
      // hold escaped, chunk-split copies of the same strings, so they are
      // dropped to avoid false alarms.
      const jsonLd = [...body.matchAll(/<script[^>]*application\/ld\+json[^>]*>(.*?)<\/script>/gis)].map((m) => m[1]);
      const rendered = body.replace(/<script(?![^>]*application\/ld\+json)[^>]*>.*?<\/script>/gis, "");
      const linkHrefs = [...rendered.matchAll(/href="([^"]*(?:amazon|amzn\.|\/\/a\.co)[^"]*)"/gi)].map((m) => decodeHtml(m[1]));
      const ldUrls = jsonLd.flatMap((blob) =>
        [...blob.matchAll(/https?:\\?\/\\?\/(?:[^"\s\\]|\\\/|\\u0026)*?(?:amazon|amzn\.|\/\/a\.co)(?:[^"\s\\]|\\\/|\\u0026)*/gi)].map((m) =>
          m[0].replace(/\\\//g, "/").replace(/\\u0026/g, "&")
        )
      );
      const hrefs = [...linkHrefs, ...ldUrls].filter(isPurchaseAmazonUrl);

      const missing = [];
      const wrong = [];

      for (const href of hrefs) {
        purchaseLinks++;
        const params = new URL(href).searchParams;
        // Case-insensitive, and every occurrence: `Tag=` or a second `tag=`
        // next to ours is a violation just like a missing one.
        const tags = [...params.entries()]
          .filter(([k]) => k.toLowerCase() === "tag")
          .map(([, v]) => v);
        const hasOtherAssociateParam = [...params.keys()].some((k) =>
          OTHER_ASSOCIATE_PARAMS.includes(k.toLowerCase())
        );
        if (tags.length === 0 || tags.every((t) => !t)) {
          missing.push(href);
          missingTagCount++;
        } else if (tags.length !== 1 || tags[0] !== EXPECTED_TAG || hasOtherAssociateParam) {
          wrong.push(href);
          wrongTagCount++;
        }
      }

      if (status !== 200 || badFallback || emptyHref || missing.length || wrong.length) {
        failed = true;
        console.log(JSON.stringify({
          path,
          status,
          purchaseLinks: hrefs.length,
          badFallback,
          emptyHref,
          missingTags: missing.slice(0, 3),
          wrongTags: wrong.slice(0, 3),
        }, null, 2));
      }
    } catch (e) {
      failed = true;
      console.error(`Error verifying path ${path}:`, e.message);
    }
  }

  console.log(JSON.stringify({
    checkedPageCount: checked,
    totalAmazonPurchaseLinks: purchaseLinks,
    missingTagCount,
    wrongTagCount,
    badFallbackCount,
    notFoundCount,
    notFoundPaths,
    finalResult: failed ? "FAIL" : "PASS",
  }, null, 2));

  process.exit(failed ? 1 : 0);
})();
