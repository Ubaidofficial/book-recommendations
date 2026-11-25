# E-E-A-T and search-intent roadmap — 2026-11-25

Goal: make every indexable page clearly *more useful than what already ranks*, so pages stop reading as templated or thin and Google is willing to index them.

Scope and method:
- Search Console, GA4 and Clarity data through 2026-11-24 (via SEO Console).
- Supabase queries on the 54 published books and their recommendations.
- Live HTML of 9 pages: home, about, methodology, a book, a person, two lists and a series.
- Earlier audits: `seo-quality-audit-2026-11-14.md` and `competitor-research-2026-10-23.md`.
- Google's own documentation, gathered by a research pass on 2026-11-25. Sources are listed at the end. **Re-check the dated items before acting on them.**

Labels used below:
- *Measured*: read from data or the live site.
- *Google says*: official documentation.
- *Opinion*: industry analysis or my own judgement.

---

## 1. Bottom line

The site has a real, defensible idea: who recommended a book, and where they said it. Most pages do not yet prove that idea. Google is acting accordingly.

The four problems that matter most, in order:

1. **The core claim is mostly unproven on the page.** Of the source links behind published books, 85% point to compilation pages that more than five people share. Only 13% tie one person to one source. On the Atomic Habits page, 36 of the 52 claimed recommenders show "Source not confirmed yet". That includes the most famous names: Tim Ferriss and Derek Sivers. *(Measured)*
2. **Every published book page says its notes are unreviewed AI.** All 54 published books have `ai_quality_status = 'draft'`. Each page shows "Draft reader notes, written with AI help and not yet reviewed by an editor", in two places. *(Measured)* Google's rater guidelines treat AI-generated main content without oversight as "little to no effort". *(Google says)*
3. **Visible accuracy errors.** Examples:
   - The Atomic Habits "About the book" text describes the *workbook* edition.
   - Hyphens are stripped from titles and descriptions ("nutsandbolts", "RealWorld Cryptography", "SaintExupéry").
   - "★ 0.4" scores look like a 0.4-star rating.
   - Odd genre tags, such as "For Men" on *To Kill a Mockingbird*.

   *(Measured)* Google's guidance says trust matters most in E-E-A-T. *(Google says)*
4. **Intent mismatch on the pages Google already shows.** `/lists/best-cryptography-books` ranks around position 6 for "cryptography books 2024/2025/2026". It had 7,086 impressions and **0 clicks** in 90 days. Its #1 and #2 books are the novels *Snow Crash* and *Cryptonomicon*, while the searcher wants books that teach cryptography. *(Measured; the cause of the zero CTR is my inference.)*

There is no "About us" with a real person, and the methodology page is **blocked in robots.txt** (`Disallow: /methodology`) as well as set to noindex. *(Measured)* So nothing on the site answers Google's "Who / How / Why" questions.

**Indexing is the symptom to watch.** Of 466 URLs inspected, 135 are indexed (29%). Most published book pages are "Crawled – currently not indexed". *(Measured)* John Mueller said on 2026-11-10 that a large share of crawled- or discovered-not-indexed pages is "usually… a sign that Google's quality systems are unconvinced about your site." He added that "just making the site smaller doesn't significantly raise the overall quality." *(Google staff, see sources)*

---

## 2. What the data says

### Search Console (bookmentions.net)

| Window | Clicks | Impressions | CTR | Avg. position |
|---|---:|---:|---:|---:|
| Last 28 days | 64 | 19,684 | 0.33% | 21.1 |

Impressions rose about 3.5× on the previous 28 days. Clicks did not keep up.

| Folder (90 days) | Pages | Clicks | Impressions | Avg. position |
|---|---:|---:|---:|---:|
| `/lists/` | 70 | 9 | 19,162 | 31 |
| `/people/` | 11 | 10 | 492 | 24 |
| `/series/` | 11 | 1 | 1,396 | 34 |
| `/books/` | 4 | 0 | 31 | 52 |
| `/compare/` | 2 | 0 | 3 | 23 |

