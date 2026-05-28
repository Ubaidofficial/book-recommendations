import { Metadata } from "next";
import Link from "next/link";
import {
  getListsPaginated,
  searchLists,
  getBroadCategoryLists,
  getTopicLists,
  getListBySlug,
  type BookList,
} from "@/lib/data";
import { pageMetadata } from "@/lib/seo";
import { ListCard, SearchBar, Breadcrumbs, EmptyState } from "@/components";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Book Lists",
  description: "Browse curated book lists — broad categories, fine-grained topic lists, fiction, nonfiction, and the most recommended books.",
  path: "/lists",
});

interface Props {
  searchParams: Promise<{ q?: string; page?: string; sort?: string }>;
}

const PAGE_SIZE = 24;

function Section({
  title,
  subtitle,
  href,
  lists,
  empty,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  lists: BookList[];
  empty?: string;
}) {
  if (!lists || lists.length === 0) {
    if (!empty) return null;
    return (
      <section className="mb-12">
        <h2 className="text-xl font-bold text-ink mb-2 tracking-tight">{title}</h2>
        <p className="text-sm text-muted">{empty}</p>
      </section>
    );
  }
  return (
    <section className="mb-12">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-ink tracking-tight">{title}</h2>
          {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
        </div>
        {href && (
          <Link href={href} className="text-sm text-accent hover:underline font-medium shrink-0">
            View all →
          </Link>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {lists.map((list) => (
          <ListCard
            key={list.id}
            title={list.title}
            slug={list.slug}
            description={list.description}
            bookCount={list.book_count}
            curator={list.curator}
          />
        ))}
      </div>
    </section>
  );
}

export default async function ListsPage({ searchParams }: Props) {
  const params = await searchParams;
  const q = (params.q || "").trim();
  const pageParam = parseInt(params.page || "0", 10);
  const sort = params.sort === "title" ? "title" : "book_count";
  const isBrowseMode = pageParam > 0 || q.length > 0;

  // ── Search mode ───────────────────────────────────────────────
  if (q.length >= 2) {
    const results = await searchLists(q, 60);
    return (
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Lists", href: "/lists" }, { label: `"${q}"` }]} />
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-ink mb-2 tracking-tight">Search results</h1>
          <p className="text-base text-muted">Results for &ldquo;{q}&rdquo;</p>
        </div>
        <div className="mb-6">
          <SearchBar placeholder="Search lists by title or topic…" />
        </div>
        <div className="text-sm text-muted mb-4">{results.length} list{results.length === 1 ? "" : "s"}</div>
        {results.length === 0 ? (
          <EmptyState message={`No lists match "${q}".`} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {results.map((list) => (
              <ListCard
                key={list.id}
                title={list.title}
                slug={list.slug}
                description={list.description}
                bookCount={list.book_count}
                curator={list.curator}
              />
            ))}
          </div>
        )}
        <div className="mt-10">
          <Link href="/lists" className="text-sm text-accent hover:underline">← Back to all lists</Link>
        </div>
      </div>
    );
  }

  // ── Browse-all paginated mode (?page=N) ────────────────────────
  if (isBrowseMode) {
    const page = Math.max(1, pageParam || 1);
    const { data: lists, total } = await getListsPaginated(page, PAGE_SIZE, sort);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const sortHref = (s: "book_count" | "title") => `/lists?page=${page}&sort=${s}`;
    const prevHref = page > 1 ? `/lists?page=${page - 1}&sort=${sort}` : "";
    const nextHref = page < totalPages ? `/lists?page=${page + 1}&sort=${sort}` : "";

    return (
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Lists", href: "/lists" }, { label: `All lists (page ${page})` }]} />
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-ink mb-2 tracking-tight">Browse all lists</h1>
          <p className="text-base text-muted">{total.toLocaleString()} lists total — page {page} of {totalPages}.</p>
        </div>
        <div className="mb-6">
          <SearchBar placeholder="Search lists by title or topic…" />
        </div>
        <div className="flex items-center justify-between mb-6 text-sm">
          <span className="text-muted">{total.toLocaleString()} lists</span>
          <div className="flex items-center gap-2">
            <span className="text-muted">Sort:</span>
            <Link
              href={sortHref("book_count")}
              className={`px-2.5 py-1 rounded-full text-xs font-medium ${sort === "book_count" ? "bg-accent-light text-accent" : "bg-subtle text-muted hover:text-ink"}`}
            >
              Most books
            </Link>
            <Link
              href={sortHref("title")}
              className={`px-2.5 py-1 rounded-full text-xs font-medium ${sort === "title" ? "bg-accent-light text-accent" : "bg-subtle text-muted hover:text-ink"}`}
            >
              Title A–Z
            </Link>
          </div>
        </div>
        {lists.length === 0 ? (
          <EmptyState message="No lists on this page." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {lists.map((list) => (
              <ListCard
                key={list.id}
                title={list.title}
                slug={list.slug}
                description={list.description}
                bookCount={list.book_count}
                curator={list.curator}
              />
            ))}
          </div>
        )}
        <div className="flex items-center justify-center gap-3 mt-10">
          {prevHref ? (
            <Link href={prevHref} className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-ink hover:bg-accent-light">← Previous</Link>
          ) : (
            <span className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-muted/40">← Previous</span>
          )}
          <span className="text-sm text-muted">Page {page} of {totalPages}</span>
          {nextHref ? (
            <Link href={nextHref} className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-ink hover:bg-accent-light">Next →</Link>
          ) : (
            <span className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-muted/40">Next →</span>
          )}
        </div>
        <div className="mt-8 text-center">
          <Link href="/lists" className="text-sm text-accent hover:underline">← Back to sectioned view</Link>
        </div>
      </div>
    );
  }

  // ── Default: sectioned discovery hub ──────────────────────────
  const [broad, popular, fiction, nonfiction, meta] = await Promise.all([
    getBroadCategoryLists(12),
    getTopicLists({ limit: 12, sort: "book_count" }),
    getTopicLists({ limit: 8, filter: "fiction" }),
    getTopicLists({ limit: 8, filter: "nonfiction" }),
    getListBySlug("most-recommended-books"),
  ]);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Lists" }]} />
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-ink mb-2 tracking-tight">Book Lists</h1>
        <p className="text-base text-muted">Curated collections — broad categories, specific topics, and the most recommended books.</p>
      </div>
      <div className="mb-10">
        <SearchBar placeholder="Search lists by title or topic…" />
      </div>

      <Section
        title="Main Categories"
        subtitle="Broad parents — Fiction, Nonfiction, and the top subject areas."
        href="/lists?page=1&sort=book_count"
        lists={broad}
        empty="No category lists yet."
      />

      {meta && (
        <Section
          title="Curated"
          subtitle="A meta-list of the most recommended books across all sources."
          lists={[meta]}
        />
      )}

      <Section
        title="Popular Topic Lists"
        subtitle="Specific best-of lists — Leadership, Sales, Sci-Fi, Photography, and more."
        href="/lists?page=1&sort=book_count"
        lists={popular.data}
      />

      <Section
        title="Fiction Lists"
        subtitle="Fine-grained fiction subcategories."
        lists={fiction.data}
      />

      <Section
        title="Nonfiction Lists"
        subtitle="Fine-grained nonfiction subcategories."
        lists={nonfiction.data}
      />

      <section className="mt-10 pt-8 border-t border-border text-center">
        <Link href="/lists?page=1&sort=book_count" className="inline-flex items-center gap-1 text-sm text-accent font-medium hover:underline">
          Browse all lists →
        </Link>
      </section>
    </div>
  );
}
