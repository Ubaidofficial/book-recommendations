import type { RoleBreakdown } from "@/lib/roles";
import { BookSectionHeading } from "./primitives";

/** Hidden when fewer than this many recommenders land in a named bucket. */
const MIN_CLASSIFIED = 3;

/**
 * "Who recommends it, by profession": recommenders bucketed by people.role
 * (see lib/roles.ts). Counts are people, not recommendations. Recommenders
 * with no role on file are counted honestly underneath rather than guessed.
 */
export function ProfessionBars({ roles }: { roles: RoleBreakdown | null }) {
  if (!roles || roles.classified < MIN_CLASSIFIED) return null;
  const max = Math.max(...roles.buckets.map((b) => b.count), 1);
  return (
    <section className="mb-12" aria-labelledby="by-profession">
      <BookSectionHeading
        id="by-profession"
        title="Who recommends it, by profession"
        dek={`By what they do, for the ${roles.withRole.toLocaleString()} recommender${roles.withRole === 1 ? "" : "s"} whose role we have on file.`}
      />
      <ul className="grid gap-3 max-w-2xl">
        {roles.buckets.map((b) => (
          <li
            key={b.bucket}
            className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_2rem] sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm"
          >
            <span className="text-ink leading-snug">{b.label}</span>
            <span className="h-2.5 rounded-full bg-border/70 overflow-hidden" aria-hidden="true">
              <span
                className={`block h-full rounded-full ${b.bucket === "other" ? "bg-muted/50" : "bg-accent"}`}
                style={{ width: `${Math.max(4, Math.round((b.count / max) * 100))}%` }}
              />
            </span>
            <span className="text-right font-semibold text-ink tabular-nums">{b.count}</span>
          </li>
        ))}
      </ul>
      {roles.withoutRole > 0 && (
        <p className="mt-4 text-xs text-muted">
          {roles.withoutRole.toLocaleString()} more recommender{roles.withoutRole === 1 ? " has" : "s have"} no role on file yet.
        </p>
      )}
    </section>
  );
}
