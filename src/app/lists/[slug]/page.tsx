import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getListBySlugCached, getBooksForListCached, getBooksForListByRecommendationsCached, getRelatedListsCached, getRecommendersForBooksCached, getRecommenderRefsForBooksCached } from "@/lib/data";
import { pageMetadata, robotsDirective, contentDates, listPageTitle, withUpdatedYear } from "@/lib/seo";
import { displayBookTitle, displayListTitle, displayListTitleFull, listKindFromSlug, listKindLabel } from "@/lib/display";
import { isProbablyValidBookTitle, repairNumericTitle, isValidHttpUrl, isValidRating, formatRating, amazonCtaUrl,
  coverAltText,
} from "@/lib/dataQuality";
import { itemListJsonLd } from "@/lib/jsonld";
import { getIndexableBookSlugs, bookLinkRel } from "@/lib/indexableBooks";
import { isDisplayableCover } from "@/lib/siteNav";
import { getListVisuals } from "@/lib/collectionVisuals";
import { getRedditMentions, redditHeadline, redditLabel, REDDIT_AS_OF_LABEL, REDDIT_SOURCE_NAME, REDDIT_SOURCE_URL } from "@/lib/reddit";
import { CoverMarquee } from "@/components/CoverMarquee";
import { AmazonCoverLink, Avatar, Breadcrumbs, SafeImage, EmptyState, LastUpdated } from "@/components";
import { RelatedListCards } from "@/components/RelatedCards";
import { ListSortControls } from "@/components/ListSortControls";

// ISR: each list is generated on its first request and cached for `revalidate` seconds.
// Two things keep it that way, and both are needed: no `searchParams` read (the A–Z sort is a
// client-side view setting, see ListSortControls) and a `generateStaticParams` export. Without
// either, the route is fully dynamic (Cache-Control: private, no-store) whatever `revalidate` says.
export const revalidate = 300;

export async function generateStaticParams() {
  return [];
}

interface Props {
  params: Promise<{ slug: string }>;
}

/**
 * Hand-written title/description for a list whose generated ones do not fit the searches it ranks for.
 * Every book named must be on the list, and the text must not claim more than the data shows.
 *
 * best-cryptography-books: 2026-08..11 it held ~5,500 impressions at position 5-7 and no clicks. The
 * generated description led with the two novels (Snow Crash, Cryptonomicon) because they carry all the
 * recommendations, while the queries ("cryptography books 2024/2025/2026") read as textbook searches.
 * The year stays in the title: the searches themselves carry it.
 */
const LIST_META_OVERRIDES: Record<string, { title: string; description: string }> = {
  "best-cryptography-books": {
    title: "Best Cryptography Books (2026): Textbooks & Novels",
    description:
      "Cryptography books from textbooks to novels: Applied Cryptography, Foundations of Cryptography, The Code Book, Snow Crash and Cryptonomicon.",
  },
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const list = await getListBySlugCached(slug);
  if (!list) return { robots: "noindex, follow" };
  const displayName = displayListTitle(list.title, list.slug);
  // The title tag carries the phrase people actually search ("Best Philosophy
  // Books"), not the bare subject; displayName stays short for prose.
  const seoName = displayListTitleFull(list.title, list.slug);
  // The first ranked book with a real cover represents the list on share
  // cards. Only the top book was tried before, and ~19 of 31 new lists lead
  // with a filename-only cover that doesn't resolve, so they had no image.
  // Same cached call the page body makes, so this adds no query.
  let ogImage: string | undefined;
  let topBooks: Awaited<ReturnType<typeof getBooksForListCached>> = [];
  try {
    topBooks = await (listKindFromSlug(list.slug) === "meta"
      ? getBooksForListByRecommendationsCached(list.id, LIST_PAGE_SIZE)
      : getBooksForListCached(list.id, LIST_PAGE_SIZE));
    ogImage = topBooks.map((b) => b.cover_image_url).find(isValidHttpUrl) ?? undefined;
  } catch {
    // A missing share image is not worth failing metadata generation over.
  }

  const override = LIST_META_OVERRIDES[list.slug];
  return pageMetadata({
    // "(2026): Most Recommended Picks": the year and hook people search for (see listPageTitle).
    title: override?.title ?? listPageTitle(seoName),
    description: override ? withUpdatedYear(override.description) : withUpdatedYear(listMetaDescription(list.description, seoName, topBooks)),
    path: `/lists/${list.slug}`,
    image: ogImage,
    robots: robotsDirective(list),
  });
}

/**
 * Books rendered on a list page. Raised from 48: book_count on these rows
 * runs into the hundreds or thousands, so the page was showing a small
 * fraction and labelling it as the whole list.
 */
const LIST_PAGE_SIZE = 100;

const META_DESC_MAX = 160;

/** "A, B and C" → ["A", "B", "C"]. Safe for people's names only. */
function splitNames(text: string): string[] {
  return text.split(/,\s*|\s+and\s+/).map((x) => x.trim()).filter(Boolean);
}

/**
 * Book titles carry commas and "and" ("Thinking, Fast and Slow", "Think and
 * Grow Rich"), so the picks sentence can't be split on them. Instead find the
 * list's own book titles inside it; if they don't account for the whole
 * sentence, return [] and the caller keeps it whole or drops it.
 */
