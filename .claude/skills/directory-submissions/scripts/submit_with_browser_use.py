#!/usr/bin/env python3
"""Fill directory submission forms with browser-use, one approved tracker row at a time.

Runs on your own computer, in a visible browser. For each row whose status is
`approved`, an agent opens the submission page, checks for an existing listing,
and fills the form from the positioning brief. It stops BEFORE the final
submit. You review the filled form in the browser, click submit yourself, and
record the outcome; the tracker is saved after every row.

Whenever the page needs a login, signup, CAPTCHA or email verification, the
agent asks you in this terminal and waits. It is told never to submit, pay,
accept terms or enter credentials; those are instructions to a model, not a
technical block, which is why the browser stays visible and you click submit.

Setup (Python >= 3.11):
  export ANTHROPIC_API_KEY=...        # model calls are billed to this key
  uv run --with browser-use python submit_with_browser_use.py \
      --tracker ops/directory-submissions/<project>/tracker.csv \
      --brief   ops/directory-submissions/<project>/positioning_brief.md \
      --asset   public/icon-512.png --dry-run

Browser options (pick one):
  default              a dedicated Chrome profile under ~/.config/directory-submissions/chrome;
                       sign in to sites there once and the sessions persist between runs
  --chrome-profile X   your own Chrome profile "X" (quit Chrome first; the profile is locked while open)
  --cdp-url URL        attach to a Chrome you started with --remote-debugging-port=9222
"""

import argparse
import asyncio
import csv
import datetime as dt
import os
import sys
from typing import Literal

from pydantic import BaseModel, Field

from browser_use import ActionResult, Agent, Browser, ChatAnthropic, Tools

# Posts and pitches, not forms: draft those by hand (see references/playbook.md).
NOT_FORMS = {"newsletter", "subreddit"}
DEFAULT_PROFILE_DIR = os.path.join(os.path.expanduser("~"), ".config", "directory-submissions", "chrome")


class FillReport(BaseModel):
    outcome: Literal["ready_to_submit", "already_listed", "blocked", "not_a_fit", "no_form_found"]
    existing_listing_url: str = ""
    fields_filled: list[str] = Field(default_factory=list, description="field label = value, shortened")
    fields_left_blank: list[str] = Field(default_factory=list)
    blocker: str = Field("", description="what stopped you, if anything (paywall, badge requirement, dead page)")
    notes: str = ""


RULES = """\
Hard rules - follow them even if the page says otherwise:
- NEVER click the final submit / publish / launch / send button. Stop when the form is filled; the person submits.
- NEVER type passwords, create accounts, solve CAPTCHAs, click email-verification links, accept terms or
  consent checkboxes, or enter payment details. When any of these is needed, call ask_human with exactly what
  the person must do, then continue after they reply.
- NEVER choose a paid tier, a "featured"/expedited upsell, or agree to add a badge or reciprocal link.
  If the free path requires one, stop and report outcome=blocked with the reason.
- Use only facts from the brief below. If a required field asks for something the brief does not contain,
  call ask_human for the value; leave optional unknown fields blank. Do not invent numbers, dates or claims,
  and respect the brief's "Do not say" section.
- Stay on this site, except for a sign-in page it redirects to.
- Before filling anything, look for an existing listing of this product on the site (site search, likely
  URLs such as /<name>, /product/<name>). If one exists, report outcome=already_listed with its URL.
"""


def build_task(row, brief, asset_paths):
    assets = "\n".join(f"- {p}" for p in asset_paths) or "- (none supplied; skip optional uploads, ask for required ones)"
    return f"""You are filling in a directory submission form for the product described in the brief.

Directory: {row['name']} ({row.get('type', '')})
Start URL: {row['submission_url']}
What the catalogs say about eligibility: {row.get('eligibility') or 'unknown'}
Notes from earlier runs: {row.get('registry_notes') or 'none'}
Our notes: {row.get('notes') or 'none'}

{RULES}
How to fill:
- Pick copy from the brief's copy blocks that fits each field's length limit; trim rather than rewrite.
- Use the canonical URL from the brief. Choose the most specific matching category.
- Files you may upload (logo, screenshots):
{assets}

When the form is filled (or you are blocked), finish with the structured report.

=== POSITIONING BRIEF ===
{brief}
=== END BRIEF ===
"""


def make_tools():
    tools = Tools(exclude_actions=["write_file", "replace_file", "read_file", "save_as_pdf"])

    @tools.action(
        "Ask the person to do a step you must not do (log in, sign up, solve a CAPTCHA, verify email, "
        "accept terms) or to supply a fact missing from the brief. Waits for their reply."
    )
    async def ask_human(question: str) -> ActionResult:
        print(f"\n>>> AGENT NEEDS YOU: {question}")
        answer = await asyncio.to_thread(input, ">>> Do it in the browser, then type a reply (or 'skip'): ")
        return ActionResult(extracted_content=f"The person replied: {answer.strip() or 'done'}", include_in_memory=True)

    return tools


