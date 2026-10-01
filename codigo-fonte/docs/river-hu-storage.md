# River HU storage and certificate construction

Baseline: `c86abe284a4d56f62a1a6fac12e3b1558521a6bf`, branch `hosting/cloudflare-oracle-migration`, application/engine `0.14.10`.

## Scope and invariants

This delivery optimizes the existing finite river HU path. Admission remains **24 combinations per seat / 576 compatible worlds**, with the unchanged **48 MiB tree reservation**, node/build/working-memory guards and **8 MiB combined retained compilation ceiling**. No turn, flop, additional player or larger-range admission is introduced.

Current-hand EV against the returned profile, full-prior action-conditioned commitment values/bounds, and subgame NashConv remain different quantities. CFR+ version, exact tree hashes, traversal order, average-strategy weighting, complete-sweep checkpoints, utilities, fees, blockers and outward rounding are unchanged. `SOLVED` still describes the covered subgame; overlapping action intervals can remain `INCONCLUSIVE`. No interval is derived from NashConv and no missing EV becomes zero.

## Changes

- Profile-value scratch uses a flat binary64 buffer plus validity bytes instead of one result array per node.
- CFR sweeps reuse a child-value buffer only at each own-decision recursion depth. Chance/opponent values accumulate in the original action order. Buffers stay private to one solve and never enter checkpoints.
- Certificate reach intervals use flat binary64 storage. Both best responses reuse the same normalized interval probability rows; each retains its own choices and counterfactual reach.
- Action-conditioned construction shares unchanged subtrees only after the private base compilation capability validates and freezes the exact owned input. It copies changed paths and repeated source occurrences. The public mutable-input builder still makes isolated copies. Every prior world and other Hero type remains represented.
- Browser terminal jobs release their redundant private checkpoint. The coherent bounded cache remains the only resume source; public history/results remain available. Cache byte telemetry is a serialized-size estimate, not total heap.
- Automatic same-context resume preserves the remaining cumulative 5-second adaptive allowance after a foreground interruption. It never grants a fresh 3-second budget or resets accumulated iteration work.

## Independent validation

`test/solver-compact-independent-qa.test.cjs` loads baseline modules directly from Git in an isolated namespace. Fixed-work comparisons require **exact equality**, including strategies, EV, best responses, NashConv, checkpoints, game hashes and every action-bound endpoint. Cases cover private priors, rare actual hands, nonuniform weights/blockers, ties, stack accounting, fee policies, both player orientations, mutation isolation, imperfect recall, cancellation and stale resume identity.

Small independent sequence-form/LP and rational feasible-policy witnesses check the intervals with **zero added containment tolerance**. The existing expanded reference artifact is regenerated against the final source graph before building the browser reference. This validates small finite games, not a full PLO5 Multiway solution.

Focused core, conditioned sharing, adaptive/cache, browser-client and SolverUI checks preserve progressive output, supersession, coherent cache snapshots, independent game state and legal action identities. Browser desktop/mobile verification and hosting receipts are recorded separately; a successful build alone is not a visual or latency claim.

## Bounded same-work measurements

Run `node test/helpers/benchmark-river-hu-storage.cjs`. Six isolated Node processes alternate baseline/candidate, three samples each, on the **same 24×24 two-sizing game with 64 iterations per tree**. Mathematical digests must match exactly. No resource guard is raised. These are descriptive observations; p95 is the slowest of three samples, not a service SLA.

| Measurement | Baseline p50 / p95 | Candidate p50 / p95 |
| --- | --- | --- |
| Original profile plus all conditioned solves/bounds | 1192 / 1272 ms | 820 / 1140 ms |
| Original profile solve | 279 / 307 ms | 159 / 236 ms |
| All isolated best-response certificate phases | 80 / 84 ms | 97 / 100 ms |
| Warm checkpoints, zero additional CFR iterations, all bounds recomputed | 333 / 398 ms | 267 / 304 ms |
| Conditioned tree construction | 25 / 26 ms | 27 / 33 ms |
| GC snapshot live-result heap delta | 2.38 / 2.44 MB | 0.72 / 0.72 MB |
| Isolated process lifetime maximum RSS | 132.1 / 135.9 MB | 99.3 / 101.5 MB |

For the retained largest-action conditioned graph, newly allocated objects fell from **15,197 to 77**; **15,231** candidate objects share the immutable base. These are actual graph object identities, not all temporary allocations or measured peak browser heap. Shared construction adds a transient seen-node set. The conservative admission formulas remain unchanged.

The total fixed-work and warm recomputation costs improved. The isolated certificate arithmetic and tree traversal phases did **not** get faster in these samples; that tradeoff is retained explicitly rather than hidden in a total or claimed as a universal improvement.

Raw evidence: [same-work storage benchmark](benchmarks/river-hu-storage.json).

### Local browser observation

The existing public 12/24-combination harness ran three cold/warm pairs per case in the native browser against the final generated worker. Input remained available during computation. Each pair recorded one cache miss/one hit, zero retained terminal checkpoints and no active worker after completion.

| Explicit combinations per seat | First useful p50 / p95 | Completion p50 / p95 | Certificate arithmetic p50 / p95 |
| --- | --- | --- | --- |
| 12 | 280 / 281 ms | 607 / 684 ms | 42 / 52 ms |
| 24 | 449 / 637 ms | 3934 / 5235 ms | 295 / 375 ms |

Warm result-cache responses took 3–7 ms total. All three 12-combination outcomes were `NEAR_EQUIVALENT`; the 24-combination group retained one `INCONCLUSIVE` and two `NEAR_EQUIVALENT` outcomes. Strict precision remained `INCONCLUSIVE` in all these overlapping cases. First responses met the target in this sample; complete background refinement did not always finish within three seconds. Different timed work counts must not be compared as fixed-work numerical regressions. No repeat performance investigation was started to explain the variance.

## Progressive delivery and remaining limits

The first coherent profile remains available before certification finishes. Browser workers refine independently; foreground input can terminate a stale/paused study without waiting for solver acknowledgement. Completed numerical snapshots remain coherent when resumed. The approximately 3-second first-response target is measured on public synthetic browser fixtures after the matched-source build, not guaranteed for every phone, range or network.

Remaining limits include the unchanged 24-combination admission, explicit finite sizing tree and river HU coverage; lack of a full-hand or safe re-solving guarantee; legitimate overlapping intervals; temporary progress/checkpoint cloning and cache serialization on the main thread; actual browser peak heap not measured; small-sample latency evidence; and authentication/backend/network startup outside the synthetic solver timing. Device/runtime performance differences remain known limitations, without a new CPU/hosting investigation in this delivery.
