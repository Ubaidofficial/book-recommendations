#!/usr/bin/env node
/**
 * publish_batch_pages.js (v3 - Tiered Pillar/Cluster/Support Publisher)
 *
 * Promotes pages toward `index_status = 'published'` in strict tier order,
 * so pillar and cluster pages always win a promotion slot before individual
 * book/person pages do — and publishes a small, steady daily drip (target:
 * 3-4 pages/day, see DAILY_BATCH_SIZE) so Google's crawler always has
 * something fresh to find.
 *
 * Hard requirements, not scoring bonuses: no book or person is ever
 * eligible for promotion without (1) a valid image (cover_image_url /
 * avatar_url), and (2) real differentiated content — for books, that means
 * having passed the reader-fit editorial pipeline
 * (generate_book_editorial_enrichment.py, 4.70+ quality bar per
 * docs/ai-editorial/ICP_READER_FIT.md), not just having *any* description;
 * for people, an actual bio (isUsefulPersonBio's 20-char + non-placeholder
 * bar), not just a non-empty field. A candidate missing either simply never
 * enters the pool below — a page that's never gone through this script
 * cannot end up commodity content with a stock blurb and nothing else.
 *
 * TIERS (checked and filled in this order):
 *   Tier 1 — Pillar: the ~31 broad-category list pages (Fiction, Nonfiction,
 *            Business, Science, History, …). These are the site's primary
 *            topical hubs — fully built, publicly displayed via the
 *            LIST_PUBLIC_OR allowlist in data.ts, but some still sit at
 *            index_status='draft', which robotsDirective() treats as
 *            noindex. This is a one-time backlog correction, not a
 *            trickle: ALL currently-eligible pillar lists are promoted on
 *            every run (uncapped by DAILY_BATCH_SIZE), because there are
 *            only ~31 of them and they're already content-complete.
 *   Tier 2 — Cluster: narrower topic lists (best-*-books,
 *            books-recommended-by-*) and series pages, which support and
 *            link back to the Tier 1 pillars. Capped by the daily quota.
 *   Tier 3 — Supporting: individual books and people, ranked by the
 *            existing EEAT scoring. Fills whatever's left of the daily
 *            quota after Tiers 1 and 2.
 *
 * No blog tier exists because this site has no blog content type — pillar
 * and cluster (list/series) pages are the entire "hub" layer.
 *
 * SAFETY:
 *   - DRY RUN by default, matching publish_indexable_content.js's
 *     convention. Pass --write (or DRY_RUN=false) to actually update rows.
 *   - Uses SUPABASE_SECRET_KEY / SUPABASE_SERVICE_KEY (not anon key) for
 *     writes — required so RLS doesn't silently no-op the update.
 *   - Never touches any column beyond index_status/published_at/updated_at.
 *
 * USAGE:
 *   node scripts/import/publish_batch_pages.js                # dry run, default daily quota (3)
 *   node scripts/import/publish_batch_pages.js --write         # live publish
 *   DAILY_BATCH_SIZE=2 node scripts/import/publish_batch_pages.js --write
 *
 * Intended to run once per day (see the "2-3 pages per day" cadence rule)
 * once Tier 1 is caught up — cron it via your own scheduler, or a Claude
 * Code Remote Routine, once you've reviewed a few dry runs.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const isWrite = process.argv.includes('--write') || process.env.DRY_RUN === 'false';
// Target cadence is 3-4 pages/day; default to the upper bound so the daily
// job never falls short of the rule. Override with DAILY_BATCH_SIZE=3 on
// slower days if desired.
const DAILY_BATCH_SIZE = parseInt(process.env.DAILY_BATCH_SIZE || process.env.BATCH_SIZE || '4', 10);

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
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;

if (isWrite && !SERVICE_KEY) {
  console.error('❌ Error: --write requires SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_KEY). Refusing to write with an anon key.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// Mirrors src/lib/seo.ts INDEXABLE_STATUSES — keep in sync manually since
// this script runs outside the Next.js build and can't import TS directly.

/**
 * Slugs that must never be published because a redirect points away from them.
 *
 * `index_status = 'noindex'` is overloaded: it means BOTH "not published yet"
 * and "deliberately retired". The publisher only understood the first sense,
 * so every page retired during duplicate consolidation — ten `best-<topic>-books`
 * twins merged into their bare-topic counterparts — read as a fresh candidate
 * again. A dry run put best-leadership-books back in the batch.
 *
 * Publishing them would recreate the duplicate pairs AND emit ten sitemap URLs
 * that 301 away, which is a self-inflicted crawl error.
 *
 * next.config.js is the authoritative record of what has been retired, so it
 * is read directly rather than duplicating a list that would drift. Anything
 * that is the SOURCE of a redirect is off-limits, permanently.
 */
