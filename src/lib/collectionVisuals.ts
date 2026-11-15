/**
 * Thumbnails for list and series cards: a person's portrait for "Books recommended by <person>" lists,
 * otherwise the first covers of the collection. One small cached read per card set, fail-soft: any error
 * returns what it has (usually {}), and the card falls back to a subject icon.
 */
import { unstable_cache } from "next/cache";
import { supabase as getSupabase } from "./supabase";
import { isDisplayableCover } from "./siteNav";
import { repairEncoding } from "./dataQuality";

export interface CollectionVisual {
  /** Up to three covers worth showing, best first. */
  covers: string[];
  /** Set for "Books recommended by <person>" lists whose person has a portrait. */
  person?: { slug: string; name: string; avatar: string } | null;
  /** The collection's stored book count, when read. */
  bookCount?: number;
}

export const PERSON_LIST_PREFIX = "books-recommended-by-";

const COVERS = 3;

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

async function fetchListVisuals(slugs: string[]): Promise<Record<string, CollectionVisual>> {
  const sb = getSupabase();
  const out: Record<string, CollectionVisual> = {};
  const { data: lists, error } = await sb.from("lists").select("id,slug,book_count").in("slug", slugs);
  if (error) throw new Error(`list visuals: ${error.message}`);
  const rows = ((lists || []) as Array<{ id: string; slug: string; book_count: number | null }>)
    .filter((l) => l && l.id && l.slug)
    .sort((a, b) => a.slug.localeCompare(b.slug));

  // Each list's own books, in the list's own order (book_lists.rank, then site-wide recommendations).
  const candidates = new Map<string, string[]>();
  await Promise.all(
    rows.map(async (l) => {
      const { data, error: e } = await sb
        .from("book_lists")
        .select("rank,books(cover_image_url,recommendation_count)")
        .eq("list_id", l.id)
        .order("rank", { ascending: true, nullsFirst: false })
        .limit(60);
      if (e) throw new Error(`list visuals covers: ${e.message}`);
      const books = ((data || []) as unknown as Array<{ rank: number | null; books: { cover_image_url: string | null; recommendation_count: number | null } | null }>)
        .filter((r) => r.books && isDisplayableCover(r.books.cover_image_url))
        .sort(
          (a, b) =>
            (a.rank ?? Infinity) - (b.rank ?? Infinity) || (b.books!.recommendation_count || 0) - (a.books!.recommendation_count || 0),
        );
      candidates.set(l.slug, uniq(books.map((r) => String(r.books!.cover_image_url))));
    }),
  );

  // Portraits for "Books recommended by <person>" lists.
  const personSlugs = uniq(rows.map((l) => l.slug).filter((s) => s.startsWith(PERSON_LIST_PREFIX)).map((s) => s.slice(PERSON_LIST_PREFIX.length)));
  const people = new Map<string, { slug: string; name: string; avatar: string }>();
  if (personSlugs.length > 0) {
    const { data, error: pe } = await sb.from("people").select("slug,name,avatar_url").in("slug", personSlugs);
    if (pe) throw new Error(`list visuals people: ${pe.message}`);
    for (const p of (data || []) as Array<{ slug: string | null; name: string | null; avatar_url: string | null }>) {
      const avatar = (p.avatar_url || "").trim();
      if (p.slug && p.name && /^https?:\/\//i.test(avatar)) people.set(p.slug, { slug: p.slug, name: repairEncoding(p.name), avatar });
    }
  }

  // Pick each list's covers from its own books, but skip a cover another list on this page already shows, so
  // lists that share their top books (the role lists all open with Sapiens) still look like different lists.
  // A list with too few distinct books left falls back to its own top ones.
  const used = new Set<string>();
  for (const l of rows) {
    const person = people.get(l.slug.startsWith(PERSON_LIST_PREFIX) ? l.slug.slice(PERSON_LIST_PREFIX.length) : "") || null;
    const own = candidates.get(l.slug) || [];
    let covers: string[] = [];
    if (!person) {
      covers = own.filter((c) => !used.has(c)).slice(0, COVERS);
      if (covers.length < COVERS) covers = [...covers, ...own.filter((c) => !covers.includes(c))].slice(0, COVERS);
      covers.forEach((c) => used.add(c));
    }
    out[l.slug] = { covers, person, bookCount: Number(l.book_count) || 0 };
  }
  return out;
}

async function fetchSeriesVisuals(slugs: string[]): Promise<Record<string, CollectionVisual>> {
  const sb = getSupabase();
  const out: Record<string, CollectionVisual> = {};
  const { data: series, error } = await sb.from("series").select("id,slug,book_count").in("slug", slugs);
  if (error) throw new Error(`series visuals: ${error.message}`);
  const rows = (series || []).filter((s) => s && s.id && s.slug) as Array<{ id: string; slug: string; book_count: number | null }>;
  await Promise.all(
    rows.map(async (s) => {
      const { data, error: e } = await sb
        .from("book_series")
        .select("position,books(cover_image_url)")
        .eq("series_id", s.id)
        .order("position", { ascending: true, nullsFirst: false })
        .limit(12);
      if (e) throw new Error(`series visuals covers: ${e.message}`);
      const covers = ((data || []) as unknown as Array<{ books: { cover_image_url: string | null } | null }>)
        .map((r) => r.books?.cover_image_url)
        .filter((u): u is string => isDisplayableCover(u));
      out[s.slug] = { covers: uniq(covers).slice(0, COVERS), bookCount: Number(s.book_count) || 0 };
    }),
  );
  return out;
}

function cachedBySlugs(kind: "lists" | "series", fetcher: (slugs: string[]) => Promise<Record<string, CollectionVisual>>) {
  return async (slugs: string[]): Promise<Record<string, CollectionVisual>> => {
    const list = uniq(slugs.map((s) => (s || "").trim()).filter(Boolean)).sort().slice(0, 120);
    if (list.length === 0) return {};
    try {
      // A thrown error is never stored by unstable_cache, so a failed read is retried on the next request.
      return await unstable_cache(() => fetcher(list), [`collection-visuals-v2-${kind}`, ...list], {
        revalidate: 3600,
        tags: [kind, "books"],
      })();
    } catch (e) {
      console.error(`[collectionVisuals] ${kind} failed:`, e);
      return {};
    }
  };
}

/** Thumbnails for the given list slugs, keyed by slug. Never throws. */
export const getListVisuals = cachedBySlugs("lists", fetchListVisuals);
/** Thumbnails for the given series slugs, keyed by slug. Never throws. */
export const getSeriesVisuals = cachedBySlugs("series", fetchSeriesVisuals);
