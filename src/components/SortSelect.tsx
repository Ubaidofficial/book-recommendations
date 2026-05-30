"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

interface SortOption {
  value: string;
  label: string;
}

interface SortSelectProps {
  value: string;
  options: SortOption[];
  /** Param key — defaults to "sort". */
  paramKey?: string;
  /** When the sort changes we reset pagination to page 1. */
  resetPageKey?: string;
  className?: string;
  ariaLabel?: string;
}

/**
 * Small client island that navigates to the same URL with an updated query
 * param when the user picks a sort option. Other params (q, category) are
 * preserved; pagination resets to page 1 because the new ordering invalidates
 * any prior page offset.
 */
export function SortSelect({
  value,
  options,
  paramKey = "sort",
  resetPageKey = "page",
  className,
  ariaLabel,
}: SortSelectProps) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = new URLSearchParams(params?.toString() || "");
    if (e.target.value) {
      next.set(paramKey, e.target.value);
    } else {
      next.delete(paramKey);
    }
    next.delete(resetPageKey);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <select
      value={value}
      onChange={onChange}
      aria-label={ariaLabel}
      className={
        className ||
        "border border-border rounded-lg px-3 py-1.5 bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/20"
      }
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
