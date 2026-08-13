/**
 * Publish the two genre lists the classification unlocked.
 *
 * "best memoirs" (5,200/mo, difficulty 4) and "best biographies" (4,300/mo,
 * difficulty 6) were unreachable: no genre taxonomy existed, and keyword
 * extraction returned Ulysses and Catch-22 as biographies. The LLM pass in
 * classify_book_genres.js produced the missing signal; this turns it into
 * pages.
 *
 * Only HIGH-confidence rows are used. A low-confidence memoir is exactly the
 * kind of near-miss that made keyword extraction unpublishable, and a wrong
 * entry on a good term earns bounces rather than rankings.
 *
 * Membership order follows recommendation_count, so the ranking means the
 * same thing here as everywhere else on the site: how many distinct people
 * recommended it, not how the classifier scored it.
 *
 * Idempotent — reruns update the existing list rather than creating a second.
 *
 * Dry-run by default; --write persists and backs up first.
 */
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://ghpdpvatfmvsahzsqgpp.supabase.co";
const READ_KEY = "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z";
const WRITE = process.argv.includes("--write");
const PROJECT = path.resolve(__dirname, "..");
const OUT = path.join(PROJECT, "backups");

const LISTS = [
  {
    genre: "memoir",
    slug: "memoirs",
    title: "Memoirs",
    description:
      "The memoirs people recommend most — lives told by the person who lived them, from sport and science to business and war. Each pick links back to who recommended it and where they said it.",
  },
  {
    genre: "biography",
    slug: "biographies",
    title: "Biographies",
    description:
      "The biographies people recommend most — founders, scientists, politicians and builders, told by the writers who studied them. Ranked by how many distinct people recommended each title.",
  },
];

(async () => {
  const classified = JSON.parse(
    fs.readFileSync(path.join(PROJECT, "rebuild_v2", "book_genres_v1.json"), "utf8"),
  );
  const sb = createClient(SUPABASE_URL, READ_KEY);

  // The classifier keyed on slug (its pool predates id selection), so resolve
  // ids here rather than trusting a stale id column.
  const slugs = classified.filter((c) => c.confidence === "high").map((c) => c.slug);
  const idBySlug = new Map();
  for (let i = 0; i < slugs.length; i += 200) {
    const { data, error } = await sb.from("books").select("id,slug").in("slug", slugs.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const b of data || []) idBySlug.set(b.slug, b.id);
  }

  const plan = [];
  for (const spec of LISTS) {
    const members = classified
      .filter((c) => c.genre === spec.genre && c.confidence === "high")
      .sort((a, b) => (b.recommendation_count || 0) - (a.recommendation_count || 0))
      .map((c) => ({ ...c, id: idBySlug.get(c.slug) }))
      .filter((c) => c.id);
    const { data: existing } = await sb.from("lists").select("id,slug,book_count,index_status").eq("slug", spec.slug);
    plan.push({ spec, members, existing: (existing || [])[0] || null });
    console.log(`\n${spec.slug}: ${members.length} high-confidence books${(existing || []).length ? " (list exists)" : " (new list)"}`);
    members.slice(0, 8).forEach((m) => console.log(`   ${String(m.recommendation_count).padStart(3)} recs  ${m.title}`));
  }

  if (!WRITE) return console.log("\nDRY RUN — pass --write to persist.");
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("--write requires SUPABASE_SECRET_KEY");
  const admin = createClient(SUPABASE_URL, secret);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, `genre_lists_pre_write_${new Date().toISOString().replace(/[:.]/g, "")}.json`),
    JSON.stringify(plan.map((p) => ({ slug: p.spec.slug, existing: p.existing, count: p.members.length })), null, 1),
  );

  for (const p of plan) {
    let listId = p.existing?.id;
    const row = {
      slug: p.spec.slug,
      title: p.spec.title,
      description: p.spec.description,
      book_count: p.members.length,
      index_status: "published",
    };
    if (listId) {
      const { error } = await admin.from("lists").update(row).eq("id", listId);
      if (error) { console.log(`  update FAILED ${p.spec.slug}: ${error.message}`); continue; }
    } else {
      const { data, error } = await admin.from("lists").insert(row).select("id").single();
      if (error) { console.log(`  insert FAILED ${p.spec.slug}: ${error.message}`); continue; }
      listId = data.id;
    }

    // Replace membership wholesale so a rerun cannot leave stale entries.
    const { error: delErr } = await admin.from("book_lists").delete().eq("list_id", listId);
    if (delErr) console.log(`  clear FAILED ${p.spec.slug}: ${delErr.message}`);
    for (let i = 0; i < p.members.length; i += 200) {
      const rows = p.members.slice(i, i + 200).map((m, j) => ({
        book_id: m.id,
        list_id: listId,
        rank: i + j + 1,
      }));
      const { error } = await admin.from("book_lists").insert(rows);
      if (error) console.log(`  membership FAILED ${p.spec.slug}: ${error.message}`);
    }
    console.log(`  ${p.spec.slug}: ${p.members.length} books published`);
  }
})();
