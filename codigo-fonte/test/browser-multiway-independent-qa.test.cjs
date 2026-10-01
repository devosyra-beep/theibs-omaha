'use strict';

// Independent transport and fixed-work parity gate. VM execution tests the
// shipped Worker graph; physical browser responsiveness is a separate gate.
// Client race cases use controlled messages/timers, not a latency benchmark.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { generate, normalize } = require('../scripts/build-browser-multiway.cjs');
const request = require('../src/multiway-compute-request');
const continuation = require('../src/continuation-strategy');
const session = require('../src/multiway-session');
const { contextFor, contextKey } = require('../src/player-profiles');
const root = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/browser-multiway-manifest.json'), 'utf8'));
const workerSource = fs.readFileSync(path.join(root, 'public/browser-multiway-worker.js'), 'utf8');
const clientSource = fs.readFileSync(path.join(root, 'public/browser-multiway-client.js'), 'utf8');
const act = (actor, action, to) => ({ type: 'ACT', actor, action, ...(to === undefined ? {} : { to }) });

function payload({ count = 4, tie = false, weighted = false, rake = 0, missingRake = false, threeSeats = false } = {}) {
  const board = tie ? ['Qs', 'Jh', 'Tc', '9d', '2h'] : ['2s', '3h', '4d', '8c', '9s'];
  const hero = (tie ? ['As', 'Kd', '4c', '5c', '6h', '7h'] : ['As', 'Ah', 'Kd', 'Qc', 'Jd', 'Tc']).slice(0, count);
  const config = { variant: `PLO${count}_HIGH`, playerCount: threeSeats ? 3 : 2, heroPosition: threeSeats ? 'BB' : 'SB',
    startingStack: 20, smallBlind: .5, bigBlind: 1, heroCards: hero,
    players: Array.from({ length: threeSeats ? 3 : 2 }, (_, index) => ({ playerId: `qa-seat-${index}`, name: `Seat ${index + 1}` })) };
  const events = threeSeats ? [act(2, 'CALL'), act(0, 'CALL'), act(1, 'CHECK')] : [act(0, 'CALL'), act(1, 'CHECK')];
  for (const length of [3, 4, 5]) {
    events.push({ type: 'BOARD', cards: board.slice(0, length) });
    if (length < 5) events.push(...(threeSeats ? [act(0, 'CHECK'), act(1, 'CHECK'), act(2, 'CHECK')] : [act(1, 'CHECK'), act(0, 'CHECK')]));
  }
  events.push(act(threeSeats ? 0 : 1, 'BET', 1));
  const multiway = { schemaVersion: 1, enabled: true, handId: '90000000-0000-4000-8000-000000000001', editEpoch: 0, config, events };
  const raw = { ...(missingRake ? {} : rake ? { rake } : { assumeNoRake: true }) };
  if (weighted) {
    const opponent = (tie ? ['Ah', 'Kc', '6c', '7c', '8d', '8h'] : ['Ks', 'Kh', 'Qd', 'Jh', 'Ts', 'Th']).slice(0, count);
    const other = ['2c', '2h', '3d', '4c', '5d', '6h'].slice(0, count);
    raw.ranges = [{ seatId: 1, range: { hands: tie ? [opponent] : [opponent, other], weights: tie ? [1] : [1, 3], source: 'INDEPENDENT_QA_DECLARED_RANGE', version: '1' } }];
  }
  const observed = session.envelope(multiway);
  raw.revisionKey = observed.state.revisionKey;
  const key = contextKey(contextFor(observed.state));
  raw.profileSnapshot = { schemaVersion: 1, source: 'PRE_HAND_OBSERVATIONS', handId: multiway.handId,
    players: { 'qa-seat-1': { playerId: 'qa-seat-1', contexts: { [key]: { counts: { FOLD: 2, CALL: 4, RAISE: 1 } } } } } };
  return { variant: config.variant, street: 'RIVER', heroCards: hero, board, samples: 128, multiway, multiwayEvaluation: raw };
}

