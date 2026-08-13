/**
 * Data quality helpers for sanitizing and validating Supabase data before display.
 */

export function isValidHttpUrl(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  return /^https?:\/\//i.test(value.trim());
}

/**
 * True iff the URL points at an Amazon affiliate domain (incl. regional TLDs and
 * the amzn.to / amzn.com short-link hosts). Conservative: requires `amazon` to be
 * a full hostname label, so `pre-amazon.com` and `amazon-asia.com` do NOT match.
 *
 * Matches:
 *   - amazon.com, amazon.co.uk, amazon.ca, amazon.de, amazon.fr, amazon.co.jp,
 *     amazon.com.au, amazon.es, amazon.it, … (any `amazon.<tld>` or `amazon.<tld>.<tld>`)
 *   - www.amazon.com, smile.amazon.com, read.amazon.com (any subdomain of amazon.<tld>)
 *   - amzn.to, amzn.com (short-link hosts)
 *
 * Does NOT match: malformed URLs, non-amazon hosts, or substrings inside other domains.
 */
export function isAmazonUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "amzn.to" || host === "amzn.com") return true;
  // Either the hostname IS amazon.<tld>[.<tld>], or any subdomain of one
  // (the `(^|\.)` boundary requires `amazon` to be a full label).
  return /(^|\.)amazon(\.[a-z]{2,3}){1,2}$/.test(host);
}

/**
 * Returns the `rel` attribute value to use on an outbound `<a>` tag.
 * Amazon links get the affiliate-compliant `sponsored` token added; all
 * other outbound links keep the safe-default `noopener noreferrer nofollow`.
 *
 * Use this on every outbound proof / source / CTA anchor that may carry an
 * Amazon URL coming from data (e.g. `source_url`, `book.amazon_url`).
 */
export function outboundLinkRel(url: string | null | undefined): string {
  return isAmazonUrl(url)
    ? "noopener noreferrer nofollow sponsored"
    : "noopener noreferrer nofollow";
}

function getAmazonAssociateTag(): string {
  return (process.env.AMAZON_ASSOCIATE_TAG || process.env.NEXT_PUBLIC_AMAZON_ASSOCIATE_TAG || "bookmentions-20").trim();
}

function withAmazonAssociateTag(u: URL): string {
  const tag = getAmazonAssociateTag();

  // Do not modify Amazon image/CDN hosts or short links. Only monetize normal
  // Amazon product/search URLs where adding ?tag= is safe and expected.
  const host = u.hostname.toLowerCase();
  if (host === "images-na.ssl-images-amazon.com" || host.endsWith(".ssl-images-amazon.com")) {
    return u.toString();
  }
  if (host === "amzn.to" || host === "amzn.com") {
    return u.toString();
  }

  if (!tag) return u.toString();
  if (!u.searchParams.get("tag")) {
    u.searchParams.set("tag", tag);
  }
  return u.toString();
}

/**
 * Normalize a raw `books.amazon_url` for safe CTA rendering. Repairs the
 * dominant data-quality bug in `books.amazon_url` (≈23% of rows) where a
 * `/dp/<ASIN>` path carries a 22-character "ASIN" that is actually a valid
 * 10-char ASIN concatenated with a 12-char hex hash, e.g.
 *
 *     /dp/148145731490a4537824dd  →  /dp/1481457314
 *     /dp/B08DC19QY8e97bee4139c6  →  /dp/B08DC19QY8
 *     /dp/B00BSBVK4Ae293cb7549ed  →  /dp/B00BSBVK4A
 *
 * Without this repair, Amazon's product lookup fails on the broken ASIN and
 * the user lands on a "page not found" page — the commercial click is wasted
 * and reads as broken to the user.
 *
 * Behavior:
 *   - null / undefined / empty / non-string         → null
 *   - URL fails parse / non-http(s) protocol         → null
 *   - Non-Amazon host (per `isAmazonUrl`)            → null
 *     (lets the caller suppress the CTA cleanly)
 *   - Already-valid `/dp/<10-char-ASIN>` URLs        → returned unchanged
 *   - 22-char `/dp/` candidate whose first 10 chars
 *     match the ASIN/ISBN-10 shape `[A-Z0-9]{10}`    → truncated to first 10
 *   - Search URLs (`/s?…`) and other Amazon paths    → returned unchanged
 *   - Other malformed lengths (5, 6, 11, …)          → returned unchanged
 *     (too uncertain to auto-repair)
 *
 * Preserves: protocol, host (including regional TLDs like amazon.ca),
 * query string, and any pre/post-ASIN path segments (so the canonical
 * `/Some-Book-Title/dp/<ASIN>/ref=…` SEO form is preserved).
 *
 * Does NOT:
 *   - require an affiliate tag to be present. If AMAZON_ASSOCIATE_TAG is set,
 *     appends it to normal Amazon product/search URLs that do not already
 *     have a tag. If no tag is set, returns the clean normalized URL.
 *   - rewrite hosts
 *   - convert non-Amazon URLs into Amazon URLs
 *   - touch any tracking parameters
 *
 * Apply at the CTA render site only — never write the normalized value back
 * to the database from this helper.
 */
