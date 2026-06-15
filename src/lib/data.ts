import { supabase as getSupabase } from "./supabase";
import { isProfilelessSurnameAlias } from "./dataQuality";

// --- Types (matched to actual Supabase schema) ---

export interface Book {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  // SCHEMA NOTE: production `books` table stores the display author in
  // `author_name` (NOT `author`). Direct PostgREST `select("author")` fails
  // with `column books.author does not exist`. `select("*")` returns
  // `author_name` and leaves `book.author` undefined. We normalize at the
  // data-layer edge: every fetch helper here pipes rows through
  // `normalizeBookRow` which fills `book.author` from `book.author_name`
  // so the rest of the app (BookCard, detail page, search filter, jsonld)
  // can keep reading `book.author`. `author_slug` is not in the schema
  // either — pages that link via `/people/${book.author_slug}` will produce
  // dead links and are guarded on truthiness; deferred to a coordinated
  // people-relations cleanup.
  author: string;
  author_name?: string | null;       // canonical column name from the DB
  author_slug: string;
  cover_image_url: string;
  amazon_url?: string | null;
  page_count?: number | null;
  description: string;
  rating: number;
  recommendation_count: number;
  series: string | null;
  series_slug: string | null;
  index_status: string;
  meta_title: string | null;
  meta_description: string | null;
  created_at: string;
  // AI editorial fields — present in the production schema since the editorial pipeline.
  // `select("*")` already returns them; declaring here lets the UI render without casts.
  editorial_summary?: string | null;
  best_for?: string | null;          // pipe-joined items
  not_for?: string | null;           // pipe-joined items
  key_themes?: string[] | string | null;  // text[] in DB; tolerate string for safety
  difficulty_level?: string | null;
  recommendation_context?: string | null;
  source_quality_note?: string | null;
  ai_generated_at?: string | null;
  ai_quality_status?: string | null;  // 'pending' | 'draft' | 'needs_review' | 'approved' | 'rejected'
}

export interface Person {
  id: string;
  slug: string;
  name: string;
  role: string;
  bio: string;
  avatar_url: string;
  source_url: string | null;
  quality_score: number;
  index_status: string;
  meta_title: string | null;
  meta_description: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  // Wikimedia Commons attribution metadata — added in the
  // people_avatar_attribution_schema migration. All nullable text;
  // populated only when avatar_url is sourced from a Commons file that
  // requires (or benefits from) credit. Render code shows a compact
  // micro-credit line below the avatar circle only when any of these
  // fields is non-empty.
  avatar_source_url?: string | null;
  avatar_license?: string | null;
  avatar_attribution?: string | null;
  avatar_author?: string | null;
}

export interface BookList {
  id: string;
  slug: string;
  title: string;
  description: string;
  book_count: number;
  curator: string | null;
  index_status: string;
  created_at: string;
}

export interface RecommendationProof {
  person: Person;
  source_url: string | null;
  source_name: string | null;
  quote: string | null;
  confidence_score: number | null;
}

export interface Series {
  id: string;
  slug: string;
  title: string;
  description: string;
  book_count: number;
  index_status: string;
  created_at: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// --- Safe query helper ---
// Catches Supabase errors and returns a fallback so no public page ever throws.
function logQueryError(label: string, error: unknown) {
  console.error(`[data] Supabase error in ${label}:`, error);
}

// --- Row normalization ---
// Production `books` carries `author_name` but the rest of the codebase reads
// `book.author`. We fill `book.author` from `book.author_name` at the data-layer
// edge so consumers don't need to know about the discrepancy. Idempotent; if
// `author` is already set we leave it. Applied to every fetch helper below.
function normalizeBookRow<T extends Partial<Book>>(row: T | null | undefined): T | null {
  if (!row) return null;
  const r = row as Record<string, unknown>;
  if ((!r.author || (typeof r.author === "string" && !r.author.trim())) && typeof r.author_name === "string" && r.author_name.trim()) {
    r.author = r.author_name;
  }
  return row;
}
function normalizeBookRows<T extends Partial<Book>>(rows: T[] | null | undefined): T[] {
  if (!rows) return [];
  for (const r of rows) normalizeBookRow(r);
  return rows;
}

// Card-only column projection for listing pages. Drops description, editorial,
// meta, and AI fields that BookCard never renders — reduces per-row payload ~80%.
const BOOK_CARD_COLUMNS = "id,slug,title,author_name,cover_image_url,rating,recommendation_count";

// Numeric-artifact title detector. Production has rows like `1916.0`, `24.0`,
// `2001.0` — year+`.0` leakage from the scraper that produced bad titles. These
// are never useful in a recommendation context.
const NUMERIC_TITLE_ARTIFACT = /^\s*\d{1,5}(\.\d+)?\s*$/;
function isNumericTitleArtifact(t: string | null | undefined): boolean {
  return !!t && NUMERIC_TITLE_ARTIFACT.test(t);
}

// --- Books ---

/**
 * Paginated all-books browse.
 *
 * `scope='curated'` (default) — filter out numeric-title artifacts; recommendation_count is not reliable enough yet for production gating. Roughly ~9,148 / 98,845 today. This is the
 *   default for /books because this is a recommendation site: numeric-title artifacts are a poor starting page; recommendation_count backfill is handled separately. Numeric-only title artifacts (`1916.0`, `24.0` etc.) are
 *   filtered out client-side after fetch.
 * `scope='all'` — full 98,845-row catalogue, no quality filter. Opt-in via
 *   /books?scope=all when someone wants to see everything (e.g. data-quality
 *   triage).
 */
export async function getBooksPaginated(
  page = 1,
  pageSize = 24,
  sort: "recommendation_count" | "rating" | "title" = "recommendation_count",
  scope: "curated" | "all" = "curated"
): Promise<PaginatedResult<Book>> {
  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const col = sort === "title" ? "title" : sort;
    const asc = sort === "title";

    // Build the query as a closure so a retry can construct a fresh builder
    // (PostgrestFilterBuilder state may otherwise be consumed by the awaited
    // first attempt). Identical filters / range / sort on each attempt.
    const runQuery = () => {
      let q = getSupabase()
        .from("books")
        .select(BOOK_CARD_COLUMNS, { count: "estimated" })
        .order(col, { ascending: asc, nullsFirst: false });
      if (scope === "curated") {
        q = q;
      }
      return q.range(from, to);
    };

    // Attempt the primary query first.
    let data: any[] | null = null;
    let count: number | null = null;
    let error: any = null;

    const firstAttempt = await runQuery();
    data = firstAttempt.data;
    count = firstAttempt.count;
    error = firstAttempt.error;

    if (error) {
      logQueryError("getBooksPaginated (attempt 1/3)", error);
    }

    // If the first query failed with an error, or if it succeeded but returned a suspicious
    // empty result for the curated default landing page (page 1), perform retries with backoff.
    if (
      error ||
      (scope === "curated" &&
        page === 1 &&
        (!data || data.length === 0) &&
        (!count || count === 0))
    ) {
      console.warn("getBooksPaginated error or suspicious empty result; retrying with backoff");
      const backoffsMs = [250, 750];
      for (const ms of backoffsMs) {
        await new Promise((resolve) => setTimeout(resolve, ms));
        const r = await runQuery();
        if (r.error) {
          logQueryError(`getBooksPaginated retry (${ms}ms) error`, r.error);
          error = r.error;
          continue;
        }
        if (r.data && r.data.length > 0) {
          data = r.data;
          count = r.count;
          error = null;
          break;
        }
      }
    }

    // Last-ditch fallback: if we still have no data (due to persistent errors or empty results),
    // try a count-less query. dropping the COUNT(*) clause removes the slowest part of the query
    // and is highly likely to succeed even when the DB/connection is warming up.
    if (!data || data.length === 0) {
      console.warn("getBooksPaginated all primary queries failed or empty; trying count-less fallback");
      let fb = getSupabase()
        .from("books")
        .select(BOOK_CARD_COLUMNS)
        .order(col, { ascending: asc, nullsFirst: false });
      if (scope === "curated") {
        fb = fb;
      }
      const fbRes = await fb.range(from, to);
      if (!fbRes.error && fbRes.data && fbRes.data.length > 0) {
        data = fbRes.data;
        // Without an exact count, set total to the number of rows we actually got
        // so the page renders cards (instead of the empty state) and the Next button
        // is hidden for this single request. A subsequent request will get the real count.
        count = fbRes.data.length;
        error = null;
      } else if (fbRes.error) {
        logQueryError("getBooksPaginated (count-less fallback error)", fbRes.error);
      }
    }

    let rows = (data || []) as Book[];
    // Drop numeric-artifact titles from the curated default (cheap client-side
    // post-filter; production has only a handful and our window is 48 rows).
    if (scope === "curated") {
      rows = rows.filter((b) => !isNumericTitleArtifact(b.title));
    }
    return { data: normalizeBookRows(rows), total: count || 0, page, pageSize };
  } catch (e) {
    logQueryError("getBooksPaginated", e);
    return { data: [], total: 0, page, pageSize };
  }
}

export async function getFeaturedBooks(count = 6): Promise<Book[]> {
  try {
    const result = await getBooksPaginated(1, count, "recommendation_count", "curated");
    return result.data.slice(0, count);
  } catch (e) {
    logQueryError("getFeaturedBooks", e);
    return [];
  }
}

export async function getBookBySlug(slug: string): Promise<Book | null> {
  try {
    const { data, error } = await getSupabase()
      .from("books")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error) { logQueryError("getBookBySlug", error); return null; }
    return normalizeBookRow(data as Book | null);
  } catch (e) {
    logQueryError("getBookBySlug", e);
    return null;
  }
}

