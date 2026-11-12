# Community recommendations (Reddit, Hacker News)

Pipeline that counts how often everyday readers recommend each catalog book in
"what should I read" threads since 2015, and shows it on book pages
(`src/components/CommunityMentions.tsx`, table `book_community_mentions`,
`migrations/006_book_community_mentions.sql`).

## Sources

| source | how | coverage |
|---|---|---|
| Reddit | [Arctic Shift](https://github.com/ArthurHeitmann/arctic_shift) public archive API | r/suggestmeabook, r/booksuggestions (every thread); r/books, r/Fantasy, r/printSF, r/horrorlit, r/nonfictionbooks, r/literature, r/sciencefiction, r/booksthatfeelgood (only request-shaped thread titles) |
| Hacker News | [Algolia HN API](https://hn.algolia.com/api) | Ask HN-style book threads with 20+ comments |

Reddit's own API / PRAW are not used. Reddit stopped accepting new Data API
applications on 2026-10-31, its listings stop at 1,000 items, and it rejects
unauthenticated requests from cloud IPs. The Arctic Shift API is free and
throttles hard (it answers HTTP 422 "Timeout. Maybe slow down a bit"), so a
full 2015-onwards Reddit pull takes **days**. The downloader is resumable per
month and runs newest-first. Arctic Shift's own guidance for very large pulls
is its monthly dump files (academictorrents.com). If you can use BitTorrent
locally, the per-subreddit dumps are the faster and more considerate route.
They would need a small converter into the layout below.

## Run

Keep the raw data somewhere that persists (it is gitignored under `data/`):

```bash
python3 scripts/community/arctic_shift_ingest.py --out data/community/reddit
```

```bash
python3 scripts/community/hn_ingest.py --out data/community/other
```

Export the catalog and people names (anon key is fine — both tables are public-read):

```bash
set -a && . ./.env.local && set +a
python3 scripts/community/export_catalog.py --out data/community
```

Match and aggregate (re-run whenever more months have downloaded; it always
rebuilds from everything on disk):

```bash
python3 scripts/community/match_book_mentions.py --in reddit=data/community/reddit --catalog data/community/catalog.json --people data/community/people_names.json --out data/community/match_reddit
```

```bash
python3 scripts/community/match_book_mentions.py --in hackernews=data/community/other --catalog data/community/catalog.json --people data/community/people_names.json --out data/community/match_hn
```

Read `report.txt` in each output folder before loading. Then load (dry run first; `--replace` drops rows the new run no longer produces):

```bash
python3 scripts/community/load_community_mentions.py --aggregates data/community/match_reddit/book_aggregates.jsonl
```

```bash
python3 scripts/community/load_community_mentions.py --aggregates data/community/match_reddit/book_aggregates.jsonl --write --replace
```

## Matching rules (why a book counts)

Precision over recall — a wrong "recommended on Reddit" claim is worse than a miss.

- Only **top-level replies** in request threads count, once per book per thread.
- **Author named** in the same reply (surname ending a name) → counts.
- **No author**: the title must be written in Title Case or formatted, and
  - 3+ word titles count when no other catalog author shares the title;
  - 1–2 word titles count only if the phrase is capitalised ≥85% of the time
    across the whole corpus and stands alone (not part of a longer name), and
    not an acronym ("VC");
  - and the book must also be matched *with* its author somewhere in the corpus.
- Titles made only of numbers ("24", "1984"), titles equal to a person's name
  ("Marcus Aurelius", "Elon Musk"), and a hand-kept generic list ("The Road",
  "Home", "It") always need the author.

## Licensing / privacy

Usernames are never stored. Pages show counts, links back to threads, and
excerpts capped at ~280 characters that link to the original comment. Reddit's
and HN's terms still apply to the content, and the site is commercial
(affiliate links). Review that with whoever handles legal before relying on
long excerpts.
