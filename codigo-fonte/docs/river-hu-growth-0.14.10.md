# THEIBS 0.14.10: larger explicit river HU studies

## Scope

This release extends only the existing PLO5 High river heads-up slice. The input ceiling is 12 explicit weighted combinations per original seat (up to 144 Cartesian assignments before blocker filtering) and 12 declared street-total sizing levels. These are admission ceilings, not latency or convergence guarantees. The service still applies 12,000 nodes, a conservative 48 MiB tree reservation and a 750 ms construction deadline. It rejects an oversized tree as a whole rather than sampling or silently omitting ranges. Three original seats keep the previous 3-combination, 27-world and 8-sizing ceilings; their coverage is not expanded or newly qualified here. Turn and flop are unchanged.

The public betting ledger is built once. Each private world still receives its own complete tree. Omaha hand rankings are reused only for the same explicit hand on the same fixed board. Settlement replay is reused only within the same public terminal and winner assignment. The authoritative ledger, fees, blockers, odd chips, refunds and exact two-hole/three-board rule are preserved.

## Mathematical meaning

The original strategy's current-hand EV and frequencies, the ex-ante value/bounds of fixing one action at Hero's private information set, and the original subgame's NashConv remain distinct. No confidence interval is inferred from NashConv. A commitment comparison is conclusive only when its valid lower bound exceeds every compatible rival upper bound with the numerical guard. All action-conditioned bounds share the same original tree and compatible state, ranges, fees, utility, abstraction and solver versions. The conditioned trees intentionally differ in the forced action.

CFR+ still operates on the entire declared tree. Adaptive certificate work prioritizes unknown bounds, then optimistic upper bounds, with a two-batch fairness guard among surviving candidates. An action is excluded from extra certificate work only by certified dominance; its branch remains in the original strategy tree. This refines the precision of declared sizing candidates, not a continuous bet-size domain. Omitting legal sizes or aggression depth retains APPROXIMATE even when NashConv is small. SOLVED and INCONCLUSIVE remain independent. The legacy heuristic continuation estimate is separately labeled.

## Validation evidence

The mathematical comparison baseline remains 1c9a91fd1555297b50c3db5e092868516436b60e; the validated 0.14.9 runtime remains 26dfae4e74552a2a0e509bfcc952e38d9fb344c1. The 24-cell construction experiment spans 2/3/4/6/8/12 combinations per seat and 3/5/8/12 sizes. All 120 new construction samples fit their declared budgets. Thirty supported old-baseline samples produced identical complete tree digests. A separate differential review found all 1,433 nodes and 914 terminal payoffs identical in 22 fee, stack, tie, blocker and seat cases against the 0.14.9 code.

An independent sparse sequence-form primal/dual LP reference checks 4x4 ranges with five sizes and 5x5 ranges with eight sizes, including all 17 root actions at three checkpoints. All 51 value-containment checks passed with explicit numerical residual tolerance. At 500 iterations, maximum commitment midpoint errors were 0.000002513 bb and 0.000000404 bb; maximum widths were 0.000013648 bb and 0.000011382 bb. These are finite numerical reference results, not symbolic proofs or per-request error claims. SciPy/HiGHS is a QA-only dependency and is not shipped to the server.

The real-worker range/sizing matrix uses three samples per cell. Thirty-three of 36 STANDARD samples reached certified separation; all remain APPROXIMATE because their tree uses sizing abstraction. The 12x12/12-size case exhausted the initial three-second compute allowance and remained INCONCLUSIVE in all three STANDARD runs. The selected DEEP continuation obtained every certificate in about 5.3 seconds of continuous local wall time. Resource exhaustion never narrows or fabricates a bound.

An experimental cache of conditioned trees was removed after eight paired trials showed extra memory and slower execution in seven pairs. It is not part of the release. No suit canonicalization or new equivalence assumption was added to the production cache.

## Transport and lifecycle

