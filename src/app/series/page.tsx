import { Metadata } from "next";
import { getSeriesPaginated } from "@/lib/data";
import { pageMetadata } from "@/lib/seo";
import { SeriesCard, SearchBar, Breadcrumbs, EmptyState } from "@/components";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Book Series",
  description: "Explore complete book series in reading order.",
  path: "/series",
});

export default async function SeriesPage() {
  const { data: seriesList, total } = await getSeriesPaginated(1, 24);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Series" }]} />
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-ink mb-2 tracking-tight">Book Series</h1>
        <p className="text-base text-muted">Complete book series in reading order.</p>
      </div>
      <div className="mb-8">
        <SearchBar placeholder="Search series by title…" basePath="/series" />
      </div>
      <div className="flex items-center justify-between mb-6 text-sm">
        <span className="text-muted">{total} series</span>
        <select className="border border-border rounded-lg px-3 py-1.5 bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/20">
          <option>Most Books</option>
          <option>Title A-Z</option>
        </select>
      </div>
      {seriesList.length === 0 ? (
        <EmptyState message="No series found." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {seriesList.map((series) => (
            <SeriesCard key={series.id} title={series.title} slug={series.slug} description={series.description} bookCount={series.book_count} />
          ))}
        </div>
      )}
    </div>
  );
}
