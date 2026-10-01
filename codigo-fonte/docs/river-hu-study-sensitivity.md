# Explicit river HU study sensitivity

Baseline: `3b13746aea7b0df410bdfe8b7304fbde5b225e9a` (0.14.10).

## Delivery boundary

This delivery adds a bounded comparison workflow for explicitly declared PLO5
river heads-up studies. It does not increase the solver's player/street coverage,
change CFR+, terminal utilities, best responses, action-conditioned bounds,
admission limits, or certify the full PLO5 game.

Keep up to three studies for the current hand. Each study has complete weighted
ranges, one declared sizing tree, and optional presentation names and rationale.
New studies are empty or explicit duplicates. No observed statistics, hidden
cards, population ranges, or prior reach probabilities are inferred. Narrative
metadata stays outside solver inputs. A changed mathematical input remains a
different cache identity and a different game.

## Three distinct result scopes

1. **Current-hand profile EV and frequencies:** the actual Hero combination
   against the original returned average strategy. These are conditional profile
   evaluations, not certified equilibrium action values.
2. **Full-prior commitment bounds:** one private information-set action is fixed,
   the original prior is retained, and the players may optimize the conditioned
   game. These bounds concern its ex-ante value. They are not intervals for the
   current-hand profile EV.
3. **Global convergence and qualification:** exact NashConv of the declared
   subgame, with `SOLVED` separate from commitment comparison status. Numerical
   convergence cannot remove missing legal sizings or aggression depth.

The study comparison does not average EVs, intersect bounds from different
games, derive confidence intervals from hypothesis spread or NashConv, or
declare a universal best action. Point leaders may change across declared
assumptions; a stable leader only describes those tested models.

## Comparability

- `RANGE_SENSITIVITY`: same public ledger, actual Hero, fees, utility, solver
  provenance and sizing tree; only explicit priors differ.
- `SIZING_SENSITIVITY`: same ledger, actual Hero, fees, utility, provenance and
  exact weighted priors; only sizing/depth differs.
- `SAME_GAME`: identical mathematical input and result context.
- `INCOMPARABLE`: mixed or unverified changes, incompatible provenance, missing
  or invalid result context. Missing actions are never represented by zero.

Input comparison is conservative. This workflow introduces no new suit
canonicalization, weight equivalence, checkpoint sharing or cache equivalence.

## Interactive work and cancellation

The active result remains visible. Comparison is an explicit Browser-compute
operation after the active study has returned and stopped running. At most two
alternatives run sequentially on the same client, with a 3-second work slice per
alternative and a 6-second workflow budget. The first response of the active
decision is not held for this workflow. A deadline retains coherent provisional
results and cancels work; it does not certify convergence or replace absence
with zero. Timer delivery depends on browser scheduling.

Every input and response is tied to owner, hand, revision and frozen study
context. State changes, new foreground work, edits and Stop invalidate comparison
work. Late acknowledgements are cancelled before replacement jobs can reuse
their identities. Voice, keyboard, ledger and normal analysis do not depend on
the comparison. No cloud service or second solver client is enabled by it.

## Coverage retained

The browser slice remains PLO5 river HU, at most 32 explicit combinations per
seat and 12 positive cent-denominated street totals, subject to world/node/memory
and construction guards. Absolute street totals are filtered at each included
node; they are not percentage-of-pot sizes at every node. `MIN_MID_MAX` samples
the legal minimum, arithmetic midpoint and maximum. The solver reports omitted
legal sizes and aggression frontiers. Full legal coverage is possible in certain
short-stack/all-in trees; a deep-stack sampled tree is still an abstraction.

Validation evidence and observed local/hosted timings accompany the publication
receipt in `validacao/river-hu-study-sensitivity`. Small independent LP/rational
references verify values and per-action bound containment, with fixed-work
mathematical parity checked against the baseline. Measurements describe those
fixtures and device; they do not establish a universal 3-second SLA.
