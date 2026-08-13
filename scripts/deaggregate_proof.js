/**
 * Recover attributable provenance from pipe-aggregated recommendation rows.
 *
 * Ingest merged several people's recommendations of the same book into one
 * row: `source_url` holds many URLs joined by "|", `quote` holds many quotes.
 * Bill Gates' row for The Box carried a Tim Ferriss transcript of Tobi Lutke
 * and a Jeff Dean tweet alongside his own Gates Notes link. Roughly two
 * thirds of stored quotes fail getProofDisplaySafety because of this, so the
 * site's strongest asset — who said it, where — is mostly invisible.
 *
 * WHY THIS DOES NOT SPLIT THE ROWS
 *
 * The obvious repair is to split an aggregate of N quotes and N URLs into N
 * rows. That is wrong here. The segments belong to DIFFERENT people, while
 * the row carries one person_id, so splitting produces N rows all attributed
 * to the same person — one misattribution becomes three. Alignment of counts
 * is not evidence of ownership.
 *
 * WHAT IT DOES INSTEAD
 *
 * Keeps only the segment that demonstrably belongs to this person: a source
 * URL containing their full name or slug (blog.longnow.org/…/stewart-brand-…,
 * twitter.com/stewartbrand). Matching is deliberately strict — an earlier
 * loose rule matched "frank" inside "viktor-frankl" and attributed Frankl's
 * page to Frank Chimero. Rows with no attributable URL, or more than one, are
 * left untouched: the gate already hides them, and a guess is worse.
 *
 * The quote is only adopted when the aggregate has exactly as many quote
 * segments as URLs, so position carries meaning. Otherwise the source is
 * repaired and the quote is left as-is — still suppressed by the gate, but
 * nothing is invented and nothing is destroyed.
 *
 * WHAT THIS TOUCHES
 *   - book_recommendations.source_url  (aggregate -> the one attributable URL)
 *   - book_recommendations.quote       (only on positionally aligned rows)
 *
 * Dry-run by default; --write persists and backs up prior values first.
 */
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://ghpdpvatfmvsahzsqgpp.supabase.co";
const READ_KEY = "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z";
const INDEXABLE = ["published", "approved", "indexed", "index"];
const WRITE = process.argv.includes("--write");
/**
 * Adopting the positionally-matching quote is OFF by default.
 *
 * Equal segment counts prove the counts match, not that the words are this
 * person's. A Munger row aligned to a quote that reads like Buffett's
 * Graham-and-Doddsville essay — plausible on a page about Munger's favourite
 * books, and wrong. The source URL is different: it literally contains the
 * person's name, which is evidence. Repair the source, leave the quote to a
 * human pass.
 */
const ADOPT_QUOTES = process.argv.includes("--adopt-quotes");
const OUT = path.join(path.resolve(__dirname, ".."), "backups");

const seg = (s) => String(s || "").split("|").map((x) => x.trim()).filter(Boolean);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Indices of URLs that carry this person's full identity, not a fragment. */
function attributableIndices(urls, person) {
  const slugKey = norm(person.slug);
  const nameKey = norm(person.name);
  const toks = person.name.toLowerCase().split(/\s+/).filter((t) => t.length > 2).map(norm);
  const hits = [];
  urls.forEach((u, i) => {
    const nu = norm(u);
    if (slugKey.length > 5 && nu.includes(slugKey)) return hits.push(i);
    if (nameKey.length > 5 && nu.includes(nameKey)) return hits.push(i);
    if (toks.length > 1 && toks.every((t) => nu.includes(t))) return hits.push(i);
  });
  return hits;
}

(async () => {
  const sb = createClient(SUPABASE_URL, READ_KEY);
  const { data: people } = await sb.from("people").select("id,slug,name").in("index_status", INDEXABLE);
  const byId = new Map(people.map((p) => [p.id, p]));

  let rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("book_recommendations")
      .select("id,person_id,source_url,quote,confidence_score")
      .in("person_id", [...byId.keys()])
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows = rows.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const plan = [];
  let sourceOnly = 0;
  let withQuote = 0;
  for (const r of rows) {
    const person = byId.get(r.person_id);
    if (!person) continue;
    const urls = seg(r.source_url);
    if (urls.length < 2) continue;
    const hits = attributableIndices(urls, person);
    if (hits.length !== 1) continue;
    const idx = hits[0];
    const patch = { source_url: urls[idx] };
    const quotes = seg(r.quote);
    if (ADOPT_QUOTES && quotes.length === urls.length && quotes.length > 1) {
      patch.quote = quotes[idx];
      withQuote++;
    } else {
      sourceOnly++;
    }
    plan.push({ id: r.id, person: person.name, before: { source_url: r.source_url, quote: r.quote }, patch });
  }

  console.log(`recommendations on published people: ${rows.length}`);
  console.log(`repairable (exactly one attributable URL): ${plan.length}`);
  console.log(`  source + matching quote adopted: ${withQuote}${ADOPT_QUOTES ? "" : "  (--adopt-quotes is OFF)"}`);
  console.log(`  source repaired, quote left alone: ${sourceOnly}`);
  for (const s of plan.slice(0, 5)) {
    console.log(`\n  ${s.person}`);
    console.log(`    source: ${seg(s.before.source_url).length} URLs -> ${s.patch.source_url.slice(0, 80)}`);
    if (s.patch.quote) console.log(`    quote : "${s.patch.quote.slice(0, 90)}…"`);
  }

  if (!WRITE) return console.log("\nDRY RUN — pass --write to persist.");
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("--write requires SUPABASE_SECRET_KEY");
  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "");
  const backup = path.join(OUT, `proof_deaggregation_pre_write_${stamp}.json`);
  fs.writeFileSync(backup, JSON.stringify(plan, null, 1));
  console.log(`backup: ${path.relative(process.cwd(), backup)}`);

  const admin = createClient(SUPABASE_URL, secret);
  let ok = 0;
  for (const s of plan) {
    const { error } = await admin.from("book_recommendations").update(s.patch).eq("id", s.id);
    if (error) console.log(`  FAILED ${s.id}: ${error.message}`);
    else ok++;
  }
  console.log(`updated ${ok}/${plan.length}`);
})();
