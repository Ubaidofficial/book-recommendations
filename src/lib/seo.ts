export const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://bookmentions.net";

export function canonicalUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

const INDEXABLE_STATUSES = new Set(["published", "approved", "indexed", "index"]);

export function isIndexable(row: { index_status?: string } | null | undefined): boolean {
  return INDEXABLE_STATUSES.has((row?.index_status || "").toLowerCase());
}

export function robotsDirective(row: { index_status?: string } | null | undefined): string {
  return isIndexable(row) ? "index, follow" : "noindex, follow";
}

export function pageMetadata({
  title,
  description,
  path,
  image,
  type = "website",
  robots,
}: {
  title: string;
  description: string;
  path: string;
  image?: string;
  type?: "website" | "article" | "book";
  robots?: string;
}) {
  return {
    title: `${title} | BookMentions`,
    description,
    alternates: { canonical: canonicalUrl(path) },
    robots: robots || "index, follow",
    openGraph: {
      title: `${title} | BookMentions`,
      description,
      url: canonicalUrl(path),
      siteName: "BookMentions",
      images: image ? [{ url: image }] : [],
      type,
    },
    twitter: {
      card: "summary_large_image" as const,
      title: `${title} | BookMentions`,
      description,
      images: image ? [image] : [],
    },
  };
}
