# Recorded player insights and reviewed range reuse

## Release scope

Implemented on `hosting/cloudflare-oracle-migration`, based on commit
`c4491fd489be3405d0c17576bd79de0fd67ad25d`, retaining product version 0.14.10.
This delivery does not expand strategic coverage, change poker utilities, retrain
the existing profile model, or change the solver's precision classification.

### Automatic observations

- Confirmed actions feed the existing identity-bound player ledger, with its
  undo/revision rules. The new insights view reports at most three separate
  opportunity contexts, their counts, reference prior, posterior estimates and
  conservative posterior intervals. It does not pool incompatible contexts.
- The canonical empty hand is frozen before the first observation request. New
  hands carry an explicit `THEIBS_FORECAST_ORIGIN_V1` receipt. Late/reconstructed
  snapshots and old hands without this receipt are not retrospectively labeled
  pre-action forecasts.
- Forecast evaluation is on demand in Players. It compares the original frozen
  action predictions against the same weak legal-action reference on eligible
  completed archives. Log loss and Brier scores are descriptive; current hands,
  future archives, unproven chronology, duplicates and invalid contexts are
  excluded. The UI cache retains bounded summaries, not full forecast arrays.
- An opponent's seat provides a contextual Player insights link. Detailed
  analysis remains outside the primary game composition.

### Reviewed ranges

- A reviewed finite opponent range can be saved locally for the verified account
  and offered automatically in Solver study for the same stable player and
  coarse river context. This is a hypothesis template, not statistical learning.
- The context includes variant, street, positions, original/active seat counts,
  facing-bet state and Hero's available action set. Matching does **not** assert
  equivalence of boards, prices, stacks or action history.
- Loading copies the original combinations and relative weights unchanged into
  a draft, clears completeness confirmation, and requires review/save. Canceling
  leaves the active study unchanged. Board blockers are rejected explicitly;
  no combination is silently removed or manufactured.
- Original board, hand, revision, scenario and weights survive workspace
  serialization. Edits are marked separately. This provenance remains outside
  mathematical requests and cache inputs; the actual edited range remains part
  of the normal mathematical input.
- Card ranges are conditional hypotheses at the current public decision. They
  are not sent through historical reach-likelihood conditioning again. Action
  marginals, notes and sparse showdowns do not identify hidden-card weights.

## Validation

- 138 focused automated tests passed, zero skipped/failed, 2026-10-01.
  Includes profile snapshots, action/context eligibility, before-first-action
  capture, archive scoring exclusions, undo/storage, account/revision isolation,
  range provenance, solver UI, keyboard and PT-BR/EN-US deterministic voice paths.
- Independent integration QA passed its 60-test focused gate.
- Cloudflare preparation and Wrangler dry-run build passed after final edits.
- Native browser: confirmed actions were entered, hands archived, the current
  river hand excluded from forecast scoring, and one eligible archived forecast
  scored against its frozen model/reference. Older reconstructed hands were
  excluded. This small synthetic fixture does not establish calibration.
- Native range review: saved/reloaded template, unchanged draft weights,
  canceled draft, explicit blocker rejection, edited weight restoration and
  original-weight provenance were verified.
- Responsive captures: 1366x900 desktop and 393x852 mobile. Document width was
  1351 and 378 respectively; no horizontal overflow in the inspected insights
  composition. Captures and test/build logs are in the ignored local evidence
  folder `validacao/player-insights-automation/`.
- Authoritative solver/math source and generated worker fingerprints are
  unchanged from the baseline:
  - solver: `47b66f5288af193a8da858c68c80069b64ff607877472b76a752456d398cf3be`
  - continuation: `06a019f6b5a78d67645fd0d048f39d197895d6e0e37d30bb35e4b65a7f88d4cd`
- A tiny local 1x1 river fixture completed in about 50 ms. This is a functional
  smoke observation, not a representative latency benchmark or 3s guarantee.
  No new broad CPU/local-versus-production investigation was conducted.

## Gates for a first real closed alpha

1. Verify a fresh authenticated hosted session: login, refresh, expiry, isolation,
   hand resume, archive/replay and exact revision restoration. Public health and
   unauthenticated rejection alone do not verify these flows.
2. Decide and test a recovery contract. Player libraries, archives and reviewed
   templates are origin-local browser storage, partitioned by account; they are
   not synchronized across devices. Browser clearing/origin changes can lose
   them. Existing Render Free server files are ephemeral. A durable export/import
   or backup path is needed before promising real hand-history retention; a
   disposable-data alpha must explicitly accept that narrower scope.
3. Keep one editing tab for the initial alpha. Revision checks reject detected
   stale writes, but localStorage does not provide an atomic cross-tab transaction.
4. Run human PT-BR/EN-US voice and physical-phone checks: rapid sequential actions,
   correction/ambiguity, microphone restart, keyboard coexistence, and obsolete
   jobs. Synthetic parser tests do not establish acoustic accuracy.
5. Measure representative device first-response p50/p95 and background completion,
   including larger supported ranges, cancellations and memory. Preserve the
   progressive 3s target and real status rather than claiming a universal SLA.
6. Assess action forecasts on newly collected eligible hands before enabling any
   stronger adaptation claim. Posterior action uncertainty is not propagated
   into strategic EV, and these templates do not provide learned card ranges.

The testable product is a hand-recording/study alpha with explicit finite river
subgames and labeled legacy continuation estimates. It is not complete strategic
Multiway GTO. Current-hand returned-profile EV, action-conditioned full-prior
commitment bounds and subgame convergence remain distinct. `INCONCLUSIVE` stays
valid whenever the relevant comparison lacks defensible certification.