export function normalizeAmazonUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }

  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!isAmazonUrl(trimmed)) return null;

  const host = u.hostname.toLowerCase();
  const associateTag = (
    process.env.AMAZON_ASSOCIATE_TAG ||
    process.env.NEXT_PUBLIC_AMAZON_ASSOCIATE_TAG ||
    ""
  ).trim();

  // Never add Associate tags to Amazon image/CDN URLs or short links.
  const shouldSkipTag =
    host === "amzn.to" ||
    host === "amzn.com" ||
    host.includes("ssl-images-amazon.com") ||
    host.includes("images-amazon.com");

  const VALID_ASIN = /^[A-Z0-9]{10}$/i;
  const m = u.pathname.match(/^(.*\/dp\/)([^\/?#]+)(.*)$/);

  if (m) {
    const [, prefix, candidate, suffix] = m;

    if (!VALID_ASIN.test(candidate)) {
      const repaired = candidate.slice(0, 10);
      if (candidate.length === 22 && VALID_ASIN.test(repaired)) {
        u.pathname = `${prefix}${repaired.toUpperCase()}${suffix}`;
      }
    }
  }

  if (associateTag && !shouldSkipTag && !u.searchParams.get("tag")) {
    u.searchParams.set("tag", associateTag);
  }

  return u.toString();
}

export function isValidRating(value: unknown): boolean {
  if (value == null) return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= 5;
}

export function formatRating(value: unknown): number | null {
  if (!isValidRating(value)) return null;
  return Math.round(Number(value) * 10) / 10;
}

/**
 * Formats a confidence_score value for display.
 * - null/undefined → null
 * - 0 < v <= 1 → convert to percentage (multiply by 100)
 * - 1 < v <= 100 → display as percentage
 * - v > 100 → null (invalid)
 */
export function formatConfidence(value: unknown): string | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  if (n <= 1) return Math.round(n * 100) + "%";
  return Math.round(n) + "%";
}

// --- Language / junk detection ---

const NON_ENGLISH_MARKERS = [
  // Spanish
  /\bel libro\b/i, /\btraducido\b/i, /\bvendidos\b/i, /\bla historia\b/i,
  /\bidomas\b/i, /\bcomenzado\b/i, /\bhumanidad\b/i, /\baños\b/i,
  /\busted\b/i, /\busted\b/i, /\bmuchos\b/i, /\bnuestra\b/i,
  // Indonesian
  /\btanggal terbit\b/i, /\binformasi lainnya\b/i, /\bhalaman\b/i,
  /\bpenerbit\b/i, /\boleh\b/i,
  // French
  /\best un\b/i, /\bdans le\b/i, /\bpour les\b/i, /\bplus de\b/i,
  // German
  /\bund die\b/i, /\bfür die\b/i, /\bbuch ist\b/i,
];

// Common English stopwords — high ratio suggests English text
const ENGLISH_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "this", "that", "it", "its", "he", "she", "they", "his", "her", "their",
  "has", "have", "had", "not", "no", "who", "which", "will", "can", "may",
  "one", "all", "about", "more", "some", "than", "also", "when", "into",
]);

