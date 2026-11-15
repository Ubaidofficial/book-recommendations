import type { RedditMention } from "@/lib/reddit";
import { REDDIT_AS_OF_LABEL, REDDIT_SOURCE_NAME, REDDIT_SOURCE_URL, redditLabel, redditSubredditUrl, redditSummary } from "@/lib/reddit";
import { BookSectionHeading } from "./primitives";

const SHOWN = 6;
const MORE = 18;

function SubLink({ subreddit, children, className = "" }: { subreddit: string; children: React.ReactNode; className?: string }) {
  const href = redditSubredditUrl(subreddit);
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="nofollow noopener noreferrer"
      title={`Open r/${subreddit} on Reddit`}
      className={`${className} hover:text-accent hover:underline underline-offset-2`}
    >
      {children}
    </a>
  );
}

/**
 * "<Title> on Reddit": a factual summary paragraph, the subreddits where users link the book most (each linked to
 * the subreddit, with the book's rank on that subreddit's list), and the long tail as links.
 *
 * Figures are user counts (one per user per subreddit) from Reddit Reads, up to March 2023, and said so in the
 * text; they are not votes, and counts from different subreddits overlap, so nothing is summed. Subreddit links
 * are external, nofollow, and open in a new tab. Hidden when the book has no mentions.
 */
export function RedditMentions({ bookTitle, mentions }: { bookTitle: string; mentions: RedditMention[] }) {
  if (mentions.length === 0) return null;
  const shown = mentions.slice(0, SHOWN);
  const more = mentions.slice(SHOWN, SHOWN + MORE);
  const left = mentions.length - shown.length - more.length;
  const max = Math.max(...shown.map((m) => m.users), 1);
  return (
    <section className="mb-12" aria-labelledby="on-reddit">
      <BookSectionHeading
        id="on-reddit"
        title={`${bookTitle} on Reddit`}
        dek={redditSummary(bookTitle, mentions)}
      />
      <ul data-reveal className="max-w-2xl grid gap-2.5">
        {shown.map((m) => (
          <li key={m.subreddit} className="rounded-xl border border-border bg-surface px-4 py-3">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-baseline gap-2">
                <SubLink subreddit={m.subreddit} className="truncate font-semibold text-ink">
                  {redditLabel(m.subreddit)}
                </SubLink>
                {m.rank != null && m.rank > 0 && (
                  <span className="shrink-0 rounded-full bg-subtle px-1.5 py-0.5 text-[11px] font-medium text-muted" title={`Rank ${m.rank} on ${redditLabel(m.subreddit)}'s most-linked books`}>
                    #{m.rank}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-muted">
                <b className="tabular-nums text-ink">{m.users.toLocaleString("en-US")}</b> {m.users === 1 ? "user" : "users"}
              </span>
            </div>
            <span className="mt-2 block h-1.5 rounded-full bg-accent-light overflow-hidden" aria-hidden="true">
              <span className="block h-full rounded-full bg-[#ff4500]" style={{ width: `${Math.max(4, Math.round((m.users / max) * 100))}%` }} />
            </span>
          </li>
        ))}
      </ul>
      {more.length > 0 && (
        <div data-reveal className="mt-4 max-w-2xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Also linked in</p>
          <ul className="flex flex-wrap gap-1.5">
            {more.map((m) => (
              <li key={m.subreddit}>
                <SubLink
                  subreddit={m.subreddit}
                  className="inline-flex items-baseline gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-[13px] text-ink"
                >
                  {redditLabel(m.subreddit)}
                  <span className="text-xs tabular-nums text-muted">{m.users.toLocaleString("en-US")}</span>
                </SubLink>
              </li>
            ))}
            {left > 0 && <li className="self-center text-xs text-muted">and {left.toLocaleString("en-US")} more</li>}
          </ul>
        </div>
      )}
      <p className="mt-4 max-w-2xl text-xs text-muted">
        Data from{" "}
        <a href={REDDIT_SOURCE_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:underline underline-offset-2">
          {REDDIT_SOURCE_NAME}
        </a>
        , which counts Amazon, Goodreads and Google Books links in Reddit comments, up to {REDDIT_AS_OF_LABEL}. A user is counted once per subreddit; counts are not votes and are never added across subreddits.
      </p>
    </section>
  );
}
