-- Verified first-publication year per book, for "<author> books in order" pages.
--
-- WHY THIS EXISTS
--
-- Series pages can only say "in order" when they hold a real order. Two
-- candidates exist today and neither is usable:
--   * book_series.position — 560 of ~87k rows carry one.
--   * books.publish_date   — free text in mixed formats, and for series books
--     it was back-filled with one year per author/series rather than per book.
--     On 2026-10-23, 2,894 of the 3,026 series with 5+ books had nearly every
--     book on the same year (every Harry Potter book reads 1997, every John
--     Grisham book 1989). Ordering by it would publish a wrong order.
--
-- first_published_year is filled per book from Open Library's work-level
-- first_publish_year by scripts/backfill_first_published_year.py (dry-run by
-- default). It stays NULL unless that script matched the book confidently, so
-- the page can gate "in publication order" wording on real coverage.
--
-- Additive and nullable: no rewrite, no default, no lock beyond the brief
-- catalog update. Safe to run while traffic is live. The app reads it through
-- `books(*)`, so it works with or without this column present.

ALTER TABLE books ADD COLUMN IF NOT EXISTS first_published_year smallint;
ALTER TABLE books ADD COLUMN IF NOT EXISTS first_published_year_source text;

-- Rollback:
--   ALTER TABLE books DROP COLUMN IF EXISTS first_published_year_source;
--   ALTER TABLE books DROP COLUMN IF EXISTS first_published_year;
