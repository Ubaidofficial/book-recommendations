import { Metadata } from "next";
import Link from "next/link";
import {
  getBooksWithSuspiciousDescriptions,
  getBooksWithMissingCover,
  getBooksWithInvalidRating,
  getBooksMissingDescription,
  getHighRecBooksWithQualityIssues,
} from "@/lib/data";
import { isValidHttpUrl } from "@/lib/dataQuality";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Data Quality Audit | BookRecs",
  robots: "noindex",
};

function isLocalPathCover(url: string): boolean {
  return !!url && !url.startsWith("http");
}

function coverLabel(url: string): string {
  if (!url || url.trim() === "") return "cover: missing";
  if (isLocalPathCover(url)) return "cover: local filename";
  if (isValidHttpUrl(url)) return `cover: ${url.substring(0, 60)}…`;
  return "cover: invalid URL";
}

function ratingLabel(rating: unknown): string {
  const n = Number(rating);
  if (rating == null || Number.isNaN(n)) return "rating: invalid/suppressed";
  if (n < 1 || n > 5) return "rating: invalid/suppressed";
  return `rating: ${n}`;
}

async function auditBooks() {
  const [suspiciousDesc, missingCover, invalidRating, missingDesc, highRecIssues] =
    await Promise.all([
      getBooksWithSuspiciousDescriptions(20),
      getBooksWithMissingCover(20),
      getBooksWithInvalidRating(20),
      getBooksMissingDescription(20),
      getHighRecBooksWithQualityIssues(20),
    ]);

  const allBooks = [...suspiciousDesc, ...missingCover, ...invalidRating, ...missingDesc, ...highRecIssues];
  const uniqueBooks = new Map<string, typeof allBooks[0]>();
  for (const b of allBooks) {
    if (!uniqueBooks.has(b.id)) uniqueBooks.set(b.id, b);
  }
  const sample = Array.from(uniqueBooks.values());

  return {
    sampleSize: uniqueBooks.size,
    totalWithValidCover: sample.filter((b) => isValidHttpUrl(b.cover_image_url)).length,
    totalWithLocalCover: sample.filter((b) => isLocalPathCover(b.cover_image_url)).length,
    totalMissingDesc: sample.filter((b) => !b.description || b.description.trim().length < 80).length,
    totalSuspiciousDesc: sample.filter(
      (b) => b.description && (b.description.includes("Goodreads") || b.description.includes("Tanggal Terbit") || b.description.includes("Informasi Lainnya"))
    ).length,
    totalInvalidRating: sample.filter((b) => {
      const r = Number(b.rating);
      return Number.isNaN(r) || r < 1 || r > 5;
    }).length,
    totalWithRecs: sample.filter((b) => b.recommendation_count > 0).length,
    suspiciousDesc,
    missingCover,
    invalidRating,
    missingDesc,
    highRecIssues,
  };
}

function BookRow({ book, extra }: { book: { id: string; slug: string; title: string; author: string; recommendation_count: number }; extra?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3 text-xs flex flex-wrap items-center gap-x-2 gap-y-1">
      <Link href={`/books/${book.slug}`} className="font-semibold text-ink hover:text-accent transition-colors">
        {book.title}
      </Link>
      {book.author && book.author.trim().length > 0 && (
        <span className="text-muted">by {book.author}</span>
      )}
      <span className="text-muted">recs: {book.recommendation_count}</span>
      {extra}
    </div>
  );
}

export default async function DataQualityPage() {
  const data = await auditBooks();

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <div className="rounded-xl border border-accent/20 bg-accent-light/30 p-4 mb-6">
        <h2 className="text-sm font-semibold text-ink mb-1">Internal QA only</h2>
        <p className="text-xs text-muted leading-relaxed">
          This page is used to choose which pages are safe to index later. It is not linked publicly and is marked noindex.
        </p>
      </div>

      <h1 className="text-2xl font-bold text-ink mb-2">Data Quality Audit</h1>
      <p className="text-sm text-muted mb-8">
        Diagnostic sample from problem queries. Counts below are sample counts, not full database totals.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-10">
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-lg font-bold text-ink">{data.sampleSize}</div>
          <div className="text-xs text-muted mt-0.5">Sample Rows</div>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-lg font-bold text-accent">{data.totalWithValidCover}</div>
          <div className="text-xs text-muted mt-0.5">Valid Covers in Sample</div>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-lg font-bold text-amber-600">{data.totalWithLocalCover}</div>
          <div className="text-xs text-muted mt-0.5">Local Covers in Sample</div>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-lg font-bold text-red-500">{data.totalMissingDesc}</div>
          <div className="text-xs text-muted mt-0.5">Missing Descriptions</div>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-lg font-bold text-red-500">{data.totalSuspiciousDesc}</div>
          <div className="text-xs text-muted mt-0.5">Suspicious Descriptions</div>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-lg font-bold text-red-500">{data.totalInvalidRating}</div>
          <div className="text-xs text-muted mt-0.5">Invalid Ratings</div>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-lg font-bold text-accent">{data.totalWithRecs}</div>
          <div className="text-xs text-muted mt-0.5">With Recommendations</div>
        </div>
      </div>

      <section className="mb-10">
        <h2 className="text-lg font-bold text-ink mb-3">Suspicious Descriptions</h2>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {data.suspiciousDesc.map((b) => (
            <BookRow key={b.id} book={b} extra={
              <div className="text-muted/60 mt-1 max-w-3xl line-clamp-2 w-full">{b.description}</div>
            } />
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-bold text-ink mb-3">Missing or Invalid Covers</h2>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {data.missingCover.map((b) => (
            <BookRow key={b.id} book={b} extra={
              <span className="text-amber-600">{coverLabel(b.cover_image_url)}</span>
            } />
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-bold text-ink mb-3">Invalid Ratings</h2>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {data.invalidRating.map((b) => (
            <BookRow key={b.id} book={b} extra={
              <span className="text-red-500">{ratingLabel(b.rating)}</span>
            } />
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-bold text-ink mb-3">Missing Descriptions</h2>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {data.missingDesc.map((b) => (
            <BookRow key={b.id} book={b} />
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-bold text-ink mb-3">High-Recommendation Books with Quality Issues</h2>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {data.highRecIssues.map((b) => {
            const issues: string[] = [];
            if (!b.cover_image_url || b.cover_image_url.trim() === "") issues.push("missing cover");
            if (!b.description || b.description.trim().length < 80) issues.push("short/missing description");
            return (
              <BookRow key={b.id} book={b} extra={
                <span className="text-muted">{issues.join(" · ")}</span>
              } />
            );
          })}
        </div>
      </section>
    </div>
  );
}
