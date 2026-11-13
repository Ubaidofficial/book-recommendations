# Changelog

## 2026-11-13 — Re-check: names with middle initials or titles

- The same-name rule now also accepts a page name with the same first and last name when the only differences are titles, initials or a middle name ("Balaji S. Srinivasan" / "Balaji Srinivasan", "Richard H. Thaler" / "Richard Thaler", "Dr. Andrew Weil").
- Re-running the re-check found 10 more own-account tweet rows; 2 were already done. 8 were written (batch `index_tweets_20261113r3_b00`), and 2 Thaler rows got the tweet text as their quote at confidence 70.

## 2026-11-13 — Re-check of the orphaned recommendations: missing index pages

- The re-check now also reads the outside index's own people listing, which names 764 people where its sitemap names 653. The 111 missing person pages were downloaded, plus the 6 person pages (3 on each outside index) that loosely matched our people but had never been downloaded.
- A page now counts as the person's only when its own name equals the person's full name after accent and punctuation folding, or an alias in ALIAS_GROUPS. This held back the 6 never-downloaded pages, which give a shorter or longer form of the name (a middle name or initial, or "Dr."); 8 own-tweet rows (Balaji S. Srinivasan 6, Richard H. Thaler 2) wait on an alias decision.
- 29 more of our people matched a newly downloaded page. 3 new rows cite a tweet from the person's own account (David Copperfield, Emily Ratajkowski, Michael Smerconish); all 3 were hand-checked and written with source_url = the tweet and confidence 60 (batch `index_tweets_20261113r2_b00`, backed up first). None of the 3 tweet texts names the book, so no quotes were written.
- Scripts in `scripts/recheck_orphans/` take an output directory argument.

## 2026-11-13 — Re-check of the orphaned recommendations: 1,020 more sources

- An independent re-check (`scripts/recheck_orphans/`) matched all 6,505 orphaned recommendations against both outside indexes. It used looser person and title matching against their full people lists and every cached person page.
- 2,796 of the 6,505 are listed on at least one index for that same person. 1,022 of those cite a tweet from the person's own account: the handle equals the one on the index's profile for that person, `people.twitter_handle` or HANDLE_MAP. The earlier runs had skipped them because X blocks automated reading, so the tweet could not be opened.
- Hand check: 26 random rows of this kind, all correct. In 365 of the 1,022 the index's copy of the tweet names the book.
- Written: **1,020 rows** (2 had changed and were skipped). Each now has source_url = the person's tweet and confidence 60. The quote is empty, because the tweet text could not be checked at the source. The writes were a 10-row pilot plus 6 batches, each with a payload checksum, a snapshot guard and a backup in `public.bak_recs_primary_sources_20261112` (batches `index_tweets_20261113_*`).
- Recommendations with the person's own source are now 1,289 of the 6,505 (269 earlier plus 1,020).
- Still without a source: the person is on neither index (3,019 rows); the person's index page does not list the book (657); the book is listed but the cited link failed the checks (aggregator or bookstore, other people's accounts) or no link is cited. Per-row detail is in `reports/orphan_recheck_20261113.csv` (gitignored).

## 2026-11-13 — Five recommendations confirmed by hand

- Gabor Maté: Don Quixote, The Dhammapada and The Drama of the Gifted Child now cite his Tim Ferriss episode (tim.blog/2018/02/20/gabor-mate/) at confidence 60, quote empty. The episode transcript has Tim naming all four books from Maté's own book and Maté discussing them. These were held back by the medium-precision gate, then confirmed by hand.
- Brené Brown: The Book of Qualities and The Power of Starting Something Stupid kept their own-blog source. Their old pipe-joined, garbled quotes were replaced with her exact words from that post.
- Backed up in `public.bak_recs_primary_sources_20261112` (batch `manual_20261113`) before writing, with a snapshot guard.

## 2026-11-12 — Weak primary-source candidates checked at the source

- The 613 weak candidates from the entry below were checked at the source itself by the new `scripts/verify_weak_primary_sources.py`. As before, an outside index was used only to find where to look. Nothing from it is stored.
- Rules: the person must be the author or the speaker. Their own words naming the book must be on the page, not a story or list about them. Comments, sponsor reads, menus and related-post blocks are removed first. Show notes that only list "books mentioned" in an episode do not count.
- Results: **80 confirmed**, 150 rejected and 383 unreachable.

  | Type | Confirmed | Rejected | Unreachable |
  |---|---|---|---|
  | Tweet | 0 | 0 | 135 |
  | YouTube | 1 | 2 | 104 |
  | Podcast page | 17 | 78 | 0 |
  | Interview | 13 | 18 | 24 |
  | Blog | 0 | 18 | 28 |
  | Other | 49 | 34 | 92 |

- Tweets were looked up only through the Wayback Machine, and X itself was never fetched. web.archive.org could not be reached from this environment, and archive.org's lookup service answered 429 after about 90 lookups, so the run stopped there. None of the 135 tweets could be read, so none were written.
- YouTube video pages answered with a bot check (a redirect to a page that answers 429). The fetcher did not count that as a 429 at first, so the run was stopped by hand, and the script now stops on it. Only the video title and channel, cached by the earlier run, were usable. One video names the person and the book in its title and was written. The other 104 do not name the book in the title, and their descriptions could not be read.
- Main rejection reasons: the book is not on the page (70); the book is only listed in episode show notes (49); a story or list about the person rather than their own words (9); a compiled list of publisher blurbs whose author is unknown (8). There were 14 others, each with its reason in the CSV.
- Unreachable: robots.txt disallows the page (65, mostly Facebook posts), the site answered 403 (61), or the page was gone or could not be fetched (18).
- Written to production: **80 rows** at confidence 60, with source_url set to the original primary URL. That was a 10-row pilot, then batches of 40 and 31, guarded by a payload checksum and a snapshot check, with each row backed up first. The batch label is `weak_verified` in `public.bak_recs_primary_sources_20261112`. No row had changed since planning, so the snapshot check skipped none.
- 56 quotes were stored, each found word for word in the person's own text. Quotes that had been edited with brackets or ellipses were not stored.
- Hand check of 30 random written rows: 29 were right (97%). The miss was a paywalled book review: only the book's header was visible, not the person's words. That row was reverted to its earlier hidden state, which leaves the 80 rows above (81 were written).
- The 533 unconfirmed candidates, each with its reason, are in `reports/weak_candidates_unconfirmed_20261112.csv` (gitignored). They were left untouched.

## 2026-11-13 — Primary sources for orphaned recommendations: a second outside index

