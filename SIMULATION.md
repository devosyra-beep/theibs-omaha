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

## Connection recovery, restarts and action control

Transient connection failures and gateway timeouts receive one bounded automatic retry. Start, next, replay, restart and action requests retain an owner-scoped operation identity; a lost acknowledgement cannot silently create another deal or duplicate an action. After retry exhaustion, **Retry last request** preserves the original intent and decision-time snapshot. Authentication errors and invalid/stale actions are not retried as network failures. Reload restores a saved uncertain intent for reconciliation. An expired server session remains distinct from a temporary connection failure.

**New deal** resets stacks and deals fresh, unfiltered cards with the existing table configuration. An interrupted hand is archived without a fabricated payout. **Next hand** carries settled stacks only when Hero and at least one opponent have chips. A busted Hero can immediately start a new deal; Shift chooses the applicable continuation. **Table setup** changes the table configuration. Lifecycle changes are atomic at the dealer, including replacing a session at its capacity limit.

Choose **Automatic**, **One action at a time**, or **Choose every action** for opponents. Manual mode exposes legal actions for the current actor; it does not permit out-of-turn or illegal actions, and hides free Fold. Any legal cent sizing can be applied independently of the EV leader. Hero's sizing dialog can evaluate a custom total before applying it; action entry never waits for the calculation. Manual opponent actions are interventions, explicitly separated from reference-policy validation. Scenario EV still interprets the entered history under its declared reference policy, not as calibrated evidence about the manually controlled opponent.

Browser EV now projects the already public, synchronized ledger directly into its worker, without first querying the dealer. This removes a network dependency before the first estimate; calculation budgets, utility, priors, provenance and numerical uncertainty are unchanged. Server calculation remains a fallback. Hidden dealer cards, seed, completed audit and future runout never enter this projection.

## Practice bankroll and action guidance

The compact **Practice bankroll** strip shows fictitious money, chip profit/loss and settled hand count. **Bankroll settings** sets starting funds, a display-only money-per-chip conversion, and BRL/USD/EUR/GBP. These values do not change table stakes, utilities, EV, or gameplay. The displayed settled balance equals starting funds plus recorded fresh-hand profit; current committed chips are not realized losses. Next hand carries table stacks, while New deal refills them without creating a bankroll gain. Manual-opponent scenario outcomes can count as practice results; they still do not become validation observations.

**Progress & accounting** displays cumulative realized chip profit. Each hand identity is booked once, including across retry, reveal, export and reload. Replay and abandoned/expired hands with unknown payouts are excluded. Detailed history can be cleared or trimmed without erasing progress. Up to 2,000 compact progress records are stored locally per account; at that limit, tracking stops with a visible message rather than silently losing totals. Export includes the progress ledger and settings. Reset progress starts a new tracking period without changing the current hand or detailed history; an already finished hand remains in the prior period. On first upgrade, only completed reports retained on this device can be imported, not previously discarded history.

On Hero's turn, the current comparison contract drives a prominent action label, its EV, and the matching action button/sizing. **Current EV leader** stays explicitly `INCONCLUSIVE` when uncertainty overlaps or coverage is incomplete. **Best modeled action** requires the existing conclusive-precision contract and complete displayed coverage, within the fixed model and sizing grid. No preliminary, stale, illegal or incomparable leader is promoted. Bet/raise opens the editable sizing dialog at the leader's legal total; the user still confirms the action. No action is executed automatically and no frequency is invented.

**EV · bb** is estimated incremental profit; **EV shortfall · bb** is the difference below the current leader. **ΔEV** separately compares the top two estimates. Actual bankroll profit is a realized outcome, not any of these mathematical estimates. The simulator remains a heuristic reference-policy environment, not a full Multiway GTO solution.

## Evaluation boundaries

EV and equity use only Hero's cards, the public board and the recorded actions. The server's hidden opponent hands, fixed future board and deal seed are not calculation inputs. Decision-time snapshots are retained before the chosen action; revealing cards later does not re-evaluate or replace past decisions. Acting while calculation is pending records that the estimate was unavailable, rather than inventing one.

