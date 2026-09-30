'use strict';
// Independent mathematical oracles, not snapshots of solver internals.
const test = require('node:test');
const assert = require('node:assert/strict');
const solver = require('../src/solver/extensive-solver');

const terminal = payoffs => ({ type: 'terminal', payoffs });
const decision = (player, informationSet, actions) => ({ type: 'decision', player, informationSet,
  actions: Object.entries(actions).map(([id, node]) => ({ id, node })) });
const chance = outcomes => ({ type: 'chance', outcomes: outcomes.map(([probability, node]) => ({ probability, node })) });
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `Expected ${actual} to equal ${expected} within ${tolerance}`);

function hiddenCoin({ probability = .5, continueChoice = false } = {}) {
  const branch = bit => {
    const guess = decision(0, 'hidden-coin-guess', {
      ZERO: terminal([bit === 0 ? 1 : 0, bit === 0 ? -1 : 0]),
      ONE: terminal([bit === 1 ? 1 : 0, bit === 1 ? -1 : 0])
    });
    return continueChoice ? decision(0, 'entry', { STOP: terminal([.6, -.6]), CONTINUE: guess }) : guess;
  };
  return { id: `independent-hidden-coin-${probability}-${continueChoice}`, playerCount: 2,
    root: chance([[probability, branch(0)], [1 - probability, branch(1)]]) };
}

function kuhnGame(offset = 0) {
  function node(cards, history = '') {
    const winner = cards[0] > cards[1] ? 1 : -1;
    const payoff = amount => terminal([amount + offset, -amount + offset]);
    if (history === 'cc') return payoff(winner);
    if (history === 'bf') return payoff(1);
    if (history === 'cbf') return payoff(-1);
    if (history === 'bk' || history === 'cbk') return payoff(winner * 2);
    const player = history === '' || history === 'cb' ? 0 : 1;
    const facingBet = history === 'b' || history === 'cb';
    return decision(player, `${cards[player]}:${history || 'root'}`, facingBet
      ? { FOLD: node(cards, history + 'f'), CALL: node(cards, history + 'k') }
      : { CHECK: node(cards, history + 'c'), BET: node(cards, history + 'b') });
  }
  const outcomes = [];
  for (let first = 0; first < 3; first++) for (let second = 0; second < 3; second++) {
    if (first !== second) outcomes.push([1 / 6, node([first, second])]);
  }
  return { id: `independent-kuhn-${offset}`, playerCount: 2, root: chance(outcomes) };
}

function threePlayerDominance() {
  const build = (player, previous) => player === 3 ? terminal(previous) : decision(player, `player-${player}`, {
    ZERO: build(player + 1, [...previous, 0]), ONE: build(player + 1, [...previous, 1])
  });
  return { id: 'independent-three-player-dominance', playerCount: 3, root: build(0, []) };
}

test('independent hidden-card best response cannot choose separately for unknown chance outcomes', () => {
  const game = hiddenCoin(), strategy = [{ 'hidden-coin-guess': { ZERO: .5, ONE: .5 } }, {}];
  near(solver.evaluate(game, strategy).values[0], .5);
  near(solver.bestResponse(game, strategy, 0).value, .5);
  const result = solver.solve(game, { iterations: 20 });
  near(result.convergence.nashConv, 0);
});

test('best response uses chance-weighted information sets and includes zero-own-reach continuations', () => {
  const game = hiddenCoin({ probability: .75, continueChoice: true });
  const strategy = [{ entry: { STOP: 1, CONTINUE: 0 }, 'hidden-coin-guess': { ZERO: .5, ONE: .5 } }, {}];
  near(solver.evaluate(game, strategy).values[0], .6);
  near(solver.bestResponse(game, strategy, 0).value, .75);
});

test('independent Kuhn game approaches the analytic -1/18 first-player value and lower NashConv', () => {
  const game = kuhnGame();
  const early = solver.solve(game, { iterations: 100 });
  const refined = solver.solve(game, { iterations: 5000 });
  near(refined.values[0], -1 / 18, .005);
  assert.ok(refined.convergence.nashConv < .02, `Kuhn NashConv ${refined.convergence.nashConv}`);
  assert.ok(refined.convergence.nashConv < early.convergence.nashConv,
    `Expected an overall improvement: ${early.convergence.nashConv} -> ${refined.convergence.nashConv}`);
  const mixed = Object.values(refined.strategy[0]).some(actions => Object.values(actions).some(p => p > .05 && p < .95));
  assert.ok(mixed, 'Known poker equilibrium must retain strategic mixing.');
});

