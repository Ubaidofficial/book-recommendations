# Changelog

## 2026-05-24 — Book Detail Page & Recommendation Proof

### Added
- `getRecommendationProof()` in data.ts — returns full book_recommendations junction data (person, source_url, source_name, quote, confidence_score)
- `RecommendationProof` interface in data.ts
- Book detail page: recommendation proof cards showing recommender name/role, quote, "View source" link, confidence percentage
- Book detail page: clean "No verified recommendation proof available yet" state when proof is empty
- Book detail page: "Verified" badge when proof exists
- Book detail page: placeholder cover design matching BookCard style

### Changed
- Book detail page fully restructured:
  - Hero: title, author, rating, recommendation count (hidden when 0), Verified badge, series chip, description
  - "Recommendation Proof" section (replaces old "Recommended By" without source data)
  - "Appears In" lists section with displayTitle()
  - "More from [Series]" section
  - "Also by [Author]" section
  - "What to read next" — merged author + series similar books, deduped, max 6
  - All sections hide when empty
- Lists use `displayTitle()` for display names

## 2026-05-24 — Real Search Implementation

### Added
- `searchBooks()`, `searchPeople()`, `searchLists()`, `searchSeries()` in `src/lib/data.ts` — Supabase `ilike` queries across title/author/name/role/description
- `src/components/GlobalSearch.tsx` — debounced (300ms) client-side search dropdown for header and homepage hero
  - Minimum 2 characters before querying
  - Results grouped by type (Books, People, Lists, Series) with max 4 each
  - "View all →" links to filtered index pages
  - Loading spinner, "No results found", "Search unavailable" error state
  - Click outside to dismiss, Escape to close
  - All result links are crawlable `<Link>` elements

### Changed
- `Header.tsx`: replaced disabled placeholder with GlobalSearch (desktop + mobile)
- `page.tsx` (homepage): replaced disabled SearchBar with GlobalSearch hero search
- `SearchBar.tsx`: now a live input that submits `?q=` param on Enter with clear button
- `/books`, `/people`, `/lists`, `/series`: accept `searchParams.q` for server-side filtering via search functions
- All index pages: show "Results for X" heading when searching; EmptyState messages reflect search context

### Fixed
- Search is genuinely functional — no more fake/disabled search UI

## 2026-05-24 — Data Presentation Cleanup

### Added
- `src/lib/display.ts` — reusable `displayTitle()` helper that converts slug text (e.g. "enid-blyton-books-in-order") to display text ("Enid Blyton Books In Order")
- Pagination placeholders on /books, /people, /lists, /series showing "Page X of Y — More coming soon" when total exceeds page size
- About page: platform stat cards (98k+ Books, 2k+ People, 350+ Lists, 3.5k+ Series)
- Methodology page: platform scale section with stats
- Footer: "Report an issue" link

### Changed
- SeriesCard and ListCard now apply `displayTitle()` — no raw slug text in UI
- Series detail page (h1, breadcrumbs, metadata) uses `displayTitle()`
- List detail page (h1, breadcrumbs, metadata) uses `displayTitle()`
- BookCard placeholder cover redesigned: purple gradient background, book title text, small book icon — looks intentional, not like a broken image
- SearchBar is now disabled with "Coming soon" label — no longer pretends search is functional
- Header search input: disabled, "coming soon" placeholder
- People index: filters single-word names unless they have recommendation/book counts
- People index: shows only first 24 results with pagination placeholder

### Fixed
- No raw slug-formatted text appears anywhere in UI

## 2026-05-23 — Homepage Book Thumbnail Fix

### Fixed
- BookCard now validates `coverUrl` against `/^https?:\/\//` — relative or broken cover URLs render a placeholder icon instead of a broken image
- PersonCard applies the same URL validation to avatar
- Added server-side diagnostic logging to homepage: logs row counts and how many books have valid covers; logs explicit warning when any section falls back to fallback data (QUERY_ERROR vs zero rows)

