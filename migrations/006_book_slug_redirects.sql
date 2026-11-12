-- Old book slugs keep working after duplicate books are merged.
--
-- WHY THIS EXISTS
--
-- On 2026-11-12 duplicate `books` rows (the same work stored twice, e.g.
-- "Letters from a Stoic" by "Lucius Annaeus Seneca" and by "Lucius Seneca")
-- were merged into one canonical row each and the extra rows deleted. Their
-- slugs had been linked and indexed, so each one must redirect permanently to
-- the surviving book instead of returning 404.
--
-- The existing `public.slugs` table (empty until then) already has the right
-- shape, so no new table is needed. One row per retired book slug:
--   entity_type = 'book'
--   entity_id   = id of the surviving (canonical) book
--   slug        = the retired slug (globally unique via slugs_slug_key)
--   is_primary  = false
-- The book page (src/app/books/[slug]/page.tsx) calls getBookRedirectSlug
-- (src/lib/data.ts) only when no book has the requested slug. It looks the slug
-- up here and resolves entity_id to the surviving book's *current* slug, so a
-- later rename or a second merge of that book still lands on a live page.
-- If that book is later merged again, repoint its rows:
--   update public.slugs set entity_id = '<new canonical>' where entity_type = 'book' and entity_id = '<old>';
-- and add the newly retired slug as another row.
--
-- `slugs` already had row-level security enabled with no policy, so the anon
-- key could not read it. This adds a read-only policy for book redirects.
-- Writes stay restricted to the service role / SQL editor.

ALTER TABLE public.slugs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read book slug redirects" ON public.slugs;
CREATE POLICY "Public can read book slug redirects"
  ON public.slugs
  FOR SELECT
  TO anon, authenticated
  USING (entity_type = 'book');

CREATE INDEX IF NOT EXISTS idx_slugs_entity ON public.slugs (entity_type, entity_id);

COMMENT ON TABLE public.slugs IS
  'Retired slugs that redirect to a live entity. entity_type=''book'': a duplicate book merged on 2026-11-12 (see migrations/006_book_slug_redirects.sql); entity_id is the surviving book.';
