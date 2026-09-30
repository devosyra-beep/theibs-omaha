'use strict';

const { settings, validateSettings } = require('./supabase-service');

function publicOrigin(env = process.env) {
  const value = env.THEIBS_PUBLIC_ORIGIN || (env.RENDER === 'true' ? env.RENDER_EXTERNAL_URL : '');
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

function runtimeConfig(env = process.env) {
  const origin = publicOrigin(env);
  const hosted = env.RENDER === 'true' || env.NODE_ENV === 'production' || Boolean(origin);
  return {
    port: Number(env.PORT || env.THEIBS_PORT || 4173),
    host: env.THEIBS_HOST || (hosted ? '0.0.0.0' : '127.0.0.1'),
    origin,
    hosted
  };
}

function validateDeployment(env = process.env) {
  const runtime = runtimeConfig(env);
  if (!Number.isInteger(runtime.port) || runtime.port < 1 || runtime.port > 65535) {
    throw new Error('PORT / THEIBS_PORT must be an integer between 1 and 65535.');
  }
  if (!runtime.hosted) return runtime;
  if (!runtime.origin?.startsWith('https://')) throw new Error('Hosted mode requires a valid HTTPS public origin.');
  const auth = settings(env);
  if (!auth.required) throw new Error('Hosted mode requires THEIBS_AUTH_REQUIRED=true.');
  validateSettings(auth, { admin: true });
  if (!auth.googleEnabled) throw new Error('Enable Google Auth before publishing the web app.');

  const billingKeys = ['ABACATEPAY_API_KEY', 'ABACATEPAY_PRODUCT_ID', 'THEIBS_ABACATEPAY_WEBHOOK_SECRET',
    'THEIBS_BILLING_ENV', 'THEIBS_PAYMENT_METHODS'];
  if (billingKeys.some(key => env[key])) {
    if (!billingKeys.every(key => env[key]?.trim())) throw new Error('AbacatePay requires its API key, product ID and webhook secret.');
    if (!['development', 'production'].includes(env.THEIBS_BILLING_ENV)) throw new Error('THEIBS_BILLING_ENV must be development or production.');
    const { configuredMethods } = require('./abacatepay');
    if (!configuredMethods(env).length) throw new Error('Choose at least one configured payment method.');
    if (env.THEIBS_BILLING_SCHEMA_VERIFIED !== 'true') throw new Error('Billing requires a verified Supabase migration.');
    if (env.THEIBS_BILLING_ENV === 'development' && String(env.SUPABASE_URL || '').includes('kevcwoeqgdwvfsvdpghe')) {
      throw new Error('Sandbox billing requires an isolated development Supabase project.');
    }
    // The current history store uses files. A free preview must not collect
    // payments while depending on Render's ephemeral filesystem.
    if (!env.THEIBS_USER_DATA_ROOT || env.THEIBS_STORAGE_PERSISTENT !== 'true') {
      throw new Error('Billing requires persistent user storage. Mount a persistent disk before enabling payments.');
    }
  }
  return runtime;
}

module.exports = { publicOrigin, runtimeConfig, validateDeployment };
