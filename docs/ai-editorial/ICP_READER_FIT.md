# ICP Reader-Fit Definition (v9.3)

## One-Sentence ICP

BookRecs AI editorial copy targets Reddit-style book discovery users who want honest, specific reader-fit intelligence — not publisher blurbs or generic AI summaries.

## Core User Question

"Should I spend 8-15 hours reading this book, and when would it actually fit me?"

## What These Readers Want

- emotional fit
- reading pace
- life-state matching
- blunt "not for" warnings
- likely DNF points
- concrete situational specificity ("a PM inside a legacy company", not "business readers")
- reader-fit diagnosis, not a recommendation or review

## What They Hate

- generic AI summaries
- publisher copy
- fake specificity ("a curious non-historian", "business leaders")
- prestige language
- unsupported proof/medical claims
- recommender-name leakage
- hallucinated formats (calling a book a workbook when it's not)
- MBA-consultant / professor / literary-critic voice

## Four Output Types, One Target

- Summary — what the book is about
- Review — whether it's good
- Recommendation — "you should read this"
- **Reader-fit diagnosis** — when this fits you and when it won't ← BookRecs target

## Quality Scale

- 2.0/5 — generic AI slop; could describe dozens of books
- 3.5/5 — acceptable human prose but no sharp reader-fit
- 4.0/5 — useful but replaceable; some fit signals, no sharpness
- 4.5/5 — strong reader-fit guidance; specific to this book; retry could lift to elite
- 4.8/5 — specific, honest, hard to replace; trusts the reader; candidate for accept
- 4.95/5 — feels like a trusted sharp reader who knows both the book and the reader

## Quality Targets by Tier

- Top books: target 4.7+
- Mid-tier: target 4.3+ (keep_pending if below; needs_retry if fixable)
- Weak-context books: remain pending rather than publishing weak AI output

## Quality Loop (v9.3)

- The 25-row v9.1 dry run produced 0 accept_candidate rows
- Weakest dimensions: best_for_specificity, reader_fit_specificity, emotional_fit_quality
- This is not a threshold problem — it's a prompt-quality and retry-cycle problem
- v9.2+ improved prompt specificity requirements
- v9.3 adds action-based reruns and better candidate snapshot preservation
- The quality loop is: generate → score → identify weak dimensions → retry weak rows → repeat
- Do not lower accept threshold to get more accept_candidate; improve output quality instead

## Brutal Truth

- 4.95/5 across 100k books without human QA is unrealistic
- 0 accept_candidate in 25 rows means iterate, don't scale
- Pending / needs_retry is better than weak AI output
- The current bottleneck is quality lift in best_for specificity and emotional_journey depth
- Validators + evaluator reduce risk — they do not make every row perfect

## Current State (v9.3)

- Hard safety validators enforce baseline (leak, proof, medical, format, DNF, generic)
- Quality evaluator scores 9 dimensions 1-5 with 4-tier thresholds
- Targeted retry available for needs_retry rows
- Action-based rerun selection (`--only-actions-from-report`) enables iterative quality improvement
- Learning-pack analysis (`--analyze-report --emit-learning-pack`) identifies weak dimensions per report
- Goal: improve accept_candidate rate through prompt/retry iteration, not threshold lowering
