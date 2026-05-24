import { Metadata } from "next";
import { getListsPaginated, searchLists } from "@/lib/data";
import { pageMetadata } from "@/lib/seo";
import { ListCard, SearchBar, Breadcrumbs, EmptyState } from "@/components";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Book Lists",
  description: "Browse curated book lists across nonfiction, fiction, business, science, history, personal development, and more.",
  path: "/lists",
});

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export default async function ListsPage({ searchParams }: Props) {
  const { q } = await searchParams;

  let listsResult;
  if (q && q.length >= 2) {
    const data = await searchLists(q, 24);
    listsResult = { data, total: data.length };
  } else {
    listsResult = await getListsPaginated(1, 24);
  }

  const { data: lists, total } = listsResult;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Lists" }]} />
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-ink mb-2 tracking-tight">Book Lists</h1>
        <p className="text-base text-muted">
          {q ? `Results for "${q}"` : "Curated collections of outstanding books."}
        </p>
      </div>
      <div className="mb-8">
        <SearchBar placeholder="Search lists by title or topic…" />
      </div>
      <div className="flex items-center justify-between mb-6 text-sm">
        <span className="text-muted">{total} lists</span>
        <select className="border border-border rounded-lg px-3 py-1.5 bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/20">
          <option>Most Books</option>
          <option>Title A-Z</option>
        </select>
      </div>
      {lists.length === 0 ? (
        <EmptyState message={q ? `No lists match "${q}".` : "No lists found."} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {lists.map((list) => (
            <ListCard key={list.id} title={list.title} slug={list.slug} description={list.description} bookCount={list.book_count} curator={list.curator} />
          ))}
        </div>
      )}
      {total > 24 && !q && (
        <div className="flex items-center justify-center mt-10 gap-2">
          <span className="text-sm text-muted">Page 1 of {Math.ceil(total / 24)}</span>
          <span className="px-3 py-1.5 rounded-full bg-subtle border border-border text-xs text-muted">
            More coming soon
          </span>
        </div>
      )}
    </div>
  );
}
