'use strict';
// Multiway only. Joint private-card worlds and public continuations are sampled
// together; the existing hand ledger owns every legal action and chip transfer.
// The response policy is an explicit study model, not a solver or GTO strategy.
const { createHash } = require('node:crypto');
const { replay } = require('./hand-flow');
const { normalizeCards, cardCodes, makeDeck } = require('./cards');
const { holeCount } = require('./variants');
const { normalizeRange, serializeRange } = require('./range-engine');
const { Lcg } = require('./equity-engine');
const { policyStrength } = require('./opponent-policy');
const { contextFor, getPosterior } = require('./player-profiles');
const { normalizeRakeSchedule, calculateRake } = require('./rake-model');
const { enrichActionEV } = require('./action-ev-presentation');
const { describeHand } = require('./hand-insights');
const { attachAnalysisContract } = require('./analysis-contract');
const ALL_ACTIONS = ['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE'];
const MODEL = 'MULTIWAY_CONTEXT_POLICY_V1';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const round = value => Math.round(value * 100) / 100;
const optionId = (action, size) => size == null ? action : `${action}:${Number(size).toFixed(2)}`;

function candidatesFor(state, chosenSize) {
  const actions = state.legal.actions;
  const candidates = actions.filter(action => !['BET', 'RAISE'].includes(action)).map(action => ({ action, size: null, optionId: action }));
  const aggression = actions.find(action => ['BET', 'RAISE'].includes(action));
  if (aggression) {
    const sizes = [state.legal.minTo, round((state.legal.minTo + state.legal.maxTo) / 2), state.legal.maxTo];
    if (chosenSize != null && chosenSize !== '') sizes.push(Number(chosenSize));
    for (const size of [...new Set(sizes)]) {
      if (!Number.isFinite(size) || size < state.legal.minTo || size > state.legal.maxTo || Math.abs(size * 100 - Math.round(size * 100)) > 1e-7) throw Error('The custom size is outside the legal street totals.');
      candidates.push({ action: aggression, size, optionId: optionId(aggression, size) });
    }
  } else if (chosenSize != null && chosenSize !== '') throw Error('No bet or raise is currently legal.');
  return candidates;
}

