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

  return {
    title: `${title} | BookMentions`,
    description: desc,
    alternates: { canonical: canonicalUrl(path) },
    robots: robots || "index, follow",
    openGraph: {
      title: `${title} | BookMentions`,
      description: desc,
      url: canonicalUrl(path),
      siteName: "BookMentions",
      images: image ? [{ url: image }] : [],
      type,
    },
    twitter: {
      card: "summary_large_image" as const,
      title: `${title} | BookMentions`,
      description: desc,
      images: image ? [image] : [],
    },
  };
}
