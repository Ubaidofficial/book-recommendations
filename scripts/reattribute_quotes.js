/**
 * Re-attribute pipe-aggregated recommendation sources/quotes to the person
 * who actually said them.  DRY RUN by default.
 *
 * BACKGROUND
 *
 * Ingest merged every source it found for a BOOK into each recommender's row
 * of that book: `source_url` holds many URLs joined by " | ", `quote` holds
 * many quotes joined by " | ". The same aggregate is copied onto every
 * owner's row of the book (Karlie Kloss, Daniel Ek and Vinod Khosla all carry
 * the identical Sapiens aggregate). Naval Ravikant's "Thinking, Fast and
 * Slow" row carries 25 URLs, mostly tweets by random accounts.
 * getProofDisplaySafety (src/lib/dataQuality.ts) hides all of it today.
 *
 * scripts/deaggregate_proof.js (never run with --write as far as the repo
 * shows: no backups/ dir, no CHANGELOG note) took the strict route — keep the
 * one URL that contains the owner's name, touch nothing else. Its lessons
 * still apply here:
 *   - never split N segments into N rows under the SAME person;
 *   - strict whole-token name matching ("frank" ⊂ "viktor-frankl");
 *   - positional quote adoption is unsafe.
 *
 * WHAT THIS DOES
 *
 * For every aggregated row, each URL segment gets an AUTHOR using only
 * evidence in the URL itself:
 *   twitter_handle_field     twitter/x/facebook/medium handle == people.twitter_handle
 *   twitter_handle_curated   handle in HANDLE_MAP below (hand-verified)
 *   twitter_handle_eq_slug   handle (minus _) == multi-token slug squashed, and
 *                            the slug is a clean rendering of the person's name
 *   personal_domain          host (+path prefix) in DOMAIN_MAP below
 *   interview_path           path on an interview/list host names exactly one
 *                            person (tim.blog/…/drew-houston/, longnow
 *                            …/stewart-brand-book-list…, nytimes …-by-the-book)
 *   article_path             same strict path match on any other non-denylisted
 *                            host — TIER 2, only with --allow-article-path
 * Everything else is unattributable and dropped from the aggregate.
 *
 * QUOTE PAIRING — NOT POSITIONAL
 *
 * Measured on this table: where the true quote for a URL is known (a
 * single-source, single-quote row elsewhere carries that exact URL), the
 * quote at the same position in an equal-count aggregate is the right one only
 * 458 of 6,506 times (7%); even 2-segment aggregates are a coin flip (271/513
 * where the right quote is present at all). The two lists are independently
 * ordered. So a quote is attached to a URL only when CORROBORATED: some
 * single-source single-quote row in the table pairs that exact URL with a
 * quote, and that same quote text is one of this aggregate's segments; or
 * CROSS_AGGREGATE: the URL sits in the aggregates of two or more different
 * books and exactly one quote is common to all of them (agrees with the
 * corroborated quote 87 of 91 times where both exist). A paired quote that @-mentions the attributed person's own handle is a
 * reply TO them, not their words, and is rejected. Positional agreement is
 * only reported, never used.
 *
 * ACTIONS (one CSV line per segment, plus one per orphaned row)
 *   KEEP_OWN          segment is the owner's → row.source_url = that URL,
 *                     row.quote = corroborated quote or NULL
 *   MOVE_TO_EXISTING  segment is P's, P has a row for the book with no clean
 *                     single source and no KEEP_OWN of its own → fill P's row
 *   CREATE_FOR_OTHER  segment is P's, P has no row for the book → insert
 *                     (adds recommendations; needs --allow-create to write)
 *   DUPLICATE         attributable, but the same target is already served by a
 *                     better/earlier segment, or P's row is already clean
 *   DROP              unattributable
 *   ORPHANED_OWNER    row-level: owner has no attributable segment and gets no
 *                     MOVE → source_url = NULL, quote = NULL, confidence 30
 *                     (row kept; deletion is the owner's call)
 *
 * OUTPUT  reports/quote_reattribution_plan.csv, reports/quote_reattribution_summary.json
 *
 * WRITE   node scripts/reattribute_quotes.js --write --confirm [--allow-create]
 *         Needs SUPABASE_SECRET_KEY. Re-reads every touched row, skips any
 *         that changed since planning, writes a full JSON backup to backups/
 *         before the first update.
 */
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://ghpdpvatfmvsahzsqgpp.supabase.co";
const READ_KEY = "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z";
const ROOT = path.resolve(__dirname, "..");
const REPORTS = path.join(ROOT, "reports");
const BACKUPS = path.join(ROOT, "backups");

const ARGS = new Set(process.argv.slice(2));
const WRITE = ARGS.has("--write");
const CONFIRM = ARGS.has("--confirm");
const ALLOW_CREATE = ARGS.has("--allow-create");
const ALLOW_ARTICLE_PATH = ARGS.has("--allow-article-path");

const PAGE = 1000;
const MAX_PAGES = 200; // hard bound on every paginated read
const IN_CHUNK = 100;
const LOW_CONFIDENCE = 30;
const HIGH_CONFIDENCE = 80;

// ─── Evidence maps (every slug is verified against `people` at runtime) ─────

/**
 * Handle → slug for accounts whose handle is not simply the slug squashed.
 * Each was checked against the people table; "corroborated N" = N existing
 * single-source rows of that person cite this handle's tweets.
 */
