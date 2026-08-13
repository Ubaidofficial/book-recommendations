/**
 * Assign a genre to the books that carry real recommendation signal.
 *
 * There is no genre taxonomy in the schema — classification lives only in list
 * membership — so "best memoirs" and "best biographies" (9,500 searches/month
 * combined at difficulty 4-6) cannot be built at all. Keyword extraction was
 * tried first and rejected: it pulled in Ulysses and Catch-22 as biographies,
 * and matched The Emperor of All Maladies because its subtitle is "A Biography
 * of Cancer". About 60% precision, which publishes a bad list on a good term.
 *
 * Scope is the top 1,000 books by recommendation_count, of which ~940 carry a
 * usable description. Classifying all 98,845 would be mostly noindex rows that
 * no list will ever surface.
 *
 * Memoir vs biography is the distinction that matters and the one keywords get
 * wrong, so the prompt defines it by WHOSE life is described and who is
 * writing, not by whether a word appears.
 *
 * Writes nothing to the database. Output is a JSON file; populating lists is a
 * separate, reviewable step.
 *
 *   node scripts/classify_book_genres.js --limit 40     # sample first
 *   node scripts/classify_book_genres.js                # full run
 */
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://ghpdpvatfmvsahzsqgpp.supabase.co";
const READ_KEY = "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z";
const OUT = path.join(path.resolve(__dirname, ".."), "rebuild_v2");
const argLimit = (() => {
  const i = process.argv.indexOf("--limit");
  return i > -1 ? parseInt(process.argv[i + 1], 10) : 0;
})();
const BATCH = 20;

const GENRES = [
  "memoir", "biography", "history", "science", "technology", "business",
  "psychology", "philosophy", "self-help", "politics", "economics",
  "essays", "fiction", "poetry", "reference", "other",
];

const SYSTEM = `You classify books into exactly one genre from this list:
${GENRES.join(", ")}.

Two definitions decide most hard cases:
- "memoir": the author writes about their OWN life or a period of it.
- "biography": the book is about SOMEONE ELSE's life, written by another person.

A book is only memoir or biography when a real person's life is the subject.
"The Emperor of All Maladies: A Biography of Cancer" is science, not biography.
A novel narrated in the first person is fiction, not memoir.
A business book that opens with the founder's story is business, not memoir,
unless the life story IS the book.

Return ONLY a JSON array, one object per input, in the same order:
[{"i":0,"genre":"memoir","confidence":"high"}]
confidence is "high" when the description makes the genre explicit, otherwise "low".`;

async function classify(batch, key) {
  const payload = batch
    .map((b, i) => `${i}. TITLE: ${b.title}\nAUTHOR: ${b.author_name || "unknown"}\nDESCRIPTION: ${String(b.description || "").slice(0, 600)}`)
    .join("\n\n");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "deepseek/deepseek-chat",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: payload },
      ],
      temperature: 0,
      max_tokens: 2000,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const text = (await res.json()).choices?.[0]?.message?.content || "";
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error(`no JSON array in reply: ${text.slice(0, 120)}`);
  return JSON.parse(m[0]);
}

(async () => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY required");
  const sb = createClient(SUPABASE_URL, READ_KEY);

  // recommendation_count carries no index, so ordering by it while pulling
  // descriptions intermittently trips the statement timeout. --pool accepts a
  // previously fetched ranking so a rerun costs no database time and the
  // classified set stays identical between runs.
  const poolArg = (() => {
    const i = process.argv.indexOf("--pool");
    return i > -1 ? process.argv[i + 1] : null;
  })();

  let books;
  if (poolArg && fs.existsSync(poolArg)) {
    books = JSON.parse(fs.readFileSync(poolArg, "utf8"));
    console.log(`pool loaded from ${poolArg} (${books.length} books)`);
  } else {
    const { data: ranked, error } = await sb
      .from("books")
      .select("id,recommendation_count")
      .order("recommendation_count", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    const order = new Map(ranked.map((r, i) => [r.id, i]));
    books = [];
    for (let i = 0; i < ranked.length; i += 200) {
      const ids = ranked.slice(i, i + 200).map((r) => r.id);
      const { data, error: e } = await sb
        .from("books")
        .select("id,slug,title,author_name,description,recommendation_count")
        .in("id", ids);
      if (e) throw new Error(e.message);
      books.push(...(data || []));
    }
    books.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
  }

  const pool = books
    .filter((b) => String(b.description || "").length > 80)
    .slice(0, argLimit > 0 ? argLimit : undefined);
  console.log(`classifying ${pool.length} books in batches of ${BATCH}`);

  const results = [];
  for (let i = 0; i < pool.length; i += BATCH) {
    const batch = pool.slice(i, i + BATCH);
    try {
      const out = await classify(batch, key);
      for (const r of out) {
        const b = batch[r.i];
        if (!b) continue;
        const genre = GENRES.includes(r.genre) ? r.genre : "other";
        results.push({
          id: b.id || null, slug: b.slug, title: b.title, author: b.author_name || null,
          recommendation_count: b.recommendation_count,
          genre, confidence: r.confidence === "high" ? "high" : "low",
        });
      }
      process.stdout.write(`\r  ${results.length}/${pool.length}`);
    } catch (e) {
      console.log(`\n  batch ${i / BATCH} failed: ${e.message}`);
    }
  }

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, "book_genres_v1.json");
  fs.writeFileSync(file, JSON.stringify(results, null, 1));
  const tally = {};
  for (const r of results) tally[r.genre] = (tally[r.genre] || 0) + 1;
  console.log(`\n\nwrote ${path.relative(process.cwd(), file)} (${results.length} rows)`);
  console.log("genre distribution:", JSON.stringify(tally, null, 1));
  const hi = results.filter((r) => r.confidence === "high").length;
  console.log(`high confidence: ${hi}/${results.length}`);
  for (const g of ["memoir", "biography"]) {
    const rows = results.filter((r) => r.genre === g && r.confidence === "high");
    console.log(`\n${g} (high confidence: ${rows.length}):`);
    rows.slice(0, 12).forEach((r) => console.log(`   ${r.title} — ${r.author}`));
  }
})();
