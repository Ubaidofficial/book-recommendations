#!/usr/bin/env node
/**
 * verify_mrb_tier_a_sources.js
 * Phase 5 — Verify Tier A Source URLs
 *
 * PURPOSE:
 *   For each row in scratch/mrb_review_queue_tier_a.json, fetch
 *   original_source_url, check reachability, and look for evidence that
 *   the page mentions the expected book title or author.  Classify each
 *   row as verified / needs_manual_review / failed and write three review-
 *   only JSON files to scratch/.
 *
 * SAFETY RULES:
 *   - No Supabase client, no createClient, no DB calls.
 *   - No insert, update, delete, upsert, rpc, or any mutation.
 *   - No service role key, no DATABASE_URL.
 *   - No storing full page HTML — evidence snippets ≤ 240 chars only.
 *   - No screenshot/OCR/PDF parsing.
 *   - Sequential fetching only; minimum 1500 ms between requests.
 *   - Identifiable User-Agent.
 *   - Output: scratch/ JSON files only.
 *
 * INPUTS:
 *   scratch/mrb_review_queue_tier_a.json
 *
 * OUTPUTS:
 *   scratch/mrb_tier_a_verified_sources.json
 *   scratch/mrb_tier_a_failed_sources.json   (failed + needs_manual_review)
 *   scratch/mrb_tier_a_verification_report.json
 *
 * VERIFICATION LOGIC:
 *   1. Fetch URL (follow redirects, 20 s timeout, 2 retries on network/5xx).
 *   2. If non-HTML (PDF, etc.)  → needs_manual_review / non_html_content.
 *   3. If HTTP 4xx/5xx (no retry) → failed.
 *   4. Search stripped page text for:
 *      a. exact title (case-insensitive)
 *      b. normalized title
 *      c. author name
 *      d. title in <title> or meta description only
 *   5. Found → verified; not found → needs_manual_review.
 *   6. personal_reading_list pages: verified but review_required forced true.
 *
 * NO COMMIT. For human review only.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT   = path.resolve(__dirname, '../../');
const SCRATCH_DIR = path.join(REPO_ROOT, 'scratch');

const IN_TIER_A   = path.join(SCRATCH_DIR, 'mrb_review_queue_tier_a.json');
const OUT_VERIFIED = path.join(SCRATCH_DIR, 'mrb_tier_a_verified_sources.json');
const OUT_FAILED   = path.join(SCRATCH_DIR, 'mrb_tier_a_failed_sources.json');
const OUT_REPORT   = path.join(SCRATCH_DIR, 'mrb_tier_a_verification_report.json');

// ---------------------------------------------------------------------------
// Fetch configuration
// ---------------------------------------------------------------------------

const USER_AGENT      = 'BookMentions-Verifier/1.0 (+https://bookmentions.com)';
const FETCH_TIMEOUT   = 20_000;   // ms
const BETWEEN_DELAY   = 1_500;    // ms — minimum gap between requests
const MAX_RETRIES     = 2;        // retries on network error or 5xx
const RETRY_DELAY     = 3_000;    // ms base for retry back-off
const SNIPPET_MAX     = 240;      // chars — max evidence snippet length
const BODY_READ_LIMIT = 600_000;  // chars — truncate body after this

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg)  { console.log(`[mrb-verify] ${msg}`); }
function warn(msg) { console.warn(`[mrb-verify] WARN: ${msg}`); }

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function bump(obj, key) { obj[key] = (obj[key] || 0) + 1; }

// Normalize for comparison: lowercase, strip punctuation, collapse whitespace
function norm(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/['''""`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Extract a ≤ SNIPPET_MAX window centred around matchIdx in text.
function extractSnippet(text, matchIdx, matchLen) {
  const half  = Math.floor((SNIPPET_MAX - matchLen) / 2);
  const start = Math.max(0, matchIdx - half);
  const end   = Math.min(text.length, start + SNIPPET_MAX);
  let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0)              snippet = '…' + snippet;
  if (end < text.length)      snippet = snippet + '…';
  return snippet.slice(0, SNIPPET_MAX);
}

// ---------------------------------------------------------------------------
// HTTP fetch with redirect-follow, timeout, and retry
// ---------------------------------------------------------------------------

async function fetchUrl(url, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const resp = await fetch(url, {
      signal:   controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':      USER_AGENT,
        'Accept':          'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control':   'no-cache',
      },
    });
    clearTimeout(timer);

    // Retry on 429 (rate limit) or 5xx (transient server errors)
    if ((resp.status === 429 || resp.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = parseInt(resp.headers.get('retry-after') || '0', 10);
      const delay = retryAfter > 0 ? retryAfter * 1000 : RETRY_DELAY * (attempt + 1);
      warn(`HTTP ${resp.status} on ${url}; retrying in ${delay} ms (attempt ${attempt + 1})`);
      await sleep(delay);
      return fetchUrl(url, attempt + 1);
    }

    return { ok: true, resp };
  } catch (err) {
    clearTimeout(timer);
    if (attempt < MAX_RETRIES) {
      warn(`Fetch error on ${url}: ${err.message}; retrying (attempt ${attempt + 1})`);
      await sleep(RETRY_DELAY * (attempt + 1));
      return fetchUrl(url, attempt + 1);
    }
    return { ok: false, err };
  }
}

// ---------------------------------------------------------------------------
// HTML → text extraction
// Returns { pageTitle, metaDesc, bodyText } — no raw HTML stored
// ---------------------------------------------------------------------------

function extractPageText(html) {
  // <title>
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = titleM
    ? titleM[1].replace(/\s+/g, ' ').trim().slice(0, 300)
    : '';

  // <meta name="description" content="...">  (two attribute orderings)
  const metaM =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,500})["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']{0,500})["'][^>]+name=["']description["']/i);
  const metaDesc = metaM ? metaM[1].replace(/\s+/g, ' ').trim() : '';

  // Body text: strip <script>, <style>, then all tags
  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, BODY_READ_LIMIT);

  return { pageTitle, metaDesc, bodyText };
}

// ---------------------------------------------------------------------------
// Verification status enum
//
//   verified_content_match         title or author found in fetched HTML body/meta
//   verified_reading_list_match    readable personal/official reading list, title found
//   needs_manual_review_url_slug_only  JS-rendered page; URL slug matches but body not inspectable
//   needs_manual_review_non_html   PDF or other non-HTML content
//   needs_manual_review_no_match   reachable page but title/author not found in content
//   failed                         HTTP 4xx/5xx, timeout, or dead URL
//
// Recommended action mapping:
//   verified_content_match           → eligible_for_manual_import
//   verified_reading_list_match      → manual_review
//   needs_manual_review_*            → manual_review
//   failed                           → hold
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Evidence search
// Returns { matched: 'title'|'normalized_title'|'author'|'meta'|'url_slug'|'none', snippet }
//
// url_slug: for JS-rendered sites (e.g. gatesnotes.com) whose initial HTML
//   is a client-side shell with no readable content.  The URL path slug is
//   a deliberate, human-chosen identifier for the page — a match against the
//   normalized book title is collected as evidence, but is NOT sufficient for
//   a 'verified' status.  These rows go to needs_manual_review_url_slug_only.
// ---------------------------------------------------------------------------

function findEvidence(pageTitle, metaDesc, bodyText, bookTitle, bookAuthor, sourceUrl) {
  const fullText     = `${pageTitle} ${metaDesc} ${bodyText}`;
  const normTitle    = norm(bookTitle);
  const normAuthor   = norm(bookAuthor);
  const normFullText = norm(fullText);
  const normMeta     = norm(`${pageTitle} ${metaDesc}`);

  // 1. Exact title (case-insensitive)
  if (bookTitle.length >= 3) {
    const re = new RegExp(escapeRegex(bookTitle), 'i');
    const m  = fullText.match(re);
    if (m) {
      return {
        matched: 'title',
        snippet: extractSnippet(fullText, m.index, bookTitle.length),
      };
    }
  }

  // 2. Normalized title in normalized full text
  if (normTitle.length >= 5) {
    const idx = normFullText.indexOf(normTitle);
    if (idx !== -1) {
      // Approximate original position (character density is similar after norm)
      const approxIdx = Math.round(idx * fullText.length / normFullText.length);
      return {
        matched: 'normalized_title',
        snippet: extractSnippet(fullText, approxIdx, bookTitle.length),
      };
    }
  }

  // 3. Author name (case-insensitive)
  if (bookAuthor && bookAuthor.length >= 3) {
    const re = new RegExp(escapeRegex(bookAuthor), 'i');
    const m  = fullText.match(re);
    if (m) {
      return {
        matched: 'author',
        snippet: extractSnippet(fullText, m.index, bookAuthor.length),
      };
    }
  }

  // 4. Normalized title in meta/title tag only (weaker signal, still counts)
  if (normTitle.length >= 5 && normMeta.includes(normTitle)) {
    return {
      matched: 'meta',
      snippet: `${pageTitle} — ${metaDesc}`.slice(0, SNIPPET_MAX),
    };
  }

  // 5. URL slug matches book title (for JS-rendered sites like gatesnotes.com
  //    that return a client-side shell with empty pageProps).
  //    The URL path is a deliberate human-readable identifier; matching it
  //    against the normalized title is legitimate contextual evidence.
  if (sourceUrl && normTitle.length >= 5) {
    try {
      const urlPath = new URL(sourceUrl).pathname;
      // Normalize path: remove slashes, replace hyphens with spaces
      const normPath = norm(urlPath.replace(/\//g, ' ').replace(/-/g, ' '));
      if (normPath.includes(normTitle)) {
        return {
          matched: 'url_slug',
          snippet: urlPath.slice(0, SNIPPET_MAX),
        };
      }
    } catch { /* invalid URL — skip */ }
  }

  return { matched: 'none', snippet: '' };
}

