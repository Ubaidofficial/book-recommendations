import { Metadata } from "next";
import { getPeoplePaginated, getPersonRecommendedCount, getPersonWrittenCount } from "@/lib/data";
import { pageMetadata } from "@/lib/seo";
import { PersonCard, SearchBar, Breadcrumbs, EmptyState } from "@/components";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "People",
  description: "Browse notable people whose book recommendations shape what we read.",
  path: "/people",
});

function isWeakName(person: { name: string; role: string; bio: string }): boolean {
  const trimmed = person.name.trim();
  if (!trimmed.includes(" ")) return true;
  return false;
}

export default async function PeoplePage() {
  const { data: people, total } = await getPeoplePaginated(1, 24);

  const peopleWithCounts = await Promise.all(
    people.map(async (p) => {
      const [rc, wc] = await Promise.all([
        getPersonRecommendedCount(p.id),
        getPersonWrittenCount(p.id),
      ]);
      return { ...p, recommendedCount: rc, writtenCount: wc };
    })
  );

  const filtered = peopleWithCounts.filter(
    (p) => !isWeakName(p) || p.recommendedCount > 0 || p.writtenCount > 0
  );
  const shown = filtered.length > 0 ? filtered : peopleWithCounts;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "People" }]} />
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-ink mb-2 tracking-tight">People</h1>
        <p className="text-base text-muted">Discover the people behind the recommendations.</p>
      </div>
      <div className="mb-8">
        <SearchBar placeholder="Search people by name or role…" basePath="/people" />
      </div>
      <div className="flex items-center justify-between mb-6 text-sm">
        <span className="text-muted">{total.toLocaleString()} people</span>
        <select className="border border-border rounded-lg px-3 py-1.5 bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/20">
          <option>Most Recommendations</option>
          <option>Name A-Z</option>
        </select>
      </div>
      {shown.length === 0 ? (
        <EmptyState message="No people found." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {shown.slice(0, 24).map((person) => (
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
      {total > 24 && (
        <div className="flex items-center justify-center mt-10 gap-2">
          <span className="text-sm text-muted">Page 1 of {Math.ceil(total / 24)}</span>
          <span className="px-3 py-1.5 rounded-full bg-subtle border border-border text-xs text-muted">
            More coming soon
          </span>
        </div>
      )}
    </div>
  );
}
