'use strict';

const crypto = require('node:crypto');
const { evaluateAccess } = require('./access-policy');
const { billingConfig } = require('./abacatepay');

function trimSlash(value) { return String(value || '').trim().replace(/\/+$/, ''); }
function isTrue(value) { return /^(1|true|yes|on)$/i.test(String(value || '')); }

function settings(env = process.env) {
  return {
    required: isTrue(env.THEIBS_AUTH_REQUIRED),
    url: trimSlash(env.SUPABASE_URL),
    publishableKey: String(env.SUPABASE_PUBLISHABLE_KEY || '').trim(),
    secretKey: String(env.SUPABASE_SECRET_KEY || '').trim(),
    trialDays: Math.max(1, Number(env.THEIBS_TRIAL_DAYS || 3) || 3),
    lifetimeEmails: String(env.THEIBS_LIFETIME_EMAILS || 'devosyra@gmail.com,ninjadevtester@gmail.com'),
    lifetimeUserIds: String(env.THEIBS_LIFETIME_USER_IDS || ''),
    googleEnabled: isTrue(env.THEIBS_AUTH_GOOGLE_ENABLED)
  };
}

function validateSettings(config, { admin = false } = {}) {
  if (!config.required) return;
  if (!/^https:\/\/[^/]+\.supabase\.(co|net)$/.test(config.url)) throw new Error('SUPABASE_URL is invalid or missing.');
  if (!config.publishableKey) throw new Error('SUPABASE_PUBLISHABLE_KEY is missing.');
  // Only publishable keys may reach publicConfig and the browser. Reject a
  // misplaced server secret (including legacy service-role JWTs) before use.
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey)) {
    throw new Error('SUPABASE_PUBLISHABLE_KEY must be a publishable key starting with sb_publishable_.');
  }
  if (admin && !config.secretKey) throw new Error('SUPABASE_SECRET_KEY is missing on the server.');
  if (admin && !/^sb_secret_[A-Za-z0-9_-]+$/.test(config.secretKey)) {
    throw new Error('SUPABASE_SECRET_KEY must be a server key starting with sb_secret_.');
  }
}

function publicConfig(env = process.env) {
  const config = settings(env);
  if (config.required) validateSettings(config);
  return {
    required: config.required,
    supabaseUrl: config.required ? config.url : null,
    supabasePublishableKey: config.required ? config.publishableKey : null,
    providers: { google: config.required && config.googleEnabled },
    trialDays: config.trialDays,
    billingEnabled: config.required && billingConfig(env).configured,
    planPriceBrl: Number(env.THEIBS_PLAN_PRICE_BRL || 250)
  };
}

function bearerToken(request) {
  const match = /^Bearer\s+(.+)$/i.exec(String(request.headers.authorization || ''));
  return match?.[1]?.trim() || null;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { throw new Error(`Invalid service response (${response.status}).`); }
}

async function authenticateRequest(request, env = process.env, fetchImpl = fetch) {
  const config = settings(env);
  if (!config.required) return { user: { id: 'local', email: null, created_at: new Date(0).toISOString() }, local: true };
  validateSettings(config);
  const token = bearerToken(request);
  if (!token) { const error = new Error('Sign in to continue.'); error.statusCode = 401; throw error; }
  const unavailable = () => Object.assign(new Error('Authentication is temporarily unavailable. Please try again.'), { statusCode: 503, code: 'AUTH_SERVICE_UNAVAILABLE' });
  let response;
  try {
    response = await fetchImpl(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
  } catch { throw unavailable(); }
  if (!response.ok) {
    // An outage/rate limit must not masquerade as a rejected login: the web
    // client only refreshes/retries on 401. No protected handler has run yet.
    await response.body?.cancel().catch(() => {});
    if (response.status === 401) throw Object.assign(new Error('Session is invalid or expired.'), { statusCode: 401, code: 'AUTH_REJECTED' });
    if (response.status === 403) throw Object.assign(new Error('Authentication service denied this access.'), { statusCode: 403, code: 'AUTH_FORBIDDEN' });
    throw unavailable();
  }
  let data;
  try { data = await readJson(response); } catch { throw unavailable(); }
  if (typeof data?.id !== 'string' || !data.id.trim()) throw unavailable();
  return { user: data, token, local: false };
}

function adminHeaders(config, extra = {}) {
  validateSettings(config, { admin: true });
  return { apikey: config.secretKey, Accept: 'application/json', ...extra };
}

async function fetchEntitlement(userId, env = process.env, fetchImpl = fetch) {
  const config = settings(env);
  if (!config.required) return null;
  const url = `${config.url}/rest/v1/theibs_entitlements?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`;
  const response = await fetchImpl(url, { headers: adminHeaders(config), signal: AbortSignal.timeout(10000) });
  const data = await readJson(response);
  if (!response.ok) throw new Error(`Could not check access (${response.status}).`);
  return Array.isArray(data) ? data[0] || null : null;
}

async function accessFor(auth, env = process.env, fetchImpl = fetch, now = Date.now()) {
  const config = settings(env);
  if (!config.required) return { allowed: true, state: 'LOCAL', reason: 'Local mode.', user: auth.user };
  const entitlement = await fetchEntitlement(auth.user.id, env, fetchImpl);
  return { ...evaluateAccess({ user: auth.user, entitlement, now, trialDays: config.trialDays,
    lifetimeEmails: config.lifetimeEmails, lifetimeUserIds: config.lifetimeUserIds }),
    user: { id: auth.user.id, email: auth.user.email || null } };
}

async function orderRequest(path, { method = 'GET', body, prefer, env = process.env, fetchImpl = fetch } = {}) {
  const config = settings(env);
  const response = await fetchImpl(`${config.url}/rest/v1/${path}`, {
    method, headers: adminHeaders(config, { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(prefer ? { Prefer: prefer } : {}) }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000)
  });
  const data = await readJson(response);
  return { status: response.status, ok: response.ok, data };
}

async function assertBillingEnvironment(expected, env = process.env, fetchImpl = fetch) {
  const result = await orderRequest('theibs_billing_environment?singleton=eq.true&select=environment&limit=1',
    { env, fetchImpl });
  if (!result.ok || result.data?.[0]?.environment !== expected) {
    throw Object.assign(new Error('Payment environment does not match the database.'), { statusCode: 503 });
  }
}

async function findOrderById(id, env = process.env, fetchImpl = fetch) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const result = await orderRequest(`theibs_payment_orders?id=eq.${encodeURIComponent(id)}&select=*&limit=1`, { env, fetchImpl });
  if (!result.ok) throw new Error(`Could not read payment order (${result.status}).`);
  return result.data?.[0] || null;
}

