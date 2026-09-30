'use strict';
// Training only. Unknown hands/runouts are sampled afresh from PUBLIC state.
// No session seed, real opponent cards or predealt future board enters here.
const { createHash } = require('node:crypto');
const { replay } = require('./hand-flow');
const { chooseOpponent } = require('./opponent-policy');
const { makeDeck, normalizeCards, cardCodes } = require('./cards');
const { holeCount } = require('./variants');
const { Lcg } = require('./equity-engine');
const fast = require('./fast-evaluator');
const { evaluateStrategy } = require('./strategy-engine');
const { calculatePotMath } = require('./pot-math');
const { describeHand } = require('./hand-insights');
const { attachAnalysisContract } = require('./analysis-contract');

const ACTIONS = ['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE'];
const MODEL = 'POLICY_ROLLOUT';
const POLICY = 'HEURISTIC_OPPONENT_V2';
const RANGE = 'UNIFORM_AT_CURRENT_STATE_NOT_HISTORY_CONDITIONED';
const round = value => Math.round(value * 100) / 100;
const optionId = (action, size) => ['BET', 'RAISE'].includes(action) ? `${action}:${Number(size).toFixed(2)}` : action;

function sizeCandidates(state) {
  const legal = state.legal || state;
  const action = (legal.actions || []).find(name => name === 'BET' || name === 'RAISE');
  if (!action) return [];
  const sizes = [...new Set([legal.minTo, round((legal.minTo + legal.maxTo) / 2), legal.maxTo])];
  return sizes.map(size => ({ optionId: optionId(action, size), action, size }));
}

function publicConfig(config) {
  if (!config || Number(config.playerCount) !== 2 || config.heroPosition !== 'BTN') throw Error('Training evaluation requires heads-up play with you on the button.');
  const result = { variant: config.variant, playerCount: 2, heroPosition: 'BTN',
    startingStack: config.startingStack, smallBlind: config.smallBlind, bigBlind: config.bigBlind,
    heroCards: cardCodes(normalizeCards(config.heroCards)) };
  if (result.heroCards.length !== holeCount(result.variant)) throw Error('Player cards are incomplete for the variant.');
  if (config.stacks) result.stacks = [...config.stacks];
  return result;
}

function publicEvents(events) {
  if (!Array.isArray(events)) throw Error('Public history is missing.');
  return events.map(event => {
    if (event.type === 'BOARD') return { type: 'BOARD', cards: cardCodes(normalizeCards(event.cards)) };
    if (event.type !== 'ACT') throw Error('Evaluation history must end before the hand result.');
    return { type: 'ACT', actor: event.actor, action: String(event.action).toUpperCase(),
      ...(['BET', 'RAISE'].includes(String(event.action).toUpperCase()) ? { to: Number(event.to) } : {}) };
  });
}

function trainingEvaluationInput(session, options = {}) {
  return { config: publicConfig(session.config), events: publicEvents(session.events),
    opponentStyle: session.opponentStyle, samples: options.samples ?? 256,
    ...(options.chosenAction ? { chosenAction: options.chosenAction } : {}),
    ...(options.chosenSize != null ? { chosenSize: Number(options.chosenSize) } : {}) };
}

function normalizeInput(input) {
  const config = publicConfig(input.config), events = publicEvents(input.events);
  const opponentStyle = String(input.opponentStyle || 'MIXED').toUpperCase();
  if (!['PASSIVE', 'MIXED', 'AGGRESSIVE'].includes(opponentStyle)) throw Error('Invalid opponent policy.');
  const samples = Number(input.samples ?? 256);
  if (!Number.isInteger(samples) || samples < 32 || samples > 2048) throw Error('Use between 32 and 2048 rollouts per option.');
  const state = replay(config, events);
  if (state.phase !== 'BETTING' || state.actor !== 0) throw Error('Evaluation requires your pending decision.');
  const actions = state.legal.actions.filter(action => action !== 'FOLD' || state.legal.toCall > 0);
  const candidates = actions.filter(action => !['BET', 'RAISE'].includes(action)).map(action => ({ optionId: action, action, size: null }));
  candidates.push(...sizeCandidates(state));
  if (input.chosenSize != null) {
    const action = actions.find(name => ['BET', 'RAISE'].includes(name));
    const size = Number(input.chosenSize);
    if (action) {
      // The same ledger validates an arbitrary user sizing before any CPU work.
      replay(config, [...events, { type: 'ACT', actor: 0, action, to: size }]);
      if (!candidates.some(candidate => candidate.optionId === optionId(action, size))) candidates.push({ optionId: optionId(action, size), action, size });
    }
  }
  const chosenAction = input.chosenAction ? String(input.chosenAction).toUpperCase() : null;
  if (chosenAction && !actions.includes(chosenAction)) throw Error('The selected action is not legal.');
  if (['BET', 'RAISE'].includes(chosenAction) && input.chosenSize == null) throw Error('Enter the size of the chosen bet.');
  const chosenOptionId = chosenAction ? optionId(chosenAction, input.chosenSize) : null;
  const fingerprint = createHash('sha256').update('THEIBS_POLICY_ROLLOUT_V1\n' + JSON.stringify({ config, events, opponentStyle })).digest('hex');
  return { config, events, state, opponentStyle, samples, actions, candidates, chosenOptionId,
    seed: parseInt(fingerprint.slice(0, 8), 16), fingerprint };
}

