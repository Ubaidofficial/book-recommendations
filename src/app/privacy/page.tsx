import { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Privacy Policy",
  description: "How BookRecs handles data, cookies, and your privacy.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
      <h1 className="text-3xl font-bold text-ink mb-4 tracking-tight">Privacy Policy</h1>
      <div className="prose prose-base text-muted max-w-none space-y-5 leading-relaxed">
        <p>
          BookRecs is a book discovery platform powered by publicly available recommendation data.
          We take a straightforward approach to privacy.
        </p>

        <h2 className="text-xl font-bold text-ink mt-8">What we collect</h2>
        <p>
          We use basic analytics to understand how people use the site — which pages are visited and
          how readers discover content. This may involve cookies or similar technologies for session
          management and analytics. We do not collect or store personal identifying information unless
          you explicitly contact us.
        </p>

        <h2 className="text-xl font-bold text-ink mt-8">What we do not do</h2>
        <p>
          We do not sell, rent, or share personal data with third parties. We do not run ad networks
          that build profiles across sites. We do not require accounts to browse.
        </p>

        <h2 className="text-xl font-bold text-ink mt-8">Cookies</h2>
        <p>
          Analytics cookies help us measure site usage. You can disable cookies in your browser
          settings at any time.
        </p>

        <h2 className="text-xl font-bold text-ink mt-8">Contact</h2>
        <p>
          If you have questions about this policy or want to report a data concern, please visit our{" "}
          <a href="/report-issue" className="text-accent hover:underline">report an issue</a> page.
        </p>
      </div>
    </div>
  );
}