async function latestOrder(userId, env = process.env, fetchImpl = fetch) {
  const result = await orderRequest(`theibs_payment_orders?user_id=eq.${encodeURIComponent(userId)}&select=*&order=created_at.desc&limit=1`, { env, fetchImpl });
  if (!result.ok) throw new Error(`Could not read payment order (${result.status}).`);
  return result.data?.[0] || null;
}

async function activeOrder(userId, productId, environment, env = process.env, fetchImpl = fetch) {
  const query = `theibs_payment_orders?user_id=eq.${encodeURIComponent(userId)}&product_id=eq.${encodeURIComponent(productId)}&environment=eq.${encodeURIComponent(environment)}&status=in.(CREATING,PENDING,PAID)&select=*&order=created_at.desc&limit=1`;
  const result = await orderRequest(query, { env, fetchImpl });
  if (!result.ok) throw new Error(`Could not read payment order (${result.status}).`);
  return result.data?.[0] || null;
}

async function reserveOrder({ userId, method, productId, priceCents, environment }, env = process.env, fetchImpl = fetch) {
  const existing = await activeOrder(userId, productId, environment, env, fetchImpl);
  if (existing) return { order: existing, created: false };
  const record = { id: crypto.randomUUID(), user_id: userId, method, product_id: productId,
    amount_cents: priceCents, environment, status: 'CREATING' };
  const result = await orderRequest('theibs_payment_orders?select=*', { method: 'POST', body: [record],
    prefer: 'return=representation', env, fetchImpl });
  if (result.ok && result.data?.[0]) return { order: result.data[0], created: true };
  if (result.status === 409) {
    const raced = await activeOrder(userId, productId, environment, env, fetchImpl);
    if (raced) return { order: raced, created: false };
  }
  throw new Error(`Could not reserve payment order (${result.status}).`);
}

async function setOrderCharge(orderId, charge, method, env = process.env, fetchImpl = fetch) {
  const body = { provider_charge_id: charge.id, status: 'PENDING',
    provider_url: method === 'CARD' ? charge.url : null, expires_at: method === 'PIX' ? charge.expiresAt : null,
    pix_br_code: method === 'PIX' ? charge.brCode : null,
    pix_qr_base64: method === 'PIX' ? charge.brCodeBase64 : null, updated_at: new Date().toISOString() };
  // Completion can only consume this server-reserved, still-CREATING order.
  const result = await orderRequest(`theibs_payment_orders?id=eq.${encodeURIComponent(orderId)}&status=eq.CREATING&select=*`, {
    method: 'PATCH', body, prefer: 'return=representation', env, fetchImpl
  });
  if (!result.ok || !result.data?.[0]) throw new Error('Could not save payment order.');
  return result.data[0];
}

async function processPaymentEvent({ orderId, eventId, eventType, status, providerChargeId, payload },
  env = process.env, fetchImpl = fetch) {
  const result = await orderRequest('rpc/theibs_apply_payment_event', { method: 'POST',
    body: { p_order_id: orderId, p_event_id: eventId, p_event_type: eventType, p_status: status,
      p_provider_charge_id: providerChargeId, p_payload: payload },
    env, fetchImpl });
  if (!result.ok) throw new Error(`Could not process payment event (${result.status}).`);
  return result.data;
}

module.exports = { settings, publicConfig, validateSettings, bearerToken, authenticateRequest, fetchEntitlement, accessFor,
  assertBillingEnvironment, findOrderById, latestOrder, activeOrder, reserveOrder, setOrderCharge,
  processPaymentEvent };
