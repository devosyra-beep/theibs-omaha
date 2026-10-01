'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const adapter = require('../src/solver/plo-river-game');
const core = require('../src/solver/extensive-solver');
const conditioned = require('../src/solver/action-conditioned');
const { replay } = require('../src/hand-flow');
const session = require('../src/multiway-session');
const { capacityRiverInput } = require('./helpers/river-hu-capacity-fixtures.cjs');
const { omahaRank, compareRanks } = require('./helpers/solver-reference-fixtures.cjs');
const exact = require('./helpers/river-hu-expanded-contract-reference.cjs');

const filename = path.resolve(__dirname, '../src/solver/plo-river-game.js');
function load(source) {
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(source, filename);
  return loaded.exports;
}
function ready(input, build = adapter.buildPloRiverGame) {
  const result = build(input);
  assert.equal(result.status, 'READY', JSON.stringify(result.reasons));
  return result;
}
function reject(input, code) {
  const result = adapter.buildPloRiverGame(input);
  assert.equal(result.status, 'NOT_SOLVED');
  assert.equal(result.game, null);
  assert.equal(result.reasons[0].code, code);
}

test('24x24 two-size HU admits all576 exact assignments under unchanged memory and node caps', () => {
  const input = capacityRiverInput(), before = structuredClone(input), built = ready(input);
  assert.equal(adapter.HU_SUPPORT.maxCombosPerSeat, 24);
  assert.equal(adapter.HU_SUPPORT.maxWorlds, 576);
  assert.equal(adapter.HU_SUPPORT.maxSizingLevels, 12);
  assert.equal(adapter.HU_SUPPORT.maxMemoryBytes, 48 * 1024 * 1024);
  assert.equal(adapter.LIMITS.maxNodes, 12000);
  assert.equal(built.game.meta.productWorlds, 576);
  assert.equal(built.game.meta.compatibleWorlds, 576);
  assert.equal(built.game.meta.excludedJointAssignments, 0);
  assert.equal(built.game.meta.chanceEnumeration, 'EXACT_JOINT_RANGE_ENUMERATION');
  assert.equal(built.game.meta.chanceSupportComplete, true);
  assert.equal(built.game.meta.treeComplete, true);
  assert.equal(built.game.meta.fullLegalSizingCoverage, false);
  assert.equal(built.coverage, 'PARTIAL');
  assert.equal(built.metrics.nodes, 5185);
  assert.equal(built.metrics.reservedMemoryBytes, 42475520);
  assert.equal(built.metrics.handRankEvaluations, 48);
  assert.ok(built.game.root.outcomes.every(row => row.probability > 0));
  const identities = new Set();
  function walk(node) {
    assert.ok(!identities.has(node), 'Every world must own its full node tree.');
    identities.add(node);
    if (node.type === 'chance') node.outcomes.forEach(edge => walk(edge.node));
    if (node.type === 'decision') node.actions.forEach(edge => walk(edge.node));
  }
  walk(built.game.root);
  assert.equal(identities.size, built.metrics.nodes);
  const validated = core.validateGame(built.game);
  assert.equal(validated.perfectRecall, true);
  assert.equal(validated.constantSum, 2);
  assert.deepEqual(input, before);
});

test('every new world uses independent Omaha ranking and the authoritative incremental cent ledger', () => {
  const input = capacityRiverInput(), built = ready(input), state = session.envelope(input.multiway).state;
  const ranks = built.game.meta.ranges.map(range => range.combos.map(combo => omahaRank(combo.cards, state.board)));
  let index = 0;
  for (let hero = 0; hero < 24; hero++) for (let opponent = 0; opponent < 24; opponent++) {
    const root = built.game.root.outcomes[index++].node;
    const comparison = compareRanks(ranks[0][hero], ranks[1][opponent]);
    const winners = comparison === 0 ? [0, 1] : [comparison > 0 ? 0 : 1];
    for (const row of root.actions.filter(row => row.id.startsWith('BET:'))) {
      const size = Number(row.id.split(':')[1]);
      const events = [...input.multiway.events, { type: 'ACT', actor: state.heroId, action: 'BET', to: size },
        { type: 'ACT', actor: 1 - state.heroId, action: 'CALL' }];
      const before = replay(input.multiway.config, events);
      const settled = replay(input.multiway.config, [...events, { type: 'SETTLE', winners: before.pots.map(() => winners), rake: 0 }]);
      const expected = settled.players.map((player, seat) => Math.round((player.stack - state.players[seat].stack) * 100) / 100 / state.bigBlind);
      assert.deepEqual(row.node.actions.find(action => action.id === 'CALL').node.payoffs, expected);
    }
  }
  assert.equal(index, 576);
});

test('24x24 ranges do not override explicit sizing, node, world or conservative memory guards', () => {
  for (const sizings of [3, 12]) reject(capacityRiverInput({ sizings }), 'MEMORY_BUDGET');
  reject({ ...capacityRiverInput(), budget: { maxWorlds: 575 } }, 'WORLD_BUDGET');
  reject({ ...capacityRiverInput(), budget: { maxNodes: 5184 } }, 'NODE_BUDGET');
  reject({ ...capacityRiverInput(), budget: { maxMemoryBytes: 42475519 } }, 'MEMORY_BUDGET');
  reject(capacityRiverInput({ combos: 25 }), 'RANGE_BUDGET');
  const sizes = capacityRiverInput();
  sizes.sizing.levels = Array.from({ length: 13 }, (_, index) => 1 + index / 100);
  reject(sizes, 'INVALID_SIZING');
  assert.deepEqual(adapter.THREE_SEAT_SUPPORT, { maxCombosPerSeat: 3, maxSizingLevels: 8,
    maxWorlds: 27, maxMemoryBytes: 96 * 1024 * 1024 });
});

