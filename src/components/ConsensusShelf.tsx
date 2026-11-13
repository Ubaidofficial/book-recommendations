"use client";

import Link from "next/link";
import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { NavBook } from "@/lib/siteNav";
import { shelfColours } from "@/lib/spinePalette";
import { coverAltText } from "@/lib/dataQuality";
import { Book3D, bookDepthRatio } from "./Book3D";

/**
 * "The books most people agree on": the most-recommended books as spines on a
 * shelf. Spine height is the book's recommendation count, scaled between the
 * shelf's own min and max so the differences read at a glance; thickness
 * follows the page count. Picking a spine shows the book in 3D with its count
 * and a link to its page.
 *
 * Keyboard: the shelf is one tab stop (roving tabindex). Arrow keys, Home and
 * End move between spines; Enter or Space takes one off the shelf.
 */
export function ConsensusShelf({ books }: { books: NavBook[] }) {
  const shelf = books.filter((b) => b.count > 0).slice(0, 18);
  const [selected, setSelected] = useState(0);
  const [focusIdx, setFocusIdx] = useState(0);
  const spineRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (shelf.length === 0) return null;

  const counts = shelf.map((b) => b.count);
  const max = Math.max(...counts);
  const min = Math.min(...counts);
  const span = Math.max(1, max - min);
  const colours = shelfColours(shelf.map((b) => b.slug));
  const currentIdx = Math.min(selected, shelf.length - 1);
  const current = shelf[currentIdx];
  const currentColour = colours[currentIdx];

  const moveFocus = (i: number) => {
    const next = (i + shelf.length) % shelf.length;
    setFocusIdx(next);
    spineRefs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(focusIdx + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(focusIdx - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveFocus(0);
    } else if (e.key === "End") {
      e.preventDefault();
      moveFocus(shelf.length - 1);
    }
  };

  return (
    <section aria-labelledby="consensus-heading" className="py-14 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div className="max-w-2xl">
            <h2 id="consensus-heading" className="text-2xl md:text-3xl font-bold text-ink tracking-tight">
              The books most people agree on
            </h2>
            <p className="mt-2 text-sm md:text-base text-muted leading-relaxed">
              Each spine is as tall as the number of people on BookMentions who recommend that book. Pick one to take it off the shelf.
            </p>
          </div>
          <Link
            href="/lists/most-recommended-books"
            className="text-sm font-semibold text-accent hover:text-accent-hover whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1 -mx-1"
          >
            Most recommended books, ranked →
          </Link>
        </div>

        <div className="cs-grid">
          <div className="cs-case">
            <div className="cs-scroll">
              <div
                role="toolbar"
                aria-label="Most recommended books, tallest spine first"
                aria-orientation="horizontal"
                className="cs-row"
                onKeyDown={onKeyDown}
              >
                {shelf.map((b, i) => {
                  const c = colours[i];
                  // Page counts under 60 are almost always a bad record (a
                  // sample, a pamphlet edition), so they get the default width.
                  const ratio = bookDepthRatio(b.pageCount && b.pageCount >= 60 ? b.pageCount : null);
                  const width = Math.round(24 + ((ratio - 0.06) / 0.16) * 28);
                  const style = {
                    "--t": ((b.count - min) / span).toFixed(3),
                    "--w": `${width}px`,
                    "--cloth": c.cloth,
                    "--ink": c.ink,
                  } as CSSProperties;
                  const isSelected = i === selected;
                  return (
                    <button
                      key={b.slug}
                      ref={(el) => {
                        spineRefs.current[i] = el;
                      }}
                      type="button"
                      className="cs-spine"
                      style={style}
                      tabIndex={i === focusIdx ? 0 : -1}
                      aria-pressed={isSelected}
                      aria-label={`${b.title}${b.author ? ` by ${b.author}` : ""}, recommended by ${b.count} people`}
                      onFocus={() => setFocusIdx(i)}
                      onClick={() => {
                        setSelected(i);
                        setFocusIdx(i);
                      }}
                    >
                      <span className="cs-count" aria-hidden="true">{b.count}</span>
                      <span className="cs-title" aria-hidden="true">{b.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="cs-plank" aria-hidden="true" />
            <div className="cs-axis">
              <span>Spine height = people recommending it</span>
              <span>
                {min === max ? `${max} people` : `${min} to ${max} people`}
              </span>
            </div>
          </div>

          <div className="cs-detail" aria-live="polite">
            <div className="cs-detail-book">
              <Book3D
                key={current.slug}
                src={current.cover}
                alt={coverAltText(current.title, current.author)}
                width={140}
                pageCount={current.pageCount}
                fallback={
                  <div
                    className="w-full h-full flex flex-col justify-between p-3 text-left"
                    style={{ background: currentColour.cloth, color: currentColour.ink }}
                  >
                    <span className="text-[15px] font-bold leading-tight line-clamp-5">{current.title}</span>
                    {current.author && <span className="text-[11px] opacity-80 leading-snug">{current.author}</span>}
                  </div>
                }
              />
            </div>
            <div>
              <p className="text-4xl font-bold text-accent leading-none tabular-nums">{current.count}</p>
              <p className="mt-1 text-xs text-muted">people recommend it</p>
            </div>
            <div>
              <h3 className="text-lg font-bold text-ink leading-snug">{current.title}</h3>
              <p className="mt-0.5 text-xs text-muted">
                {current.author ? `by ${current.author} · ` : ""}#{currentIdx + 1} on this shelf
              </p>
            </div>
            <Link
              href={`/books/${current.slug}`}
              className="inline-flex items-center justify-center rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Who recommends {current.title} →
            </Link>
          </div>
        </div>

        {/* The same shelf as text: a screen-reader and no-JS alternative to
            the chart, and a crawlable link to every book on it. */}
        <details className="cs-list mt-4 text-sm">
          <summary className="cursor-pointer text-muted hover:text-ink w-fit rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            Show this shelf as a list
          </summary>
          <ol className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-1.5">
            {shelf.map((b, i) => (
              <li key={b.slug} className="flex items-baseline gap-2 min-w-0">
                <span className="w-6 shrink-0 text-right text-xs text-muted tabular-nums">{i + 1}.</span>
                <Link href={`/books/${b.slug}`} className="truncate text-ink hover:text-accent transition-colors">
                  {b.title}
                </Link>
                <span className="shrink-0 text-xs text-muted">{b.count} people</span>
              </li>
            ))}
          </ol>
        </details>
      </div>
    </section>
  );
}
