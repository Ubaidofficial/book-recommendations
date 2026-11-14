import { unstable_cache } from "next/cache";
import { supabase as getSupabase } from "./supabase";

/**
 * Reddit mentions per book (public.book_reddit_mentions, migration 007).
 *
 * Source: redditreads.com, data to 2023-03-31. The figure is a count of USERS
 * who linked the book in a subreddit (once per user per subreddit), not votes,
 * and counts from different subreddits overlap, so they are never summed.
 *
 * Reads follow the rest of the site: the inner fetcher throws on a database
 * error so unstable_cache never stores a failure; the exported wrappers catch
 * and return an empty answer, so a page never fails because of Reddit data.
 */

export const REDDIT_SOURCE_NAME = "Reddit Reads";
export const REDDIT_SOURCE_URL = "https://www.redditreads.com/";
/** The date the source's data runs to. Always shown next to a figure. */
export const REDDIT_AS_OF_LABEL = "March 2023";

export interface RedditMention {
  subreddit: string;
  users: number;
  rank: number | null;
}

const ID_CHUNK = 40;
const PAGE = 1000;
const PAGE_CAP = 10;

async function fetchMentions(bookIds: string[]): Promise<Record<string, RedditMention[]>> {
  const sb = getSupabase();
  const out: Record<string, RedditMention[]> = {};
  for (let i = 0; i < bookIds.length; i += ID_CHUNK) {
    const ids = bookIds.slice(i, i + ID_CHUNK);
    for (let page = 0; page < PAGE_CAP; page++) {
      const { data, error } = await sb
        .from("book_reddit_mentions")
        .select("book_id,subreddit,users,rank")
        .in("book_id", ids)
        .order("book_id", { ascending: true })
        .order("subreddit", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1)
        .limit(PAGE);
      if (error) throw error;
      const rows = (data || []) as Array<{ book_id: string; subreddit: string; users: number; rank: number | null }>;
      for (const r of rows) {
        if (!r.book_id || !r.subreddit || !(r.users > 0)) continue;
        (out[r.book_id] ||= []).push({ subreddit: r.subreddit, users: r.users, rank: r.rank });
      }
      if (rows.length < PAGE) break;
    }
  }
  for (const list of Object.values(out)) list.sort((a, b) => b.users - a.users || a.subreddit.localeCompare(b.subreddit));
  return out;
}

/** book id → its subreddit lists, biggest first. Books with no mentions are absent. Never throws. */
export async function getRedditMentions(cacheKey: string, bookIds: string[]): Promise<Record<string, RedditMention[]>> {
  if (bookIds.length === 0) return {};
  try {
    return await unstable_cache(() => fetchMentions(bookIds), ["reddit-mentions", cacheKey, String(bookIds.length)], {
      revalidate: 3600,
      tags: ["reddit", cacheKey],
    })();
  } catch (e) {
    console.error("[reddit] getRedditMentions failed:", e);
    return {};
  }
}

/**
 * The one figure to show on a card: the all-of-Reddit count when the book is on
 * that list, else the biggest single subreddit. Never a sum.
 */
export function redditHeadline(mentions: RedditMention[] | undefined): { users: number; subreddit: string } | null {
  if (!mentions || mentions.length === 0) return null;
  const all = mentions.find((m) => m.subreddit.toLowerCase() === "all");
  const top = all ?? mentions[0];
  return { users: top.users, subreddit: top.subreddit };
}

/** "r/books" / "all of Reddit". */
export function redditLabel(subreddit: string): string {
  return subreddit.toLowerCase() === "all" ? "all of Reddit" : `r/${subreddit}`;
}
