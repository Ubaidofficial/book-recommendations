-- How many Reddit users recommend a book, per subreddit.
--
-- SOURCE
--   redditreads.com. It counts, per subreddit, the users who linked a book
--   (Amazon, Goodreads, Google Books or O'Reilly links in comments); a user
--   counts once per book per subreddit, by their top-voted comment. Its data
--   ends 2023-03-31, which is stored in `as_of` and must be shown with the
--   figure. The figure is a USER COUNT, not a vote count, and every surface
--   labels it that way and credits redditreads.com.
--
-- SHAPE
--   One row per (book, subreddit). `subreddit = 'all'` is the all-of-Reddit
--   list. Counts from different subreddits overlap (one user can appear in
--   several), so they must never be summed into a "total users". Show the
--   largest list a book is on, or the 'all' row when there is one.
--   If two source entries (editions) resolve to the same book and subreddit,
--   the larger count is kept.
--
-- `match_method` records how the source entry was tied to our book:
--   'asin'          the Amazon ASIN in the source link equals the ASIN in our amazon_url
--   'isbn'          the source ISBN-13 (or its ISBN-10 form) equals our isbn_13 / isbn_10
--   'title_author'  one book with the same normalized title, and the author's surname
--                   appears in the source's Amazon link text
--
-- Reads are public (the site's anon key); writes stay with the service role / SQL editor.
-- Undo: DROP TABLE public.book_reddit_mentions;

CREATE TABLE IF NOT EXISTS public.book_reddit_mentions (
  book_id      uuid        NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  subreddit    text        NOT NULL,
  users        integer     NOT NULL CHECK (users > 0),
  rank         integer     CHECK (rank > 0),
  match_method text        NOT NULL CHECK (match_method IN ('asin', 'isbn', 'title_author')),
  as_of        date        NOT NULL DEFAULT DATE '2023-03-31',
  source       text        NOT NULL DEFAULT 'redditreads.com',
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, subreddit)
);

CREATE INDEX IF NOT EXISTS idx_book_reddit_mentions_book_users
  ON public.book_reddit_mentions (book_id, users DESC);

ALTER TABLE public.book_reddit_mentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read reddit mentions" ON public.book_reddit_mentions;
CREATE POLICY "Public can read reddit mentions"
  ON public.book_reddit_mentions
  FOR SELECT
  TO anon, authenticated
  USING (true);

COMMENT ON TABLE public.book_reddit_mentions IS
  'Reddit users who recommend a book, per subreddit. Source: redditreads.com, data to 2023-03-31. A user count, not votes; counts overlap across subreddits and must not be summed.';
