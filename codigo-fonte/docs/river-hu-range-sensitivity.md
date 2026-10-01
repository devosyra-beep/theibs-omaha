# River HU: nested 24/32/48 combination sensitivity experiment

## Scope and method

This is a QA experiment on the existing PLO5 High river HU game. The candidate admission is **32 explicit combinations per seat / 1,024 Cartesian assignments**, conditional on complete-tree construction within every existing guard. The experiment loads the same adapter in memory with only its admission ceiling changed to 48 combinations / 2,304 assignments. It does not change the 48 MiB conservative tree reservation, 12,000 nodes, 750 ms construction deadline, 64 MiB solver working guard, sizing rules, ledger, chance enumeration, CFR+, certificates or convergence criterion. See [conditional admission and transport delivery](river-hu-32-transport.md) for browser evidence and release boundaries. This experiment's 48-combination adapter is never shipped.

The synthetic ranges preserve the first 24 hands and their raw positive weights when extending to 32 and 48. Additional five-card hands use three fixed anchors and two cards from each seat's existing twelve-card kicker pool. The two pools are disjoint from each other and the board, so every Cartesian assignment is compatible. Weights are explicitly declared and renormalized for each study. These are **different games and different priors**, not more accurate numerical approximations of the same game. The 48-combination study is not ground truth, a population range or full-hand equilibrium.

Two templates use the same board, pot, stacks, fees, utility and declared size levels `[1, 2]` across all range counts. The first permits one additional aggression. The second permits none and is a smaller declared game. Its EV cannot substitute for the first template's EV.

Every admitted cell receives one first execution in a fresh Node Worker and one repeat in that same runtime, each with the existing STANDARD **3,000 ms / 1,000 total work-iteration ceiling**. The repeat builds a fresh game and job; it is not a result-cache hit or checkpoint continuation. Loaded modules and runtime warmup are reused. First-value and completion measurements below are inside the Worker and exclude startup/imports and browser transport. Separate cumulative fixed-work checkpoints use 16, 32 and 64 iterations for the original game and each conditioned game. They provide diagnostics, not standalone job qualification.

## Admission results

All worlds are exactly enumerated, with no sampling, dropped assignments or truncated trees. A reservation failure returns no strategy or EV.

| Template | Combinations per seat | Compatible worlds | Complete nodes required | Reservation required | Outcome |
| --- | ---: | ---: | ---: | ---: | --- |
| Two sizes, one aggression | 24 | 576 | 5,185 | 40.508 MiB | READY |
| Two sizes, one aggression | 32 | 1,024 | 9,217 | 72.008 MiB | MEMORY_BUDGET |
| Two sizes, one aggression | 48 | 2,304 | 20,737 | 162.008 MiB | MEMORY_BUDGET; also exceeds node ceiling |
| No additional aggression | 24 | 576 | 1,729 | 13.508 MiB | READY |
| No additional aggression | 32 | 1,024 | 3,073 | 24.008 MiB | READY |
| No additional aggression | 48 | 2,304 | 6,913 | 54.008 MiB | MEMORY_BUDGET |

For this current decision, even the smallest supported FOLD/CHECK tree has three public nodes. At 48×48 it requires `(1 + 3 × 2304) × 8192 = 56,631,296` reservation bytes, exceeding 48 MiB. Thus no complete common smaller template for all three counts fits these unchanged guards. **Three-way EV/action stability is not established; 48×48 EV and bounds remain unknown.**

## Measured admitted jobs

These are individual local Node observations, not percentiles, browser/mobile timing or a universal three-second promise. The final bounded rerun measured 6.829 seconds of solver/fixed-checkpoint compute. Source digests remained stable during the run.

