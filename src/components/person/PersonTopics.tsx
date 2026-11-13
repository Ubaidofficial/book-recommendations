import Link from "next/link";
import type { PersonTopic } from "@/lib/personInsights";

/** "What <name> reads most": topic lists ranked by how many of their books they hold. */
export function PersonTopics({
  topics,
  firstName,
  totalBooks,
}: {
  topics: PersonTopic[];
  firstName: string;
  totalBooks: number;
}) {
  if (topics.length === 0) return null;
  const max = topics[0].count || 1;
  return (
    <section className="mb-14" aria-labelledby="topics-h">
      <h2 id="topics-h" className="text-xl font-bold text-ink mb-1.5 tracking-tight">
        What {firstName} reads most
      </h2>
      <p className="text-sm text-muted max-w-2xl mb-5">
        Reading lists on BookMentions that {firstName}’s recommended books appear on, by number of books
        {totalBooks > 0 ? ` (out of ${totalBooks.toLocaleString("en-US")})` : ""}. A book can be on more than one list.
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {topics.map((t) => (
          <li key={t.slug}>
            <Link
              href={`/lists/${t.slug}`}
              className="group flex flex-col gap-2 h-full rounded-xl border border-border bg-surface px-4 py-3.5 hover:border-accent/30 transition-colors"
            >
              <span className="text-sm font-semibold text-ink group-hover:text-accent transition-colors">{t.title}</span>
              <span className="text-xs text-muted">
                {t.count} of {firstName}’s {t.count === 1 ? "book" : "books"}
              </span>
              <span className="block h-1 rounded-full bg-border overflow-hidden" aria-hidden="true">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, Math.round((t.count / max) * 100))}%` }} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
