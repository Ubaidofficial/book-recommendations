import { Metadata } from "next";
import Link from "next/link";
import {
  getBooksPaginated,
  searchBooksPaginated,
  getBooksByListSlugPaginated,
} from "@/lib/data";
import { pageMetadata } from "@/lib/seo";
import { BookCard, SearchBar, SortSelect, Breadcrumbs, EmptyState } from "@/components";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Browse Books",
  description:
    "Explore recommended books ranked by recommendation signals, lists, series, ratings, and source-backed mentions.",
  path: "/books",
});

const PAGE_SIZE = 48;

// Chip → DB list slug mapping. URL `paramSlug` is the stable user-facing token
// shown in the address bar; `listSlug` is the canonical row in the production
// `lists` table this chip filters by. Probes confirmed all listSlugs exist with
// non-trivial book counts (Fiction 4717, Nonfiction 7816, Science Fiction 550,
// Classics → best-classic-books 58, History 1656, Self-Help → personal-development 1001).
const CATEGORY_CHIPS: ReadonlyArray<{ label: string; paramSlug: string | null; listSlug: string | null }> = [
  { label: "All", paramSlug: null, listSlug: null },
  { label: "Fiction", paramSlug: "fiction", listSlug: "fiction" },
  { label: "Non-Fiction", paramSlug: "non-fiction", listSlug: "nonfiction" },
  { label: "Science Fiction", paramSlug: "science-fiction", listSlug: "science-fiction" },
  { label: "Classics", paramSlug: "classics", listSlug: "best-classic-books" },
  { label: "History", paramSlug: "history", listSlug: "history" },
  { label: "Self-Help", paramSlug: "self-help", listSlug: "personal-development" },
];

const SORT_OPTIONS = [
  { value: "recommendation_count", label: "Most Recommended" },
  { value: "rating", label: "Highest Rated" },
  { value: "title", label: "Title A-Z" },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]["value"];
const SORT_KEYS = new Set<string>(SORT_OPTIONS.map((s) => s.value));

interface Props {
  searchParams: Promise<{ q?: string; category?: string; sort?: string; page?: string }>;
}

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw || "1", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 1000); // hard ceiling defensive against URL fuzzing
}

function parseSort(raw: string | undefined): SortKey {
  return raw && SORT_KEYS.has(raw) ? (raw as SortKey) : "recommendation_count";
}

