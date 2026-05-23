"use client";

import { useState } from "react";

interface SearchBarProps {
  placeholder?: string;
  basePath?: string;
  className?: string;
}

export function SearchBar({
  placeholder = "Search books, people, and lists...",
  basePath = "/books",
  className = "",
}: SearchBarProps) {
  const [query, setQuery] = useState("");

  return (
    <form action={basePath} className={`relative w-full max-w-2xl mx-auto ${className}`}>
      <input
        type="text"
        name="q"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="w-full h-14 pl-12 pr-5 rounded-full border border-border bg-surface text-ink placeholder:text-muted/50 text-base focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all shadow-sm"
      />
      <svg
        className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted/40"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    </form>
  );
}
