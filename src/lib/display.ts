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
