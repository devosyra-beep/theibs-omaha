# Expanded heads-up river validation

## Scope and evidence

This is **MODEL** validation of explicitly supplied, valid observed PLO5 high
river ledgers. It expands the private-hand, fee and monetary contexts beyond
the earlier repeated growth fixtures. Inputs remain synthetic studies; they are
not observed account hands or population range estimates.

The final Node/LP integration run passed **24 tests, zero failures and zero
skips**, in 55.568 seconds. The regenerated tracked report covers **17 scenarios**,
including **16 eligible constant-sum LP scenarios**, **37 conditioned actions**,
**74 strict refinement-bound checks**, **37 strict retained-job certificate
checks** and **120 independently calculated terminal payoffs**.

All 17 scenarios also compare default Node execution against the explicit trusted
browser compilation-reuse route at matched fixed work. Hashes, CFR checkpoints,
strategies, reporting EV, convergence, bounds and qualification match exactly.
The source versions are `THEIBS_HU_ADAPTIVE_V5` and
`THEIBS_FULL_TREE_CFR_PLUS_V1`. Solver and reference source digests matched at
the start/end of report execution: `sourceStableThroughoutRun: true`.

The earlier V4 integration report and V5 pre-routing report are preserved under
`validacao/browser-solver` outside release artifacts. They are not the final
candidate provenance. The tracked final report is
`docs/benchmarks/river-hu-expanded-contract.json`.

Actual browser transport for these new fixtures and performance/budget A/B
results remain separate gates. These small-game Node/LP checks establish no
serving latency or universal speedup. Desktop mobile viewports do not establish
physical-phone performance.

## Cases

| Study | Independent expectation / purpose |
| --- | --- |
| Royal-flush nuts facing a bet | CALL current-hand EV 30 BB; uneven opponent weights |
| Marginal positive call | CALL current-hand EV 2 BB |
| True action tie | CALL and FOLD commitment values both zero; comparison stays INCONCLUSIVE |
| Marginal negative call | CALL current-hand EV -2 BB |
| Fixed fee of 8 | CALL current-hand EV -0.4 BB; fee changes the preferred action |
| Decimal fixed fee of 0.3 | CALL current-hand EV 1.91 BB |
| Equal six-high straights | Split showdown; CALL current-hand EV 10 BB. A showdown tie is not an action-value tie |
| Joint blockers with uneven Hero/opponent priors | Three compatible worlds; current-hand CALL EV 2 BB versus full-prior CALL commitment about 18.333 BB |
| Board-blocked range mass | Impossible board-overlapping hand is excluded and the compatible prior renormalized |
| Current bet changed from 10 to 11 | New call price and pot; CALL current-hand EV 1.6 BB |
| Earlier turn bet changed from 3 to 4 | New prior contribution and pot; CALL current-hand EV 2.6 BB |
| Unequal short stacks | Hero call is all-in; ledger legal support and capped transfer checked |
| Two private types with uneven weights | Hidden private information and strategic fold/call responses to two declared sizes |
| Rare current Hero hand | Full prior retained; fixed 512-work comparison remains INCONCLUSIVE |
| Short stacks at an unbet river decision | Legal size support changes from two bet totals to one |
| Capped percentage fee | Accepted fee study remains unqualified for commitment certificates under the current adapter; no LP equilibrium or CONCLUSIVE claim |
| Hero in the big blind / player 1 | Reversed utility orientation and public check/bet history; CALL current-hand EV 2 BB |

All stages keep three separate quantities:

- **Current-hand profile action EV:** conditional on the actual Hero combination,
  against the returned original-game policy, with only that action forced.
- **Private-information-set commitment value:** ex ante minimax value over the
  full original prior, with one action fixed at one Hero information set. Other
  Hero combinations keep their own decisions. A fold commitment can therefore
  have a positive range-level value.
- **Global convergence:** unilateral-deviation measurement for the returned
  profile in the declared finite game. NashConv is not an action-EV interval.

The current adapter conservatively qualifies constant-sum certificates only
for declared NONE/FIXED fees. PERCENT_CAPPED remains unqualified even when a
specific test's cap happens to make its terminal fee constant.

## Independent checks

