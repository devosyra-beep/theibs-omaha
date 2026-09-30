'use strict';
// Optional independent QA oracle: enable THEIBS_REFERENCE_PYTHON as documented.
// The application never depends on Python, SciPy, HiGHS or these fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const { available, reference } = require('./helpers/sequence-form-reference.cjs');
const fixtures = require('./helpers/solver-reference-fixtures.cjs');
const core = require('../src/solver/extensive-solver');
const conditioned = require('../src/solver/action-conditioned');
const { buildPloRiverGame } = require('../src/solver/plo-river-game');
const enabled = available();
const qa = (name, fn) => test(name, { skip: enabled ? false : 'QA-only SciPy reference unavailable; see scripts/reference/README.md.' }, fn);
const near = (left, right, epsilon = 1e-8) => assert.ok(Math.abs(left - right) <= epsilon, `${left} != ${right} ± ${epsilon}`);
const contains = (bounds, value, tolerance = 1e-8) => assert.ok(bounds[0] <= value + tolerance && bounds[1] >= value - tolerance,
  `Reference value ${value} is outside [${bounds}] (oracle residual tolerance ${tolerance}).`);
function ready(input) { const built = buildPloRiverGame(input); assert.equal(built.status, 'READY', JSON.stringify(built.reasons)); return built.game; }

qa('independent sequence-form LP reproduces a unique mixed equilibrium and primal/dual witnesses', () => {
  const game = fixtures.matrixGame([[1, -1], [-1, 1]], 'matching-pennies');
  const result = reference({ game });
  near(result.values[0], 0); near(result.reference.nashConv, 0);
  near(result.strategy[0].row.R0, .5); near(result.strategy[1].column.C0, .5);
  assert.equal(result.symbolicallyExact, false);
  for (const residual of Object.values(result.residuals)) assert.ok(residual <= result.validationTolerance);
  assert.deepEqual(result.metrics.sequences, [3, 3]);
});

qa('independent LP does not require identical strategies when equilibrium is not unique', () => {
  const game = fixtures.matrixGame([[1, 1], [1, 1]], 'all-profiles-optimal', 4);
  const profiles = [
    [{ row: { R0: 1, R1: 0 } }, { column: { C0: 1, C1: 0 } }],
    [{ row: { R0: .25, R1: .75 } }, { column: { C0: .9, C1: .1 } }]
  ];
  for (const strategy of profiles) {
    const result = reference({ game, strategy }); near(result.values[0], 1); near(result.values[1], 3); near(result.profile.nashConv, 0);
    for (const player of [0, 1]) contains(core.saddleBounds(game, strategy, player).bounds, result.values[player]);
  }
});

qa('independent sequence-form Kuhn value is -1/18 and CFR converges toward the attainable value', () => {
  const game = fixtures.kuhnGame(), exact = reference({ game });
  near(exact.values[0], -1 / 18);
  const early = core.solve(game, { iterations: 50 }), late = core.solve(game, { iterations: 5000 });
  assert.ok(late.convergence.nashConv < early.convergence.nashConv);
  near(late.values[0], exact.values[0], .002);
  for (const result of [early, late]) {
    const bounds = core.saddleBounds(game, result.strategy, 0), independent = reference({ game, strategy: result.strategy });
    contains(bounds.bounds, exact.values[0], exact.validationTolerance);
    near(independent.profile.nashConv, result.convergence.nashConv);
    near(independent.profile.lower[0], bounds.lower); near(independent.profile.upper[0], bounds.upper);
  }
});

qa('independent LP checks both orientations of constant-sum saddle bounds for a non-equilibrium policy', () => {
  const game = fixtures.matrixGame([[3, 2], [1, 0]], 'strict-dominance', 7);
  const strategy = [{ row: { R0: .25, R1: .75 } }, { column: { C0: .8, C1: .2 } }];
  const exact = reference({ game, strategy }); near(exact.values[0], 2); near(exact.values[1], 5);
  for (const player of [0, 1]) {
    const bounds = core.saddleBounds(game, strategy, player);
    assert.equal(bounds.certified, true);
    contains(bounds.bounds, exact.values[player]);
    near(bounds.lower, exact.profile.lower[player]); near(bounds.upper, exact.profile.upper[player]);
  }
});

