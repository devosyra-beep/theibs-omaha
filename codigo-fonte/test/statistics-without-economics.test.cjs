'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decide } = require('../src/decision-engine');
const { normalizeGameState } = require('../src/game-state');

const base = {
  variant: 'PLO4_HIGH',
  heroCards: ['As','Kd','Qc','Jh'],
  board: ['2s','3d','4c'],
  players: 2,
  unknownOpponentModel: 'UNIFORM',
  samples: 256,
  seed: 17
};

test('missing financial fields remain unknown and do not become zero', () => {
  const normalized = normalizeGameState(base);
  assert.equal(normalized.valid, true);
  assert.equal(normalized.normalizedInput.potBeforeAction, null);
  assert.equal(normalized.normalizedInput.amountToCall, null);
  assert.equal(normalized.state.knownInformation.pot, false);
  assert.equal(normalized.state.knownInformation.amountToCall, false);
});

test('equity and hand quality work without position, pot, call price or stack', () => {
  const result = decide(base);
  assert.equal(result.status, 'OK');
  assert.equal(result.analysisScope, 'STATISTICS_ONLY');
  assert.equal(result.equity.opponents, 1);
  assert.ok(Number.isFinite(result.equity.equity));
  assert.ok(result.handInsights);
  assert.equal(result.potMath.potBeforeAction, null);
  assert.equal(result.potMath.amountToCall, null);
  assert.equal(result.recommendation.action, null);
  assert.equal(result.continuationAssessment.status, 'UNAVAILABLE');
  assert.deepEqual(result.continuationAssessment.reasonCodes, ['AMOUNT_TO_CALL_REQUIRED']);
  assert.ok(result.ranges.every(range => range.kind === 'UNIFORM'));
});

test('current CALL EV is available without position or effective stack when price inputs are explicit', () => {
  const input = { ...base, potBeforeAction: 100, amountToCall: 25, assumeNoRake: true };
  const result = decide(input);
  assert.equal(result.status, 'OK');
  assert.equal(result.analysisScope, 'CURRENT_PRICE_ONLY');
  assert.deepEqual(result.legalActions, ['FOLD','CALL']);
  const call = result.ev.actions.CALL;
  assert.equal(call.status, 'MODELED');
  assert.ok(Math.abs(call.ev - (result.equity.equity * 125 - 25)) < 1e-10);
  assert.equal(result.potMath.potAfterCall, 125);
  assert.equal(result.potMath.maxRaiseTo, null);
  assert.ok(['FAVORABLE','UNFAVORABLE','UNCERTAIN'].includes(result.continuationAssessment.status));
});

test('missing pot does not block equity and is named as the missing CALL input', () => {
  const result = decide({ ...base, amountToCall: 25, assumeNoRake: true });
  assert.equal(result.status, 'OK');
  assert.ok(Number.isFinite(result.equity.equity));
  assert.equal(result.ev.actions.CALL.status, 'NOT_MODELED');
  assert.deepEqual(result.ev.actions.CALL.missingInputs, ['amountToCall','potBeforeAction']);
  assert.equal(result.continuationAssessment.status, 'UNAVAILABLE');
  assert.deepEqual(result.continuationAssessment.reasonCodes, ['POT_REQUIRED']);
});

test('explicit zero call is a free CHECK, while blank call is not', () => {
  const explicit = decide({ ...base, amountToCall: 0 });
  assert.equal(explicit.status, 'OK');
  assert.equal(explicit.continuationAssessment.status, 'FREE_CHECK');
  assert.equal(explicit.continuationAssessment.action, 'CHECK');

  const blank = decide(base);
  assert.equal(blank.continuationAssessment.status, 'UNAVAILABLE');
  assert.deepEqual(blank.continuationAssessment.reasonCodes, ['AMOUNT_TO_CALL_REQUIRED']);
});
