# River HU coverage and contextual sizing package

Base: `5d9cdda251ffee8030659431fca3295dda0b76a0` on
`hosting/cloudflare-oracle-migration`. Product version remains 0.14.10.

## Delivered

- River HU study adds `ALL_LEGAL_TOTALS`: every legal cent street total at
  every included node. A branch needing more than 12 sizes refuses the entire
  tree (`EXACT_SIZING_BUDGET`). No sampled or truncated tree is called exact.
  The existing aggression cap can still make coverage partial. Qualification
  separately checks complete chance/tree/sizing support and convergence.
- Range weight checks enumerate joint blockers and current Hero support,
  and report weight concentration. Flatter/sharper opponent weights create
  explicit reviewed scenario drafts, retaining all combinations and Hero
  weights. They are sensitivity hypotheses, not inferred ranges, observations,
  confidence intervals or evidence of adaptation gain. Save confirmation is
  required; the primary result is retained while comparing alternatives.
- Confirmed bets/raises record their relative band within the legal cent-total
  interval. `CONTEXT_LEGAL_SIZE_DIRICHLET_V1` learns four conditional bands in
  the existing exact opportunity context. Undo retracts them; pre-hand snapshots
  stay frozen; old records without size metadata use the reference policy.
  `MULTIWAY_CONTEXT_POLICY_V2` uses these bands for future aggressive amounts.
  The legacy uniform reference remains exactly unchanged without size evidence.
- Players details display sizing counts/posterior marginal intervals and separate
  chronological conditional size log loss/Brier, using the original frozen
  snapshot and matching archived action/amount. They do not claim population
  calibration. Browser cache identity retains sizing counts, and worker source
  fingerprints partition versions. Profile contrasts require the same version.

## Mathematical boundaries

The CFR+ algorithm, utilities, accounting, best responses, outward action bounds,
comparison criteria, memory/node/world/time ceilings and game rules are unchanged.
Legacy sizing modes retain their mathematical trees and keys. The new mode has
an explicit sizing version and distinct key. River HU remains limited to 32
combinations per original seat, 1024 Cartesian worlds, 12 sizing choices/node,
12000 nodes and the existing 48 MiB builder reservation. No new street or player
coverage is added. Existing experimental three-seat support is unchanged.

Current-hand EV against the returned strategy, full-prior action-conditioned
commitment bounds and global convergence remain separate. `SOLVED` can coexist
with `INCONCLUSIVE`. Equal/overlapping actions are not forced into a best-action
claim. Full-prior near-equivalence is not current-hand EV equivalence or GTO.

Size responses use the existing coarse opportunity context, independently of
private-card strength; historical range conditioning still uses action likelihood,
not observed size likelihood. The card-strength response link remains heuristic.
Neither profile nor sizing posterior uncertainty is propagated into action EV
intervals. Sparse evidence, selection bias and real-player calibration remain
limitations. No automatic hidden-card weights or frequencies are manufactured.

## Verification

- 48 mathematical/runtime tests passed with the existing SciPy LP environment,
  including both Hero orientations, every action-conditioned value/bound in the
  new small legal-cent trees, old checkpoint equivalence and exact rational
  envelope containment without added endpoint tolerance.
- 240 integration tests passed: profiles, Undo/deduplication, forecasts, cache
  invalidation, player contrasts, solver qualification/scenarios, UI, keyboard
  and synthetic voice sequencing. Tests run sequentially to avoid artificial
  contention with strict build deadlines. Three stale test guards were aligned
  with the already published 5d9cdda source/metadata; mathematical assertions
  were retained. Older 32-combination reference comparisons also passed.
- Reproducible generated workers/reference fixtures and Cloudflare dry-run build
  passed. Local native-browser QA passed 22 checks on four cold plus four warm
  public synthetic cases. Cold first values: 163-216 ms; final values: 248-312 ms.
  Warm reads retained identical results without new solver work.
- Desktop gameplay recorded cards/actions through the keyboard, advanced to
  river, saved a reviewed weight scenario, and returned `SOLVED` with provisional
  current-hand EV. A 390px iframe harness checked the actual responsive app and
  study modal without horizontal overflow (375/375 document, 326/326 modal).
  The browser viewport override did not apply, so this is a responsive harness,
  not a physical-phone or direct device-emulation validation.

The native matrix is reproducible online at
`/browser-study-validation.html?package=ev-coverage`, isolated from account,
library, hand workspace and voice. Evidence and deployment receipt are in the
local `validacao/ev-coverage-package` folder. Production validation follows deploy.

These tiny, four-world, short-stack cases do not establish a universal 3-second
SLA. The primary preview/final compute budgets and progressive cancellation
remain unchanged. Larger or out-of-coverage trees may remain approximate,
inconclusive or unavailable; refinement remains optional and in background.
