# Competitor research: mostrecommendedbooks.com and goodbooks.io

Date: 2026-10-23. Project: BookMentions (`bookmentions.net`), market US / English.

## How this was gathered (and what is missing)

- Sources: each competitor's public homepage, a sample person page, a sample topic
  list, `sitemap.xml`, and MRB's `llms-full.txt`, fetched on 2026-10-23. Also a
  US web search for two of our keywords.
- **Missing: traffic, ranked keywords and backlinks.** The hosted OpenSEO account has
  17 credits. A domain overview costs about 100-300 credits, so none was pulled. The
  self-hosted OpenSEO connector is not authorized in this session yet. Re-run
  `get_domain_overview`, `get_ranked_keywords` and `get_backlinks_overview` for both
  domains once one of them can be used. Until then, nothing below says who gets more
  traffic or has stronger links.
- Sitemap counts are URL counts, not counts of indexed or ranking pages.

## Snapshot

| | mostrecommendedbooks.com (MRB) | goodbooks.io | bookmentions.net |
|---|---|---|---|
| Topic lists (`best-X-books`) | **1,296 list URLs** in sitemap | 50 list URLs | (ours) |
| People pages | 1,123 URLs (includes `books-written-by-*`); homepage claims "750+" people | 741 URLs | (ours) |
| Book pages | none (books link straight to Amazon) | 6,148 URLs | yes |
| Other | 48,000+ series claimed, 400+ summaries, blog, app | 65 blog posts, top-100, categories/industries, newsletter ("20,000+" claimed), merch shop | series, authors (noindex) |
| Per-recommendation quote + source link | **Yes** (X posts, YouTube timestamps, articles) | **No** (cover, title, buy buttons only) | partial: source where we have one |
| Freshness signal | Topic list shows "Last updated October 22, 2026". People sitemap lastmod is 2025-08-02, and the Elon Musk page says "Last updated: August 2, 2025" while its title says "(2026)" | Sitemap has no lastmod. Blog titles mostly name 2022-23 events (my reading of the slugs, not dates) | |
| Monetization | Amazon affiliate, app | Amazon + Apple Books affiliate, Audible, ads page, merch | Amazon |

## mostrecommendedbooks.com: the main threat

**What they do well**
- Topic lists cover almost every keyword we saved. MRB has a direct
  `/lists/best-…-books` page for 28 of our 33 keywords (see table below).
- Topic list anatomy (`/lists/best-stoicism-books`): title "14 Best Stoicism Books
  (2026)", a ~130-word "Our take", a "How to choose" block that maps reader types to
  books, an evaluative line and "What it's about" per book, "Also recommended by"
  people with quotes, a numbered source list (9 sources), a visible update date,
  and editor bios (Richard Reis, Anurag Ramdasan).
- Person pages show a quote and a source link for each recommendation, plus "Also
  recommended by" cross-links to other people.
- Publishes `llms-full.txt` (an AI/LLM-facing index).

**Weaknesses we can exploit**
1. **Topic-list rankings come from blogs, not people.** The stoicism page says
   "Ranked by how many expert sources name each book", and those 9 sources are mostly
   blogs, two Reddit threads and Goodreads. Several books on it (e.g. *How to Be a
   Stoic*, *Lives of the Stoics*) show no named recommender. BookMentions ranks from
   attributed people, which is a better story and harder to copy.
2. **Person pages are stale.** People sitemap lastmod is August 2025, and the
   Musk page's "(2026)" title conflicts with its "August 2, 2025" update date.
3. **No FAQ blocks** on the person or topic pages sampled. Our list pages already have
   FAQ sections (commit `1c6924a`).
4. **No book pages.** Every book goes straight to Amazon, so MRB cannot rank for
   "who recommended [book]" / "[book] recommended by" queries. Our `/books/[slug]`
   pages with recommender counts can.
5. Title and H1 differ (H1 has no count or year), a small on-page miss.

## goodbooks.io: weaker on our keywords

**What they do well**
- Large book catalog (6,148 book URLs), with each book page showing a recommender
  count (e.g. "54 people" for *Sapiens*).
- People browsable by industry (about 30), books by category (about 16), and top-100
  lists.
- Newsletter and Apple Books links on every card.

**Weaknesses**
1. **Person pages have no quotes or sources.** The Elon Musk page has 66 cards with
   cover, title, author and buy buttons only. It also shows leftover template text
   ("Book recommendations coming soon!" twice) and "No items found" under "Books
   written by".
2. **Very thin on topic keywords.** Only 50 lists. Of our 33 keywords, the only
   overlaps are AI, cyberpunk, crypto and investing (plus a general startup list).
