'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProvider, CLOUDFLARE_MODELS, LIMITS } = require('../src/multiway-llm-provider');
const llama = require('../src/llama-config');
const account = 'a'.repeat(32), token = 'synthetic-test-token-never-a-real-credential-0001';
const env = () => ({ THEIBS_MULTIWAY_LLM_PROVIDER: 'cloudflare', THEIBS_MULTIWAY_LLM_MODEL: CLOUDFLARE_MODELS[0],
  THEIBS_MULTIWAY_LLM_FREE_PLAN_CONFIRMED: 'true', CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token });
const schema = { type: 'object', additionalProperties: false, properties: { command: { type: 'string' } }, required: ['command'] };
const messages = [{ role: 'user', content: 'The current player checks.' }];
const options = (extra = {}) => ({ owner: 'fixture-owner', remoteTextConsent: true, format: schema, ...extra });
const result = (answer = { command: 'check' }) => new Response(JSON.stringify({ success: true, result: { response: answer }, errors: [] }), { headers: { 'content-type': 'application/json' } });
const errorCode = code => error => error.code === code;

test('runtime and public configuration expose neither account nor token; cloud does not probe automatically', () => {
  let calls = 0; const p = createProvider({ env: env(), fetchImpl: async () => { calls++; return result(); } });
  const config = p.runtimeConfig(), state = p.publicState();
  assert.deepEqual(Object.keys(config).sort(), ['model', 'provider', 'timeoutMs']);
  assert.equal(state.processing, 'REMOTE_TEXT_ONLY'); assert.equal(state.configured, true);
  assert.equal(state.requiresRemoteTextConsent, true); assert.equal(state.limits.billingCap, false);
  assert.equal(state.limits.scope, 'PROCESS_MEMORY_RESETS_ON_RESTART'); assert.equal(calls, 0);
  assert.ok(!JSON.stringify(state).includes(token)); assert.ok(!JSON.stringify(state).includes(account));
});
test('remote chat requires explicit text consent and owner; refusal sends no request', async () => {
  let calls = 0; const p = createProvider({ env: env(), fetchImpl: async () => { calls++; return result(); } });
  await assert.rejects(p.chat(p.runtimeConfig(), messages, options({ remoteTextConsent: false })), errorCode('LLM_REMOTE_CONSENT_REQUIRED'));
  await assert.rejects(p.chat(p.runtimeConfig(), messages, options({ remoteTextConsent: 'true' })), errorCode('LLM_REMOTE_CONSENT_REQUIRED'));
  await assert.rejects(p.chat(p.runtimeConfig(), messages, options({ owner: '' })), errorCode('LLM_OWNER_REQUIRED'));
  assert.equal(calls, 0);
});
test('missing operator Free plan declaration or credentials disables remote inference', async () => {
  for (const field of ['THEIBS_MULTIWAY_LLM_FREE_PLAN_CONFIRMED', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
    const raw = env(); delete raw[field]; let calls = 0;
    const p = createProvider({ env: raw, fetchImpl: async () => { calls++; return result(); } });
    assert.equal(p.publicState().configured, false);
    await assert.rejects(p.chat(p.runtimeConfig(), messages, options()), errorCode('LLM_REMOTE_UNAVAILABLE'));
    assert.equal(calls, 0);
  }
});
test('only approved models are accepted; arbitrary endpoints/config credentials cannot redirect requests', async () => {
  const raw = env(), calls = [];
  const p = createProvider({ env: raw, fetchImpl: async (url, request) => { calls.push({ url, request }); return result(); } });
  assert.throws(() => p.runtimeConfig({ ...raw, THEIBS_MULTIWAY_LLM_MODEL: '@cf/other/model' }), errorCode('LLM_CONFIG_INVALID'));
  await assert.rejects(p.chat({ ...p.runtimeConfig(), model: '@cf/../../evil' }, messages, options()), errorCode('LLM_CONFIG_INVALID'));
  const response = await p.chat({ ...p.runtimeConfig(), baseUrl: 'https://attacker.invalid', accountId: 'elsewhere', token: 'injected' }, messages, options({ maxTokens: 10000 }));
  assert.equal(response.text, '{"command":"check"}'); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${CLOUDFLARE_MODELS[0]}`);
  assert.equal(calls[0].request.redirect, 'error'); assert.equal(calls[0].request.headers.Authorization, `Bearer ${token}`);
  const body = JSON.parse(calls[0].request.body);
  assert.equal(body.stream, false); assert.equal(body.max_tokens, LIMITS.maxTokens);
  assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: schema });
  assert.equal(body.messages[0].content, messages[0].content);
});
test('Workers AI object and JSON-string responses normalize identically', async () => {
  for (const answer of [{ command: 'check' }, '{"command":"check"}']) {
    const p = createProvider({ env: env(), fetchImpl: async () => result(answer) });
    const response = await p.chat(p.runtimeConfig(), messages, options());
    assert.equal(response.text, '{"command":"check"}'); assert.equal(response.inference.provider, 'cloudflare');
    assert.equal(p.publicState().lastInference.state, 'SUCCEEDED');
  }
});
test('incomplete, multiple and non-object outputs cannot become partial proposals', async () => {
  for (const answer of ['', '{"command":', '{"command":"fold"}\n{"command":"call"}', [], null, 3]) {
    const p = createProvider({ env: env(), fetchImpl: async () => result(answer) });
    await assert.rejects(p.chat(p.runtimeConfig(), messages, options()));
    assert.equal(p.publicState().lastInference.state, 'FAILED');
  }
});
test('oversized Content-Length and streamed bodies are rejected without accepting a prefix', async () => {
  const responses = [
    () => new Response('{}', { headers: { 'content-length': String(LIMITS.responseBytes + 1) } }),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"success":true,"result":{"response":{"command":"check"}}}')); controller.enqueue(new Uint8Array(LIMITS.responseBytes)); controller.close(); } })),
    () => result({ command: 'x'.repeat(LIMITS.answerBytes + 1) })
  ];
  for (const make of responses) {
    const p = createProvider({ env: env(), fetchImpl: async () => make() });
    await assert.rejects(p.chat(p.runtimeConfig(), messages, options()), errorCode('LLM_RESPONSE_TOO_LARGE'));
  }
});
test('timeout bounds a provider that ignores abort and records a sanitized failure', async () => {
  const p = createProvider({ env: env(), fetchImpl: async () => new Promise(() => {}) });
  const start = performance.now();
  await assert.rejects(p.chat({ ...p.runtimeConfig(), timeoutMs: 25 }, messages, options()), errorCode('LLM_TIMEOUT'));
  assert.ok(performance.now() - start < 500); assert.equal(p.publicState().busy, false);
  assert.equal(p.publicState().lastInference.code, 'LLM_TIMEOUT');
  assert.throws(() => p.runtimeConfig({ ...env(), THEIBS_MULTIWAY_LLM_TIMEOUT_MS: '8001' }), errorCode('LLM_CONFIG_INVALID'));
});
test('caller cancellation releases concurrency and never exposes its reason', async () => {
  const controller = new AbortController(); let started;
  const ready = new Promise(resolve => { started = resolve; });
  const p = createProvider({ env: env(), fetchImpl: async () => { started(); return new Promise(() => {}); } });
  const task = p.chat(p.runtimeConfig(), messages, options({ signal: controller.signal }));
  await ready; controller.abort(Error(`do-not-leak-${token}`));
  await assert.rejects(task, error => error.code === 'LLM_CANCELLED' && !error.message.includes(token));
  assert.equal(p.publicState().busy, false); assert.equal(p.publicState().lastInference.state, 'CANCELLED');
  assert.ok(!JSON.stringify(p.publicState()).includes(token));
});
test('only one request runs; cancellation and errors do not activate fallback providers', async () => {
  let finish, calls = 0, localCalls = 0;
  const p = createProvider({ env: env(), local: { ...llama, chat: async () => { localCalls++; } }, fetchImpl: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const task = p.chat(p.runtimeConfig(), messages, options());
  await assert.rejects(p.chat(p.runtimeConfig(), messages, options({ owner: 'second-owner' })), errorCode('LLM_BUSY'));
  finish(result()); await task; assert.equal(calls, 1); assert.equal(localCalls, 0);
});
test('per-owner minute and rolling-day budgets count attempts, with no claim of a durable billing limit', async () => {
  let clock = 100000, calls = 0;
  const p = createProvider({ env: env(), now: () => clock, fetchImpl: async () => { calls++; return result(); } });
  for (let i = 0; i < 6; i++) await p.chat(p.runtimeConfig(), messages, options());
  await assert.rejects(p.chat(p.runtimeConfig(), messages, options()), errorCode('LLM_RATE_LIMIT'));
  await p.chat(p.runtimeConfig(), messages, options({ owner: 'another-owner' }));
  for (let i = 6; i < 40; i++) { clock += 60001; await p.chat(p.runtimeConfig(), messages, options()); }
  clock += 60001;
  await assert.rejects(p.chat(p.runtimeConfig(), messages, options()), errorCode('LLM_RATE_LIMIT'));
  assert.equal(calls, 41); clock += 86400001;
  await p.chat(p.runtimeConfig(), messages, options()); assert.equal(calls, 42);
  assert.equal(p.publicState().limits.accountQuotaVerified, false);
});
test('global in-memory attempt cap applies across owners and includes failed provider calls', async () => {
  let calls = 0;
  const p = createProvider({ env: env(), fetchImpl: async () => { calls++; return new Response('', { status: 503 }); } });
  for (let i = 0; i < LIMITS.totalPer24Hours; i++) await assert.rejects(p.chat(p.runtimeConfig(), messages, options({ owner: `owner-${i}` })), errorCode('LLM_PROVIDER_FAILED'));
  await assert.rejects(p.chat(p.runtimeConfig(), messages, options({ owner: 'last-owner' })), errorCode('LLM_RATE_LIMIT'));
  assert.equal(calls, LIMITS.totalPer24Hours);
});
test('provider status/body/network errors do not expose secrets or request text', async () => {
  for (const fetchImpl of [
    async () => { throw Error(`fetch ${token} ${account} ${messages[0].content}`); },
    async () => new Response(JSON.stringify({ secret: token }), { status: 401 }),
    async () => new Response(JSON.stringify({ secret: token }), { status: 429 }),
    async () => new Response(JSON.stringify({ success: false, errors: [{ message: token }] })),
    async () => new Response('invalid JSON with ' + token)
  ]) {
    const p = createProvider({ env: env(), fetchImpl });
    await assert.rejects(p.chat(p.runtimeConfig(), messages, options()), error => !JSON.stringify({ message: error.message, cause: error.cause }).includes(token));
    const publicValue = JSON.stringify(p.publicState());
    assert.ok(!publicValue.includes(token)); assert.ok(!publicValue.includes(account)); assert.ok(!publicValue.includes(messages[0].content));
  }
});
test('Ollama integration reuses its existing chat with local origin, schema and cancellation', async () => {
  let delegated;
  const local = { ...llama, chat: async (config, input, opts) => { delegated = { config, input, opts }; return { text: '{"command":"check"}' }; } };
  const p = createProvider({ env: { THEIBS_LLM_PROVIDER: 'ollama', THEIBS_LLM_MODEL: 'fixture:latest' }, local });
  const config = p.runtimeConfig(), response = await p.chat(config, messages, { format: schema, owner: 'local-fixture' });
  assert.equal(delegated.config.provider, 'ollama'); assert.ok(delegated.config.timeoutMs <= 8000);
  assert.deepEqual(delegated.opts.format, schema); assert.equal(delegated.opts.signal.aborted, false);
  assert.equal(response.text, '{"command":"check"}'); assert.equal(p.publicState().requiresRemoteTextConsent, false);
});
test('Ollama oversized content is rejected before the legacy client can truncate it', async () => {
  const p = createProvider({ env: { THEIBS_LLM_PROVIDER: 'ollama', THEIBS_LLM_MODEL: 'fixture:latest' },
    fetchImpl: async () => new Response(JSON.stringify({ message: { content: '{"command":"check"}' + ' '.repeat(6001) + '{"command":"fold"}' } })) });
  await assert.rejects(p.chat(p.runtimeConfig(), messages, { format: schema }), errorCode('LLM_RESPONSE_TOO_LARGE'));
});
test('request/schema limits reject oversized or audio-shaped context before provider invocation', async () => {
  let calls = 0; const p = createProvider({ env: env(), fetchImpl: async () => { calls++; return result(); } });
  await assert.rejects(p.chat(p.runtimeConfig(), [{ role: 'user', content: [{ type: 'audio', data: 'blob' }] }], options()), errorCode('LLM_REQUEST_INVALID'));
  await assert.rejects(p.chat(p.runtimeConfig(), [{ role: 'user', content: 'x'.repeat(17000) }], options()), errorCode('LLM_REQUEST_TOO_LARGE'));
  await assert.rejects(p.chat(p.runtimeConfig(), messages, options({ format: null })), errorCode('LLM_SCHEMA_REQUIRED'));
  await assert.rejects(p.chat(p.runtimeConfig(), messages, options({ format: { type: 'object', $ref: 'https://attacker.invalid' } })), errorCode('LLM_SCHEMA_INVALID'));
  assert.equal(calls, 0);
});
