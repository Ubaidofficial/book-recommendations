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
  // Optional Phase-4 recommender proof row. `names` is the top-N recognisable
  // recommenders (passed quality filter upstream). `totalValid` is the count
  // of recommenders that passed the same filter — used for "+N more". When
  // omitted, empty, or names.length === 0, the row is not rendered and the
  // card layout is byte-identical to the pre-Phase-4 version.
  recommenders?: {
    names: Array<{ slug: string; name: string }>;
    totalValid: number;
  };
}

export function BookCard({
  title,
  slug,
  author,
  authorSlug,
  coverUrl,
  rating,
  recommendationCount,
  recommenders,
}: BookCardProps) {
  const showCover = isValidHttpUrl(coverUrl);
  const showRating = isValidRating(rating);
  const visibleRecs = (recommenders?.names || []).filter(
    (r) =>
      r &&
      typeof r.slug === "string" &&
      r.slug.trim() &&
      r.slug !== "undefined" &&
      r.slug !== "null" &&
      typeof r.name === "string" &&
      r.name.trim()
  );
  const showRecRow = visibleRecs.length > 0;
  const namesShown = visibleRecs.slice(0, 2);
  // "+N more" counts remaining high-signal recommenders (totalValid - namesShown.length),
  // not book.recommendation_count. Falls back to 0 if totalValid is missing.
  const totalValid = recommenders?.totalValid ?? visibleRecs.length;
  const extra = showRecRow ? Math.max(0, totalValid - namesShown.length) : 0;

  // Stretched-link pattern: the whole card is clickable via an absolute-inset
  // <Link> overlay at z-10, while interactive recommender names sit at z-20
  // and capture clicks before they reach the overlay. This is the standard
  // accessible way to compose a "clickable card with secondary internal
  // links" without nesting <a> inside <a> (which is invalid HTML).
  return (
    <article className="group relative rounded-2xl border border-border bg-surface overflow-hidden hover:shadow-lg hover:border-accent/20 transition-all duration-200">
      <Link
        href={`/books/${slug}`}
        className="absolute inset-0 z-10"
        aria-label={title}
      >
        <span className="sr-only">{title}</span>
      </Link>
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
        <span className="text-xs text-muted block">{author}</span>
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
        {showRecRow && (
          <div className="mt-2 text-[11px] text-muted leading-snug relative z-20">
            <span>Recommended by </span>
            {namesShown.map((r, i) => (
              <span key={r.slug}>
                <Link
                  href={`/people/${r.slug}`}
                  className="text-ink/80 hover:text-accent hover:underline font-medium"
                >
                  {r.name}
                </Link>
                {i === 0 && namesShown.length > 1 ? ", " : ""}
              </span>
            ))}
            {extra > 0 ? <span> + {extra} more</span> : null}
          </div>
        )}
      </div>
    </article>
  );
}
