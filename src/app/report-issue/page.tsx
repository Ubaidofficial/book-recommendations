import { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Report an Issue",
  description: "Report incorrect book details, recommendation sources, broken links, or other data quality issues on BookMentions.",
  path: "/report-issue",
});

export default function ReportIssuePage() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
      <h1 className="text-3xl font-bold text-ink mb-4 tracking-tight">Report an Issue</h1>
      <div className="prose prose-base text-muted max-w-none space-y-5 leading-relaxed">
        <p>
          Found something that doesn&apos;t look right? We want to fix it. You can report problems
          with book data, recommendation sources, or anything else on the site.
        </p>

        <h2 className="text-xl font-bold text-ink mt-8">What you can report</h2>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Incorrect book information (wrong title, author, cover)</li>
          <li>Misattributed recommendations</li>
          <li>Broken or wrong source links</li>
          <li>Missing books or people</li>
          <li>Any other issue</li>
        </ul>

        <h2 className="text-xl font-bold text-ink mt-8">How to reach us</h2>
        <p>
          Send us an email with a description of the issue. Include the page URL and any supporting
          information that would help us verify the correction.
        </p>
        <p>
          <a
            href="mailto:hello@bookmentions.net"
            className="inline-flex items-center gap-1.5 text-accent font-medium hover:underline"
          >
            hello@bookmentions.net
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </a>
        </p>

        <p className="text-sm text-muted mt-6">
          We review every report and aim to correct verified issues quickly. Thank you for helping
          keep BookMentions accurate.
        </p>
      </div>
    </div>
  );
}