function drawWorld(remaining, count, board, rng) {
  const deck = remaining.slice(), need = count + 5 - board.length;
  for (let index = 0; index < need; index++) {
    const other = index + Math.floor(rng.next() * (deck.length - index));
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }
  return { opponent: deck.slice(0, count), board: [...board, ...deck.slice(count, need)],
    policySeed: Math.floor(rng.next() * 0x100000000) };
}

// Exported only under _testing for deterministic conservation/policy fixtures.
// Production never accepts a supplied world or supplied policy from a request.
function rollout(context, candidate, world, policy = chooseOpponent) {
  const { config, events, state: initial, opponentStyle } = context;
  const simulationEvents = [...events, { type: 'ACT', actor: 0, action: candidate.action,
    ...(['BET', 'RAISE'].includes(candidate.action) ? { to: candidate.size } : {}) }];
  const rng = new Lcg(world.policySeed), rngByActor = [rng, new Lcg(world.policySeed ^ 0x9e3779b9)];
  let state = replay(config, simulationEvents), raises = 0, bets = 0, folds = 0, calls = 0;
  for (let step = 0; step < 120; step++) {
    if (state.phase === 'FINISHED') {
      const value = round(state.players[0].stack - initial.players[0].stack);
      return { value, raises, bets, folds, calls, terminalStacks: state.players.map(player => player.stack),
        reason: state.result.reason, showdown: state.result.reason === 'REPORTED_SHOWDOWN' };
    }
    let event;
    if (state.phase === 'WAIT_BOARD') {
      event = { type: 'BOARD', cards: world.board.slice(0, { FLOP: 3, TURN: 4, RIVER: 5 }[state.nextStreet]) };
    } else if (state.phase === 'SHOWDOWN') {
      const heroScore = fast.omahaScore(normalizeCards(config.heroCards), normalizeCards(state.board));
      const opponentScore = fast.omahaScore(normalizeCards(world.opponent), normalizeCards(state.board));
      const winners = heroScore > opponentScore ? [0] : heroScore < opponentScore ? [1] : [0, 1];
      event = { type: 'SETTLE', winners: state.pots.map(pot => {
        const eligibleWinners = winners.filter(id => pot.eligible.includes(id));
        return eligibleWinners.length ? eligibleWinners : pot.eligible;
      }), rake: 0 };
    } else {
      const actor = state.actor;
      const response = policy({ cards: actor === 0 ? config.heroCards : world.opponent,
        board: state.board, legal: state.legal, pot: state.pot,
        style: actor === 0 ? 'MIXED' : opponentStyle,
        streetRaises: state.log.filter(item => item.street === state.street && item.actor === actor && item.action === 'RAISE').length,
        random: () => rngByActor[actor].next() });
      if (response.action === 'RAISE') raises++;
      if (response.action === 'BET') bets++;
      if (response.action === 'FOLD') folds++;
      if (response.action === 'CALL') calls++;
      event = { type: 'ACT', actor, ...response };
    }
    simulationEvents.push(event);
    state = replay(config, simulationEvents);
  }
  // Never silently grade a truncated tree as a completed hand.
  throw Error('The rollout exceeded the action limit; no partial evaluation was used.');
}

function moments() { return { n: 0, mean: 0, m2: 0 }; }
function addMoment(stats, value) {
  stats.n++;
  const delta = value - stats.mean;
  stats.mean += delta / stats.n;
  stats.m2 += delta * (value - stats.mean);
}

function empiricalInterval(stats, lower, upper, comparisons) {
  // Maurer & Pontil (2009), Corollary 5, applied to X and 1-X:
  // https://arxiv.org/pdf/0907.3740. Union bound over the finite candidate set.
  // Bounds concern MC error under this fixed policy/prior, not model validity.
  const logarithm = Math.log(4 * comparisons / .05), width = upper - lower;
  const variance = stats.m2 / (stats.n - 1);
  const margin = Math.sqrt(2 * Math.max(0, variance) * logarithm / stats.n)
    + 7 * width * logarithm / (3 * (stats.n - 1));
  return [Math.max(lower, stats.mean - margin), Math.min(upper, stats.mean + margin)];
}

