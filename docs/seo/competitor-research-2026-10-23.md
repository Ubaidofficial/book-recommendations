# Competitor research: mostrecommendedbooks.com and goodbooks.io

Date: 2026-10-23. Project: BookMentions (`bookmentions.net`), market US / English.

## How this was gathered (and what is missing)

- Sources: each competitor's public homepage, a sample person page, a sample topic
  list, `sitemap.xml`, and MRB's `llms-full.txt`, fetched on 2026-10-23. Also a
  US web search for two of our keywords.
- Traffic, ranked keywords, backlinks and live SERPs: self-hosted OpenSEO project
  "BookMentions" (DataForSEO data, US/English), pulled 2026-10-23. See "Search data"
  below. DataForSEO traffic numbers are modelled estimates, not analytics. Use them for
  relative comparison only.
- Sitemap counts are URL counts, not counts of indexed or ranking pages.

## Search data (OpenSEO self-hosted, 2026-10-23)

| | mostrecommendedbooks.com | goodbooks.io | bookmentions.net |
|---|---|---|---|
| Est. US organic traffic / month | 47,019 | 3,680 | 7 |
| Ranked US keywords | 82,547 | 4,488 | 147 |
| Backlinks / referring domains | 12,851 / 4,600 | 6,898 / 1,213 | 60 / 56 (backlink spam score 57; only 3 referring domains left after the spam filter) |
| Backlink rank (DataForSEO) | 45 | 44 | 0 |

