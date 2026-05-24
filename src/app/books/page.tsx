import { Metadata } from "next";
import { getBooksPaginated } from "@/lib/data";
import { pageMetadata } from "@/lib/seo";
import { BookCard, SearchBar, Breadcrumbs, EmptyState } from "@/components";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Browse Books",
  description: "Discover thousands of books recommended by the world's most respected people.",
  path: "/books",
});

export default async function BooksPage() {
  const { data: books, total } = await getBooksPaginated(1, 24);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Books" }]} />
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-ink mb-2 tracking-tight">Browse Books</h1>
        <p className="text-base text-muted">Discover books recommended by people you trust.</p>
      </div>
      <div className="mb-8">
        <SearchBar placeholder="Search by title, author, or topic…" />
      </div>
      <div className="flex items-center gap-3 mb-6 overflow-x-auto pb-2">
        {["All", "Fiction", "Non-Fiction", "Science Fiction", "Classics", "History", "Self-Help"].map((f, i) => (
          <button
            key={f}
            className={`text-xs px-3.5 py-1.5 rounded-full border transition-colors shrink-0 font-medium ${
              i === 0
                ? "bg-accent text-white border-accent"
                : "border-border text-muted hover:border-accent hover:text-accent"
            }`}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between mb-6 text-sm">
        <span className="text-muted">{total.toLocaleString()} books</span>
        <select className="border border-border rounded-lg px-3 py-1.5 bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/20">
          <option>Most Recommended</option>
          <option>Highest Rated</option>
          <option>Title A-Z</option>
        </select>
      </div>
      {books.length === 0 ? (
        <EmptyState message="No books found. Check back soon." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
          {books.map((book) => (
            <BookCard key={book.id} title={book.title} slug={book.slug} author={book.author} authorSlug={book.author_slug} coverUrl={book.cover_url} rating={book.rating} recommendationCount={book.recommendation_count} />
          ))}
        </div>
      )}
      {total > 24 && (
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
