'use strict';

const gateway = require('./abacatepay');
const store = require('./supabase-service');
const statusCache = new Map();

async function cachedCharge(order, env, fetchImpl) {
  const key = order.id + ':' + order.provider_charge_id;
  const cached = statusCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.charge;
  const charge = await gateway.getCharge(order, env, fetchImpl);
  if (statusCache.size > 500) statusCache.clear();
  statusCache.set(key, { charge, expiresAt: Date.now() + 5000 });
  return charge;
}

function publicOrder(order) {
  if (!order) return null;
  const recoveryNeeded = order.status === 'CREATING' &&
    Date.now() - Date.parse(order.created_at || 0) > 10 * 60 * 1000;
  return { id: order.id, method: order.method, status: order.status,
    amountCents: order.amount_cents, expiresAt: order.expires_at || null, recoveryNeeded,
    ...(order.method === 'PIX' && (order.pix_br_code || order.pix_qr_base64)
      ? { pix: { brCode: order.pix_br_code || null, brCodeBase64: order.pix_qr_base64 || null } } : {}),
    ...(order.method === 'CARD' && order.provider_url ? { url: order.provider_url } : {}) };
}

function purchaseBlocked(access) {
  return access?.state === 'ACTIVE' || access?.state === 'LIFETIME';
}

async function offer(access, env = process.env, fetchImpl = fetch) {
  const config = gateway.billingConfig(env);
  let methods = [];
  if (config.configured && !purchaseBlocked(access)) {
    await gateway.verifiedProduct(env, fetchImpl);
    await store.assertBillingEnvironment(config.environment, env, fetchImpl);
    methods = config.methods;
  }
  return { priceCents: config.priceCents, currency: 'BRL', accessLabel: 'Lifetime access',
    renewal: false, methods, available: methods.length > 0 };
}

function providerStatus(charge) {
  const status = String(charge?.status || '').toUpperCase();
  if (status === 'PAID') return 'PAID';
  if (['EXPIRED', 'CANCELLED', 'REFUNDED', 'FAILED'].includes(status)) return status;
  if (status === 'UNDER_DISPUTE') return 'DISPUTED';
  return null;
}

async function reconcileOrder(order, env = process.env, fetchImpl = fetch) {
  if (order?.status === 'CREATING') {
    const recovered = await gateway.findChargeByOrder(order, env, fetchImpl);
    if (!recovered) return order;
    order = await store.setOrderCharge(order.id, recovered, order.method, env, fetchImpl);
  }
  if (!order?.provider_charge_id || order.status !== 'PENDING') return order;
  const charge = await cachedCharge(order, env, fetchImpl);
  const status = providerStatus(charge);
  if (!status || status === order.status) return order;
  await store.processPaymentEvent({ orderId: order.id, eventId: `reconcile:${charge.id}:${status}`,
    eventType: 'gateway.reconciled', status, providerChargeId: charge.id,
    payload: { source: 'gateway-get', providerChargeId: charge.id, status } }, env, fetchImpl);
  return store.findOrderById(order.id, env, fetchImpl);
}

async function currentOrder(auth, env = process.env, fetchImpl = fetch) {
  const config = gateway.billingConfig(env);
  if (!config.configured) return null;
  await store.assertBillingEnvironment(config.environment, env, fetchImpl);
  const order = await store.latestOrder(auth.user.id, env, fetchImpl);
  if (!order) return null;
  return publicOrder(await reconcileOrder(order, env, fetchImpl));
}

async function checkout(auth, access, method, env = process.env, fetchImpl = fetch) {
  if (purchaseBlocked(access)) throw Object.assign(new Error('This account already has paid access.'), { statusCode: 409 });
  const config = gateway.billingConfig(env);
  if (!config.configured) throw Object.assign(new Error('Payment is not available.'), { statusCode: 503 });
  if (!config.methods.includes(method)) throw Object.assign(new Error('This payment method is unavailable.'), { statusCode: 400 });
  await gateway.verifiedProduct(env, fetchImpl);
  await store.assertBillingEnvironment(config.environment, env, fetchImpl);
  const reservation = await store.reserveOrder({ userId: auth.user.id, method, productId: config.productId,
    priceCents: config.priceCents, environment: config.environment }, env, fetchImpl);
  if (!reservation.created) {
    const existing = await reconcileOrder(reservation.order, env, fetchImpl);
    if (existing.status === 'CREATING') {
      const recoveryNeeded = Date.now() - Date.parse(existing.created_at || 0) > 10 * 60 * 1000;
      throw Object.assign(new Error(recoveryNeeded
        ? 'Payment needs support to verify a previous attempt before retrying.'
        : 'Payment is being prepared. Please try again shortly.'), { statusCode: 409 });
    }
    if (existing.status === 'PENDING') return publicOrder(existing);
    // A paid or terminal charge has just been reconciled; never create a
    // second charge in this request.
    return publicOrder(existing);
  }
  const charge = await gateway.createCharge(reservation.order, auth.user, env, fetchImpl);
  const order = await store.setOrderCharge(reservation.order.id, charge, method, env, fetchImpl);
  return publicOrder(order);
}

async function applyWebhook(event, env = process.env, fetchImpl = fetch) {
  const details = gateway.eventCharge(event);
  if (!details || !event.id) throw Object.assign(new Error('Invalid payment event.'), { statusCode: 400 });
  const config = gateway.billingConfig(env);
  if (!config.configured) throw Object.assign(new Error('Payment is not configured.'), { statusCode: 503 });
  await store.assertBillingEnvironment(config.environment, env, fetchImpl);
  const order = await store.findOrderById(details.charge.externalId, env, fetchImpl);
  if (order?.status === 'CREATING' && !order.provider_charge_id) {
    // The gateway can notify us before the create response is stored. A 5xx
    // tells it to retry; a 4xx would permanently lose this notification.
    throw Object.assign(new Error('Payment order is being finalized.'), { statusCode: 503 });
  }
  if (!order || order.provider_charge_id !== details.charge.id || order.method !== details.method ||
    order.product_id !== config.productId || order.amount_cents !== config.priceCents ||
    order.environment !== config.environment || event.devMode !== config.devMode) {
    throw Object.assign(new Error('Payment event does not match an order.'), { statusCode: 409 });
  }
  if (event.data?.payerInformation?.method && event.data.payerInformation.method !== details.method) {
    throw Object.assign(new Error('Payment method does not match the order.'), { statusCode: 409 });
  }
  gateway.assertCharge(details.charge, order, config);
  const verified = await gateway.getCharge(order, env, fetchImpl);
  const status = gateway.eventStatus(event);
  if (status === 'PAID' && providerStatus(verified) !== 'PAID') {
    throw Object.assign(new Error('Payment is not confirmed by the gateway.'), { statusCode: 503 });
  }
  return store.processPaymentEvent({ orderId: order.id, eventId: event.id, eventType: event.event,
    status, providerChargeId: details.charge.id, payload: event }, env, fetchImpl);
}

module.exports = { publicOrder, offer, currentOrder, checkout, applyWebhook, providerStatus, reconcileOrder };
