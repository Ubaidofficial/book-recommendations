import { BookCardSkeleton } from "@/components";

// Matches the grid the real /books results use (page.tsx:458) so the
// transition from skeleton to real content doesn't visibly reflow.
export default function BooksLoading() {
  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <div className="h-4 w-40 bg-skeleton rounded animate-pulse mb-6" />
      <div className="h-8 w-72 bg-skeleton rounded animate-pulse mb-3" />
      <div className="h-4 w-96 max-w-full bg-skeleton rounded animate-pulse mb-8" />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
        {Array.from({ length: 24 }).map((_, i) => (
          <BookCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
