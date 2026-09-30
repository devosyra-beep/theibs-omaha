# Multiway continuity and action evaluation

## Boundaries

This extension applies to the observed Multiway table. The standalone Analysis
and Train evaluation paths retain their existing contracts. `hand-flow` remains
the shared authority for legal actions, positions, chips, pots and settlement.
`multiway-session` validates the confirmed event ledger and exposes revisions.

An initial setup declares player count, Hero position, blinds and starting
stacks. Hero cards are not required to record actions. Missing cards prevent EV
evaluation, not the action ledger. Physical seats, poker positions and stable
player identities are distinct; identical nicknames do not merge identities.

## State transitions

- A completed betting round requests the next board street. Folds, accumulated
  contributions and the pot survive; only street contributions reset.
- Hero folding does not end a hand while multiple opponents remain.
- An uncontested pot is awarded by the ledger, with uncalled chips returned.
  This balance is before any unrecorded rake. The user may confirm ending stacks
  before continuing; an EV cost hypothesis never becomes an observed charge.
- Showdown accepts reported winners for each eligible pot and actual rake.
  Shown cards are optional and may be partial. They are validated for blockers.
- Skipping an unknown result records a pending result. No winner or ending
  stack is inferred. Continuing requires explicit stack reconciliation.
- Next hand returns the complete prior ledger for archival, rotates the button,
  clears active cards/actions/folds, and carries eligible identities and
  reconciled stacks. Changes to basic setup apply to that next hand.
- Shift cancels pending input. It does not start another hand or reset its
  accounting, positions or folds.

## Action EV

`MULTIWAY_CONTEXT_POLICY_V1` is an explicit heuristic continuation study, not a
solver, GTO strategy or empirically validated opponent policy.

For a candidate action:

`EV = E[net awards + returned chips - additional Hero contributions]`

Past contributions are already included in the decision's pot. They are not
deducted again. Bet and raise sizes are total contributions on the current
street; only the additional amount is paid. Fold is the zero reference. Check
uses a continuation and is not assigned zero by convention.

The simplified terminal call identity `equity * (P + C) - C` applies only with
one eligible pot, no future betting and no rake. The deterministic independent
test reproduces `P=30, C=10, equity=.30 => +2` through actual win/loss settlements.

### Implemented model coverage

The interface calculates action EV automatically **before room fees** by default.
It sends an explicit zero-cost evaluation with `feeBasis: BEFORE_FEES`, without
claiming that the room actually charges zero. Legacy unknown-cost presentation
preferences migrate to this display basis. An optional fixed fee lives under
advanced calculation options and can update the current evaluation, without
changing the ledger, previously recorded decision snapshots or actual settlement.
Direct API requests without any cost basis still preserve partial coverage;
the engine does not silently infer a net EV or an external room's fee schedule.

- PLO4, PLO5 and PLO6, respecting each table's supported player count.
- Exactly two private and three community cards for showdown ranking.
- Joint private-card worlds with blockers, including folded players' cards.
- Uniform priors or validated explicit weighted opponent combinations.
- Conditioning on confirmed opponent actions using the declared policy.
- Legal fold/check/call plus minimum, midpoint, maximum and custom aggression.
- Conditional responses, later streets, reraises, folds, all-ins, split pots,
  uncalled returns and side-pot eligibility, through the same ledger.
- Explicit fixed rake, supported rake schedule, or an explicit no-rake choice.

All compared candidates share joint worlds and the same continuation policy.
After the current action, Hero follows the reference policy. Opponents follow
their contextual profile means combined with an explicit heuristic link to
their own cards and the public board. Sizing in future actions follows a uniform
distribution over legal street totals. These are model assumptions, not learned
hidden cards or a strategic solution. No global best action is asserted for this
finite sizing grid and fixed future policy. No strategy frequencies are inferred
from EV values.

Unknown costs leave non-fold EV `null` / `NOT_MODELED`. A state without a Hero
decision returns `NO_DECISION`. Missing estimates never use numeric zero.

