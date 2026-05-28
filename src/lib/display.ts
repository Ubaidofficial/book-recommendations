/**
 * Converts slug-formatted text (e.g. "enid-blyton-books-in-order") into
 * display text ("Enid Blyton Books In Order"). Also handles already-clean
 * titles by passing them through unchanged.
 */
export function displayTitle(raw: string | null | undefined): string {
  if (!raw) return "";
  if (!raw.includes("-")) return raw;
  const hyphenOnly = /^[a-z0-9]+(-[a-z0-9]+)+$/i.test(raw);
  if (!hyphenOnly) return raw;
  return raw
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// List title normalization — DISPLAY ONLY. Never mutates DB data.
// Handles the dirty imported list titles like:
//   "NonFiction", "ParentingRelationships & Family", "Mystery & CrimeFiction",
//   "FoodHobbies", "RomanceFiction", "Comics.Fiction", "FashionArt",
//   "Teen & Young", "Ceo"
// ─────────────────────────────────────────────────────────────────────────────

const FULL_TITLE_ALIASES: Record<string, string> = {
  "non fiction": "Nonfiction",
  "non-fiction": "Nonfiction",
  "nonfiction": "Nonfiction",
  "teen & young": "Teen & Young Adult",
  // singular → plural / clearer label (display-only; DB row stays as-is)
  "comic": "Comics",
  "humor": "Humor",
  "cookbook": "Cookbooks",
  "graphic novel": "Graphic Novels",
  "ya": "Young Adult",
  "lgbt": "LGBTQ",
};

// Broader categories that appear as concatenated SUFFIXES on imported titles.
// When present, strip the suffix (the more specific head is the useful name).
const BROADER_SUFFIXES = [
  "Fiction", "NonFiction", "Nonfiction",
  "Hobbies",
  "Relationships & Family",
];

// Tokens that should always render in ALL CAPS.
const ACRONYMS = new Set(["CEO", "CFO", "CTO", "COO", "CIA", "FBI", "AI", "API", "DNA", "UX", "UI", "SaaS"]);

// English "small words" that are lowercase in title case unless they're the first
// token (or follow a colon/em-dash). Kept conservative — only the universally-safe ones.
const TITLE_CASE_SMALL_WORDS = new Set([
  "a", "an", "the", "and", "but", "or", "nor", "for",
  "of", "to", "in", "on", "at", "with", "by", "from", "as", "vs",
]);

/**
 * Smart title case for display-only book / list titles.
 *   - Lowercases recognised small words (a, the, and, of, to, …) **unless** the word
 *     is the first token of the title, follows a colon, or is an acronym.
 *   - Leaves apostrophised words ("Knight's"), all-caps acronyms (CEO), and any title
 *     that doesn't look already-title-cased completely alone.
 *
 *   "Good To Great"                      -> "Good to Great"
 *   "The Way Of The Peaceful Warrior"    -> "The Way of the Peaceful Warrior"
 *   "How To Win Friends And Influence …" -> "How to Win Friends and Influence …"
 *   "1984"                               -> "1984"           (left alone)
 *   "iPhone in 30 days"                  -> "iPhone in 30 days" (not all-caps, untouched)
 */
export function smartTitleCase(input: string | null | undefined): string {
  const s = String(input || "").trim();
  if (!s) return "";

  // Heuristic: only apply if the title looks ALREADY title-cased — every "word" that
  // starts with a letter has its first letter uppercased. This prevents us from
  // mangling titles that the author wrote with intentional casing (e.g. "bell hooks").
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 2) return s;
  const lookalreadyTitleCased = words.every((w) => {
    const first = w.match(/[A-Za-z]/);
    return !first || first[0] === first[0].toUpperCase();
  });
  if (!lookalreadyTitleCased) return s;

  // Walk tokens (preserve whitespace), lowercase small words unless first or post-colon.
  const tokens = s.split(/(\s+)/);
  let lastNonSpaceIndex = -1;
  let forceCapsNext = true; // first non-space token is capitalised
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (/^\s+$/.test(tok)) {
      out.push(tok);
      continue;
    }
    const lower = tok.toLowerCase();
    const upper = tok.toUpperCase();
    if (ACRONYMS.has(upper)) {
      out.push(upper);
    } else if (!forceCapsNext && TITLE_CASE_SMALL_WORDS.has(lower)) {
      out.push(lower);
    } else {
      out.push(tok);
    }
    forceCapsNext = /[:?!—–-]$/.test(tok);   // word after colon/em-dash/question mark gets capped
    lastNonSpaceIndex = i;
  }
  // Always cap the LAST real word too (style convention).
  if (lastNonSpaceIndex >= 0) {
    const last = out[lastNonSpaceIndex];
    if (last.length > 0 && /^[a-z]/.test(last) && !ACRONYMS.has(last.toUpperCase())) {
      // Don't recapitalise if it's a small word we just lowercased? Convention says cap last word anyway.
      out[lastNonSpaceIndex] = last.charAt(0).toUpperCase() + last.slice(1);
    }
  }
  return out.join("");
}

