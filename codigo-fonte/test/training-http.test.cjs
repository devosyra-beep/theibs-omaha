'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-training-http-'));
process.env.THEIBS_DATA_PATH = path.join(temp, 'events.jsonl');
process.env.THEIBS_WORKSPACE_PATH = path.join(temp, 'workspace.json');
process.env.THEIBS_LLM_CONFIG_PATH = path.join(temp, 'llm.json');
process.env.THEIBS_LLM_PROVIDER = 'none';
const { server } = require('../server');
const pool = require('../src/analysis-worker');
let origin;

test.before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await pool.close(); await new Promise(resolve => server.close(resolve)); });

async function post(route, body) {
  const response = await fetch(origin + '/api/training/' + route, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  return { httpStatus: response.status, ...await response.json() };
}

test('doubt, chosen custom raise, feedback and history preserve the same numerical evaluation', async () => {
  const start = await post('start', { variant: 'PLO6_HIGH', seed: 42 });
  assert.equal(start.httpStatus, 200);
  const session = start.session;
  assert.equal(session.revision, 0);
  assert.equal(session.opponentCards, undefined);
  assert.equal(session.boardAll, undefined);
  assert.ok(session.sizeCandidates.every(item => Number.isFinite(item.size) && item.ev === undefined));
  const original = pool.training;
  let forwarded;
  pool.training = (input, response) => { forwarded = input; return original(input, response); };
  let doubt;
  try {
    doubt = await post('doubt', { sessionId: session.id, revision: session.revision, size: 4.25, question: 'Por que aumentar?' });
  } finally { pool.training = original; }
  assert.equal(doubt.httpStatus, 200, doubt.reason);
  assert.deepEqual(Object.keys(forwarded).sort(), ['chosenSize', 'config', 'events', 'opponentStyle', 'samples']);
  assert.equal(forwarded.seed, undefined);
  assert.equal(forwarded.villainCards, undefined);
  assert.equal(forwarded.boardAll, undefined);
  const evaluation = doubt.context.trainingEvaluation;
  assert.ok(evaluation.candidates.some(item => item.optionId === 'RAISE:4.25'));
  for (const action of session.legalActions) assert.equal(doubt.context.ev[action].status, 'MODELED');
  const acted = await post('act', { sessionId: session.id, revision: session.revision, action: 'RAISE', size: 4.25 });
  assert.equal(acted.httpStatus, 200, acted.reason);
  const feedback = acted.feedback;
  assert.equal(feedback.chosenSize, 4.25);
  assert.equal(feedback.chosenOptionId, 'RAISE:4.25');
  assert.equal(feedback.quality.chosenEV, evaluation.candidates.find(item => item.optionId === 'RAISE:4.25').ev);
  assert.equal(feedback.context.trainingEvaluation.evaluationId, evaluation.evaluationId);
  assert.deepEqual(feedback.context.trainingEvaluation.candidates, evaluation.candidates);
  assert.equal(feedback.context.evaluationPerformance.cacheHit, true);
  assert.equal(feedback.context.evaluationPerformance.monteCarloSamples, null);
  assert.equal(feedback.context.evaluationPerformance.simulationsPerSecond, null);
  assert.ok(feedback.summary.headline && feedback.summary.points.length <= 3);
  assert.deepEqual(feedback.context.board, []);
  const review = await post('review', { sessionId: session.id });
  assert.equal(review.decisions.length, 1);
  assert.deepEqual(review.decisions[0].context, feedback.context);
  assert.deepEqual(review.decisions[0].qualityDetails, feedback.quality);
  assert.equal(review.decisions[0].chosenSize, 4.25);
  const history = await (await fetch(origin + '/api/training/history')).json();
  assert.equal(history.recent[0].trainingEvaluation.evaluationId, evaluation.evaluationId);
  assert.equal(history.recent[0].chosenSize, 4.25);
  const stale = await post('act', { sessionId: session.id, revision: session.revision, action: 'CALL' });
  assert.equal(stale.httpStatus, 409);
  assert.equal((await post('review', { sessionId: session.id })).decisions.length, 1);
});

test('invalid sizes and actions do not evaluate, change cards or append history', async () => {
  const { session } = await post('start', { variant: 'PLO5_HIGH', seed: 33 });
  const original = pool.training;
  let evaluations = 0;
  pool.training = () => { evaluations++; throw Error('Unexpected calculation'); };
  try {
    for (const size of [99999, 4.001, '', -1]) {
      const doubt = await post('doubt', { sessionId: session.id, size });
      assert.equal(doubt.httpStatus, 400, String(size));
      assert.equal((await post('act', { sessionId: session.id, action: 'RAISE', size })).httpStatus, 400);
    }
    assert.equal((await post('act', { sessionId: session.id, action: 'CHECK' })).httpStatus, 400);
    assert.equal(evaluations, 0);
    const review = await post('review', { sessionId: session.id });
    assert.deepEqual(review.session, session);
    assert.equal(review.decisions.length, 0);
  } finally { pool.training = original; }
});

test('pending evaluation leaves HTTP responsive and rejects overlapping state mutations', async () => {
  const { session } = await post('start', { seed: 81 });
  const original = pool.training;
  let notifyStarted, release;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  pool.training = async () => { notifyStarted(); await gate; throw Error('Controlled unavailable calculation'); };
  const pending = post('act', { sessionId: session.id, revision: session.revision, action: 'CALL', size: session.minSize });
  try {
    await started;
    const health = await fetch(origin + '/api/status');
    assert.equal(health.status, 200);
    assert.equal((await post('act', { sessionId: session.id, action: 'FOLD' })).httpStatus, 409);
    assert.deepEqual((await post('review', { sessionId: session.id })).session, session);
  } finally { release(); pool.training = original; }
  assert.equal((await pending).httpStatus, 400);
  const review = await post('review', { sessionId: session.id });
  assert.deepEqual(review.session, session);
  assert.equal(review.decisions.length, 0);
});

test('challenge reveals legal sizes but no numerical recommendation before the choice', async () => {
  const { session } = await post('start', { mode: 'CHALLENGE', seed: 18 });
  assert.ok(session.sizeCandidates.length > 0);
  assert.equal(session.trainingEvaluation, undefined);
  assert.equal(session.recommendedAction, undefined);
  assert.ok(session.sizeCandidates.every(item => item.ev === undefined));
  const locked = await post('doubt', { sessionId: session.id, size: session.minSize, question: 'Qual o EV?' });
  assert.equal(locked.status, 'LOCKED');
  assert.equal(locked.context, undefined);
});
