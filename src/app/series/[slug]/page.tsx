import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getSeriesBySlugCached, getBooksBySeriesOrderedCached, getRelatedSeries, seriesHasPositionsCached } from "@/lib/data";
import { pageMetadata, robotsDirective } from "@/lib/seo";
import { displayTitle } from "@/lib/display";
import { seriesJsonLd, faqPageJsonLd } from "@/lib/jsonld";
import { orderSeriesBooks, seriesBaseName, seriesFaq, seriesPageTitle } from "@/lib/seriesOrder";
import { BookCard, Breadcrumbs, EmptyState } from "@/components";

// ISR, matching books/[slug] and people/[slug] — this page reads only
// `params`, never searchParams/cookies/headers, so it's eligible for the
// same cached-HTML-plus-background-regeneration treatment.
export const revalidate = 300;

interface Props {
  params: Promise<{ slug: string }>;
}

// Publication order has to be computed over the whole series, not the first
// page of it: sorting 100 arbitrary rows of an 868-book catalog by year would
// still answer "what is the first book?" wrongly.
const SERIES_FETCH_LIMIT = 1000;
// Series pages showed 48 of a series that can run to 868 titles, while the
// page's entire promise is "in order". Covers below the fold lazy-load.
const SERIES_PAGE_SIZE = 200;

async function loadSeriesView(seriesId: string) {
  const [rawBooks, hasPositions] = await Promise.all([
    getBooksBySeriesOrderedCached(seriesId, SERIES_FETCH_LIMIT),
    seriesHasPositionsCached(seriesId),
  ]);
  return orderSeriesBooks(rawBooks, hasPositions);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const series = await getSeriesBySlugCached(slug);
  if (!series) return { robots: "noindex, follow" };
  const base = seriesBaseName(series.title);
  // "<author> books in order" queries are where these pages rank (and where
  // mostrecommendedbooks.com gets most of its traffic), so the title carries
  // that wording — but ONLY when the page holds a real order: verified
  // positions, or verified first-publication years for most of the books.
  const { order, books } = await loadSeriesView(series.id);
  const total = Math.max(series.book_count, books.length);
  const count = total > 0 ? `all ${total.toLocaleString()} books` : "every book";
  const first = order === "publication" ? books[0] : undefined;
  return pageMetadata({
    title: seriesPageTitle(base, order),
    description:
      series.description ||
      (order === "publication"
        ? `${base} books in order of publication: ${count}${first ? `, starting with ${first.title} (${first.first_published_year})` : ""}, with the most recommended titles marked.`
        : order === "position"
          ? `${base} in reading order: ${count} from first to last, with recommendation counts so you can see which titles readers rate highest.`
          : `${base}: ${count} we track, with recommendation counts so you can see which titles readers rate highest.`),
    path: `/series/${series.slug}`,
    robots: robotsDirective(series),
  });
}

