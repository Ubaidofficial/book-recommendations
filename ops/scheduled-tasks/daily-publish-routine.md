---
name: BookRecs — Daily publish (7 lists + 6 series/day)
schedule: 11:05 UTC daily (cloud scheduled task trig_01KRqR5QGotDNahzJf6dJryQ)
---

<!-- Mirror of the cloud scheduled task that actually publishes the site each
day. This is a copy: the live task only changes when its instructions are
updated from the conversation it posts into. Paste everything below the line
there to apply the series quota. -->

---

PAUSE-CHECK FIRST: if the user has asked in the session to hold publishing pending the content-quality audit, do not publish; just report. Otherwise follow the queue below.

Daily publish for BookRecs (Supabase project ghpdpvatfmvsahzsqgpp). Target: 7 list pages per day PLUS up to 6 series pages per day (SERIES_DAILY_QUOTA = 6), for about 13 pages a day. The repo publisher script is blocked and no service key exists, so publish with the Supabase MCP execute_sql tool, not the script.

PART 1 — LISTS (7 per day)

Take the NEXT 7 slugs from this reviewed queue that are not yet published (check `select slug,index_status from lists where slug in (...)` first; skip any already published). Queue, in order:
best-books-about-japan, best-books-about-china, best-books-about-korea, best-books-about-new-york-city, best-fiction-writing-books, best-screenwriting-books, best-memoir-books, best-silicon-valley-books, best-growth-hacking-books, best-negotiation-books, best-personal-finance-books, best-wealth-books, best-holocaust-books, best-world-war-1-books, best-world-war-2-books, best-books-on-vietnam-war, best-climate-change-books, best-neuroscience-books, best-magical-realism-books, best-cyberpunk-books, best-steampunk-books, best-epic-fantasy-books, best-dark-fantasy-books, best-dragon-books, best-poetry-books, best-comedy-books, best-autobiographies, best-biography-books, best-sports-biographies-books, best-meditation-books, best-medical-books, best-military-books, best-running-books, best-sailing-books, best-books-about-germany, best-books-about-france, best-books-about-italy, best-books-about-california, best-books-about-united-kingdom, best-economics-books, best-economic-development-books, best-cryptography-books, best-biology-books, best-botany-books, best-anthropology-books, best-ancient-history-books, best-world-history-books, best-war-books, best-art-books, best-architecture-books, best-picture-books, best-childrens-books, best-books-for-3-year-olds, best-books-for-6-year-olds, best-books-for-7-year-olds, best-books-for-8-year-olds, best-books-for-9-year-olds, best-books-for-10-year-olds, best-christmas-books, best-adventure-books, best-non-fiction-adventure-books, best-apocalyptic-books, best-alternate-history-books, best-dystopian-books, best-classic-books, best-political-books, best-socialism-books, best-libertarian-books, best-psychology-books, best-cognitive-psychology-books, best-social-psychology-books, best-leadership-books, best-entrepreneur-books, best-project-management-books, best-hiring-recruiting-books, best-human-resources-books, best-communication-skills-books, best-goal-setting-books, best-time-management-books, best-procrastination-books, best-self-discipline-books, best-self-help-books, best-spiritual-books, best-philosophy-books, best-mindfulness-books, best-yoga-books, best-relationship-books, best-grief-books, best-friendship-books, best-love-books, best-feminist-books, best-lgbt-books, best-immigration-books, best-books-for-women, best-books-for-men, best-mystery-books, best-thriller-books, best-psychological-thriller-books, best-spy-books, best-serial-killer-books, best-crime-books, best-video-game-books, comics, best-short-stories-books, best-music-history-books, best-software-books, best-computer-science-books, best-engineering-books, best-machine-learning-books, artificial-intelligence, best-digital-marketing-books, best-business-plan-books, best-interviewing-books, best-enneagram-books, best-books-on-habits, best-books-on-discipline.

Publish only by this guarded statement (never remove the guards), one execute_sql call:
update lists l set index_status='published', published_at=now(), updated_at=now() where l.slug in (<the 7 slugs>) and l.index_status in ('draft','noindex') and l.book_count>=15 and length(coalesce(l.description,''))>=30 and (select count(distinct br.person_id) from book_lists bl join book_recommendations br on br.book_id=bl.book_id where bl.list_id=l.id)>=20 returning l.slug;

Never publish: best-books-on-revolutions, best-quantum-physics-books, best-books-for-dads, best-data-science-books, best-design-books, best-physics-books, best-books-on-persuasion, any list with an empty slug, any slug that next.config.js redirects away, or a second list from a duplicate cluster (entrepreneur/entrepreneurship/new-business; screenwriting/screenplay; communication/communication-skills; self-help/self-improvement/motivational; philosophy/philosophers; meditation/mindfulness; mystery/murder-mystery/suspense/thriller; war/war-history/books-about-war; apocalyptic/post-apocalyptic) if its twin is already published - skip it and take the next slug. Before publishing each, glance at its top 6 books (by recommendation_count) and skip it if they do not match the topic or any title looks corrupted (ends in .0, or looks like a date).

PART 2 — SERIES (SERIES_DAILY_QUOTA = 6 per day)

Series pages ("<author> books in order") come from a pre-vetted queue: series.publish_ready = true means the series passed the verified-publication-order (80%+ of books have books.first_published_year) and completeness checks offline. Never set publish_ready yourself, never publish a series that is not publish_ready, and never raise the quota.

1. First check how many series went live recently: `select count(*) from series where index_status='published' and published_at > now() - interval '20 hours';` If that count is 6 or more, skip Part 2 today and say so.
2. Otherwise release (6 minus that count) series, best first, with this guarded statement (never remove the guards):
update series s set index_status='published', published_at=now(), updated_at=now() where s.id in (select id from series where publish_ready = true and index_status = 'draft' and slug like '%-books-in-order' order by publish_priority asc nulls last limit <N>) returning s.slug, s.publish_priority;
3. If no rows come back, the queue is empty: say so (it is useful information, not a failure).

AFTER PUBLISHING: confirm each new URL returns 200 and its title/description render — lists at https://bookmentions.net/lists/<slug>, series at https://bookmentions.net/series/<slug> (a series title must read "<Name> Books in Order"; if it does not, set that series back to index_status='draft' and report it). If the list queue is exhausted, say so. Report: list slugs published, series slugs published (with queue position), any skipped and why, lists remaining in the queue, and series remaining (`select count(*) from series where publish_ready and index_status='draft'`). Do not publish people or books unless the user asks; do not touch any other column.
