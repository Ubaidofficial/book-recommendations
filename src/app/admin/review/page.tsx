import { Metadata } from "next";
import { supabase } from "@/lib/supabase";
import { ReviewQueue, type ReviewItem } from "@/components/admin/ReviewQueue";

/**
 * Private editor page: review the AI-written reader notes on published books.
 *
 * Anyone can open this page, but nothing on it can change data without a review
 * key: every decision goes through review_book_notes() (migrations/011), which
 * checks the key against a stored hash. The notes themselves are already public
 * on the book pages, so listing them here exposes nothing new.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Review reader notes | BookMentions",
  robots: "noindex, nofollow",
};

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  const s = String(value ?? "").trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
    } catch {
      /* fall through to the plain-text forms */
    }
  }
  return s.split(/\s*\|\s*|\n+/).map((v) => v.trim()).filter(Boolean);
}

async function loadQueue(): Promise<ReviewItem[]> {
  const { data, error } = await supabase()
    .from("books")
    .select("id,slug,title,author_name,recommendation_count,editorial_summary,best_for,not_for,key_themes,ai_quality_status,ai_generated_at,ai_reviewed_at")
    .eq("index_status", "published")
    .order("recommendation_count", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || [])
    .filter((b) => (b.editorial_summary || "").trim() || toList(b.best_for).length || toList(b.not_for).length)
    .map((b) => ({
      id: b.id as string,
      slug: b.slug as string,
      title: (b.title as string) || b.slug,
      author: (b.author_name as string) || "",
      recs: (b.recommendation_count as number) || 0,
      summary: (b.editorial_summary as string) || "",
      bestFor: toList(b.best_for),
      notFor: toList(b.not_for),
      themes: toList(b.key_themes),
      status: ((b.ai_quality_status as string) || "draft").toLowerCase(),
      reviewedAt: (b.ai_reviewed_at as string) || null,
    }));
}

export default async function ReviewPage() {
  let items: ReviewItem[] = [];
  let loadError = "";
  try {
    items = await loadQueue();
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }
  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-10">
      <h1 className="type-h1 text-ink mb-2">Review reader notes</h1>
      <p className="text-sm text-muted mb-6 max-w-2xl">
        AI-written reader notes on published book pages. Approve them as they are, edit then approve, or reject to hide
        them. A book page shows &ldquo;reviewed by a BookMentions editor&rdquo; only after you approve it here, and
        changes reach the live page within about five minutes.
      </p>
      {loadError ? (
        <p className="text-sm text-red-700">Could not load books: {loadError}</p>
      ) : (
        <ReviewQueue items={items} />
      )}
    </div>
  );
}
