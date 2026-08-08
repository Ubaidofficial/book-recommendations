#!/usr/bin/env node
/**
 * enrich_and_publish_lists.js
 * Generates SEO-optimized descriptions for draft lists and publishes them in batches.
 *
 * Guardrails:
 *  - Only enriches lists with book_count >= 30 (enough content to be non-thin)
 *  - Skips corrupted/duplicate slugs (e.g. "parentingrelationships-family")
 *  - Generates rich, ICP-focused descriptions referencing the actual book count
 *  - Applies strict meta_title and meta_description SEO templates
 *  - Writes to Supabase and marks as published
 *
 * Usage:
 *   node scripts/import/enrich_and_publish_lists.js            # Dry-run preview
 *   node scripts/import/enrich_and_publish_lists.js --write    # Live publish
 *   BATCH_SIZE=10 node scripts/import/enrich_and_publish_lists.js --write
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const isDryRun = !process.argv.includes('--write');
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10', 10);
const MIN_BOOK_COUNT = parseInt(process.env.MIN_BOOK_COUNT || '30', 10);

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

// --- Slug quality filters ---
// Reject obviously corrupted/merged slugs (concatenated category names)
const CORRUPTED_SLUG_PATTERNS = [
  /^(parenting|teen|mystery|business|social)(relationships|young|crime|finance|sciences)/i,
  /[a-z]{3,}[A-Z][a-z]{2,}/,  // camelCase run-ons
];
function isCorruptedSlug(slug) {
  if (!slug || slug.trim().length === 0) return true; // empty slug
  for (const re of CORRUPTED_SLUG_PATTERNS) {
    if (re.test(slug)) return true;
  }
  // Also reject slugs with internal repetition of category words
  if (slug.length > 50) return true;
  return false;
}

// --- Description Generator ---
// Tailored, ICP-focused descriptions for genre/category lists
const DESCRIPTION_TEMPLATES = {
  // Exact slug matches first
  'psychology': (n) => `Discover the ${n} most recommended psychology books, curated from reading lists of founders, executives, therapists, and thought leaders. Explore titles on cognitive biases, behavioral science, human motivation, and mental models that top readers recommend.`,
  'philosophy': (n) => `A curated collection of ${n} philosophy books most frequently recommended by academics, entrepreneurs, and public intellectuals. From Stoicism to existentialism, these titles shape how the world's leading thinkers reason and decide.`,
  'fantasy': (n) => `Explore ${n} fantasy books recommended by avid readers, authors, and cultural figures. From epic world-building to intimate character-driven magic, these are the fantasy novels that top readers return to again and again.`,
  'historical-fiction': (n) => `Browse ${n} historical fiction books recommended by historians, novelists, and prolific readers. These titles transport readers across centuries with richly researched narratives and compelling characters drawn from real eras.`,
  'technology': (n) => `A selection of ${n} technology books most recommended by founders, engineers, investors, and tech executives. From AI and software to internet history and the future of computing, these books define how Silicon Valley thinks.`,
  'politics': (n) => `Discover ${n} politics books recommended by politicians, journalists, policy experts, and engaged citizens. These titles span political theory, governance, campaign strategy, and the history of power.`,
  'finance': (n) => `Explore ${n} finance books recommended by investors, fund managers, entrepreneurs, and financial journalists. From personal finance fundamentals to advanced investment strategies, these books form the reading canon of the financial world.`,
  'mystery-crime': (n) => `Browse ${n} mystery and crime books recommended by detectives, crime writers, and thriller enthusiasts. These titles range from classic whodunits to modern procedurals loved by top readers worldwide.`,
  'science-fiction': (n) => `Discover ${n} science fiction books recommended by technologists, futurists, writers, and visionaries. These titles explore artificial intelligence, space exploration, dystopian societies, and the long arc of human progress.`,
  'teen-young-adult': (n) => `A curated list of ${n} young adult books most recommended by educators, librarians, parents, and young readers. These coming-of-age stories, fantasy epics, and contemporary novels resonate across generations.`,
  'leadership': (n) => `Explore ${n} leadership books most recommended by CEOs, executives, military officers, and management consultants. These titles on influence, decision-making, organizational culture, and strategic thinking are essential reads for leaders at every level.`,
  'programming': (n) => `Discover ${n} programming books recommended by senior engineers, CTOs, and software architects. From algorithms and data structures to system design and clean code principles, these are the technical books developers actually read.`,
  'hobbies': (n) => `Browse ${n} books about hobbies and leisure pursuits, recommended by enthusiasts and experts across cooking, crafts, sports, music, and creative arts.`,
  'spirituality': (n) => `A curated collection of ${n} spirituality books recommended by spiritual leaders, meditators, philosophers, and seekers. From Eastern wisdom traditions to contemplative Christian texts, these books guide inner growth and meaning-making.`,
  'sports': (n) => `Explore ${n} sports books recommended by athletes, coaches, sports journalists, and dedicated fans. These titles span athletic memoir, training science, team dynamics, and the psychology of peak performance.`,
  'health': (n) => `Discover ${n} health books recommended by doctors, nutritionists, fitness experts, and wellness advocates. From evidence-based medicine to lifestyle interventions, these are the books shaping how we think about physical and mental wellbeing.`,
  'romance': (n) => `Browse ${n} romance books recommended by avid readers, romance authors, and book club favorites. These stories of love, connection, and emotional depth are among the most recommended titles in contemporary fiction.`,
  'art': (n) => `A curated collection of ${n} art books recommended by artists, designers, curators, and creative professionals. Spanning visual art, design history, creative process, and art criticism, these books are essential for anyone who makes or loves art.`,
  'adult': (n) => `Explore ${n} books for adult readers, recommended across fiction and nonfiction genres by thought leaders, creatives, and prolific readers looking for substantive, engaging reads.`,
  'travel': (n) => `Discover ${n} travel books recommended by adventurers, travel writers, and global explorers. From literary travel memoir to practical guides and cultural deep-dives, these books inspire and inform journeys around the world.`,
  'humor': (n) => `Browse ${n} humor and comedy books recommended by comedians, writers, and fans of wit. These titles range from sharp satire and absurdist fiction to laugh-out-loud essays that have delighted readers worldwide.`,
  'thriller-suspense': (n) => `Explore ${n} thriller and suspense books recommended by crime writers, avid mystery readers, and fans of edge-of-your-seat storytelling. These page-turners span espionage, psychological thrillers, legal drama, and action.`,
  'food': (n) => `A curated collection of ${n} food books recommended by chefs, food writers, nutritionists, and culinary enthusiasts. From cookbooks and food memoir to culinary history and nutrition science, these are the essential reads for food lovers.`,
  'parenting': (n) => `Discover ${n} parenting books most recommended by pediatricians, child psychologists, educators, and experienced parents. These titles offer evidence-based guidance, practical wisdom, and compassionate frameworks for raising children.`,
  'american-history': (n) => `Browse ${n} American history books recommended by historians, politicians, journalists, and history enthusiasts. These titles chronicle the founding, growth, conflicts, and ongoing evolution of the United States.`,
  'lgbtq': (n) => `A curated collection of ${n} LGBTQ+ books recommended by queer authors, advocates, scholars, and community members. Spanning memoir, fiction, theory, and history, these titles amplify and celebrate LGBTQ+ voices and experiences.`,
  'relationships-family': (n) => `Explore ${n} books on relationships and family recommended by therapists, couples counselors, sociologists, and relationship experts. These titles offer insights into communication, attachment, love, and the dynamics of modern family life.`,
  'mystery-crimefiction': null, // skip corrupted slug
  'foodhobbies': null,          // skip corrupted slug
  'parentingrelationships-family': null, // skip corrupted slug
  'teen-young': (n) => `A curated list of ${n} books for teens and young readers, recommended by educators, librarians, YA authors, and parents. These titles span contemporary fiction, fantasy, coming-of-age stories, and inspiring memoirs for young audiences.`,
  'writing': (n) => `Discover ${n} books on writing recommended by bestselling authors, writing coaches, journalists, and creative writing professors. From narrative craft and storytelling to grammar, style, and the writer's mindset, these are the essential books for writers.`,
  'memoir': (n) => `Browse ${n} memoir books recommended by readers, editors, and writers who value personal narrative. These are the first-person stories — from celebrity memoir to literary autobiography — that shaped how we understand human experience.`,
  'economics': (n) => `Explore ${n} economics books recommended by economists, investors, policymakers, and curious thinkers. From behavioral economics and macroeconomic theory to the economics of everyday life, these are the titles that explain how the world works.`,
  'entrepreneurship': (n) => `Discover ${n} entrepreneurship books recommended by founders, VCs, startup accelerators, and business journalists. These titles on building companies, raising capital, and leading teams are essential reading for anyone starting or scaling a business.`,
  'management': (n) => `A curated collection of ${n} management books recommended by executives, business school professors, and organizational consultants. These titles on team leadership, strategy, operations, and organizational culture define modern management thinking.`,
  'self-help': (n) => `Explore ${n} self-help books most recommended by coaches, psychologists, entrepreneurs, and personal development advocates. From productivity systems to mindset shifts and relationship building, these books help readers take meaningful action.`,
  'biography': (n) => `Browse ${n} biography books recommended by historians, journalists, educators, and avid readers. These true stories of remarkable lives — from political leaders and scientists to artists and athletes — offer lessons, inspiration, and deep human insight.`,
  'religion': (n) => `A curated collection of ${n} religion books recommended by theologians, scholars, clergy, and spiritual seekers. Spanning sacred texts, theological commentary, religious history, and interfaith dialogue, these titles illuminate faith and its role in human life.`,
  'education': (n) => `Discover ${n} education books recommended by teachers, school administrators, educational researchers, and learning advocates. These titles on pedagogy, cognitive science, school reform, and the future of learning shape how we think about education.`,
  'environment': (n) => `Explore ${n} environment and nature books recommended by scientists, activists, conservationists, and nature writers. These titles address climate change, ecology, biodiversity, and humanity's relationship with the natural world.`,
  'military': (n) => `Browse ${n} military history and strategy books recommended by veterans, military historians, defense analysts, and strategy professionals. These titles cover warfare, military leadership, geopolitics, and the human cost of conflict.`,
  'investing': (n) => `Discover ${n} investing books recommended by professional investors, fund managers, financial advisors, and market veterans. From value investing and quantitative finance to behavioral investor psychology, these are the most-read books in the investment world.`,
  'design': (n) => `A curated collection of ${n} design books recommended by graphic designers, product designers, UX professionals, and creative directors. Spanning typography, visual communication, industrial design, and the philosophy of good design.`,
  'marketing': (n) => `Explore ${n} marketing books most recommended by CMOs, growth marketers, brand strategists, and startup founders. From consumer psychology and content strategy to growth hacking and brand building, these titles define modern marketing thinking.`,
  'creativity': (n) => `Discover ${n} creativity books recommended by artists, writers, designers, and innovators. These titles explore the creative process, how to sustain inspiration, overcome creative blocks, and build a life around original work.`,
  'classics': (n) => `Browse ${n} classic books recommended by literature professors, avid readers, and cultural critics. These enduring works of fiction, philosophy, and history have shaped the Western literary canon and continue to resonate across generations.`,
  'poetry': (n) => `A curated collection of ${n} poetry books recommended by poets, literary scholars, and devoted readers of verse. From ancient epic poetry to contemporary spoken word, these are the collections that define the art of the poem.`,
  'nutrition': (n) => `Discover ${n} nutrition books recommended by registered dietitians, sports nutritionists, doctors, and wellness researchers. These titles cover evidence-based dietary science, food systems, gut health, and practical approaches to eating well.`,
  'fitness': (n) => `Explore ${n} fitness books recommended by personal trainers, sports scientists, elite athletes, and health coaches. From strength training and endurance sports to mobility, recovery, and the psychology of physical performance.`,
  'productivity': (n) => `Browse ${n} productivity books most recommended by executives, entrepreneurs, and knowledge workers. These titles on time management, focus, systems thinking, and deep work help ambitious people accomplish more meaningful work.`,
  'culture': (n) => `Discover ${n} culture books recommended by cultural critics, journalists, anthropologists, and artists. These titles explore art movements, pop culture, social trends, and the forces that shape how societies think, create, and communicate.`,
  'architecture': (n) => `A curated collection of ${n} architecture books recommended by architects, urban planners, designers, and city enthusiasts. Spanning architectural history, building theory, iconic structures, and the relationship between space and human experience.`,
  'music': (n) => `Browse ${n} music books recommended by musicians, music journalists, producers, and devoted listeners. These titles cover the history of genres, the lives of legendary artists, music theory, and the cultural impact of sound.`,
  'media': (n) => `Explore ${n} media and journalism books recommended by journalists, editors, media critics, and communications professionals. These titles examine the role of press, digital media, propaganda, and storytelling in shaping public opinion.`,
  'gender': (n) => `Discover ${n} books on gender recommended by feminist scholars, sociologists, activists, and cultural critics. These titles explore gender identity, feminism, masculinity, and the social construction of gender across history and culture.`,
  'race': (n) => `Browse ${n} books on race recommended by scholars, activists, historians, and writers committed to racial justice. These titles explore systemic racism, civil rights history, identity, and the ongoing struggle for equality.`,
  'sociology': (n) => `A curated collection of ${n} sociology books recommended by sociologists, social scientists, policy researchers, and curious readers. These titles explain how society works, how groups form, and the social forces that shape human behavior.`,
  'anthropology': (n) => `Discover ${n} anthropology books recommended by anthropologists, archaeologists, and travelers. These titles explore human origins, cultural diversity, social structures, and what it means to be human across time and place.`,
};

// Fallback template for unrecognized slugs
function generateDescription(slug, title, bookCount) {
  if (DESCRIPTION_TEMPLATES[slug] === null) return null; // explicitly skip
  if (DESCRIPTION_TEMPLATES[slug]) {
    return DESCRIPTION_TEMPLATES[slug](bookCount);
  }
  // Generic fallback: clean up slug to readable phrase
  const readableSlug = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return `Discover the ${bookCount} most recommended ${readableSlug} books, curated from reading lists of top thinkers, executives, creatives, and intellectuals. These are the titles serious readers recommend most.`;
}

function generateMetaTitle(title, slug, bookCount) {
  // Strip "best-" prefix and "-books" suffix from slug for clean category extraction
  let category = slug
    .replace(/^best-/, '')           // remove leading "best-"
    .replace(/-books$/, '')          // remove trailing "-books"
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

  // If title is better (less concatenated), use that — but strip leading "Best " and trailing " Books"
  if (title && title.length > 0 && title.length < 40) {
    category = title
      .replace(/^Best\s+/i, '')
      .replace(/\s+Books$/i, '')
      .trim();
  }

  return `Best ${category} Books (${bookCount}+ Recommendations) | BookRecommendations.com`;
}

function generateMetaDescription(slug, title, bookCount) {
  const desc = generateDescription(slug, title, bookCount);
  if (!desc) return null;
  // Trim to 160 chars for meta description
  return desc.length > 160 ? desc.slice(0, 157) + '...' : desc;
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`📚 List Enrichment & Publishing Pipeline`);
  console.log(`Mode: ${isDryRun ? '🔍 PREVIEW (Dry Run)' : '⚡ LIVE WRITE'}`);
  console.log(`Batch Size: ${BATCH_SIZE} | Min Book Count: ${MIN_BOOK_COUNT}`);
  console.log(`==================================================\n`);

  // Fetch all draft lists with enough books
  const { data: lists, error } = await sb
    .from('lists')
    .select('id, slug, title, description, book_count, quality_score, meta_title, meta_description, index_status')
    .eq('index_status', 'draft')
    .gte('book_count', MIN_BOOK_COUNT)
    .order('book_count', { ascending: false });

  if (error) {
    console.error('❌ Supabase query error:', error.message);
    process.exit(1);
  }

  console.log(`Found ${lists.length} draft lists with >= ${MIN_BOOK_COUNT} books.\n`);

  // Filter and score candidates
  const candidates = [];
  for (const l of lists) {
    // Skip empty/corrupted slugs
    if (isCorruptedSlug(l.slug)) {
      console.log(`⏭️  SKIP [corrupted slug]: ${l.slug}`);
      continue;
    }

    // Skip corrupted or placeholder titles
    if (!l.title || l.title.trim().length <= 1 || /^\.+$/.test(l.title.trim())) {
      console.log(`⏭️  SKIP [invalid title]: slug=${l.slug} title='${l.title}'`);
      continue;
    }

    // Skip if explicitly marked null (bad slug)
    if (DESCRIPTION_TEMPLATES[l.slug] === null) {
      console.log(`⏭️  SKIP [explicitly excluded]: ${l.slug}`);
      continue;
    }

    const desc = generateDescription(l.slug, l.title, l.book_count || 0);
    const metaTitle = generateMetaTitle(l.title, l.slug, l.book_count || 0);
    const metaDesc = generateMetaDescription(l.slug, l.title, l.book_count || 0);

    if (!desc || desc.length < 30) {
      console.log(`⏭️  SKIP [no description generated]: ${l.slug}`);
      continue;
    }

    candidates.push({
      id: l.id,
      slug: l.slug,
      title: l.title,
      book_count: l.book_count,
      current_description: l.description,
      proposed_description: desc,
      proposed_meta_title: metaTitle,
      proposed_meta_description: metaDesc,
      score: l.book_count || 0,
    });
  }

  // Sort by book_count desc, take batch
  candidates.sort((a, b) => b.score - a.score);
  const batch = candidates.slice(0, BATCH_SIZE);

  console.log(`\n📊 Enrichment Preview (top ${batch.length} of ${candidates.length} candidates):\n`);
  for (let i = 0; i < batch.length; i++) {
    const c = batch[i];
    console.log(`${i + 1}. [${c.slug}] (${c.book_count} books)`);
    console.log(`   Title: ${c.title}`);
    console.log(`   Meta Title: ${c.proposed_meta_title}`);
    console.log(`   Description: ${c.proposed_description.slice(0, 120)}...`);
    console.log('');
  }

  if (isDryRun) {
    console.log(`==================================================`);
    console.log(`🔍 Dry run complete. ${batch.length} lists would be enriched & published.`);
    console.log(`Run with --write to apply changes.`);
    console.log(`==================================================\n`);
    return;
  }

  // Live write
  console.log(`\n⚡ Applying enrichments and publishing ${batch.length} lists...\n`);
  let successCount = 0;
  let failCount = 0;

  for (const c of batch) {
    const now = new Date().toISOString();
    const updates = {
      description: c.proposed_description,
      meta_title: c.proposed_meta_title,
      meta_description: c.proposed_meta_description,
      index_status: 'published',
      published_at: now,
      updated_at: now,
    };

    const { error: updateErr } = await sb
      .from('lists')
      .update(updates)
      .eq('id', c.id);

    if (updateErr) {
      console.error(`  ❌ FAIL: ${c.slug} — ${updateErr.message}`);
      failCount++;
    } else {
      console.log(`  ✅ PUBLISHED: /lists/${c.slug} (${c.book_count} books)`);
      successCount++;
    }
  }

  console.log(`\n==================================================`);
  console.log(`✅ Done! Published: ${successCount} | Failed: ${failCount}`);
  console.log(`Total published lists will be visible at /lists/[slug]`);
  console.log(`==================================================\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
