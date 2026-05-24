import { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Methodology",
  description: "See how BookRecs collects, verifies, ranks, and quality-checks book recommendations from public sources.",
  path: "/methodology",
});

export default function MethodologyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
      <h1 className="text-3xl font-bold text-ink mb-4 tracking-tight">Methodology</h1>

      <div className="prose prose-base text-muted max-w-none space-y-5 leading-relaxed">
        <h2 className="text-xl font-bold text-ink mt-8">Platform Scale</h2>
        <p>
          BookRecs currently tracks over <strong>98,000 books</strong>, more than <strong>2,000 notable people</strong>,
          over <strong>350 curated lists</strong>, and <strong>3,500+ book series</strong>. Every entry is linked to
          verified sources where available.
        </p>

        <h2 className="text-xl font-bold text-ink mt-8">Source Collection</h2>
        <p>
          We collect book recommendations from public sources including interviews, articles, books, podcasts,
          social media posts, and curated reading lists. Each source is recorded with a URL and retrieval date.
        </p>
        <h2 className="text-xl font-bold text-ink mt-8">Verification</h2>
        <p>
          Every recommendation requires at least one primary source. We cross-reference claims across multiple
          sources where available. Recommendations without verifiable sources are excluded.
        </p>
        <h2 className="text-xl font-bold text-ink mt-8">Ranking</h2>
        <p>
          Books are ranked primarily by recommendation count — the number of unique notable people who have
          publicly recommended them. Secondary ranking factors include recency, source quality, and the
          confidence score of each individual recommendation.
        </p>
        <h2 className="text-xl font-bold text-ink mt-8">Quality Standards</h2>
        <p>
          We only surface pages when they have enough useful information, such as clear metadata,
          recommendation evidence, and related books or lists. Incomplete pages are kept out of
          discovery until they are improved.
        </p>
      </div>
    </div>
  );
}
