/**
 * Wikipedia + Wikidata identifiers for published recommenders, emitted as
 * schema.org `sameAs`.
 *
 * `sameAs` asserts that this page and that entity are the SAME person, so a
 * wrong link is worse than no link — it tells search engines to merge two
 * different people. Every entry was resolved by Wikipedia search, filtered to
 * Wikidata instance-of human (P31 = Q5), then read by eye against the stored
 * role.
 *
 * That layering mattered. Automated resolution alone proposed a coding
 * bootcamp for Austen Allred, a documentary film for Matt D’Avella, a list of
 * NBA players for Nat Eliason, and Balaji Srinivasan for Raoul Pal — all
 * caught by the P31 filter. It did NOT catch Andrew Chen resolving to a
 * Malaysian politician of the same name, because the stored name is a subset
 * of that longer label; only the manual read caught that one.
 *
 * 10 of 52 published people are deliberately absent: no article, or one that
 * could not be confirmed as this person. Absent is the correct state — do not
 * fill a gap here without verifying the human behind it.
 */
export const PERSON_SAME_AS: Record<string, string[]> = {
  "adam-grant": [
    "https://en.wikipedia.org/wiki/Adam_Grant",
    "https://www.wikidata.org/wiki/Q14712273",
  ],
  "alexis-ohanian": [
    "https://en.wikipedia.org/wiki/Alexis_Ohanian",
    "https://www.wikidata.org/wiki/Q4721504",
  ],
  "barack-obama": [
    "https://en.wikipedia.org/wiki/Barack_Obama",
    "https://www.wikidata.org/wiki/Q76",
  ],
  "bill-gates": [
    "https://en.wikipedia.org/wiki/Bill_Gates",
    "https://www.wikidata.org/wiki/Q5284",
  ],
  "brad-feld": [
    "https://en.wikipedia.org/wiki/Brad_Feld",
    "https://www.wikidata.org/wiki/Q16196004",
  ],
  "charlie-munger": [
    "https://en.wikipedia.org/wiki/Charlie_Munger",
    "https://www.wikidata.org/wiki/Q918630",
  ],
  "elon-musk": [
    "https://en.wikipedia.org/wiki/Elon_Musk",
    "https://www.wikidata.org/wiki/Q317521",
  ],
  "emma-watson": [
    "https://en.wikipedia.org/wiki/Emma_Watson",
    "https://www.wikidata.org/wiki/Q39476",
  ],
  "eric-weinstein": [
    "https://en.wikipedia.org/wiki/Eric_Weinstein",
    "https://www.wikidata.org/wiki/Q5387722",
  ],
  "ev-williams": [
    "https://en.wikipedia.org/wiki/Evan_Williams_(Internet_entrepreneur)",
    "https://www.wikidata.org/wiki/Q561960",
  ],
  "james-clear": [
    "https://en.wikipedia.org/wiki/James_Clear",
    "https://www.wikidata.org/wiki/Q98178306",
  ],
  "james-mattis": [
    "https://en.wikipedia.org/wiki/Jim_Mattis",
    "https://www.wikidata.org/wiki/Q267902",
  ],
  "jeff-bezos": [
    "https://en.wikipedia.org/wiki/Jeff_Bezos",
    "https://www.wikidata.org/wiki/Q312556",
  ],
  "jocko-willink": [
    "https://en.wikipedia.org/wiki/Jocko_Willink",
    "https://www.wikidata.org/wiki/Q22935809",
  ],
  "joe-rogan": [
    "https://en.wikipedia.org/wiki/Joe_Rogan",
    "https://www.wikidata.org/wiki/Q2718421",
  ],
  "jordan-peterson": [
    "https://en.wikipedia.org/wiki/Jordan_Peterson",
    "https://www.wikidata.org/wiki/Q6276882",
  ],
  "keith-rabois": [
    "https://en.wikipedia.org/wiki/Keith_Rabois",
    "https://www.wikidata.org/wiki/Q6384918",
  ],
  "malcolm-gladwell": [
    "https://en.wikipedia.org/wiki/Malcolm_Gladwell",
    "https://www.wikidata.org/wiki/Q318429",
  ],
  "marc-andreessen": [
    "https://en.wikipedia.org/wiki/Marc_Andreessen",
    "https://www.wikidata.org/wiki/Q62882",
  ],
  "mark-zuckerberg": [
    "https://en.wikipedia.org/wiki/Mark_Zuckerberg",
    "https://www.wikidata.org/wiki/Q36215",
  ],
  "michael-mauboussin": [
    "https://en.wikipedia.org/wiki/Michael_J._Mauboussin",
    "https://www.wikidata.org/wiki/Q6832587",
  ],
  "nancy-pearl": [
    "https://en.wikipedia.org/wiki/Nancy_Pearl",
    "https://www.wikidata.org/wiki/Q6962909",
  ],
  "nassim-nicholas-taleb": [
    "https://en.wikipedia.org/wiki/Nassim_Nicholas_Taleb",
    "https://www.wikidata.org/wiki/Q333521",
  ],
  "natalie-portman": [
    "https://en.wikipedia.org/wiki/Natalie_Portman",
    "https://www.wikidata.org/wiki/Q37876",
  ],
  "naval-ravikant": [
    "https://en.wikipedia.org/wiki/Naval_Ravikant",
    "https://www.wikidata.org/wiki/Q84323677",
  ],
  "nir-eyal": [
    "https://en.wikipedia.org/wiki/Nir_Eyal",
    "https://www.wikidata.org/wiki/Q7039822",
  ],
  "noam-chomsky": [
    "https://en.wikipedia.org/wiki/Noam_Chomsky",
    "https://www.wikidata.org/wiki/Q9049",
  ],
  "oprah-winfrey": [
    "https://en.wikipedia.org/wiki/Oprah_Winfrey",
    "https://www.wikidata.org/wiki/Q55800",
  ],
  "patrick-collison": [
    "https://en.wikipedia.org/wiki/Patrick_Collison",
    "https://www.wikidata.org/wiki/Q7146257",
  ],
  "paul-graham": [
    "https://en.wikipedia.org/wiki/Paul_Graham_(programmer)",
    "https://www.wikidata.org/wiki/Q92650",
  ],
  "peter-thiel": [
    "https://en.wikipedia.org/wiki/Peter_Thiel",
    "https://www.wikidata.org/wiki/Q705525",
  ],
  "ray-dalio": [
    "https://en.wikipedia.org/wiki/Ray_Dalio",
    "https://www.wikidata.org/wiki/Q7297378",
  ],
  "richard-branson": [
    "https://en.wikipedia.org/wiki/Richard_Branson",
    "https://www.wikidata.org/wiki/Q194419",
  ],
  "ryan-holiday": [
    "https://en.wikipedia.org/wiki/Ryan_Holiday",
    "https://www.wikidata.org/wiki/Q7384151",
  ],
  "sam-altman": [
    "https://en.wikipedia.org/wiki/Sam_Altman",
    "https://www.wikidata.org/wiki/Q7407093",
  ],
  "sarah-jessica-parker": [
    "https://en.wikipedia.org/wiki/Sarah_Jessica_Parker",
    "https://www.wikidata.org/wiki/Q170530",
  ],
  "seth-godin": [
    "https://en.wikipedia.org/wiki/Seth_Godin",
    "https://www.wikidata.org/wiki/Q439396",
  ],
  "steve-jobs": [
    "https://en.wikipedia.org/wiki/Steve_Jobs",
    "https://www.wikidata.org/wiki/Q19837",
  ],
  "stewart-brand": [
    "https://en.wikipedia.org/wiki/Stewart_Brand",
    "https://www.wikidata.org/wiki/Q971994",
  ],
  "tim-ferriss": [
    "https://en.wikipedia.org/wiki/Tim_Ferriss",
    "https://www.wikidata.org/wiki/Q563672",
  ],
  "vinod-khosla": [
    "https://en.wikipedia.org/wiki/Vinod_Khosla",
    "https://www.wikidata.org/wiki/Q738005",
  ],
  "warren-buffett": [
    "https://en.wikipedia.org/wiki/Warren_Buffett",
    "https://www.wikidata.org/wiki/Q47213",
  ],
};