How to read this:
- **Person pages** earn the best clicks per impression: "james clear reading list" (9% CTR), Ray Dalio, Nancy Pearl, Jeff Bezos. That is the core intent working.
- **List pages** get the impressions but almost no clicks.
- **Book pages** are almost invisible.

### High-impression, zero-click queries (90 days)

These are fixable through intent and content, not metadata alone:

| Query | Impressions | Position | Page |
|---|---:|---:|---|
| cryptography books 2024 / 2025 / 2026 | ~6,900 combined | 5.4–7.0 | best-cryptography-books |
| book recommendations | 1,177 | 8.4 | home / `/lists` |
| project management books 2026 | 441 | 4.1 | best-project-management-books |
| sailing books 2024 | 312 | 8.8 | best-sailing-books |
| barbara cartland books in order | 223 | 10.7 | series |
| enid blyton books in order | 361 | 11.5 | series (1 click) |
| leadership books 2025 | 139 | 9.6 | — |

### Supabase: the 54 published books

| | Count |
|---|---:|
| Recommendations on published books | 1,808 |
| … with a `source_url` | 1,748 |
| … whose source URL is shared by more than 5 people (compilation page) | 1,482 (85%) |
| … whose source URL belongs to exactly one person | 235 (13%) |
| Published books with AI notes in `draft` (unreviewed) | 54 of 54 |

The page code already hides the shared sources, which is the right call. The result is that the evidence visible on the page is thin. The most-cited source hosts are medium.com (239), twitter.com (232), tim.blog (204), onegrandbooks.com (148), blog.longnow.org (126) and fs.blog (119). Some of these, such as onegrandbooks and Long Now's lists, are aggregations, not the person speaking.

### Engagement and measurement

- **GA4:** 503 of the last 28 days' sessions are `(not set)` / Unassigned with 0% engagement. That points to a tracking or bot problem, and it makes engagement figures unreliable until fixed. *(Measured; cause not confirmed.)*
- **Clarity (latest day):** 15 of 19 sessions were bots. Average scroll depth was 23.5%, and 21% of real sessions had a quick-back click. The sample is too small to draw conclusions from.
- **AI assistants already send visitors.** `/lists/most-recommended-books` got 10 of its 11 sessions from AI assistants. robots.txt allows all crawlers, including OAI-SearchBot and PerplexityBot.

---

## 3. What Google says (most relevant points)

Every item below has a source in section 9. Dates are when the page was last updated.

- **Helpful-content questions** (updated 2026-10-05):
  - "Does the content provide original information, reporting, research, or analysis?"
  - "Are you mainly summarizing what others have to say without adding much value?"
  - "Attribution or giving credit to other sources doesn't replace the need for original effort."

  This last line goes to the heart of an aggregation site.
- **Who / How / Why:** use bylines where readers expect them. Disclose how automation was used. **Never invent personas.** Google calls fake creator profiles deception.
- **Rater guidelines (Sept 2025 version):**
  - 4.6.5 (scaled content abuse): pages made "at scale with no original content or added value" are rated Lowest.
  - 4.6.6: content that is "copied, paraphrased, embedded, auto or AI generated… even if the page assigns credit… to another source" is also rated Lowest.
- **Spam policy, scaled content abuse** (updated 2026-11-23): "Stitching or combining content from different web pages without adding value" is a named example.
- **Writing high-quality reviews** (applies to "best X books" lists):
  - Explain *why* something is best for a purpose, with evidence.
  - Say who each item suits.
  - Make sure ranked lists have "enough useful content… to stand on their own".
  - Consider links to more than one seller.
- **AI features:**
  - There are no special requirements; a page must be indexed and eligible for a snippet.
  - Google ignores llms.txt.
  - Google's AI-optimization guide (2026) says to write "non-commodity content", and that making pages for query variations to manipulate AI answers is scaled-content abuse.
  - The research pass reports a new Search Console setting for including a site in generative AI features. **Check that it is on.** I could not see it from here.