/**
 * Display-only book title normalisation: applies smartTitleCase so titles like
 * "Good To Great" render as "Good to Great". DOES NOT mutate DB. Pass-through for
 * anything that doesn't look like a title-cased string.
 */
export function displayBookTitle(raw: string | null | undefined): string {
  const s = (raw || "").trim();
  if (!s) return "";
  return smartTitleCase(s);
}

/**
 * Display-only normalization for a list title.
 *   - Empty title → derive from slug ("best-fashion-books" → "Fashion")
 *   - "NonFiction" / "Non-Fiction" / "non fiction" → "Nonfiction"
 *   - "Mystery & CrimeFiction" → "Mystery & Crime"   (strip broader-suffix)
 *   - "FoodHobbies" → "Food"                          (strip broader-suffix)
 *   - "RomanceFiction" → "Romance"
 *   - "Comics.Fiction" → "Comics"                     (drop dot-merged tail)
 *   - "FashionArt" → "Fashion Art"                    (split camelCase)
 *   - "Teen & Young" → "Teen & Young Adult"           (alias)
 *   - "Ceo" → "CEO"                                   (acronym)
 *
 * Does NOT change DB rows; this is pure presentation.
 */
export function displayListTitle(
  rawTitle: string | null | undefined,
  slug?: string | null,
): string {
  let t = (rawTitle || "").trim();

  // 0. derive from slug if title is blank/junk (Title-Case the words)
  if (!t || /^\.+$/.test(t)) {
    if (!slug) return "";
    t = slug
      .replace(/^best-/i, "")
      .replace(/-books$/i, "")
      .replace(/-/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  // 1. dotted-merge: "Comics.Fiction" → "Comics"
  if (t.includes(".")) {
    const head = t.split(".")[0].trim();
    if (head) t = head;
  }

  // 2. full-title alias / case-fold lookup
  const lower = t.toLowerCase();
  if (FULL_TITLE_ALIASES[lower]) return FULL_TITLE_ALIASES[lower];

  // 3. strip a single broader-category suffix that was concatenated without a space.
  //    "Mystery & CrimeFiction" → "Mystery & Crime"; "FoodHobbies" → "Food".
  for (const suf of BROADER_SUFFIXES) {
    if (t.length <= suf.length) continue;
    if (!t.toLowerCase().endsWith(suf.toLowerCase())) continue;
    const before = t.charAt(t.length - suf.length - 1);
    // require the suffix to be merged (not preceded by a normal space)
    if (before === " ") continue;
    t = t.slice(0, t.length - suf.length).trim();
    break;
  }

  // 4. split remaining camelCase boundaries: "FashionArt" → "Fashion Art"
  t = t.replace(/([a-z'])([A-Z])/g, "$1 $2");

  // 5. case-fold leftover "Non Fiction" produced by step 4 / step 3
  if (t.toLowerCase() === "non fiction") return "Nonfiction";
  if (FULL_TITLE_ALIASES[t.toLowerCase()]) return FULL_TITLE_ALIASES[t.toLowerCase()];

  // 6. acronym fix per token (keeps separators intact via capture group)
  t = t
    .split(/(\s+|&|-)/)
    .map((tok) => (ACRONYMS.has(tok.toUpperCase()) ? tok.toUpperCase() : tok))
    .join("");

  // 7. global "Non Fiction" → "Nonfiction" anywhere in the title (catches
  //    multi-word labels like "Non Fiction Adventure" → "Nonfiction Adventure")
  t = t.replace(/\bNon[\s-]Fiction\b/gi, "Nonfiction");

  // 8. smart title-case for already-title-cased strings (lowercase small words like
  //    "of", "to", "and" unless they're the first / last word). Safe no-op otherwise.
  t = smartTitleCase(t);

  return t.trim().replace(/\s+/g, " ");
}

// ─────────────────────────────────────────────────────────────────────────────
// List kind — for the small badge on cards ("Category" / "Topic List" / "Curated").
// ─────────────────────────────────────────────────────────────────────────────

const META_LIST_SLUGS = new Set(["most-recommended-books"]);
const BROAD_CATEGORY_SLUGS = new Set([
  "nonfiction", "fiction", "business", "science", "social-sciences", "history",
  "psychology", "personal-development", "art", "philosophy", "fantasy",
  "science-fiction", "romance", "mystery-crime", "thriller-suspense", "finance",
  "leadership", "spirituality", "sports", "technology", "health", "politics",
  "biography", "poetry", "music", "food", "travel", "design", "writing",
  "programming", "management", "entrepreneurship",
]);

export type ListKind = "topic" | "meta" | "category" | "other";

/**
 * Classify a list slug for the badge UI.
 *
 *   best-*               → topic   (curated best-of, sourced from external lists)
 *   most-recommended-books → meta  (featured)
 *   *-in-order / *-books-in-order → other (series reading order, not a category)
 *   anything else        → category  (broad/leaf taxonomy node — Fashion, Sociology,
 *                                     even dirty merged forms like "fashionart")
 *
 * Defaulting to "category" (instead of "other → no badge") gives every non-best-*,
 * non-meta, non-series-page list a meaningful label without inventing taxonomy.
 */
export function listKindFromSlug(slug: string | null | undefined): ListKind {
  const s = (slug || "").toLowerCase();
  if (!s) return "other";
  if (META_LIST_SLUGS.has(s)) return "meta";
  if (s.endsWith("-in-order") || s.includes("books-in-order")) return "other";
  if (s.startsWith("best-")) return "topic";
  // any other slug is a category-like list (Fashion, Sociology, fashionart, etc.)
  return "category";
}

export function listKindLabel(kind: ListKind): string {
  switch (kind) {
    case "topic": return "Topic List";
    case "meta": return "Curated";
    case "category": return "Category";
    default: return "List";
  }
}

/**
 * Full / disambiguating list title for use in browse and search cards where two
 * rows might share the same short title (e.g. broad category "Fashion" vs the
 * topic list "best-fashion-books"). Topic lists render as **"Best X Books"** so
 * the two are visually distinct. Non-topic lists fall through to displayListTitle.
 */
export function displayListTitleFull(
  rawTitle: string | null | undefined,
  slug?: string | null,
): string {
  const kind = listKindFromSlug(slug);
  if (kind !== "topic") return displayListTitle(rawTitle, slug);
  // Build "Best <Name> Books" using the cleaned short name as the body.
  const core = displayListTitle(rawTitle, slug);
  if (!core) return "Best Books";
  // If user already saved the full phrase, don't double-wrap.
  const lc = core.toLowerCase();
  const looksWrapped = lc.startsWith("best ") || lc.endsWith(" books");
  if (looksWrapped) return core;
  return `Best ${core} Books`;
}
