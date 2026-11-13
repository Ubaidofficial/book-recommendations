import { Metadata } from "next";
import Link from "next/link";
import { getSeriesPaginatedCached, searchSeries, getRecentlyPublishedSeriesCached } from "@/lib/data";
import { pageMetadata, canonicalUrl } from "@/lib/seo";
import { collectionPageJsonLd, breadcrumbListJsonLd } from "@/lib/jsonld";
import { SeriesCard, SearchBar, Breadcrumbs, EmptyState, NewlyPublished } from "@/components";

export const dynamic = "force-dynamic";

// Published series per page. The index lists every published series so each
// has a crawlable inbound link; at 100 per page this is one page today and
// paginates (self-canonical, crawlable) as the daily releases accumulate.
const PAGE_SIZE = 100;

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const hasParams = !!(sp.q && sp.q.trim());
  const pageParam = parseInt(sp.page || "0", 10);

  if (!hasParams && Number.isFinite(pageParam) && pageParam > 1) {
    return pageMetadata({
      title: `Book Series in Order — Page ${pageParam}`,
      description: `Page ${pageParam} of every book series on BookMentions, ordered by how many books each series has.`,
      path: `/series?page=${pageParam}`,
      robots: "index, follow",
    });
  }

  return pageMetadata({
    title: "Book Series in Order",
    description: "Explore book series and reading-order guides organized from available series data and recommendation signals.",
    path: "/series",
    robots: hasParams ? "noindex, follow" : "index, follow",
  });
}

interface Props {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export default async function SeriesPage({ searchParams }: Props) {
  const { q, page: pageParam } = await searchParams;
  const parsedPage = parseInt(pageParam || "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  let seriesResult;
  if (q && q.length >= 2) {
    const data = await searchSeries(q, 24);
    seriesResult = { data, total: data.length };
  } else {
    seriesResult = await getSeriesPaginatedCached(page, PAGE_SIZE);
  }

  const { data: seriesList, total } = seriesResult;
  // Only on the first, unfiltered page: the block is a crawl path to new releases.
  const recentSeries = !q && page === 1 ? await getRecentlyPublishedSeriesCached(10) : [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const prevHref = page > 1 ? (page === 2 ? "/series" : `/series?page=${page - 1}`) : "";
  const nextHref = page < totalPages ? `/series?page=${page + 1}` : "";

  const isSearching = q && q.length >= 2;
  const collectionJsonLd = !isSearching
    ? collectionPageJsonLd({
        name: "Book Series in Order | BookMentions",
        description: "Explore book series and reading-order guides organized from available series data and recommendation signals.",
        url: canonicalUrl("/series"),
        items: seriesList.map((s) => ({
          name: s.title,
          url: canonicalUrl(`/series/${s.slug}`),
        })),
      })
    : null;

  const breadcrumbJsonLd = !isSearching
    ? breadcrumbListJsonLd([
        { name: "Home", path: "/" },
        { name: "Series", path: "/series" },
      ])
    : null;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      {collectionJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
        />
      )}
      {breadcrumbJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
        />
      )}
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Series" }]} />
      <div className="mb-8">
        <h1 className="type-h1 text-ink mb-2">Book Series</h1>
        <p className="text-base text-muted">
          {q ? `Results for "${q}"` : "Complete book series in reading order."}
        </p>
      </div>
      <div className="mb-8">
        <SearchBar placeholder="Search series by title…" />
      </div>
      <NewlyPublished series={recentSeries} className="mb-10" />
      <div className="flex items-center justify-between mb-6 text-sm">
        <span className="text-muted">{total} series</span>
        <select className="border border-border rounded-lg px-3 py-1.5 bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/20">
          <option>Most Books</option>
          <option>Title A-Z</option>
        </select>
      </div>
      {seriesList.length === 0 ? (
        <EmptyState message={q ? `No series match "${q}".` : "No series found."} />
      ) : (
        <div data-reveal-stagger className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {seriesList.map((series) => (
            <SeriesCard key={series.id} title={series.title} slug={series.slug} description={series.description} bookCount={series.book_count} />
          ))}
        </div>
      )}
      {totalPages > 1 && !q && (
        <div className="flex items-center justify-center mt-10 gap-3">
          {prevHref ? (
            <Link href={prevHref} className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-ink hover:bg-accent-light">← Previous</Link>
          ) : null}
          <span className="text-sm text-muted">Page {page} of {totalPages}</span>
          {nextHref ? (
            <Link href={nextHref} className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-ink hover:bg-accent-light">Next →</Link>
          ) : null}
        </div>
      )}
    </div>
  );
}
