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
import {
  isValidHttpUrl,
  formatConfidence,
  isUsefulDescription,
  isUsefulPersonBio,
  uniqueByNormalizedText,
  parseSourceUrls,
  outboundLinkRel,
  normalizeAmazonUrl,
  getProofDisplaySafety,
} from "@/lib/dataQuality";
import { BookCard, Breadcrumbs, SafeImage } from "@/components";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const person = await getPersonBySlug(slug);
  if (!person) return { robots: "noindex, follow" };
  const desc = isUsefulDescription(person.meta_description)
    ? person.meta_description
    : isUsefulDescription(person.bio)
      ? person.bio
      : undefined;
  return pageMetadata({
    title: person.meta_title || `${person.name} — Books & Recommendations`,
    description: desc || "",
    path: `/people/${person.slug}`,
    image: isValidHttpUrl(person.avatar_url) ? person.avatar_url : undefined,
    robots: robotsDirective(person),
  });
}

export default async function PersonDetailPage({ params }: Props) {
  const { slug } = await params;
  const person = await getPersonBySlug(slug);
  if (!person) notFound();

  let writtenBooks: Awaited<ReturnType<typeof getBooksByAuthor>> = [];
  let rawProof: Awaited<ReturnType<typeof getPersonRecommendationProof>> = [];
  let recommendedCount = 0;
  let writtenCount = 0;

  try {
    [writtenBooks, rawProof, recommendedCount, writtenCount] = await Promise.all([
      getBooksByAuthor(person.id, 24),
      getPersonRecommendationProof(person.id, 24),
      getPersonRecommendedCount(person.id),
      getPersonWrittenCount(person.id),
    ]);
  } catch (e) {
    console.error("[person-detail] Relation queries failed:", e);
  }

  const safeWrittenBooks = writtenBooks.filter((b) => b != null && b.id);
  const safeProof = rawProof.filter((p) => p != null && p.book != null && p.book.id);
  const recommendationProof = uniqueByNormalizedText(safeProof, "quote");
  const hasAvatar = isValidHttpUrl(person.avatar_url);
  const jsonld = personJsonLd(person);
  const hasWritten = safeWrittenBooks.length > 0;
  const hasRecommendations = recommendationProof.length > 0;
  // Use the lighter-weight person-bio gate so hand-curated one-sentence
  // bios (Phase A backfill: 44–109 chars) render as visible paragraphs.
  // The page's meta-description fallback (line ~33) and the JSON-LD
  // description field still use isUsefulDescription — those are SEO
  // surfaces where the stricter 80-char + English + junk-pattern gate is
  // intentionally retained.
  const hasBio = isUsefulPersonBio(person.bio);

  const recommendationProofWithSafety = recommendationProof.map((p) => ({
    ...p,
    safety: getProofDisplaySafety(p, person)
  }));

  // Filter list to keep only those with valid display cues (not 'none')
  const proofList = recommendationProofWithSafety
    .filter((p) => p.safety.cardCue !== "none")
    .slice(0, 10);

  const hasFullProof = proofList.every((p) => parseSourceUrls(p.source_url).length > 0);
  const proofHeading = hasFullProof ? "Source & Proof" : "Recommendation Signals";

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      {jsonld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonld) }} />}
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "People", href: "/people" }, { label: person.name }]} />

      <div className="flex flex-col sm:flex-row items-start gap-6 mb-8">
        <div className="flex flex-col items-center shrink-0 gap-1.5">
          <div className="w-24 h-24 md:w-28 md:h-28 rounded-full bg-subtle overflow-hidden ring-3 ring-border flex items-center justify-center">
            {hasAvatar ? (
              <SafeImage
                src={person.avatar_url}
                alt={person.name}
                className="w-full h-full object-cover"
                fallback={<span className="text-2xl font-bold text-muted/40">{person.name.charAt(0)}</span>}
              />
            ) : (
              <span className="text-2xl font-bold text-muted/40">{person.name.charAt(0)}</span>
            )}
          </div>
          {/* Wikimedia Commons attribution micro-credit — required by
              CC BY / CC BY-SA license terms when the image is shown
              publicly. Renders ONLY when:
                (a) avatar_url is a real http(s) URL (no attribution on the
                    initials-fallback case), AND
                (b) at least one attribution field is populated.
              Falls through a small precedence chain so we always show the
              most informative line we have:
                1. avatar_attribution (pre-composed credit string)
                2. "Photo: <author> (<license>)" when both are present
                3. "Photo via <license>" when only license is known
                4. plain "Source" link when only the Commons page URL is
                   known (rare; conservative fallback)
              Wrapped in an anchor that links to the Commons file page
              when avatar_source_url is a valid URL; uses outboundLinkRel
              so the rel attribute is set correctly. Public-domain photos
              that ship with neither author nor license render no line —
              attribution is not required for PD. */}
          {hasAvatar && (() => {
            const attr = (person.avatar_attribution || "").trim();
            const author = (person.avatar_author || "").trim();
            const license = (person.avatar_license || "").trim();
            const text = attr
              ? attr
              : author && license
                ? `Photo: ${author} (${license})`
                : license
                  ? `Photo via ${license}`
                  : isValidHttpUrl(person.avatar_source_url)
                    ? "Image source"
                    : "";
            if (!text) return null;
            const className = "text-[10px] text-muted/60 leading-snug text-center max-w-[7rem] line-clamp-2";
            if (isValidHttpUrl(person.avatar_source_url)) {
              return (
                <a
                  href={person.avatar_source_url!}
                  target="_blank"
                  rel={outboundLinkRel(person.avatar_source_url)}
                  className={className + " hover:text-accent hover:underline"}
                  title={text}
                >
                  {text}
                </a>
              );
            }
            return <p className={className} title={text}>{text}</p>;
          })()}
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-ink mb-1 tracking-tight">{person.name}</h1>
          {person.role && person.role.trim().length > 0 && (
            <p className="text-sm text-accent font-semibold mb-3">{person.role}</p>
          )}
          {hasBio && <p className="text-base text-muted max-w-2xl leading-relaxed mb-3">{person.bio}</p>}
          <div className="flex flex-wrap gap-3">
            {recommendedCount > 0 && (
              <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-accent-light text-accent text-sm font-semibold">
                {recommendedCount} {recommendedCount === 1 ? "book" : "books"} recommended
              </span>
            )}
            {writtenCount > 0 && (
              <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-subtle text-ink text-sm font-medium">
                {writtenCount} {writtenCount === 1 ? "book" : "books"} written
              </span>
            )}
          </div>
          {isValidHttpUrl(person.source_url) && (
            <Link
              href={person.source_url!}
              target="_blank"
              rel={outboundLinkRel(person.source_url)}
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline mt-3"
            >
              Profile source →
            </Link>
          )}
          {/* Compact trust note — surfaces methodology near the top so the
              reader frames the page's recommendations correctly before
              scrolling. Same wording approved in the audit; conservative
              language ("sourced from") avoids overclaiming accuracy. */}
          <p className="mt-3 text-xs text-muted/70 leading-relaxed">
            Recommendations are sourced from public posts, interviews, and reading lists.
          </p>
        </div>
      </div>

      {/* Top Trust Panel */}
      <div className="mb-8 p-3.5 rounded-xl border border-border bg-subtle/30 text-xs text-muted leading-relaxed max-w-3xl flex items-start gap-2.5">
        <svg className="w-4.5 h-4.5 text-accent shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <span>
          BookMentions tracks public recommendations from interviews, posts, reading lists, and source references. Books with available evidence include proof links below.
        </span>
      </div>

      {/* Recommended Books */}
      {hasRecommendations ? (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-1.5 tracking-tight">Recommended Books</h2>
          <p className="text-xs text-muted/70 max-w-2xl mb-5">
            These books include Amazon options and source proof where available.
          </p>
          {/* Density: lg:grid-cols-5 (was lg:grid-cols-6) loosens the
              desktop pack so each cover gets more breathing room. Mobile
              (grid-cols-2) and the intermediate sm/md breakpoints are
              unchanged. lg:gap-6 widens the between-card spacing to
              match the new column width. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-5 lg:gap-6">
            {recommendationProof.map((p, i) => {
              const matchedProof = proofList.find((pl) => pl.book.id === p.book.id);
              const cardCue = matchedProof ? matchedProof.safety.cardCue : "none";
              return (
                // Wrapper around BookCard so we can append a secondary Amazon
                // CTA below each card on the people detail page WITHOUT
                // touching BookCard (which is shared with /books and was
                // reverted from Phase-4 recommender experiments). The CTA is
                // an independent sibling <a>, so BookCard's internal link to
                // /books/<slug> stays the primary card click target.
                <div key={`${p.book.id}-${i}`} className="flex flex-col h-full justify-between">
                  <div>
                    <BookCard
                      title={p.book.title}
                      slug={p.book.slug}
                      author={p.book.author}
                      authorSlug={p.book.author_slug}
                      coverUrl={p.book.cover_image_url}
                      rating={p.book.rating}
                      recommendationCount={p.book.recommendation_count}
                    />
                    {cardCue !== "none" && p.book.slug ? (
                      <div className="mt-2.5 flex flex-col items-center justify-center gap-1 text-[11px] text-center">
                        <span className="font-semibold text-emerald-700 flex items-center gap-0.5 justify-center">
                          {cardCue === "proof" ? "✓ Source proof available" : "✓ Source link available"}
                        </span>
                        <a
                          href={`#proof-${p.book.slug}`}
                          className="text-accent hover:underline font-semibold"
                        >
                          {cardCue === "proof" ? "View proof ↓" : "View source ↓"}
                        </a>
                      </div>
                    ) : (
                      <div className="mt-2.5 h-[34px]" aria-hidden="true" />
                    )}
                  </div>
                  {(() => {
                    // normalizeAmazonUrl repairs the dominant 22-char malformed
                    // ASIN pattern and returns null for non-Amazon hosts, so
                    // the CTA is suppressed cleanly when the URL isn't usable.
                    // Render-time only — DB is not modified.
                    const ctaUrl = normalizeAmazonUrl(p.book.amazon_url);
                    if (!ctaUrl) return null;
                    return (
                      <a
                        href={ctaUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow sponsored"
                        data-track-slug={p.book.slug}
                        data-track-section="people-detail-rec"
                        data-track-label="View on Amazon"
                        // CTA visual upgrade only — href / target / rel /
                        // data-track-* attributes above are UNCHANGED.
                        // Stronger amber background and border, darker text,
                        // larger touch target (px-3 py-2), text-xs (12px)
                        // instead of [11px]. Same shape, more clickable.
                        className="mt-2 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-xs font-bold transition-colors shadow-sm"
                      >
                        View on Amazon →
                      </a>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">Recommended Books</h2>
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
            {safeWrittenBooks.map((book) => (
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
        </section>
      )}

      {/* Source & Proof / Recommendation Signals */}
      <section className="mb-14">
        <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">{proofHeading}</h2>
        {proofList.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {proofList.map((p, i) => {
              const sourceUrls = parseSourceUrls(p.source_url);
              const hasSource = sourceUrls.length > 0;
              const conf = formatConfidence(p.confidence_score);

              return (
                <div
                  key={`proof-${i}`}
                  id={p.book.slug ? `proof-${p.book.slug}` : undefined}
                  className="scroll-mt-24 rounded-2xl border border-border bg-surface p-5 hover:shadow-md transition-all flex flex-col justify-between"
                >
                  <div className="mb-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <Link
                        href={`/books/${p.book.slug}`}
                        className="font-bold text-base text-ink hover:text-accent transition-colors line-clamp-1"
                      >
                        {p.book.title}
                      </Link>
                      {conf && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-subtle text-muted text-[10px] font-semibold tracking-wider uppercase">
                          {conf} Confidence
                        </span>
                      )}
                    </div>
                    {p.book.author && (
                      <p className="text-xs text-muted mb-3">by {p.book.author}</p>
                    )}
                    {p.safety.showQuote ? (
                      // Cap long quotes to 5 visible lines so a single
                      // long quote stops stretching its grid column.
                      // Tailwind line-clamp ellipsises overflow text;
                      // the underlying quote data is unchanged and remains
                      // fully accessible to screen readers and to the
                      // /books/<slug> detail page.
                      <blockquote className="text-sm text-muted italic border-l-2 border-accent/20 pl-3 leading-relaxed line-clamp-5">
                        &ldquo;{p.safety.displayQuote}&rdquo;
                      </blockquote>
                    ) : p.safety.warningText ? (
                      <p className="text-xs text-muted/65 italic pl-3 border-l-2 border-amber-300 bg-amber-50/50 py-2.5 rounded-r-lg pr-3 leading-relaxed">
                        {p.safety.warningText}
                      </p>
                    ) : (
                      <p className="text-xs text-muted/65 italic">Recommended by {person.name} without a specific quote snippet.</p>
                    )}
                  </div>
                  <div className="flex items-center justify-between border-t border-border/40 pt-3 mt-auto">
                    <Link href={`/books/${p.book.slug}`} className="text-xs font-bold text-accent hover:underline">
                      View book details →
                    </Link>
                    {hasSource && (
                      sourceUrls.length === 1 ? (
                        <a
                          href={sourceUrls[0]}
                          target="_blank"
                          rel={outboundLinkRel(sourceUrls[0])}
                          className="text-xs text-muted hover:text-accent hover:underline inline-flex items-center gap-1 font-medium"
                        >
                          <span>Original source</span>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      ) : (
                        <details className="relative group/srcs">
                          <summary className="list-none cursor-pointer text-xs text-muted hover:text-accent font-semibold select-none [&::-webkit-details-marker]:hidden flex items-center gap-1">
                            <span>Sources ({sourceUrls.length})</span>
                            <svg className="w-3 h-3 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </summary>
                          <div className="absolute right-0 bottom-full mb-1.5 z-20 w-72 max-w-[80vw] rounded-xl border border-border bg-surface shadow-xl p-3.5 space-y-2">
                            {sourceUrls.map((u, j) => {
                              let host = u;
                              try { host = new URL(u).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
                              return (
                                <a
                                  key={j}
                                  href={u}
                                  target="_blank"
                                  rel={outboundLinkRel(u)}
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
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : recommendationProof.length > 0 ? (
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

      {/* How this profile is built */}
      <section className="rounded-2xl border border-border bg-surface p-5 md:p-7">
        <h2 className="text-lg font-bold text-ink mb-2 tracking-tight">How this profile is built</h2>
        <p className="text-sm text-muted leading-relaxed">
          This profile tracks book recommendations and authored books for {person.name}. We compile recommendations from verifiable public sources, including interviews, articles, social posts, and official reading lists. Profiles are only published when they meet our thresholds for completeness, verified details, and supporting evidence.
        </p>
      </section>

      {/* Navigation Footer Prompt */}
      <div className="flex justify-between items-center mt-8 pt-6 border-t border-border text-sm flex-wrap gap-3">
        <Link href="/people" className="text-accent font-semibold hover:underline flex items-center gap-1">
          ← Back to Books Recommended by Famous People
        </Link>
        <Link href="/books" className="text-accent font-semibold hover:underline flex items-center gap-1">
          Browse All Curated Books →
        </Link>
      </div>
    </div>
  );
}
