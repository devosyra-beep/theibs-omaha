# THEIBS 0.14.9: small river heads-up solver baseline

## Release identity and scope

This closes the small river HU baseline validation slice. The validated runtime is commit `26dfae4e74552a2a0e509bfcc952e38d9fb344c1` (fixture tree `f899cdb633733fe13a2b3810b42feb801e8b3c77`). Render service `srv-das7of8jo6nc73aisi6g`, deploy `dep-dauergqd0e5s73ffr530`, was observed live on 2026-09-30 at 11:09:22 UTC. The comparison baseline is `1c9a91fd1555297b50c3db5e092868516436b60e`. The [machine-readable benchmark record](benchmarks/river-hu-baseline-0.14.9.json) preserves the measurements and their definitions.

This release validates **PLO5 river, two original seats, explicit complete finite weighted ranges and a declared bounded legal action tree**. `SOLVED` qualifies the returned average profile only for a supported, complete, constant-sum subgame that meets its exact `0.01 bb` NashConv threshold. `APPROXIMATE` can still carry a valid strategy when that qualification is not met. The action comparison status is independent: a `SOLVED` profile can have overlapping action bounds and an `APPROXIMATE` profile can have conclusively separated commitment bounds. The UI does not claim full-hand equilibrium or GTO. The setup dialog mentions three-seat study support, but this baseline did not validate that coverage.

The visible primary comparison is the **full-prior value of fixing an action only at Hero's private information set**. All original ranges, hidden worlds and other information sets remain in that conditioned game. Its certified lower and upper bounds are distinct from the current hand's action EV and frequency against the original average strategy, which appear in a separate disclosure. NashConv measures deviations of that original strategy within the declared subgame; it is not an action-value error bar or a statistical confidence interval. A conclusive commitment leader requires its lower bound to exceed every competing upper bound with the numerical guard. It does not grade the original hand/profile EV.

## Evidence and outcomes

### Release changes and cache identity

The release freezes each input before asynchronous cache lookup or queueing, preventing later caller mutations from poisoning a cache entry. The shared adaptive version is now `THEIBS_HU_ADAPTIVE_V2`, invalidating older entries. Terminal `completionMs` is recorded separately from job age. An isolated, authenticated validation page supplies reproducible synthetic HTTP benchmarks. The CFR+, best-response, action-conditioning and river game mathematics are unchanged from `1c9a91f`.

The local invalidation suite covers public ledger/state, board, pot/call and monetary scale, physical seats and position, original player count, folded blockers, Hero information set, range support/weights/ownership, stacks, fee basis/amount/rate/cap/rounding, sizing levels and aggression abstraction. Utility, rules and solver versions are checked at the fixed server-contract/cache boundary. They are not mutable public HTTP options, so no live utility/version override was claimed. Nine input mutations were also exercised against the production API. Cache identity remains conservative; no new suit-isomorphism or tree canonicalization was introduced.

Cold means an empty compatible solver cache and fresh workers, not a sleeping Render instance or a flushed OS cache. Warm reads launched no worker. Cancellation checks establish logical cancellation and rejection of obsolete work; they do not measure physical worker-exit latency.

The [local browser report](../../validacao/river-baseline-local-final.json) and [production browser report](../../validacao/river-baseline-production-final.json) each recorded **42/42 passed checks**, 15 synthetic cold variants across three scenarios, 15/15 compatible warm cache reads with identical full-result digests, nine of nine expected cache misses after input changes, and observed supersession plus explicit cancellation. The [local](../../validacao/river-baseline-local-summary-final.json) and [production](../../validacao/river-baseline-production-summary-final.json) summaries provide the distribution for each scenario. Browser production used the existing signed-in session and `/api/access`; local auth was disabled. The isolated benchmark requests did not write to the application workspace or history; the separate UI smoke used a synthetic draft as described below.

