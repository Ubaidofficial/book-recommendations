"use client";

import { useEffect, useRef, useState } from "react";

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
  /**
   * For covers drawn with `object-cover` in a tall (2:3) box. Portrait covers
   * fill it; a roughly square cover (children's booklets, annuals) would lose
   * a third of its width to the crop, so once the image has loaded and is
   * squarer than SQUARE_MAX_RATIO it is drawn with `object-contain` instead.
   * Server HTML keeps `className` as given, so nothing shifts for portrait covers.
   */
  adaptiveFit?: boolean;
}

/** height / width below which a cover counts as square-ish and is not cropped. */
const SQUARE_MAX_RATIO = 1.15;

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
  adaptiveFit = false,
}: SafeImageProps) {
  const [failed, setFailed] = useState(false);
  const [square, setSquare] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  const measure = (el: HTMLImageElement | null) => {
    if (!adaptiveFit || !el || !el.naturalWidth || !el.naturalHeight) return;
    setSquare(el.naturalHeight / el.naturalWidth < SQUARE_MAX_RATIO);
  };
  // An image already in the cache can finish loading before React attaches onLoad.
  useEffect(() => {
    if (ref.current?.complete) measure(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, adaptiveFit]);

  if (!src || failed) {
    return <>{fallback || null}</>;
  }

  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      className={adaptiveFit && square && className ? className.replace("object-cover", "object-contain") : className}
      loading={loading}
      decoding="async"
      width={width}
      height={height}
      onLoad={(e) => measure(e.currentTarget)}
      onError={() => setFailed(true)}
    />
  );
}
