# Multiway simulation

Open **Simulation**, immediately below **Players** in the navigation. This is an independent practice workspace; it does not modify Analysis, Train, the player library, or real recorded observations.

## Hand flow

- Set the variant, total players, position, stacks and blinds. PLO4/PLO5 support 2–6 simulated players; PLO6 supports 2–5.
- Play opponents to advance to your decision. Optional single-action pacing lets you inspect each recorded bot action.
- Choose a legal action. Bet/raise values are total contributions on the current street. No free Fold is offered to Hero.
- Deal each subsequent street when the betting round is complete. The server already committed the complete shuffled deck before the first action.
- Showdown uses the existing exact Omaha evaluator and authoritative pot settlement, including side-pot eligibility, ties, uncalled returns and chip rounding. No rake is charged in this practice environment.
- **Next hand** carries settled stacks and rotates positions. **New table** starts fresh stacks. **Replay this deal** repeats the completed/ended deal for informed practice; it is not a fresh blind trial.
- Keyboard: comma = check/call, period = fold when facing a bet, semicolon = sizing, Shift = next settled hand. Form fields and open dialogs retain ordinary keyboard behavior. Existing Analysis card entry and voice are unchanged.

## Evaluation boundaries

EV and equity use only Hero's cards, the public board and the recorded actions. The server's hidden opponent hands, fixed future board and deal seed are not calculation inputs. Decision-time snapshots are retained before the chosen action; revealing cards later does not re-evaluate or replace past decisions. Acting while calculation is pending records that the estimate was unavailable, rather than inventing one.

Bots use the unchanged `MULTIWAY_CONTEXT_POLICY_V2`, without learned player observations, with their own cards and the evolving public state. EV uses that same declared reference model and public-action-conditioned card priors. This is a model consistency/practice tool; it does not independently calibrate that policy against human opponents. Full hand simulation does not extend the mathematical coverage of the strategic solver.

The existing browser worker produces PREVIEW and FINAL evaluations asynchronously. Actions do not wait for it. Owner, hand and revision changes cancel or reject old results. A stopped refinement retains a valid preliminary estimate, with its actual coverage/status. Numerical uncertainty and `INCONCLUSIVE` remain visible. No result is relabeled GTO or SOLVED.

The configured 350 ms preview/1,800 ms final calculation budgets are unchanged. Network, cold service startup and slower devices can add latency; this feature does not promise a universal three-second SLA. An unsupported browser can use the existing authenticated server calculation fallback.

## Fair deals and review

Each new hand receives a fresh 256-bit cryptographic seed with no hand-strength/EV filtering. A rejection-sampled Fisher–Yates shuffle uses an HMAC-SHA256 stream; the version, seed and deck define a SHA256 commitment disclosed before play. The seed is withheld until completion or explicit abandonment. Hidden hands and the future runout can be revealed only after that point.

The seed and deal-version algorithm in `codigo-fonte/src/multiway-simulation.js` permit independent deck/commitment reconstruction. Bot random choices depend on semantic action history, not random ledger UUIDs, so the same replay/actions/pacing reproduce the same behavior. Replays are clearly identified as informed practice.

Simulation history stores up to 30 completed or explicitly ended hands in a separate owner-scoped browser namespace. Abandonment has no fabricated payout. The JSON report includes every stored hand, decision-time public inputs, available numerical evaluations and quality metadata, timing, and any completed/revealed deal audit. Actual hand profit is separate from modeled EV and is not a decision-quality certification.

## Hosting and access

The existing Cloudflare gateway forwards authenticated `/api/simulation/*` requests to the Node service. No new hosting plan, credential or external AI dependency is introduced. The dealer's sessions are server-memory-only, owner-isolated, expire after two hours and are bounded to eight per owner/128 total. Server restart can end an active simulation. Completed local reports remain available; download them for durable review. No session secret is stored in the real workspace or player-learning modules.

## Validation

Focused tests cover private-input exclusion, unfiltered seeds, owner isolation, revision/idempotency checks, replay/pacing equivalence, variant/seat limits, exact tied/side-pot settlements, chip conservation, safe abandonment and expiry. Existing keyboard, voice parser, EV presentation, browser computation and hand-flow regression tests remain required. Browser QA covers desktop, a mobile viewport, pending calculations, actions, streets, showdown, reveal, next-hand stack continuity and exported decision snapshots.
