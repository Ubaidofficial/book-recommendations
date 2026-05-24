import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getPersonBySlug,
  getBooksByAuthor,
  getPersonRecommendationProof,
  getPersonRecommendedCount,
  getPersonWrittenCount,
} from "@/lib/data";
import { pageMetadata, robotsDirective } from "@/lib/seo";
import { personJsonLd } from "@/lib/jsonld";
import { BookCard, Breadcrumbs } from "@/components";

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

  const [writtenBooks, recommendationProof, recommendedCount, writtenCount] = await Promise.all([
    getBooksByAuthor(person.id, 24),
    getPersonRecommendationProof(person.id, 24),
    getPersonRecommendedCount(person.id),
    getPersonWrittenCount(person.id),
  ]);

  const hasAvatar = person.avatar_url && /^https?:\/\//i.test(person.avatar_url);
  const jsonld = personJsonLd(person);
  const hasWritten = writtenBooks.length > 0;
  const hasRecommendations = recommendationProof.length > 0;
  const hasBio = person.bio && person.bio.length > 0;

  // Proof list — top 10 with source data
  const proofList = recommendationProof
    .filter((p) => p.source_url || p.source_name || p.quote)
    .slice(0, 10);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      {jsonld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonld) }} />}
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "People", href: "/people" }, { label: person.name }]} />

      <div className="flex flex-col sm:flex-row items-start gap-6 mb-14">
        <div className="w-24 h-24 md:w-28 md:h-28 rounded-full bg-subtle overflow-hidden shrink-0 ring-3 ring-border flex items-center justify-center">
          {hasAvatar ? (
            <img src={person.avatar_url} alt={person.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl font-bold text-muted/40">{person.name.charAt(0)}</span>
          )}
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-ink mb-1 tracking-tight">{person.name}</h1>
          <p className="text-sm text-accent font-semibold mb-3">{person.role}</p>
          {hasBio && <p className="text-base text-muted max-w-2xl leading-relaxed mb-3">{person.bio}</p>}
          <div className="flex flex-wrap gap-3">
            {recommendedCount > 0 && (
              <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-accent-light text-accent text-sm font-semibold">
                {recommendedCount} books recommended
              </span>
            )}
            {writtenCount > 0 && (
              <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-subtle text-ink text-sm font-medium">
                {writtenCount} books written
              </span>
            )}
          </div>
          {person.source_url && (
            <Link
              href={person.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline mt-3"
            >
              Profile source →
            </Link>
          )}
        </div>
      </div>

      {/* Recommended Books */}
      {hasRecommendations ? (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">Books {person.name} Recommends</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
            {recommendationProof.map((p, i) => (
              <BookCard
                key={`${p.book.id}-${i}`}
                title={p.book.title}
                slug={p.book.slug}
                author={p.book.author}
                authorSlug={p.book.author_slug}
                coverUrl={p.book.cover_url}
                rating={p.book.rating}
                recommendationCount={p.book.recommendation_count}
              />
            ))}
          </div>
        </section>
      ) : (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">Books {person.name} Recommends</h2>
          <div className="rounded-xl border border-border bg-surface p-6 text-center">
            <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-subtle flex items-center justify-center">
              <svg className="w-5 h-5 text-muted/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <p className="text-sm text-muted">No verified recommendation data available yet.</p>
          </div>
        </section>
      )}

      {/* Books Written */}
      {hasWritten && (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">Books by {person.name}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
            {writtenBooks.map((book) => (
              <BookCard
                key={book.id}
                title={book.title}
                slug={book.slug}
                author={book.author}
                authorSlug={book.author_slug}
                coverUrl={book.cover_url}
                rating={book.rating}
                recommendationCount={book.recommendation_count}
              />
            ))}
          </div>
        </section>
      )}

      {/* Source & Proof */}
      <section className="mb-14">
        <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">Source & Proof</h2>
        {proofList.length > 0 ? (
          <div className="space-y-2">
            {proofList.map((p, i) => (
              <div
                key={`proof-${i}`}
                className="rounded-xl border border-border bg-surface p-3.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
              >
                <Link
                  href={`/books/${p.book.slug}`}
                  className="text-sm font-semibold text-ink hover:text-accent transition-colors shrink-0"
                >
                  {p.book.title}
                </Link>
                {p.quote && (
                  <span className="text-xs text-muted italic line-clamp-2 flex-1">
                    &ldquo;{p.quote}&rdquo;
                  </span>
                )}
                <div className="flex items-center gap-3 shrink-0">
                  {p.source_url ? (
                    <a
                      href={p.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent hover:underline font-medium"
                    >
                      View source →
                    </a>
                  ) : p.source_name ? (
                    <span className="text-xs text-muted">{p.source_name}</span>
                  ) : null}
                  {p.confidence_score != null && p.confidence_score > 0 && (
                    <span className="text-xs text-muted/40 tabular-nums">
                      {typeof p.confidence_score === "number"
                        ? p.confidence_score >= 1
                          ? Math.round(p.confidence_score * 100) + "%"
                          : (p.confidence_score * 100).toFixed(0) + "%"
                        : ""}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : recommendationProof.length > 0 ? (
          // Recommendations exist but no source data in any of them
          <div className="rounded-xl border border-border bg-surface p-6 text-center">
            <p className="text-sm text-muted">
              {person.name} has {recommendationProof.length} recommendations, but source proof is not yet available.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface p-6 text-center">
            <p className="text-sm text-muted">
              Recommendations attributed to {person.name} are sourced from interviews, articles, and verifiable
              recommendation platforms. Proof data is added as sources are verified.
            </p>
          </div>
        )}
      </section>

      {/* Notability */}
      <section className="rounded-2xl border border-border bg-surface p-5 md:p-7">
        <h2 className="text-lg font-bold text-ink mb-2 tracking-tight">About this profile</h2>
        <p className="text-sm text-muted leading-relaxed">
          {person.name} is tracked across {recommendationProof.length} book recommendations and {writtenBooks.length} authored
          books. Detail pages are kept noindex until they meet our quality bar — complete metadata, verified
          data, and sufficient recommendation proof. This keeps search results useful.
        </p>
      </section>
    </div>
  );
}
