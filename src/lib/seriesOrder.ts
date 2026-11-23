import { Book } from "@/lib/data";
import { displayTitle } from "@/lib/display";

export type SeriesBook = Book & { series_position: number | null };

/**
 * How a series page may present its books:
 * - "position":    at least one verified book_series.position exists.
 * - "publication": enough books carry a verified first_published_year to
 *                  list them in first-publication order (the "<author> books
 *                  in order" format competitors rank with).
 * - "partial":     fewer than that, but still a real block of verified years
 *                  (PARTIAL_ORDER_MIN_DATED). The page does NOT claim "in
 *                  order": it lists the dated books first, oldest to newest,
 *                  then the undated ones, and says so. Without this, a large
 *                  catalogue with a few hundred verified years (Enid Blyton:
 *                  244 of 867) shows an arbitrary slice of itself.
 * - "none":        no trustworthy order; books stay unnumbered.
 */
export type SeriesOrder = "position" | "publication" | "partial" | "none";

/**
 * Share of books that must carry a verified year before the page claims a
 * publication order. Below this, too much of the "order" would be a guess.
 */
export const PUBLICATION_ORDER_MIN_COVERAGE = 0.8;

/**
 * Below the coverage share, this many verified years still earn the "partial"
 * treatment. Small enough to help a big catalogue, large enough that a handful
 * of stray years never reshuffles a page.
 */
export const PARTIAL_ORDER_MIN_DATED = 100;

/** Verified-year books first (oldest first); everything else after, most recommended first. */
function sortPartial(books: SeriesBook[]): SeriesBook[] {
  const dated = books
    .filter((b) => verifiedYear(b) != null)
    .sort((a, b) => verifiedYear(a)! - verifiedYear(b)! || a.title.localeCompare(b.title));
  const undated = books
    .filter((b) => verifiedYear(b) == null)
    .sort((a, b) => (b.recommendation_count || 0) - (a.recommendation_count || 0) || a.title.localeCompare(b.title));
  return [...dated, ...undated];
}

/**
 * "john-grisham-books-in-order" / "Dune Series" / "Enid Blyton Books" →
 * "John Grisham" / "Dune" / "Enid Blyton". Most series rows were imported
 * with their slug as the title, so the raw title can't go in a heading.
 */
export function seriesBaseName(title: string | null | undefined): string {
  const name = displayTitle(title || "").trim();
  const base = name.replace(/\s+(?:books\s+in\s+order|books|series|in\s+order)$/i, "").trim();
  return base || name;
}

function verifiedYear(book: Book): number | null {
  const y = book.first_published_year;
  return typeof y === "number" && y > 0 ? y : null;
}

export function orderSeriesBooks(
  books: SeriesBook[],
  hasPositions: boolean
): { order: SeriesOrder; books: SeriesBook[]; undatedCount: number } {
  if (hasPositions) return { order: "position", books, undatedCount: 0 };

  const dated = books.filter((b) => verifiedYear(b) != null);
  if (books.length < 2 || dated.length / books.length < PUBLICATION_ORDER_MIN_COVERAGE) {
    if (dated.length >= PARTIAL_ORDER_MIN_DATED) {
      return { order: "partial", books: sortPartial(books), undatedCount: books.length - dated.length };
    }
    return { order: "none", books, undatedCount: books.length - dated.length };
  }

  const undated = books.filter((b) => verifiedYear(b) == null);
  const sorted = [...dated].sort(
    (a, b) => verifiedYear(a)! - verifiedYear(b)! || a.title.localeCompare(b.title)
  );
  return { order: "publication", books: [...sorted, ...undated], undatedCount: undated.length };
}

/**
 * The series <title> (the H1 uses seriesPageTitle). Another site's title for the same pages is
 * "All 897 Enid Blyton Books in Order (Complete List 2026)": the number, "in order", "complete list" and the
 * year are what the query "<author> books in order" asks for. We use the same shape only where we can stand
 * behind it: "in order" needs a verified order, and a count we track is not a claim that the list is complete.
 */
