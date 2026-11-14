/**
 * Which book pages are indexable, for deciding how to link to them.
 *
 * Only ~54 of ~98,000 book pages are indexable; the rest are `noindex, follow`.
 * Every published list (100 books), series (up to 200) and person page links
 * to dozens of them, so Google discovers tens of thousands of noindex URLs by
 * following links ("Excluded by 'noindex' tag" in Search Console) and spends
 * crawl on them instead of on the ~460 pages we want indexed.
 *
 * Links to a book page that is not indexable carry `rel="nofollow"`: visitors
 * click through as before, crawlers are told not to treat the link as a path
 * to discover. When a book is published its links turn into normal links on
 * the next cache refresh, so the existing phased publishing stays the only
 * switch. nofollow is a hint to Google, not a directive; it lowers discovery,
 * it does not guarantee zero.
 *
 * Fails open: if the set cannot be read, no link is nofollowed, so an outage
 * can never nofollow a page that should be followed.
 */
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { INDEXABLE_STATUSES } from "@/lib/seo";

const SUPABASE_URL = "https://ghpdpvatfmvsahzsqgpp.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z";

// A failed read throws, so unstable_cache never stores a degraded (empty) set.
const loadIndexableBookSlugs = unstable_cache(
  async (): Promise<string[]> => {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const slugs: string[] = [];
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await sb
        .from("books")
        .select("slug")
        .in("index_status", INDEXABLE_STATUSES)
        .not("slug", "is", null)
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      for (const row of data ?? []) if (row.slug) slugs.push(row.slug);
      if (!data || data.length < PAGE) break;
    }
    // A catalogue with no indexable book at all means the read went wrong, not that none exist.
    if (slugs.length === 0) throw new Error("indexable book set came back empty");
    return slugs;
  },
  ["indexable-book-slugs-v1"],
  { revalidate: 3600, tags: ["indexable-books"] },
);

/** The indexable book slugs, or null when they could not be read (callers must then not nofollow). */
export const getIndexableBookSlugs = cache(async (): Promise<Set<string> | null> => {
  try {
    return new Set(await loadIndexableBookSlugs());
  } catch {
    return null;
  }
});

/** `rel` for a link to /books/<slug>: "nofollow" only when the book is known not to be indexable. */
export function bookLinkRel(indexable: Set<string> | null, slug: string): string | undefined {
  return indexable && !indexable.has(slug) ? "nofollow" : undefined;
}
