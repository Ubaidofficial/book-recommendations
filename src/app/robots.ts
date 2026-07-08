import { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        // Block the Railway staging subdomain entirely.
        // The canonical domain (bookmentions.net) is served from the same
        // deployment but gets the allow rules below. The X-Robots-Tag HTTP
        // header in next.config.js also blocks the railway.app host at the
        // HTTP level as a belt-and-suspenders guard.
        userAgent: "*",
        allow: [
          "/",
          "/books/",
          "/people/",
          "/lists/",
          "/series/",
        ],
        disallow: [
          "/admin/",
          "/api/",
          "/report-issue",
          "/methodology",
          "/*?*",   // block all query-string URLs (pagination, filters)
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