export function seriesMetaTitle(base: string, order: SeriesOrder, count: number, year: number = new Date().getFullYear()): string {
  const ordered = order === "position" || order === "publication";
  const n = count > 0 ? count.toLocaleString("en-US") : "";
  const candidates = ordered
    ? [
        n ? `All ${n} ${base} Books in Order (Complete List ${year})` : "",
        `${base} Books in Order (Complete List ${year})`,
        `${base} Books in Order (${year})`,
        `${base} Books in Order`,
      ]
    : [
        n ? `${n} ${base} Books: Full List (${year})` : "",
        `${base} Books: Full List (${year})`,
        `${base} Books: Full List`,
        `${base} Books`,
      ];
  return candidates.filter(Boolean).find((c) => c.length <= 60) || `${base} Books`;
}

export function seriesPageTitle(base: string, order: SeriesOrder): string {
  // Only a verified full order earns "in Order". A partial order is still not a claim of one.
  // Without a verified order the title does not claim one; it says what the page is: the full list.
  return order === "position" || order === "publication" ? `${base} Books in Order` : `${base} Books: Full List`;
}

export interface SeriesTimeline {
  datedCount: number;
  first: { title: string; year: number };
  latest: { title: string; year: number };
  spanYears: number;
  /** Mean years between consecutive verified releases; null with fewer than 3 dated books. */
  averageGapYears: number | null;
  /** Dated books first published in the last five calendar years (this year included). */
  recentCount: number;
  recentFrom: number;
  /** The calendar year with the most dated releases, when it holds 2 or more. */
  busiestYear: { year: number; count: number } | null;
}

/**
 * Plain facts about when a series' books came out, from verified first-publication years only.
 * Null when fewer than 2 books carry a verified year: one date is not a timeline.
 */
export function seriesTimeline(books: SeriesBook[], now: number = new Date().getFullYear()): SeriesTimeline | null {
  const dated = books
    .filter((b) => verifiedYear(b) != null)
    .sort((a, b) => verifiedYear(a)! - verifiedYear(b)! || a.title.localeCompare(b.title));
  if (dated.length < 2) return null;
  const first = dated[0];
  const latest = dated[dated.length - 1];
  const firstYear = verifiedYear(first)!;
  const latestYear = verifiedYear(latest)!;
  const spanYears = latestYear - firstYear;
  const recentFrom = now - 4;
  const perYear = new Map<number, number>();
  for (const b of dated) perYear.set(verifiedYear(b)!, (perYear.get(verifiedYear(b)!) || 0) + 1);
  let busiestYear: SeriesTimeline["busiestYear"] = null;
  for (const [year, count] of perYear) {
    if (count >= 2 && (!busiestYear || count > busiestYear.count || (count === busiestYear.count && year < busiestYear.year))) {
      busiestYear = { year, count };
    }
  }
  return {
    datedCount: dated.length,
    first: { title: first.title, year: firstYear },
    latest: { title: latest.title, year: latestYear },
    spanYears,
    averageGapYears: dated.length >= 3 && spanYears > 0 ? Math.round((spanYears / (dated.length - 1)) * 10) / 10 : null,
    recentCount: dated.filter((b) => verifiedYear(b)! >= recentFrom).length,
    recentFrom,
    busiestYear,
  };
}

