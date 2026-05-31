import { Metadata } from "next";
import { getSeriesPaginated, searchSeries } from "@/lib/data";
import { pageMetadata, canonicalUrl } from "@/lib/seo";
import { collectionPageJsonLd, breadcrumbListJsonLd } from "@/lib/jsonld";
import { SeriesCard, SearchBar, Breadcrumbs, EmptyState } from "@/components";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const hasParams = !!(sp.q && sp.q.trim());

  return pageMetadata({
    title: "Book Series in Order",
    description: "Explore book series and reading-order guides organized from available series data and recommendation signals.",
    path: "/series",
    robots: hasParams ? "noindex, follow" : "index, follow",
  });
}

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export default async function SeriesPage({ searchParams }: Props) {
  const { q } = await searchParams;

  let seriesResult;
  if (q && q.length >= 2) {
    const data = await searchSeries(q, 24);
    seriesResult = { data, total: data.length };
  } else {
    seriesResult = await getSeriesPaginated(1, 24);
  }

  const { data: seriesList, total } = seriesResult;

  const isSearching = q && q.length >= 2;
  const collectionJsonLd = !isSearching
    ? collectionPageJsonLd({
        name: "Book Series in Order | BookRecs",
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
        <h1 className="text-2xl md:text-3xl font-bold text-ink mb-2 tracking-tight">Book Series</h1>
        <p className="text-base text-muted">
          {q ? `Results for "${q}"` : "Complete book series in reading order."}
        </p>
      </div>
      <div className="mb-8">
        <SearchBar placeholder="Search series by title…" />
      </div>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {seriesList.map((series) => (
            <SeriesCard key={series.id} title={series.title} slug={series.slug} description={series.description} bookCount={series.book_count} />
          ))}
        </div>
      )}
      {total > 24 && !q && (
        <div className="flex items-center justify-center mt-10 gap-2">
          <span className="text-sm text-muted">Page 1 of {Math.ceil(total / 24)}</span>
          <span className="px-3 py-1.5 rounded-full bg-subtle border border-border text-xs text-muted">
            More coming soon
          </span>
        </div>
      )}
    </div>
  );
}
