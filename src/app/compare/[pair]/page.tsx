import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getPersonBySlugCached, type Person } from "@/lib/data";
import { pageMetadata, isIndexable, canonicalUrl } from "@/lib/seo";
import { breadcrumbListJsonLd } from "@/lib/jsonld";
import { isValidHttpUrl } from "@/lib/dataQuality";
import {
  getPersonShelf,
  getPublishedShelves,
  computeComparePairs,
  splitPairSlug,
  comparePairSlug,
  comparePath,
  COMPARE_MIN_SHARED,
  COMPARE_MIN_SHELF,
  type ShelfBook,
} from "@/lib/personInsights";
import { Avatar, Breadcrumbs } from "@/components";
import { VennDiagram } from "@/components/person/VennDiagram";
import { CoverTile, BookRow } from "@/components/person/CoverTile";

/**
 * /compare/<slugA>-vs-<slugB>: two people's shelves side by side.
 *
 * The canonical URL has the slugs in alphabetical order; the reverse order
 * permanently redirects to it. Only pairs where both people are published and
 * share at least COMPARE_MIN_SHARED books are indexable (and listed in the
 * sitemap); every other pair still renders, as noindex,follow, so a link to it
 * is never a dead end.
 */
export const revalidate = 300;

interface Props {
  params: Promise<{ pair: string }>;
}

const SHARED_SHOWN = 48;
const UNIQUE_SHOWN = 8;

interface ResolvedPair {
  a: Person;
  b: Person;
  canonical: string;
}

/** Find the two people a pair segment names. Null when either is unknown. */
async function resolvePair(pair: string): Promise<ResolvedPair | null> {
  for (const [x, y] of splitPairSlug(pair)) {
    if (x === y) continue;
    const [px, py] = await Promise.all([getPersonBySlugCached(x), getPersonBySlugCached(y)]);
    if (!px || !py) continue;
    const [a, b] = px.slug.localeCompare(py.slug) <= 0 ? [px, py] : [py, px];
    return { a, b, canonical: comparePairSlug(a.slug, b.slug) };
  }
  return null;
}

interface Overlap {
  shelfA: ShelfBook[];
  shelfB: ShelfBook[];
  shared: ShelfBook[];
  onlyA: ShelfBook[];
  onlyB: ShelfBook[];
  indexable: boolean;
}

async function overlapFor(a: Person, b: Person): Promise<Overlap> {
  const [shelfA, shelfB] = await Promise.all([getPersonShelf(a.id), getPersonShelf(b.id)]);
  const idsB = new Set(shelfB.map((x) => x.id));
  const idsA = new Set(shelfA.map((x) => x.id));
  // Shelves arrive most-recommended first, so every slice below is ranked.
  const shared = shelfA.filter((x) => idsB.has(x.id));
  const onlyA = shelfA.filter((x) => !idsB.has(x.id));
  const onlyB = shelfB.filter((x) => !idsA.has(x.id));
  // Indexability must agree with the sitemap, so it is decided from the same
  // published-shelves data the sitemap uses. If that read failed (empty), fall
  // back to the same rule applied to the shelves loaded here.
  let indexable = false;
  if (isIndexable(a) && isIndexable(b)) {
    const published = await getPublishedShelves();
    if (published.length > 0) {
      const key = comparePairSlug(a.slug, b.slug);
      indexable = computeComparePairs(
        published.filter((s) => s.slug === a.slug || s.slug === b.slug),
      ).some((p) => comparePairSlug(p.a, p.b) === key);
    } else {
      indexable =
        shared.length >= COMPARE_MIN_SHARED &&
        shelfA.length >= COMPARE_MIN_SHELF &&
        shelfB.length >= COMPARE_MIN_SHELF;
    }
  }
  return { shelfA, shelfB, shared, onlyA, onlyB, indexable };
}

function joinTitles(titles: string[]): string {
  if (titles.length <= 1) return titles.join("");
  return `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { pair } = await params;
  const resolved = await resolvePair(pair);
  if (!resolved) return { robots: "noindex, follow" };
  const { a, b, canonical } = resolved;
  const o = await overlapFor(a, b);
  const n = o.shared.length;
  const title =
    n > 0
      ? `${a.name} vs ${b.name}: ${n} ${n === 1 ? "book" : "books"} in common`
      : `${a.name} vs ${b.name}: book recommendations compared`;
  const examples = o.shared.slice(0, 3).map((x) => x.title);
  const description =
    n > 0
      ? `${a.name} and ${b.name} both recommend ${n} ${n === 1 ? "book" : "books"}, including ${joinTitles(examples)}. See the shared picks and what each recommends that the other doesn't.`
      : `${a.name} and ${b.name} have no recommended books in common on BookMentions yet. See what each of them recommends.`;
  return pageMetadata({
    title,
    description,
    path: `/compare/${canonical}`,
    robots: o.indexable ? "index, follow" : "noindex, follow",
  });
}

