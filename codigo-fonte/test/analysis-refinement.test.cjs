'use strict';
// HARNESS: execute the production request and Analyze flow with controlled HTTP
// replies. This verifies retention and lifecycle behavior, not engine speed.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createAnalysisPool, errorCode } = require('../src/analysis-worker');
const snapshots = require('../public/analysis-snapshots');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const requestSource = extract('  async function requestJson(', '\n  const postJson');
const analyzeSource = extract('  async function analyze(event)', '\n  async function newAnalysisHand');
const stoppedDisplaySource = extract('  function retainedPreviewDisplay(', '\n  const recommendationText');
const quickCallSource = extract('function quickCallFold(', '\nfunction renderResult(');
const quickActionSource = extract('  function quickAction(', '\n  const feedbackHost');
const codeError = code => ({ ok: false, status: 400, data: { status: 'ERROR', code, reason: 'Controlled refinement failure.' } });
const reply = data => ({ ok: true, status: 200, data });
function preview() {
  return { status: 'OK', analysisStage: 'PROVISIONAL', analysisId: 'preview-id', engineBuild: 'test',
    observedState: { handId: 'hand-1', revisionKey: 'decision-1' },
    equity: { method: 'MONTE_CARLO', equity: .4, samples: 8, confidenceInterval95: [.1, .8] },
    ev: { candidates: [{ optionId: 'CALL', action: 'CALL', status: 'MODELED', ev: 4.22, confidenceInterval95: [-100, 200] }],
      comparisonComplete: true, globalBestSupported: false, decisionPrecision: { status: 'INCONCLUSIVE', leaderConclusive: false } },
    recommendation: { status: 'INCONCLUSIVE', action: null }, multiwayEvaluation: { samples: 8 } };
}
function harness(responses, onRequest = () => {}, { quickSurface = false } = {}) {
  const rendered = [], charts = [], calls = [], nodes = new Map();
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, children: [], replaceChildren() {} }); return nodes.get(selector); };
  const context = { AbortController, structuredClone, performance, JSON, Promise,
    activeView: 'analyze', inputRevision: 1, inputChangedAt: performance.now(), analysisBusy: false, analysisQueued: false,
    analysisController: null, lastAnalysis: null, snapshots: [], metrics: { analyses: [] }, snapshotModel: snapshots,
    multiway: { enabled: true, handId: 'hand-1' }, multiwayState: { handId: 'hand-1', revisionKey: 'decision-1' },
    analyzeButton: node('#analyze-button'), emptyState: node('#empty'), result: node('#result'), $: node,
    cards: { announce() {}, isManualInvalid: () => false, state: { count: 4, slots: ['As','Ah','Kd','Qc'] } },
    document: { dispatchEvent() {}, body: { dataset: {} } }, CustomEvent: class {}, requestAnimationFrame: callback => callback(),
    renderResult: data => rendered.push(structuredClone(data)), quickAction() {}, renderMultiway() {},
    renderCharts: snapshot => charts.push(structuredClone(snapshot)), renderEngineDetails() {}, renderStreetCards() {}, scheduleSave() {}, scheduleAnalysis() {},
    buildAnalysisPayload: () => { if (context.invalidInput) throw Error(context.invalidInput); return structuredClone(context.payload); },
    value: id => ({ potBeforeAction: '3.5', amountToCall: '1', players: '3' })[id] || '',
    money: value => Number(value).toFixed(2), esc: value => String(value), renderHandScope() {},
    feedback: require('../public/analyze-feedback'),
    window: { theibsAuth: { ensureSession: async () => {} }, theibsVoiceSessionContext: () => context.session,
      TheibsMultiwaySolverUI: { evaluate: async () => {} }, TheibsContinuationView: require('../public/continuation-view') },
    session: { owner: 'owner-1', expired: false } };
  context.payload = { street: 'PREFLOP', multiway: structuredClone(context.multiway),
    multiwayEvaluation: { assumeNoRake: true, feeBasis: 'BEFORE_FEES', ranges: [] } };
  context.fetch = async (url, options) => {
    const payload = JSON.parse(options.body); calls.push(payload.analysisPhase);
    onRequest(context, payload, calls.length);
    const response = responses[calls.length - 1];
    if (response instanceof Error) throw response;
    return { ok: response.ok, status: response.status, json: async () => structuredClone(response.data) };
  };
  vm.createContext(context);
  vm.runInContext(`${stoppedDisplaySource}\n${requestSource}\n${analyzeSource}${quickSurface ? '\n'+quickCallSource+'\n'+quickActionSource : ''}`, context, { filename: 'app-analysis-flow.js' });
  return { context, calls, rendered, charts, nodes, run: () => context.analyze({ type: 'submit', preventDefault() {} }) };
}

