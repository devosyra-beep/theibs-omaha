'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const core = require('../src/solver/extensive-solver');
const conditioned = require('../src/solver/action-conditioned');
const job = require('../src/solver/job-worker');
const fixtures = require('../public/solver-validation-fixtures.json');

const terminal = value => ({ type: 'terminal', payoffs: [value, -value] });
function game() {
  const hand = name => ({ type: 'decision', player: 0, informationSet: name,
    actions: [{ id: 'A', node: { type: 'decision', player: 1, informationSet: 'Opponent',
      actions: [{ id: 'X', node: terminal(name === 'Red' ? 3 : 1) }, { id: 'Y', node: terminal(name === 'Red' ? -1 : 3) }] } },
    { id: 'B', node: terminal(0) }] });
  return { id: 'prepared-private-prior', playerCount: 2, meta: { constantSum: true, nested: { source: 'QA' } },
    root: { type: 'chance', outcomes: [{ probability: .3, node: hand('Red') }, { probability: .7, node: hand('Black') }] } };
}
function withoutTiming(value) {
  if (Array.isArray(value)) return value.map(withoutTiming);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['elapsedMs','certificateElapsedMs','traversalVisits','costs','compilation','treeConstruction'].includes(key))
    .map(([key, child]) => [key, withoutTiming(child)]));
}

test('private compilation preserves hashes, CFR+ arithmetic, resumed checkpoints, exact BR and outward saddle bounds', () => {
  const plain = game(), owned = game(), context = core.createCompilationContext(owned), options = { compilationContext: context };
  try {
    const expected = core.solve(plain, { iterations: 80 }), first = core.solve(owned, { ...options, iterations: 30 });
    const actual = core.solve(owned, { ...options, iterations: 50, checkpoint: first.checkpoint });
    assert.deepEqual(actual.strategy, expected.strategy);
    assert.deepEqual(actual.checkpoint, expected.checkpoint);
    assert.deepEqual(actual.values, expected.values);
    assert.deepEqual(actual.convergence, expected.convergence);
    assert.equal(actual.gameHash, expected.gameHash);
    for (const player of [0, 1]) {
      assert.deepEqual(core.bestResponse(owned, actual.strategy, player, options), core.bestResponse(plain, expected.strategy, player));
      assert.deepEqual(withoutTiming(core.saddleBounds(owned, actual.strategy, player, options)), withoutTiming(core.saddleBounds(plain, expected.strategy, player)));
    }
    assert.deepEqual(core.rootDiagnostics(owned, actual.strategy, 0, 'Red', options), core.rootDiagnostics(plain, expected.strategy, 0, 'Red'));
    assert.deepEqual(core.evaluateInformationSet(owned, actual.strategy, 'Red', options), core.evaluateInformationSet(plain, expected.strategy, 'Red'));
    const stats = core.compilationContextStats(context);
    assert.equal(stats.compileCount, 1); assert.ok(stats.reuseCount >= 8); assert.ok(stats.retainedBytes > 0);
  } finally { core.releaseCompilationContext(context); }
});

test('capability cannot be forged, serialized, transferred to another game, reused after release, or used with new limits', () => {
  const owned = game(), context = core.createCompilationContext(owned), options = { compilationContext: context };
  assert.throws(() => core.validateGame(owned, { compilationContext: {} }), /context/);
  assert.throws(() => core.validateGame(owned, { compilationContext: structuredClone(context) }), /context/);
  core.validateGame(owned, options);
  assert.throws(() => core.validateGame(structuredClone(owned), options), /context/);
  assert.throws(() => core.validateGame(owned, { ...options, maxNodes: core.DEFAULT_LIMITS.maxNodes - 1 }), /limits changed/);
  core.releaseCompilationContext(context);
  assert.throws(() => core.validateGame(owned, options), /context/);
  assert.throws(() => core.compilationContextStats(context), /released/);
  core.releaseCompilationContext(context);
});

test('successful preparation makes nested mathematical inputs and metadata immutable', () => {
  const owned = game(), context = core.createCompilationContext(owned);
  try {
    const initial = core.validateGame(owned, { compilationContext: context });
    const decision = owned.root.outcomes[0].node;
    assert.throws(() => { owned.playerCount = 3; }, TypeError);
    assert.throws(() => { owned.root.outcomes[0].probability = .8; }, TypeError);
    assert.throws(() => { decision.actions[0].id = 'changed'; }, TypeError);
    assert.throws(() => { decision.actions.push({ id: 'C', node: terminal(8) }); }, TypeError);
    assert.throws(() => { decision.actions[0].node.actions[0].node.payoffs[0] = 100; }, TypeError);
    assert.throws(() => { owned.meta.nested.source = 'changed'; }, TypeError);
    assert.deepEqual(core.validateGame(owned, { compilationContext: context }), initial);
  } finally { core.releaseCompilationContext(context); }
});

