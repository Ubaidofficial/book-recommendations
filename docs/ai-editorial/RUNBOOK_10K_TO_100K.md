# Runbook: 10k to 100k Scale (v9.3)

## Non-Negotiables

- No `--write` until dry-run quality is reviewed and accept_candidate rows exist.
- Always use `--backup-before-write` for writes.
- Draft AI content stays `pending`/`needs_review`.
- Only human-approved or explicitly high-confidence content can become public.
- Reject more rather than publishing weak AI content.
- Never generate just to fill pages.
- Never send recommender names to the AI.
- Do not treat empty/generic_pass as a success. A row is only a success if it is accept_candidate.

## Scaling Phases

### Phase 0: Offline Fixtures
- `--fixture-file` with `--mock-ai` passes all expected outcomes
- All validator guards pass
- Write/restore safety guards verified
- Evaluator scores populating correctly in CSV and JSONL

### Phase 1: 4-Row Failed-Only Dry Run
- `--only-failed-from-report` selects only actual failures
- Verify known failures are caught
- No name leaks, no proof claims
- Debug columns and candidate snapshots populated

### Phase 2: 25-Row Dry Run
- Manually inspect every row
- Run `--analyze-report --emit-learning-pack` to produce learning pack
- Check dimension averages in `prompt_patch_suggestions.md`
- If 0 accept_candidate, iterate prompt/retry before expanding

### Phase 3: Action-Based Rerun
- `--only-actions-from-report needs_retry,keep_pending` selects weak rows
- Targeted retry rewrites only weak fields
- Run cycle until accept_candidate count improves
- Do not expand batch until accept_candidate quality improves

### Phase 4: 100-Row Dry Run
- Only after at least some accept_candidate rows appear in smaller runs
- Category/style distribution check
- Cost estimation
- `--analyze-report --emit-learning-pack` for failure cluster analysis

### Phase 5: 500-Row Dry Run
- Cost/failure-pattern check
- Evaluator calibration review
- Concurrency tuning

### Phase 6: 1k Dry Run
- Production-like batch
- No DB write unless backup + explicit approval
- Full report review

### Phase 7: 10k Pilot
- Tiered generation
- Strict evaluator/gate thresholds
- Publish only high-confidence rows

### Phase 8: Top 100k
- Only after 10k quality/cost metrics are stable
- Cheaper models and skip logic for lower-value books

## Re-Run Workflow (v9.3)

1. Run dry-run
2. `--analyze-report` + `--emit-learning-pack` to produce quality reports
3. Identify action-based clusters
4. `--only-actions-from-report needs_retry,keep_pending` for targeted reruns
5. Pinpoint weakest dimensions from `prompt_patch_suggestions.md`
6. Patch prompt/validators
7. Rerun failed-only or action-based
8. Only then expand batch size

## Metrics to Track

- accept_candidate count
- generated_but_weak count (keep_pending + needs_retry)
- needs_retry count
- keep_pending count
- hard reject count (by reason)
- provider error count
- average overall_icp_score and median
- score distribution (4.8+, 4.7-4.79, 4.3-4.69, 4.0-4.29, <4.0)
- weakest dimension averages
- unsupported proof/medical claim count
- recommender leak count
- format claim rejection rate
- raw/tokens cost per accept_candidate

## DB Safety Workflow

1. Dry-run first
2. Inspect CSV + learning pack
3. `--backup-before-write` to save current state
4. `--write` with explicit backup path (only when accept_candidate rows are proven)
5. `--audit-ai-fields-from-report` after write
6. Restore path: `--restore-needs-review-ai-fields-from-report`
7. Approved rows protected (never auto-cleared)

## No-Human-QA Operating Mode

- Public approval must be conservative
- Weak rows remain `pending` or `needs_retry`
- Sample review matters — top books and failure clusters get manual attention first
- Automated acceptance requires strict validator pass + evaluator ≥ 4.7

## Brutal Operating Principle

The goal is not "generate everything."

The goal is "publish only what deserves trust."

Pending / needs_retry is better than weak AI output.

0 accept_candidate in a 25-row run means iterate quality before expanding.

## Current State (v9.3)

- Dry-run generation with `--fixture-file`, `--mock-ai`, `--only-failed-from-report`, `--only-actions-from-report`
- Hard validators for trust/safety (leak, proof, medical, format, DNF, generic, distinctness)
- Quality evaluator with 9 scoring dimensions and 4-tier threshold gating
- `--analyze-report` and `--emit-learning-pack` for structured report analysis
- `--compare-reports` for delta analysis
- `--promote-regression-cases` for regression case generation
- `--backup-before-write` required for all writes
- Audit and restore tooling
- `--concurrency` for dry-run parallelism
- `--checkpoint-every` for incremental CSV writing
- `--max-retries` capped at 3
- Provider network errors classified separately with retry_provider action
- rejected_candidates.jsonl preserves full snapshots for audit
