'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/solver/extensive-solver');
const conditioned = require('../src/solver/action-conditioned');
const exact = require('./helpers/river-hu-expanded-contract-reference.cjs');
const { capacityRiverInput } = require('./helpers/river-hu-capacity-fixtures.cjs');
const { buildPloRiverGame } = require('../src/solver/plo-river-game');

const terminal = value => ({ type: 'terminal', payoffs: [value, 2 - value] });
function privateGame() {
  function world(hand, hidden) {
    const reply = action => ({ type: 'decision', player: 0, informationSet: `${hand}:A:${action}`,
      actions: [{ id: 'CONTINUE', node: terminal(hidden ? 3 : -1) }, { id: 'DROP', node: terminal(0) }] });
    return { type: 'decision', player: 0, informationSet: hand,
      actions: [{ id: 'A', node: { type: 'decision', player: 1, informationSet: 'SharedOpponent',
        actions: [{ id: 'X', node: reply('X') }, { id: 'Y', node: reply('Y') }] } },
      { id: 'B', node: terminal(hand === 'Red' ? 1 : 0) }] };
  }
  return { id: 'immutable-path-sharing-private-prior', playerCount: 2, meta: { constantSum: true },
    root: { type: 'chance', outcomes: [
      { probability: .15, node: world('Red', false) }, { probability: .2, node: world('Red', true) },
      { probability: .65, node: world('Black', false) }, { probability: 0, node: world('Black', true) }] } };
}
function nodes(game) {
  const seen = new Set();
  function walk(node) {
    assert.ok(!seen.has(node), 'Conditioned output must remain a tree, including repeated source occurrences.');
    seen.add(node);
    if (node.type === 'chance') node.outcomes.forEach(edge => walk(edge.node));
    if (node.type === 'decision') node.actions.forEach(edge => walk(edge.node));
  }
  walk(game.root); return seen;
}
function math(value) {
  if (Array.isArray(value)) return value.map(math);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !['elapsedMs', 'certificateElapsedMs', 'traversalVisits', 'costs', 'compilation', 'treeConstruction'].includes(key))
    .map(([key, child]) => [key, math(child)]));
}
function capture(graph, options, inspect) {
  const base = core.createCompilationContext(graph), original = core.createCompilationContext, captured = [];
  try {
    core.validateGame(graph, { compilationContext: base });
    core.createCompilationContext = (game, settings) => {
      const token = original(game, settings);
      if (settings?.immutableSourceContext === base) captured.push({ game, token });
      return token;
    };
    const output = conditioned.solveActionConditioned(graph, { player: 0, informationSet: 'Red', actionIds: ['A'],
      iterations: 32, ...options, compilationContext: base });
    inspect(output, captured, base);
    return output;
  } finally { core.createCompilationContext = original; core.releaseCompilationContext(base); }
}

test('private prepared construction shares only unchanged frozen paths and preserves exact full-prior mathematics', () => {
  const original = privateGame(), plain = structuredClone(original);
  const expected = conditioned.solveActionConditioned(plain, { player: 0, informationSet: 'Red', actionIds: ['A'], iterations: 32 });
  capture(original, {}, (actual, captured) => {
    assert.deepEqual(math(actual), math(expected));
    assert.equal(captured.length, 1);
    const graph = captured[0].game;
    assert.deepEqual(graph, conditioned.buildActionConditionedGame(original, { player: 0, informationSet: 'Red', actionId: 'A' }));
    assert.notEqual(graph.root, original.root);
    for (const index of [0, 1]) {
      assert.notEqual(graph.root.outcomes[index].node, original.root.outcomes[index].node);
      assert.equal(graph.root.outcomes[index].node.actions[0].node, original.root.outcomes[index].node.actions[0].node);
    }
    for (const index of [2, 3]) assert.equal(graph.root.outcomes[index].node, original.root.outcomes[index].node);
    assert.equal(graph.root.outcomes[3].probability, 0);
    assert.ok(Object.isFrozen(graph.root.outcomes[2].node.actions[0].node));
    assert.throws(() => { graph.root.outcomes[2].node.actions[0].node.actions[0].node.actions[0].node.payoffs[0] = 100; }, TypeError);
    assert.throws(() => core.compilationContextStats(captured[0].token), /released/);
    const stats = actual.metrics.treeConstruction;
    assert.equal(stats.mode, 'VERIFIED_IMMUTABLE_PATH_SHARING');
    assert.equal(stats.completedGraphs, 1);
    assert.equal(stats.copiedNodes, 3);
    assert.equal(stats.visitedNodes, nodes(graph).size);
    assert.equal(stats.sharedNodes + stats.copiedNodes, stats.visitedNodes);
    assert.equal(actual.metrics.compilation.compileCount, 1);
    assert.equal(actual.metrics.compilation.reuseCount, 1);
    assert.ok(actual.metrics.compilation.peakRetainedBytes <= core.MAX_RETAINED_COMPILATION_BYTES);
  });
  assert.equal(expected.metrics.treeConstruction.mode, 'ISOLATED_COPY');
  assert.equal(expected.metrics.treeConstruction.sharedNodes, 0);
});

