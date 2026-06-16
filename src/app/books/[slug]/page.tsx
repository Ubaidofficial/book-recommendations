import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getBookBySlug,
  getBooksByAuthor,
  getBooksBySeries,
  getRecommendationProof,
  getBookRecommenders,
  getListsForBook,
  getSimilarBooksByLists,
  getPersonIdBySlug,
  getSeriesIdBySlug,
  type Book,
  type BookRecommenderSummary,
  type RecommendationProof,
} from "@/lib/data";
import { pageMetadata, robotsDirective } from "@/lib/seo";
import { bookJsonLd } from "@/lib/jsonld";
import { displayTitle, displayListTitle, listKindFromSlug, displayBookTitle } from "@/lib/display";
import {
  isValidHttpUrl,
  isValidRating,
  formatRating,
  formatConfidence,
  isUsefulDescription,
  cleanDescription,
  uniqueByNormalizedText,
  parseSourceUrls,
  parseEditorialList,
  sanitizeEditorialText,
  outboundLinkRel,
  normalizeAmazonUrl,
  normalizeOutboundUrl,
  getProofDisplaySafety,
} from "@/lib/dataQuality";
import { BookCard, Breadcrumbs, SafeImage } from "@/components";

// Detail-page cover fallback — calmer than the previous oversized-purple version.
// Subtle neutral gradient, small icon, readable but non-dominant title, "Cover unavailable" caption.
function DetailCoverFallback({ title }: { title: string }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-between bg-gradient-to-br from-subtle to-subtle/40 border-b border-border/60 p-3 text-center">
      <span className="mt-1 text-[10px] uppercase tracking-wider text-muted/60">Cover unavailable</span>
      <div className="flex flex-col items-center justify-center flex-1 px-2">
        <svg className="w-7 h-7 text-muted/40 mb-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
        <span className="text-sm font-medium text-ink/70 leading-snug line-clamp-5">{title}</span>
      </div>
      <span className="text-[10px] text-transparent select-none" aria-hidden>spacer</span>
    </div>
  );
}

