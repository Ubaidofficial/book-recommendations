# SEO Strategy

## Day 1 Indexable Pages

These pages are set to `index, follow`:

- `/` — Homepage
- `/books` — Books index
- `/people` — People index
- `/lists` — Lists index
- `/series` — Series index
- `/about` — About page

## Noindex Rules

Detail pages are **noindex by default**, and only become indexable when their
Supabase row has `index_status = 'index'`:

- `/books/[slug]`
- `/people/[slug]`
- `/lists/[slug]`
- `/series/[slug]`

A few pages are **permanently noindex** (no `index_status` gate — not on a
path to ever being indexed):

- `/methodology` — not worth the crawl budget over the higher-value pages above
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

