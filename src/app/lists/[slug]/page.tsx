import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getListBySlugCached, getBooksForListCached, getBooksForListByRecommendationsCached, getRelatedListsCached, getRecommendersForBooksCached } from "@/lib/data";
import { pageMetadata, robotsDirective } from "@/lib/seo";
import { displayListTitle, displayListTitleFull, listKindFromSlug, listKindLabel } from "@/lib/display";
import { isProbablyValidBookTitle, repairNumericTitle, isValidHttpUrl, isValidRating, formatRating, normalizeAmazonUrl,
  coverAltText,
} from "@/lib/dataQuality";
import { itemListJsonLd } from "@/lib/jsonld";
import { Avatar, Breadcrumbs, SafeImage, EmptyState } from "@/components";

// Declared for consistency with books/[slug] and series/[slug] (all three
// detail-page types share the same 1-8s cold-Supabase-read problem). Note
// this page also reads `searchParams` (`sort`), which Next.js renders
// dynamically per request regardless of `revalidate` — so the ISR benefit
// here is smaller than on the two params-only sibling pages, but the
// declaration keeps caching intent explicit rather than falling through to
// an undocumented default.
export const revalidate = 300;

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const list = await getListBySlugCached(slug);
  if (!list) return { robots: "noindex, follow" };
  const displayName = displayListTitle(list.title, list.slug);
  // The title tag carries the phrase people actually search ("Best Philosophy
  // Books"), not the bare subject; displayName stays short for prose.
  const seoName = displayListTitleFull(list.title, list.slug);
  // Lists had no og:image, so every share of a list rendered as a bare text
  // card while book and person pages showed artwork. The top-ranked book's
  // cover is the honest representative image for the list.
  let ogImage: string | undefined;
  try {
    const top = await getBooksForListCached(list.id, 1);
    const cover = top[0]?.cover_image_url;
    if (isValidHttpUrl(cover)) ogImage = cover;
  } catch {
    // A missing share image is not worth failing metadata generation over.
  }

  return pageMetadata({
    title: seoName,
    description:
      list.description ||
      `The ${seoName.toLowerCase()} recommended most often, with the source behind every pick.`,
    path: `/lists/${list.slug}`,
    image: ogImage,
    robots: robotsDirective(list),
  });
}

/**
 * Books rendered on a list page. Raised from 48: book_count on these rows
 * runs into the hundreds or thousands, so the page was showing a small
 * fraction and labelling it as the whole list.
 */
const LIST_PAGE_SIZE = 100;