export function isLikelyEnglish(text: string | null | undefined): boolean {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.length < 50) return true; // too short to judge
  for (const m of NON_ENGLISH_MARKERS) {
    if (m.test(trimmed)) return false;
  }
  const words = trimmed.toLowerCase().split(/[\s,.;:!?"']+/).filter(Boolean);
  if (words.length < 10) return true;
  const stopwordCount = words.filter((w) => ENGLISH_STOPWORDS.has(w)).length;
  const ratio = stopwordCount / words.length;
  if (ratio < 0.1) return false;

  // Check for high ratio of accented/non-ASCII letters
  const nonAsciiWords = words.filter((w) => /[^\x00-\x7F]/.test(w));
  if (nonAsciiWords.length / words.length > 0.2) return false;

  return true;
}

const SCRAPED_JUNK_PATTERNS = [
  /goodreads\s*profile/i,
  /books\s*read\s*section/i,
  /description\s*not\s*available/i,
  /no\s*description\s*available/i,
  // Internal/placeholder review text that must never reach public pages
  /description\s*is\s*being\s*reviewed/i,
  /description\s*pending/i,
  /description\s*coming\s*soon/i,
  /placeholder\s*description/i,
  /under\s*review/i,
  /coming\s*soon[\s.]*$/i,
  /^\s*to\s*be\s*added/i,
  /^\s*tbd[\s.]*$/i,
  /^\s*$/,
];

export function isUsefulDescription(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 80) return false;
  for (const pattern of SCRAPED_JUNK_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }
  if (!isLikelyEnglish(trimmed)) return false;
  return true;
}

// Common placeholder strings authors / scrapers sometimes write into a bio
// when the real value is unknown. Treated as missing data; would render as
// noise if shown. The check is case-insensitive on a trimmed value.
const PERSON_BIO_PLACEHOLDERS = new Set([
  "null",
  "undefined",
  "n/a",
  "na",
  "none",
  "tbd",
  "coming soon",
  "to be added",
  "-",
]);

/**
 * Lighter-weight bio gate for person detail pages. Phase A backfilled
 * hand-curated one-sentence bios (44–109 chars) for hub-visible recommenders,
 * many of which fall below the 80-char threshold isUsefulDescription was
 * tuned for (long AI-generated book descriptions with scrape-junk detection).
 *
 * Accepts any non-empty, non-placeholder string >= 20 chars. Does NOT run
 * the English-language detection or the SCRAPED_JUNK_PATTERNS check — those
 * were designed for book descriptions imported from the wild, not for short
 * hand-written person bios.
 *
 * Returns false for:
 *   - null / undefined / non-string
 *   - empty after trim
 *   - trimmed length < 20
 *   - case-insensitive placeholder strings (null / undefined / n/a / none /
 *     tbd / coming soon / to be added / "-")
 *
 * Used by src/app/people/[slug]/page.tsx for the visible bio paragraph.
 * The SEO meta-description fallback and the JSON-LD `description` field on
 * the same page still use isUsefulDescription — they have different audience
 * (Google crawler) and tighter quality requirements.
 */
export function isUsefulPersonBio(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 20) return false;
  if (PERSON_BIO_PLACEHOLDERS.has(trimmed.toLowerCase())) return false;
  return true;
}

/**
 * Launch-safety predicate: detect bare-surname alias rows that carry no
 * profile signals. These rows (e.g. `hitchens`, `brand`, `watson`,
 * `sabatini`, `rowling`, `harris`) typically aggregate book recommendations
 * from many distinct recommenders sharing a surname, with the result that
 * a single anonymous "Hitchens" entry can outrank the canonical
 * "Christopher Hitchens" by raw recommendation count.
 *
 * Returns true when ALL of the following hold:
 *   - `name` has no whitespace after trim (single-token surname only)
 *   - `role` is empty / null / whitespace-only
 *   - `bio`  is empty / null / whitespace-only
 *   - `avatar_url` is empty / null / whitespace-only
 *
 * Used as a structural filter on listing surfaces (the `/people` hub and
 * the book-detail "Recommended by notable people" face grid). Direct
 * `/people/<slug>` pages remain reachable — the row is preserved in the
 * database and accessible at its URL; only its prominence on listing
 * surfaces is suppressed. Reversible by populating any one of role / bio /
 * avatar_url, or by removing this helper from the relevant call site.
 */
