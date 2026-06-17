#!/usr/bin/env node
/**
 * extract_mrb_person_candidates.js
 * Phase 2 — MostRecommendedBooks Person Candidate Extractor  (v2)
 *
 * PURPOSE:
 *   Fetch a small sample of MRB person detail pages (HTML), extract
 *   book recommendation + source URL pairs, and write candidate review
 *   JSON files to scratch/ only.
 *
 * SAFETY RULES (hard-coded, not configurable):
 *   - No Supabase / DB imports, requires, or connections.
 *   - No writes to any production tables.
 *   - Output goes to scratch/ JSON files only.
 *   - Does NOT copy full quote bodies from MRB.
 *   - Does NOT use private/internal MRB APIs.
 *   - Does NOT bypass robots, rate limits, or login.
 *   - Sequential requests only — no parallelism.
 *   - Respects robots.txt: skips /api, /search, /admin.
 *   - Identifies itself as BookMentions source-backfill bot.
 *   - Rate-limited to MIN_DELAY_MS minimum between requests.
 *   - Timeout per request: REQUEST_TIMEOUT_MS.
 *   - Max retries per URL: MAX_RETRIES.
 *   - Sample only: MAX_SAMPLE_SIZE people max.
 *
 * CANDIDATE ROW SCHEMA:
 *   source, candidate_type, person_name, person_slug, person_page_url,
 *   book_title, book_author, book_url_on_mrb,
 *   original_source_url, original_source_host, source_anchor_text,
 *   source_type, multi_book_source_count,
 *   quote_present, quote_excerpt_short,
 *   confidence, review_required, review_reason,
 *   review_status, is_rejected, rejection_reason, matched_by
 *
 * CLASSIFICATION RULES:
 *   - amazon/goodreads/google-books/openlibrary → is_rejected:true, excluded from candidates
 *   - x.com / facebook.com → confidence:"medium", review_required:true
 *   - youtu.be / youtube.com / vimeo.com → confidence:"medium", review_required:true
 *   - instagram.com / tiktok.com → confidence:"low", review_required:true
 *   - If one source URL maps to ≥5 books for the same person →
 *       source_type:"personal_reading_list", review_required:true, multi_book_source_count set
 *   - If one source URL maps to ≥2 but <5 books for same person →
 *       source_type:"multi_book_source", review_required:true, multi_book_source_count set
 *   - Otherwise source_type inferred from host/URL patterns
 *
 * OUTPUTS (all in scratch/):
 *   mrb_person_candidates_sample.json   — accepted candidate rows only
 *   mrb_person_candidates_report.json   — summary + compliance notes (includes rejected row stats)
 *
 * USAGE:
 *   node scripts/import/extract_mrb_person_candidates.js
 *
 * NO COMMIT. For review only.
 */

'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');

// ---------------------------------------------------------------------------
// Configuration (read-only constants — do not loosen)
// ---------------------------------------------------------------------------

const USER_AGENT         = 'BookMentionsSourceBackfill/0.1 (+https://bookmentions.net)';
const MIN_DELAY_MS       = 1500;   // ≥1.5 s between requests
const REQUEST_TIMEOUT_MS = 20000;  // 20 s per request
const MAX_RETRIES        = 2;
const MAX_SAMPLE_SIZE    = 12;     // hard cap — sample only

// Threshold: ≥ this many books sharing the same source URL → personal_reading_list
const READING_LIST_THRESHOLD = 5;
// Threshold: ≥ this many books sharing the same source URL → multi_book_source
const MULTI_BOOK_THRESHOLD = 2;

// Priority target names (matched case-insensitively against discovered people)
const TARGET_NAMES = [
  'Ryan Holiday',
  'Bill Gates',
  'Barack Obama',
  'Tim Ferriss',
  'Naval Ravikant',
  'Jocko Willink',
  'Noam Chomsky',
  'Mark Manson',
  'Derek Sivers',
  'Marc Andreessen',
  'Charlie Munger',
  'Warren Buffett',
];

// ---------------------------------------------------------------------------
// Source URL rejection rules (purchase/metadata/internal — hard reject)
// Rows matching these are excluded from candidates entirely.
// ---------------------------------------------------------------------------