const HANDLE_MAP = {
  // name clearly inside the handle
  jaltucher: "james-altucher", // corroborated 7
  bhorowitz: "ben-horowitz",
  sniequist: "shauna-niequist", // corroborated 21
  awilkinson: "andrew-wilkinson", // corroborated 3
  iammarkmanson: "mark-manson", // corroborated 6
  jayshettyiw: "jay-shetty",
  iamsteveharvey: "steve-harvey",
  mjmauboussin: "michael-mauboussin", // corroborated 5
  realdonaldtrump: "donald-trump", // corroborated 13
  drsanjaygupta: "sanjay-gupta", // record says neurosurgeon = @drsanjaygupta
  profbriancox: "brian-cox",
  nytdavidbrooks: "david-brooks",
  mikeroweworks: "mike-rowe",
  scottadamssays: "scott-adams",
  realgenekim: "gene-kim",
  paulbloomatyale: "paul-bloom",
  matthaig1: "matt-haig",
  danielgolemanei: "daniel-goleman",
  bobproctorlive: "bob-proctor",
  timkellernyc: "timothy-keller", // corroborated 24
  theoliverstone: "oliver-stone",
  thatkevinsmith: "kevin-smith",
  patrick_oshag: "patrick-oshaughnessy", // corroborated 7
  al_humphreys: "alastair-humphreys", // corroborated 16
  adammgrant: "adam-grant", // corroborated 21
  kirkdborne: "kirk-borne", // corroborated 21
  thabitianyabwil: "thabiti-anyabwile", // corroborated 24
  amyjccuddy: "amy-cuddy", // corroborated 8
  sjosephburns: "steve-burns", // corroborated 8
  ericsmithrocks: "eric-smith", // corroborated 7
  thatericalper: "eric-alper", // corroborated 6
  ariannahuff: "arianna-huffington", // corroborated 7
  simonmontefiore: "simon-sebag-montefiore", // corroborated 6
  halseanderson: "laurie-halse-anderson", // corroborated 8 (dup stub halse-anderson)
  prchovanec: "patrick-chovanec", // corroborated 6
  asemota: "victor-asemota", // corroborated 5
  mangan150: "p-d-mangan", // corroborated 5
  doctorow: "cory-doctorow", // corroborated 4
  birbigs: "mike-birbiglia", // corroborated 4
  jsmian: "jawad-mian", // corroborated 4
  robgmacfarlane: "robert-macfarlane", // corroborated 4
  edyong209: "ed-yong", // corroborated 3
  chrislhayes: "chris-hayes", // corroborated 3
  profgalloway: "scott-galloway", // corroborated 3
  alexstubb: "alexander-stubb", // corroborated 4
  mpigliucci: "massimo-pigliucci", // corroborated 4
  agazdecki: "andrew-gazdecki", // corroborated 4
  gilbertliz: "elizabeth-gilbert", // corroborated 4
  drjengunter: "jennifer-gunter", // corroborated 4
  ericpmusselman: "eric-musselman", // corroborated 4
  cdivakaruni: "chitra-b-divakaruni", // corroborated 4
  revrichardcoles: "richard-coles", // corroborated 4
  adamwagner1: "adam-wagner", // corroborated 5
  sethamandel: "seth-mandel", // corroborated 4
  creynoldsnc: "christina-reynolds", // corroborated 6
  brandyljensen: "brandy-jensen", // corroborated 6
  lsarsour: "linda-sarsour", // corroborated 5
  shashib: "shashi-bellamkonda", // corroborated 5
  devonesawa: "devon-sawa", // corroborated 5
  arvindsubraman: "arvind-subramanian", // corroborated 5
  dominicdagosti2: "dominic-d-agostino", // corroborated 5
  paolini: "christopher-paolini", // corroborated 5
  djolder: "daniel-jos-older", // corroborated 7
  sacca: "chris-sacca", // corroborated 4
  moskov: "dustin-moskovitz", // corroborated 2
  skupor: "scott-kupor",
  melt_dem: "meltem-demirors", // corroborated 3
  jeffreyshaw1: "jeffrey-shaw",
  robinblackmma: "robin-black",
  iamsamirarora: "samir-arora", // corroborated 3
  thesamball: "sam-ball", // corroborated 3
  mralancooper: "alan-cooper",
  jimknight99: "jim-knight",
  gsiskind: "greg-siskind", // corroborated 3
  moorehn: "heidi-n-moore", // corroborated 3
  vladobotsvadze: "vladimer-botsvadze", // corroborated 2
  r_thaler: "richard-thaler",
  msuster: "mark-suster",
  bgurley: "bill-gurley", // corroborated 2
  // well-known handles that do not spell the full name
  dhh: "david-heinemeier-hansson", // corroborated 3
  tobi: "tobi-lutke", // corroborated 3
  austen: "austen-allred", // corroborated 3
  raoulgmi: "raoul-pal", // corroborated 6
  warikoo: "ankur-warikoo", // corroborated 10
  drmoore: "russell-moore", // corroborated 20
  sriramk: "sriram-krishnan", // corroborated 7
  film_girl: "christina-warren", // corroborated 7
  neilhimself: "neil-gaiman", // corroborated 8
  realgdt: "guillermo-del-toro", // corroborated 9
  primalpoly: "geoffrey-miller", // corroborated 9
  susanthesquark: "susan-j-fowler", // corroborated 12
  jmspool: "jared-spool", // corroborated 6
  samfr: "sam-freedman", // corroborated 5
  brainpicker: "maria-popova", // corroborated 4
  dribram: "ibram-x-kendi", // corroborated 4
  hnshah: "hiten-shah", // corroborated 4
  ljxie: "linda-xie", // corroborated 4
  kvlly: "kelly-vaughn", // corroborated 4
  realkidpoker: "daniel-negreanu", // corroborated 4
  rodinhood: "alok-kejriwal", // corroborated 4
  pronounced_ing: "celeste-ng", // corroborated 5
  thebookmaven: "bethanne-patrick", // corroborated 12
  donalynbooks: "donalyn-miller", // corroborated 12
  hels: "helen-rosner", // corroborated 8
  cz_binance: "changpeng-zhao",
  biz: "biz-stone",
  jack: "jack-dorsey", // corroborated 2
  waitbutwhy: "tim-urban", // corroborated 2
  imjennim: "jenn-im",
  work_matters: "bob-sutton", // corroborated 2
  __apf__: "adrienne-porter-felt",
  thehistoryguy: "dan-snow",
  simongerman600: "simon-kuestenmacher",
  anthilemoon: "annelaure-le-cunff",
  slicknet: "nicholas-c-zakas",
  // medium.com/@handle and facebook.com/<page>
  vkhosla: "vinod-khosla",
  barmstrong: "brian-armstrong",
  zuck: "mark-zuckerberg",
};

