-- Community (Reddit, Hacker News) recommendation signal per book.
--
-- One row per (book, source). Built offline by
--   scripts/community/arctic_shift_ingest.py   (Reddit threads, 2015 onwards)
--   scripts/community/hn_ingest.py             (Ask HN book threads, 2015 onwards)
--   scripts/community/match_book_mentions.py   (find catalog books in replies)
--   scripts/community/load_community_mentions.py (upsert into this table)
--
-- thread_count  distinct threads in which the book was recommended in a
--               top-level reply (the main popularity number)
-- comment_count top-level replies that named the book
-- upvotes       sum of the best reply's score per thread (Reddit); for HN, the
--               reply count under that comment (Algolia exposes no comment score)
-- top_comments  up to 5 {community, score, year, thread_title, snippet, url}
-- top_threads   up to 5 {community, title, comments, year, url}
-- source_rank   1 = most-recommended book in that source
--
-- Usernames are never stored. Snippets are capped at ~280 characters and
-- always link back to the original comment.

create table if not exists public.book_community_mentions (
  book_id       uuid        not null references public.books(id) on delete cascade,
  source        text        not null check (source in ('reddit', 'hackernews')),
  thread_count  integer     not null check (thread_count > 0),
  comment_count integer     not null default 0,
  upvotes       integer     not null default 0,
  first_year    smallint,
  last_year     smallint,
  by_year       jsonb       not null default '{}'::jsonb,
  communities   jsonb       not null default '{}'::jsonb,
  top_comments  jsonb       not null default '[]'::jsonb,
  top_threads   jsonb       not null default '[]'::jsonb,
  source_rank   integer,
  computed_at   timestamptz not null default now(),
  primary key (book_id, source)
);

create index if not exists book_community_mentions_rank_idx
  on public.book_community_mentions (source, source_rank);

alter table public.book_community_mentions enable row level security;

drop policy if exists "Public can read book community mentions" on public.book_community_mentions;
create policy "Public can read book community mentions"
  on public.book_community_mentions for select to anon using (true);
