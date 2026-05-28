import { supabase as getSupabase } from "./supabase";

// --- Types (matched to actual Supabase schema) ---

export interface Book {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  author: string;
  author_slug: string;
  cover_image_url: string;
  description: string;
  rating: number;
  recommendation_count: number;
  series: string | null;
  series_slug: string | null;
  index_status: string;
  meta_title: string | null;
  meta_description: string | null;
  created_at: string;
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

// --- Books ---

export async function getBooksPaginated(
  page = 1,
  pageSize = 24,
  sort: "recommendation_count" | "rating" | "title" = "recommendation_count"
): Promise<PaginatedResult<Book>> {
  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const col = sort === "title" ? "title" : sort;
    const asc = sort === "title";

    const { data, error } = await getSupabase()
      .from("books")
      .select("*")
      .order(col, { ascending: asc })
      .range(from, to);

    if (error) { logQueryError("getBooksPaginated", error); return { data: [], total: 0, page, pageSize }; }
    return { data: data || [], total: (data || []).length, page, pageSize };
  } catch (e) {
    logQueryError("getBooksPaginated", e);
    return { data: [], total: 0, page, pageSize };
  }
}

export async function getFeaturedBooks(count = 6): Promise<Book[]> {
  try {
    const { data, error } = await getSupabase()
      .from("books")
      .select("*")
      .order("recommendation_count", { ascending: false })
      .limit(count);

    if (error) { logQueryError("getFeaturedBooks", error); return []; }
    return data || [];
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
    return data;
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
    return (rows || []).map((r: { books: unknown }) => r.books as Book).filter((b: Book) => b != null && b.id);
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
    return (rows || []).map((r: { books: unknown }) => r.books as Book).filter((b: Book) => b != null && b.id);
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
    return data || [];
  } catch (e) {
    logQueryError("getRelatedBooks", e);
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
    const { data, count, error } = await getSupabase()
      .from("lists")
      .select("*", { count: "exact" })
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
 * Used for `/lists/most-recommended-books` where the imported book_lists.rank is
 * arbitrary/null and produces a junk-looking order. We sort by the books table's
 * own `recommendation_count DESC` so the most-recommended books surface first.
 *
 * Implementation: inner-join via PostgREST embed reverse-side filter, ordering
 * the parent (`books`) table directly. Then we OVERFETCH and apply
 * `isProbablyValidBookTitle` client-side to skip the junk numeric/date titles
 * from the dirty import, before truncating to `limit`.
 */
export async function getBooksForListByRecommendations(listId: string, limit = 48): Promise<Book[]> {
  try {
    const supa = getSupabase();
    // Overfetch (×3) so junk filtering still leaves us enough rows.
    const window = Math.min(200, limit * 3);
    const { data, error } = await supa
      .from("books")
      .select("*, book_lists!inner(list_id)")
      .eq("book_lists.list_id", listId)
      .order("recommendation_count", { ascending: false, nullsFirst: false })
      .limit(window);
    if (error) { logQueryError("getBooksForListByRecommendations", error); return []; }
    // Inline import to keep this file's existing import block intact
    const { isProbablyValidBookTitle } = await import("./dataQuality");
    const clean = ((data || []) as Array<Book & { book_lists?: unknown }>)
      .filter((b) => b && b.id && isProbablyValidBookTitle(b.title))
      .slice(0, limit)
      // strip the embed payload before returning
      .map(({ ...rest }) => {
        const out = { ...rest } as Book & { book_lists?: unknown };
        delete out.book_lists;
        return out as Book;
      });
    return clean;
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

/**
 * Smart related lists for a given list.
 *
 * For a topic list (`best-*`), find sibling topic lists by **co-membership**:
 *   - fetch the first ~100 book_ids of THIS list
 *   - find other lists those books appear in
 *   - rank by shared-book count, prefer `best-*`, prefer smaller (more specific)
 *   - de-prioritize broad parents and the meta list unless nothing else fits
 *
 * For broad/meta lists, fall back to top non-broad topic lists by book_count.
 */
export async function getRelatedLists(listId: string, limit = 6): Promise<BookList[]> {
  try {
    const supa = getSupabase();
    // load this list's slug to decide the strategy
    const { data: thisList } = await supa.from("lists").select("id,slug,book_count").eq("id", listId).single();
    const slug = (thisList?.slug || "").toLowerCase();
    const isTopic = slug.startsWith("best-");

    if (isTopic) {
      // Step A: top ~100 book_ids from THIS list
      const { data: links } = await supa
        .from("book_lists")
        .select("book_id")
        .eq("list_id", listId)
        .limit(100);
      const bookIds = (links || []).map((r: { book_id: string | null }) => r.book_id).filter((x): x is string => !!x);
      if (bookIds.length === 0) {
        // fallback: top best-* lists (excluding self)
        const { data: fb } = await supa.from("lists").select("*").like("slug", "best-%").neq("id", listId).order("book_count", { ascending: false }).limit(limit);
        return fb || [];
      }

      // Step B: which OTHER lists do those books also appear in?
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
      if (counts.size === 0) {
        const { data: fb } = await supa.from("lists").select("*").like("slug", "best-%").neq("id", listId).order("book_count", { ascending: false }).limit(limit);
        return fb || [];
      }
      const candidateIds = Array.from(counts.keys());
      const { data: cands } = await supa.from("lists").select("*").in("id", candidateIds);

      // Rank: best-* first, smaller book_count first, by shared count desc as tiebreaker
      const BROAD = new Set(BROAD_CATEGORY_SLUGS);
      const META = "most-recommended-books";
      const ranked = (cands || [])
        .map((c: BookList) => {
          const s = (c.slug || "").toLowerCase();
          const tier = s.startsWith("best-") ? 1 : s === META ? 3 : BROAD.has(s) ? 4 : 2;
          return { c, tier, shared: counts.get(c.id) || 0, bc: c.book_count || 1e9 };
        })
        .sort((a, b) => {
          if (a.tier !== b.tier) return a.tier - b.tier;
          if (a.shared !== b.shared) return b.shared - a.shared;
          return a.bc - b.bc;
        })
        .slice(0, limit)
        .map(x => x.c);
      return ranked;
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
    ).filter((p: RecommendationProof) => p.person != null && p.person.id);
  } catch (e) {
    logQueryError("getRecommendationProof", e);
    return [];
  }
}

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

    const { data: lists, error: listErr } = await supa.from("lists").select("*").in("id", ids);
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
      .gt("recommendation_count", 0)
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
    const { data, error } = await getSupabase()
      .from("books")
      .select("*")
      .or(`title.ilike.${pattern},author.ilike.${pattern}`)
      .order("recommendation_count", { ascending: false })
      .limit(limit);

    if (error) { logQueryError("searchBooks", error); return []; }
    return data || [];
  } catch (e) {
    logQueryError("searchBooks", e);
    return [];
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
    const { data, error } = await getSupabase()
      .from("lists")
      .select("*")
      .or(`title.ilike.${pattern},description.ilike.${pattern}`)
      .order("book_count", { ascending: false })
      .limit(limit);

    if (error) { logQueryError("searchLists", error); return []; }
    return data || [];
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
