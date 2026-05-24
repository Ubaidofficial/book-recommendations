import Link from "next/link";
import {
  getFeaturedBooks,
  getFeaturedPeople,
  getFeaturedLists,
  getFeaturedSeries,
  getPersonRecommendedCount,
  getPersonWrittenCount,
} from "@/lib/data";
import {
  getFallbackBooks,
  getFallbackPeople,
  getFallbackLists,
  getFallbackSeries,
} from "@/lib/fallback";
import { BookCard, PersonCard, ListCard, SeriesCard, GlobalSearch, SectionHeading } from "@/components";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const CARD_COUNT = 4;

  let featuredBooks: Awaited<ReturnType<typeof getFeaturedBooks>> = [];
  let featuredPeople: Awaited<ReturnType<typeof getFeaturedPeople>> = [];
  let featuredLists: Awaited<ReturnType<typeof getFeaturedLists>> = [];
  let featuredSeries: Awaited<ReturnType<typeof getFeaturedSeries>> = [];

  try {
    [featuredBooks, featuredPeople, featuredLists, featuredSeries] =
      await Promise.all([
        getFeaturedBooks(CARD_COUNT),
        getFeaturedPeople(CARD_COUNT),
        getFeaturedLists(CARD_COUNT),
        getFeaturedSeries(CARD_COUNT),
      ]);
  } catch (e) {
    console.error("[homepage] QUERY_ERROR: Supabase fetch threw exception, using fallback data:", e);
  }

  const books = (() => {
    if (featuredBooks.length > 0) {
      const withCovers = featuredBooks.filter(b => b.cover_url && /^https?:\/\//i.test(b.cover_url));
      console.log(`[homepage] Popular Books: ${featuredBooks.length} rows, ${withCovers.length} with valid covers`);
      return featuredBooks;
    }
    console.warn("[homepage] FALLBACK_BOOKS: zero rows returned from Supabase books query");
    return getFallbackBooks(CARD_COUNT);
  })();
  const people = (() => {
    if (featuredPeople.length > 0) {
      console.log(`[homepage] Featured People: ${featuredPeople.length} rows`);
      return featuredPeople;
    }
    console.warn("[homepage] FALLBACK_PEOPLE: zero rows returned from Supabase people query");
    return getFallbackPeople(CARD_COUNT);
  })();
  const lists = (() => {
    if (featuredLists.length > 0) {
      console.log(`[homepage] Popular Lists: ${featuredLists.length} rows`);
      return featuredLists;
    }
    console.warn("[homepage] FALLBACK_LISTS: zero rows returned from Supabase lists query");
    return getFallbackLists(CARD_COUNT);
  })();
  const series = (() => {
    if (featuredSeries.length > 0) {
      console.log(`[homepage] Popular Series: ${featuredSeries.length} rows`);
      return featuredSeries;
    }
    console.warn("[homepage] FALLBACK_SERIES: zero rows returned from Supabase series query");
    return getFallbackSeries(CARD_COUNT);
  })();

  let peopleWithCounts: (typeof people[number] & { recommendedCount: number; writtenCount: number })[] = [];
  try {
    peopleWithCounts = await Promise.all(
      people.map(async (p) => {
        const [rc, wc] = await Promise.all([
          getPersonRecommendedCount(p.id),
          getPersonWrittenCount(p.id),
        ]);
        return { ...p, recommendedCount: rc, writtenCount: wc };
      })
    );
  } catch (e) {
    console.error("[homepage] Person counts fetch failed:", e);
    peopleWithCounts = people.map((p) => ({ ...p, recommendedCount: 0, writtenCount: 0 }));
  }

  return (
    <>
      <section className="py-20 md:py-28 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold text-ink leading-tight mb-5 tracking-tight">
            Discover books<br />
            <span className="text-accent">people you admire</span> recommend
          </h1>
          <p className="text-base md:text-lg text-muted max-w-xl mx-auto mb-10 leading-relaxed">
            Explore hand-picked book recommendations from authors, leaders, and thinkers. Backed by real sources.
          </p>
          <GlobalSearch placeholder="Search for books, authors, or topics…" className="max-w-2xl mx-auto" />
          <div className="mt-7 flex items-center justify-center gap-3 text-sm text-muted">
            <span>Popular:</span>
            <Link href="/books" className="hover:text-ink transition-colors">Fiction</Link>
            <span className="text-border">·</span>
            <Link href="/books" className="hover:text-ink transition-colors">Non-Fiction</Link>
            <span className="text-border">·</span>
            <Link href="/books" className="hover:text-ink transition-colors">Science</Link>
            <span className="text-border">·</span>
            <Link href="/books" className="hover:text-ink transition-colors">Classics</Link>
          </div>
        </div>
      </section>

      <section className="py-14 px-4 bg-subtle/40 border-y border-border">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="rounded-2xl bg-surface border border-border p-5">
            <div className="w-10 h-10 rounded-xl bg-accent-light flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h3 className="font-semibold text-ink mb-1">Verified Sources</h3>
            <p className="text-sm text-muted leading-relaxed">Every recommendation links to a real interview, article, or curated list — no guessing.</p>
          </div>
          <div className="rounded-2xl bg-surface border border-border p-5">
            <div className="w-10 h-10 rounded-xl bg-accent-light flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h3 className="font-semibold text-ink mb-1">Curated Lists & Series</h3>
            <p className="text-sm text-muted leading-relaxed">Browse hand-picked collections and complete series in reading order.</p>
          </div>
          <div className="rounded-2xl bg-surface border border-border p-5">
            <div className="w-10 h-10 rounded-xl bg-accent-light flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h3 className="font-semibold text-ink mb-1">Quality Over Quantity</h3>
            <p className="text-sm text-muted leading-relaxed">We index only pages with complete metadata and verified data — no thin content.</p>
          </div>
        </div>
      </section>

      <section className="py-14 px-4">
        <div className="max-w-7xl mx-auto">
          <SectionHeading title="Popular Books" href="/books" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-5">
            {books.map((book) => (
              <BookCard key={book.id} {...book} coverUrl={book.cover_url} authorSlug={book.author_slug} recommendationCount={book.recommendation_count} />
            ))}
          </div>
        </div>
      </section>

      <section className="py-14 px-4 bg-subtle/60">
        <div className="max-w-7xl mx-auto">
          <SectionHeading title="Featured People" href="/people" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {peopleWithCounts.map((person) => (
              <PersonCard
                key={person.id}
                name={person.name}
                slug={person.slug}
                role={person.role}
                avatarUrl={person.avatar_url}
                recommendedCount={person.recommendedCount}
                writtenCount={person.writtenCount}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="py-14 px-4">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-14">
          <div>
            <SectionHeading title="Popular Lists" href="/lists" />
            <div className="flex flex-col gap-3">
              {lists.map((list) => (
                <ListCard key={list.id} {...list} bookCount={list.book_count} />
              ))}
            </div>
          </div>
          <div>
            <SectionHeading title="Popular Series" href="/series" />
            <div className="flex flex-col gap-3">
              {series.map((s) => (
                <SeriesCard key={s.id} {...s} bookCount={s.book_count} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-14 px-4 bg-subtle/40 border-y border-border">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-xl font-bold text-ink mb-3 tracking-tight">How recommendations are verified</h2>
          <p className="text-sm text-muted leading-relaxed max-w-2xl mx-auto mb-4">
            We collect book recommendations from public sources — interviews, articles, podcasts, and curated reading lists.
            Each entry is linked to its original source. Recommendations without verifiable proof are excluded.
          </p>
          <Link
            href="/methodology"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-hover transition-colors"
          >
            Read our full methodology
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </section>

      <section className="py-20 px-4 text-center">
        <div className="max-w-xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-ink mb-4 tracking-tight">Ready to find your next book?</h2>
          <p className="text-base text-muted mb-8 leading-relaxed">
            Browse thousands of books, explore curated lists, and discover what people you admire are reading.
          </p>
          <Link
            href="/books"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent-hover transition-colors shadow-sm"
          >
            Browse All Books
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </section>
    </>
  );
}
