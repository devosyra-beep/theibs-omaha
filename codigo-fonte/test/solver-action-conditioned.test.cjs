'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/solver/extensive-solver');
const conditioned = require('../src/solver/action-conditioned');

const terminal = value => ({ type: 'terminal', payoffs: [value, -value] });
function matrix(payoffs = [[2, -1], [1, 0]]) {
  return { id: 'saddle-matrix', playerCount: 2, root: { type: 'decision', player: 0, informationSet: 'Hero',
    actions: payoffs.map((row, a) => ({ id: String(a), node: { type: 'decision', player: 1, informationSet: 'Opponent',
      actions: row.map((value, b) => ({ id: String(b), node: terminal(value) })) } })) } };
}
function contains(bounds, value) { assert.ok(bounds[0] <= value && bounds[1] >= value, `${value} outside [${bounds}]`); }

test('outward saddle intervals contain a matrix value without turning NashConv into action error', () => {
  const game = matrix([[1, -1], [-1, 1]]);
  const result = core.saddleBounds(game, [{ Hero: { 0: .8, 1: .2 } }, { Opponent: { 0: .4, 1: .6 } }], 0);
  contains(result.bounds, 0);
  assert.ok(result.lower <= -.6 && result.upper >= .2);
  assert.equal(result.origin, conditioned.ORIGIN);
  assert.equal(result.rounding, 'IEEE754_BINARY64_NEXTAFTER_EACH_OPERATION');
});

test('saddle best response shares one action across hidden outcomes', () => {
  const guess = bit => ({ type: 'decision', player: 0, informationSet: 'Hidden', actions: [0, 1].map(a => ({ id: String(a), node: terminal(a === bit ? 1 : 0) })) });
  const game = { id: 'hidden-coin-interval', playerCount: 2, root: { type: 'chance', outcomes: [0, 1].map(bit => ({ probability: .5, node: guess(bit) })) } };
  const result = core.saddleBounds(game, [{ Hidden: { 0: .5, 1: .5 } }, {}], 0);
  contains(result.bounds, .5);
  assert.ok(result.upper < .500000000001, 'separate guesses after seeing the hidden coin would falsely return one');
});

test('constant existing-pot offset shifts saddle values and does not disappear in opponent best response', () => {
  const game = matrix([[1, -1], [-1, 1]]), shifted = structuredClone(game);
  for (const a of shifted.root.actions) for (const b of a.node.actions) { b.node.payoffs[0] += 7; b.node.payoffs[1] += 3; }
  const profile = [{ Hero: { 0: .5, 1: .5 } }, { Opponent: { 0: .5, 1: .5 } }];
  const original = core.saddleBounds(game, profile, 0), result = core.saddleBounds(shifted, profile, 0);
  contains(original.bounds, 0); contains(result.bounds, 7);
  assert.ok(result.upper - result.lower < 1e-11);
  contains(result.constantSumBounds, 10);
});

test('decimal fixed fees preserve Hero utility for both seats and different chip scales', () => {
  for (const fee of [.1, .3, 1.01]) for (const scale of [1, 100, 1e6]) for (const hero of [0, 1]) {
    const game = matrix([[2 - fee, -1 - fee], [1 - fee, -fee]]), offset = (2 - fee) * scale;
    game.meta = { constantSum: true, feeModel: { type: 'FIXED', amount: fee } };
    game.root.player = hero;
    for (const a of game.root.actions) {
      a.node.player = 1 - hero;
      for (const b of a.node.actions) {
        const own = b.node.payoffs[0] * scale;
        b.node.payoffs[hero] = own; b.node.payoffs[1 - hero] = offset - own;
      }
    }
    const profile = [{}, {}];
    profile[hero].Hero = { 0: 0, 1: 1 }; profile[1 - hero].Opponent = { 0: 0, 1: 1 };
    const certified = core.saddleBounds(game, profile, hero);
    contains(certified.bounds, -fee * scale);
    assert.equal(certified.opponentBestResponseUtility, 'CONSTANT_MINUS_HERO_PAYOFF');
    assert.ok(Number.isFinite(certified.payoffNormalizationMaxResidual));
    assert.ok(certified.width < 1e-8 * scale);
    game.meta.constantSum = false;
    assert.throws(() => core.saddleBounds(game, profile, hero), /constant-sum/);
  }
});

test('conditioning an action produces a commitment value and leaves the original game intact', () => {
  const game = matrix(), original = structuredClone(game);
  const result = conditioned.solveActionConditioned(game, { player: 0, informationSet: 'Hero', actionIds: ['0', '1'], iterations: 100 });
  assert.deepEqual(game, original);
  assert.equal(result.target, conditioned.TARGET);
  assert.equal(result.originalHandActionEV, false);
  assert.equal(result.actions.length, 2);
  contains(result.actions[0].boundsBB, -1); contains(result.actions[1].boundsBB, 0);
  assert.ok(result.actions.every(action => action.certified && action.iterations === 100 && action.boundsBB.every(Number.isFinite)));
  assert.notEqual(result.actions[0].gameHash, result.actions[1].gameHash);
  assert.equal(result.actions[0].baseGameHash, result.actions[1].baseGameHash);
});