export async function getBooksByAuthor(personId: string, limit = 12): Promise<Book[]> {
  try {
    const { data: rows, error } = await getSupabase()
      .from("book_authors")
      .select("books(*)")
      .eq("person_id", personId)
      .limit(limit);

    if (error) { logQueryError("getBooksByAuthor", error); return []; }
    return normalizeBookRows((rows || []).map((r: { books: unknown }) => r.books as Book).filter((b: Book) => b != null && b.id));
  } catch (e) {
    logQueryError("getBooksByAuthor", e);
    return [];
  }
}

export async function getBooksBySeries(seriesId: string, limit = 48): Promise<Book[]> {
  try {
    const { data: rows, error } = await getSupabase()
      .from("book_series")
      .select("books(*)")
      .eq("series_id", seriesId)
      .order("position", { ascending: true })
      .limit(limit);

    if (error) { logQueryError("getBooksBySeries", error); return []; }
    return normalizeBookRows((rows || []).map((r: { books: unknown }) => r.books as Book).filter((b: Book) => b != null && b.id));
  } catch (e) {
    logQueryError("getBooksBySeries", e);
    return [];
  }
}

export async function getRelatedBooks(
  bookId: string,
  limit = 4
): Promise<Book[]> {
  try {
    const { data, error } = await getSupabase()
      .from("books")
      .select("*")
      .neq("id", bookId)
      .order("recommendation_count", { ascending: false })
      .limit(limit);

    if (error) { logQueryError("getRelatedBooks", error); return []; }
    return normalizeBookRows((data || []) as Book[]);
  } catch (e) {
    logQueryError("getRelatedBooks", e);
    return [];
  }
}

/**
 * Similar books via list/topic co-membership.
 *
 * Two-step pattern (same shape that already works for getBooksForList and
 * getRelatedLists): (1) collect every list_id this book belongs to; (2) find
 * other books that share at least one of those lists. Rank by shared-list count
 * (more co-memberships = more topical overlap), tiebreak by recommendation_count.
 *
 * No schema change, no AI. Frontend-only consumer is the book detail page's
 * "Similar books" section.
 */
export async function getSimilarBooksByLists(bookId: string, limit = 8): Promise<Book[]> {
  try {
    const supa = getSupabase();

    // Step 1: this book's list memberships.
    const { data: myLinks, error: linkErr } = await supa
      .from("book_lists")
      .select("list_id")
      .eq("book_id", bookId)
      .limit(200);
    if (linkErr) { logQueryError("getSimilarBooksByLists[my-links]", linkErr); return []; }
    const listIds = (myLinks || [])
      .map((r: { list_id: string | null }) => r.list_id)
      .filter((x): x is string => !!x);
    if (listIds.length === 0) return [];

    // Step 2: other books in those same lists (excludes this book).
    const { data: coLinks, error: coErr } = await supa
      .from("book_lists")
      .select("book_id, list_id")
      .in("list_id", listIds)
      .neq("book_id", bookId)
      .limit(5000);
    if (coErr) { logQueryError("getSimilarBooksByLists[co-links]", coErr); return []; }

    // Step 3: count shared-list memberships per other book.
    const sharedCount = new Map<string, number>();
    for (const r of (coLinks || []) as Array<{ book_id: string | null }>) {
      if (!r.book_id) continue;
      sharedCount.set(r.book_id, (sharedCount.get(r.book_id) || 0) + 1);
    }
    if (sharedCount.size === 0) return [];

    // Step 4: top candidates by shared-list count (overfetch then refine with rec_count tiebreak).
    const topCandidateIds = Array.from(sharedCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit * 3)
      .map(([id]) => id);

    const { data: books, error: bookErr } = await supa
      .from("books")
      .select("*")
      .in("id", topCandidateIds);
    if (bookErr) { logQueryError("getSimilarBooksByLists[books]", bookErr); return []; }

    // Rank candidates by quality tier, then within tier by shared-list count
    // and rec_count. Tier order: (1) drafts with cover, (2) has-cover + rec>0,
    // (3) has-cover, (4) anything else (no cover). Numeric-artifact titles are
    // dropped outright. The fallback (tier 4) only contributes if higher tiers
    // can't fill the limit — so Endurance won't show no-cover junk next to
    // proper recs unless the topical pool really is that thin.
    type Enriched = { b: Book; shared: number; tier: number };
    const enriched: Enriched[] = ((books || []) as Book[])
      .filter((b) => b != null && !!b.id)
      .filter((b) => !isNumericTitleArtifact(b.title))
      .map((b) => {
        const hasCover = !!b.cover_image_url && /^https?:\/\//.test(b.cover_image_url);
        const isDraft = (b.ai_quality_status || "").toLowerCase() === "draft";
        const hasRec = typeof b.recommendation_count === "number" && b.recommendation_count > 0;
        let tier = 4;
        if (hasCover && isDraft) tier = 1;
        else if (hasCover && hasRec) tier = 2;
        else if (hasCover) tier = 3;
        return { b, shared: sharedCount.get(b.id) || 0, tier };
      });

    enriched.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;       // lower tier wins
      if (a.shared !== b.shared) return b.shared - a.shared;
      const ra = typeof a.b.recommendation_count === "number" ? a.b.recommendation_count : 0;
      const rb = typeof b.b.recommendation_count === "number" ? b.b.recommendation_count : 0;
      return rb - ra;
    });

    return normalizeBookRows(enriched.slice(0, limit).map((x) => x.b));
  } catch (e) {
    logQueryError("getSimilarBooksByLists", e);
    return [];
  }
}

// --- People ---

export async function getPeoplePaginated(
  page = 1,
  pageSize = 24
): Promise<PaginatedResult<Person>> {
  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error } = await getSupabase()
      .from("people")
      .select("*")
      .order("quality_score", { ascending: false })
      .range(from, to);

    if (error) { logQueryError("getPeoplePaginated", error); return { data: [], total: 0, page, pageSize }; }
    return { data: data || [], total: (data || []).length, page, pageSize };
  } catch (e) {
    logQueryError("getPeoplePaginated", e);
    return { data: [], total: 0, page, pageSize };
  }
}

export async function getFeaturedPeople(count = 4): Promise<Person[]> {
  try {
    const { data, error } = await getSupabase()
      .from("people")
      .select("*")
      .order("quality_score", { ascending: false })
      .limit(count);

    if (error) { logQueryError("getFeaturedPeople", error); return []; }
    return data || [];
  } catch (e) {
    logQueryError("getFeaturedPeople", e);
    return [];
  }
}

// For the People index default view — fetches enough rows to filter weak names client-side
export async function getQualityPeople(batch = 100): Promise<Person[]> {
  try {
    const { data, error } = await getSupabase()
      .from("people")
      .select("*")
      .order("quality_score", { ascending: false })
      .limit(batch);

    if (error) { logQueryError("getQualityPeople", error); return []; }
    return data || [];
  } catch (e) {
    logQueryError("getQualityPeople", e);
    return [];
  }
}

/**
 * People ranked by their recommendation count.
 *
 * Uses a single embedded-aggregate query (`recs:book_recommendations(count)` +
 * `auths:book_authors(count)`) paginated by 1000-row pages, then sorted in JS.
 * Returns each person with `recommendedCount` and `writtenCount` already
 * populated, so callers do NOT need to issue N+1 count queries afterward.
 *
 * Used by the /people hub default view so canonical high-recommendation
 * recommenders (Bill Gates, Naval Ravikant, Tim Ferriss, etc.) surface at
 * the top — they were previously hidden because the hub fetched by
 * quality_score, and these rows have quality_score = 0 (never promoted by
 * the editorial pipeline).
 *
 * Read-only. Does not touch index_status, sitemap, or robots metadata.
 */
export async function getTopRecommendedPeople(topN = 150): Promise<Array<Person & { recommendedCount: number; writtenCount: number }>> {
  try {
    const supa = getSupabase();
    const out: Array<Person & { recommendedCount: number; writtenCount: number }> = [];
    const pageSize = 1000;
    let offset = 0;
    while (true) {
      const { data, error } = await supa
        .from("people")
        .select("*, recs:book_recommendations(count), auths:book_authors(count)")
        .range(offset, offset + pageSize - 1);
      if (error) {
        logQueryError("getTopRecommendedPeople", error);
        break;
      }
      if (!data || data.length === 0) break;
      for (const row of data as Array<Record<string, unknown>>) {
        const recs = row.recs as Array<{ count?: number }> | undefined;
        const auths = row.auths as Array<{ count?: number }> | undefined;
        const rc = Array.isArray(recs) && recs[0] && typeof recs[0].count === "number" ? recs[0].count : 0;
        const wc = Array.isArray(auths) && auths[0] && typeof auths[0].count === "number" ? auths[0].count : 0;
        const { recs: _r, auths: _a, ...rest } = row;
        out.push({ ...(rest as unknown as Person), recommendedCount: rc, writtenCount: wc });
      }
      if (data.length < pageSize) break;
      offset += data.length;
    }
    out.sort((a, b) => {
      const r = (b.recommendedCount || 0) - (a.recommendedCount || 0);
      if (r !== 0) return r;
      const q = (b.quality_score || 0) - (a.quality_score || 0);
      if (q !== 0) return q;
      return (a.name || "").localeCompare(b.name || "");
    });
    return out.slice(0, topN);
  } catch (e) {
    logQueryError("getTopRecommendedPeople", e);
    return [];
  }
}

