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
import { BookCard, PersonCard, ListCard, SeriesCard, SearchBar, SectionHeading } from "@/components";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const CARD_COUNT = 4;

  const [featuredBooks, featuredPeople, featuredLists, featuredSeries] =
    await Promise.all([
      getFeaturedBooks(CARD_COUNT),
      getFeaturedPeople(CARD_COUNT),
      getFeaturedLists(CARD_COUNT),
      getFeaturedSeries(CARD_COUNT),
    ]);

  const books = featuredBooks.length > 0 ? featuredBooks : getFallbackBooks(CARD_COUNT);
  const people = featuredPeople.length > 0 ? featuredPeople : getFallbackPeople(CARD_COUNT);
  const lists = featuredLists.length > 0 ? featuredLists : getFallbackLists(CARD_COUNT);
  const series = featuredSeries.length > 0 ? featuredSeries : getFallbackSeries(CARD_COUNT);

  const peopleWithCounts = await Promise.all(
    people.map(async (p) => {
      const [rc, wc] = await Promise.all([
        getPersonRecommendedCount(p.id),
        getPersonWrittenCount(p.id),
      ]);
      return { ...p, recommendedCount: rc, writtenCount: wc };
    })
  );

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
          <SearchBar placeholder="Search for books, authors, or topics…" />
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

      <section className="py-20 px-4 text-center bg-subtle/40">
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