The existing Python sequence-form compiler solves a numerical primal/dual LP
with SciPy/HiGHS. It independently restricts an information-set action and never
imports production CFR, best-response traversal or action conditioning. Its
residual tolerance describes only this numerical LP reference; LP success is
not a symbolic exact proof.

The realization-plan constraints and chance-weighted sequence payoff matrix
follow [Koller, Megiddo and von Stengel, Section 2](https://ai.stanford.edu/~koller/Papers/Koller%2Bal:GEB96.pdf).
The numerical method and feasibility/time options are documented in
[SciPy's HiGHS dual-simplex reference](https://docs.scipy.org/doc/scipy/reference/optimize.linprog-highs-ds.html).

The new Node QA oracle separately enumerates every pure policy for the small
supplied game. It evaluates utilities and normalized supplied binary64 chance
and behavior weights as **exact BigInt rational arithmetic**. For an independently
selected feasible LP policy pair, its exact worst-case Hero value and exact
best-response Hero value give a minimax envelope. The same enumeration checks
the production profile's two best responses independently.

Production outward bounds must contain both exact envelopes and the numerical
LP point using unchanged endpoints and **zero added tolerance**. Refinements
at 1 and 64 CFR iterations are checked. The adaptive fixed-work job's retained
certificates are checked separately, including exact base game/context identity.
Floating reporting EV comparisons and LP residual checks are labeled separately;
neither enlarges a certificate or declares an action dominant.

Each fixed-work job permits 512 work iterations and 5,000 ms and must finish
without a time ceiling. Mathematical early stopping is retained; matching work
does not mean forcing every converged case to spend all 512 iterations. The rare
Hero case uses the full 512-work allowance and remains INCONCLUSIVE.

Every action restriction must retain the complete chance prior and all other
information sets. Dominance requires a leader's lower bound to exceed the upper
bound of every alternative using the existing machine-rounding separation guard.
True ties and merely overlapping bounds stay INCONCLUSIVE.

An independent five-card ranker enumerates Omaha's exact two-hole/three-board
choices. Subsequent river contributions, uncalled refunds, fixed fees and terminal
payouts are independently calculated in integer cents. Initial pot/stacks come
from the observed ledger and are explicitly treated as inputs.

## Context, cache and resource gates

The cache tests use valid modeled inputs for range weights/source, Hero hand,
board, current and historical price/pot, stack, sizing support and fee model/basis.
Owner, hand and revision changes cannot obtain an obsolete browser snapshot.
An unchanged mathematical ledger can retain its mathematical game identity while
its delivery revision changes. Browser strong identity still binds hand/revision.

The injected browser-client test uses real Node solver results and checks a cold
miss, read-only warm snapshot, identical retained result and zero fresh worker
time. This is **HARNESS** evidence, not actual browser Worker or hosted execution.

Compilation reuse is enabled only by the trusted dependency capability
`{ compilationReuse: true }`. Default Node execution remains uncached. The public
request, input and checkpoint do not choose that execution capability. This
validation tests both routes and does not describe Node timing as a browser gain.

Exact QA limits are 1,600 nodes, depth 32 and 4,096 pure policies per player.
The current cases use at most 37 nodes and 16 policies per player. LP subprocesses
are sequential, with a 60-second process deadline and 32 MiB output cap; the
existing reference has a 30-second limit per LP. The QA runtime stays outside
the application and release artifacts. No packages were installed for this run.

Reproduce using the existing QA runtime:

```powershell
$env:THEIBS_REFERENCE_PYTHON = 'C:/Users/paulo.otavio_involve/AppData/Local/Temp/theibs-lp-reference-venv/Scripts/python.exe'
node --test --test-concurrency=1 test/river-hu-expanded-contract.test.cjs
node test/helpers/river-hu-expanded-contract-reference.cjs
```

The required LP gate fails when that runtime is unavailable; it never silently
skips. The generator exports input, canonical revision, exact game/context hashes,
per-action LP values and rational feasible-policy envelopes in
`docs/benchmarks/river-hu-expanded-contract.json` for matched-work browser QA.

No full-hand equilibrium, safe resolving, broad population-range quality,
authenticated hosted gameplay, physical-phone performance or human ASR result
is established by these tests.