export async function getPersonBySlug(slug: string): Promise<Person | null> {
  try {
    const { data, error } = await getSupabase()
      .from("people")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error) { logQueryError("getPersonBySlug", error); return null; }
    return data;
  } catch (e) {
    logQueryError("getPersonBySlug", e);
    return null;
  }
}

// Count of books recommended BY this person (via book_recommendations)
export async function getPersonRecommendedCount(personId: string): Promise<number> {
  try {
    const { count, error } = await getSupabase()
      .from("book_recommendations")
      .select("*", { count: "exact", head: true })
      .eq("person_id", personId);

    if (error) { logQueryError("getPersonRecommendedCount", error); return 0; }
    return count || 0;
  } catch (e) {
    logQueryError("getPersonRecommendedCount", e);
    return 0;
  }
}

// Count of books written BY this person (via book_authors)
export async function getPersonWrittenCount(personId: string): Promise<number> {
  try {
    const { count, error } = await getSupabase()
      .from("book_authors")
      .select("*", { count: "exact", head: true })
      .eq("person_id", personId);

    if (error) { logQueryError("getPersonWrittenCount", error); return 0; }
    return count || 0;
  } catch (e) {
    logQueryError("getPersonWrittenCount", e);
    return 0;
  }
}

// Books a person has recommended (via book_recommendations → books)
export async function getPersonRecommendedBooks(personId: string, limit = 12): Promise<Book[]> {
  try {
    const { data: rows, error } = await getSupabase()
      .from("book_recommendations")
      .select("books(*)")
      .eq("person_id", personId)
      .order("recommended_at", { ascending: false })
      .limit(limit);

    if (error) { logQueryError("getPersonRecommendedBooks", error); return []; }
    return (rows || []).map((r: { books: unknown }) => r.books as Book).filter((b: Book) => b != null && b.id);
  } catch (e) {
    logQueryError("getPersonRecommendedBooks", e);
    return [];
  }
}

// Person recommendations with full proof data (source, quote, confidence)
export interface PersonRecommendationProof {
  book: Book;
  source_url: string | null;
  source_name: string | null;
  quote: string | null;
  confidence_score: number | null;
}

export async function getPersonRecommendationProof(
  personId: string,
  limit = 24
): Promise<PersonRecommendationProof[]> {
  try {
    const { data: rows, error } = await getSupabase()
      .from("book_recommendations")
      .select("source_url, source_name, quote, confidence_score, books(*)")
      .eq("person_id", personId)
      .order("confidence_score", { ascending: false })
      .limit(limit);

    if (error) { logQueryError("getPersonRecommendationProof", error); return []; }
    return (rows || []).map(
      (r: {
        source_url: string | null;
        source_name: string | null;
        quote: string | null;
        confidence_score: number | null;
        books: unknown;
      }) => ({
        book: r.books as Book,
        source_url: r.source_url,
        source_name: r.source_name,
        quote: r.quote,
        confidence_score: r.confidence_score,
      })
    ).filter((p: PersonRecommendationProof) => p.book != null && p.book.id);
  } catch (e) {
    logQueryError("getPersonRecommendationProof", e);
    return [];
  }
}

// --- Lists ---

export async function getListsPaginated(
  page = 1,
  pageSize = 24,
  sort: "book_count" | "title" = "book_count"
): Promise<PaginatedResult<BookList>> {
  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const col = sort === "title" ? "title" : "book_count";
    const asc = sort === "title";

    // count: 'exact' returns the REAL total in `count`, not just the slice length.
    // Public-discovery filter (see LIST_PUBLIC_OR docstring): excludes
    // draft/concat rows like `parentingrelationships-family` while keeping
    // canonical broad categories (which are also `draft` but allow-listed)
    // and any other non-draft list.
    const { data, count, error } = await getSupabase()
      .from("lists")
      .select("*", { count: "exact" })
      .or(LIST_PUBLIC_OR)
      .not("slug", "is", null)
      .neq("slug", "")
      .order(col, { ascending: asc })
      .range(from, to);

    if (error) { logQueryError("getListsPaginated", error); return { data: [], total: 0, page, pageSize }; }
    return { data: data || [], total: count || 0, page, pageSize };
  } catch (e) {
    logQueryError("getListsPaginated", e);
    return { data: [], total: 0, page, pageSize };
  }
}

// Curated set of broad-parent slugs that are actually present in production after migration.
// These appear at the top of /lists as "Main Categories".
const BROAD_CATEGORY_SLUGS = [
  "nonfiction", "fiction", "business", "science", "social-sciences", "history",
  "psychology", "personal-development", "art", "philosophy", "fantasy",
  "science-fiction", "romance", "mystery-crime", "thriller-suspense", "finance",
  "leadership", "spirituality", "sports", "technology", "health", "politics",
  "biography", "poetry", "music", "food", "travel", "design", "writing",
  "programming", "management", "entrepreneurship",
];

// Public-discovery filter for list browsing surfaces. A row is publicly
// discoverable iff:
//   (a) its slug is non-empty, AND
//   (b) EITHER its `index_status` is NOT 'draft',
//       OR its slug is in the canonical broad-category allowlist above.
//
// Rationale:
//   - 246 lists have machine-concatenated camel-cased titles (e.g.
//     "FoodHobbies", "RomanceFiction"). All 38 with book_count>=10 are
//     index_status='draft' and should NOT appear in public listing/search.
//   - The 31 broad-category slugs ARE also `draft` in the DB but are the
//     intentionally allow-listed launch surface and must remain visible.
//   - This filter is applied to listing helpers (getListsPaginated,
//     searchLists, getRelatedLists, getListsForBook). It is intentionally
//     NOT applied to getListBySlug so direct `/lists/<slug>` URLs still
//     resolve. Combined with the existing robotsDirective `noindex,follow`
//     baseline on /lists/[slug], that keeps direct links reachable while
//     hiding the row from discovery surfaces.
//
// Encoded as a PostgREST .or() string. Used with chained `.not("slug","is",null).neq("slug","")`
// to enforce the non-empty-slug requirement.
const LIST_PUBLIC_OR = `index_status.neq.draft,slug.in.(${BROAD_CATEGORY_SLUGS.join(",")})`;

export async function getBroadCategoryLists(limit = 12): Promise<BookList[]> {
  try {
    const { data, error } = await getSupabase()
      .from("lists")
      .select("*")
      .in("slug", BROAD_CATEGORY_SLUGS)
      .order("book_count", { ascending: false })
      .limit(limit);
    if (error) { logQueryError("getBroadCategoryLists", error); return []; }
    return data || [];
  } catch (e) {
    logQueryError("getBroadCategoryLists", e);
    return [];
  }
}

/**
 * Lightweight Fiction/Nonfiction classifier for `best-*` topic lists,
 * driven by slug + title keywords. Avoids a schema change.
 */
export function classifyTopicList(slug: string, title?: string | null): "fiction" | "nonfiction" | "other" {
  const s = `${slug || ""} ${title || ""}`.toLowerCase();
  const fictionKw = /\b(fiction|fantasy|romance|mystery|thriller|horror|sci-fi|dystopian|comic|comics|manga|poetry|paranormal|time-travel|space-opera|epic-fantasy|urban-fantasy|gothic|steampunk|christian-fiction|cozy-mysteries|legal-thriller|saga)\b/;
  const nonfictionKw = /\b(business|leadership|marketing|sales|finance|investing|economics|management|entrepreneur|startup|career|productivity|science|history|math|physics|biology|chemistry|astronomy|programming|technology|engineering|psychology|philosophy|self-help|self-improvement|personal-development|memoir|biography|autobiography|nutrition|cooking|food|gardening|design|art|architecture|fashion|photography|film|music|sports|fitness|parenting|relationships|education|writing|travel|nature|environment|spirituality|religion|buddhism|christianity|judaism|islam|hinduism|politics|sociology|anthropology|health|medicine|therapy)\b/;
  if (fictionKw.test(s)) return "fiction";
  if (nonfictionKw.test(s)) return "nonfiction";
  return "other";
}

/**
 * Topic-list query (slug LIKE 'best-%') with true total count + optional Fiction/Nonfiction filter.
 * The filter is applied client-side after fetching a wider window — keeps query simple, no schema change.
 */
export async function getTopicLists(opts: {
  limit?: number; offset?: number;
  sort?: "book_count" | "title";
  filter?: "all" | "fiction" | "nonfiction";
} = {}): Promise<{ data: BookList[]; total: number }> {
  const limit = opts.limit ?? 24;
  const offset = opts.offset ?? 0;
  const sort = opts.sort ?? "book_count";
  const filter = opts.filter ?? "all";
  const col = sort === "title" ? "title" : "book_count";
  const asc = sort === "title";

  try {
    // When filtering, overfetch (×4) then narrow client-side; otherwise paginate directly.
    const fetchLimit = filter === "all" ? limit : limit * 4;
    const fetchFrom = filter === "all" ? offset : 0;
    const fetchTo = fetchFrom + fetchLimit - 1;
    const { data, count, error } = await getSupabase()
      .from("lists")
      .select("*", { count: "exact" })
      .like("slug", "best-%")
      .order(col, { ascending: asc })
      .range(fetchFrom, fetchTo);
    if (error) { logQueryError("getTopicLists", error); return { data: [], total: 0 }; }
    let rows = data || [];
    if (filter !== "all") {
      rows = rows.filter(l => classifyTopicList(l.slug, l.title) === filter).slice(offset, offset + limit);
    }
    return { data: rows, total: count || 0 };
  } catch (e) {
    logQueryError("getTopicLists", e);
    return { data: [], total: 0 };
  }
}

