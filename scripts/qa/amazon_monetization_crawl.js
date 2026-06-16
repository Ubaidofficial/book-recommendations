const https = require("https");
const { URL } = require("url");

const BASE = "https://bookmentions.net";
const EXPECTED_TAG = "bookmention09-20";

const baseSeedPaths = [
  "/",
  "/books",
  "/lists",
  "/people",
  "/lists/most-recommended-books",
  "/lists/best-business-books",
  "/lists/personal-development",
  "/lists/sports",
];

function fetchPath(path) {
  return new Promise((resolve, reject) => {
    https.get(BASE + path, { headers: { "Cache-Control": "no-cache" } }, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => resolve({ path, status: res.statusCode, body }));
    }).on("error", reject);
  });
}

function decodeHtml(s) {
  return s.replace(/&amp;/g, "&").replace(/&#x2F;/g, "/").replace(/&quot;/g, '"');
}

function isPurchaseAmazonUrl(href) {
  try {
    const u = new URL(href);
    const host = u.hostname.toLowerCase();
    if (!host.includes("amazon.")) return false;
    if (host.includes("ssl-images-amazon.com")) return false;
    if (host.includes("images-amazon.com")) return false;
    return /\/dp\/|\/gp\/product\/|\/[^/]+\/dp\//i.test(u.pathname) || u.pathname === "/s";
  } catch {
    return false;
  }
}

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

  const seedPaths = [...baseSeedPaths, sciFiSeed];
  const discovered = new Set(seedPaths);

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

      const hrefs = [...body.matchAll(/href="([^"]*amazon[^"]*)"/gi)]
        .map((m) => decodeHtml(m[1]))
        .filter(isPurchaseAmazonUrl);

      const missing = [];
      const wrong = [];

      for (const href of hrefs) {
        purchaseLinks++;
        const tag = new URL(href).searchParams.get("tag") || "";
        if (!tag) {
          missing.push(href);
          missingTagCount++;
        }
        if (tag && tag !== EXPECTED_TAG) {
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