export function isProfilelessSurnameAlias(p: {
  name: string | null | undefined;
  role: string | null | undefined;
  bio: string | null | undefined;
  avatar_url: string | null | undefined;
}): boolean {
  const name = (p.name || "").trim();
  if (!name) return false;             // empty-name rows handled by other guards
  if (name.includes(" ")) return false; // multi-token names are out of scope
  const role = (p.role || "").trim();
  const bio = (p.bio || "").trim();
  const avatar = (p.avatar_url || "").trim();
  return !role && !bio && !avatar;
}

export function cleanDescription(value: string | null | undefined, maxLength = 700): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const cut = trimmed.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxLength * 0.8 ? cut.slice(0, lastSpace) : cut) + "…";
}

export function uniqueByNormalizedText<T>(items: T[], key: keyof T): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const raw = item[key];
    if (raw == null) return true;
    const norm = String(raw).replace(/\s+/g, " ").trim().toLowerCase();
    if (!norm) return true;
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
}

/**
 * Parse a recommendation source_url that may contain one or more URLs joined in dirty ways.
 *
 * Handles:
 *  - " | " separated (pipe joined)
 *  - ",%20" / ", " / "," followed by http (comma joined, with or without URL-encoded space)
 *  - adjacent concatenation: "http…http…" with no separator
 *  - malformed single-slash prefix: "https:/twitter.com" -> "https://twitter.com"
 *
 * Does NOT split:
 *  - web.archive.org URLs (the embedded http:// is part of the archive path)
 *  - encoded params like `?ref_url=https%3A%2F%2F…` (no literal `://`, so untouched)
 *
 * Returns deduped, validated http(s) URLs (may be empty).
 */
export function hasPipeAggregate(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.includes("|");
}

export function isMetadataOrPurchaseSourceUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const uLower = url.toLowerCase().trim();
  return [
    "books.google.",
    "google.com/books",
    "amazon.",
    "goodreads.",
    "openlibrary.",
    "covers.openlibrary.",
    "books.googleusercontent.",
  ].some((bad) => uLower.includes(bad)) ||
  /\.(png|jpe?g|gif|webp|svg|tiff|bmp)$/i.test(uLower);
}

export function parseSourceUrls(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== "string") return [];
  const s = raw.trim();
  if (!s) return [];

  // 1) explicit separators: pipe, or comma(+ optional %20/space) immediately before http
  const initial = s.split(/\s*\|\s*|,\s*(?:%20)?\s*(?=https?:\/)/);

  const out: string[] = [];
  for (let chunk of initial) {
    chunk = chunk.trim();
    if (!chunk) continue;

    // archive.org legitimately embeds a second http:// — keep whole
    if (chunk.includes("web.archive.org")) {
      out.push(chunk);
      continue;
    }

    // 2) adjacent concatenation: insert a split before a literal http(s):// preceded by non-space.
    //    encoded `%2F%2F` params never contain a literal `://`, so they survive untouched.
    const subs = chunk.split(/(?<=\S)(?=https?:\/\/)/);
    for (const sub of subs) {
      const t = sub.trim();
      if (t) out.push(t);
    }
  }

  // 3) normalize + validate + dedupe
  const seen = new Set<string>();
  const final: string[] = [];
  for (let u of out) {
    u = u.trim().replace(/^,+/, "").replace(/,+$/, "").trim();
    while (u.endsWith("%20")) u = u.slice(0, -3).trim();
    // malformed single-slash prefix: "https:/twitter.com" -> "https://twitter.com"
    u = u.replace(/^(https?):\/(?!\/)/i, "$1://");
    if (!/^https?:\/\//i.test(u)) continue;
    try {
      // strict URL validation
      // eslint-disable-next-line no-new
      new URL(u);
    } catch {
      continue;
    }

    if (isMetadataOrPurchaseSourceUrl(u)) continue;

    if (!seen.has(u)) {
      seen.add(u);
      final.push(u);
    }
  }
  return final;
}

