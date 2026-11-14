# Series publish review — 2026-11-14

**Nothing was published or changed.** This is a review list for your existing publish queue (`migrations/004_series_publish_queue.sql`).

## What the data says
mostrecommendedbooks.com shows 55 series on the pages of people you track. You already hold 55 of them
(the one it shows that you lack is *Jin Yong*). But **52 are drafts and only 3 are published**.

Your publish rule (see the queue migration) needs a real reading order — **80%+ of a series' books with a verified `first_published_year`** — and a completeness check against Open Library.
That is the blocker: most drafts are at 0–60% year coverage. None of the drafts is marked `publish_ready`, and none has `book_series.position` filled in.

Already published, and meeting the rule: Dune (83%), Harry Potter (100%), Jack Reacher (90%).

## Tier 1 — meet the year threshold; run the completeness check, then queue
| Series | Books | % with verified year | Recs on its books | MRB books |
|---|---:|---:|---:|---:|
| The Three Body Problem (`the-three-body-problem-books-in-order`) | 3 | 100% | 33 | 3 |
| Sprawl (`sprawl-books-in-order`) | 3 | 100% | 9 | 3 |
| The Hunger Games (`the-hunger-games-books-in-order`) | 4 | 100% | 6 | 5 |
| Regeneration (`regeneration-books-in-order`) | 3 | 100% | 0 | 3 |

## Tier 2 — heavily recommended, blocked by year coverage (run `scripts/backfill_first_published_year.py` first)
| Series | Books | % with verified year | Recs on its books | MRB books |
|---|---:|---:|---:|---:|
| Incerto (`incerto-books-in-order`) | 5 | 60% | 105 | 5 |
| Culture (`culture-books-in-order`) | 10 | 50% | 36 | 11 |
| Toni Morrison (`toni-morrison-books-in-order`) | 30 | 7% | 33 | 45 |
| Travis Mcgee (`travis-mcgee-books-in-order`) | 21 | 5% | 28 | 21 |
| Colson Whitehead (`colson-whitehead-books-in-order`) | 10 | 10% | 21 | 12 |
| Foundation (`foundation-books-in-order`) | 7 | 29% | 21 | 7 |
| Ender Saga (`ender-saga-books-in-order`) | 19 | 5% | 20 | 22 |

## Tier 3 — some recommendations, low year coverage
| Series | Books | % with verified year | Recs on its books | MRB books |
|---|---:|---:|---:|---:|
| Michael Crichton (`michael-crichton-books-in-order`) | 32 | 3% | 16 | 37 |
| The Lord Of The Rings (`the-lord-of-the-rings-books-in-order`) | 4 | 25% | 13 | 5 |
| Bernie Gunther (`bernie-gunther-books-in-order`) | 14 | 7% | 11 | 14 |
| Hyperion Cantos (`hyperion-cantos-books-in-order`) | 4 | 50% | 8 | 5 |
| Game Of Thrones (`game-of-thrones-books-in-order`) | 5 | 40% | 7 | 7 |
| The Story Of Civilization (`the-story-of-civilization-books-in-order`) | 11 | 9% | 7 | 11 |
| The Dark Tower (`the-dark-tower-books-in-order`) | 9 | 44% | 6 | 8 |
| Paco (`paco-books-in-order`) | 9 | 0% | 5 | 10 |
| The Enlightenment Trilogy (`the-enlightenment-trilogy-books-in-order`) | 3 | 0% | 5 | 3 |
| Gilead (`gilead-books-in-order`) | 4 | 0% | 4 | 4 |
| Singularity Series (`singularity-series-books-in-order`) | 4 | 0% | 3 | 4 |
| The Baroque Cycle (`the-baroque-cycle-books-in-order`) | 3 | 0% | 3 | 3 |
| Dog Man (`dog-man-books-in-order`) | 10 | 30% | 2 | 14 |
| The Years Of Lyndon Johnson (`the-years-of-lyndon-johnson-books-in-order`) | 4 | 25% | 2 | 4 |
| His Dark Materials (`his-dark-materials-books-in-order`) | 8 | 0% | 1 | 8 |
| Honor Harrington (`honor-harrington-books-in-order`) | 16 | 19% | 1 | 17 |
| Nexus (`nexus-books-in-order`) | 3 | 33% | 1 | 3 |
| Nikki Heat (`nikki-heat-books-in-order`) | 10 | 0% | 1 | 10 |
| Sherlock Holmes (`sherlock-holmes-books-in-order`) | 9 | 33% | 1 | 8 |
| The Internet Of Money (`the-internet-of-money-books-in-order`) | 3 | 0% | 1 | 3 |
| The Lost Fleet (`the-lost-fleet-books-in-order`) | 6 | 0% | 1 | 6 |
| The Void (`the-void-books-in-order`) | 3 | 33% | 1 | 3 |
| Twilight (`twilight-books-in-order`) | 5 | 0% | 1 | 8 |
| Way Of The Warrior Kid (`way-of-the-warrior-kid-books-in-order`) | 4 | 0% | 1 | 5 |

