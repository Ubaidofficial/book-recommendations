#!/usr/bin/env node
/**
 * match_mrb_candidates_to_bookmentions.js
 * Phase 3 — Match MRB Candidates to BookMentions People + Books
 *
 * PURPOSE:
 *   Read Phase 2 candidate rows from scratch/mrb_person_candidates_sample.json,
 *   match each row against the production BookMentions Supabase DB (read-only),
 *   and write three review-only JSON files to scratch/.
 *
 * SAFETY RULES:
 *   - READ-ONLY Supabase access using the public anon key ONLY.
 *   - No insert, update, delete, upsert, or any mutation.
 *   - No service role key.
 *   - No production table writes.
 *   - Output goes to scratch/ JSON files only.
 *   - Runtime assertion that no mutation methods are called.
 *
 * DATA FLOW:
 *   scratch/mrb_person_candidates_sample.json  (Phase 2 output — 1,091 rows)
 *     → person match  (slug → people table)
 *     → book match    (title + author_name → books table, bulk-fetched per person)
 *     → eligibility   (rules: person exact, book exact/normalized, source present, confidence)
 *
 * OUTPUTS (all in scratch/):
 *   mrb_matched_candidates.json    — rows where person+book both matched
 *   mrb_unmatched_candidates.json  — rows where person or book did not match
 *   mrb_match_report.json          — summary counts, examples, compliance notes
 *
 * MATCHING STRATEGY:
 *
 *   Person matching (in priority order):
 *     1. exact_slug    — MRB person_slug directly matches people.slug
 *     2. exact_name    — name normalized match against people.name
 *     3. normalized_name — strip punctuation/case/whitespace, compare
 *     4. fuzzy         — trigram-style token overlap ≥ 0.85 score, single candidate only
 *     5. ambiguous     — multiple candidates, cannot resolve safely
 *     6. unmatched     — no match found
 *
 *   Book matching (per person — only books already in the DB):
 *     1. exact_title_author   — title + author_name exact (after trim/case)
 *     2. normalized_title_author — normalize both, exact compare
 *     3. title_author_surname — normalized title + author surname match
 *     4. fuzzy                — token overlap ≥ 0.82 on title + any author match
 *     5. ambiguous            — multiple candidates match equally
 *     6. unmatched            — no match found
 *
 *   Generic title guard: titles ≤ 3 words are not matched on title alone.
 *
 * ELIGIBILITY (eligible_for_review_import):
 *   true iff ALL of:
 *     - person_match_status IN (exact_slug, exact_name, normalized_name)
 *     - book_match_status   IN (exact_title_author, normalized_title_author, title_author_surname)
 *     - original_source_url is present and non-null
 *     - source host not in blocked list (amazon, goodreads, etc.)
 *     - confidence IN (high, medium)
 *     - no pipe characters in any field
 *     - is_rejected is false
 *
 *   NOTE: eligible_for_review_import does NOT mean safe to write to DB.
 *   It means safe to include in a human review queue.
 *   review_required:true rows can still be eligible — a human must verify before any write.
 *
 * USAGE:
 *   node scripts/import/match_mrb_candidates_to_bookmentions.js
 *
 * NO COMMIT. For review only.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Must be defined before resolveSupabaseCredentials() which calls loadEnvFile()
const REPO_ROOT = path.resolve(__dirname, '../../');

// ---------------------------------------------------------------------------
// Supabase — READ-ONLY anon/public key ONLY
// Loaded from NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY.
// Falls back to reading .env.local (KEY=VALUE lines only; export/shell syntax
// is skipped). Never prints key values. Fails closed if vars missing.
// ---------------------------------------------------------------------------

function loadEnvFile() {
  // Load KEY=VALUE lines from .env.local into process.env (if not already set).
  // Does NOT eval shell syntax — only plain KEY=VALUE and KEY='VALUE' forms.
  const envPath = path.join(REPO_ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    // Skip blank lines, comments, and shell export/other directives
    if (!line || line.startsWith('#') || line.startsWith('export ')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx < 1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val  = line.slice(eqIdx + 1).trim();
    // Strip surrounding quotes (single or double)
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
  // Try to load from .env.local first (populates process.env if not already set)
  loadEnvFile();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ||
              process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Fail closed: missing vars
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

  // Safety: reject service/secret keys
  if (/service_role/i.test(key) || /sb_secret_/i.test(key) || /SECRET/i.test(key)) {
    throw new Error(
      'SAFETY VIOLATION: NEXT_PUBLIC_SUPABASE_ANON_KEY appears to be a service/secret key. ' +
      'Use the public anon/publishable key only. Aborting.'
    );
  }

  // Safety: never log the actual key value
  log(`Supabase URL loaded from env: ${url}`);
  log(`Supabase anon key loaded from env: [${key.slice(0,12)}…] (truncated for safety)`);

  return { url, key };
}

const { url: SUPABASE_URL, key: SUPABASE_ANON_KEY } = resolveSupabaseCredentials();

// Safety: wrap client so mutation methods throw immediately
function makeSafeReadOnlyClient() {
  const raw = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const BLOCKED = ['insert','update','delete','upsert','rpc'];
  // Proxy the .from() call to intercept mutations on the returned builder
  const safe = {
    from(table) {
      const builder = raw.from(table);
      for (const method of BLOCKED) {
        builder[method] = () => {
          throw new Error(`SAFETY VIOLATION: attempted DB mutation '.${method}()' on table '${table}'. Aborting.`);
        };
      }
      return builder;
    },
  };
  return safe;
}

const supabase = makeSafeReadOnlyClient();

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

const SCRATCH_DIR      = path.join(REPO_ROOT, 'scratch');
const IN_CANDIDATES    = path.join(SCRATCH_DIR, 'mrb_person_candidates_sample.json');
const OUT_MATCHED      = path.join(SCRATCH_DIR, 'mrb_matched_candidates.json');
const OUT_UNMATCHED    = path.join(SCRATCH_DIR, 'mrb_unmatched_candidates.json');
const OUT_REPORT       = path.join(SCRATCH_DIR, 'mrb_match_report.json');

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg)  { console.log(`[mrb-match] ${msg}`); }
function warn(msg) { console.warn(`[mrb-match] WARN: ${msg}`); }

// ---------------------------------------------------------------------------
// Text normalization helpers
// ---------------------------------------------------------------------------

// Normalize for comparison: lowercase, strip punctuation, collapse whitespace
function norm(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/['''""`]/g, '')       // smart quotes, backticks
    .replace(/[^a-z0-9\s]/g, ' ')   // strip non-alphanumeric (keeps spaces)
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract surname (last word, or "von X" pattern, etc.)
function surname(authorStr) {
  if (!authorStr) return '';
  const parts = norm(authorStr).split(' ').filter(Boolean);
  return parts[parts.length - 1] || '';
}

// Token overlap score (Jaccard-like on word sets)
function tokenOverlap(a, b) {
  const setA = new Set(norm(a).split(' ').filter(Boolean));
  const setB = new Set(norm(b).split(' ').filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = new Set([...setA, ...setB]).size;
  return inter / union;
}

// Is title too generic to match on title alone?
function isGenericTitle(title) {
  const words = norm(title).split(' ').filter(Boolean);
  return words.length <= 3;
}

// Blocked source hosts (should not appear as original_source_url for eligibility)
const BLOCKED_SOURCE_HOSTS = new Set([
  'amazon.com','goodreads.com','google.com','openlibrary.org',
  'mostrecommendedbooks.com','cdn.mostrecommendedbooks.com',
]);

function isBlockedHost(host) {
  if (!host) return true;
  for (const blocked of BLOCKED_SOURCE_HOSTS) {
    if (host === blocked || host.endsWith('.' + blocked)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Load all BookMentions people into memory (full table, slugs + names)
// ---------------------------------------------------------------------------

async function loadAllPeople() {
  log('Loading all people from BookMentions DB…');
  const PAGE = 1000;
  const all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('people')
      .select('id,slug,name')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`people fetch error: ${JSON.stringify(error)}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  log(`  Loaded ${all.length} people`);
  return all;
}

// ---------------------------------------------------------------------------
// Load all books for a given person_id (via book_recommendations join)
// Returns array of {id, slug, title, author_name}
// ---------------------------------------------------------------------------

async function loadBooksForPerson(personId) {
  const { data, error } = await supabase
    .from('book_recommendations')
    .select('books(id,slug,title,author_name)')
    .eq('person_id', personId)
    .limit(2000);
  if (error) throw new Error(`book_recommendations fetch error for ${personId}: ${JSON.stringify(error)}`);
  return (data || [])
    .map(r => r.books)
    .filter(b => b && b.id && b.title);
}

// ---------------------------------------------------------------------------
// Person matcher
// ---------------------------------------------------------------------------

function matchPerson(candidate, allPeople) {
  const slug = (candidate.person_slug || '').toLowerCase().trim();
  const name = (candidate.person_name || '').trim();

  // 1. Exact slug match
  const bySlug = allPeople.filter(p => p.slug === slug);
  if (bySlug.length === 1) {
    return { person: bySlug[0], status: 'exact_slug', score: 1.0 };
  }

  // 2. Exact name match (case-insensitive)
  const nameLower = name.toLowerCase();
  const byExactName = allPeople.filter(p => p.name.toLowerCase() === nameLower);
  if (byExactName.length === 1) {
    return { person: byExactName[0], status: 'exact_name', score: 1.0 };
  }
  if (byExactName.length > 1) {
    return { person: null, status: 'ambiguous', score: 0, candidates: byExactName.map(p => p.slug) };
  }

  // 3. Normalized name match
  const normName = norm(name);
  const byNorm = allPeople.filter(p => norm(p.name) === normName);
  if (byNorm.length === 1) {
    return { person: byNorm[0], status: 'normalized_name', score: 0.95 };
  }
  if (byNorm.length > 1) {
    return { person: null, status: 'ambiguous', score: 0, candidates: byNorm.map(p => p.slug) };
  }

  // 4. Fuzzy: token overlap ≥ 0.85, single candidate only
  const fuzzy = allPeople
    .map(p => ({ p, score: tokenOverlap(name, p.name) }))
    .filter(x => x.score >= 0.85)
    .sort((a, b) => b.score - a.score);
  if (fuzzy.length === 1) {
    return { person: fuzzy[0].p, status: 'fuzzy', score: fuzzy[0].score };
  }
  if (fuzzy.length > 1) {
    return { person: null, status: 'ambiguous', score: 0, candidates: fuzzy.map(x => x.p.slug) };
  }

  return { person: null, status: 'unmatched', score: 0 };
}

// ---------------------------------------------------------------------------
// Book matcher (against books already linked to a specific person)
// ---------------------------------------------------------------------------

function matchBook(candidate, personBooks) {
  const title  = (candidate.book_title  || '').trim();
  const author = (candidate.book_author || '').trim();

  if (!title) return { book: null, status: 'unmatched', score: 0, reason: 'no_title' };
  if (personBooks.length === 0) return { book: null, status: 'unmatched', score: 0, reason: 'no_person_books' };

  const normTitle  = norm(title);
  const normAuthor = norm(author);
  const authSurname = surname(author);

  // 1. Exact title + author (case-insensitive trim)
  const exact = personBooks.filter(b =>
    b.title.toLowerCase().trim() === title.toLowerCase() &&
    (b.author_name || '').toLowerCase().trim() === author.toLowerCase()
  );
  if (exact.length === 1) return { book: exact[0], status: 'exact_title_author', score: 1.0 };
  if (exact.length > 1)   return { book: null, status: 'ambiguous', score: 0, candidates: exact.map(b => b.slug) };

  // 2. Normalized title + normalized author
  const normMatch = personBooks.filter(b =>
    norm(b.title) === normTitle &&
    norm(b.author_name || '') === normAuthor
  );
  if (normMatch.length === 1) return { book: normMatch[0], status: 'normalized_title_author', score: 0.97 };
  if (normMatch.length > 1)   return { book: null, status: 'ambiguous', score: 0, candidates: normMatch.map(b => b.slug) };

  // 3. Normalized title + author surname match (guard generic titles)
  if (!isGenericTitle(title) && authSurname) {
    const surnameMatch = personBooks.filter(b =>
      norm(b.title) === normTitle &&
      surname(b.author_name) === authSurname
    );
    if (surnameMatch.length === 1) return { book: surnameMatch[0], status: 'title_author_surname', score: 0.90 };
    if (surnameMatch.length > 1)   return { book: null, status: 'ambiguous', score: 0, candidates: surnameMatch.map(b => b.slug) };
  }

  // 4. Fuzzy: token overlap ≥ 0.82 on title, AND any author token overlap > 0
  if (!isGenericTitle(title)) {
    const fuzzy = personBooks
      .map(b => ({
        b,
        titleScore:  tokenOverlap(title, b.title),
        authorScore: tokenOverlap(author, b.author_name || ''),
      }))
      .filter(x => x.titleScore >= 0.82 && x.authorScore > 0)
      .sort((a, b) => b.titleScore - a.titleScore);
    if (fuzzy.length === 1) {
      return { book: fuzzy[0].b, status: 'fuzzy', score: fuzzy[0].titleScore };
    }
    if (fuzzy.length > 1) {
      return { book: null, status: 'ambiguous', score: 0, candidates: fuzzy.map(x => x.b.slug) };
    }
  }

  return { book: null, status: 'unmatched', score: 0 };
}

// ---------------------------------------------------------------------------
// Eligibility determination
// ---------------------------------------------------------------------------

const ELIGIBLE_PERSON_STATUSES = new Set(['exact_slug','exact_name','normalized_name']);
const ELIGIBLE_BOOK_STATUSES   = new Set(['exact_title_author','normalized_title_author','title_author_surname']);
const ELIGIBLE_CONFIDENCES     = new Set(['high','medium']);

function determineEligibility(candidate, personMatch, bookMatch) {
  const reasons = [];

  if (!ELIGIBLE_PERSON_STATUSES.has(personMatch.status)) {
    reasons.push(`person_match_status:${personMatch.status}`);
  }
  if (!ELIGIBLE_BOOK_STATUSES.has(bookMatch.status)) {
    reasons.push(`book_match_status:${bookMatch.status}`);
  }
  if (!candidate.original_source_url) {
    reasons.push('missing_original_source_url');
  }
  if (isBlockedHost(candidate.original_source_host)) {
    reasons.push(`blocked_source_host:${candidate.original_source_host}`);
  }
  if (!ELIGIBLE_CONFIDENCES.has(candidate.confidence)) {
    reasons.push(`low_confidence:${candidate.confidence}`);
  }
  if (candidate.is_rejected) {
    reasons.push('candidate_is_rejected');
  }
  // Check pipe characters in key fields
  const pipeFields = ['book_title','book_author','original_source_url','source_anchor_text'];
  for (const f of pipeFields) {
    if (candidate[f] && String(candidate[f]).includes('|')) {
      reasons.push(`pipe_in_field:${f}`);
    }
  }

  const eligible = reasons.length === 0;
  return {
    eligible_for_review_import: eligible,
    ineligible_reason: eligible ? null : reasons.join('; '),
  };
}

// ---------------------------------------------------------------------------
// Bump counter
// ---------------------------------------------------------------------------

function bump(obj, key) { obj[key] = (obj[key] || 0) + 1; }

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log('=== BookMentions MRB Candidate Matching — Phase 3 ===');
  log('READ-ONLY Supabase access (anon key). No DB writes. Output: scratch/*.json');
  log('');

  // Safety: confirm no service role key is present
  const envStr = JSON.stringify(process.env);
  if (envStr.includes('service_role') || envStr.includes('SERVICE_ROLE')) {
    throw new Error('SAFETY VIOLATION: service_role key detected in environment. Aborting.');
  }
  log('Safety check PASS: no service_role key in environment');

  // Load candidates
  if (!fs.existsSync(IN_CANDIDATES)) {
    throw new Error(`Phase 2 output not found: ${IN_CANDIDATES}\nRun extract_mrb_person_candidates.js first.`);
  }
  const candidates = JSON.parse(fs.readFileSync(IN_CANDIDATES, 'utf-8'));
  log(`Loaded ${candidates.length} Phase 2 candidates`);

  // Load all people from DB
  const allPeople = await loadAllPeople();

  // Index people by slug for fast lookup (also keep full list for fuzzy)
  const peopleBySlug = new Map(allPeople.map(p => [p.slug, p]));

  // Cache: person_id → their books in BookMentions
  const booksByPersonId = new Map();
  async function getPersonBooks(personId) {
    if (!booksByPersonId.has(personId)) {
      const books = await loadBooksForPerson(personId);
      booksByPersonId.set(personId, books);
    }
    return booksByPersonId.get(personId);
  }

  // Report accumulators
  const personMatchCounts = {};
  const bookMatchCounts   = {};
  const confidenceCounts  = {};
  const sourceTypeCounts  = {};
  const ineligibleReasons = {};
  let reviewRequiredCount = 0;
  let eligibleCount       = 0;

  const matched   = [];  // person matched (may or may not have book match)
  const unmatched = [];  // person unmatched

  const personUnmatchedExamples = [];
  const bookUnmatchedExamples   = [];
  const ambiguousExamples       = [];
  const eligibleExamples        = [];

  log(`\nMatching ${candidates.length} candidates…`);

  let processed = 0;
  for (const candidate of candidates) {
    processed++;
    if (processed % 100 === 0) log(`  … ${processed}/${candidates.length}`);

    // Tally metadata
    bump(confidenceCounts, candidate.confidence || 'unknown');
    bump(sourceTypeCounts, candidate.source_type || 'unknown');
    if (candidate.review_required) reviewRequiredCount++;

    // --- Person match ---
    const personMatch = matchPerson(candidate, allPeople);
    bump(personMatchCounts, personMatch.status);

    // --- Book match (only if person matched) ---
    let bookMatch = { book: null, status: 'skipped_person_unmatched', score: 0 };
    if (personMatch.person) {
      const personBooks = await getPersonBooks(personMatch.person.id);
      bookMatch = matchBook(candidate, personBooks);
    }
    bump(bookMatchCounts, bookMatch.status);

    // --- Eligibility ---
    const { eligible_for_review_import, ineligible_reason } = determineEligibility(
      candidate, personMatch, bookMatch
    );
    if (eligible_for_review_import) eligibleCount++;
    if (ineligible_reason) {
      for (const part of ineligible_reason.split('; ')) {
        bump(ineligibleReasons, part);
      }
    }

    // --- Assemble output row ---
    const row = {
      // Phase 2 passthrough fields
      source:                  candidate.source,
      person_name:             candidate.person_name,
      person_slug:             candidate.person_slug,
      person_page_url:         candidate.person_page_url,
      book_title:              candidate.book_title,
      book_author:             candidate.book_author,
      book_url_on_mrb:         candidate.book_url_on_mrb,
      original_source_url:     candidate.original_source_url,
      original_source_host:    candidate.original_source_host,
      source_type:             candidate.source_type,
      confidence:              candidate.confidence,
      review_required:         candidate.review_required,
      review_reason:           candidate.review_reason,
      multi_book_source_count: candidate.multi_book_source_count,

      // Person match results
      bookmentions_person_id:   personMatch.person?.id   || null,
      bookmentions_person_slug: personMatch.person?.slug || null,
      bookmentions_person_name: personMatch.person?.name || null,
      person_match_status:      personMatch.status,
      person_match_score:       personMatch.score,

      // Book match results
      bookmentions_book_id:     bookMatch.book?.id          || null,
      bookmentions_book_slug:   bookMatch.book?.slug        || null,
      bookmentions_book_title:  bookMatch.book?.title       || null,
      bookmentions_book_author: bookMatch.book?.author_name || null,
      book_match_status:        bookMatch.status,
      book_match_score:         bookMatch.score,

      // Eligibility
      eligible_for_review_import,
      ineligible_reason,
    };

    // Route to matched vs unmatched
    if (personMatch.person) {
      matched.push(row);
    } else {
      unmatched.push(row);
      if (personUnmatchedExamples.length < 10) {
        personUnmatchedExamples.push({ person_name: candidate.person_name, person_slug: candidate.person_slug });
      }
    }

    // Collect examples
    if (bookMatch.status === 'unmatched' && bookUnmatchedExamples.length < 10) {
      bookUnmatchedExamples.push({ person: candidate.person_name, title: candidate.book_title, author: candidate.book_author });
    }
    if ((personMatch.status === 'ambiguous' || bookMatch.status === 'ambiguous') && ambiguousExamples.length < 5) {
      ambiguousExamples.push({
        person: candidate.person_name, title: candidate.book_title,
        person_status: personMatch.status, book_status: bookMatch.status,
        person_candidates: personMatch.candidates,
        book_candidates: bookMatch.candidates,
      });
    }
    if (eligible_for_review_import && eligibleExamples.length < 20) {
      eligibleExamples.push(row);
    }
  }

  // Build top matched people and books
  const matchedPersonCounts = {};
  const matchedBookCounts   = {};
  for (const row of matched) {
    if (row.bookmentions_person_name) bump(matchedPersonCounts, row.bookmentions_person_name);
    if (row.bookmentions_book_title && row.book_match_status !== 'unmatched' && row.book_match_status !== 'skipped_person_unmatched') {
      bump(matchedBookCounts, row.bookmentions_book_title);
    }
  }
  const topMatchedPeople = Object.entries(matchedPersonCounts)
    .sort((a,b) => b[1]-a[1]).slice(0,15)
    .map(([name, count]) => ({ name, count }));
  const topMatchedBooks = Object.entries(matchedBookCounts)
    .sort((a,b) => b[1]-a[1]).slice(0,15)
    .map(([title, count]) => ({ title, count }));

  // Write outputs
  log('\n[Writing output files]');
  fs.writeFileSync(OUT_MATCHED,   JSON.stringify(matched,   null, 2), 'utf-8');
  fs.writeFileSync(OUT_UNMATCHED, JSON.stringify(unmatched, null, 2), 'utf-8');
  log(`Wrote ${matched.length} matched   → ${OUT_MATCHED}`);
  log(`Wrote ${unmatched.length} unmatched → ${OUT_UNMATCHED}`);

  // Build report
  const report = {
    generated_at:             new Date().toISOString(),
    phase:                    3,
    input_candidates:         candidates.length,
    matched_candidates:       matched.length,
    unmatched_candidates:     unmatched.length,
    eligible_for_review_import: eligibleCount,

    person_match_counts:      personMatchCounts,
    book_match_counts:        bookMatchCounts,
    confidence_counts:        confidenceCounts,
    source_type_counts:       sourceTypeCounts,
    review_required_count:    reviewRequiredCount,
    ineligible_reasons:       ineligibleReasons,

    top_matched_people:       topMatchedPeople,
    top_matched_books:        topMatchedBooks,
    person_unmatched_examples: personUnmatchedExamples,
    book_unmatched_examples:  bookUnmatchedExamples,
    ambiguous_examples:       ambiguousExamples,
    eligible_examples:        eligibleExamples,

    no_db_writes: true,
    safety_notes: [
      'Read-only Supabase access via public anon key only.',
      'Mutation methods (insert/update/delete/upsert/rpc) are blocked at runtime by proxy.',
      'No service_role key used or referenced.',
      'No production table writes.',
      'Output is review-only JSON in scratch/.',
      'eligible_for_review_import does NOT mean safe to write — human review still required.',
    ],
  };

  fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2), 'utf-8');
  log(`Wrote report → ${OUT_REPORT}`);

  // Console summary
  log('\n=== Matching complete ===');
  log(`Input candidates:          ${candidates.length}`);
  log(`Person-matched rows:       ${matched.length}`);
  log(`Person-unmatched rows:     ${unmatched.length}`);
  log(`Eligible for review import:${eligibleCount}`);
  log(`Review required:           ${reviewRequiredCount}`);
  log('\nPerson match breakdown:');
  for (const [s,c] of Object.entries(personMatchCounts)) log(`  ${String(c).padStart(4)}  ${s}`);
  log('\nBook match breakdown:');
  for (const [s,c] of Object.entries(bookMatchCounts)) log(`  ${String(c).padStart(4)}  ${s}`);
  log('\nTop ineligible reasons:');
  for (const [r,c] of Object.entries(ineligibleReasons).sort((a,b)=>b[1]-a[1]).slice(0,10)) {
    log(`  ${String(c).padStart(4)}  ${r}`);
  }
  log('\nNO DB WRITES PERFORMED. Ready for review.');
}

main().catch(err => {
  console.error('[mrb-match] FATAL:', err);
  process.exit(1);
});