3. **Quality and consistency issues.** The homepage claims both "9,500+" and "6,500+"
   recommendations, the "politics" industry tag links to `/industries/photography`,
   and some social and Apple Books links are `#` placeholders.
4. The blog looks stale (2022-23 topics such as Bill Gates' 2022 lists), going by
   slugs only.

## Keyword coverage: who already has a page

| Our keyword (US vol.) | MRB page | goodbooks page |
|---|---|---|
| best memoirs (6,600) | best-memoir-books | — |
| best world war 2 books (5,400) | best-world-war-2-books | — |
| best true crime books (4,400) | best-true-crime-books | — |
| best investing books (2,900) | best-investing-books | best-investing-books |
| best ai books (2,900) | best-artificial-intelligence-books | best-artificial-intelligence-books |
| best greek mythology books (2,400) | yes | — |
| best entrepreneurship books (1,900) | yes | startup / entrepreneur lists |
| best personal finance books (1,600) | yes | — |
| best world war 1 books (1,600) | yes | — |
| best stoicism books (1,600) | yes | — |
| best books on the vietnam war (1,300) | best-vietnam-war-books | — |
| best holocaust books (1,000) | yes | — |
| best cyberpunk books (720) | yes | best-cyberpunk-books |
| **best screenwriting books (590)** | **none found** | — |
| books recommended by bill gates (480) | person page | person page + blog |
| best magical realism / neuroscience / music books (480 each) | yes | — |
| books recommended by elon musk (480) | person page | person page + blog |
| best negotiation books (320) | yes | — |
| **best books about new york city (320)** | **none found** | — |
| best crypto books (260) | best-cryptocurrency-books | best-cryptocurrency-books |
| **best books about china (260)** | only `best-china-history-books` | — |
| best books on writing fiction (260) | best-fiction-writing-books | — |
| best climate change books (210) | yes | — |
| **best books about japan (210)** | only `best-japan-history-books` | — |
| best books about wealth / steampunk (170 each) | yes | — |
| best books on psychedelics (110) | best-psychedelic-books | — |
| **best books about korea (50)** | only `best-korean-war-books` | — |
| best biohacking / silicon valley / growth hacking (≤20) | yes | — |

"None found" means no matching slug in MRB's lists sitemap on 2026-10-23. It does not
mean nothing ranks for the query.

## Plan to out-compete them

Ordered by how much I expect each to move rankings. These are judgment calls, not
measured. Validate them against ranking data once credits or the self-hosted
connector are available.

1. **Ship the uncontested gaps first:** best screenwriting books, best books about new
   york city, best books about china, japan and korea (country lists, not just
   history). MRB has no direct page for these, and goodbooks has none.
2. **Make "ranked by real people" the headline on every topic list.** Show the
   recommender count per book with names, quotes and source links, and say plainly in
   the intro and title area that MRB's equivalent ranks by blog mentions. Drop books
   with no attributed recommender, or label them, so every entry has a reason.
3. **Match MRB's editorial layer on top of that:** a short "our take", a "how to
   choose / start here" block (we have start-here, commit `1c6924a`), a one-line
   verdict per book, a visible update date, and a sources list. Keep the FAQ, which
   neither competitor has.
4. **Win person pages on freshness and sourcing.** MRB's people data stopped in August
   2025, and goodbooks has no sources at all. For high-volume names (Bill Gates, Elon
   Musk first), keep the update date and the year in the title consistent, show the
   date of each recommendation, and add recent recommendations. Bill Gates
   publishes reading lists regularly; check his site for the latest before refreshing.
5. **Use book pages, which MRB lacks:** title and meta like "Who recommends [Book]?
   N people, with quotes", to target "[book] recommended by" and "who recommended
   [book]" long-tail queries.
6. **Pick off goodbooks' person-page long tail:** their 741 person pages have no
   quotes or sources. Where we have the same people with sourced recommendations, our
   page is plainly more useful.
7. **Backlinks and outreach: unknown until data is pulled.** Both sites list press
   (MRB names Forbes, Business Insider and Tim Ferriss; goodbooks shows Product Hunt).
   Pull `get_backlinks_overview` before deciding on a link strategy.

## Next data to pull (when credits or the self-hosted connector allow)

- `get_domain_overview` for both competitors and bookmentions.net
- `get_ranked_keywords` for mostrecommendedbooks.com filtered to `/lists/` and
  `/people/`, excluding brand terms
- `get_serp_results` for the top 10 saved keywords, to see whether MRB actually ranks
  where it has pages
- `get_backlinks_overview` for both competitors
