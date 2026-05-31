"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function BooksErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[books-error-boundary]", error);
  }, [error]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-accent-light flex items-center justify-center mb-6">
        <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h1 className="text-2xl md:text-3xl font-bold text-ink tracking-tight mb-3">Failed to load books</h1>
      <p className="text-sm md:text-base text-muted max-w-md mb-8 leading-relaxed">
        We encountered an error while trying to load the requested books. This might be a temporary connection issue. Please try again.
      </p>
      <div className="flex items-center gap-4 flex-wrap justify-center">
        <button
          onClick={() => reset()}
          className="inline-flex items-center justify-center px-6 py-3 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent-hover transition-colors shadow-sm cursor-pointer"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex items-center justify-center px-6 py-3 rounded-full bg-subtle border border-border text-sm text-ink font-semibold hover:bg-border/30 transition-colors"
        >
          Go back home
        </Link>
      </div>
    </div>
  );
}