function policyDistribution({ state, cards, profile }) {
  const context = contextFor(state), posterior = getPosterior(profile, context);
  const strength = policyStrength(cards, state.board), centered = strength - .5;
  const weights = Object.fromEntries(context.legalActions.map(action => [action, posterior.estimates[action].mean
    * Math.exp((action === 'FOLD' ? -4 : ['BET', 'RAISE'].includes(action) ? 4 : 0) * centered)]));
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  return { probabilities: Object.fromEntries(Object.entries(weights).map(([action, weight]) => [action, weight / total])), posterior };
}
function choosePolicy(state, cards, profile, rng) {
  const distribution = policyDistribution({ state, cards, profile }).probabilities;
  let roll = rng.next(), action = Object.keys(distribution).at(-1);
  for (const [candidate, probability] of Object.entries(distribution)) { roll -= probability; if (roll <= 0) { action = candidate; break; } }
  return { action, ...(['BET', 'RAISE'].includes(action) ? { to: round(state.legal.minTo + (state.legal.maxTo - state.legal.minTo) * rng.next()) } : {}) };
}
function costs(input) {
  const supplied = [input.rakeSchedule != null, input.rake != null && input.rake !== '', input.assumeNoRake === true].filter(Boolean).length;
  if (supplied > 1) throw Error('Declare one rake model only.');
  if (!supplied) return null;
  if (input.rakeSchedule) return { schedule: normalizeRakeSchedule(input.rakeSchedule) };
  const fixed = input.assumeNoRake ? 0 : Number(input.rake);
  if (!Number.isFinite(fixed) || fixed < 0 || Math.abs(fixed * 100 - Math.round(fixed * 100)) > 1e-7) throw Error('Rake must be nonnegative with at most two decimals.');
  return { fixed };
}
function rakeAt(model, pot, boardCount) {
  const rake = model.schedule ? calculateRake({ pot, boardCount }, model.schedule) : model.fixed;
  if (rake > pot + 1e-8) throw Error('Declared fixed rake exceeds an eligible terminal pot.');
  return rake;
}
function normalize(input) {
  const raw = input.multiwayEvaluation || input, supplied = raw.config || {};
  const config = Object.fromEntries(['variant', 'playerCount', 'heroPosition', 'startingStack', 'smallBlind', 'bigBlind', 'stacks'].filter(key => supplied[key] !== undefined).map(key => [key, supplied[key]]));
  if (supplied.players) config.players = supplied.players.map(player => ({ playerId: player.playerId }));
  config.heroCards = supplied.heroCards;
  config.heroCards = cardCodes(normalizeCards(config.heroCards || []));
  const count = holeCount(config.variant);
  if (config.heroCards.length !== count) throw Error('Complete your hole cards to evaluate this decision.');
  if (!Array.isArray(raw.events)) throw Error('Confirmed hand events are required.');
  const events = raw.events.map(event => {
    if (event.type === 'ACT') return { type: 'ACT', actor: event.actor, action: event.action, ...(['BET', 'RAISE'].includes(event.action) ? { to: event.to } : {}) };
    if (event.type === 'BOARD') return { type: 'BOARD', cards: cardCodes(normalizeCards(event.cards)) };
    if (event.type === 'MARK_FOLD') return { type: 'MARK_FOLD', actor: event.actor };
    throw Error('Evaluation accepts public actions and board events before the current decision only.');
  }), state = replay(config, events);
  if (state.phase !== 'BETTING' || state.actor !== state.heroId || state.players[state.heroId].folded) throw Error('Evaluation requires your pending decision.');
  const ids = raw.playerIds || config.players?.map(player => player.playerId) || state.players.map(player => `seat-${player.id}`);
  const validIdentity = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id) && !['__proto__', 'prototype', 'constructor'].includes(id);
  if (!validIdentity(raw.handId)) throw Error('A valid hand identity is required.');
  if (ids.length !== state.players.length || ids.some(id => !validIdentity(id)) || new Set(ids).size !== ids.length) throw Error('Player identities must match the physical seats.');
  const suppliedSnapshot = raw.profileSnapshot || { schemaVersion: 1, handId: raw.handId, source: 'PRE_HAND_OBSERVATIONS', players: {} };
  if (suppliedSnapshot.schemaVersion !== 1 || suppliedSnapshot.handId !== raw.handId || suppliedSnapshot.source !== 'PRE_HAND_OBSERVATIONS' || !suppliedSnapshot.players) throw Error('A pre-hand player snapshot for this hand is required.');
  const snapshot = { schemaVersion: 1, handId: raw.handId, source: 'PRE_HAND_OBSERVATIONS', players: {} };
  for (const id of ids) if (suppliedSnapshot.players[id]) {
    const profile = suppliedSnapshot.players[id], contexts = {};
    for (const [key, cell] of Object.entries(profile.contexts || {})) {
      if (!cell.counts || Object.values(cell.counts).some(value => !Number.isSafeInteger(value) || value < 0 || value > 1e9)
          || Object.keys(cell.counts).some(action => !ALL_ACTIONS.includes(action))) throw Error('Invalid confirmed observation counts.');
      contexts[key] = { counts: { ...cell.counts } };
    }
    snapshot.players[id] = { playerId: id, contexts, observations: Object.values(contexts).reduce((sum, cell) => sum + Object.values(cell.counts).reduce((a, b) => a + b, 0), 0) };
  }
  const samples = Number(raw.samples ?? 96), timeBudgetMs = Number(raw.timeBudgetMs ?? 1800);
  if (!Number.isInteger(samples) || samples < 32 || samples > 512) throw Error('Use 32 to 512 joint simulations.');
  if (!Number.isFinite(timeBudgetMs) || timeBudgetMs < 100 || timeBudgetMs > 2400) throw Error('Use an evaluation budget from 100 to 2,400 ms.');
  const candidates = candidatesFor(state, raw.chosenSize);
  for (const item of candidates) replay(config, [...events, { type: 'ACT', actor: state.heroId, action: item.action, ...(item.size == null ? {} : { to: item.size }) }]);
  const ranges = new Map();
  for (const item of raw.ranges || []) {
    if (!Number.isInteger(item.seatId) || item.seatId === state.heroId || !state.players[item.seatId] || ranges.has(item.seatId)) throw Error('Ranges must identify distinct opponent seats.');
    ranges.set(item.seatId, normalizeRange(item.range, item.seatId, count));
  }
  const publicStates = events.map((event, index) => event.type === 'ACT' && event.actor !== state.heroId ? { event, state: replay(config, events.slice(0, index)) } : null).filter(Boolean);
  const fingerprint = hash({ config, events, ids, snapshot, candidates, ranges: [...ranges], costs: costs(raw), feeBasis:raw.feeBasis, model: MODEL });
  return { raw, config, events, state, count, ids, snapshot, samples, timeBudgetMs, candidates, ranges, publicStates,
    costs: costs(raw), fingerprint, seed: parseInt(fingerprint.slice(0, 8), 16) };
}

