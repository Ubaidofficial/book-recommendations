# supabase
- Before writing Supabase queries, read the actual database schema — never guess column names, relationship table names, or join structures. Confidence: 0.85
- Never throw Supabase errors in public-facing pages. All queries must return safe fallbacks: `[]` for list queries, `null` for detail queries, and log errors with console.error. Homepage must always render fallback data on query failure. Confidence: 0.85
- Every Supabase query must use `.limit()` — never fetch all rows without a limit. Confidence: 0.65
- Filter null objects from all junction-table casts (`.select("books(*)"`) → `.map(r => r.books as Book).filter(b => b != null && b.id)`). Supabase can return null for broken FK joins, and the unchecked `as Type` cast produces a falsy object that crashes on property access. Confidence: 0.70

# ui
- Hide recommendation/book count badges on cards when the value is 0 or null — never render "0 recs" or "0 books". Confidence: 0.70
- Never show a book cover image that does not match the book title. Fallback data covers must match their titles, or use a neutral placeholder instead. Confidence: 0.70

# design
- Design theme: purple accent color, warm background tones, rounded cards, editorial typography style. Confidence: 0.75

# ui
- Format slug-based text for display using a reusable `displayTitle()` helper — never show raw slug text (e.g., "enid-blyton-books-in-order") in the UI. Confidence: 0.65

# editorial
- Avoid generic book-review phrases: must-read, timeless classic, compelling read, thought-provoking, seminal work, game-changer, powerful, fascinating. Use concrete, specific language instead. Confidence: 0.70
- Editorial tone for book content: calm, expert, concrete. Focus on reader fit, use-case, and tradeoffs. Prefer "This may help readers..." over hype. When data is thin, say so honestly. Confidence: 0.65
- Editorial content must target Reddit-style book discovery ICP using reader-fit language: DNF points, pacing, life-state matching, vibe tags, blunt "not for" warnings. Avoid publisher-copy, MBA-consultant, and professor/literary-critic voice. Confidence: 0.75
- Prefer reader-fit language over critic/MBA wording: use "useful if", "likely to lose you when", "best when you want", "annoying if", "better as a slow read than a skim", "this helps most when" instead of "framework", "mental model", "concept", "theory", "strategy students". Confidence: 0.75

# architecture
- Separate trust failures from style failures in editorial validation: hard reject trust issues (name/recommender/source leaks, proof/prestige claims, unsupported format claims, malformed JSON, empty response), sanitize/warn style issues (formulaic phrases, publisher hype, generic reviewer language). Style failures should prefer sanitization over retry when possible. Confidence: 0.85

# workflow
- When a Figma URL cannot be accessed, provide detailed text design specs proactively — do not ask the user for screenshots or workarounds. Confidence: 0.65
- When user says "Execute only. Do not plan.", skip reasoning/planning and go directly to implementation — no analysis commentary, just action. Confidence: 0.85
- After implementing changes, run `npx next build` and update `CHANGELOG.md` to document what changed. Confidence: 0.70

# testing
- When writing mock AI output for editorial enrichment fixture tests, pre-validate against the same banned-phrase list, word count range (55-110 words for editorial_summary), and vibe tag rules (no -hum/-vib/-emo/-int suffixes, no hype tags like mind-blowing/cult-classic-energy) before declaring results. Iterative fix cycles waste time. Confidence: 0.70

# python
- Initialize variables that are conditionally set (like score buckets and counters) unconditionally before conditional blocks, so CSV report analyzers do not crash on older reports with missing/blank columns. Confidence: 0.70

# editorial-evaluator
- Score best_for_specificity based on concrete roles (founder, product manager, teacher, parent, student, coach, manager, strategist, executive, entrepreneur), concrete situations (stuck, wrestling with, trapped, early career, inside a large company, classroom, parenting, product role), and concrete use cases (trying to decide, needs language for, wants to understand, seeking a lens). Do not score 1.5 if multiple concrete signals exist. Confidence: 0.70
- Score not_for_specificity based on DNF/skip language (skip if, DNF, likely DNF, not a manual, not a playbook), friction signals (step-by-step, evidence, repetitive, dated, dense, slow, abstract, one idea stretched), and mismatch warnings (clinical data, ideology/dogma, no practical steps). Do not score 1.5 if not_for contains concrete mismatch or DNF language. Confidence: 0.70
- For evaluator quality gates: 4.7+ => accept_candidate/dry_run_update, 4.3-4.69 => keep_pending with reason quality_below_accept_threshold, 4.0-4.29 => generated_but_weak + needs_retry if no hard trust failure (only reject if hard trust failure present), <4.0 => reject with reason quality_below_threshold. Confidence: 0.80
- For books in Health, Psychology, Science, Social Sciences, Medical, Medicine, or Neuroscience categories: before name-leak validation, reject unsupported medical/research phrases (psychedelics and mental health, psychedelic research for mental health, clinical rigor, clinical data, therapeutic context, therapeutic potential, therapy, neuroscience/scientific dive when framing as efficacy). Allow neutral framing: history and personal experience, cultural history of, skeptical readers may want more clinical distance. Reason: unsupported_medical_or_research_claim_<matched_phrase>. Confidence: 0.75