## 2026-05-23 — Homepage Trust & Data QA

### Fixed
- Removed all fallback book cover URLs — fallback cards now show a neutral book icon placeholder, never a mismatched cover
- BookCard: hides "recs" badge when recommendation_count is 0 or null
- ListCard: hides "books" badge when book_count is 0 or null
- SeriesCard: hides "books" badge when book_count is 0 or null
- PersonCard: hides "recs" and "books" badges when counts are 0 or null; shows initial letter placeholder when no avatar
- Homepage no longer renders "0 recs" or "0 books" anywhere

### Added
- "Why BookRecs?" section below hero: three cards (Verified Sources, Curated Lists & Series, Quality Over Quantity)
- "How recommendations are verified" section with 2-sentence explanation and link to /methodology

## 2026-05-23 — Runtime Crash Fix

### Fixed
- All 18 `throw error` sites in `src/lib/data.ts` replaced with safe fallback returns
- Every data function now wrapped in try/catch — no Supabase error can crash a public page
- List queries return `[]` on error; detail queries return `null` on error; count queries return `0`
- Errors are logged via `console.error` with the function label for debugging
- Homepage `Promise.all` wrapped in outer try/catch as ultimate safety net — fallback data always renders
- Supabase client missing-env throw is now caught by data function try/catch wrappers

## 2026-05-23 — Homepage QA Fixes

### Fixed
- Homepage Popular Lists and Popular Series sections now always render 4 visible cards
- Added curated fallback data for all four homepage sections (books, people, lists, series) when Supabase returns empty
- Changed homepage card counts from 6/4/3/3 to 4 books, 4 people, 4 lists, 4 series
- Lists/Series sections no longer render empty when Supabase has no data

### Added
- Methodology link in desktop header navigation (previously only in mobile menu)
- `src/lib/fallback.ts` with 4 curated fallback entries per category

## 2026-05-23 — Figma Visual Theme Integration

### Changed
- Complete visual redesign based on Figma "Top Book Lists" direction
- New color palette: `#faf9f7` background, `#1b1b1f` text, `#5b4fcf` purple/indigo accent, `#e5e5ea` borders
- Purple accent badges (`bg-accent-light`, `text-accent`) on all cards
- Cards upgraded to `rounded-2xl` with `hover:shadow-lg hover:border-accent/20` on hover
- Rating badges use purple accent pill style instead of amber/orange
- Button styles: filled purple accent with rounded-full, filter pills with selected state
- Larger typography: `text-xl` section headings, `text-base` body text, `text-2xl`/`text-3xl` page titles
- Rank position badges changed from dark/ink to purple accent color

### Added
- Header redesign: left logo, embedded search bar in desktop nav, mobile hamburger menu with slide-down panel
- Mobile menu with full nav links and search bar
- Loading skeleton components: `BookCardSkeleton`, `PersonCardSkeleton`, `ListCardSkeleton`
- Empty state component with book icon illustration
- Footer: added bottom tagline, subtle top border, improved spacing
- Book detail page: redesigned hero with `grid-cols-[280px_1fr]`, series link chip with icon, cleaner section headings
- Person detail page: improved hero with accent-colored count badges, source URL link
- List/Series detail pages: title with inline purple badge, cleaner layout
- `getPersonIdBySlug()` and `getSeriesIdBySlug()` slug-to-ID helpers

### Updated
- All 12 pages updated with new color tokens, spacing, and component styles
- SearchBar: taller (h-14), rounded-full, larger text, shadow-sm
- Homepage: editorial hero headline, arrow button on CTA, alternating section backgrounds
- Books index: filter pills with selected state styling
- About/Methodology: prose text styling updated
- `PROJECT_PLAN.md` updated with Figma styling phase

## 2026-05-23 — Database Query Fix

### Fixed
- All queries now use actual Supabase table and column names
- People counts use junction table queries
- List/series books loaded via junction tables
- Supabase client uses lazy initialization
