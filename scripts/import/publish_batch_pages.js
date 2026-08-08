#!/usr/bin/env node
/**
 * publish_batch_pages.js (v2 - Strict EEAT & ICP Reader-Fit Guardrails)
 * Publishes the next batch of 10 high-quality candidate pages (Books, People, Lists, Series)
 * every 3 or 4 days.
 *
 * Guardrails enforced:
 *   - Books: recommendation_count >= 3, valid non-numeric title, valid author,
 *            useful description >= 80 chars (no junk/placeholders), valid HTTP cover.
 *   - People: rec_count >= 10, multi-token full name (filters out profileless surname aliases).
 *   - Lists: high-intent search slug (books-recommended-by-* or best-*-books), book_count >= 15, valid title & description.
 *   - Series: book_count >= 5, valid title & description.
 *
 * Usage:
 *   node scripts/import/publish_batch_pages.js             # Live publish 10 pages
 *   node scripts/import/publish_batch_pages.js --dry-run   # Preview next 10 pages without DB write
 *   BATCH_SIZE=10 node scripts/import/publish_batch_pages.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Parse args
const isDryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10', 10);

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
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SERVICE_KEY) {
  console.error('❌ Error: Missing SUPABASE key');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const PUBLISHED_STATUSES = ['published', 'index', 'indexed', 'approved'];

function isUsefulBookDescription(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < 80) return false;
  if (/description coming soon|placeholder|description pending|under review|goodreads profile/i.test(trimmed)) {
    return false;
  }
  return true;
}

async function findCandidates() {
  const candidates = [];

  // 1. Books (EEAT Guardrail: recs >= 3, valid title/author, rich description >= 80 chars, valid HTTP cover)
  const { data: books, error: bErr } = await sb
    .from('books')
    .select('id, slug, title, author_name, description, cover_image_url, recommendation_count, index_status')
    .gte('recommendation_count', 3)
    .order('recommendation_count', { ascending: false })
    .limit(BATCH_SIZE * 5);

  if (bErr) console.error('Books query error:', bErr.message);

  for (const b of books || []) {
    if (PUBLISHED_STATUSES.includes((b.index_status || '').toLowerCase())) continue;

    const validTitle = b.title && b.title.length > 1 && !/^\s*\d+(\.\d+)?\s*$/.test(b.title);
    const validAuthor = b.author_name && b.author_name.length > 1;
    const validDesc = isUsefulBookDescription(b.description);
    const hasCover = b.cover_image_url && /^https?:\/\//i.test(b.cover_image_url);

    if (validTitle && validAuthor && validDesc && hasCover) {
      candidates.push({
        type: 'book',
        id: b.id,
        slug: b.slug,
        title: `${b.title} by ${b.author_name}`,
        score: (b.recommendation_count || 0) * 15,
        detail: `${b.recommendation_count} recs`,
        table: 'books',
        target_status: 'published'
      });
    }
  }

  // 2. People (EEAT Guardrail: recs >= 10, multi-token name, not single-surname alias)
  const pCounts = {};
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data: peopleRecs, error: recErr } = await sb
      .from('book_recommendations')
      .select('person_id')
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (recErr) {
      console.error('Error fetching book_recommendations:', recErr.message);
      break;
    }
    if (!peopleRecs || peopleRecs.length === 0) break;
    for (const r of peopleRecs) {
      pCounts[r.person_id] = (pCounts[r.person_id] || 0) + 1;
    }
    if (peopleRecs.length < pageSize) break;
    page++;
  }

  const { data: people, error: pErr } = await sb
    .from('people')
    .select('id, slug, name, role, bio, avatar_url, index_status');

  if (pErr) console.error('People query error:', pErr.message);

  for (const p of people || []) {
    if (PUBLISHED_STATUSES.includes((p.index_status || '').toLowerCase())) continue;

    const count = pCounts[p.id] || 0;
    const hasFullName = p.name && p.name.trim().includes(' ');
    if (count >= 10 && hasFullName) {
      candidates.push({
        type: 'person',
        id: p.id,
        slug: p.slug,
        title: p.name,
        score: count * 10 + (p.bio ? 5 : 0) + (p.avatar_url ? 5 : 0),
        detail: `${count} recs`,
        table: 'people',
        target_status: 'published'
      });
    }
  }

  // 3. Lists (ICP Guardrail: intent slug, book_count >= 15, valid description)
  const { data: lists, error: lErr } = await sb
    .from('lists')
    .select('id, slug, title, description, book_count, quality_score, index_status')
    .gte('book_count', 15)
    .order('book_count', { ascending: false })
    .limit(BATCH_SIZE * 5);

  if (lErr) console.error('Lists query error:', lErr.message);

  for (const l of lists || []) {
    if (PUBLISHED_STATUSES.includes((l.index_status || '').toLowerCase())) continue;

    const isIntent = l.slug.startsWith('books-recommended-by-') || l.slug.startsWith('best-');
    const hasDesc = l.description && l.description.trim().length >= 30;

    if (isIntent && hasDesc) {
      candidates.push({
        type: 'list',
        id: l.id,
        slug: l.slug,
        title: l.title,
        score: (l.book_count || 0) * 2 + (l.quality_score || 0),
        detail: `${l.book_count} books, score ${l.quality_score || 0}`,
        table: 'lists',
        target_status: 'published'
      });
    }
  }

  // 4. Series (ICP Guardrail: book_count >= 5, valid description)
  const { data: series, error: sErr } = await sb
    .from('series')
    .select('id, slug, title, description, book_count, index_status')
    .gte('book_count', 5)
    .order('book_count', { ascending: false })
    .limit(BATCH_SIZE * 5);

  if (sErr) console.error('Series query error:', sErr.message);

  for (const s of series || []) {
    if (PUBLISHED_STATUSES.includes((s.index_status || '').toLowerCase())) continue;

    const hasDesc = s.description && s.description.trim().length >= 20;
    if (s.title && s.title.length > 2 && hasDesc) {
      candidates.push({
        type: 'series',
        id: s.id,
        slug: s.slug,
        title: s.title,
        score: (s.book_count || 0) * 3,
        detail: `${s.book_count} books`,
        table: 'series',
        target_status: 'published'
      });
    }
  }

  // Sort candidates by score descending
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🛡️  BookMentions EEAT & ICP Reader-Fit Batch Publisher`);
  console.log(`Mode: ${isDryRun ? '🔍 PREVIEW (Dry Run)' : '⚡ LIVE PUBLISH'}`);
  console.log(`Target Batch Size: ${BATCH_SIZE} pages`);
  console.log(`==================================================\n`);

  const candidates = await findCandidates();
  console.log(`Total high-quality candidate pages remaining in pool: ${candidates.length}`);

  if (candidates.length === 0) {
    console.log('🎉 All high-quality candidate pages have already been published!');
    return;
  }

  const selected = candidates.slice(0, BATCH_SIZE);
  console.log(`\nSelected Top ${selected.length} high-quality pages for this batch:\n`);

  selected.forEach((item, idx) => {
    console.log(` ${idx + 1}. [${item.type.toUpperCase().padEnd(6)}] ${item.title} (${item.slug}) - ${item.detail} | Score: ${item.score}`);
  });

  if (isDryRun) {
    console.log(`\nℹ️ Dry run completed. No database changes were made.`);
    console.log(`To publish this batch live, run:\n  node scripts/import/publish_batch_pages.js\n`);
    return;
  }

  console.log(`\nUpdating database records...`);

  const results = { person: 0, list: 0, book: 0, series: 0 };
  const now = new Date().toISOString();

  for (const item of selected) {
    const { error } = await sb
      .from(item.table)
      .update({ index_status: item.target_status, published_at: now, updated_at: now })
      .eq('id', item.id);

    if (error) {
      console.error(`❌ Failed to publish ${item.type} ${item.slug}:`, error.message);
    } else {
      results[item.type]++;
    }
  }

  console.log(`\n==================================================`);
  console.log(`✅ EEAT & ICP Batch Publish Complete!`);
  console.log(`   - Books:  ${results.book}`);
  console.log(`   - People: ${results.person}`);
  console.log(`   - Lists:  ${results.list}`);
  console.log(`   - Series: ${results.series}`);
  console.log(`   - Total:  ${results.book + results.person + results.list + results.series} pages published`);
  console.log(`==================================================\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
