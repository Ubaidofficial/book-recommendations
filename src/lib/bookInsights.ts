import { unstable_cache } from "next/cache";
import { supabase as getSupabase } from "./supabase";
import {
  getProofDisplaySafety,
  isProfilelessSurnameAlias,
  isProbablyValidBookTitle,
  isValidHttpUrl,
  parseSourceUrls,
  repairEncoding,
  sameWork,
} from "./dataQuality";
import { breakdownRoles, type RoleBreakdown } from "./roles";
import { classifySource, type SourceKind } from "./sourceKind";

/**
 * Book page v4 insights: who said it and where, who recommends it by
 * profession, the least-alike pair of recommenders, and what the same people
 * read next. Everything is computed in JS from bounded fetches:
 *
 *   1. this book's recommendation rows with the recommender (≤ 300 rows)
 *   2. the shelves of up to 120 of those recommenders (≤ 6 pages × 1,000 rows)
 *   3. the top 40 co-recommended books (≤ 40 rows)
 *
 * The cached function throws on any query error so a failure is never cached;
 * getBookInsights() catches it and returns EMPTY_INSIGHTS so the page still
 * renders (sections hide themselves when their data is empty).
 */

export interface EvidenceRow {
  slug: string;
  name: string;
  role: string | null;
  avatar_url: string | null;
  url: string;
  kind: SourceKind;
  label: string;
  own: boolean;
  note: string | null;
  /** Gate-approved, display-cleaned quote; null when the gate hides it. */
  quote: string | null;
}

export interface UnconfirmedRecommender {
  slug: string;
  name: string;
}

export interface PairPerson {
  slug: string;
  name: string;
  avatar_url: string | null;
  shelf: number;
}

export interface UnlikelyPair {
  a: PairPerson;
  b: PairPerson;
  /** Books both recommend, this one included. */
  shared: number;
}

export interface ReadNextBook {
  id: string;
  slug: string;
  title: string;
  author: string;
  cover_image_url: string;
  /** Recommenders of this book who also recommend that one. */
  shared: number;
}

export interface BookInsights {
  /** Recommenders whose source passed getProofDisplaySafety, strongest first. */
  confirmed: EvidenceRow[];
  /** Recommenders with no source that passes the gate. Never linked out. */
  unconfirmed: UnconfirmedRecommender[];
  roles: RoleBreakdown | null;
  unlikelyPair: UnlikelyPair | null;
  readNext: ReadNextBook[];
}

export const EMPTY_INSIGHTS: BookInsights = {
  confirmed: [],
  unconfirmed: [],
  roles: null,
  unlikelyPair: null,
  readNext: [],
};

const REC_ROW_LIMIT = 300;
const SHELF_PEOPLE_CAP = 120;
const SHELF_PAGE = 1000;
const SHELF_MAX_PAGES = 6;
const PAIR_MIN_SHELF = 15;
const PAIR_CANDIDATES = 12;
const READ_NEXT_CANDIDATES = 40;

type PersonRow = {
  id: string | null;
  slug: string | null;
  name: string | null;
  role: string | null;
  bio: string | null;
  avatar_url: string | null;
  twitter_handle: string | null;
  index_status: string | null;
};

type RecRow = {
  source_url: string | null;
  source_name: string | null;
  quote: string | null;
  confidence_score: number | null;
  people: PersonRow | null;
};

interface Recommender {
  id: string;
  slug: string;
  name: string;
  role: string | null;
  avatar_url: string | null;
  published: boolean;
  rows: RecRow[];
}

function isBadSlug(s: string): boolean {
  return !s || s === "undefined" || s === "null";
}

/** Distinct, non-alias recommenders of the book, with all their rows for it. */
function groupRecommenders(rows: RecRow[]): Recommender[] {
  const byId = new Map<string, Recommender>();
  for (const r of rows) {
    const p = r.people;
    if (!p || !p.id) continue;
    const slug = (p.slug || "").trim();
    const name = repairEncoding(p.name).trim();
    if (isBadSlug(slug) || !name) continue;
    // Bare-surname stubs ("Ek", "Kloss") duplicate a full-name person and
    // would be counted twice; the face grid and proof drawer drop them too.
    if (isProfilelessSurnameAlias({ name, role: p.role, bio: p.bio, avatar_url: p.avatar_url })) continue;
    let rec = byId.get(p.id);
    if (!rec) {
      rec = {
        id: p.id,
        slug,
        name,
        role: p.role ? repairEncoding(p.role) : null,
        avatar_url: isValidHttpUrl(p.avatar_url) ? p.avatar_url : null,
        published: (p.index_status || "").toLowerCase() === "published",
        rows: [],
      };
      byId.set(p.id, rec);
    }
    rec.rows.push(r);
  }
  return Array.from(byId.values());
}

