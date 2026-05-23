"use client";

import Link from "next/link";
import { useState } from "react";

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="border-b border-border bg-surface sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center gap-4">
        <Link href="/" className="text-lg font-bold tracking-tight text-ink shrink-0">
          BookRecs
        </Link>

        <div className="hidden md:flex flex-1 max-w-lg">
          <form action="/books" className="relative w-full">
            <input
              type="text"
              name="q"
              placeholder="Search books, lists, authors…"
              className="w-full h-10 pl-10 pr-4 rounded-full border border-border bg-bg text-ink placeholder:text-muted/60 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
            />
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </form>
        </div>

        <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-muted ml-auto">
          <Link href="/books" className="hover:text-ink transition-colors">Books</Link>
          <Link href="/people" className="hover:text-ink transition-colors">People</Link>
          <Link href="/lists" className="hover:text-ink transition-colors">Lists</Link>
          <Link href="/series" className="hover:text-ink transition-colors">Series</Link>
          <Link href="/about" className="hover:text-ink transition-colors">About</Link>
          <Link href="/methodology" className="hover:text-ink transition-colors">Methodology</Link>
        </nav>

        <button
          className="md:hidden ml-auto p-2 rounded-md hover:bg-subtle transition-colors"
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
          <form action="/books" className="relative w-full mb-3">
            <input
              type="text"
              name="q"
              placeholder="Search books, lists, authors…"
              className="w-full h-10 pl-10 pr-4 rounded-full border border-border bg-bg text-ink placeholder:text-muted/60 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </form>
          <nav className="flex flex-col gap-2 text-sm font-medium text-muted">
            <Link href="/books" className="hover:text-ink transition-colors py-1" onClick={() => setMenuOpen(false)}>Books</Link>
            <Link href="/people" className="hover:text-ink transition-colors py-1" onClick={() => setMenuOpen(false)}>People</Link>
            <Link href="/lists" className="hover:text-ink transition-colors py-1" onClick={() => setMenuOpen(false)}>Lists</Link>
            <Link href="/series" className="hover:text-ink transition-colors py-1" onClick={() => setMenuOpen(false)}>Series</Link>
            <Link href="/about" className="hover:text-ink transition-colors py-1" onClick={() => setMenuOpen(false)}>About</Link>
            <Link href="/methodology" className="hover:text-ink transition-colors py-1" onClick={() => setMenuOpen(false)}>Methodology</Link>
          </nav>
        </div>
      )}
    </header>
  );
}