function loadWorker({ now = () => 0, transport = false } = {}) {
  const messages = [], listeners = {};
  const context = vm.createContext({ TextEncoder, TextDecoder, structuredClone, crypto: crypto.webcrypto,
    performance: { now }, SharedArrayBuffer: undefined, Atomics: undefined,
    ...(transport ? { postMessage: value => messages.push(plain(value)), addEventListener: (type, listener) => { listeners[type] = listener; } } : {}) });
  vm.runInContext(workerSource, context, { timeout: 10000 });
  return { api: context.TheibsBrowserMultiway, messages, dispatch: value => listeners.message({ data: value }) };
}

// Only observations are removed. Seeds, hashes, budgets, sampled values,
// confidence bounds, precision and source qualifications are compared exactly.
function mathematics(value) {
  const result = plain(value);
  delete result.performance;
  if (result.multiwayEvaluation) delete result.multiwayEvaluation.elapsedMs;
  if (result.provenance) delete result.provenance.createdAt;
  return result;
}
function nodeFixed(input, now = () => 0) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now } });
  try { return continuation.evaluateContinuation(input); }
  finally { Object.defineProperty(globalThis, 'performance', descriptor); }
}
function stage(result, phase) { return { ...result, analysisStage: phase === 'PREVIEW' || result.multiwayEvaluation.samples === 0 ? 'PROVISIONAL' : 'FINAL' }; }
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 2)); };
async function until(predicate) { for (let i = 0; i < 40 && !predicate(); i++) await flush(); }
function track(promise) {
  const state = { status: 'PENDING', value: null, error: null };
  promise.then(value => { state.status = 'FULFILLED'; state.value = value; }, error => { state.status = 'REJECTED'; state.error = error; });
  return state;
}

function clientHarness({ stalledManifestBody = false } = {}) {
  const workers = [], timers = new Map(); let tick = 0, nextTimer = 0, manifestRequests = 0;
  class ControlledWorker {
    constructor(url) { this.url = url; this.messages = []; this.terminated = false; workers.push(this); }
    postMessage(value) { this.messages.push(structuredClone(value)); }
    terminate() { this.terminated = true; }
    emit(value) { this.onmessage?.({ data: { buildFingerprint: manifest.buildFingerprint, ...value } }); }
    ready() { this.readySent = true; this.emit({ type: 'ready', schemaVersion: 1 }); }
    done(result, overrides = {}) {
      const job = this.messages.at(-1); assert.ok(job, 'A calculation must be posted before done.');
      const requestFingerprint = crypto.createHash('sha256').update(JSON.stringify(job.payload)).digest('hex');
      this.emit({ type: 'done', jobId: job.jobId, generation: job.generation, requestFingerprint, result, ...overrides });
    }
  }
  const context = vm.createContext({ TextEncoder, structuredClone, AbortController, crypto: crypto.webcrypto, performance: { now: () => tick }, Date,
    setTimeout(callback, milliseconds) { const id = ++nextTimer; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout(id) { timers.delete(id); } });
  vm.runInContext(clientSource, context);
  const client = context.TheibsBrowserMultiwayClient.create({ Worker: ControlledWorker,
    fetch: async () => { manifestRequests++; return { ok: true, json: () => stalledManifestBody ? new Promise(() => {}) : Promise.resolve(plain(manifest)) }; }, now: () => tick, clock: () => tick });
  function result(source, { phase = 'FINAL', samples = 128, timeout = false } = {}) {
    const observed = session.envelope(source.multiway);
    return { status: 'OK', engineBuild: manifest.engineBuild, analysisStage: phase === 'PREVIEW' || samples === 0 ? 'PROVISIONAL' : 'FINAL',
      observedState: { handId: observed.multiway.handId, revisionKey: observed.state.revisionKey },
      multiwayEvaluation: { handId: observed.multiway.handId, revisionKey: observed.state.revisionKey, samples,
        effectiveSamples: samples, stopReason: timeout ? 'TIME_BUDGET' : 'SAMPLE_LIMIT' },
      ...(timeout ? { refinement: { status: 'TIME_BUDGET', reasonEnglish: 'Controlled time budget.' } } : {}),
      equity: { equity: samples ? .5 : null, winRate: samples ? .5 : null, samples },
      ev: { actions: { FOLD: { action: 'FOLD', ev: 0, method: 'DECISION_REFERENCE' } } } };
  }
  async function start(source = payload(), options = {}) {
    const counts = new Map(workers.map(worker => [worker, worker.messages.length]));
    const state = track(client.analyze(source, { owner: 'owner-A:epoch-1', ...options }));
    for (let i = 0; i < 40; i++) {
      await flush(); const worker = workers.at(-1);
      if (worker && !worker.terminated && !worker.readySent) worker.ready();
      await flush();
      if (state.status !== 'PENDING' || worker?.messages.length > (counts.get(worker) || 0)) return { state, worker };
    }
    assert.fail('Controlled client did not post or settle within its unit-test turn allowance.');
  }
  return { client, workers, timers, result, start, advance: value => { tick += value; },
    manifestRequests: () => manifestRequests,
    expireTimers() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } },
    close() { client.close(); for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } } };
}

