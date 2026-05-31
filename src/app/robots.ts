import { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [
        "/",
        "/books",
        "/lists",
        "/people",
        "/series",
      ],
      disallow: [
        "/admin/",
        "/api/",
        "/report-issue",
        "/*?*", // Block all query/filter URLs
      ],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
