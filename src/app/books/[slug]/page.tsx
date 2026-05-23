import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getBookBySlug,
  getBooksByAuthor,
  getBooksBySeries,
  getRelatedBooks,
  getRecommendersForBook,
  getListsForBook,
  getPersonIdBySlug,
  getSeriesIdBySlug,
} from "@/lib/data";
import { pageMetadata, robotsDirective } from "@/lib/seo";
import { bookJsonLd } from "@/lib/jsonld";
import { BookCard, Breadcrumbs, EmptyState } from "@/components";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const book = await getBookBySlug(slug);
  if (!book) return { robots: "noindex, follow" };
  return pageMetadata({
    title: book.meta_title || `${book.title} by ${book.author}`,
    description: book.meta_description || book.description,
    path: `/books/${book.slug}`,
    image: book.cover_url,
    type: "book",
    robots: robotsDirective(book),
  });
}

export default async function BookDetailPage({ params }: Props) {
  const { slug } = await params;
  const book = await getBookBySlug(slug);
  if (!book) notFound();

  const personId = await getPersonIdBySlug(book.author_slug);
  const seriesId = book.series_slug ? await getSeriesIdBySlug(book.series_slug) : null;

  const [authorBooks, seriesBooks, relatedBooks, recommenders, lists] = await Promise.all([
    personId ? getBooksByAuthor(personId) : Promise.resolve([]),
    seriesId ? getBooksBySeries(seriesId) : Promise.resolve([]),
    getRelatedBooks(book.id, 4),
    getRecommendersForBook(book.id, 10),
    getListsForBook(book.id, 5),
  ]);

  const jsonld = bookJsonLd(book);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      {jsonld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonld) }} />}
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Books", href: "/books" }, { label: book.title }]} />

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 md:gap-10 mb-14">
        <div className="max-w-[220px] mx-auto md:max-w-full">
          <div className="rounded-2xl overflow-hidden shadow-md bg-subtle aspect-[2/3]">
            <img src={book.cover_url} alt={book.title} className="w-full h-full object-cover" />
          </div>
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-semibold">
              ★ {book.rating}
            </span>
            <span className="text-sm text-muted">{book.recommendation_count.toLocaleString()} recommendations</span>
          </div>
          <h1 className="text-2xl md:text-4xl font-bold text-ink mb-2 tracking-tight">{book.title}</h1>
          {book.subtitle && <p className="text-base text-muted mb-3">{book.subtitle}</p>}
          <p className="text-base text-muted mb-5">
            by{" "}
            <Link href={`/people/${book.author_slug}`} className="text-accent font-semibold hover:underline">
              {book.author}
            </Link>
          </p>
          {book.series && book.series_slug && (
            <Link
              href={`/series/${book.series_slug}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-subtle text-sm text-ink hover:bg-accent-light transition-colors mb-5"
            >
              <svg className="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              Part of <span className="font-medium">{book.series}</span>
            </Link>
          )}
          <div className="prose prose-base text-muted max-w-none leading-relaxed">
            <p>{book.description}</p>
          </div>
        </div>
      </div>

      {recommenders.length > 0 && (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">Recommended By</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recommenders.map((person) => (
              <Link
                key={person.id}
                href={`/people/${person.slug}`}
                className="flex items-center gap-3 p-3.5 rounded-xl border border-border bg-surface hover:shadow-md hover:border-accent/20 transition-all"
              >
                <div className="w-11 h-11 rounded-full bg-subtle overflow-hidden shrink-0 ring-1 ring-border">
                  <img src={person.avatar_url} alt={person.name} className="w-full h-full object-cover" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{person.name}</p>
                  <p className="text-xs text-muted">{person.role}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {lists.length > 0 && (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">Appears In</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {lists.map((list) => (
              <Link
                key={list.id}
                href={`/lists/${list.slug}`}
                className="p-3.5 rounded-xl border border-border bg-surface hover:shadow-md hover:border-accent/20 transition-all"
              >
                <p className="text-sm font-semibold text-ink mb-1">{list.title}</p>
                <p className="text-xs text-muted">{list.book_count} books</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {seriesBooks.filter((b) => b.id !== book.id).length > 0 && (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">More from this series</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
            {seriesBooks.filter((b) => b.id !== book.id).map((b) => (
              <BookCard key={b.id} title={b.title} slug={b.slug} author={b.author} authorSlug={b.author_slug} coverUrl={b.cover_url} rating={b.rating} recommendationCount={b.recommendation_count} />
            ))}
          </div>
        </section>
      )}

      {authorBooks.filter((b) => b.id !== book.id).length > 0 && (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">Also by {book.author}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
            {authorBooks.filter((b) => b.id !== book.id).map((b) => (
              <BookCard key={b.id} title={b.title} slug={b.slug} author={b.author} authorSlug={b.author_slug} coverUrl={b.cover_url} rating={b.rating} recommendationCount={b.recommendation_count} />
            ))}
          </div>
        </section>
      )}

      {relatedBooks.length > 0 && (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">Similar Books</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 md:gap-5">
            {relatedBooks.map((b) => (
              <BookCard key={b.id} title={b.title} slug={b.slug} author={b.author} authorSlug={b.author_slug} coverUrl={b.cover_url} rating={b.rating} recommendationCount={b.recommendation_count} />
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border bg-surface p-5 md:p-7">
        <h2 className="text-lg font-bold text-ink mb-2 tracking-tight">How This Book Is Recommended</h2>
        <p className="text-sm text-muted leading-relaxed">
          Book recommendations are collected from public sources including interviews, articles, and curated lists.
          Each recommendation is backed by a verifiable source. Books with many recommendations from respected
          people rank higher, helping you discover genuinely worthwhile reads backed by real endorsements.
        </p>
      </section>
    </div>
  );
}
