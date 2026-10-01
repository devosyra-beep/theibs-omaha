'use strict';

// Native structured-clone/transfer QA. MessageChannel is a transport test;
// actual browser scheduling and responsiveness remain separate release gates.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { MessageChannel } = require('node:worker_threads');
const { webcrypto } = require('node:crypto');
const codec = require('../public/browser-solver-checkpoint-codec');
const clientApi = require('../public/browser-solver-client');
const core = require('../src/solver/extensive-solver');
const job = require('../src/solver/job-worker');
const conditioned = require('../src/solver/action-conditioned');
const session = require('../src/multiway-session');
const fixtures = require('./helpers/solver-reference-fixtures.cjs');
const exact = require('./helpers/river-hu-expanded-contract-reference.cjs');
const BASELINE = '5ba76316efa7bd55557cb8e7fe7a807bb0442608';
const sourceRoot = path.resolve(__dirname, '..');
const baselineIds = new Set(['src/solver/extensive-solver.js', 'src/solver/action-conditioned.js', 'src/solver/job-worker.js',
  'src/solver/plo-river-game.js', 'src/solver/versions.js', 'src/solver/solution-status.js', 'src/solver/decision-outcome.js', 'src/decision-precision.js']);
const baselineModules = new Map();
function baseline(id) {
  if (baselineModules.has(id)) return baselineModules.get(id).exports;
  const filename = path.join(sourceRoot, id), loaded = new Module(filename, module);
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const normalRequire = loaded.require.bind(loaded);
  loaded.require = name => {
    if (name.startsWith('.')) {
      const target = path.relative(sourceRoot, path.resolve(path.dirname(filename), name.endsWith('.js') ? name : name + '.js')).split(path.sep).join('/');
      if (baselineIds.has(target)) return baseline(target);
    }
    return normalRequire(name);
  };
  const source = execFileSync('git', ['show', `${BASELINE}:codigo-fonte/${id}`], { cwd: path.dirname(sourceRoot), encoding: 'utf8', windowsHide: true });
  baselineModules.set(id, loaded); loaded._compile(source, filename); return loaded.exports;
}
const oldCore = baseline('src/solver/extensive-solver.js');
const oldJob = baseline('src/solver/job-worker.js');
function mathematics(value) {
  if (Array.isArray(value)) return value.map(mathematics);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !key.endsWith('Ms') && key !== 'metrics' && key !== 'costs' && key !== 'actionCosts' && key !== 'traversalVisits')
    .map(([key, item]) => [key, mathematics(item)]));
  return value;
}
async function nativeTransfer(value, transfer) {
  const { port1, port2 } = new MessageChannel();
  try {
    const received = new Promise((resolve, reject) => { port2.once('message', resolve); port2.once('messageerror', reject); });
    port1.postMessage(value, transfer); return await received;
  } finally { port1.close(); port2.close(); }
}
function numericalCheckpoint() {
  const game = fixtures.matrixGame([[2, -1], [1, 0]]), solved = core.solve(game, { iterations: 16 });
  const global = structuredClone(solved.checkpoint); global.regrets[0][0] = -0;
  return { version: require('../src/solver/versions').ADAPTIVE_VERSION, solverVersion: core.VERSION, certificateVersion: conditioned.VERSION,
    global, actionCheckpoints: { CHECK: structuredClone(solved.checkpoint), 'BET:1.00': structuredClone(solved.checkpoint) },
    workIterations: 48, baseGameHash: solved.gameHash, comparisonPolicyKey: 'a'.repeat(64),
    actionCertificates: { CHECK: { id: 'CHECK', lowerBB: -0, upperBB: 2, boundsBB: [-0, 2], fullPriorPreserved: true, originalHandActionEV: false } } };
}

test('binary64 checkpoint roundtrip retains exact matrices, signed zero and all nonmatrix proof metadata', () => {
  const checkpoint = numericalCheckpoint(), original = structuredClone(checkpoint), packet = codec.pack(checkpoint);
  assert.equal(codec.isPacket(packet), true); codec.validate(packet);
  assert.equal(packet.encoding, codec.VERSION); assert.equal(packet.data instanceof ArrayBuffer, true);
  assert.equal(packet.matrices.length, 6); assert.deepEqual(codec.transfers(packet), [packet.data]);
  assert.deepEqual(codec.unpack(packet), original); assert.deepEqual(checkpoint, original);
  const decoded = codec.unpack(packet); decoded.global.regrets[0][0] = 777; decoded.actionCertificates.CHECK.lowerBB = 666;
  assert.deepEqual(codec.unpack(packet), original, 'Decoded caller data must not alias retained matrices or proof metadata.');
});

