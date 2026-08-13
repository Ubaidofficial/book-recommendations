/**
 * Consolidate the ten topics that are published twice.
 *
 * /philosophy and /best-philosophy-books both exist and are both indexable.
 * Since list titles were unified they render the same H1 and target the same
 * query, so the pair competes with itself — worse than either page alone.
 *
 * DIRECTION: keep the BARE slug, retire the "best-" twin.
 *
 * The obvious instinct is to keep the keyword slug, but the membership data
 * says otherwise. In every pair the bare list is the superset:
 *
 *     psychology  961 books   best-psychology-books  58   (54 shared)
 *     philosophy  730         best-philosophy-books  70   (62 shared)
 *     art         828         best-art-books         92   (67 shared)
 *
 * Keeping the "best-" slug would mean migrating thousands of memberships and
 * calling a 965-book page "Best Psychology Books". Keeping the bare slug
 * means moving 164 rows in total — the books that exist ONLY in the twin —
 * and the surviving page still renders "Best Psychology Books", because the
 * title comes from displayListTitleFull, not from the slug. An exact-match
 * slug is a weak signal; losing 900 books of content is not.
 *
 * WHAT THIS TOUCHES
 *   - book_lists: inserts the missing memberships into the surviving list
 *   - lists.book_count on the survivor
 *   - lists.index_status on the retired twin -> "noindex"
 *
 * The retired twin is NOT deleted. Its rows stay put so the merge is
 * reversible from the backup, and next.config.js 301s its URL to the survivor.
 *
 * Dry-run by default; --write persists and backs up first.
 */
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://ghpdpvatfmvsahzsqgpp.supabase.co";
const READ_KEY = "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z";
const WRITE = process.argv.includes("--write");
const OUT = path.join(path.resolve(__dirname, ".."), "backups");

/** [surviving bare slug, retired best-* twin] */
const PAIRS = [
  ["science-fiction", "best-science-fiction-books"],
  ["art", "best-art-books"],
  ["architecture", "best-architecture-books"],
  ["poetry", "best-poetry-books"],
  ["design", "best-design-books"],
  ["photography", "best-photography-books"],
  ["physics", "best-physics-books"],
  ["philosophy", "best-philosophy-books"],
  ["psychology", "best-psychology-books"],
  ["leadership", "best-leadership-books"],
];

async function members(sb, listId) {
  const out = new Set();
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("book_lists")
      .select("book_id")
      .eq("list_id", listId)
      .range(from, from + 999);
    if (error) throw new Error(`members(${listId}): ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) if (r.book_id) out.add(r.book_id);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

(async () => {
  const sb = createClient(SUPABASE_URL, READ_KEY);
  const slugs = PAIRS.flat();
  const { data: lists, error } = await sb
    .from("lists")
    .select("id,slug,title,book_count,index_status")
    .in("slug", slugs);
  if (error) throw new Error(error.message);
  const bySlug = new Map(lists.map((l) => [l.slug, l]));

  const plan = [];
  for (const [keepSlug, retireSlug] of PAIRS) {
    const keep = bySlug.get(keepSlug);
    const retire = bySlug.get(retireSlug);
    if (!keep || !retire) {
      console.log(`SKIP ${keepSlug} / ${retireSlug} — one side missing`);
      continue;
    }
    const [mk, mr] = await Promise.all([members(sb, keep.id), members(sb, retire.id)]);
    const missing = [...mr].filter((id) => !mk.has(id));
    plan.push({ keep, retire, keepSize: mk.size, retireSize: mr.size, missing });
    console.log(
      `${keepSlug.padEnd(16)} keeps ${String(mk.size).padStart(4)} books` +
        ` | ${retireSlug.padEnd(27)} retires ${String(mr.size).padStart(3)}` +
        ` | move ${String(missing.length).padStart(3)} -> new total ${mk.size + missing.length}`,
    );
  }

  const totalMoves = plan.reduce((n, p) => n + p.missing.length, 0);
  console.log(`\n${plan.length} pairs, ${totalMoves} memberships to move`);
  if (!WRITE) return console.log("\nDRY RUN — pass --write to persist.");

  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("--write requires SUPABASE_SECRET_KEY");
  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "");
  fs.writeFileSync(
    path.join(OUT, `list_consolidation_pre_write_${stamp}.json`),
    JSON.stringify(
      plan.map((p) => ({
        keep: p.keep,
        retire: p.retire,
        keepSize: p.keepSize,
        retireSize: p.retireSize,
        moved: p.missing,
      })),
      null,
      1,
    ),
  );
  console.log(`backup: backups/list_consolidation_pre_write_${stamp}.json`);

  const admin = createClient(SUPABASE_URL, secret);
  for (const p of plan) {
    if (p.missing.length > 0) {
      // Chunked so one oversized statement cannot fail the whole pair.
      for (let i = 0; i < p.missing.length; i += 200) {
        const rows = p.missing.slice(i, i + 200).map((book_id) => ({
          book_id,
          list_id: p.keep.id,
        }));
        const { error: e } = await admin.from("book_lists").insert(rows);
        if (e) console.log(`  INSERT FAILED ${p.keep.slug}: ${e.message}`);
      }
    }
    const newCount = p.keepSize + p.missing.length;
    const { error: e1 } = await admin
      .from("lists")
      .update({ book_count: newCount })
      .eq("id", p.keep.id);
    if (e1) console.log(`  book_count FAILED ${p.keep.slug}: ${e1.message}`);

    const { error: e2 } = await admin
      .from("lists")
      .update({ index_status: "noindex" })
      .eq("id", p.retire.id);
    if (e2) console.log(`  retire FAILED ${p.retire.slug}: ${e2.message}`);

    console.log(`  ${p.keep.slug}: ${p.keepSize} -> ${newCount}; retired ${p.retire.slug}`);
  }
})();
