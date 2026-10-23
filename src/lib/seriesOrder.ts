import { Book } from "@/lib/data";
import { displayTitle } from "@/lib/display";

export type SeriesBook = Book & { series_position: number | null };

/**
 * How a series page may present its books:
 * - "position":    at least one verified book_series.position exists.
 * - "publication": enough books carry a verified first_published_year to
 *                  list them in first-publication order (the "<author> books
 *                  in order" format competitors rank with).
 * - "none":        no trustworthy order; books stay unnumbered.
 */
export type SeriesOrder = "position" | "publication" | "none";

/**
 * Share of books that must carry a verified year before the page claims a
 * publication order. Below this, too much of the "order" would be a guess.
 */
export const PUBLICATION_ORDER_MIN_COVERAGE = 0.8;

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
    return { order: "none", books, undatedCount: books.length - dated.length };
  }

  const undated = books.filter((b) => verifiedYear(b) == null);
  const sorted = [...dated].sort(
    (a, b) => verifiedYear(a)! - verifiedYear(b)! || a.title.localeCompare(b.title)
  );
  return { order: "publication", books: [...sorted, ...undated], undatedCount: undated.length };
}

export function seriesPageTitle(base: string, order: SeriesOrder): string {
  return order === "none" ? `${base} Books` : `${base} Books in Order`;
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
      q: `In what order should I read ${base} books?`,
      a: `This page lists them in order of first publication, the order readers first met them. That is the usual way to read an author's books, though a few series have an author-recommended order that differs.`,
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
  if (mostRecommended && (mostRecommended.recommendation_count || 0) > 0) {
    const n = mostRecommended.recommendation_count;
    faq.push({
      q: `Which ${base} book is the most recommended?`,
      a: `${mostRecommended.title} is the most recommended, with ${n} ${n === 1 ? "recommendation" : "recommendations"} from people whose reading lists we track.`,
    });
  }
  return faq;
}
