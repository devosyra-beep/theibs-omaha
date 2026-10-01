# EV closure — 0.14.10

## Closure instruction

The user accepted the current stage and explicitly stopped further investigation,
benchmarks, refactors, mathematical changes and optimization in this session.
The local/production performance difference is a known limitation for a future
backend/performance stage. INCONCLUSIVE remains a valid result.

No new code commit or deployment was made after that instruction. This closure
record is the only new workspace document and remains uncommitted. The validated
published source is preserved.

## Active source and deployment

- Branch: `hosting/cloudflare-oracle-migration`.
- Active Git/local HEAD: `54854da75944217765a9b09148b67a3f4e208937`.
- Commit: Optimize browser river HU certificates and validate independent action bounds.
- Cloudflare Worker: `theibs-omaha`, dedicated THEIBS account.
- Git-connected build/deploy: `4bdcde6a-c828-4275-a08a-eda6912919b6`.
- Public app: https://theibs-omaha.theibs.workers.dev/app
- Published validation page: https://theibs-omaha.theibs.workers.dev/browser-solver-validation.html
- Published numerical source fingerprint observed before closure:
  `f280932b2d80b1b49f96fe0c5e9ac15e15aa9b06dfb68c1c3dcdd2f8ddc93aed`.
- Interface/API release: 0.14.10; adaptive contract V5; CFR+ and action certificates V1.
- Render remains the existing auth/API/history/heuristic upstream; it was not
  changed or stopped in this delivery.

## Current EV and established evidence

The existing finite PLO5 High river heads-up solver retains exact declared-range,
blocker and showdown enumeration, cent-ledger utilities, CFR+, full prior and
outward action-conditioned bounds. Trusted compilation reuse is enabled in the
browser only. Default Node execution stays uncached; an always-on Node proposal
was rejected after measurement.

Current-hand EV against the returned profile, full-prior private-information-set
commitment bounds and global convergence remain distinct. No full PLO5 Multiway
GTO or current-hand equilibrium-EV guarantee is claimed.

- Integrated tests: 237/237 passed, no failures or skips.
- Additional expanded mathematical tests: 24/24 passed, no failures or skips.
- Independent QA: 17 cases, 16 sequence-form LP cases, 37 conditioned actions,
  74 strict refinement checks, 37 retained-job certificate checks and 120
  independent terminal payout checks. Rational bound witnesses use no added
  epsilon. Default Node/browser opt-in match exactly at fixed work.
- Real local browser: 147 assertions passed, including 21 fixed-work references,
  cache invalidation/owner isolation, overlapping bounds and stale-job cancellation.
- Build passed; the Git-connected deploy delivered the validated browser graph.
- Online observations already completed: nine cold/warm pairs, 54 passing
  assertions, no mathematical contract failures. Input and tap were processed
  during solving. No further production test battery was run after closure.

No critical frontend bug was identified in the performed checks. Authenticated
gameplay, physical-phone performance and human speech recognition were not
certified by these synthetic tests.

## Observed performance

Each cell contains three synthetic samples on the same Windows computer. Online
means Cloudflare-delivered browser computation, not compute running on Cloudflare.
p95 is the maximum observed sample, not a population percentile or an SLA.

| Explicit combinations per seat / sizes | Local cold p50 / p95 | Online cold p50 / p95 |
| --- | --- | --- |
| 4 × 4 / 5 | 211 / 249 ms | 670 / 700 ms |
| 8 × 8 / 8 | 528 / 588 ms | 2,119 / 2,242 ms |
| 12 × 12 / 12 | 1,871 / 2,030 ms | 3,153 / 3,159 ms |

For the largest study:

| Metric | Local p50 / p95 | Online p50 / p95 |
| --- | --- | --- |
| First worker response | 225 / 230 ms | 339 / 544 ms |
| First usable EV | 228 / 233 ms | 343 / 550 ms |
| Worker compute | 1,794 / 1,962 ms | 3,003 / 3,008 ms |
| Full action refinement | 1,569 / 1,741 ms | 2,536 / 2,578 ms |
| Certificate-only work | 71 / 87 ms | 147 / 179 ms |
| Warm snapshot delivery | 7.5 / 7.9 ms | 12.4 / 13.6 ms |

The online larger runs reached the configured 3-second compute ceiling and
returned the available estimate with APPROXIMATE / INCONCLUSIVE. End-to-end
delivery includes startup, message and reporting overhead, hence approximately
3.16 seconds. The local larger runs certified a leader inside that same finite
declared abstraction. This difference is preserved, not explained or optimized
further in this session.

All nine online cold requests were misses; all nine warm reads were hits returning
the identical snapshot, with zero new Worker computation. The earlier baseline
9392b53 observed 2,567 / 2,650 ms for the largest online study. Separate sessions
are not a controlled interleaved same-origin performance experiment.

## INCONCLUSIVE and known limits