export default async function ListDetailPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { sort } = await searchParams;
  const list = await getListBySlugCached(slug);
  if (!list) notFound();

  const kind = listKindFromSlug(list.slug);
  // Meta list: sort by books.recommendation_count and filter junk numeric/date titles.
  // Other lists: keep the imported rank order.
  // How many books a list page shows.
  //
  // This was 48 while book_count on the same rows ran into the thousands, so
  // a page headed "Best Mystery & Crime Books" showed 48 of 287 and captioned
  // it "48 books curated" — the visitor had no way to know the rest existed.
  // 100 matches the depth comparable sites publish and keeps a single render
  // affordable; covers below the fold are lazy-loaded.
  const booksPromise = kind === "meta"
    ? getBooksForListByRecommendationsCached(list.id, LIST_PAGE_SIZE)
    : getBooksForListCached(list.id, LIST_PAGE_SIZE);
  const [booksRaw, relatedLists] = await Promise.all([
    booksPromise,
    getRelatedListsCached(list.id, 6),
  ]);
  // Defensive junk-title repair + filter for ALL lists. If the filter would empty
  // the grid (e.g. unexpected data shape), keep the raw set so the page is never empty.
  const repaired = booksRaw.map((b) => ({ ...b, title: repairNumericTitle(b.title) }));
  const filtered = repaired.filter((b) => isProbablyValidBookTitle(b.title));
  if (booksRaw.length > 0 && filtered.length === 0) {
    console.warn(`[list=${list.slug}] title-hygiene filter removed all ${booksRaw.length} rows — falling back to raw set`);
  }
  const books = (filtered.length > 0 ? filtered : repaired).slice(0, LIST_PAGE_SIZE);

  // In-memory sort parameters
  // Who actually recommended the books on this page. Fetched after `books`
  // because it is scoped to what the page shows, not the whole list.
  const listRecommenders = await getRecommendersForBooksCached(books.map((b) => b.id), 12);

  // book_count is the list's true membership size; it is what the caption
  // compares against so "100 of 287" stays honest.
  const totalInList =
    typeof list.book_count === "number" && list.book_count > 0
      ? list.book_count
      : books.length;

  const activeSort = sort === "title" ? "title" : "recommendation";
  const sortedBooks = [...books];
  if (activeSort === "title") {
    sortedBooks.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  } else {
    // default/most-recommended: sort by recommendation_count desc, rating desc
    sortedBooks.sort((a, b) => {
      const ra = typeof a.recommendation_count === "number" ? a.recommendation_count : 0;
      const rb = typeof b.recommendation_count === "number" ? b.recommendation_count : 0;
      if (ra !== rb) return rb - ra;
      const ya = typeof a.rating === "number" ? a.rating : 0;
      const yb = typeof b.rating === "number" ? b.rating : 0;
      return yb - ya;
    });
  }

  // Calculate sum of recommendations across pre-fetched books efficiently
  const totalRecs = books.reduce((sum, b) => sum + (b.recommendation_count || 0), 0);

  const jsonld = itemListJsonLd(list, sortedBooks);
  const displayName = displayListTitle(list.title, list.slug);
  const hasBooks = sortedBooks.length > 0;
  const hasDescription = list.description && list.description.length > 0;
  const hasRelated = relatedLists.length > 0;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      {jsonld && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonld) }} />
      )}
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Lists", href: "/lists" }, { label: displayName }]} />

      <div className="mb-10 pb-6 border-b border-border/60">
        <div className="flex items-start gap-3 flex-wrap mb-3">
          <h1 className="text-2xl md:text-3xl font-bold text-ink tracking-tight">{displayListTitleFull(list.title, list.slug)}</h1>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-subtle text-muted text-[11px] font-medium shrink-0 mt-2">
            {listKindLabel(kind)}
          </span>
          {books.length > 0 && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-semibold shrink-0 mt-1">
              {/* Say "N of M" whenever the list holds more than the page
                  shows. "48 books curated" on a list of 287 read as the whole
                  set and quietly understated the collection. */}
              {totalInList > books.length
                ? `${books.length} of ${totalInList.toLocaleString()} books`
                : `${books.length} ${books.length === 1 ? "book" : "books"} curated`}
            </span>
          )}
          {totalRecs > 0 && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-subtle border border-border text-muted text-xs font-medium shrink-0 mt-1">
              {totalRecs.toLocaleString()} recommendations total
            </span>
          )}
        </div>
        {hasDescription ? (
          <p className="text-base text-muted max-w-2xl leading-relaxed">{list.description}</p>
        ) : (
          <p className="text-base text-muted max-w-2xl leading-relaxed">
            A curated collection of books related to {displayName}, ranked by recommendation signals.
          </p>
        )}
        {list.curator && (
          <p className="text-sm text-accent font-medium mt-2">Curated by {list.curator}</p>
        )}

        {/* Dynamic server-side sort controls */}
        {hasBooks && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-border/40 text-sm">
            <span className="text-muted font-medium">Curated list content</span>
            <div className="flex items-center gap-2">
              <span className="text-muted text-xs">Sort by:</span>
              <Link
                href={`/lists/${list.slug}?sort=recommendation`}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                  activeSort === "recommendation"
                    ? "bg-accent-light text-accent"
                    : "bg-subtle text-muted hover:text-ink hover:bg-border/30"
                }`}
              >
                Most recommended
              </Link>
              <Link
                href={`/lists/${list.slug}?sort=title`}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                  activeSort === "title"
                    ? "bg-accent-light text-accent"
                    : "bg-subtle text-muted hover:text-ink hover:bg-border/30"
                }`}
              >
                Title A–Z
              </Link>
            </div>
          </div>
        )}
      </div>

      {hasBooks ? (
        <div className="grid grid-cols-1 gap-6 md:gap-8 mb-14">
          {sortedBooks.map((book, i) => {
            const hasCover = isValidHttpUrl(book.cover_image_url);
            const showRating = isValidRating(book.rating);
            
            return (
              <div
                key={book.id}
                className="flex flex-col sm:flex-row gap-6 p-5 md:p-6 rounded-2xl border border-border bg-surface relative group motion-card-hover"
              >
                {/* Rank Badge */}
                <span className="absolute -top-2.5 -left-2.5 z-10 w-8 h-8 rounded-full bg-accent text-white text-sm flex items-center justify-center font-bold shadow-md">
                  {i + 1}
                </span>

                {/* Cover image container */}
                <div className="w-28 h-40 sm:w-32 sm:h-48 shrink-0 rounded-xl overflow-hidden shadow-sm bg-subtle relative mx-auto sm:mx-0 border border-border/40">
                  {hasCover ? (
                    <SafeImage
                      src={book.cover_image_url!}
                      alt={coverAltText(book.title, book.author)}
                      className="w-full h-full object-cover motion-cover-img"
                      fallback={
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-subtle to-subtle/40 p-2 text-center">
                          <span className="text-[9px] uppercase tracking-wider text-muted/60">No cover</span>
                          <span className="text-[10px] font-medium text-ink/65 leading-snug line-clamp-3 mt-1">{book.title}</span>
                        </div>
                      }
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-subtle to-subtle/40 p-2 text-center">
                      <span className="text-[9px] uppercase tracking-wider text-muted/60">No cover</span>
                      <span className="text-[10px] font-medium text-ink/65 leading-snug line-clamp-3 mt-1">{book.title}</span>
                    </div>
                  )}
                </div>

                {/* Content details */}
                <div className="flex-1 flex flex-col justify-between">
                  <div className="order-1">
                    <div className="mb-1">
                      <Link
                        href={`/books/${book.slug}`}
                        className="font-bold text-lg md:text-xl text-ink hover:text-accent transition-colors leading-tight block"
                      >
                        {book.title}
                      </Link>
                      {book.subtitle && (
                        <p className="text-xs md:text-sm text-muted mt-0.5">{book.subtitle}</p>
                      )}
                    </div>

                    {book.author && (
                      <p className="text-xs md:text-sm text-muted mb-3">
                        by <span className="text-accent font-semibold">{book.author}</span>
                      </p>
                    )}

                    {/* Stats */}
                    <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
                      {showRating && (
                        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-accent-light text-accent font-semibold">
                          ★ {formatRating(book.rating)}
                        </span>
                      )}
                      {book.recommendation_count > 0 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-subtle text-ink font-medium">
                          {book.recommendation_count} {book.recommendation_count === 1 ? "recommendation" : "recommendations"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Source context or fallback editorial summary why it appears */}
                  {book.recommendation_context && book.recommendation_context.trim().length > 0 ? (
                    <div className="order-3 sm:order-2 mt-4 sm:mt-0 bg-subtle/20 rounded-xl p-3 border border-border/40">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted block mb-1">Recommendation Context</span>
                      <blockquote className="text-xs md:text-sm text-muted italic border-l-2 border-accent/20 pl-2 leading-relaxed">
                        &ldquo;{book.recommendation_context}&rdquo;
                      </blockquote>
                    </div>
                  ) : book.editorial_summary && book.editorial_summary.trim().length > 0 ? (
                    <div className="order-3 sm:order-2 mt-4 sm:mt-0 bg-subtle/20 rounded-xl p-3 border border-border/40">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted block mb-1">Book Summary</span>
                      <p className="text-xs md:text-sm text-muted leading-relaxed line-clamp-3">
                        {book.editorial_summary}
                      </p>
                    </div>
                  ) : book.description && book.description.trim().length > 0 ? (
                    <div className="order-3 sm:order-2 mt-4 sm:mt-0 bg-subtle/20 rounded-xl p-3 border border-border/40">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted block mb-1">Description</span>
                      <p className="text-xs md:text-sm text-muted leading-relaxed line-clamp-3">
                        {book.description}
                      </p>
                    </div>
                  ) : null}

                  {/* Actions (compliant CTAs preferring Amazon purchase/view button) */}
                  <div className="order-2 sm:order-3 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-4 border-t border-border/40 pt-4 mt-4 sm:mt-6">
                    <Link
                      href={`/books/${book.slug}`}
                      className="text-xs text-muted hover:text-accent hover:underline flex items-center justify-center sm:justify-start gap-1 font-medium transition-colors"
                    >
                      View full details →
                    </Link>
                    {(() => {
                      // normalizeAmazonUrl repairs the dominant 22-char malformed
                      // ASIN pattern (≈25% of with-amazon-url books) and returns
                      // null for non-Amazon hosts, so the CTA is suppressed cleanly
                      // when the URL isn't usable. Render-time only — DB unchanged.
                      // No affiliate tag is appended (we don't have an approved tag
                      // yet — the env-gated withAmazonAffiliateTag helper proposed in
                      // the readiness audit is intentionally not used here).
                      const ctaUrl = normalizeAmazonUrl(book.amazon_url);
                      if (!ctaUrl) return null;
                      return (
                        <a
                          href={ctaUrl}
                          target="_blank"
                          rel="noopener noreferrer nofollow sponsored"
                          data-track-slug={book.slug}
                          data-track-section="list-book"
                          data-track-label="View on Amazon"
                          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-xs md:text-sm font-semibold shadow-sm w-full sm:w-auto text-center shrink-0 motion-btn-cta"
                        >
                          <span>View on Amazon</span>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      );
                    })()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <section className="mb-14">
          <EmptyState message="Books for this list are still being organized." />
        </section>
      )}

      {/* Compact trust & curation panel explaining data signals honestly without overclaiming */}
      <div className="mb-14 p-4 rounded-xl border border-border/50 bg-subtle/25 text-xs md:text-sm">
        <div className="flex gap-2.5 items-start">
          <svg className="w-4 h-4 text-accent mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
          </svg>
          <div className="space-y-2 text-muted">
            <p className="leading-relaxed">
              Built from recommendation data, category signals, and source-backed book records. Use this list as a starting point; open any book to see proof, context, and Amazon options where available.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-muted/65">
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-accent" />
                Recommendation data
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-accent" />
                Category signals
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-accent" />
                Source-backed book records
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-accent" />
                Open book pages for proof/context
              </span>
            </div>
            <div className="flex gap-3 pt-0.5 text-[11px] font-semibold text-accent">
              <Link href="/books" className="hover:underline">
                Browse all books
              </Link>
              <span className="text-muted/30 font-normal">|</span>
              <Link href="/people" className="hover:underline">
                Explore recommenders
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Related Lists */}
      {hasRelated && (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">Explore more lists</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {relatedLists.map((rl) => (
              <Link
                key={rl.id}
                href={`/lists/${rl.slug}`}
                className="p-3.5 rounded-xl border border-border bg-surface hover:border-accent/20 motion-card-hover"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-semibold text-ink">{displayListTitleFull(rl.title, rl.slug)}</p>
                  {rl.book_count > 0 && (
                    <span className="text-xs text-muted shrink-0">{rl.book_count} books</span>
                  )}
                </div>
                {rl.description && (
                  <p className="text-xs text-muted line-clamp-2">{rl.description}</p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* About list — methodology footer. Rewritten to be more transparent
          about WHAT data drives the list (recommendation signals, category
          memberships, public sources) and less generic. Deliberately
          avoids "expert-curated" / "hand-picked" framing because most
          lists are generated from category memberships, not human
          editorial. The previous copy was the same generic stub on every
          list and contributed to the "templated feel" the live-readiness
          audit flagged. */}
      <section className="rounded-2xl border border-border bg-surface p-5 md:p-7">
        <h2 className="text-lg font-bold text-ink mb-2 tracking-tight">About this list</h2>
        <p className="text-sm text-muted leading-relaxed">
          This list aggregates books that appear in public recommendation
          sources, reader-interest signals, and category data. Books are
          ranked by their position from the source list; recommendation
          counts and ratings are shown where available. Open any book to
          see source-backed recommendation proof, editorial context, and
          Amazon options — the per-book detail page is where the trust
          signals live.
        </p>
      </section>

      {/*
        Who recommended these books.

        A list is defined by the people behind it, and until now the page
        never named one — there were zero list-to-person links anywhere on
        the site. This is both the missing substance and the internal path
        to profiles that little else points at. Ordered by how much of THIS
        list each person accounts for.
      */}
      {listRecommenders.length > 0 && (
        <section className="mt-10 pt-8 border-t border-border">
          <h2 className="text-lg font-bold text-ink mb-1 tracking-tight">
            Who recommended these books
          </h2>
          <p className="text-sm text-muted mb-5">
            The people whose recommendations shaped this list.
          </p>
          <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {listRecommenders.map((r) => (
              <li key={r.slug}>
                <Link
                  href={`/people/${r.slug}`}
                  className="group flex items-center gap-3 rounded-xl border border-border bg-surface p-3 hover:border-accent/30 transition-colors"
                >
                  <Avatar
                    name={r.name}
                    slug={r.slug}
                    avatarUrl={r.avatar_url}
                    sizeClass="w-9 h-9"
                    textClass="text-xs"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink truncate group-hover:text-accent transition-colors">
                      {r.name}
                    </span>
                    <span className="block text-xs text-muted truncate">
                      {r.bookCount} {r.bookCount === 1 ? "book" : "books"} here
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Navigation back and discovery footer prompts */}
      <div className="flex justify-between items-center mt-10 pt-6 border-t border-border text-sm flex-wrap gap-3">
        <Link href="/lists" className="text-accent font-semibold hover:underline flex items-center gap-1">
          ← Back to Curated Book Lists
        </Link>
        <Link href="/books" className="text-accent font-semibold hover:underline flex items-center gap-1">
          Browse All Curated Books →
        </Link>
      </div>
    </div>
  );
}

