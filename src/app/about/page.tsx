import { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "About",
  description: "Learn about BookRecs — how we collect and verify book recommendations from the world's most respected people.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
      <h1 className="text-3xl font-bold text-ink mb-4 tracking-tight">About BookRecs</h1>
      <div className="prose prose-base text-muted max-w-none space-y-5 leading-relaxed">
        <p>
          BookRecs aggregates book recommendations from the world&apos;s most respected people — authors,
          thinkers, scientists, entrepreneurs, and leaders. We collect publicly available recommendations
          from interviews, articles, social media, podcasts, and curated lists.
        </p>
        <p>
          Every recommendation is linked to its original source, giving you confidence that the book
          comes genuinely recommended by someone you trust.
        </p>
        <h2 className="text-xl font-bold text-ink mt-10">How It Works</h2>
        <p>
          We scan public sources for book mentions by notable people. Each mention is verified against
          at least one primary source. Books are then ranked by the number and quality of recommendations.
        </p>
        <p>
          Our methodology ensures that popular books with many endorsements naturally rise to the top,
          while hidden gems recommended by respected individuals get visibility.
        </p>
        <h2 className="text-xl font-bold text-ink mt-10">Data Integrity</h2>
        <p>
          We do not generate or fabricate recommendations. Every entry is backed by a verifiable source.
          If you believe a recommendation is inaccurate, you can report it and we&apos;ll review it.
        </p>
      </div>
    </div>
  );
}
