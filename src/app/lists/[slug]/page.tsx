import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getListBySlug, getBooksForList, getBooksForListByRecommendations, getRelatedLists } from "@/lib/data";
import { pageMetadata, robotsDirective } from "@/lib/seo";
import { displayListTitle, listKindFromSlug, listKindLabel } from "@/lib/display";
import { isProbablyValidBookTitle, repairNumericTitle } from "@/lib/dataQuality";
import { itemListJsonLd } from "@/lib/jsonld";
import { BookCard, Breadcrumbs, EmptyState } from "@/components";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const list = await getListBySlug(slug);
  if (!list) return { robots: "noindex, follow" };
  const displayName = displayListTitle(list.title, list.slug);
  return pageMetadata({
    title: displayName,
    description: list.description || `A curated collection of books in ${displayName}.`,
    path: `/lists/${list.slug}`,
    robots: robotsDirective(list),
  });
}

export default async function ListDetailPage({ params }: Props) {
  const { slug } = await params;
  const list = await getListBySlug(slug);
  if (!list) notFound();

  const kind = listKindFromSlug(list.slug);
  // Meta list: sort by books.recommendation_count and filter junk numeric/date titles.
  // Other lists: keep the imported rank order.
  const booksPromise = kind === "meta"
    ? getBooksForListByRecommendations(list.id, 60)
    : getBooksForList(list.id, 48);
  const [booksRaw, relatedLists] = await Promise.all([
    booksPromise,
    getRelatedLists(list.id, 6),
  ]);
  // Defensive junk-title repair + filter for ALL lists. If the filter would empty
  // the grid (e.g. unexpected data shape), keep the raw set so the page is never empty.
  const repaired = booksRaw.map((b) => ({ ...b, title: repairNumericTitle(b.title) }));
  const filtered = repaired.filter((b) => isProbablyValidBookTitle(b.title));
  if (booksRaw.length > 0 && filtered.length === 0) {
    console.warn(`[list=${list.slug}] title-hygiene filter removed all ${booksRaw.length} rows — falling back to raw set`);
  }
  const books = (filtered.length > 0 ? filtered : repaired).slice(0, 48);
  console.log(`[list=${list.slug} id=${list.id} kind=${kind}] booksRaw=${booksRaw.length} filtered=${filtered.length} shown=${books.length}`);

  const jsonld = itemListJsonLd(list, books);
  const displayName = displayListTitle(list.title, list.slug);
  const hasBooks = books.length > 0;
  const hasDescription = list.description && list.description.length > 0;
  const hasRelated = relatedLists.length > 0;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      {jsonld && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonld) }} />
      )}
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Lists", href: "/lists" }, { label: displayName }]} />

      <div className="mb-10">
        <div className="flex items-start gap-3 flex-wrap mb-3">
          <h1 className="text-2xl md:text-3xl font-bold text-ink tracking-tight">{displayName}</h1>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-subtle text-muted text-[11px] font-medium shrink-0 mt-2">
            {listKindLabel(kind)}
          </span>
          {list.book_count > 0 && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-medium shrink-0 mt-1">
              {list.book_count} books
            </span>
          )}
        </div>
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
      </div>

      {hasBooks ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5 mb-14">
          {books.map((book, i) => (
            <div key={book.id} className="relative">
              <span className="absolute top-2 left-2 z-10 w-6 h-6 rounded-full bg-accent text-white text-xs flex items-center justify-center font-bold shadow-sm">
                {i + 1}
              </span>
              <BookCard
                title={book.title}
                slug={book.slug}
                author={book.author}
                authorSlug={book.author_slug}
                coverUrl={book.cover_image_url}
                rating={book.rating}
                recommendationCount={book.recommendation_count}
              />
            </div>
          ))}
        </div>
      ) : (
        <section className="mb-14">
          <EmptyState message="Books for this list are still being organized." />
        </section>
      )}

      {/* Related Lists */}
      {hasRelated && (
        <section className="mb-14">
          <h2 className="text-xl font-bold text-ink mb-5 tracking-tight">Explore more lists</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {relatedLists.map((rl) => (
              <Link
                key={rl.id}
                href={`/lists/${rl.slug}`}
                className="p-3.5 rounded-xl border border-border bg-surface hover:shadow-md hover:border-accent/20 transition-all"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-semibold text-ink">{displayListTitle(rl.title, rl.slug)}</p>
                  {rl.book_count > 0 && (
                    <span className="text-xs text-muted shrink-0">{rl.book_count} books</span>
                  )}
                </div>
                {rl.description && (
                  <p className="text-xs text-muted line-clamp-2">{rl.description}</p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* About this list */}
      <section className="rounded-2xl border border-border bg-surface p-5 md:p-7">
        <h2 className="text-lg font-bold text-ink mb-2 tracking-tight">About this list</h2>
        <p className="text-sm text-muted leading-relaxed">
          {displayName} is built from recommendation and category data collected across public sources.
          Books are ranked by their position in the list — those appearing higher have stronger placement
          signals. Recommendation counts and ratings are shown where available so you can quickly
          identify standout titles.
        </p>
      </section>
    </div>
  );
}
