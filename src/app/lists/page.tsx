import { Metadata } from "next";
import { getListsPaginated } from "@/lib/data";
import { pageMetadata } from "@/lib/seo";
import { ListCard, SearchBar, Breadcrumbs, EmptyState } from "@/components";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Book Lists",
  description: "Curated book lists and reading guides covering every genre and topic imaginable.",
  path: "/lists",
});

export default async function ListsPage() {
  const { data: lists, total } = await getListsPaginated(1, 24);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Lists" }]} />
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-ink mb-2 tracking-tight">Book Lists</h1>
        <p className="text-base text-muted">Curated collections of outstanding books.</p>
      </div>
      <div className="mb-8">
        <SearchBar placeholder="Search lists by title or topic…" basePath="/lists" />
      </div>
      <div className="flex items-center justify-between mb-6 text-sm">
        <span className="text-muted">{total} lists</span>
        <select className="border border-border rounded-lg px-3 py-1.5 bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/20">
          <option>Most Books</option>
          <option>Title A-Z</option>
        </select>
      </div>
      {lists.length === 0 ? (
        <EmptyState message="No lists found." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {lists.map((list) => (
            <ListCard key={list.id} title={list.title} slug={list.slug} description={list.description} bookCount={list.book_count} curator={list.curator} />
          ))}
        </div>
      )}
    </div>
  );
}
