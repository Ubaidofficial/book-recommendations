import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getBookBySlug,
  getBooksByAuthor,
  getBooksBySeries,
  getRecommendationProof,
  getListsForBook,
  getPersonIdBySlug,
  getSeriesIdBySlug,
  type Book,
  type RecommendationProof,
} from "@/lib/data";
import { pageMetadata, robotsDirective } from "@/lib/seo";
import { bookJsonLd } from "@/lib/jsonld";
import { displayTitle, displayListTitle, listKindFromSlug } from "@/lib/display";
import {
  isValidHttpUrl,
  isValidRating,
  formatRating,
  formatConfidence,
  isUsefulDescription,
  cleanDescription,
  uniqueByNormalizedText,
  parseSourceUrls,
} from "@/lib/dataQuality";
import { BookCard, Breadcrumbs, SafeImage } from "@/components";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const book = await getBookBySlug(slug);
  if (!book) return { robots: "noindex, follow" };
  const desc = isUsefulDescription(book.meta_description)
    ? book.meta_description
    : isUsefulDescription(book.description)
      ? book.description
      : undefined;
  return pageMetadata({
    title: book.meta_title || (book.author ? `${book.title} by ${book.author}` : book.title),
    description: desc || "",
    path: `/books/${book.slug}`,
    image: isValidHttpUrl(book.cover_image_url) ? book.cover_image_url : undefined,
    type: "book",
    robots: robotsDirective(book),
  });
}

