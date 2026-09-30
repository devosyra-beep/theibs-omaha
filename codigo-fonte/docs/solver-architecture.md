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

Missing external poker reference validation is a GTO-label release gate, even
when small toy games pass. A numerically solved supported subgame still cannot
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
`THEIBS_DECISION_PRECISION_V1`. A point difference is a descriptive quantity,
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

Therefore current solver comparisons use target `EQUILIBRIUM_ACTION_EV` and
remain `INCONCLUSIVE` with reason
`EQUILIBRIUM_ACTION_VALUE_UNCERTAINTY_UNAVAILABLE`, including when the subgame's
separate solution status is `SOLVED`. The point difference and returned
strategic frequencies remain available with their original scope. A solver
solution certificate and a conclusive action ranking are different claims.
No selected-action error classification is authorized by NashConv alone.

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

These tests strengthen the bounded slice's correctness evidence. They do not
replace external PLO solver references, expand the represented range support or
certify a full-hand equilibrium. Production poker results keep `gto: false`
while independent PLO reference validation is pending.
