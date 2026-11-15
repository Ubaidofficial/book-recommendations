import Link from "next/link";
import { displayTitle, displayListTitleFull } from "@/lib/display";
import { formatDateLong } from "@/lib/seo";
import type { RecentlyPublishedItem } from "@/lib/data";
import type { CollectionVisual } from "@/lib/collectionVisuals";
import { CollectionThumb } from "./CollectionThumb";

interface NewlyPublishedProps {
  lists?: RecentlyPublishedItem[];
  series?: RecentlyPublishedItem[];
  /** Thumbnails by slug; rows show a subject icon where one is missing. Omit for text-only rows. */
  listVisuals?: Record<string, CollectionVisual>;
  seriesVisuals?: Record<string, CollectionVisual>;
  className?: string;
}

function Column({
  heading,
  hubHref,
  hubLabel,
  items,
  hrefBase,
  label,
  visuals,
}: {
  heading: string;
  hubHref: string;
  hubLabel: string;
  items: RecentlyPublishedItem[];
  hrefBase: string;
  label: (item: RecentlyPublishedItem) => string;
  visuals?: Record<string, CollectionVisual>;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-base font-semibold text-ink">{heading}</h3>
        <Link href={hubHref} className="text-sm font-medium text-accent hover:text-accent-hover transition-colors">
          {hubLabel}
        </Link>
      </div>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
        {items.map((item) => (
          <li key={item.id}>
            <Link href={`${hrefBase}/${item.slug}`} className={`group flex justify-between gap-3 px-4 hover:bg-subtle/60 ${visuals ? "items-center py-3" : "items-baseline py-3"}`}>
              {visuals && <CollectionThumb visual={visuals[item.slug] ?? null} slug={item.slug} size="sm" />}
              <span className="min-w-0 flex-1 text-sm font-medium text-ink group-hover:text-accent transition-colors leading-snug">
                {label(item)}
              </span>
              <span className="shrink-0 text-xs text-muted">
                <time dateTime={item.published_at}>{formatDateLong(item.published_at)}</time>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Newly published" block: the latest lists and series, newest first, each
 * linking straight to its page with the publish date. Server component;
 * renders nothing when there is nothing to show.
 */
export function NewlyPublished({ lists = [], series = [], listVisuals, seriesVisuals, className = "py-14 px-4" }: NewlyPublishedProps) {
  if (lists.length === 0 && series.length === 0) return null;
  const both = lists.length > 0 && series.length > 0;
  return (
    <section className={className} aria-labelledby="newly-published-heading">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h2 data-reveal id="newly-published-heading" className="type-h2 text-ink">Newly published</h2>
          <p data-reveal className="text-sm text-muted mt-1">The latest lists and series added to BookMentions.</p>
        </div>
        <div className={both ? "grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12" : "grid grid-cols-1 gap-8"}>
          <Column
            heading="New reading lists"
            hubHref="/lists"
            hubLabel="All lists →"
            items={lists}
            hrefBase="/lists"
            label={(l) => displayListTitleFull(l.title, l.slug)}
            visuals={listVisuals}
          />
          <Column
            heading="New series in order"
            hubHref="/series"
            hubLabel="All series →"
            items={series}
            hrefBase="/series"
            label={(s) => displayTitle(s.title)}
            visuals={seriesVisuals}
          />
        </div>
      </div>
    </section>
  );
}
