# People category gaps vs BookAuthority's expert categories (2026-11-14)

Scope: BookAuthority's 40 expert categories (names only, taken from its public sitemap) compared with the people we publish.
No BookAuthority recommendations, quotes or text were copied; their recommendations cite no primary sources, so they are not used as data.

## What the numbers say

- Published people: **52** of 2,359 rows (2,270 `draft`, 37 `noindex`).
- Draft people with **>= 5 recommendations: 1,025**. This is the real coverage gap: the people exist and have recommendations, but are not published.
- Of those 1,025 drafts, **883 have no role**, 981 have no source_url, and 952 have no avatar. Several top "names" are single surnames ("Hitchens", "Williams", "Deutsch", "O'Shaughnessy") or placeholder rows ("Book Recommendations (43 Books)"), which is why they are not published.
- We have no category field on `people`; only free-text `role`. The comparison below is by role keywords, so it is approximate.

## Published people by BookAuthority category (role keywords, 52 people)

| Category | Published | Note |
|---|---|---|
| Authors / novelists | 18 | covered |
| Entrepreneurs / founders | 20 | covered |
| Investors / VC | 7 | covered |
| CEOs | 5 | covered |
| Actors | 4 | covered (thin) |
| AI / tech | 3 | thin |
| Psychologists, educators, politicians, podcasters, designers | 2-3 each | thin |
| Comedians, journalists, Indian voices | 1 each | thin |
| **Athletes, billionaires (as a label), chefs, coaches, doctors, economists, engineers/developers, lawyers, marketers, musicians, scientists, spirituality, historians, health & wellness** | **0** | **not covered** |

"Billionaires" is a label rather than a role, so 0 only means our roles do not say so; our `books-recommended-by-billionaires` list exists.

## Candidates for the empty categories (from our own draft pool, >= 22 recommendations)

Matched against Wikipedia short descriptions. **Name matching is unreliable: Shane Parrish matched a fictional TV character and Andrew Wilkinson a Canadian politician; both are wrong. Every entry needs a manual identity check before a role is written.** Only 104 of 400 names matched before Wikipedia rate-limited the run (HTTP 429), so this list is a sample, not complete.

- Economists: Tyler Cowen (54 recs)
- Doctors / health: Peter Attia (41)
- Scientists: Lex Fridman (42), Sam Harris (23, also philosophy), Bret Victor (30), Nick Szabo (24)
- Chefs: Anthony Bourdain (40), Samin Nosrat (22)
- Athletes / chess: Josh Waitzkin (52), Dan Heisman (73)
- Engineers / developers: Tim O'Reilly (61), David Heinemeier Hansson (54), Matt Mullenweg (51), Susan J. Fowler (44), Max Levchin (37)
- Musicians: Amanda Palmer (22)
- Politicians: Hillary Clinton (30), Michael Bloomberg (26)
- Comedians: Bryan Callen (26), Ellen DeGeneres (24)
- Journalists: Ezra Klein (40), Cleo Abram (60), Michael Pollan (30)
- Historians and lawyers: no candidates found in the sample

## Suggested next steps (not done)

1. Add a `category` (or roles array) to people so the hub can group and filter by it, instead of free text.
2. Review the 1,025 draft people with >= 5 recs: drop junk rows, fill role/bio/avatar from a primary or Wikipedia source, publish the verified ones. Prioritise the empty categories above.
3. Add BookAuthority-style category pages (for example `/people/category/economists`) only once each has >= 5 published people, to respect the thin-page gates.

## Pilot published (2026-11-14)

Selected from the 14 candidates by the share of their recommendations that lack a source or cite only other people's tweets (12-47%; handles used for that check were typed from memory, so treat the ranking as approximate). The three with the lowest share and a licence-checked portrait went live: **Sam Harris** (scientists / philosophy), **Michael Pollan** (journalists / food) and **David Heinemeier Hansson** (engineers / developers).
Role and bio are short statements written from each person's Wikipedia lead; portraits come from Wikimedia Commons with the licence read from the file page (CC BY-SA 4.0, CC BY-SA 4.0, CC BY 2.0). Script: `scripts/people_publish_apply.py` (backups in `bak_seo_changes_20261114`, batch `people_publish_20261114`; undo with `update people set <old_values> where id = row_id`).

Not published: Peter Attia and Tim O'Reilly (low unsourced share, but Wikipedia rate-limited the lookup, so no verified bio/portrait yet); the rest have 20-47% of recommendations unsourced or sourced only to other people's tweets (for example, Anthony Bourdain's "Best Evidence" is quoted from a Joe Rogan tweet), which should be cleaned before those pages go live.
