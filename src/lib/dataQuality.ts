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
