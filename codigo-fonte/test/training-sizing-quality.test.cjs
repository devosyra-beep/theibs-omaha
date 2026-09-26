'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { decisionQuality, appendEvents } = require('../src/training-store');

function fixture() {
  return { status: 'OK', legalActions: ['FOLD', 'CALL', 'RAISE'], recommendedAction: 'CALL',
    trainingEvaluation: { evaluationId: 'public-state-evaluation', leadership: { status: 'SEPARATED' }, candidates: [
      { optionId: 'FOLD', action: 'FOLD', size: null, ev: 0, confidenceInterval95: [0, 0] },
      { optionId: 'CALL', action: 'CALL', size: null, ev: 1, confidenceInterval95: [.9, 1.1] },
      { optionId: 'RAISE:5', action: 'RAISE', size: 5, ev: 4, confidenceInterval95: [3.9, 4.1] },
      { optionId: 'RAISE:10', action: 'RAISE', size: 10, ev: 2, confidenceInterval95: [1.9, 2.1] }
    ] } };
}

test('training grades the selected sizing rather than matching the action name', () => {
  const result = fixture();
  const inferiorRaise = decisionQuality(result, 'RAISE', 10);
  assert.equal(inferiorRaise.label, 'DIFFERENT_MODELED');
  assert.equal(inferiorRaise.evLoss, 2);
  assert.equal(inferiorRaise.chosenOptionId, 'RAISE:10');
  assert.equal(inferiorRaise.recommendedOptionId, 'RAISE:5');
  assert.equal(inferiorRaise.chosenSize, 10);
  assert.equal(inferiorRaise.recommendedSize, 5);
  assert.equal(inferiorRaise.referenceScope, 'TRAINING_POLICY_ROLLOUT');
  assert.equal(decisionQuality(result, 'RAISE', 5).label, 'MATCHED_MODELED');
  assert.equal(decisionQuality(result, 'CALL').evLoss, 3);
});

test('missing or uncomputed custom sizes never receive a grade', () => {
  const result = fixture();
  for (const size of [undefined, null, NaN, 8]) {
    const quality = decisionQuality(result, 'RAISE', size);
    assert.equal(quality.label, 'UNVERIFIED');
    assert.equal(quality.evLoss, null);
  }
  result.trainingEvaluation.candidates.pop();
  assert.equal(decisionQuality(result, 'RAISE', 10).label, 'UNVERIFIED');
});

test('overlap, invalid bounds and incomplete candidates cannot create misleading EV-loss grades', () => {
  const overlap = fixture();
  overlap.trainingEvaluation.candidates[3].confidenceInterval95 = [1, 5];
  assert.equal(decisionQuality(overlap, 'RAISE', 10).evLoss, null);
  const missing = fixture();
  delete missing.trainingEvaluation.candidates[2].confidenceInterval95;
  assert.equal(decisionQuality(missing, 'CALL').evLoss, null);
  const untrusted = fixture();
  untrusted.trainingEvaluation.leadership.status = 'OVERLAPPING';
  assert.equal(decisionQuality(untrusted, 'CALL').label, 'INCONCLUSIVE_COMPARISON');
  const incomplete = fixture();
  incomplete.trainingEvaluation.candidates[1].ev = NaN;
  assert.equal(decisionQuality(incomplete, 'RAISE', 5).label, 'INCOMPLETE_COMPARISON');
  const duplicate = fixture();
  duplicate.trainingEvaluation.candidates.push({ ...duplicate.trainingEvaluation.candidates[2] });
  assert.equal(decisionQuality(duplicate, 'CALL').label, 'INCOMPLETE_COMPARISON');
});

test('a decision and hand completion are validated together before appending history', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-history-batch-'));
  const file = path.join(dir, 'events.jsonl');
  assert.throws(() => appendEvents([{ type: 'DECISION' }, { type: 'INVALID' }], file));
  assert.equal(fs.existsSync(file), false);
  appendEvents([{ type: 'DECISION' }, { type: 'HAND_COMPLETE' }], file);
  assert.deepEqual(fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line).type), ['DECISION', 'HAND_COMPLETE']);
});
