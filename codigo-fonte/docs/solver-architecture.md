# Multiway solver architecture and verification boundary

## Scope

This migration is restricted to Multiway. The confirmed hand ledger, voice,
keyboard, player library and existing Analysis/Train paths remain separate from
the solver. A calculation never records an action. There is one central decision
contract with an explicit numerical source. The new strategic core progressively
replaces the old policy evaluator as validated coverage expands; this is not a
pair of permanent products. During migration the old evaluator can supply a
clearly identified `HEURISTIC` fallback outside solver coverage.

A displayed result uses one source, one game/input revision and one quality
measurement. The interface must not combine a solver frequency with a legacy EV,
or present one model's convergence as evidence for another model's values. The
fallback does not gain a solver label when it is shown beside a pending job.

## Audit of the existing engine

| Component | Classification | Treatment |
| --- | --- | --- |
| `hand-flow.js` | Reusable rules and chip accounting | Authority for legal pot-limit actions, turn order, reopening, refunds, side pots and settlement. Solver transitions use this same code. |
| `multiway-session.js` | Reusable state and revision contract | Confirmed event ledger, hand identity, undo revision and next-hand archival. Presentation and solver results cannot mutate it. |
| `cards.js`, `variants.js`, `fast-evaluator.js` | Reusable PLO rules | Validate cards/blockers and evaluate exactly two private plus three community cards. |
| `equity-engine.js`, `joint-range-sampler.js` | Reusable equity calculation | Exact enumeration or sampled showdown expectation. Equity alone is not an action strategy or equilibrium. |
| `range-engine.js` | Reusable range validation | Validated combinations and weights. A solver subgame additionally requires explicit complete ranges for every seat in its chance model. |
| `rake-model.js` | Reusable cost model | Declared fee schedule, rounding and cap. An evaluation assumption never becomes an observed room charge or ledger settlement. |
| `multiway-evaluator.js` | Heuristic continuation / replaceable evaluator | Joint worlds plus a declared conditional action policy. Retained as an approximate fallback; its action EV and confidence intervals are not equilibrium certificates. |
| `opponent-policy.js`, `policyDistribution` | Heuristic opponent behavior | Card-strength multipliers and action models do not enter equilibrium mode. |
| `player-profiles.js` | Reusable observed statistics / exploit input | Frozen observations and manual hypotheses remain separate. Equilibrium mode does not use learned response probabilities as an equilibrium strategy. |
| `analysis-worker.js` | Reusable isolation pattern; insufficient solver lifecycle | Existing worker execution remains for its existing paths. Deep solving needs its own bounded queue, checkpoints and cancellation. |
| Existing manual result cache | Reusable for its existing contract; replaceable for solving | A sampled response cache is not a solver checkpoint and cannot be reused across incompatible games. |
| Legacy single recommended action | Obsolete as a solver presentation | A solved strategy may mix actions. Display its actual frequencies and EV, with scope and quality; do not manufacture frequencies from EV. |

No old calculation path is deleted merely because a solver module exists.

## Mathematical contract

The solver handles a finite extensive-form game with perfect recall. A decision
information set identifies the acting player, that player's private information
and the observed public history. Opponents' private cards must never select a
different action distribution within that information set.