function sampleRange(range, rng) {
  let roll = rng.next() * range.totalWeight;
  let last = null;
  for (let index = 0; index < range.hands.length; index++) { if (range.weights[index] <= 0) continue; last = range.hands[index]; roll -= range.weights[index]; if (roll <= 0) return cardCodes(last); }
  return cardCodes(last);
}
function drawWorld(context, rng) {
  const { config, state, ranges, count } = context;
  const known = [...config.heroCards, ...state.board], opponents = state.players.filter(player => player.id !== state.heroId);
  // Sample each declared range independently, then reject the WHOLE joint if
  // cards collide. Sequentially renormalizing ranges would change joint weights.
  for (let attempt = 0; attempt < 2000; attempt++) {
    if (attempt % 32 === 0) checkDeadline(context);
    const blocked = new Set(known), hands = { [state.heroId]: config.heroCards }, explicit = opponents.filter(player => ranges.get(player.id)?.kind !== 'UNIFORM' && ranges.has(player.id));
    let valid = true;
    for (const player of explicit) {
      const hand = sampleRange(ranges.get(player.id), rng);
      if (hand.some(card => blocked.has(card))) { valid = false; break; }
      hands[player.id] = hand; for (const card of hand) blocked.add(card);
    }
    if (!valid) continue;
    const deck = cardCodes(makeDeck()).filter(card => !blocked.has(card));
    const unknown = opponents.filter(player => !hands[player.id]);
    const need = unknown.length * count + 5 - state.board.length;
    if (need > deck.length) throw Error('There are not enough cards for the selected variant and seats.');
    for (let index = 0; index < need; index++) { const other = index + Math.floor(rng.next() * (deck.length - index)); [deck[index], deck[other]] = [deck[other], deck[index]]; }
    let cursor = 0;
    for (const player of unknown) { hands[player.id] = deck.slice(cursor, cursor + count); cursor += count; }
    const board = [...state.board, ...deck.slice(cursor, cursor + 5 - state.board.length)];
    const parsed = Object.fromEntries(Object.entries(hands).map(([seat, hand]) => [seat, normalizeCards(hand)]));
    return { hands, parsed, board, seed: Math.floor(rng.next() * 0x100000000) };
  }
  throw Error('No compatible joint range was sampled within the budget; simplify the explicit ranges.');
}
function checkDeadline(context) {
  if (context.deadline && performance.now() >= context.deadline) { const error = Error('The calculation reached its time budget.'); error.code = 'TIME_BUDGET'; throw error; }
}
function historyWeight(context, world) {
  let logWeight = 0;
  for (const observed of context.publicStates) {
    const actor = observed.event.actor, distribution = policyDistribution({ state: observed.state,
      cards: world.hands[actor], profile: context.snapshot.players[context.ids[actor]] });
    const probability = distribution.probabilities[observed.event.action];
    if (!(probability > 0)) throw Error('The policy cannot represent an observed legal action.');
    logWeight += Math.log(probability);
  }
  return Math.exp(logWeight);
}
function scoresFor(world) { const fast = require('./fast-evaluator'); fast.initialize(); const board = normalizeCards(world.board); return Object.fromEntries(Object.entries(world.parsed).map(([id, cards]) => [id, fast.omahaScore(cards, board)])); }
function rollout(context, candidate, world, scores, injectedPolicy) {
  const { config, state: initial } = context, heroId = initial.heroId;
  const events = [...context.events];
  let state = initial, previous = initial, steps = 0;
  const rng = new Lcg(world.seed);
  const advance = event => { previous = state; events.push(event); state = replay(config, events); };
  advance({ type: 'ACT', actor: heroId, action: candidate.action, ...(candidate.size == null ? {} : { to: candidate.size }) });
  while (++steps < 160) {
    if (steps % 8 === 0) checkDeadline(context);
    if (state.phase === 'FINISHED') {
      let result = state.players[heroId].stack - initial.players[heroId].stack;
      if (state.result?.reason === 'ALL_FOLDED' && state.result.winners.includes(heroId)) {
        const eligible = state.result.pots.reduce((sum, pot) => sum + pot.amount, 0);
        result -= rakeAt(context.costs, eligible, previous.board.length);
      }
      return round(result);
    }
    // Once Hero folds, no later action can change its incremental return.
    if (state.players[heroId].folded) return round(state.players[heroId].stack - initial.players[heroId].stack);
    if (state.phase === 'WAIT_BOARD') { advance({ type: 'BOARD', cards: world.board.slice(0, { FLOP: 3, TURN: 4, RIVER: 5 }[state.nextStreet]) }); continue; }
    if (state.phase === 'SHOWDOWN') {
      const winners = state.pots.map(pot => { const best = Math.max(...pot.eligible.map(id => scores[id])); return pot.eligible.filter(id => scores[id] === best); });
      advance({ type: 'SETTLE', winners, rake: rakeAt(context.costs, state.pot, state.board.length) }); continue;
    }
    const profile = state.actor === heroId ? null : context.snapshot.players[context.ids[state.actor]];
    const response = injectedPolicy ? injectedPolicy(state, world) : choosePolicy(state, world.hands[state.actor], profile, rng);
    advance({ type: 'ACT', actor: state.actor, ...response });
  }
  throw Error('The continuation exceeded its action budget; no truncated result was used.');
}

