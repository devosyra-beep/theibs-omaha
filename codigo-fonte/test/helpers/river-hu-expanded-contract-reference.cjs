'use strict';
// QA only. The rational oracle never imports CFR, production best responses or
// production action conditioning. Exhaustive pure policies are deliberately
// limited to small, explicitly supplied two-player river studies.
const assert = require('node:assert/strict');
const session = require('../../src/multiway-session');
const fixtures = require('./solver-reference-fixtures.cjs');

const LIMITS = Object.freeze({ maxNodes: 1600, maxPurePolicies: 4096, maxDepth: 32 });
const ZERO = Object.freeze({ n: 0n, d: 1n }), ONE = Object.freeze({ n: 1n, d: 1n });
const abs = value => value < 0n ? -value : value;
function gcd(a, b) { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a; }
function fraction(n, d = 1n) {
  assert.notEqual(d, 0n); if (!n) return ZERO;
  if (d < 0n) { n = -n; d = -d; }
  const divisor = gcd(n, d); return { n: n / divisor, d: d / divisor };
}
function fromNumber(value) {
  assert.ok(Number.isFinite(value), 'Rational oracle accepts only finite binary64 inputs.');
  if (!value) return ZERO;
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value);
  const bits = view.getBigUint64(0), sign = bits >> 63n ? -1n : 1n;
  const exponent = Number((bits >> 52n) & 2047n), mantissa = bits & ((1n << 52n) - 1n);
  const significand = sign * (exponent ? (1n << 52n) | mantissa : mantissa);
  const power = exponent ? exponent - 1023 - 52 : -1074;
  return power >= 0 ? fraction(significand << BigInt(power)) : fraction(significand, 1n << BigInt(-power));
}
const add = (a, b) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
const subtract = (a, b) => fraction(a.n * b.d - b.n * a.d, a.d * b.d);
const multiply = (a, b) => fraction(a.n * b.n, a.d * b.d);
const divide = (a, b) => fraction(a.n * b.d, a.d * b.n);
const compare = (a, b) => { const difference = a.n * b.d - b.n * a.d; return difference > 0n ? 1 : difference < 0n ? -1 : 0; };
const sum = values => values.reduce(add, ZERO);
function normalized(values) { assert.ok(values.every(value => value.n >= 0n)); const total = sum(values); assert.ok(total.n > 0n); return values.map(value => divide(value, total)); }
function toNumber(value) {
  // Scale both operands before conversion so large exact denominators do not
  // overflow Number. This approximation is reporting only; comparisons use BigInt.
  if (!value.n) return 0;
  const numeratorBits = abs(value.n).toString(2).length, denominatorBits = value.d.toString(2).length;
  const shift = Math.max(0, Math.max(numeratorBits, denominatorBits) - 1000);
  return Number(value.n >> BigInt(shift)) / Number(value.d >> BigInt(shift));
}
const encode = value => ({ numerator: String(value.n), denominator: String(value.d), approximateBB: toNumber(value) });
function assertOuterInterval(lower, upper, exactLower, exactUpper, label = '') {
  assert.ok(compare(fromNumber(lower), exactLower) <= 0, `${label}: lower endpoint excludes the exact feasible-policy lower value.`);
  assert.ok(compare(fromNumber(upper), exactUpper) >= 0, `${label}: upper endpoint excludes the exact feasible-policy upper value.`);
}

