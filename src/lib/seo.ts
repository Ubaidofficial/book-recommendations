export const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://bookmentions.net";

export function canonicalUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

export function isIndexable(row: { index_status?: string } | null | undefined): boolean {
  // Detail pages are unconditionally gated from indexation for initial launch
  return false;
}

export function robotsDirective(row: { index_status?: string } | null | undefined): string {
  return "noindex, follow";
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
    title: `${title} | BookRecs`,
    description,
    alternates: { canonical: canonicalUrl(path) },
    robots: robots || "index, follow",
    openGraph: {
      title: `${title} | BookRecs`,
      description,
      url: canonicalUrl(path),
      siteName: "BookRecs",
      images: image ? [{ url: image }] : [],
      type,
    },
    twitter: {
      card: "summary_large_image" as const,
      title: `${title} | BookRecs`,
      description,
      images: image ? [image] : [],
    },
  };
}