- **Structured data:**
  - FAQ rich results are gone (May 2026).
  - ItemList carousels do not support books.
  - Review stars are allowed only for *your own* reviews, never aggregated Goodreads or Amazon ratings.
  - ProfilePage is meant for creators who belong to the site, not for celebrity reading-list pages.
  - Breadcrumb and Organization markup still work.
- **Timing:** a November 2026 core update finished on Nov 24, and a December 2026 core update was pre-announced the same day. *(Re-check the Search Status Dashboard.)*

Opinion: Lily Ray's and Glenn Gabe's 2026 analyses describe sites losing templated folders. Their examples were one template repeated thousands of times (word × area code, "X vs Y" pairs), mostly away from the site's core offering. `/compare/` and the large `/series/` set fit that description most closely here.

---

## 4. Why the pages read as templated or thin

These are specific findings from the live pages, not general advice.

### Book page (`/books/atomic-habits-james-clear`, 2,590 words)

| Finding | Why it matters | Fix |
|---|---|---|
| "Recommended by 52 people" in the H1 area and title. The page then lists 36 of them under "Source not confirmed yet". The sourced ones include low-profile accounts (@optionshawk, @csuram88), while Tim Ferriss and Derek Sivers are unsourced. | The headline claim is not backed up where readers look first. This is a trust problem. | Lead with **sourced** recommenders, quote first. Show "52 recommendations on record, 11 with a public source". Spend sourcing effort on the famous names (section 6). |
| "About the book" describes the companion workbook. | A factual error on a top book. | Validate descriptions against title and edition. Prefer Open Library work-level descriptions, or write a short one by hand. |
| "Books like Atomic Habits": Factfulness, *The Boy, the Mole, the Fox and the Horse*, *The World as It Is*, *Anger* by Gary Chapman. | Misses the intent of "books like X", where searchers expect *The Power of Habit*, *Tiny Habits* or *Deep Work*. The page's own "Read next" block is better. | Build "books like" from topic and theme similarity plus shared recommenders. Drop "Try this instead" unless it is editorial. |
| AI reader notes plus the "draft, not reviewed" label, shown twice. | Tells readers and raters the unique content is unreviewed. | Have a named editor review all 54 (a few days of work) and show "Reviewed by <name>, <date>". Keep the AI disclosure in one place. |
| The recommender list appears twice (hero and "Who recommended"). The FAQ "Is it worth reading?" glues the bullets together with semicolons. A "How recommendation signals are reviewed" paragraph is identical on every book page. | Repeated, machine-joined text is the "templated" feel. | Remove duplicate blocks. Write FAQ answers as sentences, or drop the FAQ (no rich result any more). Replace the boilerplate with a link to the methodology page. |
| Reddit counts "run to March 2023". | Stale data shown as a feature. | Refresh, or mark it clearly as a historical signal. |
| Recommender roles are missing (34 of 47) or generic ("Indian-American businessman"). | Expertise of the recommender is the E-E-A-T story. | Fill in roles for the top 200 recommenders by hand (who they are, and why their pick matters for this topic). |

### List page (`/lists/best-cryptography-books`)

- **Topical relevance:**
  - #1 *Snow Crash* (33 recs) and #2 *Cryptonomicon* are novels.
  - 34 of 46 books have one recommendation or none, and are padded with publisher blurbs that have their hyphens stripped.
  - Ranking by raw recommendation count lets popular-but-adjacent books win topic lists.
- **No editorial voice:**
  - The "at a glance" text is generated from counts.
  - There is no "who this list is for", no "start here if you're a beginner / engineer / history reader", and no reason given for why #1 is #1.
- **Fixes:**
  - Rank by **topic relevance × recommendation strength**.
  - Split into intent sections: *Learn cryptography (beginner)*, *Applied / engineering*, *History of codes*, *Novels about cryptography*.
  - Add 2–4 sentences per top-10 book on why it is here and who it suits.
  - Hide or collapse unrecommended padding.

