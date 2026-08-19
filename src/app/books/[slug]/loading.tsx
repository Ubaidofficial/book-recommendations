// Mirrors the sticky-rail-cover + right-column layout of the real detail
// page (books/[slug]/page.tsx) so the skeleton doesn't jump/reflow when the
// real content swaps in.
export default function BookDetailLoading() {
  return (
    <div className="w-full py-8 pb-28 lg:pb-8">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="h-4 w-64 bg-skeleton rounded animate-pulse mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-8 lg:gap-12 items-start mt-6">
          <div className="hidden lg:flex lg:flex-col gap-5">
            <div className="w-[300px] mx-auto rounded-2xl bg-skeleton animate-pulse aspect-[2/3]" />
            <div className="w-[300px] mx-auto h-24 rounded-2xl bg-skeleton animate-pulse" />
          </div>
          <div className="min-w-0 space-y-4">
            <div className="mb-6 flex justify-center lg:hidden">
              <div className="w-[200px] rounded-2xl bg-skeleton animate-pulse aspect-[2/3]" />
            </div>
            <div className="h-6 w-40 bg-skeleton rounded-full animate-pulse" />
            <div className="h-10 w-3/4 bg-skeleton rounded animate-pulse" />
            <div className="h-4 w-1/3 bg-skeleton rounded animate-pulse" />
            <div className="h-24 w-full bg-skeleton rounded-xl animate-pulse" />
            <div className="h-32 w-full bg-skeleton rounded-xl animate-pulse" />
            <div className="h-4 w-full bg-skeleton rounded animate-pulse" />
            <div className="h-4 w-5/6 bg-skeleton rounded animate-pulse" />
            <div className="h-4 w-2/3 bg-skeleton rounded animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}