Bots use the unchanged `MULTIWAY_CONTEXT_POLICY_V2`, without learned player observations, with their own cards and the evolving public state. EV uses that same declared reference model and public-action-conditioned card priors. This is a model consistency/practice tool; it does not independently calibrate that policy against human opponents. Full hand simulation does not extend the mathematical coverage of the strategic solver.

The existing browser worker produces PREVIEW and FINAL evaluations asynchronously. Actions do not wait for it. Owner, hand and revision changes cancel or reject old results. A stopped refinement retains a valid preliminary estimate, with its actual coverage/status. Numerical uncertainty and `INCONCLUSIVE` remain visible. No result is relabeled GTO or SOLVED.

The configured 350 ms preview/1,800 ms final calculation budgets are unchanged. Network, cold service startup and slower devices can add latency; this feature does not promise a universal three-second SLA. An unsupported browser can use the existing authenticated server calculation fallback.

## Fair deals and review

Each new hand receives a fresh 256-bit cryptographic seed with no hand-strength/EV filtering. A rejection-sampled Fisher–Yates shuffle uses an HMAC-SHA256 stream; the version, seed and deck define a SHA256 commitment disclosed before play. The seed is withheld until completion or explicit abandonment. Hidden hands and the future runout can be revealed only after that point.

The seed and deal-version algorithm in `codigo-fonte/src/multiway-simulation.js` permit independent deck/commitment reconstruction. Bot random choices depend on semantic action history, not random ledger UUIDs, so the same replay/actions/pacing reproduce the same behavior. Replays are clearly identified as informed practice.

Simulation history stores up to 100 completed or explicitly ended hands within a bounded local storage budget, in a separate owner-scoped browser namespace. Older reports may be removed to fit that budget; download them for durable review. Abandonment has no fabricated payout. Compact snapshots retain EV candidates, bounds, method/quality, timing and decision-time public inputs. Actual hand profit is separate from modeled EV and is not a decision-quality certification.

## Using simulations to check EV

**Hand options → Finish with reference policy** explicitly lets the reference policy play the remaining actions, including Hero, and complete the committed runout. This produces a held-out realized utility for the last evaluated Hero action. It does not choose future actions from the displayed EV estimates. Replay, abandoned hands and manual opponent interventions are excluded from these measurements. Exact action/sizing and public-prefix matching are required. Missing estimates remain absent.

**Simulation history → EV validation data** reports descriptive observed-minus-predicted residuals and outcome RMSE in bb. The target utility is final Hero stack minus stack at the decision, rather than total hand profit. A single outcome is noisy; user-selected decisions, correlated hands and model mismatch preclude claiming calibration or GTO accuracy from these summaries. These data never update real Players, observed statistics, ranges, model weights or solver guarantees automatically.

Download the V2 JSON report and run `node codigo-fonte/scripts/simulation-report-check.cjs <export.json>`. The checker independently reconstructs the committed deck and verifies Hero/board prefixes, exact Omaha showdown winners, reported stacks/profit and chip conservation through the authoritative hand ledger/evaluator. It also reports the eligible frozen-decision residuals. This supports accounting/model regression investigations; it is not a replacement for independent strategic solver references or validation against human opponents. Older V1 exports remain verifiable for deal/accounting without inventing missing validation metadata.

## Automatic validation batches

Open **Simulation → Automatic EV validation**, choose the current pending Hero decision or up to five recent saved decisions, and start a batch. Each captured public decision is frozen before action and is checked across 32–512 new compatible worlds (128 by default), for every legal action and the existing minimum/midpoint/maximum/custom sizing grid. Replays are excluded. The active hand does not advance, and no hidden dealer cards, completed runout, private notes or deal seed enter the forecast or validation.