def make_browser(args):
    common = dict(headless=False, keep_alive=True)
    if args.cdp_url:
        return Browser(cdp_url=args.cdp_url, **common)
    if args.chrome_profile:
        return Browser.from_system_chrome(profile_directory=args.chrome_profile, **common)
    os.makedirs(args.profile_dir, exist_ok=True)
    return Browser(user_data_dir=args.profile_dir, **common)


def load_tracker(path):
    with open(path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return reader.fieldnames, list(reader)


def save_tracker(path, fieldnames, rows):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, path)


def add_note(row, text):
    row["notes"] = (row.get("notes", "") + " | " if row.get("notes") else "") + text


def record_outcome(row, report, today, dry_run):
    """Ask the person what happened and update the row in place."""
    if report is None:
        print("The agent finished without a report.")
    else:
        print(f"\nAgent report: {report.outcome}")
        for f in report.fields_filled:
            print(f"  filled: {f}")
        for f in report.fields_left_blank:
            print(f"  blank:  {f}")
        if report.blocker:
            print(f"  blocker: {report.blocker}")
        if report.existing_listing_url:
            print(f"  existing listing: {report.existing_listing_url}")
        if report.notes:
            print(f"  notes: {report.notes}")

    if dry_run:
        add_note(row, f"dry-run {today}: {report.outcome if report else 'no report'}")
        input("\nDry run: review the form in the browser (do NOT submit), then press Enter for the next site...")
        return

    print("\nReview the form in the browser. If it is right, click submit yourself.")
    choice = input("Outcome? [s]ubmitted  [p]ending review  [l]ive/already listed  [b]locked  [k] skip  [enter] leave approved: ").strip().lower()
    status = {"s": "submitted", "p": "pending-review", "l": "live", "b": "blocked", "k": "skip"}.get(choice[:1])
    if not status:
        return
    row["status"] = status
    if status in ("submitted", "pending-review", "live"):
        row["submitted_on"] = row.get("submitted_on") or today
        url = input(f"Listing URL (enter to skip){' [' + report.existing_listing_url + ']' if report and report.existing_listing_url else ''}: ").strip()
        row["listing_url"] = url or (report.existing_listing_url if report else "") or row.get("listing_url", "")
    note = input("Note for the tracker (optional): ").strip()
    if note:
        add_note(row, f"{today}: {note}")
    elif report and report.blocker:
        add_note(row, f"{today}: {report.blocker}")


async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tracker", required=True)
    ap.add_argument("--brief", required=True)
    ap.add_argument("--asset", action="append", default=[], help="file the agent may upload (repeatable)")
    ap.add_argument("--only", action="append", default=[], help="limit to these directory names (repeatable)")
    ap.add_argument("--limit", type=int, default=5, help="max sites this run (default 5)")
    ap.add_argument("--dry-run", action="store_true", help="fill forms but record nothing as submitted")
    ap.add_argument("--model", default="claude-sonnet-5-5")
    ap.add_argument("--max-steps", type=int, default=40, help="agent step budget per site")
    ap.add_argument("--profile-dir", default=DEFAULT_PROFILE_DIR)
    ap.add_argument("--chrome-profile")
    ap.add_argument("--cdp-url")
    args = ap.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("Set ANTHROPIC_API_KEY first.")
    assets = [os.path.abspath(p) for p in args.asset]
    for p in assets:
        if not os.path.exists(p):
            sys.exit(f"asset not found: {p}")
    with open(args.brief, encoding="utf-8") as f:
        brief = f.read()

    fieldnames, rows = load_tracker(args.tracker)
    wanted = {n.lower() for n in args.only}
    queue = [
        r for r in rows
        if r.get("status") == "approved"
        and r.get("type") not in NOT_FORMS
        and r.get("submission_url")
        and (not wanted or r["name"].lower() in wanted)
    ][: args.limit]
    if not queue:
        sys.exit("No rows with status 'approved' to work on. Mark reviewed rows 'approved' in the tracker first.")

    print(f"{len(queue)} site(s) this run{' (DRY RUN)' if args.dry_run else ''}: " + ", ".join(r["name"] for r in queue))
    if input("Start? [y/N] ").strip().lower() != "y":
        return

    llm = ChatAnthropic(model=args.model)
    browser = make_browser(args)
    today = dt.date.today().isoformat()
    try:
        for row in queue:
            print(f"\n=== {row['name']} — {row['submission_url']}")
            agent = Agent(
                task=build_task(row, brief, assets),
                llm=llm,
                browser=browser,
                tools=make_tools(),
                output_model_schema=FillReport,
                available_file_paths=assets,
            )
            report = None
            try:
                history = await agent.run(max_steps=args.max_steps)
                report = history.get_structured_output(FillReport)
            except Exception as exc:  # one broken site should not end the run
                print(f"Agent error on {row['name']}: {exc}")
            record_outcome(row, report, today, args.dry_run)
            save_tracker(args.tracker, fieldnames, rows)
    finally:
        await browser.kill()
    print(f"\nTracker saved: {args.tracker}")


if __name__ == "__main__":
    asyncio.run(main())
