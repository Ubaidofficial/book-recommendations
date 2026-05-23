import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getListBySlug, getBooksForList } from "@/lib/data";
import { pageMetadata, robotsDirective } from "@/lib/seo";
import { itemListJsonLd } from "@/lib/jsonld";
import { BookCard, Breadcrumbs, EmptyState } from "@/components";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const list = await getListBySlug(slug);
  if (!list) return { robots: "noindex, follow" };
  return pageMetadata({
    title: list.title,
    description: list.description,
    path: `/lists/${list.slug}`,
    robots: robotsDirective(list),
  });
}

export default async function ListDetailPage({ params }: Props) {
  const { slug } = await params;
  const list = await getListBySlug(slug);
  if (!list) notFound();

  const books = await getBooksForList(list.id, 10);
  const jsonld = itemListJsonLd(list, books);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      {jsonld && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonld) }} />
      )}
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Lists", href: "/lists" }, { label: list.title }]} />
      <div className="mb-10">
        <div className="flex items-start gap-3 flex-wrap mb-3">
          <h1 className="text-2xl md:text-3xl font-bold text-ink tracking-tight">{list.title}</h1>
          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-medium shrink-0 mt-1">
            {list.book_count} books
          </span>
        </div>
        <p className="text-base text-muted max-w-2xl leading-relaxed">{list.description}</p>
        {list.curator && (
          <p className="text-sm text-accent font-medium mt-2">Curated by {list.curator}</p>
        )}
      </div>
      {books.length === 0 ? (
        <EmptyState message="No books in this list yet." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
          {books.map((book, i) => (
            <div key={book.id} className="relative">
              <span className="absolute top-2 left-2 z-10 w-6 h-6 rounded-full bg-accent text-white text-xs flex items-center justify-center font-bold shadow-sm">
                {i + 1}
              </span>
              <BookCard title={book.title} slug={book.slug} author={book.author} authorSlug={book.author_slug} coverUrl={book.cover_url} rating={book.rating} recommendationCount={book.recommendation_count} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
