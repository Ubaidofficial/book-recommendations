#!/usr/bin/env node
/**
 * select_enrichment_candidates.js
 *
 * Picks the next batch of books for generate_book_editorial_enrichment.py,
 * pre-filtered to books that already have a valid cover image.
 *
 * WHY THIS EXISTS: generate_book_editorial_enrichment.py's own candidate
 * query (fetch_books() — editorial_summary IS NULL, ordered by
 * recommendation_count desc) does not check cover_image_url at all. Feeding
 * it un-covered books wastes AI spend on rows that publish_batch_pages.js
 * will refuse to publish anyway (it hard-requires a valid cover) until a
 * cover shows up separately. Rather than touch the enrichment script's
 * candidate logic directly — it's a large, heavily-guarded pipeline with a
 * lot of interacting validators — this stays a thin, separate pre-filter
 * that writes a slug list for the enrichment script's own
 * `--book-ids-file` flag.
 *
 * SAFETY: read-only. No writes, no AI calls. Works with the anon key.
 *
 * USAGE:
 *   node scripts/select_enrichment_candidates.js --limit 60
 *   node scripts/select_enrichment_candidates.js --limit 60 --out scratch/enrichment_batch.txt
 *
 * Then:
 *   python scripts/generate_book_editorial_enrichment.py \
 *     --book-ids-file scratch/enrichment_batch.txt --write --quality-status draft \
 *     --provider deepseek --budget-usd 25
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvFile() {
  const envPath = path.join(__dirname, '../.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const stripped = line.startsWith('export ') ? line.slice(7) : line;
    const eqIdx = stripped.indexOf('=');
    if (eqIdx < 1) continue;
    const key = stripped.slice(0, eqIdx).trim();
    let val = stripped.slice(eqIdx + 1).trim();
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1);
    }
    if (key && val && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadEnvFile();

function argVal(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const LIMIT = parseInt(argVal('--limit', '60'), 10);
const OUT_PATH = argVal('--out', path.join(__dirname, '../scratch', `enrichment_candidates_${new Date().toISOString().slice(0, 10)}.txt`));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ghpdpvatfmvsahzsqgpp.supabase.co';
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!KEY) {
  console.error('❌ Missing a Supabase key (anon key is sufficient — this script never writes).');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, KEY);

async function main() {
  console.log(`Selecting up to ${LIMIT} un-enriched, cover-ready books...`);

  const selected = [];
  let offset = 0;
  const PAGE = 500;
  let scanned = 0;
  let skippedNoCover = 0;

  // Overfetch and filter client-side for cover validity — same "no
  // cover column filter, overfetch + narrow" pattern already used
  // elsewhere in src/lib/data.ts (getTopicLists).
  while (selected.length < LIMIT) {
    const { data, error } = await sb
      .from('books')
      .select('id, slug, title, cover_image_url, recommendation_count, editorial_summary')
      .is('editorial_summary', null)
      .order('recommendation_count', { ascending: false, nullsFirst: false })
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error('Query error:', error.message);
      break;
    }
    if (!data || data.length === 0) break;

    for (const b of data) {
      scanned++;
      const hasCover = b.cover_image_url && /^https?:\/\//i.test(b.cover_image_url);
      if (!hasCover) {
        skippedNoCover++;
        continue;
      }
      selected.push(b);
      if (selected.length >= LIMIT) break;
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`Scanned ${scanned} un-enriched books, skipped ${skippedNoCover} with no valid cover.`);
  console.log(`Selected ${selected.length} candidate(s).`);

  if (selected.length === 0) {
    console.log('\nNothing to select. If skippedNoCover is high relative to scanned, the un-enriched backlog needs a cover backfill pass before more enrichment spend is worth it (see upgrade_cover_resolution.js / the Amazon ASIN backfill approach in CHANGELOG.md).');
    return;
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, selected.map((b) => b.slug).join('\n') + '\n');
  console.log(`\nWrote ${selected.length} slugs to: ${OUT_PATH}`);
  console.log(`Top 5 by recommendation_count: ${selected.slice(0, 5).map((b) => `${b.slug} (${b.recommendation_count})`).join(', ')}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
