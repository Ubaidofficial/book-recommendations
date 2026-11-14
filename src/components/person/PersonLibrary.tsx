"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SafeImage } from "@/components/SafeImage";

/**
 * One book on a person's list, already reduced on the server to what a card
 * shows. Quotes arrive pre-vetted (getProofDisplaySafety) and pre-truncated, so
 * nothing here decides what is safe to publish.
 */
export interface LibraryItem {
  slug: string;
  title: string;
  author: string;
  /** "" when the book has no usable cover. */
  cover: string;
  /** BookMentions recommendation score (not a Goodreads/Amazon rating). */
  score: number | null;
  /** How many people on BookMentions recommend it. */
  recs: number;
  year: number | null;
  /** Amazon affiliate URL, built on the server. */
  amazon: string | null;
  /** Indexes into the `topics` prop. */
  topics: number[];
  quote: string | null;
  /** A single, vetted source URL, or null. */
  source: string | null;
  sourceHost: string | null;
  sourceRel: string;
}

export interface LibraryTopic {
  slug: string;
  title: string;
  count: number;
}

type SortKey = "popular" | "score" | "newest" | "oldest" | "az";
type View = "grid" | "list";

const PAGE_STEP = 24;
/** Below this many books there is nothing to search or sort, so the controls stay away. */
const TOOLS_MIN = 12;
const VIEW_KEY = "bm-person-view";

const SORT_LABELS: Record<SortKey, string> = {
  popular: "Most recommended",
  score: "Highest score",
  newest: "Newest published",
  oldest: "Oldest first",
  az: "Title A–Z",
};

// Missing values always sort last, in either direction.
function byNullable(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
}

function compare(sort: SortKey): (a: LibraryItem, b: LibraryItem) => number {
  const popular = (a: LibraryItem, b: LibraryItem) => b.recs - a.recs || a.title.localeCompare(b.title);
  switch (sort) {
    case "score":
      return (a, b) => byNullable(a.score, b.score, -1) || popular(a, b);
    case "newest":
      return (a, b) => byNullable(a.year, b.year, -1) || popular(a, b);
    case "oldest":
      return (a, b) => byNullable(a.year, b.year, 1) || popular(a, b);
    case "az":
      return (a, b) => a.title.localeCompare(b.title);
    default:
      return popular;
  }
}

function matches(item: LibraryItem, q: string): boolean {
  if (!q) return true;
  return `${item.title} ${item.author} ${item.quote ?? ""}`.toLowerCase().includes(q);
}

const ExternalIcon = () => (
  <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
  </svg>
);

function NoCover({ title }: { title: string }) {
  return (
    <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-subtle to-subtle/40 p-3 text-center text-xs font-medium leading-snug text-ink/70 line-clamp-5">
      {title}
    </span>
  );
}

