import { supabase as getSupabase } from "./supabase";

// --- Types (matched to actual Supabase schema) ---

export interface Book {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  author: string;
  author_slug: string;
  cover_url: string;
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

    const { data, count, error } = await getSupabase()
      .from("books")
      .select("*", { count: "exact" })
      .order(col, { ascending: asc })
      .range(from, to);

    if (error) { logQueryError("getBooksPaginated", error); return { data: [], total: 0, page, pageSize }; }
    return { data: data || [], total: count || 0, page, pageSize };
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
      .order("rank", { ascending: true, foreignTable: "books" })
      .limit(limit);

    if (error) { logQueryError("getBooksByAuthor", error); return []; }
    return (rows || []).map((r: { books: unknown }) => r.books as Book);
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
    return (rows || []).map((r: { books: unknown }) => r.books as Book);
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

    const { data, count, error } = await getSupabase()
      .from("people")
      .select("*", { count: "exact" })
      .order("quality_score", { ascending: false })
      .range(from, to);

    if (error) { logQueryError("getPeoplePaginated", error); return { data: [], total: 0, page, pageSize }; }
    return { data: data || [], total: count || 0, page, pageSize };
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
    return (rows || []).map((r: { books: unknown }) => r.books as Book);
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
    );
  } catch (e) {
    logQueryError("getPersonRecommendationProof", e);
    return [];
  }
}

// --- Lists ---

export async function getListsPaginated(
  page = 1,
  pageSize = 24
): Promise<PaginatedResult<BookList>> {
  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, count, error } = await getSupabase()
      .from("lists")
      .select("*", { count: "exact" })
      .order("book_count", { ascending: false })
      .range(from, to);

    if (error) { logQueryError("getListsPaginated", error); return { data: [], total: 0, page, pageSize }; }
    return { data: data || [], total: count || 0, page, pageSize };
  } catch (e) {
    logQueryError("getListsPaginated", e);
    return { data: [], total: 0, page, pageSize };
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

// Books in a list (via book_lists junction table)
export async function getBooksForList(listId: string, limit = 48): Promise<Book[]> {
  try {
    const { data: rows, error } = await getSupabase()
      .from("book_lists")
      .select("rank, books(*)")
      .eq("list_id", listId)
      .order("rank", { ascending: true })
      .limit(limit);

    if (error) { logQueryError("getBooksForList", error); return []; }
    return (rows || []).map((r: { books: unknown }) => r.books as Book);
  } catch (e) {
    logQueryError("getBooksForList", e);
    return [];
  }
}

// Related lists — other popular lists by book_count
export async function getRelatedLists(listId: string, limit = 6): Promise<BookList[]> {
  try {
    const { data, error } = await getSupabase()
      .from("lists")
      .select("*")
      .neq("id", listId)
      .order("book_count", { ascending: false })
      .limit(limit);

    if (error) { logQueryError("getRelatedLists", error); return []; }
    return data || [];
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

    const { data, count, error } = await getSupabase()
      .from("series")
      .select("*", { count: "exact" })
      .order("book_count", { ascending: false })
      .range(from, to);

    if (error) { logQueryError("getSeriesPaginated", error); return { data: [], total: 0, page, pageSize }; }
    return { data: data || [], total: count || 0, page, pageSize };
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
    return (rows || []).map((r: { books: unknown }) => r.books as Book);
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
    return (rows || []).map((r: { people: unknown }) => r.people as Person);
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
    );
  } catch (e) {
    logQueryError("getRecommendationProof", e);
    return [];
  }
}

export async function getListsForBook(bookId: string, limit = 5): Promise<BookList[]> {
  try {
    const { data: rows, error } = await getSupabase()
      .from("book_lists")
      .select("lists(*)")
      .eq("book_id", bookId)
      .limit(limit);

    if (error) { logQueryError("getListsForBook", error); return []; }
    return (rows || []).map((r: { lists: unknown }) => r.lists as BookList);
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

// --- Search ---

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
