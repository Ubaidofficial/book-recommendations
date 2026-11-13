/**
 * Profession buckets for a recommender's free-text `people.role`.
 *
 * Pure and dependency-free (no imports) so it can be checked with plain node:
 *   node --experimental-strip-types scripts/selfcheck_book_v4.mjs
 *
 * Conservative on purpose. A role only lands in a named bucket when it
 * contains a clear keyword; anything else is "Other". When a role names more
 * than one profession ("Author; founder of CD Baby"), the one written first
 * wins, because people.role usually leads with the primary descriptor.
 */

export type RoleBucket =
  | "founders"
  | "investors"
  | "writers"
  | "scientists"
  | "media"
  | "politics"
  | "other";

export const ROLE_BUCKET_LABELS: Record<RoleBucket, string> = {
  founders: "Founders & executives",
  investors: "Investors",
  writers: "Writers & journalists",
  scientists: "Scientists & academics",
  media: "Broadcasters, actors & athletes",
  politics: "Politicians & public servants",
  other: "Other",
};

/** Display order for the bars (ties in count keep this order). */
export const ROLE_BUCKET_ORDER: RoleBucket[] = [
  "founders",
  "investors",
  "writers",
  "scientists",
  "media",
  "politics",
  "other",
];

// Keyword patterns per bucket. Matched case-insensitively on word boundaries.
// Multi-word phrases are listed so they beat a shorter keyword at the same
// position ("president of the united states" over "president").
const KEYWORDS: Record<Exclude<RoleBucket, "other">, string[]> = {
  founders: [
    "co-founder", "cofounder", "founder", "founding partner", "ceo", "chief executive",
    "chief executive officer", "cto", "coo", "cfo", "executive", "chairman", "chairwoman",
    "chairperson", "president", "entrepreneur", "businessman", "businesswoman",
    "businessperson", "business magnate", "business executive", "industrialist",
    "managing director", "head of product", "product manager",
  ],
  investors: [
    "investor", "angel investor", "venture capitalist", "venture capital", "vc",
    "hedge fund", "hedge fund manager", "fund manager", "money manager", "asset manager",
    "private equity", "trader", "value investor", "general partner",
  ],
  writers: [
    "author", "writer", "novelist", "journalist", "editor", "essayist", "poet",
    "columnist", "blogger", "reporter", "screenwriter", "playwright", "biographer",
    "editor-in-chief", "newsletter writer",
  ],
  scientists: [
    "scientist", "professor", "researcher", "physicist", "biologist", "neuroscientist",
    "psychologist", "economist", "academic", "historian", "mathematician", "philosopher",
    "chemist", "astronomer", "astrophysicist", "anthropologist", "sociologist",
    "geneticist", "computer scientist", "scholar",
  ],
  media: [
    "actor", "actress", "comedian", "broadcaster", "presenter", "television host",
    "talk show host", "radio host", "podcast host", "podcaster", "youtuber", "musician",
    "singer", "rapper", "songwriter", "athlete", "footballer", "basketball player",
    "baseball player", "football player", "tennis player", "boxer", "olympian",
    "olympic", "swimmer", "cyclist", "mixed martial artist", "film director",
    "filmmaker", "film producer", "model", "dj", "radio presenter", "tv presenter",
    "television presenter",
  ],
  politics: [
    "politician", "president of the united states", "vice president of the united states",
    "first lady", "senator", "prime minister", "minister", "governor", "mayor",
    "congressman", "congresswoman", "member of parliament", "mp", "diplomat",
    "ambassador", "secretary of state", "secretary of defense", "civil servant",
    "statesman", "stateswoman", "chancellor", "public servant", "head of state",
  ],
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// One regex per keyword, compiled once. `\b` on both sides keeps "author"
// out of "authority" and "host" out of "ghost".
const MATCHERS: Array<{ bucket: Exclude<RoleBucket, "other">; re: RegExp; len: number }> = [];
for (const bucket of Object.keys(KEYWORDS) as Array<Exclude<RoleBucket, "other">>) {
  for (const kw of KEYWORDS[bucket]) {
    MATCHERS.push({ bucket, re: new RegExp(`\\b${escapeRe(kw)}\\b`, "i"), len: kw.length });
  }
}

/**
 * The role with parentheticals ("(born 1967)", "(1980-)") removed, trimmed.
 * Returns "" when what is left carries no words, so a bare "(born 1966)"
 * counts as "no role on file" rather than as an unclassifiable role.
 */
export function cleanRole(role: string | null | undefined): string {
  const s = String(role || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[;,.\-–—\s]+|[;,.\-–—\s]+$/g, "");
  return (s.match(/[a-z]/gi) || []).length >= 3 ? s : "";
}

/**
 * Bucket for one role string, or null when there is no usable role at all.
 * Earliest keyword in the string wins; at the same position the longer
 * keyword wins.
 */
export function classifyRole(role: string | null | undefined): RoleBucket | null {
  const s = cleanRole(role);
  if (!s) return null;
  let best: { bucket: RoleBucket; idx: number; len: number } | null = null;
  for (const m of MATCHERS) {
    const hit = m.re.exec(s);
    if (!hit) continue;
    const idx = hit.index;
    if (!best || idx < best.idx || (idx === best.idx && m.len > best.len)) {
      best = { bucket: m.bucket, idx, len: m.len };
    }
  }
  return best ? best.bucket : "other";
}

export interface RoleBreakdown {
  /** Buckets with at least one person, largest first (ties keep ROLE_BUCKET_ORDER). */
  buckets: Array<{ bucket: RoleBucket; label: string; count: number }>;
  /** People whose role fell into a named bucket or "Other". */
  withRole: number;
  /** People with no usable role on file. */
  withoutRole: number;
  /** People in a named bucket (excludes "Other"). */
  classified: number;
}

export function breakdownRoles(roles: Array<string | null | undefined>): RoleBreakdown {
  const counts = new Map<RoleBucket, number>();
  let withoutRole = 0;
  for (const r of roles) {
    const b = classifyRole(r);
    if (!b) {
      withoutRole++;
      continue;
    }
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  const buckets = ROLE_BUCKET_ORDER.filter((b) => (counts.get(b) || 0) > 0)
    .map((b) => ({ bucket: b, label: ROLE_BUCKET_LABELS[b], count: counts.get(b) || 0 }))
    // "Other" always last; the rest by count desc, stable on display order.
    .sort((a, b) => {
      if (a.bucket === "other") return 1;
      if (b.bucket === "other") return -1;
      return b.count - a.count;
    });
  const withRole = buckets.reduce((n, b) => n + b.count, 0);
  const classified = withRole - (counts.get("other") || 0);
  return { buckets, withRole, withoutRole, classified };
}
