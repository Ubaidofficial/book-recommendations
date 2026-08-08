#!/usr/bin/env node
/**
 * export_mrb_verified_review_csv.js
 * Phase 5 export — Human-Review CSV for Verified Tier A MRB Sources
 *
 * PURPOSE:
 *   Read scratch/mrb_tier_a_verified_sources.json (Phase 5 output),
 *   join back to scratch/mrb_review_queue_tier_a.json for columns not
 *   carried forward by the verifier (person_slug, bookmentions_person_slug,
 *   bookmentions_book_slug, source_type, confidence, review_reason,
 *   multi_book_source_count), then write a human-review CSV to scratch/.
 *
 * INCLUDES ONLY:
 *   verification_status = verified_content_match
 *   verification_status = verified_reading_list_match
 *
 * EXCLUDES:
 *   needs_manual_review_url_slug_only
 *   needs_manual_review_non_html
 *   needs_manual_review_no_match
 *   failed
 *
 * SAFETY RULES:
 *   - No Supabase client, no DB calls, no network requests.
 *   - No insert, update, delete, upsert, rpc, or any mutation.
 *   - No service role key, no DATABASE_URL.
 *   - Input:  scratch/mrb_tier_a_verified_sources.json
 *             scratch/mrb_review_queue_tier_a.json   (join source)
 *   - Output: scratch/mrb_tier_a_verified_sources_review.csv
 *
 * NO COMMIT. For human review only.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT    = path.resolve(__dirname, '../../');
const SCRATCH_DIR  = path.join(REPO_ROOT, 'scratch');

const IN_VERIFIED  = path.join(SCRATCH_DIR, 'mrb_tier_a_verified_sources.json');
const IN_TIER_A    = path.join(SCRATCH_DIR, 'mrb_review_queue_tier_a.json');
const OUT_CSV      = path.join(SCRATCH_DIR, 'mrb_tier_a_verified_sources_review.csv');

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

// CSV-escape a single value: quote if it contains comma, quote, or newline.
// Internal double-quotes are doubled per RFC 4180.
function csvField(val) {
  const s = val == null ? '' : String(val);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(fields) {
  return fields.map(csvField).join(',');
}

// ---------------------------------------------------------------------------
// Column order (matches task spec exactly)
// ---------------------------------------------------------------------------

const COLUMNS = [
  'review_decision',
  'review_notes',
  'verification_status',
  'recommended_action',
  'person_name',
  'person_slug',
  'book_title',
  'book_author',
  'bookmentions_person_id',
  'bookmentions_person_slug',
  'bookmentions_book_id',
  'bookmentions_book_slug',
  'original_source_host',
  'original_source_url',
  'matched_evidence',
  'evidence_snippet',
  'verification_reason',
  'source_type',
  'confidence',
  'review_required',
  'review_reason',
  'multi_book_source_count',
];

// ---------------------------------------------------------------------------
// Statuses to include
// ---------------------------------------------------------------------------

const INCLUDE_STATUSES = new Set([
  'verified_content_match',
  'verified_reading_list_match',
]);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('[mrb-csv] === MRB Verified Sources CSV Export ===');
  console.log('[mrb-csv] No network. No DB. Output: scratch/');

  // Load inputs
  if (!fs.existsSync(IN_VERIFIED)) {
    throw new Error(`Verified sources not found: ${IN_VERIFIED}\nRun verify_mrb_tier_a_sources.js first.`);
  }
  if (!fs.existsSync(IN_TIER_A)) {
    throw new Error(`Tier A queue not found: ${IN_TIER_A}\nRun build_mrb_review_queue.js first.`);
  }

  const verified = JSON.parse(fs.readFileSync(IN_VERIFIED, 'utf-8'));
  const tierA    = JSON.parse(fs.readFileSync(IN_TIER_A,   'utf-8'));

  console.log(`[mrb-csv] Loaded ${verified.length} verified rows`);
  console.log(`[mrb-csv] Loaded ${tierA.length} Tier A rows for join`);

  // Build join index: url|book_id → Tier A row
  const joinKey = r => `${r.original_source_url}|${r.bookmentions_book_id}`;
  const tierAMap = new Map(tierA.map(r => [joinKey(r), r]));

  // Filter to include-only statuses
  const rows = verified.filter(r => INCLUDE_STATUSES.has(r.verification_status));
  console.log(`[mrb-csv] Rows after status filter: ${rows.length}`);

  const lines = [csvRow(COLUMNS)];  // header

  let joinMisses = 0;
  for (const v of rows) {
    const a = tierAMap.get(joinKey(v)) || {};
    if (!tierAMap.has(joinKey(v))) joinMisses++;

    const record = {
      review_decision:          '',
      review_notes:             '',
      verification_status:      v.verification_status,
      recommended_action:       v.recommended_action,
      person_name:              v.person_name,
      person_slug:              a.person_slug               ?? '',
      book_title:               v.book_title,
      book_author:              v.book_author,
      bookmentions_person_id:   v.bookmentions_person_id    ?? '',
      bookmentions_person_slug: a.bookmentions_person_slug  ?? '',
      bookmentions_book_id:     v.bookmentions_book_id      ?? '',
      bookmentions_book_slug:   a.bookmentions_book_slug    ?? '',
      original_source_host:     v.original_source_host,
      original_source_url:      v.original_source_url,
      matched_evidence:         v.matched_evidence,
      evidence_snippet:         v.evidence_snippet          ?? '',
      verification_reason:      v.verification_reason       ?? '',
      source_type:              a.source_type               ?? '',
      confidence:               a.confidence                ?? '',
      review_required:          v.review_required,
      review_reason:            a.review_reason             ?? '',
      multi_book_source_count:  a.multi_book_source_count   ?? '',
    };

    lines.push(csvRow(COLUMNS.map(col => record[col])));
  }

  if (joinMisses > 0) {
    console.warn(`[mrb-csv] WARN: ${joinMisses} rows had no Tier A join match — extra columns will be blank`);
  }

  const csv = lines.join('\n') + '\n';
  fs.writeFileSync(OUT_CSV, csv, 'utf-8');

  console.log(`[mrb-csv] Wrote ${lines.length - 1} data rows + header → ${OUT_CSV}`);
  console.log('[mrb-csv] NO DB WRITES PERFORMED. Ready for human review.');
}

main();
