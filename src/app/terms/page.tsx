import { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Terms of Use",
  description: "Review the terms for using BookMentions, including accuracy limits, external links, acceptable use, and content policies.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
      <h1 className="text-3xl font-bold text-ink mb-4 tracking-tight">Terms of Use</h1>
      <div className="prose prose-base text-muted max-w-none space-y-5 leading-relaxed">
        <p>
          By using BookMentions, you agree to these terms. This is an informational website — we
          present publicly available book recommendation data for discovery purposes.
        </p>

        <h2 className="text-xl font-bold text-ink mt-8">Accuracy</h2>
        <p>
          Book recommendations are collected from public sources and linked to their original URLs
          where available. While we strive for accuracy, we cannot guarantee that every recommendation
          is current or correctly attributed. If you find an error, please{" "}
          <a href="/report-issue" className="text-accent hover:underline">report it</a>.
        </p>

        <h2 className="text-xl font-bold text-ink mt-8">External Links</h2>
        <p>
          Our site links to external sources for verification. We are not responsible for the
          content or availability of third-party websites.
        </p>

        <h2 className="text-xl font-bold text-ink mt-8">Acceptable Use</h2>
        <p>
          You may browse and share content from BookMentions. Do not scrape, republish, or redistribute
          our content at scale without permission. Automated access that degrades service for other
          users is not permitted.
        </p>

        <h2 className="text-xl font-bold text-ink mt-8">Changes</h2>
        <p>
          We may update these terms. Continued use of the site after changes means you accept the
          updated terms.
        </p>
      </div>
    </div>
  );
}
