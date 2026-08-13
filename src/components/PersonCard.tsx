import Link from "next/link";
import { Avatar } from "./Avatar";

interface PersonCardProps {
  name: string;
  slug: string;
  role: string;
  avatarUrl: string;
  recommendedCount: number;
  writtenCount: number;
}

export function PersonCard({
  name,
  slug,
  role,
  avatarUrl,
  recommendedCount,
  writtenCount,
}: PersonCardProps) {
  return (
    <Link
      href={`/people/${slug}`}
      className="group flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 hover:border-accent/20 motion-card-hover"
    >
      <Avatar
        name={name}
        slug={slug}
        avatarUrl={avatarUrl}
        sizeClass="w-14 h-14"
        textClass="text-lg"
        className="ring-2 ring-border group-hover:ring-accent/30 transition-all"
        alt={`${name}${role ? `, ${role}` : ""} — book recommendations`}
      />

      <div className="min-w-0">
        <h3 className="font-semibold text-sm text-ink group-hover:text-accent transition-colors truncate">
          {name}
        </h3>
        <p className="text-xs text-muted mt-0.5">{role}</p>
        <div className="flex gap-3 mt-1.5">
          {recommendedCount > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-accent-light text-accent text-xs font-medium">
              {recommendedCount} recs
            </span>
          )}
          {writtenCount > 0 && (
            <span className="text-xs text-muted">
              {writtenCount} {writtenCount === 1 ? "book" : "books"} written
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
