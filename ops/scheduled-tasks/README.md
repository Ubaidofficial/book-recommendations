# Scheduled task definitions

Mirrors of the two automations that run this site's publishing pipeline.

## Why they are duplicated here

The live copies live in `~/.claude/scheduled-tasks/<id>/SKILL.md` on one
laptop. Nothing about them was version-controlled, reviewable in a diff, or
recoverable if that machine went away — despite the fact that between them
they encode the rules that keep the site from degrading:

- the **4.70/5** editorial accept floor, and the instruction never to lower it
- the ordering constraint that enrichment MUST precede publishing, or the
  candidate pool drains and the publisher silently stops
- the guardrails against resurrecting retired pages, creating duplicate
  topics, and publishing lists with fewer than 20 distinct recommenders
- the reviewer's read-only rule

Those are decisions with reasons behind them. They belong in the repository
where they can be read, argued with, and restored.

## Important: these are copies, not the source

Editing a file here does **not** change the running task. To change behaviour,
update the task itself (`update_scheduled_task`, or the Scheduled panel in the
sidebar) and then refresh the copy here so the two do not drift.

| file | task id | schedule | writes? |
|---|---|---|---|
| `daily-pipeline.md` | `bookmentions-daily-pipeline` | 13:00 Madrid daily | yes — enriches, then publishes |
| `pipeline-reviewer.md` | `bookmentions-pipeline-reviewer` | 15:00 Madrid daily | no — writes one report file, nothing else |

The split is deliberate: one agent acts under hard guardrails, one observes and
proposes but cannot act. Recommendations from the reviewer require human
approval before anything is changed.

Both run only while Claude Code is open. If the machine is asleep at the
scheduled time, the run happens at next launch rather than being skipped.
