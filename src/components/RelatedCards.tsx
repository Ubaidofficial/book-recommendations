import Link from "next/link";
import { CollectionThumb } from "./CollectionThumb";
import { getListVisuals, getSeriesVisuals } from "@/lib/collectionVisuals";

export interface RelatedCardItem {
  id: string;
  slug: string;
  /** Already display-formatted. */
  title: string;
  bookCount: number;
  description?: string | null;
  /** Small label at the right (e.g. "Topic", "Curated"). */
  badge?: { text: string; className: string } | null;
}

function Cards({ items, hrefBase, visuals }: { items: RelatedCardItem[]; hrefBase: string; visuals: Awaited<ReturnType<typeof getListVisuals>> }) {
  return (
    <div data-reveal-stagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {items.map((it) => (
        <Link
          key={it.id}
          href={`${hrefBase}/${it.slug}`}
          className="group flex items-start gap-3.5 rounded-xl border border-border bg-surface p-3.5 hover:border-accent/20 hover:shadow-md transition-all"
        >
          <CollectionThumb visual={visuals[it.slug] ?? null} slug={it.slug} size="sm" className="mt-0.5" />
          <span className="block min-w-0 flex-1">
            <span className="mb-1 flex items-start justify-between gap-2">
              <span className="text-sm font-semibold text-ink group-hover:text-accent transition-colors">{it.title}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {it.badge && (
                  <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${it.badge.className}`}>{it.badge.text}</span>
                )}
                {it.bookCount > 0 && <span className="text-xs text-muted">{it.bookCount} books</span>}
              </span>
            </span>
            {it.description && <span className="line-clamp-2 block text-xs text-muted">{it.description}</span>}
          </span>
        </Link>
      ))}
    </div>
  );
}

/** Cards for related lists, each with a thumbnail (a person's portrait, or the list's own top covers). */
export async function RelatedListCards({ items }: { items: RelatedCardItem[] }) {
  const visuals = await getListVisuals(items.map((i) => i.slug));
  return <Cards items={items} hrefBase="/lists" visuals={visuals} />;
}

/** Cards for related series, each with a thumbnail (the series' first covers). */
export async function RelatedSeriesCards({ items }: { items: RelatedCardItem[] }) {
  const visuals = await getSeriesVisuals(items.map((i) => i.slug));
  return <Cards items={items} hrefBase="/series" visuals={visuals} />;
}