function candidateLeadership(candidates) {
  const ranked = [...candidates].sort((a, b) => b.ev - a.ev), leader = ranked[0];
  const tied = ranked.filter(item => Math.abs(item.ev - leader.ev) < 1e-12);
  const separated = ranked.slice(1).every(item => leader.confidenceInterval95[0] > item.confidenceInterval95[1]);
  return { status: ranked.length === 1 ? 'SINGLE_MODELED_ACTION' : tied.length > 1 ? 'TIED' : separated ? 'SEPARATED' : 'OVERLAPPING',
    pointLeader: leader.optionId, pointGap: ranked.length > 1 ? leader.ev - ranked[1].ev : null,
    candidateOptions: ranked.filter(item => item.confidenceInterval95[1] >= leader.confidenceInterval95[0]).map(item => item.optionId),
    boundsByOption: Object.fromEntries(candidates.map(item => [item.optionId, { lower: item.confidenceInterval95[0], upper: item.confidenceInterval95[1] }])),
    simultaneousConfidenceLevel: .95, scope: 'FINITE_SIZE_GRID_FIXED_POLICY_UNIFORM_PRIOR',
    intervalMethod: 'EMPIRICAL_BERNSTEIN_UNION_BOUND', fixedSampleBudget: true };
}

function evaluateTraining(input) {
  const started = performance.now(), context = normalizeInput(input);
  const { config, state, candidates, samples, seed, actions } = context;
  fast.initialize();
  const hero = normalizeCards(config.heroCards), board = normalizeCards(state.board);
  const blocked = new Set([...config.heroCards, ...state.board]);
  const remaining = cardCodes(makeDeck()).filter(card => !blocked.has(card));
  const rng = new Lcg(seed), equityStats = moments();
  const stats = candidates.map(() => ({ ...moments(), raises: 0, bets: 0, folds: 0, calls: 0, showdowns: 0 }));
  for (let sample = 0; sample < samples; sample++) {
    const world = drawWorld(remaining, hero.length, state.board, rng);
    addMoment(equityStats, fast.showdown(hero, [normalizeCards(world.opponent)], normalizeCards(world.board)).share);
    for (let index = 0; index < candidates.length; index++) {
      const result = candidates[index].action === 'FOLD' ? { value: 0, raises: 0, bets: 0, folds: 0, calls: 0, showdown: false } : rollout(context, candidates[index], world);
      addMoment(stats[index], result.value);
      for (const field of ['raises', 'bets', 'folds', 'calls']) stats[index][field] += result[field];
      stats[index].showdowns += Number(result.showdown);
    }
  }
  const heroStack = state.players[0].stack, opponentStack = state.players[1].stack;
  const results = candidates.map((candidate, index) => ({ ...candidate, ev: stats[index].mean,
    confidenceInterval95: candidate.action === 'FOLD' ? [0, 0] : empiricalInterval(stats[index], -heroStack, state.pot + opponentStack, candidates.length),
    samples: candidate.action === 'FOLD' ? 0 : samples,
    terminalOutcomes: { showdowns: stats[index].showdowns, folds: stats[index].folds,
      raisesAfterFirstAction: stats[index].raises, betsAfterFirstAction: stats[index].bets, callsAfterFirstAction: stats[index].calls } }));
  const leadership = candidateLeadership(results);
  const recommended = results.find(item => item.optionId === leadership.pointLeader);
  const assumptions = [
    'Opponent hands are sampled uniformly from unseen cards; ranges are not conditioned on past actions.',
    `The opponent follows ${POLICY} (${context.opponentStyle}); after your first action, your decisions follow the MIXED heuristic.`,
    'Rollouts include folds, calls, bets and reraises through the end of the hand, without rake.',
    'Compared sizes are a finite set plus your chosen size; they do not cover every possible size or establish a GTO solution.',
    'Simultaneous 95% intervals cover sampling under fixed policies only; they do not validate the policy or range.'
  ];
  const actionEV = Object.fromEntries(ACTIONS.map(action => {
    const ranked = results.filter(item => item.action === action).sort((a, b) => b.ev - a.ev), best = ranked[0];
    return [action, best ? { status: 'MODELED', ev: best.ev, model: MODEL,
      targetStreetTotal: best.size, heroCost: ['BET', 'RAISE'].includes(action) ? round(best.size - state.players[0].streetPaid) : action === 'CALL' ? state.heroToCall : 0,
      selectedOptionId: best.optionId, confidenceInterval95: best.confidenceInterval95,
      intervalScope: 'SIMULTANEOUS_FINITE_GRID_FIXED_POLICY', assumptions,
      modelScope: 'COMPLETE_HAND_FIXED_CONTINUATION_POLICY' } : { status: 'NOT_LEGAL', ev: null }];
  }));
  const equityMargin = Math.sqrt(Math.log(40) / (2 * samples));
  const equity = { method: 'MONTE_CARLO', equity: equityStats.mean, samples, seed, opponents: 1,
    confidenceInterval95: [Math.max(0, equityStats.mean - equityMargin), Math.min(1, equityStats.mean + equityMargin)],
    intervalMethod: 'HOEFFDING_FIXED_N', scope: 'SHOWDOWN_EQUITY_UNIFORM_NOT_ACTION_EV' };
  const basic = { variant: config.variant, heroCards: config.heroCards, board: state.board,
    position: 'BTN', players: 2, potBeforeAction: state.pot, amountToCall: state.heroToCall,
    effectiveStack: Math.min(heroStack, opponentStack + state.heroToCall), heroContribution: state.players[0].streetPaid };
  const ev = { actions: actionEV, comparisonComplete: true, missingLegalActions: [],
    bestModeledAction: recommended.action, confidence: 'LOW', assumptions, warnings: [] };
  const potMath = calculatePotMath({ ...basic, equity: equity.equity, callModel: actionEV.CALL });
  potMath.callMathScope = 'CURRENT_PRICE_REFERENCE_EV_FROM_POLICY_ROLLOUT';
  const baseline = evaluateStrategy({ input: basic, equity, potMath, ev, legalActions: actions });
  baseline.leadership = { ...baseline.leadership, status: leadership.status,
    simultaneousConfidenceLevel: .95, scope: leadership.scope, candidateOptionIds: leadership.candidateOptions,
    pointLeaderOptionId: leadership.pointLeader, intervalMethod: leadership.intervalMethod };
  // The candidate comparison includes rival sizings within the same action.
  baseline.confidence = leadership.status === 'SEPARATED' ? 'MEDIUM' : 'LOW';
  baseline.reasonCodes = ['TRAINING_POLICY_ROLLOUT', 'FINITE_SIZE_GRID',
    leadership.status === 'SEPARATED' ? 'EV_LEADER_SEPARATED_WITHIN_BOUNDS' : leadership.status === 'TIED' ? 'MODELED_EV_TIE' : 'EV_LEADERSHIP_OVERLAP'];
  baseline.optimalityScope = 'FINITE_SIZE_GRID_FIXED_CONTINUATION_POLICY';
  baseline.assumptions = assumptions;
  baseline.warnings = ['Reference against a simulated policy and uniform range; optimal strategy has not been validated.'];
  const trainingEvaluation = { model: MODEL, policy: { opponent: POLICY, opponentStyle: context.opponentStyle,
    heroContinuation: `${POLICY}_MIXED` }, rangeAssumption: RANGE,
    candidates: results, recommendedOptionId: recommended.optionId, chosenOptionId: context.chosenOptionId,
    leadership, samplesPerOption: samples, totalRollouts: samples * results.filter(item => item.action !== 'FOLD').length,
    pairedSamples: true, seed, publicStateFingerprint: context.fingerprint,
    elapsedMs: Math.round(performance.now() - started), sizingScope: 'LEGAL_MIN_MID_MAX_PLUS_CHOSEN', assumptions };
  return attachAnalysisContract({ status: 'OK', contractVersion: 'THEIBS_DECISION_V1', engineBuild: require('../package.json').version,
    state: { ...basic, street: state.street, opponentCount: 1, actionHistory: state.log,
      knownInformation: { heroCards: true, board: true, position: true, pot: true, amountToCall: true },
      unknownInformation: ['opponentCards', 'futureBoard', 'historyConditionedRange'] },
    ranges: [{ id: 'TRAINING_UNKNOWN', kind: 'UNIFORM', source: 'UNIFORM_UNKNOWN' }],
    baselineAction: recommended.action, recommendedAction: recommended.action, recommendedSize: recommended.size,
    confidence: baseline.confidence, equity, potMath, ev,
    strategy: { baseline, finalAction: recommended.action, finalSource: 'TRAINING_POLICY_ROLLOUT', confidence: baseline.confidence, warnings: baseline.warnings, conflicts: [] },
    trainingEvaluation, legalActions: actions, handInsights: describeHand(config.heroCards, state.board),
    reason: `${recommended.action}${recommended.size != null ? ` to ${recommended.size}` : ''} has the highest estimated EV among tested sizes against the simulated policy. ${leadership.status === 'SEPARATED' ? 'The sample intervals are separated.' : 'The difference between alternatives is still inconclusive.'}`,
    assumptions, warnings: baseline.warnings }, { config, events: input.events, opponentStyle: context.opponentStyle, samples });
}

module.exports = { evaluateTraining, trainingEvaluationInput, sizeCandidates,
  _testing: { normalizeInput, drawWorld, rollout, moments, addMoment, empiricalInterval, candidateLeadership } };
