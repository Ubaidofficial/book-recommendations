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
        <p className="text-base text-muted max-w-2xl leading-relaxed">
          Explore books written by {authorName}, structured by community recommendations and quality filters.
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
          />
        ))}
      </div>
    </div>
  );
}
