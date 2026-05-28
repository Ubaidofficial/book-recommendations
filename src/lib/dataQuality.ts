/**
 * Data quality helpers for sanitizing and validating Supabase data before display.
 */

export function isValidHttpUrl(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  return /^https?:\/\//i.test(value.trim());
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
