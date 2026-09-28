'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');

test('Analyze does not prefill financial inputs or silently assume zero rake', () => {
  const html = read('index.html');
  const dashboard = read('dashboard.js');
  for (const id of ['potBeforeAction','amountToCall','effectiveStack']) {
    const tag = html.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'))?.[0];
    assert.ok(tag, id + ' input must exist');
    assert.doesNotMatch(tag, /\bvalue=/, id + ' must not ship with a sample value');
  }
  assert.doesNotMatch(dashboard, /assumeNoRake['"]?\)\.checked\s*=\s*true/);
  assert.match(html, /id="assumeNoRake" type="checkbox"/);
});

test('basic Analyze asks for opponent count and keeps random legal hands as the fixed baseline', () => {
  const html = read('index.html');
  const dashboard = read('dashboard.js');
  const players = html.match(/<input[^>]*id="players"[^>]*>/)?.[0];
  assert.ok(players);
  assert.doesNotMatch(players, /\bvalue=/);
  assert.match(html, /<option value="" selected>Not specified · optional for basic analysis<\/option>/);
  assert.match(dashboard, /Active opponents/);
  assert.match(dashboard, /Baseline: random legal hands/);
  assert.doesNotMatch(dashboard, /value="EXPLICIT"/);
  assert.match(dashboard, /Modelo: adversários com cartas aleatórias\./);
});