// ---------------------------------------------------------------------------
// Build output row
// ---------------------------------------------------------------------------

function buildRow(raw, httpStatus, contentType, verificationStatus,
                  matchedEvidence, evidenceSnippet, reviewRequired,
                  verificationReason, recommendedAction) {
  return {
    person_name:              raw.person_name,
    book_title:               raw.book_title,
    book_author:              raw.book_author,
    bookmentions_person_id:   raw.bookmentions_person_id   || null,
    bookmentions_book_id:     raw.bookmentions_book_id     || null,
    original_source_url:      raw.original_source_url,
    original_source_host:     raw.original_source_host,
    http_status:              httpStatus,
    content_type:             contentType,
    verification_status:      verificationStatus,
    matched_evidence:         matchedEvidence,
    evidence_snippet:         evidenceSnippet,
    review_required:          reviewRequired,
    verification_reason:      verificationReason,
    recommended_action:       recommendedAction,
  };
}

// ---------------------------------------------------------------------------
// Verify one row
// ---------------------------------------------------------------------------

async function verifyRow(raw) {
  const url           = raw.original_source_url;
  const bookTitle     = raw.book_title   || '';
  const bookAuthor    = raw.book_author  || '';
  const isReadingList = raw.source_type === 'personal_reading_list';

  log(`  Fetching: ${url}`);

  const { ok, resp, err } = await fetchUrl(url);

  // --- Network / timeout failure ---
  if (!ok) {
    const reason = err?.name === 'AbortError' ? 'timeout' : `network_error:${err?.message?.slice(0, 80)}`;
    return buildRow(raw, null, null, 'failed', 'none', '', true, reason, 'hold');
  }

  const httpStatus  = resp.status;
  const rawCT       = resp.headers.get('content-type') || '';
  const contentType = rawCT.split(';')[0].trim().toLowerCase();

  // --- HTTP error ---
  if (httpStatus >= 400) {
    const reason = httpStatus === 403 ? 'http_403_forbidden'
                 : httpStatus === 404 ? 'http_404_not_found'
                 : `http_${httpStatus}`;
    return buildRow(raw, httpStatus, contentType, 'failed', 'none', '', true, reason, 'hold');
  }

  // --- Non-HTML content (PDF, etc.) ---
  const isPdf  = contentType === 'application/pdf' || url.toLowerCase().endsWith('.pdf');
  const isHtml = contentType.startsWith('text/html') || contentType.startsWith('application/xhtml');

  if (isPdf || !isHtml) {
    const reason = isPdf ? 'pdf_source_not_inspectable' : `non_html_content:${contentType}`;
    return buildRow(raw, httpStatus, contentType, 'needs_manual_review_non_html',
      'none', '', true, reason, 'manual_review');
  }

  // --- Read and parse HTML body ---
  let html;
  try {
    html = await resp.text();
  } catch (readErr) {
    return buildRow(raw, httpStatus, contentType, 'failed', 'none', '',
      true, `body_read_error:${readErr.message?.slice(0, 80)}`, 'hold');
  }

  const { pageTitle, metaDesc, bodyText } = extractPageText(html);
  const evidence = findEvidence(pageTitle, metaDesc, bodyText, bookTitle, bookAuthor, url);

  // --- URL slug only (JS-rendered shell, no readable body content) ---
  if (evidence.matched === 'url_slug') {
    return buildRow(raw, httpStatus, contentType,
      'needs_manual_review_url_slug_only',
      'url_slug', evidence.snippet,
      true, 'js_rendered_page_url_slug_match_only', 'manual_review');
  }

  // --- Content match found ---
  if (evidence.matched !== 'none') {
    if (isReadingList) {
      // Reading-list page: title found but multiple books on one URL — flag for human
      return buildRow(raw, httpStatus, contentType,
        'verified_reading_list_match',
        evidence.matched, evidence.snippet,
        true, 'reading_list_page_verify_single_attribution', 'manual_review');
    }
    // Standard article/page with title or author found in content
    return buildRow(raw, httpStatus, contentType,
      'verified_content_match',
      evidence.matched, evidence.snippet,
      raw.review_required, null, 'eligible_for_manual_import');
  }

  // --- Reachable but no evidence found in content ---
  return buildRow(raw, httpStatus, contentType,
    'needs_manual_review_no_match',
    'none', '', raw.review_required,
    'title_and_author_not_found_in_page', 'manual_review');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log('=== BookMentions Tier A Source Verifier — Phase 5 ===');
  log('Sequential fetch only. No DB writes. Output: scratch/*.json');
  log('');

  if (!fs.existsSync(IN_TIER_A)) {
    throw new Error(`Tier A queue not found: ${IN_TIER_A}\nRun build_mrb_review_queue.js first.`);
  }

  const rows = JSON.parse(fs.readFileSync(IN_TIER_A, 'utf-8'));
  log(`Loaded ${rows.length} Tier A rows`);
  log(`Estimated time: ~${Math.ceil(rows.length * (BETWEEN_DELAY + 5000) / 60000)} min`);
  log('');

  // verified_* statuses go to OUT_VERIFIED; everything else to OUT_FAILED
  const VERIFIED_STATUSES = new Set(['verified_content_match', 'verified_reading_list_match']);

  const verified = [];
  const failed   = [];  // needs_manual_review_* + failed

  const httpStatusCounts     = {};
  const hostCounts           = {};
  const verificationStatusCounts = {};

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    log(`[${i + 1}/${rows.length}] ${raw.person_name} — "${raw.book_title}"`);

    const result = await verifyRow(raw);

    bump(httpStatusCounts,         String(result.http_status ?? 'null'));
    bump(hostCounts,               result.original_source_host || 'null');
    bump(verificationStatusCounts, result.verification_status);

    if (VERIFIED_STATUSES.has(result.verification_status)) {
      verified.push(result);
      log(`    → ${result.verification_status.toUpperCase().padEnd(28)} [${result.matched_evidence}] ${result.evidence_snippet.slice(0, 60)}`);
    } else {
      failed.push(result);
      log(`    → ${result.verification_status.toUpperCase().padEnd(28)} ${result.verification_reason || ''}`);
    }

    // Mandatory delay between requests (except after last)
    if (i < rows.length - 1) await sleep(BETWEEN_DELAY);
  }

  // Write outputs
  log('\n[Writing output files]');
  fs.writeFileSync(OUT_VERIFIED, JSON.stringify(verified, null, 2), 'utf-8');
  fs.writeFileSync(OUT_FAILED,   JSON.stringify(failed,   null, 2), 'utf-8');
  log(`Wrote ${verified.length} verified    → ${OUT_VERIFIED}`);
  log(`Wrote ${failed.length}  not-verified → ${OUT_FAILED}`);

  const report = {
    generated_at:   new Date().toISOString(),
    input_rows:     rows.length,

    // Top-level summary
    verified_content_match_count:          verificationStatusCounts['verified_content_match']          || 0,
    verified_reading_list_match_count:     verificationStatusCounts['verified_reading_list_match']     || 0,
    needs_manual_review_url_slug_count:    verificationStatusCounts['needs_manual_review_url_slug_only'] || 0,
    needs_manual_review_non_html_count:    verificationStatusCounts['needs_manual_review_non_html']    || 0,
    needs_manual_review_no_match_count:    verificationStatusCounts['needs_manual_review_no_match']    || 0,
    failed_count:                          verificationStatusCounts['failed']                          || 0,

    // Detail
    verification_status_counts: verificationStatusCounts,
    http_status_counts:         httpStatusCounts,
    host_counts:                hostCounts,
    no_db_writes:               true,
  };

  fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2), 'utf-8');
  log(`Wrote report         → ${OUT_REPORT}`);

  log('\n=== Verification complete ===');
  log(`Input:                         ${rows.length}`);
  log(`verified_content_match:        ${report.verified_content_match_count}`);
  log(`verified_reading_list_match:   ${report.verified_reading_list_match_count}`);
  log(`needs_manual_review_url_slug:  ${report.needs_manual_review_url_slug_count}`);
  log(`needs_manual_review_non_html:  ${report.needs_manual_review_non_html_count}`);
  log(`needs_manual_review_no_match:  ${report.needs_manual_review_no_match_count}`);
  log(`failed:                        ${report.failed_count}`);
  log('');
  log('HTTP status counts:');
  for (const [s, c] of Object.entries(httpStatusCounts).sort((a,b)=>b[1]-a[1])) {
    log(`  ${String(c).padStart(4)}  HTTP ${s}`);
  }
  log('\nNO DB WRITES PERFORMED. Ready for human review.');
}

main().catch(err => {
  console.error('[mrb-verify] FATAL:', err);
  process.exit(1);
});
