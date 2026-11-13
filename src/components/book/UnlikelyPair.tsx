import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import type { UnlikelyPair as Pair } from "@/lib/bookInsights";

/**
 * "Unlikely pair": the two recommenders of this book whose reading lists
 * overlap least (Jaccard over their full shelves; see lib/bookInsights.ts).
 * Every number in the sentence is computed, never rounded or estimated.
 */
export function UnlikelyPair({ pair }: { pair: Pair | null }) {
  if (!pair) return null;
  const { a, b, shared } = pair;
  const name = (p: Pair["a"]) => (
    <Link href={`/people/${p.slug}`} className="font-semibold text-ink hover:text-accent hover:underline">
      {p.name}
    </Link>
  );
  return (
    <aside className="mb-16 flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl bg-accent-light/70 border border-accent/10 p-5 md:p-6">
      <div className="flex shrink-0" aria-hidden="true">
        <Avatar name={a.name} slug={a.slug} avatarUrl={a.avatar_url} sizeClass="w-12 h-12" textClass="text-sm" className="ring-[3px] ring-accent-light" />
        <Avatar name={b.name} slug={b.slug} avatarUrl={b.avatar_url} sizeClass="w-12 h-12" textClass="text-sm" className="ring-[3px] ring-accent-light -ml-3" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent mb-1">An unlikely pair</p>
        <p className="text-[15px] md:text-base text-ink/90 leading-relaxed">
          {name(a)} and {name(b)} both recommend it. Out of {a.shelf.toLocaleString()} and {b.shelf.toLocaleString()} picks,{" "}
          {shared === 1
            ? "this is the only book they have in common."
            : `they share only ${shared.toLocaleString()} books, and this is one of them.`}
        </p>
      </div>
    </aside>
  );
}