test('incremental refinement is reproducible and retains its full averaging history', () => {
  const game = kuhnGame();
  const initial = solver.solve(game, { iterations: 200 });
  const continued = solver.solve(game, { iterations: 300, checkpoint: initial.checkpoint });
  const oneRun = solver.solve(game, { iterations: 500 });
  assert.deepEqual(continued.strategy, oneRun.strategy);
  assert.deepEqual(continued.values, oneRun.values);
  assert.deepEqual(continued.convergence, oneRun.convergence);
});

test('constant past-pot payoff offsets do not change equilibrium strategy or deviation gain', () => {
  const unshifted = solver.solve(kuhnGame(), { iterations: 300 });
  const shifted = solver.solve(kuhnGame(30), { iterations: 300 });
  near(shifted.values[0] - unshifted.values[0], 30, 1e-9);
  near(shifted.convergence.nashConv, unshifted.convergence.nashConv, 1e-9);
  for (let p = 0; p < 2; p++) for (const [key, actions] of Object.entries(unshifted.strategy[p])) {
    for (const [action, probability] of Object.entries(actions)) near(shifted.strategy[p][key][action], probability, 1e-9);
  }
});

test('three-player validation measures each unilateral deviation instead of heads-up reductions', () => {
  const game = threePlayerDominance();
  const strategy = [0, 1, 2].map(player => ({ [`player-${player}`]: { ZERO: 1, ONE: 0 } }));
  const evaluation = solver.evaluate(game, strategy);
  assert.deepEqual(evaluation.values, [0, 0, 0]);
  assert.deepEqual(evaluation.convergence.unilateralGains, [1, 1, 1]);
  near(evaluation.convergence.nashConv, 3);
  assert.equal(evaluation.convergence.convergenceGuarantee, 'NONE_FOR_GENERAL_SUM_OR_MULTIPLAYER');
  for (let player = 0; player < 3; player++) near(solver.bestResponse(game, strategy, player).value, 1);
  const result = solver.solve(game, { iterations: 100 });
  assert.equal(result.convergence.unilateralGains.length, 3);
  assert.ok(result.convergence.nashConv < .04);
  assert.equal(result.status === 'GTO', false, 'The generic solver must not self-certify a product GTO label.');
});

test('a game that forgets its own action is rejected rather than receiving a false best-response certificate', () => {
  const after = () => decision(0, 'forgot-own-action', { A: terminal([1, -1]), B: terminal([0, 0]) });
  const game = { id: 'imperfect-recall-invalid', playerCount: 2,
    root: decision(0, 'first', { LEFT: after(), RIGHT: after() }) };
  assert.throws(() => solver.solve(game, { iterations: 10 }), /recall/i);
});

test('checkpoint from a different game cannot silently seed an incompatible solve', () => {
  const initial = solver.solve(kuhnGame(), { iterations: 10 });
  assert.throws(() => solver.solve(hiddenCoin(), { iterations: 10, checkpoint: initial.checkpoint }), /checkpoint|game|fingerprint/i);
});

test('conditional action EV retains chance uncertainty and is not inferred from strategic frequency', () => {
  const game = hiddenCoin({ probability: .75 });
  const strategy = [{ 'hidden-coin-guess': { ZERO: .2, ONE: .8 } }, {}];
  const row = solver.actionValues(game, strategy, 0, 'hidden-coin-guess');
  assert.deepEqual(row.actions.map(action => action.frequency), [.2, .8]);
  near(row.actions[0].ev, .75);
  near(row.actions[1].ev, .25);
});

const session = require('../src/multiway-session');
const plo = require('../src/solver/plo-river-game');
const act = (actor, action, to) => ({ type: 'ACT', actor, action, ...(to == null ? {} : { to }) });
const publicBoard = ['2s', '3h', '4d', '8c', '9s'];
const heroCards = ['As', 'Ah', 'Kd', 'Qc', 'Tc'];
const beatableOpponent = ['Ks', 'Kh', 'Jd', 'Qh', '6c'];
const winningOpponent = ['2c', '2h', 'Qd', 'Jh', '7c'];
const range = (seatId, combinations) => ({ seatId, complete: true, source: 'INDEPENDENT_QA',
  combos: combinations.map(([cards, weight]) => ({ cards, weight })) });