## Tier 4 — no recommendations on their books yet (lowest priority)
| Series | Books | % with verified year | Recs on its books | MRB books |
|---|---:|---:|---:|---:|
| A Comprehensive Introduction To Differential Geometry (`a-comprehensive-introduction-to-differential-geometry-books-in-order`) | 5 | 0% | 0 | 5 |
| Anastasia Krupnik (`anastasia-krupnik-books-in-order`) | 9 | 0% | 0 | 9 |
| Arc Of A Scythe (`arc-of-a-scythe-books-in-order`) | 3 | 0% | 0 | 4 |
| Books Of Blood (`books-of-blood-books-in-order`) | 6 | 0% | 0 | 6 |
| Conversations With God (`conversations-with-god-books-in-order`) | 4 | 0% | 0 | 11 |
| Dragonwatch (`dragonwatch-books-in-order`) | 6 | 17% | 0 | 6 |
| Fablehaven (`fablehaven-books-in-order`) | 5 | 0% | 0 | 6 |
| History Of Religious Ideas (`history-of-religious-ideas-books-in-order`) | 3 | 0% | 0 | 3 |
| Law Legislation And Liberty (`law-legislation-and-liberty-books-in-order`) | 3 | 0% | 0 | 3 |
| Rick And Morty (`rick-and-morty-books-in-order`) | 12 | 0% | 0 | 12 |
| The Art Of Computer Programming (`the-art-of-computer-programming-books-in-order`) | 4 | 0% | 0 | 4 |
| The Boys (`the-boys-books-in-order`) | 6 | 0% | 0 | 6 |
| The Feynman Lectures On Physics (`the-feynman-lectures-on-physics-books-in-order`) | 3 | 0% | 0 | 3 |
| The Gulag Archipelago (`the-gulag-archipelago-books-in-order`) | 3 | 0% | 0 | 3 |
| The Last Lion (`the-last-lion-books-in-order`) | 3 | 0% | 0 | 3 |
| The Norton Anthology Of Modern And Contemporary Poetry (`the-norton-anthology-of-modern-and-contemporary-poetry-books-in-order`) | 2 | 0% | 0 | 2 |
| The Sandman (`the-sandman-books-in-order`) | 13 | 0% | 0 | 13 |

## Suggested order of work
1. Run the completeness check (`scripts/series_completeness_check.py`) on Tier 1, then set `publish_ready` and `publish_priority` and let `publish_batch_pages.js` release them at its daily quota.
2. Run `backfill_first_published_year.py` for Tier 2, re-check coverage, and move any that reach 80% into Tier 1.
3. Add the missing *Jin Yong* series only after its books are checked (MRB lists 15 books for it).
4. Series pages are titled with the raw slug in the database (for example `incerto-books-in-order`); the site cleans these for display (`seriesBaseName`), but a proper title column would help the publish queue.

Source: `reports/mrb_series_featured.csv` (series MRB shows on pages of people you have) joined to your `series`, `book_series` and `books` tables, read-only.