/** Best gate-approved source for one recommender, or null. */
function evidenceFor(rec: Recommender, twitterHandle: string | null): EvidenceRow | null {
  let best: EvidenceRow | null = null;
  for (const r of rec.rows) {
    const safety = getProofDisplaySafety(
      { quote: r.quote, source_url: r.source_url, source_name: r.source_name, confidence_score: r.confidence_score },
      { slug: rec.slug, name: rec.name, twitter_handle: twitterHandle },
    );
    if (!safety.showSource) continue;
    const url = parseSourceUrls(r.source_url)[0];
    if (!url) continue;
    const cls = classifySource(url, { slug: rec.slug, name: rec.name, twitter_handle: twitterHandle });
    const row: EvidenceRow = {
      slug: rec.slug,
      name: rec.name,
      role: rec.role,
      avatar_url: rec.avatar_url,
      url,
      kind: cls.kind,
      label: cls.label,
      own: cls.own,
      note: cls.note,
      quote: safety.showQuote ? safety.displayQuote : null,
    };
    if (!best || evidenceScore(row) > evidenceScore(best)) best = row;
  }
  return best;
}

function evidenceScore(e: EvidenceRow): number {
  return (e.quote ? 4 : 0) + (e.own ? 2 : 0) + (e.kind === "other" ? 0 : 1);
}

/**
 * Every book each person recommends, paged and bounded. Pages are ordered by
 * person, so if the cap is hit only the last person in the order can be
 * incomplete; that person is reported in `partial` and left out of anything
 * that needs exact shelf sizes.
 */
async function fetchShelves(personIds: string[]): Promise<{ shelves: Map<string, Set<string>>; partial: string | null }> {
  const shelves = new Map<string, Set<string>>();
  let partial: string | null = null;
  if (personIds.length === 0) return { shelves, partial };
  const supa = getSupabase();
  let lastPerson: string | null = null;
  for (let page = 0; page < SHELF_MAX_PAGES; page++) {
    const from = page * SHELF_PAGE;
    const { data, error } = await supa
      .from("book_recommendations")
      .select("person_id, book_id")
      .in("person_id", personIds)
      .order("person_id", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + SHELF_PAGE - 1)
      .limit(SHELF_PAGE);
    if (error) throw error;
    const rows = (data || []) as Array<{ person_id: string | null; book_id: string | null }>;
    for (const r of rows) {
      if (!r.person_id || !r.book_id) continue;
      let s = shelves.get(r.person_id);
      if (!s) shelves.set(r.person_id, (s = new Set()));
      s.add(r.book_id);
      lastPerson = r.person_id;
    }
    if (rows.length < SHELF_PAGE) return { shelves, partial: null };
  }
  partial = lastPerson;
  return { shelves, partial };
}

function unlikelyPairFrom(
  recs: Recommender[],
  shelves: Map<string, Set<string>>,
  partial: string | null,
): UnlikelyPair | null {
  const candidates = recs
    .filter((r) => r.published && r.id !== partial)
    .map((r) => ({ r, shelf: shelves.get(r.id) }))
    .filter((x): x is { r: Recommender; shelf: Set<string> } => !!x.shelf && x.shelf.size >= PAIR_MIN_SHELF)
    .sort((a, b) => b.shelf.size - a.shelf.size || a.r.name.localeCompare(b.r.name))
    .slice(0, PAIR_CANDIDATES);
  let best: { i: number; j: number; jac: number; shared: number } | null = null;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const A = candidates[i].shelf;
      const B = candidates[j].shelf;
      const [small, large] = A.size <= B.size ? [A, B] : [B, A];
      let shared = 0;
      for (const id of small) if (large.has(id)) shared++;
      const jac = shared / (A.size + B.size - shared);
      // Lowest overlap wins; on a tie, the pair with more picks between them
      // makes the stronger statement.
      if (
        !best ||
        jac < best.jac - 1e-12 ||
        (Math.abs(jac - best.jac) <= 1e-12 &&
          A.size + B.size > candidates[best.i].shelf.size + candidates[best.j].shelf.size)
      ) {
        best = { i, j, jac, shared };
      }
    }
  }
  if (!best || best.shared < 1) return null;
  const toPerson = (x: { r: Recommender; shelf: Set<string> }): PairPerson => ({
    slug: x.r.slug,
    name: x.r.name,
    avatar_url: x.r.avatar_url,
    shelf: x.shelf.size,
  });
  return { a: toPerson(candidates[best.i]), b: toPerson(candidates[best.j]), shared: best.shared };
}