test('inherited immutable proof is private and never treats a shallow or interrupted freeze as complete', () => {
  const base = game(), context = core.createCompilationContext(base);
  assert.throws(() => core.createCompilationContext(game(), { immutableSourceContext: {} }), /source context/);
  assert.throws(() => core.createCompilationContext(game(), { immutableSourceContext: context }), /unprepared/);
  core.validateGame(base, { compilationContext: context });
  const child = game(); child.meta = Object.freeze({ shared: base.meta, mutable: { label: 'original' } });
  const next = core.createCompilationContext(child, { immutableSourceContext: context });
  try {
    core.validateGame(child, { compilationContext: next });
    assert.throws(() => { child.meta.mutable.label = 'changed'; }, TypeError);
    assert.equal(child.meta.shared, base.meta);
  } finally { core.releaseCompilationContext(next); core.releaseCompilationContext(context); }
  const interrupted = game(), paused = core.createCompilationContext(interrupted), sentinel = Symbol('stop'); let visits = 0;
  assert.throws(() => core.validateGame(interrupted, { compilationContext: paused }, () => { if (++visits === 4) throw sentinel; }), error => error === sentinel);
  assert.throws(() => core.createCompilationContext(game(), { immutableSourceContext: paused }), /unprepared/);
  core.validateGame(interrupted, { compilationContext: paused });
  assert.throws(() => { interrupted.root.outcomes[0].node.actions[0].node.actions[0].node.payoffs[0] = 100; }, TypeError);
  core.releaseCompilationContext(paused);
});

test('preparation accepts native cross-realm plain data and rejects accessors, executable fields and custom prototypes', () => {
  const crossRealm = vm.runInNewContext('(' + JSON.stringify(game()) + ')'), context = core.createCompilationContext(crossRealm);
  assert.deepEqual(core.validateGame(crossRealm, { compilationContext: context }), core.validateGame(game()));
  core.releaseCompilationContext(context);
  const accessor = game(); let evaluated = false;
  Object.defineProperty(accessor.meta, 'dynamic', { get() { evaluated = true; return 1; } });
  const executable = game(); executable.meta.toJSON = () => ({ constantSum: false });
  const symbolExecutable = game(); symbolExecutable.meta[Symbol('fn')] = () => 1;
  const custom = game(); Object.setPrototypeOf(custom.meta, { custom: true });
  const customArray = game(); Object.setPrototypeOf(customArray.root.outcomes, Object.create(Array.prototype));
  for (const invalid of [accessor, executable, symbolExecutable, custom, customArray]) {
    const capability = core.createCompilationContext(invalid);
    try { assert.throws(() => core.validateGame(invalid, { compilationContext: capability }), /accessor|executable|plain owned/); }
    finally { core.releaseCompilationContext(capability); }
  }
  assert.equal(evaluated, false);
});

test('retention ceiling falls back to unchanged computation and does not reject an otherwise valid game', () => {
  for (const maxRetainedBytes of [0, 1]) {
    const owned = game(), context = core.createCompilationContext(owned, { maxRetainedBytes });
    try {
      const expected = core.solve(game(), { iterations: 40 });
      for (let attempt = 0; attempt < 2; attempt++) {
        assert.deepEqual(withoutTiming(core.solve(owned, { compilationContext: context, iterations: 40 })), withoutTiming(expected));
      }
      const stats = core.compilationContextStats(context);
      assert.equal(stats.retainedBytes, 0); assert.equal(stats.compileCount, 2); assert.equal(stats.reuseCount, 0);
    } finally { core.releaseCompilationContext(context); }
  }
  assert.throws(() => core.createCompilationContext(game(), { maxRetainedBytes: core.MAX_RETAINED_COMPILATION_BYTES + 1 }), /8 MiB/);
});

test('cancelled preparation or reuse never exports an unvalidated checkpoint or a certified bound', () => {
  const owned = game(), context = core.createCompilationContext(owned), options = { compilationContext: context };
  try {
    const stopped = core.solve(owned, { ...options, iterations: 10, shouldCancel: () => true });
    assert.equal(stopped.termination, 'CANCELLED'); assert.equal(stopped.checkpoint, null); assert.equal(stopped.gameHash, null);
    const completed = core.solve(owned, { ...options, iterations: 10 });
    const stoppedReuse = core.solve(owned, { ...options, checkpoint: completed.checkpoint, iterations: 10, shouldCancel: () => true });
    assert.equal(stoppedReuse.checkpoint, null); assert.equal(stoppedReuse.gameHash, null);
    const bounds = core.saddleBounds(owned, completed.strategy, 0, { ...options, shouldCancel: () => true });
    assert.equal(bounds.certified, false); assert.equal(bounds.termination, 'CANCELLED');
    assert.equal(core.compilationContextStats(context).compileCount, 1);
  } finally { core.releaseCompilationContext(context); }
});

