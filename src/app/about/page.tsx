import { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "About BookMentions",
  description: "Learn how BookMentions helps readers discover books through source-backed recommendations from notable people and curated lists.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
      <h1 className="text-3xl font-bold text-ink mb-4 tracking-tight">About BookMentions</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        {[
          { value: "98k+", label: "Books" },
          { value: "2k+", label: "People" },
          { value: "350+", label: "Lists" },
          { value: "3.5k+", label: "Series" },
        ].map(({ value, label }) => (
          <div key={label} className="rounded-xl bg-subtle/60 border border-border p-4 text-center">
            <div className="text-xl font-bold text-accent">{value}</div>
            <div className="text-xs text-muted mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <div className="prose prose-base text-muted max-w-none space-y-5 leading-relaxed">
        <p>
          BookMentions aggregates book recommendations from the world&apos;s most respected people — authors,
          thinkers, scientists, entrepreneurs, and leaders. We collect publicly available recommendations
          from interviews, articles, social media, podcasts, and curated reading lists.
        </p>
        <p>
          Where we have the original source, the recommendation links to it so you can check it yourself.
          Some older entries don&apos;t have a source link yet. We do not generate or fabricate recommendations.
          If you believe a recommendation is inaccurate or wrongly attributed, you can report it and we&apos;ll review it.
        </p>

        <h2 className="text-xl font-bold text-ink mt-10">How It Works</h2>
        <p>
          We scan public sources for book mentions by notable people and record the source where we have it.
          Books are then ranked by the number and quality of recommendations —
          so popular books with many endorsements naturally rise while hidden gems get visibility.
        </p>
        <p>
          We only surface pages when they have enough useful information — clear metadata, recommendation
          evidence, and related books or lists. Incomplete pages are kept out of discovery until they
          are improved.
        </p>

        <h2 className="text-xl font-bold text-ink mt-10">Sources</h2>
        <p>
          Unlike algorithm-only book sites, recommendations here come from real interviews, articles,
          podcasts, social posts, and curated reading lists, and we link to the source wherever we have it.
          A recommendation without a source link is marked &ldquo;No source link yet&rdquo;, so you can weigh it accordingly.
        </p>
      </div>
    </div>
  );
}