### Numerical quality

Joint importance sampling reports sample count, effective sample size, stop
reason and intervals. Simultaneous bounded ratio Hoeffding intervals include
weighting and the possible time stop. They can be very broad, especially after
long or unlikely observed histories. Model uncertainty and profile posterior
uncertainty are not included in those numerical intervals. The response means
are held fixed during an evaluation. An overlapping interval cannot establish a
conclusive leader or a meaningful action error.

The top-two candidate gap, selected-action loss and loss as a percentage of the
pot before the decision have separate meanings. Comparisons must use the exact
decision snapshot, including variant, revision, profile prior and costs. Later
revealed cards must not be used to reevaluate the original choice.

## Players and learning

The per-user browser library separates nicknames/notes from confirmed action
observations. The current hand has a frozen pre-hand profile snapshot; learning
its actions updates future profiles but never that prior snapshot. Updating or
undoing the ledger replaces affected observations by event identity, preventing
double counting. Shown cards and manual notes do not manufacture action
opportunities.

Contexts distinguish variant, original heads-up versus multiway table, initial
participant count, current participant group, position, street, call-price band
and available legal actions. A multiway table reduced to two players does not
borrow a heads-up table's strategy.

Each legal action receives a Dirichlet prior weight of one, except folding when
checking is free, which receives .01. Each action's marginal is Beta. The Players
view exposes observed counts, matching opportunities, posterior means and a
conservative interval with at least 95% posterior mass (Chebyshev bound).
Unobserved contexts retain the reference prior. Sparse data cannot establish a
population strategy. Changes affect response probabilities and action-likelihood
conditioning; they never add arbitrary bonuses to EV.

Profiles, notes and archived hands are stored for the authenticated owner in this
browser. Clearing browser data removes them; this is not cloud synchronization.
Only the minimal profile counts needed for requested calculations accompany the
existing game calculation request. Audio is not part of that contract.

Device storage writes changed player/hand records as immutable chunks and commits
a small manifest last. A failed write leaves the prior manifest readable. The
previous manifest is retained for recovery; existing single-record libraries are
migrated without discarding their original copy on failure. Conflicting revisions
from another tab are detected before publication and require review/retry. This
synchronous browser store does not claim a cross-tab atomic compare-and-swap.
Historical decision values are cloned on capture and tied to the confirmed action
event. Undoing and repeating an action cannot revive the discarded evaluation.

## Voice and optional interpretation

Known commands use the contextual deterministic parser. Sequences are previewed
and validated against one ledger revision, then accepted atomically. Opponent
sequences stop before Hero, a board transition or hand completion. Remaining
commands require contextual review. Single Hero actions remain available.
Final event IDs identify input; repeated words alone are not duplicates.

Ambiguities require resolution before later captured actions can be applied.
The microphone can continue capturing while that order is held. Revisions,
origin IDs and validation protect against stale or duplicate application.

The Llama adapter is optional and disabled for this release. It is never needed
for voice capture, known commands, card entry, arithmetic, EV or hand continuity.
Remote text assistance would require separate consent and measured benefit before
activation; on-device speech preferences do not authorize remote text processing.
Provider preparation and mock tests do not demonstrate production inference or
human speech accuracy. No cloud model validation or activation is claimed.

## Performance and evidence

Evaluation runs outside the UI thread with provisional and final stages,
revision checks, cancellation and bounded caches. The current final model budget
is 1.8 seconds within a 3-second worker deadline; this is a target/budget, not a
guaranteed end-to-end network latency. Local benchmark results must be labeled
as such and are not Render performance evidence.

Relevant automated suites include `multiway-continuity`, `multiway-evaluator`,
`multiway-independent-qa`, `player-profiles` and the sequence/HTTP integration
tests. Browser evidence must separately demonstrate the integrated desktop and
mobile interactions. Fake recognition events validate event handling only;
they do not measure real acoustic accuracy.
