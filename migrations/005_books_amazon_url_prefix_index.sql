-- Index for the book page's "is this Amazon product used by another book?" check.
--
-- WHY THIS EXISTS
--
-- Every book page runs amazonProductSharedElsewhere (src/lib/data.ts):
--   books?select=title&amazon_url=like.https://www.amazon.com/dp/<ASIN>%&id=neq.<id>&limit=25
-- A LIKE 'prefix%' match can only use a btree index built with text_pattern_ops
-- (the database collation is not "C"), and books had no index on amazon_url,
-- so each book page read all ~99k rows. Supabase logs, 2026-11-08 13:00 to
-- 2026-11-09 03:00 UTC: 6,469 of these requests, 1,027 failed on the statement
-- timeout, about 88% of every Data API failure in that window. Supabase also
-- warned that the project was depleting its Disk IO budget, and from 04:00 UTC
-- on 2026-11-09 the database stopped answering most requests.
--
-- Run this in the Supabase SQL editor. CONCURRENTLY avoids locking the table,
-- so it is safe against live traffic; it cannot run inside a transaction.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_books_amazon_url_prefix
  ON books (amazon_url text_pattern_ops);