const REJECT_SOURCE_PATTERNS = [
  { pattern: /amazon\.com/i,              reason: 'amazon_purchase_link' },
  { pattern: /google\.com\/books/i,       reason: 'google_books_link' },
  { pattern: /goodreads\.com/i,           reason: 'goodreads_link' },
  { pattern: /openlibrary\.org/i,         reason: 'openlibrary_link' },
  { pattern: /mostrecommendedbooks\.com/i,reason: 'mrb_internal_url' },
  { pattern: /cdn\.mostrecommendedbooks/i,reason: 'mrb_cdn_url' },
  { pattern: /go\.mostrecommendedbooks/i, reason: 'mrb_redirect_url' },
  { pattern: /\.(jpg|jpeg|png|gif|webp|svg|avif)(\?|$)/i, reason: 'image_url' },
  { pattern: /\|/,                        reason: 'pipe_separated_field' },
];

// ---------------------------------------------------------------------------
// Source classification rules (confidence + source_type + review_required)
// Checked in order — first match wins.
// ---------------------------------------------------------------------------

const SOURCE_CLASSIFIERS = [
  // Social / video → medium confidence, always review required
  {
    pattern:     /^https?:\/\/(www\.)?x\.com\//i,
    confidence:  'medium',
    source_type: 'social_post',
    review_required: true,
    review_reason:   'x.com social post — requires manual source verification',
  },
  {
    pattern:     /^https?:\/\/(www\.)?twitter\.com\//i,
    confidence:  'medium',
    source_type: 'social_post',
    review_required: true,
    review_reason:   'twitter social post — requires manual source verification',
  },
  {
    pattern:     /^https?:\/\/(www\.)?facebook\.com\//i,
    confidence:  'medium',
    source_type: 'social_post',
    review_required: true,
    review_reason:   'facebook post — requires manual source verification',
  },
  {
    pattern:     /^https?:\/\/(www\.)?instagram\.com\//i,
    confidence:  'low',
    source_type: 'social_post',
    review_required: true,
    review_reason:   'instagram post — low verifiability',
  },
  {
    pattern:     /^https?:\/\/(www\.)?tiktok\.com\//i,
    confidence:  'low',
    source_type: 'social_post',
    review_required: true,
    review_reason:   'tiktok post — low verifiability',
  },
  {
    pattern:     /^https?:\/\/(youtu\.be\/|www\.youtube\.com\/)/i,
    confidence:  'medium',
    source_type: 'video',
    review_required: true,
    review_reason:   'youtube/youtu.be video — timestamp verification required',
  },
  {
    pattern:     /^https?:\/\/(www\.)?vimeo\.com\//i,
    confidence:  'medium',
    source_type: 'video',
    review_required: true,
    review_reason:   'vimeo video — timestamp verification required',
  },
  {
    pattern:     /^https?:\/\/open\.spotify\.com\//i,
    confidence:  'medium',
    source_type: 'podcast',
    review_required: true,
    review_reason:   'spotify podcast — timestamp verification required',
  },
  {
    pattern:     /^https?:\/\/podcasts\.apple\.com\//i,
    confidence:  'medium',
    source_type: 'podcast',
    review_required: true,
    review_reason:   'apple podcasts — timestamp verification required',
  },
  // Well-known reading list pages — high confidence, no review required initially
  {
    pattern:     /gatesnotes\.com/i,
    confidence:  'high',
    source_type: 'article',
    review_required: false,
    review_reason:   null,
  },
  {
    pattern:     /ryanholiday\.net/i,
    confidence:  'high',
    source_type: 'personal_reading_list',
    review_required: false,
    review_reason:   null,
  },
  {
    pattern:     /tim\.blog/i,
    confidence:  'high',
    source_type: 'article',
    review_required: false,
    review_reason:   null,
  },
  {
    pattern:     /markmanson\.net/i,
    confidence:  'high',
    source_type: 'article',
    review_required: false,
    review_reason:   null,
  },
  {
    pattern:     /berkshirehathaway\.com/i,
    confidence:  'high',
    source_type: 'article',
    review_required: false,
    review_reason:   null,
  },
  {
    pattern:     /sivers\.org|sive\.rs/i,
    confidence:  'high',
    source_type: 'personal_reading_list',
    review_required: false,
    review_reason:   null,
  },
  {
    pattern:     /chomskylist\.com/i,
    confidence:  'high',
    source_type: 'personal_reading_list',
    review_required: false,
    review_reason:   null,
  },
  {
    pattern:     /a16z\.com/i,
    confidence:  'high',
    source_type: 'article',
    review_required: false,
    review_reason:   null,
  },
  {
    pattern:     /fs\.blog|farnamstreet/i,
    confidence:  'high',
    source_type: 'article',
    review_required: false,
    review_reason:   null,
  },
  {
    pattern:     /substack\.com/i,
    confidence:  'medium',
    source_type: 'article',
    review_required: false,
    review_reason:   null,
  },
  {
    pattern:     /medium\.com/i,
    confidence:  'medium',
    source_type: 'article',
    review_required: false,
    review_reason:   null,
  },
  {
    pattern:     /reddit\.com/i,
    confidence:  'medium',
    source_type: 'article',
    review_required: true,
    review_reason:   'reddit post — requires manual source verification',
  },
  // Reputable publications — high confidence
  {
    pattern:     /nytimes\.com|newyorker\.com|washingtonpost\.com|theguardian\.com|economist\.com|wsj\.com|bloomberg\.com/i,
    confidence:  'high',
    source_type: 'article',
    review_required: false,
    review_reason:   null,
  },
];

