import { Metadata } from "next";
export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import {
  getBooksPaginated,
  searchBooksPaginated,
  getBooksByListSlugPaginated,
} from "@/lib/data";
import { pageMetadata, canonicalUrl } from "@/lib/seo";
import { collectionPageJsonLd, breadcrumbListJsonLd } from "@/lib/jsonld";
import { BookCard, SearchBar, SortSelect, Breadcrumbs, EmptyState } from "@/components";

export const revalidate = 60;

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const hasParams = !!(
    (sp.q && sp.q.trim()) ||
    (sp.category && sp.category.trim()) ||
    (sp.sort && sp.sort.trim()) ||
    (sp.page && sp.page.trim()) ||
    (sp.scope && sp.scope.trim()) ||
    (sp.filter && sp.filter.trim())
  );

  return pageMetadata({
    title: "Browse Books",
    description: "Explore recommended books ranked by recommendation signals, lists, series, ratings, and source-backed mentions.",
    path: "/books",
    robots: hasParams ? "noindex, follow" : "index, follow",
  });
}

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
  searchParams: Promise<{ q?: string; category?: string; sort?: string; page?: string; scope?: string; filter?: string }>;
}

type ScopeKey = "curated" | "all";

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw || "1", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 1000); // hard ceiling defensive against URL fuzzing
}

function parseSort(raw: string | undefined): SortKey {
  return raw && SORT_KEYS.has(raw) ? (raw as SortKey) : "recommendation_count";
}

function parseScope(raw: string | undefined): ScopeKey {
  return raw === "all" ? "all" : "curated";
}

