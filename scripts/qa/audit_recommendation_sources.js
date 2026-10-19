#!/usr/bin/env node
/**
 * audit_recommendation_sources.js
 *
 * Read-only audit of how well the recommendations on PUBLISHED people pages
 * are actually sourced. The site says things like "Each pick links back to its
 * original source" — this measures whether that is true, per person.
 *
 * Per person it reports:
 *   - recs / with_url / no_url / pct_no_url   (source_url present at all)
 *   - own_site_urls   source URLs on a host that looks like the person's own
 *                     site (host contains the squashed name, e.g. jamesclear)
 *   - reply_quotes    quotes beginning "@" (a reply to someone else, which is
 *                     not the person recommending the book)
 *   - top_hosts       the three most common source hosts
 *
 * What it can NOT tell you is whether a given URL really is that person
 * recommending that book — only a human reading the source can. A person whose
 * sources are all third-party sites (another author's blog, a list compiled by
 * someone else) is flagged for review, not declared wrong.
 *
 * SAFETY: SELECT-only, anon key. Writes nothing to the database.
 *
 * OUTPUT: console summary + scripts/qa/output/recommendation_sources_report.csv
 * USAGE:  node scripts/qa/audit_recommendation_sources.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Public, read-only key — the same one committed in src/app/sitemap.ts.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ghpdpvatfmvsahzsqgpp.supabase.co';
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z';
const PUBLISHED = ['published', 'approved', 'indexed', 'index'];
const PAGE = 1000;

const sb = createClient(SUPABASE_URL, ANON_KEY);

async function fetchAll(build) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build().range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '(unparseable)';
  }
}

const squash = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function main() {
  const people = await fetchAll(() =>
    sb.from('people').select('id,slug,name').in('index_status', PUBLISHED).order('id')
  );
  if (people.length === 0) {
    console.error('Scanned 0 published people — refusing to report a clean result.');
    process.exit(1);
  }
  const byId = new Map(people.map((p) => [p.id, p]));
  const recs = await fetchAll(() =>
    sb
      .from('book_recommendations')
      .select('id,person_id,source_url,quote')
      .in('person_id', people.map((p) => p.id))
      .order('id')
  );

  const stats = new Map(
    people.map((p) => [p.id, { recs: 0, withUrl: 0, ownSite: 0, replyQuotes: 0, hosts: new Map() }])
  );
  for (const r of recs) {
    const s = stats.get(r.person_id);
    if (!s) continue;
    s.recs += 1;
    if (r.quote && r.quote.trim().startsWith('@')) s.replyQuotes += 1;
    if (r.source_url && r.source_url.trim()) {
      s.withUrl += 1;
      const host = hostOf(r.source_url);
      s.hosts.set(host, (s.hosts.get(host) || 0) + 1);
      const key = squash(byId.get(r.person_id).name);
      if (key && squash(host).includes(key)) s.ownSite += 1;
    }
  }

  const rows = people
    .map((p) => {
      const s = stats.get(p.id);
      const noUrl = s.recs - s.withUrl;
      const topHosts = [...s.hosts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([h, n]) => `${h} (${n})`)
        .join('; ');
      return {
        slug: p.slug,
        name: p.name,
        recs: s.recs,
        with_url: s.withUrl,
        no_url: noUrl,
        pct_no_url: s.recs ? Math.round((1000 * noUrl) / s.recs) / 10 : 0,
        own_site_urls: s.ownSite,
        reply_quotes: s.replyQuotes,
        top_hosts: topHosts,
      };
    })
    .sort((a, b) => b.no_url - a.no_url);

  const totalRecs = rows.reduce((n, r) => n + r.recs, 0);
  const totalNoUrl = rows.reduce((n, r) => n + r.no_url, 0);
  const mostlyUnsourced = rows.filter((r) => r.recs > 0 && r.no_url * 2 > r.recs);
  const noOwnSite = rows.filter((r) => r.recs > 0 && r.own_site_urls === 0);

  console.log(`People scanned:            ${rows.length}`);
  console.log(`Recommendations:           ${totalRecs}`);
  console.log(`  without any source URL:  ${totalNoUrl} (${((100 * totalNoUrl) / totalRecs).toFixed(1)}%)`);
  console.log(`People >50% unsourced:     ${mostlyUnsourced.length}`);
  console.log(`People with 0 own-site URL:${noOwnSite.length}  (not an error by itself — review the hosts)`);
  console.log('\nMost unsourced recommendations:');
  for (const r of rows.slice(0, 15)) {
    console.log(`  ${r.slug.padEnd(24)} ${String(r.no_url).padStart(4)}/${String(r.recs).padEnd(4)} (${r.pct_no_url}%)  ${r.top_hosts}`);
  }

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const cols = Object.keys(rows[0]);
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const outFile = path.join(outDir, 'recommendation_sources_report.csv');
  fs.writeFileSync(outFile, csv);
  console.log(`\nCSV: ${path.relative(process.cwd(), outFile)}`);
}

main().catch((e) => {
  console.error('Audit failed:', e.message);
  process.exit(1);
});
