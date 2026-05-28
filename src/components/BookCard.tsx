"use client";

import Link from "next/link";
import { SafeImage } from "./SafeImage";
import { isValidHttpUrl, isValidRating, formatRating } from "@/lib/dataQuality";

// Cleaner missing-cover placeholder: subtle book-stack icon, readable title,
// no oversized purple text, "No cover" affordance so the absence reads intentional.
function NoCoverFallback({ title }: { title: string }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-between bg-gradient-to-br from-subtle to-subtle/40 border-b border-border/60 p-3 text-center">
      <span className="mt-1 text-[10px] uppercase tracking-wider text-muted/60">No cover</span>
      <div className="flex flex-col items-center justify-center flex-1 px-1">
        <svg className="w-7 h-7 text-muted/40 mb-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
        <span className="text-xs font-medium text-ink/70 leading-snug line-clamp-4">
          {title}
        </span>
      </div>
      <span className="text-[10px] text-transparent select-none" aria-hidden>spacer</span>
    </div>
  );
}

interface BookCardProps {
  title: string;
  slug: string;
  author: string;
  authorSlug: string;
  coverUrl: string;
  rating: number;
  recommendationCount: number;
}

export function BookCard({
  title,
  slug,
  author,
  authorSlug,
  coverUrl,
  rating,
  recommendationCount,
}: BookCardProps) {
  const showCover = isValidHttpUrl(coverUrl);
  const showRating = isValidRating(rating);

  return (
    <Link
      href={`/books/${slug}`}
      className="group block rounded-2xl border border-border bg-surface overflow-hidden hover:shadow-lg hover:border-accent/20 transition-all duration-200"
    >
      <div className="aspect-[2/3] bg-subtle overflow-hidden">
        {showCover ? (
          <SafeImage
            src={coverUrl}
            alt={title}
            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
            fallback={<NoCoverFallback title={title} />}
          />
        ) : (
          <NoCoverFallback title={title} />
        )}
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-sm text-ink leading-snug mb-1 group-hover:text-accent transition-colors line-clamp-2">
          {title}
        </h3>
        <Link
          href={`/people/${authorSlug}`}
          className="text-xs text-muted hover:text-ink transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {author}
        </Link>
        <div className="flex items-center gap-2 mt-2.5 text-xs">
          {showRating && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-light text-accent font-medium">
              ★ {formatRating(rating)}
            </span>
          )}
          {recommendationCount > 0 && (
            <span className="text-muted">{recommendationCount.toLocaleString()} recs</span>
          )}
        </div>
      </div>
    </Link>
  );
}
