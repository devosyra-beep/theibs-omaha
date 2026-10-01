'use strict';
// HTTP CONTRACT HARNESS. Real loopback server and canonical observed state;
// controlled pool replies and synthetic authentication, no engine benchmark,
// external provider, real account, workspace mutation or retained private data.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-multiway-timeout-api-'));
Object.assign(process.env, { THEIBS_AUTH_REQUIRED: 'true', THEIBS_LLM_PROVIDER: 'none', THEIBS_MULTIWAY_LLM_PROVIDER: 'none',
  SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  THEIBS_USER_DATA_ROOT: path.join(temp, 'users'), THEIBS_DATA_PATH: path.join(temp, 'events.jsonl'),
  THEIBS_WORKSPACE_PATH: path.join(temp, 'workspace.json'), THEIBS_LLM_CONFIG_PATH: path.join(temp, 'llm.json'),
  THEIBS_SOLVER_CACHE_PATH: path.join(temp, 'solver-cache') });
const auth = require('../src/supabase-service'), actualAuthenticate = auth.authenticateRequest, actualAccess = auth.accessFor;
const authFetch = async (url, options) => {
  const token = new Headers(options.headers).get('Authorization');
  if (!['Bearer fixture-owner-a', 'Bearer fixture-owner-b'].includes(token)) return new Response('{}', { status: 401 });
  return Response.json({ id: token.endsWith('-a') ? 'fixture-owner-a' : 'fixture-owner-b', email: 'fixture@example.invalid' });
};
auth.authenticateRequest = request => actualAuthenticate(request, process.env, authFetch);
auth.accessFor = async () => ({ allowed: true, source: 'ISOLATED_TEST_ACCESS_STUB' });
const poolFile = require.resolve('../src/analysis-worker'), previousPoolModule = require.cache[poolFile];
const calls = []; let nextReply = 'COMPLETE';
async function controlledPool(input) {
  const raw = input.multiwayEvaluation; assert.ok(raw, 'This gate exercises only contextual analysis.');
  calls.push(structuredClone(raw));
  const samples = nextReply === 'ZERO_TIME_BUDGET' ? 0 : nextReply === 'PARTIAL_TIME_BUDGET' ? 2 : raw.samples;
  const stopReason = nextReply === 'COMPLETE' ? 'SAMPLE_LIMIT' : 'TIME_BUDGET';
  const stage = samples === 0 || raw.samples === 32 ? 'PROVISIONAL' : 'FINAL';
  const fold = { action: 'FOLD', optionId: 'FOLD', status: 'MODELED', ev: 0, evBB: 0, samples: 0, method: 'DECISION_REFERENCE' };
  const call = { action: 'CALL', optionId: 'CALL', status: samples ? 'MODELED' : 'NOT_MODELED', ev: samples ? 1.2 : null,
    evBB: samples ? .6 : null, samples, confidenceInterval95: samples ? [-2, 3] : null };
  return { status: 'OK', analysisStage: stage, observedState: { handId: raw.handId, revisionKey: raw.revisionKey },
    recommendation: { status: stage === 'PROVISIONAL' ? 'PROVISIONAL' : 'INCONCLUSIVE', action: null },
    equity: { method: 'MONTE_CARLO', equity: samples ? .5 : null, samples, confidenceInterval95: samples ? [0, 1] : null, stopReason },
    ev: { actions: { FOLD: fold, CALL: call }, candidates: [fold, call], globalBestSupported: false,
      comparisonComplete: samples > 0, decisionPrecision: { status: 'INCONCLUSIVE', leaderConclusive: false } },
    multiwayEvaluation: { samples, requestedSamples: raw.samples, stopReason, partial: stopReason === 'TIME_BUDGET',
      revisionKey: raw.revisionKey, handId: raw.handId },
    ...(stopReason === 'TIME_BUDGET' ? { refinement: { status: 'TIME_BUDGET', reasonEnglish: 'Controlled finite-budget stop.' } } : {}),
    performance: { requestElapsedMs: 1, workerExecutionMs: 1 }, analysisId: 'controlled-' + calls.length };
}
controlledPool.errorCode = code => ['TIME_BUDGET', 'WORKER_TIMEOUT', 'WORKER_FAILED', 'ENGINE_BUSY'].includes(code) ? code : null;
controlledPool.close = async () => {};
require.cache[poolFile] = { id: poolFile, filename: poolFile, loaded: true, exports: controlledPool };
const { server } = require('../server'), mw = require('../src/multiway-session');
const config = { variant: 'PLO5_HIGH', playerCount: 3, heroPosition: 'BTN', startingStack: 100,
  smallBlind: 1, bigBlind: 2, heroCards: ['As', 'Ks', 'Qh', 'Jh', 'Td'] };
