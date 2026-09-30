'use strict';
// Optional Multiway text adapter. Provider credentials are read only from the
// server environment and never become part of the serializable configuration.
const { createHash } = require('node:crypto');
const llama = require('./llama-config');
const CLOUDFLARE_MODELS = Object.freeze([
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3.1-8b-instruct'
]);
const LIMITS = Object.freeze({ ownerPerMinute: 6, ownerPer24Hours: 40, totalPer24Hours: 200,
  timeoutMaxMs: 8000, requestBytes: 16000, responseBytes: 24000, answerBytes: 6000, maxTokens: 192 });
const DAY = 24 * 60 * 60 * 1000;
const fail = (code, message) => Object.assign(Error(message), { code });
function timeout(value, fallback = 6000) {
  const ms = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(ms) || ms < 1 || ms > LIMITS.timeoutMaxMs) throw fail('LLM_CONFIG_INVALID', 'Assistant timeout must be between 1 and 8,000 ms.');
  return ms;
}
function remoteSecrets(env) {
  const account = String(env.CLOUDFLARE_ACCOUNT_ID || ''), token = String(env.CLOUDFLARE_API_TOKEN || '');
  if (!/^[a-f0-9]{32}$/i.test(account) || !/^[A-Za-z0-9_-]{20,256}$/.test(token)) return null;
  return { account, token };
}
function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 8) throw fail('LLM_REQUEST_INVALID', 'Use one compact text request.');
  const clean = messages.map(message => {
    if (!message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim()) throw fail('LLM_REQUEST_INVALID', 'Only complete text messages are supported.');
    return { role: message.role, content: message.content };
  });
  if (Buffer.byteLength(JSON.stringify(clean)) > LIMITS.requestBytes) throw fail('LLM_REQUEST_TOO_LARGE', 'The assistant context is too large.');
  return clean;
}
function schemaFor(format) {
  if (!format || typeof format !== 'object' || Array.isArray(format) || format.type !== 'object') throw fail('LLM_SCHEMA_REQUIRED', 'A structured object response schema is required.');
  const text = JSON.stringify(format);
  if (Buffer.byteLength(text) > 8000 || /"\$(?:ref|dynamicRef)"\s*:/.test(text)) throw fail('LLM_SCHEMA_INVALID', 'Use a compact response schema without external references.');
  return JSON.parse(text);
}
function limitedFetch(fetchImpl, localResponse = false) {
  return async (url, options) => {
    const response = await fetchImpl(url, options);
    const length = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(length) && length > LIMITS.responseBytes) { await response.body?.cancel?.().catch(() => {}); throw fail('LLM_RESPONSE_TOO_LARGE', 'The assistant response exceeded the size limit.'); }
    if (!response.ok) await response.body?.cancel?.().catch(() => {});
    // Both remote calls and the reused Ollama client consume the same bounded
    // reader. No prefix of an oversized model response is accepted.
    let bodyPromise;
    const read = () => bodyPromise ||= readLimitedBody(response, options.signal);
    return { ok: response.ok, status: response.status, headers: response.headers,
      json: async () => {
        const data = JSON.parse(await read());
        if (localResponse && typeof data?.message?.content === 'string' && Buffer.byteLength(data.message.content) > LIMITS.answerBytes) throw fail('LLM_RESPONSE_TOO_LARGE', 'The assistant response exceeded the size limit.');
        return data;
      }, text: read };
  };
}
async function readLimitedBody(response, signal) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    // Normal fetch responses always have a reader. This bounded fallback also
    // supports HTTP test doubles without accepting provider-generated fragments.
    const text = typeof response.text === 'function' ? await response.text() : JSON.stringify(await response.json());
    if (Buffer.byteLength(text) > LIMITS.responseBytes) throw fail('LLM_RESPONSE_TOO_LARGE', 'The assistant response exceeded the size limit.');
    signal?.throwIfAborted(); return text;
  }
  let length = 0; const chunks = [];
  try {
    while (true) {
      signal?.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > LIMITS.responseBytes) { await reader.cancel().catch(() => {}); throw fail('LLM_RESPONSE_TOO_LARGE', 'The assistant response exceeded the size limit.'); }
      chunks.push(Buffer.from(value));
    }
    signal?.throwIfAborted(); return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
}
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(fail('LLM_ABORTED', 'Assistant request interrupted.'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function createProvider({ env = process.env, local = llama, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let busy = false;
  const attempts = [], ownerAttempts = new Map(), inferences = new Map();
  function runtimeConfig(overrideEnv = env) {
    const selected = String(overrideEnv.THEIBS_MULTIWAY_LLM_PROVIDER || '').trim().toLowerCase();
    if (selected && !['none', 'ollama', 'cloudflare'].includes(selected)) throw fail('LLM_CONFIG_INVALID', 'Unsupported assistant provider.');
    if (selected === 'none') return { provider: 'none', model: '', timeoutMs: 6000 };
    if (selected === 'cloudflare') {
      const model = String(overrideEnv.THEIBS_MULTIWAY_LLM_MODEL || CLOUDFLARE_MODELS[0]);
      if (!CLOUDFLARE_MODELS.includes(model)) throw fail('LLM_CONFIG_INVALID', 'The remote model is not in the approved allowlist.');
      return { provider: 'cloudflare', model, timeoutMs: timeout(overrideEnv.THEIBS_MULTIWAY_LLM_TIMEOUT_MS) };
    }
    let config;
    try { config = local.runtimeConfig(overrideEnv); } catch { throw fail('LLM_CONFIG_INVALID', 'The local assistant configuration is invalid.'); }
    return { provider: selected || config.provider, model: config.model, baseUrl: config.baseUrl,
      timeoutMs: timeout(overrideEnv.THEIBS_MULTIWAY_LLM_TIMEOUT_MS, Math.min(LIMITS.timeoutMaxMs, config.timeoutMs || 6000)) };
  }
  function cleanConfig(raw) {
    if (!raw || !['none', 'ollama', 'cloudflare'].includes(raw.provider)) throw fail('LLM_CONFIG_INVALID', 'Unsupported assistant provider.');
    if (raw.provider === 'cloudflare') {
      if (!CLOUDFLARE_MODELS.includes(raw.model)) throw fail('LLM_CONFIG_INVALID', 'The remote model is not in the approved allowlist.');
      return { provider: 'cloudflare', model: raw.model, timeoutMs: timeout(raw.timeoutMs) };
    }
    try {
      const checked = local.validateConfig({ provider: raw.provider, model: raw.model, baseUrl: raw.baseUrl,
        timeoutMs: Math.max(3000, timeout(raw.timeoutMs)) });
      return { ...checked, timeoutMs: timeout(raw.timeoutMs) };
    } catch { throw fail('LLM_CONFIG_INVALID', 'The local assistant configuration is invalid.'); }
  }
  function configurationState(config) {
    if (config.provider === 'none') return { state: 'DISABLED', reason: 'Optional interpretation is disabled.' };
    if (config.provider === 'ollama') return { state: config.model ? 'NOT_CHECKED' : 'MODEL_MISSING', reason: config.model ? 'Local text interpretation is configured; availability is checked on request.' : 'Choose an installed local model.' };
    if (env.THEIBS_MULTIWAY_LLM_PROVIDER !== 'cloudflare' || !remoteSecrets(env)) return { state: 'UNAVAILABLE', reason: 'The remote assistant is not configured on this server.' };
    if (env.THEIBS_MULTIWAY_LLM_FREE_PLAN_CONFIRMED !== 'true') return { state: 'FREE_PLAN_CONFIRMATION_REQUIRED', reason: 'Remote interpretation requires the server operator to confirm the Free plan.' };
    return { state: 'NOT_CHECKED', reason: 'Remote text interpretation is configured; provider availability and quota have not been checked.' };
  }
  function publicState(selected) {
    const config = cleanConfig(selected?.config || selected || runtimeConfig()), key = `${config.provider}:${config.model}`;
    const availability = configurationState(config);
    return { config, source: config.provider === 'cloudflare' ? 'SERVER_ENV' : 'LOCAL_CONFIGURATION',
      processing: config.provider === 'cloudflare' ? 'REMOTE_TEXT_ONLY' : 'LOCAL_SERVER_TEXT_ONLY',
      audio: false, speechSynthesis: false, requiresRemoteTextConsent: config.provider === 'cloudflare',
      availability, configured: availability.state === 'NOT_CHECKED', reason: availability.reason,
      busy, lastInference: inferences.get(key) || null,
      limits: { ...LIMITS, requestQuotasApplyTo: 'CLOUDFLARE_ONLY', scope: 'PROCESS_MEMORY_RESETS_ON_RESTART', accountQuotaVerified: false,
        billingCap: false, providerFreePlanConfirmedByOperator: env.THEIBS_MULTIWAY_LLM_FREE_PLAN_CONFIRMED === 'true' } };
  }
  function reserve(owner) {
    if (typeof owner !== 'string' || !owner.trim() || owner.length > 200) throw fail('LLM_OWNER_REQUIRED', 'An authenticated request owner is required.');
    const time = now();
    while (attempts.length && attempts[0] <= time - DAY) attempts.shift();
    for (const [key, history] of ownerAttempts) {
      while (history.length && history[0] <= time - DAY) history.shift();
      if (!history.length) ownerAttempts.delete(key);
    }
    const key = createHash('sha256').update(owner).digest('hex'), history = ownerAttempts.get(key) || [];
    if (attempts.length >= LIMITS.totalPer24Hours || history.length >= LIMITS.ownerPer24Hours
        || history.filter(at => at > time - 60000).length >= LIMITS.ownerPerMinute) throw fail('LLM_RATE_LIMIT', 'The optional assistant request limit was reached. Use the direct controls and try later.');
    // Count all started attempts, including provider failure, timeout and cancel.
    history.push(time); attempts.push(time); ownerAttempts.set(key, history);
  }
  async function chat(raw, messages, options = {}) {
    const config = cleanConfig(raw || runtimeConfig()), cleanMessages = validateMessages(messages), schema = schemaFor(options.format);
    const owner = options.owner || (config.provider === 'cloudflare' ? null : 'local');
    if (options.signal?.aborted) throw fail('LLM_CANCELLED', 'Assistant request cancelled.');
    if (config.provider === 'none' || !config.model) throw fail('LLM_DISABLED', 'Choose an available optional assistant model.');
    if (config.provider === 'cloudflare') {
      const availability = configurationState(config);
      if (availability.state !== 'NOT_CHECKED') throw fail('LLM_REMOTE_UNAVAILABLE', availability.reason);
      if (options.remoteTextConsent !== true) throw fail('LLM_REMOTE_CONSENT_REQUIRED', 'Confirm that this text may be sent to the remote assistant.');
    }
    if (busy) throw fail('LLM_BUSY', 'The assistant is already processing a request. Direct controls remain available.');
    if (config.provider === 'cloudflare') reserve(owner);
    busy = true;
    const started = performance.now(), key = `${config.provider}:${config.model}`, controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs);
    const maxTokens = Math.max(16, Math.min(LIMITS.maxTokens, Number.isFinite(Number(options.maxTokens)) ? Math.trunc(Number(options.maxTokens)) : 96));
    const guardedFetch = limitedFetch(options.fetchImpl || fetchImpl, config.provider === 'ollama');
    try {
      const operation = (async () => {
        if (config.provider === 'ollama') return local.chat({ ...config, timeoutMs: Math.max(3000, config.timeoutMs) }, cleanMessages,
          { format: schema, maxTokens, signal: controller.signal, fetchImpl: guardedFetch });
        const secrets = remoteSecrets(env);
        if (!secrets) throw fail('LLM_REMOTE_UNAVAILABLE', 'The remote assistant is not configured on this server.');
        const url = `https://api.cloudflare.com/client/v4/accounts/${secrets.account}/ai/run/${config.model}`;
        const body = JSON.stringify({ messages: cleanMessages, stream: false, max_tokens: maxTokens, temperature: 0,
          response_format: { type: 'json_schema', json_schema: schema } });
        if (Buffer.byteLength(body) > LIMITS.requestBytes) throw fail('LLM_REQUEST_TOO_LARGE', 'The assistant context is too large.');
        const response = await guardedFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secrets.token}` },
          redirect: 'error', signal: controller.signal, body });
        if (!response.ok) {
          if (response.status === 429) throw fail('LLM_PROVIDER_QUOTA', 'The remote assistant is temporarily unavailable or its quota was reached.');
          if ([401,403].includes(response.status)) throw fail('LLM_PROVIDER_AUTH', 'Remote assistant authorization failed.');
          throw fail('LLM_PROVIDER_FAILED', 'Remote text interpretation failed.');
        }
        const data = await response.json();
        if (data?.success !== true || data.errors?.length) throw fail('LLM_PROVIDER_FAILED', 'Remote text interpretation failed.');
        const answer = data.result?.response;
        if (typeof answer !== 'string' && (!answer || typeof answer !== 'object' || Array.isArray(answer))) throw fail('LLM_BAD_RESPONSE', 'The assistant returned an invalid structured response.');
        return { text: typeof answer === 'string' ? answer : JSON.stringify(answer) };
      })();
      const result = await abortable(operation, controller.signal);
      if (controller.signal.aborted) throw fail('LLM_ABORTED', 'Assistant request interrupted.');
      const text = result?.text?.trim();
      if (!text || Buffer.byteLength(text) > LIMITS.answerBytes) throw fail('LLM_RESPONSE_TOO_LARGE', 'The assistant returned an empty or oversized response.');
      let parsed; try { parsed = JSON.parse(text); } catch { throw fail('LLM_BAD_RESPONSE', 'The assistant did not return a complete JSON object.'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw fail('LLM_BAD_RESPONSE', 'The assistant did not return a complete JSON object.');
      const inference = { state: 'SUCCEEDED', checkedAt: new Date(now()).toISOString(), elapsedMs: performance.now() - started, provider: config.provider, model: config.model };
      inferences.set(key, inference);
      return { text: JSON.stringify(parsed), inference };
    } catch (error) {
      const safe = options.signal?.aborted ? fail('LLM_CANCELLED', 'Assistant request cancelled.')
        : timedOut ? fail('LLM_TIMEOUT', 'The optional assistant did not finish within its time limit.')
        : typeof error?.code === 'string' && /^LLM_(?:RESPONSE_TOO_LARGE|REQUEST_TOO_LARGE|PROVIDER_QUOTA|PROVIDER_AUTH|PROVIDER_FAILED|BAD_RESPONSE|REMOTE_UNAVAILABLE|BUSY)$/.test(error.code)
          ? fail(error.code, ({ LLM_RESPONSE_TOO_LARGE: 'The assistant response exceeded the size limit.', LLM_REQUEST_TOO_LARGE: 'The assistant context is too large.',
            LLM_PROVIDER_QUOTA: 'The remote assistant is temporarily unavailable or its quota was reached.', LLM_PROVIDER_AUTH: 'Remote assistant authorization failed.',
            LLM_BAD_RESPONSE: 'The assistant did not return a complete structured response.', LLM_BUSY: 'The local model is already answering another request.' })[error.code] || 'Optional text interpretation failed.')
          : fail('LLM_PROVIDER_FAILED', 'Optional text interpretation failed.');
      inferences.set(key, { state: safe.code === 'LLM_CANCELLED' ? 'CANCELLED' : 'FAILED', checkedAt: new Date(now()).toISOString(),
        elapsedMs: performance.now() - started, reason: safe.message, code: safe.code });
      throw safe;
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); busy = false; }
  }
  return { runtimeConfig, publicState, chat };
}
module.exports = { ...createProvider(), createProvider, CLOUDFLARE_MODELS, LIMITS };
