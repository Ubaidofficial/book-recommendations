# Re-check of the 6,505 orphaned recommendations (2026-11-13)

Independent re-check of the two primary-source runs. Run from the repo root with `python3 -I`; all four read only cached pages (no network) plus the read-only Supabase key.

1. `recheck.py`: loose person match (name tokens, first+last) against both outside indexes' full people lists, and loose title match (subtitle dropped, containment) against every cached person page. Writes `per_row.json` next to the script.
2. `tweets.py`: for rows whose book is listed, classifies the cited link. A tweet counts as the person's own when its handle equals the handle on the index's own profile for the person, `people.twitter_handle`, or HANDLE_MAP in `scripts/reattribute_quotes.js`, minus HANDLE_DENY.
3. `sample.py`: prints random rows per class for a hand check.
4. `build.py`: builds guarded SQL batches for own-account tweets. Each batch has a payload checksum and a snapshot guard, skips rows already in the backup table, and backs up into `bak_recs_primary_sources_20261112` before writing. It rejects tweets dated two or more years before the book's first published year.

Cached index pages are read from `reports/third_party_cache/` (gitignored).
