import type { ReactNode } from "react";

/** Section heading used across the v4 book page: serif title + one-line dek. */
export function BookSectionHeading({
  id,
  title,
  dek,
}: {
  id?: string;
  title: ReactNode;
  dek?: ReactNode;
}) {
  return (
    <div className="mb-6" data-reveal>
      <h2 id={id} className="type-h2 text-ink">
        {title}
      </h2>
      {dek && <p className="mt-2 text-sm md:text-base text-muted leading-relaxed max-w-2xl">{dek}</p>}
    </div>
  );
}

/**
 * Provenance label for AI-written reader notes. Shown wherever those notes
 * appear; the wording is fixed so readers see the same disclosure everywhere.
 */
export function DraftNotesLabel({ reviewed = false, dated }: { reviewed?: boolean; dated?: string }) {
  return (
    <p className="inline-flex items-start gap-1.5 w-fit max-w-full rounded-xl border border-dashed border-border bg-surface/70 px-3 py-1.5 text-xs text-muted leading-snug">
      <svg className="w-3.5 h-3.5 mt-px shrink-0 text-muted/70" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
      <span>
        {reviewed
          ? "Reader notes written with AI help and reviewed by an editor"
          : "Draft reader notes, written with AI help and not yet reviewed by an editor"}
        {dated ? ` · ${dated}` : ""}
      </span>
    </p>
  );
}

export interface Fact {
  value: string;
  label: string;
}

/** Big-number facts under the title. Callers drop facts with no real value. */
export function FactsRow({ facts }: { facts: Fact[] }) {
  if (facts.length === 0) return null;
  return (
    <dl className="flex flex-wrap gap-x-7 gap-y-3">
      {facts.map((f) => (
        // dt before dd for assistive tech; flex-col-reverse puts the number on top.
        <div key={f.label} className="min-w-0 flex flex-col-reverse">
          <dt className="mt-1.5 text-[11px] uppercase tracking-[0.08em] text-muted">{f.label}</dt>
          <dd className="font-serif text-[28px] md:text-[30px] leading-none text-ink tabular-nums">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
