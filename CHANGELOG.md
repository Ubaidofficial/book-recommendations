# Changelog

## 2026-05-24 — Data Quality Dashboard UX

### Changed
- Dashboard subtitle: "Diagnostic sample from problem queries. Counts below are sample counts, not full database totals."
- Summary card labels: Sample Rows, Valid Covers in Sample, Local Covers in Sample, Missing Descriptions, Suspicious Descriptions, Invalid Ratings, With Recommendations
- Added info box at top: "Internal QA only — used to choose which pages are safe to index"
- Problem rows: book titles link to `/books/{slug}`, author hidden when empty, bare ratings suppressed to "invalid/suppressed", cover shows "missing" / "local filename" / truncated URL
- High-rec issues row: issues joined with "·" separator

## 2026-05-24 — Internal Data Quality Audit

### Added
- `/admin/data-quality` — internal diagnostics page with `robots: "noindex"`
- 5 summary cards: sampled books, valid covers, local covers, missing desc, bad desc, bad ratings, has recs
- 5 problem lists (20 items each):
  - Books with suspicious descriptions (Goodreads/Tanggal Terbit markers)
  - Books missing or with invalid covers
  - Books with invalid ratings (<1, >5, null)
  - Books missing descriptions
  - High-recommendation books missing covers or descriptions
- 5 diagnostic query functions in data.ts: `getBooksWithSuspiciousDescriptions`, `getBooksWithMissingCover`, `getBooksWithInvalidRating`, `getBooksMissingDescription`, `getHighRecBooksWithQualityIssues`

## 2026-05-24 — Production Crash Fix (onError + Supabase)

### Fixed
- Created `src/components/SafeImage.tsx` — client component with `useState` for onError fallback
- Removed all inline `onError` handlers from server components (book detail, person detail, BookCard)
- BookCard now uses SafeImage for cover rendering
- Book detail page: hero image uses SafeImage with fallback placeholder
- Person detail page: avatar uses SafeImage with initial-letter fallback
- `getBooksByAuthor()`: removed `.order("rank", { foreignTable: "books" })` — `rank` is on the junction table, not books, causing SQL error
- Removed `count: "exact"` from 4 paginated queries (books, people, lists, series) to avoid timeout on large tables
- Total count now uses `data.length` instead of `count(*)` — fast and sufficient for current limits

## 2026-05-24 — Production Crash Fix

### Fixed
- All 9 junction-table casts in data.ts hardened: `as Book/Person/BookList` now filter out null objects from broken FK joins
- Book detail page: related queries wrapped in try/catch with empty-array fallbacks
- Book detail page: `author_slug`, `series_slug` safely optionally chained — no crashes on books without author/series
- Person detail page: same null-safe treatment for written books and recommendation proof
- `jsonld.ts`: `bookJsonLd` returns null if book is missing title
- Junction data sanitized on both detail pages — nulls filtered from series author, and proof arrays

## 2026-05-24 — Cover Image Field Fix

### Fixed
- Book interface `cover_url` renamed to `cover_image_url` to match actual Supabase DB column
- All 13 references to `book.cover_url` updated to `book.cover_image_url` across 7 files
- Fallback data `cover_url` renamed to `cover_image_url`
- Cover images (Supabase Storage, Open Library, Google Books) now render on book detail pages

## 2026-05-24 — Conservative Labels & Cover Debugging

### Changed
- Book detail: forced conservative proof labels — always "Recommendation Signals" and "How recommendation signals are reviewed"
- Removed "Recommendation Proof" and "How recommendations are verified" from book detail pages entirely
- Will restore proof wording after DB source quality audit
- Added `console.log` in `getBookBySlug()` (dev only) showing slug + cover_url value + validity
- Cover field confirmed: DB `cover_url` → Interface `cover_url` → Page `book.cover_url` — no mismatch

## 2026-05-24 — Wrong-Language & Data Quality Fixes

### Added
- `isLikelyEnglish()` in dataQuality.ts — rejects Spanish (El libro, Traducido, vendidos, etc.), Indonesian (Tanggal Terbit, halaman, penerbit), French, and German metadata
- English stopword ratio check: text must have >10% common English stopwords if ≥10 words
- Non-ASCII accented word ratio check: rejects if >20% of words contain accented characters
- `isUsefulDescription()` now requires `isLikelyEnglish()` pass