export async function getFeaturedLists(count = 3): Promise<BookList[]> {
  try {
    const { data, error } = await getSupabase()
      .from("lists")
      .select("*")
      .order("book_count", { ascending: false })
      .limit(count);

    if (error) { logQueryError("getFeaturedLists", error); return []; }
    return data || [];
  } catch (e) {
    logQueryError("getFeaturedLists", e);
    return [];
  }
}

export async function getListBySlug(slug: string): Promise<BookList | null> {
  try {
    const { data, error } = await getSupabase()
      .from("lists")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error) { logQueryError("getListBySlug", error); return null; }
    return data;
  } catch (e) {
    logQueryError("getListBySlug", e);
    return null;
  }
}

/**
 * Books for a meta/curated list sorted by recommendation strength.
 *
 * P0 fix: replaces the previous PostgREST `!inner` embed (which returned 0 rows
 * in production for /lists/most-recommended-books) with the same two-step pattern
 * that already works for getBooksForList:
 *   Step 1 — paginate ALL book_id values from book_lists for this list.
 *   Step 2 — fetch the books table in chunks (URL-length safe), then sort by
 *            recommendation_count DESC client-side, tiebreak by rating DESC.
 *
 * Diagnostic counts are logged at every stage (visible in Railway runtime logs)
 * so future regressions show their root cause without guessing.
 */
export async function getBooksForListByRecommendations(listId: string, limit = 48): Promise<Book[]> {
  const tag = `[meta-rec list=${listId}]`;
  try {
    const supa = getSupabase();

    // Step 1: paginate ALL book_ids for this list.
    const allBookIds: string[] = [];
    let offset = 0;
    const linkPageSize = 1000;
    while (true) {
      const { data, error } = await supa
        .from("book_lists")
        .select("book_id")
        .eq("list_id", listId)
        .range(offset, offset + linkPageSize - 1);
      if (error) { logQueryError(`getBooksForListByRecommendations[links offset=${offset}]`, error); break; }
      if (!data || data.length === 0) break;
      for (const r of data as Array<{ book_id: string | null }>) {
        if (r.book_id) allBookIds.push(r.book_id);
      }
      if (data.length < linkPageSize) break;
      offset += data.length;
      if (allBookIds.length > 20000) break;   // hard ceiling — defensive
    }
    if (allBookIds.length === 0) return [];

    // Step 2: fetch books in URL-safe id chunks.
    const allBooks: Book[] = [];
    const chunkSize = 200;
    for (let i = 0; i < allBookIds.length; i += chunkSize) {
      const chunk = allBookIds.slice(i, i + chunkSize);
      const { data, error } = await supa
        .from("books")
        .select("*")
        .in("id", chunk);
      if (error) {
        logQueryError(`getBooksForListByRecommendations[books chunk=${i / chunkSize}]`, error);
        continue;
      }
      if (data) allBooks.push(...(data as Book[]));
    }

    // Sort: recommendation_count desc, tiebreak rating desc.
    allBooks.sort((a, b) => {
      const ra = typeof a.recommendation_count === "number" ? a.recommendation_count : 0;
      const rb = typeof b.recommendation_count === "number" ? b.recommendation_count : 0;
      if (ra !== rb) return rb - ra;
      const ya = typeof a.rating === "number" ? a.rating : 0;
      const yb = typeof b.rating === "number" ? b.rating : 0;
      return yb - ya;
    });

    const result = allBooks.slice(0, limit);
    return result;
  } catch (e) {
    logQueryError("getBooksForListByRecommendations", e);
    return [];
  }
}

/**
 * Two-step fetch: avoids PostgREST embed quirks that can return empty for
 * large/freshly-inserted memberships (the cause of the most-recommended-books empty grid).
 * Step 1: get book_ids from book_lists. Step 2: fetch books by id.
 */
export async function getBooksForList(listId: string, limit = 48): Promise<Book[]> {
  try {
    const { data: links, error: linkErr } = await getSupabase()
      .from("book_lists")
      .select("book_id, rank")
      .eq("list_id", listId)
      .order("rank", { ascending: true, nullsFirst: false })
      .limit(limit);
    if (linkErr) { logQueryError("getBooksForList[links]", linkErr); return []; }
    const ids: string[] = (links || [])
      .map((r: { book_id: string | null }) => r.book_id)
      .filter((x): x is string => !!x);
    if (ids.length === 0) return [];

    const { data: books, error: bookErr } = await getSupabase()
      .from("books")
      .select("*")
      .in("id", ids);
    if (bookErr) { logQueryError("getBooksForList[books]", bookErr); return []; }
    // Preserve the rank order from the first query
    const byId = new Map<string, Book>();
    for (const b of (books || []) as Book[]) {
      if (b && b.id) byId.set(b.id, b);
    }
    const ordered: Book[] = [];
    for (const id of ids) {
      const b = byId.get(id);
      if (b) ordered.push(b);
    }
    return ordered;
  } catch (e) {
    logQueryError("getBooksForList", e);
    return [];
  }
}

// ── Topic-similarity helpers used by getRelatedLists ─────────────────────────
// Stop-tokens we strip when comparing slugs.
const SLUG_STOPWORDS = new Set([
  "best", "books", "book", "on", "of", "for", "the", "and", "to", "a", "an",
  "in", "with", "your", "you", "about",
]);

// Curated cross-topic clusters. Used to bring in semantically related lists that
// don't share a direct token (e.g. Fashion ↔ Photography ↔ Design).
// Keep narrow and explicit — no invented taxonomy, just a small bias map.
const TOPIC_CLUSTERS: Record<string, string[]> = {
  // visual / lifestyle
  "fashion": ["photography", "art", "design", "makeup", "style", "beauty", "coffee-table", "architecture"],
  "photography": ["fashion", "art", "design", "coffee-table", "architecture", "film"],
  "design": ["art", "fashion", "architecture", "photography", "typography", "branding"],
  "art": ["fashion", "photography", "design", "architecture", "painting", "drawing", "art-history"],
  "architecture": ["design", "art", "photography", "interior"],
  "coffee-table": ["photography", "art", "design", "fashion", "travel"],
  "makeup": ["fashion", "beauty", "style"],
  // food / cooking
  "cooking": ["food", "nutrition", "recipe", "baking", "wine"],
  "food": ["cooking", "nutrition", "gardening", "recipe", "wine", "coffee"],
  "wine": ["food", "cooking", "spirits"],
  "nutrition": ["health", "cooking", "fitness", "running"],
  "baking": ["cooking", "food", "dessert"],
  // fitness / health
  "running": ["fitness", "nutrition", "sports", "marathon"],
  "fitness": ["running", "nutrition", "yoga", "sports", "health"],
  "yoga": ["fitness", "meditation", "mindfulness", "health"],
  "health": ["nutrition", "fitness", "wellness", "mental-health"],
  // tech
  "programming": ["software", "algorithms", "computer-science", "javascript", "python", "data-science"],
  "ai": ["machine-learning", "data-science", "programming", "technology", "algorithms"],
  "machine-learning": ["ai", "data-science", "algorithms", "programming"],
  "technology": ["programming", "ai", "startup", "software"],
  // business
  "leadership": ["management", "ceo", "executive", "business", "strategy"],
  "startup": ["entrepreneurship", "venture-capital", "business", "founder"],
  "marketing": ["sales", "branding", "business", "advertising"],
  "sales": ["marketing", "business", "negotiation"],
};

