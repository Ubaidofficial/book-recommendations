# Directory submissions

Per-project inputs and trackers for the `directory-submissions` skill
(`.claude/skills/directory-submissions/`). The skill is project-agnostic: copy
that folder into another repo (or `~/.claude/skills/`) and start a new
`<project>/` folder here from its `templates/`.

## bookmentions/

- `profile.json` — what fits BookMentions and what does not.
- `extra_destinations.csv` — book-niche places the public catalogs miss.
- `positioning_brief.md` — draft copy; needs owner review before any submission.
- `tracker.csv` — ranked shortlist with status. Refresh with:

  ```bash
  python3 .claude/skills/directory-submissions/scripts/build_shortlist.py \
    --profile ops/directory-submissions/bookmentions/profile.json \
    --out ops/directory-submissions/bookmentions/tracker.csv
  ```

  Re-running keeps `status`, `submitted_on`, `listing_url` and `notes`.

## Filling forms with browser-use (run on your own computer)

1. In `bookmentions/tracker.csv`, set `status` to `approved` on the rows you
   want done.
2. Dry run first — fills forms, submits nothing, records nothing:

   ```bash
   export ANTHROPIC_API_KEY=...
   uv run --with browser-use python .claude/skills/directory-submissions/scripts/submit_with_browser_use.py \
     --tracker ops/directory-submissions/bookmentions/tracker.csv \
     --brief   ops/directory-submissions/bookmentions/positioning_brief.md \
     --asset   public/icon-512.png --limit 2 --dry-run
   ```

3. Drop `--dry-run` for real runs. The agent stops before each final submit;
   you review the form, click submit yourself, and answer the outcome prompt.

Sign-ins live in a dedicated Chrome profile (`~/.config/directory-submissions/chrome`)
unless you pass `--chrome-profile` or `--cdp-url`.
