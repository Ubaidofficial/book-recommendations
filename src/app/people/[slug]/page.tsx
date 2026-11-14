import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getPersonBySlugCached,
  getBooksByAuthorCached,
  getPersonRecommendedCountCached,
  getPersonWrittenCountCached,
  getQualityPeopleCached,
} from "@/lib/data";
import { pageMetadata, contentDates } from "@/lib/seo";
import { detailRobotsDirective } from "@/lib/indexing";
import { isPersonPageThin } from "@/lib/thinPages";
import { personJsonLd, faqPageJsonLd } from "@/lib/jsonld";
import {
  getPersonShelf,
  getPersonLibrary,
  getPersonTopics,
  getPersonSeries,
  getCoRecommenders,
  getSimilarShelves,
  buildPersonFaq,
  firstNameOf,
  type ShelfBook,
  type LibraryRow,
  type PersonTopic,
  type SimilarShelf,
} from "@/lib/personInsights";
import { PersonShelf } from "@/components/person/PersonShelf";
import { PersonLibrary, type LibraryItem, type LibraryTopic, type LibraryRecommender } from "@/components/person/PersonLibrary";
import { ShareButton } from "@/components/person/ShareButton";
import { PersonTopics } from "@/components/person/PersonTopics";
import { SimilarShelves } from "@/components/person/SimilarShelves";
import { PersonFaq } from "@/components/person/PersonFaq";
import { toSpines } from "@/components/person/spines";
import {
  isValidHttpUrl,
  formatConfidence,
  isUsefulDescription,
  isUsefulPersonBio,
  uniqueByNormalizedText,
  parseSourceUrls,
  outboundLinkRel,
  normalizeOutboundUrl,
  getProofDisplaySafety,
  amazonCtaUrl,
} from "@/lib/dataQuality";
import { Avatar, BookCard, Breadcrumbs, SafeImage, LastUpdated } from "@/components";
import { photoCredit } from "@/lib/photoCredit";
import { getRedditMentions, redditHeadline, redditLabel } from "@/lib/reddit";

/**
 * Incremental static regeneration.
 *
 * This page had no caching declaration, so every request server-rendered it
 * against Supabase — production TTFB measured 1-8 seconds, against Google's
 * 0.8s "good" threshold, on a page whose content changes rarely.
 *
 * It reads only `params`, never searchParams/cookies/headers, so it qualifies
 * for ISR: serve cached HTML instantly, regenerate in the background every
 * five minutes. Recommendation data is not real-time; five minutes of
 * staleness costs nothing a visitor would notice.
 */
export const revalidate = 300;

interface Props {
  params: Promise<{ slug: string }>;
}

