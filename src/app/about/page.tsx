import { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";

// Brand-voice page: it names no individual (owner's choice, 2026-11-25) and says so plainly rather
// than inventing a persona. Every statement must match what the site does; if a rule changes,
// change this page and /methodology in the same commit.
export const metadata: Metadata = pageMetadata({
  title: "About BookMentions: Who Runs It and How It Works",
  description:
    "BookMentions tracks which books notable people recommend, and where they said it. Who runs it, how it is funded, how it uses AI, and how to correct a record.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
      <h1 className="type-h1 text-ink mb-4">About BookMentions</h1>

      <div className="prose-body text-muted-strong space-y-5">
        <p className="text-lg text-ink">
          BookMentions answers one question: which books do people you have heard of actually recommend, and where did
          they say it?
        </p>
        <p>
          Lists of &ldquo;books recommended by famous people&rdquo; are everywhere, and most do not tell you where a
          recommendation came from. We keep a record of who recommended which book, link the source when we can tie it
          to that person, and say so when we cannot. You can check the claim yourself instead of taking a list on trust.
        </p>

        <h2 data-reveal className="type-h2 text-ink mt-10">What you will find here</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            <Link href="/people" className="text-accent hover:underline">People</Link>: the books someone has recommended,
            with their own words and a source where we have them.
          </li>
          <li>
            <Link href="/books" className="text-accent hover:underline">Books</Link>: who recommends a book, what they
            said, and books recommended by the same people.
          </li>
          <li>
            <Link href="/lists" className="text-accent hover:underline">Lists</Link>: topic lists ordered by how many
            people on BookMentions recommend each book.
          </li>
          <li>
            <Link href="/series" className="text-accent hover:underline">Series</Link>: an author&apos;s books in
            reading or publication order, where that order is verified.
          </li>
        </ul>

        <h2 data-reveal className="type-h2 text-ink mt-10">Who runs it</h2>
        <p>
          BookMentions is an independent site published under the BookMentions name; this page does not name an
          individual. It is not affiliated with the people whose recommendations it lists, and none of them has endorsed
          it. Where AI helped write something on a page, the page says so (see below).
        </p>

        <h2 data-reveal className="type-h2 text-ink mt-10">How it is funded</h2>
        <p>
          Book pages link to Amazon, and as an Amazon Associate we earn from qualifying purchases made through those
          links. That is the site&apos;s income. It does not change what we list or the order of anything: lists and
          shelves are ordered by how many people recommend a book, as{" "}
          <Link href="/methodology" className="text-accent hover:underline">the methodology page</Link> explains.
        </p>

        <h2 data-reveal className="type-h2 text-ink mt-10">How we use AI</h2>
        <p>
          Recommendations, recommenders, quotes and sources are never generated: they come from published material.
          Some book pages carry short reader notes (who a book suits, who might skip it) drafted with AI help. They are
          labelled as such, and the label says whether an editor has reviewed them yet. Some genre labels were also
          assigned with an AI classifier.
        </p>

        <h2 data-reveal className="type-h2 text-ink mt-10">What we do not get right yet</h2>
        <p>
          Many recommendations, especially older imports, are not yet tied to the person&apos;s own words. Book details
          from public databases contain errors we are still fixing. Pages say where a source is unconfirmed, and{" "}
          <Link href="/methodology" className="text-accent hover:underline">the methodology page</Link> gives the current
          figures.
        </p>

        <h2 data-reveal className="type-h2 text-ink mt-10">Contact and corrections</h2>
        <p>
          If a recommendation is wrong or wrongly attributed, if a source is missing or broken, or if you are named on
          the site and want something changed, email{" "}
          <a href="mailto:hello@bookmentions.net" className="text-accent hover:underline">hello@bookmentions.net</a> or
          use the <Link href="/report-issue" className="text-accent hover:underline">report page</Link>. Include the page
          link and, where you can, a source. We correct the record where the evidence supports it.
        </p>
      </div>
    </div>
  );
}
