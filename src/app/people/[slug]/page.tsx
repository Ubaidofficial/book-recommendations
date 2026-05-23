import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getPersonBySlug,
  getBooksByAuthor,
  getPersonRecommendedBooks,
  getPersonRecommendedCount,
  getPersonWrittenCount,
} from "@/lib/data";
import { pageMetadata, robotsDirective } from "@/lib/seo";
import { personJsonLd } from "@/lib/jsonld";
import { BookCard, Breadcrumbs, EmptyState } from "@/components";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const person = await getPersonBySlug(slug);
  if (!person) return { robots: "noindex, follow" };
  return pageMetadata({
    title: person.meta_title || `${person.name} — Books & Recommendations`,
    description: person.meta_description || person.bio,
    path: `/people/${person.slug}`,
    image: person.avatar_url,
    robots: robotsDirective(person),
  });
}

export default async function PersonDetailPage({ params }: Props) {
  const { slug } = await params;
  const person = await getPersonBySlug(slug);
  if (!person) notFound();

  const [writtenBooks, recommendedBooks, recommendedCount, writtenCount] = await Promise.all([
    getBooksByAuthor(person.id),
    getPersonRecommendedBooks(person.id, 4),
    getPersonRecommendedCount(person.id),
    getPersonWrittenCount(person.id),
  ]);

  const jsonld = personJsonLd(person);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      {jsonld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonld) }} />}
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "People", href: "/people" }, { label: person.name }]} />

      <div className="flex flex-col sm:flex-row items-start gap-6 mb-14">
        <div className="w-24 h-24 md:w-28 md:h-28 rounded-full bg-subtle overflow-hidden shrink-0 ring-3 ring-border">
          <img src={person.avatar_url} alt={person.name} className="w-full h-full object-cover" />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-ink mb-1 tracking-tight">{person.name}</h1>
          <p className="text-sm text-accent font-semibold mb-3">{person.role}</p>
          <p className="text-base text-muted max-w-2xl leading-relaxed">{person.bio}</p>
          <div className="flex flex-wrap gap-3 mt-4">
            <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-accent-light text-accent text-sm font-semibold">
              {recommendedCount} books recommended
            </span>
            <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-subtle text-ink text-sm font-medium">
              {writtenCount} books written
            </span>
          </div>
          {person.source_url && (
            <Link href={person.source_url} className="inline-block text-xs text-accent hover:underline mt-3">
              View source →
            </Link>
          )}
        </div>
      </div>

      {writtenBooks.length > 0 && (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">Books by {person.name}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
            {writtenBooks.map((book) => (
              <BookCard key={book.id} title={book.title} slug={book.slug} author={book.author} authorSlug={book.author_slug} coverUrl={book.cover_url} rating={book.rating} recommendationCount={book.recommendation_count} />
            ))}
          </div>
        </section>
      )}

      {recommendedBooks.length > 0 && (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">Books {person.name} Recommends</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
            {recommendedBooks.map((book) => (
              <BookCard key={book.id} title={book.title} slug={book.slug} author={book.author} authorSlug={book.author_slug} coverUrl={book.cover_url} rating={book.rating} recommendationCount={book.recommendation_count} />
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border bg-surface p-5 md:p-7">
        <h2 className="text-lg font-bold text-ink mb-2 tracking-tight">Source & Proof</h2>
        <p className="text-sm text-muted leading-relaxed">
          Recommendations attributed to {person.name} are sourced from interviews, articles, social media, and
          verifiable recommendation platforms. Each entry is linked to its original source for transparency.
        </p>
      </section>
    </div>
  );
}
