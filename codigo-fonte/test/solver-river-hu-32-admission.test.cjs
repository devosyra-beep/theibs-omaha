'use strict';

// Admission and fixed-work mathematics, not a latency benchmark. The isolated
// baseline changes only the range ceiling; production resource guards remain.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const adapter = require('../src/solver/plo-river-game');
const core = require('../src/solver/extensive-solver');
const conditioned = require('../src/solver/action-conditioned');
const job = require('../src/solver/job-worker');
const session = require('../src/multiway-session');
const { replay } = require('../src/hand-flow');
const { capacityRiverInput } = require('./helpers/river-hu-capacity-fixtures.cjs');
const { omahaRank, compareRanks } = require('./helpers/solver-reference-fixtures.cjs');
const independent = require('./helpers/river-hu-expanded-contract-reference.cjs');

const BASELINE = '5ba76316';
const sourceRoot = path.resolve(__dirname, '..'), repositoryRoot = path.dirname(sourceRoot);
const baselineIds = new Set(['plo-river-game', 'extensive-solver', 'action-conditioned']);
const baselineModules = new Map();
function baseline(name) {
  if (baselineModules.has(name)) return baselineModules.get(name).exports;
  const filename = path.join(sourceRoot, 'src/solver', name + '.js'), loaded = new Module(filename, module);
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const ordinaryRequire = loaded.require.bind(loaded);
  loaded.require = id => id.startsWith('./') && baselineIds.has(id.slice(2)) ? baseline(id.slice(2)) : ordinaryRequire(id);
  let source = execFileSync('git', ['show', BASELINE + ':codigo-fonte/src/solver/' + name + '.js'],
    { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
  if (name === 'plo-river-game') {
    const admission = 'maxCombosPerSeat: 24, maxSizingLevels: 12, maxWorlds: 576';
    assert.ok(source.includes(admission), 'The baseline must retain its published 24/576 admission.');
    source = source.replace(admission, 'maxCombosPerSeat: 32, maxSizingLevels: 12, maxWorlds: 1024');
  }
  baselineModules.set(name, loaded); loaded._compile(source, filename); return loaded.exports;
}
const resourceLimits = Object.freeze({ maxWorlds: 1024, maxNodes: 12000, maxMemoryBytes: 48 * 1024 * 1024, maxBuildMs: 750 });
const solverLimits = Object.freeze({ maxNodes: 12000, maxInformationSets: 12000, maxWorkingBytes: 64 * 1024 * 1024, maxDepth: 256 });
function input32() { return { ...capacityRiverInput({ combos: 32, maxAggressions: 0 }), budget: { ...resourceLimits } }; }
function ready(input, builder = adapter) {
  const built = builder.buildPloRiverGame(input);
  assert.equal(built.status, 'READY', JSON.stringify(built.reasons)); return built;
}
function reject(input, code) {
  const built = adapter.buildPloRiverGame(input);
  assert.equal(built.status, 'NOT_SOLVED'); assert.equal(built.game, null);
  assert.equal(built.reasons[0].code, code);
}
function mathematics(value) {
  if (Array.isArray(value)) return value.map(mathematics);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !['elapsedMs', 'certificateElapsedMs', 'traversalVisits', 'metrics'].includes(key))
    .map(([key, child]) => [key, mathematics(child)]));
}

test('32x32 admission still requires a complete exact tree within the unchanged resource guards', () => {
  const input = input32(), before = structuredClone(input), built = ready(input);
  assert.deepEqual(adapter.HU_SUPPORT, { maxCombosPerSeat: 32, maxSizingLevels: 12, maxWorlds: 1024, maxMemoryBytes: 48 * 1024 * 1024 });
  assert.equal(adapter.LIMITS.maxNodes, 12000);
  assert.deepEqual(built.game.meta.budget, resourceLimits);
  assert.equal(built.metrics.publicNodes, 3); assert.equal(built.metrics.nodes, 3073);
  assert.equal(built.metrics.reservedMemoryBytes, 25174016);
  assert.equal(built.game.meta.productWorlds, 1024); assert.equal(built.game.meta.compatibleWorlds, 1024);
  assert.equal(built.game.meta.excludedJointAssignments, 0);
  assert.equal(built.game.meta.treeComplete, true); assert.equal(built.game.meta.chanceSupportComplete, true);
  assert.equal(built.game.meta.chanceEnumeration, 'EXACT_JOINT_RANGE_ENUMERATION');
  assert.equal(built.game.root.outcomes.length, 1024);
  assert.equal(built.coverage, 'PARTIAL'); assert.equal(built.game.meta.fullLegalSizingCoverage, false);
  const nodes = new Set();
  function visit(node) {
    assert.ok(!nodes.has(node), 'Every world owns distinct private-information nodes.'); nodes.add(node);
    if (node.type === 'chance') node.outcomes.forEach(edge => visit(edge.node));
    if (node.type === 'decision') node.actions.forEach(edge => visit(edge.node));
  }
  visit(built.game.root); assert.equal(nodes.size, built.metrics.nodes);
  const validated = core.validateGame(built.game, solverLimits);
  assert.equal(validated.perfectRecall, true); assert.equal(validated.constantSum, 2);
  assert.deepEqual(input, before);
});

