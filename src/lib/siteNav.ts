/**
 * Data for the site chrome: header mega menus, footer link columns and the
 * homepage consensus shelf. One cached read per section, shared by every page.
 *
 * Each section falls back to a static snapshot when the database cannot be
 * read, so the header, footer and homepage always render real, crawlable
 * links. The fetchers throw inside unstable_cache, so a failed read is never
 * cached as an empty menu.
 */
import { unstable_cache } from "next/cache";
import { supabase as getSupabase } from "./supabase";
import { INDEXABLE_STATUSES } from "./seo";
import { isValidHttpUrl, repairEncoding } from "./dataQuality";
import { displayBookTitle, displayListTitle, displayListTitleFull } from "./display";
import { FALLBACK_NAV } from "./siteNavFallback";

export interface NavBook {
  slug: string;
  title: string;
  author: string;
  /** People recommending the book (books.recommendation_count). */
  count: number;
  pageCount: number | null;
  /** A cover safe to show, or "" (draw a neutral cover instead). */
  cover: string;
}

export interface NavPerson {
  slug: string;
  name: string;
  avatar: string;
  /** Books this person recommends. */
  count: number;
}

export interface NavList {
  slug: string;
  title: string;
  count: number;
}

export interface SiteNav {
  /** Most-recommended published books, best first (up to 24). */
  books: NavBook[];
  /** Published people with the most recommendations (up to 12). */
  people: NavPerson[];
  /** Broad subject lists: Fiction, History, Science… (up to 12). */
  topics: NavList[];
  /** "Books recommended by …" lists (up to 12). */
  recommendedBy: NavList[];
  /** Narrow "Best … books" lists with the most books (up to 12). */
  popularLists: NavList[];
}

/**
 * Google Books ids whose zoom=3 image is not the book's cover: Google's
 * "image not available" placeholder or blank grey cover art, or a scanned interior page (title page,
 * praise page) that Google serves in place of a cover. Checked by hand
 * against the most-recommended books on 2026-11-12.
 */
const BAD_GOOGLE_COVER_IDS = new Set([
  "tVX00AEACAAJ", // "image not available"
  "6LGuDgAAQBAJ", // Principles: title page
  "hCf-DwAAQBAJ", // How to Win Friends and Influence People: title page
  "TnrrDwAAQBAJ", // The Psychology of Money: title page
  "8U2oAAAAQBAJ", // Steve Jobs: praise page
  "2EWNEAAAQBAJ", // Thinking, Fast and Slow: Google's grey "no cover" art
]);

