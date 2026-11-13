import Link from "next/link";
import { SafeImage } from "@/components/SafeImage";
import { coverAltText, isValidHttpUrl } from "@/lib/dataQuality";
import type { ShelfBook } from "@/lib/personInsights";

function NoCover({ title }: { title: string }) {
  return (
    <span className="w-full h-full flex items-center justify-center bg-gradient-to-br from-subtle to-border/60 p-2 text-center">
      <span className="text-[11px] font-semibold text-ink/70 leading-snug line-clamp-5">{title}</span>
    </span>
  );
}

/** A cover that reads as a bound book (spine crease, hover turn), title and count. */
export function CoverTile({ book }: { book: ShelfBook }) {
  const hasCover = isValidHttpUrl(book.cover_image_url);
  return (
    <Link href={`/books/${book.slug}`} className="group block">
      <span className="book-cover-tilt block aspect-[2/3] rounded-[3px_6px_6px_3px] overflow-hidden bg-subtle shadow-[0_10px_18px_-10px_rgba(58,40,28,0.55)]">
        <span className="book-cover-tilt-inner block relative w-full h-full">
          {hasCover ? (
            <SafeImage
              src={book.cover_image_url as string}
              alt={coverAltText(book.title, book.author)}
              className="w-full h-full object-cover"
              fallback={<NoCover title={book.title} />}
            />
          ) : (
            <NoCover title={book.title} />
          )}
          <span className="book-cover-hinge" aria-hidden="true" />
          <span className="book-cover-sheen" aria-hidden="true" />
        </span>
      </span>
      <span className="block mt-2.5 text-sm font-semibold text-ink leading-snug line-clamp-2 group-hover:text-accent transition-colors">
        {book.title}
      </span>
      {book.author && <span className="block text-xs text-muted truncate">{book.author}</span>}
      {book.recommendation_count > 0 && (
        <span className="block text-[11px] text-muted/80 mt-0.5">
          {book.recommendation_count.toLocaleString("en-US")} {book.recommendation_count === 1 ? "person recommends it" : "people recommend it"}
        </span>
      )}
    </Link>
  );
}

/** Compact row: small cover, title, author, count. */
export function BookRow({ book }: { book: ShelfBook }) {
  const hasCover = isValidHttpUrl(book.cover_image_url);
  return (
    <Link
      href={`/books/${book.slug}`}
      className="group flex items-center gap-3 rounded-lg p-1.5 -mx-1.5 hover:bg-subtle/70 transition-colors"
    >
      <span className="w-10 h-[60px] shrink-0 rounded-[2px_4px_4px_2px] overflow-hidden bg-subtle shadow-[inset_3px_0_0_rgba(0,0,0,0.15),0_4px_8px_-4px_rgba(58,40,28,0.5)]">
        {hasCover ? (
          <SafeImage
            src={book.cover_image_url as string}
            alt={coverAltText(book.title, book.author)}
            className="w-full h-full object-cover"
            fallback={<span className="block w-full h-full bg-border/60" />}
          />
        ) : (
          <span className="block w-full h-full bg-border/60" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink leading-snug truncate group-hover:text-accent transition-colors">
          {book.title}
        </span>
        <span className="block text-xs text-muted truncate">
          {book.author}
          {book.author && book.recommendation_count > 0 ? " · " : ""}
          {book.recommendation_count > 0 ? `${book.recommendation_count.toLocaleString("en-US")} recs` : ""}
        </span>
      </span>
    </Link>
  );
}
