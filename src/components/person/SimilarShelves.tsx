import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { comparePath } from "@/lib/personInsights";

export interface SimilarShelfCard {
  slug: string;
  name: string;
  role: string | null;
  avatarUrl: string | null;
  shared: number;
  /** Up to two shared titles, most-recommended first. */
  examples: string[];
  comparable: boolean;
}

/**
 * "People with a similar shelf". A card links to the /compare page for the
 * pair when that page is indexable, else to the other person's profile.
 */
export function SimilarShelves({
  personSlug,
  firstName,
  people,
}: {
  personSlug: string;
  firstName: string;
  people: SimilarShelfCard[];
}) {
  if (people.length === 0) return null;
  return (
    <section className="mb-14" aria-labelledby="similar-h">
      <h2 data-reveal id="similar-h" className="type-h2 text-ink mb-1.5">
        People with a similar shelf
      </h2>
      <p data-reveal className="text-sm text-muted max-w-2xl mb-5">
        Ranked by how many of the same books they recommend as {firstName}.
      </p>
      <ul data-reveal-stagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {people.map((p) => {
          const href = p.comparable ? comparePath(personSlug, p.slug) : `/people/${p.slug}`;
          return (
            <li key={p.slug}>
              <Link
                href={href}
                className="group flex items-start gap-3 h-full rounded-xl border border-border bg-surface p-3.5 hover:border-accent/30 transition-colors"
              >
                <Avatar name={p.name} slug={p.slug} avatarUrl={p.avatarUrl || ""} sizeClass="w-11 h-11" textClass="text-sm" className="shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink truncate group-hover:text-accent transition-colors">
                    {p.name}
                  </span>
                  {p.shared > 0 && (
                    <span className="block text-xs font-semibold text-accent mt-0.5">
                      {p.shared} {p.shared === 1 ? "book" : "books"} in common
                    </span>
                  )}
                  {p.examples.length > 0 && (
                    <span className="block text-xs text-muted mt-1 line-clamp-2">
                      Both recommend {p.examples.join(" and ")}
                    </span>
                  )}
                  <span className="block text-[11px] text-muted/80 mt-1.5 font-medium group-hover:text-accent transition-colors">
                    {p.comparable ? "Compare shelves →" : "Recommended books →"}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
