'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateStrategy } = require('../src/strategy-engine');
const { applyExploit, PROFILE_NAMES } = require('../src/exploit-engine');

const modeled = (ev) => ({ status: 'MODELED', ev, assumptions: ['Cenário fixo de teste.'] });
const missing = () => ({ status: 'NOT_MODELED', ev: null, missingInputs: ['continuationModel'] });
function context(actions, legalActions = Object.keys(actions), overrides = {}) {
  return {
    input: { position: 'BTN', players: 2, effectiveStack: 100, amountToCall: 1, board: [] },
    equity: { equity: 0.70, method: 'EXACT' },
    potMath: { potOdds: 0.40 },
    legalActions,
    ev: { status: 'MODELED', confidence: 'MEDIUM', actions },
    ...overrides
  };
}

test('a modeled fold and call do not make an unmodeled raise a complete comparison', () => {
  const result = evaluateStrategy(context({ FOLD: modeled(0), CALL: modeled(-0.294265), RAISE: missing() }, undefined, {
    equity: { equity: 0.282294, method: 'EXACT' }
  }));
  assert.equal(result.action, 'FOLD');
  assert.equal(result.comparisonStatus, 'PARTIAL');
  assert.equal(result.comparisonComplete, false);
  assert.equal(result.confidence, 'LOW');
  assert.equal(result.source, 'PARTIAL_ACTION_COMPARISON');
  assert.equal(result.optimalityScope, 'MODELED_ACTIONS_ONLY');
  assert.deepEqual(result.comparedActions, ['FOLD', 'CALL']);
  assert.deepEqual(result.missingLegalActions, ['RAISE']);
  assert.ok(result.missingFactors.includes('completeActionEV'));
});

test('high equity does not invent a raise or bet when aggression has no EV', () => {
  const facingBet = evaluateStrategy(context({ FOLD: modeled(0), CALL: modeled(1), RAISE: missing() }));
  assert.equal(facingBet.action, 'CALL');
  const freeAction = evaluateStrategy(context({ CHECK: modeled(2), BET: missing() }, undefined, {
    input: { position: 'BTN', players: 2, effectiveStack: 100, amountToCall: 0 }
  }));
  assert.equal(freeAction.action, 'CHECK');
  assert.equal(freeAction.confidence, 'LOW');
});

test('complete comparisons choose fold zero when every continuation loses', () => {
  const result = evaluateStrategy(context({ FOLD: modeled(0), CALL: modeled(-1), RAISE: modeled(-3) }));
  assert.equal(result.action, 'FOLD');
  assert.equal(result.comparisonStatus, 'COMPLETE');
  assert.equal(result.source, 'MODELED_ACTION_COMPARISON');
  assert.deepEqual(result.missingLegalActions, []);
});

test('the numerical EV ranking takes precedence over stale aggregate hints or equity thresholds', () => {
  const c = context({ FOLD: modeled(0), CALL: modeled(3), RAISE: modeled(1) });
  c.ev.positiveEvAction = 'RAISE';
  c.ev.bestModeledAction = 'RAISE';
  assert.equal(evaluateStrategy(c).action, 'CALL');
  c.ev.actions.RAISE.ev = 4;
  c.equity.equity = 0.1;
  assert.equal(evaluateStrategy(c).action, 'RAISE');
});

test('null, infinite, nonnumeric, and illegal EV entries cannot lead the comparison', () => {
  for (const bad of [null, undefined, NaN, Infinity, '100']) {
    const result = evaluateStrategy(context({ FOLD: modeled(0), CALL: modeled(1), RAISE: modeled(bad), BET: modeled(999) }, ['FOLD', 'CALL', 'RAISE']));
    assert.equal(result.action, 'CALL');
    assert.deepEqual(result.missingLegalActions, ['RAISE']);
    assert.equal(result.comparisonComplete, false);
  }
});

test('no calculated legal action produces no decision instead of a guessed action', () => {
  const result = evaluateStrategy(context({ CHECK: missing(), BET: missing() }));
  assert.equal(result.action, 'NO_DECISION');
  assert.equal(result.bestModeledAction, null);
  assert.equal(result.comparisonStatus, 'UNAVAILABLE');
  assert.equal(result.confidence, 'LOW');
  const empty = evaluateStrategy(context({}, []));
  assert.equal(empty.comparisonComplete, false);
  assert.equal(empty.action, 'NO_DECISION');
});

test('exact equity and complete action values do not imply validated optimal strategy', () => {
  const result = evaluateStrategy(context({ FOLD: modeled(0), CALL: modeled(1), RAISE: modeled(2) }));
  // Exact showdown equity alone does not certify the precision of raise EV.
  assert.equal(result.confidence, 'LOW');
  assert.equal(result.leadership.status, 'MISSING_BOUNDS');
  assert.equal(result.score, null);
  assert.equal(result.optimalityScope, 'EVALUATED_ACTIONS_AND_SIZES_UNDER_ASSUMPTIONS');
  assert.match(result.warnings.join(' '), /não é uma solução de solver/);
});

test('an exact EV tie is exposed instead of implying a unique strategic choice', () => {
  const result = evaluateStrategy(context({ FOLD: modeled(0), CALL: modeled(1), RAISE: modeled(1) }));
  assert.deepEqual(result.tiedActions, ['CALL', 'RAISE']);
  assert.ok(result.reasonCodes.includes('MODELED_EV_TIE'));
});

test('opponent profile labels cannot reverse the computed action or invent aggression', () => {
  const c = context({ CHECK: modeled(3), BET: modeled(1) }, undefined, {
    input: { position: 'BTN', players: 2, effectiveStack: 100, amountToCall: 0 }
  });
  const baseline = evaluateStrategy(c);
  for (const opponentProfile of PROFILE_NAMES) {
    const result = applyExploit({ ...c, baseline, input: { ...c.input, opponentProfile, opponentProfileSource: 'USER_OBSERVED' } });
    assert.equal(result.finalAction, 'CHECK', opponentProfile);
    assert.equal(result.finalSource, baseline.source, opponentProfile);
    assert.equal(result.confidence, baseline.confidence, opponentProfile);
    assert.deepEqual(result.adjustedInputs, {});
  }
});

test('profile multipliers are unapplied hypotheses, separated from the compared EVs', () => {
  const c = context({ FOLD: modeled(0), CALL: modeled(1), RAISE: modeled(3) });
  const baseline = evaluateStrategy(c);
  const result = applyExploit({ ...c, baseline, input: {
    ...c.input, opponentProfile: 'CALLING_STATION', foldEquity: 0.5,
    opponentResponseModel: { call: 0.4, raise: 0.1 }
  } });
  assert.equal(result.finalAction, 'RAISE');
  assert.equal(result.adjustmentStatus, 'HYPOTHESIS_ONLY');
  assert.equal(result.requiresRecalculation, true);
  assert.equal(result.proposedInputs.foldEquity, 0.3);
  assert.deepEqual(result.adjustedInputs, {});
  assert.ok(result.adjustments.length > 0);
  assert.ok(result.adjustments.every((adjustment) => adjustment.applied === false));
  assert.equal(c.ev.actions.RAISE.ev, 3);
});
