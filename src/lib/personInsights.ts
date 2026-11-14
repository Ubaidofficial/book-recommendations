import { unstable_cache } from "next/cache";
import { supabase as getSupabase } from "./supabase";
import { INDEXABLE_STATUSES, isIndexable } from "./seo";
import { repairEncoding } from "./dataQuality";
import { displayListTitle } from "./display";
import { seriesBaseName } from "./seriesOrder";

/**
 * Person-page depth (topics, similar shelves, shelf, FAQ) and the
 * /compare/<a>-vs-<b> pages.
 *
 * Read-only. Every query is bounded with .limit()/.range(). The inner fetchers
 * THROW on a database error so unstable_cache never stores a failure as an
 * empty answer for an hour; the exported wrappers catch, log, and return a
 * safe fallback ([] / null), so no public page ever throws because of them.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** A book on someone's shelf, with only the columns these surfaces render. */
export interface ShelfBook {
  id: string;
  slug: string;
  title: string;
  author: string;
  cover_image_url: string | null;
  recommendation_count: number;
  page_count: number | null;
  rating: number | null;
  amazon_url: string | null;
}

/** A published person and the ids of every book they recommend. */
export interface PublishedShelf {
  id: string;
  slug: string;
  name: string;
  role: string | null;
  avatar_url: string | null;
  updated_at: string | null;
  bookIds: string[];
}

export interface PersonTopic {
  slug: string;
  title: string;
  /** How many of this person's recommended books are on the list. */
  count: number;
  /** Ids of those books. Lets the person page filter its list by topic. */
  bookIds: string[];
}

export interface SimilarShelf {
  slug: string;
  name: string;
  role: string | null;
  avatar_url: string | null;
  shared: number;
  sharedBookIds: string[];
  /** True when /compare/<pair> for this pair is an indexable page. */
  comparable: boolean;
}

export interface ComparePair {
  a: string; // slug, alphabetically first
  b: string;
  shared: number;
  lastModified?: Date;
}

// ─── Tunables ────────────────────────────────────────────────────────────────

/** A compare page is indexable only when both people share at least this many books. */
export const COMPARE_MIN_SHARED = 8;
/** Similar-shelf cards need at least this many books in common. */
export const SIMILAR_MIN_SHARED = 3;
/** Pairs offered to the sitemap: both people need a shelf at least this deep. */
export const COMPARE_MIN_SHELF = 20;

/**
 * Lists left out of "What <name> reads most".
 *
 * - most-recommended-books (5.7k books), nonfiction (7.8k) and fiction (4.7k)
 *   are catch-all buckets: for Naval they hold 157, 92 and 40 of his books and
 *   would push every real topic down the ranking while saying nothing about
 *   what he reads. Any list over CATCH_ALL_MAX_BOOKS is treated the same way,
 *   so a future catch-all is dropped without a code change.
 * - books-recommended-by-* lists group books by who recommends them (a
 *   person, or a role like "investors"); they are not topics, and a person's
 *   own list would trivially rank near the top of their own page.
 */
const CATCH_ALL_LIST_SLUGS = new Set(["most-recommended-books", "nonfiction", "fiction"]);
const CATCH_ALL_MAX_BOOKS = 3000;
function isTopicCandidate(slug: string, bookCount: number | null): boolean {
  if (!slug) return false;
  if (CATCH_ALL_LIST_SLUGS.has(slug)) return false;
  if (slug.startsWith("books-recommended-by-")) return false;
  if ((bookCount || 0) > CATCH_ALL_MAX_BOOKS) return false;
  return true;
}

// PostgREST caps a response at 1,000 rows on this project; every paged loop
// below stops at PAGE_CAP pages so a runaway table can't turn into a crawl.
const PAGE = 1000;
const PAGE_CAP = 10;
// Keep `.in()` URLs short (a uuid is 36 chars).
const ID_CHUNK = 80;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─── Pair slugs ──────────────────────────────────────────────────────────────

/** Canonical pair segment: slugs in alphabetical order. */
export function comparePairSlug(slugA: string, slugB: string): string {
  const [a, b] = [slugA, slugB].sort();
  return `${a}-vs-${b}`;
}

