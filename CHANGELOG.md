# Changelog

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
