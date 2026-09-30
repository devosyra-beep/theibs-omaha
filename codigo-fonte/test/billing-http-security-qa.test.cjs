'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-billing-qa-'));
Object.assign(process.env, {
  THEIBS_AUTH_REQUIRED: 'true', THEIBS_TRIAL_DAYS: '3', THEIBS_PLAN_PRICE_BRL: '250',
  THEIBS_BILLING_ENV: 'development', THEIBS_PAYMENT_METHODS: 'PIX,CARD',
  THEIBS_BILLING_SCHEMA_VERIFIED: 'true',
  THEIBS_USER_DATA_ROOT: temporary, THEIBS_STORAGE_PERSISTENT: 'true',
  THEIBS_PUBLIC_ORIGIN: 'https://theibs.example', THEIBS_AUTH_GOOGLE_ENABLED: 'true',
  SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture', SUPABASE_SECRET_KEY: 'sb_secret_fixture',
  ABACATEPAY_API_KEY: 'dev_fixture', ABACATEPAY_PRODUCT_ID: 'prod_fixture',
  THEIBS_ABACATEPAY_WEBHOOK_SECRET: 'webhook_fixture'
});

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const users = new Map([['token-a', USER_A], ['token-b', USER_B]]);
const orders = new Map();
const outbound = [];
const nativeFetch = global.fetch;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status,
  headers: { 'content-type': 'application/json' } });

global.fetch = async (url, options = {}) => {
  const value = String(url);
  outbound.push({ url: value, method: options.method || 'GET', body: options.body });
  if (value.endsWith('/auth/v1/user')) {
    const token = String(options.headers?.Authorization || '').replace(/^Bearer /, '');
    const id = users.get(token);
    return id ? json({ id, email: `${id === USER_A ? 'a' : 'b'}@example.com`, created_at: '2026-09-01T00:00:00Z' }) : json({}, 401);
  }
  if (value.includes('/rest/v1/theibs_entitlements?')) return json([]);
  if (value.includes('/rest/v1/theibs_billing_environment?')) return json([{ environment: 'development' }]);
  if (value.includes('/v2/products/get?')) return json({ success: true, data: {
    id: 'prod_fixture', status: 'ACTIVE', price: 25000, currency: 'BRL', cycle: null, devMode: true
  } });
  if (value.includes('/rest/v1/theibs_payment_orders?')) {
    const query = new URL(value).searchParams;
    if (options.method === 'POST') {
      const record = JSON.parse(options.body)[0];
      orders.set(record.user_id, record);
      return json([record], 201);
    }
    if (options.method === 'PATCH') {
      const id = query.get('id')?.replace(/^eq\./, '');
      const current = [...orders.values()].find(item => item.id === id);
      if (!current) return json([]);
      Object.assign(current, JSON.parse(options.body));
      return json([current]);
    }
    const userId = query.get('user_id')?.replace(/^eq\./, '');
    const id = query.get('id')?.replace(/^eq\./, '');
    if (id) return json([...orders.values()].filter(item => item.id === id));
    return json(orders.has(userId) ? [orders.get(userId)] : []);
  }
  if (value.includes('/v2/transparents/create')) {
    const payload = JSON.parse(options.body);
    assert.equal(payload.method, 'PIX');
    assert.equal(payload.data.amount, 25000);
    return json({ success: true, data: { id: 'char_fixture', externalId: payload.data.externalId,
      amount: 25000, devMode: true, status: 'PENDING', brCode: '000201',
      brCodeBase64: 'AAAA', expiresAt: '2026-10-01T01:00:00Z' } });
  }
  if (value.includes('/v2/transparents/get?')) {
    const current = orders.get(USER_A);
    return json({ success: true, data: { id: 'char_fixture', externalId: current?.id,
      amount: 25000, devMode: true, status: 'PENDING', brCode: '000201',
      brCodeBase64: 'AAAA', expiresAt: '2026-10-01T01:00:00Z' } });
  }
  if (value.includes('/v2/transparents/list?')) return json({ success: true, data: [] });
  throw new Error(`Unexpected outbound request: ${value}`);
};

const { server } = require('../server');
let base;
test.before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  global.fetch = nativeFetch;
  await new Promise(resolve => server.close(resolve));
  const resolved = fs.realpathSync(temporary);
  if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) ||
    !path.basename(resolved).startsWith('theibs-billing-qa-')) throw new Error('Unsafe QA cleanup path.');
  fs.rmSync(resolved, { recursive: true, force: true });
});

