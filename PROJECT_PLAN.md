# Project Plan

## Current Phase: Launch Readiness QA

Real search is implemented across all pages. Data presentation and trust signals are in place. The platform is ready for production review.

## What Is Built

- **12 routes** — homepage, 5 index pages, 4 detail page types, about, methodology
- **Real search** — debounced global search dropdown (header + hero), server-side `?q=` filtering on all index pages, Supabase `ilike` queries
- **Reusable component library** — BookCard, PersonCard, ListCard, SeriesCard, SearchBar, GlobalSearch, Breadcrumbs, SectionHeading, Header (with mobile menu), Footer
- **Loading/empty states** — BookCardSkeleton, PersonCardSkeleton, ListCardSkeleton, EmptyState
- **Safe Supabase query layer** — all queries wrapped in try/catch, never crash a public page, fallback data for homepage
- **Trust signals** — "Why BookRecs?" section, verification explainer, platform stats (98k+ books, 2k+ people, 350+ lists, 3.5k+ series)
- **SEO utilities** — canonical URLs, `robotsDirective()` based on `index_status`, Open Graph, Twitter cards
- **Person detail pages** — recommended books with proof data, authored books, source/proof compact list, 3-state empty handling
- **JSON-LD placeholders** — Book, Person, ItemList schemas, only rendered when data is available
- **Display utilities** — `displayTitle()` converts slug text to readable display text
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
- Full pagination (page 1 + "More coming soon" placeholder in place)
- Dark mode

## Next Steps

1. Populate Supabase tables with real data (recommendation sources, quotes, confidence scores)
2. Set `index_status = 'index'` on high-quality rows
3. Ensure `cover_url` values are valid absolute URLs
4. Create `/books/[slug]/recommendations` sub-page for full recommendation proof list