test('native postMessage detaches only the new packet buffer and leaves solver-owned checkpoint arrays usable', async () => {
  const checkpoint = numericalCheckpoint(), original = structuredClone(checkpoint), packet = codec.pack(checkpoint);
  const before = packet.data.byteLength; assert.ok(before > 0);
  const receiving = nativeTransfer({ checkpoint: packet }, codec.transfers(packet));
  assert.equal(packet.data.byteLength, 0); const received = (await receiving).checkpoint;
  assert.equal(received.data.byteLength, before); assert.deepEqual(codec.unpack(received), original);
  assert.deepEqual(checkpoint, original); assert.deepEqual(codec.transfers(received), [received.data]);
});

test('two native resume transfers use detached copies while the retained cache packet stays attached and unchanged', async () => {
  const checkpoint = numericalCheckpoint(), packet = codec.pack(checkpoint), bytes = packet.data.byteLength;
  for (let run = 0; run < 2; run++) {
    const copy = codec.copyForTransfer(packet);
    assert.notEqual(copy.packet.data, packet.data); assert.equal(copy.transfer.length, 1);
    const receiving = nativeTransfer({ checkpoint: copy.packet }, copy.transfer);
    assert.equal(copy.packet.data.byteLength, 0); assert.equal(packet.data.byteLength, bytes);
    assert.deepEqual(codec.unpack((await receiving).checkpoint), checkpoint); assert.deepEqual(codec.unpack(packet), checkpoint);
  }
});

test('malformed matrix descriptors, unknown versions and invalid binary64 values fail before checkpoint use', () => {
  const packet = codec.pack(numericalCheckpoint());
  const changes = [
    value => { value.encoding = 'REJECTED_TRANSPORT_VERSION'; },
    value => { value.data = value.data.slice(0, value.data.byteLength - 8); },
    value => { value.matrices[0].offset += 1; },
    value => { value.matrices[0].length += 1; },
    value => { value.matrices[0].rowLengths[0] += 1; },
    value => { value.matrices.push(structuredClone(value.matrices[0])); },
    value => { value.matrices[0].path = ['unrecognized', 'matrix']; },
    value => { value.matrices[0].rowLengths = [12001]; },
    ...[-1, NaN, Infinity].map(number => value => { new Float64Array(value.data)[0] = number; }),
  ];
  if (typeof SharedArrayBuffer === 'function') changes.push(value => { value.data = new SharedArrayBuffer(value.data.byteLength); });
  for (const change of changes) {
    const invalid = structuredClone(packet); change(invalid);
    assert.throws(() => codec.validate(invalid)); assert.throws(() => codec.unpack(invalid));
  }
});

test('native transferred fixed-work global resumes match the exact baseline checkpoint, strategy, EV and convergence', async () => {
  for (const game of [fixtures.kuhnGame(), fixtures.privateTypeGame()]) {
    const first = core.solve(game, { iterations: 16 });
    const packet = codec.pack({ version: require('../src/solver/versions').ADAPTIVE_VERSION, global: first.checkpoint, actionCheckpoints: {} });
    const received = await nativeTransfer(packet, codec.transfers(packet));
    const restored = codec.unpack(received), resumed = core.solve(game, { iterations: 16, checkpoint: restored.global });
    const expected = oldCore.solve(structuredClone(game), { iterations: 32 });
    assert.deepEqual(resumed.checkpoint, expected.checkpoint); assert.deepEqual(resumed.strategy, expected.strategy);
    assert.deepEqual(resumed.values, expected.values); assert.deepEqual(resumed.convergence, expected.convergence);
  }
});

test('packed adaptive resume preserves nonuniform/blocker job and certificate mathematics against 5ba76316', async () => {
  for (const source of [fixtures.riverCallInput({ blockers: true }), fixtures.riverMixedInput()]) {
    // Candidate admission defaults intentionally allow 32 instead of 24.
    // Compare the same explicit legacy declaration, including its guard metadata.
    const input = { ...source, budget: { maxWorlds: 576, maxNodes: 12000, maxMemoryBytes: 48 * 1024 * 1024, maxBuildMs: 750 } };
    const budget = { timeMs: 5000, iterations: 64 }, dependencies = { compilationReuse: true, now: () => 0 };
    const previous = oldJob.execute({ input: structuredClone(input), budget }, dependencies);
    const actual = job.execute({ input: structuredClone(input), budget }, dependencies);
    assert.deepEqual(mathematics(actual.result), mathematics(previous.result));
    assert.deepEqual(mathematics(actual.checkpoint), mathematics(previous.checkpoint));
    const packet = codec.pack(actual.checkpoint), moved = await nativeTransfer(packet, codec.transfers(packet));
    const restored = codec.unpack(moved); assert.deepEqual(restored, actual.checkpoint);
    const resumed = job.execute({ input: structuredClone(input), budget, checkpoint: restored }, dependencies);
    const expected = oldJob.execute({ input: structuredClone(input), budget, checkpoint: previous.checkpoint }, dependencies);
    assert.deepEqual(mathematics(resumed.result), mathematics(expected.result));
    assert.deepEqual(mathematics(resumed.checkpoint), mathematics(expected.checkpoint));
    assert.equal(resumed.result.actionPrecision.fullPriorPreserved, true);
    assert.equal(resumed.result.actionPrecision.originalHandActionEV, false);
  }
});