function splitBookTitles(text: string, books: { title?: string | null }[]): string[] {
  const lower = text.toLowerCase();
  const spans: { start: number; end: number }[] = [];
  for (const b of books) {
    const t = displayBookTitle(repairNumericTitle(b.title)).trim();
    if (t.length < 2) continue;
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0) spans.push({ start: i, end: i + t.length });
  }
  // Longest match first so "On Writing Well" wins over "On Writing".
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: { start: number; end: number }[] = [];
  for (const sp of spans) {
    if (kept.some((k) => sp.start < k.end && sp.end > k.start)) continue;
    kept.push(sp);
  }
  const titles = kept.sort((a, b) => a.start - b.start).map((k) => text.slice(k.start, k.end));
  return joinNames(titles) === text ? titles : [];
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Meta description that fits the snippet budget.
 *
 * Stored list descriptions read "<Topic> books, including titles recommended
 * by A, B and C. Most recommended here: X, Y and Z." and run 150–230 chars,
 * so the sentence-boundary clamp dropped the second sentence — the one naming
 * actual books — and left ~95-char snippets. Shortening the name lists keeps
 * both sentences. Lists with no description get one built from their top
 * books instead of a generic line.
 */
function listMetaDescription(
  stored: string | null | undefined,
  seoName: string,
  books: { title?: string | null; recommendation_count?: number | null }[],
): string {
  // "Best Cryptography Books, ranked by how many people recommend each one. Most recommended: ..." leads with the
  // phrase people search and says how the list is ranked (the page's own point of difference); it names the real
  // top picks. People lists ("Books Recommended by Elon Musk") keep their stored text: the ranking sentence
  // does not describe them.
  if (!/^books recommended by /i.test(seoName)) {
    // Name the books people actually recommend most. Topic lists arrive in curation-rank order (alphabetical,
    // for many), so sort by recommendation count first and skip books nobody recommends; with fewer than two
    // such books the stored description is kept.
    const picks = [...books]
      .filter((b) => (b.recommendation_count || 0) > 0)
      .sort((a, b) => (b.recommendation_count || 0) - (a.recommendation_count || 0))
      .map((b) => displayBookTitle(repairNumericTitle(b.title)))
      .filter((t) => isProbablyValidBookTitle(t) && !t.includes(","));
    for (const n of [3, 2]) {
      if (picks.length < n) continue;
      const out = `${seoName}, ranked by how many people recommend each one. Most recommended here: ${joinNames(picks.slice(0, n))}.`;
      if (out.length <= META_DESC_MAX) return out;
    }
  }
  const text = (stored || "").replace(/\s+/g, " ").trim();
  if (text && text.length <= META_DESC_MAX) return text;

  const m = text.match(/^(.+?), including titles recommended by (.+?)\.(?: Most recommended here: (.+?)\.)?$/);
  if (m) {
    const [, head, recs, picks] = m;
    const r = splitNames(recs);
    const p = picks ? splitBookTitles(picks, books) : [];
    // Unsplittable picks can still be used whole.
    const pickSets = p.length ? [3, 2, 1].map((n) => p.slice(0, n)) : picks ? [[picks]] : [];
    const combos: [number, string[]][] = [];
    for (const ps of pickSets) combos.push([3, ps], [2, ps]);
    combos.push([3, []], [2, []]);
    for (const [rn, ps] of combos) {
      let out = `${head}, including titles recommended by ${joinNames(r.slice(0, rn))}.`;
      if (ps.length) out += ` Most recommended here: ${joinNames(ps)}.`;
      if (out.length <= META_DESC_MAX) return out;
    }
  }
  if (text) return text;

  const titles = books
    .map((b) => displayBookTitle(repairNumericTitle(b.title)))
    .filter((t) => isProbablyValidBookTitle(t))
    .slice(0, 3);
  const lead = `The ${seoName.toLowerCase()} and the people who recommend them.`;
  for (let n = titles.length; n > 0; n--) {
    const out = `${lead} Includes ${joinNames(titles.slice(0, n))}.`;
    if (out.length <= META_DESC_MAX) return out;
  }
  return lead;
}


/**
 * Auto-generated "recommendation context" text that says nothing about the
 * book ("Available recommendation signals cluster around ...") is dropped;
 * only a real quote or note from a recommender is shown.
 */
function usableContext(value: string | null | undefined): string {
  const v = (value || "").trim();
  if (!v || /^available recommendation signals/i.test(v)) return "";
  return v;
}

/**
 * Publisher blurbs arrive cut off mid-sentence, with lost punctuation
 * rendered as "?" between letters, or as scarce-reprint boilerplate. Those
 * read as broken, so they are dropped rather than shown; the rest is trimmed
 * at a sentence boundary.
 */
function cleanBlurb(value: string | null | undefined): string {
  let v = (value || "").replace(/\s+/g, " ").trim();
  if (v.length < 40) return "";
  if (/[A-Za-z0-9]\?[A-Za-z]|\s\?[A-Za-z]/.test(v)) return "";
  if (/scarce antiquarian|this is a reproduction of a book published before|reprint of the original/i.test(v)) return "";
  v = v.replace(/\.{3}$|…$/, "").trim();
  if (v.length > 280) {
    const cut = v.slice(0, 280);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    v = end > 120 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" ")) + "…";
  } else if (!/[.!?"”)]$/.test(v)) {
    const end = Math.max(v.lastIndexOf(". "), v.lastIndexOf("! "), v.lastIndexOf("? "));
    if (end > 80) v = v.slice(0, end + 1);
  }
  return v;
}

