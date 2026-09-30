'use strict';

const crypto = require('node:crypto');

const API_BASE = 'https://api.abacatepay.com/v2';
// Published by AbacatePay for v2 HMAC verification. The URL secret is private.
const DEFAULT_HMAC_KEY = 't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';
const VALID_METHODS = new Set(['PIX', 'CARD']);
const PRODUCTION_SUPABASE_REF = 'kevcwoeqgdwvfsvdpghe';

function configuredMethods(env = process.env) {
  const methods = String(env.THEIBS_PAYMENT_METHODS || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
  if (new Set(methods).size !== methods.length || methods.some(x => !VALID_METHODS.has(x))) {
    throw new Error('THEIBS_PAYMENT_METHODS must list PIX and/or CARD without duplicates.');
  }
  return methods;
}

function billingConfig(env = process.env) {
  const methods = configuredMethods(env);
  const priceBrl = Number(env.THEIBS_PLAN_PRICE_BRL || 250);
  if (!Number.isFinite(priceBrl) || priceBrl <= 0 || !Number.isInteger(priceBrl * 100)) {
    throw new Error('THEIBS_PLAN_PRICE_BRL is invalid.');
  }
  const configured = Boolean(env.ABACATEPAY_API_KEY && env.ABACATEPAY_PRODUCT_ID && env.THEIBS_ABACATEPAY_WEBHOOK_SECRET &&
    env.THEIBS_USER_DATA_ROOT && env.THEIBS_STORAGE_PERSISTENT === 'true' && env.THEIBS_AUTH_REQUIRED === 'true' &&
    env.THEIBS_BILLING_SCHEMA_VERIFIED === 'true' &&
    !(env.THEIBS_BILLING_ENV === 'development' && String(env.SUPABASE_URL || '').includes(PRODUCTION_SUPABASE_REF)) &&
    ['development', 'production'].includes(env.THEIBS_BILLING_ENV) && methods.length);
  return { configured, methods: configured ? methods : [], productId: env.ABACATEPAY_PRODUCT_ID || null,
    priceCents: Math.round(priceBrl * 100), currency: 'BRL', environment: env.THEIBS_BILLING_ENV || null,
    devMode: env.THEIBS_BILLING_ENV === 'development' };
}

async function gateway(path, { method = 'GET', body, env = process.env, fetchImpl = fetch } = {}) {
  const key = String(env.ABACATEPAY_API_KEY || '').trim();
  if (!key) throw Object.assign(new Error('Payment is not configured.'), { statusCode: 503 });
  let response;
  try {
    response = await fetchImpl(API_BASE + path, { method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  } catch { throw Object.assign(new Error('Payment service is temporarily unavailable.'), { statusCode: 503 }); }
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  if (response.status === 404) throw Object.assign(new Error('Payment was not found.'), { statusCode: 404 });
  if (!response.ok || !payload?.success || !payload?.data) {
    throw Object.assign(new Error('Payment service is temporarily unavailable.'), { statusCode: 503 });
  }
  return payload.data;
}

async function verifiedProduct(env = process.env, fetchImpl = fetch) {
  const config = billingConfig(env);
  if (!config.configured) throw Object.assign(new Error('Payment is not configured.'), { statusCode: 503 });
  const product = await gateway(`/products/get?id=${encodeURIComponent(config.productId)}`, { env, fetchImpl });
  if (product.id !== config.productId || product.status !== 'ACTIVE' || product.currency !== 'BRL' ||
    product.cycle != null || Number(product.price) !== config.priceCents || product.devMode !== config.devMode) {
    throw Object.assign(new Error('The configured payment product does not match the offer.'), { statusCode: 503 });
  }
  return { product, config };
}

function assertCharge(charge, order, config) {
  if (!charge?.id || Number(charge.amount) !== order.amount_cents || charge.devMode !== config.devMode ||
    (charge.externalId && charge.externalId !== order.id)) {
    throw Object.assign(new Error('Payment details do not match the order.'), { statusCode: 502 });
  }
  if ((charge.frequency && charge.frequency !== 'ONE_TIME') ||
    (charge.methods && (!Array.isArray(charge.methods) || !charge.methods.includes(order.method))) ||
    (charge.status === 'PAID' && charge.paidAmount != null && Number(charge.paidAmount) !== order.amount_cents)) {
    throw Object.assign(new Error('Payment terms do not match the order.'), { statusCode: 502 });
  }
  if (order.method === 'CARD' && (!Array.isArray(charge.items) || charge.items.length !== 1 ||
    charge.items[0].id !== order.product_id || Number(charge.items[0].quantity) !== 1)) {
    throw Object.assign(new Error('Payment product does not match the order.'), { statusCode: 502 });
  }
  return charge;
}

function origin(env) {
  const value = String(env.THEIBS_PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL || '').trim();
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) || url.username || url.password) {
    throw new Error('A valid HTTPS public origin is required.');
  }
  return url.origin;
}

function normalizePixQr(charge) {
  const raw = String(charge.brCodeBase64 || '');
  const base64 = raw.startsWith('data:image/png;base64,') ? raw.slice('data:image/png;base64,'.length) : raw;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 350000 ||
    typeof charge.brCode !== 'string' || !charge.brCode || charge.brCode.length > 4096) {
    throw Object.assign(new Error('PIX payment details are incomplete.'), { statusCode: 502 });
  }
  return { ...charge, brCodeBase64: `data:image/png;base64,${base64}` };
}

