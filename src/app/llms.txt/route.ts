import { getListsPaginated, getQualityPeople } from "@/lib/data";
import { displayListTitleFull } from "@/lib/display";
import { clampDescription } from "@/lib/seo";

/**
 * /llms.txt — a plain-text map of the site for language models.
 *
 * An LLM answering "what did Bill Gates recommend" either scrapes rendered
 * HTML and hopes, or reads something written for it. This is the latter: one
 * document listing every published list and recommender with a one-line
 * description and a stable URL, plus a pointer to the markdown twin of each
 * page.
 *
 * Deliberately links to the canonical HTML URLs rather than the markdown
 * ones. The markdown endpoint is an alternate representation, not a second
 * set of documents, and pointing crawlers at both invites duplication.
 *
 * Format follows the llms.txt convention: H1, a blockquote summary, then
 * H2 sections of `- [name](url): description` lines.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://bookmentions.net";

function line(name: string, url: string, desc?: string | null): string {
  const d = clampDescription(desc || "", 180);
  return d ? `- [${name}](${url}): ${d}` : `- [${name}](${url})`;
}

export async function GET() {
  const [lists, people] = await Promise.all([
    getListsPaginated(1, 200, "book_count"),
    getQualityPeople(200),
  ]);

  const out: string[] = [
    "# BookMentions",
    "",
    "> Book recommendations traced back to their source. For every book, who recommended it, where they said it, and the quote — drawn from interviews, podcasts, essays, shareholder letters and published reading lists rather than sales rank.",
    "",
    "## How to read this site",
    "",
    "- Recommendations carry provenance: a source URL and, where available, the recommender's own words.",
    "- A book's ranking reflects how many distinct people recommended it, not how many copies it sold.",
    "- Lists show the top 100 titles; the caption states the full membership when it is larger.",
    "- Every page has a plain-markdown twin at `/md/<type>/<slug>` — for example `/md/lists/best-philosophy-books`, `/md/people/bill-gates`, `/md/books/atomic-habits-james-clear`.",
    "",
    "## Reading lists",
    "",
  ];

  for (const l of lists.data) {
    if (!l?.slug) continue;
    out.push(
      line(displayListTitleFull(l.title, l.slug), `${BASE_URL}/lists/${l.slug}`, l.description),
    );
  }

  out.push("", "## Recommenders", "");
  for (const p of people) {
    if (!p?.slug || !p?.name) continue;
    out.push(line(`${p.name} — recommended books`, `${BASE_URL}/people/${p.slug}`, p.role || p.bio));
  }

  out.push(
    "",
    "## Canonical index",
    "",
    `- [Sitemap](${BASE_URL}/sitemap.xml)`,
    `- [All lists](${BASE_URL}/lists)`,
    `- [All recommenders](${BASE_URL}/people)`,
    `- [All books](${BASE_URL}/books)`,
    "",
  );

  return new Response(out.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