### Person page (`/people/james-clear`): the strongest template

- Good: a real intro, a cited source (jamesclear.com), a photo with licence, the shelf UI.
- Gaps:
  - Only 5 of 67 books carry James Clear's own words.
  - "★ 0.4" reads as a rating.
  - "For Men" genre tags.
  - "Also: Nat Eliason" appears on almost every card, because one prolific profile dominates co-recommendation.
- Intent ("james clear reading list / book recommendations"): searchers want his favourites, what he said about each, and where to start. Add:
  - "His most-repeated picks", meaning books he mentioned across several sources or years.
  - Quotes with dates.
  - "If you liked Atomic Habits, start with…"

### Series page (`/series/enid-blyton-books-in-order`)

- Titled "Full List". The page says it has no verified order and lists 868 titles chronologically: 244 with a year, and 623 without.
- Searchers for "enid blyton books in order" most likely want **the Famous Five, Secret Seven, Malory Towers and St Clare's orders**. *(Opinion)*
- Fix: group by sub-series, each with a verified order. That is a contained piece of research per author. Do not publish author pages without that.

### Site-wide

- **The mega-menu puts about 330 words of identical nav text** at the start of every page's HTML, ahead of the main content, and the footer repeats more. I am **not confident this affects ranking**, since Google separates boilerplate. It does make the main content a smaller share of each page. *Low priority.*
- **About page:**
  - 4 short paragraphs.
  - No named person, no contact details, no editorial policy.
  - Generic phrasing: "the world's most respected people".
  - Google currently reports it as "URL is unknown to Google".
- **Methodology page:**
  - About 200 words, noindexed and robots-blocked.
  - Claims "Each source is recorded with a URL and retrieval date". Pages show many unsourced recommendations, so the claim needs to match reality.
- **Compare pages:** 53 indexable "X vs Y" pages of about 470 words. This is the pattern industry analysts report being hit. *(Opinion)*
- **Accuracy:**
  - At least 25 book descriptions contain confirmed stripped-hyphen words.
  - A loose pattern match flags about 900 titles. That count includes false positives such as "McCarthy", so a proper check is needed before quoting a number.

---

## 5. Search intent by page type: what each page must answer

| Page type | Main queries | What the searcher wants | What we uniquely have | Page must lead with |
|---|---|---|---|---|
| Person | "X reading list", "X book recommendations", "books recommended by X" | The complete list, X's favourites, X's own words, where to start | Cross-source compilation, sources, dates, overlap with peers | X's top picks with quotes and dates, then the full filterable list |
| Topic list | "best X books (year)", "X books to read" | A short, trustworthy ranked list for *their level*, and why each book | Which notable people recommend each book | An editorial top 10 with per-book reasons and recommender quotes, split by reader type |
| Book | "who recommended X", "is X worth reading", "books like X" | Social proof from people they respect, honest fit, alternatives | Named recommenders and their quotes | "Who recommends it, in their words", then fit, then real alternatives |
| Series | "author books in order", "X series order" | A correct reading order, grouped by series | Little recommendation data (off-core) | A verified order per sub-series, or don't publish |
| Compare | "X vs Y books" (little demand) | — | Overlap data | Probably noindex (see P1) |

---

## 6. Roadmap

### P0: Trust bugs (this week; mostly code or data fixes)

1. **Fix hyphen stripping** in titles and descriptions at the import or enrichment step, then re-clean stored rows. Start with the published books and lists.
2. **Wrong-edition descriptions:** flag descriptions that mention "workbook", "companion", "summary of", "study guide" or "journal" on books that are not that type. Re-pull or hand-write.
3. **"★ 0.4" score:** stop showing a star. Show "BookMentions score 4/10" with a tooltip, or remove it.
4. **Genre tags:** suppress Google Books categories such as "For Men" and other junk tags from the visible UI.
5. **Unblock and index `/methodology`** (remove it from robots.txt `Disallow`, set `index, follow`). Then rewrite it (P1).
6. **GA4 `(not set)` sessions:** find the source, likely bots or a tag firing without a page_location, so engagement data can be trusted.
7. Check the **Search Console generative-AI setting**, and that Search Console shows no manual actions.

