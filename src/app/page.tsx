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
import { BookCard, PersonCard, ListCard, SeriesCard, GlobalSearch, SectionHeading, HomepageVisual } from "@/components";
import { websiteJsonLd, organizationJsonLd } from "@/lib/jsonld";

export const revalidate = 60;

export default async function HomePage() {
  const CARD_COUNT = 4;
  const websiteSchema = websiteJsonLd();
  const orgSchema = organizationJsonLd();

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
      return featuredBooks;
    }
    console.warn("[homepage] FALLBACK_BOOKS: zero rows returned from Supabase books query");
    return getFallbackBooks(CARD_COUNT);
  })();
  const people = (() => {
    if (featuredPeople.length > 0) {
      return featuredPeople;
    }
    console.warn("[homepage] FALLBACK_PEOPLE: zero rows returned from Supabase people query");
    return getFallbackPeople(CARD_COUNT);
  })();
  const lists = (() => {
    if (featuredLists.length > 0) {
      return featuredLists;
    }
    console.warn("[homepage] FALLBACK_LISTS: zero rows returned from Supabase lists query");
    return getFallbackLists(CARD_COUNT);
  })();
  const series = (() => {
    if (featuredSeries.length > 0) {
      return featuredSeries;
    }
    console.warn("[homepage] FALLBACK_SERIES: zero rows returned from Supabase series query");
    return getFallbackSeries(CARD_COUNT);
  })();

  // Remove N+1 query overhead by setting badge counts to 0 on the homepage.
  // The details will load when clicking through to the individual profiles.
  const peopleWithCounts = people.map((p) => ({ ...p, recommendedCount: 0, writtenCount: 0 }));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
      />
      <section className="py-20 md:py-24 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold text-ink leading-tight mb-5 tracking-tight">
            Find books recommended by <span className="text-accent">people you trust</span>.
          </h1>
          <p className="text-base md:text-lg text-muted max-w-2xl mx-auto mb-8 leading-relaxed">
            Explore source-backed recommendations from founders, authors, investors, scientists, creators, and public figures — with Amazon options on book pages.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 mb-8">
            <Link
              href="/books"
              className="px-6 py-3 rounded-full bg-accent text-white font-semibold hover:bg-accent-hover transition-colors shadow-sm text-sm"
            >
              Browse Books
            </Link>
            <Link
              href="/people"
              className="px-6 py-3 rounded-full border border-border bg-surface text-ink font-semibold hover:bg-subtle transition-colors text-sm"
            >
              Explore People
            </Link>
          </div>
          <GlobalSearch placeholder="Search for books, authors, or topics…" className="max-w-2xl mx-auto" />
          <div className="mt-7 flex items-center justify-center gap-3 text-sm text-muted">
            <span>Popular:</span>
            <Link href="/books?q=business" className="hover:text-ink transition-colors font-medium">Business</Link>
            <span className="text-border">·</span>
            <Link href="/books?q=science" className="hover:text-ink transition-colors font-medium">Science</Link>
            <span className="text-border">·</span>
            <Link href="/books?q=startup" className="hover:text-ink transition-colors font-medium">Startups</Link>
            <span className="text-border">·</span>
            <Link href="/books?q=history" className="hover:text-ink transition-colors font-medium">History</Link>
          </div>
        </div>
      </section>

      {/* Trust / Value Strip */}
      <section className="border-y border-border bg-subtle/30 py-6 px-4">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-light flex items-center justify-center shrink-0 text-accent">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Public recommendations</h3>
              <p className="text-xs text-muted mt-0.5">Sourced from public interviews & lists</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-light flex items-center justify-center shrink-0 text-accent">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Source-backed proof</h3>
              <p className="text-xs text-muted mt-0.5">Verifiable links for every recommendation</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-light flex items-center justify-center shrink-0 text-accent">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.907c.961 0 1.371 1.24.588 1.81l-3.97 2.88a1 1 0 00-.364 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.971-2.88a1 1 0 00-1.175 0l-3.97 2.88c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.364-1.118l-3.97-2.88c-.783-.57-.38-1.81.588-1.81h4.908a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Notable recommenders</h3>
              <p className="text-xs text-muted mt-0.5">Founders, authors, and industry experts</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-light flex items-center justify-center shrink-0 text-accent">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Fast book discovery</h3>
              <p className="text-xs text-muted mt-0.5">Lightning fast browse & search interface</p>
            </div>
          </div>
        </div>
      </section>

      {/* Start Exploring / Discovery Cards */}
      <section className="py-16 px-4 bg-surface">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-xl font-bold text-ink mb-6 tracking-tight">Start Exploring</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <Link
              href="/lists/most-recommended-books"
              className="group flex flex-col justify-between p-6 rounded-2xl border border-border bg-subtle/20 hover:border-accent/30 hover:shadow-lg transition-all duration-200"
            >
              <div>
                <div className="w-10 h-10 rounded-xl bg-accent-light flex items-center justify-center mb-4 text-accent group-hover:scale-110 transition-transform">
                  ★
                </div>
                <h3 className="font-bold text-base text-ink mb-2 group-hover:text-accent transition-colors">Most Recommended</h3>
                <p className="text-xs text-muted leading-relaxed">The all-time top recommended books based on consolidated public mentions.</p>
              </div>
              <span className="text-xs font-semibold text-accent mt-4 inline-flex items-center gap-1">
                View list →
              </span>
            </Link>
            <Link
              href="/people"
              className="group flex flex-col justify-between p-6 rounded-2xl border border-border bg-subtle/20 hover:border-accent/30 hover:shadow-lg transition-all duration-200"
            >
              <div>
                <div className="w-10 h-10 rounded-xl bg-accent-light flex items-center justify-center mb-4 text-accent group-hover:scale-110 transition-transform">
                  👤
                </div>
                <h3 className="font-bold text-base text-ink mb-2 group-hover:text-accent transition-colors">Explore People</h3>
                <p className="text-xs text-muted leading-relaxed">Browse recommendations from tech founders, investors, authors, and creators.</p>
              </div>
              <span className="text-xs font-semibold text-accent mt-4 inline-flex items-center gap-1">
                View recommenders →
              </span>
            </Link>
            <Link
              href="/lists"
              className="group flex flex-col justify-between p-6 rounded-2xl border border-border bg-subtle/20 hover:border-accent/30 hover:shadow-lg transition-all duration-200"
            >
              <div>
                <div className="w-10 h-10 rounded-xl bg-accent-light flex items-center justify-center mb-4 text-accent group-hover:scale-110 transition-transform">
                  📚
                </div>
                <h3 className="font-bold text-base text-ink mb-2 group-hover:text-accent transition-colors">Browse Topics</h3>
                <p className="text-xs text-muted leading-relaxed">Explore curated reading lists across business, science fiction, history, and development.</p>
              </div>
              <span className="text-xs font-semibold text-accent mt-4 inline-flex items-center gap-1">
                Browse lists →
              </span>
            </Link>
            <Link
              href="/books"
              className="group flex flex-col justify-between p-6 rounded-2xl border border-border bg-subtle/20 hover:border-accent/30 hover:shadow-lg transition-all duration-200"
            >
              <div>
                <div className="w-10 h-10 rounded-xl bg-accent-light flex items-center justify-center mb-4 text-accent group-hover:scale-110 transition-transform">
                  📖
                </div>
                <h3 className="font-bold text-base text-ink mb-2 group-hover:text-accent transition-colors">Browse All Books</h3>
                <p className="text-xs text-muted leading-relaxed">Explore the full curated catalogue of books with recommendations and options.</p>
              </div>
              <span className="text-xs font-semibold text-accent mt-4 inline-flex items-center gap-1">
                Browse books →
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* Trust & Visual */}
      <section className="py-16 px-4 bg-subtle/40 border-y border-border">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="text-2xl font-bold text-ink mb-4 tracking-tight">Recommendations backed by real sources</h2>
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent-light flex items-center justify-center shrink-0 mt-0.5">
                  <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">Every recommendation links to a verifiable source</p>
                  <p className="text-xs text-muted mt-0.5">Interviews, articles, podcasts, and curated lists — no guessing.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent-light flex items-center justify-center shrink-0 mt-0.5">
                  <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">Complete lists and series in reading order</p>
                  <p className="text-xs text-muted mt-0.5">Browse curated collections and discover books in sequence.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent-light flex items-center justify-center shrink-0 mt-0.5">
                  <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">Quality standards you can rely on</p>
                  <p className="text-xs text-muted mt-0.5">We surface pages when they have enough useful information — clear metadata, recommendation evidence, and related books or lists.</p>
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-center">
            <HomepageVisual />
          </div>
        </div>
      </section>

      {/* Explore Trusted Reading Lists */}
      <section className="py-16 px-4 bg-surface border-t border-border">
        <div className="max-w-7xl mx-auto">
          <div className="mb-10 text-center md:text-left">
            <h2 className="text-2xl font-bold text-ink mb-2 tracking-tight">Explore trusted reading lists</h2>
            <p className="text-sm text-muted">
              Start with curated books recommended by founders, investors, CEOs, writers, billionaires, and Bill Gates.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Link
              href="/lists/books-recommended-by-founders"
              className="group block p-6 rounded-2xl border border-border bg-subtle/10 hover:border-accent/20 hover:shadow-lg transition-all duration-200"
            >
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-bold text-base text-ink group-hover:text-accent transition-colors">Founders</h3>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-semibold shrink-0">
                  75 books
                </span>
              </div>
              <p className="text-sm text-muted leading-relaxed mb-4 min-h-[40px]">
                Startup and company-building books recommended by founders and tech builders.
              </p>
              <span className="text-xs font-semibold text-accent inline-flex items-center gap-1">
                Explore list →
              </span>
            </Link>
            <Link
              href="/lists/books-recommended-by-investors"
              className="group block p-6 rounded-2xl border border-border bg-subtle/10 hover:border-accent/20 hover:shadow-lg transition-all duration-200"
            >
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-bold text-base text-ink group-hover:text-accent transition-colors">Investors</h3>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-semibold shrink-0">
                  75 books
                </span>
              </div>
              <p className="text-sm text-muted leading-relaxed mb-4 min-h-[40px]">
                Capital allocation, decision-making, and business books recommended by investors.
              </p>
              <span className="text-xs font-semibold text-accent inline-flex items-center gap-1">
                Explore list →
              </span>
            </Link>
            <Link
              href="/lists/books-recommended-by-ceos"
              className="group block p-6 rounded-2xl border border-border bg-subtle/10 hover:border-accent/20 hover:shadow-lg transition-all duration-200"
            >
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-bold text-base text-ink group-hover:text-accent transition-colors">CEOs</h3>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-semibold shrink-0">
                  75 books
                </span>
              </div>
              <p className="text-sm text-muted leading-relaxed mb-4 min-h-[40px]">
                Leadership, strategy, and operator books recommended by executives.
              </p>
              <span className="text-xs font-semibold text-accent inline-flex items-center gap-1">
                Explore list →
              </span>
            </Link>
            <Link
              href="/lists/books-recommended-by-bill-gates"
              className="group block p-6 rounded-2xl border border-border bg-subtle/10 hover:border-accent/20 hover:shadow-lg transition-all duration-200"
            >
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-bold text-base text-ink group-hover:text-accent transition-colors">Bill Gates</h3>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-semibold shrink-0">
                  75 books
                </span>
              </div>
              <p className="text-sm text-muted leading-relaxed mb-4 min-h-[40px]">
                Science, business, global health, and biography picks from Bill Gates.
              </p>
              <span className="text-xs font-semibold text-accent inline-flex items-center gap-1">
                Explore list →
              </span>
            </Link>
            <Link
              href="/lists/books-recommended-by-billionaires"
              className="group block p-6 rounded-2xl border border-border bg-subtle/10 hover:border-accent/20 hover:shadow-lg transition-all duration-200"
            >
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-bold text-base text-ink group-hover:text-accent transition-colors">Billionaires</h3>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-semibold shrink-0">
                  75 books
                </span>
              </div>
              <p className="text-sm text-muted leading-relaxed mb-4 min-h-[40px]">
                Books recommended by self-made business leaders and investors.
              </p>
              <span className="text-xs font-semibold text-accent inline-flex items-center gap-1">
                Explore list →
              </span>
            </Link>
            <Link
              href="/lists/books-recommended-by-writers"
              className="group block p-6 rounded-2xl border border-border bg-subtle/10 hover:border-accent/20 hover:shadow-lg transition-all duration-200"
            >
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-bold text-base text-ink group-hover:text-accent transition-colors">Writers</h3>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-semibold shrink-0">
                  75 books
                </span>
              </div>
              <p className="text-sm text-muted leading-relaxed mb-4 min-h-[40px]">
                Books recommended by bestselling authors, essayists, and creators.
              </p>
              <span className="text-xs font-semibold text-accent inline-flex items-center gap-1">
                Explore list →
              </span>
            </Link>
            <Link
              href="/lists/books-recommended-by-naval-ravikant"
              className="group block p-6 rounded-2xl border border-border bg-subtle/10 hover:border-accent/20 hover:shadow-lg transition-all duration-200"
            >
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-bold text-base text-ink group-hover:text-accent transition-colors">Naval Ravikant</h3>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-semibold shrink-0">
                  75 books
                </span>
              </div>
              <p className="text-sm text-muted leading-relaxed mb-4 min-h-[40px]">
                Startups, wealth, philosophy, and decision-making books recommended by Naval Ravikant.
              </p>
              <span className="text-xs font-semibold text-accent inline-flex items-center gap-1">
                Explore list →
              </span>
            </Link>
            <Link
              href="/lists/books-recommended-by-warren-buffett"
              className="group block p-6 rounded-2xl border border-border bg-subtle/10 hover:border-accent/20 hover:shadow-lg transition-all duration-200"
            >
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-bold text-base text-ink group-hover:text-accent transition-colors">Warren Buffett</h3>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-semibold shrink-0">
                  70 books
                </span>
              </div>
              <p className="text-sm text-muted leading-relaxed mb-4 min-h-[40px]">
                Investing, business, and long-term thinking books recommended by Warren Buffett.
              </p>
              <span className="text-xs font-semibold text-accent inline-flex items-center gap-1">
                Explore list →
              </span>
            </Link>
            <Link
              href="/lists/books-recommended-by-elon-musk"
              className="group block p-6 rounded-2xl border border-border bg-subtle/10 hover:border-accent/20 hover:shadow-lg transition-all duration-200"
            >
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-bold text-base text-ink group-hover:text-accent transition-colors">Elon Musk</h3>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-semibold shrink-0">
                  75 books
                </span>
              </div>
              <p className="text-sm text-muted leading-relaxed mb-4 min-h-[40px]">
                Science fiction, engineering, physics, and startup books recommended by Elon Musk.
              </p>
              <span className="text-xs font-semibold text-accent inline-flex items-center gap-1">
                Explore list →
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* Popular Books */}
      <section className="py-14 px-4">
        <div className="max-w-7xl mx-auto">
          <SectionHeading title="Popular Books" href="/books" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-5">
            {books.map((book) => (
              <BookCard key={book.id} {...book} coverUrl={book.cover_image_url} authorSlug={book.author_slug} recommendationCount={book.recommendation_count} />
            ))}
          </div>
        </div>
      </section>

      {/* Featured People */}
      <section className="py-14 px-4 bg-subtle/60">
        <div className="max-w-7xl mx-auto">
          <SectionHeading title="Books recommended by notable people" href="/people" linkLabel="View all people →" />
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

      {/* Lists + Series */}
      <section className="py-14 px-4">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-14">
          <div>
            <SectionHeading title="Featured Reading Lists" href="/lists" />
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

      {/* How recommendations are verified */}
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

      {/* CTA */}
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