test('one freshly conditioned graph shares solve/bounds compilation then releases, preserving the full private prior', () => {
  const owned = game(), context = core.createCompilationContext(owned);
  const options = { player: 0, informationSet: 'Red', actionIds: ['A', 'B'], iterations: 80 };
  try {
    const expected = conditioned.solveActionConditioned(game(), options);
    for (let attempt = 0; attempt < 2; attempt++) {
      const actual = conditioned.solveActionConditioned(owned, { ...options, compilationContext: context });
      assert.deepEqual(withoutTiming(actual), withoutTiming(expected));
      assert.equal(actual.metrics.compilation.compileCount, 2);
      assert.equal(actual.metrics.compilation.reuseCount, 2);
      assert.ok(actual.metrics.compilation.peakRetainedBytes <= core.MAX_RETAINED_COMPILATION_BYTES);
      assert.ok(actual.metrics.costs.certificateMs >= 0);
      assert.equal(actual.fullPriorPreserved, true);
    }
    assert.equal(core.compilationContextStats(context).compileCount, 1);
    // A base capability is not forwarded to a different conditioned source.
    const fixed = conditioned.buildActionConditionedGame(owned, { player: 0, informationSet: 'Red', actionId: 'A' });
    const solved = core.solve(fixed, { iterations: 10 });
    assert.equal(conditioned.evaluateActionConditioned(owned, solved.strategy, { ...options, actionId: 'A', compilationContext: context }).certified, true);
  } finally { core.releaseCompilationContext(context); }
});

test('conditioned capabilities release on certificate exceptions and cancellation without releasing their base', () => {
  const owned = game(), context = core.createCompilationContext(owned), captures = [];
  core.validateGame(owned, { compilationContext: context });
  const originalCreate = core.createCompilationContext, originalBounds = core.saddleBounds, originalSolve = core.solve;
  const options = { player: 0, informationSet: 'Red', actionIds: ['A'], iterations: 10, compilationContext: context };
  try {
    core.createCompilationContext = (source, opts) => { const token = originalCreate(source, opts); captures.push(token); return token; };
    core.saddleBounds = () => { throw Error('certificate failed'); };
    assert.throws(() => conditioned.solveActionConditioned(owned, options), /certificate failed/);
    core.saddleBounds = originalBounds;
    let canceled = false;
    core.solve = (...args) => { const result = originalSolve(...args); canceled = true; return result; };
    const stopped = conditioned.solveActionConditioned(owned, { ...options, shouldCancel: () => canceled });
    assert.equal(stopped.termination, 'CANCELLED'); assert.equal(stopped.actions[0].certified, false);
    assert.equal(captures.length, 2);
    for (const token of captures) assert.throws(() => core.compilationContextStats(token), /released/);
    assert.equal(core.compilationContextStats(context).compileCount, 1);
  } finally {
    core.createCompilationContext = originalCreate; core.saddleBounds = originalBounds; core.solve = originalSolve;
    core.releaseCompilationContext(context);
  }
});

test('exported terminal-root values cannot mutate private compiled payoffs or their existing mathematical hash', () => {
  const owned = { id: 'terminal-root', playerCount: 2, root: terminal(2) }, context = core.createCompilationContext(owned), options = { compilationContext: context };
  try {
    const first = core.solve(owned, { ...options, iterations: 0 }), initialHash = first.gameHash;
    first.values[0] = 999; first.convergence.bestResponseValues[0] = 888;
    const evaluated = core.evaluate(owned, first.strategy, options); assert.deepEqual(evaluated.values, [2, -2]);
    evaluated.values[0] = 777;
    const solved = core.solve(owned, { ...options, iterations: 0 }); assert.deepEqual(solved.values, [2, -2]); assert.equal(solved.gameHash, initialHash);
    const bounds = core.saddleBounds(owned, first.strategy, 0, options); assert.ok(bounds.lower <= 2 && bounds.upper >= 2 && bounds.upper < 3);
  } finally { core.releaseCompilationContext(context); }
});

