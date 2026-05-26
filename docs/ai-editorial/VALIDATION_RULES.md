# Validation Rules (v9.3)

## Philosophy

- Reject more. A blank/pending page is better than generic AI output.
- Separate trust failures from style failures.
- Hard reject: recommender/source/name leaks, unsupported proof/prestige, unsupported medical/research, unsupported format claims, malformed JSON, empty response.
- Sanitize/warn: low-risk style issues (generic phrases, formulaic language).
- Quality-evaluate: passing rows that are still too generic get scored, flagged, and may be marked keep_pending or needs_retry.

## Hard Rejects (Trust/Safety)

### unsafe_prompt_contains_recommender_name
A recommender name was detected in the final prompt sent to the AI provider. The call is blocked before reaching the model.

### public_recommender_name_leak_\<name\>_\<field\> (v9.1+)
A recommender name appeared in a verified public field. **Only reported when the exact name is confirmed in the captured snippet at detection time.** Fields scanned: quick_verdict, editorial_summary, best_for, not_for, theme_tensions, emotional_journey, reading_pace_profile, vibe_tags, discussion_potential, comparable_experience. Context fields (context_recommender_names, context_list_names, source_quality_note) are never scanned.

### possible_public_recommender_name_leak_debug_mismatch_\<field\> (v9.1+)
A recommender name was detected but the snippet cannot be verified. Downgraded to debug-mismatch status. `reject_debug_source=debug_mismatch`. Warning: `possible_name_leak_debug_mismatch`. Do not treat as confirmed leak without snippet proof.

### unsupported_proof_or_prestige_claim_\<phrase\>
An unsupported proof or prestige phrase appeared in a public field. Banned phrases: decades of research, research-backed, evidence-based, proven, scientifically proven, definitive, landmark, seminal, foundational, classic, canonical, masterpiece, time-tested, award-winning, bestseller, influential, world-changing, widely regarded, celebrated classic/work/book/author, widely celebrated, highly celebrated, iconic, must-read. Note: "celebrated" alone is no longer rejected; only prestige uses like "celebrated classic" are rejected.

### unsupported_medical_or_research_claim_\<phrase\> (v8.5+)
Unsupported medical, therapeutic, clinical, or scientific claims. Banned phrases: well-researched, grounded in research, clinical evidence, therapeutic potential, treat depression/anxiety/addiction, mental health treatment, neuroscience proves, studies prove, research confirms, evidence shows, scientifically supported, backed by science, clinically proven, peer-reviewed, mental health, clinical rigor, clinical data, therapeutic context, therapists and patients, psychedelic research for mental health, psychedelics and mental health, therapy, neuroscience, scientific dive.

Medical/research claims check first before name-leak for books in: Health, Psychology, Science, Social Sciences, Medical, Medicine, Neuroscience.

### unsupported_format_claim_\<phrase\>
The output claims the book is or contains: workbook, interactive companion, guided journal, fill-in-the-blank, workbook templates, fill-in templates, downloadable templates, exercises and templates, worksheets and templates, practical templates, step-by-step templates, ready-to-use templates, etc.

Format claims are NOT rejected when negated/mismatch context: "readers who want a workbook", "if you want exercises", "not a workbook", "this stays in explanation mode", "skip if you need hands-on exercises", "does not include exercises", "no exercises", "lacks exercises". These pass with warning.

### source_overclaim_\<phrase\> (v9.0+)
Source-backed, verified, proven, endorsement, recommended by, passed along/between/among, word-of-mouth, cited by/in, widely cited, frequently cited, heavy citation, staple, staple status, canonical, cultural phenomenon, endorsed by, public figures, and similar source/social proof claims. **Narrowed in v9.0**: only "cited by/in", "widely cited", "frequently cited" (source/proof usage). Ordinary uses of "framework" are not source overclaims.

### not_for_lacks_specific_dnf_warning
The not_for field does not contain any DNF/mismatch tokens: slow, dense, repetitive, dated, ideological, abstract, shallow, emotionally heavy, disturbing, graphic, meandering, academic, anecdotal, no step-by-step, not a how-to, likely dnf, bounce off, dnf.

### generic_ai_or_publisher_copy
Two or more generic copy phrases appeared across public fields: readers gain, readers come away, the book explores/examines, compelling look, powerful meditation, masterful account, mental toolbox, rigorous architecture, durable framework, paradigm shift, rich tapestry, sweeping narrative, timely reminder.

### fields_not_distinct_enough
quick_verdict, editorial_summary, and best_for share too many overlapping words.

### provider_network_error_timeout (v9.1+)
AI provider timeout or network failure. Status=error, recommended_action=retry_provider. Not a quality failure. Not a max_retries_exhausted. Separate from validation/quality rejects.

### ai_empty_response / ai_json_parse_failed / ai_json_repair_failed
The AI response could not be parsed as valid JSON despite retries.

### internal_language_\<term\>
Internal pipeline language leaked into public fields: sampled data, database row/field, json field, csv row, raw output, dry run, supabase, llm, prompt template, ai_generated, ai-quality.

### recommendation_context_risky_\<term\>
The deterministic recommendation_context contained risky terms.

## Quality Gate (v8.5+, v9.0+)

Quality evaluation is a separate layer from hard validation:

- 4.7+ → accept_candidate / dry_run_update
- 4.3–4.69 → keep_pending / generated_but_weak
- 4.0–4.29 → needs_retry / generated_but_weak (retryable)
- <4.0 → reject

Rows below 4.3 are not accepted. Rows below 4.0 are hard quality-rejected.

## Vibe Tag Guard

Repair silently for hype/banned vibe tags. After repair, a pace/intensity tag is injected if missing.

## Quality Warnings

Non-rejection warnings: formulaic_phrase_sanitized, vibe_tag_repaired, retry_used, reject_debug_incomplete, possible_name_leak_debug_mismatch, quality_below_accept_threshold_X, quality_below_retry_threshold_X, quality_below_threshold_X, provider_network_error, reader_fit_too_generic, best_for_too_generic, not_for_too_generic, emotional_journey_weak, pacing_profile_weak, dnf_warning_weak.

## Category Rules

Preserved multi-word categories: NonFiction, Science Fiction, Personal Development, Social Sciences, Self Help, Popular Science. Known merges get split. Aliases normalized. Max 5 displayed.

## Current State (v9.3)

- All trust/safety validators implemented and hardened
- Medical/research claim priority enforced for sensitive categories
- Name-leak detection requires snippet verification
- Negated format claims pass without rejection
- Provider timeouts classified separately
- Quality evaluator implemented (9 dimensions, 4-tier thresholds)
- Quality gating: keep_pending/needs_retry for mediocre rows, not forced accept
- Targeted retry available for needs_retry rows