function inspect(game) {
  assert.equal(game.playerCount, 2);
  const infos = [new Map(), new Map()]; let nodes = 0, depth = 0;
  function visit(node, level, history) {
    assert.ok(++nodes <= LIMITS.maxNodes, 'Exact QA node cap exceeded.');
    assert.ok(level <= LIMITS.maxDepth, 'Exact QA depth cap exceeded.'); depth = Math.max(depth, level);
    if (node.type === 'terminal') { node.payoffs.forEach(fromNumber); return; }
    if (node.type === 'chance') { normalized(node.outcomes.map(edge => fromNumber(edge.probability))); for (const edge of node.outcomes) visit(edge.node, level + 1, history); return; }
    assert.equal(node.type, 'decision'); assert.ok([0, 1].includes(node.player));
    const actions = node.actions.map(edge => edge.id), recall = JSON.stringify(history[node.player]);
    const found = infos[node.player].get(node.informationSet);
    if (found) { assert.deepEqual(found.actions, actions); assert.equal(found.recall, recall, 'Exact oracle refuses imperfect recall.'); }
    else infos[node.player].set(node.informationSet, { id: node.informationSet, actions, recall });
    for (const edge of node.actions) {
      const next = history.map(row => row.slice()); next[node.player].push([node.informationSet, edge.id]); visit(edge.node, level + 1, next);
    }
  }
  visit(game.root, 0, [[], []]);
  const informationSets = infos.map(map => [...map.values()]);
  const purePolicies = informationSets.map(rows => rows.reduce((count, row) => count * row.actions.length, 1));
  assert.ok(purePolicies.every(count => count <= LIMITS.maxPurePolicies), 'Exact QA pure-policy cap exceeded.');
  return { informationSets, purePolicies, nodes, depth };
}
function restrictIndependently(game, condition) {
  const copy = structuredClone(game); let count = 0;
  function visit(node) {
    if (node.type === 'decision') {
      if (node.player === condition.player && node.informationSet === condition.informationSet) {
        node.actions = node.actions.filter(edge => edge.id === condition.actionId); assert.equal(node.actions.length, 1); count++;
      }
      node.actions.forEach(edge => visit(edge.node));
    } else if (node.type === 'chance') node.outcomes.forEach(edge => visit(edge.node));
  }
  visit(copy.root); assert.ok(count > 0); return copy;
}
function preparedEvaluator(game, strategy, heroSeat = 0) {
  function prepare(node) {
    if (node.type === 'terminal') return { type: 'terminal', value: fromNumber(node.payoffs[heroSeat]) };
    if (node.type === 'chance') return { type: 'chance', weights: normalized(node.outcomes.map(edge => fromNumber(edge.probability))), children: node.outcomes.map(edge => prepare(edge.node)) };
    const weights = node.actions.length === 1 ? [ONE] : normalized(node.actions.map(edge => {
      const weight = strategy?.[node.player]?.[node.informationSet]?.[edge.id]; assert.ok(Number.isFinite(weight) && weight >= 0); return fromNumber(weight);
    }));
    return { type: 'decision', player: node.player, id: node.informationSet, actions: node.actions.map(edge => edge.id), weights, children: node.actions.map(edge => prepare(edge.node)) };
  }
  const root = prepare(game.root);
  function value(node, purePlayer, policy) {
    if (node.type === 'terminal') return node.value;
    if (node.type === 'decision' && node.player === purePlayer) return value(node.children[node.actions.indexOf(policy[node.id])], purePlayer, policy);
    return sum(node.children.map((child, index) => node.weights[index].n ? multiply(node.weights[index], value(child, purePlayer, policy)) : ZERO));
  }
  return (player, policy) => value(root, player, policy);
}
function exactPolicyEnvelope(game, strategy, heroSeat = 0) {
  assert.ok([0, 1].includes(heroSeat));
  const metrics = inspect(game), evaluate = preparedEvaluator(game, strategy, heroSeat), best = [null, null];
  const policies = [{}, {}];
  for (const player of [0, 1]) {
    function enumerate(index) {
      if (index === metrics.informationSets[player].length) {
        const value = evaluate(player, policies[player]);
        if (best[player] === null || compare(value, best[player]) * (player === heroSeat ? 1 : -1) > 0) best[player] = value;
        return;
      }
      const info = metrics.informationSets[player][index];
      for (const action of info.actions) { policies[player][info.id] = action; enumerate(index + 1); }
    }
    enumerate(0);
  }
  return { lower: best[1 - heroSeat], upper: best[heroSeat], profile: evaluate(-1, {}), metrics };
}
function conditionalCurrentProfileAction(game, strategy, condition) {
  const restricted = restrictIndependently(game, condition);
  assert.equal(restricted.root.type, 'chance');
  restricted.root.outcomes = restricted.root.outcomes.filter(edge => edge.node.player === condition.player && edge.node.informationSet === condition.informationSet);
  assert.ok(restricted.root.outcomes.length);
  return preparedEvaluator(restricted, strategy, condition.player)(-1, {});
}

