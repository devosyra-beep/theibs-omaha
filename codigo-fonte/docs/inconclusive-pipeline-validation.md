# River HU decision outcome validation

## Scope

This gate compares baseline `54854da75944217765a9b09148b67a3f4e208937` with the new adaptive V6 outcome pipeline. It covers the supplied finite PLO5 heads-up river model and manually supplied complete study ranges. It does not establish full-hand equilibrium, current-hand equilibrium EV, range quality, profitability, or an authenticated hosted game.

The three quantities remain separate:

- Current-hand profile EV uses the returned original strategy and the actual Hero information set.
- Action certificates bound the ex ante value of the full original prior with one private-information-set commitment.
- Global NashConv measures unilateral profile improvement. It is not a confidence interval for either value above.

`NEAR_EQUIVALENT` concerns **full-prior commitments**. It requires the existing global convergence criterion, compatible valid outward bounds for every declared alternative, at least two group members, and the upward-rounded difference `maxUpper(all alternatives) - minLower(group) <= epsilon`. The default epsilon is 0.01 BB. This is a one-sided epsilon-optimality guarantee: every group member is at most epsilon below the best declared commitment. It does not assert absolute closeness to a far worse alternative outside the group. Other declared actions remain in that maximum even after they are excluded from further certificate refinement. A near result does not change strict `decisionPrecision` or prove actual-hand EV equivalence.

## Independent mathematical gate

Status: **PASS — 21/21 tests, zero failures and skips; 1.97 seconds.** Adaptive V6 and CFR V1 sources remained unchanged throughout execution. Seven small retained-result cases have every action certificate checked against exact-game independent rational LP witnesses. Two fresh LP calls establish the new near-tie reference. Percentage-fee certificates remain unsupported. The report is [inconclusive-pipeline.json](benchmarks/inconclusive-pipeline.json).

The new suite exercises true action ties, a new approximately 0.004 BB near tie, threshold rounding, zero epsilon, a third wide, missing or illicitly removed candidate, strict dominance, incompatible origin and status, global convergence, policy isolation, blockers, rare Hero mass, fixed rake and unsupported percentage fees. It reuses exact-game independent LP witnesses from the expanded reference artifact. The new near-tie input receives two fresh conditioned sequence-form LP solves through the existing SciPy runtime. Exhaustive pure-policy evaluation produces rational feasible-policy endpoints; production endpoint containment uses **zero added tolerance**. Numerical LP residual tolerances are not applied to production bounds.

The baseline maps `CONCLUSIVE` to `CERTIFIED` only when global convergence and the compatible strict comparison against every alternative are verified. Baseline overlap stays `INCONCLUSIVE`; it is not reclassified using the new near policy.

## Bounded performance protocol

Status: **PASS — 24 paired samples / 48 fresh Workers, 17.44 seconds; both source sets stable.** The first run, before a reason-text correction to express one-sided epsilon optimality, is preserved separately in the ignored validation directory. The results below use the entire final rerun; neither run's best samples were selected or pooled.

Eight fixtures use three alternating paired samples per arm. Both arms run in fresh real Node Workers, with the same trusted browser compilation capability, a 3-second compute allowance and the app's initial 1,000-iteration cap. No timed budget or CFR arithmetic is patched. There is no warm result cache or optional continuation. Baseline sources are extracted verbatim by `git archive` into the ignored validation directory, with archive and source digests recorded.

The parent stopwatch includes Worker startup. Progress messages record the first usable current-hand value, all-bounds completion, first strict certified outcome and first near-equivalent outcome separately. Node message progression does not validate browser input responsiveness; the real browser gate is separate.

Cost attribution records tree build, original strategy solve/evaluation, whole action refinement, nested outward certificate evaluation and total compute. Certificate time is included inside action refinement and must not be added twice. Heap snapshots and progress-sampled heap maxima are not true peak memory; RSS covers the process. The hard 12×12/12-sizing exact game has no independent LP reference and carries no LP error or coverage claim.

The report retains raw paired results and candidate-minus-baseline differences, including slower outcomes. p50/p95 use nearest rank and are descriptive for this small local cohort. Outcome percentages include counts and denominators and are not production rates.

### Observed results

