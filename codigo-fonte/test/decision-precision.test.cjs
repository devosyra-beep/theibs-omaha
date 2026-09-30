'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareDecisionValues, solverDecisionPrecision, LEGACY_METHOD } = require('../src/decision-precision');

function fixedPolicy() {
  return { source: 'LEGACY_CONTEXT_CONTINUATION', originVersion: 'POLICY_V2', resultStatus: 'HEURISTIC', contextKey: 'same-hand-inputs',
    target: 'CONDITIONAL_CONTINUATION_EV',
    uncertainty: { method: LEGACY_METHOD, scope: 'FIXED_CONTINUATION_POLICY', simultaneous: true, confidenceLevel: .95 },
    actions: [{ id: 'CALL', evBB: 2, boundsBB: [1, 3] }, { id: 'FOLD', evBB: 0, boundsBB: [0, 0] }] };
}

test('explicit action model versions cannot be compared across a policy migration', () => {
  for (const key of ['originVersion', 'modelVersion', 'solverVersion']) {
    const input = fixedPolicy();
    input.actions[1][key] = 'POLICY_V1';
    const result = compareDecisionValues(input);
    assert.equal(result.status, 'INCONCLUSIVE');
    assert.equal(result.reasonCode, 'INCOMPATIBLE_ORIGINS');
    assert.equal(result.deltaEVBB, null);
    assert.equal(result.bestActionId, null);
    input.actions[1][key] = input.originVersion;
    assert.equal(compareDecisionValues(input).status, 'CONCLUSIVE');
  }
});

test('action rows inherit snapshot version, but explicit versions need a recorded parent version', () => {
  const input = fixedPolicy();
  assert.equal(compareDecisionValues(input).originVersion, 'POLICY_V2');
  delete input.originVersion;
  input.actions[1].modelVersion = 'POLICY_V2';
  assert.equal(compareDecisionValues(input).reasonCode, 'INCOMPATIBLE_ORIGINS');
});

test('solver precision keeps version conflicts distinct from unavailable equilibrium EV bounds', () => {
  const snapshot = { source: 'REFERENCE_SUBGAME_STRATEGY', solverVersion: 'SOLVER_V2', status: 'SOLVED',
    abstraction: { key: 'same-declared-game' }, convergence: { exact: true, nashConv: 0 },
    actions: [{ id: 'CALL', evBB: 2 }, { id: 'FOLD', evBB: 0 }] };
  const result = solverDecisionPrecision(snapshot);
  assert.equal(result.originVersion, 'SOLVER_V2');
  assert.equal(result.deltaEVBB, 2);
  assert.equal(result.status, 'INCONCLUSIVE');
  assert.equal(result.reasonCode, 'EQUILIBRIUM_ACTION_VALUE_UNCERTAINTY_UNAVAILABLE');
  snapshot.actions[1].solverVersion = 'SOLVER_V1';
  const incompatible = solverDecisionPrecision(snapshot);
  assert.equal(incompatible.reasonCode, 'INCOMPATIBLE_ORIGINS');
  assert.equal(incompatible.deltaEVBB, null);
});
