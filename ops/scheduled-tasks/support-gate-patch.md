# Support gate for the live daily-publish task (ready to apply, not yet applied)

Task: `trig_01Vj5MAsYC7HpdaCFaioSnPU` ("Daily publish (max 2 pages) + indexing push").
Why it is not applied: the platform only lets a routine's prompt be changed from the conversation it posts
into (`session_01AzT4RCkMEwCnNKRUjTydKF`). Paste or say the following there: "Apply the support gate patch from
`ops/scheduled-tasks/support-gate-patch.md` to this routine's Part 1."

## Problem

The existing guard requires `>= 20` distinct recommenders counted across the whole list. One popular book can
carry that: `best-cryptography-books` passes on *Snow Crash* alone (33 recommenders) while 11 of the next 14
titles have no recommendation at all.

## Patch 1: replace the guarded statement in PART 1 with

```sql
update lists l set index_status='published', published_at=now(), updated_at=now()
where l.slug in (<the 1 slug>)
  and l.index_status in ('draft','noindex')
  and l.book_count>=15
  and length(coalesce(l.description,''))>=30
  and (select count(distinct br.person_id) from book_lists bl join book_recommendations br on br.book_id=bl.book_id where bl.list_id=l.id)>=20
  and (select count(*) from book_lists bl join books b on b.id=bl.book_id where bl.list_id=l.id and b.recommendation_count>=2)>=5
  and (select coalesce(max(b.recommendation_count),0)::numeric/nullif(sum(b.recommendation_count),0) from book_lists bl join books b on b.id=bl.book_id where bl.list_id=l.id)<=0.70
returning l.slug;
```

(Keep it on one line in the prompt.) The two new conditions use only `book_lists` and `books`, so they are cheap.

## Patch 2: add this paragraph straight after the statement

> SUPPORT GATE (added 2026-11-14, on top of the 20-recommender rule; never loosen it): the 20-recommender
> count is taken across the whole list, so one very popular book can carry a list whose other books have no
> recommendations. A list must ALSO have at least 5 books with 2 or more recommendations
> (`books.recommendation_count >= 2`) AND no single book may hold more than 70% of the list's total
> recommendations. If the statement returns no row for a slug, do not retry it with a weaker condition: report
> the slug as "blocked by the support gate" and take the next one.

Also add "fails the support gate" to the list of reasons the queue is exhausted, and "name any list blocked by
the support gate" to the REPORT line.

## What it does to today's lists (read-only check, 2026-11-14)

Of 176 published or noindex lists (excluding the `books-recommended-by-*` set): 160 would pass, 14 fail the
"5 books with 2+ recommendations" test, and 2 fail only the 70% test. Trade-off: the 70% rule is blunt. A
legitimate list dominated by one iconic book (for example a Holocaust list led by *Night*) would be blocked
too; relax it to 80% if that matters more than catching cases like cryptography.
