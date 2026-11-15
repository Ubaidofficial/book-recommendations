"use client";

import { useEffect, useState } from "react";

/**
 * The accent part of the home headline: "Find books recommended by <hook>." The server HTML holds only the first
 * phrase, so crawlers, no-JS readers and the first paint all see the stable headline "Find books recommended by
 * people you trust."; after hydration the phrase rotates every few seconds. Under prefers-reduced-motion it never
 * rotates. The rotating text is not announced (the heading's label stays the stable sentence).
 */
export function RotatingHook({ phrases, intervalMs = 3200 }: { phrases: string[]; intervalMs?: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (phrases.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % phrases.length), intervalMs);
    return () => clearInterval(t);
  }, [phrases.length, intervalMs]);
  return (
    <span key={i} className={`text-accent ${i > 0 ? "hook-in" : ""}`} aria-hidden={i > 0 ? "true" : undefined}>
      {phrases[i]}.
    </span>
  );
}
