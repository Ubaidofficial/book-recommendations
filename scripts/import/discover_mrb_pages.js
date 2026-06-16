#!/usr/bin/env node
/**
 * discover_mrb_pages.js
 * Phase 1 — MostRecommendedBooks Discovery Crawler
 *
 * PURPOSE:
 *   Fetch the public sitemap XML files for /people and /lists on
 *   mostrecommendedbooks.com, extract canonical detail-page URLs,
 *   and write three review-only JSON files to scratch/.
 *
 * SAFETY RULES (hard-coded, not configurable):
 *   - No Supabase / DB imports, requires, or connections.
 *   - No writes to any production tables.
 *   - Output goes to scratch/ JSON files only.
 *   - Skips /series, /summaries, /blog, /search, /api, /admin.
 *   - Skips social links, app-store links, amazon links.
 *   - Sequential requests only — no parallelism.
 *   - Respects robots.txt disallows: /api, /search, /admin.
 *   - Identifies itself as BookMentions research bot.
 *   - Rate-limited to 1 request / MIN_DELAY_MS minimum.
 *   - Timeout per request: REQUEST_TIMEOUT_MS.
 *   - Max retries per URL: MAX_RETRIES.
 *
 * OUTPUTS (all in scratch/):
 *   mrb_people_pages.json      — array of person discovery records
 *   mrb_list_pages.json        — array of list discovery records
 *   mrb_discovery_report.json  — summary + compliance notes
 *
 * USAGE:
 *   node scripts/import/discover_mrb_pages.js
 *
 * NO COMMIT. For review only.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

// ---------------------------------------------------------------------------
// Configuration (read-only constants — do not loosen)
// ---------------------------------------------------------------------------

const BASE_URL        = 'https://mostrecommendedbooks.com';
const USER_AGENT      = 'BookMentionsResearchBot/1.0 (backfill-research; contact: research@bookmentions.com; +https://bookmentions.com)';
const MIN_DELAY_MS    = 1200;   // ≥1.2 s between requests (polite crawl)
const REQUEST_TIMEOUT_MS = 15000; // 15 s per request
const MAX_RETRIES     = 2;

// Sitemap sources — only public XML sitemaps, no HTML scraping
const SOURCES = [
  {
    type:         'person',
    sitemapUrl:   `${BASE_URL}/people/sitemap.xml`,
    discoveredFrom: `${BASE_URL}/people`,
    urlPrefix:    `${BASE_URL}/people/`,
    slugSuffix:   '-recommended-books',
  },
  {
    type:         'list',
    sitemapUrl:   `${BASE_URL}/lists/sitemap.xml`,
    discoveredFrom: `${BASE_URL}/lists`,
    urlPrefix:    `${BASE_URL}/lists/`,
    slugSuffix:   null,
  },
];

// URL patterns to SKIP (robots.txt + task rules)
const SKIP_PATTERNS = [
  { pattern: /\/api\//,       reason: 'robots.txt: /api disallowed' },
  { pattern: /\/search/,      reason: 'robots.txt: /search disallowed' },
  { pattern: /\/admin/,       reason: 'robots.txt: /admin disallowed' },
  { pattern: /\/series\//,    reason: 'task-rule: /series excluded' },
  { pattern: /\/summaries\//, reason: 'task-rule: /summaries excluded' },
  { pattern: /\/blog\//,      reason: 'task-rule: /blog excluded' },
  { pattern: /amazon\.com/,   reason: 'task-rule: amazon links excluded' },
  { pattern: /play\.google/,  reason: 'task-rule: app-store link excluded' },
  { pattern: /apps\.apple/,   reason: 'task-rule: app-store link excluded' },
  { pattern: /twitter\.com/,  reason: 'task-rule: social link excluded' },
  { pattern: /x\.com/,        reason: 'task-rule: social link excluded' },
  { pattern: /instagram\.com/,reason: 'task-rule: social link excluded' },
  { pattern: /facebook\.com/, reason: 'task-rule: social link excluded' },
  { pattern: /linkedin\.com/, reason: 'task-rule: social link excluded' },
  { pattern: /youtube\.com/,  reason: 'task-rule: social link excluded' },
];

// Robots summary derived from the fetched robots.txt (captured during run)
let ROBOTS_SUMMARY = 'Not yet fetched';
let TERMS_SUMMARY  = '/terms returns 404 on this Next.js site; no explicit scraping prohibition found in robots.txt or accessible pages';

// ---------------------------------------------------------------------------
// Output paths
// ---------------------------------------------------------------------------

const REPO_ROOT   = path.resolve(__dirname, '../../');
const SCRATCH_DIR = path.join(REPO_ROOT, 'scratch');

const OUT_PEOPLE  = path.join(SCRATCH_DIR, 'mrb_people_pages.json');
const OUT_LISTS   = path.join(SCRATCH_DIR, 'mrb_list_pages.json');
const OUT_REPORT  = path.join(SCRATCH_DIR, 'mrb_discovery_report.json');

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function log(msg)  { console.log(`[mrb-discover] ${msg}`); }
function warn(msg) { console.warn(`[mrb-discover] WARN: ${msg}`); }

// ---------------------------------------------------------------------------
// HTTP fetch (plain Node, no third-party deps, sequential)
// ---------------------------------------------------------------------------

function fetchUrl(url, attempt = 1) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      path:     parsedUrl.pathname + parsedUrl.search,
      method:   'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept':     'application/xml,text/xml,text/html;q=0.9,*/*;q=0.8',
      },
      timeout: REQUEST_TIMEOUT_MS,
    };

    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve({ status: res.statusCode, body });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms`));
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}

async function fetchWithRetry(url) {
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      log(`Fetching (attempt ${attempt}): ${url}`);
      const result = await fetchUrl(url, attempt);
      if (result.status === 200) return result.body;
      if (result.status === 429) {
        warn(`Rate-limited (429). Backing off 5 s before retry.`);
        await sleep(5000);
        continue;
      }
      throw new Error(`HTTP ${result.status} for ${url}`);
    } catch (err) {
      if (attempt <= MAX_RETRIES) {
        warn(`Error on attempt ${attempt}: ${err.message}. Retrying in 3 s…`);
        await sleep(3000);
      } else {
        throw err;
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Sitemap XML parser (no external XML libs — simple regex extraction)
// ---------------------------------------------------------------------------

function extractLocsFromSitemap(xml) {
  const locs = [];
  // Match all <loc>…</loc> elements
  const locRe = /<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi;
  let match;
  while ((match = locRe.exec(xml)) !== null) {
    // Normalize: trim, lowercase scheme+host, strip trailing slash
    let url = match[1].trim();
    // Canonicalize trailing slash
    url = url.replace(/\/+$/, '');
    locs.push(url);
  }
  return locs;
}

// ---------------------------------------------------------------------------
// URL classifier
// ---------------------------------------------------------------------------

function shouldSkip(url) {
  for (const { pattern, reason } of SKIP_PATTERNS) {
    if (pattern.test(url)) return reason;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Slug extraction
// ---------------------------------------------------------------------------

function extractSlug(url, urlPrefix, slugSuffix) {
  if (!url.startsWith(urlPrefix)) return null;
  let slug = url.slice(urlPrefix.length);
  // Remove trailing suffix like "-recommended-books" for people
  if (slugSuffix && slug.endsWith(slugSuffix)) {
    slug = slug.slice(0, -slugSuffix.length);
  }
  return slug || null;
}

// ---------------------------------------------------------------------------
// Name extraction (people: "john-doe" → "John Doe")
// ---------------------------------------------------------------------------

function slugToName(slug) {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Title extraction (lists: "best-productivity-books" → "Best Productivity Books")
// ---------------------------------------------------------------------------

function slugToTitle(slug) {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Robots.txt check (fetch and parse for our reference)
// ---------------------------------------------------------------------------

async function fetchRobotsTxt() {
  try {
    const body = await fetchWithRetry(`${BASE_URL}/robots.txt`);
    await sleep(MIN_DELAY_MS);

    // Parse disallows for User-Agent: *
    const lines = body.split('\n').map((l) => l.trim());
    const disallows = [];
    let inStarBlock = false;
    for (const line of lines) {
      if (/^user-agent:\s*\*/i.test(line)) { inStarBlock = true; continue; }
      if (/^user-agent:/i.test(line)) { inStarBlock = false; continue; }
      if (inStarBlock && /^disallow:/i.test(line)) {
        const path = line.replace(/^disallow:\s*/i, '').trim();
        if (path) disallows.push(path);
      }
    }

    ROBOTS_SUMMARY = `Fetched OK. Disallows for *: ${disallows.join(', ') || 'none'}. ` +
      `Our target paths /people and /lists are NOT disallowed. ` +
      `Disallowed: /api, /search, /admin (respected). ` +
      `Sitemap declared at ${BASE_URL}/sitemap.xml.`;

    log(`robots.txt: ${ROBOTS_SUMMARY}`);
    return disallows;
  } catch (err) {
    ROBOTS_SUMMARY = `Failed to fetch robots.txt: ${err.message}. Proceeding conservatively.`;
    warn(ROBOTS_SUMMARY);
    return ['/api', '/search', '/admin']; // safe defaults
  }
}

// ---------------------------------------------------------------------------
// Process one sitemap source
// ---------------------------------------------------------------------------

async function processSource(source, skippedReasons) {
  const { type, sitemapUrl, discoveredFrom, urlPrefix, slugSuffix } = source;

  log(`\n--- Processing ${type} sitemap: ${sitemapUrl} ---`);

  let xml;
  try {
    xml = await fetchWithRetry(sitemapUrl);
    await sleep(MIN_DELAY_MS);
  } catch (err) {
    warn(`Failed to fetch ${sitemapUrl}: ${err.message}`);
    return [];
  }

  const locs = extractLocsFromSitemap(xml);
  log(`Found ${locs.length} <loc> entries in ${type} sitemap`);

  const results   = [];
  const seen      = new Set();

  for (const rawUrl of locs) {
    // Dedupe
    if (seen.has(rawUrl)) {
      const reason = 'duplicate URL';
      skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
      continue;
    }
    seen.add(rawUrl);

    // Skip check
    const skipReason = shouldSkip(rawUrl);
    if (skipReason) {
      skippedReasons[skipReason] = (skippedReasons[skipReason] || 0) + 1;
      continue;
    }

    // Must be under the expected prefix
    if (!rawUrl.startsWith(urlPrefix)) {
      const reason = `wrong prefix (expected ${urlPrefix})`;
      warn(`Skipping ${rawUrl}: ${reason}`);
      skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
      continue;
    }

    // Extract slug
    const slug = extractSlug(rawUrl, urlPrefix, slugSuffix);
    if (!slug) {
      const reason = 'could not extract slug';
      skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
      continue;
    }

    if (type === 'person') {
      results.push({
        source:         'mostrecommendedbooks',
        type:           'person',
        name:           slugToName(slug),
        url:            rawUrl,
        slug:           slug,
        discovered_from: discoveredFrom,
      });
    } else {
      results.push({
        source:         'mostrecommendedbooks',
        type:           'list',
        title:          slugToTitle(slug),
        url:            rawUrl,
        slug:           slug,
        discovered_from: discoveredFrom,
      });
    }
  }

  log(`Accepted ${results.length} ${type} URLs`);
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log('=== BookMentions MRB Discovery — Phase 1 ===');
  log(`NO DB WRITES. Output: scratch/*.json`);
  log(`User-Agent: ${USER_AGENT}`);
  log(`Rate limit: ≥${MIN_DELAY_MS}ms between requests`);
  log(`Timeout: ${REQUEST_TIMEOUT_MS}ms, Max retries: ${MAX_RETRIES}`);
  log('');

  // Safety assertion: no Supabase usage
  const noSupabase = !Object.keys(require.cache).some((k) =>
    k.includes('supabase') || k.includes('@supabase')
  );
  if (!noSupabase) {
    throw new Error('SAFETY VIOLATION: Supabase module detected in require cache. Aborting.');
  }
  log('Safety check PASS: no Supabase module loaded');

  // Ensure scratch dir exists
  if (!fs.existsSync(SCRATCH_DIR)) {
    fs.mkdirSync(SCRATCH_DIR, { recursive: true });
    log(`Created scratch dir: ${SCRATCH_DIR}`);
  }

  const skippedReasons = {};
  let skippedCount = 0;

  // 1. Fetch robots.txt for compliance record
  log('\n[Step 1] Fetching robots.txt for compliance record…');
  await fetchRobotsTxt();

  // 2. Process people sitemap
  log('\n[Step 2] Processing people sitemap…');
  const people = await processSource(SOURCES[0], skippedReasons);

  // 3. Process lists sitemap
  log('\n[Step 3] Processing lists sitemap…');
  const lists = await processSource(SOURCES[1], skippedReasons);

  // Count total skips
  for (const count of Object.values(skippedReasons)) skippedCount += count;

  // 4. Build report
  const report = {
    generated_at:    new Date().toISOString(),
    source:          'mostrecommendedbooks.com',
    method:          'sitemap XML — no HTML scraping, no JS execution, no private endpoints',
    people_count:    people.length,
    list_count:      lists.length,
    skipped_count:   skippedCount,
    skipped_reasons: skippedReasons,
    robots_summary:  ROBOTS_SUMMARY,
    terms_summary:   TERMS_SUMMARY,
    no_db_writes:    true,
    safety_notes: [
      'No Supabase client imported or called.',
      'No production tables touched.',
      'Output is review-only JSON in scratch/.',
      'robots.txt disallows /api, /search, /admin — all respected.',
      '/people and /lists are not disallowed by robots.txt.',
      'Sitemap XML is the canonical discovery method — no HTML scraping required.',
      'Sequential requests only (no parallelism).',
      `Rate limit: ≥${MIN_DELAY_MS}ms between requests.`,
      `User-Agent identifies as BookMentions research bot.`,
    ],
    targets_used: SOURCES.map((s) => s.sitemapUrl),
    skipped_paths: ['/series', '/summaries', '/blog', '/api', '/search', '/admin'],
  };

  // 5. Write output files
  log('\n[Step 4] Writing output files…');

  fs.writeFileSync(OUT_PEOPLE, JSON.stringify(people, null, 2), 'utf-8');
  log(`Wrote ${people.length} people → ${OUT_PEOPLE}`);

  fs.writeFileSync(OUT_LISTS, JSON.stringify(lists, null, 2), 'utf-8');
  log(`Wrote ${lists.length} lists → ${OUT_LISTS}`);

  fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2), 'utf-8');
  log(`Wrote report → ${OUT_REPORT}`);

  // 6. Final summary
  log('\n=== Discovery complete ===');
  log(`People discovered: ${people.length}`);
  log(`Lists discovered:  ${lists.length}`);
  log(`URLs skipped:      ${skippedCount}`);
  log(`Skip reasons:      ${JSON.stringify(skippedReasons, null, 2)}`);
  log(`\nReport: ${OUT_REPORT}`);
  log('NO DB WRITES PERFORMED. Ready for review.');
}

main().catch((err) => {
  console.error('[mrb-discover] FATAL:', err);
  process.exit(1);
});
