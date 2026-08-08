#!/usr/bin/env node
/**
 * enrich_people_metadata.js
 * Automatically enrich draft people profiles in the database with job roles,
 * Wikipedia biographies, and safety-verified Wikimedia Commons avatars.
 *
 * Safety Model:
 *   - DRY RUN by default. Use --write to actually write back to the database.
 *   - Requires SUPABASE_SECRET_KEY / SUPABASE_SERVICE_KEY for writes.
 *   - Creates a backup CSV file in scratch/ before committing any changes.
 *   - Filters out profileless single-word surname aliases (requires name to contain space).
 *   - Respects Wikidata/Wikimedia polite crawler limits (1.5s delay).
 *
 * Usage:
 *   node scripts/import/enrich_people_metadata.js             # Dry run (Top 25 draft people)
 *   LIMIT=50 node scripts/import/enrich_people_metadata.js    # Dry run with custom limit
 *   node scripts/import/enrich_people_metadata.js --write     # Live write back to Supabase
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');

// Parse flags
const isWrite = process.argv.includes('--write');
const LIMIT = parseInt(process.env.LIMIT || '25', 10);
const UA = "BookMentionsEnrichmentBot/1.0 (+https://bookmentions.net; contact: team@bookmentions.net)";
const MIN_DELAY_MS = 1500; // polite rate limit

function log(msg) { console.log(`[enrich-people] ${msg}`); }
function warn(msg) { console.warn(`[enrich-people] WARN: ${msg}`); }

// ---------------------------------------------------------------------------
// Load Env
// ---------------------------------------------------------------------------
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
const SCRATCH_DIR = path.join(__dirname, '../../scratch');

// ---------------------------------------------------------------------------
// API Helpers (Wikidata, Wikipedia, Wikimedia Commons)
// ---------------------------------------------------------------------------
function fetchJson(url) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const req = https.request({
        method: "GET",
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { "User-Agent": UA, "Accept": "application/json" },
        timeout: 15000,
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = res.headers.location.startsWith("http") ? res.headers.location : "https://" + u.hostname + res.headers.location;
          return fetchJson(next).then(resolve);
        }
        const c = [];
        res.on("data", (x) => c.push(x));
        res.on("end", () => {
          const body = Buffer.concat(c).toString("utf-8");
          try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
          catch { resolve({ status: res.statusCode, body: null, raw: body }); }
        });
      });
      req.on("error", (e) => resolve({ status: 0, error: e.message }));
      req.on("timeout", () => { req.destroy(); resolve({ status: 0, error: "timeout" }); });
      req.end();
    } catch (e) { resolve({ status: 0, error: e.message }); }
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function wikidataSearch(name) {
  const url = "https://www.wikidata.org/w/api.php?action=wbsearchentities&search=" +
    encodeURIComponent(name) + "&language=en&format=json&type=item&limit=10";
  const r = await fetchJson(url);
  if (!r.body || !r.body.search) return [];
  return r.body.search.map((c) => ({
    qid: c.id, label: c.label || "", description: c.description || "",
    url: c.url || c.concepturi || "",
  }));
}

function scoreCandidate(personName, c) {
  const desc = (c.description || "").toLowerCase();
  const label = (c.label || "").toLowerCase();
  const name = (personName || "").toLowerCase();
  let score = 0;
  // Exact/close label match
  if (label === name) score += 5;
  else if (label.replace(/\./g, "") === name.replace(/\./g, "")) score += 4;
  // Nationality boost (common for notable public figures)
  if (desc.includes("american") || desc.includes("british") || desc.includes("canadian") || desc.includes("indian") || desc.includes("australian")) score += 1;
  // High-value professional keywords
  for (const kw of [
    "author", "writer", "investor", "founder", "entrepreneur", "podcaster",
    "podcast host", "philosopher", "businessman", "businesswoman", "psychologist",
    "blogger", "designer", "politician", "u.s. president", "talk show host",
    "professor", "essayist", "navy seal", "navy officer", "computer scientist",
    "linguist", "statistician", "mathematician", "physicist", "scientist",
    "general", "secretary of defense", "military officer", "marine general",
    "admiral", "governor", "senator", "minister", "public servant",
    "chief executive", "venture capitalist", "activist", "journalist",
    "broadcaster", "comedian", "actor", "neurosurgeon", "surgeon",
  ]) {
    if (desc.includes(kw)) { score += 2; break; }
  }
  // Negative signals — generic or wrong-type results
  if (desc.includes("disambiguation")) score -= 5;
  if (desc.includes("fictional character")) score -= 5;
  if (desc.includes("manga") || desc.includes("anime")) score -= 4;
  // Sports athlete with no public figure signal — likely wrong match
  const isSportsOnly = (desc.includes("cyclist") || desc.includes("bicycle racer") ||
    desc.includes("football player") || desc.includes("basketball player") ||
    desc.includes("baseball player") || desc.includes("soccer player") ||
    desc.includes("tennis player") || desc.includes("swimmer") ||
    desc.includes("triathlete") || desc.includes("sprinter") ||
    desc.includes("wrestler") || desc.includes("racing driver"));
  if (isSportsOnly && !desc.includes("author") && !desc.includes("entrepreneur") && !desc.includes("politician")) score -= 3;
  return score;
}

async function wikidataGetEntityDetails(qid) {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&format=json&props=sitelinks|claims|descriptions&languages=en`;
  const r = await fetchJson(url);
  if (!r.body || !r.body.entities || !r.body.entities[qid]) return null;
  const entity = r.body.entities[qid];
  
  // Image (P18)
  let imageName = null;
  const p18 = entity.claims?.P18;
  if (p18 && p18.length) {
    for (const claim of p18) {
      if (claim.rank === "deprecated") continue;
      const fn = claim.mainsnak?.datavalue?.value;
      if (fn) { imageName = fn; break; }
    }
  }

  // Wikipedia Sitelink
  const wikiTitle = entity.sitelinks?.enwiki?.title || null;

  // Description
  const description = entity.descriptions?.en?.value || null;

  return { imageName, wikiTitle, description };
}

async function fetchWikipediaIntro(title) {
  const url = "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&titles=" +
    encodeURIComponent(title) + "&format=json&redirects=1";
  const r = await fetchJson(url);
  if (!r.body || !r.body.query || !r.body.query.pages) return null;
  const pages = r.body.query.pages;
  const pageKey = Object.keys(pages)[0];
  const page = pages[pageKey];
  if (!page || !page.extract) return null;
  return page.extract.trim();
}

async function commonsFileInfo(filename) {
  const url = "https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=" +
    "extmetadata%7Curl%7Csize&iiurlwidth=300&format=json&titles=File:" +
    encodeURIComponent(filename.replace(/ /g, "_"));
  const r = await fetchJson(url);
  if (!r.body || !r.body.query || !r.body.query.pages) return null;
  const pages = r.body.query.pages;
  const pageKey = Object.keys(pages)[0];
  const page = pages[pageKey];
  if (!page || !page.imageinfo || !page.imageinfo[0]) return null;
  const ii = page.imageinfo[0];
  const ext = ii.extmetadata || {};
  function v(k) { return (ext[k] && ext[k].value) ? String(ext[k].value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : ""; }
  return {
    fileUrl: ii.url || "",
    thumbUrl: ii.thumburl || "",
    license: v("LicenseShortName") || v("License"),
    usageTerms: v("UsageTerms"),
    nonFree: v("NonFree") === "1",
  };
}

const ALLOWED_PATTERNS = [
  /^pd[-\s]/i, /public[-\s]?domain/i, /^cc0/i, /^cc[-\s]?by(?![-\s]?(nc|nd))/i,
  /^cc[-\s]?by[-\s]?sa(?![-\s]?(nc|nd))/i, /no\s+copyright/i, /^attribution\b/i,
];
const REJECTED_PATTERNS = [
  /[-\s]nc(?:[-\s]|$)/i, /noncommercial/i, /non[-\s]?commercial/i,
  /[-\s]nd(?:[-\s]|$)/i, /no[-\s]?derivatives/i, /fair[-\s]?use/i,
  /copyrighted/i, /all rights reserved/i,
];

function classifyLicense(meta) {
  const lic = (meta.license || "").toLowerCase().trim();
  if (!lic) return { allowed: false, reason: "unknown_license" };
  if (meta.nonFree) return { allowed: false, reason: "non_free_marked" };
  for (const re of REJECTED_PATTERNS) {
    if (re.test(lic)) return { allowed: false, reason: "rejected_pattern_" + lic };
  }
  for (const re of ALLOWED_PATTERNS) {
    if (re.test(lic)) return { allowed: true, reason: "" };
  }
  return { allowed: false, reason: "unmatched_license_" + lic };
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ---------------------------------------------------------------------------
// Main Logic
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n==================================================`);
  console.log(`👤 Recommender Profile Metadata Enrichment Pipeline`);
  console.log(`Mode: ${isWrite ? '⚡ LIVE UPDATE (Supabase Writes Enabled)' : '🔍 PREVIEW (Dry Run Only)'}`);
  console.log(`Limit: ${LIMIT} profiles`);
  console.log(`==================================================\n`);

  if (!fs.existsSync(SCRATCH_DIR)) {
    fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  }

  // 1. Query Top Draft people with space in their names (exclude single-word aliases)
  const pCounts = {};
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data: recs, error: recErr } = await sb
      .from('book_recommendations')
      .select('person_id')
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (recErr) {
      console.error('Error fetching book_recommendations:', recErr.message);
      break;
    }
    if (!recs || recs.length === 0) break;
    for (const r of recs) {
      pCounts[r.person_id] = (pCounts[r.person_id] || 0) + 1;
    }
    if (recs.length < pageSize) break;
    page++;
  }

  const { data: people, error } = await sb
    .from('people')
    .select('id, name, slug, role, bio, avatar_url, index_status')
    .eq('index_status', 'draft');

  if (error) {
    console.error('❌ Supabase Query Error:', error.message);
    process.exit(1);
  }

  // Filter full names containing space & sort by recommendations
  // Skip already-enriched people (those who already have role or bio set)
  const candidates = people
    .filter(p => p.name && p.name.trim().includes(' '))
    .filter(p => !p.role && !p.bio) // skip if already enriched
    .map(p => ({ ...p, rec_count: pCounts[p.id] || 0 }))
    .sort((a, b) => b.rec_count - a.rec_count)
    .slice(0, LIMIT);

  log(`Found ${candidates.length} candidate profiles for metadata enrichment.`);

  const proposalRows = [];
  const backupRows = [];

  for (const p of candidates) {
    log(`Processing recommender: "${p.name}" (slug: ${p.slug}, ${p.rec_count} recommendations)`);
    
    // Save current state for backup
    backupRows.push({
      id: p.id,
      slug: p.slug,
      name: p.name,
      role: p.role || "",
      bio: p.bio || "",
      avatar_url: p.avatar_url || ""
    });

    let proposedRole = null;
    let proposedBio = null;
    let proposedAvatar = null;
    let license = "None";
    let isSafeAvatar = false;
    let failureReason = "";

    try {
      // 1) Search Wikidata
      const wdResults = await wikidataSearch(p.name);
      if (wdResults.length > 0) {
        const scored = wdResults.map(c => ({ ...c, _score: scoreCandidate(p.name, c) }))
          .sort((a, b) => b._score - a._score);
        const top = scored[0];
        
        if (top._score >= 3) {
          // 2) Get details (Sitelinks, Image, Description)
          const details = await wikidataGetEntityDetails(top.qid);
          if (details) {
            proposedRole = details.description || null;
            
            // 3) Wikipedia Bio
            if (details.wikiTitle) {
              const bio = await fetchWikipediaIntro(details.wikiTitle);
              if (bio) {
                // Limit bio length to fit target constraints safely
                proposedBio = bio.length > 600 ? bio.slice(0, 597) + "..." : bio;
              }
            }

            // 4) Avatar Verification
            if (details.imageName) {
              const meta = await commonsFileInfo(details.imageName);
              if (meta) {
                const cls = classifyLicense(meta);
                const commercial = !meta.usageTerms.toLowerCase().includes("noncommercial") && 
                                   !meta.usageTerms.toLowerCase().includes("non-commercial");
                
                license = meta.license;
                if (cls.allowed && commercial) {
                  proposedAvatar = meta.fileUrl;
                  isSafeAvatar = true;
                } else {
                  failureReason = cls.allowed ? "non_commercial_only" : cls.reason;
                }
              }
            } else {
              failureReason = "no_wikidata_image";
            }
          }
        } else {
          failureReason = "low_confidence_wikidata_match";
        }
      } else {
        failureReason = "no_wikidata_match";
      }
    } catch (e) {
      warn(`Error fetching APIs for ${p.name}: ${e.message}`);
      failureReason = "api_error_" + e.message;
    }

    proposalRows.push({
      id: p.id,
      slug: p.slug,
      name: p.name,
      rec_count: p.rec_count,
      current_role: p.role || "",
      proposed_role: proposedRole || "",
      current_bio: p.bio || "",
      proposed_bio: proposedBio || "",
      current_avatar_url: p.avatar_url || "",
      proposed_avatar_url: proposedAvatar || "",
      license: license,
      is_safe_avatar: isSafeAvatar ? "true" : "false",
      failure_reason: failureReason || "None"
    });

    await sleep(MIN_DELAY_MS);
  }

  // Save Proposal files
  const propHeaders = ["id", "slug", "name", "rec_count", "current_role", "proposed_role", "current_bio", "proposed_bio", "current_avatar_url", "proposed_avatar_url", "license", "is_safe_avatar", "failure_reason"];
  const propLines = [propHeaders.join(",")];
  for (const r of proposalRows) {
    propLines.push(propHeaders.map(h => csvEscape(r[h])).join(","));
  }
  const propCsvPath = path.join(SCRATCH_DIR, 'people_enrichment_proposal.csv');
  const propJsonPath = path.join(SCRATCH_DIR, 'people_enrichment_proposal.json');
  fs.writeFileSync(propCsvPath, propLines.join("\n") + "\n", 'utf-8');
  fs.writeFileSync(propJsonPath, JSON.stringify(proposalRows, null, 2), 'utf-8');
  log(`Saved proposal CSV to: ${propCsvPath}`);
  log(`Saved proposal JSON to: ${propJsonPath}`);

  // Print Preview
  console.log(`\n==================================================`);
  console.log(`📊 Enrichment Preview Report`);
  console.log(`==================================================`);
  proposalRows.forEach((r, idx) => {
    console.log(`\n${idx + 1}. Recommender: ${r.name} (${r.slug})`);
    console.log(`   - Proposed Role: ${r.proposed_role || "(None)"}`);
    console.log(`   - Proposed Bio:  ${r.proposed_bio ? r.proposed_bio.slice(0, 120) + "..." : "(None)"}`);
    console.log(`   - Proposed Avatar: ${r.proposed_avatar_url ? `[SAFE] (${r.license})` : `[REJECT] reason: ${r.failure_reason}`}`);
  });

  if (!isWrite) {
    console.log(`\n==================================================`);
    console.log(`🔍 Dry run complete. To apply these enrichments, run:`);
    console.log(`   node scripts/import/enrich_people_metadata.js --write`);
    console.log(`==================================================\n`);
    return;
  }

  // Live Write implementation
  console.log(`\n==================================================`);
  console.log(`💾 Live updates: Writing safety-approved enrichments back to database...`);
  console.log(`==================================================\n`);

  // Write backup CSV
  const backupHeaders = ["id", "slug", "name", "role", "bio", "avatar_url"];
  const backupLines = [backupHeaders.join(",")];
  for (const b of backupRows) {
    backupLines.push(backupHeaders.map(h => csvEscape(b[h])).join(","));
  }
  const backupPath = path.join(SCRATCH_DIR, `people_backup_before_enrichment_${Date.now()}.csv`);
  fs.writeFileSync(backupPath, backupLines.join("\n") + "\n", 'utf-8');
  log(`Pre-write backup saved to: ${backupPath}`);

  let writeCount = 0;
  for (const row of proposalRows) {
    // Only update if there is a proposed role OR a proposed bio OR a safe avatar
    const updates = {};
    if (row.proposed_role) updates.role = row.proposed_role;
    if (row.proposed_bio && row.proposed_bio.length > 30) updates.bio = row.proposed_bio;
    if (row.proposed_avatar_url && row.is_safe_avatar === 'true') updates.avatar_url = row.proposed_avatar_url;

    if (Object.keys(updates).length > 0) {
      log(`Updating DB for ${row.name}...`);
      const { error } = await sb
        .from('people')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', row.id);

      if (error) {
        console.error(`❌ DB Update failed for ${row.name}: ${error.message}`);
      } else {
        writeCount++;
      }
    } else {
      log(`Skipping update for ${row.name} (insufficient metadata or rejected avatar).`);
    }
  }

  console.log(`\n==================================================`);
  console.log(`✅ Success: Updated ${writeCount} recommender profiles in database!`);
  console.log(`==================================================\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
