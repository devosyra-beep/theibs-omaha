# Browser execution of the existing river HU solver

## Delivery scope

This delivery changes where the existing finite PLO5 High river heads-up study runs. It does not add streets, players, unknown ranges or a full PLO5 equilibrium solution. The Node source remains the single mathematical implementation. Cloudflare serves the generated browser worker and interface; Render continues to serve authentication, hand registration, heuristic analysis and stored history. No Oracle resource or paid compute is provisioned.

The package and engine stay on 0.14.10 to preserve the existing engine/interface version gate. Browser runtime identity and source-graph SHA-256 identify the new execution adapter independently of the numerical engine versions.

## Mathematical invariants

- Preserve exact enumeration of the declared joint ranges, blockers and Omaha showdown, terminal accounting, Float64 arithmetic, CFR+ and outward-rounded best-response bounds.
- Keep the current hand's EV/frequencies against the original profile separate from the full-prior action-conditioned commitment values/bounds and global subgame convergence.
- Require compatible state, ranges, board, fees, stacks, utility, tree, sizing, abstraction and source versions before comparing or reusing results.
- Only certify a commitment leader when its lower bound exceeds every compatible rival upper bound with the existing numerical guard. No action is pruned by its current point estimate.
- Keep `SOLVED`, `APPROXIMATE`, `REFINING`, `HEURISTIC`, `NOT_SOLVED` and `INCONCLUSIVE` honest and independent. A legitimate tie may remain inconclusive after convergence. NashConv is not an action EV confidence interval.

## Runtime boundary

The build statically wraps the original CommonJS source graph into a same-origin classic Worker, without dynamic evaluation. Browser adapters replace Node hashing, clocks and worker transport, not poker or strategy logic. SHA-256 input semantics and deterministic identities must agree with Node. Source text is normalized to LF before generating the worker and fingerprint, ensuring reproducible Windows/Linux builds.

The worker validates the ledger envelope and expected decision revision before calculating. Progress and completion messages carry the job, generation, hand, revision and build identity. Cancelled or superseded workers are terminated; late results cannot replace a newer hand or decision. No cross-origin isolation or SharedArrayBuffer requirement is introduced.

## Interactive budgets and cache

The initial browser passage has a three-second compute allowance. A useful unresolved result can continue once toward a cumulative five-second allowance, preserving compatible checkpoints and the last valid result. Explicit deeper refinement remains a separate user action. Wall latency also includes worker startup, building, transport and rendering; the compute allowance is not a universal three-second wall or certification guarantee.

The first cache is bounded and held in page memory. It is isolated by account/session and exact request/build identity. No new player, history or auth data is written into browser persistence. Browser execution does not migrate the existing server or origin-scoped histories. Changing presentation does not restart the hand or microphone.

## Acceptance evidence

Before enabling the browser path online, validate static bundle reproducibility, SHA-256 parity, matched-checkpoint Node/worker results, action-bound containment and the independent LP cases. Exercise separated bounds, overlap, true tie, unsupported inputs, build/time exhaustion, stale cancellation, owner isolation and cache invalidation.

Measure cold and warm first strategy, final result, bounds cost, cache hits/misses and wall time at 3/4/5-second allowances. Desktop and mobile viewport tests establish composition only; they do not substitute for benchmarks on a physical phone or actual microphone/solver contention.

### Local evidence, 2026-09-30

The generated 23-module worker is 289,837 bytes. Six adapter tests compare the original Node and browser graph at matching checkpoints, including SHA-256, exact game identity, strategies, conditional profile EV, full-prior action bounds and compatible resume. Client/UI tests exercise deadlines, account changes, incompatible fees, transport changes, cancellation and partial checkpoint retention. No files in `src/` changed.

The actual Chromium browser worker passed separated, true-tie, non-tie overlapping, matched-work Node/LP, missing-fee, cache and cancellation checks. Local evidence is recorded separately from production. The independent LP check uses the existing exact rich 4x4/5-size game key; it is not applied to a different range or weight distribution. Desktop 1440x900 and mobile 393x852 composition checks showed no horizontal document overflow. Manual card entry, action recording, turn advancement and editing the study all ran through the actual game UI; the Hero action was not executed by the solver. A variant-select input/change race found during that check was corrected in the DOM event adapter.

| Declared scenario | Cold budget | Cold final p50 / p95 | First strategy p50 / p95 | Warm p50 / p95 | Bounds cost p50 / p95 | Comparison |
| --- | --- | --- | --- | --- | --- | --- |
| 4x4 / 5 sizes | 3 s | 410 / 488 ms | 274 / 325 ms | 2.5 / 2.6 ms | 146 / 179 ms | CONCLUSIVE within supplied abstraction |
| 8x8 / 8 sizes | 3 s | 1496 / 1613 ms | 379 / 439 ms | 3.8 / 5.0 ms | 1121 / 1173 ms | CONCLUSIVE within supplied abstraction |
| 12x12 / 12 sizes | 3 s | 3194 / 3234 ms | 467 / 499 ms | 6.6 / 6.7 ms | 2480 / 2502 ms | INCONCLUSIVE; action certificates incomplete |
| 12x12 / 12 sizes | 4 s | 4179 / 4213 ms | 463 / 475 ms | 6.5 / 8.6 ms | 3463 / 3478 ms | INCONCLUSIVE; action certificates incomplete |
| 12x12 / 12 sizes | 5 s | 5132 / 5153 ms | 397 / 415 ms | 7.5 / 7.9 ms | 4410 / 4510 ms | INCONCLUSIVE; action certificates incomplete |

