'use strict';

// A finite river game, not a full-hand solution or a substitute for missing
// ranges. The existing ledger owns legal actions and every chip transfer.
const { createHash } = require('node:crypto');
const { validateRecord, envelope } = require('../multiway-session');
const { replay } = require('../hand-flow');
const { normalizeCards, cardCodes } = require('../cards');
const { evaluateOmaha, compareScores } = require('../evaluator');
const { normalizeRakeSchedule, calculateRake } = require('../rake-model');

const VERSION = 'PLO5_FINITE_RIVER_V2';
const RULES_VERSION = 'OBSERVED_HAND_CENT_LEDGER_0148';
const LIMITS = Object.freeze({ maxNodes: 12000, maxWorlds: 144, maxMemoryBytes: 96 * 1024 * 1024, maxBuildMs: 2400 });
// Range admission is separate from tree capacity: all compatible worlds must
// still fit the unchanged node, memory and construction guards below.
const HU_SUPPORT = Object.freeze({ maxCombosPerSeat: 32, maxSizingLevels: 12, maxWorlds: 1024, maxMemoryBytes: 48 * 1024 * 1024 });
const THREE_SEAT_SUPPORT = Object.freeze({ maxCombosPerSeat: 3, maxSizingLevels: 8, maxWorlds: 27, maxMemoryBytes: 96 * 1024 * 1024 });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const round = value => Math.round(value * 100) / 100;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const sameCards = (a, b) => a.join(',') === b.join(',');
function fail(code, message) { const error = Error(message); error.code = code; throw error; }
function integer(value, low, high, label) {
  if (!Number.isSafeInteger(value) || value < low || value > high) fail('INVALID_BUDGET', `${label} must be an integer from ${low} to ${high}.`);
  return value;
}
function amount(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000000 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7)
    fail('INVALID_AMOUNT', `${label} must be a nonnegative chip amount with at most two decimal places.`);
  return value;
}
function normalizeFee(raw) {
  if (!object(raw)) fail('FEE_MODEL_REQUIRED', 'Choose a declared fee model or before-fees study basis.');
  if (raw.type === 'NONE') return { type: 'NONE', basis: raw.basis === 'BEFORE_FEES' ? 'BEFORE_FEES' : 'NO_FEES' };
  if (raw.type === 'FIXED') return { type: 'FIXED', amount: amount(raw.amount, 'Fixed fee') };
  if (raw.type === 'PERCENT_CAPPED') return normalizeRakeSchedule(raw);
  fail('UNSUPPORTED_FEE_MODEL', 'This river game supports before-fees, fixed fees or an explicit capped percentage schedule.');
}
function feeAt(model, pot) {
  const fee = model.type === 'NONE' ? 0 : model.type === 'FIXED' ? model.amount : calculateRake({ pot, boardCount: 5 }, model);
  if (fee > pot + 1e-8) fail('FEE_EXCEEDS_POT', 'The fixed fee exceeds a reachable terminal pot.');
  return fee;
}
function normalizeSizing(raw, maxLevels) {
  if (!object(raw) || !['MIN_MID_MAX', 'EXPLICIT_TOTALS', 'ALL_LEGAL_TOTALS'].includes(raw.type)) fail('SIZING_REQUIRED', 'Declare the river sizing abstraction.');
  const maxAggressions = integer(raw.maxAggressions, 0, 3, 'Maximum additional aggressive actions');
  if (raw.type === 'MIN_MID_MAX') return { type: raw.type, maxAggressions };
  if (raw.type === 'ALL_LEGAL_TOTALS') return { type: raw.type, version:'LEGAL_CENT_ENUMERATION_V1', maxAggressions, maxLevels };
  if (!Array.isArray(raw.levels) || raw.levels.length < 1 || raw.levels.length > maxLevels) fail('INVALID_SIZING', `Declare one to ${maxLevels} street-total sizes.`);
  const levels = [...new Set(raw.levels.map(value => amount(value, 'Street total')))].sort((a, b) => a - b);
  if (levels.some(value => value <= 0)) fail('INVALID_SIZING', 'Street totals must be positive.');
  return { type: raw.type, levels, maxAggressions };
}
function actionsFor(state, sizing, aggressionCount) {
  const actions = state.legal.actions.filter(action => action !== 'BET' && action !== 'RAISE')
    .map(action => ({ id: action, action, size: null }));
  const aggressive = state.legal.actions.find(action => action === 'BET' || action === 'RAISE');
  if (!aggressive || aggressionCount >= sizing.maxAggressions) return actions;
  const { minTo, maxTo } = state.legal;
  let levels;
  if (sizing.type === 'ALL_LEGAL_TOTALS') {
    const first = Math.round(minTo * 100), last = Math.round(maxTo * 100), count = last - first + 1;
    // Refuse the entire tree before allocating an oversized branch. Never sample
    // or silently truncate this mode; completeness is checked at every node.
    if (count > sizing.maxLevels) fail('EXACT_SIZING_BUDGET', `All legal totals requires at most ${sizing.maxLevels} cent-denominated sizes at every included node. Use an explicit abstraction for this tree.`);
    levels = Array.from({ length: count }, (_, index) => (first + index) / 100);
  } else levels = sizing.type === 'MIN_MID_MAX' ? [minTo, round((minTo + maxTo) / 2), maxTo] : sizing.levels;
  for (const size of [...new Set(levels)].filter(size => size >= minTo && size <= maxTo)) actions.push({ id: `${aggressive}:${size.toFixed(2)}`, action: aggressive, size });
  return actions;
}
function normalize(input) {
  if (!object(input)) fail('INVALID_INPUT', 'A river solver request is required.');
  const record = validateRecord(input.multiway), state = envelope(record).state;
  if (!record.enabled) fail('MULTIWAY_DISABLED', 'Turn on Multiway before solving a decision.');
  if (record.config.variant !== 'PLO5_HIGH') fail('VARIANT_NOT_COVERED', 'This solver slice covers PLO5 high only.');
  if (record.config.playerCount < 2 || record.config.playerCount > 3) fail('TABLE_NOT_COVERED', 'This solver slice covers two or three original seats, including folded seats.');
  if (state.street !== 'RIVER' || state.board.length !== 5) fail('STREET_NOT_COVERED', 'This exact slice requires a complete river board.');
  if (state.phase !== 'BETTING' || state.actor !== state.heroId) fail('NO_DECISION', 'This slice requires the current Hero decision.');
  if (record.config.heroCards.length !== 5) fail('HERO_CARDS_REQUIRED', 'Complete the five Hero cards.');
  if (record.events.some(event => !['ACT', 'BOARD'].includes(event.type))) fail('PARTIAL_HISTORY', 'This slice requires a complete ordered public action history, without out-of-turn or later reveal events.');
  const support = state.players.length === 2 ? HU_SUPPORT : THREE_SEAT_SUPPORT;
  const sizing = normalizeSizing(input.sizing, support.maxSizingLevels), rake = normalizeFee(input.rake);
  if (sizing.type === 'ALL_LEGAL_TOTALS' && state.players.length !== 2) fail('TABLE_NOT_COVERED','All legal totals currently covers river heads-up only.');
  const budgetRaw = input.budget || {}, budget = {};
  for (const [key, maximum] of Object.entries({ ...LIMITS, maxWorlds: support.maxWorlds, maxMemoryBytes: support.maxMemoryBytes }))
    budget[key] = integer(budgetRaw[key] ?? maximum, 1, maximum, key);
  if (!Array.isArray(input.ranges) || input.ranges.length !== state.players.length) fail('COMPLETE_RANGES_REQUIRED', 'Supply an explicit range for every original seat, including Hero and folded players.');
  const ranges = Array(state.players.length), seenSeats = new Set();
  for (const raw of input.ranges) {
    if (!object(raw) || !Number.isInteger(raw.seatId) || !state.players[raw.seatId] || seenSeats.has(raw.seatId)) fail('INVALID_RANGE_SEAT', 'Each range must identify one distinct physical seat.');
    seenSeats.add(raw.seatId);
    if (raw.complete !== true || typeof raw.source !== 'string' || !raw.source.trim() || raw.source.length > 120) fail('RANGE_DEFINITION_REQUIRED', 'Each range must be declared complete for this study and identify its source.');
    if (!Array.isArray(raw.combos) || raw.combos.length < 1 || raw.combos.length > support.maxCombosPerSeat)
      fail('RANGE_BUDGET', `This exact slice accepts one to ${support.maxCombosPerSeat} explicit combinations per seat.`);
    const seenCombos = new Set();
    const combos = raw.combos.map(combo => {
      if (!object(combo) || !Array.isArray(combo.cards)) fail('INVALID_COMBO', 'A range combination needs cards and an explicit weight.');
      const cards = cardCodes(normalizeCards(combo.cards)).sort();
      if (cards.length !== 5) fail('INVALID_COMBO', 'Each PLO5 range combination must contain exactly five cards.');
      const key = cards.join(',');
      if (seenCombos.has(key)) fail('DUPLICATE_COMBO', 'Merge duplicate combinations into one explicit weight.');
      seenCombos.add(key);
      if (typeof combo.weight !== 'number' || !Number.isFinite(combo.weight) || combo.weight <= 0 || combo.weight > 1e12) fail('INVALID_WEIGHT', 'Range weights must be finite and strictly positive.');
      return { cards, weight: combo.weight };
    }).sort((a, b) => a.cards.join(',').localeCompare(b.cards.join(',')));
    const total = combos.reduce((sum, combo) => sum + combo.weight, 0);
    if (combos.some(combo => !(combo.weight / total > 0))) fail('WEIGHT_PRECISION', 'The range weight scale underflows numeric precision; provide a numerically representable study.');
    ranges[raw.seatId] = { seatId: raw.seatId, complete: true, source: raw.source.trim(), combos: combos.map(combo => ({ ...combo, weight: combo.weight / total })) };
  }
  const actualHero = [...record.config.heroCards].sort();
  if (!ranges[state.heroId].combos.some(combo => sameCards(combo.cards, actualHero))) fail('HERO_OUTSIDE_RANGE', 'The current Hero combination must belong to the explicitly defined Hero range.');
  const productWorlds = ranges.reduce((product, range) => product * range.combos.length, 1);
  if (productWorlds > budget.maxWorlds) fail('WORLD_BUDGET', 'The Cartesian range product exceeds the declared world budget.');
  // Public history is fixed at the re-solve boundary. No posterior is invented
  // from previous actions: the supplied ranges define this subgame boundary.
  const config = { variant: record.config.variant, playerCount: record.config.playerCount, heroPosition: record.config.heroPosition,
    startingStack: record.config.startingStack, smallBlind: record.config.smallBlind, bigBlind: record.config.bigBlind,
    ...(record.config.stacks ? { stacks: [...record.config.stacks] } : {}), heroCards: [...record.config.heroCards] };
  const events = record.events.map(event => event.type === 'BOARD' ? { type: 'BOARD', cards: [...event.cards] } :
    { type: 'ACT', actor: event.actor, action: event.action, ...(['BET', 'RAISE'].includes(event.action) ? { to: event.to } : {}) });
  const key = hash({ version: VERSION, rules: RULES_VERSION, config: { ...config, heroCards: undefined }, events, ranges, sizing, rake });
  return { record, state, config, events, sizing, rake, budget, ranges, actualHero, productWorlds, key };
}
function enumerateWorlds(context) {
  const worlds = [], blocked = new Set(context.state.board), hands = [];
  function visit(seat, probability) {
    if (seat === context.ranges.length) { worlds.push({ hands: hands.map(cards => [...cards]), probability }); return; }
    for (const combo of context.ranges[seat].combos) {
      if (combo.cards.some(card => blocked.has(card))) continue;
      for (const card of combo.cards) blocked.add(card);
      const nextProbability = probability * combo.weight;
      if (!(nextProbability > 0)) fail('WEIGHT_PRECISION', 'A positive joint range weight underflows numeric precision; no combination was silently discarded.');
      hands[seat] = combo.cards; visit(seat + 1, nextProbability);
      for (const card of combo.cards) blocked.delete(card);
    }
  }
  visit(0, 1);
  const mass = worlds.reduce((sum, world) => sum + world.probability, 0);
  if (!(mass > 0)) fail('NO_COMPATIBLE_WORLD', 'The declared ranges have no jointly compatible card assignment.');
  for (const world of worlds) world.probability /= mass;
  const heroWorldProbability = worlds.filter(world => sameCards(world.hands[context.state.heroId], context.actualHero)).reduce((sum, world) => sum + world.probability, 0);
  if (!(heroWorldProbability > 0)) fail('HERO_NO_COMPATIBLE_WORLD', 'The current Hero combination has no compatible joint range assignment.');
  return { worlds, compatibleMass: mass, heroWorldProbability };
}
const infoKey = (seat, cards, history) => `${seat}|${cards.join(',')}|${history.join('/')}`;
function eventFor(state, action) { return { type: 'ACT', actor: state.actor, action: action.action, ...(action.size == null ? {} : { to: action.size }) }; }
function advance(context, events, action, state) { return replay(context.config, [...context.events, ...events, eventFor(state, action)]); }
function guardDeadline(context) { if (performance.now() > context.deadline) fail('BUILD_TIME_BUDGET', 'The exact tree reached its build-time budget; no truncated tree was solved.'); }
function preflight(context, worldCount) {
  const metrics = { publicNodes: 0, publicDecisionNodes: 0, publicTerminals: 0, maxDepth: 0,
    aggressionCapNodes: 0, omittedSizingNodes: 0, omittedLegalSizeCount: 0 };
  function visit(state, events, publicHistory, aggressionCount, depth) {
    guardDeadline(context);
    metrics.publicNodes++; metrics.maxDepth = Math.max(metrics.maxDepth, depth);
    const nodes = 1 + metrics.publicNodes * worldCount;
    // Deliberately conservative reservation, including object/string overhead,
    // solver regrets/averages/checkpoints and best-response working storage.
    const reservedBytes = nodes * 8192;
    if (nodes > context.budget.maxNodes) fail('NODE_BUDGET', 'The exact tree exceeds the node budget; reduce the declared abstraction.');
    if (reservedBytes > context.budget.maxMemoryBytes) fail('MEMORY_BUDGET', 'The tree reservation exceeds the memory budget; no partial tree was allocated.');
    if (depth > 24) fail('DEPTH_BUDGET', 'The finite river tree exceeds the supported decision depth.');
    if (state.phase === 'FINISHED' || state.phase === 'SHOWDOWN') {
      metrics.publicTerminals++;
      feeAt(context.rake, state.phase === 'SHOWDOWN' ? state.pot : state.result.pots.reduce((sum, pot) => sum + pot.amount, 0));
      // Keep only data needed by the authoritative settlement replay. Retaining
      // complete ledger logs on every public node would scale with old history.
      return { type: 'terminal', events, state: { phase: state.phase, pot: state.pot,
        players: state.players.map(player => ({ stack: player.stack })), pots: state.pots,
        result: state.result ? { pots: state.result.pots, winners: state.result.winners } : null }, settlements: new Map() };
    }
    if (state.phase !== 'BETTING') fail('UNEXPECTED_STREET', 'The river tree unexpectedly requires another street.');
    metrics.publicDecisionNodes++;
    const actions = actionsFor(state, context.sizing, aggressionCount);
    const aggressive = state.legal.actions.some(action => ['BET', 'RAISE'].includes(action));
    const includedSizes = actions.filter(action => action.size != null).length;
    const legalSizes = aggressive ? Math.round((state.legal.maxTo - state.legal.minTo) * 100) + 1 : 0;
    if (aggressive && aggressionCount >= context.sizing.maxAggressions) metrics.aggressionCapNodes++;
    if (includedSizes < legalSizes) { metrics.omittedSizingNodes++; metrics.omittedLegalSizeCount += legalSizes - includedSizes; }
    return { type: 'decision', player: state.actor, publicHistory, informationSets: new Map(), actions: actions.map(action => ({ id: action.id,
      node: visit(advance(context, events, action, state), [...events, eventFor(state, action)], [...publicHistory, `${state.actor}:${action.id}`],
        aggressionCount + (action.size == null ? 0 : 1), depth + 1) })) };
  }
  const publicTree = visit(context.state, [], [], 0, 0);
  return { publicTree, metrics: { ...metrics, nodes: 1 + metrics.publicNodes * worldCount,
    reservedMemoryBytes: (1 + metrics.publicNodes * worldCount) * 8192 } };
}
function terminal(context, publicNode, scores) {
  const { state, events, settlements } = publicNode;
  let final = state, fee, winners, settlementKey = 'ALL_FOLDED';
  if (state.phase === 'SHOWDOWN') {
    fee = feeAt(context.rake, state.pot);
    winners = state.pots.map(pot => {
      let best = null;
      for (const seat of pot.eligible) if (best == null || compareScores(scores[seat], best) > 0) best = scores[seat];
      return pot.eligible.filter(seat => compareScores(scores[seat], best) === 0);
    });
    settlementKey = JSON.stringify(winners);
    if (!settlements.has(settlementKey)) {
      final = replay(context.config, [...context.events, ...events, { type: 'SETTLE', winners, rake: fee }]);
      context.buildMetrics.settlementReplays++;
    }
  } else {
    // ALL_FOLDED is paid gross by the observation ledger. This study's
    // declared fee is deducted once from that sole winner, after refunds.
    fee = feeAt(context.rake, final.result.pots.reduce((sum, pot) => sum + pot.amount, 0));
  }
  if (settlements.has(settlementKey)) {
    context.buildMetrics.settlementCacheHits++;
    return { type: 'terminal', payoffs: [...settlements.get(settlementKey)] };
  }
  const payoffs = final.players.map((player, seat) => round(player.stack - context.state.players[seat].stack -
    (state.phase === 'FINISHED' && final.result.winners.includes(seat) ? fee : 0)) / context.state.bigBlind);
  const expected = (context.state.pot - fee) / context.state.bigBlind;
  if (Math.abs(payoffs.reduce((sum, value) => sum + value, 0) - expected) > 1e-7) fail('PAYOFF_CONSERVATION', 'Incremental terminal chip conservation failed.');
  settlements.set(settlementKey, payoffs);
  return { type: 'terminal', payoffs: [...payoffs] };
}
function buildTree(context, world, publicTree) {
  // Card-independent legal transitions reuse the canonical public ledger.
  // Only terminal hand ranking and each owner's infoset know private cards.
  const scores = world.hands.map(cards => {
    const key = cards.join(',');
    if (!context.handScores.has(key)) {
      guardDeadline(context);
      context.handScores.set(key, evaluateOmaha(cards, context.state.board).score);
      context.buildMetrics.handRankEvaluations++;
    } else context.buildMetrics.handRankCacheHits++;
    return context.handScores.get(key);
  });
  function visit(publicNode) {
    guardDeadline(context);
    if (publicNode.type === 'terminal') return terminal(context, publicNode, scores);
    const cards = world.hands[publicNode.player], cardsKey = cards.join(',');
    if (!publicNode.informationSets.has(cardsKey)) publicNode.informationSets.set(cardsKey, infoKey(publicNode.player, cards, publicNode.publicHistory));
    // Every chance world still owns a distinct node tree. Only immutable
    // mathematical strings/scores are reused, never hidden-information nodes.
    return { type: 'decision', player: publicNode.player, informationSet: publicNode.informationSets.get(cardsKey),
      actions: publicNode.actions.map(action => ({ id: action.id, node: visit(action.node) })) };
  }
  return visit(publicTree);
}
function rejected(error, started) {
  return { status: 'NOT_SOLVED', coverage: 'NOT_SOLVED', reasons: [{ code: error.code || 'INVALID_INPUT', message: error.message }],
    metrics: { buildMs: performance.now() - started }, game: null };
}
function coverage(input) {
  const started = performance.now();
  try {
    const context = normalize(input), joint = enumerateWorlds(context);
    return { status: 'READY', coverage: 'FINITE_RIVER_SUBGAME', version: VERSION, key: context.key,
      heroInformationSet: infoKey(context.state.heroId, context.actualHero, []), heroSeat: context.state.heroId,
      payoffUnit: 'BB', bigBlind: context.state.bigBlind,
      worlds: joint.worlds.length, originalSeats: context.state.players.length, activeSeats: context.state.activePlayers,
      reasons: [], metrics: { coverageMs: performance.now() - started } };
  } catch (error) { return rejected(error, started); }
}
function buildPloRiverGame(input) {
  const started = performance.now();
  try {
    const context = normalize(input);
    context.deadline = started + context.budget.maxBuildMs;
    const joint = enumerateWorlds(context), { metrics, publicTree } = preflight(context, joint.worlds.length);
    context.handScores = new Map();
    context.buildMetrics = { publicLedgerTransitions: metrics.publicNodes - 1, handRankEvaluations: 0, handRankCacheHits: 0,
      settlementReplays: 0, settlementCacheHits: 0 };
    const rootActions = actionsFor(context.state, context.sizing, 0);
    const meta = { key: context.key, version: VERSION, rulesVersion: RULES_VERSION, variant: 'PLO5_HIGH', street: 'RIVER',
      scope: 'FINITE_RIVER_SUBGAME', originalSeats: context.state.players.length, activeSeats: context.state.activePlayers,
      heroSeat: context.state.heroId, heroInformationSet: infoKey(context.state.heroId, context.actualHero, []),
      rootActions, heroWorldProbability: joint.heroWorldProbability, bigBlind: context.state.bigBlind, payoffUnit: 'BB',
      payoffBasis: 'INCREMENTAL_FROM_CURRENT_DECISION', rootPotBB: context.state.pot / context.state.bigBlind,
      constantSum: context.rake.type === 'NONE' || context.rake.type === 'FIXED',
      constantSumValue: context.rake.type === 'NONE' ? context.state.pot / context.state.bigBlind : context.rake.type === 'FIXED' ? (context.state.pot - context.rake.amount) / context.state.bigBlind : null,
      feeModel: context.rake, sizing: context.sizing, fullLegalSizingCoverage: metrics.omittedSizingNodes === 0,
      treeComplete: true, chanceSupportComplete: true, chanceEnumeration: 'EXACT_JOINT_RANGE_ENUMERATION',
      fullHandEquilibriumSupported: false, safeResolving: false, jointRangeModel: 'INDEPENDENT_WEIGHTS_CONDITIONED_ON_JOINT_BLOCKERS',
      productWorlds: context.productWorlds, compatibleWorlds: joint.worlds.length,
      excludedJointAssignments: context.productWorlds - joint.worlds.length, compatiblePriorMass: joint.compatibleMass,
      ranges: context.ranges, budget: context.budget,
      limitations: ['Equilibrium, if numerically verified, applies only to this explicitly specified river subgame.',
        'This boundary has no full-hand counterfactual-value constraints and is not a safe re-solve of an earlier equilibrium.',
        'Ranges are study inputs conditional on this public decision; no hidden cards, population frequencies or historical reach probabilities are inferred.',
        ...(metrics.omittedSizingNodes ? ['Some legal raises are omitted by the explicitly declared sizing and aggression-depth abstraction.'] : []),
        ...(context.ranges.some(range => range.combos.length === 1) ? ['A singleton range is common knowledge in this study and reveals that seat\'s cards to every strategy.'] : [])] };
    const root = { type: 'chance', outcomes: joint.worlds.map(world => ({ probability: world.probability, node: buildTree(context, world, publicTree) })) };
    guardDeadline(context);
    return { status: 'READY', coverage: metrics.omittedSizingNodes ? 'PARTIAL' : 'FINITE_RIVER_SUBGAME', reasons: [],
      game: { id: `${VERSION}:${context.key}`, playerCount: context.state.players.length, root, meta },
      metrics: { ...metrics, ...context.buildMetrics, worlds: joint.worlds.length, buildMs: performance.now() - started } };
  } catch (error) { return rejected(error, started); }
}

module.exports = { VERSION, RULES_VERSION, LIMITS, HU_SUPPORT, THREE_SEAT_SUPPORT, coverage, buildPloRiverGame, buildRiverGame: buildPloRiverGame,
  _testing: { actionsFor, normalize, enumerateWorlds, feeAt, infoKey } };
