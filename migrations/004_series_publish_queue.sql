-- Publish queue for series pages.
--
-- WHY THIS EXISTS
--
-- A series page may only go live once it holds a real reading order (80%+ of
-- its books carry a verified first_published_year) and none of the author's
-- major works are missing (scripts/series_completeness_check.py). Those checks
-- need Open Library, so the daily publisher cannot run them itself. Instead
-- they are run offline and their result is recorded here:
--
--   publish_ready     true once a series passed both checks
--   publish_priority  lower = sooner; set from the US search volume of its
--                     "<author> books in order" keyword
--
-- scripts/import/publish_batch_pages.js then releases a fixed number of ready
-- series per day (SERIES_DAILY_QUOTA) instead of publishing a backlog at once.
--
-- Additive and nullable: safe while traffic is live.

ALTER TABLE series ADD COLUMN IF NOT EXISTS publish_ready boolean NOT NULL DEFAULT false;
ALTER TABLE series ADD COLUMN IF NOT EXISTS publish_priority integer;

CREATE INDEX IF NOT EXISTS idx_series_publish_queue
  ON series (publish_priority)
  WHERE publish_ready AND index_status = 'draft';

-- Rollback:
--   DROP INDEX IF EXISTS idx_series_publish_queue;
--   ALTER TABLE series DROP COLUMN IF EXISTS publish_priority;
--   ALTER TABLE series DROP COLUMN IF EXISTS publish_ready;
