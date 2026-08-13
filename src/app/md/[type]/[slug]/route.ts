import {
  getListBySlug,
  getBooksForList,
  getPersonBySlug,
  getPersonRecommendationProof,
  getBookBySlug,
  getBookRecommenders,
  getRecommendersForBooks,
} from "@/lib/data";
import { displayListTitleFull } from "@/lib/display";
import { genreForBook } from "@/lib/bookGenres";
import { parseSourceUrls, sanitizeEditorialText, getProofDisplaySafety } from "@/lib/dataQuality";

/**
 * /md/<type>/<slug> — the markdown twin of a page.
 *
 * An agent asking "who recommended Atomic Habits and what did they say" has
 * to scrape a rendered page and infer structure. This returns the same facts
 * as text: the book, its recommenders, and their actual quotes with sources.
 *
 * The HTML page stays canonical. These are an alternate representation of the
 * same resource, so each one declares its canonical URL in the body and is
 * served `X-Robots-Tag: noindex` — an agent that is handed the URL can read
 * it, but a crawler indexing both would be indexing the same content twice.
 *
 * Deliberately quote-forward. The provenance is the part of this site that
 * cannot be reconstructed from a book database, and it is the part an answer
 * engine needs in order to cite anything.
 *
 * Every quote passes getProofDisplaySafety() first — the same gate the HTML
 * pages use. Some stored rows pipe-concatenate several people's words into
 * one `quote` with several `source_url`s, and emitting those raw attributed a
 * Tobi Lutke transcript and a Jeff Dean tweet to Bill Gates. An agent will
 * quote whatever it is handed, so unverified provenance must not leave this
 * endpoint at all: no quote is far better than a misattributed one.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://bookmentions.net";

function md(body: string[], canonical: string): Response {
  return new Response(body.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
      "X-Robots-Tag": "noindex, follow",
      Link: `<${canonical}>; rel="canonical"`,
    },
  });
}

function notFound(): Response {
  return new Response("Not found\n", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ type: string; slug: string }> },
) {
  const { type, slug } = await params;

  if (type === "lists") {
    const list = await getListBySlug(slug);
    if (!list) return notFound();
    const canonical = `${BASE_URL}/lists/${list.slug}`;
    const books = await getBooksForList(list.id, 100);
    const people = await getRecommendersForBooks(books.map((b) => b.id), 12);
    const out = [
      `# ${displayListTitleFull(list.title, list.slug)}`,
      "",
      `Canonical: ${canonical}`,
      "",
      list.description || "",
      "",
      `## Books (${books.length}${list.book_count && list.book_count > books.length ? ` of ${list.book_count}` : ""})`,
      "",
      ...books.map(
        (b, i) =>
          `${i + 1}. **${b.title}**${b.author ? ` — ${b.author}` : ""}` +
          `${b.recommendation_count ? ` (${b.recommendation_count} recommendations)` : ""}` +
          ` — ${BASE_URL}/books/${b.slug}`,
      ),
      "",
      "## Who recommended these books",
      "",
      ...people.map((p) => `- ${p.name}${p.role ? ` — ${p.role}` : ""} (${p.bookCount} here) — ${BASE_URL}/people/${p.slug}`),
      "",
    ];
    return md(out, canonical);
  }

  if (type === "people") {
    const person = await getPersonBySlug(slug);
    if (!person) return notFound();
    const canonical = `${BASE_URL}/people/${person.slug}`;
    const proof = await getPersonRecommendationProof(person.id, 100);
    const out = [
      `# ${person.name} — recommended books`,
      "",
      `Canonical: ${canonical}`,
      "",
      person.role ? `**${person.role}**` : "",
      "",
      person.bio || "",
      "",
      "## Recommendations",
      "",
    ];
    for (const p of proof) {
      if (!p?.book) continue;
      const safety = getProofDisplaySafety(p, person);
      out.push(`### ${p.book.title}${p.book.author ? ` — ${p.book.author}` : ""}`);
      out.push(`${BASE_URL}/books/${p.book.slug}`);
      if (safety.showQuote && p.quote) {
        out.push("", `> ${sanitizeEditorialText(p.quote).replace(/\s+/g, " ").trim()}`);
      }
      if (safety.showSource) {
        const sources = parseSourceUrls(p.source_url);
        if (sources.length) out.push("", `Source: ${sources[0]}`);
      }
      out.push("");
    }
    return md(out, canonical);
  }

  if (type === "books") {
    const book = await getBookBySlug(slug);
    if (!book) return notFound();
    const canonical = `${BASE_URL}/books/${book.slug}`;
    const recommenders = await getBookRecommenders(book.id, 50);
    const out = [
      `# ${book.title}${book.author ? ` — ${book.author}` : ""}`,
      "",
      `Canonical: ${canonical}`,
      genreForBook(book.slug) ? `Genre: ${genreForBook(book.slug)}` : "",
      "",
      book.description || "",
      "",
      // An agent quoting this needs to know a machine wrote it, same as a
      // reader does — arguably more, since it may be repeated as fact.
      book.editorial_summary
        ? `## Summary\n\n_AI-generated from the book description and its recommendation history; not human-reviewed._\n\n${sanitizeEditorialText(book.editorial_summary)}\n`
        : "",
      `## Recommended by (${recommenders.length})`,
      "",
    ];
    for (const r of recommenders) {
      const safety = getProofDisplaySafety(r, { slug: r.person_slug, name: r.person_name });
      out.push(`### ${r.person_name}${r.role ? ` — ${r.role}` : ""}`);
      out.push(`${BASE_URL}/people/${r.person_slug}`);
      if (safety.showQuote && r.quote) {
        out.push("", `> ${sanitizeEditorialText(r.quote).replace(/\s+/g, " ").trim()}`);
      }
      if (safety.showSource) {
        const sources = parseSourceUrls(r.source_url);
        if (sources.length) out.push("", `Source: ${sources[0]}`);
      }
      out.push("");
    }
    return md(out, canonical);
  }

  return notFound();
}