**Where MRB's traffic actually comes from:** almost all of it is **series pages**. Its
top 60 non-brand keywords by estimated traffic are 58 `/series/*-books-in-order` pages
(e.g. "suzanne collins books" #4, "john grisham books in order" #2) and 2 `/lists/`
pages. Its topic lists (7,176 ranked keywords) and people pages (1,226) are weak:
the best list keyword brings an estimated 122 visits, and most rank 20-40. For
example, "true crime books" ranks #33 and "elon musk books" #23. Many of its people
URLs that rank are `books-written-by-*` pages, not recommendation pages.

**goodbooks.io:** traffic is spread across the homepage ("good books" #5, "best books
to read" #7), a few series pages and people pages. It ranks #1 for several
"[person] book recommendations" long-tail queries (Tim Ferriss, Andrew Huberman,
Warren Buffett, Peter Thiel), and #2 for "books recommended by elon musk".

**BookMentions today:** 147 keywords, all ranked 22 or worse (best: "books ceos read"
#22). The site has no organic traffic yet, so every keyword below is a fresh target.

**Live top-10 SERPs (US desktop) for 10 saved keywords:** neither competitor is in the
top 10 for any of them, except goodbooks.io at #2 for "books recommended by elon
musk". The top 10s are dominated by Reddit, Quora, Facebook groups, Goodreads, Amazon,
publishers (Penguin Random House, Pan Macmillan), fivebooks.com and Medium/Substack
posts. Most also show an AI Overview. "Books recommended by bill gates" is led by
gatesnotes.com itself. recommentions.com ("80 books Elon Musk mentioned, ranked!",
#4) is a third competitor worth watching.

What this means (my interpretation, not measured):
- The topic keywords are not locked up by either competitor. Google is mostly showing
  forum threads, which suggests searchers want to know what real people recommend.
  That is BookMentions' core data.
- Domain authority is the main gap. MRB has about 80x our referring domains, and ours
  look spammy, so links matter as much as content.
- If you want traffic at MRB's scale, series ("[author] books in order") is where its
  traffic is. That is a different play from recommendations.

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
measured. Track the saved keywords before and after each change to check them.

1. **Ship the uncontested gaps first:** best screenwriting books, best books about new
   york city, best books about china, japan and korea (country lists, not just
   history). MRB has no direct page for these, and goodbooks has none. The live SERPs
   for screenwriting, New York City and Japan show forums and publishers, and neither
   competitor.
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
7. **Backlinks are the biggest gap.** We have 56 referring domains with a spam score
   of 57, against MRB's 4,600 and goodbooks' 1,213. Both competitors get links from
   directories and launch sites (Product Hunt, SaaSHub, alternative.to,
   startupbuffer) and from AI and reading tools (easyreads.ai, superbook.ai). Getting
   listed in those places is a cheap first step. Review our spammy referring domains
   before deciding whether a disavow file is needed.
8. **Decide on series pages.** That is where MRB gets most of its traffic. We already
   have `/series/` pages, but the Enid Blyton page says the reading order is not
   verified. Verified reading orders for popular authors could be a second traffic
   pillar. It is a separate decision from the recommendations strategy.

## Next data to pull

- `get_ranked_keywords` for mostrecommendedbooks.com `/series/` (sorted by traffic),
  if series pages are on the table
- A rank tracker for the 33 saved keywords, to set a baseline before shipping changes
- `get_backlinks_profile` for bookmentions.net, to review the spammy referring domains

---

# Update (later on 2026-10-23): two more competitors and plan v2

Data: self-hosted OpenSEO (DataForSEO, US/English), Supabase production
read-only queries, and an Open Library dry run. Traffic figures are modelled
estimates.

## Executive summary

BookMentions has almost no organic traffic yet (an estimated 7 visits a month).
The biggest opening in this niche is **"[author] books in order" pages**. The
keywords have high volume and very low difficulty: 183 of bookseriesinorder.com's
top 200 traffic keywords have keyword difficulty 20 or lower. We already hold
series rows for 140 of the 177 author pages that drive that site's top traffic.
What blocks us is data and indexing, not page count:

1. **Every year in the series data is wrong.** For series books,
   `books.publish_date` holds one year per author (every Harry Potter book reads
   1997), so no page can honestly say "in order" today. Fix: migration 003 plus
   the Open Library backfill.
2. **Almost nothing is indexable.** 2 of 3,565 series, 54 of 98,845 books and
   52 of 2,359 people have an indexable `index_status`.
3. **Links.** We have 56 referring domains, against 5,375 for
   bookseriesinorder.com and 4,600 for MRB.

## New competitors

| | bookseriesinorder.com | recommentions.com |
|---|---|---|
| Est. US organic traffic / month | **96,320** (the largest in this set) | 345 |
| Ranked keywords | 99,201 | 386 |
| Referring domains | 5,375 (backlink rank 58) | 2,361, but most appeared in Sept-Oct 2026 from spam "SEO checker" domains |
| What ranks | Author pages (`/tom-clancy/`, `/john-sandford/`, `/nora-roberts/`), mostly thriller and mystery | Person pages (`/elon-musk/books/`, top 5 for many "[person] favorite books" variants) and **person + book pair pages** (`/elon-musk/books/dune.../`) |

bookseriesinorder.com's top pages by estimated traffic (top 200 keywords):
homepage, Tom Clancy, John Sandford, Nora Roberts, James Patterson, Harlan Coben,
Patricia Cornwell, Stone Barrington, Vince Flynn, Stuart Woods, Mitch Rapp,
Michael Connelly, Jack Carr, Alex Cross.

Recommentions shows a pattern worth copying: a page per person-book pair answers
queries like "elon musk lord of the rings" and "ray dalio and bill gates". We
already hold that data (`book_recommendations` with quote and source).

## Keyword opportunity table

Volume and difficulty (KD) are DataForSEO US figures. "Competitor rank" is
bookseriesinorder.com's position. All of these are saved in the OpenSEO
project.

| Keyword | US vol. | KD | Competitor rank | We have the series row? | Opportunity |
|---|---|---|---|---|---|
| harry potter books in order | 60,500 | 23 | — | yes (5 books, 100% dated in dry run) | High |
| percy jackson books in order | 40,500 | 15 | — | yes (100% dated) | High |
| louise penny books in order | 33,100 | 18 | 10 | yes | High |
| jack reacher books in order | 27,100 | 9 | 6 | yes (93% dated) | High |
| dune books in order | 22,200 | 19 | — | yes (83% dated) | High |
| alex cross books in order | 22,200 | 3 | 3 | yes | High |
| stephen king books in order | 18,100 | 19 | — | yes (94% dated) | High |
| jack carr books in order | 18,100 | 9 | 2 | yes | High |
| david baldacci books in order | 14,800 | 4 | 3 | yes | High |
| mitch rapp books in order | 14,800 | 2 | 2 | yes | High |
| harry bosch books in order | 14,800 | 1 | 9 | yes | High |
| michael connelly books in order | 14,800 | 17 | 5 | yes | High |
| john grisham books in order | 12,100 | 18 | — | yes (87% dated) | High |
| cj box books in order | 12,100 | 16 | 3 | **no** | Medium (needs data) |
| tana french books in order | 9,900 | 8 | 3 | **no** | Medium (needs data) |
| daniel silva books in order | 9,900 | 0 | 4 | yes | High |
| discworld reading order | 8,100 | 12 | — | yes (100% dated) | High |
| nora roberts books in order | 8,100 | 6 | 2 | yes | High |
| brandon sanderson reading order | 6,600 | 7 | — | yes (84% dated) | High |
| books like 1984 | 2,400 | 0 | — | book page | Medium |
| books like the alchemist | 1,900 | 0 | — | book page | Medium |
| atomic habits review | 1,000 | 20 | — | book page | Low (we don't write reviews) |
| books like atomic habits | 720 | 0 | — | book page | Medium |
| is atomic habits worth reading | 390 | 4 | — | book page (FAQ) | Medium |

"Who recommended [book]" and "[book] recommended by" have **no measurable
volume** in DataForSEO (tested for Sapiens, Atomic Habits, The Intelligent
Investor). Target them on book pages because it costs nothing and fits the
data, but the real volume around a book is "books like [book]" and "is [book]
worth reading".

## What shipped in this session (code, not yet deployed)

- **Series pages:** the title becomes "[Author] Books in Order" only when 80%+
  of the books have a verified first-publication year. Otherwise it reads
  "[Author] Books" with no order claimed. Year badges, clean names instead of
  slug titles, an FAQ (first book, latest book, how many, most recommended,
  what order to read) with FAQPage JSON-LD.
- **Book pages:** title "Sapiens by Yuval Noah Harari: Recommended by 88
  People", a meta description naming the top recommenders, H2s "Who
  recommended [book]?" and "Books like [book]", and an FAQ (who recommended,
  is it worth reading, books like it) with FAQPage JSON-LD.
- **Data:** `migrations/003_books_first_published_year.sql` (not applied) and
  `scripts/backfill_first_published_year.py`. Dry run on 10 series: 306 of 340
  books matched (90%). The spot check found wrong years from Open Library
  records: Jack Reacher's "Bad Luck and Trouble" came back as 1984 (it was
  published in 2007) and "Nothing to Lose" as 1998 (2008). Review the CSV
  before `--write`, and add a second source or a manual check for the top
  series.

## Prioritized action plan

**Quick wins (this week)**

| Action | Impact | Effort | Depends on |
|---|---|---|---|
| Apply migration 003 (additive, nullable columns) | Unblocks series order | 5 min | Your approval |
| Run the backfill dry run for the ~140 covered author series, review outliers, then `--write` | High | Half a day including review | Migration 003 |
| Deploy this branch (series + book page changes) | High | Under 1 hour | None |
| Set `index_status = 'published'` on series that pass publication order with 15+ books, starting with the 19 keywords above | High | 1-2 hours | Backfill |
| Submit the newly indexable URLs (IndexNow tool in OpenSEO, plus the Search Console sitemap) | Medium | 30 min | Indexing |
| Remove duplicate series rows (`dune`, `dune-series`, `dune-books-in-order`), or 301 them to the `-books-in-order` slug | Medium | 1-2 hours | None |

**Strategic investments (this quarter)**

| Action | Impact | Effort |
|---|---|---|
| Fill the 37 missing author series from bookseriesinorder.com's top-traffic list (C.J. Box, Tana French, Freida McFadden, Rebecca Yarros, Jo Nesbø...) from Open Library author works | High | Multi-day |
| Split author bibliographies into true series (Jack Reacher inside Lee Child; Mitch Rapp inside Vince Flynn) with positions | High | Multi-day |
| Add the BookMentions angle to series pages: "most recommended [author] book", with recommender names. Neither series competitor has it | Medium | 1 day |
| Person + book pair pages (the Recommentions pattern), e.g. `/people/elon-musk/dune`, from `book_recommendations` quotes | Medium | 1-2 days |
| Index more people and book pages by quality score (today: 52 people, 54 books) | High | Ongoing |
| Link building: library and reading-blog outreach (bookseriesinorder.com's links include libraries such as bpld.org, cheshirelibraryblog.com and iberiaschools.org), plus directories (Product Hunt, SaaSHub, alternative.to). Review our spammy referring domains | High | Ongoing |
| Rank tracker on the saved keywords for a baseline (estimate cost first) | Medium | 30 min |