| Metric | Baseline | Candidate |
|---|---:|---:|
| Total observed p50 / p95 | 64.75 / 2,563.25 ms | 59.59 / 2,317.62 ms |
| First usable value p50 / p95 | 51.04 / 322.20 ms | 52.55 / 320.73 ms |
| Compute wall p50 / p95 | 17.89 / 2,463.31 ms | 20.40 / 2,231.96 ms |
| Strict certified outcomes | 21/24 (87.5%) | 12/24 (50%) |
| Near-equivalent outcomes | 0/24 (0%) | 12/24 (50%) |
| Inconclusive outcomes | 3/24 (12.5%) | 0/24 (0%) |

These outcome categories are mutually exclusive. Near equivalence takes precedence when proved. It does not imply a strict leader; strict precision remains a separate result. The true tie changes from baseline inconclusive to a proved near group. The near tie, rare-Hero study and hard declared game also finish as near groups. The actual-hand EVs remain separate; no statement that these hands have interchangeable EV is made.

| Fixture | Baseline total p50 | Candidate total p50 |
|---|---:|---:|
| Nuts against a bet | 64.11 ms | 59.59 ms |
| True action tie | 62.07 ms | 58.32 ms |
| Near action tie | 61.46 ms | 58.61 ms |
| Fixed rake | 60.47 ms | 57.32 ms |
| Joint blockers and nonuniform prior | 64.94 ms | 60.00 ms |
| Rare actual Hero hand | 83.21 ms | 65.19 ms |
| Short stacks and legal sizing | 67.43 ms | 63.00 ms |
| Hard 12×12 / 12 sizings | 2,563.25 ms | 2,317.62 ms |

**Observed regressions are retained:** first-value p50 increased by 1.52 ms; one paired hard sample's first value was 184.47 ms later. Compute-wall p50 increased by 2.51 ms. First-all-bounds p50/p95 increased from 56.08/2,296.80 to 57.67/2,312.93 ms. Whole-result wall time includes different startup paths and diagnostic instrumentation, so the small-fixture wall improvement is not a causal algorithm claim. The hard-case median action refinement decreased from 2,167.74 to 1,892.39 ms and nested certificate evaluation from 119.83 to 109.88 ms, while original global solve increased from 165.39 to 195.66 ms and original evaluation from 5.09 to 6.36 ms. These are measured phase costs and describe this run only.

All 102 small-case action certificates across both arms and three repetitions contained the rational feasible-policy envelopes and numerical LP points with zero added endpoint tolerance. The largest candidate interval-midpoint distance from a numerical LP point was 0.003432 BB (blocker case); this is descriptive error for a full-prior commitment midpoint, not a confidence interval or current-hand EV error. Hard-case LP error stays `null`.

No compute budget or convergence threshold changed. Global NashConv, strict precision and original game/tree hashes retain their established targets. The near stopping rule adds a separate epsilon proof; different stopping points need not return identical profile EVs, frequencies or work counts.

## Reproduce

From `codigo-fonte`, with no concurrent solver calculation:

```powershell
node scripts/benchmark-inconclusive-pipeline.cjs --prepare
$env:THEIBS_REFERENCE_PYTHON = 'C:/Users/paulo.otavio_involve/AppData/Local/Temp/theibs-lp-reference-venv/Scripts/python.exe'
node --test --test-concurrency=1 test/solver-inconclusive-pipeline-reference.test.cjs
node scripts/benchmark-inconclusive-pipeline.cjs
```

The suite creates an ignored gate report only after all its checks pass and source digests remain stable. The benchmark requires that exact source gate and writes `docs/benchmarks/inconclusive-pipeline.json` only after verifying both arms stayed unchanged.

## Integrated validation and browser evidence

The bounded integration run exercised 267 tests: 264 passed and three lifecycle
cache tests initially failed because their harness still constructed the old
cache key without a normalized comparison policy. The fixture key was corrected;
all four tests in that file passed, including the real interrupted solver test.
The new worker-policy and rendered EV suites additionally passed 14/14 tests.
Across these gates, all 281 distinct tests passed; no production cache invariant
or mathematical assertion was weakened. The unchanged numerical core,
action-conditioned utility/bounds, river adapter and strict precision modules
have no Git diff against the baseline.