export function comparePath(slugA: string, slugB: string): string {
  return `/compare/${comparePairSlug(slugA, slugB)}`;
}

/**
 * Every way to split "<a>-vs-<b>" into two slugs. Usually one; more only if a
 * slug itself contains "-vs-", in which case the caller tries each in turn.
 */
export function splitPairSlug(pair: string): Array<[string, string]> {
  const s = decodeURIComponent(pair || "").toLowerCase();
  const out: Array<[string, string]> = [];
  let idx = s.indexOf("-vs-");
  while (idx > 0) {
    const a = s.slice(0, idx);
    const b = s.slice(idx + 4);
    if (a && b) out.push([a, b]);
    idx = s.indexOf("-vs-", idx + 1);
  }
  return out;
}

// ─── A person's shelf ────────────────────────────────────────────────────────

const SHELF_COLUMNS =
  "id,slug,title,author_name,cover_image_url,recommendation_count,page_count,rating,amazon_url";

async function fetchPersonShelf(personId: string): Promise<ShelfBook[]> {
  const sb = getSupabase();
  const seen = new Set<string>();
  const out: ShelfBook[] = [];
  for (let page = 0; page < PAGE_CAP; page++) {
    const { data, error } = await sb
      .from("book_recommendations")
      .select(`books(${SHELF_COLUMNS})`)
      .eq("person_id", personId)
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
      .limit(PAGE);
    if (error) throw error;
    const rows = (data || []) as unknown as Array<{ books: Record<string, unknown> | null }>;
    for (const r of rows) {
      const b = r.books;
      if (!b || typeof b.id !== "string" || !b.slug || !b.title) continue;
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      out.push({
        id: b.id,
        slug: String(b.slug),
        title: repairEncoding(String(b.title)),
        author: repairEncoding(String(b.author_name || "")),
        cover_image_url: (b.cover_image_url as string) || null,
        recommendation_count: Number(b.recommendation_count) || 0,
        page_count: Number(b.page_count) > 0 ? Number(b.page_count) : null,
        rating: typeof b.rating === "number" ? b.rating : null,
        amazon_url: (b.amazon_url as string) || null,
      });
    }
    if (rows.length < PAGE) break;
  }
  out.sort(
    (x, y) => y.recommendation_count - x.recommendation_count || x.title.localeCompare(y.title),
  );
  return out;
}

/** Every book a person recommends, most-recommended (site-wide) first. */
export async function getPersonShelf(personId: string): Promise<ShelfBook[]> {
  if (!personId) return [];
  try {
    return await unstable_cache(() => fetchPersonShelf(personId), ["pi-person-shelf", personId], {
      revalidate: 300,
      tags: ["recommendations", `person:${personId}`],
    })();
  } catch (e) {
    console.error("[personInsights] getPersonShelf failed:", e);
    return [];
  }
}

// ─── A person's full library (every recommendation, with its evidence) ───────

/**
 * One recommendation with the evidence behind it, and only the book columns
 * the person page renders. `books(*)` is deliberately avoided: for a shelf of
 * ~300 it is over a megabyte of descriptions and editorial text, which does not
 * fit in a single Next data-cache entry.
 */
export interface LibraryRow {
  id: string;
  slug: string;
  title: string;
  author: string;
  cover_image_url: string | null;
  recommendation_count: number;
  page_count: number | null;
  rating: number | null;
  amazon_url: string | null;
  first_published_year: number | null;
  quote: string | null;
  source_url: string | null;
  source_name: string | null;
  confidence_score: number | null;
}

const LIBRARY_BOOK_COLUMNS = `${SHELF_COLUMNS},first_published_year`;