test('FINAL time exhaustion retains only this invocation\'s valid preview and its exact uncertainty', async () => {
  for (const code of ['TIME_BUDGET', 'WORKER_TIMEOUT']) {
    const original = preview(), h = harness([reply(original), codeError(code)]);
    await h.run();
    const kept = h.context.lastAnalysis.data;
    assert.deepEqual(h.calls, ['PREVIEW', 'FINAL']);
    assert.equal(kept.status, 'OK'); assert.equal(kept.analysisStage, 'PROVISIONAL');
    assert.equal(kept.analysisId, original.analysisId);
    assert.deepEqual(kept.ev, original.ev); assert.deepEqual(kept.equity, original.equity);
    assert.deepEqual(kept.recommendation, original.recommendation);
    assert.equal(kept.refinement.status, 'TIME_BUDGET'); assert.match(kept.refinement.reason, /preliminary estimates remain available/);
    assert.equal(h.charts.at(-1).analysisStage, 'PROVISIONAL');
    assert.equal(h.context.snapshots.length, 0, 'a retained preview is not archived as a final decision');
    assert.equal(h.context.analysisBusy, false); assert.equal(h.context.analyzeButton.disabled, false);
  }
});

test('explicit computation failures preserve preliminary data without converting failure to a timeout', async () => {
  for (const code of ['WORKER_FAILED', 'ENGINE_BUSY']) {
    const h = harness([reply(preview()), codeError(code)]); await h.run();
    assert.equal(h.context.lastAnalysis.data.refinement.status, 'FAILED');
    assert.equal(h.context.lastAnalysis.data.analysisStage, 'PROVISIONAL');
  }
});

test('retained previews stop every auxiliary running message whether feedback or a CALL assessment supplied the view', async () => {
  for (const assessment of [null, { status: 'PROVISIONAL' }]) {
    const original = { ...preview(), continuationAssessment: assessment };
    const h = harness([reply(original), codeError('TIME_BUDGET')], () => {}, { quickSurface: true });
    await h.run();
    assert.equal(h.context.lastAnalysis.data.analysisStage, 'PROVISIONAL');
    assert.equal(h.nodes.get('#analysis-next-title').textContent, 'Preliminary estimates retained');
    assert.match(h.nodes.get('#analysis-next-detail').textContent, /time budget/);
    assert.match(h.nodes.get('#analysis-next-detail').textContent, /does not supply a recommended action/);
    assert.equal(h.nodes.get('#analysis-next-action').hidden, true);
    for (const selector of ['#ev-state', '#analysis-next-title', '#analysis-next-detail'])
      assert.doesNotMatch(h.nodes.get(selector).textContent, /calculating|awaiting|still running|refining/i);
    const callView = h.context.quickCallFold(h.context.lastAnalysis.data, { ready: true });
    assert.equal(callView.label, '—'); assert.doesNotMatch(callView.detail, /calculating|still running/i);
  }
});

test('a successful FINAL replaces the preview and carries no stopped-refinement metadata', async () => {
  const final = { ...preview(), analysisId: 'final-id', analysisStage: 'FINAL' };
  const h = harness([reply(preview()), reply(final)]); await h.run();
  assert.equal(h.context.lastAnalysis.data.analysisId, 'final-id');
  assert.equal(h.context.lastAnalysis.data.refinement, undefined); assert.equal(h.context.snapshots.length, 1);
});

test('an initial computation failure cannot recover an estimate from a previous invocation', async () => {
  const h = harness([codeError('TIME_BUDGET')]); h.context.lastAnalysis = { data: preview(), input: h.context.payload };
  await h.run(); assert.deepEqual(h.calls, ['PREVIEW']);
  assert.equal(h.context.lastAnalysis.data.status, 'ERROR'); assert.equal(h.context.lastAnalysis.data.refinement, undefined);
});

