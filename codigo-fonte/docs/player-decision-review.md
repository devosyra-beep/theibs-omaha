# Player continuity and decision sensitivity

## Table setup

New game displays Players & learning with distinct saved identities, current
positions and recorded action/hand counts. Use current players copies the current
Hero-relative roster only when every identity exists and the table size matches.
Changing the size requires explicit assignments. Use new players clears the draft
assignments; starting creates separate identities. No name or seat label merges
histories. Canceling setup does not change the active hand or player library.

Shift/Next hand retains the existing fast continuation. Confirmed actions are
synchronized and the old ledger archived before the new pre-hand profile is
frozen. Undo retracts observations. Missing payouts, shown cards and ending
balances are not required and are not fabricated. Notes remain manual hypotheses.

## Forecast checks

Existing Players insights evaluates original frozen action forecasts on demand.
An explicitly archived incomplete hand is now eligible without a payout, only
when its closing receipt identifies New game/next-hand reconciliation, the
snapshot origin and chronology are valid, and each observation matches its
archived ACT event. Current/future hands, unproven origins and duplicates remain
excluded. Log loss/Brier are descriptive; they do not establish calibration,
profitability or hidden-card ranges.

## Optional EV contrast

Methods & limits exposes Compare player profiles only for contextual heuristic
EV. It retains the primary result and evaluates a separate reference-policy
hypothesis in an owned browser worker, clearing only frozen opponent action
counts. State, seed, declared card priors, fees, stacks and sizing inputs are
copied unchanged. Changes in the response policy also affect action-history
likelihood conditioning; resulting posterior card distributions may differ.

The table reports profile EV, reference EV and their point difference in bb.
It is model sensitivity, not the gain from adapting against the same opponent,
an uncertainty interval, a learned range or a solver certificate. Sparse evidence
and numerical sampling may change point leaders. Profile uncertainty remains
unpropagated. Solver values, trees, bounds and convergence are unchanged.

No extra solve occurs at hand/table transitions. The contrast starts only on
request, waits while primary EV/river study is active, has a 2.8s cancellation
deadline, and has no server fallback. Primary re-analysis, hand edits, view/account
changes cancel its worker; obsolete responses are discarded. A timeout leaves
the main EV untouched. This deadline is not a universal end-to-end 3s SLA.

## Validation

Focused unit/integration checks cover roster identity, source immutability,
comparison provenance/state/action-grid rejection, missing EV, frozen forecast
chronology and incomplete archive evidence. Browser QA covers explicit roster
reuse, cancel, continued observations, optional contrast and Shift cancellation,
forecast scoring on the two original archived snapshots, and 390x844 mobile.
The evidence is synthetic and does not establish real-player calibration.