/** Build a URL-encoded query string preserving current filter context, with overrides. */
function buildQs(opts: { q?: string | null; category?: string | null; sort?: string | null; page?: number | null; scope?: ScopeKey | null }) {
  const sp = new URLSearchParams();
  if (opts.q) sp.set("q", opts.q);
  if (opts.category) sp.set("category", opts.category);
  if (opts.sort && opts.sort !== "recommendation_count") sp.set("sort", opts.sort);
  if (opts.scope && opts.scope === "all") sp.set("scope", "all");
  if (opts.page && opts.page > 1) sp.set("page", String(opts.page));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default async function BooksPage({ searchParams }: Props) {
  const hasEnv = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!hasEnv) {
    console.error("CRITICAL ERROR: Supabase environment variables are missing! NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is undefined.");
    const isLocalhost = typeof window !== "undefined"
      ? window.location.hostname === "localhost"
      : process.env.NODE_ENV === "development" || process.env.HOSTNAME === "localhost" || process.env.PORT === "3000";
    if (isLocalhost || process.env.NODE_ENV === "development") {
      throw new Error(
        "Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. Please verify your .env.local file is configured and sourced."
      );
    }
  }

  const sp = await searchParams;
  const q = (sp.q || "").trim();
  const categoryParam = (sp.category || "").trim().toLowerCase();
  const sort: SortKey = parseSort(sp.sort);
  const scope: ScopeKey = parseScope(sp.scope || sp.filter);
  const page = parsePage(sp.page);

  // Resolve chip — unknown values fall back to "All" so a bad URL doesn't
  // produce an empty-looking page with no visible cause.
  const activeChip =
    CATEGORY_CHIPS.find((c) => c.paramSlug === categoryParam) || CATEGORY_CHIPS[0];

  // Choose data source by mode priority: search > category > all.
  // - search: helper already filters to title/author_name hits, no extra quality gate
  //   (the user's query is the quality signal).
  // - category: the list itself is already a curated selection by definition.
  // - all: apply `scope` (default `curated` = cover+rec>0; `all` = full catalogue).
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
    result = await getBooksPaginated(page, PAGE_SIZE, sort, scope);
  }

  const { data: books, total } = result;
  const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1;
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  // Phase-4 BookCard recommender proof rows were temporarily added here and
  // are now disabled — they correlated with a /books cold-start empty-state
  // regression (5-9 of 30 hammer attempts returned the "No books found"
  // fallback after Phase 4 shipped). The hypothesis was Supabase connection
  // pool contention from the extra batch query + rec-count round trip per
  // request; the cleanest mitigation while we evaluate options is to remove
  // the extra DB work entirely from this page. Phase 3 (the rich social
  // proof section on the book detail page) is unaffected and still runs.

  const subtitle =
    mode === "search"
      ? `Search results for "${q}"`
      : mode === "category"
        ? `Showing books in ${activeChip.label}`
        : scope === "all"
          ? "Full catalogue — includes incomplete and unreviewed entries."
          : "Curated picks — books with covers and at least one source-backed recommendation.";

  const hasParams = !!(q || categoryParam || sp.sort || sp.page || sp.scope || sp.filter);

  // "Default landing" = bare `/books` URL with no querystring at all, mode=all,
  // scope=curated, page=1. When the books fetch returns empty in this case it
  // is *never* a genuine empty result (the curated catalogue has ~9,148 rows
  // in production) — it is a Supabase cold-start transient that survived even
  // the strong-retry path in getBooksPaginated. Rather than mislead the user
  // with "No books found", we render a defensive load state with a refresh
  // link to the querystring-variant `/books?scope=curated` (which has been
  // 0/N empty in every hammer test, because that URL is routed/served
  // differently by Railway's edge layer than the bare /books URL).
  //
  // Genuine empty states for search/category/scope=all stay on the existing
  // EmptyState — they reach this page with mode != "all" or hasParams=true
  // or scope != "curated" or page > 1, all of which keep isDefaultLandingEmpty
  // false.
  const isDefaultLandingEmpty =
    books.length === 0 &&
    mode === "all" &&
    scope === "curated" &&
    page === 1;

  // Opt out of caching if the query returned a suspicious empty result for browse pages.
  // This prevents Next.js ISR from caching a transient database cold start/timeout.
  if (books.length === 0 && (mode === "all" || mode === "category")) {
    noStore();
  }

  const isDefaultLanding =
    mode === "all" &&
    scope === "curated" &&
    page === 1 &&
    !hasParams;
  const collectionJsonLd = !hasParams
    ? collectionPageJsonLd({
        name: "Browse Books | BookMentions",
        description: "Explore recommended books ranked by recommendation signals, lists, series, ratings, and source-backed mentions.",
        url: canonicalUrl("/books"),
        items: books.map((b) => ({
          name: b.title,
          url: canonicalUrl(`/books/${b.slug}`),
        })),
      })
    : null;

  const breadcrumbJsonLd = !hasParams
    ? breadcrumbListJsonLd([
        { name: "Home", path: "/" },
        { name: "Books", path: "/books" },
      ])
    : null;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      {collectionJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
        />
      )}
      {breadcrumbJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
        />
      )}
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Books" }]} />
      {isDefaultLanding ? (
        <section className="mb-10 p-6 md:p-8 rounded-2xl border border-border bg-gradient-to-br from-subtle/60 to-subtle/20">
          <div className="max-w-3xl">
            <h1 className="text-3xl md:text-4xl font-bold text-ink mb-3 tracking-tight">
              Discover books recommended by notable people
            </h1>
            <p className="text-base text-muted mb-6 leading-relaxed">
              Browse source-backed book recommendations from founders, authors, investors, scientists, creators, and public figures.
            </p>
            
            {/* Trust strip */}
            <div className="flex flex-wrap items-center gap-y-3 gap-x-6 text-xs text-muted mb-6 pb-6 border-b border-border/60">
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" />
                </svg>
                Source-backed recommendations
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" />
                </svg>
                Public proof where available
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" />
                </svg>
                Amazon options on book pages
              </span>
            </div>

            {/* Quick discovery chips */}
            <div>
              <span className="block text-xs font-semibold text-ink mb-3 uppercase tracking-wider">Quick Discovery</span>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/lists/most-recommended-books"
                  className="text-xs px-3 py-1.5 rounded-xl bg-accent text-white font-semibold hover:bg-accent-hover transition-colors"
                >
                  ★ Most Recommended
                </Link>
                <Link
                  href="/books?q=business"
                  className="text-xs px-3 py-1.5 rounded-xl border border-border bg-surface text-ink hover:border-accent hover:text-accent transition-colors"
                >
                  Business
                </Link>
                <Link
                  href="/books?q=science"
                  className="text-xs px-3 py-1.5 rounded-xl border border-border bg-surface text-ink hover:border-accent hover:text-accent transition-colors"
                >
                  Science
                </Link>
                <Link
                  href="/books?q=startup"
                  className="text-xs px-3 py-1.5 rounded-xl border border-border bg-surface text-ink hover:border-accent hover:text-accent transition-colors"
                >
                  Startups
                </Link>
                <Link
                  href="/books?q=artificial%20intelligence"
                  className="text-xs px-3 py-1.5 rounded-xl border border-border bg-surface text-ink hover:border-accent hover:text-accent transition-colors"
                >
                  AI
                </Link>
                <Link
                  href="/books?q=history"
                  className="text-xs px-3 py-1.5 rounded-xl border border-border bg-surface text-ink hover:border-accent hover:text-accent transition-colors"
                >
                  History
                </Link>
                <Link
                  href="/people"
                  className="text-xs px-3 py-1.5 rounded-xl border border-accent/20 bg-accent-light text-accent font-semibold hover:bg-accent/15 transition-colors"
                >
                  Explore People →
                </Link>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-ink mb-2 tracking-tight">Browse Books</h1>
            <p className="text-base text-muted">{subtitle}</p>
          </div>
          <Link
            href="/people"
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs md:text-sm font-semibold text-accent bg-accent-light hover:bg-accent/15 border border-accent/20 rounded-xl transition-all self-start sm:self-center shrink-0"
          >
            <span>Books recommended by notable people</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      )}

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
          // Scope is preserved so the user keeps their All-catalogue choice when
          // toggling categories.
          const href = `/books${buildQs({ category: chip.paramSlug, sort, scope })}`;
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
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-muted">
            {total > 0
              ? `${mode === "search" ? "~" : ""}${total.toLocaleString()} ${total === 1 ? "book" : "books"}${
                  mode === "search" ? "" : mode === "category" ? ` in ${activeChip.label}` : scope === "all" ? " (full catalogue)" : ""
                }`
              : "No matching books"}
          </span>
          {/* Scope toggle — only shown on the all-books mode. Category and search
              modes have their own implicit quality filter (list membership / hit
              relevance). */}
          {mode === "all" && (
            <div className="inline-flex rounded-full border border-border overflow-hidden text-xs">
              <Link
                href={`/books${buildQs({ sort })}`}
                prefetch={false}
                className={`px-3 py-1 transition-colors ${scope === "curated" ? "bg-accent text-white" : "text-muted hover:text-accent"}`}
                aria-current={scope === "curated" ? "page" : undefined}
              >
                Curated
              </Link>
              <Link
                href={`/books${buildQs({ sort, scope: "all" })}`}
                prefetch={false}
                className={`px-3 py-1 transition-colors border-l border-border ${scope === "all" ? "bg-accent text-white" : "text-muted hover:text-accent"}`}
                aria-current={scope === "all" ? "page" : undefined}
              >
                All
              </Link>
            </div>
          )}
        </div>
        <SortSelect
          value={sort}
          options={SORT_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
          ariaLabel="Sort books"
        />
      </div>

      {books.length === 0 ? (
        isDefaultLandingEmpty ? (
          // Defensive load-failed state for the bare `/books` cold-start case.
          // Replaces "No books found" so the user is not told the catalogue is
          // empty when the catalogue has ~9,148 curated books. The refresh
          // link points to `/books?scope=curated` which has been stable across
          // every hammer test — Railway/Next routes querystring variants
          // through a different request path than the bare URL.
          <section
            className="my-12 rounded-2xl border border-border bg-surface p-8 text-center max-w-xl mx-auto"
            role="status"
            aria-live="polite"
          >
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-subtle flex items-center justify-center">
              <svg
                className="w-6 h-6 text-muted/60"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 4v5h5M20 20v-5h-5M5.07 9A8.001 8.001 0 0119 9M18.93 15A8.001 8.001 0 015 15"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-ink mb-2">
              Books are taking a moment to load
            </h2>
            <p className="text-sm text-muted mb-5">
              Refresh the page to try again.
            </p>
            <Link
              href="/books?scope=curated"
              prefetch={false}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Refresh books →
            </Link>
          </section>
        ) : (
          <EmptyState
            message={
              mode === "search"
                ? `No books match "${q}".`
                : mode === "category"
                  ? `No books found in ${activeChip.label}.`
                  : "No books found. Check back soon."
            }
          />
        )
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
              href={`/books${buildQs({ q: q || null, category: activeChip.paramSlug, sort, scope, page: page - 1 })}`}
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
              href={`/books${buildQs({ q: q || null, category: activeChip.paramSlug, sort, scope, page: page + 1 })}`}
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