/** A cover URL that is safe to show next to its title. */
export function isDisplayableCover(url: string | null | undefined): boolean {
  if (!isValidHttpUrl(url)) return false;
  try {
    const u = new URL(String(url).trim());
    if (/(^|\.)books\.google\./i.test(u.hostname) || /googleusercontent\.com$/i.test(u.hostname)) {
      const id = u.searchParams.get("id");
      if (id && BAD_GOOGLE_COVER_IDS.has(id)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Broad-subject lists are the ones without a "best-" or "books-recommended-by-" slug. */
function isTopicSlug(slug: string): boolean {
  return !slug.startsWith("best-") && !slug.startsWith("books-recommended-by-") && slug !== "most-recommended-books";
}

async function fetchBooks(): Promise<NavBook[]> {
  const { data, error } = await getSupabase()
    .from("books")
    .select("slug, title, author_name, recommendation_count, page_count, cover_image_url")
    .in("index_status", INDEXABLE_STATUSES)
    .not("slug", "is", null)
    .order("recommendation_count", { ascending: false, nullsFirst: false })
    .order("slug")
    .limit(24);
  if (error) throw new Error(`site nav books: ${error.message}`);
  const rows = (data || [])
    .filter((b) => b && b.slug && b.title && (b.recommendation_count || 0) > 0)
    .map((b) => ({
      slug: b.slug as string,
      title: displayBookTitle(b.title),
      author: repairEncoding(String(b.author_name || "")).trim(),
      count: Number(b.recommendation_count) || 0,
      pageCount: typeof b.page_count === "number" && b.page_count > 0 ? b.page_count : null,
      cover: isDisplayableCover(b.cover_image_url) ? String(b.cover_image_url).trim() : "",
    }));
  if (rows.length === 0) throw new Error("site nav books: no rows");
  return rows;
}

async function fetchPeople(): Promise<NavPerson[]> {
  const { data, error } = await getSupabase()
    .from("people")
    .select("slug, name, avatar_url, recs:book_recommendations(count)")
    .in("index_status", INDEXABLE_STATUSES)
    .not("slug", "is", null)
    .limit(500);
  if (error) throw new Error(`site nav people: ${error.message}`);
  const rows = ((data || []) as Array<{ slug: string; name: string; avatar_url: string | null; recs?: Array<{ count?: number }> }>)
    .filter((p) => p && p.slug && p.name)
    .map((p) => ({
      slug: p.slug,
      name: repairEncoding(p.name).trim(),
      avatar: isValidHttpUrl(p.avatar_url) ? String(p.avatar_url).trim() : "",
      count: Array.isArray(p.recs) && typeof p.recs[0]?.count === "number" ? p.recs[0].count : 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 12);
  if (rows.length === 0) throw new Error("site nav people: no rows");
  return rows;
}

async function fetchLists(): Promise<Pick<SiteNav, "topics" | "recommendedBy" | "popularLists">> {
  const { data, error } = await getSupabase()
    .from("lists")
    .select("slug, title, book_count")
    .in("index_status", INDEXABLE_STATUSES)
    .not("slug", "is", null)
    .order("book_count", { ascending: false, nullsFirst: false })
    .order("slug")
    .limit(400);
  if (error) throw new Error(`site nav lists: ${error.message}`);
  const rows = (data || [])
    .filter((l) => l && l.slug)
    .map((l) => ({
      slug: String(l.slug),
      // "Best Math Books" for the narrow lists; the broad subjects keep their
      // short name ("History"), which reads as a topic in a menu.
      title: String(l.slug).startsWith("best-") ? displayListTitleFull(l.title, l.slug) : displayListTitle(l.title, l.slug),
      count: Number(l.book_count) || 0,
    }))
    .filter((l) => l.title);
  const out = {
    topics: rows.filter((l) => isTopicSlug(l.slug)).slice(0, 12),
    recommendedBy: rows.filter((l) => l.slug.startsWith("books-recommended-by-")).slice(0, 12),
    popularLists: rows.filter((l) => l.slug.startsWith("best-")).slice(0, 12),
  };
  if (out.topics.length === 0 && out.recommendedBy.length === 0 && out.popularLists.length === 0) {
    throw new Error("site nav lists: no rows");
  }
  return out;
}

const cachedBooks = unstable_cache(fetchBooks, ["site-nav-books-v2"], { revalidate: 900, tags: ["books"] });
const cachedPeople = unstable_cache(fetchPeople, ["site-nav-people-v2"], { revalidate: 900, tags: ["recommendations"] });
const cachedLists = unstable_cache(fetchLists, ["site-nav-lists-v2"], { revalidate: 900, tags: ["lists"] });

async function orFallback<T>(label: string, read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (e) {
    console.error(`[siteNav] ${label} unavailable, using the static snapshot:`, e);
    return fallback;
  }
}

/** Header, footer and homepage-shelf data. Never throws. */
export async function getSiteNav(): Promise<SiteNav> {
  const [books, people, lists] = await Promise.all([
    orFallback("books", cachedBooks, FALLBACK_NAV.books),
    orFallback("people", cachedPeople, FALLBACK_NAV.people),
    orFallback("lists", cachedLists, {
      topics: FALLBACK_NAV.topics,
      recommendedBy: FALLBACK_NAV.recommendedBy,
      popularLists: FALLBACK_NAV.popularLists,
    }),
  ]);
  return { books, people, ...lists };
}
