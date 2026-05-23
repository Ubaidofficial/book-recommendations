import Link from "next/link";

interface SectionHeadingProps {
  title: string;
  href?: string;
  linkLabel?: string;
}

export function SectionHeading({ title, href, linkLabel }: SectionHeadingProps) {
  return (
    <div className="flex items-end justify-between mb-6">
      <h2 className="text-xl font-bold text-ink tracking-tight">{title}</h2>
      {href && (
        <Link href={href} className="text-sm font-medium text-accent hover:text-accent-hover transition-colors">
          {linkLabel || "View all →"}
        </Link>
      )}
    </div>
  );
}
