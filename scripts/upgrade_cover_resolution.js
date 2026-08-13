/**
 * Raise published book covers from Google Books' 128px thumbnail to ~575px.
 *
 * Google Books serves the same cover at several sizes off one id via the
 * `zoom` parameter. Every row was ingested with `zoom=1`, which is 128px wide
 * — smaller than the slot it renders into, on every device. `zoom=3` returns
 * ~575px from the same URL. (`zoom=0` returns the original, up to ~2500px,
 * but its dimensions vary per title and some are enormous; 575px is the
 * predictable tier.)
 *
 * `edge=curl` is dropped at the same time — it paints a fake page-curl onto
 * the image, which looks like a rendering artifact at display size.
 *
 * WHAT THIS TOUCHES
 *   - books.cover_image_url, ONLY for rows whose URL contains `zoom=1`
 *
 * WHAT THIS NEVER TOUCHES
 *   - any other column, table, or row
 *   - covers already on openlibrary or any non-Google host
 *
 * Every candidate is fetched and measured BEFORE the write; a row is only
 * updated if the upgraded URL returns 200 AND is genuinely larger than what
 * it replaces. Anything else is reported and left alone.
 *
 * Dry-run by default; pass --write to persist. --write requires
 * SUPABASE_SECRET_KEY and always writes a JSON backup of prior values first.
 */
const { createClient } = require("@supabase/supabase-js");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://ghpdpvatfmvsahzsqgpp.supabase.co";
const READ_KEY = "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z";
const INDEXABLE = ["published", "approved", "indexed", "index"];
const WRITE = process.argv.includes("--write");
const PROJECT = path.resolve(__dirname, "..");
const OUT = path.join(PROJECT, "backups");

/** zoom=1 -> zoom=3, and drop the decorative page-curl overlay. */
function upgrade(url) {
  if (!url || !url.includes("zoom=1")) return null;
  const next = url.replace(/([?&])zoom=1(&|$)/, "$1zoom=3$2").replace(/&edge=curl/, "");
  return next === url ? null : next;
}

/**
 * A handful of volume ids have a real cover ONLY at zoom=1 — every larger
 * tier returns a 575x92 "preview unavailable" strip. Open Library carries a
 * genuine ~500px cover for those, keyed by ISBN. `default=false` makes it
 * 404 rather than hand back a blank placeholder, so a miss is detectable.
 */
function openLibraryFallback(book) {
  const isbn = book.isbn_13 || book.isbn_10;
  return isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false` : null;
}

async function measure(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
    const buf = Buffer.from(await r.arrayBuffer());
    const { width, height } = await sharp(buf).metadata();
    return { ok: true, width, height, bytes: buf.length };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

(async () => {
  const sb = createClient(SUPABASE_URL, READ_KEY);
  const { data: books, error } = await sb
    .from("books")
    .select("id,slug,title,cover_image_url,isbn_13,isbn_10")
    .in("index_status", INDEXABLE)
    .order("slug");
  if (error) throw new Error(`read failed: ${error.message}`);

  const candidates = books
    .map((b) => ({ ...b, next: upgrade(b.cover_image_url) }))
    .filter((b) => b.next);

  console.log(`published books: ${books.length}`);
  console.log(`zoom=1 candidates: ${candidates.length}\n`);

  const approved = [];
  const rejected = [];
  const isBigger = (a, b) => a.ok && b.ok && a.width > b.width && a.height > b.height;
  const dim = (m) => (m.ok ? `${m.width}x${m.height}` : m.reason);

  for (const b of candidates) {
    const before = await measure(b.cover_image_url);
    let after = await measure(b.next);
    let chosen = b.next;
    let via = "zoom=3";

    if (!isBigger(after, before)) {
      const ol = openLibraryFallback(b);
      if (ol) {
        const olMeasured = await measure(ol);
        if (isBigger(olMeasured, before)) {
          after = olMeasured;
          chosen = ol;
          via = "openlibrary";
        }
      }
    }

    const line = `  ${dim(before).padStart(11)} -> ${dim(after).padEnd(11)} ${via.padEnd(12)} ${b.slug}`;
    if (isBigger(after, before)) {
      approved.push({ ...b, next: chosen });
      console.log(`OK  ${line}`);
    } else {
      rejected.push({ ...b, before, after });
      console.log(`SKIP${line}`);
    }
  }

  console.log(`\napproved: ${approved.length}  rejected: ${rejected.length}`);
  if (!WRITE) {
    console.log("\nDRY RUN — pass --write to persist.");
    return;
  }

  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("--write requires SUPABASE_SECRET_KEY");

  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "");
  const backup = path.join(OUT, `cover_resolution_pre_write_${stamp}.json`);
  fs.writeFileSync(
    backup,
    JSON.stringify(
      approved.map((b) => ({ id: b.id, slug: b.slug, cover_image_url: b.cover_image_url })),
      null,
      1,
    ),
  );
  console.log(`backup written: ${path.relative(PROJECT, backup)}`);

  const admin = createClient(SUPABASE_URL, secret);
  let ok = 0;
  for (const b of approved) {
    const { error: e } = await admin
      .from("books")
      .update({ cover_image_url: b.next })
      .eq("id", b.id);
    if (e) console.log(`  FAILED ${b.slug}: ${e.message}`);
    else ok++;
  }
  console.log(`updated ${ok}/${approved.length} rows`);
})();