function Card({
  item,
  view,
  topics,
  onTopic,
}: {
  item: LibraryItem;
  view: View;
  topics: LibraryTopic[];
  onTopic: (i: number) => void;
}) {
  const list = view === "list";
  // One chip in a grid card (they stack tall in a narrow column), two in a row.
  const chips = item.topics.slice(0, list ? 2 : 1);
  return (
    <li
      className={[
        "group rounded-2xl border border-border bg-surface overflow-hidden motion-card-hover hover:border-accent/20 flex",
        list ? "flex-row" : "flex-col",
      ].join(" ")}
    >
      <Link
        href={`/books/${item.slug}`}
        className={[
          "book-cover-tilt block bg-subtle overflow-hidden shrink-0",
          list ? "w-24 sm:w-28 self-start m-3 rounded-lg aspect-[2/3]" : "aspect-[2/3]",
        ].join(" ")}
        tabIndex={-1}
        aria-hidden="true"
      >
        <span className="book-cover-tilt-inner block relative w-full h-full">
          <SafeImage
            src={item.cover}
            alt=""
            className="w-full h-full object-cover"
            fallback={<NoCover title={item.title} />}
          />
          <span className="book-cover-hinge" aria-hidden="true" />
          <span className="book-cover-sheen" aria-hidden="true" />
        </span>
      </Link>

      <div className={["flex flex-col flex-1 min-w-0", list ? "py-3 pr-3 sm:py-4 sm:pr-4" : "p-4"].join(" ")}>
        <Link href={`/books/${item.slug}`} className="block">
          <h3 className="font-semibold text-sm text-ink leading-snug line-clamp-2 group-hover:text-accent transition-colors">
            {item.title}
          </h3>
        </Link>
        {item.author && <p className="mt-0.5 text-xs text-muted truncate">{item.author}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {item.score != null && item.score > 0 && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-light text-accent font-medium"
              title="BookMentions recommendation score — not an Amazon or Goodreads rating"
            >
              ★ {item.score.toFixed(1)}
            </span>
          )}
          {item.recs > 0 && <span className="text-muted">{item.recs.toLocaleString("en-US")} recs</span>}
          {item.year != null && <span className="text-muted tabular-nums">· {item.year}</span>}
        </div>

        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onTopic(t)}
                className="inline-flex items-center min-h-6 rounded-full border border-border px-2.5 text-[11px] font-medium text-muted-strong hover:border-accent/40 hover:text-accent transition-colors"
                title={`Show only ${topics[t].title}`}
              >
                {topics[t].title}
              </button>
            ))}
          </div>
        )}

        {item.quote ? (
          <figure className="mt-3 m-0">
            <blockquote
              className={[
                "text-[13px] text-muted-strong italic leading-relaxed border-l-2 border-accent/30 pl-3",
                list ? "line-clamp-3" : "line-clamp-4",
              ].join(" ")}
            >
              “{item.quote}”
            </blockquote>
            {item.source && (
              <figcaption className="mt-1.5 pl-3">
                <a
                  href={item.source}
                  target="_blank"
                  rel={item.sourceRel}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline underline-offset-2"
                >
                  Source{item.sourceHost ? ` · ${item.sourceHost}` : ""}
                  <ExternalIcon />
                </a>
              </figcaption>
            )}
          </figure>
        ) : item.source ? (
          <a
            href={item.source}
            target="_blank"
            rel={item.sourceRel}
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline underline-offset-2 w-fit"
          >
            Cited source{item.sourceHost ? ` · ${item.sourceHost}` : ""}
            <ExternalIcon />
          </a>
        ) : null}

        <div className="mt-auto pt-4 flex items-center gap-2">
          <Link
            href={`/books/${item.slug}`}
            className="flex-1 inline-flex items-center justify-center min-h-10 px-3 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent-hover transition-colors"
          >
            View details
          </Link>
          {item.amazon && (
            <a
              href={item.amazon}
              target="_blank"
              rel="noopener noreferrer nofollow sponsored"
              data-track-slug={item.slug}
              data-track-section="people-detail-rec"
              data-track-label="View on Amazon"
              aria-label={`Find ${item.title} on Amazon`}
              className="inline-flex items-center justify-center gap-1 min-h-10 px-3 rounded-lg border border-border text-xs font-semibold text-muted-strong hover:border-amber-500 hover:text-amber-700 transition-colors"
            >
              Amazon
              <ExternalIcon />
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

const iconProps = { className: "w-4 h-4", fill: "none", stroke: "currentColor", strokeWidth: 1.8, viewBox: "0 0 24 24", "aria-hidden": true } as const;

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        "shrink-0 inline-flex items-center gap-1.5 min-h-9 px-3.5 rounded-full border text-xs font-semibold whitespace-nowrap transition-colors",
        active
          ? "bg-ink text-white border-ink"
          : "bg-surface text-ink border-border hover:border-accent/40 hover:text-accent",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/**
 * The person page's full list: every book, with sort, topic filter, search,
 * a grid/list switch and "show more".
 *
 * This is all client state over data the server already has. The page stays
 * statically generated: it never reads searchParams, so the cached HTML (first
 * 24 cards, default order) is what a crawler and a no-JS reader get. A single
 * <details> index of every title at the bottom keeps the remaining books
 * linked in the HTML, since a crawler will not press "Show more".
 */
export function PersonLibrary({
  items,
  topics,
  firstName,
}: {
  items: LibraryItem[];
  topics: LibraryTopic[];
  firstName: string;
}) {
  const [sort, setSort] = useState<SortKey>("popular");
  const [topic, setTopic] = useState<number | null>(null);
  const [quotesOnly, setQuotesOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_STEP);
  const [view, setView] = useState<View>("grid");

  // Grid is what the server renders. On a phone, or when the reader chose
  // before, switch once hydrated. Both reads are guarded: storage can throw.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(VIEW_KEY);
    } catch {
      /* private mode, blocked storage */
    }
    if (saved === "grid" || saved === "list") setView(saved);
    else if (window.matchMedia("(max-width: 639px)").matches) setView("list");
  }, []);

  const chooseView = (v: View) => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const withYear = useMemo(() => items.filter((i) => i.year != null).length, [items]);
  const quoteCount = useMemo(() => items.filter((i) => i.quote).length, [items]);
  const sortKeys = useMemo(
    () => (Object.keys(SORT_LABELS) as SortKey[]).filter((k) => (k === "newest" || k === "oldest" ? withYear >= 10 : true)),
    [withYear],
  );

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      items
        .filter((i) => (topic == null || i.topics.includes(topic)) && (!quotesOnly || i.quote) && matches(i, q))
        .sort(compare(sort)),
    // items is stable for the life of the page; sort() on the filtered copy only.
    [items, topic, quotesOnly, q, sort],
  );
  const tools = items.length > TOOLS_MIN;
  const shown = filtered.slice(0, limit);
  const filtering = topic != null || quotesOnly || q !== "";

  const reset = () => {
    setTopic(null);
    setQuotesOnly(false);
    setQuery("");
    setLimit(PAGE_STEP);
  };
  const pickTopic = (t: number | null) => {
    setTopic(t);
    setLimit(PAGE_STEP);
  };

  const scrollToToolbar = () => {
    document.getElementById("library-toolbar")?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div id="library">
      {tools && (
      <div
        id="library-toolbar"
        role="search"
        aria-label={`Search and filter ${firstName}’s books`}
        className="md:sticky md:top-16 z-30 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-bg/90 backdrop-blur-md border-y border-border scroll-mt-16"
      >
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative order-1 w-full sm:w-auto sm:flex-1 sm:max-w-sm">
            <span className="sr-only">Search {firstName}’s books</span>
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path strokeLinecap="round" d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE_STEP);
              }}
              placeholder="Search title, author or quote"
              className="w-full min-h-10 pl-9 pr-3 rounded-lg border border-border bg-surface text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
          </label>

          <label className="order-2 flex items-center gap-2 text-sm text-muted">
            <span className="sr-only sm:not-sr-only">Sort</span>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as SortKey);
                setLimit(PAGE_STEP);
              }}
              className="min-h-10 border border-border rounded-lg px-3 bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/25"
            >
              {sortKeys.map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          </label>

          <div role="group" aria-label="Layout" className="order-3 ml-auto inline-flex rounded-lg border border-border bg-surface p-0.5">
            {(["grid", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                aria-label={v === "grid" ? "Grid view" : "List view"}
                title={v === "grid" ? "Grid view" : "List view"}
                onClick={() => chooseView(v)}
                className={[
                  "inline-flex items-center justify-center w-10 h-9 rounded-md transition-colors",
                  view === v ? "bg-ink text-white" : "text-muted hover:text-ink",
                ].join(" ")}
              >
                {v === "grid" ? (
                  <svg {...iconProps}>
                    <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
                    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
                    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
                    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
                  </svg>
                ) : (
                  <svg {...iconProps}>
                    <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>

        <div
          role="group"
          aria-label="Filter books"
          className="mt-2.5 -mx-4 px-4 md:mx-0 md:px-0 flex gap-2 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,#000_calc(100%-16px),transparent)]"
        >
          <Chip active={topic == null} onClick={() => pickTopic(null)}>
            All <span className="tabular-nums opacity-70">{items.length}</span>
          </Chip>
          {topics.map((t, i) => (
            <Chip key={t.slug} active={topic === i} onClick={() => pickTopic(topic === i ? null : i)}>
              {t.title} <span className="tabular-nums opacity-70">{t.count}</span>
            </Chip>
          ))}
          {quoteCount > 0 && (
            <Chip
              active={quotesOnly}
              onClick={() => {
                setQuotesOnly((v) => !v);
                setLimit(PAGE_STEP);
              }}
            >
              With {firstName}’s words <span className="tabular-nums opacity-70">{quoteCount}</span>
            </Chip>
          )}
        </div>
      </div>
      )}

      {tools ? (
      <div className="mt-4 mb-4 flex items-center justify-between gap-3 text-sm text-muted">
        <p aria-live="polite">
          Showing <b className="text-ink tabular-nums">{shown.length.toLocaleString("en-US")}</b> of{" "}
          <span className="tabular-nums">{filtered.length.toLocaleString("en-US")}</span>
          {filtering ? " matching" : ""} {filtered.length === 1 ? "book" : "books"}
        </p>
        {filtering && (
          <button type="button" onClick={reset} className="min-h-9 px-2 text-sm font-semibold text-accent hover:underline underline-offset-2">
            Clear filters
          </button>
        )}
      </div>
      ) : null}

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <p className="text-sm text-muted">No books match those filters.</p>
          <button type="button" onClick={reset} className="mt-3 min-h-10 px-4 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover transition-colors">
            Show all {items.length.toLocaleString("en-US")} books
          </button>
        </div>
      ) : (
        <ul
          className={
            view === "list"
              ? "grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4"
              : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-5 lg:gap-6"
          }
        >
          {shown.map((item) => (
            <Card
              key={item.slug}
              item={item}
              view={view}
              topics={topics}
              onTopic={(t) => {
                pickTopic(t);
                scrollToToolbar();
              }}
            />
          ))}
        </ul>
      )}

      {filtered.length > shown.length && (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setLimit((l) => l + PAGE_STEP)}
            className="min-h-11 px-6 rounded-lg border border-border bg-surface text-sm font-semibold text-ink hover:border-accent hover:text-accent transition-colors"
          >
            Show {Math.min(PAGE_STEP, filtered.length - shown.length)} more
          </button>
          <button
            type="button"
            onClick={() => setLimit(filtered.length)}
            className="min-h-11 px-4 text-sm font-semibold text-accent hover:underline underline-offset-2"
          >
            Show all {filtered.length.toLocaleString("en-US")}
          </button>
        </div>
      )}

      {items.length > PAGE_STEP && (
      <details className="mt-10 rounded-2xl border border-border bg-surface px-5 py-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink select-none min-h-9 flex items-center">
          Index of all {items.length.toLocaleString("en-US")} titles
        </summary>
        <ul className="mt-3 columns-1 sm:columns-2 lg:columns-3 gap-6 text-sm">
          {[...items]
            .sort((a, b) => a.title.localeCompare(b.title))
            .map((i) => (
              <li key={i.slug} className="break-inside-avoid py-1">
                <Link href={`/books/${i.slug}`} className="text-ink hover:text-accent hover:underline underline-offset-2">
                  {i.title}
                </Link>
                {i.author && <span className="text-muted"> — {i.author}</span>}
              </li>
            ))}
        </ul>
      </details>
      )}
    </div>
  );
}
