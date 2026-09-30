'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const gateway = require('../src/abacatepay');
const billing = require('../src/billing-service');

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ENV = Object.freeze({
  THEIBS_AUTH_REQUIRED: 'true', THEIBS_PLAN_PRICE_BRL: '250',
  THEIBS_BILLING_ENV: 'development', THEIBS_PAYMENT_METHODS: 'PIX,CARD',
  THEIBS_BILLING_SCHEMA_VERIFIED: 'true',
  THEIBS_USER_DATA_ROOT: '/data/users', THEIBS_STORAGE_PERSISTENT: 'true',
  THEIBS_PUBLIC_ORIGIN: 'https://theibs.example',
  SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture', SUPABASE_SECRET_KEY: 'sb_secret_fixture',
  ABACATEPAY_API_KEY: 'dev_fixture', ABACATEPAY_PRODUCT_ID: 'prod_fixture',
  THEIBS_ABACATEPAY_WEBHOOK_SECRET: 'webhook_fixture'
});
const product = { id: 'prod_fixture', status: 'ACTIVE', price: 25000, currency: 'BRL', cycle: null, devMode: true };
const order = (overrides = {}) => ({ id: ORDER_ID, user_id: USER_ID, product_id: 'prod_fixture',
  amount_cents: 25000, environment: 'development', method: 'PIX', status: 'PENDING',
  provider_charge_id: 'char_fixture', ...overrides });
const charge = (overrides = {}) => ({ id: 'char_fixture', externalId: ORDER_ID,
  amount: 25000, devMode: true, status: 'PAID', methods: ['PIX'], brCode: '000201',
  brCodeBase64: 'data:image/png;base64,AAAA', expiresAt: '2026-10-01T01:00:00Z', ...overrides });
const event = (overrides = {}) => ({ id: 'log_fixture', apiVersion: 2, event: 'transparent.completed',
  devMode: true, data: { transparent: charge() }, ...overrides });
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const environmentRow = (url) => String(url).includes('/rest/v1/theibs_billing_environment?')
  ? reply([{ environment: 'development' }]) : null;

test('payment methods stay unavailable until explicit complete server configuration', () => {
  assert.deepEqual(gateway.billingConfig({ ...ENV, THEIBS_PAYMENT_METHODS: '' }).methods, []);
  assert.deepEqual(gateway.billingConfig({ ...ENV, THEIBS_STORAGE_PERSISTENT: 'false' }).methods, []);
  assert.deepEqual(gateway.billingConfig({ ...ENV, THEIBS_BILLING_ENV: '' }).methods, []);
  assert.deepEqual(gateway.billingConfig({ ...ENV, THEIBS_BILLING_SCHEMA_VERIFIED: '' }).methods, []);
  assert.deepEqual(gateway.billingConfig({ ...ENV, ABACATEPAY_API_KEY: '' }).methods, []);
  assert.deepEqual(gateway.billingConfig(ENV).methods, ['PIX', 'CARD']);
  assert.throws(() => gateway.billingConfig({ ...ENV, THEIBS_PAYMENT_METHODS: 'PIX,CARD,PIX' }), /without duplicates/);
  assert.throws(() => gateway.billingConfig({ ...ENV, THEIBS_PAYMENT_METHODS: 'BOLETO' }), /PIX and\/or CARD/);
});

test('offer refuses a mismatched gateway product and hides purchase for a paid account', async () => {
  for (const changed of [{ price: 24999 }, { cycle: 'MONTHLY' }, { devMode: false },
    { currency: 'USD' }, { status: 'INACTIVE' }]) {
    const fetchImpl = async (url) => environmentRow(url) || reply({ success: true, data: { ...product, ...changed } });
    await assert.rejects(billing.offer({ state: 'EXPIRED' }, ENV, fetchImpl), /does not match the offer/);
  }
  const fetchImpl = async () => { throw new Error('Paid account must not reach gateway'); };
  const paid = await billing.offer({ state: 'ACTIVE' }, ENV, fetchImpl);
  assert.equal(paid.available, false);
  assert.deepEqual(paid.methods, []);
});

test('a development gateway cannot offer payment against a production database', async () => {
  let orderCalls = 0;
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('/v2/products/get?')) return reply({ success: true, data: product });
    if (value.includes('/rest/v1/theibs_billing_environment?')) return reply([{ environment: 'production' }]);
    if (value.includes('/rest/v1/theibs_payment_orders?')) orderCalls++;
    throw new Error(`Unexpected request: ${value}`);
  };
  await assert.rejects(billing.offer({ state: 'EXPIRED' }, ENV, fetchImpl), /environment does not match/);
  assert.equal(orderCalls, 0);
});

