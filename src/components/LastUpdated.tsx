import { formatDateLong } from "@/lib/seo";

/**
 * Visible "Last updated" line, paired with the dateModified in the page's
 * structured data. Renders nothing when there is no usable date, so a page
 * never states a date it does not have. Server component.
 */
export function LastUpdated({
  modified,
  className = "text-xs text-muted mt-2",
}: {
  modified: string | null | undefined;
  className?: string;
}) {
  const label = formatDateLong(modified);
  if (!modified || !label) return null;
  return (
    <p className={className}>
      Last updated <time dateTime={modified}>{label}</time>
    </p>
  );
}