/** sameAs URLs for a person slug, or an empty array when unverified. */
export function sameAsFor(slug: string | null | undefined): string[] {
  if (!slug) return [];
  return PERSON_SAME_AS[slug] ?? [];
}

/**
 * Book authors who also have a profile here, keyed by normalised name.
 *
 * `books.author_slug` does not exist in the production schema (see the note on
 * the Book interface in data.ts), so a book by James Clear had no structured
 * link to /people/james-clear — the two were separate unconnected names to a
 * crawler. This closes that edge, which is the whole point of an entity graph:
 * Book -> Person -> Wikidata, rather than three isolated mentions.
 *
 * Only names that matched a PUBLISHED person exactly are listed. Regenerate
 * when books or people are published; a stale entry here links a book to the
 * wrong profile, so treat additions with the same care as PERSON_SAME_AS.
 */
const AUTHOR_TO_PERSON: Record<string, string> = {
  "adam grant": "adam-grant",
  "charlie munger": "charlie-munger",
  "james clear": "james-clear",
  "malcolm gladwell": "malcolm-gladwell",
  "peter thiel": "peter-thiel",
  "ray dalio": "ray-dalio",
};

function normalizeName(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Person slug for a book's author display name, when they have a profile. */
export function personSlugForAuthor(authorName: string | null | undefined): string | null {
  const key = normalizeName(authorName);
  return key ? AUTHOR_TO_PERSON[key] ?? null : null;
}
