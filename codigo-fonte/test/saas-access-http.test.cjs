'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-saas-'));
process.env.THEIBS_AUTH_REQUIRED = 'true';
process.env.SUPABASE_URL = 'https://testproject.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
process.env.THEIBS_AUTH_GOOGLE_ENABLED = 'true';
process.env.THEIBS_USER_DATA_ROOT = temp;
process.env.THEIBS_LIFETIME_EMAILS = 'devosyra@gmail.com';
process.env.THEIBS_TRIAL_DAYS = '3';

const originalFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  const value = String(url);
  if (value.endsWith('/auth/v1/user')) {
    if (options.headers?.Authorization !== 'Bearer valid-jwt') return new Response('{}', { status: 401 });
    return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', email: 'new@example.com', created_at: new Date().toISOString() }), { status: 200 });
  }
  if (value.includes('/rest/v1/theibs_entitlements')) {
    assert.equal(options.headers.apikey, 'sb_secret_test');
    assert.equal(options.headers.Authorization, undefined);
    return new Response('[]', { status: 200 });
  }
  return originalFetch(url, options);
};

const { server, userStoragePath } = require('../server');
let origin;

test.before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { global.fetch = originalFetch; await new Promise(resolve => server.close(resolve)); });

test('configuração pública expõe somente chave publicável e preço único', async () => {
  const response = await originalFetch(origin + '/api/public-config');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.auth.required, true); assert.equal(body.auth.planPriceBrl, 250);
  assert.equal(body.auth.supabasePublishableKey, 'sb_publishable_test');
  assert.doesNotMatch(JSON.stringify(body), /sb_secret_test/);
});

test('API recusa visitante e libera usuário dentro dos três dias', async () => {
  const rejected = await originalFetch(origin + '/api/access');
  assert.equal(rejected.status, 401);
  const accepted = await originalFetch(origin + '/api/access', { headers: { Authorization: 'Bearer valid-jwt' } });
  const body = await accepted.json();
  assert.equal(accepted.status, 200); assert.equal(body.access.state, 'TRIAL'); assert.equal(body.access.allowed, true);
});

test('hosting health check is public and exposes no configuration or user data', async () => {
  const response = await originalFetch(origin + '/healthz');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'OK' });
  assert.equal((await originalFetch(origin + '/api/access')).status, 401);
});

test('sessão e rascunho recebem caminho isolado por usuário', () => {
  const first = userStoragePath({ user: { id: 'user-a' } }, 'workspace.json');
  const second = userStoragePath({ user: { id: 'user-b' } }, 'workspace.json');
  assert.notEqual(first, second); assert.equal(path.dirname(path.dirname(first)), temp);
  assert.match(path.basename(path.dirname(first)), /^[a-f0-9]{64}$/);
});