test('shipped graph is reproducible with real source digests and no Node service or private storage dependencies', () => {
  const generated = generate();
  assert.equal(normalize(workerSource), generated.source);
  assert.deepEqual(manifest, generated.manifest);
  assert.ok(manifest.sources.some(row => row.id === 'package.json'));
  assert.ok(manifest.sources.some(row => row.id === 'src/multiway-evaluator.js'));
  assert.ok(!manifest.sources.some(row => /job-service|solution-cache|supabase|players-storage|node_modules/.test(row.id)));
  assert.ok(manifest.nodeAdapters.every(id => ['node:crypto', 'node:perf_hooks'].includes(id)));
  assert.doesNotMatch(generated.source, /\beval\s*\(|\bnew\s+Function\s*\(/);
  for (const row of manifest.sources) {
    const source = normalize(fs.readFileSync(path.join(root, row.id), 'utf8'));
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'), row.sha256, row.id);
    assert.equal(Buffer.byteLength(source), row.bytes, row.id);
  }
  const { buildFingerprint, ...descriptor } = manifest;
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(descriptor)).digest('hex'), buildFingerprint);
});

test('canonical preparation owns current ledger/revision and immutable phase budgets', () => {
  const source = payload(), before = plain(source), expected = request.prepare(source, 'PREVIEW');
  const hostile = plain(source);
  Object.assign(hostile.multiwayEvaluation, { config: { heroCards: ['2c'] }, events: [], handId: 'other', revisionKey: 'fake',
    samples: 512, timeBudgetMs: 999999, playerIds: ['other'], feeBasis: 'NET_OF_FEES' });
  const { api } = loadWorker();
  const prepared = plain(api.prepare(hostile, 'PREVIEW'));
  assert.deepEqual(prepared, plain(expected));
  assert.equal(prepared.input.multiwayEvaluation.samples, 32);
  assert.equal(prepared.input.multiwayEvaluation.timeBudgetMs, 350);
  assert.equal(prepared.input.multiwayEvaluation.revisionKey, session.envelope(source.multiway).state.revisionKey);
  assert.equal(prepared.input.multiwayEvaluation.feeBasis, undefined);
  const final = plain(api.prepare(source, 'FINAL')).input.multiwayEvaluation;
  assert.equal(final.samples, 128); assert.equal(final.timeBudgetMs, 1800);
  assert.deepEqual(source, before);
});