export default async function BookDetailPage({ params }: Props) {
  const { slug } = await params;
  const book = await getBookBySlug(slug);
  if (!book) notFound();

  const personId = book.author_slug ? await getPersonIdBySlug(book.author_slug) : null;
  const seriesId = book.series_slug ? await getSeriesIdBySlug(book.series_slug) : null;

  let authorBooks: Awaited<ReturnType<typeof getBooksByAuthor>> = [];
  let seriesBooks: Awaited<ReturnType<typeof getBooksBySeries>> = [];
  let rawProof: Awaited<ReturnType<typeof getRecommendationProof>> = [];
  let lists: Awaited<ReturnType<typeof getListsForBook>> = [];

  try {
    [authorBooks, seriesBooks, rawProof, lists] = await Promise.all([
      personId ? getBooksByAuthor(personId, 6) : Promise.resolve([]),
      seriesId ? getBooksBySeries(seriesId, 6) : Promise.resolve([]),
      getRecommendationProof(book.id, 6),
      getListsForBook(book.id, 8),
    ]);
  } catch (e) {
    console.error("[book-detail] Relation queries failed:", e);
  }

  // Sanitize junction data — filter out nulls from failed foreign-key joins
  const safeSeriesBooks = seriesBooks.filter((b: Book | null | undefined) => b != null && b.id);
  const safeAuthorBooks = authorBooks.filter((b: Book | null | undefined) => b != null && b.id);
  const safeProof = rawProof.filter((p: RecommendationProof | null | undefined) => p != null && p.person != null && p.person.id);

  // Deduplicate quotes
  const proof = uniqueByNormalizedText(safeProof, "quote");

  // Determine proof quality
  const hasProof = proof.length > 0;
  const proofWithSource = proof.filter((p) => isValidHttpUrl(p.source_url));
  const showVerifiedBadge = proofWithSource.length >= 2;
  // Conservative labels until DB source quality is audited
  const proofHeading = "Recommendation Signals";
  const bottomBoxTitle = "How recommendation signals are reviewed";

  const hasCover = isValidHttpUrl(book.cover_image_url);
  const showRating = isValidRating(book.rating);
  const showDescription = isUsefulDescription(book.description);
  const descriptionText = showDescription
    ? cleanDescription(book.description)
    : "Description is being reviewed for this book.";

  // Author line
  const hasAuthor = book.author && book.author.trim().length > 0;

  const hasLists = lists.length > 0;
  const hasSeries = book.series && book.series_slug;

  // Consolidate similar books
  const similarIds = new Set<string>();
  const similarBooks = [...safeSeriesBooks, ...safeAuthorBooks]
    .filter((b) => b.id !== book.id && !similarIds.has(b.id) && (similarIds.add(b.id), true))
    .slice(0, 6);

  const jsonld = bookJsonLd(book);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      {jsonld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonld) }} />}
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Books", href: "/books" }, { label: book.title }]} />

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-8 md:gap-10 mb-14">
        <div className="max-w-[180px] mx-auto md:max-w-full">
          <div className="rounded-2xl overflow-hidden shadow-md bg-subtle aspect-[2/3]">
            {hasCover ? (
              <SafeImage
                src={book.cover_image_url}
                alt={book.title}
                className="w-full h-full object-cover"
                fallback={
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-accent/5 to-accent/10 p-4">
                    <span className="text-lg font-bold text-accent/50 text-center leading-tight mb-2">
                      {book.title}
                    </span>
                    <svg className="w-6 h-6 text-accent/25 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                }
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-accent/5 to-accent/10 p-4">
                <span className="text-lg font-bold text-accent/50 text-center leading-tight mb-2">
                  {book.title}
                </span>
                <svg className="w-6 h-6 text-accent/25 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {showRating && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-semibold">
                ★ {formatRating(book.rating)}
              </span>
            )}
            {book.recommendation_count > 0 && (
              <span className="text-sm text-muted">{book.recommendation_count.toLocaleString()} recommendations</span>
            )}
            {showVerifiedBadge && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-subtle border border-border text-xs text-muted font-medium">
                <svg className="w-3 h-3 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Verified
              </span>
            )}
          </div>

          <h1 className="text-2xl md:text-4xl font-bold text-ink mb-2 tracking-tight">{book.title}</h1>
          {book.subtitle && <p className="text-base text-muted mb-2">{book.subtitle}</p>}

          {hasAuthor && (
            <p className="text-base text-muted mb-4">
              by{" "}
              <Link href={`/people/${book.author_slug}`} className="text-accent font-semibold hover:underline">
                {book.author}
              </Link>
            </p>
          )}

          {hasSeries && (
            <Link
              href={`/series/${book.series_slug}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-subtle text-sm text-ink hover:bg-accent-light transition-colors mb-4"
            >
              <svg className="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              Part of <span className="font-medium">{displayTitle(book.series)}</span>
            </Link>
          )}

          <div className="prose prose-base text-muted max-w-none leading-relaxed">
            <p>{descriptionText}</p>
          </div>
        </div>
      </div>

      {/* Recommendation Proof / Signals */}
      <section className="mb-14">
        <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">{proofHeading}</h2>
        {hasProof ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {proof.map((p, i) => {
              const sourceUrls = parseSourceUrls(p.source_url);
              const hasSource = sourceUrls.length > 0;
              const hasQuote = p.quote && p.quote.trim().length >= 50;
              const conf = formatConfidence(p.confidence_score);

              return (
                <div
                  key={`${p.person.id}-${i}`}
                  className="rounded-xl border border-border bg-surface p-4"
                >
                  <Link
                    href={`/people/${p.person.slug}`}
                    className="flex items-center gap-3 mb-3 hover:opacity-80 transition-opacity"
                  >
                    <div className="w-10 h-10 rounded-full bg-subtle overflow-hidden shrink-0 ring-1 ring-border flex items-center justify-center">
                      {isValidHttpUrl(p.person.avatar_url) ? (
                        <img src={p.person.avatar_url} alt={p.person.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-sm font-bold text-muted/40">{p.person.name.charAt(0)}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{p.person.name}</p>
                      <p className="text-xs text-muted">{p.person.role}</p>
                    </div>
                  </Link>

                  {hasQuote ? (
                    <blockquote className="text-sm text-muted italic border-l-2 border-accent/20 pl-3 mb-2 line-clamp-3">
                      &ldquo;{p.quote}&rdquo;
                    </blockquote>
                  ) : (
                    <p className="text-xs text-muted/50">Recommended this book</p>
                  )}

                  <div className="flex items-center justify-between gap-2 text-xs mt-2">
                    {hasSource ? (
                      sourceUrls.length === 1 ? (
                        <a
                          href={sourceUrls[0]}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline font-medium"
                        >
                          View source →
                        </a>
                      ) : (
                        <details className="relative group/srcs">
                          <summary className="list-none cursor-pointer text-accent hover:underline font-medium select-none [&::-webkit-details-marker]:hidden">
                            View sources ({sourceUrls.length}) ▾
                          </summary>
                          <div className="absolute left-0 top-full mt-1 z-20 w-72 max-w-[80vw] rounded-lg border border-border bg-surface shadow-lg p-2 space-y-1">
                            {sourceUrls.map((u, j) => {
                              let host = u;
                              try { host = new URL(u).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
                              return (
                                <a
                                  key={j}
                                  href={u}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block text-xs text-accent hover:underline truncate"
                                  title={u}
                                >
                                  {j + 1}. {host}
                                </a>
                              );
                            })}
                          </div>
                        </details>
                      )
                    ) : p.source_name ? (
                      <span className="text-muted">{p.source_name}</span>
                    ) : null}
                    {conf && (
                      <span className="text-muted/40 tabular-nums">{conf}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface p-6 text-center">
            <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-subtle flex items-center justify-center">
              <svg className="w-5 h-5 text-muted/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
              </svg>
            </div>
            <p className="text-sm text-muted">No verified recommendation proof available yet.</p>
          </div>
        )}
      </section>

      {/* Appears in Lists — topic lists first; broad parents hidden when 6+ specific lists exist */}
      {hasLists && (() => {
        const enriched = lists.map((l) => ({ l, kind: listKindFromSlug(l.slug) }));
        const specific = enriched.filter((x) => x.kind === "topic" || x.kind === "meta" || x.kind === "other");
        const broad = enriched.filter((x) => x.kind === "category");
        // sort topic before meta (already pre-ranked by getListsForBook, but enforce here too)
        const tierRank = (k: ReturnType<typeof listKindFromSlug>) => k === "topic" ? 1 : k === "other" ? 2 : k === "meta" ? 3 : 4;
        const ordered = [...enriched].sort((a, b) => tierRank(a.kind) - tierRank(b.kind));
        const showBroad = specific.length < 6;
        const finalList = showBroad ? ordered : ordered.filter((x) => x.kind !== "category");
        const tierBadgeStyle: Record<string, string> = {
          topic: "bg-accent-light text-accent",
          meta: "bg-amber-100 text-amber-800",
          category: "bg-subtle text-muted",
          other: "bg-subtle text-muted",
        };
        const tierLabel: Record<string, string> = {
          topic: "Topic",
          meta: "Curated",
          category: "Category",
          other: "List",
        };
        return (
          <section className="mb-14">
            <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">Appears In</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {finalList.map(({ l, kind }) => (
                <Link
                  key={l.id}
                  href={`/lists/${l.slug}`}
                  className="p-3.5 rounded-xl border border-border bg-surface hover:shadow-md hover:border-accent/20 transition-all"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-sm font-semibold text-ink">{displayListTitle(l.title, l.slug)}</p>
                    {kind !== "other" && (
                      <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${tierBadgeStyle[kind]}`}>
                        {tierLabel[kind]}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted">{l.book_count} books</p>
                </Link>
              ))}
            </div>
          </section>
        );
      })()}

      {/* Series Context */}
      {hasSeries && safeSeriesBooks.length > 0 && (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">More from {displayTitle(book.series!)}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
            {safeSeriesBooks.filter((b) => b.id !== book.id).map((b) => (
              <BookCard key={b.id} title={b.title} slug={b.slug} author={b.author} authorSlug={b.author_slug} coverUrl={b.cover_image_url} rating={b.rating} recommendationCount={b.recommendation_count} />
            ))}
          </div>
        </section>
      )}

      {/* Also By Author */}
      {safeAuthorBooks.filter((b) => b.id !== book.id).length > 0 && (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">Also by {book.author}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
            {safeAuthorBooks.filter((b) => b.id !== book.id).map((b) => (
              <BookCard key={b.id} title={b.title} slug={b.slug} author={b.author} authorSlug={b.author_slug} coverUrl={b.cover_image_url} rating={b.rating} recommendationCount={b.recommendation_count} />
            ))}
          </div>
        </section>
      )}

      {/* Related Books */}
      {similarBooks.length > 0 && (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">What to read next</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
            {similarBooks.map((b) => (
              <BookCard key={b.id} title={b.title} slug={b.slug} author={b.author} authorSlug={b.author_slug} coverUrl={b.cover_image_url} rating={b.rating} recommendationCount={b.recommendation_count} />
            ))}
          </div>
        </section>
      )}

      {/* Methodology footer */}
      <section className="rounded-2xl border border-border bg-surface p-5 md:p-7">
        <h2 className="text-lg font-bold text-ink mb-2 tracking-tight">{bottomBoxTitle}</h2>
        <p className="text-sm text-muted leading-relaxed">
          Each recommendation is collected from a public source — interviews, articles, or curated lists —
          and linked to its original URL. Books with many verifiable recommendations from respected
          people rank higher.
        </p>
      </section>
    </div>
  );
}
