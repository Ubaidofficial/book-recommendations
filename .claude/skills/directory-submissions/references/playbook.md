# Submission playbook

Practical notes for Phase 5. Several come from the list-my-startup skill
(`Fh-Ndiritu/list-my-startup-skill`, MIT), reworded here.

## Before opening a form

- Read the row's `registry_recommendation` and `registry_notes`. `Blocked:` and
  `Conditional:` rows say what gate to expect (login wall, work email, HQ
  country, text CAPTCHA); tell the person up front.
- Product vs organisation: list the product/site as its own entry on product
  directories; use the company identity only on company-profile platforms
  (Crunchbase org, LinkedIn page, F6S company). Never overwrite a different
  product already held by the same vendor account.

## Filling fields

- Keep the brief's copy blocks for each common length (≈60, ≈160, ≈300, ≈500
  characters, and a long description) and trim rather than rewrite, so
  listings stay consistent but not identical. Adjust the opening line to the
  directory's audience.
- Use the canonical URL (with `https://`, no tracking parameters) unless the
  person asks for UTM-tagged links to measure referrals.
- Native `<select>`: set the value through the form tool so `change` fires,
  not by clicking coordinates.
- Logo: if none is supplied, the site's own `apple-touch-icon.png` is usually a
  clean square; open it in a tab, scale it up on a white background and
  screenshot it, rather than exporting through a canvas (cross-origin images
  taint the canvas).
- Screenshots: capture the live site (hero, a typical page). If the directory
  demands a minimum size larger than the browser's screenshot limit, ask the
  person for real files.
- Some standalone form builders (e.g. Tally) keep a draft in localStorage, so a
  closed tab is recoverable.

## Things to stop on

- A field asking to accept terms, confirm ownership or certify something — the
  person confirms.
- Any payment step, "featured" upsell defaulted on, or "add our badge to your
  site" requirement — leave it, mark the row `skip` with the reason, unless the
  person opted in.
- A form that wants facts the brief does not have (revenue, team size, launch
  date) — ask, or leave optional fields blank. Do not guess.

## Communities, subreddits and newsletters

These are not forms. Read the rules (and for subreddits, the promotion route
the catalog lists: direct post, weekly thread, or comments only). Draft the
post for the person to review; post only on their word, from their account,
and only where self-promotion is allowed. Newsletters are pitches: draft a
short, specific email and let the person send it.

## Unattended runs

Browser extensions only act on domains approved earlier. With nobody present
to approve, new domains are refused. Either pre-approve the target domains or
run attended; if refused, log the row as `blocked` with "site permission
needed" and keep the drafted copy in `notes`.
