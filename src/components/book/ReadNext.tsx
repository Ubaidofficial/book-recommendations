import Link from "next/link";
import { SafeImage } from "@/components/SafeImage";
import { coverAltText } from "@/lib/dataQuality";
import { displayBookTitle } from "@/lib/display";
import type { ReadNextBook } from "@/lib/bookInsights";
import { BookSectionHeading } from "./primitives";

/**
 * "Read next": the books most often recommended by the same people who
 * recommend this one, with the overlap stated as a count of people.
 */
export function ReadNext({ bookTitle, books }: { bookTitle: string; books: ReadNextBook[] }) {
  if (books.length < 2) return null;
  return (
    <section className="mb-16" aria-labelledby="read-next">
      <BookSectionHeading
        id="read-next"
        title="Read next"
        dek={`Books most often recommended by the same people who recommend ${bookTitle}.`}
      />
      <ul data-reveal-stagger className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-8">
        {books.map((b) => {
          const title = displayBookTitle(b.title);
          return (
            <li key={b.id} className="min-w-0">
              <Link href={`/books/${b.slug}`} className="group block text-center">
                <span className="book-cover-tilt block mx-auto w-full max-w-[150px]">
                  <span className="book-cover-tilt-inner relative block aspect-[2/3] overflow-hidden rounded-[3px_6px_6px_3px] bg-subtle shadow-[0_14px_24px_-12px_rgba(58,40,28,0.55),0_2px_6px_rgba(58,40,28,0.12)]">
                    <SafeImage
                      src={b.cover_image_url}
                      alt={coverAltText(title, b.author)}
                      className="w-full h-full object-cover"
                      fallback={
                        <span className="flex h-full w-full items-center justify-center p-3 text-xs font-medium text-ink/70">
                          {title}
                        </span>
                      }
                    />
                    <span className="book-cover-hinge" aria-hidden="true" />
                    <span className="book-cover-sheen" aria-hidden="true" />
                  </span>
                </span>
                <span className="mt-3 block font-serif text-base leading-snug text-ink group-hover:text-accent line-clamp-2">
                  {title}
                </span>
                {b.author && <span className="mt-0.5 block text-xs text-muted truncate">{b.author}</span>}
                <span className="mt-1 block text-xs text-muted">
                  {b.shared.toLocaleString()} shared recommender{b.shared === 1 ? "" : "s"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
