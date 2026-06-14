import { Metadata } from "next";
import { getTopRecommendedPeople, getPersonRecommendedCount, getPersonWrittenCount, searchPeople } from "@/lib/data";
import { pageMetadata, canonicalUrl } from "@/lib/seo";
import { collectionPageJsonLd, breadcrumbListJsonLd } from "@/lib/jsonld";
import { isProfilelessSurnameAlias } from "@/lib/dataQuality";
import { PersonCard, SearchBar, Breadcrumbs, EmptyState } from "@/components";

// Minimum recommendation count for a person to appear in the default
// (non-search) /people hub. Mirrors the >=6 quality threshold from the
// people content gap audit.
const HUB_MIN_REC_COUNT = 6;
// Conservative surname-alias dedup: drop a single-token-name record only
// when EXACTLY ONE multi-token canonical with the same surname is present
// in the candidate pool. Single-token records with 0 or 2+ canonical
// siblings are preserved (no surname conflict resolution possible).
function dedupeSurnameAliases<T extends { name: string }>(people: T[]): T[] {
  const surnameToMultiTokenCount = new Map<string, number>();
  for (const p of people) {
    const tokens = (p.name || "").trim().split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      const k = tokens[tokens.length - 1].toLowerCase();
      surnameToMultiTokenCount.set(k, (surnameToMultiTokenCount.get(k) || 0) + 1);
    }
  }
  return people.filter((p) => {
    const tokens = (p.name || "").trim().split(/\s+/).filter(Boolean);
    if (tokens.length !== 1) return true;
    const k = tokens[0].toLowerCase();
    return surnameToMultiTokenCount.get(k) !== 1;
  });
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const hasParams = !!(sp.q && sp.q.trim());

  return pageMetadata({
    title: "Books Recommended by Famous People",
    description: "Discover books recommended by authors, founders, leaders, creators, and public figures with source-backed recommendation proof.",
    path: "/people",
    robots: hasParams ? "noindex, follow" : "index, follow",
  });
}

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export default async function PeoplePage({ searchParams }: Props) {
  const { q } = await searchParams;
  const isSearching = q && q.length >= 2;
  const DISPLAY_LIMIT = 24;

  // Gather raw people — either from search or recommendation-count batch.
  // Default view: pull the top recommenders (rank by book_recommendations
  // count) so canonical famous recommenders surface even when their
  // quality_score is 0. Search: search-driven match list.
  let peopleWithCounts: Array<{
    id: string;
    slug: string;
    name: string;
    role: string;
    bio: string;
    avatar_url: string;
    quality_score: number;
    recommendedCount: number;
    writtenCount: number;
  }>;
  let rawTotal: number;

  if (isSearching) {
    const data = await searchPeople(q, DISPLAY_LIMIT);
    peopleWithCounts = await Promise.all(
      data.map(async (p) => {
        const [rc, wc] = await Promise.all([
          getPersonRecommendedCount(p.id),
          getPersonWrittenCount(p.id),
        ]);
        return { ...p, recommendedCount: rc, writtenCount: wc };
      })
    );
    rawTotal = peopleWithCounts.length;
  } else {
    peopleWithCounts = await getTopRecommendedPeople(150);
    rawTotal = peopleWithCounts.length;
  }

  // Sort: recs desc, then quality_score desc, then name asc
  const sorted = [...peopleWithCounts].sort((a, b) => {
    const rcDiff = (b.recommendedCount || 0) - (a.recommendedCount || 0);
    if (rcDiff !== 0) return rcDiff;
    const qsDiff = (b.quality_score || 0) - (a.quality_score || 0);
    if (qsDiff !== 0) return qsDiff;
    return a.name.localeCompare(b.name);
  });

  // Filter for default view:
  //   - drop one-word names without any signals (existing guard; keeps merged
  //     duplicate alias rows like /people/gates out of the hub)
  //   - drop single-token records that collide with EXACTLY ONE multi-token
  //     canonical in the same pool (conservative surname-alias dedup; keeps
  //     legit single-name recommenders intact)
  //   - require recommendation count >= HUB_MIN_REC_COUNT so the hub matches
  //     the "Books Recommended by Famous People" promise
  const shown = isSearching
    ? sorted.slice(0, DISPLAY_LIMIT)
    : dedupeSurnameAliases(
        sorted.filter((p) => {
          // Launch-safety filter: drop single-token-name rows with no
          // profile signals (no role, no bio, no avatar). These are
          // bare-surname alias rows (e.g. `hitchens`, `brand`, `watson`,
          // `sabatini`, `rowling`, `harris`) that aggregated content from
          // many distinct recommenders and can outrank a canonical
          // full-name person on raw recommendation count. The row itself
          // is preserved in the DB; only listing inclusion is suppressed.
          if (isProfilelessSurnameAlias(p)) return false;
          const name = p.name.trim();
          const hasSpace = name.includes(" ");
          if (!hasSpace && p.recommendedCount === 0 && p.writtenCount === 0 && !p.bio) {
            return false;
          }
          return p.recommendedCount >= HUB_MIN_REC_COUNT;
        })
      ).slice(0, DISPLAY_LIMIT);

  const collectionJsonLd = !isSearching
    ? collectionPageJsonLd({
        name: "Featured People | BookMentions",
        description: "Discover books recommended by authors, founders, leaders, creators, and public figures with source-backed recommendation proof.",
        url: canonicalUrl("/people"),
        items: shown.map((p) => ({
          name: p.name,
          url: canonicalUrl(`/people/${p.slug}`),
        })),
      })
    : null;

  const breadcrumbJsonLd = !isSearching
    ? breadcrumbListJsonLd([
        { name: "Home", path: "/" },
        { name: "People", path: "/people" },
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
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "People" }]} />
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-ink mb-2 tracking-tight">
          {isSearching ? "People" : "Books Recommended by Famous People"}
        </h1>
        <p className="text-base text-muted">
          {isSearching
            ? `Results for "${q}"`
            : "Browse reading lists from entrepreneurs, investors, scientists, authors, creators, and public figures."}
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