**P0 status (2026-11-25):**

1. Done, partly.
   - 5,817 books had their stripped punctuation restored by `scripts/punctuation_repair.py`, which can only add hyphens, spaces or apostrophes and never changes a letter. Every row is backed up in `bak_seo_changes_20261114`, batch `punctuation_repair_20261125`.
     - Titles and authors: 173 fixes verified against Open Library. Space-only changes were refused, which protects brand names such as StrengthsFinder.
     - Descriptions, titles and subtitles: 5,644 rows repaired by a reviewed map of 944 spellings plus `you?re` → `you’re`.
   - On visible books, 0 contraction errors are left.
   - About 1,000 descriptions with curly-quote `?` corruption are now hidden instead of shown.
   - Joined words with no hyphenated example in clean text (e.g. "recordbreaking") are still there.
   - The remaining ~1,800 non-visible suspect titles can be run later with `titles` (resumable).
2. Done for published books. Six descriptions replaced (batch `published_descriptions_20261125`).
   - A pattern-based "wrong product" filter was tried and dropped: on the full catalogue it mostly caught legitimate companion books and workbooks.
3. Done. Removed the score chip and the "Highest score" sort. `books.rating` only holds 0.0–0.9.
4. Done. Audience lists (`best-books-for-*`) are no longer shown as person topics.
5. Done. Unblocked, indexed, in the sitemap, and rewritten to match what the code does.
6. Investigated. GA4 is set up correctly (one GA4 tag; tracking health OK). The noise comes from traffic, likely bots: Direct had 2,587 sessions at 4% engagement and (not set) 511 at 0%, while Organic was 73% engaged and ChatGPT 69%. Next steps:
   - Mark `amazon_click` as a key event in GA4.
   - Judge engagement by channel until the bot traffic is filtered.
7. Not done; owner action. Search Console generative-AI setting and manual-actions check.

### P1: E-E-A-T foundation (2–3 weeks)

1. **A real "Who"** *(do not invent a persona)*:
   - Rebuild `/about` with the founder's or editor's real name, background, photo, why the site exists, how it makes money (Amazon affiliate, stated plainly), a contact email and a corrections policy.
   - Add an `/editorial-policy` page, or fold it into methodology.
2. **Methodology as a proof page:**
   - What counts as a recommendation versus a mention.
   - Source tiers: own words (podcast, post, own site) > interview > compilation list.
   - How shared sources are handled.
   - How lists are ranked.
   - How AI is used and what humans review.
   - Update cadence.
   - Live counts ("x of y recommendations have a primary source").
   - Link to it from every evidence block.
3. **Human review of all 54 published books' notes:**
   - Change the label to "Reader notes reviewed by <editor>, <date>".
   - Gate future publishing on review: no `published` book with `draft` notes.
4. **Per-page provenance in one line:** "52 recommendations on record · 11 with a public source · last checked <date>". Stop the headline from implying all 52 are verified.
5. **`/compare/` pages:** noindex all of them, unless a pair has real demand (Search Console currently shows 3 impressions in 90 days). Keep them reachable for users.
6. **Series:** only keep indexed those with a verified order. Group large authors by sub-series. Pause the rest.

**P1 status (2026-11-25):**

