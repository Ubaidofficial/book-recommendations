"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { searchBooks, searchPeople, searchLists, searchSeries } from "@/lib/data";
import { displayTitle } from "@/lib/display";
import type { Book, Person, BookList, Series } from "@/lib/data";

interface SearchResults {
  books: Book[];
  people: Person[];
  lists: BookList[];
  series: Series[];
}

const LIMIT = 4;

export function GlobalSearch({
  placeholder = "Search books, people, or lists…",
  className = "",
  compact = false,
}: {
  placeholder?: string;
  className?: string;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResults>({ books: [], people: [], lists: [], series: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults({ books: [], people: [], lists: [], series: [] });
      setError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const [books, people, lists, series] = await Promise.all([
        searchBooks(q, LIMIT),
        searchPeople(q, LIMIT),
        searchLists(q, LIMIT),
        searchSeries(q, LIMIT),
      ]);
      setResults({ books, people, lists, series });
    } catch {
      setError(true);
      setResults({ books: [], people: [], lists: [], series: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (v.length < 2) {
      setOpen(false);
      setResults({ books: [], people: [], lists: [], series: [] });
      setError(false);
      return;
    }
    setOpen(true);
    debounceRef.current = setTimeout(() => doSearch(v), 300);
  };

  const handleFocus = () => {
    if (query.length >= 2) setOpen(true);
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const hasResults =
    results.books.length > 0 ||
    results.people.length > 0 ||
    results.lists.length > 0 ||
    results.series.length > 0;

  const heightClass = compact ? "h-10 text-sm" : "h-14 text-base";
  const iconClass = compact ? "left-3.5 w-4 h-4" : "left-4 w-5 h-5";

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={`w-full ${heightClass} pl-12 pr-5 rounded-full border border-border bg-surface text-ink placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all shadow-sm`}
      />
      <svg
        className={`absolute ${iconClass} top-1/2 -translate-y-1/2 ${loading ? "text-accent animate-pulse" : "text-muted/40"}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>

      {open && query.length >= 2 && (
        <div className="absolute top-full mt-2 left-0 right-0 bg-surface border border-border rounded-2xl shadow-lg overflow-hidden z-50">
          {error ? (
            <div className="p-4 text-center text-sm text-muted">Search unavailable</div>
          ) : loading ? (
            <div className="p-4 text-center text-sm text-muted">Searching…</div>
          ) : !hasResults ? (
            <div className="p-4 text-center text-sm text-muted">No results found</div>
          ) : (
            <div className="py-2 max-h-[70vh] overflow-y-auto">
              {results.books.length > 0 && (
                <div className="px-4 py-2">
                  <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Books</div>
                  {results.books.map((b) => (
                    <Link
                      key={b.id}
                      href={`/books/${b.slug}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-lg hover:bg-subtle transition-colors"
                    >
                      <span className="text-sm font-medium text-ink truncate">{b.title}</span>
                      <span className="text-xs text-muted shrink-0">{b.author}</span>
                    </Link>
                  ))}
                  <Link
                    href={`/books?q=${encodeURIComponent(query)}`}
                    onClick={() => setOpen(false)}
                    className="block text-xs text-accent font-medium mt-1 hover:underline"
                  >
                    View all books →
                  </Link>
                </div>
              )}
              {results.people.length > 0 && (
                <div className="px-4 py-2 border-t border-border">
                  <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">People</div>
                  {results.people.map((p) => (
                    <Link
                      key={p.id}
                      href={`/people/${p.slug}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-lg hover:bg-subtle transition-colors"
                    >
                      <span className="text-sm font-medium text-ink truncate">{p.name}</span>
                      <span className="text-xs text-muted shrink-0">{p.role}</span>
                    </Link>
                  ))}
                  <Link
                    href={`/people?q=${encodeURIComponent(query)}`}
                    onClick={() => setOpen(false)}
                    className="block text-xs text-accent font-medium mt-1 hover:underline"
                  >
                    View all people →
                  </Link>
                </div>
              )}
              {results.lists.length > 0 && (
                <div className="px-4 py-2 border-t border-border">
                  <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Lists</div>
                  {results.lists.map((l) => (
                    <Link
                      key={l.id}
                      href={`/lists/${l.slug}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-lg hover:bg-subtle transition-colors"
                    >
                      <span className="text-sm font-medium text-ink truncate">{displayTitle(l.title)}</span>
                      <span className="text-xs text-muted shrink-0">{l.book_count} books</span>
                    </Link>
                  ))}
                  <Link
                    href={`/lists?q=${encodeURIComponent(query)}`}
                    onClick={() => setOpen(false)}
                    className="block text-xs text-accent font-medium mt-1 hover:underline"
                  >
                    View all lists →
                  </Link>
                </div>
              )}
              {results.series.length > 0 && (
                <div className="px-4 py-2 border-t border-border">
                  <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Series</div>
                  {results.series.map((s) => (
                    <Link
                      key={s.id}
                      href={`/series/${s.slug}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-lg hover:bg-subtle transition-colors"
                    >
                      <span className="text-sm font-medium text-ink truncate">{displayTitle(s.title)}</span>
                      <span className="text-xs text-muted shrink-0">{s.book_count} books</span>
                    </Link>
                  ))}
                  <Link
                    href={`/series?q=${encodeURIComponent(query)}`}
                    onClick={() => setOpen(false)}
                    className="block text-xs text-accent font-medium mt-1 hover:underline"
                  >
                    View all series →
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
