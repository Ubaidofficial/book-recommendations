const http = require("http");
const https = require("https");

const BASE = process.env.QA_BASE_URL || "https://bookmentions.net";
const paths = [
  "/books/man-s-search-for-meaning-viktor-e-frankl",
  "/books/atomic-habits-james-clear",
  "/books/sapiens-yuval-noah-harari",
  "/books/zero-to-one-peter-thiel",
  "/books/the-psychology-of-money-morgan-housel",
  "/books/meditations-marcus-aurelius",
  "/books/steve-jobs-walter-isaacson",
  "/books/dune-frank-herbert",
];

const badSourceHosts = [
  "books.google.",
  "google.com/books",
  "amazon.",
  "goodreads.",
  "openlibrary.",
  "covers.openlibrary.",
  "books.googleusercontent.",
];

function fetchPath(path) {
  return new Promise((resolve, reject) => {
    const client = BASE.startsWith("https") ? https : http;
    client.get(BASE + path, { headers: { "Cache-Control": "no-cache" } }, (res) => {
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => resolve({ path, status: res.statusCode, body }));
    }).on("error", reject);
  });
}

function decode(s) {
  return (s || "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); }
  catch { return ""; }
}

(async () => {
  let failed = false;

  console.log(`Auditing source links against base URL: ${BASE}`);

  for (const path of paths) {
    const { status, body } = await fetchPath(path);
    
    // Find all visible Source links (either "View source →" or "Source →")
    const links = [...body.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>\s*(?:View\s+)?Source\s*→\s*<\/a>/gi)]
      .map(m => decode(m[1]));

    const unique = [...new Set(links)];
    const hostCounts = {};
    for (const href of links) {
      const h = hostOf(href);
      hostCounts[h] = (hostCounts[h] || 0) + 1;
    }

    // 1. Check for suspicious hosts (metadata/purchase/cover)
    const suspicious = links.filter(href => {
      const lower = href.toLowerCase();
      return badSourceHosts.some(bad => lower.includes(bad));
    });

    // 2. Check for duplicate URLs (same URL appears 3+ times on the same page)
    const duplicateUrls = Object.entries(
      links.reduce((acc, href) => {
        acc[href] = (acc[href] || 0) + 1;
        return acc;
      }, {})
    ).filter(([, count]) => count >= 3);

    // 3. Check for pipe-separated aggregate quotes/contexts
    const hasPipeInQuote = /&ldquo;[^&]*\|[^&]*&rdquo;/gi.test(body) || 
                          /<blockquote[^>]*>[^<]*\|[^<]*<\/blockquote>/gi.test(body);

    // 4. Check if "Proof-backed recommendation" is shown when there are 0 safe source links
    const hasProofBackedBadge = body.includes("Proof-backed recommendation");
    const safeSourceLinks = links.filter(href => {
      const lower = href.toLowerCase();
      return !badSourceHosts.some(bad => lower.includes(bad)) && !lower.includes("|");
    });

    console.log(`\n=== ${path} status=${status} ===`);
    console.log("sourceLinks:", links.length);
    console.log("uniqueSourceLinks:", unique.length);
    console.log("hostCounts:", hostCounts);
    console.log("suspiciousSourceLinks:", suspicious.slice(0, 10));
    console.log("duplicateSourceUrls (3+):", duplicateUrls.slice(0, 10));
    console.log("hasPipeInQuote:", hasPipeInQuote);
    console.log("hasProofBackedBadge:", hasProofBackedBadge);
    console.log("safeSourceLinksCount:", safeSourceLinks.length);

    let pageFailed = false;
    if (status !== 200) {
      pageFailed = true;
      console.log("FAIL: Status is not 200");
    }
    if (suspicious.length > 0) {
      pageFailed = true;
      console.log("FAIL: Found suspicious source links (Google Books, Amazon, etc.)");
    }
    if (duplicateUrls.length > 0) {
      pageFailed = true;
      console.log("FAIL: Same source URL appeared under 3+ recommender blocks");
    }
    if (hasPipeInQuote) {
      pageFailed = true;
      console.log("FAIL: Found pipe-separated aggregate text in visible quotes");
    }
    if (hasProofBackedBadge && safeSourceLinks.length === 0) {
      pageFailed = true;
      console.log("FAIL: 'Proof-backed recommendation' badge shown but 0 safe visible source links");
    }

    if (pageFailed) {
      failed = true;
      console.log("RESULT: FAIL_OR_NEEDS_REVIEW");
    } else {
      console.log("RESULT: PASS");
    }
  }

  process.exit(failed ? 1 : 0);
})();
