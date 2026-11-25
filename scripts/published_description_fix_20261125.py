#!/usr/bin/env python3
"""
2026-11-25: fix `books.description` on six PUBLISHED books found by reading all 54 published descriptions. Dry run unless --apply.

Wrong product or no content about the book:
  atomic-habits            described the companion WORKBOOK ("An interactive guide ... Guided journal prompts")
  factfulness              described a reading-group DISCUSSION GUIDE ("Readers of Factfulness ... seeking engagement")
  how-to-win-friends       read like the blurb of an unofficial summary ("Do you feel stuck in life?")
  the-fountainhead         only described the centennial edition's afterword, nothing about the novel
Joined words from the import (letters unchanged, punctuation back):
  good-to-great            "verybeginning" -> "very beginning"
  how-to-change-your-mind  "cleareyed" -> "clear-eyed"

Atomic Habits and Factfulness use Open Library's English WORK description (works/OL17930368W, works/OL17877260W;
title and author checked). How to Win Friends and The Fountainhead get short neutral descriptions written for this
site, because Open Library's text is edition marketing ("first time ever in trade paperback") or a single line.

Every change writes old and new values to public.bak_seo_changes_20261114 first (batch below); undo with
  update books set description = old_values->>'description' where id = row_id and batch = '<BATCH>'.
"""
from __future__ import annotations

import argparse
import json

import requests

BASE = "https://ghpdpvatfmvsahzsqgpp.supabase.co/rest/v1"
H = {"apikey": "dummy", "Authorization": "Bearer dummy", "Content-Type": "application/json"}
BATCH = "published_descriptions_20261125"

REPLACE = {
    "atomic-habits-james-clear": (
        "No matter your goals, Atomic Habits offers a proven framework for improving every day. James Clear, one of the "
        "world's leading experts on habit formation, reveals practical strategies that will teach you exactly how to form "
        "good habits, break bad ones, and master the tiny behaviors that lead to remarkable results."
    ),
    "factfulness-hans-rosling": (
        "Factfulness: The stress-reducing habit of only carrying opinions for which you have strong supporting facts.\r\n\r\n"
        "When asked simple questions about global trends―what percentage of the world’s population live in poverty; why the "
        "world’s population is increasing; how many girls finish school―we systematically get the answers wrong. So wrong that "
        "a chimpanzee choosing answers at random will consistently outguess teachers, journalists, Nobel laureates, and "
        "investment bankers.\r\n\r\n"
        "In Factfulness, Professor of International Health and global TED phenomenon Hans Rosling, together with his two "
        "long-time collaborators, Anna and Ola, offers a radical new explanation of why this happens. They reveal the ten "
        "instincts that distort our perspective―from our tendency to divide the world into two camps (usually some version of "
        "us and them) to the way we consume media (where fear rules) to how we perceive progress (believing that most things "
        "are getting worse).\r\n\r\n"
        "Our problem is that we don’t know what we don’t know, and even our guesses are informed by unconscious and "
        "predictable biases.\r\n\r\n"
        "It turns out that the world, for all its imperfections, is in a much better state than we might think. That doesn’t "
        "mean there aren’t real concerns. But when we worry about everything all the time instead of embracing a worldview "
        "based on facts, we can lose our ability to focus on the things that threaten us most.\r\n\r\n"
        "Inspiring and revelatory, filled with lively anecdotes and moving stories, Factfulness is an urgent and essential "
        "book that will change the way you see the world and empower you to respond to the crises and opportunities of the "
        "future."
    ),
    "how-to-win-friends-and-influence-people-dale-carnegie": (
        "Dale Carnegie's 1936 guide to getting along with people: how to make people like you, win them over to your way of "
        "thinking, and change their behaviour without giving offence or arousing resentment. Each short chapter states a "
        "principle and illustrates it with anecdotes, and the book remains one of the best-selling self-help titles ever "
        "published."
    ),
    "the-fountainhead-ayn-rand": (
        "Ayn Rand's 1943 novel follows Howard Roark, an uncompromising young architect who refuses to design buildings any "
        "way but his own, as he battles critics, rivals and a profession that prizes conformity. Through Roark and the people "
        "who oppose or exploit him, the book sets out the individualism that Rand developed further in Atlas Shrugged."
    ),
}
# (slug, exact old substring, replacement) — punctuation and spacing only.
PATCH = [
    ("good-to-great-jim-collins", "verybeginning", "very beginning"),
    ("how-to-change-your-mind-michael-pollan", "cleareyed", "clear-eyed"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    todo = {slug: ("replace", text) for slug, text in REPLACE.items()}
    todo.update({slug: ("patch", (old, new)) for slug, old, new in PATCH})
    done = 0
    for slug, (kind, payload) in todo.items():
        rows = requests.get(f"{BASE}/books", params={"select": "id,slug,description", "slug": f"eq.{slug}"}, headers=H, timeout=60).json()
        if not rows:
            print("missing:", slug)
            continue
        row = rows[0]
        old_text = row["description"] or ""
        if kind == "replace":
            text = payload
        else:
            needle, repl = payload
            if old_text.count(needle) != 1:
                print(f"{slug}: expected exactly one '{needle}', found {old_text.count(needle)}; skipped")
                continue
            text = old_text.replace(needle, repl)
        if old_text == text:
            continue
        print(f"{slug}: {kind} ({len(old_text)} -> {len(text)} chars)")
        if not args.apply:
            continue
        b = requests.post(f"{BASE}/bak_seo_changes_20261114", headers={**H, "Prefer": "return=minimal"}, timeout=60,
                          json={"table_name": "books", "row_id": row["id"], "slug": slug, "old_values": {"description": old_text},
                                "new_values": {"description": text}, "batch": BATCH})
        if b.status_code not in (200, 201):
            print("  BACKUP FAILED, not changing", slug, b.status_code, b.text[:150])
            continue
        u = requests.patch(f"{BASE}/books", params={"id": f"eq.{row['id']}"}, headers={**H, "Prefer": "return=minimal"},
                           json={"description": text}, timeout=60)
        print("  ", "updated" if u.status_code in (200, 204) else f"FAILED {u.status_code} {u.text[:120]}")
        done += u.status_code in (200, 204)
    print(json.dumps({"mode": "APPLY" if args.apply else "DRY RUN", "updated": done, "batch": BATCH}))


if __name__ == "__main__":
    main()
