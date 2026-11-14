#!/usr/bin/env python3
"""
2026-11-14 SEO / quality pass on PUBLISHED pages. Dry run unless --apply.

Every change writes a row to public.bak_seo_changes_20261114 (old and new values) BEFORE the row is touched,
so each can be undone: update <table> set <old_values> where id = row_id.

 1. people (wrong or missing role/bio on published profiles). Roles/bios are short factual statements:
    James Mattis (the role came from a different person's Wikidata entry: "American bicycle racer"),
    Andrew Chen ("Taiwanese songwriter and record producer" is another person), Raoul Pal, Sahil Lavingia,
    Austen Allred, Matt D'Avella.
 2. lists: stored descriptions for Music and Entrepreneurship (built from each list's real top books), and
    the three published lists far below the 20-distinct-recommender publish gate (Gardening 1, Coffee Table 5,
    Dog Training 6; none had any Google impressions in 90 days) set to index_status='noindex', the same
    treatment the 2026-11-05 audit gave weaker duplicate lists.
 3. books: reader notes (editorial_summary, best_for, not_for, key_themes, difficulty) for the 14 most
    recommended published books that had none, written with AI help and stored with ai_quality_status='draft', so
    the page shows them under the fixed label "Draft reader notes, written with AI help and not yet reviewed
    by an editor". They use general knowledge of well-known books and make no claim about who recommends them.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone

import requests

BASE = "https://ghpdpvatfmvsahzsqgpp.supabase.co/rest/v1"
H = {"apikey": "dummy", "Authorization": "Bearer dummy", "Content-Type": "application/json"}
BATCH = "seo_quality_20261114"

PEOPLE = {
    "james-mattis": {
        "role": "Retired U.S. Marine Corps general; 26th U.S. Secretary of Defense",
        "bio": "James Mattis is a retired United States Marine Corps general who served as the 26th United States Secretary of Defense.",
    },
    "andrew-chen": {
        "role": "General partner at Andreessen Horowitz; author of The Cold Start Problem",
        "bio": "Andrew Chen is a general partner at the venture capital firm Andreessen Horowitz and the author of The Cold Start Problem, a book about launching network-effect products.",
    },
    "raoul-pal": {
        "role": "Macro investor; co-founder of Real Vision",
        "bio": "Raoul Pal is a macro investor and a co-founder of Real Vision, a financial media company.",
    },
    "sahil-lavingia": {
        "bio": "Sahil Lavingia is the founder and CEO of Gumroad, a platform that lets creators sell their work directly to their audience.",
    },
    "austen-allred": {
        "role": "Co-founder of BloomTech (formerly Lambda School)",
        "bio": "Austen Allred is a co-founder of BloomTech, formerly Lambda School, an online technology training company.",
    },
    "matt-davella": {
        "role": "Filmmaker and YouTuber",
        "bio": "Matt D’Avella is a filmmaker and YouTuber known for his videos on minimalism, habits and intentional living.",
    },
}

LISTS_DESCRIPTION = {
    "entrepreneurship": "Entrepreneurship books most recommended by the founders and investors we track, led by Zero to One, The Hard Thing About Hard Things and The Lean Startup.",
    "music": "Music books recommended by the people we track, from memoirs to music writing, led by Just Kids, The Art of Asking and Me.",
}
LISTS_NOINDEX = ["best-gardening-books", "best-coffee-table-books", "best-dog-training-books"]


def B(summary, best_for, not_for, themes, difficulty):
    return {"editorial_summary": summary, "best_for": json.dumps(best_for, ensure_ascii=False), "not_for": json.dumps(not_for, ensure_ascii=False),
            "key_themes": themes, "difficulty_level": difficulty}


BOOKS = {
    "how-to-win-friends-and-influence-people-dale-carnegie": B(
        "Dale Carnegie's 1936 self-help classic is a practical guide to dealing with people. Short chapters and anecdotes build around a few principles: take a genuine interest in others, avoid criticism and argument, give honest appreciation, and let people feel an idea is their own. The advice is simple, and its staying power comes from how readily it can be tried the same day.",
        ["A new manager who wants everyday habits for building trust with a team without relying on authority.", "A salesperson or founder who feels awkward networking and wants low-pressure ways to start conversations.", "Anyone who tends to win arguments but lose relationships and wants a different default."],
        ["Readers who want research-backed psychology; the book teaches through anecdotes rather than studies.", "Anyone put off by its 1930s examples and its sometimes dated, transactional tone."],
        ["listening and genuine interest", "avoiding criticism and argument", "honest appreciation", "persuading without pressure"], "easy"),
    "snow-crash-neal-stephenson": B(
        "Neal Stephenson's 1992 cyberpunk novel follows Hiro Protagonist, a hacker and pizza-delivery driver, through a near-future America divided into corporate franchises and a virtual world called the Metaverse. A fast, darkly funny thriller, it also plays with ideas about language, religion and computer viruses, and it helped popularise the word 'avatar' in its modern, online sense.",
        ["A software engineer who wants a funny, idea-heavy novel that anticipated virtual worlds and online identity.", "A science fiction reader new to cyberpunk who wants a fast plot with a lot of invention.", "Anyone curious where today's talk of the 'metaverse' came from."],
        ["Readers who dislike digressions; the middle stops for long explanations of Sumerian myth and linguistics.", "Anyone who wants a restrained, realistic near future rather than satire and exaggeration."],
        ["virtual worlds and identity", "language as code", "corporate power and fragmentation", "satire of technology"], "medium"),
    "siddhartha-hermann-hesse": B(
        "Hermann Hesse's 1922 novel tells of Siddhartha, a young man in ancient India who leaves his family to search for enlightenment. He tries asceticism, then pleasure and wealth, and finally learns from a ferryman and a river. A short, lyrical book, it presents wisdom as something found through lived experience rather than taught by doctrine.",
        ["A reader in a transition who wants a short, reflective novel about searching for meaning.", "Someone curious about Eastern spiritual ideas who prefers story to philosophy treatises.", "A student looking for a classic that can be read in an afternoon."],
        ["Readers who want a historical account of Buddhism; the Buddha appears only briefly and the book is not a faithful portrait.", "Anyone who needs plot and tension; much of it is spare and meditative."],
        ["searching versus experiencing", "the limits of teaching", "time and the river", "self-knowledge"], "easy"),
    "the-psychology-of-money-morgan-housel": B(
        "Morgan Housel's 2020 book argues that how people behave with money matters more than how much they know about it. Through short stories on luck, risk, saving, compounding and 'enough', he shows how different experiences lead sensible people to very different financial choices. It offers few formulas and many reminders about humility and long-term thinking.",
        ["Someone early in their career who wants money habits without a spreadsheet-heavy textbook.", "An investor who keeps reacting to market news and wants a calmer long-term mindset.", "A reader who finds personal-finance books dry and prefers short, story-driven chapters."],
        ["Readers wanting step-by-step instructions on budgets, tax or portfolio construction.", "Anyone looking for original research; it is essays and anecdotes more than data."],
        ["behaviour over knowledge", "luck and risk", "compounding and patience", "knowing what is enough"], "easy"),
    "factfulness-hans-rosling": B(
        "Hans Rosling, with Ola Rosling and Anna Rosling Rönnlund, argues that most people hold an outdated, too-negative picture of global development. The book names ten instincts, such as the gap, negativity and urgency instincts, that distort how we read news and statistics, and offers rules of thumb for checking them against data. It is optimistic without claiming that problems are solved.",
        ["A journalist, teacher or analyst who wants simple habits for reading statistics more carefully.", "Anyone who suspects their view of the world comes mostly from the news.", "A reader who likes data stories told with humour and personal anecdotes."],
        ["Readers who want a deep treatment of any single issue; it covers a lot of ground quickly.", "Anyone who prefers a more pessimistic reading of global trends; the book's optimism is a deliberate thesis."],
        ["ten misleading instincts", "global development in data", "reading statistics critically", "fact-based optimism"], "easy"),
    "how-to-change-your-mind-michael-pollan": B(
        "Michael Pollan's 2018 book explores the history and science of psychedelics, including psilocybin and LSD, and the renewed research into their use for depression, addiction and anxiety at the end of life. He mixes reporting on scientists and therapists with his own guided experiences. It is a balanced, curious introduction rather than an advocacy tract or a how-to.",
        ["A curious reader who wants a careful, journalistic overview of psychedelic research.", "Someone interested in consciousness and the self who is not a scientist.", "A skeptic who wants to understand why researchers took the subject up again."],
        ["Readers looking for practical guidance on using psychedelics; this is not a manual.", "Anyone who wants only the clinical evidence; much of it is personal narrative and history."],
        ["psychedelic research renaissance", "the default-mode network and the self", "mental health treatment", "a writer's first-person inquiry"], "medium"),
    "the-power-of-habit-charles-duhigg": B(
        "Charles Duhigg's 2012 book explains how habits form around a loop of cue, routine and reward, and how they can be changed. Using case studies from companies, sports teams and social movements, he shows that some 'keystone' habits reshape other behaviour. It is a readable introduction built on stories, so its claims are best treated as accessible summaries of research.",
        ["A manager interested in how routines shape team and company culture.", "Someone trying to change one stubborn habit who wants a simple model to start from.", "A general reader who likes narrative nonfiction with a business angle."],
        ["Readers wanting a rigorous review of the habit-formation literature.", "Anyone who finds case-study storytelling padded and prefers a short framework."],
        ["the habit loop", "keystone habits", "changing routines", "habits in organisations"], "easy"),
    "the-7-habits-of-highly-effective-people-stephen-r-covey": B(
        "Stephen R. Covey's 1989 book presents a principle-centred approach to personal and professional effectiveness, organised as seven habits: be proactive, begin with the end in mind, put first things first, think win-win, seek first to understand, synergise, and sharpen the saw. It moves from independence to working well with others, and has become a standard reference in management training.",
        ["A professional who wants a durable framework for priorities rather than a list of tactics.", "A team leader building a shared vocabulary for working together.", "Someone who likes reflective exercises such as writing a personal mission statement."],
        ["Readers who dislike a self-help tone or heavy use of diagrams and named frameworks.", "Anyone looking for evidence-based research; the book is a values-driven framework."],
        ["proactivity", "prioritisation", "win-win thinking", "empathic listening"], "medium"),
    "think-and-grow-rich-napoleon-hill": B(
        "Napoleon Hill's 1937 book distils a success philosophy into thirteen principles, including definite purpose, persistence, faith in one's goals and a 'mastermind' group. It is told through anecdotes about famous businessmen rather than data, so many readers treat it as motivational rather than as evidence about wealth. It remains one of the best-known self-help titles of the twentieth century.",
        ["A reader who wants the original source of many modern ideas in goal-setting and mastermind groups.", "Someone who responds to motivational writing and wants a push to define a clear aim.", "A student of self-help history who wants the book behind much later work."],
        ["Readers who want empirical evidence; its claims rest on anecdote and have been widely criticised.", "Anyone put off by the book's mystical language about thought and desire."],
        ["definite purpose", "persistence", "the mastermind principle", "the power of belief"], "easy"),
    "when-breath-becomes-air-paul-kalanithi": B(
        "Paul Kalanithi was a neurosurgery resident when he was diagnosed with advanced lung cancer at 36. His memoir moves between his path to medicine, the doctor's side of death and the patient's side of it, and the question of what makes a life meaningful. He died in 2015 before finishing it, and his wife, Lucy Kalanithi, wrote the epilogue.",
        ["A reader facing illness or loss who wants an honest, unsentimental voice on mortality.", "A medical student or clinician curious about what it is like to move from doctor to patient.", "Anyone who likes short memoirs that mix literature and medicine."],
        ["Readers who want to avoid a book about terminal illness; it is moving and often sad.", "Anyone wanting a complete memoir; it is unfinished and brief."],
        ["mortality and meaning", "doctor and patient", "literature and medicine", "legacy and family"], "easy"),
    "the-art-of-war-sun-tzu": B(
        "The Art of War is an ancient Chinese treatise on strategy, traditionally attributed to Sun Tzu, in thirteen short chapters. It stresses preparation, knowing yourself and your opponent, deception, speed, and winning without fighting when possible. Though written about warfare, its brief, aphoristic style has made it a source of ideas for business, negotiation and sport.",
        ["A strategist or manager who wants a very short text on competition, planning and timing.", "A reader of classics curious about early Chinese thought on conflict.", "Someone who likes aphorisms to think with rather than a step-by-step method."],
        ["Readers looking for a detailed account of ancient warfare; it is terse and abstract.", "Anyone who dislikes business books that quote it out of context; the text is often applied loosely."],
        ["preparation and planning", "know yourself and the opponent", "deception and adaptability", "winning without fighting"], "medium"),
    "the-courage-to-be-disliked-ichiro-kishimi": B(
        "Ichiro Kishimi and Fumitake Koga present the ideas of the psychologist Alfred Adler as a dialogue between a philosopher and a sceptical young man. It argues that we are shaped less by past trauma than by the goals we choose, that happiness depends on separating our tasks from other people's, and that a sense of community matters. First published in Japan, it was a bestseller there before reaching English readers.",
        ["A reader stuck in people-pleasing who wants a framework for setting boundaries.", "Someone who finds a conversational, Socratic format easier than a textbook.", "Anyone interested in Adlerian psychology as an alternative to Freud."],
        ["Readers who want a balanced critique of Adler; the book argues one side and gives it a persuasive voice.", "Anyone who dislikes repetition; the dialogue circles back to its main ideas."],
        ["the separation of tasks", "goals over past causes", "freedom and responsibility", "community feeling"], "medium"),
    "guns-germs-and-steel-jared-diamond": B(
        "Jared Diamond's 1997 book asks why some societies came to dominate others, and argues the answer lies in geography and environment, such as the availability of domesticable plants and animals, rather than in any difference between peoples. It won the Pulitzer Prize for general nonfiction. Its sweeping thesis has also been widely debated, with critics questioning how far it explains history.",
        ["A reader wanting a big-picture explanation of world history built on geography and ecology.", "Someone interested in the origins of agriculture, disease and technology.", "A student looking for a famous argument to test against its critics."],
        ["Readers who want a balanced account; the book gives one thesis and is often accused of environmental determinism.", "Anyone seeking detailed history of particular civilisations."],
        ["geography and history", "agriculture and domestication", "disease and conquest", "the environmental determinism debate"], "medium"),
    "anna-karenina-leo-tolstoy": B(
        "Leo Tolstoy's novel, serialised in the 1870s, follows Anna Karenina, a married aristocrat whose affair with Count Vronsky brings her into conflict with Russian society, alongside the parallel story of the landowner Levin and his search for meaning in marriage, work and faith. Its famous opening line about happy and unhappy families sets up a panoramic study of love, duty and hypocrisy.",
        ["A reader ready for a long, absorbing nineteenth-century novel with deep psychological detail.", "Someone who wants to see how a classic handles marriage, jealousy and moral judgement.", "A reader who likes two plots in contrast, one tragic and one searching."],
        ["Readers short on time or patience; it is long, with extended passages on farming, politics and philosophy.", "Anyone who wants fast plotting; the pacing is deliberate."],
        ["love and duty", "family and society", "jealousy and moral judgement", "the search for meaning"], "hard"),
}


def get(table, params):
    r = requests.get(f"{BASE}/{table}", headers=H, params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def change(table, slug, new, apply, stats):
    cols = ",".join(["id", "slug", *new.keys()])
    rows = get(table, {"select": cols, "slug": f"eq.{slug}"})
    if not rows:
        stats["missing"] += 1
        print("  missing:", table, slug)
        return
    row = rows[0]
    old = {k: row.get(k) for k in new}
    if all(old[k] == new[k] for k in new):
        stats["unchanged"] += 1
        return
    stats["would_change"] += 1
    if not apply:
        return
    b = requests.post(f"{BASE}/bak_seo_changes_20261114", headers={**H, "Prefer": "return=minimal"}, timeout=60,
                      json={"table_name": table, "row_id": row["id"], "slug": slug, "old_values": old, "new_values": new, "batch": BATCH})
    if b.status_code not in (200, 201):
        stats["backup_failed"] += 1
        print("  BACKUP FAILED, not changing", slug, b.status_code, b.text[:150])
        return
    u = requests.patch(f"{BASE}/{table}", params={"id": f"eq.{row['id']}"}, headers={**H, "Prefer": "return=minimal"}, json=new, timeout=60)
    if u.status_code not in (200, 204):
        stats["update_failed"] += 1
        print("  UPDATE FAILED", slug, u.status_code, u.text[:150])
        return
    stats["changed"] += 1


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    now = datetime.now(timezone.utc).isoformat()
    stats = {k: __import__("collections").Counter() for k in ("people", "lists", "books")}
    for slug, new in PEOPLE.items():
        change("people", slug, new, args.apply, stats["people"])
    for slug, desc in LISTS_DESCRIPTION.items():
        assert len(desc) <= 160 and len(desc) >= 30, (slug, len(desc))
        change("lists", slug, {"description": desc}, args.apply, stats["lists"])
    for slug in LISTS_NOINDEX:
        change("lists", slug, {"index_status": "noindex"}, args.apply, stats["lists"])
    for slug, new in BOOKS.items():
        change("books", slug, {**new, "ai_generated_at": now, "ai_quality_status": "draft"}, args.apply, stats["books"])
    print(json.dumps({"mode": "APPLY" if args.apply else "DRY RUN", **{k: dict(v) for k, v in stats.items()}}, indent=1))


if __name__ == "__main__":
    main()