test('fixed complete worlds preserve exact Node values, simultaneous bounds, RNG hashes and heuristic qualification', () => {
  const worker = loadWorker();
  const cases = [{ count: 4, weighted: true }, { count: 5, weighted: true, rake: .25 }, { count: 6 },
    { count: 4, tie: true, weighted: true }, { count: 4, missingRake: true }, { count: 5, threeSeats: true }];
  for (const fixture of cases) {
    const source = payload(fixture), input = request.prepare(source, 'PREVIEW').input;
    const expected = nodeFixed(input), actual = plain(worker.api.evaluateContinuation(input));
    assert.equal(actual.multiwayEvaluation.samples, 32, JSON.stringify(fixture));
    assert.deepEqual(mathematics(actual), mathematics(expected), JSON.stringify(fixture));
    assert.equal(actual.strategyMetadata.source, 'LEGACY_CONTEXT_CONTINUATION');
    assert.equal(actual.strategyMetadata.status, 'HEURISTIC');
    assert.equal(actual.strategyMetadata.quality.nashConv, null);
    assert.equal(actual.strategyMetadata.quality.profileUncertaintyPropagated, false);
    assert.equal(actual.ev.decisionPrecision.leaderConclusive, false);
    assert.equal(actual.recommendation.action, null);
    assert.equal(actual.provenance.evReference, 'INCREMENTAL_FROM_CURRENT_DECISION');
    if (fixture.tie) assert.equal(actual.equity.equity, .5);
  }
});

test('Worker adapter reuses tables across PREVIEW/FINAL and keeps full numerical output and startup accounting', () => {
  const source = payload({ count: 4, weighted: true }), worker = loadWorker({ transport: true });
  assert.equal(worker.messages[0].type, 'ready');
  for (const [index, phase] of ['PREVIEW', 'FINAL'].entries()) {
    worker.dispatch({ type: 'analyze', jobId: `qa-${index}`, generation: 1, phase, payload: source, expectedBuildFingerprint: manifest.buildFingerprint });
    const message = worker.messages.at(-1);
    assert.equal(message.type, 'done'); assert.equal(message.jobId, `qa-${index}`); assert.equal(message.generation, 1);
    const expected = stage(nodeFixed(request.prepare(source, phase).input), phase);
    assert.deepEqual(mathematics(message.result), mathematics(expected));
    assert.equal(message.result.multiwayEvaluation.samples, phase === 'PREVIEW' ? 32 : 128);
    assert.equal(message.result.performance.measurementScope, 'THIS_DEVICE_EXECUTION_INCLUDING_TABLE_INITIALIZATION');
    assert.ok(Object.hasOwn(message.result.performance, 'initializationMs'));
  }
});

test('validation-exhausted worlds remain provisional with only exact Fold and missing equity on the browser graph', () => {
  const source = payload(), input = request.prepare(source, 'PREVIEW').input;
  let nodeTicks = 0, browserTicks = 0;
  const expected = nodeFixed(input, () => nodeTicks++ ? 351 : 0);
  const worker = loadWorker({ now: () => browserTicks++ ? 351 : 0 });
  const result = plain(worker.api.evaluateContinuation(input));
  assert.deepEqual(mathematics(result), mathematics(expected));
  assert.equal(result.analysisStage, 'PROVISIONAL'); assert.equal(result.multiwayEvaluation.samples, 0);
  assert.equal(result.ev.actions.FOLD.ev, 0); assert.equal(result.ev.actions.FOLD.method, 'DECISION_REFERENCE');
  assert.equal(result.equity.equity, null); assert.equal(result.equity.confidenceInterval95, null);
  assert.ok(result.ev.candidates.filter(row => row.action !== 'FOLD').every(row => row.ev === null && row.confidenceInterval95 === null));
  assert.equal(result.recommendation.action, null);
});

test('Worker transport rejects wrong build and malformed identity before producing any value', () => {
  for (const modify of [value => { value.expectedBuildFingerprint = 'obsolete'; }, value => { value.generation = -1; }, value => { value.jobId = ''; }]) {
    const worker = loadWorker({ transport: true });
    const message = { type: 'analyze', jobId: 'qa', generation: 1, phase: 'FINAL', payload: payload(), expectedBuildFingerprint: manifest.buildFingerprint };
    modify(message); worker.dispatch(message);
    assert.equal(worker.messages.at(-1).type, 'error');
    assert.equal(worker.messages.filter(row => row.result).length, 0);
  }
});

