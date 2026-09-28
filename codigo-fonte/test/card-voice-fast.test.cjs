'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { FastEndpoint, candidate } = require('../public/card-voice-fast');

function clock() {
  let time = 0, nextId = 0;
  const jobs = new Map(), callbacks = [], calls = [];
  const options = { now: () => time, setTimer: (fn, delay) => {
    const id = nextId++; jobs.set(id, { fn, at: time + delay }); callbacks.push(fn); return id;
  }, clearTimer: id => jobs.delete(id), onReady: event => calls.push({ ...event, at: time }) };
  function advance(ms) {
    const target = time + ms;
    while (true) {
      const first = [...jobs].sort((a, b) => a[1].at - b[1].at)[0];
      if (!first || first[1].at > target) break;
      time = first[1].at; jobs.delete(first[0]); first[1].fn();
    }
    time = target;
  }
  return { options, advance, calls, callbacks, jobs };
}

test('single-card endpoint waits 220 ms, ignores replay and fires only once for unchanged input', () => {
  const c = clock(), endpoint = new FastEndpoint(c.options), update = { key: 'oito de paus', contextKey: 'hand:0', eligible: true };
  endpoint.update(update); c.advance(100); endpoint.update(update); c.advance(119);
  assert.deepEqual(c.calls, []); endpoint.update(update); c.advance(1);
  assert.deepEqual(c.calls, [{ key: 'oito de paus', contextKey: 'hand:0', stableMs: 220, at: 220 }]);
  endpoint.update(update); c.advance(1000); assert.equal(c.calls.length, 1); assert.equal(c.jobs.size, 0);
});

test('changed text or context restarts the entire stability window', () => {
  const c = clock(), endpoint = new FastEndpoint(c.options);
  endpoint.update({ key: 'ace of spades', contextKey: 'selection:0', eligible: true });
  c.advance(100); endpoint.update({ key: 'ace of hearts', contextKey: 'selection:0', eligible: true });
  c.advance(100); endpoint.update({ key: 'ace of hearts', contextKey: 'selection:1', eligible: true });
  c.advance(219); assert.deepEqual(c.calls, []); c.advance(1);
  assert.deepEqual(c.calls, [{ key: 'ace of hearts', contextKey: 'selection:1', stableMs: 220, at: 420 }]);
});

test('ineligible input cancels its candidate; becoming eligible starts a new deadline', () => {
  const c = clock(), endpoint = new FastEndpoint(c.options), update = { key: 'ace of spades', contextKey: 'a', eligible: true };
  endpoint.update(update); c.advance(200); endpoint.update({ ...update, eligible: false });
  c.advance(500); assert.deepEqual(c.calls, []); assert.equal(c.jobs.size, 0);
  endpoint.update(update); c.advance(219); assert.deepEqual(c.calls, []); c.advance(1);
  assert.equal(c.calls.length, 1); assert.equal(c.calls[0].at, 920);
});

test('clear invalidates queued callbacks, including timer handle zero, and permits a fresh cycle', () => {
  const c = clock(), endpoint = new FastEndpoint(c.options), update = { key: 'oito de paus', contextKey: 'a', eligible: true };
  endpoint.update(update); const late = c.callbacks.at(-1); assert.equal(endpoint.timer, 0);
  c.advance(100); endpoint.clear(); assert.equal(c.jobs.size, 0); c.advance(500); late();
  assert.deepEqual(c.calls, []);
  endpoint.update(update); c.advance(220); assert.equal(c.calls.length, 1);
  late(); assert.equal(c.calls.length, 1);
});

test('replaced callbacks cannot signal readiness for the new text or context', () => {
  const c = clock(), endpoint = new FastEndpoint(c.options);
  endpoint.update({ key: 'ace of spades', contextKey: 'a', eligible: true }); const stale = c.callbacks.at(-1);
  c.advance(100); endpoint.update({ key: 'king of hearts', contextKey: 'b', eligible: true });
  c.advance(120); stale(); assert.deepEqual(c.calls, []); c.advance(100);
  assert.equal(c.calls.length, 1); assert.equal(c.calls[0].key, 'king of hearts');
});