// ─────────────────────────────────────────────────────────────────────────────
// List ranking — used by Appears In and related-list selection
// ─────────────────────────────────────────────────────────────────────────────

const BROAD_PARENT_SLUGS = new Set([
  "nonfiction", "fiction", "social-sciences", "science", "history", "business",
  "children", "psychology", "personal-development", "art", "philosophy", "hobbies",
  "politics", "spirituality", "sports", "technology", "humor", "comics", "poetry",
  "design", "nature", "sociology", "math", "physics", "biology", "education",
  "food", "travel", "writing", "music", "film", "fashion", "gardening",
]);

const META_SLUGS = new Set(["most-recommended-books"]);

export type RankedList = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  book_count?: number | null;
  // optional join-info from book_lists
  rank?: number | null;
};

/**
 * Rank book→list memberships so "Appears In" prefers narrow topic lists.
 *
 * Priority tiers:
 *   1. Topic lists (slug starts with "best-")
 *   2. Other narrow lists (not broad parent, not meta)
 *   3. Meta lists (most-recommended-books)
 *   4. Broad parents (nonfiction/fiction/business/…)
 *
 * Within each tier, prefer:
 *   - smaller book_count (more specific)
 *   - lower membership rank (closer to position 1) if available
 */
export function rankBookAppearsInLists<T extends RankedList>(lists: T[], topN = 8): T[] {
  const tier = (s: string): number => {
    const slug = (s || "").toLowerCase();
    if (slug.startsWith("best-")) return 1;
    if (META_SLUGS.has(slug)) return 3;
    if (BROAD_PARENT_SLUGS.has(slug)) return 4;
    return 2;
  };
  const score = (l: T): [number, number, number] => [
    tier(l.slug),
    typeof l.book_count === "number" && l.book_count > 0 ? l.book_count : 1e9,
    typeof l.rank === "number" && l.rank > 0 ? l.rank : 1e9,
  ];
  return [...lists]
    .sort((a, b) => {
      const [ta, ba, ra] = score(a);
      const [tb, bb, rb] = score(b);
      if (ta !== tb) return ta - tb;
      if (ba !== bb) return ba - bb;
      return ra - rb;
    })
    .slice(0, topN);
}

export function isBroadParentSlug(slug: string | null | undefined): boolean {
  return BROAD_PARENT_SLUGS.has((slug || "").toLowerCase());
}

export function isMetaListSlug(slug: string | null | undefined): boolean {
  return META_SLUGS.has((slug || "").toLowerCase());
}

export function isTopicListSlug(slug: string | null | undefined): boolean {
  return (slug || "").toLowerCase().startsWith("best-");
}

/**
 * Heuristic guard against obviously-not-a-book titles imported from dirty sources.
 * Filters out:
 *   - pure numeric strings: "1421", "1944.0", "2034.0"
 *   - bare datetime stamps: "2001-03-05 00:00:00", "2023-06-24 00:00:00"
 *   - empty / single-char / whitespace
 *
 * Returns true for anything that looks like a real title (default-allow).
 * DISPLAY-side filter only — does not delete or modify any row.
 */
export function isProbablyValidBookTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  const s = String(title).trim();
  if (s.length < 2) return false;
  // pure number with optional decimals: 1421, 1944.0
  if (/^\d+(?:\.\d+)?$/.test(s)) return false;
  // date or datetime: 2001-03-05, 2001-03-05 00:00:00
  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(s)) return false;
  return true;
}

/**
 * Display-only sanitiser for editorial text. Replaces the bookish jargon "DNF"
 * with plain-English equivalents so public readers aren't confronted with it.
 *   - "you'll (likely) DNF"     → "you'll likely put it down"
 *   - "likely DNF point"        → "likely drop-off point"
 *   - "likely DNF"              → "likely lose interest"
 *   - "DNF point"               → "drop-off point"
 *   - "DNF if …"                → "lose interest if …"
 *   - bare "DNF" / "dnf"        → "lose interest"
 *
 * Does NOT mutate stored data. Apply at render time only. Conservative: meaning is
 * preserved, no aggressive rewriting beyond the specific jargon term.
 */