The initial vertical slice uses deterministic full-tree CFR+ with alternating
player updates and a linearly weighted average behavioral strategy. Its terminal
payoffs come from the ledger. Counterfactual
regret updates exclude the updating player's own reach. Strategy averaging uses
that player's own realization reach. All members of an information set share
one regret vector and one action set. The algorithm follows the
[CFR+ formulation](https://arxiv.org/abs/1407.5042); this implementation does not
claim that a sampled showdown evaluation is CFR.

The verifier evaluates the returned average profile, not the final iteration.
For each player, it computes a best response to the other players' fixed
strategies, choosing one action across all histories in each information set:

`gain_i = max_sigma_i u_i(sigma_i, sigma_-i) - u_i(sigma)`

`NashConv = sum_i max(0, gain_i)`

Report both the sum and the largest unilateral gain in the game's utility unit
(bb for a PLO adapter). A deviation bound concerns the declared game only. It
does not measure omitted sizings, missing range support or play before the
subgame. Floating-point enumeration is not arbitrary-precision arithmetic.

The CFR regret-to-Nash guarantee used for two-player zero-sum games does not
automatically extend to three or more players or to outcome-dependent fees.
For those cases, a small **measured** unilateral-deviation bound is required;
iteration count, low local regret, elapsed time and beating a sample policy are
not substitutes. See the original [CFR paper](https://papers.nips.cc/paper_files/paper/2007/file/08d98638c6fcd194a4b1e6992063e944-Paper.pdf).

DCFR and MCCFR are possible future alternatives. They are not described as
implemented merely because they were evaluated during architecture selection.
DCFR changes regret and strategy weighting; using sampling additionally changes
the variance and verification budget. See [Brown and Sandholm's DCFR paper](https://arxiv.org/abs/1809.04040).

## PLO vertical slice

The initial adapter is deliberately bounded: river decisions, two or three
initial seats, explicit finite weighted ranges for every seat, and a disclosed
betting abstraction. Folded seats remain in the joint card model so that their
cards cannot be dealt to active players. Joint chance weights are products of
range weights, conditioned on all card collisions being absent. The current
Hero combo selects the output information set; it does not secretly disclose
that combo to opponents by conditioning the entire game on it.

The ledger supplies complete legal actions at every reachable public node. A
chosen finite sizing set or aggression cap changes the game and must be stated
in the result. Reaching a node/world/memory budget rejects the construction;
it must not silently cut branches, force checks, truncate raises or substitute
a showdown value for unresolved betting.

Payoffs are incremental from the current decision:

`terminal stack - current stack`

They therefore include returned chips and eligible awards and charge only
additional contributions. Their sum is the existing pot less terminal fees,
not necessarily zero. This constant existing pot does not change incentives;
outcome-dependent fees can change the game class. Showdown evaluation uses the
whole joint world and each pot's eligible players, never a sum of independent
heads-up equities.

A river re-solve is an equilibrium calculation **of that specified subgame**.
Without counterfactual-value constraints from a compatible prior solution it
does not certify equilibrium of the complete hand. No private future reveal or
subsequent action is allowed into a recorded decision's original game.

## Result qualification

Action coverage (`MODELED`, `NOT_MODELED`, `NO_DECISION`), tree coverage and
solution status are distinct. A modeled numerical estimate is not necessarily
solved. `PARTIAL` describes restricted tree coverage; it does not independently
certify strategy quality.

| Solution status | Meaning |
| --- | --- |
| `SOLVED` | A supported declared subgame passed the mathematical qualification and current deviation threshold. The claim is limited to that subgame. |
| `REFINING` | A real job is still running; the separate numerical quality describes the current completed snapshot. |
| `APPROXIMATE` | A valid strategy is available but the supported-game, completeness or convergence qualification for `SOLVED` is not satisfied. |
| `HEURISTIC` | The temporary legacy continuation evaluator supplied this result. Its action estimates are not equilibrium strategy frequencies. |
| `NOT_SOLVED` | No supported strategy result is available for this input. Missing numerical values remain absent. |

`src/solver/solution-status.js` owns this qualification. The initial `SOLVED`
gate requires a versioned PLO5 river game with two original seats, constant-sum
payoffs confirmed by both the adapter and the compiled tree, complete declared
chance enumeration, complete tree construction, all legal sizes in that subgame,
verified perfect recall, and exact consistent NashConv at or below `0.01 bb` for
the returned average profile. It checks the unrounded metric. Timeouts, elapsed
time and a high iteration count cannot promote a result.

Three-player or general-sum results stay `APPROXIMATE` in this release even if
their measured NashConv meets the threshold. The threshold flag remains visible
as measured evidence, separate from the stricter supported-game status. Restricted
betting abstractions also remain `APPROXIMATE`.

`SOLVED` does not automatically enable a GTO label. External PLO reference
validation is a separate gate, and the current release always keeps `gto: false`
and `fullHandEquilibrium: false` for poker results.

A production GTO label requires all of the following, with evidence attached to
the result:

1. Explicit game, variant, rules, ranges, positions, stacks, fee basis and sizing
   abstraction, all compatible with the current decision.
2. Complete construction of the declared game and legal information sets.
3. An appropriate equilibrium procedure and a reproducible returned strategy.
4. A best-response/convergence measurement below the declared threshold for
   that returned strategy.
5. Passed known-game and applicable independent poker-reference validation.
6. Clear restriction of the claim to the validated game or abstraction.

Broader independent poker-reference validation remains a GTO-label release gate.
The selected small river heads-up fixtures checked by the independent LP reference
do not certify every supported input, and production does not run LP for each
request. A numerically solved supported subgame still cannot
be called full-hand GTO. A forced betting abstraction cannot claim full-action PLO5
optimality. Multiplayer empirical strength is also a different claim: the
[Pluribus paper](https://doi.org/10.1126/science.aay2400) explicitly studies
strong multiplayer play, not a general CFR proof of multiplayer equilibrium.

Frequencies come only from the returned strategy at the specified information
set. Category or range-average frequencies require separate labels and proper
range/reach weighting. A frequency of 55% is not a recommendation to always
take that action. Unavailable EV/frequency is `null`, never numerical zero.

## Decision differences and numerical precision

`src/decision-precision.js` owns the comparison contract
`THEIBS_DECISION_PRECISION_V2`. A point difference is a descriptive quantity,
not evidence that its sign is resolved. `decisionPrecision.deltaEVBB` reports
the difference between the largest and second-largest comparable point EVs.
It is separate from the chosen action's loss and that loss as a percentage of
the pot. A missing value is never replaced with zero to complete the ranking.

Each comparison identifies `source`, `originVersion`, `resultStatus`,
`contextKey` and its value `target`. `version` identifies the comparison
contract; `originVersion` identifies the evaluator that produced the values.
Rows inherit the enclosing snapshot's provenance. Explicit per-row source,
model/solver version, status or context must agree with it. Incompatible rows
produce `INCOMPATIBLE_ORIGINS` and a null difference; a common fold reference
does not make different models comparable. The interface consumes this
contract instead of inferring precision from formatted numbers or tolerances.

For the legacy `HEURISTIC` evaluator, the supported uncertainty construction is
the simultaneous weighted-ratio Hoeffding interval with a union bound over
candidate actions and allowed stopping counts. Its scope is
`FIXED_CONTINUATION_POLICY`: fixed range assumptions, fixed response model and
fixed posterior means. It excludes model error and uncertainty in those
assumptions. A conditional leader is `CONCLUSIVE` only if its lower bound is
strictly above the upper bound of **every** competing action. Comparing only
the top two point estimates misses a third action with a wide interval.
`differenceBoundsBB` contains the conservative best-versus-second interval;
overlapping or touching intervals remain `INCONCLUSIVE`. Even a conclusive
fixed-policy comparison keeps `globalBestSupported: false`.

For a solver snapshot, action EVs evaluate the returned strategy profile at
the current information set. Exact tree enumeration does not give an error
bound relative to an equilibrium action value. NashConv measures unilateral
improvement of the entire profile; it is **not** an action-EV confidence
interval and is never added to or subtracted from action EV. Multiple exact
equilibria can assign different values to an unused action. A rare hand's
conditional regret can also be large while global NashConv is small.

Solver snapshots without action-conditioned certificates retain target
`EQUILIBRIUM_ACTION_EV` and remain `INCONCLUSIVE` with reason
`EQUILIBRIUM_ACTION_VALUE_UNCERTAINTY_UNAVAILABLE`, including when the subgame's
separate solution status is `SOLVED`. The point difference and returned
strategic frequencies remain available with their original scope. A solver
solution certificate and a conclusive action ranking are different claims.
No selected-action error classification is authorized by NashConv alone.

### Action-conditioned bounds, limited to river HU

`src/solver/action-conditioned.js` introduces the separate value target
`PRIVATE_INFORMATION_SET_COMMITMENT_VALUE`. For each root action it creates a
restricted game in which only that action at Hero's queried information set is
available. Other private combinations, chance worlds, prior weights and all
other information sets remain unchanged. In particular, the opponent does not
learn Hero's actual cards through a filtered chance distribution.

The target is the **ex ante minimax value of this commitment over the full
original prior**. It is not the conditional EV of this one hand under the
original average profile, nor a guarantee about an equilibrium of the full hand.
For a multi-combination Hero range, even fixing Fold at one information set can
leave positive value contributed by other combinations. Dividing this value by
the probability of the current hand would not fix this semantic distinction.

For the restricted two-player constant-sum game, write Hero's payoff as
`u(x,y)` and the payoff sum as `K`. Any feasible strategy pair provides:

`L(x) = min_y u(x,y) = K - max_y u_opponent(x,y)`

`U(y) = max_x u(x,y)`

`L(x) <= restricted_game_value <= U(y)`.

Each best response chooses one action for an entire information set, never one
action per hidden world. Production certificates round arithmetic outward at
every operation and treat supplied chance/strategy rows as normalized binary64
weights. The estimate is the midpoint of the certified saddle interval; its
method is recorded explicitly. These are deterministic game-value bounds, not
statistical confidence intervals or `EV +/- NashConv`.

For a declared constant-sum game, certification explicitly represents the
opponent's payoff as `K - uHero`. This preserves Hero's terminal utilities and
avoids turning binary64 cancellation in decimal fees into a spurious strategic
gap. The certificate records the original payoff-sum interval and maximum
normalization residual. Unsupported general-sum games cannot use this path.

The original profile EV and mix remain in `actions`; the new estimates and
bounds live in `actionPrecision.actions`. The UI labels them **Range commitment
EV**, with the original hand/profile EV and frequencies in details. The
comparison contract never puts commitment bounds around original-profile EV.

An action is conclusively best within this declared commitment comparison only
when its lower bound exceeds the upper bound of **every** other root action,
plus a conservative `16 * EPSILON * max(1, absolute bounds)` comparison guard.
That guard only withholds conclusions; it does not manufacture a value bound.
`SOLVED` remains the separate original-subgame qualification. Missing, touching
or overlapping bounds retain `Current EV leader` and `INCONCLUSIVE`. A valid
separation allows `Best action`, within the prominently labeled commitment scope.

Certificates record estimate, lower/upper, origin, exact bound-module version,
solver version, root action fixed, queried player/information set, iterations,
time, rounding method and utility scope. A base game hash and a context hash bind
the original state, ranges, fees, utility, tree/sizings and queried information
set. Different conditioned-game hashes are expected across actions, but their
base context must agree. Altered, missing or incompatible provenance prevents
a conclusion and never receives a synthetic interval.

### Adaptive refinement and diagnostics

The initial strategy is published before completion of deeper precision work.
Global convergence and action bounds are measured independently. The worker
alternates global CFR+ checkpoints with conditioned solves and continues from
the compatible checkpoint of each action. Iteration/time/memory limits are
explicit resource ceilings, not evidence of convergence.

After the first pass, focus uses certified intervals. An action can stop
receiving focused effort only when `upper + numerical_guard < best lower`.
No point estimate can prune a candidate. This does not remove actions from the
original game or modify its strategy tree. A third action with a wide upper
bound remains competitive even if its current estimate is low.

Automatic FAST-to-STANDARD refinement can continue after global NashConv meets
its threshold if the action comparison still needs precision. Explicit resource
ceilings stop unresolved ties without promoting them to conclusions. The
decision keeps the last complete snapshot; UI, keyboard, voice and hand recording
remain independent. Cancellation/revision checks apply to bounds as well as EV.
When all surviving conditioned games have no remaining strategic choices and
have valid certificates, further CFR work is unnecessary. They stop with
`FIXED_CONTINUATIONS_FULLY_EVALUATED`; touching roundoff bounds still remain
`INCONCLUSIVE`.

Per decision, diagnostics include global NashConv/exploitability, one-step regret
at the queried root information set, action EVs and frequency/EV changes across
compatible checkpoints. Root regret and checkpoint stability are descriptive
diagnostics, not substitutes for a global convergence proof or action bounds.
Build, global solve/evaluation, conditioned solves and total compute time are
recorded separately. p50/p95 evidence identifies sample counts, cache conditions
and hardware; local timing is not a hosted latency guarantee.

Run `node scripts/benchmark-hu-precision.cjs` to measure actual worker/service
latency for five repetitions of three river HU scenarios, followed by exact
warm-cache reads. It records first profile, first complete set of certificates,
completion, global/action compute and sampled combined process RSS. The separate
browser harness verifies cancellation, keyboard and synthetic voice while solving;
neither report claims real acoustic accuracy or a cloud-host performance SLA.

### Independent mathematical reference

The QA-only Python sequence-form compiler and HiGHS primal/dual LP live under
`scripts/reference/`. They do not call the CFR, production best-response or
action-conditioning implementation. The compiler creates realization-plan
constraints and a chance-weighted payoff matrix, then checks both primal/dual
residuals and independent best-response LPs. See the
[reference methodology and reproduction instructions](../scripts/reference/README.md).

The oracle validates the finite original game and each independently restricted
action game. Tests include unique and nonunique equilibria, both player
orientations, the analytic Kuhn value, independent PLO five-card ranking with
exact two-hole/three-board enumeration, blockers, fees and preservation of the
full prior. Numerical values and certified intervals are checked, not merely a
solver success status. Equivalent optimal strategies are allowed; matching one
arbitrary LP equilibrium is not required.

The LP uses floating-point arithmetic with explicit residual tolerances; it is
an independent numerical reference, not a symbolic proof. SciPy/HiGHS are optional
test dependencies and are never installed or invoked by the application. A
release precision gate runs these tests with the dependency present; a normal
checkout without it reports explicit skips rather than claiming reference passes.
This validates the supplied small river HU models, without widening street,
player-count or sizing coverage.

Other explicit reasons distinguish missing origin, fewer than two available
values, missing alternatives, absent defensible uncertainty, invalid intervals,
ties, overlap of the leading pair, and overlap with another alternative.
Old snapshots lacking a defensible precision contract must display an
inconclusive comparison instead of reconstructing a certainty claim.

## Cache and checkpoint design

Mathematical compatibility is exact in this slice. No nearest-neighbor board,
stack, range, variant or player-count reuse is permitted.

A game key includes solver, rules and comparison-contract versions, variant, physical seats and
positions, public action state, stacks and all contributions, board, all ranges
and normalized weights, fee schedule/basis, sizing abstraction and any aggression
cap. Suit or seat canonicalization requires a proven isomorphism plus a correct
inverse mapping; it is not enabled by treating sorted cards as interchangeable.

The current request also carries hand identity/revision and an input generation.
Those identify whether a completed response still belongs on screen. A
mathematically compatible cache entry does not authorize applying an old job to
the current interface without this check.

Checkpoints contain the exact game fingerprint, solver/algorithm version,
regrets, cumulative strategy weights and iteration/averaging schedule. Continuing
a checkpoint adds iterations without restarting the averaging schedule. A
result JSON alone cannot resume CFR. Invalid, incomplete, differently configured
or incompatible checkpoints must be rejected, not partially repaired.

In-memory entries are bounded by bytes and count; persisted entries are bounded
by bytes and written atomically. Both are
scoped to the same authorized owner as the range input. Persistent caches on a
Free ephemeral host are opportunistic; process restart or redeploy may remove
them. Cache hits describe compatible reuse, not measured strategic quality.

## Execution and responsiveness

- Initial response: legal actions, price, pot, coverage and a compatible cached
  result are available without awaiting deep solving.
- FAST / STANDARD / DEEP determine time and iteration budgets, not truth labels.
- A separate worker owns tree construction, CFR and exact verification.
- The server enforces worker resource limits, tree/node/world limits, bounded
  pending jobs and bounded cache bytes. It avoids accumulating every checkpoint
  or cloning the whole game on every progress message.
- Current hand work has priority over background study. A newer generation
  cancels obsolete queued/running work; hand edits, undo and owner changes do
  the same. Worker cancellation must not stop voice capture or alter the ledger.
- Progressive snapshots preserve table geometry and show real status. Only a
  complete iteration/checkpoint may replace the last valid result.
- Keyboard, recognition and deterministic command parsing run independently.
  Llama is optional and disabled in this release's critical path.

Measure first useful response, refinement time, p50/p95, peak or sampled memory,
iterations, NashConv, cache hit/miss and cancellation. Report the sample count,
hardware, cold/warm conditions and whether time includes tree construction,
worker start, serialization, verification and HTTP transport. Local fixtures do
not establish a Render performance guarantee or human speech accuracy.

## Verification plan

Independent adversarial tests cover hidden-information best response, choices
at zero own reach, known-game value, mixed strategy, reproducibility, checkpoint
continuation and three-player unilateral gains. Adapter tests cover exact
two-plus-three evaluation, joint blockers, range support, pot-limit, all-ins,
refunds, side pots, fees and incremental accounting. Cache/service tests cover
incompatibility, stale jobs, cancellation, owner isolation and resource limits.

Known-game convergence is measured across iteration budgets, with an improving
overall trend rather than an unjustified claim that every CFR iteration is
monotonically better. A UI/browser test must separately exercise voice, keyboard
and hand recording while the solver worker is occupied. Test reports distinguish
synthetic/model evidence from live provider/browser evidence.

### Independent tests included

`test/solver-independent-qa.test.cjs` contains mathematical oracles independently
constructed from the solver implementation:

- A hidden coin best response must remain 0.5; selecting a separate guess after
  seeing each hidden outcome would incorrectly produce 1.
- A best response can enter a continuation that the supplied strategy reaches
  with zero own probability. It still uses chance-weighted information sets.
- Independently constructed Kuhn poker approaches the analytic first-player
  value of `-1/18`, preserves mixed strategies and reduces measured NashConv
  across the tested iteration budgets.
- A 200-iteration checkpoint followed by 300 iterations matches a single
  500-iteration run, including the returned strategy and measured quality.
- A constant past-pot utility offset does not change incentives or NashConv.
- Three-player general-sum validation measures all three unilateral gains and
  does not advertise a two-player convergence guarantee.
- PLO5 terminal call accounting independently reproduces `P=30, C=10,
  equity=0.30 => EV=+2 bb`; a 2-chip terminal fee changes it to `+1.4 bb`.
- Alternative Hero combinations remain hidden from opponents' information sets.
- Missing ranges and construction budgets cannot create a truncated valid game.

`test/solver-solution-status.test.cjs` uses a real adapter/core result, then removes
or corrupts individual qualification requirements. It covers the strict supported
subgame gate, unrounded thresholds, unavailable/inconsistent quality, partial and
multiplayer scope, lifecycle refinement and explicit legacy source separation.

`test/solver-job-service.test.cjs` independently covers cache identity and owner
isolation, snapshot immutability, persisted reload, memory/disk bounds, an
asynchronous request-generation race, late results after cancellation and
foreground-priority checkpoint continuation. Its mock worker is a lifecycle
harness only; its timing is not evidence of real solver speed.

`test/decision-precision-independent.test.cjs` verifies overlapping/touching
intervals, strict separation, an uncertain third alternative, absent or invalid
bounds, incompatible origins, missing values and one-action comparisons. It
also constructs two exact NashConv-zero profiles with different unused-action
EVs, and a rare information set whose large conditional loss is hidden by a
small global NashConv. These are direct counterexamples to using NashConv as
an action-EV error bar. `test/decision-precision.test.cjs` additionally rejects
explicit evaluator-version mismatches, and the Multiway evaluator tests check
the integrated provenance, point gap and inconclusive contract.

These tests strengthen the bounded slice's correctness evidence. The new
independent sequence-form LP reference validates the tested small river HU
fixtures and their action bounds (see `scripts/reference/README.md`). It does
not validate every supported input, expand the represented range support or
certify a full-hand equilibrium. Production poker results keep `gto: false`;
the broader external poker-reference and release qualification remain separate.
