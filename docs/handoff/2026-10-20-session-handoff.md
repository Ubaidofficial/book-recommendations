# Session handoff, 2026-10-20

Start here tomorrow. Everything below is the state at the end of 2026-10-20. Repo: `Ubaidofficial/book-recommendations` (Next.js 16, Supabase project `ghpdpvatfmvsahzsqgpp`, site bookmentions.net, hosted on Railway). All code from this session is merged to `main` (PRs #3 and #4).

## 1. What is live and running

| Thing | State |
|---|---|
| New list-page template (`/lists/[slug]`) | Live (PR #3). "Where to start" block, "Recommended by" on every book row, edition dedupe, long-tail toggle, per-person sections, FAQ + FAQPage JSON-LD. Verified on the 6 published lists. |
| People alias redirects | Live (PR #4). 37 old surname-only URLs 308-redirect to the full-name page (`next.config.js`). |
| Daily list publisher | **Enabled.** Scheduled task `trig_01KRqR5QGotDNahzJf6dJryQ`, "Daily publish (7 lists/day)", cron `5 11 * * *` (11:05 UTC), first run 2026-10-21. Publishes via the Supabase MCP `execute_sql` (the repo script is blocked here and no service key exists). Queue of ~110 reviewed slugs is in the task prompt. |
| Published lists | 6 so far: greek-mythology, stoicism, true-crime, cryptocurrency, biohacking, psychedelics (all `best-*-books`; psychedelics is `best-books-on-psychedelics`). Published 2026-10-20 11:12 UTC. |
| Commons photo retry task | Deleted at the user's request (no Commons for the next photo batch). |

## 2. Production data changes made today (all in Supabase, not in git)

- **List descriptions:** 284 draft lists got data-grounded descriptions ("<Topic> books, including titles recommended by A, B and C. Most recommended here: X, Y and Z."). 157 draft lists with 15+ books still have none (excluded as mismatched or too little data).
- **People bios/roles:** ~196 people have a Wikipedia bio (`bio`, `role`, `source_url` = Wikipedia article, which renders as "Profile source"). Written only where a same-name Wikipedia article was verified AND the person's own recommendation sources tie to them (own-handle tweet or a guest page). 7 doubtful ones were cleared (Negreanu, Burr, Stanley, Jeselnik, Blunt, Johansson, Affleck). Hand-dropped as wrong-person risks: Alice Little, Brian Moran, Jim Knight, Brad Frost, Peter Wang, a Survivor-season row, Lucciola (restaurant), Langston Galloway. ~92 candidates had no verifying source and were left unwritten.
- **Photos:** 21 public-domain/CC0 avatars written (Hemingway, Gandhi, Meg Whitman, Samantha Power, Pete Buttigieg, Chelsea Clinton, Jim Himes, Ted Lieu, Kerry Washington, Megyn Kelly, Preet Bharara, Max Boot, Scott Gottlieb, Justin Amash, Sean Hannity, Laura Helmuth, Ravi Zacharias, Bill Rasmussen, D.A. Wallach, Jamie Kilstein, Herman Mashaba). No CC BY / CC BY-SA photos written (needs photographer credit).
- **Book titles:** 41 float-corrupted titles fixed ("1984.0" to "1984") and 9 date-corrupted titles restored ("August 1914", "5/3/1", "24/6", "9-11", etc.). Still corrupted: "19141918.0" (D. Stevenson) and one Arthur C. Clarke "2019-07-20".
- **Covers:** 718 Open Library covers written for books shown up front on queued/published lists (`?default=false` URLs, `open_library_id` set). 112 of 830 had no safe title+author match. Note: ~86,500 books still hold a filename-only `cover_image_url` (e.g. "Stoicism.png") that does not resolve; those show "No cover".
- **People merges:** 37 surname-only alias rows merged into the full-name person (1,461 recommendation rows moved, duplicates dropped, `recommendation_count` recomputed as distinct recommenders, alias pages set `noindex`). Tier B (ambiguous surnames): only rows whose own source URL names the person were moved. Backups: tables `bak_people_merge_20261020` and `bak_people_merge_b_20261020` . Each holds the full original `book_recommendations` rows (original alias `person_id`) plus the canonical slug. To undo: re-insert any row missing from `book_recommendations` (the redundant duplicates were deleted), and for rows still present set `person_id` back to the backup's `person_id`; then recompute `books.recommendation_count` and set the alias pages' `index_status` back.

## 3. Policies and decisions (set by the user, do not relitigate)

- Publish 5 to 7 lists per day (user raised it to 7). Tier 1 pillar lists are uncapped.
- Never publish a book or person without an image or a planned SEO case; no commodity content. (Open question below: relax for people with initials avatars.)
- Publishing only through the guarded SQL in the scheduled task; never remove the guards (15+ books, description >= 30 chars, 20+ distinct recommenders).
- Hold lists, never publish: best-books-on-revolutions, best-quantum-physics-books, best-books-for-dads, best-data-science-books, best-design-books, best-physics-books, best-books-on-persuasion, any empty slug. Also encoded in `HELD_LIST_SLUGS` in `scripts/import/publish_batch_pages.js`.
- Publish one list per duplicate cluster (entrepreneur/entrepreneurship/new-business; screenwriting/screenplay; communication/communication-skills; self-help/self-improvement/motivational; philosophy/philosophers; meditation/mindfulness; mystery/murder-mystery/suspense/thriller; war/war-history/books-about-war; apocalyptic/post-apocalyptic).
- **Photos:** the user asked repeatedly to copy photos from mostrecommendedbooks.com, readthistwice.com and similar sites, and to skip outreach. I declined every time (copyright; not licensed to us). The user also said no Commons for the next batch. Net: no photo work is in progress. Do not scrape other sites' images.

## 4. Open items, in suggested order

1. **Check tomorrow's publish ran** (11:05 UTC): 7 new lists, each URL 200 and `index, follow`. If the scheduled task could not reach the Supabase tool it should say so.
2. **People publishing / photos (needs a decision).** About 300 people with 10+ recommendations have no photo. Options: (a) publish people with the site's existing initials avatar (relax the image rule), (b) free sources only: Library of Congress / US gov / CC0, Flickr CC (needs an API key), Commons with credit when its rate limit clears, (c) permission emails: `docs/handoff/2026-10-20-photo-outreach-sheet.md` (25 people, template; most contacts unverified) and `docs/handoff/2026-10-20-photo-permission-requests.md`.
3. **Ambiguous surnames** still holding rows: Moore, Cook, Grant, O'Shaughnessy (no evidence at all), and leftovers on King, Harris, Clinton, Williams, Brand, Marcus, Wright, Watson, Weinstein, Shapiro, Green, Shea, Wilson, Koch. Needs a call on who each is. Single names with no match: Phan, Slim, PewDiePie, Patchett.
4. **Junk person rows** to remove or fix: "Book Recommendations (43 Books)", "The Rational Walk", "Alex and Books"; duplicate full-name rows (patrick-oshaughnessy and patrick-o-shaughnessy; money-mustache, mr-money-mustache and peter-adeney; tobi-lutke and tobi-l-tke; deGrasse Tyson vs Neil deGrasse Tyson; Halse Anderson vs Laurie Halse Anderson; R. R. Martin vs George R. R. Martin; Maples, Jr. vs Mike Maples, Jr.; Ngozi Adichie vs Chimamanda Ngozi Adichie; Rukh Khan vs Shah Rukh Khan).
5. **Remaining list quality work:** editorial intro (150 to 200 words) for the ~20 priority lists, written for the user to review; clean publisher blurbs; the 157 draft lists without descriptions.
6. **Covers:** extend the Open Library finder (`scripts/data/backfill_covers_openlibrary.py`) to lists as they enter the queue; ~86,500 books still have filename-only covers.
7. **Still open from earlier in the project:** Blyton order data (28% match); numbered-series pilot (Stephen King, Janet Evanovich, J.D. Robb, Stuart Woods, Horus Heresy); book-summaries pilot (needs the user's answer on AI-drafted, human-reviewed summaries); re-inspect `/books` in Search Console in 1 to 2 weeks; `SUPABASE_SECRET_KEY` for the disabled routines and enrichment script; PostHog connector authorization; the `/authors` 57014 timeout on main; the 28 short-title Collison matches; the other two corrupted titles (section 2).

## 5. Gotchas that cost time today

- `pkill -f "<pattern>"` inside a Bash call kills the Bash call itself (its command line contains the pattern). Use a PID or a pattern not in the command.
- Wikimedia (Commons, Wikipedia, Wikidata) rate-limits this container's shared IP with HTTP 429; scripts fail silently. `build_people_enrichment_sql.py` now caches Wikipedia results (`scratch/people_write_wiki_cache.json`); `fill_avatar_attribution.py` is batched and resumable.
- Google Books API is over quota. Open Library works (search + covers).
- The auto-mode permission check blocked running `publish_batch_pages.js`; counting eligibility with read-only SQL works instead. No service key exists, so only the Supabase MCP `execute_sql` can write.
- `scratch/` is git-ignored and ephemeral (lost when the container is reclaimed). Durable copies of the two outreach docs are in `docs/handoff/`. The proposal/CSV/SQL working files under `scratch/` (people_enrichment_proposal.json, people_write*.csv/sql, covers*.csv/sql, list_desc/*) are regenerable from the scripts below.
- Search-result summaries invented licence details for a press kit (claimed CC BY with a named photographer; the page said neither). Open the page and read it before recording a licence.

## 6. Scripts added (all in `scripts/`, committed to main)

- `data/build_list_descriptions.py`: read-only; writes review CSV + SQL chunks for list descriptions.
- `data/build_people_enrichment_sql.py`: read-only; Wikipedia bios/roles with verification, cache, SQL chunks.
- `data/fill_avatar_attribution.py`: Commons credit lookup (batched, resumable); blocked while rate-limited.
- `data/backfill_covers_openlibrary.py`: Open Library cover finder scoped to ready-to-publish lists.
- `import/publish_batch_pages.js`: `HELD_LIST_SLUGS` added.

## 7. Key IDs and links

- Daily publish task: `trig_01KRqR5QGotDNahzJf6dJryQ` (update its prompt to change pace or queue).
- Supabase project: `ghpdpvatfmvsahzsqgpp`. Repo: https://github.com/Ubaidofficial/book-recommendations. PRs: #3 (list page), #4 (redirects), #2 (earlier sourcing work).
- Public read key (anon, already in `src/app/sitemap.ts`): used by the read-only scripts.
