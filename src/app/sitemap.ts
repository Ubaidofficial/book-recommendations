import type { MetadataRoute } from "next";
import { BASE_URL, INDEXABLE_STATUSES } from "@/lib/seo";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPABASE_URL      = "https://ghpdpvatfmvsahzsqgpp.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
                          "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z";

type IndexableEntry = { slug: string; lastModified?: Date };

/**
 * `<lastmod>` is only worth emitting if it tracks real content changes —
 * a timestamp that moves on every crawl is noise Google learns to discount.
 * All four tables carry `updated_at`, populated on every indexable row, so
 * that is the signal. `created_at` is the fallback for rows predating the
 * column; a row with neither omits `lastmod` rather than carrying a
 * fabricated date.
 */
function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function getIndexableEntries(table: string): Promise<IndexableEntry[]> {
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const entries: IndexableEntry[] = [];
    let offset = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await sb
        .from(table)
        .select("slug, updated_at, created_at")
        .in("index_status", INDEXABLE_STATUSES)
        .not("slug", "is", null)
        .neq("slug", "")
        .range(offset, offset + PAGE - 1);

      if (error || !data || data.length === 0) break;
      for (const row of data) {
        if (!row.slug) continue;
        // A missing timestamp drops `lastmod` for that URL only — the URL
        // itself still belongs in the sitemap.
        const lastModified =
          parseTimestamp(row.updated_at) ?? parseTimestamp(row.created_at) ?? undefined;
        entries.push({ slug: row.slug, lastModified });
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
    return entries;
  } catch {
    return [];
  }
}

/** Newest row in a collection — the honest `lastmod` for its hub page. */
function newestOf(entries: IndexableEntry[]): Date | undefined {
  let newest: Date | undefined;
  for (const { lastModified } of entries) {
    if (!lastModified) continue;
    if (!newest || lastModified > newest) newest = lastModified;
  }
  return newest;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // One round-trip per table instead of four in series — this route is
  // force-dynamic, so every crawler hit pays the full cost.
  const [people, lists, books, series] = await Promise.all([
    getIndexableEntries("people"),
    getIndexableEntries("lists"),
    getIndexableEntries("books"),
    getIndexableEntries("series"),
  ]);

  const entriesFor = (
    prefix: string,
    entries: IndexableEntry[],
    priority: number,
  ): MetadataRoute.Sitemap =>
    entries.map((e) => ({
      url: `${BASE_URL}/${prefix}/${e.slug}`,
      lastModified: e.lastModified,
      changeFrequency: "weekly" as const,
      priority,
    }));

  // Hub pages change when their collection does, so they inherit the newest
  // row. /about, /privacy and /terms are hand-edited static copy with no
  // timestamp to draw on — they omit `lastmod` instead of claiming one.
  const newestOverall = newestOf([...people, ...lists, ...books, ...series]);

  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE_URL,              lastModified: newestOverall,     changeFrequency: "daily",   priority: 1.0 },
    { url: `${BASE_URL}/books`,   lastModified: newestOf(books),   changeFrequency: "daily",   priority: 0.9 },
    { url: `${BASE_URL}/people`,  lastModified: newestOf(people),  changeFrequency: "daily",   priority: 0.9 },
    { url: `${BASE_URL}/lists`,   lastModified: newestOf(lists),   changeFrequency: "daily",   priority: 0.8 },
    { url: `${BASE_URL}/series`,  lastModified: newestOf(series),  changeFrequency: "weekly",  priority: 0.7 },
    { url: `${BASE_URL}/about`,                                    changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE_URL}/privacy`,                                  changeFrequency: "yearly",  priority: 0.3 },
    { url: `${BASE_URL}/terms`,                                    changeFrequency: "yearly",  priority: 0.3 },
    // NOTE: /methodology is noindex — intentionally excluded from sitemap
  ];

  return [
    ...staticPages,
    ...entriesFor("people", people, 0.85),
    ...entriesFor("lists", lists, 0.8),
    ...entriesFor("books", books, 0.8),
    ...entriesFor("series", series, 0.75),
  ];
}
