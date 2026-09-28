'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, outcomeTimeline } = require('../src/training-store');

function decision(overrides = {}) {
  return { type: 'DECISION', sessionId: 's1', source: 'TRAINING_POLICY_ROLLOUT', engineBuild: 'test-1',
    opponentPolicyVersion: 'test-policy', quality: 'DIFFERENT_MODELED', evLoss: 2,
    context: { variant: 'PLO4_HIGH', street: 'FLOP', comparisonComplete: true, leadership: { status: 'SEPARATED' },
      bigBlind: 2, startingStack: 100, unit: 'chips', costModel: { mode: 'EXPLICIT_ZERO', amount: 0 } }, ...overrides };
}

test('single-cohort EV difference exposes its denominator and units', () => {
  const good = decision(), inconclusive = decision({ quality: 'INCONCLUSIVE_COMPARISON', evLoss: null });
  const summary = summarize([good, inconclusive]);
  assert.equal(summary.averageEvLoss, 2);
  assert.equal(summary.averageEvLossBigBlinds, 1);
  assert.equal(summary.averageEvLossUnit, 'chips');
  assert.equal(summary.averageEvLossDenominator, 1);
  assert.equal(summary.decisions, 2);
  assert.equal(summary.ungradedDecisions, 1);
  assert.equal(summary.evLossCohorts[0].denominatorScope, 'COMPLETE_SEPARATED_COMPARISONS_ONLY');
});

test('variants, versions, costs and stakes are never silently averaged together', () => {
  const original = decision();
  for (const change of [{ engineBuild: 'test-2' }, { context: { ...original.context, variant: 'PLO5_HIGH' } },
    { context: { ...original.context, bigBlind: 4 } }, { context: { ...original.context, costModel: { mode: 'FIXED_INPUT', amount: 1 } } }]) {
    const summary = summarize([original, decision(change)]);
    assert.equal(summary.averageEvLoss, null);
    assert.equal(summary.averageEvLossStatus, 'MIXED_COHORTS');
    assert.equal(summary.evLossCohorts.length, 2);
    assert.equal(summary.modeledDecisions, 2);
    assert.equal(summary.evLossCohorts.reduce((n, cohort) => n + cohort.denominator, 0), 2);
  }
});

test('known zero and missing, invalid or string results remain distinct', () => {
  const events = [decision(), ...[0, undefined, null, NaN, '0', -2].map(heroNet => ({ type: 'HAND_COMPLETE', sessionId: 's1', outcome: { heroNet } }))];
  const timeline = outcomeTimeline(events);
  assert.deepEqual(timeline.map(item => item.net), [0, null, null, null, null, -2]);
  assert.deepEqual(timeline.map(item => item.netBigBlinds), [0, null, null, null, null, -1]);
  assert.equal(timeline[0].resultStatus, 'KNOWN');
  assert.equal(timeline[1].resultStatus, 'UNKNOWN');
  assert.equal(timeline[0].cohort.variant, 'PLO4_HIGH');
  const summary = summarize(events);
  assert.equal(summary.knownNetResults, 2); assert.equal(summary.unknownNetResults, 4);
});

test('empty and legacy histories preserve unknown metadata and do not invent learning scores', () => {
  const empty = summarize([]);
  assert.equal(empty.averageEvLoss, null); assert.equal(empty.averageEvLossDenominator, 0);
  const old = decision(); delete old.context.bigBlind;
  const summary = summarize([old]);
  assert.equal(summary.averageEvLossBigBlinds, null);
  assert.equal(summary.evLossCohorts[0].metadataComplete, false);
  assert.equal(summary.automaticTraining, false);
});