| Declared scenario | Returned profile status | Commitment comparison | Independent reference outcome |
| --- | --- | --- | --- |
| Separated terminal call | `SOLVED` | `CONCLUSIVE`; Call above Fold | Call value 3 bb, Fold value 0 bb within certified bounds |
| Overlapping terminal call | `SOLVED`; NashConv 0 bb | `INCONCLUSIVE`; intervals overlap | Both reference values 0 bb; no artificial separation |
| Four worlds, five root actions | `APPROXIMATE` | `CONCLUSIVE`; Check dominates every alternative | Five independent action values lie inside their certified intervals |

The independent [sequence-form LP report](../../validacao/solver-sequence-form-reference.json) passed **36/36 numerical reference samples**. Its Python/HiGHS primal and dual LP does not import production CFR, best-response traversal or action conditioning. It checks value containment with independent residual tolerances; it is a numerical reference for these finite examples, not a symbolic proof or a claim about all PLO inputs. The [release suite](../../validacao/river-baseline-release-tests.log) passed **788/788** tests. These counts do not extend the supported player count, street, ranges or sizing coverage.

The [real-worker local benchmark](../../validacao/river-baseline-v2-worker-performance.json) repeated each scenario five times with an empty solver-service cache and fresh worker jobs. Its local p50 time to the first complete action certificate was approximately 149, 154 and 190 ms for the separated, overlapping and five-action cases, respectively. A compatible in-memory FAST cache read had p50 approximately 1.48, 0.96 and 1.18 ms with no new worker calculation. These measurements exclude browser, HTTP, hosted infrastructure and concurrent analysis or audio load. The process RSS samples cover the benchmark Node process and workers together; the browser reports' `heapUsedBytes` is only a worker heap sample, never peak service memory.

### Hosted timing, as measured

The following figures are descriptive production browser observations, five cold and five warm variants per scenario. p95 uses nearest rank, so with five samples it is the maximum observed sample. Times are milliseconds.

| Scenario | First HTTP response p50 / p95 | First strategy observed p50 / p95 | Certified result observed p50 / p95 | Warm HTTP p50 / p95 |
| --- | ---: | ---: | ---: | ---: |
| Separated call | 691 / 754 | 1,729 / 1,886 | 3,556 / 3,650 | 693 / 765 |
| Overlapping call | 719 / 770 | 1,814 / 1,851 | 3,608 / 3,635 | 688 / 727 |
| Four-world, five-action | 716 / 839 | 1,873 / 2,721 | 5,068 / 5,777 | 696 / 741 |

The first HTTP response is the browser's round trip to `/solver/start`, including transport and authentication; it is **not** the first strategy. The first observed strategy includes 350 ms polling. “Certified result observed” sums the browser-observed FAST and optional STANDARD phase durations; it is not one continuous interaction stopwatch. The corresponding server resolution measure sums fixed completion durations of those jobs, excluding HTTP transport and the gap between them. Cumulative decision compute and action-bounds compute measure worker work, not elapsed browser time. `timing.totalMs` in a response is the job's age at observation; the fixed terminal duration is `timing.completionMs`. No three-second end-to-end latency SLA is established: the hosted certified-result p50 exceeded three seconds in all three scenarios.

| Scenario | Local server resolution p50 / p95 | Production server resolution p50 / p95 | Local bounds compute p50 / p95 | Production bounds compute p50 / p95 |
| --- | ---: | ---: | ---: | ---: |
| Separated call | 204 / 231 | 1,273 / 1,306 | 4.72 / 5.19 | 6.05 / 96.53 |
| Overlapping call | 218 / 225 | 1,418 / 1,735 | 4.41 / 6.26 | 93.15 / 181.99 |
| Four-world, five-action | 299 / 320 | 2,442 / 2,532 | 14.02 / 16.84 | 494.40 / 581.01 |

Local HTTP acknowledgement p50/p95 was 12/20, 11/24 and 10/174 ms, respectively. Local observed certificate durations were 750/776, 759/767 and 762/920 ms; local warm HTTP reads were 10/12, 9/10 and 10/15 ms. Production server first-value p50/p95 was 547/656, 639/686 and 780/885 ms, independently of the longer browser-observed first strategy.

### Comparison with `1c9a91f`

