'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const solver = require('../src/solver/extensive-solver');

function terminal(value) { return { type: 'terminal', payoffs: [value, -value] }; }
function matrixGame(matrix) {
  return { id: 'matrix-' + JSON.stringify(matrix), playerCount: 2, root: {
    type: 'decision', player: 0, informationSet: 'first', actions: matrix.map((row, r) => ({ id: String(r), node: {
      type: 'decision', player: 1, informationSet: 'second-hidden-first-action', actions: row.map((value, c) => ({ id: String(c), node: terminal(value) }))
    } }))
  } };
}
function kuhn() {
  const deck = [0, 1, 2], outcomes = [];
  function build(cards, history) {
    const winner = cards[0] > cards[1] ? 1 : -1;
    if (history === 'kk') return terminal(winner);
    if (history === 'bc' || history === 'kbc') return terminal(winner * 2);
    if (history === 'bf') return terminal(1);
    if (history === 'kbf') return terminal(-1);
    const player = history.length % 2;
    return { type: 'decision', player, informationSet: `${player}:${cards[player]}:${history}`, actions: (history.endsWith('b') ? ['f', 'c'] : ['k', 'b']).map(id => ({ id, node: build(cards, history + id) })) };
  }
  for (const first of deck) for (const second of deck) if (first !== second) outcomes.push({ probability: 1 / 6, node: build([first, second], '') });
  return { id: 'kuhn-three-card-one-bet', playerCount: 2, root: { type: 'chance', outcomes } };
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function close(actual, expected, epsilon = 1e-10) { assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected} +/- ${epsilon}`); }

test('exact best response respects hidden actions rather than choosing per underlying node', () => {
  const game = matrixGame([[1, -1], [-1, 1]]);
  const strategy = [{ first: { 0: 0.5, 1: 0.5 } }, { 'second-hidden-first-action': { 0: 0.5, 1: 0.5 } }];
  close(solver.bestResponse(game, strategy, 1).value, 0);
  close(solver.evaluate(game, strategy).convergence.nashConv, 0);
  const solved = solver.solve(game, { iterations: 100 });
  close(solved.values[0], 0);
  close(solved.convergence.nashConv, 0);
  close(solved.strategy[1]['second-hidden-first-action']['0'], 0.5);
});

test('rock-paper-scissors returns a real mixed strategic profile and exact zero NashConv', () => {
  const game = matrixGame([[0, -1, 1], [1, 0, -1], [-1, 1, 0]]);
  const solved = solver.solve(game, { iterations: 100 });
  for (const row of solved.strategy) for (const actions of Object.values(row)) for (const probability of Object.values(actions)) close(probability, 1 / 3);
  close(solved.convergence.nashConv, 0);
});

test('CFR+ learns asymmetric matching pennies and evaluates the returned average', () => {
  const game = matrixGame([[2, -1], [-1, 1]]);
  const solved = solver.solve(game, { iterations: 10000, checkEvery: 10000 });
  close(solved.values[0], 0.2, 0.002);
  close(solved.strategy[0].first['0'], 0.4, 0.004);
  close(solved.strategy[1]['second-hidden-first-action']['0'], 0.4, 0.004);
  assert.ok(solved.convergence.nashConv < 0.01);
  assert.deepEqual(solved.convergence, solver.evaluate(game, solved.strategy).convergence);
});

test('Kuhn value approaches -1/18 and NashConv improves over iteration scales', () => {
  const game = kuhn();
  const short = solver.solve(game, { iterations: 10, checkEvery: 10000 });
  const medium = solver.solve(game, { iterations: 1000, checkpoint: short.checkpoint, checkEvery: 10000 });
  const long = solver.solve(game, { iterations: 8990, checkpoint: medium.checkpoint, checkEvery: 10000 });
  close(long.values[0], -1 / 18, 0.0005);
  assert.ok(medium.convergence.nashConv < short.convergence.nashConv / 3);
  assert.ok(long.convergence.nashConv < medium.convergence.nashConv);
  assert.ok(long.convergence.nashConv < 0.005);
  assert.deepEqual(long.convergence, solver.evaluate(game, long.strategy).convergence);
  console.log(JSON.stringify({ solverKuhnEvidence: { iterations: [short.iterations, medium.iterations, long.iterations], values: [short.values[0], medium.values[0], long.values[0]], nashConv: [short.convergence.nashConv, medium.convergence.nashConv, long.convergence.nashConv], elapsedMs: long.metrics.elapsedMs } }));
});

test('Kuhn exact best response agrees with independent exhaustive pure policy enumeration', () => {
  const game = kuhn(), result = solver.solve(game, { iterations: 37 });
  function value(node, strategy, player) {
    if (node.type === 'terminal') return node.payoffs[player];
    if (node.type === 'chance') return node.outcomes.reduce((sum, outcome) => sum + outcome.probability * value(outcome.node, strategy, player), 0);
    return node.actions.reduce((sum, action) => sum + strategy[node.player][node.informationSet][action.id] * value(action.node, strategy, player), 0);
  }
  for (let player = 0; player < 2; player++) {
    const infos = Object.entries(result.strategy[player]);
    let best = -Infinity;
    for (let bits = 0; bits < 2 ** infos.length; bits++) {
      const policy = clone(result.strategy);
      for (let i = 0; i < infos.length; i++) Object.keys(infos[i][1]).forEach((action, a) => { policy[player][infos[i][0]][action] = a === ((bits >> i) & 1) ? 1 : 0; });
      best = Math.max(best, value(game.root, policy, player));
    }
    close(best, solver.bestResponse(game, result.strategy, player).value);
  }
});

test('checkpoint resumption equals uninterrupted deterministic iterations', () => {
  const game = kuhn();
  const whole = solver.solve(game, { iterations: 300 });
  const first = solver.solve(game, { iterations: 70 });
  const resumed = solver.solve(game, { iterations: 230, checkpoint: clone(first.checkpoint) });
  assert.equal(resumed.additionalIterations, 230);
  assert.deepEqual(resumed.strategy, whole.strategy);
  assert.deepEqual(resumed.checkpoint, whole.checkpoint);
  assert.deepEqual(resumed.convergence, whole.convergence);
  const changed = clone(game); changed.root.outcomes[0].node.actions[0].node.actions[0].node.payoffs[0] += 0.1;
  assert.throws(() => solver.solve(changed, { checkpoint: first.checkpoint }), /Checkpoint does not match/);
});

test('budgets and cancellation preserve whole iterations, never a stale exact metric', () => {
  const game = kuhn();
  const first = solver.solve(game, { iterations: 12 });
  const canceled = solver.solve(game, { iterations: 100, checkpoint: first.checkpoint, shouldCancel: () => true });
  assert.equal(canceled.termination, 'CANCELLED');
  assert.equal(canceled.additionalIterations, 0);
  assert.deepEqual(canceled.checkpoint, first.checkpoint);
  assert.equal(canceled.convergence.nashConv, null);
  const deadline = solver.solve(game, { iterations: 100000, timeBudgetMs: 4, checkEvery: 1 });
  assert.equal(deadline.termination, 'TIME_BUDGET');
  assert.ok(deadline.metrics.elapsedMs < 1000);
  if (deadline.convergence.exact) assert.deepEqual(deadline.convergence, solver.evaluate(game, deadline.strategy).convergence);
  const resumed = solver.solve(game, { iterations: 10, checkpoint: deadline.checkpoint });
  const whole = solver.solve(game, { iterations: deadline.iterations + 10 });
  assert.deepEqual(resumed.checkpoint, whole.checkpoint);
});

test('target stopping requires exact measured NashConv and does not fabricate a GTO label', () => {
  const result = solver.solve(matrixGame([[2, -1], [-1, 1]]), { iterations: 5000, targetNashConv: 0.02, checkEvery: 50 });
  assert.equal(result.termination, 'TARGET_NASH_CONV');
  assert.ok(result.convergence.nashConv <= 0.02);
  assert.equal(result.status, undefined);
});

test('action EV is conditioned on a player information set, not hidden opponent action', () => {
  const game = matrixGame([[2, -1], [-1, 1]]);
  const strategy = [{ first: { 0: 0.25, 1: 0.75 } }, { 'second-hidden-first-action': { 0: 0.3, 1: 0.7 } }];
  const info = solver.actionValues(game, strategy, 1, 'second-hidden-first-action');
  close(info.actions[0].ev, 0.25);
  close(info.actions[1].ev, -0.5);
  close(info.actions[0].frequency, 0.3);
  close(info.counterfactualReach, 1);
  assert.deepEqual(solver.evaluateInformationSet(game, strategy, 'second-hidden-first-action'), info);
});

test('three-player general-sum profiles are evaluated without a convergence guarantee', () => {
  function build(choices) {
    if (choices.length === 3) return { type: 'terminal', payoffs: choices.map((choice, i) => choices.filter(other => other === choice).length === 1 ? 2 + i : 0) };
    return { type: 'decision', player: choices.length, informationSet: `P${choices.length}`, actions: ['0', '1'].map(id => ({ id, node: build(choices.concat(Number(id))) })) };
  }
  const game = { id: 'minority-three', playerCount: 3, root: build([]) }, solved = solver.solve(game, { iterations: 300 });
  assert.equal(solved.strategy.length, 3);
  assert.equal(solved.convergence.convergenceGuarantee, 'NONE_FOR_GENERAL_SUM_OR_MULTIPLAYER');
  assert.equal(solved.convergence.exploitability, null);
  for (let p = 0; p < 3; p++) {
    const pureValues = ['0', '1'].map(action => {
      const policy = clone(solved.strategy); policy[p][`P${p}`] = { 0: action === '0' ? 1 : 0, 1: action === '1' ? 1 : 0 };
      return solver.evaluate(game, policy).values[p];
    });
    close(Math.max(...pureValues), solved.convergence.bestResponseValues[p]);
  }
});

test('invalid probability, imperfect recall, action mismatch, cycles and size limits fail closed', () => {
  const badChance = kuhn(); badChance.root.outcomes[0].probability = 0.8;
  assert.throws(() => solver.validateGame(badChance), /sum to one/);
  const forgotten = matrixGame([[1, -1], [-1, 1]]);
  forgotten.root.actions.forEach(action => { action.node.player = 0; action.node.informationSet = 'forgot-own-first-choice'; });
  assert.throws(() => solver.validateGame(forgotten), /Imperfect recall/);
  const mismatch = matrixGame([[1, -1], [-1, 1]]); mismatch.root.actions[1].node.actions[0].id = 'changed';
  assert.throws(() => solver.validateGame(mismatch), /Actions must match/);
  const cycle = matrixGame([[1, -1], [-1, 1]]); cycle.root.actions[0].node.actions[0].node = cycle.root;
  assert.throws(() => solver.validateGame(cycle), /cycle/);
  assert.throws(() => solver.validateGame(kuhn(), { maxNodes: 10 }), /nodes exceed/);
  assert.throws(() => solver.validateGame(kuhn(), { maxWorkingBytes: 512 }), /memory exceeds/);
});