/** Shorten a quote at a word boundary. The full text lives on the book's own page. */
function shortenQuote(text: string, max = 260): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > max * 0.6 ? space : max).replace(/[\s,;:.\-–—]+$/, "")}…`;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const person = await getPersonBySlugCached(slug);
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
    // index_status, plus the thin-page floor (src/lib/indexing.ts).
    robots: detailRobotsDirective(person, await isPersonPageThin(person)),
  });
}

export default async function PersonDetailPage({ params }: Props) {
  const { slug } = await params;
  const person = await getPersonBySlugCached(slug);
  if (!person) notFound();

  let writtenBooks: Awaited<ReturnType<typeof getBooksByAuthorCached>> = [];
  let library: LibraryRow[] = [];
  let recommendedCount = 0;
  let writtenCount = 0;
  let otherPeople: Awaited<ReturnType<typeof getQualityPeopleCached>> = [];
  let shelf: ShelfBook[] = [];
  let topics: PersonTopic[] = [];
  let similar: SimilarShelf[] = [];
  let seriesByBook: Awaited<ReturnType<typeof getPersonSeries>> = {};
  let coRecs: Awaited<ReturnType<typeof getCoRecommenders>> = { people: [], byBook: {} };
  let reddit: Awaited<ReturnType<typeof getRedditMentions>> = {};

  try {
    // Person pages linked to books and to nothing else — zero person->person
    // links across the whole site. That strands every profile as a dead end
    // for a crawler walking the graph, and leaves the deeper profiles with no
    // internal path to them at all.
    let qualityPeople: Awaited<ReturnType<typeof getQualityPeopleCached>>;
    [writtenBooks, library, recommendedCount, writtenCount, qualityPeople, shelf] = await Promise.all([
      getBooksByAuthorCached(person.id, 24),
      getPersonLibrary(person.id),
      getPersonRecommendedCountCached(person.id),
      getPersonWrittenCountCached(person.id),
      getQualityPeopleCached(40),
      getPersonShelf(person.id),
    ]);
    otherPeople = qualityPeople
      .filter((p) => p && p.slug && p.slug !== person.slug && p.name)
      .slice(0, 8);
  } catch (e) {
    console.error("[person-detail] Relation queries failed:", e);
  }

  // Shelf-derived sections: topics and overlap both start from the full set
  // of this person's book ids. Each helper already returns [] on failure.
  const shelfIds = shelf.map((b) => b.id);
  try {
    [topics, similar, seriesByBook, coRecs, reddit] = await Promise.all([
      getPersonTopics(person.id, shelfIds, 8),
      getSimilarShelves(person, shelfIds, 8),
      getPersonSeries(person.id, shelfIds),
      getCoRecommenders(person, shelfIds),
      getRedditMentions(`person:${person.id}`, shelfIds),
    ]);
  } catch (e) {
    console.error("[person-detail] Shelf insights failed:", e);
  }
  const firstName = firstNameOf(person.name);
  const shelfById = new Map(shelf.map((b) => [b.id, b]));
  const similarCards = similar.map((s) => ({
    slug: s.slug,
    name: s.name,
    role: s.role,
    avatarUrl: s.avatar_url,
    shared: s.shared,
    comparable: s.comparable,
    examples: s.sharedBookIds
      .map((id) => shelfById.get(id))
      .filter((b): b is ShelfBook => b != null)
      .sort((a, b) => b.recommendation_count - a.recommendation_count)
      .slice(0, 2)
      .map((b) => b.title),
  }));
  const faq = buildPersonFaq({ name: person.name, shelf, topics, similar });
  const faqLd = faqPageJsonLd(faq);

  const safeWrittenBooks = writtenBooks.filter((b) => b != null && b.id);
  // Library rows arrive best-evidenced first (confidence, then id), so the
  // proof cards below keep showing the strongest sources — now picked from
  // every recommendation instead of only the first 24.
  const safeProof = library.map((r) => ({
    book: { id: r.id, slug: r.slug, title: r.title, author: r.author },
    source_url: r.source_url,
    source_name: r.source_name,
    quote: r.quote,
    confidence_score: r.confidence_score,
  }));
  const recommendationProof = uniqueByNormalizedText(safeProof, "quote");
  const hasAvatar = isValidHttpUrl(person.avatar_url);
  const jsonld = personJsonLd(person);
  // A lone book with no cover renders as a grey placeholder card, which reads
  // as a broken section. Show the section only when at least one book has a
  // real cover.
  const hasWritten = safeWrittenBooks.some((b) => isValidHttpUrl(b.cover_image_url));
  const hasRecommendations = library.length > 0;
  // Use the lighter-weight person-bio gate so hand-curated one-sentence
  // bios (Phase A backfill: 44–109 chars) render as visible paragraphs.
  // The page's meta-description fallback (line ~33) and the JSON-LD
  // description field still use isUsefulDescription — those are SEO
  // surfaces where the stricter 80-char + English + junk-pattern gate is
  // intentionally retained.
  const hasBio = isUsefulPersonBio(person.bio);
  const credit = hasAvatar ? photoCredit(person) : null;

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

  // Spine shelf: the 16 picks most recommended across the site. The panel
  // links down to a proof card only when this page actually renders one.
  const proofSlugs = new Set(proofList.map((p) => p.book.slug).filter(Boolean));
  // The full list: one compact item per book. Quotes only appear when
  // getProofDisplaySafety clears them; sources only when there is exactly one
  // trustworthy URL. Topic membership becomes indexes into `libraryTopics`.
  const libraryTopics: LibraryTopic[] = topics.map((t) => ({ slug: t.slug, title: t.title, count: t.count }));
  const topicsByBook = new Map<string, number[]>();
  topics.forEach((t, i) => {
    for (const id of t.bookIds) {
      const list = topicsByBook.get(id);
      if (list) list.push(i);
      else topicsByBook.set(id, [i]);
    }
  });
  const libraryItems: LibraryItem[] = library
    .map((r) => {
      const safety = getProofDisplaySafety(
        { quote: r.quote, source_url: r.source_url, source_name: r.source_name, confidence_score: r.confidence_score, book: { slug: r.slug, title: r.title } },
        person,
      );
      const source = safety.showSource ? parseSourceUrls(r.source_url)[0] ?? null : null;
      return {
        slug: r.slug,
        title: r.title,
        author: r.author,
        cover: isValidHttpUrl(r.cover_image_url) ? (r.cover_image_url as string) : "",
        score: r.rating != null && r.rating > 0 ? r.rating : null,
        recs: r.recommendation_count,
        year: r.first_published_year,
        amazon: amazonCtaUrl({ title: r.title, author: r.author, amazon_url: r.amazon_url }),
        topics: topicsByBook.get(r.id) ?? [],
        quote: safety.showQuote && safety.displayQuote ? shortenQuote(safety.displayQuote) : null,
        source,
        sourceHost: source ? hostOf(source) : null,
        sourceRel: source ? outboundLinkRel(source) : "noopener noreferrer nofollow",
        series: seriesByBook[r.id] ?? null,
        also: coRecs.byBook[r.id]?.idx ?? [],
        alsoTotal: coRecs.byBook[r.id]?.total ?? 0,
        reddit: (() => {
          const h = redditHeadline(reddit[r.id]);
          return h ? { users: h.users, label: redditLabel(h.subreddit) } : null;
        })(),
      };
    })
    // Same order the client starts in, so the server-rendered first page and
    // the hydrated default agree.
    .sort((a, b) => b.recs - a.recs || a.title.localeCompare(b.title));
  const libraryRecommenders: LibraryRecommender[] = coRecs.people.map((p) => ({ slug: p.slug, name: p.name, avatarUrl: p.avatar_url }));
  const itemBySlug = new Map(libraryItems.map((i) => [i.slug, i]));

  // 24 spines (was 16): the shelf is the page's showpiece, and it scrolls
  // sideways, so more books cost no height.
  const spines = toSpines(shelf.slice(0, 24), proofSlugs).map((sp) => {
    const it = itemBySlug.get(sp.slug);
    return it ? { ...sp, quote: it.quote, source: it.source, sourceHost: it.sourceHost, sourceRel: it.sourceRel } : sp;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      {jsonld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonld) }} />}
      {faqLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />}
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "People", href: "/people" }, { label: person.name }]} />

      {/* Hero: portrait and who they are on the left, the shelf at a glance
          on the right, so the line is balanced at desktop widths. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12 items-start mt-2 mb-10">
        <div className="flex flex-col sm:flex-row items-start gap-6 md:gap-8 min-w-0">
          <figure className="m-0 flex flex-col items-center shrink-0 gap-2">
            <div className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-subtle overflow-hidden ring-1 ring-border ring-offset-4 ring-offset-bg flex items-center justify-center">
              {hasAvatar ? (
                <SafeImage
                  src={person.avatar_url}
                  // A bare name repeats the H1 directly above it. Naming what
                  // the image is, and the page it sits on, describes it for
                  // image search instead.
                  alt={`${person.name}${person.role ? `, ${person.role}` : ""} — book recommendations`}
                  className="w-full h-full object-cover"
                  loading="eager"
                  width={128}
                  height={128}
                  fallback={<span className="font-serif text-3xl text-muted/50">{person.name.charAt(0)}</span>}
                />
              ) : (
                <span className="font-serif text-3xl text-muted/50">{person.name.charAt(0)}</span>
              )}
            </div>
            {/* Licence credit for CC BY / CC BY-SA portraits: author and the
                source's host name, linked to the source (src/lib/photoCredit).
                Public-domain photos with no author or licence get no line. */}
            {credit && (
              <figcaption className="text-[11px] leading-snug text-muted text-center max-w-[10rem]">
                {credit.href ? (
                  <a
                    href={credit.href}
                    target="_blank"
                    rel={outboundLinkRel(credit.href)}
                    className="hover:text-accent hover:underline underline-offset-2"
                    title={credit.full}
                  >
                    {credit.text}
                  </a>
                ) : (
                  <span title={credit.full}>{credit.text}</span>
                )}
              </figcaption>
            )}
          </figure>
          <div className="min-w-0">
            <p className="eyebrow text-accent mb-3">Reading list</p>
            {/*
              The H1 is the page's strongest on-page signal and a bare name
              spends it on a term this page does not compete for — nobody
              searches "Bill Gates" hoping for a reading list. The searched
              phrase is "<name> recommended books", so the heading states what
              the page actually is. The name stays first for readability.

              Two visual lines, one phrase: the space between them keeps the
              text content "<name> Recommended Books" for screen readers,
              search and copy-paste.
            */}
            <h1 className="type-h1 text-ink">
              {person.name}{" "}
              <span className="block mt-1 font-sans text-base md:text-lg font-medium tracking-normal text-muted-strong">
                Recommended Books
              </span>
            </h1>
            {person.role && person.role.trim().length > 0 && (
              <p className="mt-4 text-sm text-accent font-semibold">{person.role}</p>
            )}
            {hasBio && <p className="mt-2 prose-body text-muted-strong">{person.bio}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <LastUpdated modified={contentDates(person).modified} className="text-xs text-muted" />
              <ShareButton title={`${person.name} — recommended books`} />
            </div>
            <div className="mt-6 pt-5 border-t border-border flex flex-col gap-2.5 max-w-[60ch]">
              {normalizeOutboundUrl(person.source_url) && (
                <Link
                  href={normalizeOutboundUrl(person.source_url)!}
                  target="_blank"
                  rel={outboundLinkRel(person.source_url)}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline w-fit"
                >
                  Profile source →
                </Link>
              )}
              {/* Compact trust note — surfaces methodology near the top so the
                  reader frames the page's recommendations correctly before
                  scrolling. Conservative language ("sourced from") avoids
                  overclaiming accuracy. */}
              <p className="flex items-start gap-2 text-xs text-muted leading-relaxed">
                <svg className="w-4 h-4 text-accent shrink-0 mt-px" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span>
                  Recommendations are sourced from public posts, interviews, and reading lists. Books with available evidence include proof links below.
                </span>
              </p>
            </div>
          </div>
        </div>

        <aside aria-label={`${person.name}’s shelf at a glance`} className="rounded-2xl border border-border bg-surface p-6 shadow-[0_30px_60px_-40px_rgba(58,40,28,0.35)]">
          <p className="eyebrow text-muted">At a glance</p>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5">
            <div className="flex flex-col-reverse">
              <dt className="mt-1.5 text-xs text-muted">{recommendedCount === 1 ? "book recommended" : "books recommended"}</dt>
              <dd className="stat-num text-4xl text-accent">
                <a href="#books-h" className="hover:underline underline-offset-4 decoration-accent/40">
                  {recommendedCount.toLocaleString("en-US")}
                </a>
              </dd>
            </div>
            <div className="flex flex-col-reverse">
              <dt className="mt-1.5 text-xs text-muted">{writtenCount === 1 ? "book written" : "books written"}</dt>
              <dd className="stat-num text-4xl text-ink">{writtenCount.toLocaleString("en-US")}</dd>
            </div>
            {topics.length > 0 && (
              <div className="col-span-2 border-t border-border pt-4">
                <dt className="text-xs text-muted">Reads most about</dt>
                <dd className="mt-2 flex flex-wrap gap-1.5">
                  {topics.slice(0, 3).map((t) => (
                    <Link
                      key={t.slug}
                      href={`/lists/${t.slug}`}
                      className="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-xs font-medium text-ink hover:border-accent/40 hover:text-accent transition-colors"
                    >
                      {t.title}
                    </Link>
                  ))}
                </dd>
              </div>
            )}
            {similar.length > 0 && (
              <div className="col-span-2 border-t border-border pt-4">
                <dt className="text-xs text-muted">Closest shelf</dt>
                <dd className="mt-1 text-sm text-ink">
                  <Link href={`/people/${similar[0].slug}`} className="font-semibold hover:text-accent transition-colors">
                    {similar[0].name}
                  </Link>
                  <span className="text-muted"> · <span className="tabular-nums">{similar[0].shared}</span> {similar[0].shared === 1 ? "book" : "books"} in common</span>
                </dd>
              </div>
            )}
          </dl>
        </aside>
      </div>

      {/* In-page jump links: the page is long, and on a phone the sections
          below the list are a long scroll away. Plain anchors, no script. */}
      <nav aria-label="On this page" className="-mt-4 mb-10 -mx-4 px-4 md:mx-0 md:px-0 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[
          ...(spines.length >= 3 ? [{ href: "#shelf-h", label: "Shelf" }] : []),
          ...(hasRecommendations ? [{ href: "#books-h", label: `All books · ${libraryItems.length.toLocaleString("en-US")}` }] : []),
          ...(topics.length > 0 ? [{ href: "#topics-h", label: "Topics" }] : []),
          ...(proofList.length > 0 ? [{ href: "#proof-h", label: "Sources" }] : []),
          ...(faq.length > 0 ? [{ href: "#faq-h", label: "FAQ" }] : []),
        ].map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="shrink-0 inline-flex items-center min-h-10 px-4 rounded-full border border-border bg-surface text-xs font-semibold text-ink hover:border-accent/40 hover:text-accent transition-colors"
          >
            {l.label}
          </a>
        ))}
      </nav>

      {/* On the shelf — the person's most-recommended picks as spines. */}
      {spines.length >= 3 && (
        <section className="mb-14 scroll-mt-20" aria-labelledby="shelf-h">
          <h2 data-reveal id="shelf-h" className="type-h2 text-ink mb-1.5">On the shelf</h2>
          <p data-reveal className="text-sm text-muted max-w-2xl mb-5">
            {spines.length === shelf.length
              ? `All ${shelf.length} of ${firstName}’s picks. Choose a book to take it off the shelf.`
              : `The ${spines.length} of ${firstName}’s ${shelf.length.toLocaleString("en-US")} picks that the most people recommend. Choose a book to take it off the shelf.`}
          </p>
          <PersonShelf books={spines} firstName={firstName} totalCount={libraryItems.length} />
        </section>
      )}

      {/* Recommended Books */}
      {hasRecommendations ? (
        <section className="mb-14 scroll-mt-20" aria-labelledby="books-h">
          <h2 data-reveal id="books-h" className="type-h2 text-ink mb-1.5">
            {libraryItems.length > 1 ? `All ${libraryItems.length.toLocaleString("en-US")} books ` : "Books "}
            {firstName} recommends
          </h2>
          <p data-reveal className="text-sm text-muted max-w-2xl mb-5">
            {libraryItems.length > 12 ? "Sort, filter by topic or search the whole list. " : ""}
            Where we have {firstName}’s own words about a book, they appear on its card with a link to the source.
          </p>
          <PersonLibrary items={libraryItems} topics={libraryTopics} recommenders={libraryRecommenders} firstName={firstName} />
        </section>
      ) : (
        <section className="mb-14">
          <h2 data-reveal className="type-h2 text-ink mb-5">Recommended Books</h2>
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

      <PersonTopics topics={topics} firstName={firstName} totalBooks={shelf.length} />
      <SimilarShelves personSlug={person.slug} firstName={firstName} people={similarCards} />

      {/* Books Written */}
      {hasWritten && (
        <section className="mb-14">
          <h2 data-reveal className="type-h2 text-ink mb-5">Books by {person.name}</h2>
          <div data-reveal-stagger className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
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
        <h2 data-reveal id="proof-h" className="type-h2 text-ink mb-5 scroll-mt-20">{proofHeading}</h2>
        {proofList.length > 0 ? (
          <div data-reveal-stagger className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

      <PersonFaq heading={`Questions about ${firstName}’s reading list`} items={faq} />

      {/* How this profile is built */}
      <section className="rounded-2xl border border-border bg-surface p-5 md:p-7">
        <h2 className="type-h3 text-ink mb-2">How this profile is built</h2>
        <p className="text-sm text-muted leading-relaxed">
          This profile tracks book recommendations and authored books for {person.name}. We compile recommendations from public sources such as interviews, articles, social posts, and reading lists, and link to the original source wherever we have one. Some recommendations don&apos;t have a source link yet; those are shown without one. If a recommendation looks wrong or wrongly attributed, please report it.
        </p>
      </section>

      {/*
        Other recommenders.

        Before this, a profile linked out to books and to nothing else — there
        were zero person-to-person links anywhere on the site, so each profile
        was a leaf a crawler could enter but never traverse sideways, and the
        deeper profiles had no internal path pointing at them at all. This is
        also the cheapest fix for that: eight sibling links per profile turns
        a set of isolated pages into a connected neighbourhood.
      */}
      {otherPeople.length > 0 && (
        <section className="mt-10 pt-8 border-t border-border">
          <h2 className="type-h3 text-ink mb-1">Other recommenders</h2>
          <p className="text-sm text-muted mb-5">
            More reading lists from people whose recommendations we track.
          </p>
          <ul data-reveal-stagger className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {otherPeople.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/people/${p.slug}`}
                  className="group flex items-center gap-3 rounded-xl border border-border bg-surface p-3 hover:border-accent/30 transition-colors"
                >
                  <Avatar
                    name={p.name}
                    slug={p.slug}
                    avatarUrl={p.avatar_url}
                    sizeClass="w-9 h-9"
                    textClass="text-xs"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink truncate group-hover:text-accent transition-colors">
                      {p.name}
                    </span>
                    <span className="block text-xs text-muted truncate">
                      {/* Anchor text carries the phrase the target page ranks
                          for, not a bare name. */}
                      Recommended books
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

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