The default UI starts one progressive STANDARD job instead of a FAST job followed by another STANDARD request and tree build. Owner-scoped, abortable status waits wake on a newer result/phase or after at most one second; legacy servers retain the 350 ms polling fallback. A stopped compatible result that needs no refinement is reused without a worker. When a valid HU STANDARD result reaches its budget and still recommends refinement, one automatic DEEP continuation per study signature keeps the partial result visible and uses the existing cumulative 30-second decision ceiling. Legitimate ties do not trigger retries merely because they remain INCONCLUSIVE. Stop, obsolete states and manual requests prevent automatic loops. Explicit refinement preserves its cumulative decision budget. State changes cancel or supersede old jobs and late replies cannot replace the current decision. Presentation snapshots no longer expose internal budget objects by reference.

## Measurements and release verification

The full sequential test suite passed 811/811 with no skipped tests. The existing Render build (`node --check server.js`) and syntax checks of affected browser/solver modules passed. An optional desktop archive attempt encountered the pre-existing absent, gitignored assistant-validation attestation; no attestation was fabricated. That archive is not the website release artifact.

Browser/HTTP validation passed 93 checks across the progressive and legacy suites: 24 actual cold misses, 24 identical warm snapshots, nine relevant-input invalidation misses, obsolete-job supersession and explicit cancellation. Server-controlled utility and solver-version changes are validated at the module boundary rather than exposed as live API mutations. Responsive review covered CONCLUSIVE and overlapping INCONCLUSIVE results at desktop 1280x720 and mobile 393x852, expanded range editing, voice options, card picker and physical keyboard editing. Editing the hand removed the obsolete solver result. The HUD now maintains a measured 14 px gap above the board on the short desktop viewport. No microphone was opened.

| Local browser scenario | Samples | First response p50/p95 | First strategy p50/p95 | Completion p50/p95 | Warm p50/p95 | Bounds compute p50/p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Separated call | 5 | 17 / 32 ms | 77 / 109 ms | 144 / 363 ms | 11 / 16 ms | 3.3 / 4.5 ms |
| Overlapping call | 5 | 34 / 54 ms | 87 / 106 ms | 159 / 167 ms | 28 / 43 ms | 3.4 / 5.1 ms |
| Four worlds / five actions | 5 | 54 / 86 ms | 95 / 126 ms | 233 / 257 ms | 54 / 70 ms | 16.1 / 17.1 ms |
| 4x4 ranges / 5 sizes | 3 | 78 / 84 ms | 118 / 129 ms | 311 / 323 ms | 81 / 104 ms | 76.5 / 80.8 ms |
| 8x8 ranges / 8 sizes | 3 | 103 / 141 ms | 166 / 176 ms | 677 / 725 ms | 85 / 103 ms | 422.4 / 458.1 ms |
| 12x12 ranges / 12 sizes | 3 | 143 / 211 ms | 301 / 329 ms | 2218 / 2240 ms | 128 / 157 ms | 1738.4 / 1766.8 ms |

Construction, worker and browser/HTTP measurements are separate experiments. This faster HTTP round does not erase the earlier three-second ceiling observed in the worker matrix. Cold means an empty compatible solver cache and fresh worker, not an OS cache flush or a sleeping hosted service. Small-sample p95 is descriptive (the maximum for three or five samples), not an SLA. Real microphone/audio accuracy and hosted peak RSS are not established by this solver benchmark.

The interleaved, same-machine comparison against verbatim 1c9a91f used 15 pairs. Original-profile EV, frequencies and NashConv matched exactly in every pair. Completion p50/p95 changed from 576/667 to 472/603 ms for the separated call, 429/479 to 346/371 ms for the tie, and 588/646 to 552/797 ms for four worlds. The last tail worsened; small samples and unmeasured host load do not support a universal speed claim.

Evidence: [measurements and test outcomes](benchmarks/river-hu-growth-0.14.10.json), [independent LP](benchmarks/river-hu-expanded-lp-reference.json), [ledger differential](benchmarks/river-hu-adapter-independent-differential.json), [rejected cache optimization](benchmarks/river-hu-conditioned-cache-negative-experiment.json).

Screenshots: [conclusive desktop](benchmarks/river-01410-conclusive-desktop.png), [conclusive mobile](benchmarks/river-01410-conclusive-mobile.png), [overlap desktop](benchmarks/river-01410-overlap-desktop.png), [overlap mobile](benchmarks/river-01410-overlap-mobile.png).