/** Same book under two editions: keep the first (best-ranked) one. */
function editionKey(b: { title?: string | null; author?: string | null }): string {
  const t = (b.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const last = (b.author || "").toLowerCase().replace(/[^a-z\s]/g, "").trim().split(/\s+/).pop() || "";
  return `${t}|${last}`;
}

const MIN_RECS_PRIMARY = 2;
const MIN_PRIMARY_BOOKS = 12;

export default async function ListDetailPage({ params }: Props) {
  const { slug } = await params;
  const list = await getListBySlugCached(slug);
  if (!list) notFound();
  // Links to book pages that are not indexable are nofollow (see lib/indexableBooks.ts).
  const indexableBooks = await getIndexableBookSlugs();

  const kind = listKindFromSlug(list.slug);
  // Meta list: sort by books.recommendation_count and filter junk numeric/date titles.
  // Other lists: keep the imported rank order.
  // How many books a list page shows.
  //
  // This was 48 while book_count on the same rows ran into the thousands, so
  // a page headed "Best Mystery & Crime Books" showed 48 of 287 and captioned
  // it "48 books curated" — the visitor had no way to know the rest existed.
  // 100 matches the depth comparable sites publish and keeps a single render
  // affordable; covers below the fold are lazy-loaded.
  const booksPromise = kind === "meta"
    ? getBooksForListByRecommendationsCached(list.id, LIST_PAGE_SIZE)
    : getBooksForListCached(list.id, LIST_PAGE_SIZE);
  const [booksRaw, relatedLists] = await Promise.all([
    booksPromise,
    getRelatedListsCached(list.id, 6),
  ]);
  // Defensive junk-title repair + filter for ALL lists. If the filter would empty
  // the grid (e.g. unexpected data shape), keep the raw set so the page is never empty.
  const repaired = booksRaw.map((b) => ({ ...b, title: repairNumericTitle(b.title) }));
  const filtered = repaired.filter((b) => isProbablyValidBookTitle(b.title));
  if (booksRaw.length > 0 && filtered.length === 0) {
    console.warn(`[list=${list.slug}] title-hygiene filter removed all ${booksRaw.length} rows — falling back to raw set`);
  }
  const books = (filtered.length > 0 ? filtered : repaired).slice(0, LIST_PAGE_SIZE);

  // In-memory sort parameters
  // Who actually recommended the books on this page. Fetched after `books`
  // because it is scoped to what the page shows, not the whole list.
  const listRecommenders = await getRecommendersForBooksCached(books.map((b) => b.id), 12);
  // Reddit Reads: how many Reddit users link each book (a user count, never votes; data to March 2023).
  const redditMentions = await getRedditMentions(`list:${list.slug}`, books.map((b) => b.id));
  const redditByBook = new Map<string, { users: number; subreddit: string }>();
  for (const b of books) {
    const h = redditHeadline(redditMentions[b.id]);
    if (h) redditByBook.set(b.id, h);
  }

  // book_count is the list's true membership size; it is what the caption
  // compares against so "100 of 287" stays honest.
  const totalInList =
    typeof list.book_count === "number" && list.book_count > 0
      ? list.book_count
      : books.length;

  // Most-recommended first (recommendation_count desc, rating desc). The A–Z view is applied
  // in the browser from each row's `--az` position, so this page never depends on the request.
  const sortedBooks = [...books];
  sortedBooks.sort((a, b) => {
    const ra = typeof a.recommendation_count === "number" ? a.recommendation_count : 0;
    const rb = typeof b.recommendation_count === "number" ? b.recommendation_count : 0;
    if (ra !== rb) return rb - ra;
    const ya = typeof a.rating === "number" ? a.rating : 0;
    const yb = typeof b.rating === "number" ? b.rating : 0;
    return yb - ya;
  });

  // Calculate sum of recommendations across pre-fetched books efficiently
  const totalRecs = books.reduce((sum, b) => sum + (b.recommendation_count || 0), 0);

  const jsonld = itemListJsonLd(list, sortedBooks);
  // For "Books recommended by <person>" lists: the person's portrait (cached, fail-soft; {} on any error).
  const listPerson = (await getListVisuals([list.slug]))[list.slug]?.person ?? null;
  const displayName = displayListTitle(list.title, list.slug);
  const hasBooks = sortedBooks.length > 0;
  const hasDescription = list.description && list.description.length > 0;
  const hasRelated = relatedLists.length > 0;

  // Who recommended what, for the per-book line and the per-person sections.
  const refs = await getRecommenderRefsForBooksCached(books.map((b) => b.id));
  const personStats = new Map<string, { slug: string; name: string; bookIds: string[] }>();
  for (const r of refs) {
    const e = personStats.get(r.slug);
    if (e) e.bookIds.push(r.book_id);
    else personStats.set(r.slug, { slug: r.slug, name: r.name, bookIds: [r.book_id] });
  }
  const recsByBook = new Map<string, { slug: string; name: string }[]>();
  for (const r of refs) {
    const arr = recsByBook.get(r.book_id) || [];
    arr.push({ slug: r.slug, name: r.name });
    recsByBook.set(r.book_id, arr);
  }
  // The people who account for most of this list come first on every book.
  for (const arr of recsByBook.values()) {
    arr.sort((a, b) => (personStats.get(b.slug)?.bookIds.length || 0) - (personStats.get(a.slug)?.bookIds.length || 0));
  }
  const topPeople = [...personStats.values()]
    .sort((a, b) => b.bookIds.length - a.bookIds.length || a.name.localeCompare(b.name))
    .slice(0, 12);

  // One row per book (editions collapse), and the long tail of one-mention
  // titles sits behind a toggle so the page leads with the books people
  // actually keep recommending.
  const seenEditions = new Set<string>();
  const uniqueBooks = sortedBooks.filter((b) => {
    const k = editionKey(b);
    if (seenEditions.has(k)) return false;
    seenEditions.add(k);
    return true;
  });
  const azPosition = new Map(
    [...uniqueBooks].sort((x, y) => (x.title || "").localeCompare(y.title || "")).map((b, i) => [b.id, i + 1] as const)
  );
  const byRecs = [...uniqueBooks].sort((a, b) => (b.recommendation_count || 0) - (a.recommendation_count || 0));
  let primaryIds = new Set(byRecs.filter((b) => (b.recommendation_count || 0) >= MIN_RECS_PRIMARY).map((b) => b.id));
  if (primaryIds.size < MIN_PRIMARY_BOOKS) primaryIds = new Set(byRecs.slice(0, MIN_PRIMARY_BOOKS).map((b) => b.id));
  const primaryBooks = uniqueBooks.filter((b) => primaryIds.has(b.id));
  const moreBooks = uniqueBooks.filter((b) => !primaryIds.has(b.id));

  // Topic wording for headings and answers, taken from the page title
  // ("Best Stoicism Books" -> "Stoicism Books").
  const topic = displayListTitleFull(list.title, list.slug).replace(/^best\s+/i, "").trim() || displayName;
  const startHere = byRecs.filter((b) => (b.recommendation_count || 0) > 0).slice(0, 5);
  const bookById = new Map(uniqueBooks.map((b) => [b.id, b]));
  const personSections = topPeople.slice(0, 3).map((p) => ({
    ...p,
    picks: p.bookIds
      .map((id) => bookById.get(id))
      .filter((b): b is (typeof uniqueBooks)[number] => !!b)
      .sort((a, b) => (b.recommendation_count || 0) - (a.recommendation_count || 0))
      .slice(0, 6),
  }));
  const joinNames = (names: string[]) =>
    names.length <= 1 ? names[0] || "" : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const recWord = (n: number) => `${n} ${n === 1 ? "recommendation" : "recommendations"}`;
  const dates = contentDates(list);

  // Key Takeaways: 3-5 complete, quotable claims shown first on the page.
  // Every figure is read from the same data the rest of the page renders —
  // nothing here is written copy — so it cannot drift from the list below it.
  // Topic wording is deliberately left out of the bullets: the page title
  // gives mixed-case topics ("Books About Japan") and lowercasing them
  // mid-sentence would misspell proper nouns.
  const takeaways: string[] = [];
  if (startHere.length >= 3) {
    const topCount = startHere[0].recommendation_count || 0;
    const leaders = startHere.filter((b) => (b.recommendation_count || 0) === topCount);
    const bookRef = (b: (typeof startHere)[number]) =>
      `${b.title}${b.author ? ` by ${b.author}` : ""}${b.first_published_year ? ` (${b.first_published_year})` : ""}`;
    takeaways.push(
      leaders.length === 1
        ? `${bookRef(leaders[0])} is the most recommended book on this list, with ${recWord(topCount)}.`
        : `${joinNames(leaders.map(bookRef))} are tied as the most recommended books on this list, with ${recWord(topCount)} each.`
    );
    const next = startHere.filter((b) => (b.recommendation_count || 0) < topCount).slice(0, 2);
    if (next.length > 0) {
      takeaways.push(
        `${joinNames(next.map((b) => `${b.title} (${recWord(b.recommendation_count || 0)})`))} ${next.length === 1 ? "comes" : "come"} next.`
      );
    }
    takeaways.push(
      `This page shows ${totalInList > books.length ? `${books.length} of ${totalInList.toLocaleString()}` : books.length} books with ${totalRecs.toLocaleString()} recommendations in total.`
    );
    if (topPeople.length >= 2) {
      takeaways.push(`Recommenders include ${joinNames(topPeople.slice(0, 3).map((p) => p.name))}.`);
    }
  }

  // Ranked summary table: the same ordering as "Where to start", with the
  // facts a reader (or an answer engine) compares books on.
  const tableBooks = byRecs.filter((b) => (b.recommendation_count || 0) > 0).slice(0, 8);

  const faq = [
    startHere.length >= 3 && {
      q: `What are the best ${topic.toLowerCase()}?`,
      a: `${joinNames(startHere.slice(0, 3).map((b) => b.title))} are the most recommended ${topic.toLowerCase()} on BookMentions, ranked by how many people recommended them.`,
    },
    topPeople.length >= 2 && {
      q: `Who recommends ${topic.toLowerCase()}?`,
      a: `${joinNames(topPeople.slice(0, 4).map((p) => p.name))} are among the people who recommend books on this list. Each name links to their full set of book recommendations.`,
    },
    startHere[0] && {
      q: `Which of these top ${topic.toLowerCase()} should I read first?`,
      a: `${startHere[0].title}${startHere[0].author ? ` by ${startHere[0].author}` : ""} is the most recommended here with ${startHere[0].recommendation_count} ${startHere[0].recommendation_count === 1 ? "recommendation" : "recommendations"}, which makes it the safest place to start. If you only have time for a few ${topic.toLowerCase()} to read, begin with the top three above.`,
    },
  ].filter((x): x is { q: string; a: string } => !!x);
  const faqJsonLd = faq.length
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      }
    : null;

  const renderBook = (book: (typeof sortedBooks)[number], i: number) => {
            const hasCover = isValidHttpUrl(book.cover_image_url);
    const showRating = isValidRating(book.rating);
    // Tagged (bookmention09-20) Amazon URL, shared by the cover link and the
    // "View on Amazon" button so both always point at the same place.
    const ctaUrl = amazonCtaUrl(book);
    
    return (
      <div
        key={book.id}
        className="list-row flex flex-col sm:flex-row gap-6 p-5 md:p-6 rounded-2xl border border-border bg-surface relative group motion-card-hover"
        style={{ "--az": azPosition.get(book.id) ?? 0 } as React.CSSProperties}
      >
        {/* Rank Badge */}
        <span className="absolute -top-2.5 -left-2.5 z-10 w-8 h-8 rounded-full bg-accent text-white text-sm flex items-center justify-center font-bold shadow-md">
          {i + 1}
        </span>

        {/* Cover image container */}
        <div className="w-28 h-40 sm:w-32 sm:h-48 shrink-0 rounded-xl overflow-hidden shadow-sm bg-subtle relative mx-auto sm:mx-0 border border-border/40">
          <AmazonCoverLink href={ctaUrl} title={book.title} slug={book.slug} section="list-cover">
          {hasCover ? (
            <SafeImage
              src={book.cover_image_url!}
              alt={coverAltText(book.title, book.author)}
              className="w-full h-full object-cover motion-cover-img"
              fallback={
                <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-subtle to-subtle/40 p-2 text-center">
                  <span className="text-[9px] uppercase tracking-wider text-muted/60">No cover</span>
                  <span className="text-[10px] font-medium text-ink/65 leading-snug line-clamp-3 mt-1">{book.title}</span>
                </div>
              }
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-subtle to-subtle/40 p-2 text-center">
              <span className="text-[9px] uppercase tracking-wider text-muted/60">No cover</span>
              <span className="text-[10px] font-medium text-ink/65 leading-snug line-clamp-3 mt-1">{book.title}</span>
            </div>
          )}
          </AmazonCoverLink>
        </div>

        {/* Content details */}
        <div className="flex-1 flex flex-col justify-between">
          <div className="order-1">
            <div className="mb-1">
              <Link
                href={`/books/${book.slug}`} rel={bookLinkRel(indexableBooks, book.slug)}
                className="font-bold text-lg md:text-xl text-ink hover:text-accent transition-colors leading-tight block"
              >
                {book.title}
              </Link>
              {book.subtitle && (
                <p className="text-xs md:text-sm text-muted mt-0.5">{book.subtitle}</p>
              )}
            </div>

            {book.author && (
              <p className="text-xs md:text-sm text-muted mb-3">
                by <span className="text-accent font-semibold">{book.author}</span>
              </p>
            )}

            {/* Stats */}
            <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
              {showRating && (
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-accent-light text-accent font-semibold">
                  ★ {formatRating(book.rating)}
                </span>
              )}
              {book.recommendation_count > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-subtle text-ink font-medium">
                  {book.recommendation_count} {book.recommendation_count === 1 ? "recommendation" : "recommendations"}
                </span>
              )}
            </div>

            {(() => {
              const r = redditByBook.get(book.id);
              if (!r) return null;
              return (
                <p
                  className="-mt-2 mb-3 inline-flex items-center gap-1.5 text-xs text-muted w-fit"
                  title={`Linked by ${r.users.toLocaleString("en-US")} users in ${redditLabel(r.subreddit)} (${REDDIT_SOURCE_NAME}, data to ${REDDIT_AS_OF_LABEL}). A user count, not votes.`}
                >
                  <span aria-hidden="true" className="inline-block w-2 h-2 rounded-full bg-[#ff4500]" />
                  <span className="tabular-nums font-semibold text-ink">{r.users.toLocaleString("en-US")}</span>
                  <span>Reddit users · {redditLabel(r.subreddit)}</span>
                </p>
              );
            })()}

            {/* Who recommended it: the thing this site has that a
                plain bestseller list does not. */}
            {(() => {
              const who = recsByBook.get(book.id) || [];
              if (who.length === 0) return null;
              const shown = who.slice(0, 3);
              const extra = who.length - shown.length;
              return (
                <p className="text-xs md:text-sm text-muted mb-3 leading-relaxed">
                  <span className="font-semibold text-ink">Recommended by </span>
                  {shown.map((w, wi) => (
                    <span key={w.slug}>
                      {wi > 0 ? (wi === shown.length - 1 && extra === 0 ? " and " : ", ") : ""}
                      <Link href={`/people/${w.slug}`} className="text-accent hover:underline">{w.name}</Link>
                    </span>
                  ))}
                  {extra > 0 && (
                    <>
                      {" "}and{" "}
                      <Link href={`/books/${book.slug}`} rel={bookLinkRel(indexableBooks, book.slug)} className="text-accent hover:underline">
                        {extra} {extra === 1 ? "other" : "others"}
                      </Link>
                    </>
                  )}
                </p>
              );
            })()}
          </div>

          {/* Source context or fallback editorial summary why it appears */}
          {usableContext(book.recommendation_context) ? (
            <div className="order-3 sm:order-2 mt-4 sm:mt-0 bg-subtle/20 rounded-xl p-3 border border-border/40">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted block mb-1">What they said</span>
              <blockquote className="text-xs md:text-sm text-muted italic border-l-2 border-accent/20 pl-2 leading-relaxed">
                &ldquo;{book.recommendation_context}&rdquo;
              </blockquote>
            </div>
          ) : book.editorial_summary && book.editorial_summary.trim().length > 0 ? (
            <div className="order-3 sm:order-2 mt-4 sm:mt-0 bg-subtle/20 rounded-xl p-3 border border-border/40">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted block mb-1">Book Summary</span>
              <p className="text-xs md:text-sm text-muted leading-relaxed line-clamp-3">
                {book.editorial_summary}
              </p>
            </div>
          ) : cleanBlurb(book.description) ? (
            <div className="order-3 sm:order-2 mt-4 sm:mt-0 bg-subtle/20 rounded-xl p-3 border border-border/40">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted block mb-1">Description</span>
              <p className="text-xs md:text-sm text-muted leading-relaxed line-clamp-3">
                {cleanBlurb(book.description)}
              </p>
            </div>
          ) : null}

          {/* Actions (compliant CTAs preferring Amazon purchase/view button) */}
          <div className="order-2 sm:order-3 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-4 border-t border-border/40 pt-4 mt-4 sm:mt-6">
            <Link
              href={`/books/${book.slug}`} rel={bookLinkRel(indexableBooks, book.slug)}
              className="text-xs text-muted hover:text-accent hover:underline flex items-center justify-center sm:justify-start gap-1 font-medium transition-colors"
            >
              View full details →
            </Link>
            {(() => {
              // ctaUrl (computed above) is repaired and tagged with
              // bookmention09-20 by amazonCtaUrl; null only when there is no
              // title to search for. Render-time only — DB unchanged.
              if (!ctaUrl) return null;
              return (
                <a
                  href={ctaUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow sponsored"
                  data-track-slug={book.slug}
                  data-track-section="list-book"
                  data-track-label="View on Amazon"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-xs md:text-sm font-semibold shadow-sm w-full sm:w-auto text-center shrink-0 motion-btn-cta"
                >
                  <span>View on Amazon</span>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              );
            })()}
          </div>
        </div>
      </div>
    );
  };


  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      {jsonld && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonld) }} />
      )}
      {faqJsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      )}
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Lists", href: "/lists" }, { label: displayName }]} />

      <div className="mb-10 pb-6 border-b border-border/60">
        {listPerson && (
          <Link
            href={`/people/${listPerson.slug}`}
            className="group mb-4 inline-flex items-center gap-3 rounded-full border border-border bg-surface py-1.5 pl-1.5 pr-5 transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Avatar name={listPerson.name} slug={listPerson.slug} avatarUrl={listPerson.avatar} sizeClass="w-12 h-12" alt={`${listPerson.name}, book recommender`} />
            <span className="text-sm leading-tight">
              <span className="block font-semibold text-ink group-hover:text-accent transition-colors">{listPerson.name}</span>
              <span className="block text-xs text-muted">View profile and sources →</span>
            </span>
          </Link>
        )}
        <div className="flex items-start gap-3 flex-wrap mb-3">
          <h1 className="type-h1 text-ink">{displayListTitleFull(list.title, list.slug)}</h1>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-subtle text-muted text-[11px] font-medium shrink-0 mt-2">
            {listKindLabel(kind)}
          </span>
          {books.length > 0 && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-semibold shrink-0 mt-1">
              {/* Say "N of M" whenever the list holds more than the page
                  shows. "48 books curated" on a list of 287 read as the whole
                  set and quietly understated the collection. */}
              {totalInList > books.length
                ? `${books.length} of ${totalInList.toLocaleString()} books`
                : `${books.length} ${books.length === 1 ? "book" : "books"} curated`}
            </span>
          )}
          {totalRecs > 0 && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-subtle border border-border text-muted text-xs font-medium shrink-0 mt-1">
              {totalRecs.toLocaleString()} recommendations total
            </span>
          )}
        </div>
        {takeaways.length >= 3 && (
          <section className="mb-5 rounded-2xl border border-border bg-surface p-5 max-w-3xl" aria-labelledby="key-takeaways">
            <h2 id="key-takeaways" className="type-h3 text-ink mb-2">Top {topic} at a glance</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-ink leading-relaxed">
              {takeaways.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>
        )}
        {hasDescription ? (
          <p className="text-base text-muted max-w-2xl leading-relaxed">{list.description}</p>
        ) : (
          <p className="text-base text-muted max-w-2xl leading-relaxed">
            A curated collection of books related to {displayName}, ranked by recommendation signals.
          </p>
        )}
        {list.curator && (
          <p className="text-sm text-accent font-medium mt-2">Curated by {list.curator}</p>
        )}
        {redditByBook.size >= 3 && (
          <p className="mt-3 inline-flex max-w-2xl items-start gap-2 text-sm text-muted">
            <span aria-hidden="true" className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-[#ff4500]" />
            <span>
              {redditByBook.size} of these {books.length} books are also linked by Reddit users. The counts come from{" "}
              <a href={REDDIT_SOURCE_URL} rel="noopener" className="text-accent hover:underline">{REDDIT_SOURCE_NAME}</a>{" "}
              and run to {REDDIT_AS_OF_LABEL}; each counts users, not votes.
            </span>
          </p>
        )}
        <LastUpdated modified={dates.modified} />

        {hasBooks && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-border/40 text-sm">
            <span className="text-muted font-medium">Curated list content</span>
            <ListSortControls />
          </div>
        )}
      </div>

      {/* Decorative drifting covers of this list. Below the heading on purpose,
          so the H1 and first paint are unchanged. */}
      <CoverMarquee covers={books.map((b) => b.cover_image_url).filter((u): u is string => isDisplayableCover(u))} />

      {startHere.length >= 3 && (
        <section className="mb-12" aria-labelledby="start-here">
          <h2 data-reveal id="start-here" className="type-h2 text-ink mb-1">
            What are the most recommended {topic}?
          </h2>
          <p data-reveal className="text-sm text-muted mb-5 max-w-2xl leading-relaxed">
            The most recommended {topic} are {joinNames(startHere.slice(0, 3).map((b) => `${b.title} (${b.recommendation_count})`))}, ranked by how many of the {personStats.size.toLocaleString()} people behind this list recommended each one.
            {" "}Start with these top {topic}: they are the {topic} to read first.
          </p>
          {/* A real <table>: ranked, comparable columns for the books people
              recommend most. Rows are the top of the same ordering the page
              uses everywhere else. */}
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm text-left">
              <caption className="sr-only">Most recommended {topic}, ranked by number of recommendations</caption>
              <thead className="bg-subtle text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Rank</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Book</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Author</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">First published</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Recommendations</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Recommended by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tableBooks.map((b, i) => {
                  const who = (recsByBook.get(b.id) || []).slice(0, 3);
                  return (
                    <tr key={b.id}>
                      <td className="px-4 py-2.5 text-muted">{i + 1}</td>
                      <td className="px-4 py-2.5 font-semibold">
                        <div className="flex items-center gap-3">
                          {/* Cover beside the rank: decorative (the title link next to it names the book). */}
                          <Link href={`/books/${b.slug}`} rel={bookLinkRel(indexableBooks, b.slug)} tabIndex={-1} aria-hidden="true" className="shrink-0">
                            <span className="block h-[54px] w-9 overflow-hidden rounded-[3px] border border-border bg-subtle shadow-sm">
                              {isDisplayableCover(b.cover_image_url) && (
                                <SafeImage src={b.cover_image_url!} alt="" className="h-full w-full object-cover" width={36} height={54} />
                              )}
                            </span>
                          </Link>
                          <Link href={`/books/${b.slug}`} rel={bookLinkRel(indexableBooks, b.slug)} className="text-ink hover:text-accent">{b.title}</Link>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-muted">{b.author || "—"}</td>
                      <td className="px-4 py-2.5 text-muted">{b.first_published_year || "—"}</td>
                      <td className="px-4 py-2.5 text-ink">{b.recommendation_count}</td>
                      <td className="px-4 py-2.5 text-muted">
                        {who.length > 0
                          ? who.map((w, wi) => (
                              <span key={w.slug}>
                                {wi > 0 ? (wi === who.length - 1 ? " and " : ", ") : ""}
                                <Link href={`/people/${w.slug}`} className="text-accent hover:underline">{w.name}</Link>
                              </span>
                            ))
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {hasBooks ? (
        <div id="list-books" data-sort="recommendation">
        <div data-reveal-stagger className="list-grid grid grid-cols-1 gap-6 md:gap-8 mb-14">
          {primaryBooks.map((book, i) => renderBook(book, i))}
        </div>
        {moreBooks.length > 0 && (
          <details className="mb-14 group rounded-2xl border border-border bg-surface p-5">
            <summary className="cursor-pointer text-sm font-semibold text-accent">
              Show {moreBooks.length} more {moreBooks.length === 1 ? "book" : "books"} with a single recommendation
            </summary>
            <div className="list-grid grid grid-cols-1 gap-6 md:gap-8 mt-6">
              {moreBooks.map((book, i) => renderBook(book, primaryBooks.length + i))}
            </div>
          </details>
        )}
        </div>
      ) : (
        <section className="mb-14">
          <EmptyState message="Books for this list are still being organized." />
        </section>
      )}

      {/* Recommended books by person: keyword-matching sections that are also
          real content (their own picks from this list) and internal links. */}
      {personSections.filter((p) => p.picks.length > 0).map((p) => (
        <section key={p.slug} className="mb-10" aria-labelledby={`by-${p.slug}`}>
          <h2 id={`by-${p.slug}`} className="type-h3 text-ink mb-1">
            Which {topic} does {p.name} recommend?
          </h2>
          <p className="text-sm text-muted mb-3">
            {p.name} recommends {p.bookIds.length} {p.bookIds.length === 1 ? "book" : "books"} on this list.{" "}
            <Link href={`/people/${p.slug}`} className="text-accent hover:underline">See all book recommendations by {p.name}</Link>
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            {p.picks.map((b) => (
              <li key={b.id}>
                <Link href={`/books/${b.slug}`} rel={bookLinkRel(indexableBooks, b.slug)} className="text-ink hover:text-accent font-medium">{b.title}</Link>
                {b.author && <span className="text-muted"> by {b.author}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {faq.length > 0 && (
        <section className="mt-12 mb-12" aria-labelledby="faq">
          <h2 id="faq" className="type-h3 text-ink mb-4">{topic}: common questions</h2>
          <dl className="space-y-4">
            {faq.map((f) => (
              <div key={f.q}>
                <dt className="font-semibold text-ink text-sm">{f.q}</dt>
                <dd className="text-sm text-muted leading-relaxed mt-1">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Compact trust & curation panel explaining data signals honestly without overclaiming */}
      <div className="mb-14 p-4 rounded-xl border border-border/50 bg-subtle/25 text-xs md:text-sm">
        <div className="flex gap-2.5 items-start">
          <svg className="w-4 h-4 text-accent mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
          </svg>
          <div className="space-y-2 text-muted">
            <p className="leading-relaxed">
              Built from recommendation data, category signals, and source-backed book records. Use this list as a starting point; open any book to see proof, context, and Amazon options where available.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-muted/65">
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-accent" />
                Recommendation data
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-accent" />
                Category signals
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-accent" />
                Source-backed book records
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-accent" />
                Open book pages for proof/context
              </span>
            </div>
            <div className="flex gap-3 pt-0.5 text-[11px] font-semibold text-accent">
              <Link href="/books" className="hover:underline">
                Browse all books
              </Link>
              <span className="text-muted/30 font-normal">|</span>
              <Link href="/people" className="hover:underline">
                Explore recommenders
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Related Lists */}
      {hasRelated && (
        <section className="mb-14">
          <h2 data-reveal className="type-h2 text-ink mb-5">More {topic} to read: explore related lists</h2>
          <RelatedListCards
            items={relatedLists.map((rl) => ({
              id: rl.id,
              slug: rl.slug,
              title: displayListTitleFull(rl.title, rl.slug),
              bookCount: rl.book_count,
              description: rl.description,
            }))}
          />
        </section>
      )}

      {/* About list — methodology footer. Rewritten to be more transparent
          about WHAT data drives the list (recommendation signals, category
          memberships, public sources) and less generic. Deliberately
          avoids "expert-curated" / "hand-picked" framing because most
          lists are generated from category memberships, not human
          editorial. The previous copy was the same generic stub on every
          list and contributed to the "templated feel" the live-readiness
          audit flagged. */}
      <section className="rounded-2xl border border-border bg-surface p-5 md:p-7">
        <h2 className="type-h3 text-ink mb-2">How we choose the best {topic}</h2>
        <p className="text-sm text-muted leading-relaxed">
          The {topic} list is built from public recommendation sources and
          category memberships. Books are ranked by how many distinct people
          recommended each one; recommendation counts and ratings are shown
          where available. Open any book to see source-backed recommendation
          proof, editorial context, and Amazon options — the per-book detail
          page is where the trust signals live.
        </p>
      </section>

      {/*
        Who recommended these books.

        A list is defined by the people behind it, and until now the page
        never named one — there were zero list-to-person links anywhere on
        the site. This is both the missing substance and the internal path
        to profiles that little else points at. Ordered by how much of THIS
        list each person accounts for.
      */}
      {listRecommenders.length > 0 && (
        <section className="mt-10 pt-8 border-t border-border">
          <h2 className="type-h3 text-ink mb-1">
            Who recommends {topic}?
          </h2>
          <p className="text-sm text-muted mb-5">
            {topic} are recommended by the people below, including {joinNames(listRecommenders.slice(0, 3).map((r) => r.name))}. Open a profile to see everything they recommend, with the source behind each pick.
          </p>
          <ul data-reveal-stagger className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {listRecommenders.map((r) => (
              <li key={r.slug}>
                <Link
                  href={`/people/${r.slug}`}
                  className="group flex items-center gap-3 rounded-xl border border-border bg-surface p-3 hover:border-accent/30 transition-colors"
                >
                  <Avatar
                    name={r.name}
                    slug={r.slug}
                    avatarUrl={r.avatar_url}
                    sizeClass="w-9 h-9"
                    textClass="text-xs"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink truncate group-hover:text-accent transition-colors">
                      {r.name}
                    </span>
                    <span className="block text-xs text-muted truncate">
                      Books recommended by {r.name.split(" ")[0]}: {r.bookCount}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Navigation back and discovery footer prompts */}
      <div className="flex justify-between items-center mt-10 pt-6 border-t border-border text-sm flex-wrap gap-3">
        <Link href="/lists" className="text-accent font-semibold hover:underline flex items-center gap-1">
          ← Back to Curated Book Lists
        </Link>
        <Link href="/books" className="text-accent font-semibold hover:underline flex items-center gap-1">
          Browse All Curated Books →
        </Link>
      </div>
    </div>
  );
}