| Template / combinations | First strategy, first/repeat | Job completion, first/repeat | Final NashConv (bb) | Strict commitment precision | Practical outcome |
| --- | ---: | ---: | ---: | --- | --- |
| Two sizes / 24 | 338 / 299 ms | 1,088 / 983 ms | 0.00755994 | INCONCLUSIVE | NEAR_EQUIVALENT |
| No aggression / 24 | 343 / 197 ms | 551 / 335 ms | 0.00309206 | CONCLUSIVE | NEAR_EQUIVALENT |
| No aggression / 32 | 356 / 260 ms | 647 / 487 ms | 0.00663342 | CONCLUSIVE | NEAR_EQUIVALENT |

Every admitted job remains APPROXIMATE because the declared tree omits legal aggression/sizing opportunities. Complete chance support and every declared root action are retained. The first/repeat mathematical snapshots match exactly for each cell. Approximation status, global convergence, strict commitment separation and practical near-equivalence remain separate labels.

The near-equivalence result uses the unchanged 0.01 bb policy and valid outward bounds over the **full original prior with one Hero information-set commitment fixed**. It does not claim the current hand's action EVs are near-equivalent. In the no-aggression study, FOLD still has current-hand incremental EV zero, while CHECK is materially positive; the near group can contain both because only the selected Hero private type is fixed in the ex-ante commitment comparison.

Worker final heap samples across first/repeat executions were about 12.6–22.7 MiB. The largest sampled parent-plus-worker process RSS was about 115.7 MiB. These include runtime/allocator state and are not per-worker peak heap, browser memory or the conservative reservation itself. Refused trees are not allocated into partially solved games.

## What the EV comparison shows

Only the **same no-aggression template** admits both 24 and 32 combinations. At the same 64 iterations per tree:

| Quantity (bb) | 24×24 | 32×32 | Change |
| --- | ---: | ---: | ---: |
| Current-hand FOLD profile EV | 0 | 0 | 0 |
| Current-hand CHECK profile EV | 1.18666667 | 0.67424242 | −0.51242424 |
| Full-prior FOLD commitment midpoint | 1.29455550 | 0.72831150 | −0.56624400 |
| Full-prior CHECK commitment midpoint | 1.29851105 | 0.72958847 | −0.56892258 |

CHECK remains the current-hand point leader and commitment-midpoint leader in both studies and at all 16/32/64 checkpoints for this smaller template. Its EV changes substantially when the explicitly weighted ranges change. A stable action label therefore does not demonstrate stable EV or adequate population coverage. Midpoint differences above are range sensitivity, not numerical error against an ideal 48-combination answer.

For the larger admitted 24-combination two-size game, the current-hand point leader is CHECK at all three fixed checkpoints. The commitment-midpoint leader changes from BET:1.00 at 16 iterations to CHECK at 32 and 64; global NashConv decreases from 0.03637415 to 0.01174081 to 0.00298036 bb. The early midpoint leader is a diagnostic estimate. The actual STANDARD job retains strict INCONCLUSIVE while proving its separate near group using all compatible bounds. No point-EV proximity or low NashConv alone is promoted into a commitment proof.

## Validation and reproduction

Run from `codigo-fonte`:

```text
node test/helpers/benchmark-river-hu-range-sensitivity.cjs
node --test test/river-hu-range-sensitivity.test.cjs test/solver-river-hu-capacity.test.cjs
```

The sensitivity/capacity gates check nested hand/weight preservation, exact 1,024/2,304-world coverage, experiment isolation, conditional 32-combination admission, unchanged guards, atomic aggressive-32/48 rejection, and the minimal 48 refusal. The new 32-admission gate independently validates all 1,024 world payoffs, 992 jointly blocker-compatible assignments, exact fixed-work/checkpoint/bound parity with baseline `5ba76316`, and small rational containment without added endpoint tolerance. Historical 24-capacity cases and their `b62b0f1` parity remain intact.

No external LP was computed for 24/32/48. The 48-combination experiment remains isolated and no resource limit is raised to make a tree fit. The separate delivery admits qualified 32-combination trees; it does not silently reduce their actions, weights or chance support. Browser timing is recorded separately and does not establish population-range adequacy or a universal SLA.

Evidence: [complete inputs, progress, checkpoints, bounds and measurements](benchmarks/river-hu-range-sensitivity.json).
