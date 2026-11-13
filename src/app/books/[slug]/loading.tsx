// Mirrors the hero of the real detail page (books/[slug]/page.tsx): the 3D
// book on the left (240px wide on desktop, 176px on phones, in a 2:3
// stage), the "should you read it?" copy on the right, so the
// skeleton doesn't jump when the real content swaps in.
export default function BookDetailLoading() {
  return (
    // min-h-[100svh]: the footer stays below the fold while the page
    // streams in, so replacing this skeleton shifts nothing on screen (the
    // footer jump measured CLS 0.16 at 1440×900).
    <div className="w-full py-8 pb-28 lg:pb-8 min-h-[100svh]">
      <div className="max-w-6xl mx-auto px-4 md:px-6">
        <div className="h-4 w-64 bg-skeleton rounded animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-4 lg:gap-14 items-center mt-4 lg:mt-8 mb-16">
          <div className="flex flex-col items-center pt-6">
            <div className="w-[176px] h-[264px] lg:w-[240px] lg:h-[360px] flex items-end">
              <div className="w-full rounded-md bg-skeleton animate-pulse aspect-[2/3]" />
            </div>
            <div className="mt-9 h-3 w-48 bg-skeleton rounded animate-pulse" />
          </div>
          <div className="min-w-0 space-y-5">
            <div className="h-4 w-40 bg-skeleton rounded-full animate-pulse" />
            <div className="h-14 w-3/4 bg-skeleton rounded animate-pulse" />
            <div className="h-5 w-1/3 bg-skeleton rounded animate-pulse" />
            <div className="flex gap-7">
              <div className="h-12 w-20 bg-skeleton rounded animate-pulse" />
              <div className="h-12 w-20 bg-skeleton rounded animate-pulse" />
              <div className="h-12 w-20 bg-skeleton rounded animate-pulse" />
            </div>
            <div className="h-4 w-full bg-skeleton rounded animate-pulse" />
            <div className="h-4 w-5/6 bg-skeleton rounded animate-pulse" />
            <div className="h-4 w-2/3 bg-skeleton rounded animate-pulse" />
            <div className="h-12 w-72 bg-skeleton rounded-xl animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}