test('job owns and releases compilation capabilities on completion, cancellation and errors without freezing its request', () => {
  const input = structuredClone(fixtures.cases[0].variants[0].input), original = structuredClone(input), captures = [];
  const instrumented = { ...core, createCompilationContext(source) { const context = core.createCompilationContext(source); captures.push(context); return context; } };
  const dependencies = { core: instrumented, compilationReuse: true };
  const first = job.execute({ input, budget: { timeMs: 3000, iterations: 1000 } }, dependencies);
  assert.deepEqual(input, original); assert.equal(Object.isFrozen(input), false); assert.equal(Object.isFrozen(input.multiway), false);
  const pending = [input];
  while (pending.length) {
    const value = pending.pop(); assert.equal(Object.isFrozen(value), false, 'the request must remain caller owned and mutable');
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
  }
  assert.equal(first.result.metrics.compilation.base.compileCount, 1);
  assert.ok(first.result.metrics.compilation.base.reuseCount > 0);
  assert.equal(first.result.metrics.compilation.scope, 'CURRENT_EXECUTION_ONLY');
  assert.ok(first.result.metrics.compilation.peakRetainedBytes <= core.MAX_RETAINED_COMPILATION_BYTES);
  assert.ok(first.result.metrics.runCosts.actionCertificateMs >= 0);
  assert.ok(!JSON.stringify(first.checkpoint).includes('compilationContext'));
  for (const context of captures) assert.throws(() => core.compilationContextStats(context), /released/);
  const second = job.execute({ input, budget: { timeMs: 3000, iterations: 1000 }, checkpoint: first.checkpoint }, dependencies);
  assert.equal(second.result.metrics.compilation.base.compileCount, 1);
  assert.notEqual(captures[0], captures[1]);
  const canceled = job.execute({ input, budget: { timeMs: 3000, iterations: 1000 }, shouldCancel: () => true }, dependencies);
  assert.equal(canceled.paused, true); assert.deepEqual(canceled.result.actions, []);
  assert.throws(() => job.execute({ input, budget: { timeMs: 3000, iterations: 1000 }, onProgress() { throw Error('consumer failed'); } }, dependencies), /consumer failed/);
  for (const context of captures) assert.throws(() => core.compilationContextStats(context), /released/);
});

test('default Node computation remains uncached; only trusted dependencies enable identical prepared mathematics', () => {
  const input = structuredClone(fixtures.cases[0].variants[0].input), budget = { timeMs: 3000, iterations: 1000 }; let created = 0;
  const instrumented = { ...core, createCompilationContext(source) { created++; return core.createCompilationContext(source); } };
  const ordinary = job.execute({ input, budget }, { core: instrumented });
  const forged = job.execute({ input: { ...input, compilationReuse: true }, budget,
    checkpoint: { ...ordinary.checkpoint, compilationReuse: true } }, { core: instrumented });
  assert.equal(created, 0); assert.equal(ordinary.result.metrics.compilation, undefined); assert.equal(forged.result.metrics.compilation, undefined);
  const prepared = job.execute({ input, budget }, { core: instrumented, compilationReuse: true });
  assert.equal(created, 1); assert.equal(prepared.result.metrics.compilation.scope, 'CURRENT_EXECUTION_ONLY');
  for (const key of ['gameHash','actions','convergence','decisionPrecision']) assert.deepEqual(prepared.result[key], ordinary.result[key]);
  assert.deepEqual(withoutTiming(prepared.result.actionPrecision), withoutTiming(ordinary.result.actionPrecision));
  assert.deepEqual(prepared.checkpoint.global, ordinary.checkpoint.global);
  assert.deepEqual(prepared.checkpoint.actionCheckpoints, ordinary.checkpoint.actionCheckpoints);
});

test('adaptive V6 rejects old execution checkpoints while mathematical CFR checkpoint identity is preserved', () => {
  assert.equal(job.VERSION, 'THEIBS_HU_ADAPTIVE_V6');
  assert.equal(core.VERSION, 'THEIBS_FULL_TREE_CFR_PLUS_V1');
  const input = fixtures.cases[0].variants[0].input, first = job.execute({ input, budget: { timeMs: 3000, iterations: 1000 } });
  const stale = structuredClone(first.checkpoint); stale.version = 'THEIBS_HU_ADAPTIVE_V5'; stale.workIterations = 123456;
  stale.actionCertificates = { FAKE: { certified: true, lowerBB: 100, upperBB: 100 } };
  const restarted = job.execute({ input, checkpoint: stale, budget: { timeMs: 3000, iterations: 1000 } });
  assert.equal(restarted.checkpoint.global.iterations, first.checkpoint.global.iterations);
  assert.equal(restarted.checkpoint.workIterations, first.checkpoint.workIterations);
  assert.equal(restarted.checkpoint.actionCertificates.FAKE, undefined);
  assert.equal(restarted.result.gameHash, first.result.gameHash);
});