function slugTokens(slug: string): Set<string> {
  const out = new Set<string>();
  for (const t of (slug || "").toLowerCase().split(/[\s\-]+/)) {
    if (t && !SLUG_STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

function clusterTokensFor(slug: string): Set<string> {
  const out = new Set<string>();
  for (const t of slugTokens(slug)) {
    const cluster = TOPIC_CLUSTERS[t];
    if (!cluster) continue;
    // Tokenize cluster entries the SAME way slug tokens are tokenized, so multi-word
    // cluster names like "coffee-table" and "art-history" actually match slugs that
    // contain those parts (best-coffee-table-books -> {coffee, table}).
    for (const ct of cluster) {
      for (const sub of ct.toLowerCase().split(/[\s\-]+/)) {
        if (sub && !SLUG_STOPWORDS.has(sub)) out.add(sub);
      }
    }
  }
  return out;
}

function countShared(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/**
 * Smart related lists for a given list.
 *
 * For a topic list (`best-*`):
 *   PRIMARY signal — slug-token similarity (direct token overlap × 3 + cluster overlap × 1).
 *                    e.g. Fashion → Fashion History (direct), Photography/Art/Design (cluster).
 *   SECONDARY      — co-membership: if token similarity returns < limit results, fill the rest
 *                    with lists that share the most books with this one, excluding broad parents
 *                    and the meta list, biased toward smaller (more specific) lists.
 *   Co-membership is no longer the primary ranking, so unrelated-but-co-membership-y lists
 *   (CEO / Wine appearing under Fashion) drop out unless nothing better exists.
 *
 * For broad/meta lists, show top `best-*` topic lists as discovery (unchanged).
 */
export async function getRelatedLists(listId: string, limit = 6): Promise<BookList[]> {
  try {
    const supa = getSupabase();
    const { data: thisList } = await supa.from("lists").select("id,slug,book_count").eq("id", listId).single();
    const slug = (thisList?.slug || "").toLowerCase();
    const isTopic = slug.startsWith("best-");

    if (isTopic) {
      const myTokens = slugTokens(slug);
      const myCluster = clusterTokensFor(slug);

      // Step 1 — pull all best-* topic lists once; rank locally by token similarity.
      // Public-discovery filter: exclude draft best-* rows (unless they were
      // allow-listed as broad categories, which best-* slugs cannot be).
      const { data: allTopic } = await supa
        .from("lists")
        .select("*")
        .like("slug", "best-%")
        .neq("id", listId)
        .or(LIST_PUBLIC_OR)
        .not("slug", "is", null)
        .neq("slug", "")
        .limit(2000);
      const tokenScored = (allTopic || [])
        .map((c: BookList) => {
          const cTok = slugTokens(c.slug || "");
          const direct = countShared(myTokens, cTok);
          const cluster = myCluster.size ? countShared(myCluster, cTok) : 0;
          const score = direct * 3 + cluster;
          return { c, score, bc: c.book_count || 1e9 };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => {
          if (a.score !== b.score) return b.score - a.score;
          return a.bc - b.bc;
        });

      const tokenPick = tokenScored.slice(0, limit).map((x) => x.c);
      if (tokenPick.length >= limit) return tokenPick;

      // Step 2 — top up via co-membership, but EXCLUDE broad parents and meta list,
      // and exclude anything already chosen by token similarity.
      const have = new Set(tokenPick.map((c) => c.id));
      const BROAD = new Set(BROAD_CATEGORY_SLUGS);
      const META = "most-recommended-books";

      const { data: links } = await supa
        .from("book_lists")
        .select("book_id")
        .eq("list_id", listId)
        .limit(100);
      const bookIds = (links || []).map((r: { book_id: string | null }) => r.book_id).filter((x): x is string => !!x);

      let coRanked: BookList[] = [];
      if (bookIds.length > 0) {
        const { data: coLinks } = await supa
          .from("book_lists")
          .select("list_id, book_id")
          .in("book_id", bookIds)
          .neq("list_id", listId)
          .limit(5000);
        const counts = new Map<string, number>();
        for (const r of (coLinks || []) as Array<{ list_id: string }>) {
          if (!r.list_id) continue;
          counts.set(r.list_id, (counts.get(r.list_id) || 0) + 1);
        }
        if (counts.size > 0) {
          const candidateIds = Array.from(counts.keys()).filter((id) => !have.has(id));
          if (candidateIds.length > 0) {
            // Public-discovery filter: drop draft/concat rows from the
            // co-membership related-list candidate pool.
            const { data: cands } = await supa.from("lists").select("*").in("id", candidateIds).or(LIST_PUBLIC_OR).not("slug", "is", null).neq("slug", "");
            coRanked = ((cands || []) as BookList[])
              .filter((c) => {
                const s = (c.slug || "").toLowerCase();
                if (s === META) return false;            // exclude meta from co-membership fill
                if (BROAD.has(s)) return false;          // exclude broad parents
                if (!s.startsWith("best-")) return false; // only other topic lists
                return true;
              })
              .map((c) => ({ c, shared: counts.get(c.id) || 0, bc: c.book_count || 1e9 }))
              .sort((a, b) => {
                if (a.shared !== b.shared) return b.shared - a.shared;
                return a.bc - b.bc;
              })
              .map((x) => x.c);
          }
        }
      }
      return [...tokenPick, ...coRanked].slice(0, limit);
    }

    // Non-topic (broad/meta): show top best-* topic lists as discovery
    const { data: fallback } = await supa
      .from("lists")
      .select("*")
      .like("slug", "best-%")
      .neq("id", listId)
      .order("book_count", { ascending: false })
      .limit(limit);
    return fallback || [];
  } catch (e) {
    logQueryError("getRelatedLists", e);
    return [];
  }
}

// --- Series ---

export async function getSeriesPaginated(
  page = 1,
  pageSize = 24
): Promise<PaginatedResult<Series>> {
  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error } = await getSupabase()
      .from("series")
      .select("*")
      .order("book_count", { ascending: false })
      .range(from, to);

    if (error) { logQueryError("getSeriesPaginated", error); return { data: [], total: 0, page, pageSize }; }
    return { data: data || [], total: (data || []).length, page, pageSize };
  } catch (e) {
    logQueryError("getSeriesPaginated", e);
    return { data: [], total: 0, page, pageSize };
  }
}

export async function getFeaturedSeries(count = 3): Promise<Series[]> {
  try {
    const { data, error } = await getSupabase()
      .from("series")
      .select("*")
      .order("book_count", { ascending: false })
      .limit(count);

    if (error) { logQueryError("getFeaturedSeries", error); return []; }
    return data || [];
  } catch (e) {
    logQueryError("getFeaturedSeries", e);
    return [];
  }
}

export async function getSeriesBySlug(slug: string): Promise<Series | null> {
  try {
    const { data, error } = await getSupabase()
      .from("series")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error) { logQueryError("getSeriesBySlug", error); return null; }
    return data;
  } catch (e) {
    logQueryError("getSeriesBySlug", e);
    return null;
  }
}

// Related series — other popular series by book_count
export async function getRelatedSeries(seriesId: string, limit = 6): Promise<Series[]> {
  try {
    const { data, error } = await getSupabase()
      .from("series")
      .select("*")
      .neq("id", seriesId)
      .order("book_count", { ascending: false })
      .limit(limit);

    if (error) { logQueryError("getRelatedSeries", error); return []; }
    return data || [];
  } catch (e) {
    logQueryError("getRelatedSeries", e);
    return [];
  }
}

// Books in a series (via book_series junction table)
export async function getBooksForSeriesDetail(seriesId: string): Promise<Book[]> {
  try {
    const { data: rows, error } = await getSupabase()
      .from("book_series")
      .select("position, books(*)")
      .eq("series_id", seriesId)
      .order("position", { ascending: true });

    if (error) { logQueryError("getBooksForSeriesDetail", error); return []; }
    return (rows || []).map((r: { books: unknown }) => r.books as Book).filter((b: Book) => b != null && b.id);
  } catch (e) {
    logQueryError("getBooksForSeriesDetail", e);
    return [];
  }
}

// --- Recommendation Proof (via book_recommendations) ---

export async function getRecommendersForBook(
  bookId: string,
  limit = 10
): Promise<Person[]> {
  try {
    const { data: rows, error } = await getSupabase()
      .from("book_recommendations")
      .select("people(*)")
      .eq("book_id", bookId)
      .order("confidence_score", { ascending: false })
      .limit(limit);

    if (error) { logQueryError("getRecommendersForBook", error); return []; }
    return (rows || []).map((r: { people: unknown }) => r.people as Person).filter((p: Person) => p != null && p.id);
  } catch (e) {
    logQueryError("getRecommendersForBook", e);
    return [];
  }
}

export async function getRecommendationProof(
  bookId: string,
  limit = 10
): Promise<RecommendationProof[]> {
  try {
    const { data: rows, error } = await getSupabase()
      .from("book_recommendations")
      .select("source_url, source_name, quote, confidence_score, people(*)")
      .eq("book_id", bookId)
      .order("confidence_score", { ascending: false })
      .limit(limit);

    if (error) { logQueryError("getRecommendationProof", error); return []; }
    return (rows || []).map(
      (r: {
        source_url: string | null;
        source_name: string | null;
        quote: string | null;
        confidence_score: number | null;
        people: unknown;
      }) => ({
        person: r.people as Person,
        source_url: r.source_url,
        source_name: r.source_name,
        quote: r.quote,
        confidence_score: r.confidence_score,
      })
    ).filter((p: RecommendationProof) =>
      // Existing null-/missing-id guards from the previous shape:
      p.person != null && p.person.id &&
      // Launch-safety filter: drop single-token-name persons with no
      // profile signals so the "Recommendation Signals" drawer matches
      // the face grid + /people hub hygiene. Same structural predicate
      // (isProfilelessSurnameAlias) used in getBookRecommenders and the
      // /people hub. Direct /people/<slug> pages stay reachable; only
      // proof-drawer inclusion is suppressed.
      !isProfilelessSurnameAlias({
        name: p.person.name,
        role: p.person.role,
        bio: p.person.bio,
        avatar_url: p.person.avatar_url,
      })
    );
  } catch (e) {
    logQueryError("getRecommendationProof", e);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase-3 / Phase-4 social-proof helpers: book-level recommender summaries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One recommender of a single book, with the proof context attached. Returned
 * by getBookRecommenders for the book-detail "Recommended by notable people"
 * grid. Filtered upstream to drop alias-with-no-data and undefined slugs.
 */
export interface BookRecommenderSummary {
  person_slug: string;
  person_name: string;
  avatar_url: string | null;
  role: string | null;
  bio: string | null;
  source_url: string | null;
  quote: string | null;
  confidence_score: number | null;
}

/**
 * Up to `limit` distinct people who have recommended this book.
 *
 * Sorts by recommender-profile completeness (avatar / role / bio) then by name.
 * Drops invalid slugs ("undefined", "null", empty), drops null people rows
 * (failed FK joins), and dedupes on slug. One PostgREST round trip with an
 * embedded people(*) and an overfetch of 60 rows to allow the JS dedupe to
 * find 12 unique faces even when a single recommender appears multiple times
 * for the same book.
 */
export async function getBookRecommenders(
  bookId: string,
  limit = 12
): Promise<BookRecommenderSummary[]> {
  if (!bookId) return [];
  try {
    const supa = getSupabase();
    // Step 1: rec rows joined with the recommender. Order by confidence so
    // the strongest proofs surface first; overfetch to allow dedupe.
    const { data, error } = await supa
      .from("book_recommendations")
      .select("source_url, quote, confidence_score, people(id, slug, name, avatar_url, role, bio)")
      .eq("book_id", bookId)
      .order("confidence_score", { ascending: false, nullsFirst: false })
      .limit(60);
    if (error) {
      logQueryError("getBookRecommenders", error);
      return [];
    }
    type Row = {
      source_url: string | null;
      quote: string | null;
      confidence_score: number | null;
      // Supabase TS infers many-to-one embeds as an array; at runtime it is a
      // single object. Cast through `unknown` (mirrors getRecommendationProof
      // above) and narrow inline.
      people:
        | { id: string | null; slug: string | null; name: string | null; avatar_url: string | null; role: string | null; bio: string | null }
        | null;
    };
    const seen = new Set<string>();
    type Buffered = BookRecommenderSummary & { _person_id: string };
    const buffered: Buffered[] = [];
    for (const r of (data || []) as unknown as Row[]) {
      const p = r.people;
      if (!p) continue;
      const pid = (p.id || "").trim();
      const slug = (p.slug || "").trim();
      const name = (p.name || "").trim();
      if (!pid) continue;
      if (!slug || slug === "undefined" || slug === "null") continue;
      if (!name) continue;
      if (seen.has(slug)) continue;
      // Launch-safety filter: drop single-token-name persons with no
      // profile signals (e.g. bare `hitchens` / `brand` / `watson`). These
      // rows aggregated content from many recommenders sharing a surname
      // and would otherwise outrank the canonical full-name person on raw
      // recommendation count. Direct /people/<slug> pages stay reachable;
      // only face-grid inclusion is suppressed.
      if (isProfilelessSurnameAlias({ name, role: p.role, bio: p.bio, avatar_url: p.avatar_url })) continue;
      seen.add(slug);
      buffered.push({
        _person_id: pid,
        person_slug: slug,
        person_name: name,
        avatar_url: p.avatar_url,
        role: p.role,
        bio: p.bio,
        source_url: r.source_url,
        quote: r.quote,
        confidence_score: r.confidence_score,
      });
    }
    // Step 2: person-wide recommendation counts for the unique people above.
    // One additional round trip; provides the "more recommenders win" signal
    // that distinguishes well-known canonicals (Bill Gates, Naval Ravikant)
    // from a long tail of low-activity recommenders sharing the same
    // confidence band.
    const recCount = new Map<string, number>();
    const ids = buffered.map((b) => b._person_id);
    if (ids.length > 0) {
      const { data: counts, error: cErr } = await supa
        .from("people")
        .select("id, recs:book_recommendations(count)")
        .in("id", ids);
      if (cErr) {
        logQueryError("getBookRecommenders[recCounts]", cErr);
      } else {
        type RC = { id: string; recs: Array<{ count: number | null }> | null };
        for (const row of (counts || []) as unknown as RC[]) {
          const c = Array.isArray(row.recs) && row.recs[0] && typeof row.recs[0].count === "number" ? row.recs[0].count : 0;
          recCount.set(row.id, c);
        }
      }
    }
    // Sort order tuned for the "Recommended by notable people" section:
    //   1. person-wide recommendation count DESC (well-known canonicals first)
    //   2. profile completeness DESC (avatar/role/bio present)
    //   3. multi-token names (full-name canonicals) before single-token aliases
    //      — this deprioritises unmerged surname-only records like
    //      mauboussin / o-shaughnessy / rabois / weinstein while still showing
    //      them at the bottom of the list
    //   4. name asc for stable ordering
    buffered.sort((a, b) => {
      const ra = recCount.get(a._person_id) || 0;
      const rb = recCount.get(b._person_id) || 0;
      if (ra !== rb) return rb - ra;
      const sa = (a.avatar_url ? 4 : 0) + (a.role ? 2 : 0) + (a.bio ? 1 : 0);
      const sb = (b.avatar_url ? 4 : 0) + (b.role ? 2 : 0) + (b.bio ? 1 : 0);
      if (sa !== sb) return sb - sa;
      const ma = a.person_name.includes(" ");
      const mb = b.person_name.includes(" ");
      if (ma !== mb) return ma ? -1 : 1;
      return a.person_name.localeCompare(b.person_name);
    });
    return buffered.slice(0, limit).map(({ _person_id: _id, ...rest }) => rest);
  } catch (e) {
    logQueryError("getBookRecommenders", e);
    return [];
  }
}

// Phase-4 BookCard recommender row (getBookRecommenderSummaries + the
// BookRecommenderName / BookRecommenderCardSummary types) was removed here
// because the additional Supabase round-trips per /books request correlated
// with a cold-start empty-state regression (5-9 of 30 hammer attempts
// returned the "No books found" fallback after Phase 4 shipped). The Phase-3
// detail-page section (getBookRecommenders above) is unaffected and remains
// in place — it runs once per book detail render and has not shown any
// stability impact.

/**
 * Returns book→list memberships ranked for "Appears In":
 *   topic lists (best-*) first, then narrow lists, then meta, then broad parents;
 *   within each tier, smaller book_count and lower membership rank win.
 *
 * Two-step fetch so it works regardless of PostgREST embed quirks. Fetches up to 200
 * memberships, picks the top `limit` after ranking.
 */
export async function getListsForBook(bookId: string, limit = 8): Promise<BookList[]> {
  try {
    const supa = getSupabase();
    const { data: links, error: linkErr } = await supa
      .from("book_lists")
      .select("list_id, rank")
      .eq("book_id", bookId)
      .limit(200);
    if (linkErr) { logQueryError("getListsForBook[links]", linkErr); return []; }
    const rows = (links || []) as Array<{ list_id: string | null; rank: number | null }>;
    const ids = rows.map(r => r.list_id).filter((x): x is string => !!x);
    if (ids.length === 0) return [];

    // Public-discovery filter: book-detail "Appears In" must not surface
    // draft/concat lists. Same predicate as listing/search helpers — canonical
    // broad categories (which are also `draft`) remain visible.
    const { data: lists, error: listErr } = await supa
      .from("lists")
      .select("*")
      .in("id", ids)
      .or(LIST_PUBLIC_OR)
      .not("slug", "is", null)
      .neq("slug", "");
    if (listErr) { logQueryError("getListsForBook[lists]", listErr); return []; }
    const rankByListId = new Map<string, number | null>();
    for (const r of rows) if (r.list_id) rankByListId.set(r.list_id, r.rank);

    // Rank tiers locally — best-* first, broad parents last.
    const BROAD = new Set(BROAD_CATEGORY_SLUGS);
    const META = "most-recommended-books";
    const tier = (s: string): number => {
      const slug = (s || "").toLowerCase();
      if (slug.startsWith("best-")) return 1;
      if (slug === META) return 3;
      if (BROAD.has(slug)) return 4;
      return 2;
    };
    const ranked = ((lists || []) as BookList[])
      .filter(l => l && l.id)
      .map(l => ({
        l,
        t: tier(l.slug),
        bc: (typeof l.book_count === "number" && l.book_count > 0) ? l.book_count : 1e9,
        r: rankByListId.get(l.id) ?? 1e9,
      }))
      .sort((a, b) => {
        if (a.t !== b.t) return a.t - b.t;
        if (a.bc !== b.bc) return a.bc - b.bc;
        return (a.r as number) - (b.r as number);
      })
      .slice(0, limit)
      .map(x => x.l);
    return ranked;
  } catch (e) {
    logQueryError("getListsForBook", e);
    return [];
  }
}

// --- Slug → ID helpers ---
export async function getPersonIdBySlug(slug: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabase()
      .from("people")
      .select("id")
      .eq("slug", slug)
      .single();

    if (error || !data) { logQueryError("getPersonIdBySlug", error); return null; }
    return data.id;
  } catch (e) {
    logQueryError("getPersonIdBySlug", e);
    return null;
  }
}

export async function getSeriesIdBySlug(slug: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabase()
      .from("series")
      .select("id")
      .eq("slug", slug)
      .single();

    if (error || !data) { logQueryError("getSeriesIdBySlug", error); return null; }
    return data.id;
  } catch (e) {
    logQueryError("getSeriesIdBySlug", e);
    return null;
  }
}

// --- Data quality diagnostics (admin/internal use) ---

export async function getBooksWithSuspiciousDescriptions(limit = 20): Promise<Book[]> {
  try {
    const { data, error } = await getSupabase()
      .from("books")
      .select("*")
      .or("description.ilike.%goodreads%,description.ilike.%tanggal terbit%,description.ilike.%informasi lainnya%")
      .order("recommendation_count", { ascending: false })
      .limit(limit);

    if (error) { logQueryError("getBooksWithSuspiciousDescriptions", error); return []; }
    return data || [];
  } catch (e) {
    logQueryError("getBooksWithSuspiciousDescriptions", e);
    return [];
  }
}

export async function getBooksWithMissingCover(limit = 20): Promise<Book[]> {
  try {
    const { data, error } = await getSupabase()
      .from("books")
      .select("*")
      .or("cover_image_url.is.null,cover_image_url.eq.")
      .order("recommendation_count", { ascending: false })
      .limit(limit);

    if (error) { logQueryError("getBooksWithMissingCover", error); return []; }
    return data || [];
  } catch (e) {
    logQueryError("getBooksWithMissingCover", e);
    return [];
  }
}

export async function getBooksWithInvalidRating(limit = 20): Promise<Book[]> {
  try {
    const { data, error } = await getSupabase()
      .from("books")
      .select("*")
      .or("rating.lt.1,rating.gt.5,rating.is.null")
      .order("recommendation_count", { ascending: false })
      .limit(limit);

    if (error) { logQueryError("getBooksWithInvalidRating", error); return []; }
    return data || [];
  } catch (e) {
    logQueryError("getBooksWithInvalidRating", e);
    return [];
  }
}

export async function getBooksMissingDescription(limit = 20): Promise<Book[]> {
  try {
    const { data, error } = await getSupabase()
      .from("books")
      .select("*")
      .is("description", null)
      .order("recommendation_count", { ascending: false })
      .limit(limit);

    if (error) { logQueryError("getBooksMissingDescription", error); return []; }
    return data || [];
  } catch (e) {
    logQueryError("getBooksMissingDescription", e);
    return [];
  }
}

export async function getHighRecBooksWithQualityIssues(limit = 20): Promise<Book[]> {
  try {
    // Books with recommendation_count > 0 but missing cover or short description
    const { data, error } = await getSupabase()
      .from("books")
      .select("*")
      .order("recommendation_count", { ascending: false })
      .limit(200);

    if (error) { logQueryError("getHighRecBooksWithQualityIssues", error); return []; }
    // Filter client-side for missing cover or suspicious description
    const filtered = (data || []).filter((b: Book) => {
      const noCover = !b.cover_image_url || b.cover_image_url.trim() === "";
      const shortDesc = !b.description || b.description.trim().length < 80;
      return noCover || shortDesc;
    });
    return filtered.slice(0, limit);
  } catch (e) {
    logQueryError("getHighRecBooksWithQualityIssues", e);
    return [];
  }
}

export async function searchBooks(q: string, limit = 8): Promise<Book[]> {
  if (!q || q.length < 2) return [];
  try {
    const pattern = `%${q}%`;
    // FIX: production has `author_name`, not `author`. The previous `author.ilike`
    // OR-clause referenced a non-existent column, causing PostgREST to return
    // `column books.author does not exist` (42703) and the catch path to return [].
    const { data, error } = await getSupabase()
      .from("books")
      .select("*")
      .or(`title.ilike.${pattern},author_name.ilike.${pattern}`)
      .order("recommendation_count", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) { logQueryError("searchBooks", error); return []; }
    return normalizeBookRows((data || []) as Book[]);
  } catch (e) {
    logQueryError("searchBooks", e);
    return [];
  }
}

/**
 * Paginated title/author search used by /books?q=...
 *
 * Two fixes vs the previous version:
 *   1) Filter column is `author_name` (real DB column), not `author` — that 42703
 *      error was the entire reason "/books?q=atomic" returned "No matching books".
 *   2) `count: 'estimated'` instead of `'exact'`. Exact count forces Postgres to
 *      scan every matching row to give a precise total; on a 99k-row table with
 *      ilike substring patterns this consistently breached the 8s statement
 *      timeout (verified via direct probe: `or(...).ilike` + `count:'exact'`
 *      → 57014 statement timeout). Estimated uses the planner's stats — fast
 *      and accurate enough for "Showing N of ~M" UX.
 */
export async function searchBooksPaginated(
  q: string,
  page = 1,
  pageSize = 48,
  sort: "recommendation_count" | "rating" | "title" = "recommendation_count"
): Promise<PaginatedResult<Book>> {
  if (!q || q.length < 2) return { data: [], total: 0, page, pageSize };
  try {
    const pattern = `%${q}%`;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const col = sort === "title" ? "title" : sort;
    const asc = sort === "title";

    const { data, count, error } = await getSupabase()
      .from("books")
      .select(BOOK_CARD_COLUMNS, { count: "estimated" })
      .or(`title.ilike.${pattern},author_name.ilike.${pattern}`)
      .order(col, { ascending: asc, nullsFirst: false })
      .range(from, to);

    if (error) { logQueryError("searchBooksPaginated", error); return { data: [], total: 0, page, pageSize }; }
    return { data: normalizeBookRows((data || []) as Book[]), total: count || 0, page, pageSize };
  } catch (e) {
    logQueryError("searchBooksPaginated", e);
    return { data: [], total: 0, page, pageSize };
  }
}

/**
 * Paginated category browse driven by a list slug. Used by /books?category=...
 *
 * Why the two-step pattern instead of `book_lists!inner(books(*))` with an
 * embedded sort: PostgREST's `order(..., { foreignTable: 'books' })` only
 * orders the embedded representation, not the parent `book_lists` row slice.
 * Production probe on the Fiction list confirmed this: rec=13 (Republic)
 * appeared after rec=5 with the embedded sort. So we resolve list_id, fetch
 * ALL membership book_ids, fetch those books in URL-safe chunks, sort
 * client-side by the requested criterion, and return the requested page.
 *
 * Bounded at 10,000 member books — the largest current category (Nonfiction
 * ~7800) fits comfortably; the cap is defensive against future runaway lists.
 *
 * TODO: this is a defensive cap, NOT real pagination. Replace with true DB-side
 * pagination once we have an indexed `books.category_slug[]` column (or a
 * materialized `category_books` view ordered by recommendation_count) so that
 * a category with >10k members can be paginated without enumerating every
 * member row per page load. Right now broad categories load all member ids on
 * every page hit and sort in JS — fine at current scale, not at 10×.
 */
export async function getBooksByListSlugPaginated(
  listSlug: string,
  page = 1,
  pageSize = 48,
  sort: "recommendation_count" | "rating" | "title" = "recommendation_count"
): Promise<PaginatedResult<Book>> {
  try {
    const supa = getSupabase();

    // Resolve slug → id.
    const { data: list, error: listErr } = await supa
      .from("lists")
      .select("id, book_count")
      .eq("slug", listSlug)
      .single();
    if (listErr || !list) {
      logQueryError("getBooksByListSlugPaginated[list]", listErr);
      return { data: [], total: 0, page, pageSize };
    }

    // Step 1: paginate ALL membership book_ids.
    // TODO(perf): HARD_CAP exists because we have no indexed category column on
    // `books` today — for now we always materialize every member id in JS to do
    // proper sorting. When `books.category_slug[]` (or equivalent index) lands,
    // delete this loop and slice the page directly in Postgres.
    const allBookIds: string[] = [];
    let offset = 0;
    const linkPageSize = 1000;
    const HARD_CAP = 10000;
    while (true) {
      const { data, error } = await supa
        .from("book_lists")
        .select("book_id")
        .eq("list_id", list.id)
        .range(offset, offset + linkPageSize - 1);
      if (error) { logQueryError(`getBooksByListSlugPaginated[links offset=${offset}]`, error); break; }
      if (!data || data.length === 0) break;
      for (const r of data as Array<{ book_id: string | null }>) {
        if (r.book_id) allBookIds.push(r.book_id);
      }
      if (data.length < linkPageSize) break;
      offset += data.length;
      if (allBookIds.length >= HARD_CAP) break;
    }
    if (allBookIds.length === 0) return { data: [], total: 0, page, pageSize };

    // Step 2: fetch books in URL-safe id chunks.
    const allBooks: Book[] = [];
    const chunkSize = 200;
    for (let i = 0; i < allBookIds.length; i += chunkSize) {
      const chunk = allBookIds.slice(i, i + chunkSize);
      const { data, error } = await supa.from("books").select("*").in("id", chunk);
      if (error) {
        logQueryError(`getBooksByListSlugPaginated[books chunk=${i / chunkSize}]`, error);
        continue;
      }
      if (data) allBooks.push(...(data as Book[]));
    }

    // Step 3: sort client-side by requested criterion (tiebreaks chosen to keep
    // results stable across paginations).
    allBooks.sort((a, b) => {
      if (sort === "title") {
        return (a.title || "").localeCompare(b.title || "");
      }
      if (sort === "rating") {
        const dr = (b.rating || 0) - (a.rating || 0);
        if (dr !== 0) return dr;
        return (b.recommendation_count || 0) - (a.recommendation_count || 0);
      }
      // recommendation_count (default)
      const drc = (b.recommendation_count || 0) - (a.recommendation_count || 0);
      if (drc !== 0) return drc;
      return (b.rating || 0) - (a.rating || 0);
    });

    // Step 4: paginate sorted result.
    const total = allBooks.length;
    const from = (page - 1) * pageSize;
    const to = from + pageSize;
    return { data: normalizeBookRows(allBooks.slice(from, to)), total, page, pageSize };
  } catch (e) {
    logQueryError("getBooksByListSlugPaginated", e);
    return { data: [], total: 0, page, pageSize };
  }
}

export async function searchPeople(q: string, limit = 8): Promise<Person[]> {
  if (!q || q.length < 2) return [];
  try {
    const pattern = `%${q}%`;
    const { data, error } = await getSupabase()
      .from("people")
      .select("*")
      .or(`name.ilike.${pattern},role.ilike.${pattern}`)
      .order("quality_score", { ascending: false })
      .limit(limit);

    if (error) { logQueryError("searchPeople", error); return []; }
    return data || [];
  } catch (e) {
    logQueryError("searchPeople", e);
    return [];
  }
}

export async function searchLists(q: string, limit = 8): Promise<BookList[]> {
  if (!q || q.length < 2) return [];
  try {
    const pattern = `%${q}%`;
    // Public-discovery filter applied client-side after the title/description
    // text-match query — PostgREST's single-`.or()` per builder makes chaining
    // a second `.or(LIST_PUBLIC_OR)` ambiguous, so we overfetch (×6) and
    // filter resolved rows in JS before slicing to `limit`. Same predicate
    // as LIST_PUBLIC_OR: non-draft OR canonical broad category, plus
    // non-empty slug.
    const broad = new Set(BROAD_CATEGORY_SLUGS);
    const fetchLimit = Math.max(limit * 6, 24);
    const { data, error } = await getSupabase()
      .from("lists")
      .select("*")
      .or(`title.ilike.${pattern},description.ilike.${pattern}`)
      .order("book_count", { ascending: false })
      .limit(fetchLimit);

    if (error) { logQueryError("searchLists", error); return []; }
    const filtered = (data || []).filter((l: BookList) => {
      const slug = (l.slug || "").trim();
      if (!slug) return false;
      if (l.index_status !== "draft") return true;
      return broad.has(slug);
    });
    return filtered.slice(0, limit);
  } catch (e) {
    logQueryError("searchLists", e);
    return [];
  }
}

export async function searchSeries(q: string, limit = 8): Promise<Series[]> {
  if (!q || q.length < 2) return [];
  try {
    const pattern = `%${q}%`;
    const { data, error } = await getSupabase()
      .from("series")
      .select("*")
      .or(`title.ilike.${pattern},description.ilike.${pattern}`)
      .order("book_count", { ascending: false })
      .limit(limit);

    if (error) { logQueryError("searchSeries", error); return []; }
    return data || [];
  } catch (e) {
    logQueryError("searchSeries", e);
    return [];
  }
}

export function slugify(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "") // remove special characters
    .replace(/[\s-]+/g, "-")      // collapse spaces/hyphens
    .replace(/^-+|-+$/g, "");      // trim trailing hyphens
}

export async function getBooksByAuthorSlug(
  slug: string,
  limit = 48
): Promise<{ authorName: string; books: Book[] } | null> {
  try {
    const supa = getSupabase();
    
    // Step 1: Query unique author names of eligible draft books from the books table in pages
    const rawAuthors: Array<{ author_name: string | null }> = [];
    const pageSize = 1000;
    let offset = 0;
    
    while (true) {
      const from = offset;
      const to = offset + pageSize - 1;
      
      const { data, error } = await supa
        .from("books")
        .select("id, author_name")
        .eq("ai_quality_status", "draft")
        .not("author_name", "is", null)
        .neq("author_name", "")
        .not("cover_image_url", "is", null)
        .neq("cover_image_url", "")
        .not("slug", "is", null)
        .neq("slug", "")
        .not("title", "is", null)
        .neq("title", "")
        .order("id", { ascending: true })
        .range(from, to);
        
      if (error) {
        logQueryError(`getBooksByAuthorSlug.auth[offset=${offset}]`, error);
        return null;
      }
      
      if (!data || data.length === 0) {
        break;
      }
      
      rawAuthors.push(...(data as any[]));
      
      if (data.length < pageSize) {
        break;
      }
      offset += data.length;
    }
    
    // Step 2: Find all matching display author names (Slug-Collision Protection)
    const uniqueNames = Array.from(new Set(rawAuthors.map(r => r.author_name).filter((x): x is string => !!x)));
    const matchingNames = uniqueNames.filter(name => slugify(name) === slug);
    if (matchingNames.length === 0) {
      return null; // Author not found or lacks eligible books
    }
    
    if (matchingNames.length > 1) {
      console.warn(`[author-collision] Slug collision detected for slug: "${slug}". Matching names: ${JSON.stringify(matchingNames)}`);
      return null; // Return null / notFound on collision to protect author name separation
    }
    
    const primaryName = matchingNames[0];
    
    // Step 3: Fetch all eligible draft books written by this author
    const { data: books, error: booksErr } = await supa
      .from("books")
      .select("*")
      .eq("ai_quality_status", "draft")
      .eq("author_name", primaryName)
      .not("cover_image_url", "is", null)
      .neq("cover_image_url", "")
      .not("slug", "is", null)
      .neq("slug", "")
      .not("title", "is", null)
      .neq("title", "")
      .order("recommendation_count", { ascending: false })
      .limit(limit);
      
    if (booksErr || !books) {
      logQueryError("getBooksByAuthorSlug.books", booksErr || new Error("No books returned"));
      return null;
    }
    
    if (books.length === 0) {
      return null;
    }
    
    // Step 4: Exclude books linked to series via live DB check
    const { data: seriesLinks, error: seriesErr } = await supa
      .from("book_series")
      .select("book_id")
      .in("book_id", books.map(b => b.id));
      
    if (seriesErr) {
      logQueryError("getBooksByAuthorSlug.series", seriesErr);
    }
    
    const seriesIds = new Set((seriesLinks || []).map(s => s.book_id));
    const nonSeriesBooks = books.filter(b => !seriesIds.has(b.id));
    
    // Step 5: Enforce HTTPS cover image eligibility
    const eligibleBooks = nonSeriesBooks.filter(
      b => b.cover_image_url && b.cover_image_url.startsWith("https://")
    );
    
    if (eligibleBooks.length === 0) {
      return null;
    }
    
    return {
      authorName: primaryName,
      books: normalizeBookRows(eligibleBooks),
    };
  } catch (e) {
    logQueryError("getBooksByAuthorSlug", e);
    return null;
  }
}

export interface AuthorIndexItem {
  authorName: string;
  slug: string;
  eligibleBookCount: number;
  totalRecommendationCount: number;
}

export async function getAuthorCatalogIndex(limit = 100): Promise<AuthorIndexItem[]> {
  try {
    const supa = getSupabase();
    
    // Step 1: Fetch all draft books with valid metadata in pages
    const books: Array<{
      id: string;
      slug: string | null;
      title: string | null;
      author_name: string | null;
      cover_image_url: string | null;
      recommendation_count: number | null;
    }> = [];
    
    const pageSize = 1000;
    let offset = 0;
    
    while (true) {
      const from = offset;
      const to = offset + pageSize - 1;
      
      const { data, error } = await supa
        .from("books")
        .select("id, slug, title, author_name, cover_image_url, recommendation_count")
        .eq("ai_quality_status", "draft")
        .not("author_name", "is", null)
        .neq("author_name", "")
        .not("cover_image_url", "is", null)
        .neq("cover_image_url", "")
        .not("slug", "is", null)
        .neq("slug", "")
        .not("title", "is", null)
        .neq("title", "")
        .order("id", { ascending: true })
        .range(from, to);
        
      if (error) {
        logQueryError(`getAuthorCatalogIndex.books[offset=${offset}]`, error);
        return [];
      }
      
      if (!data || data.length === 0) {
        break;
      }
      
      books.push(...(data as any[]));
      
      if (data.length < pageSize) {
        break;
      }
      offset += data.length;
    }
    
    // Step 2: Live Supabase series exclusions check in chunked batches
    const bookIds = books.map(b => b.id);
    const seriesBookIds = new Set<string>();
    const chunkBatchSize = 250;
    
    for (let i = 0; i < bookIds.length; i += chunkBatchSize) {
      const chunk = bookIds.slice(i, i + chunkBatchSize);
      const { data: seriesLinks, error: seriesErr } = await supa
        .from("book_series")
        .select("book_id")
        .in("book_id", chunk);
        
      if (seriesErr) {
        logQueryError(`getAuthorCatalogIndex.series[chunk=${i / chunkBatchSize}]`, seriesErr);
        continue;
      }
      
      if (seriesLinks) {
        for (const s of seriesLinks) {
          if (s.book_id) {
            seriesBookIds.add(s.book_id);
          }
        }
      }
    }
    
    // Filter non-series books and ensure HTTPS cover URL
    const eligibleBooks = books.filter(
      b => !seriesBookIds.has(b.id) && b.cover_image_url && b.cover_image_url.startsWith("https://")
    );
    
    // Step 3: Group books by author_name
    const authorGroups = new Map<string, any[]>();
    for (const b of eligibleBooks) {
      const author = b.author_name as string;
      if (!authorGroups.has(author)) {
        authorGroups.set(author, []);
      }
      authorGroups.get(author)!.push(b);
    }
    
    // Step 4: Map groups and check for slug collisions
    const authorItems: AuthorIndexItem[] = [];
    const slugToNames = new Map<string, string[]>();
    
    for (const [authorName, booksWritten] of authorGroups.entries()) {
      const slug = slugify(authorName);
      if (!slug) continue;
      
      if (!slugToNames.has(slug)) {
        slugToNames.set(slug, []);
      }
      slugToNames.get(slug)!.push(authorName);
      
      const totalRecs = booksWritten.reduce((sum, b) => sum + (b.recommendation_count || 0), 0);
      
      authorItems.push({
        authorName,
        slug,
        eligibleBookCount: booksWritten.length,
        totalRecommendationCount: totalRecs,
      });
    }
    
    // Filter out collided slugs
    const cleanItems = authorItems.filter(item => {
      const names = slugToNames.get(item.slug);
      return names && names.length === 1;
    });
    
    // Sort: eligibleBookCount desc, totalRecommendationCount desc, authorName asc
    cleanItems.sort((a, b) => {
      if (b.eligibleBookCount !== a.eligibleBookCount) {
        return b.eligibleBookCount - a.eligibleBookCount;
      }
      if (b.totalRecommendationCount !== a.totalRecommendationCount) {
        return b.totalRecommendationCount - a.totalRecommendationCount;
      }
      return a.authorName.localeCompare(b.authorName);
    });
    
    return cleanItems.slice(0, limit);
  } catch (e) {
    logQueryError("getAuthorCatalogIndex", e);
    return [];
  }
}