let origin;
test.before(async () => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + server.address().port; });
test.after(async () => {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  auth.authenticateRequest = actualAuthenticate; auth.accessFor = actualAccess;
  if (previousPoolModule) require.cache[poolFile] = previousPoolModule; else delete require.cache[poolFile];
});
function hand() { return mw.start(config); }
async function post(record, phase = 'FINAL', token = 'fixture-owner-a', model = {}) {
  const response = await fetch(origin + '/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ multiway: record, multiwayEvaluation: { assumeNoRake: true, ...model }, analysisPhase: phase }) });
  return { httpStatus: response.status, ...await response.json() };
}
test('cold zero-world FINAL stays provisional, ungraded and uncached; a warm retry performs fresh work', async () => {
  const current = hand(), before = JSON.stringify(current.multiway), begin = calls.length;
  nextReply = 'ZERO_TIME_BUDGET';
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await post(current.multiway);
    assert.equal(result.httpStatus, 200); assert.equal(result.status, 'OK'); assert.equal(result.analysisStage, 'PROVISIONAL');
    assert.equal(result.recommendation.action, null); assert.notEqual(result.recommendation.status, 'CONDITIONAL');
    assert.equal(result.ev.actions.FOLD.ev, 0); assert.equal(result.ev.actions.CALL.ev, null);
    assert.equal(result.equity.equity, null); assert.equal(result.equity.confidenceInterval95, null);
    assert.equal(result.performance.cacheHit, false); assert.equal(result.observedState.revisionKey, current.state.revisionKey);
  }
  assert.equal(calls.length, begin + 2);
  nextReply = 'COMPLETE'; const recovered = await post(current.multiway);
  assert.equal(recovered.analysisStage, 'FINAL'); assert.equal(recovered.ev.actions.CALL.ev, 1.2); assert.equal(recovered.performance.cacheHit, false);
  assert.equal(calls.length, begin + 3); assert.equal(JSON.stringify(current.multiway), before);
});
test('partial timeout FINAL retains complete-world values and does not populate the complete-result cache', async () => {
  const current = hand(), begin = calls.length; nextReply = 'PARTIAL_TIME_BUDGET';
  const first = await post(current.multiway), second = await post(current.multiway);
  assert.equal(first.analysisStage, 'FINAL'); assert.equal(first.multiwayEvaluation.samples, 2);
  assert.equal(first.refinement.status, 'TIME_BUDGET'); assert.equal(first.ev.actions.CALL.ev, 1.2);
  assert.equal(first.recommendation.action, null); assert.equal(second.performance.cacheHit, false); assert.equal(calls.length, begin + 2);
});
test('PREVIEW and FINAL use canonical 350/1800 budgets and 32/128 samples, with distinct cache entries', async () => {
  const current = hand(), begin = calls.length; nextReply = 'COMPLETE';
  const preview = await post(current.multiway, 'PREVIEW', 'fixture-owner-a', { samples: 999999, timeBudgetMs: 999999, revisionKey: 'forged-revision' });
  assert.equal(preview.analysisStage, 'PROVISIONAL'); assert.equal(preview.recommendation.action, null);
  const final = await post(current.multiway); assert.equal(final.analysisStage, 'FINAL'); assert.equal(final.performance.cacheHit, false);
  assert.equal(calls[begin].samples, 32); assert.equal(calls[begin].timeBudgetMs, 350);
  assert.equal(calls[begin + 1].samples, 128); assert.equal(calls[begin + 1].timeBudgetMs, 1800);
  for (const raw of calls.slice(begin)) { assert.equal(raw.revisionKey, current.state.revisionKey); assert.equal(raw.handId, current.multiway.handId); }
  assert.equal((await post(current.multiway, 'PREVIEW')).performance.cacheHit, true);
  assert.equal((await post(current.multiway)).performance.cacheHit, true); assert.equal(calls.length, begin + 2);
});
test('complete cache entries cannot cross authenticated owner, hand/revision or current model', async () => {
  const current = hand(), begin = calls.length; nextReply = 'COMPLETE';
  assert.equal((await post(current.multiway)).performance.cacheHit, false);
  assert.equal((await post(current.multiway)).performance.cacheHit, true);
  assert.equal((await post(current.multiway, 'FINAL', 'fixture-owner-b')).performance.cacheHit, false);
  assert.equal((await post(current.multiway, 'FINAL', 'fixture-owner-b')).performance.cacheHit, true);
  const revised = structuredClone(current.multiway); revised.editEpoch++;
  const result = await post(revised); assert.equal(result.performance.cacheHit, false);
  assert.notEqual(result.observedState.revisionKey, current.state.revisionKey); assert.equal(result.observedState.revisionKey, mw.envelope(revised).state.revisionKey);
  const nextHand = structuredClone(current.multiway); nextHand.handId = '00000000-0000-4000-8000-000000008881';
  assert.equal((await post(nextHand)).performance.cacheHit, false);
  assert.equal((await post(current.multiway, 'FINAL', 'fixture-owner-a', { assumeNoRake: false, rake: 1 })).performance.cacheHit, false);
  assert.equal(calls.length, begin + 5);
});
test('unauthenticated requests never reach the controlled worker', async () => {
  const begin = calls.length, rejected = await post(hand().multiway, 'FINAL', null);
  assert.equal(rejected.httpStatus, 401); assert.equal(calls.length, begin);
});