### Changed
- Author line hidden completely when `book.author` is empty — never renders naked "by"
- "Verified" badge: only shown when ≥2 recommendations have valid source_url (was ≥1)
- Proof section: renamed "Recommendation Proof" → "Recommendation Signals" unless ALL recs have source_url AND quote ≥50 chars
- Bottom box title: changes to "How recommendation signals are reviewed" unless all recs fully verified
- Quote cards: only show quote if length ≥50 chars (was ≥30); otherwise show "Recommended this book"
- Quote cards: no source link rendered unless source_url is valid
- Confidence always formatted via `formatConfidence()`; invalid (>100) values hidden
- Cover images on detail page accept Supabase Storage, Open Library, and Google Books URLs; onError fallback works
- `generateMetadata` handles missing author by falling back to book title alone

## 2026-05-24 — Data Quality Display Hardening

### Added
- `src/lib/dataQuality.ts` — reusable quality helpers:
  - `isValidHttpUrl()` — validates https?:// URLs
  - `isValidRating()` — only 1-5 numeric
  - `formatRating()` — one-decimal max
  - `formatConfidence()` — null-safe: 0<v≤1→%, 1<v≤100→%, >100→null
  - `isUsefulDescription()` — rejects empty/<80 chars/scraped junk (Goodreads, Indonesian metadata, etc.)
  - `cleanDescription()` — trims and clamps to 700 chars
  - `uniqueByNormalizedText()` — deduplicates by normalized text

### Changed
- BookCard: rating only shown if `isValidRating()`, cover uses `isValidHttpUrl()` + `onError` fallback
- BookCard: rating formatted via `formatRating()` (one decimal)
- Book detail page: rating only shown if valid, description shows fallback message if scraped/too-short, clamped 700 chars
- Book detail page: confidence formatted with `formatConfidence()`, hidden if null
- Book detail page: quotes deduplicated via `uniqueByNormalizedText()`
- Book detail page: "Verified" badge only when at least one recommendation has valid source_url
- Book detail page: section renamed to "Recommendation Signals" unless all recs have source_url
- Person detail page: same confidence formatting, quote dedupe, source URL validation
- Person detail page: renamed to "Recommendation Signals" when source proof incomplete
- JSON-LD: only includes aggregateRating if valid 1-5, only includes image if valid URL, filters bad descriptions

## 2026-05-24 — Metadata Polish

### Changed
- All page metadata titles and descriptions updated for launch:
  - Homepage: "BookRecs | Source-Backed Book Recommendations"
  - /books: "Browse Books | BookRecs"
  - /people: "Featured People | BookRecs"
  - /lists: "Book Lists | BookRecs"
  - /series: "Book Series in Order | BookRecs"
  - /about: "About BookRecs"
  - /methodology: "Methodology | BookRecs"
  - /privacy: "Privacy Policy | BookRecs"
  - /terms: "Terms of Use | BookRecs"
  - /report-issue: "Report an Issue | BookRecs"
- `pageMetadata()` now uses "BookRecs" brand (was "Book Recommendations")
- All meta descriptions are human-readable, 130-160 characters, no SEO/internal jargon

## 2026-05-24 — People Page Data Quality

### Changed
- People index default view now fetches top 100 by quality_score, then sorts client-side by:
  recommendation_count desc → quality_score desc → name asc
- One-word names (e.g. "Gross", "Sedaris") are hidden from default view unless they have
  recommendation counts, written counts, or a bio
- One-word names still appear in search results when explicitly searched
- Search results skip the quality filter entirely
- Default People page heading now reads "Featured people whose recommendations shape what we read"
- Pagination label shows "Showing X of Y people" instead of page numbers
- New `getQualityPeople()` in data.ts — fetches up to 100 people by quality_score for client-side filtering

## 2026-05-24 — Legal Pages & Homepage Upgrade

### Added
- `/privacy` — privacy policy covering analytics, cookies, data handling
- `/terms` — terms of use covering accuracy disclaimer, external links, acceptable use
- `/report-issue` — report page with mailto link and types of issues that can be reported
- `src/components/HomepageVisual.tsx` — original abstract SVG of people/recommendations/books with purple accent
- Footer: Legal section (Privacy, Terms) and Help section (Report an issue)

### Changed
- Homepage restructured:
  - Trust + Visual section below hero with 3 benefit points and abstract SVG
  - "Popular Books" section
  - "Books recommended by notable people" section (renamed from "Featured People")
  - "Featured Reading Lists" section (renamed from "Popular Lists")
  - "Popular Series" section
  - "How recommendations are verified" section
  - CTA section
- Footer: reorganized into Discover / Info / Legal / Help columns
- Header: kept focused — Books, People, Lists, Series, About only

### Removed
- "Why BookRecs?" 3-card grid replaced with trust + visual section
- All remaining public copy mentioning noindex, indexing, SEO, Google, or search engines

