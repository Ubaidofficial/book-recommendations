import Link from "next/link";

interface SectionHeadingProps {
  title: string;
  href?: string;
  linkLabel?: string;
  /** Small uppercase label above the title. */
  eyebrow?: string;
}

export function SectionHeading({ title, href, linkLabel, eyebrow }: SectionHeadingProps) {
  return (
    <div className="flex items-end justify-between gap-4 mb-6" data-reveal>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow text-accent mb-2">{eyebrow}</p>}
        <h2 className="type-h2 text-ink">{title}</h2>
      </div>
      {href && (
        <Link
          href={href}
          className="shrink-0 whitespace-nowrap pb-1 text-sm font-semibold text-accent hover:text-accent-hover transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {linkLabel || "View all →"}
        </Link>
      )}
    </div>
  );
}
