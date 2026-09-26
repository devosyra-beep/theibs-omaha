'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateStrategy } = require('../src/strategy-engine');

const modeled = (ev, extra = {}) => ({ status: 'MODELED', ev, assumptions: [], ...extra });
function evaluate(actions, extra = {}) {
  return evaluateStrategy({
    input: { position: 'BTN', players: 2, effectiveStack: 100, amountToCall: 1 },
    equity: { equity: .3, method: 'MONTE_CARLO' },
    legalActions: Object.keys(actions),
    ev: { status: 'MODELED', confidence: 'MEDIUM', actions },
    ...extra
  });
}

test('overlapping EV envelopes keep nominal ranking but reduce recommendation confidence', () => {
  const result = evaluate({ FOLD: modeled(0), CALL: modeled(1, { confidenceInterval95: [.7, 1.3] }), RAISE: modeled(1.1, { conditionalEvEnvelope: [.6, 1.6] }) });
  assert.equal(result.comparisonComplete, true);
  assert.equal(result.action, 'RAISE');
  assert.equal(result.confidence, 'LOW');
  assert.equal(result.leadership.status, 'OVERLAPPING');
  assert.deepEqual(result.leadership.candidateActions, ['RAISE', 'CALL']);
  assert.equal(result.leadership.simultaneousConfidenceLevel, null);
  assert.ok(result.reasonCodes.includes('EV_LEADERSHIP_OVERLAP'));
});

test('call interval crossing zero cannot establish that call beats fold', () => {
  const result = evaluate({ FOLD: modeled(0), CALL: modeled(.02, { confidenceInterval95: [-.1, .14] }) });
  assert.equal(result.action, 'CALL');
  assert.equal(result.leadership.status, 'OVERLAPPING');
  assert.equal(result.confidence, 'LOW');
  assert.deepEqual(result.leadership.boundsByAction.FOLD, { lower: 0, upper: 0, source: 'DECISION_POINT_REFERENCE' });
});

test('touching bounds are not treated as separated', () => {
  const result = evaluate({ CALL: modeled(1, { confidenceInterval95: [.5, 1.5] }), RAISE: modeled(2, { conditionalEvEnvelope: [1.5, 2.5] }) });
  assert.equal(result.leadership.status, 'OVERLAPPING');
  assert.equal(result.confidence, 'LOW');
});

test('well-separated bounds permit only conditional medium confidence', () => {
  const result = evaluate({ FOLD: modeled(0), CALL: modeled(1, { confidenceInterval95: [.7, 1.3] }), RAISE: modeled(2, { conditionalEvEnvelope: [1.5, 2.5] }) });
  assert.equal(result.leadership.status, 'SEPARATED');
  assert.equal(result.confidence, 'MEDIUM');
  assert.deepEqual(result.leadership.candidateActions, ['RAISE']);
  assert.equal(result.leadership.pointGap, 1);
  assert.equal(result.leadership.simultaneousConfidenceLevel, null);
});

test('exact equity alone does not make a raise EV exact or replace missing bounds', () => {
  const result = evaluate({ FOLD: modeled(0), CALL: modeled(1, { model: 'SHOWDOWN_ONLY' }), RAISE: modeled(2, { model: 'SCENARIO_SHOWDOWN_ONLY' }) }, { equity: { equity: .7, method: 'EXACT' } });
  assert.equal(result.leadership.status, 'MISSING_BOUNDS');
  assert.deepEqual(result.leadership.missingBoundsActions, ['RAISE']);
  assert.equal(result.confidence, 'LOW');
});

test('deterministic arithmetic under explicit fixed inputs can be compared without Monte Carlo intervals', () => {
  const result = evaluate({ FOLD: modeled(0), CALL: modeled(1, { model: 'SHOWDOWN_ONLY' }), RAISE: modeled(2, { model: 'FOLD_EQUITY_SHOWDOWN_ONLY' }) }, { equity: { equity: .7, method: 'EXACT' } });
  assert.equal(result.leadership.status, 'SEPARATED');
  assert.equal(result.leadership.boundsByAction.RAISE.source, 'FIXED_INPUT_ARITHMETIC');
  assert.equal(result.confidence, 'MEDIUM');
});

test('only user-fixed scenario equities may become point arithmetic without sampling envelopes', () => {
  const scenario = modeled(2, {
    model: 'SCENARIO_SHOWDOWN_ONLY',
    scenarioBreakdown: [
      { probability: .2, callers: [], equitySource: null },
      { probability: .8, callers: ['opponent-1'], equitySource: 'USER_CONDITIONAL' }
    ]
  });
  const userFixed = evaluate({ FOLD: modeled(0), RAISE: scenario });
  assert.equal(userFixed.leadership.status, 'SEPARATED');
  assert.equal(userFixed.leadership.boundsByAction.RAISE.source, 'FIXED_INPUT_ARITHMETIC');
  assert.equal(userFixed.leadership.simultaneousConfidenceLevel, null);
  const calculated = structuredClone(scenario);
  calculated.scenarioBreakdown[1].equitySource = 'CALCULATED_CONDITIONAL';
  const missing = evaluate({ FOLD: modeled(0), RAISE: calculated });
  assert.equal(missing.leadership.status, 'MISSING_BOUNDS');
  assert.equal(missing.confidence, 'LOW');
});

test('malformed or estimate-excluding intervals do not silently become exact', () => {
  for (const bounds of [[2, 3], [1, -1], [NaN, 2], [0, Infinity], [0], ['0', 2]]) {
    const result = evaluate({ FOLD: modeled(0), CALL: modeled(1, { model: 'SHOWDOWN_ONLY', confidenceInterval95: bounds }) }, { equity: { equity: .7, method: 'EXACT' } });
    assert.equal(result.leadership.status, 'MISSING_BOUNDS');
    assert.equal(result.confidence, 'LOW');
  }
});

test('ties, single modeled actions, incomplete comparisons and absence stay qualified', () => {
  const tie = evaluate({ CALL: modeled(1, { confidenceInterval95: [.9, 1.1] }), RAISE: modeled(1, { conditionalEvEnvelope: [.8, 1.2] }) });
  assert.equal(tie.leadership.status, 'TIED'); assert.equal(tie.confidence, 'LOW');
  const single = evaluate({ FOLD: modeled(0), CALL: { status: 'NOT_MODELED', ev: null } });
  assert.equal(single.leadership.status, 'SINGLE_MODELED_ACTION'); assert.equal(single.confidence, 'LOW');
  const partial = evaluate({ FOLD: modeled(0), CALL: modeled(1, { confidenceInterval95: [.9, 1.1] }), RAISE: { status: 'NOT_MODELED', ev: null } });
  assert.equal(partial.leadership.status, 'SEPARATED'); assert.equal(partial.comparisonComplete, false); assert.equal(partial.confidence, 'LOW');
  assert.equal(evaluate({}).leadership.status, 'UNAVAILABLE');
});