qa('independent action-conditioned LP preserves the prior and changes a mixed game instead of reusing original EV', () => {
  const game = fixtures.matrixGame([[1, -1], [-1, 1]], 'mixed-commitment');
  const original = reference({ game }); near(original.values[0], 0);
  for (const actionId of ['R0', 'R1']) {
    const condition = { player: 0, informationSet: 'row', actionId };
    const exact = reference({ game, condition }); near(exact.values[0], -1);
    const restricted = conditioned.buildActionConditionedGame(game, condition), solved = core.solve(restricted, { iterations: 100 });
    const bounds = conditioned.evaluateActionConditioned(game, solved.strategy, condition);
    assert.equal(bounds.target, 'PRIVATE_INFORMATION_SET_COMMITMENT_VALUE'); assert.equal(bounds.originalHandActionEV, false);
    contains(bounds.boundsBB, exact.values[0]);
    assert.ok(bounds.upperBB < original.values[0], 'Commitment target must not be silently reused as original profile EV.');
  }
});

qa('zero global exploitability does not make a private-hand conditional equilibrium EV unique', () => {
  const game = fixtures.privateTypeGame(), condition = { player: 0, informationSet: 'TYPE0', actionId: 'A' };
  const result = reference({ game, condition }); near(result.values[0], 0); assert.equal(result.conditionedNodes, 1);
  const restricted = conditioned.buildActionConditionedGame(game, condition);
  assert.deepEqual(restricted.root.outcomes.map(edge => edge.probability), [.5, .5]);
  const observed = [];
  for (const left of [0, 1]) {
    const strategy = [{ TYPE0: { A: 1 }, TYPE1: { A: .5, B: .5 } }, { HIDDEN: { L: left, R: 1 - left } }];
    const oracle = reference({ game, condition, strategy, conditionalInformationSet: condition });
    near(oracle.profile.nashConv, 0); near(oracle.profile.values[0], 0);
    observed.push(oracle.conditionalCurrentProfile.value);
    contains(conditioned.evaluateActionConditioned(game, strategy, condition).boundsBB, 0);
  }
  assert.deepEqual(observed, [-1, 1]);
  const revealed = { ...game, root: structuredClone(game.root.outcomes[0].node) };
  near(reference({ game: revealed, condition }).values[0], -1);
});

qa('PLO5 reference independently checks exact 2+3 showdown, joint blockers, chance weights and incremental fees', () => {
  for (const fee of [0, 2]) {
    const input = fixtures.riverCallInput({ blockers: true, fee }), game = ready(input);
    const worlds = [];
    for (const hero of input.ranges[0].combos) for (const opponent of input.ranges[1].combos) {
      if (new Set([...fixtures.board, ...hero.cards, ...opponent.cards]).size !== 15) continue;
      const comparison = fixtures.compareRanks(fixtures.omahaRank(hero.cards, fixtures.board), fixtures.omahaRank(opponent.cards, fixtures.board));
      const share = comparison > 0 ? 1 : comparison < 0 ? 0 : .5;
      worlds.push({ hero: [...hero.cards].sort().join(','), mass: hero.weight * opponent.weight, fold: 0, call: share * (40 - fee) - 10 });
    }
    const mass = worlds.reduce((sum, world) => sum + world.mass, 0);
    assert.equal(game.root.outcomes.length, worlds.length); assert.equal(worlds.length, 3);
    for (const edge of game.root.outcomes) {
      const cards = edge.node.informationSet.split('|')[1].split(',').sort().join(',');
      const world = worlds.find(item => item.hero === cards && Math.abs(item.mass / mass - edge.probability) < 1e-10);
      assert.ok(world, 'Each actual chance world must have independent blocker-consistent support.');
      for (const action of edge.node.actions) {
        assert.equal(action.node.type, 'terminal');
        near(action.node.payoffs[0], action.id === 'FOLD' ? world.fold : world.call);
        near(action.node.payoffs[0] + action.node.payoffs[1], 30 - fee);
      }
    }
    const target = { player: 0, informationSet: game.meta.heroInformationSet, actionId: 'CALL' };
    const exact = reference({ game, condition: target });
    // Other Hero types stay unrestricted: their optimal fold/call contributes to
    // the range value, while only the current Hero information set is committed.
    const actual = [...fixtures.heroCards].sort().join(',');
    const independentExAnte = worlds.reduce((sum, world) => sum + world.mass / mass * (world.hero === actual ? world.call : Math.max(world.fold, world.call)), 0);
    near(exact.values[0], independentExAnte);
    const solved = core.solve(conditioned.buildActionConditionedGame(game, target), { iterations: 100 });
    contains(conditioned.evaluateActionConditioned(game, solved.strategy, target).boundsBB, independentExAnte);
    assert.notEqual(independentExAnte, fee ? 1.4 : 2, 'Full-prior commitment and conditional current-hand EV must remain distinct.');
  }
});

