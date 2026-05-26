# Style Do / Don't (v9.3)

## Voice

Write like a sharp, honest reader-fit recommender. Target the Reddit-style book discovery user.

Do NOT write like a publisher, professor, literary critic, MBA consultant, marketer, Wikipedia, or generic AI assistant.

## Preferred Phrases (v9.3+)

- "useful if…"
- "likely to lose you when…"
- "best when you want…"
- "annoying if…"
- "better as a slow read than a skim…"
- "this helps most when…"
- "the tricky part is…"
- "the useful part is…"
- "the book is strongest when…"
- "the book is weakest when…"

## Banned/Avoid Phrases (Hard Reject)

These trigger hard rejection:

Prestige/proof: classic, landmark, seminal, definitive, canonical, masterpiece, research-backed, evidence-based, proven, time-tested, decades of research, studies show, research shows, award-winning, bestseller, widely regarded, iconic, must-read, celebrated classic/work/book/author, widely celebrated.

Medical/research: well-researched, grounded in research, clinical evidence, therapeutic potential, treat depression/anxiety/addiction, mental health treatment, neuroscience proves, studies prove, research confirms, evidence shows, scientifically supported, peer-reviewed, clinical rigor, clinical data, therapeutic context, mental health, neuroscience, psychedelic research for mental health, psychedelics and mental health.

Generic copy: readers gain, readers come away, the book explores, the book examines, compelling look, powerful meditation, masterful account, mental toolbox, rigorous architecture, durable framework, paradigm shift, rich tapestry, sweeping narrative, timely reminder.

## Low-Risk Style (Sanitize/Warn, Don't Reject)

- "fans of" → sanitize to "readers who like"
- "sweeping assertions/claims/generalizations" → sanitize to "broad, forceful claims" / "broad claims"
- "compelling" → sanitize to "strong"
- "powerful" → sanitize to "direct"
- "thought-provoking" → sanitize to "discussion-friendly"
- "intellectually stimulating" → sanitize to "idea-heavy"
- "main value is" → sanitize to "useful part is"
- "case-study templates", "thinking templates", "narrative templates" → warn formulaic_phrase_sanitized, do not reject

## best_for Specificity Rules (v9.2+)

Each best_for item must include at least 2 of:
- Concrete reader identity
- Concrete life/work situation
- Concrete reading mood
- Concrete problem they are trying to solve
- Concrete reason this book fits now

**Weak (reject-level):**
- "a curious non-historian who wants a big narrative" — demographic label, no situation
- "business readers" — pure demographic label
- "someone seeking meaning after hardship" — generic, no situation or why-now
- "a product manager interested in innovation" — generic role

**Strong:**
- "a reader who loves big-history podcasts but wants a sharper argument to debate, not a careful academic survey" — identity + mood + situation
- "someone in a grief or burnout season who wants a short, severe book about meaning without motivational softness" — life-state + mood + book-fit
- "a PM inside a legacy company trying to explain why a low-margin competitor matters before leadership takes it seriously" — identity + situation + why-now

## not_for Specificity Rules

Each not_for item should name a specific friction mechanism and a likely DNF point. Be blunt.

**Weak:**
- "readers who want a how-to guide" — no friction, no DNF point
- "the book is long" — true of many books
- "some concepts may be challenging" — could describe anything

**Strong:**
- "the case studies are all from 1980s manufacturing — likely DNF point around chapter 3 if you work in software and need examples that feel current" — specific friction + timeline
- "skip if you need hands-on exercises; this stays in explanation mode" — concrete mismatch, no format hallucination
- "the repetition becomes grating around page 200 if you already understood the idea in chapter one" — specific DNF point with friction mechanism

## emotional_journey Rules (v9.2+)

Must include: start feeling, mid-book friction, ending aftertaste, and wrong-reader emotional reaction.

**Weak:** "engaging and thought-provoking", "inspiring and emotional"
**Strong:** "starts like a jolt of clarity, gets irritating when the author's certainty hardens, and ends either as a useful provocation or an overconfident sermon depending on whether you bought in"

## reading_pace_profile Rules

Must include concrete physical reading signals: one sitting, read in chunks, dense, skimmable, early chapters are the hurdle, back half loses momentum, front-loaded, drags.

**Weak:** "well-paced and engaging"
**Strong:** "reads fast for the first 50 pages while the concept is fresh, then becomes skippable. Best as a slow skim after the core idea lands"

## No-Format-Hallucination Rule (v9.3)

Do not call a book: workbook, journal, companion, planner, course, templates, or exercise book UNLESS the title or metadata explicitly says so. Never infer workbook format from practical content. If the reader wants exercises but the book is not a workbook, say it lacks exercises.

**Good:** "skip if you want exercises; this stays conceptual"  
**Bad:** "this workbook includes practical exercises" (unless title says workbook)

## Medical/Research Claims Rule (v9.0+)

Do not claim medical, therapeutic, clinical, or scientific efficacy unless safe facts explicitly support it. You may say a book discusses psychedelic therapy or reports on research — but never claim the book proves efficacy or provides clinical evidence.

**Good:** "the book discusses psychedelics through history and personal experience"  
**Bad:** "proves therapeutic potential" or "peer-reviewed evidence shows mental health benefits"

## Current State (v9.3)

- Prompt instructs model with v9.2+ reader-fit specificity requirements
- Low-risk style phrases are sanitized, not hard-rejected
- Medical/research claims are hard-rejected before name-leak for sensitive categories
- No-format-hallucination rule enforced in prompt and targeted retry
- Evaluator scores specificity dimensions 1-5; best_for and not_for specificity drive keep_pending / needs_retry decisions