async function fetchPersonLibrary(personId: string): Promise<LibraryRow[]> {
  const sb = getSupabase();
  const seen = new Set<string>();
  const out: LibraryRow[] = [];
  for (let page = 0; page < PAGE_CAP; page++) {
    const { data, error } = await sb
      .from("book_recommendations")
      .select(`quote,source_url,source_name,confidence_score,books(${LIBRARY_BOOK_COLUMNS})`)
      .eq("person_id", personId)
      // Best-evidenced first; id breaks ties so pages never overlap or skip.
      .order("confidence_score", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
      .limit(PAGE);
    if (error) throw error;
    const rows = (data || []) as unknown as Array<{
      quote: string | null;
      source_url: string | null;
      source_name: string | null;
      confidence_score: number | null;
      books: Record<string, unknown> | null;
    }>;
    for (const r of rows) {
      const b = r.books;
      if (!b || typeof b.id !== "string" || !b.slug || !b.title) continue;
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      out.push({
        id: b.id,
        slug: String(b.slug),
        title: repairEncoding(String(b.title)),
        author: repairEncoding(String(b.author_name || "")),
        cover_image_url: (b.cover_image_url as string) || null,
        recommendation_count: Number(b.recommendation_count) || 0,
        page_count: Number(b.page_count) > 0 ? Number(b.page_count) : null,
        rating: typeof b.rating === "number" ? b.rating : null,
        amazon_url: (b.amazon_url as string) || null,
        first_published_year: Number(b.first_published_year) > 0 ? Number(b.first_published_year) : null,
        quote: r.quote,
        source_url: r.source_url,
        source_name: r.source_name,
        confidence_score: r.confidence_score,
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Every recommendation a person has, best-evidenced first. The person page
 * used to read the first 24, so a profile with 200 books showed 24 of them
 * with no way to reach the rest. Never throws; [] on failure.
 */
export async function getPersonLibrary(personId: string): Promise<LibraryRow[]> {
  if (!personId) return [];
  try {
    return await unstable_cache(() => fetchPersonLibrary(personId), ["pi-person-library", personId], {
      revalidate: 300,
      tags: ["recommendations", `person:${personId}`],
    })();
  } catch (e) {
    console.error("[personInsights] getPersonLibrary failed:", e);
    return [];
  }
}

// ─── Published shelves (the basis for overlap) ───────────────────────────────

async function fetchPublishedShelves(): Promise<PublishedShelf[]> {
  const sb = getSupabase();
  const { data: people, error } = await sb
    .from("people")
    .select("id,slug,name,role,avatar_url,updated_at,index_status")
    .in("index_status", INDEXABLE_STATUSES)
    .not("slug", "is", null)
    .order("slug", { ascending: true })
    .limit(1000);
  if (error) throw error;
  const rows = (people || []).filter((p) => p && p.id && p.slug && p.name && isIndexable(p));
  if (rows.length === 0) return [];

  const books = new Map<string, Set<string>>(rows.map((p) => [p.id as string, new Set<string>()]));
  for (const ids of chunk(rows.map((p) => p.id as string), ID_CHUNK)) {
    for (let page = 0; page < PAGE_CAP; page++) {
      const { data, error: recErr } = await sb
        .from("book_recommendations")
        .select("person_id,book_id")
        .in("person_id", ids)
        .order("id", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1)
        .limit(PAGE);
      if (recErr) throw recErr;
      for (const r of data || []) {
        if (r.book_id) books.get(r.person_id)?.add(r.book_id);
      }
      if (!data || data.length < PAGE) break;
    }
  }

  return rows.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: repairEncoding(p.name),
    role: p.role ? repairEncoding(p.role) : null,
    avatar_url: p.avatar_url || null,
    updated_at: p.updated_at || null,
    bookIds: Array.from(books.get(p.id) || []),
  }));
}

const publishedShelvesCached = unstable_cache(fetchPublishedShelves, ["pi-published-shelves-v1"], {
  revalidate: 3600,
  tags: ["recommendations", "people"],
});

/** All published people with the ids of the books they recommend. Never throws. */
export async function getPublishedShelves(): Promise<PublishedShelf[]> {
  try {
    return await publishedShelvesCached();
  } catch (e) {
    console.error("[personInsights] getPublishedShelves failed:", e);
    return [];
  }
}

// ─── Similar shelves ─────────────────────────────────────────────────────────

/**
 * Other published people ranked by how many books they share with this one.
 * `personIsPublished` decides whether the compare page for a pair is
 * indexable (both sides must be).
 */
export async function getSimilarShelves(
  person: { id: string; slug: string; index_status?: string },
  bookIds: string[],
  limit = 8,
): Promise<SimilarShelf[]> {
  if (!person?.id || bookIds.length === 0) return [];
  const mine = new Set(bookIds);
  const shelves = await getPublishedShelves();
  const personIsPublished = isIndexable(person);
  const out: SimilarShelf[] = [];
  for (const s of shelves) {
    if (s.id === person.id || s.slug === person.slug) continue;
    const shared = s.bookIds.filter((id) => mine.has(id));
    if (shared.length < SIMILAR_MIN_SHARED) continue;
    out.push({
      slug: s.slug,
      name: s.name,
      role: s.role,
      avatar_url: s.avatar_url,
      shared: shared.length,
      sharedBookIds: shared,
      comparable:
        personIsPublished &&
        shared.length >= COMPARE_MIN_SHARED &&
        bookIds.length >= COMPARE_MIN_SHELF &&
        s.bookIds.length >= COMPARE_MIN_SHELF,
    });
  }
  out.sort((x, y) => y.shared - x.shared || x.name.localeCompare(y.name));
  return out.slice(0, limit);
}

// ─── Topics ──────────────────────────────────────────────────────────────────

async function fetchPersonTopics(personId: string, bookIds: string[]): Promise<PersonTopic[]> {
  const sb = getSupabase();
  const tally = new Map<string, { slug: string; title: string; books: Set<string> }>();
  for (const ids of chunk(bookIds, ID_CHUNK)) {
    for (let page = 0; page < PAGE_CAP; page++) {
      const { data, error } = await sb
        .from("book_lists")
        .select("book_id,list_id,lists!inner(slug,title,book_count,index_status)")
        .in("book_id", ids)
        .eq("lists.index_status", "published")
        .order("list_id", { ascending: true })
        .order("book_id", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1)
        .limit(PAGE);
      if (error) throw error;
      const rows = (data || []) as unknown as Array<{
        book_id: string;
        list_id: string;
        lists: { slug: string; title: string; book_count: number | null } | null;
      }>;
      for (const r of rows) {
        const l = r.lists;
        if (!l || !isTopicCandidate(l.slug, l.book_count)) continue;
        let t = tally.get(r.list_id);
        if (!t) {
          t = { slug: l.slug, title: displayListTitle(l.title, l.slug) || l.slug, books: new Set() };
          tally.set(r.list_id, t);
        }
        t.books.add(r.book_id);
      }
      if (rows.length < PAGE) break;
    }
  }
  void personId; // part of the cache key only
  return Array.from(tally.values())
    .map((t) => ({ slug: t.slug, title: t.title, count: t.books.size, bookIds: Array.from(t.books) }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}

/** Published topic lists this person's books appear on, ranked by book count. */
export async function getPersonTopics(
  personId: string,
  bookIds: string[],
  limit = 8,
): Promise<PersonTopic[]> {
  if (!personId || bookIds.length === 0) return [];
  try {
    const all = await unstable_cache(
      () => fetchPersonTopics(personId, bookIds),
      ["pi-person-topics-v2", personId, String(bookIds.length)],
      { revalidate: 3600, tags: ["lists", `person:${personId}`] },
    )();
    return all.slice(0, limit);
  } catch (e) {
    console.error("[personInsights] getPersonTopics failed:", e);
    return [];
  }
}

// ─── Per-book extras for the person page's list ─────────────────────────────

/** Another published person who recommends the same book. */
export interface CoRecommender {
  slug: string;
  name: string;
  avatar_url: string | null;
}

/**
 * For each of `bookIds`, the other published people who recommend it, the
 * people closest to this person first (most books in common). Built from the
 * cached published shelves, so it costs no extra database read. `people` is
 * the deduplicated list; `byBook` points into it, so a person who recommends
 * forty of these books is sent once, not forty times. Never throws.
 */
export async function getCoRecommenders(
  person: { id: string; slug: string },
  bookIds: string[],
  perBook = 3,
): Promise<{ people: CoRecommender[]; byBook: Record<string, { idx: number[]; total: number }> }> {
  const empty = { people: [], byBook: {} };
  if (!person?.id || bookIds.length === 0) return empty;
  try {
    const shelves = await getPublishedShelves();
    const mine = new Set(bookIds);
    const others = shelves
      .filter((s) => s.id !== person.id && s.slug !== person.slug)
      .map((s) => ({ s, shared: s.bookIds.filter((id) => mine.has(id)) }))
      .filter((x) => x.shared.length > 0)
      // Closest first; name keeps the order stable between renders.
      .sort((a, b) => b.shared.length - a.shared.length || a.s.name.localeCompare(b.s.name));
    const people: CoRecommender[] = [];
    const index = new Map<string, number>();
    const byBook: Record<string, { idx: number[]; total: number }> = {};
    for (const { s, shared } of others) {
      for (const bookId of shared) {
        const e = (byBook[bookId] ||= { idx: [], total: 0 });
        e.total++;
        if (e.idx.length >= perBook) continue;
        let i = index.get(s.id);
        if (i == null) {
          i = people.push({ slug: s.slug, name: s.name, avatar_url: s.avatar_url }) - 1;
          index.set(s.id, i);
        }
        e.idx.push(i);
      }
    }
    return { people, byBook };
  } catch (e) {
    console.error("[personInsights] getCoRecommenders failed:", e);
    return empty;
  }
}

/** A published series a book belongs to. */
export interface BookSeriesRef {
  slug: string;
  title: string;
  position: number | null;
}

async function fetchPersonSeries(bookIds: string[]): Promise<Record<string, BookSeriesRef>> {
  const sb = getSupabase();
  const out: Record<string, BookSeriesRef> = {};
  for (const ids of chunk(bookIds, ID_CHUNK)) {
    const { data, error } = await sb
      .from("book_series")
      .select("book_id,position,series!inner(slug,title,index_status)")
      .in("book_id", ids)
      .in("series.index_status", INDEXABLE_STATUSES)
      .order("book_id", { ascending: true })
      .limit(PAGE);
    if (error) throw error;
    const rows = (data || []) as unknown as Array<{
      book_id: string;
      position: number | null;
      series: { slug: string; title: string } | null;
    }>;
    for (const r of rows) {
      if (!r.series?.slug || !r.series.title || out[r.book_id]) continue;
      out[r.book_id] = {
        slug: r.series.slug,
        title: seriesBaseName(repairEncoding(r.series.title)),
        position: typeof r.position === "number" && r.position > 0 ? r.position : null,
      };
    }
  }
  return out;
}

/** book id → the published series it belongs to (books in none are absent). Never throws. */
export async function getPersonSeries(personId: string, bookIds: string[]): Promise<Record<string, BookSeriesRef>> {
  if (!personId || bookIds.length === 0) return {};
  try {
    return await unstable_cache(() => fetchPersonSeries(bookIds), ["pi-person-series-v2", personId, String(bookIds.length)], {
      revalidate: 3600,
      tags: ["series", `person:${personId}`],
    })();
  } catch (e) {
    console.error("[personInsights] getPersonSeries failed:", e);
    return {};
  }
}

// ─── Compare pairs ───────────────────────────────────────────────────────────

/** Pure overlap computation, exported for the compare page and the sitemap. */
export function computeComparePairs(shelves: PublishedShelf[]): ComparePair[] {
  const eligible = shelves.filter((s) => s.bookIds.length >= COMPARE_MIN_SHELF);
  const sets = eligible.map((s) => new Set(s.bookIds));
  const out: ComparePair[] = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const [small, big] =
        sets[i].size <= sets[j].size ? [sets[i], sets[j]] : [sets[j], sets[i]];
      let shared = 0;
      for (const id of small) if (big.has(id)) shared++;
      if (shared < COMPARE_MIN_SHARED) continue;
      const [x, y] = [eligible[i], eligible[j]].sort((p, q) => p.slug.localeCompare(q.slug));
      const times = [x.updated_at, y.updated_at]
        .map((t) => (t ? Date.parse(t) : NaN))
        .filter((t) => Number.isFinite(t));
      out.push({
        a: x.slug,
        b: y.slug,
        shared,
        lastModified: times.length ? new Date(Math.max(...times)) : undefined,
      });
    }
  }
  out.sort((p, q) => q.shared - p.shared || p.a.localeCompare(q.a) || p.b.localeCompare(q.b));
  return out;
}

/**
 * Every indexable /compare pair: both people published with at least
 * COMPARE_MIN_SHELF recommendations, sharing at least COMPARE_MIN_SHARED
 * books. Used by the sitemap. Never throws; [] on failure.
 */
export async function getIndexableComparePairs(): Promise<ComparePair[]> {
  try {
    return computeComparePairs(await getPublishedShelves());
  } catch (e) {
    console.error("[personInsights] getIndexableComparePairs failed:", e);
    return [];
  }
}

// ─── Small helpers shared by the UI ──────────────────────────────────────────

/**
 * "Naval" from "Naval Ravikant". Falls back to the full name when the first
 * token is an initial or honorific ("J.", "Dr."), which would read oddly.
 */
export function firstNameOf(name: string): string {
  const parts = String(name || "").trim().split(/\s+/);
  const first = parts[0] || "";
  if (parts.length < 2 || first.length <= 2 || first.endsWith(".")) return name.trim();
  return first;
}

/** Stable 32-bit string hash (FNV-1a) for deterministic spine sizes/colours. */
export function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ─── Data-driven FAQ ─────────────────────────────────────────────────────────

export interface FaqItem {
  q: string;
  a: string;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Three or four Q&As built only from numbers already on the page. Each answer
 * is omitted when its data is missing, so nothing is padded or guessed. The
 * same array feeds the visible section and the FAQPage JSON-LD, so the two
 * always match word for word.
 */
export function buildPersonFaq({
  name,
  shelf,
  topics,
  similar,
}: {
  name: string;
  shelf: ShelfBook[];
  topics: PersonTopic[];
  similar: SimilarShelf[];
}): FaqItem[] {
  const first = firstNameOf(name);
  const faq: FaqItem[] = [];
  const total = shelf.length;
  if (total > 0) {
    faq.push({
      q: `How many books has ${name} recommended?`,
      a:
        `BookMentions has ${total.toLocaleString("en-US")} ${total === 1 ? "book" : "books"} on file as recommended by ${name}, ` +
        `collected from public interviews, podcasts, posts and reading lists. ` +
        `Where we have confirmed the original source, it is linked next to the recommendation; some picks do not have a confirmed source yet.`,
    });
  }
  // recommendation_count includes this person, so "others" is one less.
  const popular = shelf.filter((b) => b.recommendation_count >= 2).slice(0, 3);
  if (popular.length > 0) {
    const parts = popular.map((b) => {
      const others = b.recommendation_count - 1;
      return `${b.title} (${others.toLocaleString("en-US")} other ${others === 1 ? "person" : "people"})`;
    });
    faq.push({
      q: `Which of ${first}’s picks do other people recommend most?`,
      a: `Of the books ${first} recommends, the ones most often recommended by others on BookMentions are ${joinList(parts)}.`,
    });
  }
  const topTopics = topics.slice(0, 4);
  if (topTopics.length > 0) {
    faq.push({
      q: `What topics does ${first} read most?`,
      a:
        `Going by the reading lists ${first}’s recommended books appear on: ` +
        `${joinList(topTopics.map((t) => `${t.title} (${t.count} ${t.count === 1 ? "book" : "books"})`))}.`,
    });
  }
  const topSimilar = similar.slice(0, 3);
  if (topSimilar.length > 0) {
    const [lead, ...rest] = topSimilar;
    let a = `${lead.name} has the most similar shelf, with ${lead.shared} books in common with ${first}`;
    if (rest.length > 0) {
      a += `, followed by ${joinList(rest.map((p) => `${p.name} (${p.shared})`))}`;
    }
    faq.push({ q: `Whose reading list is most like ${first}’s?`, a: `${a}.` });
  }
  return faq;
}
