-- Read-only. How much real recommendation support does each PUBLISHED list have?
-- The publish gate counts distinct recommenders across the whole list, so one very
-- popular book can carry a list that is otherwise empty (best-cryptography-books:
-- Snow Crash has 33 recommenders, 11 of the other 14 top titles have none).
-- Run with the Supabase SQL editor or MCP execute_sql. Lowest support first.
with pl as (select id, slug, book_count from lists where index_status = 'published'),
t as (
  select pl.slug, pl.book_count,
         count(*) filter (where b.recommendation_count >= 1) as books_with_rec,
         count(*) filter (where b.recommendation_count >= 2) as books_with_2plus,
         coalesce(sum(b.recommendation_count), 0)            as total_rec,
         coalesce(max(b.recommendation_count), 0)            as top_rec
  from pl
  join book_lists bl on bl.list_id = pl.id
  join books b on b.id = bl.book_id
  group by pl.slug, pl.book_count
)
select slug, book_count, books_with_rec, books_with_2plus, total_rec, top_rec,
       round(100.0 * top_rec / nullif(total_rec, 0)) as top_book_share_pct
from t
order by books_with_2plus asc, top_book_share_pct desc;
-- Proposed stricter gate for new lists: books_with_2plus >= 5 AND top_book_share_pct <= 70
-- (exact guarded UPDATE in ops/scheduled-tasks/support-gate-patch.md).