/** Build a URL-encoded query string preserving current filter context, with overrides. */
function buildQs(opts: { q?: string | null; category?: string | null; sort?: string | null; page?: number | null }) {
  const sp = new URLSearchParams();
  if (opts.q) sp.set("q", opts.q);
  if (opts.category) sp.set("category", opts.category);
  if (opts.sort && opts.sort !== "recommendation_count") sp.set("sort", opts.sort);
  if (opts.page && opts.page > 1) sp.set("page", String(opts.page));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default async function BooksPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = (sp.q || "").trim();
  const categoryParam = (sp.category || "").trim().toLowerCase();
  const sort: SortKey = parseSort(sp.sort);
  const page = parsePage(sp.page);

  // Resolve chip — unknown values fall back to "All" so a bad URL doesn't
  // produce an empty-looking page with no visible cause.
  const activeChip =
    CATEGORY_CHIPS.find((c) => c.paramSlug === categoryParam) || CATEGORY_CHIPS[0];

  // Choose data source by mode priority: search > category > all.
  let result: Awaited<ReturnType<typeof getBooksPaginated>>;
  let mode: "search" | "category" | "all";
  if (q.length >= 2) {
    mode = "search";
    result = await searchBooksPaginated(q, page, PAGE_SIZE, sort);
  } else if (activeChip.listSlug) {
    mode = "category";
    result = await getBooksByListSlugPaginated(activeChip.listSlug, page, PAGE_SIZE, sort);
  } else {
    mode = "all";
    result = await getBooksPaginated(page, PAGE_SIZE, sort);
  }

  const { data: books, total } = result;
  const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1;
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const subtitle =
    mode === "search"
      ? `Results for "${q}"`
      : mode === "category"
        ? `Showing books in ${activeChip.label}`
        : "Discover books recommended by people you trust.";

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Books" }]} />
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-ink mb-2 tracking-tight">Browse Books</h1>
        <p className="text-base text-muted">{subtitle}</p>
      </div>

      <div className="mb-8">
        <SearchBar placeholder="Search by title or author…" />
      </div>

      {/* Category chips — real navigation links. Active state derived from
          the resolved chip (handles unknown URLs by falling back to "All"). */}
      <div className="flex items-center gap-3 mb-6 overflow-x-auto pb-2">
        {CATEGORY_CHIPS.map((chip) => {
          const isActive = chip.paramSlug === activeChip.paramSlug;
          // When a chip is clicked, we drop the page param (chip change invalidates
          // any prior page offset) and the q param (search and category are
          // separate modes; switching chip implies "browse this category fresh").
          const href = `/books${buildQs({ category: chip.paramSlug, sort })}`;
          return (
            <Link
              key={chip.label}
              href={href}
              prefetch={false}
              aria-current={isActive ? "page" : undefined}
              className={`text-xs px-3.5 py-1.5 rounded-full border transition-colors shrink-0 font-medium ${
                isActive
                  ? "bg-accent text-white border-accent"
                  : "border-border text-muted hover:border-accent hover:text-accent"
              }`}
            >
              {chip.label}
            </Link>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 mb-6 text-sm flex-wrap">
        <span className="text-muted">
          {total > 0
            ? `${total.toLocaleString()} ${total === 1 ? "book" : "books"}${
                mode === "search" ? "" : mode === "category" ? ` in ${activeChip.label}` : ""
              }`
            : "No matching books"}
        </span>
        <SortSelect
          value={sort}
          options={SORT_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
          ariaLabel="Sort books"
        />
      </div>

      {books.length === 0 ? (
        <EmptyState
          message={
            mode === "search"
              ? `No books match "${q}".`
              : mode === "category"
                ? `No books found in ${activeChip.label}.`
                : "No books found. Check back soon."
          }
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
          {books.map((book) => (
            <BookCard
              key={book.id}
              title={book.title}
              slug={book.slug}
              author={book.author}
              authorSlug={book.author_slug}
              coverUrl={book.cover_image_url}
              rating={book.rating}
              recommendationCount={book.recommendation_count}
            />
          ))}
        </div>
      )}

      {/* Pagination — only renders when there's actually a page beyond what we
          just showed. Prev/Next are real <Link>s so they work without JS. */}
      {(hasPrev || hasNext) && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-center gap-2 mt-10 flex-wrap"
        >
          {hasPrev ? (
            <Link
              href={`/books${buildQs({ q: q || null, category: activeChip.paramSlug, sort, page: page - 1 })}`}
              prefetch={false}
              className="px-4 py-2 rounded-lg border border-border text-sm text-ink hover:border-accent hover:text-accent transition-colors"
            >
              ← Previous
            </Link>
          ) : (
            <span className="px-4 py-2 rounded-lg border border-border text-sm text-muted/40 cursor-not-allowed">
              ← Previous
            </span>
          )}
          <span className="text-sm text-muted px-2">
            Page {page} of {totalPages.toLocaleString()}
          </span>
          {hasNext ? (
            <Link
              href={`/books${buildQs({ q: q || null, category: activeChip.paramSlug, sort, page: page + 1 })}`}
              prefetch={false}
              className="px-4 py-2 rounded-lg border border-border text-sm text-ink hover:border-accent hover:text-accent transition-colors"
            >
              Next →
            </Link>
          ) : (
            <span className="px-4 py-2 rounded-lg border border-border text-sm text-muted/40 cursor-not-allowed">
              Next →
            </span>
          )}
        </nav>
      )}
    </div>
  );
}