function loadRedirectedSlugs() {
  const retired = new Set();
  try {
    // next.config.js exports `async redirects()`, so calling it returns a
    // Promise — unusable from a module-level constant. The file is read as
    // text instead: the rule list is a static literal, so a scan for
    // `source: "/<type>/<slug>"` is exact and needs no evaluation.
    const cfgPath = path.join(__dirname, '../../next.config.js');
    const text = fs.readFileSync(cfgPath, 'utf-8');
    const re = /source:\s*["'`]\/(?:lists|books|people|series)\/([^"'`\/:*]+)["'`]/g;
    let m;
    while ((m = re.exec(text)) !== null) retired.add(m[1].toLowerCase());
  } catch (e) {
    // A parse failure must not silently disable the guard.
    console.error('⚠️  Could not read redirects from next.config.js:', e.message);
    console.error('   Refusing to publish rather than risk resurrecting a retired page.');
    process.exit(1);
  }
  return retired;
}

const REDIRECTED_SLUGS = loadRedirectedSlugs();

const PUBLISHED_STATUSES = ['published', 'approved', 'indexed', 'index'];

// Mirrors src/lib/data.ts BROAD_CATEGORY_SLUGS exactly — these are the
// site's pillar pages. Keep in sync manually for the same reason as above.
const BROAD_CATEGORY_SLUGS = [
  'nonfiction', 'fiction', 'business', 'science', 'social-sciences', 'history',
  'psychology', 'personal-development', 'art', 'philosophy', 'fantasy',
  'science-fiction', 'romance', 'mystery-crime', 'thriller-suspense', 'finance',
  'leadership', 'spirituality', 'sports', 'technology', 'health', 'politics',
  'biography', 'poetry', 'music', 'food', 'travel', 'design', 'writing',
  'programming', 'management', 'entrepreneurship',
];

// Mirrors src/lib/dataQuality.ts PERSON_BIO_PLACEHOLDERS / isUsefulPersonBio
// exactly — keep in sync manually for the same reason as the constants
// above (this script runs outside the Next.js build).
const PERSON_BIO_PLACEHOLDERS = new Set(['null', 'undefined', 'n/a', 'na', 'none', 'tbd', 'coming soon', 'to be added', '-']);
function isUsefulPersonBio(value) {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 20) return false;
  if (PERSON_BIO_PLACEHOLDERS.has(trimmed.toLowerCase())) return false;
  return true;
}

function isUsefulBookDescription(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < 80) return false;
  if (/description coming soon|placeholder|description pending|under review|goodreads profile/i.test(trimmed)) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Tier 1 — Pillar: broad-category lists
// ---------------------------------------------------------------------------


/**
 * Topic collision guard.
 *
 * A list slug and its "best-<topic>-books" variant are the same page to a
 * search engine: /fiction and /best-fiction-books both render "Best Fiction
 * Books" and chase one query. Ten such pairs already had to be consolidated by
 * hand, merging memberships and 301ing the loser.
 *
 * 39 more are sitting in the candidate pool right now — best-history-books (77
 * books) against a live /history (1,656), best-nonfiction-books (40) against
 * /nonfiction (7,816). Publishing on a schedule would recreate the problem
 * automatically, and always in the damaging direction: the new page is the
 * thinner of the two and splits the topic's authority.
 *
 * So a topic whose page is already live is closed. The normalised key strips
 * the "best-" prefix, the "-books" suffix and a trailing plural, which is what
 * makes memoirs/best-memoir-books resolve to the same topic.
 */

/**
 * Minimum distinct people who must stand behind a list before it can publish.
 *
 * book_count measures catalogue size, not substance, and the two come apart
 * badly. Sampling the description-less backlog found "Best Astrology Books"
 * with 84 books and ZERO recommendations, "Best Warhammer 40k Books" with 22
 * and zero, "Best Beer Books" with 15 and zero — alongside genuinely strong
 * candidates like "Best Spiritual Books" (175 distinct recommenders) and
 * "Best Neuroscience Books" (108).
 *
 * Across an even sample of 25, roughly half were filler. Publishing on
 * book_count alone would have made most new pages indistinguishable from any
 * other auto-generated listicle — the one thing this site's provenance model
 * exists to avoid. A page nobody recommended has nothing to say that a
 * bookstore category page does not.
 *
 * 20 distinct recommenders is the line the sample supports: above it the pages
 * carry real, sourced endorsement; below it they are a catalogue with a title.
 */
const MIN_LIST_RECOMMENDERS = 20;

/** Distinct people recommending anything in this list. */
async function countListRecommenders(listId) {
  const bookIds = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from('book_lists')
      .select('book_id')
      .eq('list_id', listId)
      .range(from, from + 499);
    if (error) return null;              // unknown, not zero — caller fails closed
    if (!data || data.length === 0) break;
    for (const r of data) if (r.book_id) bookIds.push(r.book_id);
    if (data.length < 500) break;
    from += 500;
  }
  if (bookIds.length === 0) return 0;

  const people = new Set();
  for (let i = 0; i < bookIds.length; i += 150) {
    const { data, error } = await sb
      .from('book_recommendations')
      .select('person_id')
      .in('book_id', bookIds.slice(i, i + 150));
    if (error) return null;
    for (const r of data || []) if (r.person_id) people.add(r.person_id);
  }
  return people.size;
}

/**
 * A failed candidate query must abort the run, not degrade it.
 *
 * These queries sort books by recommendation_count, which carries no index, so
 * they intermittently exceed the statement timeout. The old handling logged
 * the error and carried on with an empty result — which on one dry run turned
 * a mixed batch into a people-only batch without anything looking wrong.
 *
 * Unattended and daily, that silently skews what the site publishes and leaves
 * no signal that it happened. A publisher that cannot see its candidates must
 * stop, not guess. (The durable fix is an index on books.recommendation_count
 * and books.index_status; this makes the failure visible until then.)
 */
function failClosed(label, error) {
  if (!error) return;
  console.error(`\n❌ ${label} query failed: ${error.message}`);
  console.error('   Aborting: publishing a partial batch would skew the mix invisibly.');
  process.exit(1);
}

function topicKey(slug) {
  return String(slug || '')
    .toLowerCase()
    .replace(/^best-/, '')
    .replace(/-books$/, '')
    .replace(/s$/, '');
}

async function loadPublishedTopics() {
  const topics = new Set();
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from('lists')
      .select('slug, index_status')
      .in('index_status', PUBLISHED_STATUSES)
      .range(from, from + 999);
    if (error) {
      console.error('⚠️  Could not load published topics:', error.message);
      console.error('   Refusing to publish rather than risk creating a duplicate pair.');
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    for (const l of data) if (l.slug) topics.add(topicKey(l.slug));
    if (data.length < 1000) break;
    from += 1000;
  }
  return topics;
}

async function findTier1Candidates() {
  const { data: lists, error } = await sb
    .from('lists')
    .select('id, slug, title, book_count, index_status')
    .in('slug', BROAD_CATEGORY_SLUGS);

  if (error) {
    failClosed('Tier 1 (pillar lists)', error);
    return [];
  }

  return (lists || [])
    .filter((l) => !PUBLISHED_STATUSES.includes((l.index_status || '').toLowerCase()))
    // Tier 1 uses a filter chain rather than a loop, so it needs the retired
    // guard applied here too.
    .filter((l) => !REDIRECTED_SLUGS.has(String(l.slug || '').toLowerCase()))
    .map((l) => ({
      tier: 1,
      type: 'pillar-list',
      id: l.id,
      slug: l.slug,
      title: l.title,
      score: l.book_count || 0,
      detail: `${l.book_count} books — pillar category`,
      table: 'lists',
      target_status: 'published',
    }))
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Tier 2 — Cluster: topic lists + series
// ---------------------------------------------------------------------------

async function findTier2Candidates() {
  const candidates = [];

  const { data: lists, error: lErr } = await sb
    .from('lists')
    .select('id, slug, title, description, book_count, quality_score, index_status')
    .gte('book_count', 15)
    // Exclude published rows IN the query, not after fetching.
    //
    // The window is a fixed slice from the top of the ranking, and the
    // published set IS the top of that ranking — so as more pages go live the
    // slice fills with rows that are then all discarded. At limit(50) this had
    // already reduced book candidates to zero. limit(500) hides it for now,
    // but the same exhaustion returns once ~500 books are live, and it fails
    // silently: an empty batch looks identical to "nothing eligible".
    //
    // Filtering server-side makes the window a cursor over eligible rows.
    .not('index_status', 'in', `(${PUBLISHED_STATUSES.join(',')})`)
    .order('book_count', { ascending: false })
    .limit(200);

  failClosed('Tier 2 (cluster lists)', lErr);

  for (const l of lists || []) {
    if (PUBLISHED_STATUSES.includes((l.index_status || '').toLowerCase())) continue;
    // A redirect points away from this slug: it was retired on purpose.
    if (REDIRECTED_SLUGS.has(String(l.slug || '').toLowerCase())) continue;
    if (BROAD_CATEGORY_SLUGS.includes(l.slug)) continue; // handled in Tier 1

    const isIntent = l.slug.startsWith('books-recommended-by-') || l.slug.startsWith('best-');
    const hasDesc = l.description && l.description.trim().length >= 30;
    if (isIntent && hasDesc) {
      candidates.push({
        tier: 2,
        type: 'cluster-list',
        id: l.id,
        slug: l.slug,
        title: l.title,
        score: (l.book_count || 0) * 2 + (l.quality_score || 0),
        detail: `${l.book_count} books, score ${l.quality_score || 0} — cluster list`,
        table: 'lists',
        target_status: 'published',
      });
    }
  }

  const { data: series, error: sErr } = await sb
    .from('series')
    .select('id, slug, title, description, book_count, index_status')
    .gte('book_count', 5)
    // Exclude published rows IN the query, not after fetching.
    //
    // The window is a fixed slice from the top of the ranking, and the
    // published set IS the top of that ranking — so as more pages go live the
    // slice fills with rows that are then all discarded. At limit(50) this had
    // already reduced book candidates to zero. limit(500) hides it for now,
    // but the same exhaustion returns once ~500 books are live, and it fails
    // silently: an empty batch looks identical to "nothing eligible".
    //
    // Filtering server-side makes the window a cursor over eligible rows.
    .not('index_status', 'in', `(${PUBLISHED_STATUSES.join(',')})`)
    .order('book_count', { ascending: false })
    .limit(200);

  failClosed('Tier 2 (series)', sErr);

  for (const s of series || []) {
    if (PUBLISHED_STATUSES.includes((s.index_status || '').toLowerCase())) continue;
    // A redirect points away from this slug: it was retired on purpose.
    if (REDIRECTED_SLUGS.has(String(s.slug || '').toLowerCase())) continue;
    const hasDesc = s.description && s.description.trim().length >= 20;
    if (s.title && s.title.length > 2 && hasDesc) {
      candidates.push({
        tier: 2,
        type: 'cluster-series',
        id: s.id,
        slug: s.slug,
        title: s.title,
        score: (s.book_count || 0) * 3,
        detail: `${s.book_count} books — series`,
        table: 'series',
        target_status: 'published',
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// ---------------------------------------------------------------------------
// Tier 3 — Supporting: books + people
// ---------------------------------------------------------------------------

// A book is only eligible once it has passed the reader-fit editorial
// pipeline (generate_book_editorial_enrichment.py) and cleared its 4.70+
// quality bar — see docs/ai-editorial/ICP_READER_FIT.md. Before this gate,
// `isUsefulBookDescription` alone (any description >=80 chars) was enough
// to publish a book, which let generic/scraped blurbs reach a public URL
// with none of the reader-fit content (best_for/not_for/emotional_journey)
// that's the actual differentiator books/[slug]/page.tsx's `showEditorial`
// gate is built around. Tying publish eligibility to the same status the
// page uses to decide whether to render that content means a published
// page can never show up as description-only commodity copy.
const EDITORIAL_PASSED_STATUSES = ['draft', 'approved'];

async function findTier3Candidates() {
  const candidates = [];

  // Exclude published rows IN the query, not after fetching (see the same
  // reasoning on Tier 2 above). That alone isn't enough here, though: a fixed
  // limit() ordered by recommendation_count also hides eligible rows, just
  // not by publishing them away. Eligibility (cover/description/editorial
  // status) doesn't correlate with recommendation_count, so a `limit(500)`
  // window pinned to the top of that ranking permanently excludes every
  // eligible book below its cutoff — measured 2026-08-27 at 284 books (63%
  // of the true eligible pool) sitting just below the window with
  // recommendation_count 3-6, invisible to every run indefinitely. Paginating
  // through the full non-published set removes the cap instead of just
  // raising it.
  const books = [];
  let bFrom = 0;
  const bPageSize = 1000;
  for (;;) {
    const { data, error } = await sb
      .from('books')
      .select('id, slug, title, author_name, description, cover_image_url, recommendation_count, index_status, ai_quality_status')
      .gte('recommendation_count', 3)
      .not('index_status', 'in', `(${PUBLISHED_STATUSES.join(',')})`)
      .order('recommendation_count', { ascending: false })
      .range(bFrom, bFrom + bPageSize - 1);
    if (error) {
      failClosed('Tier 3 (books)', error);
      break;
    }
    if (!data || data.length === 0) break;
    books.push(...data);
    if (data.length < bPageSize) break;
    bFrom += bPageSize;
  }

  for (const b of books) {
    if (PUBLISHED_STATUSES.includes((b.index_status || '').toLowerCase())) continue;
    // A redirect points away from this slug: it was retired on purpose.
    if (REDIRECTED_SLUGS.has(String(b.slug || '').toLowerCase())) continue;

    const validTitle = b.title && b.title.length > 1 && !/^\s*\d+(\.\d+)?\s*$/.test(b.title);
    const validAuthor = b.author_name && b.author_name.length > 1;
    const validDesc = isUsefulBookDescription(b.description);
    const hasCover = b.cover_image_url && /^https?:\/\//i.test(b.cover_image_url);
    const passedEditorial = EDITORIAL_PASSED_STATUSES.includes((b.ai_quality_status || '').toLowerCase());

    if (validTitle && validAuthor && validDesc && hasCover && passedEditorial) {
      candidates.push({
        tier: 3,
        type: 'book',
        id: b.id,
        slug: b.slug,
        title: `${b.title} by ${b.author_name}`,
        score: (b.recommendation_count || 0) * 15,
        detail: `${b.recommendation_count} recs`,
        table: 'books',
        target_status: 'published',
      });
    }
  }

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

  failClosed('Tier 3 (people)', pErr);

  for (const p of people || []) {
    if (PUBLISHED_STATUSES.includes((p.index_status || '').toLowerCase())) continue;
    // A redirect points away from this slug: it was retired on purpose.
    if (REDIRECTED_SLUGS.has(String(p.slug || '').toLowerCase())) continue;

    const count = pCounts[p.id] || 0;
    const hasFullName = p.name && p.name.trim().includes(' ');
    // Hard gate, not a scoring bonus: a published person page with no photo
    // is exactly the "no book or person on a published URL without an
    // image" gap this pipeline exists to prevent.
    const hasAvatar = p.avatar_url && /^https?:\/\//i.test(p.avatar_url);
    // Same standard the page itself uses (isUsefulPersonBio in
    // dataQuality.ts) — was previously just "non-empty," which let a person
    // publish with a one-word bio. E-E-A-T needs an actual bio, not a stub.
    const hasRealBio = isUsefulPersonBio(p.bio);
    if (count >= 10 && hasFullName && hasAvatar && hasRealBio) {
      candidates.push({
        tier: 3,
        type: 'person',
        id: p.id,
        slug: p.slug,
        title: p.name,
        score: count * 10 + 5,
        detail: `${count} recs`,
        table: 'people',
        target_status: 'published',
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n==================================================`);
  console.log(`🛡️  BookMentions Tiered Publisher (Pillar > Cluster > Support)`);
  console.log(`Mode: ${isWrite ? '⚡ LIVE PUBLISH' : '🔍 PREVIEW (Dry Run)'}`);
  console.log(`Daily quota for Tier 2/3: ${DAILY_BATCH_SIZE} pages (Tier 1 pillar backlog is uncapped)`);
  console.log(`==================================================\n`);

  // Topics already covered by a live page. Applied to LIST candidates only —
  // a book and a list can share a topic word without competing, but two lists
  // on one topic is the duplicate pair this project already had to unwind.
  const publishedTopics = await loadPublishedTopics();
  const notADuplicateTopic = (c) =>
    !(c.type === 'pillar-list' || c.type === 'cluster-list' || c.type === 'list') ||
    !publishedTopics.has(topicKey(c.slug));

  const tier1All = await findTier1Candidates();
  const tier1 = tier1All.filter(notADuplicateTopic);
  console.log(`Tier 1 (pillar lists) pending: ${tier1.length} of ${BROAD_CATEGORY_SLUGS.length} total broad categories`);

  let remaining = DAILY_BATCH_SIZE;
  const tier2All = remaining > 0 ? await findTier2Candidates() : [];
  const tier2 = tier2All.filter(notADuplicateTopic);
  const blocked2 = tier2All.length - tier2.length;
  console.log(`Tier 2 (cluster lists + series) candidate pool: ${tier2.length}${blocked2 ? `  (${blocked2} blocked: topic already published)` : ''}`);
  const tier3 = await findTier3Candidates();
  console.log(`Tier 3 (books + people) candidate pool: ${tier3.length}\n`);

  // Tier 1 is never capped — it's a backlog fix, not a drip.
  const selected = [...tier1];

  // Depth is checked at selection time, not while building the pool: only the
  // few candidates about to publish need measuring, which keeps this to a
  // handful of queries instead of hundreds.
  let shallowSkipped = 0;
  for (const c of tier2) {
    if (remaining <= 0) break;
    if (c.type === 'cluster-list' || c.type === 'list') {
      const depth = await countListRecommenders(c.id);
      if (depth === null) {
        console.error(`⚠️  Could not measure recommender depth for ${c.slug}; skipping rather than guessing.`);
        continue;
      }
      if (depth < MIN_LIST_RECOMMENDERS) {
        shallowSkipped++;
        continue;
      }
      c.detail += `, ${depth} recommenders`;
    }
    selected.push(c);
    remaining--;
  }
  if (shallowSkipped > 0) {
    console.log(`  (${shallowSkipped} list(s) skipped: fewer than ${MIN_LIST_RECOMMENDERS} distinct recommenders)`);
  }
  for (const c of tier3) {
    if (remaining <= 0) break;
    selected.push(c);
    remaining--;
  }

  if (selected.length === 0) {
    console.log('🎉 Nothing pending in any tier. All eligible pages are already published.');
    return;
  }

  console.log(`Selected ${selected.length} page(s) for this run:\n`);
  selected.forEach((item, idx) => {
    console.log(
      ` ${idx + 1}. [T${item.tier} ${item.type.toUpperCase().padEnd(13)}] ${item.title} (${item.slug}) — ${item.detail} | Score: ${item.score}`
    );
  });

  if (!isWrite) {
    console.log(`\nℹ️  Dry run completed. No database changes were made.`);
    console.log(`To publish this batch live, run:\n  node scripts/import/publish_batch_pages.js --write\n`);
    return;
  }

  console.log(`\nUpdating database records...`);

  const results = { 'pillar-list': 0, 'cluster-list': 0, 'cluster-series': 0, book: 0, person: 0 };
  const now = new Date().toISOString();

  for (const item of selected) {
    const { error } = await sb
      .from(item.table)
      .update({ index_status: item.target_status, published_at: now, updated_at: now })
      .eq('id', item.id);

    if (error) {
      console.error(`❌ Failed to publish ${item.type} ${item.slug}:`, error.message);
    } else {
      results[item.type] = (results[item.type] || 0) + 1;
    }
  }

  console.log(`\n==================================================`);
  console.log(`✅ Tiered Publish Complete!`);
  console.log(`   - Tier 1 pillar lists:   ${results['pillar-list']}`);
  console.log(`   - Tier 2 cluster lists:  ${results['cluster-list']}`);
  console.log(`   - Tier 2 series:         ${results['cluster-series']}`);
  console.log(`   - Tier 3 books:          ${results.book}`);
  console.log(`   - Tier 3 people:         ${results.person}`);
  console.log(`   - Total:                 ${selected.length} pages published`);
  console.log(`==================================================`);
  console.log(`\nRedeploy (or wait for the next request) to pick up the new sitemap entries, then re-submit the sitemap in Google Search Console if you want to nudge discovery.\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