# editorial-debug
- Name-leak rejects must include the exact matched name in reject_debug_snippet. If snippet does not contain the matched name, emit reject_debug_incomplete warning. Capture snippet at detection time before cleaning/scrubbing. Confidence: 0.70
- Name-leak scanning must only check AI-generated public output fields: quick_verdict, editorial_summary, best_for, not_for, theme_tensions, key_themes, emotional_journey, reading_pace_profile, vibe_tags, discussion_potential, comparable_experience. Never scan context_recommender_names, context_list_names, source_quality_note, raw context/debug columns, or retry metadata. Confidence: 0.70

# editorial-evaluator
See [editorial-evaluator/taste.md](editorial-evaluator/taste.md)

# editorial-debug
- When multiple validators fail, report the highest-priority failure: name leak > medical/proof/format > source overclaim > structure/list > quality. Do not report theme_tensions_bad_list when unsupported format hallucination is present — format hallucination is the more useful failure to surface. Debug field/snippet must point to the actual failing field and phrase. Confidence: 0.80

# editorial-retry
- When pacing_expectation_quality <= 3.5, rewrite reading_pace_profile only. Must include: reading speed, where momentum changes, skim/slow-read advice, likely drag point. Example: "front half moves fast; middle case studies drag; skim the repeated examples after the core idea lands." Reject if it lacks these concrete signals. Confidence: 0.75
- For rows scoring 4.3–4.69, run one final polish retry focusing only on the lowest 1–2 dimensions. Keep the highest-scoring safe candidate across attempts. Do not replace a higher score with a lower one. If final score remains below 4.7, keep as generated_but_weak. Confidence: 0.75

# editorial-calibration
- Pacing evaluator: reward front half/back half, first third/middle chapters, skim advice, slow read/read in chunks, drag point, momentum changes. Penalize generic "fast-paced" only phrasing — do not score high on pacing when the only pacing signal is "fast-paced" without concrete speed/momentum/drag detail. Confidence: 0.75
- Reject "templates" only when output claims the book is/includes workbook/fill-in/downloadable/practical/step-by-step/ready-to-use templates. When "templates" appears in abstract/critical phrases (case-study templates, narrative templates, thinking templates, genre templates, tired templates), sanitize with quality_warnings += formulaic_phrase_sanitized — do not hard reject. Confidence: 0.70
- When a dry run produces 0 accept_candidate rows (all rows are generated_but_weak or rejected), interpret as quality prompt/retry needing improvement. Do not proceed to DB write until accept_candidate quality is proven. Confidence: 0.65
# workflow
- During development and code changes to the editorial enrichment script: never run --write or DB writes, always use --dry-run with --mock-ai for testing. Confidence: 0.70

# editorial-prompt
- Each best_for item must include at least 2 concrete signals: reader identity (PM, teacher, parent), life/work situation (inside a legacy company, grief season), reading mood (wants sharp argument, not academic survey), problem they are solving, or reason this book fits now. Reject generic labels like "a curious non-historian" or "someone seeking meaning." Confidence: 0.70
- Emotional journey must describe start feeling, mid-book friction, ending aftertaste, and wrong-reader emotional reaction. Reject vague summaries like "inspiring and thought-provoking" in favor of concrete arcs like "starts like a jolt, gets irritating when author's certainty hardens, ends as useful provocation or overconfident sermon." Confidence: 0.70
- Reader fit specificity requires quick_verdict and editorial_summary to answer: when is this the right book, when is this the wrong book, what makes someone bounce. Confidence: 0.70
- When evaluator returns best_for_specificity/reader_fit_specificity/emotional_fit_quality below 4.0 or not_enough_elite_specificity, trigger targeted retry that rewrites only weak fields (best_for, emotional_journey, quick_verdict, editorial_summary, not_for if needed) without touching strong fields. Do not run full retry on hard trust failure. Confidence: 0.70
- Keep compact prompt contracts (for script-loadable injection) under 1500 tokens. The contract must fit into the system prompt without blowing context budget. Confidence: 0.65

# editorial-analyzer
See [editorial-analyzer/taste.md](editorial-analyzer/taste.md)
