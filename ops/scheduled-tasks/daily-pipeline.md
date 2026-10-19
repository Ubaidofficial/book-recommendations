---
name: bookmentions-daily-pipeline
description: Daily enrich-then-publish pipeline for bookmentions.net, with pre- and post-publish verification
---

Run the daily BookMentions enrichment-and-publishing pipeline. Work in `/Users/ubaid/Desktop/Book Recommendations`.

This runs unattended and publishes to a live site, so the ordering and the abort conditions below are not optional. Read them before running anything.

## Context you need (no memory of previous runs)

The site is bookmentions.net (Next.js on Railway, Supabase backend). Secrets are in `.env.local` in the project root — source it with `set -a && . ./.env.local && set +a` before any script that writes. Every script is dry-run by default and needs an explicit flag to write.

**Enrichment must run before publishing, every time.** The publisher only accepts books whose `ai_quality_status` is `draft` or `approved`, which only editorial enrichment sets. It also requires a cover and an 80+ character description, which metadata enrichment fills. If enrichment does not run, the candidate pool drains and the publisher quietly starts publishing nothing, or only people.

**The editorial quality floor is 4.70 out of 5.** Do not lower it, do not pass any flag that bypasses it, and do not "promote" anything scoring below it. Scores of 4.3–4.7 are retried automatically; below 4.0 is rejected. This threshold is the difference between the site's editorial and generic AI filler.

## Steps

**1. Preflight**
- `git -C . pull --ff-only` so you are on current main. If it fails, stop and report.
- Confirm `.env.local` contains `SUPABASE_SECRET_KEY` and `OPENROUTER_API_KEY`. If either is missing, stop and report which.

**2. Metadata enrichment** — fills covers and descriptions, the largest publish blocker (~1,170 books are blocked only by a missing cover):
```
python3 scripts/enrich_books_metadata.py --limit 50 --write
```

**3. Editorial enrichment** — sets `ai_quality_status`, the publish gate. Batch 50 at the 4.70 floor:
```
python3 scripts/generate_book_editorial_enrichment.py --limit 50 --write
```

**4. People enrichment** — roles, bios, Wikimedia avatars:
```
LIMIT=25 node scripts/import/enrich_people_metadata.js --write
```

**5. Publish — dry run first, always**
```
node scripts/import/publish_batch_pages.js --dry-run
```
Read the output. **Abort the publish and report instead of writing** if any of these appear:
- a "query failed" / abort message (the script fails closed on query errors by design — do not work around it)
- a candidate whose slug appears as a redirect source in `next.config.js`
- a list candidate with fewer than 20 distinct recommenders (the script blocks these; if one appears, something regressed)
- the batch is empty (means the pool is exhausted — report it, do not force anything)

If the dry run looks correct, publish:
```
node scripts/import/publish_batch_pages.js --write
```

**6. Post-publish verification** — the failures on this project have all been silent, so check the rendered site, not just exit codes. Wait ~3 minutes for Railway to redeploy, then verify against https://bookmentions.net:
- the homepage renders at least one book card (it once rendered an empty "Popular Books" rail for weeks)
- `/books` lists books
- `/sitemap.xml` returns 200 and its URL count went UP, not down
- spot-check each newly published page: returns 200, has one `<h1>`, has a meta description, and its JSON-LD parses
- no newly published URL is a redirect source in `next.config.js`
- no displayed quote starts with an `@` handle

**7. Report** — a short summary: how many rows each enrichment step changed, what was published (slug and type), what verification found, and anything you skipped and why. If nothing published, say so plainly and give the reason — an empty pool is useful information, not a failure to hide.

## Hard rules

- Never lower the 4.70 editorial threshold or bypass the publisher's guardrails.
- Never publish a page whose slug has a redirect pointing away from it — that resurrects a deliberately retired page and puts a redirecting URL in the sitemap.
- Never publish a list whose topic already has a live page (e.g. `best-history-books` when `/history` exists). It splits the topic's authority and the new page is always the thinner one.
- If a step errors, stop the pipeline there. A partial run that publishes anyway skews the site invisibly.
- Do not commit or push code as part of this run. This is a data pipeline, not a code change.