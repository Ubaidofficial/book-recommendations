-- Indexed author_catalog_slug + a server-side aggregate for the /authors pages.
--
-- WHY THIS EXISTS
--
-- books has no slug column for its author, so getBooksByAuthorSlug and
-- getAuthorCatalogIndex (src/lib/data.ts) resolve a slug by paging the
-- *entire* books table into Node (~98,845 rows) and matching
-- slugify(author_name) in application code. That already timed out in
-- production (57014: canceling statement due to statement timeout) — every
-- /authors/[slug] page was 404ing and /authors rendered empty, not as a
-- theoretical risk but as an observed failure.
--
-- NAMING: this column is deliberately NOT called `author_slug`. That name is
-- already load-bearing elsewhere: src/lib/jsonld.ts reads `book.author_slug`
-- to mean "this author's /people/[slug] profile" and falls back to a
-- hand-verified AUTHOR_TO_PERSON map specifically to avoid asserting a wrong
-- identity link in JSON-LD (see entityLinks.ts's own warning: "a wrong link
-- is worse than no link"). A raw slugify(author_name) column under that same
-- name would be truthy for every author and silently short-circuit that
-- fallback, reintroducing exactly the bug the curation prevents. This column
-- is a different concept — the /authors/[slug] catalog page slug — so it
-- gets a different name: author_catalog_slug.
--
-- Run this in the Supabase SQL editor, in order, one statement group at a
-- time (CREATE INDEX CONCURRENTLY cannot run inside a transaction, so if the
-- editor wraps statements in one, split them out).
--
-- IMPACT: adding a STORED generated column rewrites the table once. On
-- ~98,845 rows this should take low single-digit seconds, but it does take
-- an ACCESS EXCLUSIVE lock for that window — run it off-peak, not mid-traffic.
--
-- Do not deploy the application code that reads author_catalog_slug or calls
-- get_author_catalog_index() until this migration has been applied — both
-- will 400 against a schema that doesn't have them yet.

-- ---------------------------------------------------------------------------
-- Part 1: author_catalog_slug, generated from author_name with the exact
-- slugify() logic in src/lib/data.ts (lowercase, strip non [a-z0-9\s-],
-- collapse whitespace/hyphens to one hyphen, trim leading/trailing hyphens).
-- Postgres keeps it in sync automatically on every insert/update — no
-- backfill script, no drift.
-- ---------------------------------------------------------------------------

ALTER TABLE books ADD COLUMN author_catalog_slug text GENERATED ALWAYS AS (
  regexp_replace(
    regexp_replace(
      regexp_replace(lower(trim(author_name)), '[^a-z0-9\s-]', '', 'g'),
      '[\s-]+', '-', 'g'
    ),
    '^-+|-+$', '', 'g'
  )
) STORED;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_books_author_catalog_slug
  ON books (author_catalog_slug);

-- Verify afterwards:
--   EXPLAIN ANALYZE
--   SELECT * FROM books WHERE author_catalog_slug = 'yuval-noah-harari';
-- Expect an Index Scan, not a Seq Scan.

-- ---------------------------------------------------------------------------
-- Part 2: get_author_catalog_index(), a server-side aggregate for the
-- /authors index page. This page fundamentally has to group every eligible
-- book by author — an indexed author_catalog_slug speeds up looking up *one*
-- author, but the full listing still needs an aggregate scan either way. The
-- win here is doing that GROUP BY in Postgres (one query, one round trip)
-- instead of pulling all matching rows into Node and grouping in a Map.
-- Mirrors getAuthorCatalogIndex's eligibility filter, series exclusion, and
-- collision drop (same slug, different author_name) exactly.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_author_catalog_index(p_limit int DEFAULT 100)
RETURNS TABLE (
  author_name text,
  author_catalog_slug text,
  eligible_book_count bigint,
  total_recommendation_count bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH eligible AS (
    SELECT b.id, b.author_name, b.author_catalog_slug, b.recommendation_count
    FROM books b
    WHERE b.ai_quality_status = 'draft'
      AND b.author_name IS NOT NULL AND b.author_name <> ''
      AND b.cover_image_url IS NOT NULL AND b.cover_image_url <> ''
      AND b.slug IS NOT NULL AND b.slug <> ''
      AND b.title IS NOT NULL AND b.title <> ''
      AND b.author_catalog_slug IS NOT NULL AND b.author_catalog_slug <> ''
      AND NOT EXISTS (SELECT 1 FROM book_series bs WHERE bs.book_id = b.id)
  ),
  grouped AS (
    SELECT
      author_name,
      author_catalog_slug,
      COUNT(*) AS eligible_book_count,
      COALESCE(SUM(recommendation_count), 0) AS total_recommendation_count
    FROM eligible
    GROUP BY author_name, author_catalog_slug
  ),
  slug_name_counts AS (
    SELECT author_catalog_slug, COUNT(*) AS distinct_names
    FROM grouped
    GROUP BY author_catalog_slug
  )
  SELECT g.author_name, g.author_catalog_slug, g.eligible_book_count, g.total_recommendation_count
  FROM grouped g
  JOIN slug_name_counts c ON c.author_catalog_slug = g.author_catalog_slug
  WHERE c.distinct_names = 1
  ORDER BY g.eligible_book_count DESC, g.total_recommendation_count DESC, g.author_name ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_author_catalog_index(int) TO anon, authenticated;

-- Verify afterwards:
--   SELECT * FROM get_author_catalog_index(10);
-- Expect real rows back in well under a second.
