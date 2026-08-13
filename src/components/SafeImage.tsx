"use client";

import { useState } from "react";

interface SafeImageProps {
  src: string;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
  /**
   * Set "eager" for the one image above the fold (a book's own cover, a
   * person's portrait). Everything in a grid should stay lazy.
   */
  loading?: "lazy" | "eager";
  /** Intrinsic size, when known, to reserve space and avoid layout shift. */
  width?: number;
  height?: number;
}

/**
 * An <img> that degrades to `fallback` when the source fails to load.
 *
 * Lazy by default. This matters more since list pages went from 48 covers to
 * 100: every cover was being fetched eagerly, which is how a list page reached
 * 846KB and stalled its own largest-contentful paint behind 99 images nobody
 * had scrolled to yet. Callers rendering a hero image opt into "eager".
 *
 * `decoding="async"` keeps image decode off the main thread, so a long grid
 * cannot block interaction while it paints.
 */
export function SafeImage({
  src,
  alt,
  className,
  fallback,
  loading = "lazy",
  width,
  height,
}: SafeImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return <>{fallback || null}</>;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      decoding="async"
      width={width}
      height={height}
      onError={() => setFailed(true)}
    />
  );
}