/**
 * Presentational cleanup for a pulled quote.
 *
 * These are largely tweets, so 87 of the 600 quotes that currently display
 * open with the handles the author was replying to — "@ribas_artur
 * @LauraHuangLA I know of no other collections of interviews with founders".
 * As a pull-quote on the page that is the whole point of this site, that reads
 * as broken data even though the words are genuine.
 *
 * Stripped at DISPLAY time, not in the database: the mentions are part of the
 * original post, and removing them from storage would lose fidelity we cannot
 * recover. The stored row stays exactly as captured.
 *
 * Only leading mentions go. A handle inside the sentence is usually load-
 * bearing ("as @pmarca put it"), so it stays.
 */
export function cleanQuoteText(value: string | null | undefined): string {
  let t = String(value || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  // Reply chains can carry several handles before the first real word.
  t = t.replace(/^(?:RT\s+)?(?:@[A-Za-z0-9_]{1,30}[\s,:]+)+/u, "").trim();
  // A stripped trailing link often leaves a dangling connector.
  t = t.replace(/[\s,:;\-–—]+$/u, "").trim();
  // Re-capitalise only when the sentence now starts mid-flow in lowercase.
  if (t && /^[a-z]/.test(t)) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

export function sanitizeEditorialText(text: string | null | undefined): string {
  if (!text) return "";
  let s = String(text);
  // Order matters — more specific phrases first.
  s = s.replace(/\byou(?:'|’)ll\s+likely\s+DNF\b/gi, "you'll likely put it down");
  s = s.replace(/\byou(?:'|’)ll\s+DNF\b/gi, "you'll put it down");
  s = s.replace(/\blikely\s+DNF\s+point\b/gi, "likely drop-off point");
  s = s.replace(/\blikely\s+DNF\b/gi, "likely lose interest");
  s = s.replace(/\bDNF\s+point\b/gi, "drop-off point");
  s = s.replace(/\bDNF\s+if\b/gi, "lose interest if");
  s = s.replace(/\bDNF\b/g, "lose interest");
  s = s.replace(/\bdnf\b/g, "lose interest");
  return s;
}

/**
 * Alt text for a book cover image.
 *
 * A bare title ("Army of None") duplicates the visible caption directly
 * beside it and tells an image crawler nothing the surrounding text does not
 * already say. Naming the artefact and the author describes what the image
 * actually shows and carries the author entity into image search.
 */
export function coverAltText(
  title: string | null | undefined,
  author?: string | null,
): string {
  const t = String(title || "").trim();
  if (!t) return "Book cover";
  const a = String(author || "").trim();
  return a ? `Book cover for “${t}” by ${a}` : `Book cover for “${t}”`;
}

/**
 * Repair Windows-1252 smart punctuation that survived import as `_x00NN_`
 * escapes — "Matt D_x0092_Avella" should read "Matt D’Avella".
 *
 * This is a render-time guard, not a substitute for fixing the stored value:
 * the escapes are scattered through book descriptions as well as names, and a
 * page should never show one even if a row was missed by a backfill. Mirrors
 * repairEncoding() in scripts/backfill_people_meta.js — keep the two in step.
 */
export function repairEncoding(value: string | null | undefined): string {
  if (!value) return "";
  return String(value)
    .replace(/_x0091_|_x0092_|_x2018_|_x2019_/g, "’")
    .replace(/_x0093_|_x0094_|_x201C_|_x201D_/g, '"')
    .replace(/_x0096_|_x0097_|_x2013_|_x2014_/g, "—")
    .replace(/_x0085_/g, "…")
    .replace(/_x00A0_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Where reasonable, repair a numeric-looking title like "1984.0" into "1984".
 * Only repairs strings of the form integer + ".0" (the common Excel-as-float export).
 * Returns the original string when no safe repair applies.
 */
export function repairNumericTitle(title: string | null | undefined): string {
  const s = String(title || "").trim();
  if (!s) return s;
  const m = s.match(/^(\d{1,5})\.0+$/);
  if (m) return m[1];
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Editorial field parsing — robust against shape variability and junk
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_ACRONYMS = new Set([
  "CEO", "CFO", "CTO", "COO", "CIA", "FBI", "AI", "API", "DNA", "UX", "UI", "ML",
  "MIT", "NSA", "PM", "CMO", "VP", "HR", "PR", "QA", "VC", "MBA", "PhD",
]);

/**
 * Parse a best_for / not_for / key_themes value into a clean array of strings,
 * regardless of how it arrives from production (PostgREST may return text, text[],
 * JSON-encoded array string, or null depending on column type and write history).
 *
 * Rules:
 *  - array of strings → use as-is
 *  - JSON-encoded array string ('["a","b"]') → parse
 *  - pipe-joined string ("a | b | c") → split on "|"
 *  - newline-separated → split on \n
 *  - semicolon-separated, ONLY when every part is meaningful → split on ";"
 *  - otherwise → one item containing the whole sentence
 *  - never spread a string into characters
 *  - strip leading bullets ("-", "•", "*", "–", "—") and list numbers ("1.", "2)")
 *  - drop items shorter than `minLen` unless they are a known acronym
 *  - dedupe (case-insensitive)
 *  - cap at `maxItems`
 *  - if the resulting list looks like single-character junk (>50% items length 1),
 *    return [] so the UI can hide the section instead of rendering huge empty cards
 *
 * Optional `maxItemLength` truncates each item with an ellipsis — useful for chips
 * where parenthetical mega-phrases would otherwise dominate the layout.
 */
export function parseEditorialList(
  raw: unknown,
  opts: { maxItems?: number; minLen?: number; maxItemLength?: number } = {},
): string[] {
  const maxItems = opts.maxItems ?? 4;
  const minLen = opts.minLen ?? 8;
  const maxItemLength = opts.maxItemLength;
  if (raw == null) return [];

  // 1) Collect raw items into a flat string list, by shape.
  let items: string[] = [];

  if (Array.isArray(raw)) {
    items = raw.filter((x): x is string => typeof x === "string");
  } else if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];

    // 1a) JSON-encoded array
    if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"))) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          items = parsed.filter((x): x is string => typeof x === "string");
        }
      } catch {
        // fall through to delimiter detection
      }
    }
    // 1b) Pipe-joined
    if (items.length === 0 && s.includes("|")) {
      items = s.split("|");
    }
    // 1c) Newline-separated (after pipe — pipe takes priority)
    if (items.length === 0 && /\r?\n/.test(s)) {
      items = s.split(/\r?\n/);
    }
    // 1d) Semicolon-separated — ONLY when each piece is reasonably long, to avoid
    //     splitting natural sentences that contain a semicolon.
    if (items.length === 0 && s.includes(";")) {
      const parts = s.split(";").map((t) => t.trim()).filter(Boolean);
      if (parts.length >= 2 && parts.every((p) => p.length >= minLen)) {
        items = parts;
      }
    }
    // 1e) Plain sentence → one item.  CRITICALLY: never split into characters.
    if (items.length === 0) {
      items = [s];
    }
  } else {
    // not array, not string — give up
    return [];
  }

  // 2) Clean each item.
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const r of items) {
    let s = String(r ?? "").trim();
    if (!s) continue;
    // strip leading bullet glyphs
    s = s.replace(/^[\-•–—*]+\s*/, "");
    // strip list numbering "1." / "1)"
    s = s.replace(/^\d+[.)]\s*/, "");
    // strip wrapping quotes
    s = s.replace(/^["“]+|["”]+$/g, "");
    s = s.trim();
    if (!s) continue;

    const tooShort = s.length < minLen;
    if (tooShort) {
      // allow well-known acronyms ("CEO", "AI"), reject everything else short
      if (!KNOWN_ACRONYMS.has(s.toUpperCase())) continue;
    }
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (maxItemLength && s.length > maxItemLength) {
      s = s.slice(0, maxItemLength - 1).trimEnd() + "…";
    }
    cleaned.push(s);
    if (cleaned.length >= maxItems) break;
  }

  // 3) Junk guard — if more than half the items are length 1 (the char-bullet bug),
  //    return [] so the section hides instead of rendering a tall empty card.
  if (cleaned.length > 0) {
    const shortRatio = cleaned.filter((x) => x.length <= 1).length / cleaned.length;
    if (shortRatio > 0.5) return [];
  }
  return cleaned;
}

export interface ProofItem {
  quote?: string | null;
  source_url?: string | null;
  source_name?: string | null;
  confidence_score?: number | string | null;
  book?: {
    slug?: string | null;
    title?: string | null;
  } | null;
}

export interface PersonItem {
  slug: string;
  name: string;
}

export interface ProofDisplaySafety {
  isSafe: boolean;
  showQuote: boolean;
  showSource: boolean;
  cardCue: "proof" | "link" | "none";
  warningText: string | null;
  displayQuote: string | null;
}

const SHREDDED_SURNAMES = [
  "gates", "ferriss", "ravikant", "obama", "zuckerberg", "collison", "andreessen",
  "graham", "peterson", "winfrey", "musk", "buffett", "clear", "altman", "dalio"
];

export function getProofDisplaySafety(
  proof: ProofItem,
  person: PersonItem
): ProofDisplaySafety {
  const quote = (proof.quote || "").trim();
  const sourceUrl = (proof.source_url || "").trim();
  const sourceName = (proof.source_name || "").trim();
  
  const rawScore = proof.confidence_score;
  let isLowConf = true;
  if (rawScore !== null && rawScore !== undefined) {
    const score = parseFloat(String(rawScore));
    if (Number.isFinite(score) && score >= 70) {
      isLowConf = false;
    }
  }

  const hasPipeQuote = quote.includes("|");
  const hasPipeSource = sourceUrl.includes("|");
  const isMetadata = isMetadataOrPurchaseSourceUrl(sourceUrl);
  const sourceUrls = parseSourceUrls(sourceUrl);

  // Stricter Trust/Provenance rules:
  // A source is trustworthy only if it has exactly one parsed URL, has no pipes, and is not a metadata link
  const showSource = sourceUrls.length === 1 && !hasPipeSource && !isMetadata;
  const showQuote = showSource && quote.length >= 50 && !hasPipeQuote && !isLowConf;

  // Mismatch Check
  let likelyMismatch = false;
  if (showQuote && person && person.name) {
    const pNameLower = person.name.toLowerCase();
    const pParts = pNameLower.split(" ");
    const lastName = pParts[pParts.length - 1];
    const firstName = pParts[0];

    const snLower = sourceName.toLowerCase();
    const suLower = sourceUrl.toLowerCase();

    for (const surname of SHREDDED_SURNAMES) {
      if (snLower.includes(surname) || suLower.includes(surname)) {
        if (!pNameLower.includes(surname) && 
            !snLower.includes(lastName) && !suLower.includes(lastName) &&
            !snLower.includes(firstName) && !suLower.includes(firstName)) {
          likelyMismatch = true;
          break;
        }
      }
    }
  }

  const finalShowQuote = showQuote && !likelyMismatch;

  let cardCue: "proof" | "link" | "none" = "none";
  if (finalShowQuote && showSource) {
    cardCue = "proof";
  } else if (showSource) {
    cardCue = "link";
  }

  const warningText = !finalShowQuote && showSource
    ? "We found a public source for this recommendation, but quote text is hidden because attribution could not be safely verified."
    : null;

  return {
    isSafe: finalShowQuote,
    showQuote: finalShowQuote,
    showSource,
    cardCue,
    warningText,
    // Cleaned only for display; the stored row keeps the original post text.
    displayQuote: finalShowQuote ? cleanQuoteText(quote) : null
  };
}



export function normalizeOutboundUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (!isValidHttpUrl(trimmed)) return null;
  if (isAmazonUrl(trimmed)) return normalizeAmazonUrl(trimmed);

  return trimmed;
}
