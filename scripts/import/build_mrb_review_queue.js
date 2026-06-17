#!/usr/bin/env node
/**
 * build_mrb_review_queue.js
 * Phase 4 — Build Tiered MRB Review Queues
 *
 * PURPOSE:
 *   Read Phase 3 match output from scratch/mrb_matched_candidates.json and
 *   scratch/mrb_unmatched_candidates.json, then sort each row into one of
 *   three human-review tiers (A / B / HOLD).  Write four review-only JSON
 *   files to scratch/.  No Supabase access.  No DB writes of any kind.
 *
 * SAFETY RULES:
 *   - No Supabase client, no createClient, no DB calls.
 *   - No insert, update, delete, upsert, rpc, or mutation of any kind.
 *   - No service role key, no DATABASE_URL.
 *   - Input:  scratch/mrb_matched_candidates.json
 *             scratch/mrb_unmatched_candidates.json
 *   - Output: scratch/mrb_review_queue_tier_a.json   (safest)
 *             scratch/mrb_review_queue_tier_b.json   (manual review)
 *             scratch/mrb_review_queue_hold.json     (not ready)
 *             scratch/mrb_review_queue_report.json   (summary)
 *
 * TIER DEFINITIONS:
 *
 *   Tier A — safest:
 *     - eligible_for_review_import: true
 *     - person_match_status IN (exact_slug, exact_name, normalized_name)
 *     - book_match_status   IN (exact_title_author, normalized_title_author)
 *     - confidence: high
 *     - source_type NOT IN (social_post, video, multi_book_source, unknown)
 *     - original_source_host NOT in SOCIAL_HOSTS
 *     - multi_book_source_count null / missing / <= 1
 *     - review_required false  OR  review_reason is low-risk only
 *     - no pipe chars in key fields
 *     - recommended_action: manual_verify_then_import
 *
 *   Tier B — manual review:
 *     - eligible_for_review_import: true
 *     - person_match_status IN STRONG_PERSON_STATUSES
 *     - book_match_status   IN STRONG_BOOK_STATUSES (allows title_author_surname)
 *     - but has one or more review flags
 *     - recommended_action: review_source_context
 *
 *   Hold:
 *     - everything else (not eligible, fuzzy, unmatched, ambiguous,
 *       low confidence, blocked host, pipe field, missing source URL)
 *     - recommended_action: hold
 *
 * NO COMMIT. For human review only.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

const REPO_ROOT     = path.resolve(__dirname, '../../');
const SCRATCH_DIR   = path.join(REPO_ROOT, 'scratch');

const IN_MATCHED    = path.join(SCRATCH_DIR, 'mrb_matched_candidates.json');
const IN_UNMATCHED  = path.join(SCRATCH_DIR, 'mrb_unmatched_candidates.json');
const OUT_TIER_A    = path.join(SCRATCH_DIR, 'mrb_review_queue_tier_a.json');
const OUT_TIER_B    = path.join(SCRATCH_DIR, 'mrb_review_queue_tier_b.json');
const OUT_HOLD      = path.join(SCRATCH_DIR, 'mrb_review_queue_hold.json');
const OUT_REPORT    = path.join(SCRATCH_DIR, 'mrb_review_queue_report.json');

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg)  { console.log(`[mrb-queue] ${msg}`); }

// ---------------------------------------------------------------------------
// Classification constants
// ---------------------------------------------------------------------------

const STRONG_PERSON_STATUSES = new Set(['exact_slug', 'exact_name', 'normalized_name']);

// Book statuses accepted for Tier A (strictest)
const TIER_A_BOOK_STATUSES   = new Set(['exact_title_author', 'normalized_title_author']);

// Book statuses accepted for Tier B (allows title_author_surname + fuzzy only
// if eligible — but fuzzy is ineligible, so effectively up to title_author_surname)
const STRONG_BOOK_STATUSES   = new Set(['exact_title_author', 'normalized_title_author', 'title_author_surname']);

// Source types that push a row to Tier B or Hold regardless of other signals
const SOCIAL_VIDEO_SOURCE_TYPES = new Set(['social_post', 'video', 'multi_book_source', 'unknown']);

// Social / low-verifiability hosts
const SOCIAL_HOSTS = new Set([
  'x.com', 'twitter.com',
  'facebook.com', 'fb.com',
  'youtube.com', 'youtu.be',
  'instagram.com',
  'vimeo.com',
  'tiktok.com',
  'linkedin.com',
]);

// Review reasons that are considered low-risk (do not block Tier A on their own)
// A review_reason is low-risk if it contains NONE of these high-risk markers.
const HIGH_RISK_REASON_MARKERS = [
  'x.com',
  'twitter',
  'facebook',
  'youtube',
  'youtu.be',
  'instagram',
  'vimeo',
  'tiktok',
  'multi-book source',
  'multi_book_source',
  'timestamp verification',
  'manual source verification',
  'low verifiability',
];

function isHighRiskReviewReason(reason) {
  if (!reason) return false;
  const lower = reason.toLowerCase();
  return HIGH_RISK_REASON_MARKERS.some(m => lower.includes(m));
}

// ---------------------------------------------------------------------------
// Pipe-field guard
// ---------------------------------------------------------------------------

const PIPE_CHECK_FIELDS = [
  'book_title', 'book_author', 'original_source_url', 'source_anchor_text',
];

function hasPipeField(row) {
  return PIPE_CHECK_FIELDS.some(f => row[f] && String(row[f]).includes('|'));
}

// ---------------------------------------------------------------------------
// Counter helpers
// ---------------------------------------------------------------------------

function bump(obj, key) { obj[key] = (obj[key] || 0) + 1; }

function topN(obj, n = 15) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => ({ name: k, count: v }));
}

// ---------------------------------------------------------------------------
// Reason canonicalization
// Normalizes Phase 3 ineligible_reason parts to the compact form used here,
// then deduplicates against an existing set of already-added reason strings.
// ---------------------------------------------------------------------------

const REASON_CANON = {
  // Phase 3 stores "book_match_status:X" / "person_match_status:X";
  // Phase 4 uses the shorter "book_match:X" / "person_match:X".
  'book_match_status:unmatched':   'book_match:unmatched',
  'book_match_status:fuzzy':       'book_match:fuzzy',
  'book_match_status:ambiguous':   'book_match:ambiguous',
  'person_match_status:unmatched': 'person_match:unmatched',
  'person_match_status:ambiguous': 'person_match:ambiguous',
};

function canonReason(part) {
  return REASON_CANON[part.trim()] ?? part.trim();
}

// Parse raw.ineligible_reason ("; "-separated), canonicalize each part,
// and return only parts not already present in the `seen` Set.
function ineligibleParts(raw, seen) {
  if (!raw.ineligible_reason) return [];
  return raw.ineligible_reason
    .split('; ')
    .map(canonReason)
    .filter(p => p && !seen.has(p));
}

// ---------------------------------------------------------------------------
// Build output row
// ---------------------------------------------------------------------------

function buildRow(raw, tier, tierReason, recommendedAction) {
  return {
    tier,
    tier_reason:              tierReason,
    source:                   raw.source,
    person_name:              raw.person_name,
    person_slug:              raw.person_slug,
    book_title:               raw.book_title,
    book_author:              raw.book_author,
    bookmentions_person_id:   raw.bookmentions_person_id   || null,
    bookmentions_person_slug: raw.bookmentions_person_slug || null,
    bookmentions_book_id:     raw.bookmentions_book_id     || null,
    bookmentions_book_slug:   raw.bookmentions_book_slug   || null,
    original_source_url:      raw.original_source_url      || null,
    original_source_host:     raw.original_source_host     || null,
    source_type:              raw.source_type,
    confidence:               raw.confidence,
    review_required:          raw.review_required,
    review_reason:            raw.review_reason            || null,
    multi_book_source_count:  raw.multi_book_source_count  ?? null,
    person_match_status:      raw.person_match_status,
    book_match_status:        raw.book_match_status,
    eligible_for_review_import: raw.eligible_for_review_import,
    recommended_action:       recommendedAction,
  };
}

// ---------------------------------------------------------------------------
// Tier classification
// ---------------------------------------------------------------------------

function classify(raw) {
  // --- prerequisite checks (common to A and B) ---
  const eligible       = raw.eligible_for_review_import === true;
  const strongPerson   = STRONG_PERSON_STATUSES.has(raw.person_match_status);
  const tierABook      = TIER_A_BOOK_STATUSES.has(raw.book_match_status);
  const strongBook     = STRONG_BOOK_STATUSES.has(raw.book_match_status);
  const highConf       = raw.confidence === 'high';
  const medConf        = raw.confidence === 'medium';
  const isSocialType   = SOCIAL_VIDEO_SOURCE_TYPES.has(raw.source_type);
  const isSocialHost   = SOCIAL_HOSTS.has(raw.original_source_host || '');
  const mbsc           = raw.multi_book_source_count;
  const mbscHigh       = mbsc != null && mbsc >= 2;
  const hasPipe        = hasPipeField(raw);
  const rrTrue         = raw.review_required === true;
  const highRiskReason = isHighRiskReviewReason(raw.review_reason);

  // --- HOLD: not eligible or fundamental quality issues ---
  if (!eligible) {
    const seen = new Set();
    const reasons = [];
    const add = r => { if (!seen.has(r)) { seen.add(r); reasons.push(r); } };
    if (!strongPerson) add(`person_match:${raw.person_match_status}`);
    if (!strongBook)   add(`book_match:${raw.book_match_status}`);
    // Merge Phase 3 ineligible_reason parts (canonicalized, deduplicated)
    for (const p of ineligibleParts(raw, seen)) add(p);
    if (reasons.length === 0) add('not_eligible');
    return buildRow(raw, 'HOLD', reasons.join('; '), 'hold');
  }
  if (hasPipe) {
    return buildRow(raw, 'HOLD', 'pipe_character_in_field', 'hold');
  }
  if (!raw.original_source_url) {
    return buildRow(raw, 'HOLD', 'missing_original_source_url', 'hold');
  }

  // --- TIER A: all conditions strictly satisfied ---
  if (
    strongPerson &&
    tierABook &&
    highConf &&
    !isSocialType &&
    !isSocialHost &&
    !mbscHigh &&
    !hasPipe &&
    (!rrTrue || !highRiskReason)
  ) {
    const reasons = ['strong_person_book_match', `source_type:${raw.source_type}`];
    if (!rrTrue) reasons.push('review_not_required');
    return buildRow(raw, 'A', reasons.join('; '), 'manual_verify_then_import');
  }

  // --- TIER B: eligible + strong matches + has review flags ---
  if (eligible && strongPerson && strongBook) {
    const flags = [];
    if (!tierABook)      flags.push(`book_match:${raw.book_match_status}`);
    if (!highConf)       flags.push(`confidence:${raw.confidence}`);
    if (isSocialType)    flags.push(`source_type:${raw.source_type}`);
    if (isSocialHost)    flags.push(`social_host:${raw.original_source_host}`);
    if (mbscHigh)        flags.push(`multi_book_source_count:${mbsc}`);
    if (rrTrue && highRiskReason) flags.push('high_risk_review_reason');
    else if (rrTrue)     flags.push('review_required');
    return buildRow(raw, 'B', flags.join('; ') || 'review_flags_present', 'review_source_context');
  }

  // --- HOLD: fallthrough ---
  const holdReasons = [];
  if (!strongPerson) holdReasons.push(`weak_person_match:${raw.person_match_status}`);
  if (!strongBook)   holdReasons.push(`weak_book_match:${raw.book_match_status}`);
  if (!eligible)     holdReasons.push('not_eligible');
  return buildRow(raw, 'HOLD', holdReasons.join('; ') || 'unclassifiable', 'hold');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log('=== BookMentions MRB Review Queue Builder — Phase 4 ===');
  log('NO Supabase access. NO DB writes. Input: scratch/ → Output: scratch/');
  log('');

  // Load inputs
  if (!fs.existsSync(IN_MATCHED)) {
    throw new Error(`Phase 3 matched output not found: ${IN_MATCHED}\nRun match_mrb_candidates_to_bookmentions.js first.`);
  }
  const matched   = JSON.parse(fs.readFileSync(IN_MATCHED,   'utf-8'));
  const unmatched = fs.existsSync(IN_UNMATCHED)
    ? JSON.parse(fs.readFileSync(IN_UNMATCHED, 'utf-8'))
    : [];

  log(`Loaded ${matched.length} matched rows, ${unmatched.length} unmatched rows`);

  // All unmatched rows go straight to HOLD
  const holdFromUnmatched = unmatched.map(raw =>
    buildRow(raw, 'HOLD', `person_match:${raw.person_match_status || 'unmatched'}`, 'hold')
  );

  // Classify matched rows
  const tierA = [];
  const tierB = [];
  const hold  = [...holdFromUnmatched];

  for (const raw of matched) {
    const row = classify(raw);
    if      (row.tier === 'A')    tierA.push(row);
    else if (row.tier === 'B')    tierB.push(row);
    else                          hold.push(row);
  }

  // --- Report accumulators ---
  function tierStats(rows) {
    const hosts   = {};
    const stypes  = {};
    const people  = {};
    const books   = {};
    const reasons = {};
    for (const r of rows) {
      bump(hosts,   r.original_source_host || 'null');
      bump(stypes,  r.source_type          || 'unknown');
      bump(people,  r.person_name          || 'unknown');
      bump(books,   r.book_title           || 'unknown');
      if (r.tier === 'HOLD' || r.tier === 'B') {
        for (const part of (r.tier_reason || '').split('; ')) bump(reasons, part);
      }
    }
    return { hosts, stypes, people, books, reasons };
  }

  const statsA    = tierStats(tierA);
  const statsB    = tierStats(tierB);
  const statsHold = tierStats(hold);

  const sourceTypeCounts = {};
  for (const tier of ['A','B','HOLD']) {
    const rows = tier === 'A' ? tierA : tier === 'B' ? tierB : hold;
    const counts = {};
    for (const r of rows) bump(counts, r.source_type || 'unknown');
    sourceTypeCounts[tier] = counts;
  }

  const report = {
    generated_at:              new Date().toISOString(),
    input_matched_rows:        matched.length,
    input_unmatched_rows:      unmatched.length,
    tier_a_count:              tierA.length,
    tier_b_count:              tierB.length,
    hold_count:                hold.length,

    tier_a_hosts:              Object.fromEntries(topN(statsA.hosts).map(x => [x.name, x.count])),
    tier_b_hosts:              Object.fromEntries(topN(statsB.hosts).map(x => [x.name, x.count])),
    hold_reasons:              Object.fromEntries(topN(statsHold.reasons, 20).map(x => [x.name, x.count])),

    source_type_counts_by_tier: sourceTypeCounts,

    top_people_by_tier: {
      A:    topN(statsA.people,   10),
      B:    topN(statsB.people,   10),
      HOLD: topN(statsHold.people, 10),
    },
    top_books_by_tier: {
      A:    topN(statsA.books,   10),
      B:    topN(statsB.books,   10),
      HOLD: topN(statsHold.books, 10),
    },

    notes: [
      'Tier A: eligible + strong person+book match + high confidence + non-social source type + low multi-book count + no high-risk review reason.',
      'Tier B: eligible + strong matches + one or more review flags (social host/type, multi-book source, medium confidence, review_required with high-risk reason).',
      'Hold: not eligible for review import, fuzzy book match, unmatched book, low confidence, or unmatched person.',
      'All outputs are read-only review files. No DB writes performed.',
      'recommended_action values: manual_verify_then_import | review_source_context | hold',
    ],
    no_db_writes: true,
  };

  // Write outputs
  log('\n[Writing output files]');
  fs.writeFileSync(OUT_TIER_A, JSON.stringify(tierA, null, 2), 'utf-8');
  fs.writeFileSync(OUT_TIER_B, JSON.stringify(tierB, null, 2), 'utf-8');
  fs.writeFileSync(OUT_HOLD,   JSON.stringify(hold,  null, 2), 'utf-8');
  fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2), 'utf-8');

  log(`Wrote ${tierA.length} Tier A rows   → ${OUT_TIER_A}`);
  log(`Wrote ${tierB.length} Tier B rows   → ${OUT_TIER_B}`);
  log(`Wrote ${hold.length}  Hold rows     → ${OUT_HOLD}`);
  log(`Wrote report           → ${OUT_REPORT}`);

  // Console summary
  log('\n=== Queue build complete ===');
  log(`Input matched:   ${matched.length}`);
  log(`Input unmatched: ${unmatched.length}`);
  log(`Tier A:          ${tierA.length}  (manual_verify_then_import)`);
  log(`Tier B:          ${tierB.length}  (review_source_context)`);
  log(`Hold:            ${hold.length}   (hold)`);
  log('');
  log('Tier A top hosts:');
  for (const [h, c] of topN(statsA.hosts, 8).map(x => [x.name, x.count])) {
    log(`  ${String(c).padStart(4)}  ${h}`);
  }
  log('Tier B top hosts:');
  for (const [h, c] of topN(statsB.hosts, 8).map(x => [x.name, x.count])) {
    log(`  ${String(c).padStart(4)}  ${h}`);
  }
  log('Top Hold reasons:');
  for (const [r, c] of topN(statsHold.reasons, 8).map(x => [x.name, x.count])) {
    log(`  ${String(c).padStart(4)}  ${r}`);
  }
  log('\nNO DB WRITES PERFORMED. Ready for human review.');
}

main().catch(err => {
  console.error('[mrb-queue] FATAL:', err);
  process.exit(1);
});
