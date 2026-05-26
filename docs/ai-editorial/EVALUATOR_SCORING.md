# Evaluator Scoring (v9.3)

## Current Status

**Implemented in v9.0+.** The `evaluate_reader_fit_quality()` function is a deterministic heuristic that scores 9 dimensions on a 1-5 scale. It does not call an LLM.

Rows that fail hard validators are rejected regardless of evaluator score. The evaluator gates quality for rows that pass hard validators.

## Relationship to Validators

Validators catch hard failures (rejected rows — trust/safety issues). An evaluator scores quality (how good the surviving rows are).

An evaluator does not replace validators. Trust/safety hard rejects always take priority.

## Scoring Dimensions (1–5 each)

| Dimension | What It Measures |
|---|---|
| reader_fit_specificity | Concrete reader-fit signals in quick_verdict, best_for, summary |
| dnf_warning_quality | Specific DNF points and friction tokens in not_for |
| emotional_fit_quality | Emotional arc description with start/mid/end signals |
| pacing_expectation_quality | Physical reading-pattern signals (one sitting, chunks, slow read, etc.) |
| best_for_specificity | Concrete roles, situations, and use cases in best_for items |
| not_for_specificity | Concrete mismatch/DNF language in not_for items |
| generic_ai_safety | Absence of generic AI phrases (lower score = more generic phrases) |
| fact_minimal_safety | Absence of fact-claim language (lower score = more unsupported claims) |
| vibe_quality | Quality and count of vibe tags (banned tokens penalize) |

Higher is better for all dimensions.

Additional checks:
- **summary_book_report_check**: flags editorial_summary that reads like a book report (multiple "explores/examines/discusses" signals). If triggered, reduces fact_minimal_safety.
- **fact_minimal_safety attribution**: author/book-attributed statements ("the author argues", "the book presents") are excluded from the fact-claim hit count.

## Quality Thresholds (v9.3)

| overall_icp_score | recommended_action | CSV status | Reason prefix |
|---|---|---|---|
| ≥ 4.7 | accept_candidate | dry_run_update | ok |
| 4.3–4.69 | keep_pending | generated_but_weak | quality_below_accept_threshold |
| 4.0–4.29 | needs_retry | generated_but_weak | quality_below_retry_threshold; needs_retry |
| < 4.0 | reject | rejected | quality_below_threshold |

Rows below 4.0 are hard quality-rejected.

Rows at 4.0–4.29 get `needs_retry` (not `reject`) and `generated_but_weak` status. They are retryable: the targeted retry rewrites only the weakest fields (best_for, emotional_journey, quick_verdict, editorial_summary).

Rows at 4.3–4.69 get `keep_pending` and `generated_but_weak`. These need either a retry cycle or human review before acceptance.

Accept threshold is 4.7. Do not lower this threshold just to get more accept_candidate rows.

## Evaluator Output Format (CSV + JSONL)

Every output row includes these evaluator columns:

```
reader_fit_specificity
dnf_warning_quality
emotional_fit_quality
pacing_expectation_quality
best_for_specificity
not_for_specificity
generic_ai_safety
fact_minimal_safety
vibe_quality
overall_icp_score
evaluator_notes
recommended_action
```

`evaluator_notes` must never be "ok" when `recommended_action` is not `accept_candidate`.

## Example Scores

**4.5 row (keep_pending):**
> overall_icp_score=4.50, evaluator_notes="ok", reader_fit_specificity=4.8, dnf_warning_quality=4.5, emotional_fit_quality=4.5. Strong but pacing scored 2.5.

**4.0 row (needs_retry):**
> overall_icp_score=4.00, evaluator_notes="score_drivers: pacing expectation quality=1.5, best_for_specificity=3.0". Weak pacing and generic best_for; retryable.

**3.5 row (reject):**
> overall_icp_score=3.50, evaluator_notes="dnf_warning_weak, best_for_too_generic, not_for_too_generic". Multiple weak dimensions; hard reject.

**2.1 row (reject):**
> overall_icp_score=2.11, evaluator_notes="best_for_too_generic, emotional_journey_weak, pacing_profile_weak...". Generic safe copy; should never reach public.

## Current Operating Evidence (v9.1 25-row dry run)

- 0 accept_candidate out of 25 rows
- Average overall_icp_score ~4.08
- Weakest dimensions: best_for_specificity (3.63), reader_fit_specificity (3.93), emotional_fit_quality (3.54)
- This means the quality prompt needs improvement and retry cycles are needed — not that the evaluator is too strict
- The evaluator correctly identifies weak rows; the fix is not to lower thresholds but to produce better output

## Current vs Future

**Current (v9.3):**
- Deterministic heuristic evaluator implemented in `evaluate_reader_fit_quality()`
- 9 scoring dimensions, overall ICP score, recommended_action, evaluator_notes
- Quality-gated thresholds for accept_candidate / keep_pending / needs_retry / reject
- Learning-pack tooling outputs evaluator scores per row and dimension averages per report
- `prompt_patch_suggestions.md` emits concrete fixes when dimension averages are below 4.0

**Future:**
- LLM-based evaluator for harder-to-catch quality signals (not yet planned)
- Calibration against human quality scores