1. Done, brand-only, by the owner's choice: `/about` names no individual and says so. It covers who runs the site, how it is funded (Amazon affiliate, which does not affect ordering), AI use, known gaps, and contact and corrections. The Organization JSON-LD gains `email` and `publishingPrinciples`.
2. Done in P0 (methodology rewrite). Book pages now link to it from the evidence section and the closing box.
3. Tool built; the human review itself is the owner's job.
   - `/admin/review` lists the 54 published books' notes. Each one can be approved as-is, edited then approved, rejected (hidden), or reset to draft.
   - Writes go only through `review_book_notes()` (migrations/011). It checks a review key against a stored SHA-256 hash; keys and the audit log are unreadable by public roles. Verified as the `anon` role: reading keys and log is blocked, direct book updates change 0 rows, and a wrong key is refused.
   - Approved notes show "reviewed by a BookMentions editor · reviewed <month>".
   - Not yet enforced: a gate that blocks publishing books whose notes are still draft. Enforcing it now would unpublish all 54.
4. Done.
   - The evidence section shows "N recommenders on record · M with a source tied to them". The closing box is now specific to the book instead of the same paragraph on every page.
   - **New finding:** `recommendation_count` includes records filed under a bare surname with no profile ("Abdaal", "Stone"), some of which duplicate a named person.
     - Scale: 347 of 1,814 recommendations counted on published books (19%), on 53 of 54 books; 4,629 rows catalogue-wide.
     - Book pages now state the gap.
     - Open owner decision: recount, or merge the aliases into real people.
5. Done. The compare allowlist is emptied: all compare pages are `noindex, follow` and out of the sitemap, and person pages no longer link to them. The 15 kept on 2026-11-15 had earned 3 impressions and 0 clicks in 90 days.
6. Mostly already true. 70 of 71 published series have a verified order (69 by publication year, 1 by position). The exception is Enid Blyton, the series page with the most impressions. It still needs grouping by sub-series, which requires a source for each series' membership.

### P2: Intent rebuild per template (1–2 months; the "10x" part)

**Lists (biggest impression pool):**
- Relevance-weighted ranking. A topic-fit check (genre/subject match against the list topic) runs before recommendation count.
- Sections by reader type.
- An editor-written intro of 120–200 words: who the list is for, how it was picked, what's notably missing.
- Per-book "why it's here" for the top 10, plus the strongest recommender quote.
- Hide padding books with no recommender. Or label them clearly: "Also in the catalogue, no notable recommendation yet".
- Start with the 10 lists that already have impressions: cryptography, project management, sailing, sports biographies, fiction, travel, history, growth hacking, human resources, marketing.

**Books:**
- The recommender quote block comes first.
- Fix "books like".
- Write one-sentence "why X recommended it" where a quote exists.
- Remove duplicate blocks and boilerplate.
- Drop the FAQ block, or make it hand-written.

**People:**
- "Most-repeated picks".
- Quotes with dates.
- "Start here" (3 books with reasons).
- Timeline (e.g. "recommended in 2016 on the Tim Ferriss Show, again in 2021 on his blog").
- Down-weight a single prolific profile, such as Nat Eliason, in "Also recommended by" so the overlap looks less repetitive.

**Make sections conditional on data.** A section appears only when its data says something specific about *this* page. That is the most direct cure for the templated feel: two pages of the same type then look different because their data differs.

### P3: Build the moat (ongoing)

1. **Primary-source sourcing programme.** For the top 200 recommendations on published pages (famous person × popular book), find the person's own words: podcast episode plus timestamp, tweet, blog post, shareholder letter. Store quote, date and URL. Competitor research (Oct 2026) found MRB does this per recommendation and goodbooks does not, so it is both the quality bar and the gap.
2. **Original data studies** (linkable, and E-E-A-T "original research"):
   - "The 50 books founders recommend most — 2026 data".
   - "Which books do investors and scientists agree on?" (the overlap/Venn data you already compute).
   - An annual "most recommended books of the year".

   These are the most realistic way to earn links. The site has about 56 referring domains, most spammy (Oct 2026 data), against about 4,600 for MRB.
