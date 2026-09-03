import { Metadata } from "next";
import Link from "next/link";
import { getAuthorCatalogIndexCached } from "@/lib/data";
import { Breadcrumbs } from "@/components";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Authors Catalog",
  description: "Browse authors with recommended books in the BookMentions catalog.",
  path: "/authors",
  robots: "noindex, follow", // noindex, follow as requested
});

export default async function AuthorsIndexPage() {
  const authors = await getAuthorCatalogIndexCached(100);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Authors" },
        ]}
      />

      <div className="mb-10">
        <h1 className="text-2xl md:text-3xl font-bold text-ink tracking-tight mb-2">
          Authors
        </h1>
        <p className="text-base text-muted max-w-2xl leading-relaxed">
          Browse authors with recommended books in the BookMentions catalog.
        </p>
      </div>

      {authors.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-14">
          {authors.map((author) => (
            <Link
              key={author.slug}
              href={`/authors/${author.slug}`}
              className="group block rounded-2xl border border-border bg-surface p-5 hover:shadow-lg hover:border-accent/20 transition-all duration-200"
            >
              <h2 className="font-semibold text-base text-ink mb-2 group-hover:text-accent transition-colors line-clamp-1">
                {author.authorName}
              </h2>
              <div className="flex flex-wrap items-center gap-2.5 text-xs text-muted">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-accent-light text-accent font-medium">
                  {author.eligibleBookCount} {author.eligibleBookCount === 1 ? "book" : "books"}
                </span>
                {author.totalRecommendationCount > 0 && (
                  <span>
                    {author.totalRecommendationCount.toLocaleString()} recs
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 border border-dashed border-border rounded-2xl">
          <p className="text-sm text-muted">No authors found in the catalog.</p>
        </div>
      )}
    </div>
  );
}
