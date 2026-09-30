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

Corrected production verification remains pending. The validation page now records sanitized rejection reasons and logical cancellation round trips. These measurements do not claim worker-exit latency. Final hosted capacity must be reported separately from the locally admitted input ceiling.
