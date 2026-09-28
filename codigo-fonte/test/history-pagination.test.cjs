'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { readEventPage } = require('../src/training-store');

function fixture(t, events, ending = '\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-history-page-'));
  const file = path.join(dir, 'events.jsonl');
  fs.writeFileSync(file, events.map(event => JSON.stringify(event)).join('\n') + ending);
  t.after(() => { fs.unlinkSync(file); fs.rmdirSync(dir); });
  return file;
}

test('reverse pages preserve UTF-8 and cross-buffer records without duplicates', async t => {
  const events = Array.from({ length: 75 }, (_, id) => ({ type: 'DECISION', id, question: 'Ação, coração 🂡'.repeat(id % 3 === 0 ? 5000 : 2) }));
  const filePath = fixture(t, events);
  const collected = [];
  let beforeOffset = null;
  do {
    const page = await readEventPage({ filePath, limit: 7, beforeOffset });
    collected.push(...page.events);
    beforeOffset = page.nextOffset;
  } while (beforeOffset !== null);
  assert.deepEqual(collected, [...events].reverse());
});

test('appending newer events does not disturb an older cursor and filters apply before page limit', async t => {
  const events = Array.from({ length: 12 }, (_, id) => ({ type: id % 2 ? 'DOUBT' : 'DECISION', id }));
  const filePath = fixture(t, events);
  const first = await readEventPage({ filePath, limit: 2, types: ['DECISION'] });
  fs.appendFileSync(filePath, JSON.stringify({ type: 'DECISION', id: 12 }) + '\n');
  const second = await readEventPage({ filePath, limit: 2, types: ['DECISION'], beforeOffset: first.nextOffset });
  assert.deepEqual(first.events.map(event => event.id), [10, 8]);
  assert.deepEqual(second.events.map(event => event.id), [6, 4]);
});

test('missing file, no trailing newline, CRLF and blank lines have explicit behavior', async t => {
  const filePath = fixture(t, [{ type: 'DECISION', id: 1 }], '');
  assert.equal((await readEventPage({ filePath })).events[0].id, 1);
  fs.writeFileSync(filePath, '\r\n' + JSON.stringify({ type: 'DECISION', id: 2 }) + '\r\n\r\n');
  assert.deepEqual((await readEventPage({ filePath })).events.map(event => event.id), [2]);
  assert.deepEqual((await readEventPage({ filePath: filePath + '.missing' })).events, []);
});

test('corrupt records and invalid boundaries fail without rewriting history', async t => {
  const filePath = fixture(t, [{ type: 'DECISION', id: 1 }]);
  fs.appendFileSync(filePath, '{"type":"DOUBT"');
  const before = fs.readFileSync(filePath);
  await assert.rejects(readEventPage({ filePath }), /Malformed history record/);
  assert.deepEqual(fs.readFileSync(filePath), before);
  await assert.rejects(readEventPage({ filePath, beforeOffset: 4 }), /not an event boundary/);
  await assert.rejects(readEventPage({ filePath, beforeOffset: 100000 }), /truncated/);
});

test('pagination reads a bounded tail for recent events and respects cancellation', async t => {
  const filePath = fixture(t, Array.from({ length: 5000 }, (_, id) => ({ type: 'DECISION', id, text: 'x'.repeat(300) })));
  const page = await readEventPage({ filePath, limit: 20 });
  assert.equal(page.events.length, 20);
  assert.ok(page.scannedBytes <= 65536);
  assert.ok(page.fileSize > 1000000);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readEventPage({ filePath, signal: controller.signal }), { name: 'AbortError' });
});

test('a sparse-type coach retrieval stops at its byte budget and returns a reusable event boundary', async t => {
  const filePath = fixture(t, Array.from({ length: 1000 }, (_, id) => ({ type: 'DOUBT', id, text: 'x'.repeat(300) })));
  const page = await readEventPage({ filePath, types: ['DECISION'], limit: 100, maxScannedBytes: 32768 });
  assert.deepEqual(page.events, []);
  assert.equal(page.scanLimited, true);
  assert.equal(page.scannedBytes, 32768);
  assert.ok(page.nextOffset < page.fileSize && page.nextOffset > 0);
  const resumed = await readEventPage({ filePath, beforeOffset: page.nextOffset, limit: 1 });
  assert.equal(resumed.events[0].type, 'DOUBT');
  assert.ok(resumed.events[0].id < 999);
});
