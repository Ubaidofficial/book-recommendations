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
          // Carve-out from the blanket `/*?*` disallow below. The /lists
          // browse-all view (`/lists?page=N&sort=...`) is the ONLY internal
          // link path to the published lists that don't fit on the /lists
          // hub — 37 of them had no crawlable inbound link at all while this
          // was blocked. getListsPaginated is filtered by LIST_PUBLIC_OR, so
          // this opens ~5 pages total, not the whole table.
          //
          // Deliberately NOT generalised to `/*?page=`: getBooksPaginated
          // applies no filter for the default "curated" scope, so /books
          // paginates all ~98,845 books (~2,060 URLs pointing at noindex
          // book pages). That stays blocked.
          //
          // Google resolves allow/disallow conflicts by longest matching
          // rule, so `/lists?page=` (12) beats `/*?*` (4).
          "/lists?page=",
        ],
        disallow: [
          "/admin/",
          "/api/",
          // Markdown twins of canonical pages. Readable by an agent handed
          // the URL, but not a second set of documents to index — the HTML
          // page is canonical and these carry X-Robots-Tag: noindex too.
          "/md/",
          "/report-issue",
          "/methodology",
          "/*?*",   // block all other query-string URLs (search, filters, sort)
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
