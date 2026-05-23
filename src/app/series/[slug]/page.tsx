import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSeriesBySlug, getBooksBySeries } from "@/lib/data";
import { pageMetadata, robotsDirective } from "@/lib/seo";
import { BookCard, Breadcrumbs, EmptyState } from "@/components";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const series = await getSeriesBySlug(slug);
  if (!series) return { robots: "noindex, follow" };
  return pageMetadata({
    title: series.title,
    description: series.description,
    path: `/series/${series.slug}`,
    robots: robotsDirective(series),
  });
}

export default async function SeriesDetailPage({ params }: Props) {
  const { slug } = await params;
  const series = await getSeriesBySlug(slug);
  if (!series) notFound();

  const books = await getBooksBySeries(series.id);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Series", href: "/series" }, { label: series.title }]} />
      <div className="mb-10">
        <div className="flex items-start gap-3 flex-wrap mb-3">
          <h1 className="text-2xl md:text-3xl font-bold text-ink tracking-tight">{series.title}</h1>
          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-medium shrink-0 mt-1">
            {series.book_count} books
          </span>
        </div>
        <p className="text-base text-muted max-w-2xl leading-relaxed">{series.description}</p>
      </div>
      {books.length === 0 ? (
        <EmptyState message="No books in this series yet." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
          {books.map((book, i) => (
            <div key={book.id} className="relative">
              <span className="absolute top-2 left-2 z-10 w-6 h-6 rounded-full bg-accent text-white text-xs flex items-center justify-center font-bold shadow-sm">
                {i + 1}
              </span>
              <BookCard title={book.title} slug={book.slug} author={book.author} authorSlug={book.author_slug} coverUrl={book.cover_url} rating={book.rating} recommendationCount={book.recommendation_count} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
