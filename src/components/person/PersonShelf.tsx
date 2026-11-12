"use client";

import Link from "next/link";
import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Book3D } from "@/components/Book3D";

export interface ShelfSpine {
  slug: string;
  title: string;
  author: string;
  coverUrl: string;
  recommendationCount: number;
  pageCount: number | null;
  /** Precomputed on the server from a stable hash, so SSR and client agree. */
  height: number;
  width: number;
  color: string;
  ink: string;
  /** Has a proof card further down this page (anchor #proof-<slug>). */
  hasProof: boolean;
}

function PanelFallback({ title }: { title: string }) {
  return (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-subtle to-border/60 p-3 text-center">
      <span className="text-sm font-semibold text-ink/70 leading-snug line-clamp-5">{title}</span>
    </div>
  );
}

/**
 * "On the shelf": up to 16 of a person's most-recommended books as spines.
 *
 * Each spine is a real <button> (aria-pressed, accessible "Title by Author"
 * label). Picking one shows that book in the side panel as a 3D book with a
 * link to its page. Arrow keys move between spines; Home/End jump to the
 * ends. Motion is transform-only and gated behind motion-safe, so
 * prefers-reduced-motion gets a still shelf (the selected spine just sits
 * raised).
 */
export function PersonShelf({
  books,
  firstName,
  panelId = "shelf-focus",
}: {
  books: ShelfSpine[];
  firstName: string;
  panelId?: string;
}) {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const book = books[active] ?? books[0];
  if (!book) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = refs.current.findIndex((el) => el === document.activeElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(books.length - 1, i + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(0, i - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = books.length - 1;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
      <div className="min-w-0">
        <div className="rounded-2xl border border-border bg-gradient-to-b from-subtle/40 to-[#ebe5db] overflow-hidden">
          <div
            role="group"
            aria-label={`${firstName}’s shelf: pick a book`}
            onKeyDown={onKeyDown}
            className="overflow-x-auto overscroll-x-contain"
          >
            <div className="flex items-end justify-start sm:justify-center gap-[3px] min-w-max px-5 pt-10 min-h-[260px]">
              {books.map((b, i) => {
                const selected = i === active;
                return (
                  <button
                    key={b.slug}
                    ref={(el) => {
                      refs.current[i] = el;
                    }}
                    type="button"
                    aria-pressed={selected}
                    aria-controls={panelId}
                    aria-label={`${b.title}${b.author ? ` by ${b.author}` : ""}`}
                    title={b.title}
                    onClick={() => setActive(i)}
                    style={
                      {
                        height: b.height,
                        width: b.width,
                        backgroundColor: b.color,
                        // Rounded-spine shading: dark at both edges, a soft
                        // highlight just left of centre.
                        backgroundImage:
                          "linear-gradient(90deg, rgba(0,0,0,.30), rgba(0,0,0,.04) 22%, rgba(255,255,255,.16) 44%, rgba(0,0,0,.04) 70%, rgba(0,0,0,.28))",
                        color: b.ink,
                      } as CSSProperties
                    }
                    className={[
                      "relative shrink-0 rounded-t-[3px] rounded-b-[1px] flex items-center justify-center overflow-hidden",
                      "shadow-[inset_3px_0_0_rgba(0,0,0,0.18),inset_-3px_0_0_rgba(0,0,0,0.22),0_1px_0_rgba(0,0,0,0.15)]",
                      "motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                      selected
                        ? "-translate-y-5 ring-2 ring-accent ring-offset-1 ring-offset-[#ebe5db]"
                        : "motion-safe:hover:-translate-y-2.5 motion-safe:focus-visible:-translate-y-2.5",
                    ].join(" ")}
                  >
                    {/* Paper bands top and bottom, as on a cloth binding. */}
                    <span aria-hidden="true" className="absolute inset-x-0 top-2 h-[2px] opacity-40" style={{ backgroundColor: b.ink }} />
                    <span aria-hidden="true" className="absolute inset-x-0 bottom-3 h-[2px] opacity-40" style={{ backgroundColor: b.ink }} />
                    <span
                      aria-hidden="true"
                      className="[writing-mode:vertical-rl] rotate-180 whitespace-nowrap overflow-hidden text-ellipsis font-serif font-semibold text-[12px] leading-none tracking-tight"
                      style={{ maxHeight: b.height - 30 }}
                    >
                      {b.title}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          {/* The plank the books stand on. */}
          <div aria-hidden="true" className="h-3 bg-gradient-to-b from-[#d9cfbf] to-[#c8bba7] shadow-[0_8px_14px_-8px_rgba(58,40,28,0.45)]" />
        </div>
        <p className="mt-2 text-xs text-muted">
          Spines are ordered by how many people on BookMentions recommend each book.
          <span className="sm:hidden"> Swipe the shelf to see the rest.</span>
          <span className="hidden sm:inline"> Arrow keys move along the shelf.</span>
        </p>
      </div>

      <aside
        id={panelId}
        aria-live="polite"
        className="rounded-2xl border border-border bg-surface p-5 flex flex-col items-center text-center gap-4 lg:sticky lg:top-24"
      >
        <div className="pt-2 pb-4">
          <Book3D
            key={book.slug}
            src={book.coverUrl}
            alt={`Book cover for “${book.title}”${book.author ? ` by ${book.author}` : ""}`}
            width={150}
            pageCount={book.pageCount}
            fallback={<PanelFallback title={book.title} />}
          />
        </div>
        <div>
          <h3 className="text-lg font-bold text-ink leading-snug">{book.title}</h3>
          {book.author && <p className="text-sm text-muted mt-0.5">by {book.author}</p>}
        </div>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
          {book.recommendationCount > 0 && (
            <span>
              <b className="text-ink tabular-nums">{book.recommendationCount.toLocaleString("en-US")}</b>{" "}
              {book.recommendationCount === 1 ? "person recommends it" : "people recommend it"}
            </span>
          )}
          {book.pageCount ? (
            <span>
              <b className="text-ink tabular-nums">{book.pageCount.toLocaleString("en-US")}</b> pages
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Link
            href={`/books/${book.slug}`}
            className="inline-flex items-center px-3.5 py-2 rounded-lg bg-accent text-white text-xs font-bold hover:bg-accent-hover transition-colors"
          >
            See the book →
          </Link>
          {book.hasProof && (
            <a
              href={`#proof-${book.slug}`}
              className="inline-flex items-center px-3.5 py-2 rounded-lg border border-border text-ink text-xs font-semibold hover:border-accent/40 hover:text-accent transition-colors"
            >
              Source &amp; proof ↓
            </a>
          )}
        </div>
      </aside>
    </div>
  );
}
