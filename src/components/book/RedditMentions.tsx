import type { RedditMention } from "@/lib/reddit";
import { REDDIT_AS_OF_LABEL, REDDIT_SOURCE_NAME, REDDIT_SOURCE_URL, redditLabel } from "@/lib/reddit";
import { BookSectionHeading } from "./primitives";

const SHOWN = 6;

/**
 * "On Reddit": the subreddits where users most often link this book.
 *
 * The figure is a count of users (one per user per subreddit), from Reddit
 * Reads and only up to March 2023, so both are said in the text; it is not a
 * vote count, and counts from different subreddits overlap, so nothing here is
 * summed. Hidden when the book has no mentions.
 */
export function RedditMentions({ bookTitle, mentions }: { bookTitle: string; mentions: RedditMention[] }) {
  if (mentions.length === 0) return null;
  const shown = mentions.slice(0, SHOWN);
  const max = Math.max(...shown.map((m) => m.users), 1);
  return (
    <section className="mb-12" aria-labelledby="on-reddit">
      <BookSectionHeading
        id="on-reddit"
        title="On Reddit"
        dek={`Where Reddit users link ${bookTitle} most. Each figure counts users, once per subreddit, up to ${REDDIT_AS_OF_LABEL}. It is not a vote count.`}
      />
      <ul data-reveal className="max-w-2xl grid gap-2.5">
        {shown.map((m) => (
          <li key={m.subreddit} className="rounded-xl border border-border bg-surface px-4 py-3">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-semibold text-ink">{redditLabel(m.subreddit)}</span>
              <span className="text-muted">
                <b className="tabular-nums text-ink">{m.users.toLocaleString("en-US")}</b> {m.users === 1 ? "user" : "users"}
              </span>
            </div>
            <span className="mt-2 block h-1.5 rounded-full bg-accent-light overflow-hidden" aria-hidden="true">
              <span className="block h-full rounded-full bg-[#ff4500]" style={{ width: `${Math.max(4, Math.round((m.users / max) * 100))}%` }} />
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">
        {mentions.length > SHOWN ? `Showing ${SHOWN} of ${mentions.length} lists. ` : ""}
        Data from{" "}
        <a href={REDDIT_SOURCE_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:underline underline-offset-2">
          {REDDIT_SOURCE_NAME}
        </a>
        , which counts Amazon, Goodreads and Google Books links in Reddit comments.
      </p>
    </section>
  );
}