const request = (route, token, options = {}) => nativeFetch(base + route, {
  ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
});

test('billing remains behind authentication, but expired users can inspect offer and buy', async () => {
  for (const route of ['/api/billing/offer', '/api/billing/order']) {
    assert.equal((await request(route)).status, 401);
  }
  assert.equal((await request('/api/billing/checkout', null,
    { method: 'POST', body: JSON.stringify({ method: 'PIX' }) })).status, 401);
  const access = await (await request('/api/access', 'token-a')).json();
  assert.equal(access.access.state, 'EXPIRED');
  assert.equal((await request('/api/workspace', 'token-a')).status, 402);
  const response = await request('/api/billing/offer', 'token-a');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.offer.priceCents, 25000);
  assert.deepEqual(body.offer.methods, ['PIX', 'CARD']);
});

test('client-submitted user, price and product cannot alter a server-owned PIX order', async () => {
  const response = await request('/api/billing/checkout', 'token-a', { method: 'POST', body: JSON.stringify({
    method: 'PIX', userId: USER_B, amountCents: 1, productId: 'prod_other'
  }) });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.order.amountCents, 25000);
  assert.equal(body.order.method, 'PIX');
  assert.equal(body.order.status, 'PENDING');
  assert.equal(orders.get(USER_A).user_id, USER_A);
  assert.equal(orders.get(USER_A).product_id, 'prod_fixture');
  assert.equal(orders.get(USER_A).amount_cents, 25000);
  assert.equal(orders.has(USER_B), false);
  assert.ok(body.order.pix.brCode && body.order.pix.brCodeBase64.startsWith('data:image/png;base64,'));
});

test('order lookup is scoped to the authenticated account and reopening does not create a charge', async () => {
  const priorCreates = outbound.filter(item => item.url.includes('/v2/transparents/create')).length;
  const own = await (await request('/api/billing/order', 'token-a')).json();
  const other = await (await request(`/api/billing/order?id=${orders.get(USER_A).id}`, 'token-b')).json();
  assert.equal(own.order.id, orders.get(USER_A).id);
  assert.equal(other.order, null);
  assert.equal(outbound.filter(item => item.url.includes('/v2/transparents/create')).length, priorCreates);
});

test('a return query or a forged access request does not grant paid access', async () => {
  const afterReturn = await (await request('/api/access?billing=success', 'token-a')).json();
  assert.equal(afterReturn.access.allowed, false);
  const mutation = await request('/api/access', 'token-a',
    { method: 'POST', body: JSON.stringify({ paid: true, status: 'PAID' }) });
  assert.notEqual(mutation.status, 200);
  const again = await (await request('/api/access', 'token-a')).json();
  assert.equal(again.access.state, 'EXPIRED');
});

test('webhook rejects missing, wrong and spoofed signatures before reading payment state', async () => {
  const payload = JSON.stringify({ id: 'log_hmac_fixture', apiVersion: 2, event: 'transparent.completed',
    devMode: true, data: { transparent: { id: 'char_fixture', externalId: orders.get(USER_A).id,
      amount: 1, devMode: true, status: 'PAID', methods: ['PIX'] } } });
  const signature = crypto.createHmac('sha256', require('../src/abacatepay').DEFAULT_HMAC_KEY)
    .update(Buffer.from(payload, 'utf8')).digest('base64');
  const route = '/api/billing/webhook?webhookSecret=webhook_fixture';
  const before = outbound.length;
  for (const [target, header] of [
    [route, {}], [route, { 'X-Webhook-Signature': 'forged' }],
    ['/api/billing/webhook?webhookSecret=wrong', { 'X-Webhook-Signature': signature }]
  ]) {
    const response = await request(target, null, { method: 'POST', body: payload, headers: header });
    assert.equal(response.status, 401);
  }
  assert.equal(outbound.length, before, 'invalid webhook authentication must not query the database or gateway');

  const authenticated = await request(route, null, { method: 'POST', body: payload,
    headers: { 'X-Webhook-Signature': signature } });
  assert.equal(authenticated.status, 502, 'valid signature reaches independent order/amount validation');
  assert.equal(outbound.some(item => item.url.includes('/rest/v1/rpc/theibs_apply_payment_event')), false);
});
