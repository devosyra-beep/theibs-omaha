'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../public/auth-session.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '../public/auth-ui.js'), 'utf8');
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function mount(fetch, saved = null) {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) {
      const tag = html.match(new RegExp('<[^>]+id="' + id + '"[^>]*>'))?.[0] || '';
      const attrs = new Set(/\binert\b/.test(tag) ? ['inert'] : []);
      nodes.set(id, { hidden: /\bhidden\b/.test(tag), disabled: /\bdisabled\b/.test(tag), textContent: '', handlers: {},
        setAttribute: k => attrs.add(k), removeAttribute: k => attrs.delete(k), hasAttribute: k => attrs.has(k),
        addEventListener(name, cb) { this.handlers[name] = cb; }, focus() {} });
    }
    return nodes.get(id);
  };
  let start;
  const storage = new Map(saved ? [['theibs.auth.session.v1', JSON.stringify(saved)]] : []);
  const window = { fetch, addEventListener: (name, cb) => { if (name === 'DOMContentLoaded') start = cb; } };
  const document = { getElementById: get, body: { style: {} }, title: 'THEIBS', dispatchEvent() {} };
  vm.runInNewContext(source, { window, document, localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    location: { href: 'https://theibs.example/app', origin: 'https://theibs.example', pathname: '/app', search: '', hash: '', replace() {}, assign() {} },
    history: { replaceState() {} }, URL, URLSearchParams, Headers, Request, AbortController, AbortSignal, atob, Date, CustomEvent, clearTimeout, setTimeout: (fn, delay) => setTimeout(fn, delay).unref() });
  return { get, start, window };
}
const config = { required: true, providers: { google: true }, billingEnabled: false };
const response = body => ({ ok: true, status: 200, json: async () => body });
function assertLocked(ui) {
  assert.equal(ui.get('app-shell').hidden, true);
  assert.equal(ui.get('app-shell').hasAttribute('inert'), true);
  assert.equal(ui.get('login-screen').hidden, false);
}

test('lab stays hidden from initial HTML through a delayed config and visitor login', async () => {
  const pending = deferred();
  const ui = mount(() => pending.promise);
  assertLocked(ui);
  const boot = ui.start();
  assertLocked(ui);
  pending.resolve(response({ auth: config }));
  await boot;
  assertLocked(ui);
  assert.equal(ui.get('auth-google').disabled, false);
});

test('a cached session does not reveal the lab until server access is confirmed', async () => {
  const access = deferred();
  const ui = mount(url => url === '/api/public-config' ? response({ auth: config }) : access.promise,
    { access_token: 'test', expires_at: Date.now() + 3600000 });
  const boot = ui.start();
  await new Promise(setImmediate);
  assertLocked(ui);
  access.resolve(response({ access: { allowed: true, state: 'TRIAL', daysRemaining: 3 } }));
  await boot;
  assert.equal(ui.get('app-shell').hidden, false);
  assert.equal(ui.get('app-shell').hasAttribute('inert'), false);
  assert.equal(ui.get('login-screen').hidden, true);
});

test('expired access and configuration errors keep the lab hidden', async () => {
  const denied = mount(url => response(url === '/api/public-config' ? { auth: config } : { access: { allowed: false, state: 'EXPIRED' } }),
    { access_token: 'test', expires_at: Date.now() + 3600000 });
  await denied.start();
  assertLocked(denied);
  const offline = mount(async () => { throw new Error('Connection unavailable.'); });
  await offline.start();
  assertLocked(offline);
  assert.equal(offline.get('auth-status').textContent, 'Connection unavailable.');
});

test('local mode still opens the lab after configuration and sign out hides it immediately', async () => {
  const ui = mount(() => response({ auth: { ...config, required: false } }));
  await ui.start();
  assert.equal(ui.get('app-shell').hidden, false);
  const logout = ui.get('header-signout').handlers.click();
  assertLocked(ui);
  await logout;
});