test('complete client results cache detached data; PREVIEW and FINAL never share cache entries', async () => {
  const h = clientHarness();
  try {
    const source = payload(), first = await h.start(source, { phase: 'PREVIEW' });
    first.worker.done(h.result(source, { phase: 'PREVIEW', samples: 32 })); await flush();
    assert.equal(first.state.status, 'FULFILLED'); first.state.value.ev.actions.FOLD.ev = 999;
    const cached = track(h.client.analyze(source, { owner: 'owner-A:epoch-1', phase: 'PREVIEW' })); await flush();
    assert.equal(cached.status, 'FULFILLED'); assert.equal(cached.value.ev.actions.FOLD.ev, 0);
    assert.equal(cached.value.performance.cacheHit, true); assert.equal(first.worker.messages.length, 1);
    const final = await h.start(source); assert.equal(final.worker, first.worker); assert.equal(final.worker.messages.length, 2);
    final.worker.done(h.result(source)); await flush(); assert.equal(final.state.status, 'FULFILLED');
    assert.equal(final.state.value.performance.workerReused, true); assert.equal(h.client.metrics().cacheEntries, 2);
  } finally { h.close(); }
});

test('zero or partial TIME_BUDGET snapshots never occupy client cache and permit unchanged-input recovery', async () => {
  const h = clientHarness();
  try {
    const source = payload();
    for (const samples of [0, 2]) {
      const run = await h.start(source); run.worker.done(h.result(source, { samples, timeout: true })); await flush();
      assert.equal(run.state.status, 'FULFILLED'); assert.equal(h.client.metrics().cacheEntries, 0);
    }
    const complete = await h.start(source); complete.worker.done(h.result(source)); await flush();
    assert.equal(complete.state.status, 'FULFILLED'); assert.equal(complete.worker.messages.length, 3);
    assert.equal(h.client.metrics().cacheEntries, 1); assert.equal(h.workers.length, 1);
  } finally { h.close(); }
});

test('owner/epoch, hand, revision, range, fee, size and profile changes cannot reuse a completed snapshot', async () => {
  const h = clientHarness();
  try {
    const original = payload({ weighted: true });
    const changes = [source => { source.multiway.handId = '90000000-0000-4000-8000-000000000002'; source.multiwayEvaluation.profileSnapshot.handId = source.multiway.handId; },
      source => { source.multiway.editEpoch++; }, source => { source.multiwayEvaluation.ranges[0].range.weights = [3, 1]; },
      source => { delete source.multiwayEvaluation.assumeNoRake; source.multiwayEvaluation.rake = .25; },
      source => { source.multiwayEvaluation.chosenSize = 2.37; },
      source => { Object.values(source.multiwayEvaluation.profileSnapshot.players['qa-seat-1'].contexts)[0].counts.FOLD++; }];
    const first = await h.start(original); first.worker.done(h.result(original)); await flush();
    for (const change of changes) {
      const changed = plain(original); change(changed);
      changed.multiwayEvaluation.revisionKey = session.envelope(changed.multiway).state.revisionKey;
      const run = await h.start(changed); assert.equal(run.state.status, 'PENDING');
      run.worker.done(h.result(changed)); await flush(); assert.equal(run.state.status, 'FULFILLED'); assert.equal(run.state.value.performance.cacheHit, false);
    }
    const owner = await h.start(original, { owner: 'owner-B:epoch-2' });
    assert.equal(first.worker.terminated, true); owner.worker.done(h.result(original)); await flush();
    assert.equal(owner.state.value.performance.cacheHit, false); assert.equal(h.client.metrics().cacheEntries, 1);
  } finally { h.close(); }
});

