# On-page, technical and quality audit — 2026-11-14

Scope: every URL in the live sitemap (464 pages: 55 books, 53 people, 192 lists, 107 series, 53 compare, 4 static),
Search Console data for bookmentions.net (90 days, to 2026-11-14), and your own thin-page and publish gates.
Crawler: `scripts/qa/seo_audit.py` (re-runnable; also works against a local build with `--base`).

## Where the site stands (Search Console, 90 days)
66 clicks from 24,722 impressions (CTR 0.27%, average position 29.7); impressions up 86% on the previous period.
The pattern is **impressions without clicks**, not a visibility problem:

| Page | Impressions | Position | Clicks | Query behind it |
|---|---:|---:|---:|---|
| `/lists/best-cryptography-books` | 5,463 | 6.1 | 0 | "cryptography books 2025 / 2024 / 2026" |
| `/series/enid-blyton-books-in-order` | 644 | 33 | 1 | "enid blyton books in order" (pos 11.6) |
| `/lists/fiction`, `/travel`, `/history` | 1,400 / 1,169 / 869 | 53–58 | 0 | "best fiction / travel / history books" |
| `/people/james-clear` | 221 | 17 | 2 | "james clear book recommendations / reading list" |

Several published book pages are "Crawled – currently not indexed" (High Output Management, Influence, Poor Charlie's Almanack, Range).

## What was already good (no change needed)
All 464 URLs return 200. Zero duplicate titles, descriptions or H1s. Every page has one H1, a self-referencing canonical, Open Graph and Twitter tags.
JSON-LD is valid everywhere (no malformed blocks). All 28,708 images have alt text. No `noindex` page is in the sitemap.
http→https is a 301, www→apex and trailing-slash are 308s, real 404s, HSTS is on, `llms.txt` and the sitemap are live.
No page is thin by word count (median 700–5,000 words).

## Problems found and fixed (this branch)
1. **Titles did not match search intent.** Lists were "Best X Books | BookMentions". Now
   `Best Cryptography Books (2026): Most Recommended Picks` (176 of 189 lists), computed from current data so the year is accurate.
   Descriptions gain "Updated 2026." where there is room.
2. **People titles carried stale, inflated counts** frozen in the database: Bill Gates "310 Books" (page lists 295), Naval "219" (200), Marc Andreessen "142" (125), Noam Chomsky "133" (111).
   Titles and descriptions are now built from the real count and the person's top picks:
   `James Clear Book Recommendations: 67 Books, With Sources`. They also stay correct as recommendations are added.
3. **Detail pages were never cached.** People, books and series pages were served `Cache-Control: private, no-store` and re-rendered on every request
   (the code declared `revalidate = 300` but had no `generateStaticParams`, so the route was fully dynamic). They now return `s-maxage=300, stale-while-revalidate` (first request MISS, then HIT).
4. **Series without a verified order dropped the query phrase.** "Enid Blyton Books" is now "Enid Blyton Books: Complete List". It still does not claim an order it cannot verify.
5. **`/people` hub:** showed 24 of ~52 published people, had a sort dropdown with no handler, and ended in a "More coming soon" placeholder; 292 words. Now every qualifying person, no dead UI, an explanatory section (755 words).
6. **Wrong facts on published person pages.** "James Mattis: American bicycle racer" (a different person's Wikidata entry; the Secretary of Defense is "Jim Mattis", Q267902), "Andrew Chen: Taiwanese songwriter and record producer", "Raoul Pal: crypto promoter". Corrected; bios added for six profiles.
7. **Lists below your own publish gate** (20 distinct recommenders): Gardening **1**, Coffee Table 5, Dog Training 6 (none had Google impressions) set to `noindex`; their descriptions claimed support the data does not have.
8. **14 published books had no reader notes** (How to Win Friends, Snow Crash, Siddhartha, The Psychology of Money, Factfulness, How to Change Your Mind, The Power of Habit, The 7 Habits, Think and Grow Rich, When Breath Becomes Air, The Art of War, The Courage to Be Disliked, Guns Germs and Steel, Anna Karenina). They now have them, stored as `draft` so the page shows the fixed label "Draft reader notes, written with AI help and not yet reviewed by an editor". **Please have an editor review them.**

Every data change has a row in `public.bak_seo_changes_20261114` (old and new values) so it can be undone.

## Still open (recommendations, not done)
- **List pages are not cached.** They read `searchParams` for the sort and page controls, so they render on every request (~1 s). They are 40% of the sitemap and include the best-cryptography page.
  Fix: serve the bare URL statically and handle `?sort=`/`?page=` in a client component or a rewrite. Larger change, so I did not hack it.
- **Pregnancy (11 recommenders) and Photography (17) are also under the 20-recommender gate.** Left published; your call. Health topics deserve extra care.
- **Series below 80% publication-year coverage (2) and 52 draft series** are blocked by your publish rule, not by anything on the page; see `docs/series/series-publish-review-2026-11-14.md`.
- **10 published people have no portrait**, and Sophie Bakalar has no verified role or bio. These need a licensed image and a source I could verify; I did not guess.
- **Compare pages** (53 in the sitemap, ~470 words each) are the thinnest indexable pages and are templated; worth watching in Search Console, and a candidate for a `noindex` floor like the person/book one.
- **FAQPage markup** is on 403 pages. Google now shows FAQ rich results only for a narrow set of sites, so it earns nothing here (harmless).
- **Head terms** ("best fiction books") rank 50–70; the title change helps, but moving up needs links and unique content, not metadata.
- Core Web Vitals could not be measured from this environment.
