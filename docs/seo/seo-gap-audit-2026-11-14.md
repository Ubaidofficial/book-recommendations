# SEO gap audit: the "7 deadly sins" checked against bookmentions.net

Date: 2026-11-14. Data: Search Console (90 days to 2026-11-14) through the SEO Console connector, a crawl of
all 464 sitemap URLs (`scripts/qa/sitemap_audit.py`), read-only Supabase queries, one live-results check
(3 queries, OpenSEO, about 15 credits), the repo, and the scheduled tasks as they are today.

**Read this first.** The site is new: 66 clicks and 24,722 impressions in 90 days (average position 29.7), and the
previous 90 days were close to zero. Query-level numbers rest on very few clicks, and 83% of clicks are
anonymised in Search Console. Treat every ranking figure as directional. Google's November 2026 core update began
2026-11-10 and was still rolling out on 2026-11-14, so nothing here can be judged against it yet.

## Corrections to the first-pass analysis

| First pass said | What the evidence shows |
|---|---|
| About 13 pages a day are being published | True from 2026-10-25 to 2026-11-11 (7 lists + 6 series). **Not true now:** the live task (`trig_01Vj5MAs…`) was capped at 2 pages a day on 2026-11-14, the list queue is exhausted and no series is publish-ready. The two 7+6 tasks are disabled. The repo mirror was stale; it is now marked so. |
| The sitemap may list noindex pages | **Not confirmed.** All 464 sitemap URLs return 200, none carries noindex (meta or `X-Robots-Tag`), none redirects, no canonical differs. |
| "Excluded by noindex" and the 4 blocked series pages are a code problem | **Not a code problem.** The 4 series pages (laura-dave, margaret-atwood, maze-runner, sarah-graves) are `published` and serve `index, follow` today. Search Console is holding the copy it fetched before they were published. The fix is a re-crawl (IndexNow, Request indexing), which the live daily task already does. |
| The top page by impressions is an orphan | **Mostly not confirmed.** In a full crawl only 8 lists have no followed inbound link (programming, food, music, poetry, romance, sports, dog-training, greek-mythology). `best-cryptography-books` has 5. The connector's orphan list came from a 42-page crawl in which 18 pages failed. |
| Internal `nofollow` on book links may be hurting discovery | **Not supported.** 46,816 of 58,071 internal `/books/` links (81%) are nofollow, but they point at the ~98,000 noindex book pages. Links to indexable pages are followed. `/books` itself is "unknown to Google" while 463 pages link to it with a normal link, so link discovery is not the bottleneck. Left as is. |
| 13 pages a day while 28% of the sample is indexed is the same Sloth mistake | Valid when it was happening; moot now that the cap is 2. |

## The five actions

1. **Wait for the core update before structural changes.** Done by restraint: the only title change is a 2-page
   test, and no data, index status or live scheduled task was changed.
2. **Throttle publishing.** Already done by you earlier today (cap 2 a day plus an indexing push). Nothing to add. One real gap
   found in the gate, below.
3. **Sitemap vs robots diff and the nofollow review.** Done, see the table above. Result: clean sitemap, nofollow is not the cause, no change.
4. **Fix the cryptography page.** Partly. Live results check, 2026-11-14, US desktop:
   - All three queries ("cryptography books 2025", "best cryptography books", "cryptography books 2026") show an **AI Overview first**.
   - The organic results are textbook lists (IACR reviews, *Understanding Cryptography*, *Serious Cryptography*, *Handbook of Applied Cryptography*), Reddit r/crypto threads and review sites.
   - Our page was at organic rank 12 for "cryptography books 2025" and not in the top 20 for the other two. Search Console reports an average position of about 6 for the same queries; I can't reconcile the two (one-off desktop snapshot versus a 90-day average), so verify before relying on either.
   - Our snippet leads with *Snow Crash*, *Cryptonomicon* and *The Code Book*. Database: only 4 of 46 books have any recommendation; *Snow Crash* has 33 recommenders, *Cryptonomicon* 6, *The Code Book* 2, *Foundations of Cryptography* 1, and the rest (including *Applied Cryptography*, *Cryptography Engineering*) have none.
   - So this is partly an intent mismatch (searchers want technical books; our evidence is about a novel), which a title cannot fix. **My reading, not proven:** zero clicks on 5,463 impressions comes from an AI Overview above us plus that mismatch.
   - Done: the year the list was last edited is now in the title of this page and `best-sailing-books` (a measured test, see `SEO_STRATEGY.md`). Not done: changing the stored description or un-publishing the list, which are data decisions for you.
