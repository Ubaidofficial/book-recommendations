import { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import {
  getBookBySlugCached,
  getBookRedirectSlug,
  getBooksByAuthor,
  getBooksBySeries,
  getBookRecommenders,
  getListsForBook,
  getSimilarBooksByLists,
  getPersonIdBySlug,
  getSeriesIdBySlug,
  type Book,
  type BookRecommenderSummary,
} from "@/lib/data";
import { getBookInsights, EMPTY_INSIGHTS, type BookInsights } from "@/lib/bookInsights";
import { pageMetadata, bookPageTitle, contentDates } from "@/lib/seo";
import { detailRobotsDirective } from "@/lib/indexing";
import { isBookPageThin } from "@/lib/thinPages";
import { bookJsonLd, faqPageJsonLd } from "@/lib/jsonld";
import { displayTitle, displayListTitle, listKindFromSlug, displayBookTitle } from "@/lib/display";
import {
  isValidHttpUrl,
  isValidRating,
  formatRating,
  isUsefulDescription,
  cleanDescription,
  parseSourceUrls,
  parseEditorialList,
  sanitizeEditorialText,
  amazonCtaUrl,
  getProofDisplaySafety,
  coverAltText,
} from "@/lib/dataQuality";
import { Avatar, Book3D, BookCard, Breadcrumbs, SafeImage, LastUpdated } from "@/components";
import { BookSectionHeading, DraftNotesLabel, FactsRow, type Fact } from "@/components/book/primitives";
import { ReaderFit } from "@/components/book/ReaderFit";
import { ProfessionBars } from "@/components/book/ProfessionBars";
import { UnlikelyPair } from "@/components/book/UnlikelyPair";
import { SourceEvidence } from "@/components/book/SourceEvidence";
import { ReadNext } from "@/components/book/ReadNext";

// Detail-page cover fallback — calmer than the previous oversized-purple version.
// Subtle neutral gradient, small icon, readable but non-dominant title, "Cover unavailable" caption.
function DetailCoverFallback({ title }: { title: string }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-between bg-gradient-to-br from-subtle to-subtle/40 border-b border-border/60 p-3 text-center">
      <span className="mt-1 text-[10px] uppercase tracking-wider text-muted/60">Cover unavailable</span>
      <div className="flex flex-col items-center justify-center flex-1 px-2">
        <svg className="w-7 h-7 text-muted/40 mb-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
        <span className="text-sm font-medium text-ink/70 leading-snug line-clamp-5">{title}</span>
      </div>
      <span className="text-[10px] text-transparent select-none" aria-hidden>spacer</span>
    </div>
  );
}

function isValidSlug(slug: string | null | undefined): boolean {
  if (!slug || typeof slug !== "string") return false;
  const s = slug.trim().toLowerCase();
  return s !== "" && s !== "undefined" && s !== "null";
}

/**
 * Incremental static regeneration.
 *
 * This page had no caching declaration, so every request server-rendered it
 * against Supabase — production TTFB measured 1-8 seconds, against Google's
 * 0.8s "good" threshold, on a page whose content changes rarely.
 *
 * It reads only `params`, never searchParams/cookies/headers, so it qualifies
 * for ISR: serve cached HTML instantly, regenerate in the background every
 * five minutes. Recommendation data is not real-time; five minutes of
 * staleness costs nothing a visitor would notice.
 */
export const revalidate = 300;

interface Props {
  params: Promise<{ slug: string }>;
}

const joinNames = (names: string[]) =>
  names.length <= 1 ? names[0] || "" : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const book = await getBookBySlugCached(slug);
  if (!book) return { robots: "noindex, follow" };
  const title = displayBookTitle(book.title);
  const recCount = book.recommendation_count || 0;
  // Lead the snippet with who recommends the book — the answer to "who
  // recommended <book>" and the reason to click this result over a retailer's.
  // Falls back to the book's own description when there's no such proof.
  const recommenders = recCount >= 2 ? await getBookRecommenders(book.id, 3) : [];
  const names = recommenders.map((r) => r.person_name).filter((n) => n && n.trim().length > 0);
  const proofDesc = names.length > 0
    ? `${title}${book.author ? ` by ${book.author}` : ""} is recommended by ${recCount.toLocaleString()} people, including ${joinNames(names)}. See what they said, with sources, plus books like it.`
    : undefined;
  const desc = proofDesc
    || (isUsefulDescription(book.meta_description)
      ? book.meta_description
      : isUsefulDescription(book.description)
        ? book.description
        : undefined);
  return pageMetadata({
    title: bookPageTitle(title, book.author, recCount, book.meta_title),
    description: desc || "",
    path: `/books/${book.slug}`,
    image: isValidHttpUrl(book.cover_image_url) ? book.cover_image_url : undefined,
    type: "book",
    // index_status, plus the thin-page floor (src/lib/indexing.ts).
    robots: detailRobotsDirective(book, await isBookPageThin(book)),
  });
}