function weightedMean(values, weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) throw Error('Observed history has insufficient sampling support.');
  return values.reduce((sum, value, index) => sum + value * weights[index], 0) / total;
}
function weightedBounds(values, weights, lower, upper, comparisons, maxSamples) {
  if (lower === upper) return [lower, upper];
  const n = weights.length, denominator = weights.reduce((sum, weight) => sum + weight, 0) / n;
  const numerator = values.reduce((sum, value, index) => sum + weights[index] * (value - lower) / (upper - lower), 0) / n;
  // Hoeffding for bounded weighted numerator and denominator, union over all
  // compared options AND every possible stopping count up to maxSamples. This
  // includes self-normalization uncertainty and remains valid on a time stop.
  const margin = Math.sqrt(Math.log(4 * comparisons * maxSamples / .05) / (2 * n));
  const lo = Math.max(0, (numerator - margin) / (denominator + margin));
  const hi = denominator > margin ? Math.min(1, (numerator + margin) / (denominator - margin)) : 1;
  return [lower + lo * (upper - lower), lower + hi * (upper - lower)];
}

function evaluateMultiway(input) {
  const started = performance.now(), context = normalize(input), { state, candidates, costs: costModel } = context;
  context.deadline = started + context.timeBudgetMs;
  require('./fast-evaluator').initialize();
  const rng = new Lcg(context.seed), weights = [], equityValues = [], values = candidates.map(() => []);
  const opponents = state.players.filter(player => !player.folded && !player.hero);
  const lower = -state.players[state.heroId].stack, upper = state.pot + state.players.filter(player => !player.hero).reduce((sum, player) => sum + player.stack, 0);
  let stopReason = 'SAMPLE_LIMIT';
  for (let sample = 0; sample < context.samples; sample++) {
    try {
      checkDeadline(context);
      const world = drawWorld(context, rng), scores = scoresFor(world), weight = historyWeight(context, world);
      const max = Math.max(scores[state.heroId], ...opponents.map(player => scores[player.id]));
      const tied = 1 + opponents.filter(player => scores[player.id] === scores[state.heroId]).length;
      const outcomes = candidates.map(candidate => candidate.action === 'FOLD' ? 0 : costModel ? rollout(context, candidate, world, scores) : 0);
      // Commit only complete joint worlds: every compared action gets the same
      // cards and sample count. A time stop never mixes unfinished alternatives.
      equityValues.push(scores[state.heroId] === max ? 1 / tied : 0); weights.push(weight);
      for (let index = 0; index < candidates.length; index++) values[index].push(outcomes[index]);
    } catch (error) {
      if (error.code === 'TIME_BUDGET' && weights.length) { stopReason = 'TIME_BUDGET'; break; }
      throw error;
    }
  }
  const n = weights.length, weightSum = weights.reduce((a, b) => a + b, 0), effectiveSamples = weightSum * weightSum / weights.reduce((a, b) => a + b * b, 0);
  const assumptions = [
    'Joint card worlds are conditioned on recorded opponent actions using the declared card-dependent response policy; unseen cards remain simulated.',
    'Response means use the frozen pre-hand Dirichlet profile for this exact variant, original table format and size, position, street, active participant group and call-price band. Missing contexts use the reference prior.',
    'The link between hand strength and actions is an explicit heuristic, not learned card evidence, a solved range or a GTO strategy.',
    'After the evaluated action, opponents use their contextual policy and Hero uses the reference policy; continuations include future bets, reraises, folds, returns and eligible side pots.',
    'Responses depend on the evolving public state and each simulated private hand; no product of global fold rates or heads-up equity average is used.',
    'Bet and raise amounts are street totals. EV deducts only additional contributions from this decision.',
    'Compared sizings are legal minimum, midpoint, maximum and the requested custom size. Other sizes and alternative future policies are not evaluated.',
    'Intervals cover numerical sampling under fixed hypotheses, including weighting and the bounded time stop; they do not measure policy validity or population certainty.'
  ];
  assumptions.push('Profile posterior means are held fixed during this evaluation; their Bayesian uncertainty is reported in Players and is not propagated into action EV intervals.');
  if (!costModel) assumptions.push('Rake is unknown; non-fold action EV remains unavailable.');
  if (context.raw.feeBasis === 'BEFORE_FEES' && costModel?.fixed === 0) assumptions.push('EV is before room fees. No room-specific fee schedule is inferred.');
  const results = candidates.map((candidate, index) => {
    const modeled = candidate.action === 'FOLD' || Boolean(costModel), ev = modeled ? weightedMean(values[index], weights) : null;
    return { ...candidate, status: modeled ? 'MODELED' : 'NOT_MODELED', ev,
      evBB: ev == null ? null : ev / state.bigBlind,
      confidenceInterval95: !modeled ? null : candidate.action === 'FOLD' ? [0, 0] : weightedBounds(values[index], weights, lower, upper, candidates.length + 1, context.samples),
      samples: candidate.action === 'FOLD' ? 0 : modeled ? n : 0,
      method: candidate.action === 'FOLD' ? 'DECISION_REFERENCE' : MODEL, missingInputs: modeled ? [] : ['Declared rake or explicit no-rake assumption'] };
  });
  const ranked = results.filter(item => item.status === 'MODELED').sort((a, b) => b.ev - a.ev), best = ranked[0] || null;
  for (const item of results) item.differenceToBestModeledBB = best && item.ev != null ? (best.ev - item.ev) / state.bigBlind : null;
  const separated = ranked.length > 1 && ranked.slice(1).every(item => best.confidenceInterval95[0] > item.confidenceInterval95[1]);
  const actionEV = Object.fromEntries(ALL_ACTIONS.map(action => {
    const item = [...results].filter(candidate => candidate.action === action).sort((a, b) => (b.ev ?? -Infinity) - (a.ev ?? -Infinity))[0];
    return [action, item ? { ...item, action, legal: true, model: item.status === 'MODELED' ? MODEL : null,
      targetStreetTotal: item.size, heroCost: item.size == null ? action === 'CALL' ? state.legal.toCall : 0 : round(item.size - state.players[state.heroId].streetPaid),
      intervalScope: 'SIMULTANEOUS_RATIO_HOEFFDING_FIXED_POLICY', comparisonContext: context.fingerprint,
      assumptions, warnings: [], selectedOptionId: item.optionId } : { action, legal: false, status: 'NOT_LEGAL', ev: null, warnings: [], assumptions: [], missingInputs: [] }];
  }));
  const legalActions = [...new Set(candidates.map(item => item.action))];
  const basic = { variant: context.config.variant, heroCards: context.config.heroCards, board: state.board,
    street: state.street, position: state.players[state.heroId].position, players: state.activePlayers,
    opponentCount: opponents.length, potBeforeAction: state.pot, amountToCall: state.legal.toCall,
    effectiveStack: state.players[state.heroId].stack, heroContribution: state.players[state.heroId].streetPaid, bigBlind: state.bigBlind };
  const equity = { method: 'MONTE_CARLO', equity: weightedMean(equityValues, weights), samples: n,
    effectiveSamples, seed: context.seed, opponents: opponents.length,
    confidenceInterval95: weightedBounds(equityValues, weights, 0, 1, candidates.length + 1, context.samples),
    intervalMethod: 'JOINT_WEIGHTED_RATIO_HOEFFDING_WITH_STOPPING_UNION_BOUND', stopReason,
    scope: 'SHOWDOWN_SHARE_UNDER_HISTORY_CONDITIONED_PRIOR_NOT_ACTION_EV' };
  const ev = enrichActionEV({ status: ranked.length ? 'MODELED' : 'NOT_MODELED', actions: actionEV, assumptions, warnings: [] }, { ...basic, legalActions }, equity);
  for (const item of Object.values(ev.actions)) if (item.status === 'MODELED') item.comparisonContext = item.action === 'FOLD' ? 'DECISION_POINT_REFERENCE' : context.fingerprint;
  ev.comparisonContexts = [context.fingerprint];
  ev.candidates = results; ev.bestModeledOptionId = best?.optionId || null;
  ev.gapBestSecondCandidateBB = ranked.length > 1 ? (best.ev - ranked[1].ev) / state.bigBlind : null;
  ev.leaderConclusive = Boolean(costModel && separated); ev.globalBestSupported = false;
  ev.comparisonScope = 'FINITE_SIZE_GRID_FIXED_CONTEXTUAL_CONTINUATION_POLICY';
  ev.feeBasis = context.raw.feeBasis === 'BEFORE_FEES' && costModel?.fixed === 0 ? 'BEFORE_FEES' : costModel ? 'DECLARED_FEES' : 'UNKNOWN';
  const policy = { model: MODEL, profileSnapshotHash: hash(context.snapshot), heroContinuation: 'REFERENCE_CONTEXT_POLICY',
    cardDependence: 'HEURISTIC_EXPONENTIAL_STRENGTH_LINK', sizePolicy: 'UNIFORM_LEGAL_STREET_TOTAL', learnedObservations: 'PRE_HAND_ONLY', externallyValidated: false };
  policy.profileUncertaintyPropagation = 'NOT_PROPAGATED_FIXED_POSTERIOR_MEANS';
  const result = { status: 'OK', contractVersion: 'THEIBS_DECISION_V1', state: basic,
    observedState: { ...state, revisionKey: context.raw.revisionKey, handId: context.raw.handId, revision: context.events.length },
    observedSource: 'USER_OBSERVED_ACTIONS', observedOpponentIds: opponents.map(player => player.id),
    opponentHypotheses: opponents.map(player => ({ playerId: context.ids[player.id], seatId: player.id, position: player.position,
      origin: 'FROZEN_PRE_HAND_OBSERVATIONS_AND_DECLARED_REFERENCE_POLICY', snapshotHash: hash(context.snapshot),
      observedActionsBeforeHand: context.snapshot.players[context.ids[player.id]]?.observations || 0,
      situation: { variant: state.variant, street: state.street, participants: state.activePlayers,
        toCall: Math.max(0, state.currentBet - player.streetPaid), stackRemaining: player.stack },
      cards: { model: 'ACTION_LIKELIHOOD_CONDITIONED_JOINT_PRIOR', origin: context.ranges.get(player.id)?.source || 'UNIFORM_PRIOR' },
      responses: [{ model: MODEL, origin: 'CONTEXT_DIRICHLET_PLUS_EXPLICIT_HEURISTIC_STRENGTH_LINK' }] })),
    ranges: opponents.map(player => ({ seatId: player.id, playerId: context.ids[player.id],
      ...(context.ranges.has(player.id) ? serializeRange(context.ranges.get(player.id)) : { kind: 'UNIFORM', source: 'UNIFORM_PRIOR' }),
      conditioning: 'CONFIRMED_ACTION_LIKELIHOOD_UNDER_DECLARED_POLICY' })),
    equity, ev, legalActions, recommendedAction: 'NO_DECISION', baselineAction: best?.action || 'NO_DECISION', confidence: 'LOW',
    potMath: { potBeforeAction: state.pot, amountToCall: state.legal.toCall, evCall: actionEV.CALL.ev,
      potOdds: state.legal.toCall / (state.pot + state.legal.toCall), callMathScope: 'EV_FROM_CONTINUATION_POLICY' },
    strategy: { finalAction: 'NO_DECISION', finalSource: MODEL, confidence: 'LOW', conflicts: [], warnings: [],
      baseline: { action: best?.action || 'NO_DECISION', bestModeledAction: best?.action || null,
        leadership: { status: separated ? 'SEPARATED' : 'OVERLAPPING', candidateOptions: results.map(item => item.optionId), scope: ev.comparisonScope } },
      exploit: { finalAction: 'NO_DECISION', finalSource: MODEL } },
    multiwayEvaluation: { model: MODEL, policy, candidates: results, fingerprint: context.fingerprint,
      profileSnapshotHash: policy.profileSnapshotHash, revisionKey: context.raw.revisionKey, handId: context.raw.handId,
      samples: n, requestedSamples: context.samples, effectiveSamples, elapsedMs: performance.now() - started,
      stopReason, rangeMethod: 'JOINT_IMPORTANCE_SAMPLING_CONDITIONED_ON_CONFIRMED_ACTIONS',
      intervalMethod: equity.intervalMethod, sizeScope: ev.comparisonScope },
    handInsights: describeHand(context.config.heroCards, state.board), assumptions,
    reason: !costModel ? 'Declare rake to calculate non-fold action EV.' : 'Action EV is conditional on a contextual continuation model. The table compares tested sizes; it is not a solved strategy.',
    warnings: ['The response policy and its card-strength link are modeling assumptions, not validated opponent strategies.',
      ...(effectiveSamples < 16 ? ['History conditioning has low effective sample support; action differences are inconclusive.'] : [])] };
  return attachAnalysisContract(result, { ...basic, handId: context.raw.handId, revisionKey: context.raw.revisionKey,
    config: context.config, events: context.events, profileSnapshot: context.snapshot,
    ranges: [...context.ranges].map(([seatId, range]) => ({ seatId, range: serializeRange(range) })),
    samples: context.samples, timeBudgetMs: context.timeBudgetMs, chosenSize: context.raw.chosenSize,
    ...(context.costs?.schedule ? { rakeSchedule: context.costs.schedule } : context.costs ? { rake: context.costs.fixed } : {}),
    futureStreetModel: policy });
}
module.exports = { MODEL, evaluateMultiway, candidatesFor, policyDistribution,
  _testing: { normalize, drawWorld, historyWeight, rollout, scoresFor, weightedBounds, weightedMean, costs, rakeAt } };
