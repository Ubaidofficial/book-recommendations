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

export function listKindFromSlug(slug: string | null | undefined): ListKind {
  const s = (slug || "").toLowerCase();
  if (!s) return "other";
  if (META_LIST_SLUGS.has(s)) return "meta";
  if (s.startsWith("best-")) return "topic";
  if (BROAD_CATEGORY_SLUGS.has(s)) return "category";
  return "other";
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
