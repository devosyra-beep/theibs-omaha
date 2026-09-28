'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { historyOverview, closeHistoryService } = require('../src/history-service');
const { summarize, outcomeTimeline } = require('../src/training-store');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
test.after(closeHistoryService);

function fixture(t, events) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-history-service-')), file = path.join(dir, 'events.jsonl');
  fs.writeFileSync(file, events.map(event => JSON.stringify(event)).join('\n') + '\n');
  t.after(() => { fs.unlinkSync(file); fs.rmdirSync(dir); });
  return file;
}

test('worker aggregation reconciles to source events with explicit timeline window', async t => {
  const events = [
    { type: 'DECISION', sessionId: 's1', chosenAction: 'FOLD', context: { variant: 'PLO5_HIGH', bigBlind: 2 }, quality: 'UNVERIFIED' },
    { type: 'HAND_COMPLETE', sessionId: 's1', outcome: { heroNet: 0, winner: 'TIE' } },
    { type: 'HAND_COMPLETE', sessionId: 's2', outcome: { heroNet: 4, winner: 'HERO' } },
    { type: 'HAND_COMPLETE', sessionId: 's3', outcome: {} }
  ];
  const file = fixture(t, events), data = await historyOverview(file, { timelineLimit: 2 });
  assert.deepEqual(data.summary, summarize(events));
  assert.deepEqual(data.outcomeTimeline, outcomeTimeline(events).slice(-2));
  assert.equal(data.recent[0].chosenAction, 'FOLD');
  assert.equal(data.historyScope.timelineTotal, 3);
  assert.equal(data.historyScope.timelineReturned, 2);
  assert.equal(data.historyScope.timelineTruncated, true);
  assert.equal(data.historyScope.aggregation, 'ALL_RECORDS');
  assert.equal(data.historyScope.storageRead, 'WORKER_THREAD');
});

test('cache invalidates on append and one response cannot mutate a later cached result', async t => {
  const file = fixture(t, [{ type: 'DOUBT', question: 'One?' }]);
  const first = await historyOverview(file);
  first.summary.doubts = 999;
  const cached = await historyOverview(file);
  assert.equal(cached.summary.doubts, 1);
  assert.equal(cached.historyScope.cacheHit, true);
  fs.appendFileSync(file, JSON.stringify({ type: 'DOUBT', question: 'Two?' }) + '\n');
  const changed = await historyOverview(file);
  assert.equal(changed.summary.doubts, 2);
  assert.equal(changed.historyScope.cacheHit, false);
});

test('separate user files and concurrent requests cannot share history', async t => {
  const first = fixture(t, [{ type: 'DECISION', chosenAction: 'CALL', context: {} }]);
  const second = fixture(t, [{ type: 'DECISION', chosenAction: 'FOLD', context: {} }]);
  const [a, b, c] = await Promise.all([historyOverview(first), historyOverview(second), historyOverview(first)]);
  assert.equal(a.recent[0].chosenAction, 'CALL');
  assert.equal(b.recent[0].chosenAction, 'FOLD');
  assert.equal(c.recent[0].chosenAction, 'CALL');
});

test('corruption and cancellation never return successful or invented empty histories', async t => {
  const file = fixture(t, [{ type: 'DOUBT' }]);
  fs.appendFileSync(file, '{');
  const original = fs.readFileSync(file);
  await assert.rejects(historyOverview(file));
  assert.deepEqual(fs.readFileSync(file), original);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(historyOverview(file, { signal: controller.signal }), { name: 'AbortError' });
});

test('undefined history path uses the same configured default as the local event store', async t => {
  const file = fixture(t, [{ type: 'DECISION', chosenAction: 'CALL', context: {} }]);
  // Set the environment before loading either module, just as the local server does.
  // A subprocess avoids changing this test process or accessing the user's default history.
  const script = `const assert = require('node:assert/strict');
    const store = require('./src/training-store');
    const service = require('./src/history-service');
    (async () => { try {
      assert.equal(store.DEFAULT_PATH, process.env.THEIBS_DATA_PATH);
      const data = await service.historyOverview(undefined);
      assert.equal(data.recent[0].chosenAction, store.readEvents()[0].chosenAction);
      const omitted = await service.historyOverview();
      assert.equal(omitted.historyScope.cacheHit, true);
      process.stdout.write('DEFAULT_PATH_OK');
    } finally { await service.closeHistoryService(); } })().catch(error => { console.error(error); process.exitCode = 1; });`;
  const result = await execFile(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, THEIBS_DATA_PATH: file }
  });
  assert.equal(result.stdout, 'DEFAULT_PATH_OK');
});
