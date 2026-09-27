'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/auth-ui.js'), 'utf8');

async function boot({ required = true, loggedIn = true, logout } = {}) {
  const storage = new Map(), elements = new Map(), calls = [], navigations = [];
  const key = 'theibs.auth.session.v1';
  if (loggedIn) storage.set(key, JSON.stringify({ access_token: 'test-token', expires_at: Date.now() + 3600000 }));
  function element(id) {
    if (!elements.has(id)) elements.set(id, { hidden: true, disabled: false, style: {}, listeners: {}, attributes: {},
      addEventListener(name, handler) { this.listeners[name] = handler; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; }, focus() {} });
    return elements.get(id);
  }
  const config = { required, providers: { google: required }, billingEnabled: false,
    supabaseUrl: required ? 'https://test.supabase.co' : null, supabasePublishableKey: 'test-public-key' };
  const window = { listeners: {}, addEventListener(name, handler) { this.listeners[name] = handler; },
    async fetch(url, init) {
      calls.push({ url, init });
      if (url === '/api/public-config') return Response.json({ auth: config });
      if (url === '/api/access') return Response.json({ access: { allowed: true, state: 'LIFETIME' } });
      if (String(url).includes('/auth/v1/logout')) return logout ? logout() : new Response(null, { status: 204 });
      return Response.json({ status: 'OK' });
    } };
  const location = { origin: 'http://localhost:4175', href: 'http://localhost:4175/app', pathname: '/app', search: '', hash: '',
    replace(url) { navigations.push(url); } };
  vm.runInNewContext(source, { window, location, document: { getElementById: element, body: { style: {} } },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    history: { replaceState() {} }, URL, URLSearchParams, Headers, AbortSignal, console });
  await window.listeners.DOMContentLoaded();
  return { element, storage, key, window, calls, navigations };
}

test('signed-in users can leave immediately; tokens clear before revocation and old requests are blocked', async () => {
  let finishLogout;
  const app = await boot({ logout: () => new Promise(resolve => { finishLogout = resolve; }) });
  assert.equal(app.element('header-signout').hidden, false);
  const pending = app.element('header-signout').listeners.click();
  assert.equal(app.storage.has(app.key), false);
  assert.equal(app.element('header-signout').disabled, true);
  await assert.rejects(app.window.fetch('/api/training/history'), /signed out/);
  const request = app.calls.find(call => call.url.includes('/auth/v1/logout'));
  assert.match(request.url, /scope=local$/);
  assert.equal(request.init.headers.Authorization, 'Bearer test-token');
  finishLogout(new Response(null, { status: 204 }));
  await pending;
  assert.deepEqual(app.navigations, ['/app?login=1']);
});

test('offline logout still removes local credentials and leaves the loaded account', async () => {
  const app = await boot({ logout: () => Promise.reject(new Error('offline')) });
  await app.element('auth-signout').listeners.click();
  assert.equal(app.storage.has(app.key), false);
  assert.deepEqual(app.navigations, ['/app?login=1']);
});

test('local lab has a visible exit and returns to the landing without a provider request', async () => {
  const app = await boot({ required: false, loggedIn: false });
  assert.equal(app.element('header-signout').hidden, false);
  await app.element('header-signout').listeners.click();
  assert.deepEqual(app.navigations, ['/']);
  assert.equal(app.calls.some(call => call.url.includes('/auth/v1/logout')), false);
});

test('signed-out hosted users see login and cannot interact with the lab', async () => {
  const app = await boot({ loggedIn: false });
  assert.equal(app.element('login-screen').hidden, false);
  assert.equal(app.element('app-shell').attributes.inert, '');
  assert.equal(app.element('auth-signout').hidden, true);
});