test('transferred action resumes preserve exact rational full-prior envelope containment without endpoint tolerance', async () => {
  const builder = require('../src/solver/plo-river-game');
  for (const id of ['marginal_true_action_tie', 'rare_actual_hand_full_prior_commitment']) {
    const scenario = exact.scenarios().find(row => row.id === id), built = builder.buildPloRiverGame(scenario.input);
    assert.equal(built.status, 'READY'); const game = built.game, player = game.meta.heroSeat;
    const action = game.meta.rootActions.find(row => row.id === 'CALL') || game.meta.rootActions[0];
    const condition = { player, informationSet: game.meta.heroInformationSet, actionId: action.id };
    const fixed = conditioned.buildActionConditionedGame(game, condition), first = core.solve(fixed, { iterations: 16 });
    const packet = codec.pack({ version: require('../src/solver/versions').ADAPTIVE_VERSION, global: null, actionCheckpoints: { [action.id]: first.checkpoint } });
    const moved = await nativeTransfer(packet, codec.transfers(packet)), decoded = codec.unpack(moved);
    const resumed = core.solve(fixed, { iterations: 16, checkpoint: decoded.actionCheckpoints[action.id] });
    const expected = oldCore.solve(structuredClone(fixed), { iterations: 32 }); assert.deepEqual(resumed.checkpoint, expected.checkpoint);
    const witness = exact.exactPolicyEnvelope(exact.restrictIndependently(game, condition), resumed.strategy, player);
    const bounds = conditioned.evaluateActionConditioned(game, resumed.strategy, condition);
    assert.equal(bounds.certified, true); exact.assertOuterInterval(bounds.lowerBB, bounds.upperBB, witness.lower, witness.upper, id);
    assert.equal(bounds.fullPriorPreserved, true); assert.equal(bounds.originalHandActionEV, false);
  }
});

async function finish(client, owner, initial) {
  let current = initial;
  for (let count = 0; count < 20 && !['COMPLETE', 'FAILED', 'CANCELLED', 'UNSUPPORTED'].includes(current.phase); count++)
    current = await client.wait(owner, current.jobId, { afterVersion: current.updateVersion, waitMs: 1000 });
  assert.ok(['COMPLETE', 'FAILED', 'CANCELLED', 'UNSUPPORTED'].includes(current.phase)); return current;
}
function nativeClientFixture(input, result, checkpoint, { hold = false } = {}) {
  const manifest = require('../public/browser-solver-manifest.json'), workers = [];
  const client = clientApi.create({ manifest, crypto: webcrypto, checkpointCodec: codec, createWorker: () => {
    const { port1, port2 } = new MessageChannel();
    const worker = { terminated: false, received: [], detachedOutputs: [],
      postMessage(message, transfer = []) { port1.postMessage(message, transfer); },
      terminate() { this.terminated = true; port1.close(); port2.close(); } };
    port1.on('message', message => worker.onmessage?.({ data: message }));
    worker.reply = (message, type = 'done') => {
      const output = structuredClone(result); output.adaptation.refinementRecommended = false;
      const packet = codec.pack(checkpoint);
      port2.postMessage({ type, jobId: message.jobId, generation: message.generation,
        buildFingerprint: manifest.buildFingerprint, handId: input.multiway.handId, revisionKey: message.expectedRevisionKey,
        result: output, checkpoint: packet, workerMs: 1 }, codec.transfers(packet));
      worker.detachedOutputs.push(packet.data.byteLength);
    };
    port2.on('message', message => {
      worker.received.push(message);
      if (!hold) worker.reply(message);
    });
    workers.push(worker);
    port2.postMessage({ type: 'ready', schemaVersion: manifest.schemaVersion, buildFingerprint: manifest.buildFingerprint,
      checkpointTransportVersion: codec.VERSION }); return worker;
  } });
  return { client, workers };
}

