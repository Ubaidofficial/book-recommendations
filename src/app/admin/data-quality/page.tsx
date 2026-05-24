import { Metadata } from "next";
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

async function auditBooks() {
  const [suspiciousDesc, missingCover, invalidRating, missingDesc, highRecIssues] =
    await Promise.all([
      getBooksWithSuspiciousDescriptions(20),
      getBooksWithMissingCover(20),
      getBooksWithInvalidRating(20),
      getBooksMissingDescription(20),
      getHighRecBooksWithQualityIssues(20),
    ]);

  // Compute from fetched data — avoid separate count queries
  const allBooks = [...suspiciousDesc, ...missingCover, ...invalidRating, ...missingDesc, ...highRecIssues];
  const uniqueBooks = new Map<string, typeof allBooks[0]>();
  for (const b of allBooks) {
    if (!uniqueBooks.has(b.id)) uniqueBooks.set(b.id, b);
  }
  const sample = Array.from(uniqueBooks.values());

  const totalWithValidCover = sample.filter((b) => isValidHttpUrl(b.cover_image_url)).length;
  const totalWithLocalCover = sample.filter((b) => isLocalPathCover(b.cover_image_url)).length;
  const totalMissingDesc = sample.filter((b) => !b.description || b.description.trim().length < 80).length;
  const totalSuspiciousDesc = sample.filter(
    (b) => b.description && (b.description.includes("Goodreads") || b.description.includes("Tanggal Terbit") || b.description.includes("Informasi Lainnya"))
  ).length;
  const totalInvalidRating = sample.filter((b) => {
    const r = Number(b.rating);
    return Number.isNaN(r) || r < 1 || r > 5;
  }).length;
  const totalWithRecs = sample.filter((b) => b.recommendation_count > 0).length;

  return {
    sampleSize: uniqueBooks.size,
    totalWithValidCover,
    totalWithLocalCover,
    totalMissingDesc,
    totalSuspiciousDesc,
    totalInvalidRating,
    totalWithRecs,
    suspiciousDesc,
    missingCover,
    invalidRating,
    missingDesc,
    highRecIssues,
  };
}

export default async function DataQualityPage() {
  const data = await auditBooks();

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <h1 className="text-2xl font-bold text-ink mb-2">Data Quality Audit</h1>
      <p className="text-sm text-muted mb-8">Sample of {data.sampleSize} books from problem queries. Internal use only.</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-10">
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-lg font-bold text-ink">{data.sampleSize}</div>
          <div className="text-xs text-muted mt-0.5">Sampled</div>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-lg font-bold text-accent">{data.totalWithValidCover}</div>
          <div className="text-xs text-muted mt-0.5">Valid Covers</div>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-lg font-bold text-amber-600">{data.totalWithLocalCover}</div>
          <div className="text-xs text-muted mt-0.5">Local Covers</div>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-lg font-bold text-red-500">{data.totalMissingDesc}</div>
          <div className="text-xs text-muted mt-0.5">No Desc</div>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-lg font-bold text-red-500">{data.totalSuspiciousDesc}</div>
          <div className="text-xs text-muted mt-0.5">Bad Desc</div>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-lg font-bold text-red-500">{data.totalInvalidRating}</div>
          <div className="text-xs text-muted mt-0.5">Bad Ratings</div>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3 text-center">
          <div className="text-lg font-bold text-accent">{data.totalWithRecs}</div>
          <div className="text-xs text-muted mt-0.5">Has Recs</div>
        </div>
      </div>

      <section className="mb-10">
        <h2 className="text-lg font-bold text-ink mb-3">Suspicious Descriptions</h2>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {data.suspiciousDesc.map((b) => (
            <div key={b.id} className="rounded-lg border border-border bg-surface p-3 text-xs">
              <span className="font-semibold text-ink">{b.title}</span>
              <span className="text-muted ml-2">by {b.author}</span>
              <span className="text-muted ml-2">recs: {b.recommendation_count}</span>
              <div className="text-muted/60 mt-1 max-w-3xl line-clamp-2">{b.description}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-bold text-ink mb-3">Missing or Invalid Covers</h2>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {data.missingCover.map((b) => (
            <div key={b.id} className="rounded-lg border border-border bg-surface p-3 text-xs">
              <span className="font-semibold text-ink">{b.title}</span>
              <span className="text-muted ml-2">by {b.author}</span>
              <span className="text-muted ml-2">recs: {b.recommendation_count}</span>
              <span className="text-amber-600 ml-2">
                cover: {b.cover_image_url || "(empty)"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-bold text-ink mb-3">Invalid Ratings</h2>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {data.invalidRating.map((b) => (
            <div key={b.id} className="rounded-lg border border-border bg-surface p-3 text-xs">
              <span className="font-semibold text-ink">{b.title}</span>
              <span className="text-muted ml-2">by {b.author}</span>
              <span className="text-red-500 ml-2">rating: {b.rating}</span>
              <span className="text-muted ml-2">recs: {b.recommendation_count}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-bold text-ink mb-3">Missing Descriptions</h2>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {data.missingDesc.map((b) => (
            <div key={b.id} className="rounded-lg border border-border bg-surface p-3 text-xs">
              <span className="font-semibold text-ink">{b.title}</span>
              <span className="text-muted ml-2">by {b.author}</span>
              <span className="text-muted ml-2">recs: {b.recommendation_count}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-bold text-ink mb-3">High-Recommendation Books with Quality Issues</h2>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {data.highRecIssues.map((b) => (
            <div key={b.id} className="rounded-lg border border-border bg-surface p-3 text-xs">
              <span className="font-semibold text-ink">{b.title}</span>
              <span className="text-muted ml-2">by {b.author}</span>
              <span className="text-accent ml-2 font-medium">recs: {b.recommendation_count}</span>
              <span className="text-muted ml-2">
                {!b.cover_image_url || b.cover_image_url.trim() === "" ? "missing cover" : ""}
                {(!b.cover_image_url || b.cover_image_url.trim() === "") && (!b.description || b.description.trim().length < 80) ? " + " : ""}
                {!b.description || b.description.trim().length < 80 ? "short/missing description" : ""}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
