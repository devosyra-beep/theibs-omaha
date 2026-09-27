'use strict';

const { evaluateAccess } = require('./access-policy');

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
  if (!/^https:\/\/[^/]+\.supabase\.(co|net)$/.test(config.url)) throw new Error('SUPABASE_URL inválida ou ausente.');
  if (!config.publishableKey) throw new Error('SUPABASE_PUBLISHABLE_KEY ausente.');
  if (admin && !config.secretKey) throw new Error('SUPABASE_SECRET_KEY ausente no servidor.');
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
    billingEnabled: config.required && Boolean(env.ABACATEPAY_API_KEY && env.ABACATEPAY_PRODUCT_ID),
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
  try { return JSON.parse(text); } catch { throw new Error(`Resposta inválida do serviço (${response.status}).`); }
}

async function authenticateRequest(request, env = process.env, fetchImpl = fetch) {
  const config = settings(env);
  if (!config.required) return { user: { id: 'local', email: null, created_at: new Date(0).toISOString() }, local: true };
  validateSettings(config);
  const token = bearerToken(request);
  if (!token) { const error = new Error('Entre para continuar.'); error.statusCode = 401; throw error; }
  const response = await fetchImpl(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000)
  });
  const data = await readJson(response);
  if (!response.ok || !data?.id) { const error = new Error('Sessão inválida ou expirada.'); error.statusCode = 401; throw error; }
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
  if (!response.ok) throw new Error(`Não foi possível consultar o acesso (${response.status}).`);
  return Array.isArray(data) ? data[0] || null : null;
}

async function accessFor(auth, env = process.env, fetchImpl = fetch, now = Date.now()) {
  const config = settings(env);
  if (!config.required) return { allowed: true, state: 'LOCAL', reason: 'Modo local.', user: auth.user };
  const entitlement = await fetchEntitlement(auth.user.id, env, fetchImpl);
  return { ...evaluateAccess({ user: auth.user, entitlement, now, trialDays: config.trialDays,
    lifetimeEmails: config.lifetimeEmails, lifetimeUserIds: config.lifetimeUserIds }),
    user: { id: auth.user.id, email: auth.user.email || null } };
}

async function insertPaymentEvent(event, env = process.env, fetchImpl = fetch) {
  const config = settings(env);
  const response = await fetchImpl(`${config.url}/rest/v1/theibs_payment_events`, {
    method: 'POST', headers: adminHeaders(config, { 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' }),
    body: JSON.stringify([{ event_id: event.id, event_type: event.event, dev_mode: event.devMode === true, payload: event }]),
    signal: AbortSignal.timeout(10000)
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(`Não foi possível registrar o evento (${response.status}).`);
  return Array.isArray(data) && data.length > 0;
}

async function upsertEntitlement(record, env = process.env, fetchImpl = fetch) {
  const config = settings(env);
  const response = await fetchImpl(`${config.url}/rest/v1/theibs_entitlements?on_conflict=user_id`, {
    method: 'POST', headers: adminHeaders(config, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify([{ ...record, updated_at: new Date().toISOString() }]), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) { await response.text(); throw new Error(`Não foi possível atualizar o acesso (${response.status}).`); }
}

module.exports = { settings, publicConfig, validateSettings, bearerToken, authenticateRequest, fetchEntitlement, accessFor,
  insertPaymentEvent, upsertEntitlement };