test('native client transfers preserve cached pairs, immutable public values, owner isolation and repeatable resumes', async () => {
  const input = fixtures.riverMixedInput(), revisionKey = session.envelope(input.multiway).state.revisionKey;
  const computed = job.execute({ input: structuredClone(input), budget: { timeMs: 5000, iterations: 64 } }, { compilationReuse: true, now: () => 0 });
  const { client, workers } = nativeClientFixture(input, computed.result, computed.checkpoint);
  const owner = 'independent-qa-owner', options = { handId: input.multiway.handId, revisionKey, automatic: false };
  try {
    const initial = await finish(client, owner, await client.start(owner, input, options));
    assert.equal(initial.phase, 'COMPLETE'); assert.equal(workers.length, 1); assert.equal(client.stats().retainedCheckpointJobs, 0);
    assert.deepEqual(workers[0].detachedOutputs, [0]);
    const warm = await client.start(owner, input, { ...options, budget: 'FAST' });
    assert.equal(warm.cache.hit, true); assert.equal(warm.cache.readOnly, true); assert.equal(workers.length, 1);
    const originalEV = warm.result.actions[0].evBB; warm.result.actions[0].evBB = 12345;
    assert.equal(client.get(owner, warm.jobId).result.actions[0].evBB, originalEV);
    for (let repeat = 0; repeat < 2; repeat++) {
      const resumed = await finish(client, owner, await client.start(owner, input, { ...options, budget: 'DEEP' }));
      assert.equal(resumed.phase, 'COMPLETE'); const received = workers.at(-1).received[0];
      assert.equal(codec.isPacket(received.checkpoint), true); assert.deepEqual(codec.unpack(received.checkpoint), computed.checkpoint);
      assert.deepEqual(workers.at(-1).detachedOutputs, [0]); assert.equal(client.stats().retainedCheckpointJobs, 0);
    }
    const count = workers.length, other = await finish(client, 'independent-qa-other', await client.start('independent-qa-other', input, options));
    assert.equal(other.cache.hit, false); assert.equal(workers.length, count + 1);
    assert.throws(() => client.get('independent-qa-other', initial.jobId), /owner/);
    client.clearOwner(owner);
    const cleared = await finish(client, owner, await client.start(owner, input, { ...options, budget: 'FAST' }));
    assert.equal(cleared.cache.hit, false); assert.equal(workers.at(-1).received[0].checkpoint, null);
  } finally { client.close(); }
});

async function eventually(predicate) {
  for (let attempt = 0; attempt < 50 && !predicate(); attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), 'Native message did not arrive within the bounded event-loop turns.');
}

test('native stale or cancelled packets are ignored before decoding and cannot repopulate an owner cache', async () => {
  const input = fixtures.riverMixedInput(), revisionKey = session.envelope(input.multiway).state.revisionKey;
  const computed = job.execute({ input: structuredClone(input), budget: { timeMs: 5000, iterations: 64 } }, { compilationReuse: true, now: () => 0 });
  const { client, workers } = nativeClientFixture(input, computed.result, computed.checkpoint, { hold: true });
  const owner = 'independent-stale-owner', options = { handId: input.multiway.handId, revisionKey, automatic: false };
  try {
    const first = await client.start(owner, input, options); await eventually(() => workers[0].received.length > 0);
    const old = workers[0].received[0]; workers[0].reply(old, 'progress');
    await eventually(() => client.get(owner, first.jobId).result != null);
    const retained = client.get(owner, first.jobId).result, oldHandler = workers[0].onmessage;
    client.cancelOwner(owner); assert.equal(client.get(owner, first.jobId).phase, 'CANCELLED');
    const poison = () => { const value = codec.pack(computed.checkpoint); value.encoding = 'MUST_NEVER_BE_DECODED'; return value; };
    async function delayed(identity) {
      const packet = poison(); return nativeTransfer({ type: 'done', ...identity, result: computed.result,
        checkpoint: packet, workerMs: 5000 }, [packet.data]);
    }
    const identity = { jobId: old.jobId, generation: old.generation, buildFingerprint: require('../public/browser-solver-manifest.json').buildFingerprint,
      handId: input.multiway.handId, revisionKey };
    oldHandler({ data: await delayed(identity) });
    assert.deepEqual(client.get(owner, first.jobId).result, retained);
    client.clearOwner(owner); assert.equal(client.stats().entries, 0);
    const next = await client.start(owner, input, { ...options, budget: 'FAST' });
    await eventually(() => workers[1].received.length > 0); assert.equal(next.cache.hit, false);
    oldHandler({ data: await delayed(identity) }); assert.equal(client.stats().entries, 0);
    const active = workers[1].received[0];
    workers[1].onmessage({ data: await delayed({ ...identity, jobId: active.jobId, generation: active.generation - 1 }) });
    assert.equal(client.stats().entries, 0); assert.notEqual(client.get(owner, next.jobId).phase, 'FAILED');
    workers[1].reply(active); const completed = await finish(client, owner, next);
    assert.equal(completed.phase, 'COMPLETE'); assert.equal(client.stats().entries, 1);
    assert.deepEqual(completed.result.actions, computed.result.actions); assert.ok(client.stats().staleMessages >= 3);
  } finally { client.close(); }
});