const act = (actor, action, to) => ({ type: 'ACT', actor, action, ...(to == null ? {} : { to }) });
function checkedRiver({ board = fixtures.board, heroCards = fixtures.heroCards, startingStack = 20, stacks } = {}) {
  let current = session.start({ variant: 'PLO5_HIGH', playerCount: 2, heroPosition: 'SB', startingStack, smallBlind: .5, bigBlind: 1, heroCards, ...(stacks ? { stacks } : {}) });
  for (let step = 0; !(current.state.street === 'RIVER' && current.state.actor === current.state.heroId); step++) {
    assert.ok(step < 40);
    current = session.step(current.multiway, current.state.phase === 'WAIT_BOARD'
      ? { type: 'BOARD', cards: board.slice(0, { FLOP: 3, TURN: 4, RIVER: 5 }[current.state.nextStreet]) }
      : act(current.state.actor, current.state.legal.toCall ? 'CALL' : 'CHECK'));
  }
  return current.multiway;
}
function identify(input, index) {
  input.multiway.handId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`; input.multiway.editEpoch = 0; return input;
}
function scenarios() {
  const cases = [];
  function put(id, categories, input, expectation = {}, reference = true) { cases.push({ id, categories, input: identify(input, cases.length), expectation, reference }); }
  const marginal = (win, fee = 0) => { const input = fixtures.riverCallInput({ fee }); input.ranges[1].combos[0].weight = win; input.ranges[1].combos[1].weight = 1 - win; return input; };
  const nuts = fixtures.riverCallInput();
  nuts.multiway.config.heroCards = ['As', 'Ts', '8h', '7d', '6c'];
  for (const event of nuts.multiway.events) if (event.type === 'BOARD') event.cards = ['Ks', 'Qs', 'Js', '2d', '3c'].slice(0, event.cards.length);
  nuts.ranges = [fixtures.range(0, [[nuts.multiway.config.heroCards, 1]]), fixtures.range(1, [[['Kh', 'Kd', '4s', '5c', '6d'], 8], [['9s', '8s', 'Kc', '7h', '7c'], 1]])];
  put('royal_flush_nuts_facing_bet', ['NUTS', 'NONUNIFORM_OPPONENT'], nuts, { profileCallEVBB: 30, commitmentCallBB: 30 });
  put('marginal_positive_call', ['MARGINAL', 'NONUNIFORM_OPPONENT'], marginal(.3), { profileCallEVBB: 2 });
  put('marginal_true_action_tie', ['MARGINAL', 'ACTION_TIE'], marginal(.25), { profileCallEVBB: 0, trueActionTie: true });
  put('marginal_negative_call', ['MARGINAL', 'NONUNIFORM_OPPONENT'], marginal(.2), { profileCallEVBB: -2 });
  put('fixed_rake_changes_preferred_action', ['MARGINAL', 'FIXED_RAKE'], marginal(.3, 8), { profileCallEVBB: -.4 });
  put('decimal_fixed_rake', ['MARGINAL', 'DECIMAL_FIXED_RAKE'], marginal(.3, .3), { profileCallEVBB: 1.91 });
  const tied = fixtures.riverCallInput(); tied.multiway.config.heroCards = ['5s', '6s', 'As', 'Kh', 'Tc'];
  tied.ranges = [fixtures.range(0, [[tied.multiway.config.heroCards, 1]]), fixtures.range(1, [[['5h', '6h', 'Ad', 'Kc', 'Td'], 1]])];
  put('equal_straights_split_pot', ['SHOWDOWN_TIE'], tied, { profileCallEVBB: 10, tiedShowdown: true });
  put('joint_blockers_nonuniform_prior', ['JOINT_BLOCKERS', 'NONUNIFORM_BOTH', 'PROFILE_VS_COMMITMENT'], fixtures.riverCallInput({ blockers: true }), { distinctProfileAndCommitment: true, expectedWorlds: 3 });
  const boardBlocker = marginal(.3); boardBlocker.ranges[1].combos.push({ cards: ['2s', '5c', '6d', '7h', 'Th'], weight: 9 });
  put('board_blocked_mass_excluded', ['BOARD_BLOCKERS', 'PRIOR_RENORMALIZATION'], boardBlocker, { profileCallEVBB: 2, expectedWorlds: 2 });
  const price = marginal(.3); price.multiway.events.at(-1).to = 11;
  put('current_bet_changes_price_and_pot', ['CALL_PRICE', 'POT'], price, { profileCallEVBB: 1.6 });
  const pot = marginal(.3); pot.multiway.events.find((event, index) => index > 6 && event.action === 'BET').to = 4;
  put('past_commitment_changes_pot', ['PUBLIC_HISTORY', 'POT'], pot, { profileCallEVBB: 2.6 });
  const stack = marginal(.3); stack.multiway.config.stacks = [20, 30];
  put('unequal_short_stacks_facing_bet', ['STACK', 'ALL_IN_CAP'], stack, { profileCallEVBB: 2 });
  for (const [id, edit, categories] of [
    ['mixed_nonuniform_two_private_types', input => { input.ranges[0].combos[0].weight = 3; input.ranges[0].combos[1].weight = 1; input.ranges[1].combos[0].weight = 1; input.ranges[1].combos[1].weight = 4; }, ['NONUNIFORM_BOTH', 'STRATEGIC_RESPONSE']],
    ['rare_actual_hand_full_prior_commitment', input => { input.ranges[0].combos[0].weight = .001; input.ranges[0].combos[1].weight = 5; }, ['RARE_HERO', 'PROFILE_VS_COMMITMENT', 'STRATEGIC_RESPONSE']],
    ['short_stack_changes_legal_tree', input => { input.multiway.config.stacks = [2.5, 3]; }, ['STACK', 'ALL_IN_CAP', 'STRATEGIC_RESPONSE']]
  ]) {
    const input = fixtures.riverMixedInput(); input.sizing = { type: 'EXPLICIT_TOTALS', levels: [1, 2], maxAggressions: 1 }; edit(input);
    put(id, categories, input, { strategic: true });
  }
  const percent = marginal(.3); percent.rake = { type: 'PERCENT_CAPPED', rate: .05, cap: 1, noFlopNoDrop: true, rounding: 'FLOOR_CENT', source: 'SYNTHETIC_STUDY', version: '1' };
  put('percentage_fee_not_constant_sum_qualified', ['PERCENTAGE_FEE', 'UNQUALIFIED_CERTIFICATES'], percent, { unsupportedCertificates: true }, false);
  const bigBlindHero = marginal(.3); bigBlindHero.multiway.config.heroPosition = 'BB';
  bigBlindHero.multiway.events.pop(); bigBlindHero.multiway.events.push(act(1, 'CHECK'), act(0, 'BET', 10));
  bigBlindHero.ranges = [fixtures.range(0, [[fixtures.weak, .3], [fixtures.strong, .7]]), fixtures.range(1, [[fixtures.heroCards, 1]])];
  put('big_blind_hero_reversed_utility_orientation', ['HERO_PLAYER_ONE', 'POSITION', 'MARGINAL'], bigBlindHero, { profileCallEVBB: 2 });
  return cases;
}

// Independent terminal accounting for this QA slice: at most one new river
// aggression; every leaf is fold or showdown. Initial observed stacks/pot are
// ledger inputs. Subsequent transfers, refunds, Omaha ranking and payout are QA.
const cents = value => Math.round(value * 100);
function terminalAudit(input, game) {
  const state = session.envelope(input.multiway).state, publicCards = state.board;
  const ordered = input.ranges.map(range => range.combos.map(combo => ({ cards: [...combo.cards].sort(), weight: combo.weight }))
    .sort((a, b) => a.cards.join(',').localeCompare(b.cards.join(','))));
  const worlds = [];
  for (const hero of ordered[0]) for (const opponent of ordered[1]) {
    if (new Set([...publicCards, ...hero.cards, ...opponent.cards]).size !== 15) continue;
    worlds.push({ hands: [hero.cards, opponent.cards], mass: hero.weight * opponent.weight });
  }
  assert.equal(worlds.length, game.root.outcomes.length);
  let terminals = 0, ties = 0;
  for (let index = 0; index < worlds.length; index++) {
    const world = worlds[index], comparison = fixtures.compareRanks(fixtures.omahaRank(world.hands[0], publicCards), fixtures.omahaRank(world.hands[1], publicCards));
    if (!comparison) ties++;
    const start = state.players.map(player => cents(player.stack));
    function visit(node, stacks, streetPaid, pot, folded) {
      if (node.type === 'decision') {
        for (const edge of node.actions) {
          const nextStacks = stacks.slice(), nextPaid = streetPaid.slice(), nextFolded = folded.slice(), [action, total] = edge.id.split(':'); let contribution = 0;
          if (action === 'FOLD') nextFolded[node.player] = true;
          else if (action === 'CALL') contribution = Math.min(nextStacks[node.player], Math.max(...nextPaid) - nextPaid[node.player]);
          else if (action === 'BET' || action === 'RAISE') contribution = cents(Number(total)) - nextPaid[node.player];
          else assert.equal(action, 'CHECK');
          nextStacks[node.player] -= contribution; nextPaid[node.player] += contribution;
          visit(edge.node, nextStacks, nextPaid, pot + contribution, nextFolded);
        }
        return;
      }
      assert.equal(node.type, 'terminal'); terminals++;
      const highest = streetPaid[0] > streetPaid[1] ? 0 : 1, refund = Math.abs(streetPaid[0] - streetPaid[1]);
      if (refund && !folded[highest]) { stacks[highest] += refund; pot -= refund; }
      const fee = input.rake.type === 'NONE' ? 0 : input.rake.type === 'FIXED' ? cents(input.rake.amount)
        : Math.min(pot, cents(input.rake.cap), Math.floor(pot * input.rake.rate + 1e-9));
      let winners;
      if (folded.some(Boolean)) winners = [folded[0] ? 1 : 0];
      else winners = comparison ? [comparison > 0 ? 0 : 1] : [0, 1];
      const net = pot - fee, award = Math.floor(net / winners.length), remainder = net % winners.length;
      winners.forEach((winner, offset) => { stacks[winner] += award + (offset < remainder ? 1 : 0); });
      const expected = stacks.map((stack, seat) => (stack - start[seat]) / cents(state.bigBlind));
      assert.deepEqual(node.payoffs, expected, `Independent cent payoff mismatch at world ${index}.`);
    }
    visit(game.root.outcomes[index].node, start.slice(), state.players.map(player => cents(player.streetPaid)), cents(state.pot), [false, false]);
  }
  return { worlds: worlds.length, terminalPayoffChecks: terminals, tiedWorlds: ties, method: 'INDEPENDENT_OMAHA_TWO_PLUS_THREE_AND_CENT_TRANSFERS', initialStateSource: 'OBSERVED_LEDGER_INPUT', subsequentTransfersSource: 'QA_ARITHMETIC' };
}

module.exports = { LIMITS, ZERO, ONE, fraction, fromNumber, add, subtract, multiply, divide, compare, toNumber, encode, assertOuterInterval,
  inspect, restrictIndependently, exactPolicyEnvelope, conditionalCurrentProfileAction, checkedRiver, scenarios, terminalAudit };

function fixedMathematicalSnapshot(output) {
  const result = output.result, checkpoint = output.checkpoint;
  const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key] ?? null]));
  return { ...pick(result, ['status', 'method', 'solverVersion', 'gameHash', 'scope', 'strategyScope', 'iterations', 'actions', 'convergence', 'qualification', 'decisionPrecision', 'rootDiagnostics']),
    actionPrecision: { ...pick(result.actionPrecision, ['version', 'target', 'origin', 'solverVersion', 'player', 'informationSet', 'baseGameHash', 'baseContextKey', 'scope', 'utility', 'supportedGameClass', 'status', 'fullPriorPreserved', 'originalHandActionEV', 'focus']),
      actions: result.actionPrecision.actions.map(row => pick(row, ['id', 'certified', 'lowerBB', 'upperBB', 'boundsBB', 'estimateBB', 'baseGameHash', 'baseContextKey', 'gameHash', 'conditionedHash', 'target', 'fullPriorPreserved', 'originalHandActionEV', 'iterations', 'strategicDecisionCount', 'profileValueBB', 'convergence'])) },
    checkpoint: pick(checkpoint, ['version', 'solverVersion', 'certificateVersion', 'baseContextKey', 'baseGameHash', 'global', 'actionCheckpoints', 'attempts', 'supportedGameClass', 'iterations', 'workIterations']) };
}

function runReferenceCase(scenario) {
  const started = performance.now();
  const adapter = require('../../src/solver/plo-river-game'), core = require('../../src/solver/extensive-solver');
  const conditioned = require('../../src/solver/action-conditioned'), worker = require('../../src/solver/job-worker');
  const { reference } = require('./sequence-form-reference.cjs');
  const built = adapter.buildPloRiverGame(scenario.input); assert.equal(built.status, 'READY', JSON.stringify(built.reasons));
  const game = built.game, audit = terminalAudit(scenario.input, game), limits = inspect(game);
  if (scenario.expectation.expectedWorlds) assert.equal(audit.worlds, scenario.expectation.expectedWorlds);
  if (scenario.expectation.tiedShowdown) assert.equal(audit.tiedWorlds, audit.worlds);
  const fixedBudget = { timeMs: 5000, iterations: 512 };
  const defaultOutput = worker.execute({ input: scenario.input, budget: fixedBudget });
  const output = worker.execute({ input: scenario.input, budget: fixedBudget }, { compilationReuse: true });
  assert.equal(defaultOutput.result.metrics.compilation, undefined, 'Default Node execution must retain the uncached route.');
  assert.equal(output.result.metrics.compilation.scope, 'CURRENT_EXECUTION_ONLY');
  assert.deepEqual(fixedMathematicalSnapshot(output), fixedMathematicalSnapshot(defaultOutput), 'Default Node and trusted browser compilation reuse must preserve exact fixed-work mathematics.');
  assert.notEqual(output.result.adaptation?.stopReason, 'TIME_RESOURCE_CEILING', 'Fixed-work comparison must not stop on time.');
  const result = { id: scenario.id, categories: scenario.categories, input: scenario.input, expectation: scenario.expectation,
    expectedRevisionKey: session.envelope(scenario.input.multiway).state.revisionKey, gameKey: game.meta.key,
    gameHash: core.validateGame(game).gameHash, heroInformationSet: game.meta.heroInformationSet,
    build: built.metrics, independentTerminalAudit: audit, exactOracleLimits: { ...LIMITS, nodes: limits.nodes, purePolicies: limits.purePolicies },
    defaultVsTrustedBrowserFixedMathematicsEqual: true,
    defaultNodeFixedWork: { workIterations: defaultOutput.checkpoint?.workIterations, globalIterations: defaultOutput.result.iterations,
      status: defaultOutput.result.status, decisionStatus: defaultOutput.result.decisionPrecision?.status, stopReason: defaultOutput.result.adaptation?.stopReason,
      workerMs: defaultOutput.workerMs, compilationReuse: false },
    fixedBudget, fixedWork: { workIterations: output.checkpoint?.workIterations, globalIterations: output.result.iterations,
      status: output.result.status, decisionStatus: output.result.decisionPrecision?.status, stopReason: output.result.adaptation?.stopReason,
      nashConv: output.result.convergence?.nashConv, actions: output.result.actions, costs: output.result.metrics?.costs,
      workerMs: output.workerMs, baseContextKey: output.checkpoint?.baseContextKey, trustedCompilationReuse: true }, actions: [] };
  assert.equal(output.result.qualification.gto, false); assert.equal(output.result.qualification.fullHandEquilibrium, false);
  if (!scenario.reference) {
    assert.equal(output.result.status, 'APPROXIMATE'); assert.equal(output.result.actionPrecision.status, 'UNSUPPORTED');
    assert.equal(output.result.decisionPrecision.status, 'INCONCLUSIVE'); assert.equal(output.result.actionPrecision.actions.some(row => row.certified), false);
    result.referenceStatus = 'NOT_APPLICABLE_UNQUALIFIED_FEE_CLASS'; result.elapsedMs = performance.now() - started; return result;
  }
  const originalLP = reference({ game });
  const originalEnvelope = exactPolicyEnvelope(game, originalLP.strategy, game.meta.heroSeat);
  result.heroSeat = game.meta.heroSeat;
  result.originalGameReference = { method: originalLP.method, numericalValueBB: originalLP.values[game.meta.heroSeat], residuals: originalLP.residuals,
    residualToleranceBB: originalLP.validationTolerance, runtime: originalLP.runtime, metrics: originalLP.metrics,
    exactFeasiblePolicyEnvelope: { lower: encode(originalEnvelope.lower), upper: encode(originalEnvelope.upper) } };
  for (const action of game.meta.rootActions) {
    const condition = { player: game.meta.heroSeat, informationSet: game.meta.heroInformationSet, actionId: action.id };
    const lp = reference({ game, condition }), independentGame = restrictIndependently(game, condition);
    const lpEnvelope = exactPolicyEnvelope(independentGame, lp.strategy, game.meta.heroSeat), lpValue = lp.values[game.meta.heroSeat];
    assertOuterInterval(toNumber(lpEnvelope.lower) - lp.validationTolerance, toNumber(lpEnvelope.upper) + lp.validationTolerance,
      fromNumber(lpValue), fromNumber(lpValue), 'LP point and its independent numerical feasibility guard');
    const restricted = conditioned.buildActionConditionedGame(game, condition);
    assert.deepEqual(restricted.root, independentGame.root, 'Action restriction must keep all prior worlds and all other information sets.');
    const fixedJobRow = output.result.actionPrecision.actions.find(row => row.id === action.id);
    assert.equal(fixedJobRow?.certified, true, 'This small fixed-work case must have a complete action certificate.');
    assertOuterInterval(fixedJobRow.lowerBB, fixedJobRow.upperBB, lpEnvelope.lower, lpEnvelope.upper, scenario.id + ':adaptive-job:' + action.id);
    assert.ok(fixedJobRow.lowerBB <= lpValue && fixedJobRow.upperBB >= lpValue, 'Adaptive retained certificate excludes the independent numeric LP point.');
    assert.equal(fixedJobRow.baseGameHash, result.gameHash);
    assert.equal(fixedJobRow.baseContextKey, output.checkpoint.baseContextKey);
    assert.equal(fixedJobRow.target, 'PRIVATE_INFORMATION_SET_COMMITMENT_VALUE');
    assert.equal(fixedJobRow.fullPriorPreserved, true); assert.equal(fixedJobRow.originalHandActionEV, false);
    const refinements = [];
    for (const iterations of [1, 64]) {
      const solved = core.solve(restricted, { iterations });
      const bounds = conditioned.evaluateActionConditioned(game, solved.strategy, condition);
      assert.equal(bounds.certified, true);
      const exact = exactPolicyEnvelope(independentGame, solved.strategy, game.meta.heroSeat);
      // These are exact rational comparisons. No LP tolerance is applied to
      // production endpoints, best-response values or dominance decisions.
      assertOuterInterval(bounds.lowerBB, bounds.upperBB, exact.lower, exact.upper, scenario.id + ':' + action.id);
      assertOuterInterval(bounds.lowerBB, bounds.upperBB, lpEnvelope.lower, lpEnvelope.upper, scenario.id + ':LP feasible policies:' + action.id);
      assert.ok(bounds.lowerBB <= lpValue && bounds.upperBB >= lpValue, `${scenario.id}/${action.id}: numeric LP point outside unchanged bounds.`);
      refinements.push({ iterations, lowerBB: bounds.lowerBB, upperBB: bounds.upperBB, widthBB: bounds.upperBB - bounds.lowerBB,
        exactProductionProfileEnvelope: { lower: encode(exact.lower), upper: encode(exact.upper) },
        strictExactBestResponseContainment: true, strictLPFeasibleEnvelopeContainment: true, strictNumericLPPointContainment: true,
        boundsToleranceBB: 0, numericalLPResidualToleranceBB: lp.validationTolerance });
    }
    const global = output.checkpoint.global;
    const solved = core.solve(game, { iterations: 0, checkpoint: global });
    const conditionalEV = conditionalCurrentProfileAction(game, solved.strategy, condition), displayed = output.result.actions.find(row => row.id === action.id);
    // Reporting EV is a floating-point reduction, not an outward certificate.
    // This comparison is explicitly unrelated to the commitment interval.
    assert.ok(Math.abs(displayed.evBB - toNumber(conditionalEV)) <= 64 * Number.EPSILON * Math.max(1, Math.abs(displayed.evBB)), 'Current profile action EV differs from independent conditional evaluation.');
    if (action.id === 'CALL' && Number.isFinite(scenario.expectation.profileCallEVBB)) {
      assert.ok(Math.abs(toNumber(conditionalEV) - scenario.expectation.profileCallEVBB) < 1e-12, 'Declared analytical conditional call expectation does not match this fixture.');
    }
    result.actions.push({ id: action.id, target: 'PRIVATE_INFORMATION_SET_COMMITMENT_VALUE', scope: 'FULL_PRIOR_EX_ANTE',
      numericalReferenceValueBB: lpValue, numericalReferenceMethod: lp.method, numericalResiduals: lp.residuals,
      numericalResidualToleranceBB: lp.validationTolerance, symbolicallyExactLP: false,
      exactLPFeasiblePolicyEnvelope: { lower: encode(lpEnvelope.lower), upper: encode(lpEnvelope.upper) },
      fixedWorkCertifiedBounds: { id: action.id, certified: true, lowerBB: fixedJobRow.lowerBB, upperBB: fixedJobRow.upperBB, iterations: fixedJobRow.iterations,
        baseGameHash: fixedJobRow.baseGameHash, baseContextKey: fixedJobRow.baseContextKey, conditionedHash: fixedJobRow.conditionedHash,
        target: fixedJobRow.target, fullPriorPreserved: fixedJobRow.fullPriorPreserved, originalHandActionEV: fixedJobRow.originalHandActionEV,
        strictLPFeasibleEnvelopeContainment: true, strictNumericLPPointContainment: true, boundsToleranceBB: 0 },
      conditionedGameHash: core.validateGame(restricted).gameHash,
      currentHandProfileEV: { target: 'CONDITIONAL_CURRENT_RETURNED_PROFILE_NOT_EQUILIBRIUM_CERTIFICATE', exactValue: encode(conditionalEV), displayedEVBB: displayed.evBB },
      refinements });
  }
  if (scenario.expectation.trueActionTie) {
    assert.equal(result.actions.every(row => row.numericalReferenceValueBB === 0), true);
    assert.equal(output.result.decisionPrecision.status, 'INCONCLUSIVE');
  }
  if (scenario.expectation.distinctProfileAndCommitment) {
    const call = result.actions.find(row => row.id === 'CALL');
    assert.ok(Math.abs(call.numericalReferenceValueBB - call.currentHandProfileEV.displayedEVBB) > .1);
  }
  result.dominance = [1, 64].map(iterations => {
    const rows = result.actions.map(action => ({ id: action.id, lpEnvelope: action.exactLPFeasiblePolicyEnvelope, ...action.refinements.find(row => row.iterations === iterations) }));
    const guard = 16 * Number.EPSILON * Math.max(1, ...rows.flatMap(row => [Math.abs(row.lowerBB), Math.abs(row.upperBB)]));
    const leader = rows.find(row => rows.every(other => other.id === row.id || row.lowerBB > other.upperBB + guard));
    if (leader) {
      const lower = fraction(BigInt(leader.lpEnvelope.lower.numerator), BigInt(leader.lpEnvelope.lower.denominator));
      for (const other of rows.filter(row => row.id !== leader.id)) {
        const upper = fraction(BigInt(other.lpEnvelope.upper.numerator), BigInt(other.lpEnvelope.upper.denominator));
        assert.ok(compare(lower, upper) > 0, 'Declared dominance contradicts the independent feasible-policy minimax envelopes.');
      }
    }
    return { iterations, status: leader ? 'CONCLUSIVE' : 'INCONCLUSIVE', leader: leader?.id || null, everyAlternativeCompared: true, separationGuardBB: guard };
  });
  result.elapsedMs = performance.now() - started; return result;
}
module.exports.runReferenceCase = runReferenceCase;

if (require.main === module) {
  const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
  const { available, python } = require('./sequence-form-reference.cjs');
  assert.equal(available(), true, 'The required LP validation cannot be skipped. Set THEIBS_REFERENCE_PYTHON.');
  const report = { schemaVersion: 1, classification: 'MODEL_INDEPENDENT_LP_AND_EXACT_RATIONAL_POLICY_QA', generatedAt: new Date().toISOString(), python,
    methodology: 'Small valid observed PLO5 HU river ledgers. Independent Omaha ranker and cent payouts; separate SciPy sequence-form primal/dual LP; exhaustive pure-policy best responses evaluated as exact rational arithmetic on normalized supplied binary64 inputs. Production outer bounds and LP point containment use zero added tolerance. LP residual guards apply only to the numerical reference. Current-hand profile EV, ex ante private-information-set commitment values and global convergence remain separate.',
    exactOracleLimits: LIMITS, sourceVersions: { core: require('../../src/solver/extensive-solver').VERSION, adaptive: require('../../src/solver/versions').ADAPTIVE_VERSION },
    sourceDigests: Object.fromEntries(['extensive-solver.js', 'action-conditioned.js', 'job-worker.js', 'versions.js'].map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../../src/solver', name))).digest('hex')])),
    notExecuted: ['Real browser Worker transport for these new fixtures', 'Authenticated hosted gameplay', 'Physical phone', 'Human speech recognition', 'Population range quality', 'Full-hand equilibrium or safe re-solving'], cases: [] };
  report.referenceDigests = Object.fromEntries(['river-hu-expanded-contract-reference.cjs', 'solver-reference-fixtures.cjs', '../../scripts/reference/sequence_form_lp.py']
    .map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, name))).digest('hex')]));
  for (const scenario of scenarios()) { report.cases.push(runReferenceCase(scenario)); console.log(scenario.id + ': independent checks passed'); }
  for (const [name, digest] of Object.entries(report.sourceDigests)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../../src/solver', name))).digest('hex'), digest,
      'Solver source changed during reference execution; discard this run and regenerate after integration is stable.');
  }
  for (const [name, digest] of Object.entries(report.referenceDigests)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, name))).digest('hex'), digest,
      'Independent reference source changed during execution; regenerate.');
  }
  report.sourceStableThroughoutRun = true;
  report.summary = { cases: report.cases.length, lpCases: report.cases.filter(row => row.referenceStatus !== 'NOT_APPLICABLE_UNQUALIFIED_FEE_CLASS').length,
    actions: report.cases.reduce((n, row) => n + row.actions.length, 0), strictContainmentChecks: report.cases.reduce((n, row) => n + row.actions.reduce((m, action) => m + action.refinements.length, 0), 0),
    strictAdaptiveJobContainmentChecks: report.cases.reduce((n, row) => n + row.actions.length, 0),
    exactDefaultVsTrustedBrowserFixedWorkComparisons: report.cases.length,
    independentTerminalPayoffChecks: report.cases.reduce((n, row) => n + row.independentTerminalAudit.terminalPayoffChecks, 0) };
  const destination = path.resolve(__dirname, '../../docs/benchmarks/river-hu-expanded-contract.json');
  fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ destination, summary: report.summary }));
}