Browser Worker fingerprint:
`309aafd9b23d540fddabaf552357bd9b633301d935a0f6e39f597e7e19bc29b6`.
The generated 21-case fixed reference, bundle freshness check and existing
Cloudflare dry-run build passed. The product remains version 0.14.10; the adaptive
checkpoint contract is V6 and the comparison policy/outcome contracts are V1.

Actual local browser self-test, 21-case fixed parity, cache invalidation and
cancel/replacement checks passed. Changes to board, prior weights/combinations,
stakes, rake, sizing/tree, utility/abstraction, owner, revision and comparison
policy are tested for isolation. Changing policy does not change the
mathematical game hash but cannot reuse a completed outcome under another
policy. The cancellation gate uses a real obsolete browser job and replacement.

One additional bounded hard 12×12/12-sizing cold/warm pair observed first usable
EV at 618.70 ms, an ESTIMATING to NEAR_EQUIVALENT transition at 2,866.90 ms,
completion at 2,894.10 ms and a warm hit at 7.50 ms. The cold result digest and
warm digest matched, with no new warm solver work. Its original strategy solve
was 262.80 ms, whole action refinement 2,373.80 ms and nested certificate
evaluation 111.80 ms. This is one browser sample, not a p50/p95 or SLA. Text entry
and a button tap were accepted during computation. The heartbeat's largest
observed gap was 358.50 ms; this is not a voice latency measurement.

Desktop and 393×852 mobile viewport checks covered strict certification and
overlap/practical equivalence, with no document horizontal overflow. Captures
and visible raw JSON are retained in ignored `validacao/inconclusive-pipeline`.
These are isolated public fixtures, not authenticated gameplay screenshots.

Publication follows the existing Git-connected Cloudflare production branch.
The final commit/deploy identity and bounded online gate receipt are recorded
after deployment in that validation directory and the delivery response. No
infrastructure investigation, new provider or paid service is part of this
release. The Render fallback is not redeployed here and retains its previous
server solver policy; the newly published pipeline executes in the browser.

## Remaining validation boundaries

Authenticated game behavior, physical-phone performance and human speech
recognition remain unverified by this gate. A mobile viewport is not a
physical-phone measurement. Larger finite games have no new independent LP
oracle and can still exhaust time/iteration budgets or retain wide bounds.
Different/local online performance remains a recorded limitation, not an
investigation in this task.

## Exact changed files for this slice

Paths relative to the repository root:

```text
codigo-fonte/docs/benchmarks/river-hu-expanded-contract.json
codigo-fonte/public/browser-solver-client.js
codigo-fonte/public/browser-solver-manifest.json
codigo-fonte/public/browser-solver-reference.json
codigo-fonte/public/browser-solver-validation.js
codigo-fonte/public/browser-solver-worker.js
codigo-fonte/public/multiway-solver-ui.js
codigo-fonte/public/multiway-ui.js
codigo-fonte/scripts/browser-solver/worker-entry.js
codigo-fonte/scripts/build-browser-solver.cjs
codigo-fonte/server.js
codigo-fonte/src/solver/job-service.js
codigo-fonte/src/solver/job-worker.js
codigo-fonte/src/solver/solution-cache.js
codigo-fonte/src/solver/versions.js
codigo-fonte/test/browser-solver-client.test.cjs
codigo-fonte/test/helpers/generate-browser-solver-reference.cjs
codigo-fonte/test/multiway-ev-ui.test.cjs
codigo-fonte/test/solver-cache-invalidation.test.cjs
codigo-fonte/test/solver-compilation-context.test.cjs
codigo-fonte/test/solver-job-service.test.cjs
codigo-fonte/test/solver-paused-reuse.test.cjs
codigo-fonte/test/solver-ui.test.cjs
POST_CLOSURE.md
codigo-fonte/docs/benchmarks/inconclusive-pipeline.json
codigo-fonte/docs/inconclusive-pipeline-validation.md
codigo-fonte/scripts/benchmark-inconclusive-pipeline.cjs
codigo-fonte/src/solver/decision-outcome.js
codigo-fonte/test/browser-solver-worker-policy.test.cjs
codigo-fonte/test/solver-decision-outcome.test.cjs
codigo-fonte/test/solver-inconclusive-pipeline-reference.test.cjs
```