- The orphaned-recommendation search was repeated with a second outside recommendation index, collected once with the project owner's approval (one request at a time, at least 2 s apart, every page cached locally). As before, the index was used only to find where to look. Nothing from it is stored: no link to it, none of its text, no mention of it and no credit. New script: `scripts/rtt_primary_sources.py`. It reuses the matching and checking code of `scripts/find_primary_sources.py`, which now exposes those steps as shared functions; that script's output is unchanged.
- Scope: the 6,505 orphaned rows minus the 187 already handled on 2026-11-12 (186 written and the one reverted on purpose), so 6,318 rows, checked again against the live tables.
- The index has a page for 649 of the 1,426 people with orphaned rows, covering 3,228 of the 6,505 rows. Of the 1,043 people the first index had no page for, it covers 329 (1,023 rows). The newest date on any page was March 2023, so the index is no longer updated.
- Results: 2 strong candidates (the person's own blog), 6 medium (podcast show notes) and 181 weak. 6,129 rows have no candidate: for 3,249 the person has no page in the index, for 1,096 the book is not on their page, 1,779 had only unusable sources (809 tweets from accounts we could not confirm, 152 bookstore or aggregator links, the rest with no sign the person wrote or said it), and 5 now sit on a book with a different title after the merge.
- Tweets could not be checked this time. The archive service's lookup started refusing requests (too many requests) after about 300 lookups, and its snapshot server did not accept connections at all, so every tweet stayed weak or was rejected.
- New rule after the hand check: the index sometimes gives a sentence written about the person ("His primary book source on management technique is ...") as their quote. Such sentences are now ignored, so they can neither be stored nor count as the person's own words. This moved 3 rows from a magazine profile to weak.
- Hand check: 2 of 2 strong candidates were right. All 6 medium candidates were checked: 4 were confirmed (one in the episode's own timestamps, three in the episode transcript). The other 2 came from an episode with two guests whose show notes do not say which guest named the book. Medium precision was 4 of 6, below the 90% bar, so only strong rows could be written.
- Written to production: **0 rows**, 0 quotes. Both strong rows already carry exactly that source link, and the site already shows it as "Own source", so they were left alone, as in the first run. In all, 29 candidate rows already had their source link (2 strong, 3 medium, 24 weak).
- Weak candidates are only in a local CSV (`reports/rtt_weak_candidates_20261112.csv`).
- Checked afterwards: no link to or text from either outside index was added to any recommendation. One older row, outside this work, holds a person's own tweet that mentions the second index's account name.

## 2026-11-12 — Primary sources for orphaned recommendations

- 6,505 recommendations had a stored source that was a pipe-joined list belonging to other people (the site already hid it). `scripts/find_primary_sources.py` now covers all of them (`--scope all`), not just the 987 of published people. For each row it looks for the person's own tweet, podcast episode, interview, video or blog post, and checks that source itself. An outside recommendation index was used only to find where to look. Nothing from it is stored, and no link to it is stored.
- All 6,505 rows still exist after today's book merge. 3 were skipped because they now sit on a book with a different title.
- Results: 16 strong, 180 medium and 613 weak candidates. 5,696 rows have no candidate: 4,030 rows belong to the 1,043 people with no entry in the index, for 729 the book is not listed for the person, 934 had only unusable sources (bookstores, aggregators, other people's accounts), and 3 were the merge skips above.
- Rules tightened after a hand check:
  - Medium now needs the book named, or the person's words found, at the source itself. X, Facebook and Instagram block automated reading, so 135 tweet candidates and the YouTube ones moved to weak. One of them was a 2015 tweet about an author, cited for that author's 2020 book.
  - A news story about the person no longer counts as their interview unless their own quoted words are on the page.
  - A co-guest's own book, reader comments and podcast sponsor reads no longer count as the person's mention.
  - Sources dated two or more years before the book was published are rejected.
- Hand check: 16 of 16 strong candidates were right. 39 of 40 random medium candidates (final rules) were right; the miss was a co-guest's own book, which the co-guest rule now moves to weak.
- Written to production: **187 rows** (14 strong at confidence 80, 173 medium at 60), in guarded batches with a payload checksum and a snapshot check. That was a 10-row pilot, then 3 batches of 50 and one of 27. All rows passed. 9 more strong or medium rows already had the same source and were left alone. Weak candidates are only in the CSV.
- Afterwards one medium row was undone (Soman Chainani / The Graveyard Book): the book is in the podcast's show notes, but the host also names it in a sponsor read, so who mentioned it is unclear. It went back to its earlier hidden state, which leaves **186 rows** written (14 strong, 172 medium).
- 48 quotes were stored, each found word for word at the source. Quotes that had been edited with brackets or ellipses were not stored.
- Backup: `public.bak_recs_primary_sources_20261112`, with RLS on. The restore SQL is in the table comment.
- Checked on the local site against live data: /people/seth-godin, /people/james-clear and six book pages. The new sources show as "Own source" or "Podcast episode" with an "Open source" link.

## 2026-11-12 — Book covers: English editions only, second recovery pass

- `scripts/recover_covers.py` now takes a cover only from an English edition. Open Library covers come from the work's editions (`editions.json`). The edition's languages must include `eng`, or it must list no language and carry only group-0/1 ISBNs, and its own title must match the book. Amazon and the book's own ISBN must be in group 0/1 (978-0/978-1). Covers that Open Library imported from an Internet Archive title-page scan are rejected. Photos of library copies (often plain cloth or leather bindings) are tried last.
- New checks on covers that load fine: `google` (any Google Books URL), `foreign` (an Amazon ISBN outside group 0/1, or an OL cover whose edition is not English) and `maybe_not_cover` (an OL cover taken from an IA title-page scan). A text-page heuristic (low saturation, mostly white) only flags covers.
- Census of the 17,199 shown books before this pass: 6,529 ok, 9,956 bare filename, 347 empty, 177 placeholder, 90 Google, 68 foreign (39 Amazon, 29 OL), 32 title-page scans.
- Written to production, all high confidence and backed up in `public.bak_books_cover_20261112b` (the restore SQL is in the table comment): **2,237 covers**. That is 2,131 missing, 24 placeholder, 41 foreign, 31 not-a-cover and 10 Google. The 10 Google replacements are only the ones checked by hand as wrong: a title page, praise page, grey art, contents page or print template (Principles, Thinking Fast and Slow, The Psychology of Money, Steve Jobs, How to Win Friends, The Power of Habit, Surely You're Joking, Think and Grow Rich, Endurance, Crossing the Chasm). The other 80 Google covers are real covers and were kept.
- Hand check: 104 of 105 random high-confidence missing-cover candidates were right (right book, English, real cover). 42 of 43 foreign replacements and 32 of 32 title-page replacements were right.
- Applied the 31 remaining batches (`reports/cover_write_batches_20261112b/`, gitignored): 6,004 rows given, 5,870 written, 134 skipped because the book was deleted or its cover changed since the dry run. Every batch passed its checksum. Backup table total: 8,107 rows (7,874 missing, 151 placeholder, 41 foreign, 31 not_cover, 10 google); every surviving book has its new cover in place.

## 2026-11-12 — Book page v4: "Should you read it?"

### What changed on /books/[slug]
- **Hero.** The 3D book sits beside the title, with a row of facts underneath: how many people recommend it, how many sources we traced, pages, and difficulty. A fact is left out when its value is zero or unknown. The editorial summary follows when the book has one, with the label "Draft reader notes, written with AI help and not yet reviewed by an editor". The Amazon CTA (still `above-fold`) sits next to a "See who said it, and where" button. The sticky left rail is gone: one `Book3D` now serves both layouts (`mobileWidth`), so on phones the hero cover is the eager LCP image as well.
- **Is it for you?** has two cards, "Read it if you are…" (`best_for`) and "Skip it if…" (`not_for`), plus `key_themes` chips. It always carries the draft label, and it hides when neither list parses. It replaces the old Reading Profile strip, the "Should I read this?" card, the "Read this if / Skip this if" boxes, Before You Buy and Key themes, which repeated the same fields.
- **Who said it, and where** replaces "Recommendation Signals". Each recommender whose source passes `getProofDisplaySafety` (unchanged) gets a row with a source type (Tweet, Podcast episode, YouTube, Their own website, Interview, Article, Reference page, Other). An "Own source" note appears when the account or site is demonstrably theirs: their own handle, a handle that matches their slug, a hand-checked owned domain, or their name in the host. Each row links "Open source ↗" (`rel="noopener noreferrer nofollow"`). Everyone else appears in a "Source not confirmed yet" list, by name only and with no link.
- **Who recommends it, by profession.** Bars per profession bucket, from `people.role` and a conservative keyword classifier (`src/lib/roles.ts`). The section also says how many recommenders have no role on file, and it hides when fewer than 3 people are classified.
- **An unlikely pair.** Among the published recommenders with at least 15 picks, the pair whose shelves overlap least (Jaccard), with the real counts. On Sapiens: Keith Rabois and Richard Branson, 100 and 87 picks, and Sapiens is the only book they share.
- **Read next.** The books most often recommended by the same people, with "N shared recommenders". Other editions of the same work are skipped, and so are books without a valid cover or slug.
- The face grid no longer links sources (they were not gated). The "+N more" popover now shows a quote or source only when the gate allows it.
- Section headings use a serif. The methodology note now says sources are linked only when they can be tied to the person.

### 3D book (`src/components/Book3D.tsx`)
- Its height follows the cover's real aspect ratio, from the image's natural size or an `aspectRatio` prop, clamped to 1.36–1.62. The stage keeps its 2:3 box and the book stands on its floor, so a ratio that arrives late never shifts the layout. A taller cover rises above the box.
- Every `Book3D` turns over by default, including the homepage consensus shelf and person-page panels. Pass `flippable={false}` to turn that off.
- Click without dragging turns the book to its back cover and back again. Press and drag past 6px turns it freely, and on release it settles on the nearer cover. Enter and Space turn it when it has focus, and Escape returns to the front. It has `role="button"`, with `aria-pressed` set to show the back.
- There's now a back cover with the title, author and "Recommended by N people" (the optional `backTitle`, `backAuthor` and `backNote` props), on a blurred, darkened wash of the cover art.
- Paper grain on the boards and a warmer, brown contact shadow. The spine is now the cover's left edge blurred into a colour, so the cover lettering no longer shows on it.
- Motion is still a single rAF loop writing CSS variables, with no React re-render per frame. Under `prefers-reduced-motion` there is no tilt, drag, float or entrance, and a click shows the back without animating. Existing props are unchanged. The front face keeps the real `<img>` with its alt text.
- New CSS is in a `/* book page v4 */` block at the end of `globals.css`.

### Data (`src/lib/bookInsights.ts`)
- `getBookInsights(bookId, title)` makes three bounded reads: the book's recommendation rows (≤300), the shelves of up to 120 recommenders (paged, ≤6×1,000 rows), and ≤40 candidate books. It computes everything else in JS. Profileless surname stubs ("Ek", "Kloss") are excluded so nobody is counted twice. Results are cached for 15 minutes. A failed query throws inside the cache, so it is never stored, and the page gets empty sections instead.
- `src/lib/sourceKind.ts` labels source URLs. It does not decide visibility, which stays with `getProofDisplaySafety`. Its owned-domain map mirrors `DOMAIN_MAP` in `scripts/reattribute_quotes.js`.
- Self-checks for the role and source classifiers: `node --experimental-strip-types scripts/selfcheck_book_v4.mjs` (55 checks; no test framework added).

### Data caveats
- Most recommendation rows on popular books still carry a pipe-joined aggregate source. Those fail the gate and are listed as "not confirmed" (67 of 72 on Sapiens).
- A few `people` rows are not people (for example "Book Recommendations (43 Books)"). They appear in the unconfirmed names list until the data is cleaned.

## 2026-11-12 — Duplicate books merged (738 rows), old slugs 301 to the surviving book

The same book was often stored twice or more, mostly because the author name was written differently ("Letters from a Stoic" by "Lucius Annaeus Seneca" and by "Lucius Seneca", "High Output Management" by "Andrew S. Grove" and "Andrew Grove"). Recommenders and lists were split between the copies, so each page showed a lower count. A person page or list could also show the same book twice.

### What was merged
- Candidates: every group of books sharing a normalised main title (text before ":", lowercased, letters and digits only) that contains at least one book shown on the site (published, on a published list, or recommended by a published person). That gave **1,937 groups**. Shown books were also matched against books that are not shown.
- A pair counts as the same book only with author evidence: same surname with compatible first names or initials, one name's words contained in the other's ("Chip & Dan Heath" / "Chip Heath"), a surname typo with an identical first name, or a known pen name or transliteration (Galbraith/Rowling, LeSieg/Seuss, Dostoevsky/Dostoyevsky). Without a shared Amazon product or ISBN, a pair whose first names differ goes to review.
- A pair stays separate when anything points to a different work: subtitles that don't match ("Cravings" vs "Cravings: Hungry for More"), different volume or series numbers ("Dinosaur Training Secrets: Volume I/II"), adaptation or format words on one side only (graphic, workbook, summary, omnibus, young readers, a "Kids" author), or first-published years more than 3 years apart. Titles that are just a volume number ("Vol. 1"), 1–2 characters, or a one-word title naming the author without a full subtitle ("Trump", "Will") go to review. A merge group is accepted only if no pair inside it conflicts.
- 38 pairs had the same Amazon product and the same full title and subtitle, but one row named a recommender as the author ("Quiet" by David Blaine, "Abundance" by Arnold Schwarzenegger). They were merged into the row with the real author, and that row is always the one kept.
- 20 review groups were checked by hand and merged: co-authors, editors, translators, pen names and later editions (Hooked, Billion Dollar Whale, The Bhagavad Gita (Easwaran), First Break All the Rules, The Red Knight).
- Result: **716 groups merged, 738 rows deleted**. 37 groups (76 rows) are left for review and the rest are kept separate. The plan, with a reason for every row, is in `reports/dedupe_20261112/plan.csv` (gitignored), made by `scripts/dedupe_books/plan.py`.
- Hand check: all 716 merge groups were read. The rules were tightened until none was wrong. Two wrong merges found in early drafts were fixed: Dinosaur Training Secrets Vol. I/II, and The Travel Book adult vs Kids edition. 107 kept-separate pairs were also checked. Every different-author pair was a different book. Of the same-author pairs kept apart, about half are missed merges (e.g. "The Passage of Power" "Vol. IV" vs "Book 4"), which are left for review on purpose.

### How rows were merged (one transaction per batch: a pilot of 10, then 15 batches of at most 50)
- Kept row: the published one, then the one already shown on the site (to keep the indexed URL), then the most recommendations, a valid cover, a useful description or editorial, and the oldest. Its empty fields were filled from the duplicates and never overwritten: 38 covers, 57 descriptions (under 80 characters counts as empty), 75 subtitles, 45 first-published years, 8 editorial blocks, 8 Amazon links.
- Links moved to the kept row: 522 recommendations, 684 list memberships, 42 series memberships and 28 author links. When one person had recommended two copies, only one recommendation was kept: the one with a clean single source, else the longer quote. That dropped **408** rows. The same book twice on one list kept the better rank, dropping 142 rows, and `lists.book_count` went down to match. Two author links were dropped as duplicates.
- `recommendation_count`, `list_count`, `series_count` and `author_count` were recomputed for the 716 kept rows: distinct recommenders, lists, series and authors, as the import does. Kept books gained 412 recommenders in total ("The 4-Hour Workweek" now has 59, "Influence" 38).

### Redirects
- Each removed slug is stored in the existing, empty `public.slugs` table: `entity_type='book'`, `entity_id` = the kept book, `is_primary=false`. That is 738 rows. `migrations/006_book_slug_redirects.sql` adds an anon read policy (book rows only) and an index.
- `next.config.js` serves the 738 slugs as real **HTTP 301**s from `redirects/book-merges-20261112.json`, exported from `public.slugs`. A redirect from inside the book page can't set the status, because `books/[slug]/loading.tsx` streams the response first.
- Fallback for later merges: when no book has the slug, the book page asks `getBookRedirectSlug` (src/lib/data.ts), which reads `public.slugs` and resolves to the kept book's current slug, then calls `permanentRedirect` before `notFound()`. In a stream that is a client-side 308.
- 13 genre-map keys in `src/lib/bookGenres.ts` pointed at removed slugs. Seven now point at the kept slug. Six were dropped because the kept slug already had the same genre.
- The sitemap and lists no longer contain removed slugs because the rows are gone. Checked: 0 of 54 sitemap book URLs.

### Backup and restore
- `bak_books_dedupe_20261112` holds the full rows of every deleted duplicate and every kept row as it was before. `bak_book_links_dedupe_20261112` holds every recommendation, list, series and author row of both, as jsonb, plus the `lists` rows whose `book_count` changed. RLS is on for both, and a table comment explains the restore. The full restore SQL is at the bottom of `scripts/dedupe_books/merge_20261112.sql`.

## 2026-11-12 — One Amazon button per book card on person pages

- Person pages showed two "View on Amazon" buttons on every recommended book: BookCard's own button, plus a second one the page appended below the card. The extra button is gone. BookCard now gets the book's `amazon_url`, so its single button links to the product page (an Amazon search is the fallback), and it keeps the person page's `people-detail-rec` analytics label through a new optional `trackSection` prop.

## 2026-11-12 — Person page depth and shelf comparison pages

### Person pages (`/people/[slug]`)
- **On the shelf**: up to 16 of the person's picks, ordered by how many people on BookMentions recommend each one, drawn as book spines. Each spine is a real `<button>` (`aria-pressed`, "Title by Author" label). Arrow keys, Home and End move along the shelf. Picking one shows it in a side panel as a 3D book (the existing `Book3D`), with a link to the book page and, when this page has one, to its proof card. Spine colours come from a fixed neutral palette chosen by a stable hash of the slug (no image processing). Heights come from the same hash and widths from page count. Motion is transform-only behind `motion-safe`.
- **What <first name> reads most**: published lists that hold the most of the person's recommended books (top 8, with counts and a proportional bar), linked to `/lists/<slug>`. Catch-all lists are left out: `most-recommended-books` (5.7k books), `nonfiction` (7.8k), `fiction` (4.7k), plus any list over 3,000 books. They held 157, 92 and 40 of Naval's books and would push every real topic down. `books-recommended-by-*` lists are also left out because they group books by recommender, not by topic.
- **People with a similar shelf**: other published people ranked by shared recommended books (at least 3 in common, top 8). Each card shows the shared count and two shared titles. A card links to the compare page when that page is indexable, and to the person otherwise.
- **FAQ** (3–4 Q&As) built only from numbers on the page: books on file, the picks other people recommend most, top topics, and the most similar shelf. The FAQPage JSON-LD comes from the same array as the visible text, so the two match word for word. The answers say that sources are linked where confirmed and that some picks don't have one yet.
- The H1, Person JSON-LD, LastUpdated, the book grid, proof section and "Other recommenders" are unchanged.

### Compare pages (`/compare/<slugA>-vs-<slugB>`)
- New route. Slugs are in alphabetical order. The reverse order, or any other spelling, gets a 308 to the canonical URL. An unknown person or the same slug twice returns a 404.
- Shows both people, the shared count, an area-proportional SVG Venn diagram (circle area follows shelf size, lens area follows shared books), the shared books as cover tiles (top 48), and the top 8 books unique to each person. It also links to both person pages, each book and up to 8 more comparisons.
- Indexable only when both people are published, each has at least 20 recommendations, and they share at least 8 books. Any other pair renders as `noindex, follow`. Titles look like "Naval Ravikant vs Tim Ferriss: 22 books in common".
- `sitemap.ts` gets a separate block at the end listing the qualifying pairs: **55 today**. These are computed in JS from one cached, paged read of the 52 published people's 4,658 recommendation rows (`unstable_cache`, 1h).

### Data layer
- New `src/lib/personInsights.ts`. Every query is bounded with `.limit()`/`.range()`, inner fetchers throw so a failure is never cached, and the exported functions log and return `[]`. UI is in `src/components/person/*` and `src/app/compare/[pair]/page.tsx`.
## 2026-11-12 — Mega menus, link-rich footer, consensus shelf, thin-page floor

### Header mega menus
- Books, People and Lists in the header are now menus. Books shows the 8 most-recommended books (small cover, author, recommendation count) and the broad topics. People shows the 12 published people with the most recommendations (photo or initials, book count). Lists shows the 12 "Books recommended by …" lists and the 12 largest "Best … books" lists. Each has an "All …" link.
- The panels are rendered in the server HTML and only shown or hidden, so every link is a real, crawlable `<a href>` with the book title, person name or list title as its text. Nothing is fetched when a menu opens.
- Opens on hover with a mouse and on click or Enter. Escape closes it and returns focus to its button, as do a click outside and tabbing out of the panel. Buttons carry `aria-expanded` and `aria-controls`.
- Below 1024px the menu button opens the existing mobile menu, now with Books, People and Lists as collapsible groups holding the same links.
- Covers are shown only when the URL is valid and is not one of the Google Books images that turned out not to be a cover: the "image not available" placeholder, a blank grey cover, or a scanned title or praise page (Principles, How to Win Friends and Influence People, The Psychology of Money, Steve Jobs, Thinking, Fast and Slow). Those books get a plain coloured stand-in.

### Footer
- New link columns: Most recommended books (8), People (8) and Topics (8), above the existing Discover, Info, Legal and Help links. Two columns on phones.

### Homepage: "The books most people agree on"
- A shelf of the 18 most-recommended books, placed right after the hero. Each spine's height is the book's recommendation count, scaled between the shelf's lowest and highest count. Its thickness follows the page count, and it shows the title along the spine and the count at the top. Spine colours come from a fixed palette chosen by slug, with no image processing.
- Picking a spine (click, or arrow keys then Enter) shows the book in 3D (`Book3D`) with its count, title, author and a link to its page. The shelf is one tab stop. It scrolls sideways inside its case on small screens, never the page, and has no motion under reduced motion.
- A "Show this shelf as a list" disclosure gives the same 18 books as a text list, for screen readers and crawlers.
- Existing homepage sections are unchanged. The hero is a little shorter so the shelf sits higher.

### Shared data and fallbacks
- `src/lib/siteNav.ts` reads the menu, footer and shelf data in three cached queries (15 minutes), each with `.limit()`. A failed read is never cached. Each section falls back to a dated static snapshot (`src/lib/siteNavFallback.ts`, no covers), so the header, footer and shelf render real links even with the database down. The build passes with the database unreachable.

### Thin-page floor for indexing
- New pure rules in `src/lib/indexing.ts`, used by the person and book page `robots` metadata and by `sitemap.ts`. A page whose `index_status` is published is still served `noindex, follow` and left out of the sitemap when it is thin:
  - Person: fewer than 5 recommended books AND no recommendation with a source we would show (`getProofDisplaySafety().showSource`).
  - Book: no recommenders AND no useful description AND no editorial summary.
- When the database can't be read, the check fails open and the page keeps its `index_status`, so an outage never de-indexes anything.
- Measured before shipping with read-only queries: **0** of 52 published people and **0** of 54 published books are affected today. The thinnest published person has 28 recommended books, and the least-recommended published book has 20 recommenders. The rule would catch 775 of the 2,307 unpublished people (for example julie-plec with 1 book, marie-forleo with 2, john-gruber with 4) and at least 73,799 of the 98,846 noindex books, so it guards future publishing. Lists (191) and series (102) are unchanged: none is empty, and the smallest have 15 and 4 books.

### Internal links (unique, server HTML)
- Homepage: 55 → 105. Person page (Naval Ravikant): 42 → 98. Book page (Zero to One): 41 → 88.

## 2026-11-12 — Data repairs: covers and misattributed tweet sources

### Covers (352 books)
- Replaced 352 broken or placeholder covers with real covers found by `scripts/recover_covers.py`: 308 from Open Library and 44 from Amazon by ISBN. Before the fix, 336 had a bare filename that didn't exist in storage, 15 had Google's "image not available" image or another placeholder, and 1 was empty. Atomic Habits is one of the books fixed.
- Only high-confidence matches were written: exact title, author surname match, and an image re-checked just before the write. Two dry-run picks were left out after a hand check: Parting the Waters (a scanned title page) and The Good Earth (a Spanish edition). The Long Goodbye was also skipped because its image failed the re-check. Medium-confidence matches weren't written (3 of 7 were wrong).
- The backup is in `bak_books_cover_20261112` (row-level security on). Each update only applied if the row still held the value seen in the dry run.

### Misattributed tweet sources (140 rows)
- 140 recommendation rows on published people cited a tweet by a *different* known person. For example, a Charlie Munger row cited an @paulg tweet. 51 of them showed that tweet's quote on the page; the other 89 linked the wrong person's tweet as the source.
- These rows now have `source_url` and `quote` cleared and `confidence_score` set to 30. The recommendation itself stays. In every case the tweet's author already has their own row with that tweet.
- The backup is in `bak_recs_misattributed_tweets_20261112` (row-level security on).
- `node scripts/reattribute_quotes.js --misattributed-tweets` reproduces the list. 657 more such rows on draft people were not changed.

### New dry-run tool
- `scripts/find_primary_sources.py` looks up unsourced recommendations on mostrecommendedbooks.com person pages to discover the *primary* source each one cites. It stores the primary URL only, never MRB's page or text, follows robots.txt, and checks that the source belongs to the person. readthistwice.com is excluded because its terms forbid automated access. Nothing has been written from this tool yet.

## 2026-11-11 — 3D book covers on book detail pages

### What changed
- New `Book3D` component (`src/components/Book3D.tsx`): the book page's hero cover is now drawn as a physical book (front cover, spine, page block, top and bottom page edges, back cover, and a contact shadow underneath) using CSS 3D transforms. It adds no dependency and no WebGL.
- Spine thickness follows `page_count`. The 0.06–0.22 × width range is clamped, and books with an unknown page count get a mid-size spine.
- The spine is painted with the cover image's own left edge, so its colour matches the book without client-side canvas sampling, which remote covers would block via CORS.
- Mouse: the book turns toward the pointer (left shows the spine, right shows the page block) and a light sweep follows. Touch: a horizontal drag turns it and vertical scrolling is untouched (`touch-action: pan-y`). Motion is eased in a rAF loop that writes CSS custom properties, so React never re-renders on move.
- Entrance turn-in and an idle float. Under `prefers-reduced-motion` all motion is off and the book sits still in its angled pose.
- Grid covers (`BookCard`): a spine-crease shading on every cover, plus a slight turn-on-spine and light sweep on hover. This is CSS only.
- `books/[slug]/loading.tsx` skeleton resized to the new cover sizes (280px desktop and 190px mobile, down from 300px and 200px) so the swap doesn't jump.

### What did not change
- The cover is still a real `<img>` with the same alt text and `loading="eager"` + `fetchpriority="high"` on desktop, so LCP, image search and JSON-LD see the same image as before.

### Research behind it
- Studied GithubAnant/bookshelf (a fork of mintdotgg/bookshelf). It's a three.js scene of roughly 400 KB+ that loads lazily, and it has no license file, so it was used for ideas only and no code was copied. Also studied scastiel/3d-book-image-css-generator (MIT), elishacoad/3d-bookshelf (MIT), mawise/bookshelf (MIT) and gcuddy/3d-bookshelf. For a single book, CSS 3D gives the same effect at near-zero bundle cost.

## 2026-06-01 — GPT-5 mini post-cover fresh500 promote (415 → 736 drafts)

### Fresh500 candidate build
- Sourced a fresh set of exactly 500 candidate book IDs from the newly expanded post-cover pool (usable HTTPS cover URLs).
- Primary editorial model: `openai/gpt-5-mini` via OpenRouter.
- Excluded all existing draft rows and all prior pilot/test IDs, deduplicated by slug, and enforced description $\ge 180$ chars and correct language/title checks.

### Initial run issue & billing block
- Launch command: `--concurrency 5 --sleep 0.5 --checkpoint-every 25`.
- The run successfully parsed its first 25-row checkpoint (20 accepts, 4 weak, 1 reject) but subsequently encountered a massive wave of immediate errors (420 errors total).
- The entire 500-book batch completed with only **36 accepted rows** and **445 error rows**.
- **Root Cause Diagnosed**: Investigated the retry attempt and found the errors were not true timeouts or rate limits, but a raw upstream **`HTTP Error 402: Payment Required`** billing block on the OpenRouter account.

### Safe retry after credit refill
- OpenRouter credits were refilled. 
- Built an error-only retry ID list containing strictly the 445 error rows (excluding all accepted, weak, and validator-rejected rows).
- Ran a successful 2-ID smoke test first to confirm billing block cleared and raw JSON payload generated perfectly.
- Relaunched the 445 error-only retry under safer throughput settings: `--concurrency 2 --sleep 1.0 --max-retries 3 --checkpoint-every 10`.
- Rerun outcomes:
  - **285 accepted (`dry_run_update`)**
  - 110 weak (`generated_but_weak`)
  - 47 rejected (`rejected`)
  - **3 errors (`error`)** — network/timeout errors (a tiny 0.67% error rate)
  - **0 HTTP 402 billing errors**

### Combined promotion results
- Original 36 accepts + retry 285 accepts = **321 accepted unique books**.
- All 321 accepted rows promoted live to `draft` status in Supabase:
  - **Promoted**: `321`
  - **Skipped**: `0`
  - **Failed**: `0`
  - **AI calls made during promote**: `0` (Deterministic write-from-report path)
  - **Existing drafts overwritten**: `0` (Zero collision risk)
  - **Duplicate slugs in DB**: `0` (Perfect unique-slug constraint)
  - **Supabase Live Draft Count**: **`415 → 736`** (+321 drafts)
  - **Backup snapshot written to**: `backups/editorial_gpt5_mini_post_cover_fresh500_combined_pre_v1.csv` (logging the precise pre-write state of all 321 rows).

### Operational lessons
- **concurrency 2 + sleep 1.0** is the safest, most robust configuration for large-scale OpenRouter batches to avoid credit/rate-limit pressures.
- **Idempotency first**: Never re-run successful or graded rows; compile strict error-only sets for recovery.
- **Fail-fast on 402**: Stop runs immediately upon encountering billing blocks (HTTP 402) rather than letting the script cycle rapidly.

## 2026-05-31 — Post-cover GPT-5 mini fresh200 promote (273 → 415 drafts)

### Post-cover fresh200 dry-run (rec_count 5–15)
- First scaling gate after the Amazon cover backfill expanded the strict candidate pool 70× (133 → 9,340 books).
- 200 fresh IDs built at rec_count 5–15 (top of the newly-accessible pool — Why Nations Fail, Leonardo da Vinci, Deep Learning, The Republic, etc.).
- Run at `--concurrency 10 --sleep 0.3`, v9.18 pipeline, dry-run only.
- Results:
  - **118 accepted (59.0%)** on first pass
  - 37 weak (below 4.70)
  - 10 validator-rejected (mostly `format_claim_prompts` cluster — same as prior runs)
  - **35 errors (17.5%)** — first significant error rate in 650 prior GPT-5 mini rows. Mix of `provider_network_error_timeout` (29) and `IncompleteRead` (6) — symptoms of upstream rate-limit pressure at sustained conc=10 over a long batch.
  - 0 JSON parse failures (track record intact: 0 across 850+ GPT-5 mini rows).
  - 1 hard-trust catch: `greenlights-matthew-mcconaughey` triggered `possible_public_recommender_name_leak_debug_mismatch_emotional_journey` — same low-severity validator alarm seen on To Kill a Mockingbird and The Little Prince. Not a real PII leak.
- Score distribution: median 4.76, max 4.93 (higher than prior rec=0–1 batches whose medians hovered at 4.70).

### Error-only retry at conc=5
- Built a 35-ID retry set containing ONLY the network-error / timeout / IncompleteRead rows. Zero overlap with accepted, weak, or validator-rejected rows (verified before launch).
- Reran at `--concurrency 5 --sleep 0.5 --max-retries 3` (3 is the pipeline's hard ceiling — your spec said 4 but the script refuses >3 by design).
- Results:
  - **24 / 35 = 68.6% recovered to accept** (24 books recovered from error → dry_run_update).
  - 6 weak, 5 validator-rejected.
  - **0 errors, 0 timeouts** — error rate dropped from 17.5% at conc=10 to **0% at conc=5**.
  - Retry cost: ~$0.17.
- **Key finding: the 17.5% conc=10 error rate was load-induced, not systemic.** Halving concurrency completely eliminated the timeout/IncompleteRead cluster.

### Combined accept count
- Original 118 + error-retry recovered 24 = **142 accepts of 200 distinct books = 71.0%** — a new high-water mark for GPT-5 mini on this contract.
- All 142 are unique slugs; 0 already-drafted; 0 overlap with prior batches.
- Combined dry-run promote-preview: `would_promote=142, skipped=0, failed=0`.

### Live promote — 142 combined accepts
- Filtered to pending-only: 142 unique slugs, 0 already-drafted (no overwrite risk).
- Triple-gated: `--write --confirm-promote-accepted --backup-before-write`.
- Promote summary: `rows_read=142, accept_candidate=142, promoted=142, would_promote=0, skipped=0, failed=0`.
- **`NO AI CALLS WERE MADE`** — confirmed in log.
- Backup snapshot: `backups/editorial_gpt5_mini_post_cover_combined_pre_v1.csv` (142 rows pre-write).

### Post-write verification
- Found in DB: 142 / 142.
- Flipped to `ai_quality_status='draft'`: 142 / 142.
- Full editorial payload (summary + best_for + not_for + key_themes + difficulty_level): 142 / 142.
- Duplicate slugs in DB: 0.
- **Live draft total: 273 → 415 (+142).**

### Scaling rule for GPT-5 mini concurrency
Confirmed empirically across this cycle's batches:
- **conc=10 is fine for batches ≤ 100 rows.** The 50-row, 100-row, and 133-row mini runs all completed at 0% error rate.
- **conc=5 should be the default for batches ≥ 200 rows.** The 200-row run hit 17.5% timeouts at conc=10, but the same retried 35-row pool at conc=5 finished at 0%.
- Wall-clock cost of conc=5: about 25% slower per row vs conc=10, but avoids the cost+time of error-retry rounds. Net win.
- Throughput projection: 500 rows at conc=5 should take ~50–60 min and cost ~$2.40; at conc=10 it would risk another ~85 errors needing retry.

### Cumulative session trajectory
```
77 → 98 → 114 → 144 → 194 → 205 → 273 → 415
 +21   +16   +30   +50   +11   +68   +142
(DS    DS    mini-  mini-  nano- mini- post-cover-
 next1 next2 fresh) fresh100) only) fresh133) combined)
```
**+338 net-new drafts today**, all gated, all verified, all on the v9.18 pipeline with the 4.70 accept threshold unchanged.

### Current production state
- **Live drafts: 415**
- **Usable https covers: 10,248** (was 1,161 at session start; +9,087 from Amazon ASIN backfill)
- **Primary editorial model: GPT-5 mini** (71% effective accept rate on rec=5–15 content)
- **Cleanup candidate: GPT-5.4 nano** (deployed once this session as union with mini-fresh100; not yet deployed on the post-cover batch)
- **Concurrency default: conc=5 for batches ≥ 200, conc=10 for smaller**

### Next step (none started in this commit)
After your approval — either:
1. **SEO / product-page audit** — surface what the new editorial content needs at the frontend layer (book detail pages, structured data, OG cards, schema.org). Read-only audit only.
2. **500-row dry-run at conc=5** — scale validation of the new concurrency rule on the next slice of the post-cover pool. Dry-run, no writes.

### Scope discipline
- No schema changes. No frontend changes. No editorial-script changes (v9.18 still at `403efd1`).
- 4.70 accept threshold unchanged. Prestige/source/medical gates intact.
- `.env.local` (carries `OPENROUTER_API_KEY`) gitignored.
- All dry-run reports, promote-preview CSVs, retry reports, backup CSVs in untracked `rebuild_v2/` and `backups/` — not committed.
- No nano cleanup. No 500-row batch. No SEO / frontend work.

## 2026-05-31 — Amazon ASIN cover backfill (1,161 → 10,248 real-URL covers)

### Background — why this was needed
After 273 drafts the strict editorial-candidate pool was effectively exhausted. The recovery-audit (logged in prior commit) discovered that the *real* bottleneck wasn't catalogue exhaustion — it was that 96.8% of the `books.cover_image_url` column contained broken filenames (e.g. `"The Way of Kings.png"`) rather than usable URLs. Only 1,161 of 98,845 books had genuine `https://` cover URLs. Every book has an `amazon_url` carrying an ASIN, so Amazon's image CDN was the available recovery vector.

### Preview phase (Phase 1.a, 2k cap then Phase 1.b full)
- Candidate set: `cover_image_url` not a real URL + `amazon_url` present + `description >= 180` + `ai_quality_status='pending'` + slug-deduped.
- Phase 1.a (cap 2,000): **79.9% safe rate** confirmed the approach worked.
- Phase 1.b (full pool, 12,277 candidates): **9,087 safe / 12,277 = 74.0%**.
- HEAD-only requests to `https://images-na.ssl-images-amazon.com/images/P/{ASIN}.01._SX300_.jpg`. No page scraping. No paid APIs.
- Safety threshold: `status=200` AND `content-type` starts with `image/` AND `content-length >= 5,000` (5k bytes filters out the 43-byte Amazon "no image" placeholder GIF and the 3–5KB low-resolution variants).
- Failures bucketed: 2,491 low-res variants (3–5KB), 470 placeholder GIFs (<100 bytes), 225 small (1–3KB), 2 tiny (100–999), 1 status_404, 1 ASIN extraction failure.
- ASIN extraction success: 99.99% (12,276/12,277). HEAD reachability: 99.98%.

### Write phase — gated cover update
- New single-purpose script: `rebuild_v2/_cover_backfill_amazon_write.js`. NOT committed (lives in untracked `rebuild_v2/` per audit-artifact convention).
- **Triple gates** enforced at script startup:
  - `--write` — required to perform any UPDATE
  - `--confirm-cover-backfill` — required when `--write` is present
  - `--backup-before-write <PATH>` — required when `--write` is present
- **Single-column update**: payload is literally `{ cover_image_url: <url> }` — never any other column.
- **Idempotency re-check at write time**: for every candidate, refetches the current DB `cover_image_url` and skips if it already starts with `http://` or `https://`. Result: 0 skips for `already_has_real_url` (none of the 9,087 candidates had been touched between preview and write).
- **Pre-write backup**: 9,087 `(id, slug, pre_write_cover_image_url)` rows captured before any UPDATE statement to `backups/cover_backfill_amazon_asin_pre_v1.csv`. Backup contains the original broken filename values, e.g. `"Stegothesaurus.png"`, `"Berlin Game.png"`.
- Wall-clock: 241 seconds for 9,087 single-row updates (batch=200, retries on Supabase fetch transients).

### Live write result
```
mode                : LIVE WRITE
rows_read           : 12277
safe_to_write=true  : 9087
already_has_real_url: 0   ← no overwrites
not_found_in_db     : 0
updated             : 9087
failed              : 0
```

### Post-write verification
- Real https covers in DB: **1,161 → 10,248** (exactly +9,087).
- 20/20 sampled cover URLs HEAD-checked live post-write: all 200 OK, all 5,251–8,835 bytes.
- 5/5 sampled rows: editorial_summary, best_for, not_for, key_themes, difficulty_level all still NULL — only `cover_image_url` changed.
- Live draft total: 273 (unchanged).
- Live pending total: 98,572 (unchanged).

### Scope discipline
- Only `cover_image_url` modified. No editorial fields touched. No schema changes. No frontend changes. No editorial-script changes.
- No commits during the run. Backup, write report, and run log all in untracked `rebuild_v2/` and `backups/`.
- Quality gates (4.70 accept threshold, v9.18 validators) untouched — this was data-coverage work, not editorial work.

### Files generated (untracked, audit-only)
- `rebuild_v2/_cover_backfill_amazon_preview.js` — 2k preview script
- `rebuild_v2/_cover_backfill_amazon_preview_full.js` — full preview script
- `rebuild_v2/_cover_backfill_amazon_write.js` — gated write script
- `rebuild_v2/cover_backfill_amazon_asin_preview_2k_v1.csv` — 2k preview output
- `rebuild_v2/cover_backfill_amazon_asin_preview_full_v1.csv` — full preview output (12,277 rows × 12 cols)
- `rebuild_v2/cover_backfill_amazon_asin_write_report_v1.csv` — write report (status per row)
- `rebuild_v2/cover_backfill_amazon_asin_write_run_v1.log` — write run log
- `backups/cover_backfill_amazon_asin_pre_v1.csv` — pre-write snapshot (rollback source for all 9,087 rows)

### Impact on editorial scaling
- Strict editorial candidate pool went from ~1,038 fresh books (after 273 drafts) to **~10,120 fresh books** (1,306 real-cover ∩ desc≥180, minus 273 drafts, plus 9,087 newly-covered).
- **~18× growth** in addressable editorial scope without lowering any quality threshold or weakening any validator.
- Next step: rerun the GPT-5 mini candidate builder against the newly-expanded pool and resume dry-run scaling. At 50% accept rate this unlocks ~5,000+ net-new drafts at ~$50 in editorial generation cost.
- Remaining ~3,190 books whose Amazon image was low-resolution / placeholder are not lost — a future cycle can try other Amazon image-template sizes (`_SX450_`, `_SCRMZZZZZZZ_`) before falling back to "no cover" classification.

## 2026-05-31 — GPT-5 mini fresh133 promote (205 → 273) + pool exhaustion finding

### GPT-5 mini fresh133 dry run (rec_count 0–1)
- Target batch was 200; pool exhaustion capped it at 133 valid strict-filter candidates (details below).
- **68 / 133 accepted = 51.1%** — essentially identical to the prior 100-row test (50/100 = 50.0%).
- **0 JSON parse failures · 0 errors · 0 timeouts** across all 133 rows (consistent with the 250 prior rows GPT-5 mini has now processed across all scales).
- Runtime ~20 min @ conc=10. Cost ~$0.63.
- rec_count distribution in pool: **rec=1: 5 books (4 accepted = 80%) · rec=0: 128 books (64 accepted = 50.0%)**.
- **GPT-5 mini is stable at scale and remarkably tier-robust** — holds ≥50% accept even on books with zero source recommendations (description-only context).
- Score distribution: min 4.20, median 4.72, max 4.91.

### Pool exhaustion finding (scaling bottleneck identified)
The 200-row build attempt revealed that the clean strict-filter pool for fresh editorial work is now nearly empty after 205 prior drafts + 381 prior pilot/test IDs:
- **Pool scanned: 30,000 books** (paginated from the rec_count-sorted catalogue)
- **no-cover rejects: 29,500 (98.3 %)** ← dominant constraint
- short_desc rejects: 61
- bad_title rejects: 3
- bad_desc rejects: 1
- already-excluded (drafts + prior pilots): 300
- slug-dup drops: 2
- **Valid strict-filter candidates: 133** (target was 200)
- Range: rec_count 0–1; 96 % of the 133 valid candidates have rec_count = 0 (zero source recommendations).

The bottleneck is **not** the model anymore — GPT-5 mini handles zero-rec books fine. It's that 98 % of the remaining unprocessed catalogue lacks cover URLs, and the strict filter (cover present + description ≥180 chars) screens almost all of them out. Any 500+ batch will hit this wall hard.

### Validator behaviour on fresh133
- Hard-trust catches: **6** (encyclopedia-of-cryptography `source_overclaim_proof`, 50-artists-you-should-know `proven`, alcestis `classic`, algorithms-unlocked `source_overclaim_proof`, atlas-of-human-anatomy `medical_or_research_claim_therapy`, cleopatra `source_overclaim_famous`). All real — first medical-claim catch this cycle.
- `format_claim_prompts` cluster persisted: **7 / 133 (≈5.3 %)** — similar share to the 100-row test (8/100 = 8 %). All hits are real catches on books where GPT-5 mini phrases editorial as "writing prompts" / "reflection prompts" / etc. Candidate for a future v9.19 context-aware carveout.

### Live promote — 68 fresh133 accepts → drafts
- Filtered to pending-only: 68 unique slugs, 0 already drafted, 0 overwrites.
- Triple-gated: `--write --confirm-promote-accepted --backup-before-write`.
- Promote summary: `rows_read=68, accept_candidate=68, promoted=68, would_promote=0, skipped=0, failed=0`.
- **`NO AI CALLS WERE MADE`** — confirmed in log.
- Backup snapshot: `backups/editorial_gpt5_mini_fresh133_pre_v1.csv` (68 rows captured pre-write).

### Post-write verification
- Found in DB: 68 / 68.
- Flipped to `ai_quality_status='draft'`: 68 / 68.
- Full editorial payload (summary + best_for + not_for + key_themes + difficulty_level): 68 / 68.
- Duplicate slugs in DB: 0.
- **Live draft total: 205 → 273 (+68).**

### Cumulative session trajectory
```
77  → 98   → 114  → 144  → 194  → 205  → 273
 +21    +16    +30    +50    +11    +68
(next-1 (next-2 (mini-  (mini-  (nano-  (mini-
 DS)    DS)    fresh) fresh100) only)  fresh133)
```
**+196 net-new drafts today**, model lineup: DeepSeek v4 pro → GPT-5 mini (primary) + GPT-5.4 nano (cleanup candidate).

### Current recommendation
- **GPT-5 mini remains primary.** Two scaling tests at 50% accept rate, zero JSON / errors / timeouts across 250 rows, clean trust-gate behaviour, $0.0048 per book.
- **GPT-5.4 nano remains cleanup candidate.** 26 % standalone accept rate is too low to elevate as primary; +11 nano-only accepts per 100 mini-rows is real recovery value to deploy when scaling.
- **Pause larger 500 / 1k batches until cover-recovery / data-coverage strategy is planned.** The catalogue's strict-filter pool is exhausted at scale; running a 500-row build today would yield ~133 valid rows at best (same constraint, deeper-pool diminishing returns). Cover-recovery is the next phase that unblocks scaling.

### Scope discipline
- No schema changes. No frontend changes. No editorial-script changes (v9.18 still at `403efd1`).
- 4.70 accept threshold unchanged. Prestige/source/medical gates intact and firing (medical catch on Netter's Atlas is the first this cycle).
- `.env.local` (carries `OPENROUTER_API_KEY`) gitignored.
- All dry-run reports, promote-preview CSVs, backup CSVs in untracked `rebuild_v2/` and `backups/` — not committed.
- No nano cleanup launched. No cover-recovery work started.

## 2026-05-31 — GPT mini + nano fresh100 union promote (144 → 205 drafts)

### GPT-5 mini fresh100 dry run (rec_count 0–1, deepest tail tested)
- 100 unique IDs built with explicit slug-dedup (excluded 5 same-slug pairs from production data).
- **50 / 100 accepted = 50.0%** at the deepest rec_count tier remaining (0–1).
- **0 JSON parse failures · 0 errors · 0 timeouts** across all 100 rows.
- Runtime ~17 min @ conc=10. Cost ~$0.48.
- 2 hard-trust catches (real prestige claims — `landmark` on The Works, `source_overclaim_staple` on Wheat Belly cookbook).
- Notable: 8 `format_claim_prompts` cluster — GPT-5 mini's tendency to mention "prompts" in editorial; all 8 are real validator catches, not false positives. Flagged as a future v9.19 candidate if pattern persists.
- Filtered promote-preview: 50 would_promote / 0 skipped / 0 failed.

### GPT-5.4 nano comparison (same 100 IDs)
- Slug: `openai/gpt-5.4-nano` (preferred — available, no fallback needed). Pricing $0.20 / $1.25 per Mtok.
- **26 / 100 accepted = 26%** — roughly half of mini's rate on the same content.
- **0 JSON parse failures · 0 errors · 0 timeouts**.
- Runtime ~8 min @ conc=10. Cost ~$0.31.
- 5 hard-trust catches (vs mini's 2) — nano has a stronger tendency toward prestige adjectives (`classic`, `staple`, `famous`) but the validator catches them.
- Score distribution: median 4.56, max 4.84 (vs mini's median 4.70, max 4.90).
- Wider reject-reason spread (13 unique reasons vs mini's 5) — more failure modes per row, but each is a genuine catch.

### Mini vs nano overlap analysis (same 100 IDs)
- mini accepts: 50
- nano accepts: 26
- overlap (both accepted): 15
- mini-only: 35
- **nano-only: 11** ← books mini missed that nano caught
- Union (mini ∪ nano): 61 / 100 = **61%** effective accept rate
- The 11 nano-only accepts are net-new books — worth recovering via the cleanup-pass architecture below.

### Union live promote (mini-50 + nano-only-11 = 61)
- Step 1: mini-50 pending-only CSV → `promote-accepted-from-report --write --confirm-promote-accepted --backup-before-write`. Result: 50 promoted, 0 skipped, 0 failed.
- Step 2: nano-only-11 filtered CSV → same triple-gated path. Result: 11 promoted, 0 skipped, 0 failed.
- **No AI calls during either promote** — confirmed in both logs (`NO AI CALLS WERE MADE`).
- **No overlap between mini-50 and nano-11** (filter logic excluded any nano accept whose slug was already in mini accepts).
- **No existing drafts overwritten** (both filtered CSVs pre-excluded any row whose slug already had `ai_quality_status='draft'`).
- Backup snapshots written for both: `backups/editorial_gpt5_mini_fresh100_pre_v1.csv` (50 rows) and `backups/editorial_gpt54_nano_only_fresh100_pre_v1.csv` (11 rows).

### Post-write verification
- Found in DB: 61 / 61.
- Flipped to `ai_quality_status='draft'`: 61 / 61.
- Full editorial payload (summary + best_for + not_for + key_themes + difficulty_level): 61 / 61.
- Unique slugs across union: 61 / 61 (no duplicates).
- **Live draft total: 144 → 194 (after mini) → 205 (after nano)**.

### Draft count trajectory (full v9.17.1 + v9.18 cycle)
```
77  → 98   → 114  → 144  → 194  → 205
 +21    +16    +30    +50    +11
(next-1 (next-2 (gpt5-  (mini-  (nano-
 DS)    DS)    mini-fresh) fresh100) only delta)
```

### Current recommendation
- **GPT-5 mini = production primary.** 50% accept on the deepest tail (rec=0-1), 0 reliability issues across two runs (150 total rows), clean trust-gate behavior.
- **GPT-5.4 nano = cleanup pass on mini's weak rows.** Provides 11 net-new accepts per 100 books (+22 percentage points on the cleanup pool) at ~35% cheaper cost than mini.
- **Do NOT use nano as primary.** 26% accept rate is too low, and nano's higher hard-trust rate (5/100 vs mini's 2/100) signals more downstream FP risk if it ran on its own.
- **Architecture confirmed for next scaling phase:** Pass 1 = GPT-5 mini @ conc=10 · Pass 2 = GPT-5.4 nano @ conc=10 on the weak/error rows from Pass 1. Projected effective rate ~61% at ~$60 / 10k books.

### Next scaling gate
- **200-row GPT-5 mini dry-run** to validate behavior at 2× scale before committing to the 10k catalogue cycle. Not started in this task per explicit hold.

### Scope discipline
- No schema changes. No frontend changes. No editorial-script changes in this cycle (v9.18 already at `403efd1`).
- 4.70 accept threshold unchanged. Prestige/source/medical gates intact.
- `.env.local` (carries `OPENROUTER_API_KEY`) gitignored.
- All dry-run reports, promote-preview CSVs, backup CSVs in untracked `rebuild_v2/` and `backups/` — not committed.

## 2026-05-31 — GPT-5 mini validation + promote close (114 → 144 drafts)

### Bake-off result (4-way on same next-2 50 IDs, v9.18 pipeline)
| Provider / model | Accept rate | Runtime | Cost / 50 | JSON fails | Trust catches |
|---|---:|---:|---:|---:|---:|
| DeepSeek v4 pro | 32% (16/50) | 74 min | ~$3 | 0 | 0 |
| Gemini 3.1 Flash Lite | 4% (2/50) | 6 min | ~$0.15 | 0 | 2 |
| GLM 4.5 Air | 34% (17/50) | 33 min | ~$0.10 | 2 | 5 |
| **GPT-5 mini (`openai/gpt-5-mini` via OpenRouter)** | **62% (31/50)** | **~7 min** | **~$0.24** | **0** | **0–1 (1 borderline)** |

### GPT-5 mini fresh-50 validation (truly fresh IDs, rec_count 1–2, deep tail)
- 50 fresh IDs built by excluding all 114 drafts + every prior pilot/test file (next-1, next-2, next-3, top25, fresh25, fresh50, recheck batches — 235 IDs total in exclusion set).
- Result: **32/50 = 64% accepted** at the deepest remaining rec_count tier (1–2).
- **0 JSON parse failures · 0 timeouts · 0 errors · 2 real prestige-claim catches (no false positives)**.
- Validator gates v9.18 firing correctly: 2 catches were genuine prestige adjectives (`classic` on Julia Child, `landmark` on Hampton's drawing book).
- GPT-5 mini is **tier-robust** — accept rate held *higher* on deep tail (64% rec=1–2) than on mid-tier (62% rec=4–14). For comparison, GLM dropped from 34% → 18% on a less-extreme tier change.

### Live promote — 30 unique pending accepts → drafts
- 32 raw accepts deduped by slug to **30 unique** (input pool had 2 duplicate slugs: `legend-marie-lu` and `lands-of-lost-borders-kate-harris` — pre-existing data quality issue, same book ID'd twice in production; kept higher-scored row of each pair).
- 30 unique slugs cross-checked against current 114 drafts: **0 collisions** — all 30 are genuinely new books, no risk of overwriting existing DeepSeek/GLM-promoted drafts.
- Filtered preview CSV: `rebuild_v2/editorial_fresh50_v9_18_gpt5_mini_fresh_pending_only_v1.csv`.
- Triple-gated write: `--write --confirm-promote-accepted --backup-before-write`.
- Promote summary: `rows_read=30, accept_candidate=30, promoted=30, would_promote=0, skipped=0, failed=0`.
- **`NO AI CALLS WERE MADE`** — confirmed in script log (promote path reads editorial payload from the dry-run CSV deterministically).
- Pre-write backup snapshot: `backups/editorial_fresh50_v9_18_gpt5_mini_fresh_pre_v1.csv` (30 rows captured).

### Post-write verification
- 30 / 30 flipped to `ai_quality_status='draft'`.
- 30 / 30 carry full editorial payload (`editorial_summary` + `best_for` + `not_for` + `key_themes` + `difficulty_level`).
- **Live draft total: 114 → 144** (+30).
- No duplicate slugs promoted (verified — 30 unique target slugs in DB after write).
- No existing drafts overwritten (filter step pre-excluded all already-draft rows).
- Transient Supabase DNS warnings appeared in the log during the script's optional diagnostic recount AFTER all 30 writes succeeded — no impact on the actual writes (confirmed via independent Supabase query).

### Draft trajectory across v9.17.1 + v9.18 cycle
```
77  → 98   → 114  → 144
 +21    +16    +30
(next-1 (next-2 (GPT-5 mini
 DeepSeek) DeepSeek) fresh)
```

### Conclusion
- **GPT-5 mini is now the primary candidate for the next scaling phase.** It beat all alternatives on accept rate (62–64% vs DeepSeek's 32%, GLM's 34%, Gemini's 4%), runtime (12× faster than DeepSeek), cost ($48 vs $400 projected for 10k books), and reliability (0 JSON / 0 timeouts across 100 total rows). Trust-gate behavior is the cleanest of any model tested.
- **No 10k cycle started.** Validation passed all criteria but production scale is deferred.
- **Next step: project/pipeline audit + batch-runner planning.** Specifically: rate-limit verification at conc=20+, parallelism for multi-batch runs, idempotent ID-bucket assignment, recovery from partial failures.

### Scope discipline
- No schema changes. No frontend changes. No editorial-script changes (v9.18 already committed at `403efd1`).
- 4.70 accept threshold unchanged. Prestige/source/medical gates intact.
- `.env.local` (carries `OPENROUTER_API_KEY`) gitignored.
- Bake-off CSVs, promote-preview CSVs, backup CSVs all live in untracked `rebuild_v2/` and `backups/` — not committed.

## 2026-05-31 — Editorial pipeline v9.18: validator narrowing + OpenRouter provider

### Validator narrowing (`scripts/generate_book_editorial_enrichment.py`)
Two real false-positive classes surfaced when running Gemini 3.1 Flash Lite against the v9.17.1 contract. Both also bit DeepSeek occasionally — fix is model-agnostic and gates remain strict.

**1) Modifier-aware negation in `_is_negated_context`.** Catches multi-adjective negations of format terms:
- `"lacks hands-on exercises"`, `"no formal exercises"`, `"without structured exercises"`, `"doesn't include guided exercises"`, `"without practical hands-on exercises"`, etc.
- The v9.17.1 list-based check only matched bare forms (`lacks exercises`, `no exercises`) — adjectives between negator and format term broke the substring match.
- v9.18 adds a windowed regex with a positive list of book-format modifiers (`hands-on, fill-in, step-by-step, formal, structured, practical, guided, specific, explicit, named, dedicated, distinct, extra, additional, concrete, actionable, tangible, any, specialized, systematic, deliberate`). Allows 0–3 modifiers between negator and term.
- Modifier slot is whitelist-only — does not swallow generic connectors like `and / but / or` that could falsely negate unrelated mentions.
- **Result on Gemini re-bake-off: `format_claim_exercises` rejects 25 → 3 (88% reduction).**

**2) New `_is_planner_profession` helper.** Skips `format_claim_planner` when `planner` appears as a profession context (`city planner`, `urban planner`, `financial planner`, `event planner`, `wedding planner`, `product planner`, `media planner`, `strategic planner`, etc. — 30+ profession modifiers).
- Same shape as v9.15's `_is_reader_usecase_course` carveout for `course`.
- Conservative: if ANY occurrence of `planner` is bare, the carveout is REFUSED for the whole text — mixed cases still hit the validator.
- Wired into both validator sites (`_check_title_format_mismatch` and the secondary format-claim loop).
- **Result on Gemini re-bake-off: `format_claim_planner` rejects 3 → 0 (100% eliminated).**

### Quality gates UNCHANGED
- Accept threshold remains **4.70**.
- Prestige claims (`foundational, definitive, famous, masterpiece, seminal, iconic`) still rejected on bare use — verified by selftest section `[C]`. The 2 hard-trust catches in the Gemini re-bake-off (`source_overclaim_proof` on SICP, `unsupported_proof_or_prestige_claim_definitive` on Name of the Wind) confirm gates intact.
- Format-claim rule still fires on `"this book is a planner"`, `"a daily planner"`, `"planner templates"`, `"the book offers exercises"`, etc.

### Tests
- New `--selftest-v918-narrowing` covers 38 cases (modifier-aware negation positives + negatives, planner-profession positives + negatives, prestige gates intact). **38/38 pass.**
- All prior selftests pass with no regression: v9.17 (17/17), v9.16 (14/14), v9.15 (18/18), validator-narrowing (23/23), evaluator-dnf (5/5), key-themes (7/7), list-serializer (12/12), theme-quality (21/21). **Total 155/155.**
- Fixture validator: **24/24 expected outcomes matched, 0 mismatched.**

### New OpenRouter provider
- `call_llm` gains an `openrouter` branch (OpenAI-compatible endpoint at `https://openrouter.ai/api/v1/chat/completions`). Same request shape as the existing `openai` branch; model id carries the vendor prefix (e.g. `google/gemini-3.1-flash-lite`).
- `--provider` choices extended: `deepseek, openai, openrouter`.
- `default_model` returns `google/gemini-3.1-flash-lite` when provider is `openrouter`.
- `OPENROUTER_API_KEY` env var. Optional `HTTP-Referer` / `X-Title` attribution headers for the OpenRouter dashboard.
- **Use case:** lets the same pipeline target Claude Sonnet/Opus, Gemini, GLM, Kimi, etc. behind one key without per-vendor branches.

### Bake-off snapshot (provider comparison on same 50 IDs)
| Provider / pipeline | Accept rate | Reject rate | Runtime | Concurrency | Approx cost / 50 rows |
|---|---:|---:|---:|---:|---:|
| **DeepSeek v4 pro / v9.17.1** | **32 % (16/50)** | 12 % | ~74 min | 2 | ~$3 |
| Gemini 3.1 Flash Lite / v9.17.1 | 0 % (0/50) | 76 % | ~6 min | 10 | ~$0.20 |
| Gemini 3.1 Flash Lite / v9.18 | 4 % (2/50) | 26 % | ~6 min | 10 | ~$0.20 |

### Decisions captured by this commit
- **DeepSeek v4 pro remains primary** for the editorial cycle. Gemini Flash Lite's literary ceiling on this contract (median score 4.37, max 4.72) is too low for the 4.70 floor — even with validators perfectly tuned, accept rate caps around 4–8 %.
- **Gemini outputs are NOT promoted.** The v9.18 dry-run reports remain audit-only.
- **v9.18 patch is kept** because it removes real false positives that also occasionally hit DeepSeek (DeepSeek's next-2 batch lost Future Shock to the same `format_claim_planner` regression).
- **OpenRouter integration is kept** for future bake-offs (GLM 4.6 Air, Claude Sonnet 4.6) without further script work.

### Known residual (not patched in this commit)
- 3 `format_claim_exercises` near-miss false positives where the phrasing is `"lack of ... exercises"` (noun form) instead of `"lacks ... exercises"` (verb form). Affected Zen Mind, When Things Fall Apart, and one truncated Flow retry. Below the bar for a v9.18.1; bundle into next maintenance pass if needed.

### Scope discipline
- Frontend untouched. No schema changes. No DB writes from this patch.
- `.env.local` (which carries `OPENROUTER_API_KEY`) is gitignored — verified before commit.
- Bake-off CSVs and audit reports live in untracked `rebuild_v2/` — not committed.

## 2026-05-31 — Browse/detail QA: search fix, curated default, similar-books quality

### Root cause — search returned 0 results
- `searchBooks` / `searchBooksPaginated` filtered on `author.ilike.…` but **`books.author` is not a column** in production. PostgREST returned `column books.author does not exist` (42703), the helper catch-path swallowed the error and returned `{data:[], total:0}`, and the page rendered "No matching books".
- The real column is **`author_name`**. The TS `Book` type was declaring `author` based on stale schema. Combined with the now-known `book.author_slug` absence, every `book.author` read in the frontend was silently undefined.

### Fixed in `src/lib/data.ts`
- `searchBooks` and `searchBooksPaginated` now reference `author_name.ilike` in the OR clause. Verified live: `/books?q=atomic` → 7 hits (Atomic Habits top), `/books?q=habits` → 32, `/books?q=tim ferriss` → 5, `/books?q=dune` → 15.
- `searchBooksPaginated` swapped `count:'exact'` → `count:'estimated'`. Exact count forces Postgres to scan every matching row, which blew the 8s statement timeout (`57014`) on a 99k-row ilike substring. Estimated uses planner stats — fast and accurate enough for "Showing ~N results" UX. Total label gains a `~` prefix in search mode to signal this.
- Added `normalizeBookRow()` adapter at the data-layer edge that fills `book.author` from `book.author_name` on every fetch. Every consumer of `book.author` (BookCard, detail page, jsonld, etc.) starts working immediately without per-file changes. Idempotent. Applied in: `getBooksPaginated`, `getFeaturedBooks`, `getBookBySlug`, `getBooksByAuthor`, `getBooksBySeries`, `getRelatedBooks`, `searchBooks`, `searchBooksPaginated`, `getBooksByListSlugPaginated`, `getSimilarBooksByLists`.
- `Book` interface gains `author_name?: string | null` (the canonical DB column). The older `author: string` field is now populated by the adapter rather than the DB.

### Public browse quality — `?scope` opt-in
- Default `/books` now filters to `cover_image_url IS NOT NULL AND recommendation_count > 0` plus a client-side drop of numeric-artifact titles (`1916.0`, `24.0`, `2001.0` — year+`.0` from the scraper). Pool size: 98,845 → **~9,148 curated books**.
- `/books?scope=all` opt-in shows the full unfiltered catalogue, with subtitle "Full catalogue — includes incomplete and unreviewed entries."
- A small `Curated ⏐ All` toggle pill is shown next to the count line (only on the all-books mode). Category browse and search keep their own implicit quality gate (list membership / hit relevance).
- All href builders thread `scope` through chips, sort changes, and Prev/Next so the user's scope choice survives navigation.

### Similar books — `getSimilarBooksByLists` rerank
- Candidates now sort by quality tier first, then shared-list count, then `recommendation_count`. Tier order:
  1. Drafts with cover (editorially-vetted)
  2. Has-cover + `recommendation_count > 0`
  3. Has-cover (but no recs)
  4. Anything else (no cover) — fallback only
- Numeric-artifact titles are dropped outright.
- The fallback tier still contributes when the high-quality pool is thin, so Endurance won't lose its similar-books section on a long-tail topic.

### Verification
- Live probe: all four sample queries (`atomic`, `habits`, `tim ferriss`, `dune`) return hits in 1–2.5s, no timeouts.
- `npx next build`: clean, all 7 routes, TypeScript validated.

### Scope discipline
- **Frontend + data-layer only.** No DB writes. No schema changes. No editorial-pipeline files touched. No Amazon affiliate changes.

## 2026-05-31 — Editorial batch close: Endurance fix + 21 fresh-50 v9.17.1 promotions

### Endurance description (single-row data fix)
- `endurance-alfred-lansing` description rebuilt from **117 → 232 chars** (Wikipedia REST extract, source-backed, verbatim with leading-whitespace trim). Complete-draft threshold is description length ≥ 120.
- Confidence: 100% — title + author + year (1959) match Wikipedia REST API summary and Open Library work `OL874157W` / `OL874159W` independently.
- Before fix: 76 / 77 drafts complete. After fix: **77 / 77** drafts complete.
- Description-only PATCH. `ai_quality_status` remained `draft`. All editorial fields, title, subtitle, slug, cover, amazon_url, and recommendations were untouched (tamper-check confirmed 0 fields changed). No AI used.
- Backup: `rebuild_v2/single_row_endurance_description_backup_2026-05-31T00-05-12-628Z.json`.
- Write report: `rebuild_v2/single_row_endurance_description_report_2026-05-31T00-05-12-628Z.json`.

### Fresh-50 v9.17.1 dry-run @ DeepSeek `deepseek-v4-pro` concurrency=2
- 50 rows processed (coverage 50/50, no drops).
- **21 accepted** (`dry_run_update`, scores 4.70–4.83 — at or above the 4.70 accept floor; floor unchanged).
- **24 weak** (below accept threshold; score range 4.27–4.68).
- **4 validator-rejected**: `atomic-habits-james-clear` (`unsupported_format_claim_prompts`), `just-mercy-bryan-stevenson` (`unsupported_format_claim_course`), `the-gene-siddhartha-mukherjee` (`unsupported_proof_or_prestige_claim_foundational`), `stumbling-on-happiness-daniel-todd-gilbert` (`quality_below_threshold; score=3.89`).
- **1 provider timeout**: `a-tale-of-two-cities-charles-dickens`.
- **Timeout rate: 2.0 %** (1 / 50).
- **Concurrency=2 remains the recommended setting** for DeepSeek v4 pro at scale. Concurrency=5 produced the ~40 % timeout cliff in earlier cycles; concurrency=2 has stayed at 0–2 % across v9.16, v9.17, and v9.17.1.
- Dry-run report: `rebuild_v2/editorial_fresh50_v9_17_1_next_dry_run_v1.csv`.

### Live promote of the 21 accepts
- Triple-gated promote path used: `--write --confirm-promote-accepted --backup-before-write`. Pointed at the dry-run CSV directly so the script reads `recommended_action=accept_candidate` rows.
- Promote summary: `rows_read=50, accept_candidate=21, promoted=21, would_promote=0, skipped=0, failed=0`.
- **No AI calls during promote** — confirmed in script log (`[promote] NO AI CALLS WERE MADE.`).
- Per-row backup snapshot before write: `backups/editorial_fresh50_v9_17_1_next_pre_v1.csv`.
- Post-write verification: 21 / 21 flipped to `ai_quality_status='draft'`; 21 / 21 carry full editorial payload (`editorial_summary` + `best_for` + `not_for` + `key_themes` + `difficulty_level`).
- **Live draft count: 77 → 98** (Endurance fix raised 76→77, then +21 promote → 98).

### Scope discipline
- **No schema changes. No frontend changes. No editorial-script changes during promote.**
- `scripts/generate_book_editorial_enrichment.py` unchanged from `31744db` (v9.17.1).
- Quality floor unchanged (4.70 accept threshold).
- Audit artifacts in `rebuild_v2/` and `backups/` are intentionally not tracked — they're per-run audit trails, not source.

### Type-only note (no behavior change, kept intentional)
- `src/lib/data.ts` — added a TODO comment in the `Book` interface flagging that production `books` does NOT carry an `author` column. PostgREST `select("author")` returns `column books.author does not exist`; author info lives in `author_name` and/or via `book_authors` → `people`. Comment names two reconcile paths (rename the TS field, or expose `author` via a generated-column view) and explicitly defers to a coordinated migration. Pure documentation — pages continue to read `book.author` and tolerate undefined as before.

## 2026-05-31 — Browse Books page: real pagination, category chips, sort, search

### Root cause (before)
The `/books` page had four cosmetic-only controls that did nothing:
- **Cap at 24**: page only ever called `getBooksPaginated(1, 24)` — no `page`/`pageSize` URL wiring.
- **Wrong total**: `getBooksPaginated` returned `total = data.length` (the page slice, not the catalogue count), so pagination math was impossible even if the rest worked.
- **Dead chips**: category buttons were hard-coded `<button>` elements with no `href`/no handler. Array index `i === 0` permanently marked "All" active.
- **Dead sort**: `<select>` had no `value`/`onChange`/no form.
- **Fake "next page"**: literal text "More coming soon" instead of a Page-2 link.
- **Search cap**: `searchBooks(q, 24)` — same 24-row cap.

### Fixed
- **URL-driven state** — `/books?q=…&category=…&sort=…&page=…`. The page reads all four params, validates them, and renders accordingly. Active chip is derived from the URL (unknown values fall back to "All" so bad URLs don't produce silent empty grids).
- **Real pagination** — page size 48. `Prev` / `Next` are real `<Link>`s that preserve the active query state. Works without JS.
- **Category chips become real filters** — chip → list_slug mapping verified against production:
  - Fiction → `fiction` (4,717 books)
  - Non-Fiction → `nonfiction` (7,816 books)
  - Science Fiction → `science-fiction` (550)
  - Classics → `best-classic-books` (58)
  - History → `history` (1,656)
  - Self-Help → `personal-development` (1,001)
- **Sort dropdown** — `Most Recommended` (default), `Highest Rated`, `Title A-Z`. Persists in URL. Implemented via small new `SortSelect` client island that navigates on change and resets `page` to 1 (new ordering invalidates prior offset).
- **Search works beyond first 24** — new paginated `searchBooksPaginated` returns true `count`. Works in combination with sort + paging.
- **Real catalogue total** — `getBooksPaginated` switched to `count:'exact'`, so the "X books" indicator and pagination math now reflect the actual ~98,845 catalogue size.
- **Graceful empty state** — mode-aware messages ("No books match …", "No books found in …", default).

### New helpers in `src/lib/data.ts`
- `searchBooksPaginated(q, page, pageSize, sort)` — title/author search with real `count:'exact'`.
- `getBooksByListSlugPaginated(listSlug, page, pageSize, sort)` — category browse using the existing two-step pattern (paginate ALL membership book_ids → fetch books in URL-safe chunks → client-side sort → page slice). Bounded at 10,000 member books (largest current category Nonfiction is ~7,800 — fits with headroom).
- **Why not a PostgREST `!inner` embed**: probed in production — `order(col, { foreignTable: 'books' })` only orders the embedded representation, not the parent `book_lists` row slice. Confirmed live on Fiction: `the-republic-plato` (rec=13) appeared *after* `death-s-end` (rec=5) under that pattern. Two-step is the only path that gives a correct page slice today.

### New client component
- `src/components/SortSelect.tsx` — small client island for the sort dropdown. Reads current params, updates the URL with `router.push`, drops `page` on change.

### Scope discipline
- **Frontend + data-layer only.** No DB writes. No schema changes. No editorial-pipeline files touched. No AI calls. No Amazon affiliate changes.

## 2026-05-31 — Book detail discovery Phase 1 (reading-fit strip, similar books, why-recommended)

### Added
- **Reading-fit strip** on `/books/[slug]` — compact pills above the description showing `Difficulty: {level}` (from `books.difficulty_level`), `Length: {Short|Medium|Long} · {N} pages` (from `books.page_count`), and up to 2 top key themes (from `books.key_themes`). Purely a quick-glance "is this for me?" preview; the full theme list still renders in the Editorial section below.
- **"Why recommended" card** — deterministic one-sentence summary above the Recommendation Signals section. Format: `Recommended by N source(s) and appears in {list1}, {list2}, and {list3}.` Built from `books.recommendation_count` + the top 3 entries from the existing `getListsForBook` (already ranked: topic > narrow > meta > broad). Hidden when neither signal is present.
- **Similar books section** — replaces "What to read next". Now sourced primarily from list/topic co-membership via new `getSimilarBooksByLists(bookId, limit)` helper, with series + author fills as fallback. Deduped against the current book. Cap raised from 6 to 8.

### Type changes
- `Book` interface in `src/lib/data.ts`: added `page_count?: number | null`. The column already exists in the production `books` table (verified via direct probe: ~113 / 98,845 rows populated) and `select("*")` was already returning it — this only types it so the UI can render the Length badge.

### Length-bucket thresholds
- Short: `< 250` pages
- Medium: `250–450` pages
- Long: `> 450` pages
- Renders only when `book.page_count` is a positive finite number. Population is sparse in production today (~0.11% of catalogue), so the badge hides on most pages — that's expected, not a bug.

### New helper (`src/lib/data.ts`)
- `getSimilarBooksByLists(bookId, limit = 8)` — two-step fetch matching the pattern already used by `getBooksForList`/`getRelatedLists`:
  1. Pull this book's `book_lists` memberships.
  2. Find other books in those same lists, count shared memberships per book, fetch the top N.
  3. Rank by shared-list count, tiebreak by `recommendation_count` desc.
- No schema change. No PostgREST `!inner` embed (avoids the same empty-grid quirk that bit `getBooksForList` earlier this cycle).

### Scope discipline
- **Frontend + data-layer only.** No DB writes. No schema changes. No AI calls. No editorial-pipeline files touched. No Amazon affiliate changes. No mutation of any production data.
- All new signals are derived deterministically from columns/relations that already populate today.

## 2026-05-31 — Amazon buy CTA on book detail pages

### Added
- "Buy on Amazon" link on `/books/[slug]` book detail pages, rendered conditionally only when `books.amazon_url` is populated.
- Placement: under the series chip and above the description, adjacent to the cover/title area.
- Styling: `bg-accent text-white rounded-lg px-3.5 py-2 text-sm font-semibold` with subtle right-arrow icon — consistent with the existing accent-button pattern used on the homepage hero CTA.
- Link attributes: `target="_blank" rel="noopener noreferrer nofollow sponsored"` (sponsored hint added for future-proofing if affiliate tags are introduced later).

### Type changes
- `Book` interface in `src/lib/data.ts`: added `amazon_url?: string | null`. The existing `select("*")` was already returning the column from production; this only types it.

### Scope discipline
- **Frontend only.** No DB writes. No schema changes. No mutation of `amazon_url` values — uses what production already has populated.
- **No affiliate tags** introduced. `amazon_url` values rendered as-is from the DB. `rel="sponsored"` is included as a forward-compatible signal; current URLs carry no tag.
- **No editorial-pipeline files touched.**

## 2026-05-31 — Editorial Pipeline v9.13–v9.17.1 (validator/prompt fixes + 49 new drafts)

### Pipeline changes (scripts/generate_book_editorial_enrichment.py)

**v9.13** — narrow over-strict validators (no quality threshold change):
- `_is_negated_context`: added friction-aware mismatch openers (`lose interest if`, `looking for`, `annoying if`, `you'll bounce`, `skip if you`, …) so the format-claim check correctly treats "lose interest if you're looking for exercises" as negation.
- `_is_comparison_context` (new helper): 30-char lookback for comparison openers (`like a`, `similar to a`, `feels like a`, `reads like a`). Skips proof/fact-risk rejection when the phrase is part of a comparison rather than a claim about the book itself.
- `DNF_TOKENS`: expanded from 18 to 38 tokens — added contract-approved sanitized DNF phrasings (`lose interest`, `tedious`, `preachy`, `tough love`, etc.) so non-narrative books can satisfy the rule without using the banned literal "DNF".
- `contains_recommender_name`: new `_is_non_person_name` guard skips list-label-shaped strings (`Book Recommendations (7 Books)`, `Reading List`, etc.) from the recommender-leak check.

**v9.14** — fix evaluator/contract DNF mismatch:
- Evaluator `dnf_signals` rewritten to recognize contract-approved sanitized phrasings (`you'll likely put it down`, `you'll lose patience`, `put it down when`, …). Previously the evaluator only matched DNF-literal strings the contract forbids — capping the dimension at 4.5 even for contract-perfect output.
- DNF cap raised from 4.5 to 5.0 for rows with both sanitized signal AND friction token AND chapter anchor.
- `SCORE_DRIVER_DIMS` extended with `dnf_warning_quality` and `not_for_specificity` so surgical-retry can target them.
- Surgical instructions added for both new dims.
- Surgical length-only repair path for `summary_length_out_of_range`.
- Brief-item penalty narrowed: now fires only when majority of items are <8 words (was: any one).
- Contract (`docs/ai-editorial/COMPACT_PROMPT_CONTRACT.md`): explicit length budget (70-95 words, 4-6 sentences); explicit not_for guidance for aphoristic books; comparable_experience genre/era guidance.

**v9.15** — narrow 3 false positives surfaced in fresh-25:
- `proof` carveout for `social proof` / `burden of proof` / `proof of work` / `proof of concept` / `proof of life` / `living proof` / `proof of stake` / `standard of proof` / `level of proof`.
- `_is_reader_usecase_course` (new helper): "course" used as reader use-case (`preparing a course`, `teaching a course`, `designing a course`, `taking a course`, `enrolled in a course`) does NOT trip the format-claim rule.
- `_is_negated_context` extended with contrastive openers (`rather than`, `instead of`, `not on`, `not in`, `, not `, ` not just `, `as opposed to`, `in contrast to`).

**v9.16** — 2 false positives surfaced in fresh-50:
- Hyphenated-proof compound carveout: `\b\w+-proof\b` (e.g., `AI-proof`, `future-proof`, `fool-proof`) does NOT trip the proof rule when every occurrence is inside a hyphenated compound.
- `_is_reader_desire_proven` (new helper): "needs a proven X" / "looking for a proven Y" reader-desire patterns do NOT trip unsupported-proof-or-prestige claim.

**v9.17 + v9.17.1** — 2 more false positives surfaced in fresh-50 recovery:
- Hyphenated compound carveout extended: `\bproof-\w+\b` (e.g., `proof-texting`, `proof-read`, `proof-positive`) — covers `proof` as first half of hyphenated compound. Combined with v9.16 `\w+-proof`, full coverage.
- Word-boundary matching for short format phrases (`course`, `journal`, `workbook`, `planner`, `worksheet`, `exercises`, `prompts`) applied at BOTH validator sites (`_check_title_format_mismatch` AND the secondary format-loop). Substrings like "discourse" no longer falsely trigger `unsupported_format_claim_course`. v9.17.1 closes the second-site gap.

### Tests
- 7 new selftest harnesses added: `--selftest-validator-narrowing` (23), `--selftest-evaluator-dnf` (5), `--selftest-v915-narrowing` (18), `--selftest-v916-narrowing` (14), `--selftest-v917-narrowing` (17).
- All existing selftests preserved.
- **Total: 117/117 selftests passing + 24/24 mock-AI fixture outcomes. Zero regressions across v9.13–v9.17.1.**

### Production state — editorial drafts
- Before this cycle: 28 production drafts.
- Promoted this cycle (4 live writes, all triple-gated + count-validated + backed up before write):
  - 10 from same-20 v9.14 benchmark
  - 11 from fresh-25 v9.14
  - 26 from fresh-50 v9.16 combined (15 original + 11 recovery)
  - 2 from v9.17 recheck of previously-rejected rows (ai-superpowers-kaifu-lee 4.88, a-guide-to-the-good-life-william-b-irvine 4.84)
- **49 new editorial drafts promoted this cycle.**
- **Live draft count now 77.**
- Pipeline accept rate confirmed reproducible at ~50% on completed runs across same-20 (10/20), fresh-25 (11/25), fresh-50 (26/50 combined).

### Operational findings
- **DeepSeek v4 pro concurrency**: at concurrency=5 the timeout rate hit 40% (20/50); at concurrency=2 the timeout rate was 0% (0/20 in recovery batch). **Recommendation: use `--concurrency 2 --sleep 0` for any batch larger than 25 rows.** Recovery using concurrency=2 successfully resolved all 20 fresh-50 timeouts.
- 4.70 accept threshold UNCHANGED. No quality floor was lowered to achieve the accept-rate improvement.

### Scope discipline
- **No schema changes.** No new columns added; storage format (text JSON-encoded array string for `best_for`/`not_for`, text[] for `key_themes`) preserved as-is.
- **No frontend changes** in this cycle. Existing `parseEditorialList` already handles the production storage format.
- All writes column-scoped: PATCH payloads target `editorial_summary`, `best_for`, `not_for`, `key_themes`, `theme_tensions`, `emotional_journey`, `reading_pace_profile`, `vibe_tags`, `difficulty_level`, `recommendation_context`, `discussion_potential`, `comparable_experience`, `source_quality_note`, `ai_quality_status`, `ai_generated_at` only.
- All writes preceded by triple-gated promote (`--write` + `--confirm-promote-accepted` + `--backup-before-write`), count-validated backup, and zero-overlap verification against existing drafts.

### Backups
- `backups/editorial_top25_v9_14_same20_pre_v1.csv` (10 rows pre-write)
- `backups/editorial_fresh25_v9_14_pre_v1.csv` (11 rows pre-write)
- `backups/editorial_fresh50_v9_16_pre_v1.csv` (26 rows pre-write)
- `backups/editorial_fresh50_v9_17_pre_v1.csv` (2 rows pre-write)

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

## 2026-05-30 — Top 500 Description and Cover Quality Pass

### Changed
- Backfilled high-confidence descriptions for top-500 books with empty or junk descriptions.
- Reduced top-500 bad/short descriptions from 36 to 23.
- Verified top-500 live covers have zero missing rows.
- Added stricter gated top-500 description backfill tooling with manual-review routing for edition-sensitive/classic/religious rows.
- PATCH operations were limited to description or cover_image_url only; no slug, title, schema, editorial, or AI writes.

### Held
- Remaining 23 top-500 bad descriptions require manual/source-backed review.
- Top-500 editorial enrichment remains largely pending.

## 2026-05-30 — Top 25 Editorial Draft Pilot

### Changed
- Ran top-25 editorial enrichment dry-runs with DeepSeek.
- Promoted 5 accepted editorial candidates to draft status after report validation and manual approval.
- Promoted books: The Alchemist, Principles, The Selfish Gene, Why We Sleep, and The Hard Thing About Hard Things.
- Held weak/rejected candidates pending prompt/validator improvements.
- No broad editorial write; only accepted candidates were promoted.
