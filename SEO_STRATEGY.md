# SEO Strategy

## Day 1 Indexable Pages

These pages are set to `index, follow`:

- `/` — Homepage
- `/books` — Books index
- `/people` — People index
- `/lists` — Lists index
- `/series` — Series index
- `/about` — About page
- `/methodology` — Methodology page

## Noindex Rules

Detail pages are **noindex by default**:

- `/books/[slug]`
- `/people/[slug]`
- `/lists/[slug]`
- `/series/[slug]`

These pages only become indexable when their Supabase row has `index_status = 'index'`.

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