test('aborting an active client job retires its Worker and cannot deliver a late result', async () => {
  const h = clientHarness();
  try {
    const controller = new AbortController(), source = payload(), run = await h.start(source, { signal: controller.signal });
    controller.abort(); await flush(); assert.equal(run.state.status, 'REJECTED'); assert.equal(run.state.error.name, 'AbortError');
    assert.equal(run.worker.terminated, true); run.worker.done(h.result(source)); await flush();
    assert.equal(h.client.metrics().cacheEntries, 0); assert.equal(run.state.status, 'REJECTED');
    const next = await h.start(source); next.worker.done(h.result(source)); await flush();
    assert.equal(next.state.status, 'FULFILLED'); assert.notEqual(next.worker, run.worker);
  } finally { h.close(); }
});

test('aborting while awaiting ready promptly settles the startup invocation and retires its Worker', async () => {
  const h = clientHarness();
  try {
    const controller = new AbortController();
    const state = track(h.client.analyze(payload(), { owner: 'owner-A:epoch-1', signal: controller.signal }));
    await until(() => h.workers.length === 1 || state.status !== 'PENDING'); assert.equal(h.workers.length, 1); controller.abort(); await flush();
    assert.equal(state.status, 'REJECTED'); assert.equal(state.error.name, 'AbortError');
    assert.equal(h.workers[0].terminated, true); assert.equal(h.workers[0].messages.length, 0);
  } finally { h.close(); }
});

test('simultaneous startup requests settle the superseded request and keep at most one live Worker', async () => {
  const h = clientHarness();
  try {
    const source = payload(), first = track(h.client.analyze(source, { owner: 'owner-A:epoch-1' }));
    const second = track(h.client.analyze(source, { owner: 'owner-A:epoch-1' }));
    await until(() => h.workers.length > 0 || second.status !== 'PENDING');
    assert.equal(h.workers.filter(worker => !worker.terminated).length, 1);
    assert.equal(first.status, 'REJECTED'); assert.equal(first.error.name, 'AbortError');
    const current = h.workers.find(worker => !worker.terminated); current.ready(); await flush();
    current.done(h.result(source)); await flush(); assert.equal(second.status, 'FULFILLED');
  } finally { h.close(); }
});

test('owner clearing while awaiting ready settles old startup and cannot retire a later owner Worker', async () => {
  const h = clientHarness();
  try {
    const source = payload(), first = track(h.client.analyze(source, { owner: 'owner-A:epoch-1' }));
    await until(() => h.workers.length > 0 || first.status !== 'PENDING'); const old = h.workers.at(-1); h.client.clearOwner(); await flush();
    assert.equal(first.status, 'REJECTED'); assert.equal(first.error.name, 'AbortError'); assert.equal(old.terminated, true);
    const next = await h.start(source, { owner: 'owner-B:epoch-2' }); next.worker.done(h.result(source)); await flush();
    assert.equal(next.state.status, 'FULFILLED'); h.expireTimers(); await flush();
    assert.equal(next.worker.terminated, false); assert.equal(h.client.metrics().cacheEntries, 1);
  } finally { h.close(); }
});

test('wrong job/generation is ignored; wrong build or decision identity fails closed without a cached value', async () => {
  for (const corrupt of ['job', 'generation', 'build', 'hand', 'revision']) {
    const h = clientHarness();
    try {
      const source = payload(), run = await h.start(source), result = h.result(source);
      const overrides = corrupt === 'job' ? { jobId: 'old-job' } : corrupt === 'generation' ? { generation: -1 } : corrupt === 'build' ? { buildFingerprint: '0'.repeat(64) } : {};
      if (corrupt === 'hand') result.observedState.handId = '90000000-0000-4000-8000-000000000099';
      if (corrupt === 'revision') { result.observedState.revisionKey = 'obsolete'; result.multiwayEvaluation.revisionKey = 'obsolete'; }
      run.worker.done(result, overrides); await flush();
      if (['job', 'generation'].includes(corrupt)) {
        assert.equal(run.state.status, 'PENDING'); run.worker.done(h.result(source)); await flush(); assert.equal(run.state.status, 'FULFILLED');
      } else {
        assert.equal(run.state.status, 'REJECTED', corrupt); assert.equal(h.client.metrics().cacheEntries, 0, corrupt);
      }
    } finally { h.close(); }
  }
});