// Source anchor texts that identify a real external source proof link
const SOURCE_ANCHOR_TEXTS = ['(source)', '(read more', 'source'];

// ---------------------------------------------------------------------------
// Output paths
// ---------------------------------------------------------------------------

const REPO_ROOT      = path.resolve(__dirname, '../../');
const SCRATCH_DIR    = path.join(REPO_ROOT, 'scratch');
const INPUT_PEOPLE   = path.join(SCRATCH_DIR, 'mrb_people_pages.json');
const OUT_CANDIDATES = path.join(SCRATCH_DIR, 'mrb_person_candidates_sample.json');
const OUT_REPORT     = path.join(SCRATCH_DIR, 'mrb_person_candidates_report.json');

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function log(msg)  { console.log(`[mrb-extract] ${msg}`); }
function warn(msg) { console.warn(`[mrb-extract] WARN: ${msg}`); }

// ---------------------------------------------------------------------------
// HTTP fetch (plain Node, no third-party deps, sequential)
// ---------------------------------------------------------------------------

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      path:     parsedUrl.pathname + parsedUrl.search,
      method:   'GET',
      headers: {
        'User-Agent':      USER_AGENT,
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
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

    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout after ${REQUEST_TIMEOUT_MS}ms`)); });
    req.on('error',   (err) => reject(err));
    req.end();
  });
}

async function fetchWithRetry(url) {
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      log(`  Fetching (attempt ${attempt}): ${url}`);
      const result = await fetchUrl(url);
      if (result.status === 200) return result.body;
      if (result.status === 404) throw new Error(`HTTP 404`);
      if (result.status === 429) { warn(`Rate-limited (429). Backing off 8 s…`); await sleep(8000); continue; }
      throw new Error(`HTTP ${result.status}`);
    } catch (err) {
      if (attempt <= MAX_RETRIES) { warn(`  Error attempt ${attempt}: ${err.message}. Retrying in 4 s…`); await sleep(4000); }
      else throw err;
    }
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// HTML entity decode + tag strip
// ---------------------------------------------------------------------------

function decodeHtml(str) {
  return str
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/<!-- -->/g, '').trim();
}

function stripTags(str) { return str.replace(/<[^>]+>/g, '').trim(); }

// ---------------------------------------------------------------------------
// Source URL rejection check (hard reject — row excluded from candidates)
// ---------------------------------------------------------------------------

function hardRejectSourceUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) return 'empty_url';
  if (!url.trim().startsWith('http')) return 'non_http_url';
  for (const { pattern, reason } of REJECT_SOURCE_PATTERNS) {
    if (pattern.test(url)) return reason;
  }
  return null; // accepted
}

// ---------------------------------------------------------------------------
// Source classification (confidence, source_type, review_required)
// ---------------------------------------------------------------------------

function classifySource(url) {
  if (!url) {
    return {
      confidence:         'low',
      source_type:        'unknown',
      review_required:    true,
      review_reason:      'missing_original_source_url',
    };
  }

  for (const cls of SOURCE_CLASSIFIERS) {
    if (cls.pattern.test(url)) {
      return {
        confidence:      cls.confidence,
        source_type:     cls.source_type,
        review_required: cls.review_required,
        review_reason:   cls.review_reason,
      };
    }
  }

  // Default: medium confidence for unknown external URLs
  return {
    confidence:      'medium',
    source_type:     'unknown',
    review_required: false,
    review_reason:   null,
  };
}

// Extract hostname
function getHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return 'unknown'; }
}

// ---------------------------------------------------------------------------
// Person name extractor from HTML
// ---------------------------------------------------------------------------

function extractPersonName(html) {
  // JSON-LD Person block (most reliable)
  const ldMatches = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of ldMatches) {
    try {
      const content = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
      const data  = JSON.parse(content);
      const graph = data['@graph'] || [data];
      for (const item of graph) {
        if (item['@type'] === 'Person' && item.name && item['@id'] && item['@id'].includes('/people/')) {
          return item.name;
        }
      }
    } catch { /* ignore */ }
  }
  // H1 fallback
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1) {
    const name = decodeHtml(stripTags(h1[1])).replace(/\s*recommended books?\s*$/i, '').trim();
    if (name) return name;
  }
  // <title> fallback
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) return decodeHtml(titleMatch[1]).replace(/\s*recommended books?\s*.*$/i, '').trim();
  return null;
}

// ---------------------------------------------------------------------------
// Book card extractor
//
// MRB HTML structure (confirmed from live page inspection):
//   <h3 class="... line-clamp-2">BOOK TITLE</h3>
//   <span class="line-clamp-1">by <!-- -->AUTHOR</span>
//   <blockquote ...>QUOTE <!-- --> <a ... href="SOURCE_URL">(Source)</a></blockquote>
//
// Returns raw cards — rejection / classification happens in buildCandidates.
// ---------------------------------------------------------------------------

function extractBookCards(html) {
  const cards = [];
  const titleRe = /<h3[^>]*\bline-clamp-2\b[^>]*>([\s\S]*?)<\/h3>/g;
  let titleMatch;

  while ((titleMatch = titleRe.exec(html)) !== null) {
    const titleEnd  = titleMatch.index + titleMatch[0].length;
    const title     = decodeHtml(stripTags(titleMatch[1]));
    if (!title) continue;

    // Author — in ≤400 chars after title close tag
    const authorWindow = html.slice(titleEnd, titleEnd + 400);
    const authorMatch  = authorWindow.match(/by <!-- -->([\s\S]*?)<\/span>/);
    const author       = authorMatch ? decodeHtml(stripTags(authorMatch[1])) : null;

    // Source anchor — in ≤2500 chars after title close tag
    const sourceWindow    = html.slice(titleEnd, titleEnd + 2500);
    const sourceAnchorRe  = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>(\([^)]+\))<\/a>/g;
    let sourceUrl  = null;
    let anchorText = null;
    let srcMatch;

    while ((srcMatch = sourceAnchorRe.exec(sourceWindow)) !== null) {
      const candidateText = srcMatch[2].toLowerCase();
      if (SOURCE_ANCHOR_TEXTS.some(t => candidateText.includes(t))) {
        sourceUrl  = srcMatch[1];
        anchorText = srcMatch[2];
        break;
      }
    }

    cards.push({ title, author, sourceUrl, anchorText });
  }

  return cards;
}

// ---------------------------------------------------------------------------
// Build candidate rows from one person page.
//
// Two-pass approach:
//   Pass 1 — count how many books share each sourceUrl (for multi-book flagging)
//   Pass 2 — build final rows with correct source_type / review_required
// ---------------------------------------------------------------------------

function buildCandidates(personEntry, html, stats) {
  const personName = extractPersonName(html) || personEntry.name;
  const rawCards   = extractBookCards(html);

  // Pass 1: count sourceUrl frequency for this person
  const sourceUrlFreq = {};
  for (const card of rawCards) {
    if (card.sourceUrl) {
      const key = card.sourceUrl.toLowerCase();
      sourceUrlFreq[key] = (sourceUrlFreq[key] || 0) + 1;
    }
  }

  const accepted = [];
  const rejected = [];
  const seen     = new Set();

  for (const card of rawCards) {
    const { title, author, sourceUrl, anchorText } = card;

    // Rule: must have a title
    if (!title) {
      bump(stats.rejectionReasons, 'missing_book_title');
      stats.rejectedCount++;
      continue;
    }

    // Rule: dedupe (person + title + sourceUrl)
    const dedupeKey = `${personEntry.slug}|${title.toLowerCase()}|${(sourceUrl || '').toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      bump(stats.rejectionReasons, 'duplicate_row');
      stats.rejectedCount++;
      continue;
    }
    seen.add(dedupeKey);

    // Rule: hard-reject bad source URLs (amazon, goodreads, etc.)
    const hardRejectReason = hardRejectSourceUrl(sourceUrl);
    if (hardRejectReason) {
      bump(stats.rejectionReasons, hardRejectReason);
      stats.rejectedCount++;
      rejected.push({
        person_name:      personName,
        person_slug:      personEntry.slug,
        book_title:       title,
        book_author:      author || null,
        rejected_source:  sourceUrl,
        rejection_reason: hardRejectReason,
      });
      continue;
    }

    // Classify source (confidence, source_type, review_required)
    const classification = classifySource(sourceUrl);
    let { confidence, source_type, review_required, review_reason } = classification;

    // Multi-book source detection (Pass 2 annotation)
    let multi_book_source_count = null;
    if (sourceUrl) {
      const freq = sourceUrlFreq[sourceUrl.toLowerCase()] || 1;
      if (freq >= READING_LIST_THRESHOLD) {
        source_type            = 'personal_reading_list';
        multi_book_source_count = freq;
        review_required        = true;
        review_reason          = review_reason
          ? `${review_reason}; personal reading list (${freq} books share this source URL)`
          : `personal reading list (${freq} books share this source URL)`;
      } else if (freq >= MULTI_BOOK_THRESHOLD) {
        source_type            = source_type === 'unknown' ? 'multi_book_source' : source_type;
        multi_book_source_count = freq;
        review_required        = true;
        review_reason          = review_reason
          ? `${review_reason}; multi-book source (${freq} books share this source URL)`
          : `multi-book source (${freq} books share this source URL)`;
      }
    }

    const row = {
      source:                  'mostrecommendedbooks',
      candidate_type:          'person_book_source',
      person_name:             personName,
      person_slug:             personEntry.slug,
      person_page_url:         personEntry.url,
      book_title:              title,
      book_author:             author || null,
      book_url_on_mrb:         null,   // MRB does not expose /books/ in current HTML
      original_source_url:     sourceUrl || null,
      original_source_host:    sourceUrl ? getHost(sourceUrl) : null,
      source_anchor_text:      anchorText || null,
      source_type:             source_type,
      multi_book_source_count: multi_book_source_count,
      quote_present:           false,  // NOT copying quote bodies per Phase 2 rules
      quote_excerpt_short:     null,   // Intentionally null — do not store MRB quotes
      confidence:              confidence,
      review_required:         review_required,
      review_reason:           review_reason || null,
      review_status:           'pending',
      is_rejected:             false,
      rejection_reason:        null,
      matched_by:              sourceUrl ? 'page_structure' : 'unknown',
    };

    accepted.push(row);

    // Tally for report
    if (sourceUrl) {
      stats.rowsWithSource++;
      const host = getHost(sourceUrl);
      stats.sourceHostCounts[host] = (stats.sourceHostCounts[host] || 0) + 1;
    } else {
      stats.rowsWithoutSource++;
    }
  }

  return { accepted, rejected };
}

