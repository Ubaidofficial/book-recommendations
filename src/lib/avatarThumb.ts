/**
 * Small-image URLs for tiny portraits.
 *
 * Most stored avatars are Wikimedia Commons originals (often several hundred
 * KB, some multi-MB) because the URL was copied from the file page. Drawn at
 * 24-36px, that is mostly wasted bytes, and Commons rate-limits hotlinked
 * originals more eagerly than thumbnails. Commons serves resized copies at
 * /thumb/<a>/<ab>/<file>/<N>px-<file>, so a plain jpg/jpeg/png original is
 * rewritten to the 120px copy (about 5-10KB, enough for a 24-36px circle at
 * 3x). Anything else is returned untouched: existing /thumb/ URLs, other hosts,
 * and file types whose thumbnail has a different name (svg, tif, xcf, gif).
 * The stored data is never changed.
 */
const COMMONS_ORIGINAL =
  /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+\.(?:jpe?g|png))(?:[?#].*)?$/i;

export function commonsThumb(url: string, px = 120): string {
  const m = COMMONS_ORIGINAL.exec(url.trim());
  if (!m) return url;
  const [, a, ab, file] = m;
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${a}/${ab}/${file}/${px}px-${file}`;
}
