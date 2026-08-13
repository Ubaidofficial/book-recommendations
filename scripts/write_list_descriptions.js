/**
 * Author descriptions for published lists that have none.
 *
 * These 11 pages shipped with no description at all, so they fell back to a
 * generated line ("A curated collection of books in Philosophy.") that names
 * the subject and says nothing else. They are also, per keyword research, the
 * highest-opportunity pages on the site — best-philosophy-books alone sits on
 * a 9,100/month term at difficulty 2.
 *
 * Two rules the copy follows:
 *
 *   1. NO BOOK COUNTS. The stored text must stay true regardless of how many
 *      books a page displays, because how many it displays is about to change
 *      (list pages currently cap at ~48 while book_count claims thousands).
 *      Counts belong in the template, injected at render.
 *
 *   2. First sentence stands alone under 160 chars. clampDescription() cuts at
 *      a sentence boundary, so sentence one becomes the meta description
 *      intact and sentence two adds on-page depth.
 *
 * The semantically-related terms are the subject-adjacent nouns inside each
 * (ethics, metaphysics, existentialism), not repetitions of the head term —
 * that is the difference from the copy this replaces.
 *
 * Dry-run by default; --write persists and backs up prior values first.
 */
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://ghpdpvatfmvsahzsqgpp.supabase.co";
const READ_KEY = "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z";
const WRITE = process.argv.includes("--write");
const OUT = path.join(path.resolve(__dirname, ".."), "backups");

const DESCRIPTIONS = {
  "best-philosophy-books": "The philosophy books that writers, scientists and founders return to most — ethics, metaphysics, existentialism, Stoicism and the ancient Greeks. Recommended reading for beginners and rereaders alike, with the source behind every pick.",
  "fiction": "The novels and short story collections recommended most by writers, critics and serious readers — literary fiction, science fiction and modern classics. Historical epics included, and every title here came off a real reading list rather than a bestseller chart.",
  "history": "The history books historians, journalists and heads of state recommend most — ancient civilisations, war and empire, and social history. Many read like novels; each pick links back to who recommended it and where.",
  "business": "The business books founders, investors and executives actually recommend — strategy, management, negotiation, startups and the case studies behind them. Ranked by how many people recommended each title, not by publisher marketing.",
  "nonfiction": "Nonfiction recommended by people worth listening to — history, science, biography, economics and ideas, ranked by how often each title is genuinely recommended. Every book was picked up from a real reading list, interview or essay.",
  "best-psychology-books": "The psychology books clinicians, researchers and writers recommend most — cognitive bias, behavioural economics, memory and trauma. Including the original studies behind the popular science, with a source for every recommendation.",
  "children-s": "Children's books recommended most by parents, teachers and librarians — picture books, early readers and read-aloud favourites. Plus the chapter books that turn children into readers, sourced from people who work with them daily.",
  "personal-development": "The self-improvement books that hold up — habits, focus, decision-making, money and the psychology underneath them. Recommended by people who have applied them rather than only reviewed them, with the source for each pick.",
  "science": "The science books physicists, biologists and science writers recommend most — evolution, cosmology, neuroscience and mathematics. Including the popular accounts that get the details right, each with a source behind it.",
  "social-sciences": "The social science books economists, sociologists and anthropologists recommend most — inequality, cities, migration and institutions. Each title links back to the fieldwork, and to who recommended it.",
  "most-recommended-books": "The books that come up most often across every reading list, interview and podcast we track — the closest thing to a consensus canon. Ranked by how many different people recommended each title, with the source for every one.",
};

(async () => {
  const sb = createClient(SUPABASE_URL, READ_KEY);
  const slugs = Object.keys(DESCRIPTIONS);
  const { data: rows, error } = await sb
    .from("lists")
    .select("id,slug,title,description,index_status")
    .in("slug", slugs);
  if (error) throw new Error(error.message);

  const missing = slugs.filter((s) => !rows.some((r) => r.slug === s));
  if (missing.length) console.log("WARNING slugs not found:", missing.join(", "));

  let willOverwrite = 0;
  for (const r of rows) {
    const next = DESCRIPTIONS[r.slug];
    const had = (r.description || "").trim();
    if (had) willOverwrite++;
    console.log(`\n── ${r.slug} [${r.index_status}]`);
    console.log(`   was: ${had ? JSON.stringify(had.slice(0, 70)) : "(empty)"}`);
    console.log(`   now: ${next.slice(0, 100)}…`);
    console.log(`   meta-desc slice: ${next.split(/(?<=\.)\s/)[0].length} chars`);
  }
  console.log(`\n${rows.length} rows; ${willOverwrite} already had copy (expected 0)`);

  if (!WRITE) return console.log("\nDRY RUN — pass --write to persist.");
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("--write requires SUPABASE_SECRET_KEY");
  fs.mkdirSync(OUT, { recursive: true });
  const f = path.join(OUT, `list_descriptions_pre_write_${new Date().toISOString().replace(/[:.]/g, "")}.json`);
  fs.writeFileSync(f, JSON.stringify(rows, null, 1));
  console.log("backup:", path.relative(process.cwd(), f));

  const admin = createClient(SUPABASE_URL, secret);
  let ok = 0;
  for (const r of rows) {
    const { error: e } = await admin.from("lists").update({ description: DESCRIPTIONS[r.slug] }).eq("id", r.id);
    if (e) console.log(`  FAILED ${r.slug}: ${e.message}`);
    else ok++;
  }
  console.log(`updated ${ok}/${rows.length}`);
})();
