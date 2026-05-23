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

// --- Books ---

export async function getBooksPaginated(
  page = 1,
  pageSize = 24,
  sort: "recommendation_count" | "rating" | "title" = "recommendation_count"
): Promise<PaginatedResult<Book>> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const col = sort === "title" ? "title" : sort;
  const asc = sort === "title";

  const { data, count, error } = await getSupabase()
    .from("books")
    .select("*", { count: "exact" })
    .order(col, { ascending: asc })
    .range(from, to);

  if (error) throw error;
  return { data: data || [], total: count || 0, page, pageSize };
}

export async function getFeaturedBooks(count = 6): Promise<Book[]> {
  const { data, error } = await getSupabase()
    .from("books")
    .select("*")
    .order("recommendation_count", { ascending: false })
    .limit(count);

  if (error) throw error;
  return data || [];
}

export async function getBookBySlug(slug: string): Promise<Book | null> {
  const { data, error } = await getSupabase()
    .from("books")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error) return null;
  return data;
}

export async function getBooksByAuthor(personId: string, limit = 12): Promise<Book[]> {
  // Uses book_authors junction table
  const { data: rows, error } = await getSupabase()
    .from("book_authors")
    .select("books(*)")
    .eq("person_id", personId)
    .order("rank", { ascending: true, foreignTable: "books" })
    .limit(limit);

  if (error) throw error;
  return (rows || []).map((r: { books: unknown }) => r.books as Book);
}

export async function getBooksBySeries(seriesId: string, limit = 12): Promise<Book[]> {
  // Uses book_series junction table
  const { data: rows, error } = await getSupabase()
    .from("book_series")
    .select("books(*)")
    .eq("series_id", seriesId)
    .order("position", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (rows || []).map((r: { books: unknown }) => r.books as Book);
}

export async function getRelatedBooks(
  bookId: string,
  limit = 4
): Promise<Book[]> {
  // Books in same series, same author, or just top-rated
  const { data, error } = await getSupabase()
    .from("books")
    .select("*")
    .neq("id", bookId)
    .order("recommendation_count", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// --- People ---

export async function getPeoplePaginated(
  page = 1,
  pageSize = 24
): Promise<PaginatedResult<Person>> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, count, error } = await getSupabase()
    .from("people")
    .select("*", { count: "exact" })
    .order("quality_score", { ascending: false })
    .range(from, to);

  if (error) throw error;
  return { data: data || [], total: count || 0, page, pageSize };
}

export async function getFeaturedPeople(count = 4): Promise<Person[]> {
  const { data, error } = await getSupabase()
    .from("people")
    .select("*")
    .order("quality_score", { ascending: false })
    .limit(count);

  if (error) throw error;
  return data || [];
}

export async function getPersonBySlug(slug: string): Promise<Person | null> {
  const { data, error } = await getSupabase()
    .from("people")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error) return null;
  return data;
}

// Count of books recommended BY this person (via book_recommendations)
export async function getPersonRecommendedCount(personId: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from("book_recommendations")
    .select("*", { count: "exact", head: true })
    .eq("person_id", personId);

  if (error) throw error;
  return count || 0;
}

// Count of books written BY this person (via book_authors)
export async function getPersonWrittenCount(personId: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from("book_authors")
    .select("*", { count: "exact", head: true })
    .eq("person_id", personId);

  if (error) throw error;
  return count || 0;
}

// Books a person has recommended (via book_recommendations → books)
export async function getPersonRecommendedBooks(personId: string, limit = 12): Promise<Book[]> {
  const { data: rows, error } = await getSupabase()
    .from("book_recommendations")
    .select("books(*)")
    .eq("person_id", personId)
    .order("recommended_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (rows || []).map((r: { books: unknown }) => r.books as Book);
}

// --- Lists ---

export async function getListsPaginated(
  page = 1,
  pageSize = 24
): Promise<PaginatedResult<BookList>> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, count, error } = await getSupabase()
    .from("lists")
    .select("*", { count: "exact" })
    .order("book_count", { ascending: false })
    .range(from, to);

  if (error) throw error;
  return { data: data || [], total: count || 0, page, pageSize };
}

export async function getFeaturedLists(count = 3): Promise<BookList[]> {
  const { data, error } = await getSupabase()
    .from("lists")
    .select("*")
    .order("book_count", { ascending: false })
    .limit(count);

  if (error) throw error;
  return data || [];
}

export async function getListBySlug(slug: string): Promise<BookList | null> {
  const { data, error } = await getSupabase()
    .from("lists")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error) return null;
  return data;
}

// Books in a list (via book_lists junction table)
export async function getBooksForList(listId: string, limit = 10): Promise<Book[]> {
  const { data: rows, error } = await getSupabase()
    .from("book_lists")
    .select("rank, books(*)")
    .eq("list_id", listId)
    .order("rank", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (rows || []).map((r: { books: unknown }) => r.books as Book);
}

// --- Series ---

export async function getSeriesPaginated(
  page = 1,
  pageSize = 24
): Promise<PaginatedResult<Series>> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, count, error } = await getSupabase()
    .from("series")
    .select("*", { count: "exact" })
    .order("book_count", { ascending: false })
    .range(from, to);

  if (error) throw error;
  return { data: data || [], total: count || 0, page, pageSize };
}

export async function getFeaturedSeries(count = 3): Promise<Series[]> {
  const { data, error } = await getSupabase()
    .from("series")
    .select("*")
    .order("book_count", { ascending: false })
    .limit(count);

  if (error) throw error;
  return data || [];
}

export async function getSeriesBySlug(slug: string): Promise<Series | null> {
  const { data, error } = await getSupabase()
    .from("series")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error) return null;
  return data;
}

// Books in a series (via book_series junction table)
export async function getBooksForSeriesDetail(seriesId: string): Promise<Book[]> {
  const { data: rows, error } = await getSupabase()
    .from("book_series")
    .select("position, books(*)")
    .eq("series_id", seriesId)
    .order("position", { ascending: true });

  if (error) throw error;
  return (rows || []).map((r: { books: unknown }) => r.books as Book);
}

// --- Recommendation Proof (via book_recommendations) ---

export async function getRecommendersForBook(
  bookId: string,
  limit = 10
): Promise<Person[]> {
  const { data: rows, error } = await getSupabase()
    .from("book_recommendations")
    .select("people(*)")
    .eq("book_id", bookId)
    .order("confidence_score", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (rows || []).map((r: { people: unknown }) => r.people as Person);
}

export async function getListsForBook(bookId: string, limit = 5): Promise<BookList[]> {
  const { data: rows, error } = await getSupabase()
    .from("book_lists")
    .select("lists(*)")
    .eq("book_id", bookId)
    .limit(limit);

  if (error) throw error;
  return (rows || []).map((r: { lists: unknown }) => r.lists as BookList);
}

// --- Slug → ID helpers ---
export async function getPersonIdBySlug(slug: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from("people")
    .select("id")
    .eq("slug", slug)
    .single();

  if (error || !data) return null;
  return data.id;
}

export async function getSeriesIdBySlug(slug: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from("series")
    .select("id")
    .eq("slug", slug)
    .single();

  if (error || !data) return null;
  return data.id;
}
