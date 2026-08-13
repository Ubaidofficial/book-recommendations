import Link from "next/link";
import { displayListTitle, displayListTitleFull, listKindFromSlug, listKindLabel, type ListKind } from "@/lib/display";

interface ListCardProps {
  title: string;
  slug: string;
  description: string;
  bookCount: number;
  curator?: string | null;
  /** Override the derived list kind (otherwise inferred from slug). */
  kind?: ListKind;
  /** Hide the type badge — useful when a whole section is one kind. */
  hideKind?: boolean;
}

const KIND_BADGE_STYLE: Record<ListKind, string> = {
  topic: "bg-accent-light text-accent",
  meta: "bg-amber-100 text-amber-800",
  category: "bg-subtle text-muted",
  other: "bg-subtle text-muted",
};

export function ListCard({ title, slug, description, bookCount, curator, kind, hideKind }: ListCardProps) {
  const resolvedKind: ListKind = kind || listKindFromSlug(slug);
  // Card titles double as internal anchor text, so they carry the phrase the
  // target page ranks for. displayListTitleFull already returns the short
  // clean title for meta and series-style lists, so this branch only served
  // to suppress the phrase on category lists — which target "Best X Books"
  // just as topic lists do.
  const displayName = displayListTitleFull(title, slug);
  return (
    <Link
      href={`/lists/${slug}`}
      className="group block rounded-2xl border border-border bg-surface p-5 hover:border-accent/20 motion-card-hover"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-semibold text-base text-ink group-hover:text-accent transition-colors leading-snug">
          {displayName}
        </h3>
        {bookCount > 0 && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-light text-accent text-xs font-medium shrink-0">
            {bookCount} books
          </span>
        )}
      </div>
      {!hideKind && resolvedKind !== "other" && (
        <div className="flex items-center gap-2 mb-2 text-[11px]">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium ${KIND_BADGE_STYLE[resolvedKind]}`}>
            {listKindLabel(resolvedKind)}
          </span>
          {resolvedKind === "topic" && (
            <span className="text-muted/60 truncate">{slug}</span>
          )}
        </div>
      )}
      <p className="text-sm text-muted leading-relaxed line-clamp-2">{description}</p>
      {curator && (
        <p className="text-xs text-accent font-medium mt-3">Curated by {curator}</p>
      )}
    </Link>
  );
}