## Initial production findings and interruption correction

Runtime commit `012ab996038ab8a3ba7ebec5dca4b4a2b4f15aa7` was deployed through the existing manual Render flow as `dep-daukpt7lk1mc73d9fud0` on 2026-09-30 (33.6 seconds). Public health and engine version checks confirmed 0.14.10. The authenticated baseline suite passed 42/42 checks, including nine cache-invalidation misses, explicit cancellation and obsolete-job supersession.

The first progressive hosted run did not pass its expanded-capacity gate. One 4x4 sample was cancelled with an incomplete certificate set; its exact cancellation trigger was not captured. Two 8x8 samples reached certified separation in approximately 28–29 seconds; a third remained inconclusive at its resource ceiling. All three 12x12 samples returned NOT_SOLVED/UNSUPPORTED without actions. The initial sanitized report omitted rejection reasons, so their specific cause is not yet established. These observations do not support a three-second completion claim for expanded hosted studies.

Independent lifecycle review identified a separate, reproducible defect: a foreground pause could mark a cached partial snapshot STOPPED with no further refinement recommended. The correction represents interruption as PAUSED, retains the mathematical refinement requirement, and permits automatic final reuse only for known mathematical stopping reasons. Adaptive contract V4 invalidates old interruption metadata; CFR, utilities, certificates, coverage and resource budgets are unchanged. A focused regression suite covers real-solver interruption/resume, persisted paused snapshots, rejection of legacy false-final metadata, and continued reuse of legitimate terminal results.

Corrected production verification is recorded below. The validation page now records sanitized rejection reasons and logical cancellation round trips. These measurements do not claim worker-exit latency. Hosted capacity remains separate from the locally admitted input ceiling.

## Final hosted verification and EV presentation

Runtime commit `9cac713297108d106fd4d3ee75cf99cb82035600` became Live through the existing Render flow as `dep-daum1p67bikc73cu38j0` (29.4 seconds). Health was OK; engine and interface reported 0.14.10; all four changed browser assets matched the indexed release after line-ending normalization. The final authenticated baseline passed 42/42. Nine relevant public input changes each produced a cache miss. Utility and solver-version invalidation remain module-boundary checks because the server controls those fields.

The final progressive run recorded **43 PASS, 4 FAIL, 4 INFO**. Every separated and overlapping small fixture passed, preserving SOLVED independently of CONCLUSIVE/INCONCLUSIVE. All three 4x4 studies completed with all seven action certificates. Two of three 8x8 studies completed with ten certificates; the other ended NOT_SOLVED with BUDGET_BEFORE_FIRST_STRATEGY. None of the three 12x12 studies produced a strategy: one ended BUDGET_BEFORE_FIRST_STRATEGY, two reached BUILD_TIME_BUDGET at approximately 791–795 ms. These failures are capacity limits, not qualified larger-range performance. Earlier hosted rounds are retained in the JSON, including the initial interruption problem and the pre-correction cancellation fixture failures. No failed capacity sample is silently replaced.

Times below are browser wall p50/p95 in **seconds**, except that bounds are the cumulative worker action-conditioned solve cost in seconds. First response is acknowledgement, not an EV table. Successful completion excludes rejected requests; warm latency includes attempted requests, with actual cache hits explicitly counted. The four failed expanded requests remain in their own rejection measurements.

| Hosted scenario | Cold samples | First response | First strategy | Successful completion | Warm request | Bounds compute | Warm hits |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Separated call | 5 | 1.031 / 1.548 | 1.915 / 2.384 | 1.915 / 2.385 | 1.059 / 1.438 | 0.004 / 0.075 | 5/5 |
| Overlapping call | 5 | 0.748 / 1.446 | 1.597 / 2.493 | 1.598 / 2.493 | 0.701 / 0.770 | 0.091 / 0.094 | 5/5 |
| Four worlds / five actions | 5 | 0.751 / 1.538 | 1.822 / 2.694 | 3.004 / 3.449 | 0.718 / 1.071 | 0.501 / 0.586 | 5/5 |
| 4x4 / five sizes | 3 | 0.698 / 0.717 | 1.670 / 1.806 | 4.660 / 8.108 | 0.695 / 0.724 | 1.605 / 2.787 | 3/3 |
| 8x8 / eight sizes | 3 | 1.117 / 1.127 | 2.353 / 2.526 | 20.112 / 27.716 | 0.721 / 3.784 | 7.974 / 14.724 | 2/3 |
| 12x12 / twelve sizes | 3 | 0.669 / 0.693 | — | — | 2.823 / 2.916 | — | 0/3 |

