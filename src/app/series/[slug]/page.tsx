import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getSeriesBySlug, getBooksBySeries, getRelatedSeries } from "@/lib/data";
import { pageMetadata, robotsDirective } from "@/lib/seo";
import { displayTitle } from "@/lib/display";
import { seriesJsonLd } from "@/lib/jsonld";
import { BookCard, Breadcrumbs, EmptyState } from "@/components";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const series = await getSeriesBySlug(slug);
  if (!series) return { robots: "noindex, follow" };
  return pageMetadata({
    title: displayTitle(series.title),
    description: series.description || `A reading-order guide for ${displayTitle(series.title)}.`,
    path: `/series/${series.slug}`,
    robots: robotsDirective(series),
  });
}

const SERIES_PAGE_SIZE = 100;

export default async function SeriesDetailPage({ params }: Props) {
  const { slug } = await params;
  const series = await getSeriesBySlug(slug);
  if (!series) notFound();

  // Series pages showed 48 of a series that can run to 868 titles, while the
  // page's entire promise is "in order". A reading order truncated at 48 with
  // no indication answers the question wrongly rather than partially. Matches
  // the depth list pages now use; covers below the fold lazy-load.
  const [books, related] = await Promise.all([
    getBooksBySeries(series.id, SERIES_PAGE_SIZE),
    getRelatedSeries(series.id, 6),
  ]);

  const displayName = displayTitle(series.title);
  const hasBooks = books.length > 0;
  const hasDescription = series.description && series.description.length > 0;
  const hasRelated = related.length > 0;

  const jsonld = seriesJsonLd(series, books);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      {jsonld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonld) }} />}
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Series", href: "/series" }, { label: displayName }]} />

      <div className="mb-10">
        <div className="flex items-start gap-3 flex-wrap mb-3">
          <h1 className="text-2xl md:text-3xl font-bold text-ink tracking-tight">{displayName}</h1>
          {series.book_count > 0 && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-medium shrink-0 mt-1">
              {series.book_count} books
            </span>
          )}
        </div>
        {hasDescription ? (
          <p className="text-base text-muted max-w-2xl leading-relaxed">{series.description}</p>
        ) : (
          <p className="text-base text-muted max-w-2xl leading-relaxed">
            A reading-order guide for {displayName}, organized from available series metadata.
          </p>
        )}
      </div>

      {hasBooks ? (
        <>
          <div className="flex items-center gap-2 mb-5 text-xs text-muted">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            Reading order is based on available series metadata.
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5 mb-14">
            {books.map((book, i) => (
              <div key={book.id} className="relative">
                <span className="absolute top-2 left-2 z-10 px-1.5 h-5 rounded-full bg-accent text-white text-[10px] flex items-center justify-center font-bold shadow-sm">
                  #{i + 1}
                </span>
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
            ))}
          </div>
        </>
      ) : (
        <section className="mb-14">
          <EmptyState message="Books for this series are still being organized." />
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
        <h2 className="text-lg font-bold text-ink mb-2 tracking-tight">About this series</h2>
        <p className="text-sm text-muted leading-relaxed">
          {displayName} is organized from available series metadata. Books are shown in reading
          order based on their position in the series, starting from the first book. Recommendation
          counts and ratings are displayed where available so you can quickly spot the standout
          titles in the sequence.
        </p>
      </section>
    </div>
  );
}
