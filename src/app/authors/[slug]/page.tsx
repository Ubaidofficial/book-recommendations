import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBooksByAuthorSlug } from "@/lib/data";
import { pageMetadata } from "@/lib/seo";
import { BookCard, Breadcrumbs } from "@/components";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await getBooksByAuthorSlug(slug);
  if (!data) return { robots: "noindex, follow" };

  return pageMetadata({
    title: `Books by ${data.authorName} — Author Catalog`,
    description: `Explore the complete catalog of books written by ${data.authorName}, ranked by recommendation signals.`,
    path: `/authors/${slug}`,
    robots: "noindex, follow", // noindex, follow as requested
  });
}

export default async function AuthorDetailPage({ params }: Props) {
  const { slug } = await params;
  const data = await getBooksByAuthorSlug(slug);
  if (!data) notFound();

  const { authorName, books } = data;
  const totalRecs = books.reduce((sum, b) => sum + (b.recommendation_count || 0), 0);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: authorName },
        ]}
      />

      <div className="mb-10">
        <h1 className="text-2xl md:text-3xl font-bold text-ink tracking-tight mb-2">
          Books by {authorName}
        </h1>
        
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted mb-4">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-accent-light text-accent font-medium">
            {books.length} {books.length === 1 ? "book" : "books"}
          </span>
          {totalRecs > 0 && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-subtle text-muted">
              {totalRecs.toLocaleString()} total recommendations
            </span>
          )}
        </div>

        <p className="text-base text-muted max-w-2xl leading-relaxed mb-3">
          Browse books by {authorName}, ranked by recommendation signals from our public-source dataset.
        </p>
        
        <p className="text-xs text-muted max-w-2xl bg-subtle/50 border border-border/40 rounded-xl p-3 inline-block leading-normal">
          <strong>Note:</strong> Author pages show books written by this author. Recommender pages live separately under{" "}
          <a href="/people" className="text-accent hover:underline font-medium">
            People
          </a>.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5 mb-14">
        {books.map((book) => (
          <BookCard
            key={book.id}
            title={book.title}
            slug={book.slug}
            author={book.author}
            authorSlug={book.author_slug}
            coverUrl={book.cover_image_url}
            rating={book.rating}
            recommendationCount={book.recommendation_count}
            amazonUrl={book.amazon_url}
          />
        ))}
      </div>
    </div>
  );
}