qa('real PLO5 river action bounds contain independent LP values for every legal root action', () => {
  const game = ready(fixtures.riverMixedInput()); assert.equal(game.meta.compatibleWorlds, 4);
  for (const action of game.meta.rootActions) {
    const target = { player: 0, informationSet: game.meta.heroInformationSet, actionId: action.id };
    const exact = reference({ game, condition: target });
    const restricted = conditioned.buildActionConditionedGame(game, target);
    for (const iterations of [1, 100]) {
      const solved = core.solve(restricted, { iterations });
      const bounds = conditioned.evaluateActionConditioned(game, solved.strategy, target);
      assert.equal(bounds.certified, true); contains(bounds.boundsBB, exact.values[0], exact.validationTolerance);
      const independent = reference({ game, condition: target, strategy: solved.strategy });
      near(bounds.lowerBB, independent.profile.lower[0], 1e-7); near(bounds.upperBB, independent.profile.upper[0], 1e-7);
    }
  }
});

qa('decimal PLO fees preserve the Hero maxmin value despite binary64 cancellation in terminal sums', () => {
  for (const fee of [.1, .3, 1.01]) {
    const input = fixtures.riverMixedInput(); input.rake = { type: 'FIXED', amount: fee }; input.sizing.maxAggressions = 3;
    const game = ready(input), condition = { player: 0, informationSet: game.meta.heroInformationSet, actionId: 'CHECK' };
    const oracle = reference({ game, condition });
    const solved = core.solve(conditioned.buildActionConditionedGame(game, condition), { iterations: 50 });
    const bounds = conditioned.evaluateActionConditioned(game, solved.strategy, condition);
    assert.equal(bounds.certified, true); contains(bounds.boundsBB, oracle.values[0], oracle.validationTolerance);
    assert.ok(Math.max(...Object.values(oracle.residuals)) <= oracle.validationTolerance);
  }
});

qa('the independent Omaha ranker never plays the board or uses more than two private cards', () => {
  const royalBoard = ['As', 'Ks', 'Qs', 'Js', 'Ts'];
  assert.equal(fixtures.omahaRank(['2c', '3d', '4h', '5c', '6d'], royalBoard)[0], 0);
  assert.deepEqual(fixtures.omahaRank(['9s', '8s', '2c', '3d', '4h'], royalBoard), [8, 12]);
  assert.deepEqual(fixtures.omahaRank(['As', '2h', 'Kd', 'Qc', 'Tc'], ['3s', '4h', '5d', '8c', '9s']), [4, 5]);
});

qa('independent sequence-form compiler rejects information leakage through imperfect recall and non-constant-sum games', () => {
  const after = () => fixtures.decision(0, 'forgotten', { X: fixtures.terminal(1), Y: fixtures.terminal(-1) });
  const invalid = { playerCount: 2, root: fixtures.decision(0, 'earlier', { A: after(), B: after() }) };
  assert.throws(() => reference({ game: invalid }), /recall/i);
  const generalSum = fixtures.matrixGame([[1, 0], [0, 1]]);
  generalSum.root.actions[0].node.actions[0].node.payoffs = [1, 2];
  assert.throws(() => reference({ game: generalSum }), /constant-sum/i);
});