test('a stale expected revision never gets a cache hit for an otherwise identical completed ledger', async () => {
  const h = clientHarness();
  try {
    const source = payload(), first = await h.start(source); first.worker.done(h.result(source)); await flush();
    assert.equal(first.state.status, 'FULFILLED');
    const changed = plain(source); changed.multiwayEvaluation.revisionKey = 'obsolete';
    const stale = track(h.client.analyze(changed, { owner: 'owner-A:epoch-1' })); await flush();
    if (stale.status === 'PENDING' && h.workers.at(-1)?.messages.length > 1) { h.workers.at(-1).done(h.result(source)); await flush(); }
    assert.equal(stale.status, 'REJECTED'); assert.ok(['STALE_RESULT', 'INVALID_INPUT'].includes(stale.error.code));
    assert.equal(h.client.metrics().cacheHit, 0);
  } finally { h.close(); }
});

test('client excludes private annotations and tokens before cloning math input into a Worker', async () => {
  const h = clientHarness();
  try {
    const source = payload(), marker = 'PRIVATE_QA_SENTINEL';
    source.access_token = marker; source.voiceTranscript = marker; source.multiway.note = marker;
    source.multiway.config.secret = marker; source.multiway.config.players[0].note = marker; source.multiway.events[0].voice = marker;
    const snapshot = source.multiwayEvaluation.profileSnapshot;
    snapshot.notes = marker; snapshot.players['qa-seat-1'].note = marker;
    Object.values(snapshot.players['qa-seat-1'].contexts)[0].note = marker;
    const before = plain(source), run = await h.start(source);
    assert.ok(run.worker.messages.length); assert.doesNotMatch(JSON.stringify(run.worker.messages.at(-1).payload), new RegExp(marker));
    assert.deepEqual(source, before);
    run.worker.done(h.result(source)); await flush(); assert.equal(run.state.status, 'FULFILLED');
  } finally { h.close(); }
});

test('manifest body parsing shares the startup deadline rather than hanging after response headers', async () => {
  const h = clientHarness({ stalledManifestBody: true });
  try {
    const state = track(h.client.analyze(payload(), { owner: 'owner-A:epoch-1' })); await flush();
    h.expireTimers(); await flush();
    assert.equal(state.status, 'REJECTED'); assert.equal(state.error.code, 'BROWSER_RUNTIME_UNAVAILABLE');
    assert.equal(h.workers.length, 0);
  } finally { h.close(); }
});

test('cache TTL expiry recalculates while closed/missing-owner/oversized inputs never start a Worker', async () => {
  const h = clientHarness();
  try {
    const source = payload(), first = await h.start(source); first.worker.done(h.result(source)); await flush();
    h.advance(h.client.limits.cacheTTL);
    const next = await h.start(source); assert.equal(next.worker.messages.length, 2); next.worker.done(h.result(source)); await flush();
    assert.equal(next.state.value.performance.cacheHit, false);
    const missing = track(h.client.analyze(source)); await flush(); assert.equal(missing.error.code, 'OWNER_REQUIRED');
    const large = plain(source); large.multiwayEvaluation.profileSnapshot.players['qa-seat-1'].contexts['x'.repeat(512001)] = { counts: { CALL: 1 } };
    const oversized = track(h.client.analyze(large, { owner: 'owner-A:epoch-1' })); await flush(); assert.equal(oversized.error.code, 'INVALID_INPUT');
    assert.equal(h.workers.length, 1);
    h.client.close(); const closed = track(h.client.analyze(source, { owner: 'owner-A:epoch-1' })); await flush(); assert.equal(closed.error.code, 'CLIENT_CLOSED');
  } finally { h.close(); }
});