test('public builder ignores sharing flags and retains mutable caller isolation even for frozen sources', () => {
  const source = privateGame(), before = structuredClone(source);
  const condition = { player: 0, informationSet: 'Red', actionId: 'A', shareImmutable: true, reuseImmutable: true, compilationContext: {} };
  const graph = conditioned.buildActionConditionedGame(source, condition), initial = structuredClone(graph);
  const sourceNodes = nodes(source);
  for (const node of nodes(graph)) assert.ok(!sourceNodes.has(node));
  assert.deepEqual(source, before);
  source.root.outcomes[2].node.actions[1].node.payoffs[0] = 99;
  assert.deepEqual(graph, initial);
  assert.equal(Object.isFrozen(source), false);
  const frozen = privateGame(), context = core.createCompilationContext(frozen);
  try {
    core.validateGame(frozen, { compilationContext: context });
    const separate = conditioned.buildActionConditionedGame(frozen, { ...condition, compilationContext: context });
    const allFrozen = nodes(frozen);
    for (const node of nodes(separate)) assert.ok(!allFrozen.has(node));
  } finally { core.releaseCompilationContext(context); }
});

test('forged or wrong-source capabilities and later commitments cannot enable sharing', () => {
  const source = privateGame(), other = privateGame(), context = core.createCompilationContext(other);
  const options = { player: 0, informationSet: 'Red', actionIds: ['A'], iterations: 4 };
  try {
    core.validateGame(other, { compilationContext: context });
    assert.throws(() => conditioned.solveActionConditioned(source, { ...options, compilationContext: {} }), /context/);
    assert.throws(() => conditioned.solveActionConditioned(source, { ...options, compilationContext: context }), /context/);
    const correct = core.createCompilationContext(source);
    try {
      assert.throws(() => conditioned.solveActionConditioned(source, { ...options,
        compilationContext: correct, informationSet: 'Red:A:X', actionIds: ['CONTINUE'] }), /initial decision/);
    } finally { core.releaseCompilationContext(correct); }
  } finally { core.releaseCompilationContext(context); }
});

test('repeated immutable source nodes are copied at later occurrences, preserving a tree and its exact hash', () => {
  const shared = terminal(1), source = { id: 'shared-terminal-source', playerCount: 2, meta: { constantSum: true },
    root: { type: 'chance', outcomes: [{ probability: .3, node: { type: 'decision', player: 0, informationSet: 'Red',
      actions: [{ id: 'A', node: shared }, { id: 'B', node: shared }] } },
    { probability: .7, node: { type: 'decision', player: 0, informationSet: 'Black',
      actions: [{ id: 'A', node: shared }, { id: 'B', node: terminal(0) }] } }] } };
  const expected = conditioned.solveActionConditioned(structuredClone(source), { player: 0, informationSet: 'Red', actionIds: ['A'], iterations: 32 });
  capture(source, {}, (actual, captured) => {
    assert.deepEqual(math(actual), math(expected));
    nodes(captured[0].game);
    assert.ok(actual.metrics.treeConstruction.repeatedSourceVisits > 0);
    assert.notEqual(captured[0].game.root.outcomes[0].node.actions[0].node, captured[0].game.root.outcomes[1].node.actions[0].node);
  });
});

test('both players and hidden successor infosets retain independent exact rational best-response containment', () => {
  const source = privateGame(), context = core.createCompilationContext(source);
  try {
    const response = conditioned.solveActionConditioned(source, { player: 0, informationSet: 'Red', actionIds: ['A', 'B'], iterations: 32, compilationContext: context });
    for (const row of response.actions) {
      const condition = { player: 0, informationSet: 'Red', actionId: row.id };
      const independent = exact.restrictIndependently(source, condition);
      const graph = conditioned.buildActionConditionedGame(source, condition);
      const solved = core.solve(graph, { iterations: 0, checkpoint: row.checkpoint });
      const envelope = exact.exactPolicyEnvelope(independent, solved.strategy, 0);
      exact.assertOuterInterval(row.lowerBB, row.upperBB, envelope.lower, envelope.upper, row.id);
      for (const player of [0, 1]) assert.deepEqual(core.bestResponse(graph, solved.strategy, player), core.bestResponse(independent, solved.strategy, player));
    }
  } finally { core.releaseCompilationContext(context); }
});

test('cancellation during sharing exports no unfinished conditioned checkpoint and keeps the base usable', () => {
  const built = buildPloRiverGame(capacityRiverInput()); assert.equal(built.status, 'READY');
  const source = built.game, context = core.createCompilationContext(source); let polls = 0;
  try {
    core.validateGame(source, { compilationContext: context });
    const result = conditioned.solveActionConditioned(source, { player: source.meta.heroSeat,
      informationSet: source.meta.heroInformationSet, actionIds: [source.meta.rootActions[1].id],
      iterations: 32, compilationContext: context, shouldCancel: () => ++polls >= 4 });
    assert.equal(result.termination, 'CANCELLED');
    assert.deepEqual(result.actions, []);
    assert.equal(result.metrics.treeConstruction.completedGraphs, 0);
    assert.ok(result.metrics.treeConstruction.visitedNodes > 0);
    assert.ok(core.validateGame(source, { compilationContext: context }).gameHash);
    const resumed = conditioned.solveActionConditioned(source, { player: source.meta.heroSeat,
      informationSet: source.meta.heroInformationSet, actionIds: [source.meta.rootActions[1].id], iterations: 1, compilationContext: context });
    assert.equal(resumed.actions[0].certified, true);
  } finally { core.releaseCompilationContext(context); }
});
