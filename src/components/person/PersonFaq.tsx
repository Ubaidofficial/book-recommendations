import type { FaqItem } from "@/lib/personInsights";

/**
 * Visible FAQ. Rendered fully expanded (no <details>) so every answer the
 * FAQPage JSON-LD declares is on screen, word for word.
 */
export function PersonFaq({ heading, items }: { heading: string; items: FaqItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mb-14" aria-labelledby="faq-h">
      <h2 id="faq-h" className="text-xl font-bold text-ink mb-5 tracking-tight">
        {heading}
      </h2>
      <dl className="grid gap-3 max-w-3xl">
        {items.map((f) => (
          <div key={f.q} className="rounded-xl border border-border bg-surface px-5 py-4">
            <dt className="text-sm font-semibold text-ink">{f.q}</dt>
            <dd className="mt-1.5 text-sm text-muted leading-relaxed">{f.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