function isValidSlug(slug: string | null | undefined): boolean {
  if (!slug || typeof slug !== "string") return false;
  const s = slug.trim().toLowerCase();
  return s !== "" && s !== "undefined" && s !== "null";
}

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
    title: book.meta_title || (book.author ? `${displayBookTitle(book.title)} by ${book.author}` : displayBookTitle(book.title)),
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

  // Repaired Amazon CTA href. `book.amazon_url` is malformed for ~23% of
  // rows in production (a 10-char ASIN concatenated with a 12-char hex hash,
  // which lands users on Amazon's page-not-found view). normalizeAmazonUrl
  // truncates the corrupt suffix; it also returns null for non-Amazon hosts
  // (8 rows in DB) so the CTAs are simply suppressed for those books. No
  // affiliate tag is appended. Render-time only — DB is not modified.
  const normalizedAmazonUrl = normalizeAmazonUrl(book.amazon_url);

  const personId = book.author_slug ? await getPersonIdBySlug(book.author_slug) : null;
  const seriesId = book.series_slug ? await getSeriesIdBySlug(book.series_slug) : null;

  let authorBooks: Awaited<ReturnType<typeof getBooksByAuthor>> = [];
  let seriesBooks: Awaited<ReturnType<typeof getBooksBySeries>> = [];
  let rawProof: Awaited<ReturnType<typeof getRecommendationProof>> = [];
  let lists: Awaited<ReturnType<typeof getListsForBook>> = [];
  let listSimilarBooks: Awaited<ReturnType<typeof getSimilarBooksByLists>> = [];
  let notableRecommenders: BookRecommenderSummary[] = [];

  try {
    [authorBooks, seriesBooks, rawProof, lists, listSimilarBooks, notableRecommenders] = await Promise.all([
      personId ? getBooksByAuthor(personId, 6) : Promise.resolve([]),
      seriesId ? getBooksBySeries(seriesId, 100) : Promise.resolve([]),
      getRecommendationProof(book.id, 6),
      getListsForBook(book.id, 8),
      getSimilarBooksByLists(book.id, 12),
      getBookRecommenders(book.id, 12),
    ]);
  } catch (e) {
    console.error("[book-detail] Relation queries failed:", e);
  }

  // Sanitize junction data — filter out nulls from failed foreign-key joins
  const safeSeriesBooks = seriesBooks.filter((b: Book | null | undefined) => b != null && b.id);
  const safeAuthorBooks = authorBooks.filter((b: Book | null | undefined) => b != null && b.id);
  const safeProof = rawProof.filter((p: RecommendationProof | null | undefined) => p != null && p.person != null && p.person.id);

  // Trust-signal badge text for the primary (above-fold) Amazon CTA.
  // Reuses the already-fetched notableRecommenders array (Phase 3 data, sorted
  // by person-wide rec count desc, top 12). No new DB queries. Returns null
  // when there are no valid recommender names — in that case the badge
  // simply does not render.
  //   1 name  -> "Recommended by <X>"
  //   2 names -> "Recommended by <X> and <Y>"
  //   3+      -> "Recommended by <N> notable people, including <X> and <Y>"
  const notableBadgeText = (() => {
    const validNames = (notableRecommenders || [])
      .map((r) => (r && typeof r.person_name === "string" ? r.person_name.trim() : ""))
      .filter((n) => n.length > 0);
    if (validNames.length === 0) return null;
    if (validNames.length === 1) return `Recommended by ${validNames[0]}`;
    if (validNames.length === 2) return `Recommended by ${validNames[0]} and ${validNames[1]}`;
    return `Recommended by ${validNames.length} notable people, including ${validNames[0]} and ${validNames[1]}`;
  })();

  // Apply safety to proof items first
  const proofWithSafety = safeProof.map((p) => {
    const safety = getProofDisplaySafety(p, p.person);
    return { p, safety };
  });

  // Deduplicate by the actual displayable quote (which is null if not safe).
  // Only deduplicate if displayQuote is non-null.
  const dedupedProofWithSafety: typeof proofWithSafety = [];
  const seenQuotes = new Set<string>();
  for (const item of proofWithSafety) {
    const dq = item.safety.displayQuote;
    if (dq) {
      const normalized = dq.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      if (seenQuotes.has(normalized)) {
        continue;
      }
      seenQuotes.add(normalized);
    }
    dedupedProofWithSafety.push(item);
  }

  // Re-rank: prefer quote-backed + source-backed cards. Then cap weak (no-quote, no-source)
  // entries so the section doesn't look like 6 equally weighty signals when only generic ones exist.
  const proofScored = dedupedProofWithSafety.map((item) => {
    const { p, safety } = item;
    const hasQuote = safety.showQuote;
    const hasSource = safety.showSource;
    const conf = typeof p.confidence_score === "number" ? p.confidence_score : 0;
    const strength = (hasQuote ? 3 : 0) + (hasSource ? 2 : 0);
    return { p, safety, strength, hasQuote, hasSource, conf };
  }).sort((a, b) => {
    if (a.strength !== b.strength) return b.strength - a.strength;
    return (b.conf || 0) - (a.conf || 0);
  });

  const strongCount = proofScored.filter((x) => x.strength > 0).length;
  // Display cap: when 3+ strong signals exist, show up to 6. When 1–2 strong, allow
  // a few weak as filler (max 4 total). When zero strong, show at most 3 weak.
  const proofCap = strongCount >= 3 ? 6 : strongCount > 0 ? 4 : 3;
  const proofItems = proofScored.slice(0, proofCap);
  const proof = proofItems.map((x) => x.p);

  // Determine proof quality
  const hasProof = proof.length > 0;
  const proofWithSource = proofItems.filter((item) => item.safety.showSource);
  const showVerifiedBadge = proofWithSource.length >= 2;
  // Conservative labels until DB source quality is audited
  const proofHeading = "Recommendation Signals";
  const bottomBoxTitle = "How recommendation signals are reviewed";

  const hasCover = isValidHttpUrl(book.cover_image_url);
  const showRating = isValidRating(book.rating);
  // Display-only description hygiene: if the row doesn't pass isUsefulDescription
  // (placeholder text, scraped junk, too short, non-English) we hide the description
  // block entirely rather than show internal review text to the public.
  const showDescription = isUsefulDescription(book.description);
  const descriptionText = showDescription ? cleanDescription(book.description) : "";

  // Author line
  const hasAuthor = book.author && book.author.trim().length > 0;

  const hasLists = lists.length > 0;
  const hasSeries = book.series && book.series_slug;

  // Consolidate similar books — list/topic co-membership first (strongest topical
  // signal), then fall back to series + author so the section always has 6–8 cards
  // when possible. Deduped against the current book and against itself.
  const safeListSimilar = (listSimilarBooks || []).filter(
    (b: Book | null | undefined) => b != null && !!b.id && b.id !== book.id
  );
  const seriesIds = new Set(safeSeriesBooks.filter((b) => b !== null && b.id && b.id !== book.id).map((b) => b.id));
  const authorIds = new Set(safeAuthorBooks.filter((b) => b !== null && b.id && b.id !== book.id).map((b) => b.id));
  const similarIds = new Set<string>();
  const similarBooks = [...safeListSimilar, ...safeSeriesBooks, ...safeAuthorBooks]
    .filter((b) => {
      if (!b || !b.id || b.id === book.id) return false;
      if (seriesIds.has(b.id)) return false;
      if (authorIds.has(b.id)) return false;
      if (similarIds.has(b.id)) return false;
      similarIds.add(b.id);
      return true;
    })
    .slice(0, 8);

  // Scoring algorithm to pick one strong alternative from similarBooks for "Try this instead"
  const alternativeCandidate = (() => {
    if (similarBooks.length === 0) return null;
    const candidates = similarBooks
      .map((b) => {
        if (!isValidSlug(b.slug) || !b.title || !isValidHttpUrl(b.cover_image_url)) {
          return { b, score: -1 };
        }
        const recCount = typeof b.recommendation_count === "number" ? b.recommendation_count : 0;
        const hasEditorialSummary = b.editorial_summary && b.editorial_summary.trim().length >= 20 ? 15 : 0;
        const isApprovedOrDraft = (b.ai_quality_status && ["approved", "draft"].includes(b.ai_quality_status.toLowerCase())) ? 10 : 0;
        const hasBestFor = b.best_for && b.best_for.trim().length > 0 ? 5 : 0;
        const hasNotFor = b.not_for && b.not_for.trim().length > 0 ? 5 : 0;
        const hasThemes = (b.key_themes && (Array.isArray(b.key_themes) ? b.key_themes.length > 0 : String(b.key_themes).trim().length > 0)) ? 5 : 0;
        const score = recCount + hasEditorialSummary + isApprovedOrDraft + hasBestFor + hasNotFor + hasThemes;
        return { b, score };
      })
      .filter((x) => x.score >= 0);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].b;
  })();

  // Reading-fit strip: parsed up-front so we can decide whether to render the strip.
  // Themes come from key_themes via the same parser used in the Editorial section,
  // capped at 2 here to act as a "main vibe" preview (full list still appears below).
  const fitStripThemes = parseEditorialList(book.key_themes, { maxItems: 2, minLen: 3 })
    .map((s) => sanitizeEditorialText(s))
    .filter((s) => s && s.length <= 50);
  const fitStripDifficulty = (book.difficulty_level || "").trim();
  // Length bucket: Short (<250) / Medium (250–450) / Long (>450). Renders only when
  // `book.page_count` is a positive integer. Population is sparse in production
  // (~113 / 98,845 rows at time of writing) so the badge hides on most pages — that's
  // expected, not a bug.
  const rawPageCount =
    typeof book.page_count === "number" && Number.isFinite(book.page_count) && book.page_count > 0
      ? Math.round(book.page_count)
      : null;
  const lengthBucket: "Short" | "Medium" | "Long" | null = rawPageCount == null
    ? null
    : rawPageCount < 250 ? "Short"
      : rawPageCount > 450 ? "Long"
        : "Medium";
  const showFitStrip = !!fitStripDifficulty || fitStripThemes.length > 0 || lengthBucket != null;

  // "Why recommended" deterministic summary — no AI, no DB. Uses the existing
  // pre-ranked lists from getListsForBook (topic > narrow > meta > broad) and
  // the recommendation_count column. Empty if both signals are absent.
  const whyRecParts: string[] = [];
  const recCount = typeof book.recommendation_count === "number" ? book.recommendation_count : 0;
  if (recCount > 0) {
    whyRecParts.push(
      `Recommended by ${recCount.toLocaleString()} source${recCount === 1 ? "" : "s"}`
    );
  }
  const whyRecListNames = (lists || [])
    .slice(0, 3)
    .map((l) => displayListTitle(l.title, l.slug))
    .filter((s): s is string => !!s && s.length > 0);
  if (whyRecListNames.length > 0) {
    const joined =
      whyRecListNames.length === 1
        ? whyRecListNames[0]
        : whyRecListNames.length === 2
          ? `${whyRecListNames[0]} and ${whyRecListNames[1]}`
          : `${whyRecListNames.slice(0, -1).join(", ")}, and ${whyRecListNames[whyRecListNames.length - 1]}`;
    whyRecParts.push(`appears in ${joined}`);
  }
  const whyRecSentence = whyRecParts.length > 0 ? whyRecParts.join(" and ") + "." : null;

  // Editorial parameters parsed up-front for top placements
  const aiStatus = (book.ai_quality_status || "").toLowerCase();
  const showEditorial = aiStatus && aiStatus !== "rejected" && aiStatus !== "pending";

  const editorialSummary = showEditorial
    ? sanitizeEditorialText((book.editorial_summary || "").trim())
    : "";
  const bestForItems = showEditorial
    ? parseEditorialList(book.best_for, { maxItems: 4, minLen: 8 }).map((s) => sanitizeEditorialText(s)).filter((s): s is string => !!s)
    : [];
  const notForItems = showEditorial
    ? parseEditorialList(book.not_for, { maxItems: 4, minLen: 8 }).map((s) => sanitizeEditorialText(s)).filter((s): s is string => !!s)
    : [];
  const themesRaw = showEditorial
    ? parseEditorialList(book.key_themes, { maxItems: 6, minLen: 3 })
    : [];

  const summaryHook = editorialSummary || whyRecSentence || "";

  // Before You Buy visibility rules based on at least 2 useful signal groups:
  // 1) Reading specifications (difficulty level or page count)
  // 2) Themes group (key themes length > 0)
  // 3) Audience fit group (best_for or not_for has items)
  const hasReadingSpecs = !!(fitStripDifficulty || rawPageCount);
  const hasThemes = themesRaw.length > 0;
  const hasAudienceFit = bestForItems.length > 0 || notForItems.length > 0;
  const showBeforeYouBuy = ((hasReadingSpecs ? 1 : 0) + (hasThemes ? 1 : 0) + (hasAudienceFit ? 1 : 0)) >= 2;
  const hasInlineEditorialCtas = (bestForItems.length > 0 || notForItems.length > 0) || showBeforeYouBuy;

  const jsonld = bookJsonLd(book);

  // Social Proof Summary Row
  const socialProofRow = (() => {
    const validRecs = (notableRecommenders || [])
      .filter((r) => r && typeof r.person_name === "string" && r.person_name.trim().length > 0);
    if (validRecs.length === 0) return null;

    const cluster = validRecs.slice(0, 3);
    const remainingCount = validRecs.length - 2;

    return (
      <div className="flex items-center gap-3 mb-4 flex-wrap text-xs md:text-sm text-muted">
        <div className="flex -space-x-2 shrink-0">
          {cluster.map((r, idx) => {
            const hasAvatar = isValidHttpUrl(r.avatar_url);
            const initials = (r.person_name || "?").charAt(0);
            const content = hasAvatar ? (
              <SafeImage
                src={r.avatar_url!}
                alt={r.person_name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-[9px] font-bold text-muted/60">{initials}</span>
            );

            return r.person_slug ? (
              <Link
                key={r.person_slug}
                href={`/people/${r.person_slug}`}
                className="w-6.5 h-6.5 rounded-full bg-subtle border border-surface overflow-hidden flex items-center justify-center hover:z-10 transition-transform hover:scale-105 shrink-0"
                title={r.person_name}
              >
                {content}
              </Link>
            ) : (
              <div
                key={idx}
                className="w-6.5 h-6.5 rounded-full bg-subtle border border-surface overflow-hidden flex items-center justify-center shrink-0"
                title={r.person_name}
              >
                {content}
              </div>
            );
          })}
        </div>

        <span className="leading-relaxed">
          Recommended by{" "}
          {validRecs.length === 1 && (
            validRecs[0].person_slug ? (
              <Link href={`/people/${validRecs[0].person_slug}`} className="font-semibold text-ink hover:text-accent hover:underline">
                {validRecs[0].person_name}
              </Link>
            ) : (
              <span className="font-semibold text-ink">{validRecs[0].person_name}</span>
            )
          )}
          {validRecs.length === 2 && (
            <>
              {validRecs[0].person_slug ? (
                <Link href={`/people/${validRecs[0].person_slug}`} className="font-semibold text-ink hover:text-accent hover:underline">
                  {validRecs[0].person_name}
                </Link>
              ) : (
                <span className="font-semibold text-ink">{validRecs[0].person_name}</span>
              )}
              {" and "}
              {validRecs[1].person_slug ? (
                <Link href={`/people/${validRecs[1].person_slug}`} className="font-semibold text-ink hover:text-accent hover:underline">
                  {validRecs[1].person_name}
                </Link>
              ) : (
                <span className="font-semibold text-ink">{validRecs[1].person_name}</span>
              )}
            </>
          )}
          {validRecs.length >= 3 && (
            <>
              {validRecs[0].person_slug ? (
                <Link href={`/people/${validRecs[0].person_slug}`} className="font-semibold text-ink hover:text-accent hover:underline">
                  {validRecs[0].person_name}
                </Link>
              ) : (
                <span className="font-semibold text-ink">{validRecs[0].person_name}</span>
              )}
              {", "}
              {validRecs[1].person_slug ? (
                <Link href={`/people/${validRecs[1].person_slug}`} className="font-semibold text-ink hover:text-accent hover:underline">
                  {validRecs[1].person_name}
                </Link>
              ) : (
                <span className="font-semibold text-ink">{validRecs[1].person_name}</span>
              )}
              {" + "}
              <details className="relative inline group/popover recommenders-popover">
                <summary className="list-none inline cursor-pointer font-semibold text-accent hover:text-accent-hover hover:underline focus:outline-none select-none [&::-webkit-details-marker]:hidden">
                  {remainingCount} more
                </summary>
                <div className="absolute left-1/2 -translate-x-1/2 md:translate-x-0 md:left-0 top-full mt-2 z-30 w-80 max-w-[90vw] rounded-xl border border-border bg-surface shadow-xl p-3 space-y-2.5 text-left font-normal text-xs md:text-sm text-ink">
                  <p className="font-bold text-ink border-b border-border pb-1.5 mb-1.5">More Recommenders</p>
                  <div className="max-h-60 overflow-y-auto space-y-3 pr-1">
                    {validRecs.slice(2).map((r, idx) => {
                      const initials = (r.person_name || "?").charAt(0);
                      const hasAvatar = isValidHttpUrl(r.avatar_url);
                      // Do not use aggregate URLs or metadata links in popover
                      const firstSource = r.source_url && !r.source_url.includes("|") ? parseSourceUrls(r.source_url)[0] : null;
                      return (
                        <div key={idx} className="flex gap-2.5 items-start">
                          <div className="w-7 h-7 rounded-full bg-subtle shrink-0 border border-border overflow-hidden flex items-center justify-center">
                            {hasAvatar ? (
                              <SafeImage src={r.avatar_url!} alt={r.person_name} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-[10px] font-bold text-muted/50">{initials}</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-1.5">
                              {r.person_slug ? (
                                <Link
                                  href={`/people/${r.person_slug}`}
                                  className="font-semibold text-ink hover:text-accent hover:underline text-xs truncate"
                                >
                                  {r.person_name}
                                </Link>
                              ) : (
                                <span className="font-semibold text-ink text-xs truncate">{r.person_name}</span>
                              )}
                            </div>
                            {r.role && <p className="text-[10px] text-muted truncate mt-0.5">{r.role}</p>}
                            {r.quote && !r.quote.includes("|") && (
                              <p className="text-[11px] text-muted/80 leading-relaxed italic border-l border-accent/20 pl-2 mt-1 line-clamp-2">
                                &ldquo;{r.quote}&rdquo;
                              </p>
                            )}
                            {firstSource && (
                              <a
                                href={firstSource}
                                target="_blank"
                                rel={outboundLinkRel(firstSource)}
                                className="text-[10px] text-accent hover:underline inline-block mt-1 font-semibold"
                              >
                                Source →
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="border-t border-border pt-2 text-center">
                    <a
                      href="#proof-signals"
                      className="text-xs text-accent font-semibold hover:underline"
                    >
                      View full proof ({validRecs.length} signals) ↓
                    </a>
                  </div>
                </div>
              </details>
            </>
          )}
        </span>
      </div>
    );
  })();

  return (
    <div className="relative w-full py-8 pb-28 lg:pb-8">
      {/* Full-width blurred cover-art band behind hero */}
      {hasCover && (
        <div className="absolute inset-x-0 top-0 h-[280px] lg:h-[420px] -z-10 pointer-events-none select-none overflow-hidden" aria-hidden="true">
          <img
            src={book.cover_image_url}
            alt=""
            className="w-full h-full object-cover blur-[100px] opacity-[0.22] scale-125 origin-center"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent" />
        </div>
      )}

      {/* Main page content wrapper */}
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        {jsonld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonld) }} />}
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Books", href: "/books" }, { label: displayBookTitle(book.title) }]} />

        {/* Full-page sticky sidebar grid */}
        <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-8 lg:gap-12 items-start mt-6">
          
          {/* Left sticky rail (desktop only) */}
          <aside className="hidden lg:flex lg:flex-col lg:sticky lg:top-24 lg:self-start lg:w-[320px] gap-5 shrink-0">
            <div className="w-[300px] max-w-[300px] mx-auto rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.3)] bg-subtle aspect-[2/3] ring-1 ring-ink/10 transition-transform duration-300 hover:scale-[1.02]">
              {hasCover ? (
                <SafeImage
                  src={book.cover_image_url}
                  alt={displayBookTitle(book.title)}
                  className="w-full h-full object-cover"
                  fallback={<DetailCoverFallback title={displayBookTitle(book.title)} />}
                />
              ) : (
                <DetailCoverFallback title={displayBookTitle(book.title)} />
              )}
            </div>
            {normalizedAmazonUrl && (
              <div className="w-[300px] mx-auto text-center p-4.5 rounded-2xl border border-amber-200/60 bg-amber-50/15 shadow-[0_8px_30px_rgba(245,158,11,0.04)]">
                <a
                  href={normalizedAmazonUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow sponsored"
                  data-track-slug={book.slug}
                  data-track-section="above-fold"
                  data-track-label="Check price on Amazon"
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-all duration-150 hover:shadow-md shadow-sm"
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                  </svg>
                  Check price on Amazon
                </a>
                {book.recommendation_count > 0 && (
                  <p className="mt-3 text-xs font-bold text-accent" data-track-context="above-fold-trust-badge">
                    Recommended by {book.recommendation_count.toLocaleString()} sources
                  </p>
                )}
                {proofWithSource.length > 0 ? (
                  <p className="mt-1.5 text-[11px] text-muted font-medium leading-normal">
                    Proof-backed recommendation
                  </p>
                ) : book.recommendation_count > 0 ? (
                  <p className="mt-1.5 text-[11px] text-muted font-medium leading-normal">
                    Recommended by public sources
                  </p>
                ) : null}
                <p className="mt-0.5 text-[11px] text-muted font-medium leading-normal">
                  Amazon availability
                </p>
              </div>
            )}
          </aside>

          {/* Right scrolling column */}
          <div className="min-w-0">
            {/* Mobile/Tablet Cover (hidden on desktop) */}
            <div className="mb-6 flex justify-center lg:hidden">
              <div className="w-[200px] max-w-[200px] rounded-2xl overflow-hidden shadow-[0_15px_35px_rgba(0,0,0,0.2)] bg-subtle aspect-[2/3] ring-1 ring-ink/10">
                {hasCover ? (
                  <SafeImage
                    src={book.cover_image_url}
                    alt={displayBookTitle(book.title)}
                    className="w-full h-full object-cover"
                    fallback={<DetailCoverFallback title={displayBookTitle(book.title)} />}
                  />
                ) : (
                  <DetailCoverFallback title={displayBookTitle(book.title)} />
                )}
              </div>
            </div>

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
                  <svg className="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  Verified
                </span>
              )}
            </div>

            <h1 className="text-2xl md:text-4xl font-bold text-ink mb-2 tracking-tight">{displayBookTitle(book.title)}</h1>
            {book.subtitle && <p className="text-base text-muted mb-2">{book.subtitle}</p>}

            {hasAuthor && (
              <p className="text-base text-muted mb-4">
                by <span className="text-accent font-semibold">{book.author}</span>
              </p>
            )}

            {socialProofRow}

            {hasSeries && safeSeriesBooks.length > 0 && (() => {
              const currentIndex = safeSeriesBooks.findIndex((b) => b.id === book.id);
              if (currentIndex === -1) return null;
              const position = currentIndex + 1;
              const total = safeSeriesBooks.length;
              const prevBook = currentIndex > 0 ? safeSeriesBooks[currentIndex - 1] : null;
              const nextBook = currentIndex < total - 1 ? safeSeriesBooks[currentIndex + 1] : null;
              const firstBook = safeSeriesBooks[0];
              const isNotFirst = currentIndex > 0;

              return (
                <div className="flex flex-col gap-3 p-4 rounded-xl border border-border bg-subtle/25 mb-5 max-w-xl">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                      <span className="text-sm font-semibold text-ink">
                        Book {position} of {total} in{" "}
                        {isValidSlug(book.series_slug) ? (
                          <Link href={`/series/${book.series_slug}`} className="text-accent hover:underline">
                            {displayTitle(book.series!)}
                          </Link>
                        ) : (
                          <span className="text-accent font-semibold">{displayTitle(book.series!)}</span>
                        )}
                      </span>
                    </div>
                    {isNotFirst && firstBook && isValidSlug(firstBook.slug) && (
                      <Link
                        href={`/books/${firstBook.slug}`}
                        className="text-xs font-bold text-accent hover:text-accent/80 flex items-center gap-1 bg-accent-light px-2 py-1 rounded"
                      >
                        Start series here
                      </Link>
                    )}
                  </div>

                  {(prevBook || nextBook) && (
                    <div className="grid grid-cols-2 gap-4 border-t border-border/40 pt-3 text-xs">
                      {prevBook ? (
                        isValidSlug(prevBook.slug) ? (
                          <Link
                            href={`/books/${prevBook.slug}`}
                            className="group flex flex-col gap-0.5 text-left hover:opacity-85"
                          >
                            <span className="text-muted font-medium flex items-center gap-1 group-hover:text-accent">
                              ← Previous Book
                            </span>
                            <span className="font-semibold text-ink truncate max-w-full">
                              {displayBookTitle(prevBook.title)}
                            </span>
                          </Link>
                        ) : (
                          <div className="group flex flex-col gap-0.5 text-left">
                            <span className="text-muted font-medium flex items-center gap-1">
                              ← Previous Book
                            </span>
                            <span className="font-semibold text-ink truncate max-w-full">
                              {displayBookTitle(prevBook.title)}
                            </span>
                          </div>
                        )
                      ) : (
                        <div />
                      )}

                      {nextBook ? (
                        isValidSlug(nextBook.slug) ? (
                          <Link
                            href={`/books/${nextBook.slug}`}
                            className="group flex flex-col gap-0.5 text-right hover:opacity-85"
                          >
                            <span className="text-muted font-medium flex items-center justify-end gap-1 group-hover:text-accent">
                              Next Book →
                            </span>
                            <span className="font-semibold text-ink truncate max-w-full block">
                              {displayBookTitle(nextBook.title)}
                            </span>
                          </Link>
                        ) : (
                          <div className="group flex flex-col gap-0.5 text-right">
                            <span className="text-muted font-medium flex items-center justify-end gap-1">
                              Next Book →
                            </span>
                            <span className="font-semibold text-ink truncate max-w-full block">
                              {displayBookTitle(nextBook.title)}
                            </span>
                          </div>
                        )
                      ) : (
                        <div />
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {normalizedAmazonUrl && (
              <div className="mb-6 lg:hidden">
                {notableBadgeText && (
                  <p
                    className="mb-2 text-xs font-medium text-ink/80 flex items-start gap-1.5"
                    data-track-context="above-fold-trust-badge"
                  >
                    <svg
                      className="w-3.5 h-3.5 shrink-0 mt-0.5 text-accent"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>{notableBadgeText}</span>
                  </p>
                )}
                <a
                  href={normalizedAmazonUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow sponsored"
                  data-track-slug={book.slug}
                  data-track-section="above-fold"
                  data-track-label="Check price on Amazon"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-all duration-150 hover:shadow-md shadow-sm"
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                  </svg>
                  Check price on Amazon
                </a>
                {proofWithSource.length > 0 ? (
                  <p className="mt-2 text-[11px] text-muted font-medium leading-normal">
                    Proof-backed recommendation
                  </p>
                ) : book.recommendation_count > 0 ? (
                  <p className="mt-2 text-[11px] text-muted font-medium leading-normal">
                    Recommended by public sources
                  </p>
                ) : null}
                <p className="mt-0.5 text-[11px] text-muted font-medium leading-normal">
                  Amazon availability
                </p>
              </div>
            )}


          {/* Reading Profile Widget */}
          {showFitStrip && (() => {
            const diffVal = (fitStripDifficulty || "").toLowerCase();
            const diffBars = diffVal === "easy" ? 1 : diffVal === "medium" ? 2 : diffVal === "hard" || diffVal === "advanced" || diffVal === "complex" ? 3 : 0;
            return (
              <div className="rounded-xl border border-border bg-subtle/35 p-4 mb-6">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted mb-3">Reading Profile</h4>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
                  {fitStripDifficulty && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted text-xs">Difficulty:</span>
                      <span className="font-semibold text-ink capitalize">{fitStripDifficulty}</span>
                      <div className="flex gap-0.5 items-center select-none" aria-hidden="true">
                        <span className={`w-2.5 h-1.5 rounded-sm ${diffBars >= 1 ? "bg-accent" : "bg-border"}`} />
                        <span className={`w-2.5 h-1.5 rounded-sm ${diffBars >= 2 ? "bg-accent" : "bg-border"}`} />
                        <span className={`w-2.5 h-1.5 rounded-sm ${diffBars >= 3 ? "bg-accent" : "bg-border"}`} />
                      </div>
                    </div>
                  )}
                  {lengthBucket && rawPageCount != null && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted text-xs">Length:</span>
                      <span className="font-semibold text-ink">{lengthBucket}</span>
                      <span className="text-muted text-xs">({rawPageCount.toLocaleString()} pages)</span>
                    </div>
                  )}
                  {fitStripThemes.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-muted text-xs mr-0.5">Themes:</span>
                      {fitStripThemes.map((theme, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded-full bg-accent-light text-accent text-xs font-semibold"
                        >
                          {theme}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Should I read this summary card */}
          {summaryHook && (
            <div className="rounded-xl border border-amber-100 bg-gradient-to-br from-amber-50/60 to-white p-4 mb-6 shadow-sm">
              <h4 className="text-xs font-bold text-amber-900 mb-2 uppercase tracking-wider flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
                </svg>
                Should I read this?
              </h4>
              <p className="text-sm md:text-base text-ink leading-relaxed font-medium">
                {summaryHook}
              </p>
            </div>
          )}

          {/* Read this if / Skip this if */}
          {(bestForItems.length > 0 || notForItems.length > 0) && (
            <div className="mb-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                {bestForItems.length > 0 && (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/20 p-4">
                    <h4 className="text-xs font-bold text-emerald-900 mb-2.5 flex items-center gap-1.5 uppercase tracking-wider">
                      <svg className="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      Read this if...
                    </h4>
                    <ul className="space-y-1.5">
                      {bestForItems.map((item, i) => (
                        <li key={i} className="text-xs md:text-sm text-ink/85 leading-relaxed flex gap-2">
                          <span className="text-emerald-500 shrink-0 select-none">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {notForItems.length > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50/30 p-4">
                    <h4 className="text-xs font-bold text-gray-800 mb-2.5 flex items-center gap-1.5 uppercase tracking-wider">
                      <svg className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Skip this if...
                    </h4>
                    <ul className="space-y-1.5">
                      {notForItems.map((item, i) => (
                        <li key={i} className="text-xs md:text-sm text-muted leading-relaxed flex gap-2">
                          <span className="text-muted/40 shrink-0 select-none">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {normalizedAmazonUrl && (
                <div className="flex justify-start">
                  <a
                    href={normalizedAmazonUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow sponsored"
                    data-track-slug={book.slug}
                    data-track-section="audience-fit"
                    // data-track-label intentionally preserved as the
                    // original "Check formats on Amazon" string so the
                    // existing analytics CTR series stays continuous
                    // across this copy-only refresh. Visible button text
                    // below is the new intent-driven copy.
                    data-track-label="Check formats on Amazon"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-all duration-150 hover:shadow-sm"
                  >
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                    </svg>
                    See formats and current price on Amazon
                  </a>
                </div>
              )}
            </div>
          )}

          {showDescription && (
            <div className="prose prose-base text-muted max-w-none leading-relaxed">
              <p>{descriptionText}</p>
            </div>
          )}

          {/* Mid-page fallback CTA for books with missing editorial inline sections */}
          {!hasInlineEditorialCtas && normalizedAmazonUrl && (
            <div className="my-8 p-6 rounded-2xl border border-amber-200/60 bg-amber-50/15 shadow-[0_8px_30px_rgba(245,158,11,0.02)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-ink">
                  Looking for Kindle, hardcover, paperback, or audiobook editions?
                </h4>
                <p className="text-xs text-muted">
                  Check formats, pricing, and current availability directly.
                </p>
              </div>
              <a
                href={normalizedAmazonUrl}
                target="_blank"
                rel="noopener noreferrer nofollow sponsored"
                data-track-slug={book.slug}
                data-track-section="book-fallback"
                data-track-label="Check availability on Amazon"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-semibold transition-all shrink-0 hover:shadow-sm"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
                Check availability on Amazon
              </a>
            </div>
          )}

      {/* Before you buy section */}
      {showBeforeYouBuy && (
        <section className="mb-14 rounded-2xl border border-border bg-surface p-6 md:p-8">
          <h2 className="text-xl font-bold text-ink mb-6 tracking-tight flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Before You Buy
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              {/* Quick Profile Indicators */}
              {(fitStripDifficulty || rawPageCount || themesRaw.length > 0) && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Reading Specifications</h3>
                  <div className="space-y-2 text-sm">
                    {fitStripDifficulty && (
                      <p className="flex items-center gap-2 text-ink">
                        <span className="text-muted w-20 shrink-0">Difficulty:</span>
                        <span className="font-semibold capitalize">{fitStripDifficulty}</span>
                      </p>
                    )}
                    {rawPageCount && (
                      <p className="flex items-center gap-2 text-ink">
                        <span className="text-muted w-20 shrink-0">Length:</span>
                        <span className="font-semibold">{rawPageCount.toLocaleString()} pages ({lengthBucket})</span>
                      </p>
                    )}
                    {themesRaw.length > 0 && (
                      <div className="flex items-start gap-2 text-ink">
                        <span className="text-muted w-20 shrink-0">Themes:</span>
                        <div className="flex flex-wrap gap-1">
                          {themesRaw.slice(0, 3).map((t, idx) => (
                            <span key={idx} className="bg-subtle text-ink text-xs px-2 py-0.5 rounded">
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              {/* Read this if / Skip this if list if exists */}
              {(bestForItems.length > 0 || notForItems.length > 0) && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Audience Fit</h3>
                  <div className="space-y-2.5">
                    {bestForItems.length > 0 && (
                      <div>
                        <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block mb-1">Recommended for:</span>
                        <ul className="text-xs text-ink/90 space-y-1 pl-4 list-disc">
                          {bestForItems.slice(0, 3).map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {notForItems.length > 0 && (
                      <div>
                        <span className="text-[10px] font-bold text-gray-700 uppercase tracking-wider block mb-1">Not ideal if you want:</span>
                        <ul className="text-xs text-muted space-y-1 pl-4 list-disc">
                          {notForItems.slice(0, 3).map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {normalizedAmazonUrl && (
            <div className="mt-6 pt-6 border-t border-border/60 flex flex-wrap items-center justify-between gap-4">
              <p className="text-xs text-muted max-w-md">
                Check formats, pricing, and availability options for Kindle, physical print, or audiobooks directly.
              </p>
              <a
                href={normalizedAmazonUrl}
                target="_blank"
                rel="noopener noreferrer nofollow sponsored"
                data-track-slug={book.slug}
                data-track-section="before-you-buy"
                // data-track-label intentionally preserved as the original
                // "Check price on Amazon" string so analytics CTR series
                // stays continuous across this copy-only refresh. Visible
                // button text below differentiates from the primary
                // above-fold CTA (which still says "Check price on
                // Amazon") so the two don't look like duplicates.
                data-track-label="Check price on Amazon"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-all duration-150 hover:shadow-md shadow-sm"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
                View available editions on Amazon
              </a>
            </div>
          )}
        </section>
      )}

      {/* Editorial Themes — relocated summary and lists to the top to improve quick fit evaluation */}
      {showEditorial && themesRaw.length > 0 && (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-3 tracking-tight">Key themes</h2>
          <div className="flex flex-wrap gap-1.5">
            {themesRaw.map((full, i) => {
              const MAX_CHIP_CHARS = 50;
              const truncated = full.length > MAX_CHIP_CHARS;
              const shown = truncated ? full.slice(0, MAX_CHIP_CHARS - 1).trimEnd() + "…" : full;
              return (
                <span
                  key={i}
                  className="inline-flex items-center px-2.5 py-1 rounded-full bg-subtle text-ink text-xs"
                  title={truncated ? full : undefined}
                >
                  {shown}
                </span>
              );
            })}
          </div>
        </section>
      )}

      {/* Why recommended — deterministic one-sentence summary built from existing
          signals: recommendation_count + the top 3 list memberships from
          getListsForBook (already ranked: topic > narrow > meta > broad).
          No AI, no DB writes. Hidden when neither signal is present. */}
      {whyRecSentence && (
        <section className="mb-10">
          <div className="rounded-xl border border-border bg-surface p-4 md:p-5 max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">Why recommended</p>
            <p className="text-sm md:text-base text-ink leading-relaxed">{whyRecSentence}</p>
          </div>
        </section>
      )}

      {/* Recommended by notable people — compact scannable face grid.
          Distinct from the rich Recommendation Signals section below, which
          renders the same data with quotes + sources. This grid primes the
          user with recognisable recommenders before the quote evidence.
          Hidden entirely when no recommenders exist; no empty state. */}
      {notableRecommenders.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-ink mb-2 tracking-tight">Recommended by notable people</h2>
          <p className="text-sm text-muted mb-5">People and public figures who have recommended this book.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {notableRecommenders.map((r) => (
              <div
                key={r.person_slug}
                className="rounded-xl border border-border bg-surface p-3 flex items-center gap-3"
              >
                <Link
                  href={`/people/${r.person_slug}`}
                  className="group flex items-center gap-3 min-w-0 flex-1"
                >
                  <div className="w-10 h-10 rounded-full bg-subtle overflow-hidden shrink-0 ring-1 ring-border flex items-center justify-center">
                    {isValidHttpUrl(r.avatar_url) ? (
                      <img src={r.avatar_url!} alt={r.person_name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-sm font-bold text-muted/40">
                        {(r.person_name || "?").charAt(0)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink truncate group-hover:text-accent transition-colors">
                      {r.person_name}
                    </p>
                    {r.role && (
                      <p className="text-xs text-muted truncate">{r.role}</p>
                    )}
                  </div>
                </Link>
                {(() => {
                  // r.source_url may be a pipe-concatenated string of multiple
                  // URLs (true for ~64% of non-null source_url rows in
                  // production). Parse first, then render only the primary
                  // (first) parsed URL so the <a href> is a single valid URL
                  // and `rel` is computed against the URL that the click
                  // actually navigates to. The deeper "Recommendation Proof /
                  // Signals" section below the face grid already surfaces all
                  // parsed URLs via its <details> dropdown, so the compact
                  // face card only needs the first URL.
                  const first = r.source_url && !r.source_url.includes("|") ? parseSourceUrls(r.source_url)[0] : null;
                  if (!first) return null;
                  return (
                    <a
                      href={first}
                      target="_blank"
                      rel={outboundLinkRel(first)}
                      className="text-[10px] uppercase tracking-wider text-muted hover:text-accent hover:underline shrink-0 font-semibold"
                    >
                      Source
                    </a>
                  );
                })()}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recommendation Proof / Signals */}
      <section className="mb-14">
        <h2 className="text-xl font-bold text-ink mb-1 tracking-tight">{proofHeading}</h2>
        {/* Compact trust/methodology note — mirrors the wording shipped on
            /people/[slug] and frames the proof drawer that follows. Sits
            tight under the section H2 (h2 mb-1 + this paragraph mb-5 =
            same total rhythm as the previous mb-5). Always renders; does
            not crowd the Amazon CTA which lives above this section. */}
        <p className="text-xs text-muted/70 leading-relaxed mb-5">
          Recommendation proof is sourced from public posts, interviews, reading lists, and cited references.
        </p>
        {hasProof ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {proofItems.map((item, i) => {
              const { p, safety } = item;
              const sourceUrls = parseSourceUrls(p.source_url);
              const hasSource = safety.showSource;
              const hasQuote = safety.showQuote;
              const conf = formatConfidence(p.confidence_score);

              return (
                <div
                  key={`${p.person.id}-${i}`}
                  className="rounded-xl border border-border bg-surface p-4"
                >
                  {isValidSlug(p.person.slug) ? (
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
                  ) : (
                    <div className="flex items-center gap-3 mb-3">
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
                    </div>
                  )}

                  {hasQuote ? (
                    <blockquote className="text-sm text-muted italic border-l-2 border-accent/20 pl-3 mb-2 line-clamp-3">
                      &ldquo;{safety.displayQuote}&rdquo;
                    </blockquote>
                  ) : (
                    <p className="text-xs text-muted/50">Recommended this book</p>
                  )}

                  {hasSource ? (
                    sourceUrls.length === 1 ? (
                      <div className="flex items-center justify-between gap-2 text-xs mt-2">
                        <a
                          href={normalizeOutboundUrl(sourceUrls[0]) ?? sourceUrls[0]}
                          target="_blank"
                          rel={outboundLinkRel(sourceUrls[0])}
                          className="text-accent hover:underline font-medium"
                        >
                          View source →
                        </a>
                        {conf && (
                          <span className="text-muted/40 tabular-nums">{conf}</span>
                        )}
                      </div>
                    ) : (
                      <details className="w-full mt-2 mb-1.5">
                        <summary className="list-none cursor-pointer flex items-center justify-between gap-2 text-xs select-none [&::-webkit-details-marker]:hidden">
                          <span className="text-accent hover:underline font-medium">View sources ({sourceUrls.length}) ▾</span>
                          {conf && <span className="text-muted/40 tabular-nums">{conf}</span>}
                        </summary>
                        <div className="mt-2 w-full rounded-lg border border-border bg-subtle/50 p-2 space-y-1 text-xs">
                          {sourceUrls.map((u, j) => {
                            let host = u;
                            try { host = new URL(u).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
                            return (
                              <a
                                key={j}
                                href={normalizeOutboundUrl(u) ?? u}
                                target="_blank"
                                rel={outboundLinkRel(u)}
                                className="block text-xs text-accent hover:underline truncate"
                                title={normalizeOutboundUrl(u) ?? u}
                              >
                                {j + 1}. {host}
                              </a>
                            );
                          })}
                        </div>
                      </details>
                    )
                  ) : (
                    <div className="flex items-center justify-between gap-2 text-xs mt-2">
                      {p.source_name ? (
                        <span className="text-muted">{p.source_name}</span>
                      ) : <span />}
                      {conf && (
                        <span className="text-muted/40 tabular-nums">{conf}</span>
                      )}
                    </div>
                  )}
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

      {/* Concluding Amazon CTA below proof section */}
      {normalizedAmazonUrl && (
        <div className="my-8 p-6 rounded-2xl border border-amber-200/60 bg-amber-50/15 shadow-[0_8px_30px_rgba(245,158,11,0.02)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1 flex-1">
            <h4 className="text-sm font-bold text-ink">
              Ready to read {displayBookTitle(book.title)}?
            </h4>
            <p className="text-xs text-muted">
              Check formats, pricing, and availability options directly on Amazon.
            </p>
          </div>
          <a
            href={normalizedAmazonUrl}
            target="_blank"
            rel="noopener noreferrer nofollow sponsored"
            data-track-slug={book.slug}
            data-track-section="proof-conclusion"
            data-track-label="View on Amazon"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-semibold transition-all shrink-0 hover:shadow-sm"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
            View on Amazon
          </a>
        </div>
      )}

      {/* Appears in Lists — single-pass dedupe across ALL kinds by normalized display label,
          keeping the higher-priority entry (topic > meta > other > category); same priority
          ties broken by lower pre-rank index, then smaller book_count. Broad parents
          (Fiction/Nonfiction/History/…) are hidden once we have ≥5 useful specific cards.
          Final list capped at 8. Fiction and Nonfiction are never shown together — the
          contradiction is resolved by slug-keyword inference, else both are hidden. */}
      {hasLists && (() => {
        // Priority: lower number wins on duplicate-label collisions.
        const PRIORITY: Record<ReturnType<typeof listKindFromSlug>, number> = {
          topic: 1, meta: 2, other: 3, category: 4,
        };
        // The 10 broad-parent slugs explicitly called out for suppression on this page.
        const BROAD_APPEARS_IN_SLUGS = new Set([
          "fiction", "nonfiction", "history", "social-sciences", "business",
          "philosophy", "science", "art", "personal-development", "psychology",
        ]);

        // Heuristic: infer whether the book is fiction or nonfiction from its OTHER lists'
        // slug tokens. Used to resolve the Fiction-vs-Nonfiction contradiction.
        const fictionKw = /(^|-)(fiction|fantasy|romance|mystery|thriller|horror|dystopian|comics?|manga|poetry|paranormal|time-travel|space-opera|steampunk|saga|novel|sci-fi)(-|$)/;
        const nonfictionKw = /(^|-)(biography|autobiography|memoir|business|leadership|ceo|history|science|math|physics|biology|psychology|philosophy|self-help|personal-development|finance|investing|technology|programming|cookbook|nutrition|fitness|sports|parenting|health|spirituality|religion|writing|design|architecture|photography|travel|nature|gardening|management|marketing|sales|strategy|startup)(-|$)/;
        const otherSlugs = lists.map((l) => (l.slug || "").toLowerCase());
        const hasFictionSignal = otherSlugs.some((s) => fictionKw.test(s));
        const hasNonfictionSignal = otherSlugs.some((s) => nonfictionKw.test(s));
        const inferredType: "fiction" | "nonfiction" | "unknown" =
          hasFictionSignal && !hasNonfictionSignal ? "fiction"
            : hasNonfictionSignal && !hasFictionSignal ? "nonfiction"
              : "unknown";

        const enriched = lists.map((l, idx) => ({
          l,
          idx,                                                         // pre-rank position
          kind: listKindFromSlug(l.slug),
          displayName: displayListTitle(l.title, l.slug),
          isBroad: BROAD_APPEARS_IN_SLUGS.has((l.slug || "").toLowerCase()),
        }));

        // Resolve Fiction-vs-Nonfiction contradiction BEFORE dedupe so it doesn't leak through.
        const hasFictionCard = enriched.some((x) => x.kind === "category" && (x.l.slug || "").toLowerCase() === "fiction");
        const hasNonfictionCard = enriched.some((x) => x.kind === "category" && (x.l.slug || "").toLowerCase() === "nonfiction");
        const dropFiction = hasFictionCard && hasNonfictionCard && inferredType === "nonfiction";
        const dropNonfiction = hasFictionCard && hasNonfictionCard && inferredType === "fiction";
        const dropBothFN = hasFictionCard && hasNonfictionCard && inferredType === "unknown";
        const beforeFN = enriched.filter((x) => {
          const s = (x.l.slug || "").toLowerCase();
          if (s === "fiction" && (dropFiction || dropBothFN)) return false;
          if (s === "nonfiction" && (dropNonfiction || dropBothFN)) return false;
          return true;
        });

        // Single-pass dedupe by normalized display label across ALL kinds.
        const bestByLabel = new Map<string, typeof beforeFN[number]>();
        for (const x of beforeFN) {
          const key = x.displayName.toLowerCase().trim();
          if (!key) continue;
          const cur = bestByLabel.get(key);
          if (!cur) { bestByLabel.set(key, x); continue; }
          const curP = PRIORITY[cur.kind];
          const xP = PRIORITY[x.kind];
          if (xP < curP) { bestByLabel.set(key, x); continue; }
          if (xP === curP) {
            // Same kind & label collision — keep the better pre-rank, then smaller book_count.
            if (x.idx < cur.idx) { bestByLabel.set(key, x); continue; }
            if (x.idx === cur.idx) {
              const curBc = cur.l.book_count || 1e9;
              const xBc = x.l.book_count || 1e9;
              if (xBc < curBc) bestByLabel.set(key, x);
            }
          }
        }
        const deduped = Array.from(bestByLabel.values());

        const usefulSpecific = deduped.filter((x) => x.kind !== "category").length;
        const tierRank = (k: ReturnType<typeof listKindFromSlug>) => PRIORITY[k];
        const ordered = [...deduped].sort((a, b) => {
          const t = tierRank(a.kind) - tierRank(b.kind);
          return t !== 0 ? t : a.idx - b.idx;        // preserve pre-rank within tier
        });
        const finalList = ordered
          .filter((x) => !(usefulSpecific >= 5 && x.kind === "category" && x.isBroad))
          .slice(0, 8);
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
              {finalList.map(({ l, kind, displayName }) => {
                const content = (
                  <>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm font-semibold text-ink">{displayName}</p>
                      {kind !== "other" && (
                        <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${tierBadgeStyle[kind]}`}>
                          {tierLabel[kind]}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted">{l.book_count} books</p>
                  </>
                );
                return isValidSlug(l.slug) ? (
                  <Link
                    key={l.id}
                    href={`/lists/${l.slug}`}
                    className="p-3.5 rounded-xl border border-border bg-surface hover:shadow-md hover:border-accent/20 transition-all block"
                  >
                    {content}
                  </Link>
                ) : (
                  <div
                    key={l.id}
                    className="p-3.5 rounded-xl border border-border bg-surface block"
                  >
                    {content}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

      {/* Series Context */}
      {hasSeries && safeSeriesBooks.length > 0 && (() => {
        const currentIndex = safeSeriesBooks.findIndex((b) => b.id === book.id);
        const prevBookId = currentIndex > 0 ? safeSeriesBooks[currentIndex - 1]?.id : null;
        const nextBookId = currentIndex < safeSeriesBooks.length - 1 ? safeSeriesBooks[currentIndex + 1]?.id : null;

        const bottomSeriesBooks = safeSeriesBooks.filter(
          (b) => b.id !== book.id && b.id !== prevBookId && b.id !== nextBookId
        ).slice(0, 6);

        if (bottomSeriesBooks.length === 0) return null;

        return (
          <section className="mb-14">
            <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">More from {displayTitle(book.series!)}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
              {bottomSeriesBooks.map((b) => (
                <BookCard key={b.id} title={b.title} slug={b.slug} author={b.author} authorSlug={b.author_slug} coverUrl={b.cover_image_url} rating={b.rating} recommendationCount={b.recommendation_count} amazonUrl={b.amazon_url} />
              ))}
            </div>
          </section>
        );
      })()}

      {/* Also By Author */}
      {safeAuthorBooks.filter((b) => b.id !== book.id).length > 0 && (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">Also by {book.author}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
            {safeAuthorBooks.filter((b) => b.id !== book.id).map((b) => (
              <BookCard key={b.id} title={b.title} slug={b.slug} author={b.author} authorSlug={b.author_slug} coverUrl={b.cover_image_url} rating={b.rating} recommendationCount={b.recommendation_count} amazonUrl={b.amazon_url} />
            ))}
          </div>
        </section>
      )}

      {/* Similar Books — list/topic co-membership first, then series + author fallback.
          Deduped and capped at 8. Section appears even when series/author are empty
          as long as co-membership returns results. */}
      {/* Try this instead section */}
      {alternativeCandidate && (
        <section className="mb-14 rounded-2xl border border-amber-100 bg-amber-50/15 p-6 md:p-8">
          <div className="flex flex-col md:flex-row gap-6 items-start">
            <div className="w-24 shrink-0 aspect-[2/3] rounded-lg overflow-hidden shadow-sm bg-subtle">
              <SafeImage
                src={alternativeCandidate.cover_image_url}
                alt={displayBookTitle(alternativeCandidate.title)}
                className="w-full h-full object-cover"
                fallback={<div className="w-full h-full bg-border flex items-center justify-center text-[10px] text-muted">No Cover</div>}
              />
            </div>
            <div className="flex-1">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-xs font-semibold uppercase tracking-wider mb-2">
                Try This Instead
              </span>
              <h3 className="text-lg font-bold text-ink mb-1">
                Not sure if this is the right fit?
              </h3>
              <p className="text-sm text-muted mb-4">
                Consider <span className="font-semibold text-ink">{displayBookTitle(alternativeCandidate.title)}</span> by {alternativeCandidate.author}. 
                {alternativeCandidate.recommendation_count > 0 && ` Recommended by ${alternativeCandidate.recommendation_count} sources.`}
              </p>

              {alternativeCandidate.editorial_summary && (
                <p className="text-xs text-muted leading-relaxed italic border-l border-amber-200 pl-3 mb-4 line-clamp-2">
                  &ldquo;{sanitizeEditorialText(alternativeCandidate.editorial_summary)}&rdquo;
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/books/${alternativeCandidate.slug}`}
                  className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 shadow-sm"
                >
                  View book details →
                </Link>
                {!normalizedAmazonUrl && (() => {
                  // try-this-instead is the fallback CTA when the *current*
                  // book has no usable Amazon URL. We surface the alternative
                  // book's Amazon link only after normalizing it, so a broken
                  // /dp/<22-char-ASIN> alternative also renders cleanly (or
                  // is suppressed if the alternative's URL is non-Amazon).
                  const altUrl = normalizeAmazonUrl(alternativeCandidate.amazon_url);
                  if (!altUrl) return null;
                  return (
                    <a
                      href={altUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow sponsored"
                      data-track-slug={alternativeCandidate.slug}
                      data-track-section="try-this-instead"
                      data-track-label="Check price on Amazon"
                      className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold shadow-sm"
                    >
                      Check price on Amazon
                    </a>
                  );
                })()}
              </div>
            </div>
          </div>
        </section>
      )}

      {similarBooks.length > 0 && (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">Similar books</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
            {similarBooks.map((b) => (
              <BookCard key={b.id} title={b.title} slug={b.slug} author={b.author} authorSlug={b.author_slug} coverUrl={b.cover_image_url} rating={b.rating} recommendationCount={b.recommendation_count} amazonUrl={b.amazon_url} />
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
          </div> {/* min-w-0 right column closed */}
        </div> {/* lg:grid closed */}
      </div> {/* max-w-7xl content wrapper closed */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              document.addEventListener('click', function(e) {
                // Click outside to close details popovers
                var popovers = document.querySelectorAll('details.recommenders-popover[open]');
                popovers.forEach(function(p) {
                  if (!p.contains(e.target)) {
                    p.removeAttribute('open');
                  }
                });

                var target = e.target.closest('a[data-track-section]');
                if (target) {
                  var slug = target.getAttribute('data-track-slug') || '';
                  var section = target.getAttribute('data-track-section') || '';
                  var label = target.getAttribute('data-track-label') || '';
                  
                  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    console.log('[Analytics] Outbound Click:', {
                      book_slug: slug,
                      page_section: section,
                      cta_label: label
                    });
                  }
                  
                  try {
                    if (typeof window.gtag === 'function') {
                      window.gtag('event', 'outbound_click', {
                        book_slug: slug,
                        page_section: section,
                        cta_label: label
                      });
                    }
                    if (window.umami && typeof window.umami.track === 'function') {
                      window.umami.track('outbound_click', {
                        book_slug: slug,
                        page_section: section,
                        cta_label: label
                      });
                    }
                    if (window.plausible && typeof window.plausible === 'function') {
                      window.plausible('outbound_click', {
                        props: {
                          book_slug: slug,
                          page_section: section,
                          cta_label: label
                        }
                      });
                    }
                  } catch (err) {
                    // ignore
                  }
                }
              });
            })();
          `,
        }}
      />

      {/* Sticky mobile Amazon CTA — fixed bottom bar on viewports < lg only.
          Renders only when book.amazon_url is a valid http(s) URL. The
          desktop right-rail CTA stays in place; this bar is purely additive
          for mobile and tablet, where the primary CTA otherwise lives
          below the fold for most book detail pages. Same rel / target /
          tracking attributes as the existing CTAs. Page-wrapper has
          `pb-28 lg:pb-8` so the last section is not covered. */}
      {normalizedAmazonUrl && (
        <div
          className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-border shadow-[0_-4px_12px_rgba(0,0,0,0.06)] px-3 pt-2.5 flex items-center gap-3"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))", paddingTop: "0.75rem" }}
          role="region"
          aria-label="Buy this book"
        >
          {hasCover ? (
            <SafeImage
              src={book.cover_image_url}
              alt={book.title}
              className="w-10 h-14 object-cover rounded shrink-0"
              fallback={<div className="w-10 h-14 bg-subtle rounded shrink-0" aria-hidden />}
            />
          ) : (
            <div className="w-10 h-14 bg-subtle rounded shrink-0" aria-hidden />
          )}
          <p className="text-xs font-semibold text-ink line-clamp-1 flex-1 min-w-0">
            {displayBookTitle(book.title)}
          </p>
          <a
            href={normalizedAmazonUrl}
            target="_blank"
            rel="noopener noreferrer nofollow sponsored"
            data-track-slug={book.slug}
            data-track-section="sticky-mobile"
            data-track-label="View on Amazon"
            className="px-4 py-3 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-xs font-bold whitespace-nowrap transition-colors shrink-0"
          >
            View on Amazon →
          </a>
        </div>
      )}
    </div>
  );
}
