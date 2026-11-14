import { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";

// Indexable on purpose: the footer and the home page point here for "how is this
// ranked", so it is the page that backs up the site's main claim. Keep every
// statement below true of the code and data; if the ranking or the publishing
// rules change, change this page in the same commit.
export const metadata: Metadata = pageMetadata({
  title: "Methodology",
  description: "How BookMentions collects, sources and ranks book recommendations from public sources, and where the evidence is thin.",
  path: "/methodology",
});

export default function MethodologyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
      <h1 className="type-h1 text-ink mb-4">Methodology</h1>

      <div className="prose-body text-muted-strong space-y-5">
        <h2 data-reveal className="type-h2 text-ink mt-8">Platform Scale</h2>
        <p>
          BookMentions tracks over <strong>98,000 books</strong>, more than <strong>2,000 notable people</strong>,
          hundreds of curated lists, and <strong>3,500+ book series</strong>. Only a small share of these pages
          is shown to search engines. The rest stay available to visitors but are kept out of search until they
          pass the checks under Quality Standards below.
        </p>

        <h2 data-reveal className="type-h2 text-ink mt-8">Source Collection</h2>
        <p>
          We collect book recommendations from public sources including interviews, articles, books, podcasts,
          social media posts, and curated reading lists. Each source is recorded with a URL and retrieval date.
        </p>

        <h2 data-reveal className="type-h2 text-ink mt-8">Verification</h2>
        <p>
          We prefer recommendations backed by a primary source and link to it wherever we have one. Some
          entries, mostly older imports, don&apos;t yet have a source link; they are shown without one. We do
          not generate or invent recommendations. If one is wrong or wrongly attributed,{" "}
          <Link href="/report-issue" className="text-accent hover:underline">report it</Link> and we will review it.
        </p>

        <h2 data-reveal className="type-h2 text-ink mt-8">Ranking</h2>
        <p>
          Within a list, books are ordered by how many people recommend them, with ties broken by the book&apos;s
          rating where we have one. Sales rank is not a factor. The recommendation count is shown next to each
          book so you can judge how much support a pick has. Where we show the evidence behind a
          recommendation (the quote and its source), the entries with the highest confidence score are shown first.
        </p>

        <h2 data-reveal className="type-h2 text-ink mt-8">What the counts can and can&apos;t tell you</h2>
        <p>
          A count of one or two is thin evidence, and some lists, mostly niche topics, rest on few recommendations
          in total. In those lists a book with no recorded recommendation is included because it fits the topic,
          not because someone notable endorsed it. The people we track include many authors, founders and
          investors, so a list reflects what those people recommend, not what readers at large rate highest.
        </p>

        <h2 data-reveal className="type-h2 text-ink mt-8">Quality Standards</h2>
        <p>
          A page is only shown to search engines when it has enough on it to be useful: clear metadata,
          recommendation evidence, and related books or lists. Person pages with very few books and no
          sourced recommendation, and book pages that nobody recommends and that have no description of their
          own, are kept out. Newer lists must also meet minimum thresholds for size and for the number of
          different people recommending before they are published. Pages that miss the bar stay available
          to visitors.
        </p>

        <h2 data-reveal className="type-h2 text-ink mt-8">Affiliate links</h2>
        <p>
          Links to Amazon carry our Associates tag, and we earn a commission on qualifying purchases at no extra
          cost to you. They are marked as sponsored links and have no effect on ranking.
        </p>
      </div>
    </div>
  );
}
