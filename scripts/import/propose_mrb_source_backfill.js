#!/usr/bin/env node
/**
 * propose_mrb_source_backfill.js
 * Phase 6 — DRY RUN ONLY: Propose source_url Backfill for Approved MRB Rows
 *
 * PURPOSE:
 *   Read scratch/mrb_tier_a_verified_sources_reviewed.csv, filter rows where
 *   review_decision === 'APPROVE', look up each row in the production
 *   book_recommendations table (READ-ONLY SELECT), and propose a source_url
 *   update. No writes are performed under any circumstances.
 *
 * SAFETY RULES — ABSOLUTE:
 *   - DRY RUN ONLY. No DB writes. No Supabase mutation of any kind.
 *   - No insert, update, delete, upsert, rpc, or any mutation method.
 *   - No service role key, no DATABASE_URL, no direct SQL.
 *   - NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY only.
 *   - Fails closed if env vars are missing.
 *   - Mutation proxy blocks at runtime before any network call.
 *   - Output goes to scratch/ only. Do not commit scratch/.
 *
 * INPUT:
 *   scratch/mrb_tier_a_verified_sources_reviewed.csv
 *     (Phase 5-decisions output — human-reviewed; 18 APPROVE, 23 HOLD, 5 REJECT)
 *
 * OUTPUTS (all in scratch/):
 *   mrb_source_backfill_apply_proposal.json — array of proposal rows
 *   mrb_source_backfill_apply_proposal.csv  — same rows as CSV
 *   mrb_source_backfill_apply_report.json   — summary counts + skip reasons
 *
 * PROPOSAL ROW SHAPE:
 *   {
 *     dry_run_only:             true,           // always
 *     bookmentions_person_id:   string,
 *     bookmentions_book_id:     string,
 *     person_name:              string,
 *     book_title:               string,
 *     book_author:              string,
 *     original_source_url:      string,         // proposed new source_url
 *     proposed_quote:           null,           // source_url-only batch
 *     current_source_url:       string|null,    // what is in the DB today
 *     db_row_count:             number,         // how many DB rows matched
 *     action:                   'propose_update' | 'skip',
 *     skip_reason:              string|null,
 *     review_decision:          'APPROVE',
 *     verification_status:      string,
 *   }
 *
 * SKIP CONDITIONS (action = 'skip'):
 *   - DB lookup returns 0 rows (not found)
 *   - DB lookup returns > 1 rows (ambiguous)
 *   - current_source_url is already safe (non-null, non-empty, not a blocked/
 *     metadata/purchase URL, no pipe character)
 *   - new_source_url has a pipe character
 *   - new_source_url host is in BLOCKED_HOSTS
 *   - new_source_url is empty/null
 *
 * USAGE:
 *   node scripts/import/propose_mrb_source_backfill.js
 *
 * NO COMMIT. DRY RUN OUTPUT ONLY.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Must be defined before resolveSupabaseCredentials() (which calls loadEnvFile())
const REPO_ROOT = path.resolve(__dirname, '../../');

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg)  { console.log(`[mrb-propose] ${msg}`); }
function warn(msg) { console.warn(`[mrb-propose] WARN: ${msg}`); }

// ---------------------------------------------------------------------------
// Supabase — READ-ONLY anon/public key ONLY
// ---------------------------------------------------------------------------

function loadEnvFile() {
  const envPath = path.join(REPO_ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('export ')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx < 1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith("'") && val.endsWith("'")) ||
        (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1);
    }
    if (key && val && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

function resolveSupabaseCredentials() {
  loadEnvFile();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ||
              process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL.\n' +
      'Add it to .env.local:\n  NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co'
    );
  }
  if (!key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_ANON_KEY.\n' +
      'Add the PUBLIC anon/publishable key (NOT the service role key) to .env.local:\n' +
      '  NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_<your-anon-key>'
    );
  }

  if (/service_role/i.test(key) || /sb_secret_/i.test(key) || /SECRET/i.test(key)) {
    throw new Error(
      'SAFETY VIOLATION: NEXT_PUBLIC_SUPABASE_ANON_KEY appears to be a service/secret key. ' +
      'Use the public anon/publishable key only. Aborting.'
    );
  }

  log(`Supabase URL loaded from env: ${url}`);
  log(`Supabase anon key loaded from env: [${key.slice(0, 12)}…] (truncated for safety)`);

  return { url, key };
}

const { url: SUPABASE_URL, key: SUPABASE_ANON_KEY } = resolveSupabaseCredentials();

function makeSafeReadOnlyClient() {
  const raw = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const BLOCKED_METHODS = ['insert', 'update', 'delete', 'upsert', 'rpc'];
  return {
    from(table) {
      const builder = raw.from(table);
      for (const method of BLOCKED_METHODS) {
        builder[method] = () => {
          throw new Error(
            `SAFETY VIOLATION: attempted DB mutation '.${method}()' on table '${table}'. ` +
            'This script is DRY RUN ONLY. Aborting.'
          );
        };
      }
      return builder;
    },
  };
}

const supabase = makeSafeReadOnlyClient();

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

const SCRATCH_DIR   = path.join(REPO_ROOT, 'scratch');
const IN_CSV        = path.join(SCRATCH_DIR, 'mrb_tier_a_verified_sources_reviewed.csv');
const OUT_JSON      = path.join(SCRATCH_DIR, 'mrb_source_backfill_apply_proposal.json');
const OUT_CSV       = path.join(SCRATCH_DIR, 'mrb_source_backfill_apply_proposal.csv');
const OUT_REPORT    = path.join(SCRATCH_DIR, 'mrb_source_backfill_apply_report.json');

// ---------------------------------------------------------------------------
// Blocked source URL hosts (from Phase 3/4 pipeline)
// ---------------------------------------------------------------------------

const BLOCKED_HOSTS = new Set([
  'amazon.com',
  'www.amazon.com',
  'goodreads.com',
  'www.goodreads.com',
  'google.com',
  'www.google.com',
  'openlibrary.org',
  'www.openlibrary.org',
  'mostrecommendedbooks.com',
  'www.mostrecommendedbooks.com',
  'cdn.mostrecommendedbooks.com',
]);

// ---------------------------------------------------------------------------
// URL safety checks
// ---------------------------------------------------------------------------

// Patterns that indicate a metadata/purchase/redirect URL — not a real source
const UNSAFE_URL_PATTERNS = [
  /[?&]tag=/i,          // Amazon affiliate
  /[?&]utm_/i,          // UTM tracking (not inherently unsafe, but skip if already present)
  /\/dp\//i,            // Amazon product
  /\/gp\/product\//i,   // Amazon product
  /goodreads\.com/i,
  /amazon\./i,
  /google\.com/i,
  /openlibrary\.org/i,
];

function getHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isBlockedHost(url) {
  const host = getHostname(url);
  if (!host) return false;
  // Check exact match or subdomain match against blocked hosts
  for (const blocked of BLOCKED_HOSTS) {
    if (host === blocked || host.endsWith('.' + blocked)) return true;
  }
  return false;
}

function hasPipe(s) {
  return typeof s === 'string' && s.includes('|');
}

// A source_url is considered "already safe" (skip: don't overwrite) if it is:
//   - non-null, non-empty
//   - not a pipe-polluted value
//   - not a blocked host
//   - not matching unsafe patterns
function isAlreadySafeSourceUrl(url) {
  if (!url || url.trim() === '') return false;
  if (hasPipe(url)) return false;
  if (isBlockedHost(url)) return false;
  for (const pat of UNSAFE_URL_PATTERNS) {
    if (pat.test(url)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// CSV parser — RFC 4180 quoted-field
// ---------------------------------------------------------------------------

function parseCSVLine(line) {
  const fields = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) { fields.push(''); break; }
    if (line[i] === '"') {
      // Quoted field
      let val = '';
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            val += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          val += line[i];
          i++;
        }
      }
      fields.push(val);
      if (i < line.length && line[i] === ',') i++;
    } else {
      // Unquoted field
      const end = line.indexOf(',', i);
      if (end === -1) {
        fields.push(line.slice(i));
        break;
      } else {
        fields.push(line.slice(i, end));
        i = end + 1;
      }
    }
  }
  return fields;
}

function parseCSV(content) {
  const rawLines = content.split('\n');
  const nonEmpty = rawLines.filter(l => l.trim() !== '');
  if (nonEmpty.length < 2) return [];

  const headers = parseCSVLine(nonEmpty[0]);
  const rows = [];

  for (let i = 1; i < nonEmpty.length; i++) {
    const fields = parseCSVLine(nonEmpty[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = fields[j] ?? '';
    }
    rows.push(row);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// CSV output helpers
// ---------------------------------------------------------------------------

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

const PROPOSAL_COLUMNS = [
  'dry_run_only',
  'action',
  'skip_reason',
  'bookmentions_person_id',
  'bookmentions_book_id',
  'person_name',
  'book_title',
  'book_author',
  'original_source_url',
  'current_source_url',
  'proposed_quote',
  'db_row_count',
  'review_decision',
  'verification_status',
];

// ---------------------------------------------------------------------------
// DB lookup — SELECT only
// ---------------------------------------------------------------------------

async function lookupRecommendation(personId, bookId) {
  const { data, error } = await supabase
    .from('book_recommendations')
    .select('id, person_id, book_id, source_url')
    .eq('person_id', personId)
    .eq('book_id', bookId);

  if (error) {
    throw new Error(
      `book_recommendations SELECT failed (person=${personId}, book=${bookId}): ` +
      JSON.stringify(error)
    );
  }

  return data || [];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log('=== MRB Source Backfill Proposal — DRY RUN ONLY ===');
  log('NO DB WRITES WILL BE PERFORMED.');
  log(`Input: ${IN_CSV}`);

  if (!fs.existsSync(IN_CSV)) {
    throw new Error(
      `Reviewed CSV not found: ${IN_CSV}\n` +
      'Run the review decision apply step first.'
    );
  }

  const csvContent = fs.readFileSync(IN_CSV, 'utf-8');
  const allRows = parseCSV(csvContent);
  log(`Parsed ${allRows.length} rows from reviewed CSV`);

  const approvedRows = allRows.filter(r => r.review_decision === 'APPROVE');
  log(`Rows with review_decision=APPROVE: ${approvedRows.length}`);

  if (approvedRows.length !== 18) {
    warn(`Expected 18 APPROVE rows, got ${approvedRows.length}. Continuing anyway.`);
  }

  const proposals = [];
  const skipReasons = {};

  for (const row of approvedRows) {
    const personId  = row.bookmentions_person_id;
    const bookId    = row.bookmentions_book_id;
    const newUrl    = row.original_source_url;
    const personName = row.person_name;
    const bookTitle  = row.book_title;
    const bookAuthor = row.book_author;

    log(`Processing: ${personName} / "${bookTitle}"`);

    // --- Pre-flight checks on the proposed URL ---

    if (!newUrl || newUrl.trim() === '') {
      const reason = 'skip:new_url_empty';
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
      proposals.push({
        dry_run_only:           true,
        bookmentions_person_id: personId,
        bookmentions_book_id:   bookId,
        person_name:            personName,
        book_title:             bookTitle,
        book_author:            bookAuthor,
        original_source_url:    newUrl,
        proposed_quote:         null,
        current_source_url:     null,
        db_row_count:           null,
        action:                 'skip',
        skip_reason:            reason,
        review_decision:        row.review_decision,
        verification_status:    row.verification_status,
      });
      continue;
    }

    if (hasPipe(newUrl)) {
      const reason = 'skip:new_url_has_pipe';
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
      proposals.push({
        dry_run_only:           true,
        bookmentions_person_id: personId,
        bookmentions_book_id:   bookId,
        person_name:            personName,
        book_title:             bookTitle,
        book_author:            bookAuthor,
        original_source_url:    newUrl,
        proposed_quote:         null,
        current_source_url:     null,
        db_row_count:           null,
        action:                 'skip',
        skip_reason:            reason,
        review_decision:        row.review_decision,
        verification_status:    row.verification_status,
      });
      continue;
    }

    if (isBlockedHost(newUrl)) {
      const reason = 'skip:new_url_blocked_host';
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
      proposals.push({
        dry_run_only:           true,
        bookmentions_person_id: personId,
        bookmentions_book_id:   bookId,
        person_name:            personName,
        book_title:             bookTitle,
        book_author:            bookAuthor,
        original_source_url:    newUrl,
        proposed_quote:         null,
        current_source_url:     null,
        db_row_count:           null,
        action:                 'skip',
        skip_reason:            reason,
        review_decision:        row.review_decision,
        verification_status:    row.verification_status,
      });
      continue;
    }

    // --- DB lookup ---

    let dbRows;
    try {
      dbRows = await lookupRecommendation(personId, bookId);
    } catch (err) {
      warn(`DB lookup error for ${personName} / "${bookTitle}": ${err.message}`);
      const reason = 'skip:db_lookup_error';
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
      proposals.push({
        dry_run_only:           true,
        bookmentions_person_id: personId,
        bookmentions_book_id:   bookId,
        person_name:            personName,
        book_title:             bookTitle,
        book_author:            bookAuthor,
        original_source_url:    newUrl,
        proposed_quote:         null,
        current_source_url:     null,
        db_row_count:           null,
        action:                 'skip',
        skip_reason:            reason,
        review_decision:        row.review_decision,
        verification_status:    row.verification_status,
      });
      continue;
    }

    const dbRowCount = dbRows.length;

    if (dbRowCount === 0) {
      const reason = 'skip:not_found_in_db';
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
      proposals.push({
        dry_run_only:           true,
        bookmentions_person_id: personId,
        bookmentions_book_id:   bookId,
        person_name:            personName,
        book_title:             bookTitle,
        book_author:            bookAuthor,
        original_source_url:    newUrl,
        proposed_quote:         null,
        current_source_url:     null,
        db_row_count:           0,
        action:                 'skip',
        skip_reason:            reason,
        review_decision:        row.review_decision,
        verification_status:    row.verification_status,
      });
      continue;
    }

    if (dbRowCount > 1) {
      const reason = 'skip:multiple_db_rows';
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
      proposals.push({
        dry_run_only:           true,
        bookmentions_person_id: personId,
        bookmentions_book_id:   bookId,
        person_name:            personName,
        book_title:             bookTitle,
        book_author:            bookAuthor,
        original_source_url:    newUrl,
        proposed_quote:         null,
        current_source_url:     dbRows.map(r => r.source_url).join(' | '),
        db_row_count:           dbRowCount,
        action:                 'skip',
        skip_reason:            reason,
        review_decision:        row.review_decision,
        verification_status:    row.verification_status,
      });
      continue;
    }

    // Exactly one DB row
    const dbRow = dbRows[0];
    const currentSourceUrl = dbRow.source_url || null;

    if (isAlreadySafeSourceUrl(currentSourceUrl)) {
      const reason = 'skip:current_source_url_already_safe';
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
      proposals.push({
        dry_run_only:           true,
        bookmentions_person_id: personId,
        bookmentions_book_id:   bookId,
        person_name:            personName,
        book_title:             bookTitle,
        book_author:            bookAuthor,
        original_source_url:    newUrl,
        proposed_quote:         null,
        current_source_url:     currentSourceUrl,
        db_row_count:           1,
        action:                 'skip',
        skip_reason:            reason,
        review_decision:        row.review_decision,
        verification_status:    row.verification_status,
      });
      continue;
    }

    // All checks passed — propose the update
    proposals.push({
      dry_run_only:           true,
      bookmentions_person_id: personId,
      bookmentions_book_id:   bookId,
      person_name:            personName,
      book_title:             bookTitle,
      book_author:            bookAuthor,
      original_source_url:    newUrl,
      proposed_quote:         null,
      current_source_url:     currentSourceUrl,
      db_row_count:           1,
      action:                 'propose_update',
      skip_reason:            null,
      review_decision:        row.review_decision,
      verification_status:    row.verification_status,
    });

    log(`  → propose_update: current="${currentSourceUrl}" → new="${newUrl}"`);
  }

  // ---------------------------------------------------------------------------
  // Write outputs
  // ---------------------------------------------------------------------------

  const proposedUpdates = proposals.filter(p => p.action === 'propose_update');
  const skipped         = proposals.filter(p => p.action === 'skip');

  // JSON
  fs.writeFileSync(OUT_JSON, JSON.stringify(proposals, null, 2), 'utf-8');
  log(`Wrote proposal JSON (${proposals.length} rows) → ${OUT_JSON}`);

  // CSV
  const csvLines = [csvRow(PROPOSAL_COLUMNS)];
  for (const p of proposals) {
    csvLines.push(csvRow(PROPOSAL_COLUMNS.map(col => p[col])));
  }
  fs.writeFileSync(OUT_CSV, csvLines.join('\n') + '\n', 'utf-8');
  log(`Wrote proposal CSV (${proposals.length} data rows) → ${OUT_CSV}`);

  // Report
  const report = {
    dry_run_only:       true,
    generated_at_utc:   new Date().toISOString(),
    input_file:         IN_CSV,
    total_approved_rows: approvedRows.length,
    total_proposals:    proposals.length,
    proposed_updates:   proposedUpdates.length,
    skipped:            skipped.length,
    skip_reason_counts: skipReasons,
    proposed_update_rows: proposedUpdates.map(p => ({
      person_name:            p.person_name,
      book_title:             p.book_title,
      bookmentions_person_id: p.bookmentions_person_id,
      bookmentions_book_id:   p.bookmentions_book_id,
      current_source_url:     p.current_source_url,
      proposed_source_url:    p.original_source_url,
      verification_status:    p.verification_status,
    })),
    notes: [
      'DRY RUN ONLY — no DB writes performed.',
      'proposed_update rows require a separate apply step with explicit confirmation.',
      'proposed_quote is null for all rows (source_url-only batch).',
    ],
  };

  fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2), 'utf-8');
  log(`Wrote report JSON → ${OUT_REPORT}`);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  log('');
  log('=== PROPOSAL SUMMARY (DRY RUN) ===');
  log(`  APPROVE rows processed : ${approvedRows.length}`);
  log(`  propose_update         : ${proposedUpdates.length}`);
  log(`  skipped                : ${skipped.length}`);
  if (Object.keys(skipReasons).length > 0) {
    log('  Skip reason breakdown:');
    for (const [reason, count] of Object.entries(skipReasons)) {
      log(`    ${reason}: ${count}`);
    }
  }
  log('');
  log('NO DB WRITES PERFORMED. This is a dry run only.');
  log(`Review proposal at: ${OUT_JSON}`);
}

main().catch(err => {
  console.error(`[mrb-propose] FATAL: ${err.message}`);
  process.exit(1);
});
