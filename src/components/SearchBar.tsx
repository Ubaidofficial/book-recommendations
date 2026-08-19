"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface SearchBarProps {
  placeholder?: string;
  className?: string;
}

export function SearchBar({
  placeholder = "Search...",
  className = "",
}: SearchBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // router.replace() keeps this a soft, client-side navigation (re-fetches
  // the server component's RSC payload in place) instead of the full-page
  // hard reload `window.location.search = ...` previously triggered here on
  // every search — and replace() rather than push() avoids stacking a new
  // browser-history entry on every keystroke.
  const navigate = useCallback(
    (q: string) => {
      const params = new URLSearchParams(window.location.search);
      if (q.length >= 2) {
        params.set("q", q);
      } else {
        params.delete("q");
      }
      const qs = params.toString();
      router.replace(qs ? `${window.location.pathname}?${qs}` : window.location.pathname, { scroll: false });
    },
    [router]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Debounced auto-navigate, mirroring GlobalSearch's live-results pattern,
    // so results update as the user pauses typing instead of requiring Enter.
    debounceRef.current = setTimeout(() => navigate(v), 400);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      navigate(query);
    }
  };

  const handleClear = () => {
    setQuery("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    navigate("");
  };

  return (
    <div className={`relative w-full max-w-2xl mx-auto ${className}`}>
      <input
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full h-14 pl-12 pr-12 rounded-full border border-border bg-surface text-ink placeholder:text-muted/50 text-base focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all shadow-sm"
      />
      <svg
        className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted/40"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      {query && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-subtle flex items-center justify-center hover:bg-border/50 transition-colors"
          aria-label="Clear search"
        >
          <svg className="w-3 h-3 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
