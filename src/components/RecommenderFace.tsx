"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A 24px recommender portrait that degrades in two steps: the small copy
 * first, then the full-size original if the small one fails to load, then a
 * plain tint circle. So trying a lighter image can never leave a face worse
 * off than it was with the original alone.
 *
 * An image that failed before React hydrated fires no onError afterwards, so
 * the effect also checks for an already-failed load.
 */
export function RecommenderFace({
  src,
  fallbackSrc,
  className = "",
}: {
  src: string;
  fallbackSrc?: string;
  className?: string;
}) {
  // 0 = src, 1 = fallbackSrc, 2 = tint circle
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const ref = useRef<HTMLImageElement>(null);
  const canFallBack = Boolean(fallbackSrc) && fallbackSrc !== src;
  const next = () => setStage((s) => (s === 0 && canFallBack ? 1 : 2));

  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const current = stage === 0 ? src : stage === 1 ? fallbackSrc : "";
  if (!current) {
    return <span className="w-6 h-6 rounded-full bg-accent-light ring-2 ring-surface" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      key={stage}
      src={current}
      alt=""
      width={24}
      height={24}
      loading="lazy"
      decoding="async"
      className={className}
      onError={next}
    />
  );
}
