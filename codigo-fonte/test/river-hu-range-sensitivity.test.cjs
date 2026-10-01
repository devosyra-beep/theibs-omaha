'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const production = require('../src/solver/plo-river-game');
const { capacityRiverInput } = require('./helpers/river-hu-capacity-fixtures.cjs');
const { experimentalAdapter, budgets } = require('./helpers/benchmark-river-hu-range-sensitivity.cjs');

test('nested24/32/48 QA ranges preserve previous hands and weights with disjoint exact Cartesian support', () => {
  const adapter = experimentalAdapter();
  for (const [smaller, larger] of [[24, 32], [32, 48]]) {
    const before = capacityRiverInput({ combos: smaller }), after = capacityRiverInput({ combos: larger });
    for (let seat = 0; seat < 2; seat++) {
      assert.deepEqual(after.ranges[seat].combos.slice(0, smaller), before.ranges[seat].combos);
      assert.equal(after.ranges[seat].combos.length, larger);
      assert.equal(new Set(after.ranges[seat].combos.map(combo => [...combo.cards].sort().join(','))).size, larger);
    }
    const observed = adapter.coverage({ ...after, budget: { ...budgets } });
    assert.equal(observed.status, 'READY');
    assert.equal(observed.worlds, larger * larger);
  }
});

test('in-memory admission experiments keep validated production32 and all resource guards unchanged', () => {
  const adapter = experimentalAdapter();
  assert.equal(adapter.HU_SUPPORT.maxCombosPerSeat, 48);
  assert.equal(adapter.HU_SUPPORT.maxWorlds, 2304);
  assert.equal(adapter.HU_SUPPORT.maxMemoryBytes, production.HU_SUPPORT.maxMemoryBytes);
  assert.equal(adapter.LIMITS.maxNodes, production.LIMITS.maxNodes);
  assert.equal(adapter.LIMITS.maxBuildMs, production.LIMITS.maxBuildMs);
  assert.equal(production.HU_SUPPORT.maxCombosPerSeat, 32);
  assert.equal(production.coverage(capacityRiverInput({ combos: 48 })).reasons[0].code, 'RANGE_BUDGET');
});

test('32/48 cannot acquire synthetic EV from a refused aggressive tree, and48 cannot fit even the minimal tree', () => {
  const adapter = experimentalAdapter();
  for (const combos of [32, 48]) {
    const result = adapter.buildPloRiverGame({ ...capacityRiverInput({ combos }), budget: { ...budgets } });
    assert.equal(result.status, 'NOT_SOLVED');
    assert.equal(result.game, null);
    assert.equal(result.reasons[0].code, 'MEMORY_BUDGET');
  }
  const minimal32 = adapter.buildPloRiverGame({ ...capacityRiverInput({ combos: 32, maxAggressions: 0 }), budget: { ...budgets } });
  assert.equal(minimal32.status, 'READY');
  assert.equal(minimal32.metrics.publicNodes, 3);
  assert.equal(minimal32.metrics.nodes, 3073);
  const minimal48 = adapter.buildPloRiverGame({ ...capacityRiverInput({ combos: 48, maxAggressions: 0 }), budget: { ...budgets } });
  assert.equal(minimal48.status, 'NOT_SOLVED');
  assert.equal(minimal48.game, null);
  assert.equal(minimal48.reasons[0].code, 'MEMORY_BUDGET');
  assert.equal((1 + 3 * 48 * 48) * 8192, 56631296);
});
