"use client";

import { useState } from "react";

/**
 * "Most recommended" / "Title A–Z" switch for a list page.
 *
 * It used to be a `?sort=` link, which made the whole list route read
 * `searchParams` and render per request (Cache-Control: no-store). Sorting is
 * now a view setting: the server always renders the same HTML, every row
 * carries its A–Z position in `--az`, and this switch only flips a `data-sort`
 * attribute on the books container (`#list-books`), where globals.css applies
 * the CSS `order`. The page stays cacheable and the rank badges keep showing
 * the recommendation rank in both views.
 */
export function ListSortControls() {
  const [sort, setSort] = useState<"recommendation" | "title">("recommendation");

  const choose = (next: "recommendation" | "title") => {
    setSort(next);
    document.getElementById("list-books")?.setAttribute("data-sort", next);
  };

  const cls = (active: boolean) =>
    `px-3 py-1 rounded-full text-xs font-semibold transition-all ${
      active ? "bg-accent-light text-accent" : "bg-subtle text-muted hover:text-ink hover:bg-border/30"
    }`;

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted text-xs">Sort by:</span>
      <button type="button" aria-pressed={sort === "recommendation"} onClick={() => choose("recommendation")} className={cls(sort === "recommendation")}>
        Most recommended
      </button>
      <button type="button" aria-pressed={sort === "title"} onClick={() => choose("title")} className={cls(sort === "title")}>
        Title A–Z
      </button>
    </div>
  );
}