The same local worker protocol recorded completion p50/p95 of 135.978/155.499, 151.413/164.959 and 210.820/239.025 ms at `1c9a91f`, versus 149.302/162.859, 153.840/168.194 and 189.950/199.094 ms in this release. These five-sample runs show runtime variation; they are not evidence of a statistically significant speedup or a hosted comparison. Global/action iteration counts remained 20/80, 10/90 and 30/220; result classifications and numerical values were preserved. Maximum sampled process RSS was 95,031,296 bytes before and 96,747,520 bytes now. Final hosted worker heap samples reached 10,398,736 bytes; this is not a hosted peak-RSS measurement.

The independent 1,000-iteration reference checkpoints recorded maximum commitment midpoint error / interval width of 0.000000974 / 0.000002547 bb for the four-world PLO case, and 0.000008159 / 0.000016317 bb for the blocker/fee case. All 36 reference containment checks passed. Those are separate reference checkpoints, not claimed per-request production error bars. The reference benchmark was preserved from the mathematical baseline and its independent LP regression tests passed in the current 788-test suite.

The [first production run](../../validacao/river-baseline-production-initial-limit.json) failed one cancellation check because its heavy nine-world replacement exceeded the existing 750 ms build ceiling and returned `UNSUPPORTED`. The final fixture isolates cancellation of the obsolete heavy DEEP job with a smaller valid replacement decision; the production rerun observed `CANCELLED` for the old job and `COMPLETE` for the replacement. An additional fresh job returned `CANCELLED` after explicit cancellation. The solver's node, world, memory and build ceilings were **not relaxed**. The initial failure remains recorded and the final pass should be read in that narrower cancellation scope.

## Final interface smoke

The final browser smoke on the deployed runtime passed desktop and 393 × 852 mobile layouts. Mobile measured `scrollWidth` 378 at viewport width 393. The screenshots preserve both [conclusive desktop](benchmarks/river-0149-final-conclusive-desktop.png), [conclusive mobile](benchmarks/river-0149-final-conclusive-mobile.png), [inconclusive desktop](benchmarks/river-0149-final-inconclusive-desktop.png) and [inconclusive mobile](benchmarks/river-0149-final-inconclusive-mobile.png) states. They show a `SOLVED` Call-versus-Fold commitment separation and a separately `SOLVED` yet `INCONCLUSIVE` overlap at NashConv zero. The commitment table is visually distinct from the original-hand/profile disclosure; the continuation-model equity area remains labeled separately.

The smoke also exercised virtual card input, heads-up setup, actions, range editing and the progressive placeholder without automatically playing a Hero action. Voice options displayed “This device only”; the test did not grant a new device permission or submit actual microphone audio. Closing options preserved the hand. On mobile, the separate legacy continuation/equity calculation timed out under its budget **at the river state** and remained visibly unavailable while the finite explicit-range river solver completed; the desktop state displayed an existing equity value with a separate continuation-model label. This solver pass does not verify whole-application calculation performance. The smoke restored the empty Analysis draft after testing without choosing a Hero action or archiving the synthetic hand. These observations are UI workflow checks, not an acoustic-recognition benchmark. The [structured final UI evidence](../../validacao/river-baseline-ui-final.json) records the interaction checks.

## Boundary for future growth

Wider streets, seats, chance/range support, unabstracted bet sizing, fee/game classes, adversarial reference suites, hosted load and concurrent voice/analysis measurements require their own qualification and performance evidence. They are not implemented or validated by this 0.14.9 baseline. A cached result is reused only for a compatible game key and still must match the active hand/revision before presentation. A valid solver result never turns the older heuristic continuation estimate into a solver-certified value.

The next slice is larger **river HU** ranges and more explicit/adaptive sizings, always compared with `1c9a91f` and this validated release. An action may stop receiving refinement only after compatible valid bounds certify its dominance exclusion; a low point estimate is insufficient. Every tree-growth step must retain CFR+, small-case independent LP validation, per-action bounds and provenance, and record error, NashConv, time, memory and cache behavior. No turn, flop or added players are part of this delivery. Render Free suspension, ephemeral filesystem persistence, heavy-tree build limits and real concurrent voice/EV load remain outside the validated real-time claim.