test('all1024 worlds use independent Omaha rankings and the original incremental cent ledger', () => {
  const input = input32(), built = ready(input), state = session.envelope(input.multiway).state;
  const ranks = built.game.meta.ranges.map(range => range.combos.map(combo => omahaRank(combo.cards, state.board)));
  const fold = replay(input.multiway.config, [...input.multiway.events, { type: 'ACT', actor: state.heroId, action: 'FOLD' }]);
  const checkedEvents = [...input.multiway.events, { type: 'ACT', actor: state.heroId, action: 'CHECK' }];
  const checked = replay(input.multiway.config, checkedEvents); assert.equal(checked.phase, 'SHOWDOWN');
  let index = 0;
  for (let hero = 0; hero < 32; hero++) for (let opponent = 0; opponent < 32; opponent++) {
    const world = built.game.root.outcomes[index++], comparison = compareRanks(ranks[0][hero], ranks[1][opponent]);
    const winners = comparison === 0 ? [0, 1] : [comparison > 0 ? 0 : 1];
    const settled = replay(input.multiway.config, [...checkedEvents, { type: 'SETTLE', winners: checked.pots.map(() => winners), rake: 0 }]);
    for (const [id, terminalState] of [['FOLD', fold], ['CHECK', settled]]) {
      const expected = terminalState.players.map((player, seat) => Math.round((player.stack - state.players[seat].stack) * 100) / 100 / state.bigBlind);
      assert.deepEqual(world.node.actions.find(action => action.id === id).node.payoffs, expected);
    }
  }
  assert.equal(index, 1024);
});

test('nonuniform weights and blockers retain every compatible assignment without inventing posterior mass', () => {
  const input = input32(); input.ranges[0].combos.at(-1).cards = ['As', 'Ah', 'Qd', 'Jc', 'Ks'];
  const built = ready(input), meta = built.game.meta, normalized = meta.ranges;
  assert.equal(meta.productWorlds, 1024); assert.equal(meta.compatibleWorlds, 992); assert.equal(meta.excludedJointAssignments, 32);
  const actualHeroCards = new Set(input.multiway.config.heroCards); // Hero is a type, never a chance blocker.
  assert.ok(normalized[0].combos.some(combo => combo.cards.every(card => actualHeroCards.has(card))));
  const products = [];
  for (const hero of normalized[0].combos) for (const opponent of normalized[1].combos)
    if (!hero.cards.some(card => opponent.cards.includes(card))) products.push({ hero, opponent, probability: hero.weight * opponent.weight });
  const mass = products.reduce((sum, row) => sum + row.probability, 0);
  assert.equal(meta.compatiblePriorMass, mass);
  for (const [index, row] of products.entries()) {
    const actual = built.game.root.outcomes[index]; assert.equal(actual.probability, row.probability / mass);
    assert.ok(actual.probability > 0);
  }
  const actualHeroKey = [...input.multiway.config.heroCards].sort().join(',');
  assert.equal(meta.heroWorldProbability, products.filter(row => row.hero.cards.join(',') === actualHeroKey)
    .reduce((sum, row) => sum + row.probability / mass, 0));
  const scaled = structuredClone(input); for (const range of scaled.ranges) for (const combo of range.combos) combo.weight *= 7;
  assert.deepEqual(ready(scaled).game, built.game, 'Uniformly scaling raw weights must preserve this normalized study.');
});

test('33/48 ranges and32 richer trees fail atomically instead of granting coverage or partial EV', () => {
  for (const combos of [33, 48]) reject(capacityRiverInput({ combos, maxAggressions: 0 }), 'RANGE_BUDGET');
  reject({ ...capacityRiverInput({ combos: 32 }), budget: { ...resourceLimits } }, 'MEMORY_BUDGET');
  reject({ ...input32(), budget: { ...resourceLimits, maxWorlds: 1023 } }, 'WORLD_BUDGET');
  reject({ ...input32(), budget: { ...resourceLimits, maxNodes: 3072 } }, 'NODE_BUDGET');
  reject({ ...input32(), budget: { ...resourceLimits, maxMemoryBytes: 25174015 } }, 'MEMORY_BUDGET');
  reject({ ...input32(), budget: { ...resourceLimits, maxMemoryBytes: 48 * 1024 * 1024 + 1 } }, 'INVALID_BUDGET');
  assert.equal(adapter.coverage({ ...capacityRiverInput({ combos: 32 }), budget: { ...resourceLimits } }).status, 'READY',
    'Range coverage is not complete-tree admission.');
});