3. **Recommender involvement:** a "Is this you? Suggest a correction or add a pick" link on person pages. Corrections from the person are first-hand evidence and sometimes earn a link.
4. **A freshness loop:** a monthly "new recommendations this month" page or newsletter, built from real new rows, never placeholder updates.

### P4: Measurement

- North-star metric: **share of published URLs indexed**, from the SEO Console monitor; it is 29% of the inspected sample today. Track it per folder.
- Second metric: **clicks per published page per folder**.
- Run P2 on the 10 lists with impressions first. Compare the 28 days before and after with `start_seo_test`, then roll out further.
- Leave changes in place through the December core update. Don't judge them within the rollout window.

---

## 7. What not to do

- **Don't publish more pages to "build authority".** Mueller (Sept 2026): "Expanding it with even more generated data… doesn't make it more useful for users."
- **Don't create author personas or AI headshots.** Google explicitly calls this deception.
- **Don't add Review or AggregateRating markup** built from Goodreads or Amazon data, or from the internal score.
- **Don't mass-delete to shrink the site.** Google's December 2025 core-update doc calls deletion "a last resort". Noindex what fails the bar, and improve the rest.
- **Don't keep adding FAQ blocks for rich results.** They no longer show.
- **Don't add "(2026)" to a title unless the page's content was actually reviewed that year.**

---

## 8. Open questions and uncertainties

- The 85% "shared source" figure counts a URL as shared when more than 5 distinct people use it. Some shared URLs may be legitimate, such as a podcast episode with several guests. The real share of weak sources could be somewhat lower.
- I could not see the Search Console generative-AI setting, manual actions, or Core Web Vitals from here.
- GA4 engagement numbers are unreliable until the `(not set)` sessions are explained.
- The industry case studies are opinion, and none names a programmatic site that survived. They show the failure pattern, not a proven recipe.
- I cannot promise a "10x" outcome. Indexing and rankings depend on Google's systems, links and competition. The plan targets the gaps that Google's own documentation and our data point to.

---

## 9. Sources

Google (official):
- Creating helpful, reliable, people-first content: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Search Quality Rater Guidelines (Sept 11, 2025 PDF): https://guidelines.raterhub.com/searchqualityevaluatorguidelines.pdf
- Spam policies: https://developers.google.com/search/docs/essentials/spam-policies
- Using generative AI content: https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
- Write high quality reviews: https://developers.google.com/search/docs/specialty/ecommerce/write-high-quality-reviews
- AI features and your website: https://developers.google.com/search/docs/appearance/ai-features
- Optimizing for generative AI features: https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- Core updates: https://developers.google.com/search/docs/appearance/core-updates
- Search Status Dashboard (ranking updates): https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history
- Page indexing report help: https://support.google.com/webmasters/answer/7440203
- Structured data gallery: https://developers.google.com/search/docs/appearance/structured-data/search-gallery
- Review snippets: https://developers.google.com/search/docs/appearance/structured-data/review-snippet
- Search Central updates log (FAQ removal, spam policy in AI responses): https://developers.google.com/search/updates
- John Mueller on Bluesky, 2026-11-10: https://bsky.app/profile/johnmu.com/post/3mzycywr5vs26
- John Mueller on Bluesky, 2026-09-07: https://bsky.app/profile/johnmu.com/post/3muwiaqve6k22

Other engines (official):
- OpenAI crawlers: https://developers.openai.com/api/docs/bots
- Perplexity crawlers: https://docs.perplexity.ai/guides/bots

Industry (opinion):
- SEJ on the November 2026 core update (Lily Ray's examples): https://www.searchenginejournal.com/google-november-2026-core-update-complete/598751/
- Glenn Gabe, August 2026 spam update case studies: https://www.gsqi.com/marketing-blog/august-2026-google-spam-update-case-studies/
- Marie Haynes on "Crawled – currently not indexed": https://www.mariehaynes.com/crawled-currently-not-indexed/
- Ahrefs on AI Overview citations: https://ahrefs.com/blog/ai-overview-citations-top-10/
