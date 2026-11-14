# SEO Strategy

## Day 1 Indexable Pages

These pages are set to `index, follow`:

- `/` — Homepage
- `/books` — Books index
- `/people` — People index
- `/lists` — Lists index
- `/series` — Series index
- `/about` — About page
- `/methodology` — how recommendations are collected and ranked (indexable since 2026-11-14: it is the trust page the footer and home page link to)

## Noindex Rules

Detail pages are **noindex by default**, and only become indexable when their
Supabase row has `index_status = 'index'`:

- `/books/[slug]`
- `/people/[slug]`
- `/lists/[slug]`
- `/series/[slug]`

A few pages are **permanently noindex** (no `index_status` gate — not on a
path to ever being indexed):

- `/authors`, `/authors/[slug]` — derived author-catalog pages with no independent quality signal beyond the books they list

## Implementation

The `robotsDirective()` function in `src/lib/seo.ts` checks `index_status`:

```ts
export function robotsDirective(row: { index_status?: string } | null | undefined): string {
  return isIndexable(row) ? "index, follow" : "noindex, follow";
}
```

Each detail page's `generateMetadata()` uses this to set the `robots` meta tag.

## Future pSEO Rollout

1. **Phase 1 (current)**: Index only high-level pages. Detail pages are noindex.
2. **Phase 2**: Set `index_status = 'index'` on high-quality detail pages.
3. **Phase 3**: Programmatic sub-pages for search-oriented content.
4. **Phase 4**: Cross-linking pages based on data patterns.
5. **Phase 5**: Sitemap generation with index_status-based prioritization.

Each phase only indexes pages that meet quality thresholds.

## Discovery of noindex pages (links and sitemap)

Only the pages in the sitemap are meant to be indexed, and publishing them in
phases (daily quota, `index_status`) is the only switch. Google can still
*discover* noindex pages by following links, and in Search Console that shows
as "Excluded by 'noindex' tag" (42k+ on 2026-11-09). That is not an error, but
it spends crawl on pages we do not want indexed.

- **Links.** A link to a book page that is not indexable carries
  `rel="nofollow"` (`src/lib/indexableBooks.ts`, used by `BookCard`,
  `CoverTile`/`BookRow`, `ReadNext` and the list and people pages). Visitors
  click through as before. A book's links turn into normal links within an hour
  of it being published. nofollow is a hint to Google, not a directive, and it
  lowers *new* discovery; URLs Google already knows stay known for a long time.
  If the indexable set cannot be read, no link is nofollowed (fails open).
  Not covered: header/footer/search links (they point at published books) and
  the client components `PersonShelf` and `ConsensusShelf`.
- **Sitemap.** `/sitemap.xml` is built from several full-catalogue reads and took
  40-50 s cold. It is now cached for an hour (stale copy served while a fresh one
  builds). A failed or empty read is never cached; the route then falls back to
  the uncached build.


## Measured tests (do not judge before the review date)

| Started | Change | Pages | Baseline (Search Console, 90 days to 2026-11-14) | Review |
|---|---|---|---|---|
| 2026-11-14 | Year the list was last edited added to the `<title>` | `/lists/best-cryptography-books`, `/lists/best-sailing-books` | cryptography: 5,463 impressions, 0 clicks, average position 6.05 (queries "cryptography books 2024/2025/2026"); sailing: 130 impressions on "sailing books 2024" at position 8.1 | 4 weeks after Google's November 2026 core update finishes (it began 2026-11-10 and was still rolling out on 2026-11-14) |

The cryptography page also has an intent mismatch the title cannot fix: its top book is a novel (*Snow Crash*, 33 recommenders) while the
results page is textbooks, Reddit threads and an AI Overview. See `docs/seo/seo-gap-audit-2026-11-14.md`.
