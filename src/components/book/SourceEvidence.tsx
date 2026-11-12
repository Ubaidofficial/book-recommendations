import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import type { EvidenceRow, UnconfirmedRecommender } from "@/lib/bookInsights";
import { BookSectionHeading } from "./primitives";

/** Confirmed sources shown before the "show more" fold. */
const VISIBLE_ROWS = 6;
/** Unconfirmed names listed before they collapse into a count. */
const VISIBLE_NAMES = 18;

function EvidenceItem({ e }: { e: EvidenceRow }) {
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] sm:grid-cols-[2.75rem_minmax(0,1fr)_auto] gap-x-4 gap-y-2 items-start rounded-2xl border border-border bg-surface p-4 md:p-5">
      <Link href={`/people/${e.slug}`} className="row-span-2 sm:row-span-1" tabIndex={-1} aria-hidden="true">
        <Avatar name={e.name} slug={e.slug} avatarUrl={e.avatar_url} sizeClass="w-10 h-10 sm:w-11 sm:h-11" textClass="text-sm" className="ring-1 ring-border" />
      </Link>
      <div className="min-w-0">
        <Link href={`/people/${e.slug}`} className="font-semibold text-ink hover:text-accent hover:underline">
          {e.name}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="rounded-md bg-accent-light px-2 py-0.5 font-semibold text-accent">{e.label}</span>
          {e.own ? (
            <span className="inline-flex items-center gap-1 text-emerald-800">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              Own source{e.note ? ` · ${e.note}` : ""}
            </span>
          ) : (
            e.note && <span className="truncate max-w-[16rem]">{e.note}</span>
          )}
        </div>
        {e.quote ? (
          <blockquote className="mt-3 border-l-[3px] border-accent pl-3.5 font-serif text-[17px] md:text-lg leading-snug text-ink line-clamp-5">
            &ldquo;{e.quote}&rdquo;
          </blockquote>
        ) : (
          <p className="mt-2 text-[13px] text-muted">No quote captured from this source yet.</p>
        )}
      </div>
      <a
        href={e.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="col-start-2 sm:col-start-3 sm:row-start-1 text-[13px] font-semibold text-accent hover:text-accent-hover hover:underline whitespace-nowrap"
      >
        Open source <span aria-hidden="true">↗</span>
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </li>
  );
}

/**
 * "Who said it, and where": one row per recommender whose source passed
 * getProofDisplaySafety, typed (tweet, podcast, own site…) and marked when it
 * is demonstrably their own. Everyone else is listed by name only, plainly
 * marked as not confirmed, with no link.
 */
export function SourceEvidence({
  bookTitle,
  confirmed,
  unconfirmed,
}: {
  bookTitle: string;
  confirmed: EvidenceRow[];
  unconfirmed: UnconfirmedRecommender[];
}) {
  if (confirmed.length === 0 && unconfirmed.length === 0) return null;
  const shown = confirmed.slice(0, VISIBLE_ROWS);
  const folded = confirmed.slice(VISIBLE_ROWS);
  const names = unconfirmed.slice(0, VISIBLE_NAMES);
  const moreNames = unconfirmed.length - names.length;

  return (
    <section className="mb-16 scroll-mt-24" id="evidence" aria-labelledby="evidence-h">
      {/* Older links point at #proof-signals; keep them landing here. */}
      <span id="proof-signals" className="block -translate-y-24" aria-hidden="true" />
      <BookSectionHeading
        id="evidence-h"
        title="Who said it, and where"
        dek="Sources we could tie to the person who recommended it: their own account, website, an interview or an episode page. A quote appears only when we could match it to that source."
      />

      {confirmed.length > 0 ? (
        <>
          <ul className="grid gap-3">
            {shown.map((e) => (
              <EvidenceItem key={e.slug} e={e} />
            ))}
          </ul>
          {folded.length > 0 && (
            <details className="group mt-3">
              <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer w-fit rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink hover:border-accent/30">
                <span className="group-open:hidden">Show {folded.length} more source{folded.length === 1 ? "" : "s"}</span>
                <span className="hidden group-open:inline">Show fewer</span>
              </summary>
              <ul className="grid gap-3 mt-3">
                {folded.map((e) => (
                  <EvidenceItem key={e.slug} e={e} />
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <p className="rounded-2xl border border-border bg-surface p-5 text-sm text-muted">
          We have not yet tied any recommendation of {bookTitle} to a source of the recommender&rsquo;s own.
        </p>
      )}

      {unconfirmed.length > 0 && (
        <div className="mt-5 rounded-2xl border border-dashed border-border p-4 md:p-5">
          <p className="text-sm font-semibold text-ink">
            Source not confirmed yet{" "}
            <span className="font-normal text-muted">
              ({unconfirmed.length.toLocaleString()} recommender{unconfirmed.length === 1 ? "" : "s"})
            </span>
          </p>
          <p className="mt-1 text-xs text-muted leading-relaxed">
            Our records list them as recommending {bookTitle}, but the source on file is missing, shared across many
            people or belongs to someone else, so we do not link it.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ink/85">
            {names.map((n, i) => (
              <span key={n.slug}>
                <Link href={`/people/${n.slug}`} className="hover:text-accent hover:underline">
                  {n.name}
                </Link>
                {i < names.length - 1 ? ", " : ""}
              </span>
            ))}
            {moreNames > 0 && <span className="text-muted"> and {moreNames.toLocaleString()} more</span>}
          </p>
        </div>
      )}
    </section>
  );
}
