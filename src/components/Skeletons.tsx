export function BookCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-surface overflow-hidden animate-pulse">
      <div className="aspect-[2/3] bg-skeleton" />
      <div className="p-4 space-y-2">
        <div className="h-4 bg-skeleton rounded w-3/4" />
        <div className="h-3 bg-skeleton rounded w-1/2" />
        <div className="h-5 bg-skeleton rounded w-2/3" />
      </div>
    </div>
  );
}

export function PersonCardSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 animate-pulse">
      <div className="w-14 h-14 rounded-full bg-skeleton shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-4 bg-skeleton rounded w-2/3" />
        <div className="h-3 bg-skeleton rounded w-1/2" />
        <div className="h-4 bg-skeleton rounded w-1/3" />
      </div>
    </div>
  );
}

export function ListCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 animate-pulse space-y-3">
      <div className="flex justify-between">
        <div className="h-5 bg-skeleton rounded w-2/3" />
        <div className="h-5 bg-skeleton rounded w-16" />
      </div>
      <div className="h-3 bg-skeleton rounded w-full" />
      <div className="h-3 bg-skeleton rounded w-3/4" />
    </div>
  );
}

export function EmptyState({ message = "Nothing here yet." }: { message?: string }) {
  return (
    <div className="text-center py-16 px-4">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-subtle flex items-center justify-center">
        <svg className="w-8 h-8 text-muted/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      </div>
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}