function PersonHead({ person, count, tone }: { person: Person; count: number; tone: "a" | "b" }) {
  const ring = tone === "a" ? "ring-[#5b4fcf]/50" : "ring-[#e07b39]/60";
  return (
    <Link
      href={`/people/${person.slug}`}
      className="group flex items-center gap-3.5 rounded-2xl border border-border bg-surface p-4 hover:border-accent/30 transition-colors min-w-0"
    >
      <Avatar
        name={person.name}
        slug={person.slug}
        avatarUrl={isValidHttpUrl(person.avatar_url) ? person.avatar_url : ""}
        sizeClass="w-14 h-14"
        textClass="text-base"
        className={`ring-2 ${ring}`}
        alt={`${person.name}${person.role ? `, ${person.role}` : ""} — book recommendations`}
      />
      <span className="min-w-0">
        <span className="block font-semibold text-ink truncate group-hover:text-accent transition-colors">{person.name}</span>
        {person.role && <span className="block text-xs text-muted truncate">{person.role}</span>}
        <span className="block text-xs font-semibold text-accent mt-1">
          {count > 0 ? `${count.toLocaleString("en-US")} ${count === 1 ? "book" : "books"} recommended · ` : ""}See all →
        </span>
      </span>
    </Link>
  );
}

export default async function ComparePage({ params }: Props) {
  const { pair } = await params;
  const resolved = await resolvePair(pair);
  if (!resolved) notFound();
  const { a, b, canonical } = resolved;
  // Reverse order, stray capitals or encoding all collapse onto one URL.
  if (decodeURIComponent(pair) !== canonical) permanentRedirect(`/compare/${canonical}`);

  const o = await overlapFor(a, b);
  const n = o.shared.length;

  // Other comparisons for either person, for sideways navigation. Only
  // indexable pairs are offered, so these links never point at noindex pages.
  let morePairs: Array<{ href: string; label: string; shared: number }> = [];
  try {
    const shelves = await getPublishedShelves();
    const nameOf = new Map(shelves.map((s) => [s.slug, s.name]));
    const here = new Set([a.slug, b.slug]);
    morePairs = computeComparePairs(shelves)
      .filter((p) => (here.has(p.a) || here.has(p.b)) && !(here.has(p.a) && here.has(p.b)))
      .slice(0, 8)
      .map((p) => ({
        href: comparePath(p.a, p.b),
        label: `${nameOf.get(p.a) ?? p.a} vs ${nameOf.get(p.b) ?? p.b}`,
        shared: p.shared,
      }));
  } catch (e) {
    console.error("[compare] related pairs failed:", e);
  }

  const pageUrl = canonicalUrl(`/compare/${canonical}`);
  const shown = o.shared.slice(0, SHARED_SHOWN);
  const jsonLd: Record<string, unknown>[] = [
    breadcrumbListJsonLd([
      { name: "Home", path: "/" },
      { name: "People", path: "/people" },
      { name: `${a.name} vs ${b.name}`, path: `/compare/${canonical}` },
    ]),
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${pageUrl}#webpage`,
      url: pageUrl,
      name: `${a.name} vs ${b.name}: ${n} books in common`,
      inLanguage: "en",
      about: [
        { "@type": "Person", "@id": canonicalUrl(`/people/${a.slug}#person`), name: a.name },
        { "@type": "Person", "@id": canonicalUrl(`/people/${b.slug}#person`), name: b.name },
      ],
      ...(shown.length > 0
        ? {
            mainEntity: {
              "@type": "ItemList",
              name: `Books recommended by both ${a.name} and ${b.name}`,
              numberOfItems: n,
              itemListElement: shown.map((x, i) => ({
                "@type": "ListItem",
                position: i + 1,
                item: { "@type": "Book", "@id": canonicalUrl(`/books/${x.slug}#book`), name: x.title, url: canonicalUrl(`/books/${x.slug}`) },
              })),
            },
          }
        : {}),
    },
  ];

  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "People", href: "/people" }, { label: `${a.name} vs ${b.name}` }]} />

      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent mb-2">Compare two shelves</p>
        <h1 className="text-2xl md:text-4xl font-bold text-ink tracking-tight leading-tight">
          {a.name} vs {b.name}
          <span className="block text-base md:text-xl font-semibold text-muted mt-1">
            {n > 0 ? `${n} ${n === 1 ? "book" : "books"} in common` : "No books in common yet"}
          </span>
        </h1>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 mb-8">
        <PersonHead person={a} count={o.shelfA.length} tone="a" />
        <PersonHead person={b} count={o.shelfB.length} tone="b" />
      </div>

      <section className="mb-14 rounded-2xl border border-border bg-surface p-5 md:p-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center" aria-labelledby="overlap-h">
        <div>
          <h2 id="overlap-h" className="text-xl font-bold text-ink tracking-tight mb-2">How much their shelves overlap</h2>
          <p className="text-sm text-muted leading-relaxed">
            {n > 0 ? (
              <>
                {a.name} and {b.name} both recommend <b className="text-ink">{n}</b> {n === 1 ? "book" : "books"}. That is{" "}
                {pct(n, o.shelfA.length)}% of {a.name}’s {o.shelfA.length} picks and {pct(n, o.shelfB.length)}% of {b.name}’s{" "}
                {o.shelfB.length}.
              </>
            ) : (
              <>
                We have no book on file that both {a.name} and {b.name} recommend. Their full lists are linked above.
              </>
            )}
          </p>
          <p className="text-xs text-muted/80 mt-3 leading-relaxed">
            Circle sizes follow how many books each person has recommended; the overlap follows the books they share.
            Recommendations come from public interviews, posts and reading lists, with sources linked on each person’s page where confirmed.
          </p>
        </div>
        <VennDiagram nameA={a.name} nameB={b.name} sizeA={o.shelfA.length} sizeB={o.shelfB.length} shared={n} />
      </section>

      {n > 0 && (
        <section className="mb-14" aria-labelledby="shared-h">
          <h2 id="shared-h" className="text-xl font-bold text-ink mb-1.5 tracking-tight">
            {n === 1 ? "The book they both recommend" : `The ${n} books they both recommend`}
          </h2>
          <p className="text-sm text-muted max-w-2xl mb-6">
            Ordered by how many people on BookMentions recommend each one
            {n > SHARED_SHOWN ? `; showing the top ${SHARED_SHOWN}` : ""}.
          </p>
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-7 md:gap-x-5">
            {shown.map((x) => (
              <li key={x.id}>
                <CoverTile book={x} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {(o.onlyA.length > 0 || o.onlyB.length > 0) && (
        <section className="mb-14" aria-labelledby="unique-h">
          <h2 id="unique-h" className="text-xl font-bold text-ink mb-1.5 tracking-tight">What only one of them recommends</h2>
          <p className="text-sm text-muted max-w-2xl mb-6">The most-recommended picks on each shelf that are not on the other.</p>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              { p: a, list: o.onlyA, tone: "border-t-[#5b4fcf]" },
              { p: b, list: o.onlyB, tone: "border-t-[#e07b39]" },
            ].map(({ p, list, tone }) => (
              <div key={p.slug} className={`rounded-2xl border border-border border-t-4 ${tone} bg-surface p-5 min-w-0`}>
                <h3 className="text-base font-bold text-ink mb-3">
                  Only {p.name}
                  {list.length > 0 && <span className="font-normal text-muted text-sm"> · {list.length} {list.length === 1 ? "book" : "books"}</span>}
                </h3>
                {list.length > 0 ? (
                  <ul className="grid gap-1">
                    {list.slice(0, UNIQUE_SHOWN).map((x) => (
                      <li key={x.id}>
                        <BookRow book={x} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">Every book on {p.name}’s list is also on the other.</p>
                )}
                <Link href={`/people/${p.slug}`} className="inline-block mt-4 text-xs font-bold text-accent hover:underline">
                  All of {p.name}’s recommended books →
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {morePairs.length > 0 && (
        <section className="mb-10 pt-8 border-t border-border" aria-labelledby="more-h">
          <h2 id="more-h" className="text-lg font-bold text-ink mb-4 tracking-tight">More shelf comparisons</h2>
          <ul className="flex flex-wrap gap-2">
            {morePairs.map((p) => (
              <li key={p.href}>
                <Link
                  href={p.href}
                  className="inline-flex items-baseline gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-ink hover:border-accent/40 hover:text-accent transition-colors"
                >
                  {p.label}
                  <span className="text-xs text-muted">{p.shared} in common</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex justify-between items-center mt-8 pt-6 border-t border-border text-sm flex-wrap gap-3">
        <Link href={`/people/${a.slug}`} className="text-accent font-semibold hover:underline">
          ← {a.name}’s recommended books
        </Link>
        <Link href={`/people/${b.slug}`} className="text-accent font-semibold hover:underline">
          {b.name}’s recommended books →
        </Link>
      </div>
    </div>
  );
}