/**
 * Handles that would auto-match a slug but must not: a different person of
 * the same name, or a person record whose bio contradicts the account.
 */
const HANDLE_DENY = new Set([
  "_sanjaygupta", // not the neurosurgeon the sanjay-gupta record describes
  "achrisevans", // two Chris Evans accounts; only one record
  "awealthofcs", // ben-carlson record is enriched as a "Canadian actor"
  "stuartmcmillan1", // stuart-mcmillan record is a Scottish politician
]);

/** Host (optionally host + path prefix) → slug. Owner-published sites only. */
const DOMAIN_MAP = [
  ["sivers.org", "derek-sivers"],
  ["gatesnotes.com", "bill-gates"],
  ["nav.al", "naval-ravikant"],
  ["navalmanack.com", "naval-ravikant"], // Jorgenson's compilation of Naval's own words
  ["virgin.com/richard-branson", "richard-branson"],
  ["jordanbpeterson.com", "jordan-peterson"],
  ["okdork.com", "noah-kagan"],
  ["berkshirehathaway.com/letters", "warren-buffett"],
  ["waitbutwhy.com", "tim-urban"],
  ["humanwhocodes.com", "nicholas-c-zakas"],
  ["blog.codinghorror.com", "jeff-atwood"],
  ["jamesclear.com", "james-clear"],
  ["santana.com", "carlos-santana"],
  ["pickuplimes.com", "sadia-badiei"],
  ["tonyrobbins.com/news/tonys-", "tony-robbins"],
  ["blog.samaltman.com", "sam-altman"],
  ["jamesaltucher.com", "james-altucher"],
  ["ryanholiday.net", "ryan-holiday"],
  ["aubreymarcus.com", "aubrey-marcus"],
  ["scottadamssays.com", "scott-adams"],
  ["jimkwik.com", "jim-kwik"],
  ["mrmoneymustache.com", "mr-money-mustache"],
  ["susanjfowler.com", "susan-j-fowler"],
  ["guykawasaki.com", "guy-kawasaki"],
  ["paulgraham.com", "paul-graham"],
  ["patrickcollison.com", "patrick-collison"],
  ["barackobama.medium.com", "barack-obama"],
  ["obamawhitehouse.archives.gov/blog/2016/08/12/presidents-summer-reading-list", "barack-obama"],
  ["neilstrauss.com", "neil-strauss"],
  ["steveblank.com", "steve-blank"],
  ["markmanson.net", "mark-manson"],
  ["gretchenrubin.com", "gretchen-rubin"],
  ["jackkornfield.com", "jack-kornfield"],
  ["bobdylan.com", "bob-dylan"],
  ["oprah.com/oprahsbookclub/oprahs-", "oprah-winfrey"],
  ["ma.tt", "matt-mullenweg"],
  ["calacanis.com", "jason-calacanis"],
  ["caterina.net", "caterina-fake"],
  ["seths.blog", "seth-godin"],
  ["bryanjohnson.co", "bryan-johnson"],
  ["stratechery.com", "ben-thompson"],
];

/**
 * Duplicate person stubs for one human. Attribution to any member counts as
 * the same person (KEEP_OWN, or "already has a row"). Groups whose slug or
 * name squash to the same string are added automatically.
 */
const ALIAS_GROUPS = [
  ["peter-adeney", "mr-money-mustache", "money-mustache"],
  ["laurie-halse-anderson", "halse-anderson"],
  ["david-heinemeier-hansson", "heinemeier-hansson"],
  ["dominic-d-agostino", "d-agostino"],
  ["patrick-oshaughnessy", "patrick-o-shaughnessy", "o-shaughnessy"],
  ["bertalan-mesk", "berci-mesk"],
  ["george-r-r-martin", "r-r-martin"],
  ["tobi-lutke", "tobi-l-tke", "l-tke"],
];

/** Hosts whose pages are interviews/lists where the path names the recommender. */
const INTERVIEW_HOSTS = new Set([
  "tim.blog", "blog.longnow.org", "fivebooks.com", "thereadinglists.com",
  "onegrandbooks.com", "achievement.org", "producthunt.com", "fs.blog",
  "nytimes.com", "theweek.com", "linkedin.com", "quora.com", "oprah.com",
]);

/** No authorship evidence is possible from these. */
const HOST_DENY = [
  "amazon.", "goodreads.", "openlibrary.", "books.google.", "google.com", "books.googleusercontent.",
  "wikipedia.org", "docs.google.com", "bookshop.org", "barnesandnoble.com", "audible.", "foyles.",
  "youtube.com", "youtu.be", "vimeo.com", "instagram.com", "pinterest.", "ibb.co", "imgur.",
  "podbay.fm", "netflix.com", "archive.org",
];

const PATH_STOP_TOKENS = new Set([
  "book", "books", "reading", "list", "lists", "recommendations", "recommended", "best", "the",
  "and", "of", "review", "podcast", "show", "blog", "money", "mr",
]);
const TIM_FERRISS_HOST_NOISE = new Set(["show", "transcript", "transcripts", "podcast", "episode"]);
const RULE_RANK = {
  twitter_handle_field: 1, personal_domain: 2, twitter_handle_curated: 3,
  twitter_handle_eq_slug: 4, interview_path: 5, article_path: 6,
};
const STRONG_RULES = new Set(["twitter_handle_field", "personal_domain", "twitter_handle_curated", "twitter_handle_eq_slug"]);

// ─── Helpers ────────────────────────────────────────────────────────────────

