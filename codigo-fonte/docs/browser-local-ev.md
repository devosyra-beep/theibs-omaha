# Browser contextual EV and bounded river HU capacity

## Release scope

Baseline: `b62b0f1`, branch `hosting/cloudflare-oracle-migration`, application/engine version `0.14.10`.

The normal contextual Multiway calculation now runs in one browser Web Worker. It uses the same canonical request preparation and continuation/equity sources as the server. It remains `HEURISTIC`; it is not a strategic solution of PLO Multiway. Simple Analysis, Train, payments and game rules are unchanged.

The server still validates the session and entitlement through the protected capabilities endpoint before calculation. No account tokens, player notes or transcripts enter the compute worker. Unsupported runtimes can use the existing server path, with visible provenance. Mathematical errors, stale state and access errors do not silently fall back.

PREVIEW uses the existing 32-world/350 ms budget; FINAL uses 128 worlds/1800 ms. Worker startup is measured separately. Only completed sample-limit results enter the small owner/build/input/phase cache. Aborting or superseding work retires its worker and prevents stale publication. Hand, revision, owner, session and input guards remain in place. Active browser river studies pause before foreground contextual calculation and resume afterwards using the existing study/checkpoint path.

## Finite river HU studies

The explicit range admission limit is 24 combinations per seat, up to 576 compatible worlds. The existing 48 MiB reservation, 12,000-node guard, build deadline, CFR+, utilities, convergence rules and action-conditioned certificates remain unchanged. Admission is conditional on the entire declared tree fitting those guards; 24 combinations do not imply unlimited sizings or a full PLO range.

Current-hand EV against the returned strategy, full-prior action-conditioned commitment values/bounds, and subgame convergence are separate quantities. Restricted trees remain `APPROXIMATE`. Overlapping valid bounds remain `INCONCLUSIVE`, even when convergence or certified near-equivalence is available. No turn, flop or new player coverage was added.

## Validation

- Same-source fixed-work fixtures cover PLO4/5/6, weighted ranges, blockers, fees, missing coverage and ties. The browser/Node comparison keeps HEURISTIC provenance separate from finite solver results.
- Integration tests cover canonical ledger inputs, owner/build/revision binding, stale cancellation, cache identity/expiry and partial time-budget results.
- Independent LP/sequence-form references validate small supported subgames, utilities and action-conditioned bounds. Those references do not certify a 24/32/48-combination game globally.
- Desktop and 393 x 852 viewport checks exercised empty/populated hands, native card keyboard entry, observed calls, Hero auto-evaluation, options and the default `This device only` selection. No microphone recording or physical-phone benchmark was performed.

### Observed local browser timings

Three synthetic cold runs per case; descriptive nearest-rank percentiles, not an SLA. These timings exclude the authenticated access request and network startup.

| Case | First useful p50/p95 | Completion p50/p95 | Warm result cache |
| --- | --- | --- | --- |
| Contextual six-seat PLO5 | 485 / 504 ms | 1376 / 1471 ms | 0.7 / 0.8 ms |
| River HU 12 x 12 | 151 / 210 ms | 426 / 513 ms | about 2 ms |
| River HU 24 x 24, two sizings | 296 / 300 ms | 1026 / 1078 ms | about 2 ms |

The normal case completed all 128 final worlds. Its maximum cross-runtime arithmetic difference was `7.11e-15` bb with an identical input fingerprint. The 24 x 24 case enumerated 576 worlds and preserved `APPROXIMATE` / `INCONCLUSIVE`; certificate evaluation p50/p95 was 47.7 / 53.8 ms. Cancellation recovered without publishing the obsolete result.

## 24 / 32 / 48 comparison

See `benchmarks/river-hu-range-sensitivity.json` and its accompanying protocol. Larger admission was enabled only in an isolated in-memory QA adapter. Production retains 24/576 and all resource guards.

Changing explicit ranges changes the game and prior; it is sensitivity to assumptions, not simply increasing numerical resolution. With the same two-size aggressive tree, 24 fits and 32/48 are refused by the reservation guard. A common minimal no-additional-aggression tree admits 24 and 32; even its smallest fully compatible 48 x 48 tree needs 54.01 MiB, above the 48 MiB guard. No missing EV is replaced with zero and no incomplete tree is claimed valid.

## Interactive target and production receipt

The target remains approximately three seconds for a useful foreground response, with honest progressive status and optional background refinement. Device speed, network/auth latency and resource admission prevent a universal three-second guarantee. Larger rejected cases are not enabled to satisfy a point estimate.

Production publication uses the existing Git-connected Cloudflare build and a manual Render deployment of the same commit. The final production receipt records the actual published commit, build/deploy IDs, asset fingerprints, browser timings, cache/cancellation smoke results and verification limits. Production measurements were pending when this source document was committed.
