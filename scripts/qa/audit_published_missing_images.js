#!/usr/bin/env node
/**
 * audit_published_missing_images.js
 *
 * Read-only audit: finds every book or person that is ALREADY indexable
 * (index_status in the same set robotsDirective() treats as "index, follow")
 * but has a gap the current publish gates would refuse today — missing
 * image, missing/weak description or bio, missing title/author, OR (books)
 * never having passed the reader-fit editorial pipeline. That last one is
 * the commodity-content check: a book can satisfy every other check while
 * still showing only a generic/scraped description with none of the
 * best_for/not_for/emotional_journey reader-fit content that's the site's
 * actual differentiation per docs/ai-editorial/ICP_READER_FIT.md — books/
 * [slug]/page.tsx's `showEditorial` gate hides that whole section when
 * ai_quality_status isn't set, so a page like that is live with strictly
 * less content than the template is built to show.
 *
 * This is the retroactive check; publish_batch_pages.js and
 * publish_indexable_content.js are the forward-looking gates (as of this
 * pass, both now require ai_quality_status/isUsefulPersonBio too) that stop
 * new gaps like this from being created.
 *
 * SAFETY:
 *   - No writes. SELECT-only, works with the anon key.
 *   - Never modifies index_status or any other column.
 *
 * OUTPUT:
 *   - Console summary.
 *   - CSV report at scripts/qa/output/missing_images_report.csv (books and
 *     people, sorted by recommendation_count desc so the
 *     highest-visibility/highest-traffic-risk gaps sort first).
 *
 * USAGE:
 *   node scripts/qa/audit_published_missing_images.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvFile() {
  const envPath = path.join(__dirname, '../../.env.local');
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ghpdpvatfmvsahzsqgpp.supabase.co';
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!KEY) {
  console.error('❌ Missing a Supabase key (anon key is sufficient — this script never writes).');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, KEY);

// Mirrors src/lib/seo.ts INDEXABLE_STATUSES.
const INDEXABLE_STATUSES = ['published', 'approved', 'indexed', 'index'];

// Mirrors src/lib/dataQuality.ts EDITORIAL_PASSED_STATUSES concept — see
// publish_batch_pages.js for the full rationale.
const EDITORIAL_PASSED_STATUSES = ['draft', 'approved'];
const PERSON_BIO_PLACEHOLDERS = new Set(['null', 'undefined', 'n/a', 'na', 'none', 'tbd', 'coming soon', 'to be added', '-']);

function hasValidUrl(u) {
  return !!u && typeof u === 'string' && /^https?:\/\//i.test(u.trim());
}
function isUsefulDescription(t) {
  return !!t && typeof t === 'string' && t.trim().length >= 80;
}
// Mirrors src/lib/dataQuality.ts isUsefulPersonBio exactly.
function isUsefulBio(t) {
  if (!t || typeof t !== 'string') return false;
  const trimmed = t.trim();
  if (trimmed.length < 20) return false;
  if (PERSON_BIO_PLACEHOLDERS.has(trimmed.toLowerCase())) return false;
  return true;
}

async function fetchAllIndexable(table, columns) {
  const rows = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .in('index_status', INDEXABLE_STATUSES)
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error(`${table} fetch error:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

function csvField(val) {
  const s = val == null ? '' : String(val);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function main() {
  console.log('\n==================================================');
  console.log('🔎 Audit: published books/people missing image or SEO essentials');
  console.log('==================================================\n');

  const books = await fetchAllIndexable(
    'books',
    'id, slug, title, author_name, cover_image_url, description, recommendation_count, index_status, ai_quality_status'
  );
  const people = await fetchAllIndexable(
    'people',
    'id, slug, name, bio, avatar_url, index_status'
  );

  const badBooks = books
    .map((b) => {
      const reasons = [];
      if (!hasValidUrl(b.cover_image_url)) reasons.push('missing_cover');
      if (!isUsefulDescription(b.description)) reasons.push('weak_or_missing_description');
      if (!b.title || b.title.trim().length < 2) reasons.push('missing_title');
      if (!b.author_name || b.author_name.trim().length < 2) reasons.push('missing_author');
      if (!EDITORIAL_PASSED_STATUSES.includes((b.ai_quality_status || '').toLowerCase())) {
        reasons.push('no_reader_fit_content_commodity_risk');
      }
      return { ...b, reasons };
    })
    .filter((b) => b.reasons.length > 0)
    .sort((a, b) => (b.recommendation_count || 0) - (a.recommendation_count || 0));

  const badPeople = people
    .map((p) => {
      const reasons = [];
      if (!hasValidUrl(p.avatar_url)) reasons.push('missing_avatar');
      if (!isUsefulBio(p.bio)) reasons.push('weak_or_missing_bio');
      return { ...p, reasons };
    })
    .filter((p) => p.reasons.length > 0);

  const commodityBooks = badBooks.filter((b) => b.reasons.includes('no_reader_fit_content_commodity_risk'));

  console.log(`Indexable books scanned:  ${books.length}`);
  console.log(`  → with a gap:           ${badBooks.length}`);
  console.log(`  → commodity-content risk (no reader-fit editorial content): ${commodityBooks.length}`);
  console.log(`Indexable people scanned: ${people.length}`);
  console.log(`  → with a gap:           ${badPeople.length}\n`);

  if (books.length === 0 && people.length === 0) {
    console.error('⚠️  Scanned zero rows from both tables — this almost certainly means the Supabase fetch failed (see errors above), not that nothing is indexed yet. Fix connectivity/credentials and re-run before trusting a "no gaps" result.');
    process.exitCode = 1;
    return;
  }

  if (badBooks.length > 0) {
    console.log('Top 20 highest-traffic-risk books with a gap (by recommendation_count):');
    for (const b of badBooks.slice(0, 20)) {
      console.log(`  ${(b.recommendation_count || 0).toString().padStart(4)} recs  /books/${b.slug}  [${b.reasons.join(', ')}]`);
    }
    console.log('');
  }
  if (badPeople.length > 0) {
    console.log('People with a gap:');
    for (const p of badPeople.slice(0, 20)) {
      console.log(`  /people/${p.slug}  [${p.reasons.join(', ')}]`);
    }
    console.log('');
  }

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'missing_images_report.csv');
  const lines = ['type,slug,recommendation_count,reasons,url'];
  for (const b of badBooks) {
    lines.push(
      [csvField('book'), csvField(b.slug), b.recommendation_count || 0, csvField(b.reasons.join('|')), csvField(`/books/${b.slug}`)].join(',')
    );
  }
  for (const p of badPeople) {
    lines.push([csvField('person'), csvField(p.slug), '', csvField(p.reasons.join('|')), csvField(`/people/${p.slug}`)].join(','));
  }
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
  console.log(`Full report written to: ${outPath}`);

  if (badBooks.length === 0 && badPeople.length === 0) {
    console.log('\n✅ No gaps found — every indexable book and person has an image, usable copy, and (for books) reader-fit editorial content.');
  } else {
    console.log(`\n⚠️  ${badBooks.length + badPeople.length} published page(s) have a gap. Backfill the image/copy/editorial content, or demote back to noindex until they clear it.`);
    if (commodityBooks.length > 0) {
      console.log(`   ${commodityBooks.length} of those are commodity-content risk specifically — live with only a generic description, none of the best_for/not_for/emotional_journey content the ICP actually wants. These are strong candidates for scripts/select_enrichment_candidates.js's next batch, or for temporary demotion to noindex if that would take a while.`);
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
