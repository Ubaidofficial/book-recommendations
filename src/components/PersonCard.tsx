import Link from "next/link";

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
      className="group flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 hover:shadow-lg hover:border-accent/20 transition-all duration-200"
    >
      <div className="w-14 h-14 rounded-full bg-subtle overflow-hidden shrink-0 ring-2 ring-border group-hover:ring-accent/30 transition-all">
        <img src={avatarUrl} alt={name} className="w-full h-full object-cover" loading="lazy" />
      </div>
      <div className="min-w-0">
        <h3 className="font-semibold text-sm text-ink group-hover:text-accent transition-colors truncate">
          {name}
        </h3>
        <p className="text-xs text-muted mt-0.5">{role}</p>
        <div className="flex gap-3 mt-1.5">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-accent-light text-accent text-xs font-medium">
            {recommendedCount} recs
          </span>
          <span className="text-xs text-muted">{writtenCount} books</span>
        </div>
      </div>
    </Link>
  );
}
