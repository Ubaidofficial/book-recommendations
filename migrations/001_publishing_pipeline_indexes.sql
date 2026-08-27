-- Indexes the publishing pipeline depends on.
--
-- WHY THIS EXISTS
--
-- books has ~98,845 rows and no index on recommendation_count or index_status.
-- Every query that ranks or filters on them does a full scan, and they
-- intermittently exceed the statement timeout. That is not a theoretical
-- concern — it has already caused two silent production failures:
--
--   1. getBooksPaginated timed out, returned [], and the homepage rendered a
--      "Popular Books" heading above nothing while /books listed no books at
--      all. Neither page errored; they just showed less.
--
--   2. The batch publisher's Tier 3 query timed out mid-run, so a mixed batch
--      silently became people-only. On a daily schedule that would skew what
--      the site publishes with no signal that anything went wrong.
--
-- Run this in the Supabase SQL editor. CONCURRENTLY avoids locking the table,
-- so it is safe against live traffic; it cannot run inside a transaction, so
-- execute the statements one at a time if the editor wraps them.

-- Ranking books by how often they are recommended: the publisher's Tier 3
-- query, the homepage rails, /books, and the genre classifier pool.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_books_recommendation_count
  ON books (recommendation_count DESC NULLS LAST);

-- Every candidate query filters on publication state, and the sitemap reads
-- it for all four content tables.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_books_index_status
  ON books (index_status);

-- The publisher's hot path is "eligible books, best first" — both columns
-- together, so the planner can satisfy filter and sort from one index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_books_status_recs
  ON books (index_status, recommendation_count DESC NULLS LAST);

-- Recommendation fan-out: list recommender depth, book recommender lists, and
-- the person proof queries all filter on these.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_book_recs_book_id
  ON book_recommendations (book_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_book_recs_person_id
  ON book_recommendations (person_id);

-- List membership, read on every list page and by the depth gate.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_book_lists_list_id
  ON book_lists (list_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_book_lists_book_id
  ON book_lists (book_id);

-- Verify afterwards:
--   EXPLAIN ANALYZE
--   SELECT id FROM books
--   WHERE index_status = 'noindex' AND recommendation_count >= 3
--   ORDER BY recommendation_count DESC LIMIT 500;
-- Expect an Index Scan, not a Seq Scan, and single-digit milliseconds.
