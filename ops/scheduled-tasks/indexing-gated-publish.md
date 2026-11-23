# BookRecs: indexing-gated daily publish (replaces "Daily publish (max 2 pages)")

Live task since 2026-11-23: `trig_01BWSEPysnwsJsKTquZj7Wc2`, 11:05 UTC daily (the earlier copy `trig_01CW3Xi1RWKBuAj3WMDVya7y` is disabled).
Steps run in the order A, B, E, C (D on cap-0 days).

Decided by the owner on 2026-11-15: take unindexed pages out, then publish 1-2 pages a day ONLY while Google indexing is improving, stop
the day it does not, and learn from Search Console (SEOConsole MCP) and OpenSEO (OpenSEO_Selfhost MCP) every day.
State lives in `public.seo_publish_log` (one row per day, migration 010). Removed pages are backed up in `bak_seo_changes_20261114`
(batch `unpublish_unindexed_20261115`); undo with `update <table> set index_status='published' where id=<row_id>`.

## The loop

**A. MEASURE (every day, even when nothing is published)**
1. `mcp__SEOConsole__get_indexing_status` site bookmentions.net, view `summary` (indexed, notIndexed, whyNotIndexed, indexedShareHistory) and view `events`
   (newly indexed vs de-indexed in the last 24h-7d).
2. `mcp__SEOConsole__get_overview` days 7 (clicks, impressions, position) and `mcp__SEOConsole__get_sitemap_coverage` (shown vs never shown).
3. Read the newest row of `public.seo_publish_log` (previous day). Decision:
   * `improved` = indexed today > indexed in the previous row, or (equal and newly-indexed > de-indexed in `events`);
   * `declined` = fewer indexed, or de-indexed > newly indexed;
   * `flat` = anything else.
   The inspected set is a rotating sample, so use net events as the tie-breaker and never act on a one-URL swing.
4. Gate: **improved -> cap 2; flat or declined -> cap 0 (publish nothing today).** Never above 2. The cap resets daily.
5. First day after a change wave (removals, big deploy): decide against the previous row as usual, but do not publish if the previous row's
   decision was `baseline` and indexed has not risen.

**B. PUBLISH (only up to the cap; lists and series combined; nothing else)**
Choose the page by evidence, not by queue order:
* OpenSEO_Selfhost (project 02d2d22f-7134-43c2-bca5-f3cb4cac79d0): `get_keyword_metrics` / `get_search_opportunities` for the head keyword of each
  candidate ("best <topic> books", "<author> books in order"); prefer higher volume and lower difficulty.
* SEOConsole `get_top_queries` / `get_opportunities`: prefer topics Google already shows the site for.
* Learned preference: the section (lists vs series) with the higher indexed share in `learnings` of the last 7 rows.
Candidates and guards are the existing ones: lists from the reviewed queue below, guarded statement unchanged; series only `publish_ready`.

**E. OPTIMIZATION GATE (added 2026-11-23; every page published today, before IndexNow and log_change)**
Run `python3 -I scripts/qa/seo_audit.py` (whole sitemap, about 3 minutes, read-only) and read each new page's row in
`reports/seo_audit_pages.csv`. Every new page must have: status 200, no redirect, `canonical_self` true, no noindex in `robots`/`x_robots`;
title 30-65 chars containing "Books" (series: "<Name> Books in Order"); meta description 70-160 chars; title and description not identical to
any other sitemap URL; exactly 1 H1 and at least 8 H2; `jsonld_invalid` 0 and `jsonld_types` containing ItemList, BreadcrumbList and
CollectionPage; `og_image` set; `images_no_alt` 0; at least 1,000 words for a list, 350 for a series (flag series under 500 words as thin);
and the URL present in https://bookmentions.net/sitemap.xml (re-check after a minute if missing). Then
`QA_PATHS=<today's paths> node scripts/qa/amazon_monetization_crawl.js` must print `"finalResult": "PASS"`.
If any check fails, set that page back to `index_status='draft'`, publish nothing else that day and report the failing checks. Never edit
titles, descriptions, meta columns or `amazon_url` from the run to get a page through: list and series titles/descriptions are generated in
code (`src/app/lists/[slug]/page.tsx`, `src/app/series/[slug]/page.tsx`), so a failure needs a reviewed fix. Also report (do not change) any
already-live sitemap page that fails the same rules. On cap-0 days run the audit anyway to catch regressions.
Baseline 2026-11-23: all 300 sitemap URLs returned 200 and passed every rule above except /privacy and /terms titles (27-29 chars, not
publish candidates); 17 series pages are under 500 words (shortest 366); the five lists published 11-21..11-23 passed the Amazon check.

**C. LEARN (always write the row)**
Insert today's row into `seo_publish_log`: indexed, not_indexed, crawled_not_indexed, impressions_7d, clicks_7d, published_cap, published, removed,
decision, reasoning (the numbers that drove it), learnings (indexed share per section: lists/series/people/books/compare; days from publish to
indexed for pages published >7 days ago; the best and worst performing topics). Call `mcp__SEOConsole__log_change` for every page published (so
SEOConsole attributes later movement). Every 7 days write one paragraph into `reasoning` on what the data says to change in the rule.

**D. WHEN THE CAP IS 0**
Spend the day on pages already live: (a) re-inspect pages that were "crawled - currently not indexed" and report any that improved; (b) pick the
page with the most impressions and zero clicks (as of 2026-11-15: /lists/best-cryptography-books, 5,620 impressions at position 6) and report a
title/description change for the owner; (c) IndexNow (OpenSEO `submit_indexnow_urls` and SEOConsole `submit_indexnow`) for the newest published pages.
Never publish, never raise the cap, never loosen a guard.

