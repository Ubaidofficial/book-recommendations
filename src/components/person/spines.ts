import { isValidHttpUrl } from "@/lib/dataQuality";
import { stableHash, type ShelfBook } from "@/lib/personInsights";
import type { ShelfSpine } from "./PersonShelf";

/**
 * Cloth-binding palette for spines. Covers are remote, so there is no
 * server-side colour extraction; a neutral palette picked by a stable hash of
 * the slug keeps a book the same colour on every render and every page.
 * Each entry is [binding, ink] with the ink chosen for contrast.
 */
const PALETTE: Array<[string, string]> = [
  ["#2f3b52", "#f3efe6"],
  ["#7a3b33", "#f6ece4"],
  ["#3e5a4c", "#eef2ea"],
  ["#d9cdb4", "#2a2620"],
  ["#4b3f6b", "#efeaf8"],
  ["#1f2329", "#e9e6df"],
  ["#a8682f", "#fbf3e8"],
  ["#e9e3d6", "#2c2a26"],
  ["#5a6b7a", "#f1f3f5"],
  ["#8c2f39", "#fbeef0"],
  ["#c9a54a", "#2b2210"],
  ["#36494f", "#e8eef0"],
];

/**
 * Same curve as Book3D's bookDepthRatio. Book3D is a client module, so its
 * export can't be called during a server render; this mirrors it.
 */
function depthRatio(pageCount: number | null): number {
  if (!pageCount || !Number.isFinite(pageCount) || pageCount <= 0) return 0.13;
  return Math.min(0.22, Math.max(0.06, 0.045 + pageCount / 3000));
}

/** Turn shelf books into spine props: height from a stable hash, width from page count. */
export function toSpines(books: ShelfBook[], proofSlugs: Set<string>): ShelfSpine[] {
  return books.map((b) => {
    const h = stableHash(b.slug);
    const [color, ink] = PALETTE[h % PALETTE.length];
    return {
      slug: b.slug,
      title: b.title,
      author: b.author,
      coverUrl: isValidHttpUrl(b.cover_image_url) ? (b.cover_image_url as string) : "",
      recommendationCount: b.recommendation_count,
      pageCount: b.page_count,
      height: 172 + ((h >>> 8) % 7) * 9, // 172–226px
      width: Math.round(22 + depthRatio(b.page_count) * 110), // ~29–46px
      color,
      ink,
      hasProof: proofSlugs.has(b.slug),
    };
  });
}