## 2026-05-24 — Nav & Methodology Copy Cleanup

### Changed
- Removed Methodology link from desktop and mobile header nav
- Methodology link remains in footer under Info
- `/methodology`: renamed "Indexing Policy" → "Quality Standards"
- `/methodology`: rewritten to be user-facing — no mention of noindex, indexing, Google, or search engines
- `/about`: removed noindex mention from quality standards paragraph, replaced with user-facing copy

## 2026-05-24 — Series Detail Page Quality

### Added
- `getRelatedSeries()` in data.ts — returns popular series by book_count (excluding current, max 6)
- Series detail page: reading order indicator ("#1, #2, #3..." badges)
- Series detail page: "Reading order is based on available series metadata" explainer
- Series detail page: "Explore more series" section with related series cards
- Series detail page: "About this series" explainer section
- Series detail page: fallback description when series has no description text

### Changed
- `getBooksBySeries()` default limit increased from 12 → 48
- Series detail page restructured:
  - Hero: displayTitle, book count badge (hidden when 0), description or fallback intro
  - Books: ranked cards with "#N" position badges, up to 48 shown
  - Empty state: "Books for this series are still being organized."
  - Related series section hidden when empty
- Book count badge hidden when 0

## 2026-05-24 — List Detail Page Quality

### Added
- `getRelatedLists()` in data.ts — returns popular lists by book_count (excluding current list, max 6)
- List detail page: "Explore more lists" section with related list cards
- List detail page: "About this list" explainer section with ranking methodology
- List detail page: fallback description when list has no description text

### Changed
- `getBooksForList()` default limit increased from 10 to 48
- List detail page restructured:
  - Hero: displayTitle, book count badge (hidden when 0), description or fallback intro copy, curator
  - Books: ranked cards with position badges, up to 48 shown
  - Empty state: "Books for this list are still being organized."
  - Related lists section hidden when empty
- Book count badge hidden when 0

## 2026-05-24 — Person Detail Page Quality

### Added
- `getPersonRecommendationProof()` in data.ts — returns books with source_url, quote, confidence_score from book_recommendations
- `PersonRecommendationProof` interface
- Person detail page: compact proof list with book title, quote, "View source" link, confidence percentage (top 10 with source data)
- Person detail page: "About this profile" section with recommendation count and authored count

### Changed
- Person detail page restructured:
  - Hero: avatar with initial fallback, name, role, bio (hidden if empty), badges (hidden when 0), "Profile source →" link
  - "Books [Name] Recommends" — cards from proof data, sorted by confidence_score desc
  - Empty state when no recommendations: "No verified recommendation data available yet."
  - "Books by [Name]" — hidden when empty
  - "Source & Proof" — 3 states: compact proof rows, "recommendations exist but sources pending", general explainer
- Zero-count badges hidden everywhere
- All queries limited to 24 rows max

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

## 2026-05-30 — Manual Title Quality Fixes

### Changed
- Normalized 9 live book titles after preview and drift-check gates.
- Fixed mashed title casing/hyphenation for Capital in the Twenty-First Century, Dear Life, The Hundred-Year Walk, Pre-Suasion, Slaughterhouse-Five, The Demon-Haunted World, The Long Goodbye, The Mythical Man-Month, and duplicate Three-Body Problem row.
- PATCH limited to title/subtitle only; no slug, cover, description, schema, or AI writes.

## 2026-05-30 — Description Artifact Repair

### Changed
- Repaired 54 deterministic description artifacts after live preview, backup, and drift-check gates.
- Fixed safe mashed phrases such as twentyfirst century, Englishspeaking, SlaughterhouseFive, Mythical ManMonth, and Liu Cixin.Set.
- Left Piketty, Gulag Archipelago, and Outsiders mojibake rows in manual review.
- PATCH limited to description only; no slug, title, cover, schema, editorial, or AI writes.

## 2026-05-30 — Missing Cover Recovery

### Changed
- Added gated missing-cover recovery tooling.
- Backfilled cover for Why Are We Yelling? after preview, manual approval, backup, and drift-check gates.
- Held low-confidence / unmatched cover candidates for manual review.
- PATCH limited to cover_image_url only; no title, slug, description, schema, editorial, or AI writes.

## 2026-05-30 — Top 500 Description Backfill

### Changed
- Backfilled high-confidence descriptions for top-500 books with empty or junk descriptions.
- Reduced top-500 bad/short descriptions from 36 to 23.
- Used preview, manual approval, backup, and drift-check gates.
- PATCH limited to description only; no slug, title, cover, schema, editorial, or AI writes.
