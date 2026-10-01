'use strict';

// Mathematical equivalence, not a timing benchmark. Baseline modules have an
// isolated dependency namespace so candidate source cannot contaminate them.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const core = require('../src/solver/extensive-solver');
const conditioned = require('../src/solver/action-conditioned');
const job = require('../src/solver/job-worker');
const fixtures = require('./helpers/solver-reference-fixtures.cjs');
const independent = require('./helpers/river-hu-expanded-contract-reference.cjs');
const lp = require('./helpers/sequence-form-reference.cjs');
const BASELINE = 'c86abe284a4d56f62a1a6fac12e3b1558521a6bf';
const sourceRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(sourceRoot, '..');
const baselineIds = new Set(['src/solver/extensive-solver.js', 'src/solver/action-conditioned.js', 'src/solver/job-worker.js',
  'src/solver/plo-river-game.js', 'src/solver/versions.js', 'src/solver/solution-status.js', 'src/solver/decision-outcome.js', 'src/decision-precision.js']);
const baselineModules = new Map();
function baseline(id) {
  if (baselineModules.has(id)) return baselineModules.get(id).exports;
  const filename = path.join(sourceRoot, id), loaded = new Module(filename, module);
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const normalRequire = loaded.require.bind(loaded);
  loaded.require = name => {
    if (name.startsWith('.')) {
      const target = path.relative(sourceRoot, path.resolve(path.dirname(filename), name.endsWith('.js') ? name : name + '.js')).split(path.sep).join('/');
      if (baselineIds.has(target)) return baseline(target);
    }
    return normalRequire(name);
  };
  const source = execFileSync('git', ['show', `${BASELINE}:codigo-fonte/${id}`], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
  baselineModules.set(id, loaded); loaded._compile(source, filename); return loaded.exports;
}
const previousCore = baseline('src/solver/extensive-solver.js');
const previousConditioned = baseline('src/solver/action-conditioned.js');
const previousBuilder = baseline('src/solver/plo-river-game.js');
const previousJob = baseline('src/solver/job-worker.js');

function boundsMath(value) {
  const { elapsedMs, certificateElapsedMs, traversalVisits, ...mathematics } = value;
  return mathematics;
}
function solveMath(value) {
  return Object.fromEntries(['solverVersion', 'method', 'gameHash', 'strategy', 'iterations', 'additionalIterations', 'termination', 'stopReason', 'values', 'convergence', 'checkpoint']
    .filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
}
function ready(input, builder) {
  const built = builder.buildPloRiverGame(input);
  assert.equal(built.status, 'READY', JSON.stringify(built.reasons)); return built.game;
}
const builder = require('../src/solver/plo-river-game');
function selectedCases() {
  const ids = ['marginal_true_action_tie', 'decimal_fixed_rake', 'joint_blockers_nonuniform_prior',
    'board_blocked_mass_excluded', 'current_bet_changes_price_and_pot', 'unequal_short_stacks_facing_bet',
    'rare_actual_hand_full_prior_commitment', 'big_blind_hero_reversed_utility_orientation'];
  const cases = independent.scenarios();
  return ids.map(id => { const value = cases.find(row => row.id === id); assert.ok(value, id); return value; });
}

test('generic finite games preserve fixed CFR work, exact BR/convergence and outward bounds against c86abe', () => {
  const games = [fixtures.matrixGame([[1, -1], [-1, 1]]), fixtures.kuhnGame(), fixtures.privateTypeGame()];
  for (const source of games) {
    const expected = previousCore.solve(structuredClone(source), { iterations: 64 });
    for (const reuse of [false, true]) {
      const game = structuredClone(source), context = reuse ? core.createCompilationContext(game) : undefined;
      const options = { ...(reuse ? { compilationContext: context } : {}) };
      try {
        const actual = core.solve(game, { ...options, iterations: 64 });
        assert.deepEqual(solveMath(actual), solveMath(expected));
        assert.deepEqual(core.evaluate(game, actual.strategy, options), previousCore.evaluate(source, expected.strategy));
        for (const player of [0, 1]) {
          assert.deepEqual(core.bestResponse(game, actual.strategy, player, options), previousCore.bestResponse(source, expected.strategy, player));
          assert.deepEqual(boundsMath(core.saddleBounds(game, actual.strategy, player, options)), boundsMath(previousCore.saddleBounds(source, expected.strategy, player)));
        }
        const first = core.solve(game, { ...options, iterations: 20 });
        const resumed = core.solve(game, { ...options, checkpoint: first.checkpoint, iterations: 44 });
        assert.deepEqual(resumed.checkpoint, expected.checkpoint); assert.deepEqual(resumed.strategy, expected.strategy);
      } finally { if (context !== undefined) core.releaseCompilationContext(context); }
    }
  }
});

test('real river utilities, blockers, fees, ties and both Hero orientations retain hashes, profile EV and certificates exactly', () => {
  for (const scenario of selectedCases()) {
    const original = ready(scenario.input, previousBuilder), candidate = ready(scenario.input, builder);
    assert.deepEqual(candidate, original, scenario.id + ': public mathematical game');
    const expected = previousCore.solve(original, { iterations: 32 }), actual = core.solve(candidate, { iterations: 32 });
    assert.deepEqual(solveMath(actual), solveMath(expected), scenario.id);
    const player = candidate.meta.heroSeat, informationSet = candidate.meta.heroInformationSet;
    assert.deepEqual(core.rootDiagnostics(candidate, actual.strategy, player, informationSet), previousCore.rootDiagnostics(original, expected.strategy, player, informationSet));
    for (const action of candidate.meta.rootActions) {
      const condition = { player, informationSet, actionId: action.id };
      const expectedGame = previousConditioned.buildActionConditionedGame(original, condition);
      const actualGame = conditioned.buildActionConditionedGame(candidate, condition);
      assert.deepEqual(actualGame, expectedGame, scenario.id + ':' + action.id);
      const fixed = core.solve(actualGame, { iterations: 32 }), oldFixed = previousCore.solve(expectedGame, { iterations: 32 });
      assert.deepEqual(solveMath(fixed), solveMath(oldFixed));
      const actualBounds = conditioned.evaluateActionConditioned(candidate, fixed.strategy, condition);
      const expectedBounds = previousConditioned.evaluateActionConditioned(original, oldFixed.strategy, condition);
      assert.deepEqual(boundsMath(actualBounds), boundsMath(expectedBounds));
      const independentGame = independent.restrictIndependently(candidate, condition);
      const witness = independent.exactPolicyEnvelope(independentGame, fixed.strategy, player);
      independent.assertOuterInterval(actualBounds.lowerBB, actualBounds.upperBB, witness.lower, witness.upper, scenario.id + ':' + action.id);
      assert.equal(actualBounds.fullPriorPreserved, true); assert.equal(actualBounds.originalHandActionEV, false);
      assert.equal(actualBounds.target, 'PRIVATE_INFORMATION_SET_COMMITMENT_VALUE');
    }
  }
});

test('prepared action solve remains baseline-identical while preserving full prior and other private information sets', () => {
  const scenario = selectedCases().find(row => row.id === 'rare_actual_hand_full_prior_commitment');
  const game = ready(scenario.input, builder), original = ready(scenario.input, previousBuilder), context = core.createCompilationContext(game);
  const options = { player: game.meta.heroSeat, informationSet: game.meta.heroInformationSet,
    actionIds: game.meta.rootActions.map(row => row.id), iterations: 32 };
  try {
    const actual = conditioned.solveActionConditioned(game, { ...options, compilationContext: context });
    const expected = previousConditioned.solveActionConditioned(original, options);
    assert.equal(actual.baseGameHash, expected.baseGameHash);
    for (const row of actual.actions) {
      const prior = expected.actions.find(value => value.id === row.id);
      assert.deepEqual(boundsMath(row), boundsMath(prior));
      assert.equal(row.fullPriorPreserved, true); assert.equal(row.originalHandActionEV, false);
      const privateGame = conditioned.buildActionConditionedGame(game, { ...options, actionId: row.id });
      assert.deepEqual(privateGame.root.outcomes.map(value => value.probability), game.root.outcomes.map(value => value.probability));
      assert.ok(privateGame.root.outcomes.some(value => value.node.informationSet !== options.informationSet && value.node.actions.length > 1));
    }
    assert.ok(actual.metrics.compilation.peakRetainedBytes <= core.MAX_RETAINED_COMPILATION_BYTES);
  } finally { core.releaseCompilationContext(context); }
});

test('unprepared or shallow-frozen conditioning does not alias mutable math from its source', () => {
  for (const shallow of [false, true]) {
    const game = fixtures.privateTypeGame(); if (shallow) Object.freeze(game);
    const original = structuredClone(game), player = 0;
    const root = game.root.outcomes[0].node, actionId = root.actions[0].id;
    const fixed = conditioned.buildActionConditionedGame(game, { player, informationSet: root.informationSet, actionId });
    const leaves = [];
    function visit(node) { if (node.type === 'terminal') leaves.push(node); else for (const row of node.outcomes || node.actions) visit(row.node); }
    visit(fixed.root); leaves[0].payoffs[0] = 12345;
    assert.deepEqual(game, original);
  }
});

test('exported vectors/strategies/checkpoints cannot mutate prepared source or later values and bounds', () => {
  const source = fixtures.matrixGame([[2, -1], [1, 0]]), owned = structuredClone(source), context = core.createCompilationContext(owned);
  try {
    const expected = previousCore.solve(source, { iterations: 32 });
    const first = core.solve(owned, { iterations: 32, compilationContext: context });
    first.values[0] = 999; first.convergence.bestResponseValues[0] = 888;
    first.checkpoint.regrets[0][0] = 777; first.checkpoint.strategySums[0][0] = 666;
    Object.values(first.strategy[0])[0][Object.keys(Object.values(first.strategy[0])[0])[0]] = 555;
    const next = core.solve(owned, { iterations: 32, compilationContext: context });
    assert.deepEqual(solveMath(next), solveMath(expected));
    const bounds = core.saddleBounds(owned, next.strategy, 0, { compilationContext: context });
    bounds.bounds[0] = 444;
    assert.deepEqual(boundsMath(core.saddleBounds(owned, next.strategy, 0, { compilationContext: context })), boundsMath(previousCore.saddleBounds(source, expected.strategy, 0)));
  } finally { core.releaseCompilationContext(context); }
});

test('invalid recalls, incompatible limits and released/forged contexts remain fail-closed', () => {
  const invalid = fixtures.privateTypeGame();
  const rows = invalid.root.outcomes.map(value => value.node);
  const laterActions = rows[0].actions.map(edge => ({ ...edge }));
  rows[0].actions[0].node = { type: 'decision', player: 0, informationSet: rows[0].informationSet, actions: laterActions };
  for (const implementation of [previousCore, core]) assert.throws(() => implementation.validateGame(invalid), /recall/);
  const game = fixtures.matrixGame([[1, -1], [-1, 1]]), context = core.createCompilationContext(game);
  core.validateGame(game, { compilationContext: context });
  assert.throws(() => core.validateGame(game, { compilationContext: structuredClone(context) }), /context/);
  assert.throws(() => core.validateGame(structuredClone(game), { compilationContext: context }), /context/);
  assert.throws(() => core.validateGame(game, { compilationContext: context, maxNodes: 1 }), /limits/);
  core.releaseCompilationContext(context); assert.throws(() => core.validateGame(game, { compilationContext: context }), /context/);
});

test('cancelled compilation and certificates do not export uncertified precision or mutate a saved checkpoint', () => {
  const game = fixtures.privateTypeGame(), prior = core.solve(game, { iterations: 32 }), before = structuredClone(prior.checkpoint);
  const canceled = core.solve(game, { iterations: 32, checkpoint: prior.checkpoint, shouldCancel: () => true });
  const previous = previousCore.solve(game, { iterations: 32, checkpoint: prior.checkpoint, shouldCancel: () => true });
  // A small tree finishes validation before the control cadence fires. Its
  // validated checkpoint remains resumable, but no new sweep/value is claimed.
  assert.deepEqual(solveMath(canceled), solveMath(previous));
  assert.equal(canceled.termination, 'CANCELLED'); assert.deepEqual(canceled.checkpoint, before);
  assert.equal(canceled.additionalIterations, 0); assert.equal(canceled.values, null); assert.equal(canceled.convergence.exact, false);
  const large = { id: 'qa-cancel-during-compilation', playerCount: 2, root: { type: 'chance',
    outcomes: Array.from({ length: 600 }, (_, i) => ({ probability: 1 / 600, node: { type: 'terminal', payoffs: [i, -i] } })) } };
  for (const implementation of [previousCore, core]) {
    const interrupted = implementation.solve(large, { iterations: 32, checkpoint: prior.checkpoint, shouldCancel: () => true });
    assert.equal(interrupted.termination, 'CANCELLED'); assert.equal(interrupted.checkpoint, null); assert.equal(interrupted.gameHash, null);
  }
  const stopped = core.saddleBounds(game, prior.strategy, 0, { shouldCancel: () => true });
  assert.equal(stopped.certified, false); assert.equal(stopped.bounds, null);
  assert.deepEqual(prior.checkpoint, before);
});

test('fixed-work job preserves source scope, global/profile mathematics and current full-prior certificates', () => {
  const input = selectedCases()[0].input, budget = { timeMs: 5000, iterations: 128 };
  const previous = previousJob.execute({ input: structuredClone(input), budget }, { compilationReuse: true, now: () => 0 });
  const actual = job.execute({ input: structuredClone(input), budget }, { compilationReuse: true, now: () => 0 });
  for (const key of ['gameHash', 'actions', 'convergence', 'decisionPrecision', 'rootDiagnostics']) assert.deepEqual(actual.result[key], previous.result[key], key);
  assert.deepEqual(actual.checkpoint.global, previous.checkpoint.global);
  assert.deepEqual(actual.checkpoint.actionCheckpoints, previous.checkpoint.actionCheckpoints);
  for (const row of actual.result.actionPrecision.actions) assert.deepEqual(boundsMath(row), boundsMath(previous.result.actionPrecision.actions.find(value => value.id === row.id)));
  const stale = structuredClone(actual.checkpoint); stale.version = 'REJECTED_QA_EXECUTION_VERSION';
  stale.actionCertificates = { FAKE: { certified: true, lowerBB: 999, upperBB: 999 } };
  const restarted = job.execute({ input: structuredClone(input), budget, checkpoint: stale }, { compilationReuse: true, now: () => 0 });
  assert.equal(restarted.checkpoint.actionCertificates.FAKE, undefined);
  assert.deepEqual(restarted.checkpoint.global, actual.checkpoint.global);
});

test('three small independent LPs and exact rational feasible-policy envelopes remain within outward certificates with zero added tolerance', () => {
  assert.equal(lp.available(), true, 'Required independent LP must not be skipped; set THEIBS_REFERENCE_PYTHON.');
  const ids = ['marginal_true_action_tie', 'decimal_fixed_rake', 'rare_actual_hand_full_prior_commitment'];
  for (const id of ids) {
    const scenario = selectedCases().find(value => value.id === id), game = ready(scenario.input, builder), player = game.meta.heroSeat;
    const action = game.meta.rootActions.find(value => value.id === 'CALL') || game.meta.rootActions.find(value => value.id.startsWith('BET:')) || game.meta.rootActions[0];
    const condition = { player, informationSet: game.meta.heroInformationSet, actionId: action.id };
    const independentGame = independent.restrictIndependently(game, condition), oracle = lp.reference({ game: independentGame });
    const feasible = independent.exactPolicyEnvelope(independentGame, oracle.strategy, player);
    const fixed = conditioned.buildActionConditionedGame(game, condition), solved = core.solve(fixed, { iterations: 32 });
    const own = independent.exactPolicyEnvelope(independentGame, solved.strategy, player);
    const bounds = conditioned.evaluateActionConditioned(game, solved.strategy, condition);
    assert.equal(bounds.certified, true); independent.assertOuterInterval(bounds.lowerBB, bounds.upperBB, own.lower, own.upper, id + ':production-profile');
    independent.assertOuterInterval(bounds.lowerBB, bounds.upperBB, feasible.lower, feasible.upper, id + ':LP-feasible-policies');
    assert.ok(bounds.lowerBB <= oracle.values[player] && bounds.upperBB >= oracle.values[player], id + ':LP point');
    assert.equal(bounds.fullPriorPreserved, true); assert.equal(bounds.originalHandActionEV, false);
  }
});
