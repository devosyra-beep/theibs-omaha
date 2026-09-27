'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { publicConfig } = require('../src/supabase-service');
const { DEFAULT_HMAC_KEY, verifyWebhook, entitlementFromEvent, createPaymentCheckout } = require('../src/abacatepay');

test('configuração pública nunca expõe as chaves secretas', () => {
  const result = publicConfig({ THEIBS_AUTH_REQUIRED: 'true', SUPABASE_URL: 'https://abc.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public', SUPABASE_SECRET_KEY: 'sb_secret_private', ABACATEPAY_API_KEY: 'private',
    ABACATEPAY_PRODUCT_ID: 'prod_1', THEIBS_AUTH_GOOGLE_ENABLED: 'true' });
  assert.equal(result.supabasePublishableKey, 'sb_publishable_public');
  assert.equal(result.providers.google, true); assert.equal(result.billingEnabled, true);
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

test('pagamento confirmado vira acesso permanente pelo userId do metadata', () => {
  const result = entitlementFromEvent({ id: 'log_1', event: 'checkout.completed', data: {
    id: 'bill_1', metadata: { userId: '8c055cd3-a11e-4f53-88d5-f552aa1bbbbb' }
  } });
  assert.equal(result.user_id, '8c055cd3-a11e-4f53-88d5-f552aa1bbbbb');
  assert.equal(result.status, 'PAID'); assert.equal(result.access_kind, 'PURCHASE');
});

test('checkout de pagamento único mantém API key no servidor e referencia o usuário', async () => {
  let request;
  const fetchImpl = async (url, options) => { request = { url, options }; return new Response(JSON.stringify({ success: true, data: {
    id: 'bill_1', url: 'https://app.abacatepay.com/pay/bill_1', status: 'PENDING', devMode: true } }), { status: 200 }); };
  const result = await createPaymentCheckout({ id: 'user-1', email: 'a@b.com' }, {
    ABACATEPAY_API_KEY: 'secret-api', ABACATEPAY_PRODUCT_ID: 'prod_1', THEIBS_PUBLIC_ORIGIN: 'https://theibs.example'
  }, fetchImpl);
  assert.equal(result.url, 'https://app.abacatepay.com/pay/bill_1');
  assert.equal(request.options.headers.Authorization, 'Bearer secret-api');
  const body = JSON.parse(request.options.body);
  assert.equal(body.externalId, 'theibs:user-1'); assert.equal(body.metadata.userId, 'user-1');
  assert.deepEqual(body.methods, ['PIX', 'CARD']);
  assert.equal(body.metadata.license, 'LIFETIME');
  assert.equal(body.completionUrl, 'https://theibs.example/app?billing=success');
  assert.equal(body.returnUrl, 'https://theibs.example/app?billing=cancelled');
});