function riverCallInput() {
  const initial = session.start({ variant: 'PLO5_HIGH', playerCount: 2, heroPosition: 'SB',
    startingStack: 100, smallBlind: .5, bigBlind: 1, heroCards });
  const events = [act(0, 'CALL'), act(1, 'CHECK'), { type: 'BOARD', cards: publicBoard.slice(0, 3) },
    act(1, 'BET', 2), act(0, 'RAISE', 6), act(1, 'CALL'), { type: 'BOARD', cards: publicBoard.slice(0, 4) },
    act(1, 'BET', 3), act(0, 'CALL'), { type: 'BOARD', cards: publicBoard }, act(1, 'BET', 10)];
  return { multiway: { ...initial.multiway, events },
    ranges: [range(0, [[heroCards, 1]]), range(1, [[beatableOpponent, .3], [winningOpponent, .7]])],
    sizing: { type: 'MIN_MID_MAX', maxAggressions: 0 }, rake: { type: 'NONE', basis: 'BEFORE_FEES' } };
}

test('independent PLO5 river call oracle is +2 bb at P30 C10 equity30%, with fold exactly zero', () => {
  const built = plo.buildPloRiverGame(riverCallInput());
  assert.equal(built.status, 'READY', JSON.stringify(built.reasons));
  assert.equal(built.coverage, 'PARTIAL', 'Omitted legal raises must be disclosed.');
  assert.equal(built.game.meta.fullHandEquilibriumSupported, false);
  assert.equal(built.game.meta.safeResolving, false);
  const result = solver.solve(built.game, { iterations: 50 });
  const rows = solver.actionValues(built.game, result.strategy, 0, built.game.meta.heroInformationSet).actions;
  near(rows.find(row => row.id === 'FOLD').ev, 0);
  near(rows.find(row => row.id === 'CALL').ev, 2);
  assert.equal(built.game.meta.feeModel.basis, 'BEFORE_FEES');
});

test('PLO5 declared terminal fees affect awards once and never charge past contributions twice', () => {
  const input = riverCallInput();
  input.rake = { type: 'FIXED', amount: 2 };
  const built = plo.buildPloRiverGame(input);
  assert.equal(built.status, 'READY', JSON.stringify(built.reasons));
  const result = solver.solve(built.game, { iterations: 20 });
  const rows = solver.actionValues(built.game, result.strategy, 0, built.game.meta.heroInformationSet).actions;
  near(rows.find(row => row.id === 'CALL').ev, 1.4); // .3 * 28 + .7 * -10
  near(rows.find(row => row.id === 'FOLD').ev, 0);
  near(result.values.reduce((sum, value) => sum + value, 0), 28);
});

test('PLO5 range support does not expose the actual Hero combo to opponent information sets', () => {
  const input = riverCallInput(), alternativeHero = ['Ad', 'Ac', 'Kd', 'Qc', 'Tc'];
  input.ranges = [range(0, [[heroCards, 1], [alternativeHero, 1]]), range(1, [[beatableOpponent, 1]])];
  input.sizing.maxAggressions = 1;
  const built = plo.buildPloRiverGame(input);
  assert.equal(built.status, 'READY', JSON.stringify(built.reasons));
  assert.equal(built.game.root.outcomes.length, 2);
  near(built.game.meta.heroWorldProbability, .5);
  const keysPerWorld = built.game.root.outcomes.map(outcome => {
    const keys = new Set();
    function visit(node) {
      if (node.type === 'decision') { if (node.player === 1) keys.add(node.informationSet); node.actions.forEach(action => visit(action.node)); }
      if (node.type === 'chance') node.outcomes.forEach(item => visit(item.node));
    }
    visit(outcome.node); return [...keys].sort();
  });
  assert.ok(keysPerWorld[0].length > 0);
  assert.deepEqual(keysPerWorld[0], keysPerWorld[1], 'Opponent cannot condition a response on an unobserved Hero combination.');
  assert.equal(solver.validateGame(built.game).perfectRecall, true);
});

test('unsupported or over-budget poker construction never produces a silently truncated game', () => {
  const missing = riverCallInput(); missing.ranges.pop();
  const missingResult = plo.buildPloRiverGame(missing);
  assert.equal(missingResult.status, 'NOT_SOLVED'); assert.equal(missingResult.game, null);
  const exhausted = riverCallInput(); exhausted.budget = { maxNodes: 1 };
  const exhaustedResult = plo.buildPloRiverGame(exhausted);
  assert.equal(exhaustedResult.status, 'NOT_SOLVED'); assert.equal(exhaustedResult.game, null);
  assert.equal(exhaustedResult.reasons[0].code, 'NODE_BUDGET');
});
