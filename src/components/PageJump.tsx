"use client";

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

interface PageJumpProps {
  currentPage: number;
  totalPages: number;
}

/**
 * Small client island for jumping straight to a page number, so reaching
 * book #9,000 of the curated catalogue doesn't require ~190 sequential
 * "Next" clicks. Preserves every other query param (q, category, sort,
 * scope) the same way SortSelect does.
 */
export function PageJump({ currentPage, totalPages }: PageJumpProps) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const [value, setValue] = useState(String(currentPage));

  const go = () => {
    const parsed = Math.round(Number(value));
    const n = Number.isFinite(parsed) ? Math.min(Math.max(1, parsed), totalPages) : currentPage;
    const next = new URLSearchParams(params?.toString() || "");
    if (n > 1) {
      next.set("page", String(n));
    } else {
      next.delete("page");
    }
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
      className="flex items-center gap-1.5 text-sm"
    >
      <label htmlFor="page-jump" className="text-muted whitespace-nowrap">
        Go to page
      </label>
      <input
        id="page-jump"
        type="number"
        min={1}
        max={totalPages}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-16 px-2 py-1.5 rounded-lg border border-border bg-surface text-ink text-center focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      <button
        type="submit"
        className="px-3 py-1.5 rounded-lg border border-border text-sm text-ink hover:border-accent hover:text-accent transition-colors"
      >
        Go
      </button>
    </form>
  );
}