Each row has three synthetic variants on this Windows Chromium computer (12 logical processors reported by the browser). Nearest-rank p95 is the largest of only three observations, not an SLA or a population estimate. Every warm snapshot was a hit with an identical result digest; every cold request was a miss. `COMPLETE` is the job lifecycle stop, not a claim of solver precision. These growth results stay `APPROXIMATE` because their sizing/depth abstraction omits legal continuations. Actual worker peak heap cannot be measured with this browser API; reservation/allocation estimates are labelled as estimates.

The largest fixture does not justify a promise of conclusive answers in 3, 4 or 5 seconds. Its valid partial result is retained and the reason remains visible. The usable interactive path is progressive computation, an exact-key warm cache, certified candidate refinement and bounded deeper work. The production worker evidence below validates this computation path separately from authenticated gameplay. A successful Cloudflare build alone is not production mathematical or authenticated-flow validation.

## Online evidence, 2026-10-01

Implementation commit `603e7863bb0a1af5a87b810baea0b5ff9dd42509` was deployed automatically from `hosting/cloudflare-oracle-migration`, by Cloudflare build `75fc2990-a969-40f9-a823-140825626d24` (successful; 38 seconds). The public QA page and manifest on `https://theibs-omaha.theibs.workers.dev` loaded the exact expected worker fingerprint `7cc1aa41fa10684cf2d3da8123a76007fffb87138c286345c5ee6eba3536a501`. The capture metadata and raw-report digest are in `benchmarks/browser-river-hu-production.json`.

The real online browser worker passed 105 assertions in 36 recorded runs: separated actions, exact tie, non-tied overlapping best-response bounds, five fixed-work Node/browser reference cases (including the independently validated LP game), nine mathematically relevant cache changes, owner isolation, obsolete cancellation and 15 growth cold/warm pairs. The selected Node regression gate passed 140 tests. This is not a claim that the whole repository test suite was run.

| Declared scenario | Cold budget | Cold final p50 / p95 | First strategy p50 / p95 | Warm p50 / p95 | Bounds cost p50 / p95 | Comparison |
| --- | --- | --- | --- | --- | --- | --- |
| 4x4 / 5 sizes | 3 s | 446 / 522 ms | 222 / 307 ms | 2.4 / 4.4 ms | 182 / 200 ms | CONCLUSIVE within supplied abstraction |
| 8x8 / 8 sizes | 3 s | 1460 / 1770 ms | 337 / 597 ms | 3.8 / 4.9 ms | 1081 / 1101 ms | CONCLUSIVE within supplied abstraction |
| 12x12 / 12 sizes | 3 s | 3218 / 3252 ms | 463 / 511 ms | 5.3 / 8.9 ms | 2484 / 2498 ms | INCONCLUSIVE; action certificates incomplete |
| 12x12 / 12 sizes | 4 s | 4266 / 4303 ms | 510 / 543 ms | 6.7 / 8.6 ms | 3465 / 3516 ms | INCONCLUSIVE; action certificates incomplete |
| 12x12 / 12 sizes | 5 s | 5276 / 5333 ms | 533 / 566 ms | 8.8 / 10.7 ms | 4424 / 4488 ms | INCONCLUSIVE; action certificates incomplete |

Cold/warm refers to the solver result cache, not an empty browser HTTP cache, first page load or a cold Render instance. First-strategy wall time is measured from the requested study job. Existing non-river-HU calculations and APIs still run on Render and are not covered by this browser latency evidence.

The same Windows Chromium device was used locally and online. Each row has three synthetic variants; nearest-rank p95 is their maximum and cannot establish a device-independent SLA. All growth cold requests missed and every warm request hit an identical snapshot. Their global NashConv stayed below 0.01 BB at the returned checkpoint, but the 12x12 tree still had missing action certificates; global convergence did not override comparison uncertainty. Growth games remain APPROXIMATE because of explicit continuation/sizing restrictions.

The obsolete active worker was terminated in 0.3 ms at the client; its phase/update version remained CANCELLED/3 when the replacement finished. This measures browser job cancellation, not provider-side server cancellation. Text entry and a touch-like button click remained available during online compute; the heartbeat sampler did not establish hard real-time scheduling or actual microphone contention. Peak worker heap is unavailable; retained allocation/reservation estimates are labelled accordingly.

### Deployment boundary and remaining gate

The public worker runs online without Oracle, a credit card or a Llama dependency. Render is still the API/auth/history service. Its free storage remains ephemeral; stopping it would interrupt those functions and is not safe in this delivery.

The authenticated app gate on the new origin is PENDING: Google authentication returned to the old Render URL, and the Supabase project administration session requires human sign-in before the exact new redirect can be configured and checked. No tokens were copied across origins, no authentication bypass was added and no private history migration is claimed. The local actual app already passed card keyboard entry, hand progression, study setup and desktop/mobile composition, but that is explicitly separate from authenticated Cloudflare gameplay. Physical phone performance and human microphone recognition were not executed.