The final run observed 24 cold misses and 20 warm hits, all 20 with identical result digests. Four failed-capacity warm attempts were misses. The progressive obsolete job changed BUILDING to CANCELLED when superseded; the replacement completed. Explicit cancellation acknowledgement took 794 ms. The baseline separately reproduced obsolete cancellation and a 715 ms explicit acknowledgement. Supersession observation times (5,199 / 2,570 ms) include replacement work and HTTP requests, not physical worker shutdown latency. No hosted peak RSS, sleeping-service cold start or hard latency guarantee is established.

The viable free-hosted envelope is smaller than the admitted 12-combination ceiling. First strategies for completed 4x4 and 8x8 fixtures were visible within about 1.5–2.6 seconds in this round, while certificate completion required 4.4–8.1 and 20.1–27.7 seconds respectively. Across preceding runs, the 8x8 completion tail reached about 33.7 seconds. A three-second certified completion guarantee is unsupported. Four explicit combinations per seat is the most consistently successful expanded fixture tested here; it is not evidence that four combinations represent a realistic unknown range. Missing range information remains unknown. Further expansion requires faster tree construction and verified numerical throughput rather than looser bounds, invented ranges or enlarged deadlines disguised as interactive performance.

### Preliminary estimate retention and labels

The deterministic Analyze PREVIEW and FINAL continuation passes remain separate from the river solver. FINAL failure previously replaced a valid PREVIEW. The interface now retains that preliminary result only for allowlisted compute failures and the identical live hand, input revision, payload, session and analysis invocation. Authentication, access, version, input/range errors and obsolete states cannot use this fallback. A retained estimate stays PROVISIONAL/HEURISTIC, keeps its original uncertainty and identifier, and cannot grade a training decision or create a final recommendation. The visible state says that refinement stopped; no surface remains stuck on Refining or Calculating final. If no complete sample was available, the calculation remains unavailable. No budget, poker formula or Train rule was changed by this patch.

The action table now shows **Below leader · bb**, a nonnegative EV gap (leader estimate minus action estimate), instead of negating it under the ambiguous delta label. Incremental action EV, gap between alternatives, commitment bounds and numerical uncertainty retain their distinct meanings. A failed calculation says UNAVAILABLE rather than falsely reporting NO_DECISION. Provisional values do not declare a precision-qualified leader.

Focused retention, session/revision safety, error-code propagation and UI checks passed. One integrated run recorded 42/43 because an unchanged 500 ms cold-worker recovery test exceeded its deadline under host load; the worker suite then passed 11/11 in isolation. This is retained as a test timing limitation rather than relabeled as a passing integrated run. The earlier full suite passed 811/811 before these final presentation/transport patches.

The integrated independent visual review covered conclusive and overlapping tables at desktop (1366x900 / 1280x720) and mobile (390x852). English labels, positive gaps, unchanged action values and SOLVED plus INCONCLUSIVE were visible without clipping. Final production app smoke covered the empty layout at 1280x720 and 393x852 and the expanding/collapsing Details control, with no horizontal overflow. Populated app fixtures and keyboard/voice-options interactions were exercised locally; isolated authenticated production API cases cover the corresponding math without changing the user's workspace. Live populated workspace interaction and human microphone accuracy were not executed.

Final presentation captures: [conclusive desktop](benchmarks/river-01410-ev-gap-conclusive-desktop.png), [conclusive mobile](benchmarks/river-01410-ev-gap-conclusive-mobile.png), [overlap desktop](benchmarks/river-01410-ev-gap-overlap-desktop.png), [overlap mobile](benchmarks/river-01410-ev-gap-overlap-mobile.png).

The baseline remains validated; the expanded admission ceiling is capacity-limited on Render Free. Turn, flop and additional player coverage were not added.