- True action ties and overlapping commitment bounds remain INCONCLUSIVE.
- Rare actual-Hero cases can retain overlapping bounds at fixed work.
- Percentage/capped fees remain unqualified for current commitment certificates.
- The largest online timed studies stopped before sufficient certification.
- Comparison requires compatible state, ranges, utility, fees, tree/sizing and
  versions, and dominance over every alternative. Global NashConv is not an
  action-EV confidence interval.
- Larger declared trees still have explicit sizing/aggression abstractions.
- Compilation retention (8 MiB cap) and solver working memory are estimates;
  browser peak heap was not measured. Three seconds is a target, not a universal
  device/server latency guarantee.

## Cleanup and Git state

At closure all three QA pages had completed; no active benchmark remained to
interrupt. All three subagents were completed. Temporary validation tabs were
closed and the temporary QA server on port 4185 (verified owned PID24436) was
stopped. A subsequent owned-work check found zero matching benchmark/test Python
or Node processes and no listener on 4185. Essential Codex runtimes and unrelated
user processes were preserved.

`git status --short` was clean before writing this file. The only post-closure
workspace change is this uncommitted `POST_CLOSURE.md`. No code was reverted,
refactored or optimized after the stop instruction.

## Exact changed files

The following 27 files belong to the published commit compared with immediate
baseline `9392b539548c7b79a7128219d489d147230c1d37`. Paths are relative to this
checkout: `C:/Users/paulo.otavio_involve/Downloads/theibs-omaha-main/deployment-checkout`.

```text
codigo-fonte/docs/benchmarks/river-hu-certificate-optimization.json
codigo-fonte/docs/benchmarks/river-hu-expanded-contract.json
codigo-fonte/docs/river-hu-certificate-optimization.md
codigo-fonte/docs/river-hu-expanded-validation.md
codigo-fonte/hosting/cloudflare/prepare.cjs
codigo-fonte/public/browser-solver-client.js
codigo-fonte/public/browser-solver-manifest.json
codigo-fonte/public/browser-solver-reference.json
codigo-fonte/public/browser-solver-validation.html
codigo-fonte/public/browser-solver-validation.js
codigo-fonte/public/browser-solver-worker.js
codigo-fonte/public/multiway-solver-ui.js
codigo-fonte/public/multiway-ui.js
codigo-fonte/public/service-worker.js
codigo-fonte/scripts/benchmark-river-certificates.cjs
codigo-fonte/scripts/browser-solver/worker-entry.js
codigo-fonte/src/solver/action-conditioned.js
codigo-fonte/src/solver/extensive-solver.js
codigo-fonte/src/solver/job-worker.js
codigo-fonte/src/solver/versions.js
codigo-fonte/test/browser-solver-adapter.test.cjs
codigo-fonte/test/browser-solver-client.test.cjs
codigo-fonte/test/helpers/generate-browser-solver-reference.cjs
codigo-fonte/test/helpers/river-hu-expanded-contract-reference.cjs
codigo-fonte/test/river-hu-expanded-contract.test.cjs
codigo-fonte/test/solver-compilation-context.test.cjs
codigo-fonte/test/solver-ui.test.cjs
```

The additional file requested for closure is `POST_CLOSURE.md` at the checkout root.
Previously gathered raw online measurements were preserved under ignored
`validacao/river-hu-optimization/browser-final-online.json`; they are not new code
or a new test run. The previously committed evidence artifact predates the final
online observations; this record contains their accepted closure summary.

## Future backend stage — not executed here

- Investigate and reproduce the accepted local/online performance difference.
- Improve backend scheduling/resource isolation and measure concurrent EV jobs.
- Define device-dependent interactive budgets and deployment capacity from data.
- Complete authenticated Cloudflare-origin/OAuth gameplay validation separately.
- Resolve the existing free-backend history persistence limitation.

Do not silently broaden streets/players, re-label approximations as full GTO,
erase valid INCONCLUSIVE states or infer an error interval from global NashConv.

**STATUS: EV ATUAL FECHADO PARA ESTA VERSÃO**

## Subsequent authorized slice — 2026-10-01

The entry above is the historical closure of commit `54854da`. A subsequent
user-authored request explicitly authorized a bounded inconclusive-pipeline
delivery. It does not reopen the infrastructure/performance investigation.
The reference solver, payoff rules, streets, player counts and finite range
coverage are preserved. The comparison policy and adaptive execution contract
are versioned independently of the mathematical game.

### Deferred after the pipeline delivery

- Investigating Cloudflare/local performance differences remains deferred.
- Deeper parallelism, a new solver algorithm, retained cross-analysis compiled
  graphs and speculative mathematical canonicalization remain deferred.
- Larger ranges, more sizings, turn/flop and multiplayer coverage are not part
  of this delivery.
- Certification of actual-hand equilibrium action EV is a separate mathematical
  problem. Current action-conditioned intervals concern the full-prior
  commitment game, and practical equivalence must keep that explicit scope.
- Production workload, physical-device latency and a universal three-second
  service guarantee require a future backend/performance stage.

The delivery evidence is recorded in
`codigo-fonte/docs/inconclusive-pipeline-validation.md` and its benchmark JSON.