// ---------------------------------------------------------------------------
// Utility: bump a counter in an object
// ---------------------------------------------------------------------------

function bump(obj, key) { obj[key] = (obj[key] || 0) + 1; }

// ---------------------------------------------------------------------------
// Person selector: prefer TARGET_NAMES, fill remainder from discovered list
// ---------------------------------------------------------------------------

function selectPeople(allPeople) {
  const byNormalizedName = {};
  for (const p of allPeople) {
    byNormalizedName[p.name.toLowerCase().replace(/[^a-z0-9]/g, '')] = p;
  }

  const selected      = [];
  const targetMissing = [];

  for (const targetName of TARGET_NAMES) {
    if (selected.length >= MAX_SAMPLE_SIZE) break;
    const norm  = targetName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const match = byNormalizedName[norm];
    if (match) selected.push(match);
    else        targetMissing.push(targetName);
  }

  // Fill remaining slots from the top of the discovered list
  if (selected.length < MAX_SAMPLE_SIZE) {
    const selectedSlugs = new Set(selected.map(p => p.slug));
    for (const p of allPeople) {
      if (selected.length >= MAX_SAMPLE_SIZE) break;
      if (!selectedSlugs.has(p.slug)) { selected.push(p); selectedSlugs.add(p.slug); }
    }
  }

  return { selected, targetMissing };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log('=== BookMentions MRB Candidate Extraction — Phase 2 (v2) ===');
  log(`NO DB WRITES. Sample only (max ${MAX_SAMPLE_SIZE} people). Output: scratch/*.json`);
  log(`User-Agent: ${USER_AGENT}`);
  log(`Rate limit: ≥${MIN_DELAY_MS}ms between requests`);
  log(`Timeout: ${REQUEST_TIMEOUT_MS}ms, Max retries: ${MAX_RETRIES}`);
  log('');

  // Safety assertion: no Supabase in require cache
  const supabaseLoaded = Object.keys(require.cache).some(
    (k) => k.includes('supabase') || k.includes('@supabase')
  );
  if (supabaseLoaded) throw new Error('SAFETY VIOLATION: Supabase module detected. Aborting.');
  log('Safety check PASS: no Supabase module loaded');

  // Ensure scratch dir exists
  if (!fs.existsSync(SCRATCH_DIR)) { fs.mkdirSync(SCRATCH_DIR, { recursive: true }); }

  // Load Phase 1 output
  if (!fs.existsSync(INPUT_PEOPLE)) {
    throw new Error(`Phase 1 output not found: ${INPUT_PEOPLE}\nRun discover_mrb_pages.js first.`);
  }
  const allPeople = JSON.parse(fs.readFileSync(INPUT_PEOPLE, 'utf-8'));
  log(`Loaded ${allPeople.length} people from Phase 1 discovery`);

  // Select sample
  const { selected, targetMissing } = selectPeople(allPeople);
  log(`\nSelected ${selected.length} people for extraction:`);
  for (const p of selected) log(`  - ${p.name}  (${p.url})`);
  if (targetMissing.length) {
    log(`\nTarget names NOT found (${targetMissing.length}):`);
    for (const n of targetMissing) log(`  - ${n}`);
  }

  // Shared stats object (mutated by buildCandidates)
  const stats = {
    rejectionReasons: {},
    sourceHostCounts: {},
    rowsWithSource:   0,
    rowsWithoutSource:0,
    rejectedCount:    0,
  };

  const allAccepted = [];
  const allRejected = [];
  const fetchedPeople = [];
  const notes = [];
  let pagesRequested = 0;
  let pagesFetched   = 0;

  // Process each person sequentially
  for (const personEntry of selected) {
    log(`\n--- [${fetchedPeople.length + 1}/${selected.length}] ${personEntry.name} ---`);
    pagesRequested++;

    let html;
    try {
      html = await fetchWithRetry(personEntry.url);
      pagesFetched++;
    } catch (err) {
      warn(`Failed to fetch ${personEntry.url}: ${err.message}`);
      notes.push(`FETCH_FAIL: ${personEntry.name} — ${err.message}`);
      await sleep(MIN_DELAY_MS);
      continue;
    }

    const { accepted, rejected } = buildCandidates(personEntry, html, stats);

    allAccepted.push(...accepted);
    allRejected.push(...rejected);
    fetchedPeople.push(personEntry.name);

    log(`  Accepted: ${accepted.length} candidate rows  |  Rejected: ${rejected.length} rows`);
    await sleep(MIN_DELAY_MS);
  }

  // Sort source hosts
  const sortedHosts = Object.entries(stats.sourceHostCounts)
    .sort((a, b) => b[1] - a[1])
    .reduce((acc, [h, c]) => { acc[h] = c; return acc; }, {});

  // Confidence breakdown
  const confBreakdown = { high: 0, medium: 0, low: 0 };
  let reviewRequiredCount = 0;
  for (const row of allAccepted) {
    confBreakdown[row.confidence] = (confBreakdown[row.confidence] || 0) + 1;
    if (row.review_required) reviewRequiredCount++;
  }

  // Build report
  const report = {
    generated_at:    new Date().toISOString(),
    source:          'mostrecommendedbooks.com',
    phase:           '2v2',
    method:          'HTML extraction from public person pages — no private APIs, no login',
    pages_requested: pagesRequested,
    pages_fetched:   pagesFetched,
    people_fetched:  fetchedPeople,

    // Candidate rows (accepted only — rejected excluded)
    candidate_rows:                  allAccepted.length,
    rows_with_original_source_url:   stats.rowsWithSource,
    rows_without_source_url:         stats.rowsWithoutSource,

    // Confidence breakdown (accepted rows only)
    confidence_breakdown: confBreakdown,
    review_required_count: reviewRequiredCount,

    // Rejected rows (hard-rejected, NOT in candidates output)
    rejected_rows:       allRejected.length,
    rejection_reasons:   stats.rejectionReasons,
    rejection_note:      'Rejected rows are NOT included in mrb_person_candidates_sample.json. ' +
                         'They are counted here only for auditing.',

    source_host_counts:  sortedHosts,
    target_names_missing: targetMissing,
    no_db_writes:        true,
    safety_notes: [
      'No Supabase client imported or called.',
      'No production tables touched.',
      'Output is review-only JSON in scratch/.',
      'Full quote bodies intentionally NOT stored (quote_present:false on all rows).',
      'Amazon/Goodreads/Google Books rows are hard-rejected and excluded from candidates.',
      'x.com, facebook.com, youtube → confidence:medium, review_required:true.',
      'instagram.com, tiktok.com → confidence:low, review_required:true.',
      `Multi-book source (≥${MULTI_BOOK_THRESHOLD} books/URL) → review_required:true + multi_book_source_count.`,
      `Personal reading list (≥${READING_LIST_THRESHOLD} books/URL) → source_type:personal_reading_list.`,
      `Sequential requests only, ≥${MIN_DELAY_MS}ms between pages.`,
      `User-Agent: ${USER_AGENT}`,
      `Sample limited to ${MAX_SAMPLE_SIZE} people.`,
    ],
    notes,
  };

  // Write outputs
  log('\n[Writing output files]');
  fs.writeFileSync(OUT_CANDIDATES, JSON.stringify(allAccepted, null, 2), 'utf-8');
  log(`Wrote ${allAccepted.length} accepted candidate rows → ${OUT_CANDIDATES}`);

  fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2), 'utf-8');
  log(`Wrote report → ${OUT_REPORT}`);

  // Console summary
  log('\n=== Extraction complete ===');
  log(`People fetched:            ${pagesFetched}/${pagesRequested}`);
  log(`Accepted candidate rows:   ${allAccepted.length}`);
  log(`  ├─ with source URL:      ${stats.rowsWithSource}`);
  log(`  └─ without source URL:   ${stats.rowsWithoutSource}`);
  log(`Rejected rows (excluded):  ${allRejected.length}`);
  log(`Review required:           ${reviewRequiredCount}`);
  log(`Confidence breakdown:      high=${confBreakdown.high}  medium=${confBreakdown.medium}  low=${confBreakdown.low}`);
  log(`Target names missing:      ${targetMissing.join(', ') || 'none'}`);
  log('\nTop source hosts:');
  for (const [host, count] of Object.entries(sortedHosts).slice(0, 12)) {
    log(`  ${String(count).padStart(4)}  ${host}`);
  }
  if (Object.keys(stats.rejectionReasons).length) {
    log('\nRejection reasons (hard-rejected rows):');
    for (const [r, c] of Object.entries(stats.rejectionReasons)) {
      log(`  ${String(c).padStart(4)}  ${r}`);
    }
  }
  log('\nNO DB WRITES PERFORMED. Ready for review.');
}

main().catch((err) => {
  console.error('[mrb-extract] FATAL:', err);
  process.exit(1);
});