export default async function BookDetailPage({ params }: Props) {
  const { slug } = await params;
  const book = await getBookBySlugCached(slug);
  if (!book) {
    // A duplicate merged into another book (public.slugs). The slugs merged on
    // 2026-11-12 already get an HTTP 301 from next.config.js; this catches
    // later merges (loading.tsx streams first, so here it is an in-page 308).
    const mergedInto = await getBookRedirectSlug(slug);
    if (mergedInto) permanentRedirect(`/books/${mergedInto}`);
    notFound();
  }

  // Repaired Amazon CTA href. `book.amazon_url` is malformed for ~23% of
  // rows in production (a 10-char ASIN concatenated with a 12-char hex hash,
  // which lands users on Amazon's page-not-found view). normalizeAmazonUrl
  // truncates the corrupt suffix; it also returns null for non-Amazon hosts
  // (8 rows in DB) so the CTAs are simply suppressed for those books. No
  // affiliate tag is appended. Render-time only — DB is not modified.
  const normalizedAmazonUrl = amazonCtaUrl(book);

  const [personId, seriesId] = await Promise.all([
    book.author_slug ? getPersonIdBySlug(book.author_slug) : Promise.resolve(null),
    book.series_slug ? getSeriesIdBySlug(book.series_slug) : Promise.resolve(null),
  ]);

  let authorBooks: Awaited<ReturnType<typeof getBooksByAuthor>> = [];
  let seriesBooks: Awaited<ReturnType<typeof getBooksBySeries>> = [];
  let lists: Awaited<ReturnType<typeof getListsForBook>> = [];
  let listSimilarBooks: Awaited<ReturnType<typeof getSimilarBooksByLists>> = [];
  let notableRecommenders: BookRecommenderSummary[] = [];
  let insights: BookInsights = EMPTY_INSIGHTS;

  try {
    [authorBooks, seriesBooks, lists, listSimilarBooks, notableRecommenders, insights] = await Promise.all([
      personId ? getBooksByAuthor(personId, 6) : Promise.resolve([]),
      seriesId ? getBooksBySeries(seriesId, 100) : Promise.resolve([]),
      getListsForBook(book.id, 8),
      getSimilarBooksByLists(book.id, 12),
      getBookRecommenders(book.id, 12),
      // Source evidence, professions, unlikely pair and read-next. Never
      // throws; empty sections hide themselves.
      getBookInsights(book.id, book.title),
    ]);
  } catch (e) {
    console.error("[book-detail] Relation queries failed:", e);
  }

  // Sanitize junction data — filter out nulls from failed foreign-key joins
  const safeSeriesBooks = seriesBooks.filter((b: Book | null | undefined) => b != null && b.id);
  const safeAuthorBooks = authorBooks.filter((b: Book | null | undefined) => b != null && b.id);

  // Sources that passed getProofDisplaySafety (see lib/bookInsights.ts).
  const confirmedSources = insights.confirmed.length;
  const showVerifiedBadge = confirmedSources >= 2;
  const bottomBoxTitle = "How recommendation signals are reviewed";

  const hasCover = isValidHttpUrl(book.cover_image_url);
  const showRating = isValidRating(book.rating);
  // Display-only description hygiene: if the row doesn't pass isUsefulDescription
  // (placeholder text, scraped junk, too short, non-English) we hide the description
  // block entirely rather than show internal review text to the public.
  const showDescription = isUsefulDescription(book.description);
  const descriptionText = showDescription ? cleanDescription(book.description) : "";

  // Author line
  const hasAuthor = book.author && book.author.trim().length > 0;

  const hasLists = lists.length > 0;
  const hasSeries = book.series && book.series_slug;

  // Consolidate similar books — list/topic co-membership first (strongest topical
  // signal), then fall back to series + author so the section always has 6–8 cards
  // when possible. Deduped against the current book and against itself.
  const safeListSimilar = (listSimilarBooks || []).filter(
    (b: Book | null | undefined) => b != null && !!b.id && b.id !== book.id
  );
  const seriesIds = new Set(safeSeriesBooks.filter((b) => b !== null && b.id && b.id !== book.id).map((b) => b.id));
  const authorIds = new Set(safeAuthorBooks.filter((b) => b !== null && b.id && b.id !== book.id).map((b) => b.id));
  const similarIds = new Set<string>();
  const similarBooks = [...safeListSimilar, ...safeSeriesBooks, ...safeAuthorBooks]
    .filter((b) => {
      if (!b || !b.id || b.id === book.id) return false;
      if (seriesIds.has(b.id)) return false;
      if (authorIds.has(b.id)) return false;
      if (similarIds.has(b.id)) return false;
      similarIds.add(b.id);
      return true;
    })
    .slice(0, 8);

  // Scoring algorithm to pick one strong alternative from similarBooks for "Try this instead"
  const alternativeCandidate = (() => {
    if (similarBooks.length === 0) return null;
    const candidates = similarBooks
      .map((b) => {
        if (!isValidSlug(b.slug) || !b.title || !isValidHttpUrl(b.cover_image_url)) {
          return { b, score: -1 };
        }
        const recCount = typeof b.recommendation_count === "number" ? b.recommendation_count : 0;
        const hasEditorialSummary = b.editorial_summary && b.editorial_summary.trim().length >= 20 ? 15 : 0;
        const isApprovedOrDraft = (b.ai_quality_status && ["approved", "draft"].includes(b.ai_quality_status.toLowerCase())) ? 10 : 0;
        const hasBestFor = b.best_for && b.best_for.trim().length > 0 ? 5 : 0;
        const hasNotFor = b.not_for && b.not_for.trim().length > 0 ? 5 : 0;
        const hasThemes = (b.key_themes && (Array.isArray(b.key_themes) ? b.key_themes.length > 0 : String(b.key_themes).trim().length > 0)) ? 5 : 0;
        const score = recCount + hasEditorialSummary + isApprovedOrDraft + hasBestFor + hasNotFor + hasThemes;
        return { b, score };
      })
      .filter((x) => x.score >= 0);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].b;
  })();

  // Reading facts. page_count is sparse in production, so the pages fact
  // simply hides on most books; difficulty only exists where the editorial
  // pipeline ran.
  const difficulty = (book.difficulty_level || "").trim();
  const rawPageCount =
    typeof book.page_count === "number" && Number.isFinite(book.page_count) && book.page_count > 0
      ? Math.round(book.page_count)
      : null;

  // "Why recommended" deterministic summary — no AI, no DB. Uses the existing
  // pre-ranked lists from getListsForBook (topic > narrow > meta > broad) and
  // the recommendation_count column. Empty if both signals are absent.
  const whyRecParts: string[] = [];
  const recCount = typeof book.recommendation_count === "number" ? book.recommendation_count : 0;
  if (recCount > 0) {
    whyRecParts.push(
      `Recommended by ${recCount.toLocaleString()} source${recCount === 1 ? "" : "s"}`
    );
  }
  const whyRecListNames = (lists || [])
    .slice(0, 3)
    .map((l) => displayListTitle(l.title, l.slug))
    .filter((s): s is string => !!s && s.length > 0);
  if (whyRecListNames.length > 0) {
    const joined =
      whyRecListNames.length === 1
        ? whyRecListNames[0]
        : whyRecListNames.length === 2
          ? `${whyRecListNames[0]} and ${whyRecListNames[1]}`
          : `${whyRecListNames.slice(0, -1).join(", ")}, and ${whyRecListNames[whyRecListNames.length - 1]}`;
    whyRecParts.push(`appears in ${joined}`);
  }
  const whyRecSentence = whyRecParts.length > 0 ? whyRecParts.join(" and ") + "." : null;

  // Editorial (AI-written reader notes). Shown for draft/needs_review/approved
  // rows; always with a provenance label (DraftNotesLabel).
  const aiStatus = (book.ai_quality_status || "").toLowerCase();
  const showEditorial = !!aiStatus && aiStatus !== "rejected" && aiStatus !== "pending";
  const editorialReviewed = aiStatus === "approved";

  const editorialSummary = showEditorial
    ? sanitizeEditorialText((book.editorial_summary || "").trim())
    : "";
  const bestForItems = showEditorial
    ? parseEditorialList(book.best_for, { maxItems: 4, minLen: 8 }).map((s) => sanitizeEditorialText(s)).filter((s): s is string => !!s)
    : [];
  const notForItems = showEditorial
    ? parseEditorialList(book.not_for, { maxItems: 4, minLen: 8 }).map((s) => sanitizeEditorialText(s)).filter((s): s is string => !!s)
    : [];
  const themesRaw = showEditorial
    ? parseEditorialList(book.key_themes, { maxItems: 6, minLen: 3 }).map((s) => sanitizeEditorialText(s)).filter((s) => !!s)
    : [];

  // Month + year is enough to date the editorial without implying a precision
  // the pipeline does not have.
  const aiGeneratedLabel = (() => {
    if (!showEditorial || !book.ai_generated_at) return "";
    const d = new Date(book.ai_generated_at);
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  })();

  const hasAudienceFit = bestForItems.length > 0 || notForItems.length > 0;

  const jsonld = bookJsonLd(book, book.slug);

  // Visible Q&A answering the searches a book page can satisfy — "who
  // recommended <book>", "is <book> worth reading", "books like <book>" —
  // built only from data already on the page. Each question is omitted when
  // its answer would be empty or invented.
  const bookTitle = displayBookTitle(book.title);
  const recommenderNames = notableRecommenders
    .map((r) => (typeof r.person_name === "string" ? r.person_name.trim() : ""))
    .filter((n) => n.length > 0);
  const recommenderTotal = Math.max(book.recommendation_count || 0, recommenderNames.length);
  const faq = [
    recommenderNames.length > 0 && {
      q: `Who recommended ${bookTitle}?`,
      a: `${recommenderTotal.toLocaleString()} ${recommenderTotal === 1 ? "person has" : "people have"} recommended ${bookTitle} in the interviews, articles and reading lists we track, including ${joinNames(recommenderNames.slice(0, 4))}. Each name links to their full reading list.`,
    },
    bestForItems.length > 0 && {
      q: `Is ${bookTitle} worth reading?`,
      a: `${recommenderTotal > 0 ? `${recommenderTotal.toLocaleString()} ${recommenderTotal === 1 ? "person we track recommends it" : "people we track recommend it"}. ` : ""}It is best for: ${bestForItems.join("; ")}.${notForItems.length > 0 ? ` It may not suit: ${notForItems.join("; ")}.` : ""}`,
    },
    similarBooks.length >= 3 && {
      q: `What books are like ${bookTitle}?`,
      a: `Readers of ${bookTitle} also turn to ${joinNames(similarBooks.slice(0, 3).map((b) => displayBookTitle(b.title)))}, based on the lists and recommenders these books share.`,
    },
  ].filter((x): x is { q: string; a: string } => !!x);
  const faqJsonLd = faqPageJsonLd(faq);

  // Facts under the title. Zero/unknown values are dropped, never shown as 0.
  const facts: Fact[] = [
    recCount > 0 && { value: recCount.toLocaleString(), label: recCount === 1 ? "Person recommends it" : "People recommend it" },
    confirmedSources > 0 && { value: confirmedSources.toLocaleString(), label: confirmedSources === 1 ? "Source we traced" : "Sources we traced" },
    rawPageCount != null && { value: rawPageCount.toLocaleString(), label: "Pages" },
    difficulty && { value: difficulty.charAt(0).toUpperCase() + difficulty.slice(1).toLowerCase(), label: "Difficulty" },
  ].filter((f): f is Fact => !!f);

  // Long titles step down a size so the H1 never dominates the hero.
  const h1Size =
    bookTitle.length > 60
      ? "text-3xl md:text-4xl"
      : bookTitle.length > 28
        ? "text-4xl md:text-5xl"
        : "text-[44px] md:text-6xl lg:text-[68px]";

  const personLink = (slug: string | null | undefined, name: string, cls = "font-semibold text-ink hover:text-accent hover:underline") =>
    slug ? (
      <Link href={`/people/${slug}`} className={cls}>
        {name}
      </Link>
    ) : (
      <span className="font-semibold text-ink">{name}</span>
    );

  // Social Proof Summary Row
  const socialProofRow = (() => {
    const validRecs = (notableRecommenders || [])
      .filter((r) => r && typeof r.person_name === "string" && r.person_name.trim().length > 0);
    if (validRecs.length === 0) return null;

    const cluster = validRecs.slice(0, 3);
    const remainingCount = validRecs.length - 2;

    return (
      <div className="flex items-center gap-3 flex-wrap text-xs md:text-sm text-muted">
        <div className="flex -space-x-2 shrink-0">
          {cluster.map((r, idx) => {
            const hasAvatar = isValidHttpUrl(r.avatar_url);
            const initials = (r.person_name || "?").charAt(0);
            const content = hasAvatar ? (
              <SafeImage
                src={r.avatar_url!}
                alt={r.person_name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-[9px] font-bold text-muted/60">{initials}</span>
            );

            return r.person_slug ? (
              <Link
                key={r.person_slug}
                href={`/people/${r.person_slug}`}
                className="w-6.5 h-6.5 rounded-full bg-subtle border border-surface overflow-hidden flex items-center justify-center hover:z-10 transition-transform hover:scale-105 shrink-0"
                title={r.person_name}
              >
                {content}
              </Link>
            ) : (
              <div
                key={idx}
                className="w-6.5 h-6.5 rounded-full bg-subtle border border-surface overflow-hidden flex items-center justify-center shrink-0"
                title={r.person_name}
              >
                {content}
              </div>
            );
          })}
        </div>

        <span className="leading-relaxed">
          Recommended by{" "}
          {validRecs.length === 1 && personLink(validRecs[0].person_slug, validRecs[0].person_name)}
          {validRecs.length === 2 && (
            <>
              {personLink(validRecs[0].person_slug, validRecs[0].person_name)}
              {" and "}
              {personLink(validRecs[1].person_slug, validRecs[1].person_name)}
            </>
          )}
          {validRecs.length >= 3 && (
            <>
              {personLink(validRecs[0].person_slug, validRecs[0].person_name)}
              {", "}
              {personLink(validRecs[1].person_slug, validRecs[1].person_name)}
              {" + "}
              <details className="relative inline group/popover recommenders-popover">
                <summary className="list-none inline cursor-pointer font-semibold text-accent hover:text-accent-hover hover:underline focus:outline-none select-none [&::-webkit-details-marker]:hidden">
                  {remainingCount} more
                </summary>
                <div className="absolute left-1/2 -translate-x-1/2 md:translate-x-0 md:left-0 top-full mt-2 z-30 w-80 max-w-[90vw] rounded-xl border border-border bg-surface shadow-xl p-3 space-y-2.5 text-left font-normal text-xs md:text-sm text-ink">
                  <p className="font-bold text-ink border-b border-border pb-1.5 mb-1.5">More recommenders</p>
                  <div className="max-h-60 overflow-y-auto space-y-3 pr-1">
                    {validRecs.slice(2).map((r, idx) => {
                      const initials = (r.person_name || "?").charAt(0);
                      const hasAvatar = isValidHttpUrl(r.avatar_url);
                      // Same gate as "Who said it, and where": a quote or
                      // source only appears when getProofDisplaySafety allows
                      // it (no aggregates, no other people's tweets).
                      const safety = getProofDisplaySafety(
                        { quote: r.quote, source_url: r.source_url, confidence_score: r.confidence_score },
                        { slug: r.person_slug, name: r.person_name, twitter_handle: r.twitter_handle },
                      );
                      const firstSource = safety.showSource ? parseSourceUrls(r.source_url)[0] : null;
                      return (
                        <div key={idx} className="flex gap-2.5 items-start">
                          <div className="w-7 h-7 rounded-full bg-subtle shrink-0 border border-border overflow-hidden flex items-center justify-center">
                            {hasAvatar ? (
                              <SafeImage src={r.avatar_url!} alt={r.person_name} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-[10px] font-bold text-muted/50">{initials}</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-1.5">
                              {r.person_slug ? (
                                <Link
                                  href={`/people/${r.person_slug}`}
                                  className="font-semibold text-ink hover:text-accent hover:underline text-xs truncate"
                                >
                                  {r.person_name}
                                </Link>
                              ) : (
                                <span className="font-semibold text-ink text-xs truncate">{r.person_name}</span>
                              )}
                            </div>
                            {r.role && <p className="text-[10px] text-muted truncate mt-0.5">{r.role}</p>}
                            {safety.displayQuote && (
                              <p className="text-[11px] text-muted/80 leading-relaxed italic border-l border-accent/20 pl-2 mt-1 line-clamp-2">
                                &ldquo;{safety.displayQuote}&rdquo;
                              </p>
                            )}
                            {firstSource && (
                              <a
                                href={firstSource}
                                target="_blank"
                                rel="noopener noreferrer nofollow"
                                className="text-[10px] text-accent hover:underline inline-block mt-1 font-semibold"
                              >
                                Source ↗
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="border-t border-border pt-2 text-center">
                    <a href="#evidence" className="text-xs text-accent font-semibold hover:underline">
                      See who said it, and where ↓
                    </a>
                  </div>
                </div>
              </details>
            </>
          )}
        </span>
      </div>
    );
  })();

  const amazonIcon = (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
    </svg>
  );

  const seriesNav = hasSeries && safeSeriesBooks.length > 0 ? (() => {
    const currentIndex = safeSeriesBooks.findIndex((b) => b.id === book.id);
    if (currentIndex === -1) return null;
    const position = currentIndex + 1;
    const total = safeSeriesBooks.length;
    const prevBook = currentIndex > 0 ? safeSeriesBooks[currentIndex - 1] : null;
    const nextBook = currentIndex < total - 1 ? safeSeriesBooks[currentIndex + 1] : null;
    const firstBook = safeSeriesBooks[0];
    const isNotFirst = currentIndex > 0;
    const navItem = (b: Book, dir: "prev" | "next") => {
      const label = dir === "prev" ? "← Previous book" : "Next book →";
      const align = dir === "prev" ? "text-left" : "text-right";
      const inner = (
        <>
          <span className={`text-muted font-medium ${dir === "next" ? "justify-end" : ""} flex items-center gap-1 group-hover:text-accent`}>{label}</span>
          <span className="font-semibold text-ink truncate max-w-full block">{displayBookTitle(b.title)}</span>
        </>
      );
      return isValidSlug(b.slug) ? (
        <Link href={`/books/${b.slug}`} className={`group flex flex-col gap-0.5 ${align} hover:opacity-85 min-w-0`}>
          {inner}
        </Link>
      ) : (
        <div className={`group flex flex-col gap-0.5 ${align} min-w-0`}>{inner}</div>
      );
    };

    return (
      <div className="flex flex-col gap-3 p-4 rounded-xl border border-border bg-surface/70 max-w-xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-ink">
            Book {position} of {total} in{" "}
            {isValidSlug(book.series_slug) ? (
              <Link href={`/series/${book.series_slug}`} className="text-accent hover:underline">
                {displayTitle(book.series!)}
              </Link>
            ) : (
              <span className="text-accent font-semibold">{displayTitle(book.series!)}</span>
            )}
          </span>
          {isNotFirst && firstBook && isValidSlug(firstBook.slug) && (
            <Link
              href={`/books/${firstBook.slug}`}
              className="text-xs font-bold text-accent hover:text-accent/80 bg-accent-light px-2 py-1 rounded"
            >
              Start series here
            </Link>
          )}
        </div>
        {(prevBook || nextBook) && (
          <div className="grid grid-cols-2 gap-4 border-t border-border/40 pt-3 text-xs">
            {prevBook ? navItem(prevBook, "prev") : <div />}
            {nextBook ? navItem(nextBook, "next") : <div />}
          </div>
        )}
      </div>
    );
  })() : null;

  return (
    <div className="relative w-full py-8 pb-28 lg:pb-8 overflow-x-clip">
      {/* Full-width blurred cover-art band behind hero */}
      {hasCover && (
        <div className="absolute inset-x-0 top-0 h-[320px] lg:h-[480px] -z-10 pointer-events-none select-none overflow-hidden" aria-hidden="true">
          <img
            src={book.cover_image_url}
            alt=""
            className="w-full h-full object-cover blur-[100px] opacity-[0.22] scale-125 origin-center"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent" />
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 md:px-6">
        {jsonld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonld) }} />}
        {faqJsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />}
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Books", href: "/books" }, { label: bookTitle }]} />

        {/* ── Hero: the book as an object, then "should you read it?" ── */}
        <section className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-4 lg:gap-14 items-center mt-4 lg:mt-8 mb-16">
          <div className="flex flex-col items-center pt-6">
            {/* The cover as a 3D object. Book3D keeps a real <img> with the
                same alt on its front face, so LCP and image search see the same
                image a flat cover gave them. One instance serves both layouts
                (mobileWidth), so the hero image is eager on phones too. */}
            <Book3D
              src={hasCover ? book.cover_image_url : ""}
              alt={coverAltText(book.title, book.author)}
              width={240}
              mobileWidth={176}
              pageCount={book.page_count}
              loading="eager"
              fallback={<DetailCoverFallback title={bookTitle} />}
              backTitle={bookTitle}
              backAuthor={hasAuthor ? book.author : undefined}
              backNote={recCount > 0 ? `Recommended by ${recCount.toLocaleString()} ${recCount === 1 ? "person" : "people"}` : undefined}
            />
            <p className="mt-9 text-xs text-muted select-none">Drag to turn it · click for the back cover</p>
          </div>

          <div className="min-w-0 flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Should you read it?</span>
              {showRating && (
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent-light text-accent text-xs font-semibold"
                  title="BookMentions recommendation score — not an Amazon or Goodreads rating"
                >
                  {formatRating(book.rating)} rec. score
                </span>
              )}
              {showVerifiedBadge && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface border border-border text-xs text-muted font-medium">
                  <svg className="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  Sources linked
                </span>
              )}
            </div>

            <div>
              <h1 className={`font-serif font-medium text-ink tracking-tight leading-[1.05] break-words ${h1Size}`}>{bookTitle}</h1>
              {book.subtitle && <p className="mt-3 text-base md:text-lg text-muted">{book.subtitle}</p>}
              {hasAuthor && (
                <p className="mt-3 text-base md:text-lg text-muted">
                  by <span className="text-ink font-medium">{book.author}</span>
                </p>
              )}
              <LastUpdated modified={contentDates(book).modified} className="text-xs text-muted mt-2" />
            </div>

            <FactsRow facts={facts} />

            {editorialSummary ? (
              <div className="flex flex-col gap-3">
                <p className="text-[15px] md:text-base text-ink/90 leading-relaxed max-w-2xl">{editorialSummary}</p>
                <DraftNotesLabel reviewed={editorialReviewed} />
              </div>
            ) : whyRecSentence ? (
              <p className="text-[15px] md:text-base text-ink/90 leading-relaxed max-w-2xl">{whyRecSentence}</p>
            ) : null}

            {socialProofRow}

            <div className="flex flex-wrap items-center gap-3">
              {normalizedAmazonUrl && (
                <a
                  href={normalizedAmazonUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow sponsored"
                  data-track-slug={book.slug}
                  data-track-section="above-fold"
                  data-track-label="Check price on Amazon"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold shadow-sm motion-btn-cta"
                >
                  {amazonIcon}
                  Check price on Amazon
                </a>
              )}
              {(insights.confirmed.length > 0 || insights.unconfirmed.length > 0) && (
                <a
                  href="#evidence"
                  className="inline-flex items-center justify-center px-5 py-3 rounded-xl border border-border bg-surface text-sm font-semibold text-ink hover:border-accent/40 hover:text-accent transition-colors"
                >
                  See who said it, and where
                </a>
              )}
            </div>
            {normalizedAmazonUrl && (
              <p className="-mt-2 text-[11px] text-muted leading-normal" data-track-context="above-fold-trust-badge">
                {confirmedSources > 0
                  ? `${confirmedSources.toLocaleString()} recommendation source${confirmedSources === 1 ? "" : "s"} linked below`
                  : recCount > 0
                    ? "Recommended by public sources"
                    : "Amazon availability"}
                {" · "}
                <a
                  href={normalizedAmazonUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow sponsored"
                  data-track-slug={book.slug}
                  data-track-section="above-fold"
                  data-track-label="See customer reviews on Amazon"
                  className="font-semibold text-accent hover:text-accent-hover hover:underline"
                >
                  See customer reviews on Amazon →
                </a>
              </p>
            )}

            {seriesNav}
          </div>
        </section>

        <ReaderFit
          bestFor={bestForItems}
          notFor={notForItems}
          themes={themesRaw}
          reviewed={editorialReviewed}
          dated={aiGeneratedLabel ? `generated ${aiGeneratedLabel}` : undefined}
          cta={
            normalizedAmazonUrl ? (
              <a
                href={normalizedAmazonUrl}
                target="_blank"
                rel="noopener noreferrer nofollow sponsored"
                data-track-slug={book.slug}
                data-track-section="audience-fit"
                // data-track-label intentionally preserved as the original
                // "Check formats on Amazon" string so the analytics CTR
                // series stays continuous across copy changes.
                data-track-label="Check formats on Amazon"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold motion-btn-cta"
              >
                {amazonIcon}
                See formats and current price on Amazon
              </a>
            ) : undefined
          }
        />

        {showDescription && (
          <section className="mb-16 max-w-3xl" aria-labelledby="about-book">
            <h2 id="about-book" className="font-serif text-[22px] md:text-2xl font-medium text-ink tracking-tight mb-3">About the book</h2>
            <p className="text-[15px] text-muted leading-relaxed">{descriptionText}</p>
          </section>
        )}

        {/* Mid-page fallback CTA for books without reader notes */}
        {!hasAudienceFit && normalizedAmazonUrl && (
          <div className="mb-16 p-6 rounded-2xl border border-amber-200/60 bg-amber-50/15 shadow-[0_8px_30px_rgba(245,158,11,0.02)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-sm font-bold text-ink">
                Looking for Kindle, hardcover, paperback, or audiobook editions?
              </h2>
              <p className="text-xs text-muted">
                Check formats, pricing, and current availability directly.
              </p>
            </div>
            <a
              href={normalizedAmazonUrl}
              target="_blank"
              rel="noopener noreferrer nofollow sponsored"
              data-track-slug={book.slug}
              data-track-section="book-fallback"
              data-track-label="Check availability on Amazon"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-semibold shrink-0 motion-btn-cta"
            >
              {amazonIcon}
              Check availability on Amazon
            </a>
          </div>
        )}

      {/* Recommended by notable people — compact scannable face grid. Sources
          and quotes live in "Who said it, and where" below, behind the
          attribution gate; this grid only names people. */}
      {notableRecommenders.length > 0 && (
        <section className="mb-12" aria-labelledby="who-recommended">
          <BookSectionHeading
            id="who-recommended"
            title={`Who recommended ${bookTitle}?`}
            dek="People and public figures who have recommended this book."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {notableRecommenders.map((r) => (
              <Link
                key={r.person_slug}
                href={`/people/${r.person_slug}`}
                className="group rounded-xl border border-border bg-surface p-3 flex items-center gap-3 min-w-0 hover:border-accent/30 transition-colors"
              >
                <Avatar
                  name={r.person_name}
                  slug={r.person_slug}
                  avatarUrl={r.avatar_url}
                  sizeClass="w-10 h-10"
                  textClass="text-sm"
                  className="ring-1 ring-border"
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate group-hover:text-accent transition-colors">
                    {r.person_name}
                  </p>
                  {r.role && <p className="text-xs text-muted truncate">{r.role}</p>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <ProfessionBars roles={insights.roles} />

      <UnlikelyPair pair={insights.unlikelyPair} />

      <SourceEvidence bookTitle={bookTitle} confirmed={insights.confirmed} unconfirmed={insights.unconfirmed} />

      {/* Concluding Amazon CTA below the evidence */}
      {normalizedAmazonUrl && (
        <div className="mb-16 p-6 rounded-2xl border border-amber-200/60 bg-amber-50/15 shadow-[0_8px_30px_rgba(245,158,11,0.02)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1 flex-1">
            <h3 className="text-sm font-bold text-ink">
              Ready to read {bookTitle}?
            </h3>
            <p className="text-xs text-muted">
              Check formats, pricing, and availability options directly on Amazon.
            </p>
          </div>
          <a
            href={normalizedAmazonUrl}
            target="_blank"
            rel="noopener noreferrer nofollow sponsored"
            data-track-slug={book.slug}
            data-track-section="proof-conclusion"
            data-track-label="View on Amazon"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-semibold shrink-0 motion-btn-cta"
          >
            {amazonIcon}
            View on Amazon
          </a>
        </div>
      )}

      <ReadNext bookTitle={bookTitle} books={insights.readNext} />

      {/* Why recommended — deterministic one-sentence summary (rec count + top
          lists). Shown here only when the hero used the editorial summary;
          otherwise the hero already says it. */}
      {whyRecSentence && editorialSummary && (
        <section className="mb-10">
          <div className="rounded-xl border border-border bg-surface p-4 md:p-5 max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">Why recommended</p>
            <p className="text-sm md:text-base text-ink leading-relaxed">{whyRecSentence}</p>
          </div>
        </section>
      )}
      {/* Appears in Lists — single-pass dedupe across ALL kinds by normalized display label,
          keeping the higher-priority entry (topic > meta > other > category); same priority
          ties broken by lower pre-rank index, then smaller book_count. Broad parents
          (Fiction/Nonfiction/History/…) are hidden once we have ≥5 useful specific cards.
          Final list capped at 8. Fiction and Nonfiction are never shown together — the
          contradiction is resolved by slug-keyword inference, else both are hidden. */}
      {hasLists && (() => {
        // Priority: lower number wins on duplicate-label collisions.
        const PRIORITY: Record<ReturnType<typeof listKindFromSlug>, number> = {
          topic: 1, meta: 2, other: 3, category: 4,
        };
        // The 10 broad-parent slugs explicitly called out for suppression on this page.
        const BROAD_APPEARS_IN_SLUGS = new Set([
          "fiction", "nonfiction", "history", "social-sciences", "business",
          "philosophy", "science", "art", "personal-development", "psychology",
        ]);

        // Heuristic: infer whether the book is fiction or nonfiction from its OTHER lists'
        // slug tokens. Used to resolve the Fiction-vs-Nonfiction contradiction.
        const fictionKw = /(^|-)(fiction|fantasy|romance|mystery|thriller|horror|dystopian|comics?|manga|poetry|paranormal|time-travel|space-opera|steampunk|saga|novel|sci-fi)(-|$)/;
        const nonfictionKw = /(^|-)(biography|autobiography|memoir|business|leadership|ceo|history|science|math|physics|biology|psychology|philosophy|self-help|personal-development|finance|investing|technology|programming|cookbook|nutrition|fitness|sports|parenting|health|spirituality|religion|writing|design|architecture|photography|travel|nature|gardening|management|marketing|sales|strategy|startup)(-|$)/;
        const otherSlugs = lists.map((l) => (l.slug || "").toLowerCase());
        const hasFictionSignal = otherSlugs.some((s) => fictionKw.test(s));
        const hasNonfictionSignal = otherSlugs.some((s) => nonfictionKw.test(s));
        const inferredType: "fiction" | "nonfiction" | "unknown" =
          hasFictionSignal && !hasNonfictionSignal ? "fiction"
            : hasNonfictionSignal && !hasFictionSignal ? "nonfiction"
              : "unknown";

        const enriched = lists.map((l, idx) => ({
          l,
          idx,                                                         // pre-rank position
          kind: listKindFromSlug(l.slug),
          displayName: displayListTitle(l.title, l.slug),
          isBroad: BROAD_APPEARS_IN_SLUGS.has((l.slug || "").toLowerCase()),
        }));

        // Resolve Fiction-vs-Nonfiction contradiction BEFORE dedupe so it doesn't leak through.
        const hasFictionCard = enriched.some((x) => x.kind === "category" && (x.l.slug || "").toLowerCase() === "fiction");
        const hasNonfictionCard = enriched.some((x) => x.kind === "category" && (x.l.slug || "").toLowerCase() === "nonfiction");
        const dropFiction = hasFictionCard && hasNonfictionCard && inferredType === "nonfiction";
        const dropNonfiction = hasFictionCard && hasNonfictionCard && inferredType === "fiction";
        const dropBothFN = hasFictionCard && hasNonfictionCard && inferredType === "unknown";
        const beforeFN = enriched.filter((x) => {
          const s = (x.l.slug || "").toLowerCase();
          if (s === "fiction" && (dropFiction || dropBothFN)) return false;
          if (s === "nonfiction" && (dropNonfiction || dropBothFN)) return false;
          return true;
        });

        // Single-pass dedupe by normalized display label across ALL kinds.
        const bestByLabel = new Map<string, typeof beforeFN[number]>();
        for (const x of beforeFN) {
          const key = x.displayName.toLowerCase().trim();
          if (!key) continue;
          const cur = bestByLabel.get(key);
          if (!cur) { bestByLabel.set(key, x); continue; }
          const curP = PRIORITY[cur.kind];
          const xP = PRIORITY[x.kind];
          if (xP < curP) { bestByLabel.set(key, x); continue; }
          if (xP === curP) {
            // Same kind & label collision — keep the better pre-rank, then smaller book_count.
            if (x.idx < cur.idx) { bestByLabel.set(key, x); continue; }
            if (x.idx === cur.idx) {
              const curBc = cur.l.book_count || 1e9;
              const xBc = x.l.book_count || 1e9;
              if (xBc < curBc) bestByLabel.set(key, x);
            }
          }
        }
        const deduped = Array.from(bestByLabel.values());

        const usefulSpecific = deduped.filter((x) => x.kind !== "category").length;
        const tierRank = (k: ReturnType<typeof listKindFromSlug>) => PRIORITY[k];
        const ordered = [...deduped].sort((a, b) => {
          const t = tierRank(a.kind) - tierRank(b.kind);
          return t !== 0 ? t : a.idx - b.idx;        // preserve pre-rank within tier
        });
        const finalList = ordered
          .filter((x) => !(usefulSpecific >= 5 && x.kind === "category" && x.isBroad))
          .slice(0, 8);
        const tierBadgeStyle: Record<string, string> = {
          topic: "bg-accent-light text-accent",
          meta: "bg-amber-100 text-amber-800",
          category: "bg-subtle text-muted",
          other: "bg-subtle text-muted",
        };
        const tierLabel: Record<string, string> = {
          topic: "Topic",
          meta: "Curated",
          category: "Category",
          other: "List",
        };
        return (
          <section className="mb-14">
            <h2 className="font-serif text-2xl md:text-[28px] leading-tight font-medium text-ink mb-5 tracking-tight">Appears in</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {finalList.map(({ l, kind, displayName }) => {
                const content = (
                  <>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm font-semibold text-ink">{displayName}</p>
                      {kind !== "other" && (
                        <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${tierBadgeStyle[kind]}`}>
                          {tierLabel[kind]}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted">{l.book_count} books</p>
                  </>
                );
                return isValidSlug(l.slug) ? (
                  <Link
                    key={l.id}
                    href={`/lists/${l.slug}`}
                    className="p-3.5 rounded-xl border border-border bg-surface hover:shadow-md hover:border-accent/20 transition-all block"
                  >
                    {content}
                  </Link>
                ) : (
                  <div
                    key={l.id}
                    className="p-3.5 rounded-xl border border-border bg-surface block"
                  >
                    {content}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

      {/* Series Context */}
      {hasSeries && safeSeriesBooks.length > 0 && (() => {
        const currentIndex = safeSeriesBooks.findIndex((b) => b.id === book.id);
        const prevBookId = currentIndex > 0 ? safeSeriesBooks[currentIndex - 1]?.id : null;
        const nextBookId = currentIndex < safeSeriesBooks.length - 1 ? safeSeriesBooks[currentIndex + 1]?.id : null;

        const bottomSeriesBooks = safeSeriesBooks.filter(
          (b) => b.id !== book.id && b.id !== prevBookId && b.id !== nextBookId
        ).slice(0, 6);

        if (bottomSeriesBooks.length === 0) return null;

        return (
          <section className="mb-14">
            <h2 className="font-serif text-2xl md:text-[28px] leading-tight font-medium text-ink mb-5 tracking-tight">More from {displayTitle(book.series!)}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
              {bottomSeriesBooks.map((b) => (
                <BookCard key={b.id} title={b.title} slug={b.slug} author={b.author} authorSlug={b.author_slug} coverUrl={b.cover_image_url} rating={b.rating} recommendationCount={b.recommendation_count} amazonUrl={b.amazon_url} />
              ))}
            </div>
          </section>
        );
      })()}

      {/* Also By Author */}
      {safeAuthorBooks.filter((b) => b.id !== book.id).length > 0 && (
        <section className="mb-14">
          <h2 className="font-serif text-2xl md:text-[28px] leading-tight font-medium text-ink mb-5 tracking-tight">Also by {book.author}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
            {safeAuthorBooks.filter((b) => b.id !== book.id).map((b) => (
              <BookCard key={b.id} title={b.title} slug={b.slug} author={b.author} authorSlug={b.author_slug} coverUrl={b.cover_image_url} rating={b.rating} recommendationCount={b.recommendation_count} amazonUrl={b.amazon_url} />
            ))}
          </div>
        </section>
      )}

      {/* Similar Books — list/topic co-membership first, then series + author fallback.
          Deduped and capped at 8. Section appears even when series/author are empty
          as long as co-membership returns results. */}
      {/* Try this instead section */}
      {alternativeCandidate && (
        <section className="mb-14 rounded-2xl border border-amber-100 bg-amber-50/15 p-6 md:p-8">
          <div className="flex flex-col md:flex-row gap-6 items-start">
            <div className="w-24 shrink-0 aspect-[2/3] rounded-lg overflow-hidden shadow-sm bg-subtle">
              <SafeImage
                src={alternativeCandidate.cover_image_url}
                alt={displayBookTitle(alternativeCandidate.title)}
                className="w-full h-full object-cover"
                fallback={<div className="w-full h-full bg-border flex items-center justify-center text-[10px] text-muted">No Cover</div>}
              />
            </div>
            <div className="flex-1">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-xs font-semibold uppercase tracking-wider mb-2">
                Try This Instead
              </span>
              <h3 className="text-lg font-bold text-ink mb-1">
                Not sure if this is the right fit?
              </h3>
              <p className="text-sm text-muted mb-4">
                Consider <span className="font-semibold text-ink">{displayBookTitle(alternativeCandidate.title)}</span> by {alternativeCandidate.author}. 
                {alternativeCandidate.recommendation_count > 0 && ` Recommended by ${alternativeCandidate.recommendation_count} sources.`}
              </p>

              {alternativeCandidate.editorial_summary && (
                <p className="text-xs text-muted leading-relaxed italic border-l border-amber-200 pl-3 mb-4 line-clamp-2">
                  &ldquo;{sanitizeEditorialText(alternativeCandidate.editorial_summary)}&rdquo;
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/books/${alternativeCandidate.slug}`}
                  className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 shadow-sm"
                >
                  View book details →
                </Link>
                {!normalizedAmazonUrl && (() => {
                  // try-this-instead is the fallback CTA when the *current*
                  // book has no usable Amazon URL. We surface the alternative
                  // book's Amazon link only after normalizing it, so a broken
                  // /dp/<22-char-ASIN> alternative also renders cleanly (or
                  // is suppressed if the alternative's URL is non-Amazon).
                  const altUrl = amazonCtaUrl(alternativeCandidate);
                  if (!altUrl) return null;
                  return (
                    <a
                      href={altUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow sponsored"
                      data-track-slug={alternativeCandidate.slug}
                      data-track-section="try-this-instead"
                      data-track-label="Check price on Amazon"
                      className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold shadow-sm motion-btn-cta"
                    >
                      Check price on Amazon
                    </a>
                  );
                })()}
              </div>
            </div>
          </div>
        </section>
      )}

      {similarBooks.length > 0 && (
        <section className="mb-14">
          <h2 className="font-serif text-2xl md:text-[28px] leading-tight font-medium text-ink mb-5 tracking-tight">Books like {displayBookTitle(book.title)}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
            {similarBooks.map((b) => (
              <BookCard key={b.id} title={b.title} slug={b.slug} author={b.author} authorSlug={b.author_slug} coverUrl={b.cover_image_url} rating={b.rating} recommendationCount={b.recommendation_count} amazonUrl={b.amazon_url} />
            ))}
          </div>
        </section>
      )}

      {faq.length > 0 && (
        <section className="mb-14" aria-labelledby="faq">
          <h2 id="faq" className="font-serif text-2xl leading-tight font-medium text-ink mb-4 tracking-tight">{bookTitle}: common questions</h2>
          <dl className="space-y-4">
            {faq.map((f) => (
              <div key={f.q}>
                <dt className="font-semibold text-ink text-sm">{f.q}</dt>
                <dd className="text-sm text-muted leading-relaxed mt-1">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Methodology footer */}
      <section className="rounded-2xl border border-border bg-surface p-5 md:p-7">
        <h2 className="text-lg font-bold text-ink mb-2 tracking-tight">{bottomBoxTitle}</h2>
        <p className="text-sm text-muted leading-relaxed">
          Each recommendation is collected from a public source — interviews, articles, or curated lists.
          We link the original source only when we can tie it to the person who recommended the book;
          where we cannot yet, the page says so. Books with many verifiable recommendations from
          respected people rank higher.
        </p>
      </section>
      </div> {/* max-w-7xl content wrapper closed */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              document.addEventListener('click', function(e) {
                // Click outside to close details popovers
                var popovers = document.querySelectorAll('details.recommenders-popover[open]');
                popovers.forEach(function(p) {
                  if (!p.contains(e.target)) {
                    p.removeAttribute('open');
                  }
                });

                var target = e.target.closest('a[data-track-section]');
                if (target) {
                  var slug = target.getAttribute('data-track-slug') || '';
                  var section = target.getAttribute('data-track-section') || '';
                  var label = target.getAttribute('data-track-label') || '';
                  
                  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    console.log('[Analytics] Outbound Click:', {
                      book_slug: slug,
                      page_section: section,
                      cta_label: label
                    });
                  }
                  
                  try {
                    if (typeof window.gtag === 'function') {
                      window.gtag('event', 'outbound_click', {
                        book_slug: slug,
                        page_section: section,
                        cta_label: label
                      });
                    }
                    if (window.umami && typeof window.umami.track === 'function') {
                      window.umami.track('outbound_click', {
                        book_slug: slug,
                        page_section: section,
                        cta_label: label
                      });
                    }
                    if (window.plausible && typeof window.plausible === 'function') {
                      window.plausible('outbound_click', {
                        props: {
                          book_slug: slug,
                          page_section: section,
                          cta_label: label
                        }
                      });
                    }
                  } catch (err) {
                    // ignore
                  }
                }
              });
            })();
          `,
        }}
      />

      {/* Sticky mobile Amazon CTA — fixed bottom bar on viewports < lg only.
          Renders only when book.amazon_url is a valid http(s) URL. The
          desktop right-rail CTA stays in place; this bar is purely additive
          for mobile and tablet, where the primary CTA otherwise lives
          below the fold for most book detail pages. Same rel / target /
          tracking attributes as the existing CTAs. Page-wrapper has
          `pb-28 lg:pb-8` so the last section is not covered. */}
      {normalizedAmazonUrl && (
        <div
          className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-border shadow-[0_-4px_12px_rgba(0,0,0,0.06)] px-3 pt-2.5 flex items-center gap-3 motion-slide-up"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))", paddingTop: "0.75rem" }}
          role="region"
          aria-label="Buy this book"
        >
          {hasCover ? (
            <SafeImage
              src={book.cover_image_url}
              alt={coverAltText(book.title, book.author)}
              className="w-10 h-14 object-cover rounded shrink-0"
              fallback={<div className="w-10 h-14 bg-subtle rounded shrink-0" aria-hidden />}
            />
          ) : (
            <div className="w-10 h-14 bg-subtle rounded shrink-0" aria-hidden />
          )}
          <p className="text-xs font-semibold text-ink line-clamp-1 flex-1 min-w-0">
            {displayBookTitle(book.title)}
          </p>
          <a
            href={normalizedAmazonUrl}
            target="_blank"
            rel="noopener noreferrer nofollow sponsored"
            data-track-slug={book.slug}
            data-track-section="sticky-mobile"
            data-track-label="View on Amazon"
            className="px-4 py-3 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-xs font-bold whitespace-nowrap shrink-0 motion-btn-cta"
          >
            View on Amazon →
          </a>
        </div>
      )}
    </div>
  );
}
