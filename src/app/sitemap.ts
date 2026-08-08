import type { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/seo";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL      = "https://ghpdpvatfmvsahzsqgpp.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
                          "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z";

const INDEXABLE_STATUSES = ["published", "approved", "indexed", "index"];

async function getIndexableSlugs(table: string): Promise<string[]> {
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const slugs: string[] = [];
    let offset = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await sb
        .from(table)
        .select("slug")
        .in("index_status", INDEXABLE_STATUSES)
        .not("slug", "is", null)
        .neq("slug", "")
        .range(offset, offset + PAGE - 1);

      if (error || !data || data.length === 0) break;
      for (const row of data) {
        if (row.slug) slugs.push(row.slug);
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
    return slugs;
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // Static pages (canonical, always indexable)
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE_URL,              lastModified: now, changeFrequency: "daily",   priority: 1.0 },
    { url: `${BASE_URL}/books`,   lastModified: now, changeFrequency: "daily",   priority: 0.9 },
    { url: `${BASE_URL}/people`,  lastModified: now, changeFrequency: "daily",   priority: 0.9 },
    { url: `${BASE_URL}/lists`,   lastModified: now, changeFrequency: "daily",   priority: 0.8 },
    { url: `${BASE_URL}/series`,  lastModified: now, changeFrequency: "weekly",  priority: 0.7 },
    { url: `${BASE_URL}/about`,   lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE_URL}/privacy`, lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
    { url: `${BASE_URL}/terms`,   lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
    // NOTE: /methodology is noindex — intentionally excluded from sitemap
  ];

  // Dynamic: indexable people pages
  const peopleSlugs = await getIndexableSlugs("people");
  const peoplePages: MetadataRoute.Sitemap = peopleSlugs.map((slug) => ({
    url: `${BASE_URL}/people/${slug}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.85,
  }));

  // Dynamic: indexable list pages
  const listSlugs = await getIndexableSlugs("lists");
  const listPages: MetadataRoute.Sitemap = listSlugs.map((slug) => ({
    url: `${BASE_URL}/lists/${slug}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  // Dynamic: indexable book pages
  const bookSlugs = await getIndexableSlugs("books");
  const bookPages: MetadataRoute.Sitemap = bookSlugs.map((slug) => ({
    url: `${BASE_URL}/books/${slug}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  // Dynamic: indexable series pages
  const seriesSlugs = await getIndexableSlugs("series");
  const seriesPages: MetadataRoute.Sitemap = seriesSlugs.map((slug) => ({
    url: `${BASE_URL}/series/${slug}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.75,
  }));

  return [...staticPages, ...peoplePages, ...listPages, ...bookPages, ...seriesPages];
}