const seg = (s) => String(s || "").split("|").map((x) => x.trim()).filter(Boolean);
const squash = (s) => String(s || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
const normQuote = (s) => squash(s);
const tokens = (s) => String(s || "").normalize("NFKD").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const csvCell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Port of isMetadataOrPurchaseSourceUrl (src/lib/dataQuality.ts). */
function isMetadataUrl(url) {
  if (!url) return true;
  const u = url.toLowerCase().trim();
  return ["books.google.", "google.com/books", "amazon.", "goodreads.", "openlibrary.", "covers.openlibrary.", "books.googleusercontent."]
    .some((b) => u.includes(b)) || /\.(png|jpe?g|gif|webp|svg|tiff|bmp)$/i.test(u);
}

/** Port of twitterStatusHandle (src/lib/dataQuality.ts). */
function twitterStatusHandle(url) {
  const m = /^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/([^/?#]+)\/status/i.exec((url || "").trim());
  return m ? m[1].toLowerCase() : null;
}

const SHREDDED_SURNAMES = ["gates", "ferriss", "ravikant", "obama", "zuckerberg", "collison", "andreessen",
  "graham", "peterson", "winfrey", "musk", "buffett", "clear", "altman", "dalio"];

/** Condensed port of getProofDisplaySafety → does this row show a quote? */
function showsQuote(row, person) {
  const quote = (row.quote || "").trim();
  const src = (row.source_url || "").trim();
  const urls = seg(src).filter((u) => /^https?:\/\//i.test(u) && !isMetadataUrl(u));
  const known = (person.twitter_handle || "").trim().replace(/^@/, "").toLowerCase();
  const th = twitterStatusHandle(urls[0]);
  const foreign = !!known && !!th && th !== known;
  const showSource = urls.length === 1 && !src.includes("|") && !isMetadataUrl(src) && !foreign;
  const conf = parseFloat(String(row.confidence_score));
  const showQuote = showSource && quote.length >= 50 && !quote.includes("|") && Number.isFinite(conf) && conf >= 70;
  if (!showQuote) return false;
  const parts = person.name.toLowerCase().split(" ");
  const last = parts[parts.length - 1];
  const first = parts[0];
  const su = src.toLowerCase();
  for (const s of SHREDDED_SURNAMES) {
    if (su.includes(s) && !person.name.toLowerCase().includes(s) && !su.includes(last) && !su.includes(first)) return false;
  }
  return true;
}

function isCleanSingleSource(row) {
  const src = (row.source_url || "").trim();
  if (!src || src.includes("|")) return false;
  const urls = seg(src);
  return urls.length === 1 && /^https?:\/\//i.test(urls[0]) && !isMetadataUrl(urls[0]);
}

async function readAll(sb, table, cols) {
  let out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await sb.from(table).select(cols).order("id").range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out = out.concat(data || []);
    if (!data || data.length < PAGE) return out;
  }
  throw new Error(`${table}: exceeded ${MAX_PAGES} pages`);
}

async function readByIds(sb, table, cols, ids) {
  const out = [];
  const list = [...ids];
  for (let i = 0; i < list.length; i += IN_CHUNK) {
    const { data, error } = await sb.from(table).select(cols).in("id", list.slice(i, i + IN_CHUNK)).limit(IN_CHUNK);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}

// ─── Attribution ────────────────────────────────────────────────────────────

function buildIndex(people) {
  const bySlug = new Map(people.map((p) => [p.slug, p]));
  const problems = [];

  // handle → { slug, rule }
  const handles = new Map();
  for (const p of people) {
    const h = (p.twitter_handle || "").trim().replace(/^@/, "").toLowerCase();
    if (h) handles.set(h, { slug: p.slug, rule: "twitter_handle_field" });
  }
  for (const [h, slug] of Object.entries(HANDLE_MAP)) {
    if (!bySlug.has(slug)) { problems.push(`HANDLE_MAP ${h} -> ${slug}: slug missing`); continue; }
    if (!handles.has(h)) handles.set(h, { slug, rule: "twitter_handle_curated" });
  }
  const explicitTargets = new Set([...handles.values()].map((v) => v.slug));

  // Path/slug matching only for clean multi-token slugs that spell the name.
  const pathPeople = [];
  const autoHandle = new Map(); // squashed slug → slug
  for (const p of people) {
    const toks = p.slug.split("-").filter(Boolean);
    if (toks.length < 2) continue; // surname-only stubs ("green", "williams")
    if (squash(p.name) !== squash(p.slug)) continue; // garbled slugs
    if (toks.some((t) => PATH_STOP_TOKENS.has(t) || /^\d+$/.test(t))) continue;
    if (squash(p.slug).length < 6) continue;
    pathPeople.push({ slug: p.slug, toks });
    if (!explicitTargets.has(p.slug)) autoHandle.set(squash(p.slug), p.slug);
  }
  const byFirstTok = new Map();
  for (const pp of pathPeople) {
    if (!byFirstTok.has(pp.toks[0])) byFirstTok.set(pp.toks[0], []);
    byFirstTok.get(pp.toks[0]).push(pp);
  }

  const domains = [];
  for (const [prefix, slug] of DOMAIN_MAP) {
    if (!bySlug.has(slug)) { problems.push(`DOMAIN_MAP ${prefix} -> ${slug}: slug missing`); continue; }
    domains.push({ prefix: prefix.toLowerCase(), slug });
  }
  domains.sort((a, b) => b.prefix.length - a.prefix.length);

  // alias groups: curated + identical squashed slug/name
  const canon = new Map();
  const union = (slugs) => {
    const present = slugs.filter((x) => bySlug.has(x));
    if (present.length < 2) return;
    const root = present.map((x) => canon.get(x) || x).sort()[0];
    for (const x of present) {
      const old = canon.get(x);
      if (old && old !== root) for (const [k, v] of canon) if (v === old) canon.set(k, root);
      canon.set(x, root);
    }
  };
  for (const g of ALIAS_GROUPS) {
    for (const x of g) if (!bySlug.has(x)) problems.push(`ALIAS_GROUPS ${x}: slug missing`);
    union(g);
  }
  for (const key of [(p) => squash(p.slug), (p) => squash(p.name)]) {
    const groups = new Map();
    for (const p of people) {
      const k = key(p);
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p.slug);
    }
    for (const g of groups.values()) if (g.length > 1) union(g);
  }
  const canonOf = (slug) => canon.get(slug) || slug;
  const membersOf = new Map();
  for (const [slug, root] of canon) {
    if (!membersOf.has(root)) membersOf.set(root, []);
    membersOf.get(root).push(slug);
  }
  const aliases = (slug) => membersOf.get(canonOf(slug)) || [slug];

  return { bySlug, handles, autoHandle, byFirstTok, domains, problems, canonOf, aliases };
}

function lookupHandle(idx, raw) {
  const h = String(raw || "").toLowerCase().replace(/^@/, "");
  if (!h || HANDLE_DENY.has(h)) return null;
  if (idx.handles.has(h)) return { ...idx.handles.get(h), handle: h };
  const slug = idx.autoHandle.get(h.replace(/_/g, ""));
  return slug ? { slug, rule: "twitter_handle_eq_slug", handle: h } : null;
}

/** People whose full slug appears as a contiguous token run in the path. */
function pathMatches(idx, pathTokens) {
  const hits = [];
  pathTokens.forEach((t, i) => {
    for (const pp of idx.byFirstTok.get(t) || []) {
      const n = pp.toks.length;
      let ok = i + n <= pathTokens.length;
      for (let k = 0; ok && k < n; k++) {
        const pt = pathTokens[i + k];
        const want = pp.toks[k];
        ok = pt === want || (k === n - 1 && pt === `${want}s`); // possessive: emma-watsons-books
      }
      if (ok) hits.push({ slug: pp.slug, start: i, end: i + n });
    }
  });
  // drop matches strictly inside a longer one (o-reilly inside tim-o-reilly)
  return hits.filter((a) => !hits.some((b) => b !== a && b.start <= a.start && b.end >= a.end && b.end - b.start > a.end - a.start));
}

function attributeUrl(idx, url, book) {
  let u;
  try { u = new URL(url); } catch { return { slug: null, rule: "unattributable:invalid_url" }; }
  const host = u.hostname.toLowerCase().replace(/^(www\.|mobile\.|m\.)/, "");
  const full = (host + u.pathname).toLowerCase();
  const segs = u.pathname.split("/").filter(Boolean);

  if (/^(twitter|x)\.com$/.test(host)) {
    const h = segs[0];
    if (!h || ["i", "search", "hashtag", "intent", "home", "share"].includes(h.toLowerCase())) return { slug: null, rule: "unattributable:twitter_no_handle" };
    return lookupHandle(idx, h) || { slug: null, rule: "unattributable:unknown_handle", handle: h.toLowerCase() };
  }
  if (host === "facebook.com" && segs[0] && segs[0] !== "pg") {
    const hit = lookupHandle(idx, segs[0]);
    if (hit) return hit;
  }
  if (host === "facebook.com" && segs[0] === "pg" && segs[1]) {
    const hit = lookupHandle(idx, segs[1]);
    if (hit) return hit;
  }
  if (host === "medium.com" && segs[0] && segs[0].startsWith("@")) {
    return lookupHandle(idx, segs[0].slice(1)) || { slug: null, rule: "unattributable:unknown_medium_author" };
  }

  for (const d of idx.domains) {
    if (full === d.prefix || full.startsWith(d.prefix.includes("/") ? d.prefix : `${d.prefix}/`) || host === d.prefix) {
      return { slug: d.slug, rule: "personal_domain" };
    }
  }

  if (HOST_DENY.some((d) => host.includes(d))) return { slug: null, rule: "unattributable:host_denylist" };

  const isInterview = INTERVIEW_HOSTS.has(host);
  if (host === "onegrandbooks.com" && !u.pathname.startsWith("/shop/curators/")) return { slug: null, rule: "unattributable:no_evidence" };
  const ptoks = tokens(decodeURIComponent(u.pathname));
  let hits = pathMatches(idx, ptoks);
  if (host === "tim.blog" && ptoks.some((t) => TIM_FERRISS_HOST_NOISE.has(t))) {
    // "the-tim-ferriss-show-transcripts-tobi-lutke": his name is the show's.
    // "tim-ferriss-and-kevin-rose-discuss…" stays ambiguous below.
    hits = hits.filter((h) => h.slug !== "tim-ferriss");
  }
  const distinct = [...new Set(hits.map((h) => h.slug))];
  if (distinct.length === 0) return { slug: null, rule: "unattributable:no_evidence" };
  if (distinct.length > 1) return { slug: null, rule: "unattributable:ambiguous_path" };
  const slug = distinct[0];
  const person = idx.bySlug.get(slug);
  const nameToks = tokens(person.name).filter((t) => t.length > 1);
  const authorToks = new Set(tokens(book?.author_name));
  const titleToks = new Set(tokens(book?.title));
  if (nameToks.length && nameToks.every((t) => authorToks.has(t))) return { slug: null, rule: "unattributable:path_names_book_author" };
  if (nameToks.length && nameToks.every((t) => titleToks.has(t))) return { slug: null, rule: "unattributable:path_names_book_subject" };
  const rule = isInterview ? "interview_path" : "article_path";
  if (rule === "article_path" && !ALLOW_ARTICLE_PATH) return { slug: null, rule: "unattributable:article_path_disabled", wouldBe: slug };
  return { slug, rule };
}

// ─── Main ───────────────────────────────────────────────────────────────────

(async () => {
  if (WRITE && (!process.env.SUPABASE_SECRET_KEY || !CONFIRM)) {
    console.error("--write requires SUPABASE_SECRET_KEY in the environment and --confirm.");
    process.exit(1);
  }
  const sb = createClient(SUPABASE_URL, READ_KEY);
  console.log("reading people + book_recommendations (read-only)…");
  const people = await readAll(sb, "people", "id,slug,name,twitter_handle,index_status");
  const recs = await readAll(sb, "book_recommendations", "id,book_id,person_id,source_url,quote,confidence_score");
  const personById = new Map(people.map((p) => [p.id, p]));
  const idx = buildIndex(people);
  for (const p of idx.problems) console.log(`  map problem: ${p}`);

  const isAgg = (r) => String(r.source_url || "").includes("|") || String(r.quote || "").includes("|");
  const aggRows = recs.filter(isAgg).sort((a, b) => (a.id < b.id ? -1 : 1));
  const books = await readByIds(sb, "books", "id,slug,title,author_name", new Set(aggRows.map((r) => r.book_id)));
  const bookById = new Map(books.map((b) => [b.id, b]));
  const rowByBookPerson = new Map(recs.map((r) => [`${r.book_id}|${r.person_id}`, r]));

  // URL → set of quotes it is paired with in single-source, single-quote rows.
  const corroborated = new Map();
  for (const r of recs) {
    const us = seg(r.source_url);
    if (us.length !== 1 || !r.quote || r.quote.includes("|")) continue;
    if (!corroborated.has(us[0])) corroborated.set(us[0], new Set());
    corroborated.get(us[0]).add(normQuote(r.quote));
  }

  // URL → the one quote common to every aggregate (of different books) that
  // carries it. A tweet listing five books is copied into five books'
  // aggregates with the same text; nothing else survives the intersection.
  // Checked against `corroborated`: 87 of 91 agree.
  const crossAggregate = new Map();
  {
    const byUrl = new Map();
    for (const r of aggRows) {
      const qset = new Set(seg(r.quote).map(normQuote));
      for (const u of seg(r.source_url)) {
        if (!byUrl.has(u)) byUrl.set(u, new Map());
        byUrl.get(u).set(r.book_id, qset);
      }
    }
    for (const [u, perBook] of byUrl) {
      if (perBook.size < 2) continue;
      let inter = null;
      for (const qs of perBook.values()) inter = inter ? new Set([...inter].filter((q) => qs.has(q))) : new Set(qs);
      if (inter.size === 1) crossAggregate.set(u, [...inter][0]);
    }
  }

  // ── Pass 1: attribute every segment
  const stats = { positional: { pairsWouldMake: 0, checkable: 0, agreeWithCorroborated: 0 }, rejectedAddressee: 0 };
  const segments = []; // flat list
  for (const r of aggRows) {
    const owner = personById.get(r.person_id);
    const book = bookById.get(r.book_id);
    const urls = seg(r.source_url);
    const quotes = seg(r.quote);
    const qNorm = quotes.map(normQuote);
    urls.forEach((url, i) => {
      const a = attributeUrl(idx, url, book);
      let quote = null;
      let pairing = "none";
      if (a.slug) {
        const known = corroborated.get(url);
        if (known) {
          const found = [...new Set(qNorm.map((q, k) => (known.has(q) ? k : -1)).filter((k) => k >= 0).map((k) => qNorm[k]))];
          if (found.length === 1) {
            const k = qNorm.indexOf(found[0]);
            quote = quotes[k];
            pairing = "corroborated";
            if (quotes.length === urls.length) {
              stats.positional.checkable++;
              if (k === i) stats.positional.agreeWithCorroborated++;
            }
          } else if (found.length > 1) pairing = "ambiguous";
        }
        if (!quote && pairing === "none" && crossAggregate.has(url)) {
          const k = qNorm.indexOf(crossAggregate.get(url));
          if (k >= 0) { quote = quotes[k]; pairing = "cross_aggregate"; }
        }
        if (quotes.length === urls.length) stats.positional.pairsWouldMake++;
        const target = idx.bySlug.get(a.slug);
        const ownHandles = [a.handle, (target.twitter_handle || "").toLowerCase()].filter(Boolean);
        if (quote && ownHandles.some((h) => new RegExp(`@${h}(?![a-z0-9_])`, "i").test(quote))) {
          quote = null;
          pairing = "rejected_addressee";
          stats.rejectedAddressee++;
        }
      }
      segments.push({ row: r, owner, book, i, url, a, quote, pairing, action: null, targetRowId: null, note: "" });
    });
  }

  const quality = (s) => [
    s.quote && s.quote.length >= 50 ? 0 : s.quote ? 1 : 2,
    RULE_RANK[s.a.rule] || 9,
    s.i,
  ];
  const better = (x, y) => {
    const qx = quality(x);
    const qy = quality(y);
    for (let k = 0; k < qx.length; k++) if (qx[k] !== qy[k]) return qx[k] < qy[k];
    return x.row.id < y.row.id;
  };

  // ── Pass 2: KEEP_OWN — best own segment per row
  const keepByRow = new Map();
  for (const s of segments) {
    if (!s.a.slug || idx.canonOf(s.a.slug) !== idx.canonOf(s.owner.slug)) continue;
    const cur = keepByRow.get(s.row.id);
    if (!cur || better(s, cur)) keepByRow.set(s.row.id, s);
  }
  for (const s of segments) {
    if (s.a.slug && idx.canonOf(s.a.slug) === idx.canonOf(s.owner.slug)) {
      if (keepByRow.get(s.row.id) === s) s.action = "KEEP_OWN";
      else { s.action = "DUPLICATE"; s.note = "owner already keeps a better segment"; }
    }
  }

  // ── Pass 3: other people — best segment per (book, person)
  const bestForTarget = new Map();
  for (const s of segments) {
    if (!s.a.slug || s.action) continue;
    const k = `${s.row.book_id}|${idx.canonOf(s.a.slug)}`;
    const cur = bestForTarget.get(k);
    if (!cur || better(s, cur)) bestForTarget.set(k, s);
  }
  const movedInto = new Set();
  for (const s of segments) {
    if (!s.a.slug || s.action) continue;
    const k = `${s.row.book_id}|${idx.canonOf(s.a.slug)}`;
    if (bestForTarget.get(k) !== s) { s.action = "DUPLICATE"; s.note = "same (book, person) served by another segment"; continue; }
    const candidates = [s.a.slug, ...idx.aliases(s.a.slug).filter((x) => x !== s.a.slug)];
    const existing = candidates.map((slug) => rowByBookPerson.get(`${s.row.book_id}|${idx.bySlug.get(slug).id}`)).find(Boolean);
    if (!existing) {
      // a surname-only stub ("trump", "cox") may already hold this recommendation
      const stub = idx.bySlug.get(s.a.slug.split("-").pop());
      if (stub && rowByBookPerson.has(`${s.row.book_id}|${stub.id}`)) { s.action = "DUPLICATE"; s.note = `surname stub ${stub.slug} already has a row`; continue; }
      s.action = "CREATE_FOR_OTHER";
      continue;
    }
    s.targetRowId = existing.id;
    if (keepByRow.has(existing.id)) { s.action = "DUPLICATE"; s.note = "target row gets its own KEEP_OWN"; continue; }
    if (isCleanSingleSource(existing)) { s.action = "DUPLICATE"; s.note = "target row already has a clean single source"; continue; }
    s.action = "MOVE_TO_EXISTING";
    movedInto.add(existing.id);
  }
  for (const s of segments) if (!s.action) s.action = "DROP";

  // ── Row-level: orphaned owners
  const orphaned = aggRows.filter((r) => !keepByRow.has(r.id) && !movedInto.has(r.id));

  // ── Patches (exactly what --write would apply)
  const updates = new Map(); // row id → { before, patch, action }
  for (const [rowId, s] of keepByRow) {
    updates.set(rowId, { action: "KEEP_OWN", before: s.row, patch: { source_url: s.url, quote: s.quote || null } });
  }
  for (const s of segments.filter((x) => x.action === "MOVE_TO_EXISTING")) {
    const target = recs.find((r) => r.id === s.targetRowId);
    updates.set(s.targetRowId, { action: "MOVE_TO_EXISTING", before: target, patch: { source_url: s.url, quote: s.quote || null }, fromRowId: s.row.id });
  }
  for (const r of orphaned) {
    if (updates.has(r.id)) continue;
    updates.set(r.id, { action: "ORPHANED_OWNER", before: r, patch: { source_url: null, quote: null, confidence_score: LOW_CONFIDENCE } });
  }
  const creates = segments.filter((s) => s.action === "CREATE_FOR_OTHER").map((s) => ({
    book_id: s.row.book_id,
    person_id: idx.bySlug.get(s.a.slug).id,
    source_url: s.url,
    quote: s.quote || null,
    confidence_score: STRONG_RULES.has(s.a.rule) ? HIGH_CONFIDENCE : LOW_CONFIDENCE,
    _from_row_id: s.row.id,
    _rule: s.a.rule,
  }));

  // ── Before/after displayability
  const after = new Map(recs.map((r) => [r.id, { ...r }]));
  for (const [id, u] of updates) Object.assign(after.get(id), u.patch);
  const peopleWithQuote = (rows) => {
    const set = new Set();
    let n = 0;
    for (const r of rows) {
      const p = personById.get(r.person_id);
      if (p && showsQuote(r, p)) { set.add(p.id); n++; }
    }
    return { rows: n, people: set.size };
  };
  const before = peopleWithQuote(recs);
  const afterNoCreate = peopleWithQuote([...after.values()]);
  const afterWithCreate = peopleWithQuote([...after.values(), ...creates]);

  // ── Summaries
  const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  const perAction = count(segments, (s) => s.action);
  perAction.ORPHANED_OWNER_rows = orphaned.length;
  const perRule = count(segments, (s) => s.a.rule);
  const perRuleAction = count(segments.filter((s) => s.a.slug), (s) => `${s.a.rule} → ${s.action}`);
  const pairing = count(segments.filter((s) => ["KEEP_OWN", "MOVE_TO_EXISTING", "CREATE_FOR_OTHER"].includes(s.action)), (s) => `${s.action}:${s.pairing}`);
  const gains = {};
  for (const s of segments) {
    if (!["KEEP_OWN", "MOVE_TO_EXISTING", "CREATE_FOR_OTHER"].includes(s.action) || !s.quote) continue;
    gains[s.a.slug] = (gains[s.a.slug] || 0) + 1;
  }
  const topGainers = Object.entries(gains).sort((a, b) => b[1] - a[1]).slice(0, 20);
  const unknownHandles = count(segments.filter((s) => s.a.rule === "unattributable:unknown_handle"), (s) => s.a.handle);
  const topUnknownHandles = Object.entries(unknownHandles).sort((a, b) => b[1] - a[1]).slice(0, 25);
  const articleWouldBe = segments.filter((s) => s.a.rule === "unattributable:article_path_disabled").length;

  // Already-"clean" single-source tweet rows that cite a known OTHER person.
  let singleForeign = 0;
  for (const r of recs) {
    if (isAgg(r)) continue;
    const us = seg(r.source_url);
    if (us.length !== 1) continue;
    const h = twitterStatusHandle(us[0]);
    const hit = h && lookupHandle(idx, h);
    if (hit && hit.slug !== personById.get(r.person_id).slug) singleForeign++;
  }

  const naval = idx.bySlug.get("naval-ravikant");
  const navalRows = naval ? recs.filter((r) => r.person_id === naval.id) : [];
  const navalAgg = navalRows.filter(isAgg);
  const navalSummary = naval && {
    rows: navalRows.length,
    aggregated: navalAgg.length,
    keepOwn: navalAgg.filter((r) => keepByRow.has(r.id)).length,
    keepOwnWithQuote: navalAgg.filter((r) => keepByRow.get(r.id)?.quote).length,
    keepOwnByRule: count(navalAgg.filter((r) => keepByRow.has(r.id)), (r) => keepByRow.get(r.id).a.rule),
    receivesMove: navalAgg.filter((r) => movedInto.has(r.id)).length,
    orphaned: navalAgg.filter((r) => orphaned.includes(r)).length,
    createsForNaval: creates.filter((c) => c.person_id === naval.id).length,
    displayableBefore: navalRows.filter((r) => showsQuote(r, naval)).length,
    displayableAfter: navalRows.filter((r) => showsQuote(after.get(r.id), naval)).length,
  };

  const summary = {
    generated_at: new Date().toISOString(),
    flags: { allowArticlePath: ALLOW_ARTICLE_PATH },
    input: { recommendations: recs.length, aggregatedRows: aggRows.length, segments: segments.length, people: people.length },
    perAction,
    perRule,
    perRuleAction,
    quotePairing: pairing,
    positionalPairingCheck: stats.positional,
    rejectedAddresseeQuotes: stats.rejectedAddressee,
    rowUpdates: count([...updates.values()], (u) => u.action),
    creates: { total: creates.length, withQuote: creates.filter((c) => c.quote).length, toDraftPeople: creates.filter((c) => personById.get(c.person_id).index_status === "draft").length },
    displayableQuotes: { before, afterWithoutCreates: afterNoCreate, afterWithCreates: afterWithCreate },
    topGainers,
    topUnknownHandles,
    articlePathCandidatesDisabled: articleWouldBe,
    singleSourceRowsCitingAnotherKnownPersonsTweet: singleForeign,
    naval: navalSummary,
    mapProblems: idx.problems,
    maps: { handleMap: HANDLE_MAP, handleDeny: [...HANDLE_DENY], domainMap: DOMAIN_MAP },
  };

  fs.mkdirSync(REPORTS, { recursive: true });
  const header = ["row_id", "book_slug", "book_title", "owner_slug", "segment_index", "url", "quote_excerpt", "attributed_slug", "rule", "action", "pairing", "target_row_id", "note"];
  const lines = [header.join(",")];
  for (const s of segments) {
    lines.push([s.row.id, s.book?.slug, s.book?.title, s.owner.slug, s.i, s.url, (s.quote || "").slice(0, 160), s.a.slug || s.a.wouldBe || "", s.a.rule, s.action, s.pairing, s.targetRowId || "", s.note].map(csvCell).join(","));
  }
  for (const r of orphaned) {
    const b = bookById.get(r.book_id);
    lines.push([r.id, b?.slug, b?.title, personById.get(r.person_id).slug, "-", "", "", "", "", "ORPHANED_OWNER", "", "", `${seg(r.source_url).length} urls / ${seg(r.quote).length} quotes, none attributable to owner`].map(csvCell).join(","));
  }
  fs.writeFileSync(path.join(REPORTS, "quote_reattribution_plan.csv"), lines.join("\n") + "\n");
  fs.writeFileSync(path.join(REPORTS, "quote_reattribution_summary.json"), JSON.stringify(summary, null, 2));

  console.log(`\nrecommendations ${recs.length} · aggregated rows ${aggRows.length} · URL segments ${segments.length}`);
  console.log("\nsegments per action:");
  for (const [k, v] of Object.entries(perAction)) console.log(`  ${k.padEnd(22)} ${v}`);
  console.log("\nsegments per rule:");
  for (const [k, v] of Object.entries(perRule).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(40)} ${v}`);
  console.log("\nquote pairing on planned actions:", pairing);
  console.log(`positional pairing check: of ${stats.positional.checkable} corroborated pairs in equal-count rows, ${stats.positional.agreeWithCorroborated} are at the same position`);
  console.log(`row updates: ${JSON.stringify(summary.rowUpdates)} · creates: ${JSON.stringify(summary.creates)}`);
  console.log("\ntop 20 people gaining attributable quotes:");
  for (const [slug, n] of topGainers) console.log(`  ${slug.padEnd(28)} ${n}`);
  console.log("\nrows / people with a displayable quote (getProofDisplaySafety port):");
  console.log(`  before                  ${before.rows} rows · ${before.people} people`);
  console.log(`  after (no creates)      ${afterNoCreate.rows} rows · ${afterNoCreate.people} people`);
  console.log(`  after (with creates)    ${afterWithCreate.rows} rows · ${afterWithCreate.people} people`);
  if (navalSummary) console.log("\nnaval-ravikant:", JSON.stringify(navalSummary));
  console.log(`\narticle_path matches held back (enable with --allow-article-path): ${articleWouldBe}`);
  console.log(`single-source rows citing another known person's tweet (not touched): ${singleForeign}`);
  console.log(`\nplan: ${path.relative(process.cwd(), path.join(REPORTS, "quote_reattribution_plan.csv"))}`);

  if (!WRITE) return console.log("\nDRY RUN — nothing written. See header for the --write command.");

  // ── WRITE (never runs without SUPABASE_SECRET_KEY + --confirm)
  const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  const ids = [...updates.keys()];
  const current = await readByIds(admin, "book_recommendations", "*", new Set(ids));
  const curById = new Map(current.map((r) => [r.id, r]));
  fs.mkdirSync(BACKUPS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "");
  const backup = path.join(BACKUPS, `quote_reattribution_pre_write_${stamp}.json`);
  fs.writeFileSync(backup, JSON.stringify({ rows: current, plannedUpdates: [...updates], plannedCreates: ALLOW_CREATE ? creates : [] }, null, 1));
  console.log(`backup: ${path.relative(process.cwd(), backup)} (${current.length} rows)`);

  let ok = 0, skipped = 0, failed = 0;
  for (const [id, u] of updates) {
    const cur = curById.get(id);
    if (!cur || cur.source_url !== u.before.source_url || cur.quote !== u.before.quote) { skipped++; continue; }
    const { error } = await admin.from("book_recommendations").update(u.patch).eq("id", id);
    if (error) { failed++; console.log(`  FAILED ${id}: ${error.message}`); } else ok++;
  }
  console.log(`updated ${ok}/${updates.size} (skipped ${skipped} changed since plan, failed ${failed})`);

  if (!ALLOW_CREATE) return console.log(`CREATE_FOR_OTHER: ${creates.length} planned, not written (pass --allow-create).`);
  let made = 0;
  for (const c of creates) {
    const { data: exists, error: e1 } = await admin.from("book_recommendations").select("id").eq("book_id", c.book_id).eq("person_id", c.person_id).limit(1);
    if (e1) { console.log(`  FAILED check ${c.book_id}/${c.person_id}: ${e1.message}`); continue; }
    if (exists && exists.length) continue;
    const { _from_row_id, _rule, ...row } = c;
    const { error } = await admin.from("book_recommendations").insert(row);
    if (error) console.log(`  FAILED insert ${c.book_id}/${c.person_id}: ${error.message}`); else made++;
  }
  console.log(`created ${made}/${creates.length}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
