/**
 * Thin-page quality floor for detail pages.
 *
 * `index_status` decides which rows are public. This adds a floor under it: a
 * published page that has almost nothing on it is served `noindex, follow`
 * and left out of the sitemap, so one thin page cannot drag down how search
 * engines judge the rest of the site. Links on the page are still followed.
 *
 * The rule is deliberately narrow. It only catches pages that are thin on
 * every axis at once, and when a signal could not be read (a database error)
 * it treats the page as NOT thin, so an outage never de-indexes anything.
 *
 * Pure functions only (no data access), so the page metadata and the sitemap
 * apply exactly the same rule. Data fetching lives in thinPages.ts.
 */
import { getProofDisplaySafety, isUsefulDescription, type PersonItem, type ProofItem } from "./dataQuality";
import { isIndexable } from "./seo";

/** A person page needs at least this many recommended books to stand on count alone. */
export const THIN_PERSON_MIN_BOOKS = 5;

export interface PersonThinSignals {
  /** Distinct books this person recommends. */
  recommendedBookCount: number;
  /** Recommendations whose source passes getProofDisplaySafety's showSource. */
  sourcedRecommendationCount: number;
}

type RecommendationRow = ProofItem & { book_id?: string | null };

/** Builds the person signals from their recommendation rows. */
export function personThinSignals(person: PersonItem, rows: RecommendationRow[]): PersonThinSignals {
  const books = new Set<string>();
  let sourced = 0;
  rows.forEach((row, i) => {
    books.add(row.book_id || `row-${i}`);
    if (getProofDisplaySafety(row, person).showSource) sourced += 1;
  });
  return { recommendedBookCount: books.size, sourcedRecommendationCount: sourced };
}

/**
 * Thin person page: fewer than 5 recommended books AND not one recommendation
 * with a source we would show. Unknown signals (null) are never thin.
 */
export function isThinPerson(signals: PersonThinSignals | null | undefined): boolean {
  if (!signals) return false;
  return (
    signals.recommendedBookCount < THIN_PERSON_MIN_BOOKS &&
    signals.sourcedRecommendationCount === 0
  );
}

export interface BookContent {
  description?: string | null;
  editorial_summary?: string | null;
}

/** True when the book has text of its own worth a page: a useful description or an editorial summary. */
export function bookHasOwnContent(book: BookContent): boolean {
  return isUsefulDescription(book.description) || (book.editorial_summary || "").trim().length > 0;
}

/**
 * Thin book page: no one recommends it AND it has no useful description AND
 * no editorial summary. `recommenderCount` null means "could not be read",
 * which is never thin.
 */
export function isThinBook(book: BookContent, recommenderCount: number | null | undefined): boolean {
  if (recommenderCount == null) return false;
  return recommenderCount === 0 && !bookHasOwnContent(book);
}

/** robots value for a detail page: index_status first, then the thin-page floor. */
export function detailRobotsDirective(
  row: { index_status?: string } | null | undefined,
  thin: boolean,
): string {
  return isIndexable(row) && !thin ? "index, follow" : "noindex, follow";
}
