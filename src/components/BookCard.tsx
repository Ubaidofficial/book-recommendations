"use client";

import Link from "next/link";

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
  return (
    <Link
      href={`/books/${slug}`}
      className="group block rounded-2xl border border-border bg-surface overflow-hidden hover:shadow-lg hover:border-accent/20 transition-all duration-200"
    >
      <div className="aspect-[2/3] bg-subtle overflow-hidden">
        <img
          src={coverUrl}
          alt={title}
          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
          loading="lazy"
        />
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
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-light text-accent font-medium">
            ★ {rating}
          </span>
          <span className="text-muted">{recommendationCount.toLocaleString()} recs</span>
        </div>
      </div>
    </Link>
  );
}