5. **"Ranked by real people" as the headline, and the series decision.**
   - The list pages already say it (recommendation counts, ranked table, FAQ). The risk is the reverse: the claim is only true for some lists. Of 191 published lists, **17 have fewer than 5 books with 2 or more recommenders** (gardening: 3 recommendations in total across 99 books; dog training 7; coffee-table books 5; pregnancy 12; business plans, HR, interviewing, cryptography, anthropology, grief, sailing, enneagram, steampunk, botany, dragons, immigration, serial killers). Run `scripts/qa/list_support_audit.sql` for the full table.
   - So I did **not** make a stronger sitewide headline claim. The methodology page now says what is true, including that some lists are thin (see gap 5).
   - Series: keep the 106 published, do not expand. Evidence: series pages are 106 of 463 sitemap URLs but only 10 have had an impression in 90 days (1,176 impressions, 1 click), and the one series page with traction (Enid Blyton, 644 impressions) is titled "Enid Blyton Books" because its reading order is not verified (`publish_ready = false`, 868 books), while people search "enid blyton books in order". Verifying that one order is a better use of time than publishing more series.

## The seven gaps

| # | Gap | Finding | Action |
|---|---|---|---|
| 1 | Indexing and discovery | Sample of 358 URLs: 101 indexed (28%). Not indexed: 111 unknown to Google, 58 noindex (stale copies, see above), 51 crawled-not-indexed (including *Atomic Habits*, *Thinking, Fast and Slow*), 37 discovered-not-indexed. Impression coverage by folder (a proxy, not index status): lists 66 of 191, people 11 of 52, series 10 of 106, books 3 of 54, compare 0 of 53. 78 of 207 inspected pages had not been re-crawled a week after their sitemap date changed. | None in code. Keep the 2-a-day cap and the daily indexing push; judge again after the core update. |
| 2 | Templated pages | The gate weakness above. Also 53 `/compare/` pages (885-1,167 words, unique shared-book data) have had **zero impressions** in 90 days. | No change. Revisit compare pages in January; if still zero, drop them from the sitemap. Tighten the list gate (SQL in the ops note). |
| 3 | Measurement | GA4 shows no data at all for 90 days in the connector. GTM has a Google tag and a Clarity tag firing on all pages, but the GA4 measurement ID could not be read through the API (the linked property is `G-PCTSPWJHR2`). Clarity does record sessions (7 on 2026-11-14, plus 32 bot sessions). Core Web Vitals (CrUX) is not connected. | **You:** open GA4 Realtime and confirm a page view arrives; connect CrUX on the SEO Console Connect page. I can't verify GA4 from here. |
| 4 | Orphans | 8 lists with no followed inbound link (above). Median followed inbound links: lists 8, series 7, compare 6, books 27, people 46. | Link the 8 lists from their parent category or the lists hub. Not done; small and safe, say if you want it. |
| 5 | Trust | `/methodology` was noindex and blocked in `robots.txt`; it claimed ranking factors (recency, source quality, confidence) I could not find in the list-sorting code (it sorts by recommendation count, then rating). The About page names no editor or owner. The Amazon disclosure is in the footer; all 31,655 Amazon links are `nofollow sponsored`. | Done: methodology is indexable, in the sitemap, accurate, with a "what the counts can't tell you" section. **You:** if the removed ranking factors are real, say so and I'll restore them. Naming who runs the site is something only you can supply. |
| 6 | AI search | `llms.txt` and markdown twins exist. No AI-answer tracking is set up and the connector shows 0 AI referral sessions (but GA4 is empty, so that is "unmeasured", not "zero"). One-off check, 5 prompts on 3 engines: about $0.24; weekly tracking about $0.85 a month (OpenSEO estimate). | Not run: it needs a saved recurring tracker, which is your call. |
| 7 | Over-trusting estimates | The 2026-10-23 research modelled 7 organic visits a month; Search Console shows 27 clicks in October. The connector's "estimated extra clicks" use a CTR curve fitted to very little data. | Use Search Console as the baseline; treat modelled numbers as relative only. |

## Needs your decision

1. **Weak lists.** 17 published lists have thin recommendation support. Options: leave, noindex, or un-publish. This changes live pages, so not done, and best decided after the core update finishes.
2. **Stricter gate** (at least 5 books with 2+ recommendations; no book above 70% of all recommendations) in the live publishing task. The queue is nearly exhausted, so low urgency.
3. **AI tracking** (about $0.24 once, or about $0.85 a month weekly).
4. **GA4 check** and **CrUX connection** (yours to do).
5. **Enid Blyton reading order:** verify publication years for the 868 books so the title can say "in Order".
6. **Cryptography list:** keep, rewrite the stored description to say what the data supports, or noindex.

## Re-running this

```bash
python3 -I scripts/qa/sitemap_audit.py            # crawl + checks (about a minute)
# list_support_audit.sql: run in the Supabase SQL editor
```
