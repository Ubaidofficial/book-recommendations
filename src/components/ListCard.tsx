import Link from "next/link";

interface ListCardProps {
  title: string;
  slug: string;
  description: string;
  bookCount: number;
  curator?: string | null;
}

export function ListCard({ title, slug, description, bookCount, curator }: ListCardProps) {
  return (
    <Link
      href={`/lists/${slug}`}
      className="group block rounded-2xl border border-border bg-surface p-5 hover:shadow-lg hover:border-accent/20 transition-all duration-200"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-semibold text-base text-ink group-hover:text-accent transition-colors leading-snug">
          {title}
        </h3>
        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-medium shrink-0">
          {bookCount} books
        </span>
      </div>
      <p className="text-sm text-muted leading-relaxed line-clamp-2">{description}</p>
      {curator && (
        <p className="text-xs text-accent font-medium mt-3">Curated by {curator}</p>
      )}
    </Link>
  );
}
