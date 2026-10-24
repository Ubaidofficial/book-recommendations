---
name: directory-submissions
description: Plan, prepare and submit a website or product to relevant directories, launch sites, communities and newsletters, for any project. Builds a ranked, resumable tracker from public submission catalogs plus the project's own niche list, writes a positioning brief with copy at every length, then fills and submits forms in a browser while the person handles logins and CAPTCHAs. Use when someone asks to list, submit or launch a site on directories, get directory backlinks, or plan distribution for a project.
---

# Directory submissions

One workflow, any project. Each project keeps its own folder of inputs and
outputs; this skill holds only the method and the script.

```
<project-folder>/            e.g. ops/directory-submissions/<slug>/
  profile.json               who the project is for and what fits (you write it)
  extra_destinations.csv     niche places the public catalogs miss (you research it)
  positioning_brief.md       source of truth for every piece of copy
  tracker.csv                ranked destinations + status, refreshed in place
```

Templates for the first three live in `templates/`. The submission rules and
browser tips are in `references/playbook.md` — read it before Phase 5.

## Ground rules (never relax these)

- **Relevance over volume.** Mass, low-quality directory submission is named
  in search engines' link-spam guidance. Aim for a reviewed list of tens, not
  hundreds. Every row submitted needs a reason it fits the project's audience.
- **The person does identity.** Never create accounts, enter passwords, solve
  CAPTCHAs, click email-verification links, or accept terms of service on the
  person's behalf. Stop, say exactly what step is needed, wait, continue.
- **Nothing paid, no reciprocal badges, no fake engagement** unless the person
  opts in for that specific site.
- **Submitting is outward-facing.** Get the person's go-ahead on the reviewed
  shortlist before the first submission, and again before any site not on it.
- **Never invent facts** in copy: no made-up user counts, ratings, founding
  dates, press, pricing or HQ. Everything comes from the brief, and the brief
  comes from the live site and the person.
- **No duplicates.** Search the site for an existing listing first; refresh or
  claim it instead of adding a second one.

## Phase 1 — Profile

Copy `templates/profile.example.json` into the project folder and fill it in
from the live site (homepage, about page, `llms.txt`/sitemap if present) and
from the person. The fields that matter most:

- `core_keywords` — words that make a destination clearly relevant (25 pts each).
- `context_keywords` — weaker signals (5 pts each).
- `exclude_terms` / `exclude_types` — what the project is *not* (e.g. "AI tool",
  "B2B", `github` awesome-lists for a non-dev product).
- `allow` — whether paid, reciprocal-badge or registry-"Skip" sites are allowed.

## Phase 2 — Niche research

The public catalogs are built for startups, SaaS, AI and dev tools. Most
projects have niche channels they miss (for a book site: book-blog
directories, reader communities, library resource lists). Search the web for
them, open each candidate's submission page, and record only places you
actually saw accept submissions in `extra_destinations.csv`, with the rules
you read in `eligibility`. Mark anything you could not open as unverified in
`registry_notes`. Never add a site from memory alone.

## Phase 3 — Build the tracker

```bash
python3 <skill-dir>/scripts/build_shortlist.py \
  --profile <project-folder>/profile.json \
  --out <project-folder>/tracker.csv \
  --excluded /tmp/excluded.csv      # optional: what was dropped and why
```

It fetches (and caches for 7 days) the Submitlist catalog
(`alvinunreal/awesome-submitlist`, CC0) and the list-my-startup registry
(`Fh-Ndiritu/list-my-startup-skill`, MIT), merges them with the project's niche
list by domain, drops exclusions, scores the rest, and writes the tracker.
Re-running refreshes the ranking and keeps every row's `status`,
`submitted_on`, `listing_url` and `notes`.

## Phase 4 — Review the shortlist with the person

The score is a keyword filter, not a judgement. Go through the tracker row by
row: read each destination's eligibility and a few existing listings (fetch
the page), then set `status` to `skip` with a one-line reason in `notes`
for anything that does not fit (wrong audience, product-type mismatch, dead,
gated in a way the person won't accept). Present the remaining rows grouped
by effort (public form / login needed / editorial pitch) and get the
person's go-ahead before Phase 5. Set `status` to `approved` on exactly the
rows they agree to; Phase 5 works only on `approved` rows.

Also write `positioning_brief.md` from `templates/positioning_brief.md` now,
and have the person confirm it — every form field is filled from it.

## Phase 5 — Submit (browser, tag-team)

Needs a browser the person can see and act in: Claude in Chrome, the Claude
desktop app's built-in browser, or Cowork. A headless browser in a cloud
container cannot hand logins or CAPTCHAs to the person, so do not attempt
submissions from one; stop after Phase 4 and say so.

Two ways to run it:

- **Scripted, with browser-use** (`scripts/submit_with_browser_use.py`). The
  person runs it on their own computer; usage is in the script's docstring.
  It opens a visible Chrome, has an agent fill each `approved` row's form
  from the brief, asks in the terminal whenever a login/CAPTCHA/missing fact
  comes up, stops before the final submit, lets the person review and click
  submit themselves, then records the outcome in the tracker. Start with
  `--dry-run` on two or three sites to check fill quality. Do not point it at
  browser-use's cloud browsers or their CAPTCHA-solving/stealth features.
- **Interactively**, with Claude in Chrome or the desktop browser, following
  the steps below.

For each approved row, in rank order:

1. Check for an existing listing (site search, `/<slug>` patterns, the
   account's "my listings" page). Found → refresh or claim it instead.
2. Open `submission_url`. Login, signup, verification or CAPTCHA → ask the
   person to do that step, wait.
3. Fill every field from the brief, cut to each field's limit, using the most
   specific category. Upload the logo/screenshots the person approved.
4. Show the person the filled form (screenshot or summary) and submit on
   their word. For a run they pre-approved as a batch, submit and report.
5. Confirm the success state, then update the row immediately: `status`
   (`submitted` / `pending-review` / `live` / `skip` / `blocked`),
   `submitted_on`, `listing_url`, `notes`.

## Phase 6 — Verify and maintain

Some days later, reopen each `submitted` / `pending-review` row: is the
listing live, in the right category, linking to the canonical URL? Update
`status` and `listing_url`. Note anything the registries got wrong (now paid,
dead, login wall) in `notes`; if the person wants, open a PR upstream to the
registry it came from.