The optional, separately generated browser worker makes a fresh forecast using the existing `MULTIWAY_CONTEXT_POLICY_V2` and evaluates held-out worlds with an independent SHA-256 random stream, full shuffle, continuation traversal and exact 2-hole/3-board Omaha enumeration. It shares the declared response probabilities and authoritative hand ledger deliberately: this tests numerical/model consistency, not independent validation of the behavioral policy or a new strategic solver. Coverage is restricted to Simulation's uniform priors, reference responses and zero rake. Learned profiles, custom explicit ranges and fees are rejected rather than compared under different assumptions.

Reports preserve incremental predicted EV, independently estimated mean utility, signed difference in bb, model-conditional bounded weighted-ratio intervals, effective sample support, checkpoint leader changes, compute time, source/build fingerprint, frozen public context and held-out seed. The difference is validation mean minus forecast; missing forecasts remain null. Forecast and reference each use 95% numerical bounds; the interval formed from both has at least 90% coverage per decision by the union bound. Wide/overlapping bounds are inconclusive, never an automatic pass. Neither agreement nor a separated reference leader establishes GTO or human-player accuracy.

The worker yields between small slices, caps compute at 30 seconds per decision, and commits only worlds completed for all alternatives. A budget stop retains a `PARTIAL_BUDGET` result. Foreground gameplay, new EV, route changes, hidden tabs and editors pause/terminate batch work; Resume is explicit. A paused in-flight slice is discarded and replayed from the last committed checkpoint. Reload restores a paused batch and refuses to resume against a changed validation build. Only the latest batch is retained per account on this device; download its JSON before replacement. Batch results do not change hand progression, bankroll, Players statistics, ranges, model weights or solver guarantees.

The existing river CFR+/LP and per-action bounds are unaffected. This feature does not increase solver coverage. Batch data can identify numerical regressions and future calibration work; changing a response model still requires separately held-out evidence and regression gates.

## Stable gameplay presentation

Turn, network and EV updates reconcile existing DOM elements instead of remounting the workspace. Native selectors, compatible action buttons, the table and user-open disclosures retain their identity. A button is not reused for a different poker action; disabled state and sizing attributes still update from the current state. Temporary disabling restores focus without scrolling when the control becomes available again.

Within a hand, automatic updates retain the current scroll position and the evaluation area's measured footprint through loading/opponent states. Expanded calculation details remain fully readable and are excluded from that retained footprint. A new hand starts a fresh footprint. Primary decision buttons keep a consistent height with or without the leader badge. Reconnecting/error recovery sits after the gameplay layout; retry is offered only after an unsettled request has actually failed, never during a normal pending action. No betting, evaluation, idempotency or accounting rules are changed.

## Reading practice progress

The progress chart plots cumulative settled net profit in chips against the number of settled hands, starting at zero. Straight segments retain every recorded result, including fractional chips; there is no smoothing or projection. The dashed zero line separates profit from loss, with loss portions shown in pink. Axis labels and the current total remain readable on mobile. Empty and flat histories keep a stable plotting area.

Accounting details remain available within the existing disclosure. Replays and hands without a payout do not enter the plotted results. The chart does not change payouts, bankroll bookkeeping, EV, player learning or storage limits.

## Hosting and access

The existing Cloudflare gateway forwards authenticated `/api/simulation/*` requests to the Node service. No new hosting plan, credential or external AI dependency is introduced. The dealer's sessions are server-memory-only, owner-isolated, expire after two hours and are bounded to eight per owner/128 total. Server restart can end an active simulation. Completed local reports remain available; download them for durable review. No session secret is stored in the real workspace or player-learning modules.

## Validation

Focused tests cover private-input exclusion, unfiltered seeds, owner isolation, revision/idempotency checks, replay/pacing equivalence, variant/seat limits, exact tied/side-pot settlements, chip conservation, safe abandonment and expiry. Existing keyboard, voice parser, EV presentation, browser computation and hand-flow regression tests remain required. Browser QA covers desktop, a mobile viewport, pending calculations, actions, streets, showdown, reveal, next-hand stack continuity and exported decision snapshots.