async function createCharge(order, user, env = process.env, fetchImpl = fetch) {
  const config = billingConfig(env);
  if (!config.methods.includes(order.method) || order.product_id !== config.productId ||
    order.amount_cents !== config.priceCents || order.environment !== config.environment || order.user_id !== user.id) {
    throw Object.assign(new Error('Payment order does not match the offer.'), { statusCode: 409 });
  }
  let charge;
  if (order.method === 'PIX') {
    charge = await gateway('/transparents/create', { method: 'POST', env, fetchImpl, body: { method: 'PIX',
      data: { amount: config.priceCents, expiresIn: 3600, externalId: order.id,
        description: 'THEIBS permanent access', metadata: { theibsOrderId: order.id, theibsProductId: config.productId } } } });
    charge = normalizePixQr(charge);
    if (!charge.expiresAt) throw Object.assign(new Error('PIX payment details are incomplete.'), { statusCode: 502 });
  } else {
    const publicOrigin = origin(env);
    charge = await gateway('/checkouts/create', { method: 'POST', env, fetchImpl, body: {
      items: [{ id: config.productId, quantity: 1 }], methods: ['CARD'], externalId: order.id,
      completionUrl: `${publicOrigin}/app?billing=success`, returnUrl: `${publicOrigin}/app?billing=cancelled`,
      metadata: { theibsOrderId: order.id, theibsProductId: config.productId, theibsUserId: user.id }
    } });
    if (!/^https:\/\/app\.abacatepay\.com\/pay\//.test(String(charge.url || ''))) {
      throw Object.assign(new Error('Hosted checkout URL is invalid.'), { statusCode: 502 });
    }
  }
  return assertCharge(charge, order, config);
}

async function findChargeByOrder(order, env = process.env, fetchImpl = fetch) {
  const config = billingConfig(env);
  if (!config.configured) return null;
  try {
    if (order.method === 'CARD') {
      const charge = await gateway(`/checkouts/get?externalId=${encodeURIComponent(order.id)}`, { env, fetchImpl });
      return assertCharge(charge, order, config);
    }
    const data = await gateway(`/transparents/list?externalId=${encodeURIComponent(order.id)}`, { env, fetchImpl });
    const charges = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
    const charge = charges.find(item => item.externalId === order.id);
    return charge ? assertCharge(normalizePixQr(charge), order, config) : null;
  } catch (error) {
    if (error.statusCode === 404) return null;
    throw error;
  }
}

async function getCharge(order, env = process.env, fetchImpl = fetch) {
  const config = billingConfig(env);
  if (!order.provider_charge_id || !config.configured) throw Object.assign(new Error('Payment order is unavailable.'), { statusCode: 503 });
  const path = order.method === 'PIX' ? '/transparents/get' : '/checkouts/get';
  const charge = await gateway(`${path}?id=${encodeURIComponent(order.provider_charge_id)}`, { env, fetchImpl });
  if (charge.id !== order.provider_charge_id) throw Object.assign(new Error('Payment ID does not match the order.'), { statusCode: 502 });
  return assertCharge(order.method === 'PIX' ? normalizePixQr(charge) : charge, order, config);
}

function verifyWebhook(rawBody, signature, env = process.env) {
  const secret = String(env.THEIBS_ABACATEPAY_WEBHOOK_SECRET || '');
  const supplied = String(env.__webhookSecretFromRequest || '');
  const a = Buffer.from(secret), b = Buffer.from(supplied);
  if (!secret || !supplied || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const expected = crypto.createHmac('sha256', env.ABACATEPAY_HMAC_KEY || DEFAULT_HMAC_KEY)
    .update(Buffer.from(rawBody, 'utf8')).digest('base64');
  const x = Buffer.from(expected), y = Buffer.from(String(signature || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function eventCharge(event) {
  if (event?.apiVersion !== 2 || !/^(checkout|transparent)\.(completed|refunded|disputed|lost)$/.test(String(event.event || ''))) return null;
  const method = event.event.startsWith('transparent.') ? 'PIX' : 'CARD';
  const charge = method === 'PIX' ? event.data?.transparent : event.data?.checkout;
  if (!charge?.id || !charge?.externalId) return null;
  return { method, charge };
}

function eventStatus(event) {
  if (event.event.endsWith('.completed')) return 'PAID';
  if (event.event.endsWith('.refunded')) return 'REFUNDED';
  return 'DISPUTED';
}

module.exports = { API_BASE, DEFAULT_HMAC_KEY, billingConfig, configuredMethods, verifiedProduct, createCharge,
  getCharge, findChargeByOrder, assertCharge, verifyWebhook, eventCharge, eventStatus };
