#!/usr/bin/env node
/**
 * publish_indexable_content.js
 * Bulk-update index_status to 'published' for books and people that
 * meet quality thresholds, making them eligible for Google indexing.
 *
 * ⚠️  NOT the daily-cadence tool. This promotes every eligible row in one
 * shot, with no tiering (pillar/cluster pages are not prioritized over
 * individual books) and no daily cap — dumping thousands of pages into the
 * index at once reads as a spam pattern to Google and works against the
 * paced, pillar-first rollout this site now uses. For routine publishing,
 * use `publish_batch_pages.js` (tiered: pillar lists > cluster lists/series
 * > books/people, small daily quota). Reserve this script for one-off bulk
 * catch-up situations, reviewed with DRY_RUN first as always.
 *
 * SAFETY:
 *   - DRY RUN by default. Set DRY_RUN=false to actually write.
 *   - Shows exactly what will change before committing.
 *   - Uses SUPABASE_SERVICE_KEY (not anon key) — required for writes.
 *   - Does NOT modify any other fields.
 *
 * THRESHOLDS:
 *   Books:
 *     - recommendation_count >= MIN_BOOK_RECS (default: 3)
 *     - Has a non-empty, non-numeric title
 *     - Has author_name
 *     - Current index_status = 'noindex' (safe to promote)
 *
 *   People:
 *     - Has bio (non-empty, useful)
 *     - Current index_status = 'draft' (safe to promote)
 *     - Optionally: has at least MIN_PERSON_RECS recommendations
 *
 * USAGE:
 *   node scripts/import/publish_indexable_content.js             # dry run
 *   DRY_RUN=false node scripts/import/publish_indexable_content.js  # real write
 *   MIN_BOOK_RECS=5 DRY_RUN=false node scripts/import/publish_indexable_content.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DRY_RUN       = process.env.DRY_RUN !== 'false';  // default: dry run
const MIN_BOOK_RECS = parseInt(process.env.MIN_BOOK_RECS || '3', 10);
const MIN_PERSON_RECS = parseInt(process.env.MIN_PERSON_RECS || '1', 10);
const BATCH_SIZE    = 200;

function log(msg)  { console.log(`[publish] ${msg}`); }
function warn(msg) { console.warn(`[publish] WARN: ${msg}`); }

// ---------------------------------------------------------------------------
// Load env
// ---------------------------------------------------------------------------

function loadEnvFile() {
  const envPath = path.join(__dirname, '../../.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // Handle both "export KEY='val'" and "KEY=val" formats
    const stripped = line.startsWith('export ') ? line.slice(7) : line;
    const eqIdx = stripped.indexOf('=');
    if (eqIdx < 1) continue;
    const key = stripped.slice(0, eqIdx).trim();
    let val   = stripped.slice(eqIdx + 1).trim();
    if ((val.startsWith("'") && val.endsWith("'")) ||
        (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1);
    }
    if (key && val && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadEnvFile();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ||
                     process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SECRET_KEY ||
                     process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL) {
  console.error('Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL');
  process.exit(1);
}
if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SECRET_KEY. This script requires the service role key for writes.');
  process.exit(1);
}

// Validate it looks like a service/secret key
if (!SERVICE_KEY.startsWith('sb_secret_') && !SERVICE_KEY.includes('service_role')) {
  warn('SUPABASE_SECRET_KEY does not look like a service key. Proceeding with caution.');
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NUMERIC_TITLE = /^\s*\d{1,5}(\.\d+)?\s*$/;
function isUsefulTitle(t) {
  return t && typeof t === 'string' && t.trim().length > 1 && !NUMERIC_TITLE.test(t);
}
function isUsefulText(t) {
  return t && typeof t === 'string' && t.trim().length > 10;
}

async function updateInBatches(table, ids, patch) {
  let updated = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    if (DRY_RUN) {
      log(`  [DRY RUN] Would update ${batch.length} rows in ${table}`);
      updated += batch.length;
      continue;
    }
    const { error } = await sb.from(table).update(patch).in('id', batch);
    if (error) {
      warn(`Batch update error on ${table}: ${JSON.stringify(error)}`);
    } else {
      updated += batch.length;
      log(`  Updated batch ${Math.floor(i/BATCH_SIZE)+1}: ${batch.length} rows`);
    }
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Books: fetch candidates and filter
// ---------------------------------------------------------------------------

async function processBooks() {
  log(`\n=== Books (MIN_BOOK_RECS=${MIN_BOOK_RECS}) ===`);

  const eligible = [];
  let offset = 0;
  const PAGE = 1000;

  while (true) {
    const { data, error } = await sb
      .from('books')
      .select('id, title, author_name, cover_image_url, recommendation_count, index_status')
      .eq('index_status', 'noindex')
      .gte('recommendation_count', MIN_BOOK_RECS)
      .range(offset, offset + PAGE - 1);

    if (error) { warn(`books fetch error: ${JSON.stringify(error)}`); break; }
    if (!data || data.length === 0) break;

    for (const book of data) {
      // Hard gate: never publish a book with no valid cover image.
      const hasCover = book.cover_image_url && /^https?:\/\//i.test(book.cover_image_url);
      if (isUsefulTitle(book.title) && isUsefulText(book.author_name) && hasCover) {
        eligible.push(book.id);
      }
    }

    log(`  Scanned offset ${offset}: ${data.length} rows, ${eligible.length} eligible so far`);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  log(`\nEligible books to publish: ${eligible.length}`);

  if (eligible.length === 0) {
    log('Nothing to update for books.');
    return 0;
  }

  // Show sample
  log('Sample IDs (first 5): ' + eligible.slice(0, 5).join(', '));

  const updated = await updateInBatches('books', eligible, { index_status: 'index' });
  log(`Books ${DRY_RUN ? '[DRY RUN] would update' : 'updated'}: ${updated}`);
  return updated;
}

// ---------------------------------------------------------------------------
// People: fetch candidates
// ---------------------------------------------------------------------------

async function processPeople() {
  log(`\n=== People (MIN_PERSON_RECS=${MIN_PERSON_RECS}) ===`);

  const eligible = [];
  let offset = 0;
  const PAGE = 1000;

  while (true) {
    const { data, error } = await sb
      .from('people')
      .select('id, name, slug, bio, avatar_url, index_status, recs:book_recommendations(count)')
      .eq('index_status', 'draft')
      .range(offset, offset + PAGE - 1);

    if (error) { warn(`people fetch error: ${JSON.stringify(error)}`); break; }
    if (!data || data.length === 0) break;

    for (const person of data) {
      const recCount = (person.recs && person.recs[0]) ? (person.recs[0].count || 0) : 0;
      // Hard gate: never publish a person with no valid avatar image.
      const hasAvatar = person.avatar_url && /^https?:\/\//i.test(person.avatar_url);
      if (isUsefulText(person.bio) && recCount >= MIN_PERSON_RECS && hasAvatar) {
        eligible.push({ id: person.id, name: person.name, slug: person.slug, recs: recCount });
      }
    }

    log(`  Scanned offset ${offset}: ${data.length} rows, ${eligible.length} eligible so far`);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  // Sort by rec count desc for transparency
  eligible.sort((a, b) => b.recs - a.recs);

  log(`\nEligible people to publish: ${eligible.length}`);
  if (eligible.length > 0) {
    log('Top 20 people to publish:');
    for (const p of eligible.slice(0, 20)) {
      log(`  ${p.recs.toString().padStart(4)} recs  ${p.slug}`);
    }
  }

  if (eligible.length === 0) {
    log('Nothing to update for people.');
    return 0;
  }

  const ids = eligible.map(p => p.id);
  const updated = await updateInBatches('people', ids, { index_status: 'published' });
  log(`People ${DRY_RUN ? '[DRY RUN] would update' : 'updated'}: ${updated}`);
  return updated;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log('=== BookMentions: Publish Indexable Content ===');
  log(`Mode:          ${DRY_RUN ? 'DRY RUN (no DB writes)' : '⚠️  LIVE WRITE to production DB'}`);
  log(`MIN_BOOK_RECS: ${MIN_BOOK_RECS}`);
  log(`MIN_PERSON_RECS: ${MIN_PERSON_RECS}`);
  log('');

  if (!DRY_RUN) {
    log('⚠️  LIVE MODE: Production DB will be updated in 3 seconds. Ctrl+C to abort.');
    await new Promise(r => setTimeout(r, 3000));
  }

  const booksUpdated  = await processBooks();
  const peopleUpdated = await processPeople();

  log('\n=== Summary ===');
  log(`Books  ${DRY_RUN ? 'eligible' : 'updated'}: ${booksUpdated}`);
  log(`People ${DRY_RUN ? 'eligible' : 'updated'}: ${peopleUpdated}`);
  if (DRY_RUN) {
    log('\nThis was a DRY RUN. To apply, run:');
    log('  DRY_RUN=false node scripts/import/publish_indexable_content.js');
  } else {
    log('\n✅ Done. Redeploy the site to regenerate the sitemap with new published pages.');
    log('Then re-submit sitemap in Google Search Console.');
  }
}

main().catch(err => {
  console.error('[publish] FATAL:', err);
  process.exit(1);
});