test('configured endpoint delay is respected even if a timer callback arrives early', () => {
  const c = clock(), endpoint = new FastEndpoint({ ...c.options, delayMs: 400 });
  endpoint.update({ key: 'ace of spades', contextKey: 'a', eligible: true });
  const early = c.callbacks.at(-1); c.jobs.clear(); c.advance(100); early();
  c.advance(299); assert.deepEqual(c.calls, []); c.advance(1);
  assert.equal(c.calls.length, 1); assert.equal(c.calls[0].stableMs, 400);
});

test('callback can clear or replace its endpoint without reviving the previous candidate', () => {
  const c = clock(); let endpoint;
  endpoint = new FastEndpoint({ ...c.options, onReady: event => {
    c.calls.push(event);
    if (event.key === 'first') endpoint.update({ key: 'second', contextKey: 'b', eligible: true });
    else endpoint.clear();
  } });
  endpoint.update({ key: 'first', contextKey: 'a', eligible: true }); c.advance(440);
  assert.deepEqual(c.calls.map(event => event.key), ['first', 'second']); assert.equal(c.jobs.size, 0);
});

test('endpoint requires explicit eligibility and valid injected timer dependencies', () => {
  const c = clock(), endpoint = new FastEndpoint(c.options);
  for (const eligible of [undefined, null, false, 1, 'true']) endpoint.update({ key: 'card', contextKey: 'a', eligible });
  c.advance(1000); assert.deepEqual(c.calls, []);
  for (const delayMs of [-1, NaN, Infinity]) assert.throws(() => new FastEndpoint({ delayMs }), RangeError);
  assert.throws(() => new FastEndpoint({ onReady: null }), TypeError);
});

test('candidate parses the complete PT/EN phrase and only returns exactly one card', () => {
  assert.deepEqual(candidate('oito de paus', 'pt-BR'), { type: 'cards', target: 'selected', cards: ['8c'] });
  assert.deepEqual(candidate('my cards, ace of spades', 'en-US'), { type: 'cards', target: 'hero', cards: ['As'] });
  assert.deepEqual(candidate('turn dama de ouros', 'pt-BR'), { type: 'cards', target: 'turn', cards: ['Qd'] });
  for (const [locale, phrases] of [
    ['pt-BR', ['ás de espadas rei de copas', 'ás de', 'ás de espadas e', 'ás de espadas e rei', 'ás de espadas lixo', 'ás de espadas cancelar', 'eu aumento para dois', 'eu pago', 'flop', 'desfazer', 'cancelar', 'selecionar carta dois', 'corrigir carta dois para ás de espadas']],
    ['en-US', ['ace of spades king of hearts', 'ace of', 'ace of spades and', 'ace of spades and king', 'ace of spades noise', 'ace of spades cancel', 'hero raise to two', 'hero call', 'flop', 'undo', 'cancel', 'select card two', 'correct card two to ace of spades']]
  ]) for (const phrase of phrases) assert.equal(candidate(phrase, locale), null, phrase);
  assert.equal(candidate('ace of spades', 'pt-BR'), null); assert.equal(candidate('ás de espadas', 'en-US'), null);
  assert.equal(candidate('ace of spades', 'fr-FR'), null);
});

test('browser UMD exposes the same pure helper without a module loader', () => {
  const fs = require('node:fs'), vm = require('node:vm'), core = require('../public/card-voice');
  const window = { TheibsCardVoice: core };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/card-voice-fast'), 'utf8'), { window });
  assert.equal(typeof window.TheibsCardVoiceFast.FastEndpoint, 'function');
  assert.equal(window.TheibsCardVoiceFast.candidate('eight of clubs', 'en-US').cards[0], '8c');
});
