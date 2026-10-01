# River heads-up certificate optimization

## Scope and acceptance

This package improves execution and validation of the existing finite PLO5 High
river heads-up study. It does not add a street, player, unknown range, legal
sizing or strategic abstraction. The interface/API release remains 0.14.10;
the generated browser source fingerprint identifies the numerical source graph.

The immediate comparison baseline is `9392b539548c7b79a7128219d489d147230c1d37`.
The validated historical river baseline remains
`1c9a91fd1555297b50c3db5e092868516436b60e`.

Acceptance requires exact mathematical parity at matching work, independent
small-game checks, correct cache and checkpoint invalidation, progressive
browser responses, and measured cold/warm execution. A lower runtime alone
does not establish greater coverage, precision or a full-hand equilibrium.

## Mathematical boundaries

- Preserve exact declared joint-range/blocker/showdown enumeration, incremental
  terminal utilities, alternating CFR+, full original prior and perfect recall.
- Preserve outward-rounded information-set best responses; global NashConv is
  not an action EV confidence interval.
- Separate the current hand's EV against the returned strategy, the full-prior
  game value with a private information-set action fixed, and global convergence.
- Only certify a commitment leader when its lower bound exceeds every compatible
  competing upper bound. Never remove an action because its point estimate is low.
- Preserve honest `SOLVED`, `REFINING`, `APPROXIMATE`, `HEURISTIC`, `NOT_SOLVED`
  qualification independently of `CONCLUSIVE`/`INCONCLUSIVE` comparison.
- Preserve mathematical hashes, utility/rake/range/tree identity and stale-result
  cancellation. Voice, card entry and hand progression remain outside solver work.

## Execution change

An execution-local opaque compilation capability permits reuse only of an owned,
immutable game and matching resource limits. It cannot be serialized into a
checkpoint or shared across decisions. The original graph is reused within a job;
one newly conditioned graph is shared between its solve and certificate, then
released. Conditioned trees are not retained across action batches.

This capability is enabled only by the trusted browser entry point. Request or
checkpoint fields cannot enable it. Default Node jobs remain uncached: the five
paired Node runs did not justify always-on reuse (APP_FIRST_PASS p50 was 3.3%,
2.6% and 3.9% slower in the three growth cells). That configuration was rejected;
its measurements remain in the evidence artifact rather than being reported as
a server speedup. The adaptive cache/checkpoint contract is V5; CFR+ and
action-certificate versions remain V1.

Retained base plus conditioned compilation is bounded by an **estimated** 8 MiB
allocation cap. It is not a measured process/Worker heap limit. Oversized cases
fall back to the unchanged uncached compiler. Owned contexts and private proof
sets are released on completion, cancellation and failure.

The previous three-entry conditioned-tree cache was rejected because it was
slower in seven of eight paired runs. That experiment remains in
`benchmarks/river-hu-conditioned-cache-negative-experiment.json`.

New browser telemetry distinguishes acknowledgement, worker readiness, first
worker response, first usable value, terminal lifecycle time, current slice work,
logical-job work and cumulative decision work. A warm memory snapshot records
its source timing separately and charges zero new worker work.

## Verification record

The final candidate passed **237 integrated tests** and **24 additional expanded
contract tests**, with no failures or skips. The expanded oracle covers 17
scenarios, 16 numerical sequence-form LP references, 37 conditioned actions,
74 strict refinement-bound checks, 37 retained-job bound checks and 120
independent integer-cent terminal payouts. An exact rational feasible-policy
envelope supplies the zero-tolerance bound witness; a floating LP point is not
an action confidence interval. Node default and browser capability agree
exactly at matching work in all 17 small cases.

Real local Chromium passed **147 assertions**, including all 21 fixed-work
reference cases, nine cold/warm pairs, cache dimensions and owner isolation,
true ties, non-tied overlapping bounds, and obsolete-job cancellation.
The QA page and Cloudflare build now reject a stale reference fingerprint,
worker digest or adaptive checkpoint version before running/publishing it.

### Local browser, 3-second compute budget

| Explicit ranges / aggressive sizes | Cold p50 / p95 | First usable value p50 / p95 | Warm p50 / p95 | Certificate-only p50 / p95 |
| --- | --- | --- | --- | --- |
| 4 × 4 / 5 | 211 / 249 ms | 122 / 167 ms | 1.5 / 2.3 ms | 8.2 / 8.7 ms |
| 8 × 8 / 8 | 528 / 588 ms | 95 / 160 ms | 3.0 / 3.3 ms | 23.3 / 25.3 ms |
| 12 × 12 / 12 | 1,871 / 2,030 ms | 228 / 233 ms | 7.5 / 7.9 ms | 71.0 / 87.4 ms |

The freshly measured online baseline `9392b53` took 2,567 / 2,650 ms in the last
cell. This local candidate and the online baseline both run on the same computer;
they are separate browser sessions, not an interleaved same-origin controlled
experiment. The baseline lacked certificate-only instrumentation: unavailable
cost is null, never zero. Both builds certified the leader in these timed studies.
First response, first usable value, preparation and action refinement costs are
reported separately in `benchmarks/river-hu-certificate-optimization.json`.

The larger study retains all 144 compatible worlds, 5,617 nodes and 14 root
alternatives. Every warm hit returned the identical completed snapshot with zero
new Worker work. Input and tap events were processed during the larger cold run;
this does not establish acoustic or physical-phone performance.

Online final-build validation is recorded after Git-connected publication. The
build fingerprint is
`f280932b2d80b1b49f96fe0c5e9ac15e15aa9b06dfb68c1c3dcdd2f8ddc93aed`.
The interface/API release remains 0.14.10 to preserve engine parity.

Local Node work, online-delivered browser computation and authenticated gameplay
are separate evidence classes. Three samples per browser cell make p95 the
maximum observation, not a universal 3-second SLA. Browser Worker peak heap,
authenticated account gameplay and human speech performance are not established
by these instruments. Ties, overlap, unsupported fees and uncovered games retain
their honest qualification and INCONCLUSIVE status.