/** The timeline as two or three sentences of prose; every figure comes from seriesTimeline. */
export function seriesTimelineText(base: string, t: SeriesTimeline): string {
  const parts: string[] = [];
  parts.push(
    t.spanYears > 0
      ? `The ${t.datedCount} ${base} books with a verified first-publication year run from ${t.first.title} (${t.first.year}) to ${t.latest.title} (${t.latest.year}), a span of ${t.spanYears} ${t.spanYears === 1 ? "year" : "years"}.`
      : `All ${t.datedCount} ${base} books with a verified first-publication year came out in ${t.first.year}.`,
  );
  if (t.averageGapYears != null) {
    parts.push(
      t.averageGapYears < 1
        ? `That is more than one new book a year on average.`
        : `That works out to a new book about every ${t.averageGapYears.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${t.averageGapYears === 1 ? "year" : "years"} on average.`,
    );
  }
  if (t.busiestYear) {
    parts.push(`The busiest year was ${t.busiestYear.year}, with ${t.busiestYear.count} books.`);
  }
  parts.push(
    t.recentCount > 0
      ? `${t.recentCount} of them ${t.recentCount === 1 ? "was" : "were"} first published in ${t.recentFrom} or later.`
      : `None of them was first published in ${t.recentFrom} or later, as far as our records show.`,
  );
  return parts.join(" ");
}

export interface FaqItem {
  q: string;
  a: string;
}

/** Questions answered only from data the page actually holds. */
export function seriesFaq(base: string, order: SeriesOrder, books: SeriesBook[], totalCount: number): FaqItem[] {
  const faq: FaqItem[] = [];
  const byline = (b: SeriesBook) => `${b.title}${verifiedYear(b) ? ` (${verifiedYear(b)})` : ""}`;

  if (order === "publication") {
    const dated = books.filter((b) => verifiedYear(b) != null);
    const first = dated[0];
    const latest = dated[dated.length - 1];
    if (first) {
      faq.push({
        q: `What is the first ${base} book?`,
        a: `${byline(first)} is the earliest ${base} book by first publication year among the ${totalCount.toLocaleString()} we track.`,
      });
    }
    if (latest && latest !== first) {
      faq.push({
        q: `What is the latest ${base} book?`,
        a: `${byline(latest)} is the most recent ${base} book in our records. New releases can take a while to appear here.`,
      });
    }
    faq.push({
      q: `What is the order of ${base} books?`,
      a: `The order of ${base} books on this page is first publication, the order readers first met them. That is the usual ${base} reading order, though a few series have an author-recommended order that differs.`,
    });
  } else if (order === "position") {
    const first = books.find((b) => b.series_position === 1) || books.find((b) => b.series_position != null);
    if (first) {
      faq.push({ q: `What is the first ${base} book?`, a: `${first.title} is #${first.series_position} in the series.` });
    }
  }

  if (totalCount > 0) {
    faq.push({
      q: `How many ${base} books are there?`,
      a: `We track ${totalCount.toLocaleString()} ${totalCount === 1 ? "book" : "books"} for ${base}.`,
    });
  }

  const mostRecommended = [...books].sort((a, b) => (b.recommendation_count || 0) - (a.recommendation_count || 0))[0];
  const hasRecommended = !!mostRecommended && (mostRecommended.recommendation_count || 0) > 0;
  if (hasRecommended) {
    const n = mostRecommended.recommendation_count;
    faq.push({
      q: `Which ${base} book is the most recommended?`,
      a: `${mostRecommended.title} is the most recommended, with ${n} ${n === 1 ? "recommendation" : "recommendations"} from people whose reading lists we track.`,
    });
  }

  // Only where the page holds a verified order: "start here" on an unordered list would be a guess.
  const start =
    order === "publication"
      ? books.find((b) => verifiedYear(b) != null)
      : order === "position"
        ? books.find((b) => b.series_position === 1) || books.find((b) => b.series_position != null)
        : undefined;
  if (start) {
    const where = order === "publication" ? `the first published, ${byline(start)}` : `#${start.series_position}, ${start.title}`;
    const alt =
      hasRecommended && mostRecommended.id !== start.id
        ? ` If you would rather start with the title the people we track recommend most, that is ${mostRecommended.title}.`
        : "";
    faq.push({
      q: `Where should I start with ${base} books?`,
      a: `Going by the order on this page, start with ${where}.${alt}`,
    });
  }
  return faq;
}
