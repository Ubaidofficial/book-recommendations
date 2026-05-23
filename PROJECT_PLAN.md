# Project Plan

## Current Phase: Visual Theme Integration

Figma-inspired editorial theme has been applied across all 12 routes and components. Purple/indigo accent color system, rounded editorial cards, and responsive mobile layouts are complete.

## What Is Built

- **12 routes** — homepage, 5 index pages, 4 detail page types, about, methodology
- **Reusable component library** — BookCard, PersonCard, ListCard, SeriesCard, SearchBar, Breadcrumbs, SectionHeading, Header (with mobile menu), Footer
- **Loading/empty states** — BookCardSkeleton, PersonCardSkeleton, ListCardSkeleton, EmptyState
- **Supabase query layer** — all queries use actual table names, junction tables, and column names from the real schema
- **SEO utilities** — canonical URLs, `robotsDirective()` based on `index_status`, Open Graph, Twitter cards
- **JSON-LD placeholders** — Book, Person, ItemList schemas, only rendered when data is available
- **Visual theme** — purple/indigo accent (`#5b4fcf`), near-white background (`#faf9f7`), charcoal text (`#1b1b1f`), rounded-2xl editorial cards, purple accent badges, responsive mobile menu
- **Documentation** — README.md, PROJECT_PLAN.md, DATABASE.md, SEO_STRATEGY.md, CHANGELOG.md

## What Is Intentionally Not Built Yet

- Auth / user accounts
- Payments / subscriptions
- Admin dashboard
- CSV import pipeline
- Book scraping or enrichment
- Static generation of 98k pages
- Database schema creation (Supabase-side concern)
- Quotes page
- Add Book flow
- Mass-indexing of detail pages

## Next Steps

1. Populate Supabase tables with real data
2. Set `index_status = 'index'` on high-quality rows
3. Add search functionality (backend query + debounced search)
4. Implement pagination UI on index pages
5. Create `/books/[slug]/recommendations` sub-page for recommendation proof
6. Roll out more detail pages as quality data becomes available