test('auth, invalid-model, uncoded and network failures do not retain a preview', async () => {
  for (const response of [codeError('AUTH_REQUIRED'), codeError('INVALID_RANGE'), codeError('UNKNOWN_PRIVATE_CODE'),
    { ...codeError('TIME_BUDGET'), status: 401 }, { ...codeError('WORKER_TIMEOUT'), status: 403 }, { ...codeError('ENGINE_BUSY'), status: 409 },
    { ok: false, status: 400, data: { reason: 'Invalid range.' } }, new TypeError('Network unavailable.')]) {
    const h = harness([reply(preview()), response]); await h.run();
    assert.equal(h.context.lastAnalysis.data.status, 'ERROR'); assert.equal(h.context.lastAnalysis.data.refinement, undefined);
  }
});

test('revision, hand, session, current inputs, version errors and cancellation cannot revive a preview', async () => {
  const mutations = [
    c => { c.inputRevision++; c.lastAnalysis = null; },
    c => { c.activeView = 'train'; c.lastAnalysis = null; },
    c => { c.multiway.handId = 'hand-2'; c.lastAnalysis = null; },
    c => { c.multiwayState.revisionKey = 'decision-2'; c.lastAnalysis = null; },
    c => { c.session.owner = 'owner-2'; c.lastAnalysis = null; },
    c => { c.session.expired = true; c.lastAnalysis = null; },
    c => { c.payload.multiwayEvaluation.ranges = [{ seatId: 1, range: { kind: 'UNIFORM' } }]; },
    c => { c.payload.multiwayEvaluation.feeBasis = 'DECLARED_FEES'; },
    c => { c.invalidInput = 'Version mismatch: reload the page.'; },
    c => { c.analysisController.abort(); c.lastAnalysis = null; }
  ];
  for (const mutate of mutations) {
    const h = harness([reply(preview()), codeError('TIME_BUDGET')], (context, payload, count) => { if (count === 2) mutate(context); });
    await h.run();
    assert.notEqual(h.context.lastAnalysis?.data?.status, 'OK');
    assert.equal(h.context.lastAnalysis?.data?.refinement, undefined);
  }
});

test('a misbound preview cannot be retained after a later timeout', async () => {
  for (const changed of [{ handId: 'another-hand', revisionKey: 'decision-1' }, { handId: 'hand-1', revisionKey: 'another-decision' }]) {
    const h = harness([reply({ ...preview(), observedState: changed }), codeError('TIME_BUDGET')]); await h.run();
    assert.equal(h.context.lastAnalysis.data.status, 'ERROR');
  }
});

test('worker computation codes are allowlisted and the watchdog keeps its own typed timeout', async t => {
  for (const code of ['TIME_BUDGET', 'WORKER_TIMEOUT', 'WORKER_FAILED', 'ENGINE_BUSY']) assert.equal(errorCode(code), code);
  for (const code of ['AUTH_REQUIRED', 'PRIVATE_TOKEN', null, {}, '__proto__']) assert.equal(errorCode(code), null);
  const pool = createAnalysisPool({ workerFile: path.join(__dirname, 'fixtures/pool-worker.cjs'), adaptiveTimeoutMs: 100 });
  t.after(() => pool.close());
  await assert.rejects(pool({ multiwayEvaluation: {}, delay: 1000 }), error => error.code === 'WORKER_TIMEOUT');
  assert.equal(pool.stats().workers, 0);
});

test('the production worker preserves TIME_BUDGET through its error message but drops arbitrary codes', async t => {
  const pool = createAnalysisPool({ workerFile: path.join(__dirname, 'fixtures/refinement-worker.cjs') });
  t.after(() => pool.close());
  await assert.rejects(pool({ controlledError: 'TIME_BUDGET' }), error => error.code === 'TIME_BUDGET' && /Controlled worker/.test(error.message));
  await assert.rejects(pool({ controlledError: 'PRIVATE_PROVIDER_VALUE' }), error => error.code === undefined && /Controlled worker/.test(error.message));
  assert.equal(pool.stats().workers, 1, 'a computation error leaves the worker reusable');
});
