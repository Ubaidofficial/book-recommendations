-- One row per day of the indexing-gated publishing loop (see ops/scheduled-tasks/indexing-gated-publish.md).
-- The daily task reads the newest row, compares today's Search Console indexing with it, and decides how many pages to publish.
-- Applied via the Supabase MCP on 2026-11-15. Undo: DROP TABLE public.seo_publish_log;
create table if not exists public.seo_publish_log (
  day            date primary key,
  indexed        integer,            -- Google-indexed URLs among those inspected (SEOConsole get_indexing_status)
  not_indexed    integer,
  crawled_not_indexed integer,
  impressions_7d integer,
  clicks_7d      integer,
  published_cap  integer not null default 0,   -- what the gate allowed today (0, 1 or 2)
  published      jsonb not null default '[]', -- [{"type":"list","slug":"..."}]
  removed        jsonb not null default '[]',
  decision       text,               -- 'improved' | 'flat' | 'declined' | 'baseline'
  reasoning      text,               -- what data led to the decision (self-learning notes)
  learnings      jsonb not null default '{}', -- e.g. indexed share per section, lag in days
  created_at     timestamptz not null default now()
);
alter table public.seo_publish_log enable row level security;
