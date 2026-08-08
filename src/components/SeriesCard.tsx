import Link from "next/link";
import { displayTitle } from "@/lib/display";

interface SeriesCardProps {
  title: string;
  slug: string;
  description: string;
  bookCount: number;
}

export function SeriesCard({ title, slug, description, bookCount }: SeriesCardProps) {
  return (
    <Link
      href={`/series/${slug}`}
      className="group block rounded-2xl border border-border bg-surface p-5 hover:border-accent/20 motion-card-hover"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-semibold text-base text-ink group-hover:text-accent transition-colors leading-snug">
          {displayTitle(title)}
        </h3>
        {bookCount > 0 && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-medium shrink-0">
            {bookCount} books
          </span>
        )}
      </div>
      <p className="text-sm text-muted leading-relaxed line-clamp-2">{description}</p>
    </Link>
  );
}