test('charge validation rejects account/order, amount, product and environment substitutions', () => {
  const config = gateway.billingConfig(ENV);
  for (const changed of [{ amount: 1 }, { devMode: false }, { externalId: OTHER_ID }]) {
    assert.throws(() => gateway.assertCharge(charge(changed), order(), config), /do not match/);
  }
  const cardOrder = order({ method: 'CARD', provider_charge_id: 'bill_fixture' });
  const cardCharge = { ...charge({ id: 'bill_fixture', methods: ['CARD'] }), items: [{ id: 'prod_fixture', quantity: 1 }] };
  assert.equal(gateway.assertCharge(cardCharge, cardOrder, config), cardCharge);
  assert.throws(() => gateway.assertCharge({ ...cardCharge, items: [{ id: 'prod_other', quantity: 1 }] }, cardOrder, config), /product/);
  assert.throws(() => gateway.assertCharge({ ...cardCharge, items: [{ id: 'prod_fixture', quantity: 2 }] }, cardOrder, config), /product/);
});

test('a signed-looking event still requires the original order and independent gateway confirmation', async () => {
  const cases = [
    { name: 'sandbox event into production order', event: event({ devMode: false }) },
    { name: 'wrong amount', event: event({ data: { transparent: charge({ amount: 24999 }) } }) },
    { name: 'wrong provider charge', event: event({ data: { transparent: charge({ id: 'char_other' }) } }) },
    { name: 'wrong product', order: order({ product_id: 'prod_other' }) },
    { name: 'wrong environment', order: order({ environment: 'production' }) },
    { name: 'gateway still pending', provider: charge({ status: 'PENDING' }) }
  ];
  for (const scenario of cases) {
    let rpcCalls = 0;
    const fetchImpl = async (url) => {
      const value = String(url);
      if (environmentRow(url)) return environmentRow(url);
      if (value.includes('/rest/v1/theibs_payment_orders?')) return reply([scenario.order || order()]);
      if (value.includes('/v2/transparents/get?')) return reply({ success: true, data: scenario.provider || charge() });
      if (value.includes('/rest/v1/rpc/theibs_apply_payment_event')) {
        rpcCalls++;
        return reply({ duplicate: false, status: 'PAID' });
      }
      throw new Error(`Unexpected request: ${value}`);
    };
    await assert.rejects(billing.applyWebhook(scenario.event || event(), ENV, fetchImpl),
      undefined, scenario.name);
    assert.equal(rpcCalls, 0, `${scenario.name} must not mutate entitlement`);
  }
  let rpcCalls = 0;
  const fetchImpl = async (url, options) => {
    const value = String(url);
    if (environmentRow(url)) return environmentRow(url);
    if (value.includes('/rest/v1/theibs_payment_orders?')) return reply([order()]);
    if (value.includes('/v2/transparents/get?')) return reply({ success: true, data: charge() });
    if (value.includes('/rest/v1/rpc/theibs_apply_payment_event')) {
      rpcCalls++;
      assert.equal(JSON.parse(options.body).p_order_id, ORDER_ID);
      return reply({ duplicate: false, status: 'PAID' });
    }
    throw new Error(`Unexpected request: ${value}`);
  };
  assert.deepEqual(await billing.applyWebhook(event(), ENV, fetchImpl), { duplicate: false, status: 'PAID' });
  assert.equal(rpcCalls, 1);
});

test('only v2 payment events with a provider checkout can reach payment processing', () => {
  assert.equal(gateway.eventCharge(event({ apiVersion: 1 })), null);
  assert.equal(gateway.eventCharge(event({ event: 'subscription.completed' })), null);
  assert.equal(gateway.eventCharge(event({ data: { transparent: charge({ externalId: '' }) } })), null);
  assert.deepEqual(gateway.eventCharge(event()).method, 'PIX');
});

test('a creating order is recovered by externalId without creating a second charge', async () => {
  let postCount = 0;
  const creating = order({ status: 'CREATING', provider_charge_id: null });
  const pending = charge({ status: 'PENDING', brCode: '000201',
    brCodeBase64: 'data:image/png;base64,AAAA', expiresAt: '2026-10-01T01:00:00Z' });
  const fetchImpl = async (url, options = {}) => {
    const value = String(url);
    if (options.method === 'POST') postCount++;
    if (value.includes('/v2/transparents/list?externalId=')) return reply({ success: true, data: [pending] });
    if (value.includes('/rest/v1/theibs_payment_orders?') && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      assert.equal(body.provider_charge_id, pending.id);
      return reply([{ ...creating, ...body }]);
    }
    if (value.includes('/v2/transparents/get?')) return reply({ success: true, data: pending });
    throw new Error(`Unexpected request: ${value}`);
  };
  const result = await billing.reconcileOrder(creating, ENV, fetchImpl);
  assert.equal(result.provider_charge_id, pending.id);
  assert.equal(result.status, 'PENDING');
  assert.equal(postCount, 0);
});

test('an unconfirmed creating order fails closed and does not create another charge', async () => {
  let postCount = 0;
  const creating = order({ status: 'CREATING', provider_charge_id: null });
  const fetchImpl = async (url, options = {}) => {
    if (options.method === 'POST') postCount++;
    if (String(url).includes('/v2/transparents/list?externalId=')) return reply({ success: true, data: [] });
    throw new Error(`Unexpected request: ${url}`);
  };
  assert.deepEqual(await billing.reconcileOrder(creating, ENV, fetchImpl), creating);
  assert.equal(postCount, 0);
});
