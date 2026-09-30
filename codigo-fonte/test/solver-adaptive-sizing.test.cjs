'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execute, chooseFocus, focusActions } = require('../src/solver/job-worker');
const adapter = require('../src/solver/plo-river-game');
const { riverMixedInput } = require('./helpers/solver-reference-fixtures.cjs');

const bounds = (id, lowerBB, upperBB) => ({ id, lowerBB, upperBB, certified: true });
function expandedInput() {
  const input = riverMixedInput();
  input.sizing = { type: 'EXPLICIT_TOTALS', levels: Array.from({ length: 12 }, (_, i) => 1 + i * .08), maxAggressions: 1 };
  return input;
}

test('twelve declared candidates receive refinement despite low point EV and wide competitors', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `BET:${i + 1}`), attempts = {};
  const rows = ids.map((id, i) => ({ ...bounds(id, -100, i === 0 ? 10000 : 10), evBB: i ? -99999 : 10000, frequency: i ? 0 : 1 }));
  for (let step = 0; step < 48; step++) {
    const selected = chooseFocus(ids, rows, attempts);
    assert.equal(selected.focus.dominatedActions.length, 0);
    attempts[selected.id] = (attempts[selected.id] || 0) + 1;
    const counts = ids.map(id => attempts[id] || 0);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 2, 'optimistic bound cannot starve other competitive actions');
  }
  assert.ok(ids.every(id => attempts[id] >= 3));
  const pending = ids.map(id => ({ id, certified: false, evBB: -1e9, frequency: 0 }));
  const pendingAttempts = {};
  for (let step = 0; step < ids.length; step++) {
    const selected = chooseFocus(ids, pending, pendingAttempts).id;
    pendingAttempts[selected] = (pendingAttempts[selected] || 0) + 1;
  }
  assert.ok(ids.every(id => pendingAttempts[id] === 1), 'every unknown action gets an initial certification attempt');
});

test('only strictly dominated bounds exclude work; tied, unknown and touching candidates stay', () => {
  const ids = ['LEADER', 'DOMINATED', 'TOUCHING', 'UNKNOWN', 'WIDE'];
  const rows = [bounds('LEADER', 5, 6), bounds('DOMINATED', -10, 4), bounds('TOUCHING', 0, 5),
    { id: 'UNKNOWN', certified: false, evBB: -9999 }, bounds('WIDE', -1000, 7)];
  const focus = focusActions(ids, rows);
  assert.deepEqual(focus.dominatedActions.map(row => row.id), ['DOMINATED']);
  assert.deepEqual(focus.survivingActionIds, ['LEADER', 'TOUCHING', 'UNKNOWN', 'WIDE']);
  const attempts = {}, selected = [];
  for (let i = 0; i < 16; i++) {
    const id = chooseFocus(ids, rows, attempts).id; attempts[id] = (attempts[id] || 0) + 1; selected.push(id);
  }
  assert.ok(!selected.includes('DOMINATED'));
  assert.ok(focus.survivingActionIds.every(id => selected.includes(id)));
});

test('execution keeps every declared legal sizing in one tree and discloses partial sizing coverage', () => {
  const input = expandedInput(), original = JSON.stringify(input), progress = [];
  const built = adapter.buildPloRiverGame(input);
  assert.equal(built.status, 'READY', JSON.stringify(built.reasons));
  assert.equal(built.game.meta.rootActions.filter(action => action.size !== null).length, 12);
  const output = execute({ input, budget: { timeMs: 3000, iterations: 1500 }, onProgress: row => progress.push(row.result) });
  assert.ok(output.result.actions.length > 12);
  const ids = output.result.actions.map(row => row.id);
  for (const snapshot of [...progress, output.result]) {
    assert.deepEqual(snapshot.actions.map(row => row.id), ids);
    assert.equal(snapshot.gameHash, output.result.gameHash);
    assert.equal(snapshot.status, 'APPROXIMATE', 'an abstracted tree cannot qualify as all legal sizing');
    assert.equal(snapshot.qualification.gto, false);
    const refinement = snapshot.adaptation.sizingRefinement;
    assert.equal(refinement.mode, 'FIXED_DECLARED_TREE_ADAPTIVE_CERTIFICATES');
    assert.equal(refinement.allDeclaredActionsRetained, true);
    assert.equal(refinement.allLegalSizesRepresented, false);
    assert.equal(refinement.sizingActionIds.length, 12);
    assert.deepEqual(refinement.candidates.map(row => row.id), ids);
    assert.equal(refinement.gameHash, snapshot.gameHash);
    assert.equal(refinement.baseContextKey, snapshot.actionPrecision.baseContextKey);
    for (const row of snapshot.actionPrecision.actions) {
      assert.equal(row.baseGameHash, snapshot.gameHash);
      assert.equal(row.baseContextKey, snapshot.actionPrecision.baseContextKey);
      assert.equal(row.utility.basis, 'INCREMENTAL_TERMINAL_PAYOFF_FROM_ORIGINAL_DECISION');
    }
  }
  assert.ok(output.result.actionPrecision.actions.every(row => row.certified), 'the small reference exercises every declared candidate');
  assert.equal(JSON.stringify(input), original);
  assert.equal(Object.hasOwn(output.checkpoint, 'preparationCache'), false);
});

test('changing declared sizing trees discards old strategy and action bounds even for shared actions', () => {
  const input = expandedInput(), before = execute({ input, budget: { timeMs: 3000, iterations: 1000 } });
  assert.ok(before.result.actionPrecision.actions.some(row => row.certified));
  const larger = structuredClone(input); larger.sizing.levels[11] = 1.99;
  const after = execute({ input: larger, checkpoint: before.checkpoint, budget: { timeMs: 3000, iterations: 1 } });
  assert.notEqual(after.result.gameHash, before.result.gameHash);
  assert.notEqual(after.result.actionPrecision.baseContextKey, before.result.actionPrecision.baseContextKey);
  assert.ok(after.result.actionPrecision.actions.every(row => row.certified === false));
  assert.equal(after.checkpoint.global.iterations, 1);
  assert.deepEqual(after.checkpoint.actionCheckpoints, {});
  assert.deepEqual(after.checkpoint.actionCertificates, {});
});

