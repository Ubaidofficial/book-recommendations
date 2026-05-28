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
