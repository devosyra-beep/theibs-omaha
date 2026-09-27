'use strict';

const crypto = require('node:crypto');

const API_BASE = 'https://api.abacatepay.com/v2';
const DEFAULT_HMAC_KEY = 't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';

function required(env, name) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`${name} ausente no servidor.`);
  return value;
}

function safePublicOrigin(env) {
  const value = required(env, 'THEIBS_PUBLIC_ORIGIN').replace(/\/+$/, '');
  const url = new URL(value);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('THEIBS_PUBLIC_ORIGIN deve usar HTTPS.');
  return url.origin;
}

async function createPaymentCheckout(user, env = process.env, fetchImpl = fetch) {
  if (!user?.id) throw new Error('Usuário autenticado ausente.');
  const apiKey = required(env, 'ABACATEPAY_API_KEY');
  const productId = required(env, 'ABACATEPAY_PRODUCT_ID');
  const origin = safePublicOrigin(env);
  const response = await fetchImpl(`${API_BASE}/checkouts/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      items: [{ id: productId, quantity: 1 }], methods: ['PIX', 'CARD'], externalId: `theibs:${user.id}`,
      completionUrl: `${origin}/?billing=success`, returnUrl: `${origin}/?billing=cancelled`,
      metadata: { userId: user.id, email: user.email || null, product: 'THEIBS', license: 'LIFETIME' }
    }), signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok || !payload?.success || !payload?.data?.url) throw new Error(payload?.error || `Checkout indisponível (${response.status}).`);
  return { id: payload.data.id, url: payload.data.url, status: payload.data.status || 'PENDING', devMode: payload.data.devMode === true };
}

function verifyWebhook(rawBody, signature, env = process.env) {
  const secret = required(env, 'THEIBS_ABACATEPAY_WEBHOOK_SECRET');
  const suppliedSecret = String(env.__webhookSecretFromRequest || '');
  const secretBuffer = Buffer.from(secret), suppliedBuffer = Buffer.from(suppliedSecret);
  if (!suppliedSecret || secretBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(secretBuffer, suppliedBuffer)) return false;
  const expected = crypto.createHmac('sha256', env.ABACATEPAY_HMAC_KEY || DEFAULT_HMAC_KEY).update(Buffer.from(rawBody, 'utf8')).digest('base64');
  const actual = String(signature || '');
  const a = Buffer.from(expected), b = Buffer.from(actual);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function candidateObjects(event) {
  const data = event?.data || {};
  return [data, data.checkout, data.subscription, data.subscription?.checkout, data.billing, data.payment].filter(Boolean);
}

function userIdFromEvent(event) {
  for (const item of candidateObjects(event)) {
    const userId = item.metadata?.userId || item.metadata?.user_id;
    if (userId) return String(userId);
    const external = String(item.externalId || '');
    if (external.startsWith('theibs:')) return external.slice(7);
  }
  return null;
}

function entitlementFromEvent(event) {
  const userId = userIdFromEvent(event);
  if (!userId) return null;
  const type = String(event.event || '');
  const objects = candidateObjects(event);
  const subscription = objects.find(item => String(item.id || '').startsWith('subs_')) || {};
  const checkout = objects.find(item => String(item.id || '').startsWith('bill_')) || {};
  const base = { user_id: userId, provider: 'ABACATEPAY', provider_subscription_id: subscription.id || null,
    provider_checkout_id: checkout.id || subscription.checkoutId || null, last_event_id: event.id || null };
  if (type === 'checkout.completed') return { ...base, status: 'PAID', access_kind: 'PURCHASE' };
  if (['checkout.refunded', 'checkout.disputed', 'checkout.lost'].includes(type)) return { ...base, status: 'SUSPENDED', access_kind: 'PURCHASE' };
  return null;
}

module.exports = { API_BASE, DEFAULT_HMAC_KEY, createPaymentCheckout, verifyWebhook, userIdFromEvent, entitlementFromEvent };
