# Golden Examples (v9.3)

Examples for devs and prompts to imitate or reject. No recommender names, no unsupported claims.

---

## quick_verdict

**Good (v9.2+ specificity):**
> Read when you want a short, combative startup manifesto from someone who actually built a monopoly; skip if you need evidence, nuance, or steps you can apply Monday morning.

*Why it works: right reader, wrong reader, one blunt sentence.*

**Good:**
> Read when you're questioning whether your own effort is enough — and want to be told it might be. Skip if you need tactical career advice or get annoyed by one-idea books padded to 300 pages.

**Bad:**
> This book explores the transformative power of mindset and resilience.

*Why it fails: generic, could describe ten books, no reader-fit signal.*

---

## editorial_summary

**Good:**
> Dweck walks through a single core distinction — fixed versus growth mindset — across education, sports, business, and relationships. The research examples are accessible and the central idea is genuinely useful for people who catch themselves avoiding challenges. The main limitation is repetition: the book makes its point in chapter one and then illustrates it for 200 more pages. Works best as a concept you internalize rather than a book you read cover to cover. Good if you want one clean lens to test against your own habits; frustrating if you need nuance or step-by-step help.

*Why it works: names the experience, the value, the limitation. No summary. No prestige.*

**Bad:**
> This groundbreaking work offers a powerful framework for personal and professional success through decades of rigorous research.

*Why it fails: prestige claims, generic, no limitation, publisher copy.*

---

## best_for (v9.2+ concrete situational requirement)

**Good (each includes person + situation + why now):**
- "a reader who loves big-history podcasts but wants a sharper argument to debate, not a careful academic survey"
- "someone in a grief or burnout season who wants a short, severe book about meaning without motivational softness"
- "a PM inside a legacy company trying to explain why a low-margin competitor matters before leadership takes it seriously"

*Why it works: identity + situation + why-now in each item. Not demographic labels.*

**Bad (should score <3.0 on best_for_specificity):**
- "a curious non-historian who wants a big narrative" — demographic label, no situation or why-now
- "business readers" / "fans of psychology" / "anyone interested in personal growth" — pure label
- "someone seeking meaning after hardship" — generic situation, no concrete book-fit

---

## not_for

**Good:**
- "the case studies are all from 1980s manufacturing — likely DNF point around chapter 3 if you work in software and need examples that feel current"
- "the core idea is stated clearly in chapter one; the next 200 pages are repetition — likely DNF point around chapter four"

**Good (no-format-hallucination, negated context):**
- "skip if you need hands-on exercises; this stays in explanation mode" — does not hallucinate workbook format
- "not for readers who want templates or fill-in exercises — this is pure reasoning"

**Bad:**
- "readers who prefer fiction may not enjoy this" — vague, no DNF point
- "the book is long" — true of many books

---

## emotional_journey (v9.2+ arc requirement)

**Good (start + mid + end + wrong-reader reaction):**
> Starts like a jolt of clarity, gets irritating when the author's certainty hardens, and ends either as a useful provocation or an overconfident sermon depending on whether you bought in.

**Good:**
> Starts with recognition — you see yourself in the early examples — then plateaus into repetition before leaving you with one durable mental model you'll actually use.

**Bad:**
> A powerful and emotional reading experience that leaves you inspired.

*Why the bad fails: praise without description. No arc.*

---

## medical/research claims (v9.0+)

**Good (neutral book-topic framing):**
> "the book discusses psychedelics through history and personal experience"
> "skeptical readers may want more clinical distance"
> "the author follows researchers and patients, but the book is journalism not clinical evidence"

**Bad (unsupported medical/research claim — hard reject):**
> "proves therapeutic potential for treating depression"
> "peer-reviewed evidence shows mental health benefits"
> "clinical data supports the effectiveness of psychedelic therapy"

---

## no-format-hallucination (v9.3)

**Good:**
> "skip if you want exercises; this stays conceptual" — negated, no format hallucination
> "not for readers who want a workbook" — mismatch warning, not claiming format

**Bad:**
> "this workbook includes practical exercises" — unless title explicitly says workbook
> "the guided journal format helps you apply each chapter" — unless metadata confirms format

---

## reading_pace_profile

**Good:**
> Reads fast for the first 50 pages while the concept is fresh, then becomes skippable. Best as a slow skim after the core idea lands.

**Bad:**
> Well-paced and engaging throughout.

---

## vibe_tags

**Good:** idea-dense, one-clear-lens, repetitive-but-useful, patience-demanding, discussion-heavy
**Bad:** classic-self-help, life-changing, mind-blowing, must-read, tech-bro, founder-gospel

---

## discussion_potential

**Good:** "people will argue whether the book is empowering or just repackaged individualism"
**Bad:** "excellent for book clubs and group discussion"

---

## comparable_experience

**Good:** "reads like a longer, more research-anchored version of the kind of insight you'd get from a good long-form magazine article"
**Bad:** "a classic of the genre that belongs alongside the greats"

---

## Gold-Standard Row Shape

A full excellent (4.7+) row should:

- quick_verdict: right reader + wrong reader, one blunt sentence
- editorial_summary: experience + value + limitation, 70-95 words
- best_for: three items, each with person + situation + why-now
- not_for: three mismatch/DNF warnings with specific friction mechanisms
- emotional_journey: start feeling + mid-book friction + ending aftertaste
- reading_pace_profile: physical reading signals (one sitting, chunks, slow read)
- vibe_tags: clean lowercase tags, no hype/prestige
- discussion_potential: what people will actually argue about
- comparable_experience: reading experience comparison, not status
- No medical/research overclaims, no format hallucinations, no recommender names

## Current State (v9.3)

- V9.3 validators + evaluator enforce these rules
- Prompt instructs model with v9.2+ specificity requirements
- best_for requires concrete person + situation + why-now
- emotional_journey requires start/mid/end arc
- No-format-hallucination rule: never infer workbook/journal/course format from practical content
- Medical/research claim priority for Health/Psychology/Science categories