test('32 private priors preserve baseline exact trees, CFR checkpoints, BRs and every commitment bound', () => {
  const input = input32(), candidate = ready(input), previous = ready(input, baseline('plo-river-game'));
  assert.deepEqual(candidate.game, previous.game);
  const oldCore = baseline('extensive-solver'), oldConditioned = baseline('action-conditioned');
  const context = core.createCompilationContext(candidate.game), oldContext = oldCore.createCompilationContext(previous.game);
  const options = { ...solverLimits, iterations: 16 }, currentOptions = { ...options, compilationContext: context }, oldOptions = { ...options, compilationContext: oldContext };
  try {
    const actual = core.solve(candidate.game, currentOptions), expected = oldCore.solve(previous.game, oldOptions);
    assert.deepEqual(mathematics(actual), mathematics(expected));
    for (const player of [0, 1]) assert.deepEqual(core.bestResponse(candidate.game, actual.strategy, player, currentOptions),
      oldCore.bestResponse(previous.game, expected.strategy, player, oldOptions));
    const more = core.solve(candidate.game, { ...currentOptions, checkpoint: actual.checkpoint, iterations: 16 });
    const oldMore = oldCore.solve(previous.game, { ...oldOptions, checkpoint: expected.checkpoint, iterations: 16 });
    assert.deepEqual(mathematics(more), mathematics(oldMore));
    const targets = { player: candidate.game.meta.heroSeat, informationSet: candidate.game.meta.heroInformationSet,
      actionIds: candidate.game.meta.rootActions.map(row => row.id) };
    const bounds = conditioned.solveActionConditioned(candidate.game, { ...currentOptions, ...targets });
    const oldBounds = oldConditioned.solveActionConditioned(previous.game, { ...oldOptions, ...targets });
    assert.deepEqual(mathematics(bounds), mathematics(oldBounds));
    assert.ok(bounds.actions.every(row => row.certified && row.fullPriorPreserved && row.originalHandActionEV === false));
    assert.ok(bounds.metrics.compilation.peakRetainedBytes <= core.MAX_RETAINED_COMPILATION_BYTES);
  } finally { core.releaseCompilationContext(context); oldCore.releaseCompilationContext(oldContext); }
});

test('small reference envelopes remain inside outward bounds without added endpoint tolerance', () => {
  const input = capacityRiverInput({ combos: 2, maxAggressions: 0 }), built = ready(input);
  const condition = { player: built.game.meta.heroSeat, informationSet: built.game.meta.heroInformationSet };
  const response = conditioned.solveActionConditioned(built.game, { ...solverLimits, ...condition,
    actionIds: built.game.meta.rootActions.map(row => row.id), iterations: 16 });
  for (const row of response.actions) {
    const declaration = { ...condition, actionId: row.id }, restricted = independent.restrictIndependently(built.game, declaration);
    const owned = conditioned.buildActionConditionedGame(built.game, declaration);
    assert.deepEqual(owned.root, restricted.root);
    const solved = core.solve(owned, { ...solverLimits, iterations: 0, checkpoint: row.checkpoint });
    const reference = independent.exactPolicyEnvelope(restricted, solved.strategy, condition.player);
    independent.assertOuterInterval(row.lowerBB, row.upperBB, reference.lower, reference.upper, row.id);
  }
});

test('real adaptive32 job publishes coherent profile before final commitment outcome without relabeling partial sizing', () => {
  const progress = [], input = input32(), before = structuredClone(input);
  const finished = job.execute({ input, budget: { timeMs: 3000, iterations: 1000 }, onProgress: message => progress.push(message) },
    { compilationReuse: true });
  assert.ok(progress.length > 0);
  for (const snapshot of [...progress, finished]) {
    const result = snapshot.result, checkpoint = snapshot.checkpoint;
    assert.ok(result.actions.every(row => Number.isFinite(row.evBB) && Number.isFinite(row.frequency)));
    assert.equal(result.gameHash, checkpoint.baseGameHash); assert.equal(result.iterations, checkpoint.global.iterations);
    assert.equal(result.abstraction.compatibleWorlds, 1024); assert.equal(result.abstraction.treeComplete, true);
    assert.equal(result.abstraction.chanceSupportComplete, true); assert.equal(result.abstraction.fullLegalSizingCoverage, false);
    assert.notEqual(result.status, 'SOLVED'); assert.equal(result.qualification.gto, false);
    assert.equal(result.decisionOutcome.scope, 'FULL_PRIOR_COMMITMENT'); assert.equal(result.decisionOutcome.actualHandEVEquivalence, false);
    assert.equal(result.actions.find(row => row.id === 'FOLD').evBB, 0);
    assert.ok(result.metrics.compilation.peakRetainedBytes <= core.MAX_RETAINED_COMPILATION_BYTES);
  }
  assert.deepEqual(input, before);
});