export default async function SeriesDetailPage({ params }: Props) {
  const { slug } = await params;
  const series = await getSeriesBySlugCached(slug);
  if (!series) notFound();

  const [{ order, books: orderedBooks, undatedCount }, related] = await Promise.all([
    loadSeriesView(series.id),
    getRelatedSeries(series.id, 6),
  ]);

  const base = seriesBaseName(series.title);
  const heading = seriesPageTitle(base, order);
  const books = orderedBooks.slice(0, SERIES_PAGE_SIZE);
  const total = Math.max(series.book_count, orderedBooks.length);
  const hasBooks = books.length > 0;
  const hasDescription = series.description && series.description.length > 0;
  const hasRelated = related.length > 0;
  const faq = seriesFaq(base, order, orderedBooks, total);

  const jsonld = seriesJsonLd(series, books, heading);
  const faqJsonLd = faqPageJsonLd(faq);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      {jsonld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonld) }} />}
      {faqJsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />}
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Series", href: "/series" }, { label: heading }]} />

      <div className="mb-10">
        <div className="flex items-start gap-3 flex-wrap mb-3">
          <h1 className="text-2xl md:text-3xl font-bold text-ink tracking-tight">{heading}</h1>
          {total > 0 && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-medium shrink-0 mt-1">
              {/* Same honesty rule as list pages: when the page cannot show
                  the whole series, say how many of how many. A reading order
                  silently cut at 200 of 868 answers the question wrongly. */}
              {total > books.length
                ? `${books.length} of ${total.toLocaleString()} books`
                : `${total} books`}
            </span>
          )}
        </div>
        {hasDescription ? (
          <p className="text-base text-muted max-w-2xl leading-relaxed">{series.description}</p>
        ) : (
          <p className="text-base text-muted max-w-2xl leading-relaxed">
            {order === "publication"
              ? `Every ${base} book we track, in order of first publication${books[0] ? `, from ${books[0].title}` : ""}. Recommendation counts show which ones the people we track rate highest.`
              : order === "position"
                ? `A reading-order guide for ${base}, organized from available series metadata.`
                : `The ${base} books we track.`}
          </p>
        )}
      </div>

      {hasBooks ? (
        <>
          <h2 className="text-xl font-bold text-ink mb-1 tracking-tight">
            {order === "publication"
              ? `${base} books in publication order`
              : order === "position"
                ? `${base} in order`
                : "Books in this series"}
          </h2>
          <div className="flex items-center gap-2 mb-5 text-xs text-muted">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            {order === "publication"
              ? undatedCount > 0
                ? `Ordered by first publication year (from Open Library). ${undatedCount} ${undatedCount === 1 ? "title has" : "titles have"} no verified year yet and ${undatedCount === 1 ? "is" : "are"} listed last.`
                : "Ordered by first publication year (from Open Library)."
              : order === "none"
                ? "We don’t have verified publication years or reading-order positions for this series yet, so these books are not numbered."
                : books.some((b) => b.series_position == null)
                  ? "Numbered titles are in series order. Unnumbered titles have no verified position yet and are listed last."
                  : "Reading order is based on available series metadata."}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5 mb-14">
            {books.map((book) => {
              // Badge shows verified data only — a real position, or a real
              // first-publication year — never the array index.
              const badge =
                order === "position" && book.series_position != null
                  ? `#${book.series_position}`
                  : order === "publication" && book.first_published_year
                    ? String(book.first_published_year)
                    : null;
              return (
                <div key={book.id} className="relative">
                  {badge && (
                    <span className="absolute top-2 left-2 z-10 px-1.5 h-5 rounded-full bg-accent text-white text-[10px] flex items-center justify-center font-bold shadow-sm">
                      {badge}
                    </span>
                  )}
                  <BookCard
                    title={book.title}
                    slug={book.slug}
                    author={book.author}
                    authorSlug={book.author_slug}
                    coverUrl={book.cover_image_url}
                    rating={book.rating}
                    recommendationCount={book.recommendation_count}
                    amazonUrl={book.amazon_url}
                  />
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <section className="mb-14">
          <EmptyState message="Books for this series are still being organized." />
        </section>
      )}

      {faq.length > 0 && (
        <section className="mb-14" aria-labelledby="faq">
          <h2 id="faq" className="text-lg font-bold text-ink mb-4 tracking-tight">{base} books: common questions</h2>
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

      {/* Related Series */}
      {hasRelated && (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">Explore more series</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {related.map((rs) => (
              <Link
                key={rs.id}
                href={`/series/${rs.slug}`}
                className="p-3.5 rounded-xl border border-border bg-surface hover:shadow-md hover:border-accent/20 transition-all"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-semibold text-ink">{displayTitle(rs.title)}</p>
                  {rs.book_count > 0 && (
                    <span className="text-xs text-muted shrink-0">{rs.book_count} books</span>
                  )}
                </div>
                {rs.description && (
                  <p className="text-xs text-muted line-clamp-2">{rs.description}</p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* About this series */}
      <section className="rounded-2xl border border-border bg-surface p-5 md:p-7">
        <h2 className="text-lg font-bold text-ink mb-2 tracking-tight">About this page</h2>
        <p className="text-sm text-muted leading-relaxed">
          {order === "publication"
            ? `Books are listed by the year each was first published, taken from Open Library's record for the original work rather than a later edition. Recommendation counts come from the public interviews, articles and reading lists BookMentions tracks, so you can spot the standout ${base} books.`
            : order === "position"
              ? `${base} is organized from available series metadata. Books are shown in reading order based on their position in the series, starting from the first book. Recommendation counts and ratings are displayed where available so you can quickly spot the standout titles in the sequence.`
              : `${base} is compiled from available series metadata. We don’t yet hold verified publication years or reading-order positions for these titles, so they are not numbered or presented as a sequence. Recommendation counts and ratings are shown where available so you can spot the standout titles.`}
        </p>
      </section>
    </div>
  );
}
