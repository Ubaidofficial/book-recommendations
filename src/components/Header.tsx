"use client";

import Link from "next/link";
import { useState } from "react";
import { GlobalSearch } from "./GlobalSearch";

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="border-b border-border bg-surface sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-ink shrink-0">
          <img
            src="/bookmentions-logo.png"
            alt="BookMentions"
            className="h-8 w-8 rounded-full object-cover"
          />
          <span>BookMentions</span>
        </Link>

        <div className="hidden md:flex flex-1 max-w-lg">
          <GlobalSearch
            compact
            placeholder="Search books, lists, authors…"
          />
        </div>

        <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-muted ml-auto">
          <Link href="/books" className="hover:text-ink transition-colors focus-visible:outline-none focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1 -mx-1">Books</Link>
          <Link href="/people" className="hover:text-ink transition-colors focus-visible:outline-none focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1 -mx-1">People</Link>
          <Link href="/lists" className="hover:text-ink transition-colors focus-visible:outline-none focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1 -mx-1">Lists</Link>
          <Link href="/series" className="hover:text-ink transition-colors focus-visible:outline-none focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1 -mx-1">Series</Link>
          <Link href="/about" className="hover:text-ink transition-colors focus-visible:outline-none focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1 -mx-1">About</Link>
        </nav>

        <button
          className="md:hidden ml-auto p-2 rounded-md hover:bg-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
        >
          <svg className="w-5 h-5 text-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {menuOpen && (
        <div className="md:hidden border-t border-border bg-surface px-4 py-4 space-y-3">
          <GlobalSearch
            compact
            placeholder="Search books, lists, authors…"
            className="mb-3"
          />
          <nav className="flex flex-col gap-2 text-sm font-medium text-muted">
            <Link href="/books" className="hover:text-ink transition-colors py-1 focus-visible:outline-none focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1" onClick={() => setMenuOpen(false)}>Books</Link>
            <Link href="/people" className="hover:text-ink transition-colors py-1 focus-visible:outline-none focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1" onClick={() => setMenuOpen(false)}>People</Link>
            <Link href="/lists" className="hover:text-ink transition-colors py-1 focus-visible:outline-none focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1" onClick={() => setMenuOpen(false)}>Lists</Link>
            <Link href="/series" className="hover:text-ink transition-colors py-1 focus-visible:outline-none focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1" onClick={() => setMenuOpen(false)}>Series</Link>
            <Link href="/about" className="hover:text-ink transition-colors py-1 focus-visible:outline-none focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1" onClick={() => setMenuOpen(false)}>About</Link>
          </nav>
        </div>
      )}
    </header>
  );
}
