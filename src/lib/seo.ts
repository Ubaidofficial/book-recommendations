export const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://bookmentions.net";

export function canonicalUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

const INDEXABLE_STATUSES = new Set(["published", "approved", "indexed", "index"]);

export function isIndexable(row: { index_status?: string } | null | undefined): boolean {
  return INDEXABLE_STATUSES.has((row?.index_status || "").toLowerCase());
}

export function robotsDirective(row: { index_status?: string } | null | undefined): string {
  return isIndexable(row) ? "index, follow" : "noindex, follow";
}

export const SITE_NAME = "BookMentions";

/**
 * Upper bound for a page title. Google truncates the SERP link around 60
 * characters / ~600px.
 */
export const TITLE_MAX = 60;

/**
 * Trailing boilerplate that duplicates — or contradicts — the site suffix
 * `pageTitle` appends.
 *
 * All 52 published book rows carry "| Book Recommendations" in meta_title
 * from the enrichment pipeline, which collided with the site suffix to
 * produce titles up to 111 characters. 79 published list rows carry
 * "| BookRecommendations.com", a different site's brand left over from
 * import; those aren't rendered today (lists/[slug] uses displayListTitle),
 * but stripping them here means wiring meta_title in later can't leak a
 * competitor's domain into our titles.
 *
 * Each is only stripped when preceded by a separator, so a legitimate title
 * ending in these words (e.g. "Best Book Recommendations") is left alone.
 */
const REDUNDANT_TITLE_SUFFIXES = [
  "bookrecommendations\\.com",
  "book recommendations",
  "book recommendation",
  "bookmentions",
];

const REDUNDANT_TITLE_RE = new RegExp(
  `\\s*[|\\-–—:]\\s*(?:${REDUNDANT_TITLE_SUFFIXES.join("|")})\\s*$`,
  "i"
);

/**
 * Builds the final <title>: strips redundant brand boilerplate, then appends
 * the site suffix only when it fits inside the budget.
 *
 * When the suffix won't fit, the bare title wins — a title truncated
 * mid-phrase loses more information than a missing brand does, and og:site_name
 * still carries the brand for social cards.
 */
export function pageTitle(base: string): string {
  let text = (base || "").replace(/\s+/g, " ").trim();

  // Loop: a title can carry more than one boilerplate segment.
  let previous: string;
  do {
    previous = text;
    text = text.replace(REDUNDANT_TITLE_RE, "").trim();
  } while (text !== previous && text.length > 0);

  if (!text) return SITE_NAME;

  const withBrand = `${text} | ${SITE_NAME}`;
  if (withBrand.length <= TITLE_MAX) return withBrand;
  if (text.length <= TITLE_MAX) return text;

  const window = text.slice(0, TITLE_MAX);
  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace > TITLE_MAX * 0.5 ? lastSpace : TITLE_MAX - 1;
  return text.slice(0, cut).replace(/[\s.,;:—–-]+$/, "") + "…";
}

/**
 * Upper bound for a meta description. Google truncates the SERP snippet
 * somewhere around 155–160 characters on desktop; anything past that is
 * wasted and often makes the snippet end mid-word.
 */
export const META_DESCRIPTION_MAX = 160;

/**
 * Normalises and length-caps a meta description.
 *
 * Several sources feed descriptions into `pageMetadata` unclamped — person
 * bios (up to 600 chars), list descriptions, and book descriptions — which
 * left 111 of 218 published pages over the limit, the longest at 1,327
 * characters. Clamping here rather than at each call site means every
 * current and future page is covered by one rule.
 *
 * Prefers to end on a sentence boundary so the snippet reads as finished
 * prose; falls back to a word boundary with an ellipsis. Returns "" for
 * empty input so the caller can omit the tag rather than emit content="".
 */
export function clampDescription(
  input: string | null | undefined,
  max: number = META_DESCRIPTION_MAX
): string {
  const text = (input || "").replace(/\s+/g, " ").trim();
  if (!text || text.length <= max) return text;

  // A sentence terminator sitting at index max-1 still yields a slice of
  // exactly `max`, so this window may run one past the budget.
  const sentenceWindow = text.slice(0, max + 1);
  // Only accept a sentence break that falls in the back half of the window —
  // cutting at the first short sentence would throw away most of the budget.
  const sentenceEnd = Math.max(
    sentenceWindow.lastIndexOf(". "),
    sentenceWindow.lastIndexOf("! "),
    sentenceWindow.lastIndexOf("? ")
  );
  if (sentenceEnd >= max * 0.5) return text.slice(0, sentenceEnd + 1);

  // The ellipsis costs a character, so the word-boundary search has to stay
  // inside `max - 1` for the result to fit the budget. A space that lands in
  // the front half means the text is dominated by one long unbroken token —
  // a hard cut keeps more of it than an almost-empty snippet would.
  const wordWindow = text.slice(0, max);
  const lastSpace = wordWindow.lastIndexOf(" ");
  const cut = lastSpace > max * 0.5 ? lastSpace : max - 1;
  return text.slice(0, cut).replace(/[\s.,;:—–-]+$/, "") + "…";
}

export function pageMetadata({
  title,
  description,
  path,
  image,
  type = "website",
  robots,
}: {
  title: string;
  description: string;
  path: string;
  image?: string;
  type?: "website" | "article" | "book";
  robots?: string;
}) {
  const desc = clampDescription(description);
  const fullTitle = pageTitle(title);

  return {
    title: fullTitle,
    description: desc,
    alternates: { canonical: canonicalUrl(path) },
    robots: robots || "index, follow",
    openGraph: {
      title: fullTitle,
      description: desc,
      url: canonicalUrl(path),
      siteName: SITE_NAME,
      images: image ? [{ url: image }] : [],
      type,
    },
    twitter: {
      card: "summary_large_image" as const,
      title: fullTitle,
      description: desc,
      images: image ? [image] : [],
    },
  };
}
