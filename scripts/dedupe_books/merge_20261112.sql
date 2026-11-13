-- Duplicate book merge, 2026-11-12.
--
-- Run in this order (Supabase SQL editor / MCP execute_sql as postgres):
--   1. the "backup tables" block (once)
--   2. the function definition
--   3. select public.dedupe_merge_books_20261112('<batch json>'::jsonb);  -- once per batch
--      batch json = [{"dup": "<uuid>", "canon": "<uuid>", "ord": <int>}, ...]
--      produced by scripts/dedupe_books/plan.py + batches.py (reports/dedupe_20261112/batches/).
--      ord ranks the duplicates of one canonical: the lowest ord fills a gap first.
--   4. drop function public.dedupe_merge_books_20261112(jsonb);
--
-- Each call is one transaction: any failed check raises and nothing in that
-- batch is written. Restore steps are in the COMMENT on the backup tables and at
-- the bottom of this file.

-- 1. Backup tables -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bak_books_dedupe_20261112 AS
  SELECT NULL::text AS merge_role, NULL::uuid AS canonical_id, NULL::timestamptz AS backed_up_at, b.*
  FROM public.books b WHERE false;
ALTER TABLE public.bak_books_dedupe_20261112 ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bak_book_links_dedupe_20261112 (
  table_name   text        NOT NULL,  -- book_recommendations | book_lists | book_series | book_authors | lists | series
  book_id      uuid,                  -- the row's book_id before the merge (null for lists/series rows)
  canonical_id uuid,                  -- the book it belongs to after the merge
  row_data     jsonb       NOT NULL,  -- the full row before the merge
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bak_book_links_dedupe_20261112 ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.bak_books_dedupe_20261112 IS
  'Backup for the 2026-11-12 duplicate-book merge. merge_role=duplicate: deleted rows (canonical_id = book they were merged into). merge_role=canonical_before: surviving rows before gap-fill/count update. Restore: scripts/dedupe_books/merge_20261112.sql (bottom). Re-insert duplicates with INSERT INTO books SELECT <books columns> FROM this table WHERE merge_role=''duplicate''; restore canonical fields from canonical_before rows; then restore link rows from bak_book_links_dedupe_20261112 and delete their slugs rows (entity_type=book, slug = duplicate slug).';
COMMENT ON TABLE public.bak_book_links_dedupe_20261112 IS
  'Backup for the 2026-11-12 duplicate-book merge: every book_recommendations/book_lists/book_series/book_authors row of every merged book (duplicates AND canonicals) before the merge, plus lists/series rows whose book_count was decremented. Restore: delete current link rows of the canonical_ids, then INSERT ... SELECT (jsonb_populate_record(NULL::public.<table_name>, row_data)).* for each table_name. Full steps: scripts/dedupe_books/merge_20261112.sql.';

-- 2. Merge function ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dedupe_merge_books_20261112(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_pairs int; v_canons int;
  v_recs_moved int; v_recs_dropped int;
  v_lists_moved int; v_lists_dropped int;
  v_series_moved int; v_series_dropped int;
  v_authors_moved int; v_authors_dropped int;
  v_redirects int; v_repointed int; v_deleted int; v_left int;
BEGIN
  DROP TABLE IF EXISTS pg_temp.m, pg_temp.rr, pg_temp.lr, pg_temp.sr, pg_temp.ar, pg_temp.ldrop, pg_temp.sdrop;
  CREATE TEMP TABLE m ON COMMIT DROP AS
    SELECT (e->>'dup')::uuid AS dup, (e->>'canon')::uuid AS canon, coalesce((e->>'ord')::int, 0) AS ord
    FROM jsonb_array_elements(p) e;
  SELECT count(*), count(DISTINCT canon) INTO v_pairs, v_canons FROM m;

  -- Checks ---------------------------------------------------------------
  IF v_pairs = 0 THEN RAISE EXCEPTION 'empty batch'; END IF;
  IF EXISTS (SELECT 1 FROM m WHERE dup = canon) THEN RAISE EXCEPTION 'dup = canon'; END IF;
  IF (SELECT count(DISTINCT dup) FROM m) <> v_pairs THEN RAISE EXCEPTION 'a duplicate appears twice'; END IF;
  IF EXISTS (SELECT 1 FROM m a JOIN m b ON a.dup = b.canon) THEN RAISE EXCEPTION 'a duplicate is also a canonical'; END IF;
  IF EXISTS (SELECT 1 FROM m WHERE NOT EXISTS (SELECT 1 FROM books WHERE id = m.dup)) THEN
    RAISE EXCEPTION 'duplicate row missing: %', (SELECT dup FROM m WHERE NOT EXISTS (SELECT 1 FROM books WHERE id = m.dup) LIMIT 1);
  END IF;
  IF EXISTS (SELECT 1 FROM m WHERE NOT EXISTS (SELECT 1 FROM books WHERE id = m.canon)) THEN
    RAISE EXCEPTION 'canonical row missing: %', (SELECT canon FROM m WHERE NOT EXISTS (SELECT 1 FROM books WHERE id = m.canon) LIMIT 1);
  END IF;
  IF EXISTS (SELECT 1 FROM slugs s JOIN m ON s.slug = (SELECT slug FROM books WHERE id = m.dup)) THEN
    RAISE EXCEPTION 'a duplicate slug is already in slugs';
  END IF;

  -- Backups --------------------------------------------------------------
  INSERT INTO bak_books_dedupe_20261112
    SELECT 'duplicate', m.canon, now(), b.* FROM books b JOIN m ON m.dup = b.id;
  INSERT INTO bak_books_dedupe_20261112
    SELECT 'canonical_before', b.id, now(), b.* FROM books b WHERE b.id IN (SELECT canon FROM m);
  INSERT INTO bak_book_links_dedupe_20261112 (table_name, book_id, canonical_id, row_data)
    SELECT 'book_recommendations', r.book_id, coalesce(m.canon, r.book_id), to_jsonb(r)
    FROM book_recommendations r LEFT JOIN m ON m.dup = r.book_id
    WHERE r.book_id IN (SELECT dup FROM m UNION SELECT canon FROM m);
  INSERT INTO bak_book_links_dedupe_20261112 (table_name, book_id, canonical_id, row_data)
    SELECT 'book_lists', r.book_id, coalesce(m.canon, r.book_id), to_jsonb(r)
    FROM book_lists r LEFT JOIN m ON m.dup = r.book_id
    WHERE r.book_id IN (SELECT dup FROM m UNION SELECT canon FROM m);
  INSERT INTO bak_book_links_dedupe_20261112 (table_name, book_id, canonical_id, row_data)
    SELECT 'book_series', r.book_id, coalesce(m.canon, r.book_id), to_jsonb(r)
    FROM book_series r LEFT JOIN m ON m.dup = r.book_id
    WHERE r.book_id IN (SELECT dup FROM m UNION SELECT canon FROM m);
  INSERT INTO bak_book_links_dedupe_20261112 (table_name, book_id, canonical_id, row_data)
    SELECT 'book_authors', r.book_id, coalesce(m.canon, r.book_id), to_jsonb(r)
    FROM book_authors r LEFT JOIN m ON m.dup = r.book_id
    WHERE r.book_id IN (SELECT dup FROM m UNION SELECT canon FROM m);

  -- book_recommendations: one row per (canonical, person). When the same
  -- person recommended two copies, keep the row with a clean single source
  -- (no " | " concatenation), then the longer quote, then the canonical's own.
  CREATE TEMP TABLE rr ON COMMIT DROP AS
    SELECT r.id, r.book_id, coalesce(m.canon, r.book_id) AS canon,
           row_number() OVER (
             PARTITION BY coalesce(m.canon, r.book_id), coalesce(r.person_id::text, r.id::text)
             ORDER BY (coalesce(r.source_url, '') <> '' AND position('|' IN r.source_url) = 0) DESC,
                      length(coalesce(r.quote, '')) DESC,
                      (m.dup IS NULL) DESC, r.created_at, r.id) AS rn
    FROM book_recommendations r LEFT JOIN m ON m.dup = r.book_id
    WHERE r.book_id IN (SELECT dup FROM m UNION SELECT canon FROM m);
  DELETE FROM book_recommendations WHERE id IN (SELECT id FROM rr WHERE rn > 1);
  GET DIAGNOSTICS v_recs_dropped = ROW_COUNT;
  UPDATE book_recommendations r SET book_id = rr.canon FROM rr WHERE rr.id = r.id AND rr.rn = 1 AND rr.book_id <> rr.canon;
  GET DIAGNOSTICS v_recs_moved = ROW_COUNT;

  -- book_lists: one row per (canonical, list), keeping the better (lower) rank.
  CREATE TEMP TABLE lr ON COMMIT DROP AS
    SELECT r.book_id, r.list_id, coalesce(m.canon, r.book_id) AS canon,
           row_number() OVER (PARTITION BY coalesce(m.canon, r.book_id), r.list_id
                              ORDER BY r.rank ASC NULLS LAST, (m.dup IS NULL) DESC, r.created_at) AS rn
    FROM book_lists r LEFT JOIN m ON m.dup = r.book_id
    WHERE r.book_id IN (SELECT dup FROM m UNION SELECT canon FROM m);
  CREATE TEMP TABLE ldrop ON COMMIT DROP AS SELECT list_id, count(*) AS n FROM lr WHERE rn > 1 GROUP BY list_id;
  INSERT INTO bak_book_links_dedupe_20261112 (table_name, row_data)
    SELECT 'lists', to_jsonb(l) FROM lists l WHERE l.id IN (SELECT list_id FROM ldrop);
  DELETE FROM book_lists b USING lr WHERE lr.rn > 1 AND b.book_id = lr.book_id AND b.list_id = lr.list_id;
  GET DIAGNOSTICS v_lists_dropped = ROW_COUNT;
  UPDATE book_lists b SET book_id = lr.canon FROM lr
    WHERE lr.rn = 1 AND lr.book_id <> lr.canon AND b.book_id = lr.book_id AND b.list_id = lr.list_id;
  GET DIAGNOSTICS v_lists_moved = ROW_COUNT;
  UPDATE lists l SET book_count = greatest(l.book_count - d.n, 0) FROM ldrop d WHERE d.list_id = l.id AND l.book_count IS NOT NULL;

  -- book_series: one row per (canonical, series), preferring the canonical's own row.
  CREATE TEMP TABLE sr ON COMMIT DROP AS
    SELECT r.book_id, r.series_id, coalesce(m.canon, r.book_id) AS canon,
           row_number() OVER (PARTITION BY coalesce(m.canon, r.book_id), r.series_id
                              ORDER BY (m.dup IS NULL) DESC, r.position ASC NULLS LAST, r.created_at) AS rn
    FROM book_series r LEFT JOIN m ON m.dup = r.book_id
    WHERE r.book_id IN (SELECT dup FROM m UNION SELECT canon FROM m);
  CREATE TEMP TABLE sdrop ON COMMIT DROP AS SELECT series_id, count(*) AS n FROM sr WHERE rn > 1 GROUP BY series_id;
  INSERT INTO bak_book_links_dedupe_20261112 (table_name, row_data)
    SELECT 'series', to_jsonb(s) FROM series s WHERE s.id IN (SELECT series_id FROM sdrop);
  DELETE FROM book_series b USING sr WHERE sr.rn > 1 AND b.book_id = sr.book_id AND b.series_id = sr.series_id;
  GET DIAGNOSTICS v_series_dropped = ROW_COUNT;
  UPDATE book_series b SET book_id = sr.canon FROM sr
    WHERE sr.rn = 1 AND sr.book_id <> sr.canon AND b.book_id = sr.book_id AND b.series_id = sr.series_id;
  GET DIAGNOSTICS v_series_moved = ROW_COUNT;
  UPDATE series s SET book_count = greatest(s.book_count - d.n, 0) FROM sdrop d WHERE d.series_id = s.id AND s.book_count IS NOT NULL;

  -- book_authors: one row per (canonical, person).
  CREATE TEMP TABLE ar ON COMMIT DROP AS
    SELECT r.book_id, r.person_id, coalesce(m.canon, r.book_id) AS canon,
           row_number() OVER (PARTITION BY coalesce(m.canon, r.book_id), r.person_id
                              ORDER BY (m.dup IS NULL) DESC, r.created_at) AS rn
    FROM book_authors r LEFT JOIN m ON m.dup = r.book_id
    WHERE r.book_id IN (SELECT dup FROM m UNION SELECT canon FROM m);
  DELETE FROM book_authors b USING ar WHERE ar.rn > 1 AND b.book_id = ar.book_id AND b.person_id = ar.person_id;
  GET DIAGNOSTICS v_authors_dropped = ROW_COUNT;
  UPDATE book_authors b SET book_id = ar.canon FROM ar
    WHERE ar.rn = 1 AND ar.book_id <> ar.canon AND b.book_id = ar.book_id AND b.person_id = ar.person_id;
  GET DIAGNOSTICS v_authors_moved = ROW_COUNT;

  -- Fill the canonical's empty fields from its duplicates (lowest ord first).
  -- Never overwrites a value the canonical already has.
  UPDATE books c SET
    cover_image_url = CASE WHEN coalesce(c.cover_image_url, '') ~ '^https?://' THEN c.cover_image_url
      ELSE coalesce((SELECT d.cover_image_url FROM books d JOIN m ON m.dup = d.id WHERE m.canon = c.id AND d.cover_image_url ~ '^https?://' ORDER BY m.ord LIMIT 1), c.cover_image_url) END,
    -- under 80 characters counts as empty, as in isUsefulDescription (src/lib/dataQuality.ts)
    description = CASE WHEN length(btrim(coalesce(c.description, ''))) >= 80 THEN c.description
      ELSE coalesce((SELECT d.description FROM books d JOIN m ON m.dup = d.id WHERE m.canon = c.id AND length(btrim(coalesce(d.description, ''))) >= 80 ORDER BY m.ord LIMIT 1),
                    nullif(btrim(c.description), ''),
                    (SELECT d.description FROM books d JOIN m ON m.dup = d.id WHERE m.canon = c.id AND nullif(btrim(d.description), '') IS NOT NULL ORDER BY m.ord LIMIT 1),
                    c.description) END,
    subtitle = CASE WHEN nullif(btrim(c.subtitle), '') IS NOT NULL OR position(':' IN coalesce(c.title, '')) > 0 THEN c.subtitle
      ELSE coalesce((SELECT d.subtitle FROM books d JOIN m ON m.dup = d.id WHERE m.canon = c.id AND nullif(btrim(d.subtitle), '') IS NOT NULL
                     AND d.subtitle !~* '(book|volume|vol\.?|part|no\.?|#)\s*[0-9]+\s*$' ORDER BY m.ord LIMIT 1), c.subtitle) END,
    author_name = coalesce(nullif(btrim(c.author_name), ''),
      (SELECT d.author_name FROM books d JOIN m ON m.dup = d.id WHERE m.canon = c.id AND nullif(btrim(d.author_name), '') IS NOT NULL ORDER BY m.ord LIMIT 1), c.author_name),
    isbn_10 = coalesce(nullif(btrim(c.isbn_10), ''), (SELECT d.isbn_10 FROM books d JOIN m ON m.dup = d.id WHERE m.canon = c.id AND nullif(btrim(d.isbn_10), '') IS NOT NULL ORDER BY m.ord LIMIT 1), c.isbn_10),
    isbn_13 = coalesce(nullif(btrim(c.isbn_13), ''), (SELECT d.isbn_13 FROM books d JOIN m ON m.dup = d.id WHERE m.canon = c.id AND nullif(btrim(d.isbn_13), '') IS NOT NULL ORDER BY m.ord LIMIT 1), c.isbn_13),
    page_count = coalesce(c.page_count, (SELECT d.page_count FROM books d JOIN m ON m.dup = d.id WHERE m.canon = c.id AND d.page_count > 0 ORDER BY m.ord LIMIT 1)),
    publisher = coalesce(nullif(btrim(c.publisher), ''), (SELECT d.publisher FROM books d JOIN m ON m.dup = d.id WHERE m.canon = c.id AND nullif(btrim(d.publisher), '') IS NOT NULL ORDER BY m.ord LIMIT 1), c.publisher),
    publish_date = coalesce(nullif(btrim(c.publish_date), ''), (SELECT d.publish_date FROM books d JOIN m ON m.dup = d.id WHERE m.canon = c.id AND nullif(btrim(d.publish_date), '') IS NOT NULL ORDER BY m.ord LIMIT 1), c.publish_date),
    language = coalesce(nullif(btrim(c.language), ''), (SELECT d.language FROM books d JOIN m ON m.dup = d.id WHERE m.canon = c.id AND nullif(btrim(d.language), '') IS NOT NULL ORDER BY m.ord LIMIT 1), c.language),
    open_library_id = coalesce(nullif(btrim(c.open_library_id), ''), (SELECT d.open_library_id FROM books d JOIN m ON m.dup = d.id WHERE m.canon = c.id AND nullif(btrim(d.open_library_id), '') IS NOT NULL ORDER BY m.ord LIMIT 1), c.open_library_id),
    google_books_id = coalesce(nullif(btrim(c.google_books_id), ''), (SELECT d.google_books_id FROM books d JOIN m ON m.dup = d.id WHERE m.canon = c.id AND nullif(btrim(d.google_books_id), '') IS NOT NULL ORDER BY m.ord LIMIT 1), c.google_books_id),
    amazon_url = coalesce(nullif(btrim(c.amazon_url), ''), (SELECT d.amazon_url FROM books d JOIN m ON m.dup = d.id WHERE m.canon = c.id AND nullif(btrim(d.amazon_url), '') IS NOT NULL ORDER BY m.ord LIMIT 1), c.amazon_url),
    meta_description = coalesce(nullif(btrim(c.meta_description), ''), (SELECT d.meta_description FROM books d JOIN m ON m.dup = d.id WHERE m.canon = c.id AND nullif(btrim(d.meta_description), '') IS NOT NULL ORDER BY m.ord LIMIT 1), c.meta_description)
  WHERE c.id IN (SELECT canon FROM m);

  -- Rating, first-published year and the editorial block move as units so a
  -- value never mixes with another row's source/link/status.
  UPDATE books c SET rating = d.rating, rating_link = coalesce(nullif(btrim(c.rating_link), ''), d.rating_link)
  FROM (SELECT DISTINCT ON (m.canon) m.canon, d.rating, d.rating_link FROM books d JOIN m ON m.dup = d.id
        WHERE d.rating IS NOT NULL ORDER BY m.canon, m.ord) d
  WHERE c.id = d.canon AND c.rating IS NULL;

  UPDATE books c SET first_published_year = d.first_published_year, first_published_year_source = d.first_published_year_source
  FROM (SELECT DISTINCT ON (m.canon) m.canon, d.first_published_year, d.first_published_year_source FROM books d JOIN m ON m.dup = d.id
        WHERE d.first_published_year IS NOT NULL ORDER BY m.canon, m.ord) d
  WHERE c.id = d.canon AND c.first_published_year IS NULL;

  UPDATE books c SET editorial_summary = d.editorial_summary, best_for = d.best_for, not_for = d.not_for,
                     key_themes = d.key_themes, difficulty_level = d.difficulty_level,
                     recommendation_context = d.recommendation_context, source_quality_note = d.source_quality_note,
                     ai_generated_at = d.ai_generated_at, ai_quality_status = d.ai_quality_status
  FROM (SELECT DISTINCT ON (m.canon) m.canon, d.* FROM books d JOIN m ON m.dup = d.id
        WHERE nullif(btrim(d.editorial_summary), '') IS NOT NULL ORDER BY m.canon, m.ord) d
  WHERE c.id = d.canon AND nullif(btrim(c.editorial_summary), '') IS NULL;

  -- Redirects: retired slug -> surviving book id (resolved to its live slug at request time).
  UPDATE slugs s SET entity_id = m.canon FROM m WHERE s.entity_type = 'book' AND s.entity_id = m.dup;
  GET DIAGNOSTICS v_repointed = ROW_COUNT;
  INSERT INTO slugs (entity_type, entity_id, slug, is_primary)
    SELECT 'book', m.canon, b.slug, false FROM m JOIN books b ON b.id = m.dup WHERE nullif(btrim(b.slug), '') IS NOT NULL;
  GET DIAGNOSTICS v_redirects = ROW_COUNT;

  -- Nothing may still point at a duplicate before it is deleted.
  SELECT (SELECT count(*) FROM book_recommendations WHERE book_id IN (SELECT dup FROM m))
       + (SELECT count(*) FROM book_lists WHERE book_id IN (SELECT dup FROM m))
       + (SELECT count(*) FROM book_series WHERE book_id IN (SELECT dup FROM m))
       + (SELECT count(*) FROM book_authors WHERE book_id IN (SELECT dup FROM m)) INTO v_left;
  IF v_left <> 0 THEN RAISE EXCEPTION '% link rows still point at duplicates', v_left; END IF;

  DELETE FROM books WHERE id IN (SELECT dup FROM m);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> v_pairs THEN RAISE EXCEPTION 'deleted % of % duplicates', v_deleted, v_pairs; END IF;

  -- Counts, computed as the import did: distinct recommenders, lists, series, authors.
  UPDATE books c SET
    recommendation_count = (SELECT count(DISTINCT person_id) FROM book_recommendations WHERE book_id = c.id),
    list_count   = (SELECT count(*) FROM book_lists WHERE book_id = c.id),
    series_count = (SELECT count(DISTINCT series_id) FROM book_series WHERE book_id = c.id),
    author_count = (SELECT count(*) FROM book_authors WHERE book_id = c.id),
    updated_at = now()
  WHERE c.id IN (SELECT canon FROM m);

  RETURN jsonb_build_object(
    'pairs', v_pairs, 'canonicals', v_canons, 'deleted', v_deleted,
    'recs_moved', v_recs_moved, 'recs_dropped_same_person', v_recs_dropped,
    'lists_moved', v_lists_moved, 'lists_dropped_same_list', v_lists_dropped,
    'series_moved', v_series_moved, 'series_dropped_same_series', v_series_dropped,
    'authors_moved', v_authors_moved, 'authors_dropped_same_person', v_authors_dropped,
    'redirects', v_redirects, 'redirects_repointed', v_repointed);
END;
$fn$;
REVOKE ALL ON FUNCTION public.dedupe_merge_books_20261112(jsonb) FROM PUBLIC, anon, authenticated;

-- RESTORE (all batches) -------------------------------------------------------
-- Run as one transaction. Edits made to the canonical books' links after the
-- merge are lost by step 3; check bak_book_links first if time has passed.
--
-- BEGIN;
-- -- 1. Put the canonical rows back as they were (fields + counts).
-- UPDATE public.books b SET (subtitle, author_name, description, cover_image_url, isbn_10, isbn_13, page_count,
--        publisher, publish_date, language, open_library_id, google_books_id, amazon_url, meta_description, rating,
--        rating_link, first_published_year, first_published_year_source, editorial_summary, best_for, not_for,
--        key_themes, difficulty_level, recommendation_context, source_quality_note, ai_generated_at, ai_quality_status,
--        recommendation_count, list_count, series_count, author_count, updated_at)
--   = (k.subtitle, k.author_name, k.description, k.cover_image_url, k.isbn_10, k.isbn_13, k.page_count,
--        k.publisher, k.publish_date, k.language, k.open_library_id, k.google_books_id, k.amazon_url, k.meta_description, k.rating,
--        k.rating_link, k.first_published_year, k.first_published_year_source, k.editorial_summary, k.best_for, k.not_for,
--        k.key_themes, k.difficulty_level, k.recommendation_context, k.source_quality_note, k.ai_generated_at, k.ai_quality_status,
--        k.recommendation_count, k.list_count, k.series_count, k.author_count, k.updated_at)
--   FROM (SELECT DISTINCT ON (id) * FROM public.bak_books_dedupe_20261112 WHERE merge_role = 'canonical_before' ORDER BY id, backed_up_at) k
--   WHERE b.id = k.id;
-- -- 2. Re-insert the deleted duplicates.
-- INSERT INTO public.books SELECT (jsonb_populate_record(NULL::public.books, to_jsonb(k) - 'merge_role' - 'canonical_id' - 'backed_up_at')).*
--   FROM public.bak_books_dedupe_20261112 k WHERE merge_role = 'duplicate';
-- -- 3. Replace the link rows of every merged book with the backed-up ones.
-- DELETE FROM public.book_recommendations WHERE book_id IN (SELECT canonical_id FROM public.bak_books_dedupe_20261112);
-- DELETE FROM public.book_lists           WHERE book_id IN (SELECT canonical_id FROM public.bak_books_dedupe_20261112);
-- DELETE FROM public.book_series          WHERE book_id IN (SELECT canonical_id FROM public.bak_books_dedupe_20261112);
-- DELETE FROM public.book_authors         WHERE book_id IN (SELECT canonical_id FROM public.bak_books_dedupe_20261112);
-- INSERT INTO public.book_recommendations SELECT (jsonb_populate_record(NULL::public.book_recommendations, row_data)).* FROM public.bak_book_links_dedupe_20261112 WHERE table_name = 'book_recommendations';
-- INSERT INTO public.book_lists           SELECT (jsonb_populate_record(NULL::public.book_lists, row_data)).*           FROM public.bak_book_links_dedupe_20261112 WHERE table_name = 'book_lists';
-- INSERT INTO public.book_series          SELECT (jsonb_populate_record(NULL::public.book_series, row_data)).*          FROM public.bak_book_links_dedupe_20261112 WHERE table_name = 'book_series';
-- INSERT INTO public.book_authors         SELECT (jsonb_populate_record(NULL::public.book_authors, row_data)).*         FROM public.bak_book_links_dedupe_20261112 WHERE table_name = 'book_authors';
-- -- 4. Put back list/series book_count and drop the redirects.
--    (a list touched by several batches has several backups; the earliest holds the original count)
-- UPDATE public.lists  l SET book_count = (k.row_data->>'book_count')::int
--   FROM (SELECT DISTINCT ON (row_data->>'id') * FROM public.bak_book_links_dedupe_20261112 WHERE table_name = 'lists'  ORDER BY row_data->>'id', backed_up_at) k
--   WHERE l.id = (k.row_data->>'id')::uuid;
-- UPDATE public.series s SET book_count = (k.row_data->>'book_count')::int
--   FROM (SELECT DISTINCT ON (row_data->>'id') * FROM public.bak_book_links_dedupe_20261112 WHERE table_name = 'series' ORDER BY row_data->>'id', backed_up_at) k
--   WHERE s.id = (k.row_data->>'id')::uuid;
-- DELETE FROM public.slugs WHERE entity_type = 'book' AND slug IN (SELECT slug FROM public.bak_books_dedupe_20261112 WHERE merge_role = 'duplicate');
-- COMMIT;
