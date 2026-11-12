"use client";

import { useEffect, useState } from "react";

/** Items published within this window get a "New" badge. */
const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * "Just now", "12 minutes ago", "4 hours ago", "Yesterday", "3 days ago".
 * Older than a week falls back to the absolute date, where a relative phrase
 * stops being useful.
 */
export function relativeTime(then: Date, now: Date, absolute: string): string {
  const diff = now.getTime() - then.getTime();
  if (!Number.isFinite(diff) || diff < 0) return absolute;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return absolute;
}

/**
 * Publish time shown as "New · 4 hours ago".
 *
 * The page is cached (the homepage revalidates every 60s, other pages
 * longer), so a relative phrase rendered on the server would freeze: "2 hours
 * ago" could still be on screen the next day. The server therefore renders
 * the absolute date, and the visitor's browser swaps in the relative phrase
 * and the "New" badge after hydration, refreshing every minute. Crawlers and
 * no-JS visitors keep the absolute date, and <time dateTime> always carries
 * the exact timestamp.
 */
export function RecentTime({ iso, absolute }: { iso: string; absolute: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const then = new Date(iso);
  const valid = !Number.isNaN(then.getTime());
  const isNew = valid && now !== null && now.getTime() - then.getTime() < NEW_WINDOW_MS && now >= then;
  const label = valid && now ? relativeTime(then, now, absolute) : absolute;

  return (
    <span className="inline-flex items-center gap-1.5">
      {isNew && (
        <span className="rounded-full bg-accent-light px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
          New
        </span>
      )}
      <time dateTime={iso} title={absolute} suppressHydrationWarning>
        {label}
      </time>
    </span>
  );
}
