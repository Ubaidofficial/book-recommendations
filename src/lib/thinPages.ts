/**
 * Data reads behind the thin-page floor (rules in indexing.ts).
 *
 * Every reader here fails OPEN: if the database cannot be read, the page is
 * treated as not thin and keeps whatever index_status says. Cached lookups
 * throw inside unstable_cache so a failed read is never stored as an answer.
 */
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as getSupabase } from "./supabase";
import { INDEXABLE_STATUSES, isIndexable } from "./seo";
import {
  THIN_PERSON_MIN_BOOKS,
  bookHasOwnContent,
  isThinBook,
  isThinPerson,
  personThinSignals,
  type PersonThinSignals,
} from "./indexing";

const REC_COLUMNS = "book_id, source_url, source_name, quote, confidence_score";

interface PersonRef {
  id: string;
  slug: string;
  name: string;
  twitter_handle?: string | null;
  index_status?: string;
}

interface BookRef {
  id: string;
  index_status?: string;
  description?: string | null;
  editorial_summary?: string | null;
  recommendation_count?: number | null;
}

// ── Detail pages (generateMetadata) ─────────────────────────────────────────

async function fetchPersonSignals(person: PersonRef): Promise<PersonThinSignals> {
  const { data, error } = await getSupabase()
    .from("book_recommendations")
    .select(REC_COLUMNS)
    .eq("person_id", person.id)
    .limit(200);
  if (error) throw new Error(`thin-person signals: ${error.message}`);
  return personThinSignals(person, data || []);
}

/** True only when the person page is confirmed thin. Unreadable → false. */
export async function isPersonPageThin(person: PersonRef): Promise<boolean> {
  // A page index_status already keeps out of the index needs no check.
  if (!isIndexable(person)) return false;
  try {
    const signals = await unstable_cache(
      () => fetchPersonSignals(person),
      ["thin-person-signals", person.id],
      { revalidate: 300, tags: ["recommendations", `person:${person.id}`] },
    )();
    return isThinPerson(signals);
  } catch (e) {
    console.error("[thinPages] person signals unavailable, keeping index_status:", e);
    return false;
  }
}

async function fetchBookRecommenderCount(bookId: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from("book_recommendations")
    .select("book_id", { count: "exact", head: true })
    .eq("book_id", bookId)
    .limit(1);
  if (error) throw new Error(`thin-book recommenders: ${error.message}`);
  return count || 0;
}

/** True only when the book page is confirmed thin. Unreadable → false. */
export async function isBookPageThin(book: BookRef): Promise<boolean> {
  // Most books are settled without a query: their own text or a stored
  // recommendation count already proves they are not thin.
  if (!isIndexable(book) || bookHasOwnContent(book) || (book.recommendation_count || 0) > 0) return false;
  try {
    const recommenders = await unstable_cache(
      () => fetchBookRecommenderCount(book.id),
      ["thin-book-recommenders", book.id],
      { revalidate: 300, tags: ["recommendations", `book:${book.id}`] },
    )();
    return isThinBook(book, recommenders);
  } catch (e) {
    console.error("[thinPages] book recommenders unavailable, keeping index_status:", e);
    return false;
  }
}

// ── Sitemap ─────────────────────────────────────────────────────────────────

export interface ThinSlugs {
  people: Set<string>;
  books: Set<string>;
}

const PAGE = 1000;
const MAX_PAGES = 50;

async function thinPeopleSlugs(sb: SupabaseClient): Promise<Set<string>> {
  // Published people with their recommendation-row count; only those under
  // the book threshold need their sources checked.
  const candidates: PersonRef[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await sb
      .from("people")
      .select("id, slug, name, twitter_handle, recs:book_recommendations(count)")
      .in("index_status", INDEXABLE_STATUSES)
      .not("slug", "is", null)
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`thin people: ${error.message}`);
    for (const row of (data || []) as Array<PersonRef & { recs?: Array<{ count?: number }> }>) {
      const n = Array.isArray(row.recs) && typeof row.recs[0]?.count === "number" ? row.recs[0].count : 0;
      if (n < THIN_PERSON_MIN_BOOKS) candidates.push(row);
    }
    if (!data || data.length < PAGE) break;
  }

  const thin = new Set<string>();
  // Each candidate has at most THIN_PERSON_MIN_BOOKS - 1 rows, so a chunk of
  // 100 people fits well inside one response (and the id list in one URL).
  for (let i = 0; i < candidates.length; i += 100) {
    const chunk = candidates.slice(i, i + 100);
    const { data, error } = await sb
      .from("book_recommendations")
      .select(`person_id, ${REC_COLUMNS}`)
      .in("person_id", chunk.map((p) => p.id))
      .limit(chunk.length * THIN_PERSON_MIN_BOOKS);
    if (error) throw new Error(`thin people recs: ${error.message}`);
    // A full response may be cut short; judge nobody on partial rows.
    if ((data || []).length >= chunk.length * THIN_PERSON_MIN_BOOKS) continue;
    const byPerson = new Map<string, Array<Record<string, unknown>>>();
    for (const r of (data || []) as Array<Record<string, unknown>>) {
      const id = String(r.person_id);
      byPerson.set(id, [...(byPerson.get(id) || []), r]);
    }
    for (const p of chunk) {
      if (isThinPerson(personThinSignals(p, byPerson.get(p.id) || []))) thin.add(p.slug);
    }
  }
  return thin;
}

async function thinBookSlugs(sb: SupabaseClient): Promise<Set<string>> {
  // Only books with no stored recommendation count can be thin; of those,
  // only the ones without their own text need a recommender check.
  const candidates: Array<BookRef & { slug: string }> = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await sb
      .from("books")
      .select("id, slug, description, editorial_summary, recommendation_count")
      .in("index_status", INDEXABLE_STATUSES)
      .or("recommendation_count.is.null,recommendation_count.eq.0")
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`thin books: ${error.message}`);
    for (const b of (data || []) as Array<BookRef & { slug: string }>) {
      if (b.slug && !bookHasOwnContent(b)) candidates.push(b);
    }
    if (!data || data.length < PAGE) break;
  }

  const thin = new Set<string>();
  for (let i = 0; i < candidates.length; i += 100) {
    const chunk = candidates.slice(i, i + 100);
    const { data, error } = await sb
      .from("book_recommendations")
      .select("book_id")
      .in("book_id", chunk.map((b) => b.id))
      .limit(PAGE);
    if (error) throw new Error(`thin book recs: ${error.message}`);
    // A full response may be cut short; judge nobody on partial rows.
    if ((data || []).length >= PAGE) continue;
    const recommended = new Set(((data || []) as Array<{ book_id: string }>).map((r) => r.book_id));
    for (const b of chunk) {
      if (isThinBook(b, recommended.has(b.id) ? 1 : 0)) thin.add(b.slug);
    }
  }
  return thin;
}

/**
 * Slugs of published person/book pages that fall under the thin-page floor,
 * for the sitemap to leave out. Any read error → empty sets (nothing removed).
 */
export async function getThinDetailSlugs(sb: SupabaseClient): Promise<ThinSlugs> {
  const [people, books] = await Promise.all([
    thinPeopleSlugs(sb).catch((e) => {
      console.error("[thinPages] sitemap people check failed, excluding none:", e);
      return new Set<string>();
    }),
    thinBookSlugs(sb).catch((e) => {
      console.error("[thinPages] sitemap books check failed, excluding none:", e);
      return new Set<string>();
    }),
  ]);
  return { people, books };
}
