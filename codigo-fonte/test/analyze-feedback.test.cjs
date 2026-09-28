'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const feedback = require('../public/analyze-feedback');
const hero = ['AE', 'KC', 'QO', 'JP', 'TE'];
const progress = board => feedback.inputProgress({ count: 5, slots: [...hero, ...board] });
test('partial flop identifies the exact missing cards; preflop and full streets stay valid', () => {
  assert.deepEqual([progress([]).ready, progress([]).street], [true, 'PREFLOP']);
  assert.equal(progress(['2E']).remaining, 2); assert.equal(progress(['2E', '3C']).remaining, 1);
  for (const [board, street] of [[['2E', '3C', '4O'], 'FLOP'], [['2E', '3C', '4O', '5P'], 'TURN'], [['2E', '3C', '4O', '5P', '6E'], 'RIVER']]) assert.deepEqual([progress(board).ready, progress(board).street], [true, street]);
  assert.equal(progress(['2E', null, '4O', '5P']).remaining, 1);
  assert.equal(progress(['2E', null, '4O', '5P']).street, 'TURN');
  assert.equal(feedback.inputProgress({count: 5, slots: hero.slice(0, 3)}).remaining, 2);
  assert.equal(feedback.inputProgress({count: 5, slots: hero, manualInvalid: true}).target, 'entry');
});
const data = (ev, ci, extras = {}) => ({ status: 'OK', recommendation: { status: 'INCONCLUSIVE' }, provenance: {rake: {mode: 'ASSUMED_ZERO', amount: 0}}, ev: {actions: {CALL: {legal: true, status: 'MODELED', ev, confidenceInterval95: ci}}, missingLegalActions: [], ...extras} });
test('positive estimate crossing or touching zero stays neutral, distinct from negative EV', () => {
  const positive = feedback.summary({data: data(.1, [-.2, .4])});
  assert.equal(positive.tone, 'neutral'); assert.match(positive.state, /Positive estimate/); assert.equal(positive.target, 'precision');
  assert.equal(feedback.summary({data: data(.1, [0, .4])}).uncertain, true);
  assert.equal(feedback.summary({data: data(-2, [-3, -1])}).tone, 'negative');
  assert.equal(feedback.summary({data: data(2, [1, 3])}).tone, 'positive');
  assert.match(feedback.summary({data: data(0, [0, 0])}).state, /break-even/);
});
test('missing costs and response models lead to relevant settings, not more samples', () => {
  const value = data(2, [1, 3], {actions: {CALL: {legal: true, status: 'UNMODELED', missingInputs: ['rake or assumeNoRake']}}, missingLegalActions: ['CALL', 'RAISE']});
  assert.equal(feedback.summary({data: value}).target, 'costs');
  const partial = data(2, [1, 3], {missingLegalActions: ['RAISE']});
  assert.equal(feedback.summary({data: partial}).target, 'responses');
  assert.match(feedback.summary({data: partial}).detail, /More samples do not/);
  assert.equal(feedback.summary({data: partial, multiway: true}).target, 'calculation');
  assert.match(feedback.summary({data: partial, multiway: true}).detail, /does not provide/);
});
test('partial cards take precedence over stale calculation and presentation never changes it', () => {
  const value = data(2, [1, 3]), before = JSON.stringify(value);
  const result = feedback.summary({data: value, progress: progress(['2E']), busy: true});
  assert.equal(result.state, 'Waiting for cards'); assert.equal(result.target, 'cards'); assert.match(result.detail, /Add 2 board/);
  assert.equal(JSON.stringify(value), before);
  assert.match(feedback.summary({progress: progress(['2E']), auto: false}).detail, /Then select Analyze/);
});
test('cost schedules and explicit zero are visible without inventing a cost assumption', () => {
  assert.equal(feedback.costLabel(data(2, [1, 3])), 'Costs: zero rake assumed.');
  assert.match(feedback.costLabel({provenance: {rake: {mode: 'PERCENT_CAPPED_SCHEDULE', schedule: {rate: .05, cap: 6, noFlopNoDrop: true}}}}), /5.00%, cap 6.00 chips, no flop no drop/);
  assert.match(feedback.costLabel({}), /see the assumptions/);
});
