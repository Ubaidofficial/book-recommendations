import { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/seo";
import { getIndexedPeopleForSitemap } from "@/lib/data";

export const revalidate = 60;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routes = ["", "/books", "/lists", "/people", "/series"];

  const staticEntries: MetadataRoute.Sitemap = routes.map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
    changeFrequency: "daily" as const,
    priority: route === "" ? 1.0 : 0.8,
  }));

  try {
    const indexedPeople = await getIndexedPeopleForSitemap();
    const peopleEntries: MetadataRoute.Sitemap = indexedPeople.map((p) => ({
      url: `${BASE_URL}/people/${p.slug}`,
      lastModified: p.updated_at ? new Date(p.updated_at) : new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));
    return [...staticEntries, ...peopleEntries];
  } catch (e) {
    // Fallback: return static hub routes only if DB query fails
    console.error("[sitemap] Failed to fetch indexed people:", e);
    return staticEntries;
  }
}