test('larger blockers remain exact joint conditioning without a sampled or truncated support', () => {
  const input = capacityRiverInput();
  input.ranges[0].combos.at(-1).cards = ['As', 'Ah', 'Qd', 'Jc', 'Ks'];
  const built = ready(input);
  assert.equal(built.game.meta.productWorlds, 576);
  assert.equal(built.game.meta.compatibleWorlds, 552);
  assert.equal(built.game.meta.excludedJointAssignments, 24);
  assert.equal(new Set(built.game.root.outcomes.map(row => row.node.informationSet)).size, 23);
  assert.equal(built.game.root.outcomes.filter(row => row.node.informationSet === built.game.meta.heroInformationSet).length, 24);
  const probability = built.game.root.outcomes.reduce((sum, row) => sum + row.probability, 0);
  assert.ok(Math.abs(probability - 1) < 1e-12);
  assert.equal(built.game.meta.chanceSupportComplete, true);
});

test('construction deadline rejects24x24 as a whole before private-tree allocation', () => {
  // Deterministic deadline clock; cards, public ledger and builder are real.
  const source = fs.readFileSync(filename, 'utf8');
  const expired = load("'use strict'; let ticks=0; const performance={now:()=>ticks++?751:0};\n" + source);
  const result = expired.buildPloRiverGame({ ...capacityRiverInput(), budget: { maxBuildMs: 750 } });
  assert.equal(result.status, 'NOT_SOLVED');
  assert.equal(result.game, null);
  assert.equal(result.reasons[0].code, 'BUILD_TIME_BUDGET');
});

test('old admitted trees, keys and deterministic fixed-work maths match verbatim b62b0f1', () => {
  const source = execFileSync('git', ['show', 'b62b0f1:codigo-fonte/src/solver/plo-river-game.js'],
    { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', windowsHide: true });
  const baseline = load(source);
  for (const combos of [2, 12]) {
    const input = { ...capacityRiverInput({ combos }), budget: { maxWorlds: 144 } };
    const original = ready(input, baseline.buildPloRiverGame), candidate = ready(input);
    assert.deepEqual(candidate.game, original.game);
    assert.equal(candidate.game.meta.key, original.game.meta.key);
    if (combos === 2) {
      const oldSolved = core.solve(original.game, { iterations: 32 }), newSolved = core.solve(candidate.game, { iterations: 32 });
      assert.deepEqual(newSolved.strategy, oldSolved.strategy);
      assert.deepEqual(newSolved.values, oldSolved.values);
      assert.deepEqual(newSolved.convergence, oldSolved.convergence);
      assert.deepEqual(newSolved.checkpoint, oldSolved.checkpoint);
      for (const action of candidate.game.meta.rootActions) {
        const condition = { player: candidate.game.meta.heroSeat, informationSet: candidate.game.meta.heroInformationSet, actionId: action.id };
        const oldGame = conditioned.buildActionConditionedGame(original.game, condition);
        const newGame = conditioned.buildActionConditionedGame(candidate.game, condition);
        const old = core.solve(oldGame, { iterations: 32 }), current = core.solve(newGame, { iterations: 32 });
        assert.deepEqual(current.strategy, old.strategy);
        assert.deepEqual(current.values, old.values);
        assert.deepEqual(current.convergence, old.convergence);
        assert.deepEqual(current.checkpoint, old.checkpoint);
        const { elapsedMs: currentElapsed, ...currentBounds } = conditioned.evaluateActionConditioned(candidate.game, current.strategy, condition);
        const { elapsedMs: oldElapsed, ...oldBounds } = conditioned.evaluateActionConditioned(original.game, old.strategy, condition);
        assert.deepEqual(currentBounds, oldBounds);
      }
    }
  }
});

test('small reference commitments retain zero-tolerance exact pure-policy envelope containment', () => {
  const scenario = exact.scenarios().find(row => row.id === 'marginal_positive_call');
  const built = ready(scenario.input), game = built.game;
  for (const action of game.meta.rootActions) {
    const condition = { player: game.meta.heroSeat, informationSet: game.meta.heroInformationSet, actionId: action.id };
    const restricted = conditioned.buildActionConditionedGame(game, condition);
    const solved = core.solve(restricted, { iterations: 32 });
    const independent = exact.restrictIndependently(game, condition);
    const envelope = exact.exactPolicyEnvelope(independent, solved.strategy, game.meta.heroSeat);
    const bounds = conditioned.evaluateActionConditioned(game, solved.strategy, condition);
    assert.equal(bounds.certified, true);
    exact.assertOuterInterval(bounds.lowerBB, bounds.upperBB, envelope.lower, envelope.upper, action.id);
    assert.equal(bounds.fullPriorPreserved, true);
    assert.equal(bounds.originalHandActionEV, false);
  }
});
