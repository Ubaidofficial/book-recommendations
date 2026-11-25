import { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";

// Hand-maintained copy. Every statement here must match what the code and data
// actually do: if a rule changes (ranking, what counts as a source, how AI text
// is labelled), change this page in the same commit. The figures are a dated
// snapshot, not live counts; update them with the date when you refresh them.
export const metadata: Metadata = pageMetadata({
  title: "How BookMentions Works: Sources, Ranking and AI Use",
  description:
    "What counts as a recommendation on BookMentions, when we link a source, how lists are ranked, where AI is used, and what we do not yet do well.",
  path: "/methodology",
});

const SNAPSHOT_DATE = "25 November 2026";

export default function MethodologyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
      <h1 className="type-h1 text-ink mb-4">How BookMentions works</h1>

      <div className="prose-body text-muted-strong space-y-5">
        <p>
          BookMentions records which books notable people have recommended in public, and where they said it. This page
          explains what we count, what we link, how pages are ranked, where AI is involved, and the limits of the data.
          If something here does not match what you see on a page, please{" "}
          <Link href="/report-issue" className="text-accent hover:underline">report it</Link>.
        </p>

        <h2 data-reveal className="type-h2 text-ink mt-8">What counts as a recommendation</h2>
        <p>
          A recommendation is a public statement by a named person that they recommend, rate highly or list a book among
          books worth reading: in an interview, a podcast, a post, their own website, a newsletter or a published reading
          list. Each person is counted once per book, however many times they mentioned it, so &ldquo;recommended by 40
          people&rdquo; means 40 different people.
        </p>
        <p>
          Most records were imported from public compilations and reading lists. We do not generate or invent
          recommendations, and a person is never added to a book because of an AI suggestion.
        </p>

        <h2 data-reveal className="type-h2 text-ink mt-8">When we link a source, and when we do not</h2>
        <p>
          We show a source only when we can tie it to the person who made the recommendation: their own account or
          website, an interview with them, or an episode page they appear on. A quote appears only when we could match it
          to that source.
        </p>
        <p>
          Many records point to a page that lists recommendations from many people at once, such as a compilation
          article. Those pages do not show who said what, so we do not present them as proof for any one person. On a
          book page these recommenders appear under &ldquo;Source not confirmed yet&rdquo; instead.
        </p>
        <p>As of {SNAPSHOT_DATE}, across the whole catalogue:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>22,124 recommendation records;</li>
          <li>15,722 of them (71%) carry a source link of some kind;</li>
          <li>
            of the 5,257 distinct source links, 2,878 belong to a single person. The rest are shared by several people,
            so on their own they do not confirm any one person&apos;s recommendation.
          </li>
        </ul>
        <p>
          Put plainly: for many recommendations, especially older imports, we have not yet found the person&apos;s own
          words. Finding them is our main ongoing work, and pages say so where it applies.
        </p>

        <h2 data-reveal className="type-h2 text-ink mt-8">How lists and pages are ordered</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            <strong>Topic lists</strong> (&ldquo;Best &hellip; Books&rdquo;) show up to 100 books from the list, ordered by
            how many people on BookMentions recommend each one.
          </li>
          <li>
            <strong>&ldquo;Most recommended&rdquo;</strong> and the books index are ordered by the same count.
          </li>
          <li>
            <strong>A person&apos;s page</strong> lists everything we have on record for them, most widely recommended
            first by default. You can re-sort it.
          </li>
          <li>
            <strong>Series pages</strong> list books in reading order only when that order is verified. Otherwise the page
            says so and orders by first-publication year where we have one.
          </li>
        </ul>
        <p>
          The count measures how widely a book is recommended, not how good it is, and it favours books that have been
          around long enough to be recommended often.
        </p>

        <h2 data-reveal className="type-h2 text-ink mt-8">Where AI is used</h2>
        <p>
          Some book pages carry short reader notes (who a book suits, who might skip it, key themes) drafted with AI help
          from the book&apos;s description and metadata. Until an editor has reviewed them, they are labelled
          &ldquo;Draft reader notes, written with AI help and not yet reviewed by an editor&rdquo;. AI is not used to
          create recommendations, recommenders, quotes or sources.
        </p>
        <p>
          Some books&apos; genre labels, used to group books by subject, were assigned with the help of an AI classifier.
          They can be wrong; tell us if you spot one.
        </p>

        <h2 data-reveal className="type-h2 text-ink mt-8">Other data we show</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            <strong>Book details</strong> (descriptions, page counts, publication years, covers) come from public book
            databases such as Open Library and Google Books, and from the original imports. They contain errors; we fix
            them as we find them.
          </li>
          <li>
            <strong>Reddit counts</strong> come from Reddit Reads and cover comments up to March 2023. They count users
            who linked a book, once per subreddit, not votes.
          </li>
          <li>
            <strong>Amazon links</strong> are affiliate links: as an Amazon Associate we earn from qualifying purchases.
            This does not affect which books appear or how they are ordered.
          </li>
        </ul>

        <h2 data-reveal className="type-h2 text-ink mt-8">What gets published</h2>
        <p>
          The catalogue holds about 98,000 books, 2,000 people, 350 lists and 3,500 series, but only pages that pass our
          checks are published for search, such as enough recommendations from distinct people and usable book details.
          The rest stay out of search until they are improved.
        </p>

        <h2 data-reveal className="type-h2 text-ink mt-8">Corrections</h2>
        <p>
          If a recommendation is wrong, wrongly attributed or missing its source, or if you are the person named and want
          something changed, use the{" "}
          <Link href="/report-issue" className="text-accent hover:underline">report page</Link> or email{" "}
          <a href="mailto:hello@bookmentions.net" className="text-accent hover:underline">hello@bookmentions.net</a>.
          We correct the record where the evidence supports it.
        </p>
      </div>
    </div>
  );
}