## Hard rules
Never publish people, books or compare pages. Never set `publish_ready`. Never remove a guard from a statement. Never delete rows. If SEOConsole
or Supabase tools are unavailable, publish nothing and say which. Report: decision, numbers vs yesterday, what (if anything) was published and why
that page, what was learned.

## Guarded statements (never remove a guard)

Lists (one call per page):
```sql
update lists l set index_status='published', published_at=now(), updated_at=now()
where l.slug in ('<the one slug>') and l.index_status in ('draft','noindex') and l.book_count>=15
  and length(coalesce(l.description,''))>=30
  and (select count(distinct br.person_id) from book_lists bl join book_recommendations br on br.book_id=bl.book_id where bl.list_id=l.id)>=20
returning l.slug;
```
Series (only vetted `publish_ready` rows; never set `publish_ready` yourself):
```sql
update series s set index_status='published', published_at=now(), updated_at=now()
where s.id in (select id from series where publish_ready = true and index_status = 'draft' and slug like '%-books-in-order'
               order by publish_priority asc nulls last limit 1)
returning s.slug, s.publish_priority;
```
BEFORE every publish (learned 2026-11-16, best-leadership-books was published by mistake and reverted): grep the slug in `next.config.js`
(`source: "/lists/<slug>"` = a redirect, never publish it) and `curl -sI https://bookmentions.net/lists/<slug>` must return 200, not 308. The
guarded statement cannot see redirects. Also `seo_publish_log.day` is the primary key: use `ON CONFLICT (day) DO UPDATE`.

Never publish: best-leadership-books (redirects to /lists/leadership), best-books-on-revolutions, best-quantum-physics-books, best-books-for-dads, best-data-science-books, best-design-books,
best-physics-books, best-books-on-persuasion, best-memoir-books, best-poetry-books, any empty slug, any slug next.config.js redirects, or a
second list from a duplicate cluster (entrepreneur/entrepreneurship/new-business; screenwriting/screenplay; communication/communication-skills;
self-help/self-improvement/motivational; philosophy/philosophers; meditation/mindfulness; mystery/murder-mystery/suspense/thriller;
war/war-history/books-about-war; apocalyptic/post-apocalyptic) whose twin is published. Check the top 6 books by recommendation_count: skip the
list if they do not match the topic or any title looks corrupted (ends in .0 or looks like a date).

Reviewed list queue (candidates, not an order): best-books-about-japan, best-books-about-china, best-books-about-korea, best-books-about-new-york-city,
best-fiction-writing-books, best-screenwriting-books, best-silicon-valley-books, best-growth-hacking-books, best-negotiation-books,
best-personal-finance-books, best-wealth-books, best-holocaust-books, best-world-war-1-books, best-world-war-2-books, best-books-on-vietnam-war,
best-climate-change-books, best-neuroscience-books, best-magical-realism-books, best-cyberpunk-books, best-steampunk-books, best-epic-fantasy-books,
best-dark-fantasy-books, best-dragon-books, best-comedy-books, best-autobiographies, best-biography-books, best-sports-biographies-books,
best-meditation-books, best-medical-books, best-military-books, best-running-books, best-sailing-books, best-books-about-germany,
best-books-about-france, best-books-about-italy, best-books-about-california, best-books-about-united-kingdom, best-economics-books,
best-economic-development-books, best-cryptography-books, best-biology-books, best-botany-books, best-anthropology-books, best-ancient-history-books,
best-world-history-books, best-war-books, best-art-books, best-architecture-books, best-picture-books, best-childrens-books,
best-books-for-3-year-olds, best-books-for-6-year-olds, best-books-for-7-year-olds, best-books-for-8-year-olds, best-books-for-9-year-olds,
best-books-for-10-year-olds, best-christmas-books, best-adventure-books, best-non-fiction-adventure-books, best-apocalyptic-books,
best-alternate-history-books, best-dystopian-books, best-classic-books, best-political-books, best-socialism-books, best-libertarian-books,
best-psychology-books, best-cognitive-psychology-books, best-social-psychology-books, best-leadership-books, best-entrepreneur-books,
best-project-management-books, best-hiring-recruiting-books, best-human-resources-books, best-communication-skills-books, best-goal-setting-books,
best-time-management-books, best-procrastination-books, best-self-discipline-books, best-self-help-books, best-spiritual-books, best-philosophy-books,
best-mindfulness-books, best-yoga-books, best-relationship-books, best-grief-books, best-friendship-books, best-love-books, best-feminist-books,
best-lgbt-books, best-immigration-books, best-books-for-women, best-books-for-men, best-mystery-books, best-thriller-books,
best-psychological-thriller-books, best-spy-books, best-serial-killer-books, best-crime-books, best-video-game-books, comics, best-short-stories-books,
best-music-history-books, best-software-books, best-computer-science-books, best-engineering-books, best-machine-learning-books,
artificial-intelligence, best-digital-marketing-books, best-business-plan-books, best-interviewing-books, best-enneagram-books, best-books-on-habits,
best-books-on-discipline. The 98 lists unpublished on 2026-11-15 are back in `draft` and can re-enter through this queue when the data favours them.

Deferred tools to load first: `ToolSearch` select:mcp__SEOConsole__get_indexing_status,mcp__SEOConsole__get_overview,mcp__SEOConsole__get_sitemap_coverage,mcp__SEOConsole__log_change,mcp__SEOConsole__get_top_queries,mcp__SEOConsole__get_opportunities,mcp__SEOConsole__submit_indexnow.
