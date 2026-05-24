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

const SCRAPED_JUNK_PATTERNS = [
  /goodreads\s*profile/i,
  /books\s*read\s*section/i,
  /tanggal\s*terbit/i,
  /informasi\s*lainnya/i,
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