async function readNextFrom(
  bookId: string,
  bookTitle: string,
  recs: Recommender[],
  shelves: Map<string, Set<string>>,
): Promise<ReadNextBook[]> {
  const co = new Map<string, number>();
  for (const r of recs) {
    const s = shelves.get(r.id);
    if (!s) continue;
    for (const id of s) if (id !== bookId) co.set(id, (co.get(id) || 0) + 1);
  }
  const top = Array.from(co.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, READ_NEXT_CANDIDATES);
  if (top.length === 0) return [];
  const { data, error } = await getSupabase()
    .from("books")
    .select("id, slug, title, author_name, cover_image_url")
    .in("id", top.map(([id]) => id))
    .limit(READ_NEXT_CANDIDATES);
  if (error) throw error;
  type B = { id: string; slug: string | null; title: string | null; author_name: string | null; cover_image_url: string | null };
  const byId = new Map(((data || []) as B[]).map((b) => [b.id, b]));
  const out: ReadNextBook[] = [];
  for (const [id, shared] of top) {
    const b = byId.get(id);
    if (!b || !b.slug || isBadSlug(b.slug.trim())) continue;
    if (!isProbablyValidBookTitle(b.title) || !isValidHttpUrl(b.cover_image_url)) continue;
    const title = String(b.title).trim();
    // Another edition of this same book is not a "next" read; nor is a
    // second edition of something already picked.
    if (sameWork(title, bookTitle)) continue;
    if (out.some((o) => sameWork(o.title, title))) continue;
    out.push({
      id,
      slug: b.slug.trim(),
      title,
      author: (b.author_name || "").trim(),
      cover_image_url: b.cover_image_url as string,
      shared,
    });
    if (out.length >= 6) break;
  }
  return out;
}

async function computeBookInsights(bookId: string, bookTitle: string): Promise<BookInsights> {
  const { data, error } = await getSupabase()
    .from("book_recommendations")
    .select(
      "source_url, source_name, quote, confidence_score, people(id, slug, name, role, bio, avatar_url, twitter_handle, index_status)",
    )
    .eq("book_id", bookId)
    .order("confidence_score", { ascending: false, nullsFirst: false })
    .limit(REC_ROW_LIMIT);
  if (error) throw error;
  const rows = (data || []) as unknown as RecRow[];
  const recs = groupRecommenders(rows);
  if (recs.length === 0) return EMPTY_INSIGHTS;

  const handleById = new Map<string, string | null>();
  for (const r of rows) if (r.people?.id) handleById.set(r.people.id, r.people.twitter_handle);

  // Who said it, and where.
  const confirmed: EvidenceRow[] = [];
  const unconfirmed: UnconfirmedRecommender[] = [];
  for (const rec of recs) {
    const ev = evidenceFor(rec, handleById.get(rec.id) ?? null);
    if (ev) confirmed.push(ev);
    else unconfirmed.push({ slug: rec.slug, name: rec.name });
  }
  const publishedSlugs = new Set(recs.filter((r) => r.published).map((r) => r.slug));
  confirmed.sort(
    (a, b) =>
      evidenceScore(b) - evidenceScore(a) ||
      Number(publishedSlugs.has(b.slug)) - Number(publishedSlugs.has(a.slug)) ||
      a.name.localeCompare(b.name),
  );
  unconfirmed.sort(
    (a, b) => Number(publishedSlugs.has(b.slug)) - Number(publishedSlugs.has(a.slug)) || a.name.localeCompare(b.name),
  );

  // Who recommends it, by profession.
  const roles = breakdownRoles(recs.map((r) => r.role));

  // Shelves of the recommenders: published people first (the pair needs
  // them), then the rest, capped.
  const shelfPeople = [...recs]
    .sort((a, b) => Number(b.published) - Number(a.published))
    .slice(0, SHELF_PEOPLE_CAP);
  const { shelves, partial } = await fetchShelves(shelfPeople.map((r) => r.id));

  const unlikelyPair = unlikelyPairFrom(recs, shelves, partial);
  const readNext = await readNextFrom(bookId, bookTitle, shelfPeople, shelves);

  return { confirmed, unconfirmed, roles, unlikelyPair, readNext };
}

const getBookInsightsCached = (bookId: string, bookTitle: string) =>
  unstable_cache(() => computeBookInsights(bookId, bookTitle), ["book-insights-v4", bookId], {
    revalidate: 900,
    tags: ["recommendations", `book:${bookId}`],
  })();

/** Never throws. On any query failure, logs and returns EMPTY_INSIGHTS (not cached). */
export async function getBookInsights(bookId: string, bookTitle: string): Promise<BookInsights> {
  if (!bookId) return EMPTY_INSIGHTS;
  try {
    return await getBookInsightsCached(bookId, bookTitle);
  } catch (e) {
    console.error("[bookInsights] getBookInsights failed:", e);
    return EMPTY_INSIGHTS;
  }
}