test('private information-set commitment preserves other hands and their shared opponent information', () => {
  const hand = (name, aPayoffs) => ({ type: 'decision', player: 0, informationSet: name,
    actions: [{ id: 'A', node: { type: 'decision', player: 1, informationSet: 'AfterA', actions: aPayoffs.map((value, i) => ({ id: String(i), node: terminal(value) })) } },
      { id: 'B', node: terminal(0) }] });
  const game = { id: 'private-commitment', playerCount: 2, root: { type: 'chance', outcomes: [
    { probability: .5, node: hand('Red', [3, -1]) }, { probability: .5, node: hand('Black', [1, 3]) }
  ] } };
  const forced = conditioned.buildActionConditionedGame(game, { player: 0, informationSet: 'Red', actionId: 'A' });
  assert.equal(forced.root.outcomes.length, 2);
  assert.deepEqual(forced.root.outcomes.map(outcome => outcome.probability), [.5, .5]);
  assert.equal(forced.root.outcomes[0].node.actions.length, 1);
  assert.equal(forced.root.outcomes[1].node.actions.length, 2);
  assert.equal(forced.root.outcomes[0].node.actions[0].node.informationSet, forced.root.outcomes[1].node.actions[0].node.informationSet);
  const result = conditioned.solveActionConditioned(game, { player: 0, informationSet: 'Red', actionIds: ['A'], iterations: 500 });
  contains(result.actions[0].boundsBB, 1);
  assert.ok(result.actions[0].strategicDecisionCount > 0, 'other private hands still have strategic choices');
  assert.ok(result.actions[0].lowerBB > .99, 'revealing Red would incorrectly give -1 instead of the ex ante commitment value 1');
});

test('a forced terminal continuation is structurally complete even when two values tie', () => {
  const game = { id: 'terminal-tie', playerCount: 2, root: { type: 'decision', player: 0, informationSet: 'Hero',
    actions: ['FOLD', 'CALL'].map(id => ({ id, node: terminal(0) })) } };
  const result = conditioned.solveActionConditioned(game, { player: 0, informationSet: 'Hero', actionIds: ['FOLD', 'CALL'], iterations: 0 });
  for (const action of result.actions) {
    assert.equal(action.certified, true);
    assert.equal(action.strategicDecisionCount, 0);
    contains(action.boundsBB, 0);
  }
});

test('action checkpoints resume only the exact conditioned game and preserve iteration schedule', () => {
  const game = matrix();
  const options = { player: 0, informationSet: 'Hero', actionIds: ['0'], iterations: 20 };
  const first = conditioned.solveActionConditioned(game, options).actions[0];
  const resumed = conditioned.solveActionConditioned(game, { ...options, iterations: 30, checkpoints: { 0: first.checkpoint } }).actions[0];
  const whole = conditioned.solveActionConditioned(game, { ...options, iterations: 50 }).actions[0];
  assert.equal(resumed.iterations, 50); assert.equal(resumed.additionalIterations, 30);
  assert.deepEqual(resumed.checkpoint, whole.checkpoint);
  assert.deepEqual(resumed.boundsBB, whole.boundsBB);
  assert.throws(() => conditioned.solveActionConditioned(game, { ...options, actionIds: ['1'], checkpoints: { 1: first.checkpoint } }), /Checkpoint/);
});

test('invalid game classes, nonroot commitments and budgets cannot create certificates', () => {
  const game = matrix(), fees = structuredClone(game);
  fees.root.actions[0].node.actions[0].node.payoffs[1] -= 1;
  assert.throws(() => conditioned.solveActionConditioned(fees, { player: 0, informationSet: 'Hero', actionIds: ['0'] }), /constant-sum/);
  assert.throws(() => conditioned.buildActionConditionedGame(game, { player: 1, informationSet: 'Opponent', actionId: '0' }), /initial decision/);
  const canceled = conditioned.solveActionConditioned(game, { player: 0, informationSet: 'Hero', actionIds: ['0'], shouldCancel: () => true });
  assert.equal(canceled.termination, 'CANCELLED'); assert.deepEqual(canceled.actions, []);
  const exhausted = conditioned.solveActionConditioned(game, { player: 0, informationSet: 'Hero', actionIds: ['0'], timeBudgetMs: 0 });
  assert.equal(exhausted.termination, 'TIME_BUDGET'); assert.equal(exhausted.metrics.certifiedActionCount, 0);
});

test('root regret and stability describe original profile and cannot certify equilibrium action precision', () => {
  const game = matrix(), profile = [{ Hero: { 0: .5, 1: .5 } }, { Opponent: { 0: 0, 1: 1 } }];
  const result = core.rootDiagnostics(game, profile, 0, 'Hero');
  assert.equal(result.oneStepRegret, .5); assert.equal(result.counterfactualOneStepRegret, .5);
  assert.equal(result.profileValue, -.5); assert.equal(result.certifiesConvergence, false);
  const same = core.rootDiagnostics(game, profile, 0, 'Hero', { previous: result });
  assert.equal(same.stability.comparable, true); assert.equal(same.stability.maxActionEVChange, 0);
  assert.equal(same.stability.maxFrequencyChange, 0);
  const unrelated = core.rootDiagnostics(game, profile, 0, 'Hero', { previous: { ...result, gameHash: 'other' } });
  assert.equal(unrelated.stability.comparable, false);
});
