/**
 * Backfill meta_title / meta_description for published people rows.
 *
 * Dry-run by default; pass --write to persist. --write requires
 * SUPABASE_SECRET_KEY in the environment and always writes a JSON backup of
 * the prior values to backups/ first.
 */
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://ghpdpvatfmvsahzsqgpp.supabase.co";
const READ_KEY = "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z";
const INDEXABLE = ["published", "approved", "indexed", "index"];
const WRITE = process.argv.includes("--write");
const PROJECT = path.resolve(__dirname, "..");
const OUT = path.join(PROJECT, "backups");

const TITLE_MAX = 45; // + " | BookMentions" (15) = 60
const DESC_MAX = 155;

/** Repair Windows-1252 smart punctuation that survived import as _x00NN_. */
function repairEncoding(s) {
  return (s || "")
    .replace(/_x0092_|_x2019_/g, "’")
    .replace(/_x0093_|_x0094_/g, '"')
    .replace(/_x0096_|_x0097_/g, "—")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Mirrors repairNumericTitle() in src/lib/dataQuality.ts — a chunk of titles
 * were exported from Excel as floats, so "1984" is stored as "1984.0".
 */
function repairNumericTitle(title) {
  const s = String(title || "").trim();
  const m = s.match(/^(\d{1,5})\.0+$/);
  return m ? m[1] : s;
}

/** Strip subtitle and trailing series/edition noise from a book title. */
function shortTitle(raw) {
  let t = repairEncoding(raw);
  t = t.split(/\s*[:—–]\s+/)[0]; // drop subtitle after colon/dash
  t = t.replace(/\s*\((?:[^)]*)\)\s*$/, ""); // drop trailing parenthetical
  return repairNumericTitle(t.trim());
}

function joinTitles(titles) {
  if (titles.length === 1) return titles[0];
  if (titles.length === 2) return `${titles[0]} and ${titles[1]}`;
  return `${titles.slice(0, -1).join(", ")}, and ${titles[titles.length - 1]}`;
}

function buildTitle(name) {
  const base = `Books Recommended by ${name}`;
  if (base.length <= TITLE_MAX) return base;
  const alt = `${name} Book Recommendations`;
  return alt.length <= TITLE_MAX ? alt : `${name}: Books`;
}

/**
 * Description is built only from data we can stand behind: the recommendation
 * count and the person's actual top recommended titles. The `role` column is
 * deliberately NOT used — it contains factual errors for several published
 * people (e.g. James Mattis is stored as "American bicycle racer").
 */
function buildDescription(name, rec, titles) {
  const lead = `${rec} books recommended by ${name}`;
  const tail = " Every pick links back to the original interview, post, or reading list.";
  const shortTail = " Each pick links back to its original source.";

  for (const n of [3, 2, 1]) {
    const picked = titles.slice(0, n);
    if (picked.length < n) continue;
    const mid = `${lead} — including ${joinTitles(picked)}.`;
    for (const t of [tail, shortTail, ""]) {
      const candidate = mid + t;
      if (candidate.length <= DESC_MAX) return candidate;
    }
  }
  const plain = `${lead}, with source links to the interviews, posts, and reading lists where each one appeared.`;
  return plain.length <= DESC_MAX
    ? plain
    : `${lead}, with a source link for every recommendation.`;
}

(async () => {
  const read = createClient(SUPABASE_URL, READ_KEY);
  const { data: people, error } = await read
    .from("people")
    .select("id,slug,name,role,meta_title,meta_description")
    .in("index_status", INDEXABLE);
  if (error) throw error;

  const rows = [];
  for (const p of people) {
    const [{ count: rec }, { data: proof }] = await Promise.all([
      read.from("book_recommendations").select("*", { count: "exact", head: true }).eq("person_id", p.id),
      read
        .from("book_recommendations")
        .select("books(title,recommendation_count)")
        .eq("person_id", p.id)
        .limit(200),
    ]);

    const titles = [...new Set(
      (proof || [])
        .map((r) => r.books)
        .filter((b) => b && b.title)
        .sort((a, b) => (b.recommendation_count || 0) - (a.recommendation_count || 0))
        .map((b) => shortTitle(b.title))
        .filter((t) => t.length >= 3 && t.length <= 34 && !/^\d+$/.test(t))
    )];

    const name = repairEncoding(p.name);
    rows.push({
      id: p.id,
      slug: p.slug,
      name,
      rec: rec || 0,
      old_title: p.meta_title,
      old_desc: p.meta_description,
      meta_title: buildTitle(name),
      meta_description: buildDescription(name, rec || 0, titles),
      titles_used: titles.slice(0, 3),
    });
  }

  rows.sort((a, b) => b.rec - a.rec);
  fs.writeFileSync(path.join(OUT, "people_meta_preview.json"), JSON.stringify(rows, null, 1));

  const tLen = rows.map((r) => r.meta_title.length + 15);
  const dLen = rows.map((r) => r.meta_description.length);
  console.log(`rows: ${rows.length}`);
  console.log(`title (incl. " | BookMentions") min/max: ${Math.min(...tLen)}/${Math.max(...tLen)}  over 60: ${tLen.filter((n) => n > 60).length}`);
  console.log(`description min/max: ${Math.min(...dLen)}/${Math.max(...dLen)}  over ${DESC_MAX}: ${dLen.filter((n) => n > DESC_MAX).length}`);
  console.log(`with real titles: ${rows.filter((r) => r.titles_used.length > 0).length}  generic fallback: ${rows.filter((r) => r.titles_used.length === 0).length}`);
  console.log(`unique descriptions: ${new Set(rows.map((r) => r.meta_description)).size}`);
  console.log(`overwriting non-null existing values: ${rows.filter((r) => r.old_title || r.old_desc).length}`);
  console.log("\n--- sample ---");
  for (const r of [rows[0], rows[1], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]]) {
    console.log(`\n/people/${r.slug}  (${r.rec} recs)`);
    console.log(`  T(${r.meta_title.length + 15}): ${r.meta_title} | BookMentions`);
    console.log(`  D(${r.meta_description.length}): ${r.meta_description}`);
  }

  if (!WRITE) {
    console.log("\nDRY RUN — no writes. Re-run with --write to persist.");
    return;
  }

  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY not set — cannot write.");

  const backupPath = path.join(PROJECT, "backups", `people_meta_backup_${process.env.STAMP || "manual"}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify(rows.map((r) => ({ id: r.id, slug: r.slug, meta_title: r.old_title, meta_description: r.old_desc })), null, 1)
  );
  console.log(`\nbackup written: ${backupPath}`);

  const write = createClient(SUPABASE_URL, secret);
  let ok = 0;
  const failures = [];
  for (const r of rows) {
    const { error: e } = await write
      .from("people")
      .update({ meta_title: r.meta_title, meta_description: r.meta_description })
      .eq("id", r.id);
    if (e) failures.push({ slug: r.slug, error: e.message });
    else ok++;
  }
  console.log(`updated: ${ok}/${rows.length}`);
  if (failures.length) console.log("FAILURES:", JSON.stringify(failures, null, 1));
})();
