'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { publicConfig } = require('../src/supabase-service');
const { DEFAULT_HMAC_KEY, verifyWebhook, eventCharge, createCharge } = require('../src/abacatepay');

test('configuração pública nunca expõe as chaves secretas', () => {
  const result = publicConfig({ THEIBS_AUTH_REQUIRED: 'true', SUPABASE_URL: 'https://abc.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public', SUPABASE_SECRET_KEY: 'sb_secret_private', ABACATEPAY_API_KEY: 'private',
    ABACATEPAY_PRODUCT_ID: 'prod_1', THEIBS_AUTH_GOOGLE_ENABLED: 'true' });
  assert.equal(result.supabasePublishableKey, 'sb_publishable_public');
  assert.equal(result.providers.google, true); assert.equal(result.billingEnabled, false);
  assert.doesNotMatch(JSON.stringify(result), /sb_secret|ABACATE|private/);
});

test('webhook exige secret de URL e HMAC sobre o corpo bruto', () => {
  const raw = JSON.stringify({ id: 'log_1', event: 'subscription.completed', data: {} });
  const signature = crypto.createHmac('sha256', DEFAULT_HMAC_KEY).update(Buffer.from(raw)).digest('base64');
  const env = { THEIBS_ABACATEPAY_WEBHOOK_SECRET: 'route-secret', __webhookSecretFromRequest: 'route-secret' };
  assert.equal(verifyWebhook(raw, signature, env), true);
  assert.equal(verifyWebhook(raw + ' ', signature, env), false);
  assert.equal(verifyWebhook(raw, signature, { ...env, __webhookSecretFromRequest: 'wrong' }), false);
});

test('webhook only identifies a charge; account binding comes from the stored order', () => {
  const result = eventCharge({ apiVersion: 2, event: 'checkout.completed', data: {
    checkout: { id: 'bill_1', externalId: 'order-1', metadata: { userId: 'attacker' } }
  } });
  assert.deepEqual(result, { method: 'CARD', charge: { id: 'bill_1', externalId: 'order-1',
    metadata: { userId: 'attacker' } } });
  assert.equal(eventCharge({ event: 'checkout.completed', data: { checkout: { id: 'bill_1' } } }), null);
});

test('single-payment CARD checkout uses only the hosted provider and server-side product', async () => {
  let request;
  const fetchImpl = async (url, options) => { request = { url, options }; return new Response(JSON.stringify({ success: true, data: {
    id: 'bill_1', externalId: '11111111-1111-4111-8111-111111111111', amount: 25000,
    items: [{ id: 'prod_1', quantity: 1 }], url: 'https://app.abacatepay.com/pay/bill_1',
    status: 'PENDING', devMode: true } }), { status: 200 }); };
  const order = { id: '11111111-1111-4111-8111-111111111111', user_id: 'user-1', product_id: 'prod_1',
    amount_cents: 25000, method: 'CARD', environment: 'development' };
  const result = await createCharge(order, { id: 'user-1', email: 'a@b.com' }, {
    ABACATEPAY_API_KEY: 'secret-api', ABACATEPAY_PRODUCT_ID: 'prod_1',
    THEIBS_ABACATEPAY_WEBHOOK_SECRET: 'secret', THEIBS_PUBLIC_ORIGIN: 'https://theibs.example',
    THEIBS_PAYMENT_METHODS: 'CARD', THEIBS_BILLING_ENV: 'development', THEIBS_AUTH_REQUIRED: 'true',
    THEIBS_USER_DATA_ROOT: '/data/users', THEIBS_STORAGE_PERSISTENT: 'true', THEIBS_BILLING_SCHEMA_VERIFIED: 'true'
  }, fetchImpl);
  assert.equal(result.url, 'https://app.abacatepay.com/pay/bill_1');
  assert.equal(request.options.headers.Authorization, 'Bearer secret-api');
  const body = JSON.parse(request.options.body);
  assert.equal(body.externalId, order.id); assert.equal(body.metadata.theibsUserId, 'user-1');
  assert.deepEqual(body.methods, ['CARD']);
  assert.equal(body.completionUrl, 'https://theibs.example/app?billing=success');
  assert.equal(body.returnUrl, 'https://theibs.example/app?billing=cancelled');
});
