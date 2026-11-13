import type { ReactNode } from "react";
import { BookSectionHeading, DraftNotesLabel } from "./primitives";

/**
 * "Is it for you?": who the book suits, who may want to skip it, and its
 * themes. Built from books.best_for / not_for / key_themes, which are
 * AI-written drafts, so the provenance label is part of the block and the
 * block renders nothing when none of the lists parsed.
 */
export function ReaderFit({
  bestFor,
  notFor,
  themes,
  reviewed,
  dated,
  cta,
}: {
  bestFor: string[];
  notFor: string[];
  themes: string[];
  reviewed: boolean;
  dated?: string;
  cta?: ReactNode;
}) {
  if (bestFor.length === 0 && notFor.length === 0) return null;
  return (
    <section className="mb-16" aria-labelledby="fit">
      <BookSectionHeading id="fit" title="Is it for you?" dek="Who it suits, and when you might want to skip it." />
      <div className="mb-4">
        <DraftNotesLabel reviewed={reviewed} dated={dated} />
      </div>
      <div data-reveal-stagger className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {bestFor.length > 0 && (
          <div className="rounded-2xl border border-border bg-surface p-5 md:p-6">
            <h3 className="type-h3 text-ink mb-4">Read it if you are…</h3>
            <ul className="space-y-3">
              {bestFor.map((item, i) => (
                <li key={i} className="grid grid-cols-[20px_minmax(0,1fr)] gap-2 text-[15px] leading-relaxed text-ink/90">
                  <svg className="w-4 h-4 mt-1 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {notFor.length > 0 && (
          <div className="rounded-2xl border border-border bg-surface p-5 md:p-6">
            <h3 className="type-h3 text-ink mb-4">Skip it if…</h3>
            <ul className="space-y-3">
              {notFor.map((item, i) => (
                <li key={i} className="grid grid-cols-[20px_minmax(0,1fr)] gap-2 text-[15px] leading-relaxed text-ink/90">
                  <svg className="w-4 h-4 mt-1 text-orange-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {themes.length > 0 && (
        <div className="mt-5">
          <h3 className="sr-only">Key themes</h3>
          <ul className="flex flex-wrap gap-2" aria-label="Key themes">
            {themes.map((t) => (
              <li
                key={t}
                className="max-w-full truncate rounded-full border border-border bg-surface px-3 py-1.5 text-[13px] text-ink/85"
                title={t}
              >
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-4 text-xs text-muted/80 leading-relaxed max-w-3xl">
        Recommendations, quotes and sources elsewhere on this page come from published material and are not generated.
      </p>
      {cta && <div className="mt-4">{cta}</div>}
    </section>
  );
}
