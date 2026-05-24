import { Metadata } from "next";
import { getQualityPeople, getPersonRecommendedCount, getPersonWrittenCount, searchPeople } from "@/lib/data";
import { pageMetadata } from "@/lib/seo";
import { PersonCard, SearchBar, Breadcrumbs, EmptyState } from "@/components";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Featured People",
  description: "Discover books recommended by authors, founders, leaders, creators, and public figures with source-backed recommendation proof.",
  path: "/people",
});

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export default async function PeoplePage({ searchParams }: Props) {
  const { q } = await searchParams;
  const isSearching = q && q.length >= 2;
  const DISPLAY_LIMIT = 24;

  // Gather raw people — either from search or quality batch
  let rawPeople;
  let rawTotal: number;

  if (isSearching) {
    const data = await searchPeople(q, DISPLAY_LIMIT);
    rawPeople = data;
    rawTotal = data.length;
  } else {
    const data = await getQualityPeople(100);
    rawPeople = data;
    rawTotal = data.length;
  }

  // Fetch counts for all
  const peopleWithCounts = await Promise.all(
    rawPeople.map(async (p) => {
      const [rc, wc] = await Promise.all([
        getPersonRecommendedCount(p.id),
        getPersonWrittenCount(p.id),
      ]);
      return { ...p, recommendedCount: rc, writtenCount: wc };
    })
  );

  // Sort: recs desc, then quality_score desc, then name asc
  const sorted = [...peopleWithCounts].sort((a, b) => {
    const rcDiff = (b.recommendedCount || 0) - (a.recommendedCount || 0);
    if (rcDiff !== 0) return rcDiff;
    const qsDiff = (b.quality_score || 0) - (a.quality_score || 0);
    if (qsDiff !== 0) return qsDiff;
    return a.name.localeCompare(b.name);
  });

  // Filter for default view: hide one-word names without signals
  const shown = isSearching
    ? sorted.slice(0, DISPLAY_LIMIT)
    : sorted.filter((p) => {
        const name = p.name.trim();
        const hasSpace = name.includes(" ");
        if (!hasSpace && p.recommendedCount === 0 && p.writtenCount === 0 && !p.bio) {
          return false;
        }
        return true;
      }).slice(0, DISPLAY_LIMIT);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "People" }]} />
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-ink mb-2 tracking-tight">People</h1>
        <p className="text-base text-muted">
          {isSearching
            ? `Results for "${q}"`
            : "Featured people whose recommendations shape what we read."}
        </p>
      </div>
      <div className="mb-8">
        <SearchBar placeholder="Search people by name or role…" />
      </div>
      <div className="flex items-center justify-between mb-6 text-sm">
        <span className="text-muted">{rawTotal.toLocaleString()} people</span>
        <select className="border border-border rounded-lg px-3 py-1.5 bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/20">
          <option>Most Recommendations</option>
          <option>Name A-Z</option>
        </select>
      </div>
      {shown.length === 0 ? (
        <EmptyState message={isSearching ? `No people match "${q}".` : "No people found."} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {shown.map((person) => (
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
      )}
      {!isSearching && (
        <div className="flex items-center justify-center mt-10 gap-2">
          <span className="text-sm text-muted">Showing {shown.length} of {rawTotal} people</span>
          <span className="px-3 py-1.5 rounded-full bg-subtle border border-border text-xs text-muted">
            More coming soon
          </span>
        </div>
      )}
    </div>
  );
}
