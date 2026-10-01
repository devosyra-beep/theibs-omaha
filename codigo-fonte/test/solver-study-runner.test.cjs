'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../public/solver-study-runner');
const binding = { handId: 'hand', revisionKey: 'revision', token: 'owner:hand:revision:input' };
const model = id => ({ id, name: id, input: { multiway: { handId: 'hand' }, ranges: [{ weight: 1 }], sizing: {} } });
const baseline = { ...model('base'), phase: 'COMPLETE', result: { actions: [{ evBB: 7 }] } };
const job = (id, phase = 'COMPLETE', result = { actions: [{ evBB: 1 }] }) => ({ jobId: id, handId: 'hand', revisionKey: 'revision', phase, result, updateVersion: 1 });
const deferred = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), get resolve() { return resolve; } }; };

test('comparisons run sequentially; keep frozen base and independent model results', async () => {
  let active = 0, maximum = 0; const calls = [];
  const runner = create({ start: async input => { maximum = Math.max(maximum, ++active); calls.push(input.ranges[0].weight); return job('j' + calls.length, 'REFINING'); },
    wait: async id => { active--; return job(id); }, cancel: async () => { active--; }, isCurrent: () => true });
  const alternative = model('one'); alternative.input.ranges[0].weight = 2;
  const pending = runner.run({ entries: [alternative, model('two')], baseline, binding });
  alternative.input.ranges[0].weight = 9;
  const state = await pending;
  assert.equal(state.phase, 'COMPLETE'); assert.equal(maximum, 1); assert.deepEqual(calls, [2, 1]);
  // Inputs are frozen at the start of the workflow, before work begins.
  state.entries[0].result.actions[0].evBB = 0;
  assert.equal(runner.getState().entries[0].result.actions[0].evBB, 7);
  assert.equal(baseline.result.actions[0].evBB, 7);
  assert.equal(state.perScenarioMs, 3000); assert.equal(state.totalMs, 6000);
});

test('cancelling before start acknowledgement drains and cancels the late job', async () => {
  const late = deferred(), began = deferred(); const cancelled = [];
  const runner = create({ start: () => { began.resolve(); return late.promise; }, wait: async () => { throw Error('Must not poll cancelled acknowledgement'); },
    cancel: async id => { cancelled.push(id); return job(id, 'CANCELLED'); }, isCurrent: () => true });
  const pending = runner.run({ entries: [model('one')], baseline, binding }); await began.promise;
  let drained = false; const stop = runner.cancel().then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false);
  late.resolve(job('late', 'REFINING')); await stop; await pending;
  assert.deepEqual(cancelled, ['late']); assert.equal(runner.getState().phase, 'CANCELLED');
  assert.equal(runner.getState().entries[1].result, null);
});

test('strict scenario deadline cancels live work and preserves the latest estimate', async () => {
  const runner = create({ perScenarioMs: 12, totalMs: 30, start: async () => job('slow', 'REFINING', { actions: [{ evBB: 4 }] }),
    wait: async (id, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })), { once: true })),
    cancel: async id => job(id, 'CANCELLED', { actions: [{ evBB: 5 }] }), isCurrent: () => true });
  const state = await runner.run({ entries: [model('one')], baseline, binding });
  assert.equal(state.entries[1].phase, 'CANCELLED'); assert.match(state.entries[1].error, /time budget/);
  assert.equal(state.entries[1].result.actions[0].evBB, 5); assert.equal(state.entries[0].result.actions[0].evBB, 7);
});

test('old decision updates are discarded and its worker is cancelled', async () => {
  let current = true; const next = deferred(), polling = deferred(), cancelled = [];
  const runner = create({ start: async () => job('old', 'REFINING'), wait: () => { polling.resolve(); return next.promise; },
    cancel: async id => { cancelled.push(id); return job(id, 'CANCELLED'); }, isCurrent: () => current,
    onUpdate: state => { if (!current) assert.equal(state.entries.length, 0, 'Never publish stale progress'); } });
  const pending = runner.run({ entries: [model('one'), model('two')], baseline, binding }); await polling.promise;
  current = false; next.resolve(job('old')); const state = await pending;
  assert.equal(state.phase, 'CANCELLED'); assert.deepEqual(state.entries, []); assert.deepEqual(cancelled, ['old']);
});

test('a late acknowledgement cannot keep the visible workflow open beyond its total budget', async () => {
  const late = deferred(), cancelled = [];
  const runner = create({ perScenarioMs: 8, totalMs: 18, start: () => late.promise, wait: () => assert.fail('No acknowledgement yet'),
    cancel: async id => { cancelled.push(id); }, isCurrent: () => true });
  const state = await runner.run({ entries: [model('one'), model('two')], baseline, binding });
  assert.equal(state.phase, 'COMPLETE'); assert.equal(state.entries[1].result, null);
  assert.equal(state.entries[2].phase, 'CANCELLED'); assert.match(state.error, /time budget/);
  late.resolve(job('late')); await runner.cancel(); assert.deepEqual(cancelled, ['late']);
});

test('mismatched result identities fail closed and stop their job', async () => {
  const cancelled = [];
  const runner = create({ start: async () => ({ ...job('wrong'), revisionKey: 'other' }), wait: async () => {}, cancel: async id => cancelled.push(id) });
  const state = await runner.run({ entries: [model('one')], baseline, binding });
  assert.equal(state.entries[1].phase, 'FAILED'); assert.equal(state.entries[1].result, null); assert.deepEqual(cancelled, ['wrong']);
});

test('refuses unbounded or duplicate scenario workflows before starting compute', async () => {
  const runner = create({ start: () => assert.fail('No compute'), wait: () => {}, cancel: () => {} });
  for (const entries of [[model('one'), model('two'), model('three')], [model('base')]]) {
    await assert.rejects(runner.run({ entries, baseline, binding }), /distinct studies/);
  }
});
