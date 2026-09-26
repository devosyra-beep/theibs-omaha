'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-llm-test-'));
process.env.THEIBS_WORKSPACE_PATH = path.join(temp, 'workspace.json');
process.env.THEIBS_DATA_PATH = path.join(temp, 'training-events.jsonl');
process.env.THEIBS_LLM_CONFIG_PATH = path.join(temp, 'llm-config.json');
delete process.env.THEIBS_LLM_PROVIDER;
const config = require('../src/llama-config');
const { prepareScenario, composeFactSelection } = require('../src/coach');
const { server } = require('../server');
const pool = require('../src/analysis-worker');
let origin, ollamaOrigin, lastChat, chats = 0, answer = JSON.stringify({ factIds: ['equity', 'limitations'] });
const ollama = http.createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ name: 'test-local:1b' }] }));
  let body = ''; for await (const chunk of request) body += chunk;
  lastChat = JSON.parse(body); chats++;
  response.end(JSON.stringify({ message: { content: answer } }));
});
test.before(async () => {
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  ollamaOrigin = `http://127.0.0.1:${ollama.address().port}`;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await pool.close();
  await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => ollama.close(resolve))]);
  assert.equal(path.dirname(temp), os.tmpdir()); assert.ok(path.basename(temp).startsWith('theibs-llm-test-'));
  fs.rmSync(temp, { recursive: true, force: true });
});
async function api(url, payload) {
  const response = await fetch(origin + url, payload === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return { code: response.status, data: await response.json() };
}

test('configuration persists separately from model availability and supports environment fallback', async () => {
  const initial = await api('/api/llm/config'); assert.equal(initial.data.config.provider, 'none');
  assert.equal(config.readConfig({ THEIBS_LLM_PROVIDER: 'ollama', THEIBS_LLM_MODEL: 'env-model' }, path.join(temp, 'absent.json')).source, 'ENV');
  const saved = await api('/api/llm/config', { provider: 'ollama', model: 'test-local:1b', baseUrl: ollamaOrigin });
  assert.equal(saved.data.source, 'FILE'); assert.equal(saved.data.availability.state, 'NOT_CHECKED');
  assert.equal(fs.existsSync(process.env.THEIBS_LLM_CONFIG_PATH), true);
  const checked = await api('/api/llm/check', {});
  assert.equal(checked.data.availability.state, 'AVAILABLE');
  assert.deepEqual(checked.data.availability.models, ['test-local:1b']);
  assert.equal(checked.data.availability.probe, 'MODEL_LIST'); assert.equal(checked.data.lastInference, null);
  const status = await api('/api/status'); assert.equal(status.data.llmProvider, 'ollama'); assert.equal(status.data.learning.parameterUpdates, false);
});

test('remote endpoints, credentials and paths cannot be configured; start never accepts executable input', async () => {
  for (const baseUrl of ['https://example.com', 'http://example.com', 'http://user:pass@127.0.0.1:11434', 'http://127.0.0.1:11434/private']) {
    assert.equal((await api('/api/llm/config', { provider: 'ollama', model: 'test-local:1b', baseUrl })).code, 400);
  }
  // Nondefault endpoint rejects before process launch; no real service is started in this test.
  assert.equal((await api('/api/llm/start', { executable: 'untrusted.exe' })).code, 400);
  assert.equal((await api('/api/llm/config')).data.config.baseUrl, ollamaOrigin);
});

test('explicit Portuguese setup produces a preview without applying or creating cards, ranges or EV', async () => {
  const reply = await api('/api/analysis/prepare', { question: 'PLO6, BTN, 4 adversários, pote 20, call 4, stack 100, raise para 10, 10 mil amostras', context: { variant: 'PLO5_HIGH', players: 6 } });
  assert.equal(reply.data.status, 'PROPOSAL'); assert.equal(reply.data.provider, 'local-parser');
  assert.deepEqual(reply.data.proposal.patch, { potBeforeAction: 20, amountToCall: 4, effectiveStack: 100, raiseTo: 10, players: 5, samples: 10000, variant: 'PLO6_HIGH', position: 'BTN' });
  assert.equal(reply.data.proposal.requiresConfirmation, true);
  assert.equal(fs.existsSync(process.env.THEIBS_WORKSPACE_PATH), false);
  assert.equal(reply.data.proposal.patch.heroCards, undefined);
});

test('unsupported adjectives, conflicting quantities and impossible decks do not become assumptions', async () => {
  for (const question of ['PLO6 com 9 jogadores', 'PLO6 com 6 jogadores', 'PLO5 com 7 jogadores', 'pote 10 e pote 20', '100 mil amostras']) {
    assert.equal((await prepareScenario(question, {}, { provider: 'none' })).status, 'UNSUPPORTED', question);
  }
  const before = chats;
  const malformed = await api('/api/analysis/prepare', { question: 'meu adversário é agressivo', context: {} });
  assert.equal(chats, before);
  assert.equal(malformed.data.status, 'UNSUPPORTED'); assert.equal(malformed.data.proposal, undefined);
});

test('analysis doubt recomputes numeric facts, filters hidden client fields and uses local LLM with limits', async () => {
  const input = { variant: 'PLO4_HIGH', heroCards: ['As', 'Ks', '2d', '3d'], board: ['Qs', 'Js', 'Ts', '4c', '5h'], position: 'BTN', players: 2,
    potBeforeAction: 10, amountToCall: 1, effectiveStack: 100, assumeNoRake: true, unknownOpponentModel: 'UNIFORM', samples: 500, seed: 42,
    equity: 0, recommendedAction: 'FOLD', ev: { CALL: -99999 }, villainCards: ['secret-marker'] };
  const reply = await api('/api/analysis/doubt', { input, question: 'Por que a comparação é parcial?' });
  assert.equal(reply.data.status, 'OK'); assert.equal(reply.data.context.equity.value, 1);
  assert.equal(reply.data.context.ev.CALL.ev, 10); assert.equal(reply.data.answer.provider, 'ollama');
  assert.equal(reply.data.answer.fallback, false);
  assert.equal(reply.data.answer.explanationSource, 'ENGINE_FACTS_SELECTED_BY_LOCAL_MODEL');
  assert.equal(reply.data.answer.grounding, 'VALIDATED_FACT_SELECTION');
  assert.deepEqual(reply.data.answer.factIds, ['equity', 'limitations']);
  assert.equal(JSON.stringify(lastChat).includes('secret-marker'), false);
  assert.equal(JSON.stringify(lastChat).includes('-99999'), false);
  assert.equal(lastChat.options.num_thread, 2); assert.equal(lastChat.options.num_ctx, 2048);
  assert.ok(lastChat.options.num_predict <= 80); assert.equal(lastChat.stream, false); assert.ok(lastChat.format.properties.factIds);
  const status = await api('/api/llm/config'); assert.equal(status.data.lastInference.state, 'SUCCEEDED');
  const events = fs.readFileSync(process.env.THEIBS_DATA_PATH, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.at(-1).type, 'DOUBT'); assert.equal(events.at(-1).source, 'MANUAL_ANALYSIS');
});

test('untrusted Llama output cannot supply numbers, prose, illegal facts or executable instructions', async () => {
  const snapshot = { recommendation: 'CALL', legalActions: ['FOLD', 'CALL', 'RAISE'], ev: { CALL: { status: 'MODELED', ev: -.29 } }, equity: { value: .2823 }, amountToCall: 1 };
  const facts = { ev_call: 'EV de CALL: -0.29 fichas, negativo.' };
  for (const malicious of ['EV CALL é 99.5.', '{"factIds":["raise-is-best"]}', '{"factIds":["ev_call"],"explanation":"perde uma ficha"}', '{"factIds":["ev_call","ev_call"]}', '{"factIds":[]}', '{"factIds":["__proto__"]}']) {
    assert.throws(() => composeFactSelection(malicious, facts, snapshot));
  }
  assert.match(composeFactSelection('{"factIds":["ev_call"]}', facts, snapshot, 'Qual o EV do call?').answer, /-0.29/);
  answer = '{"factIds":["equity"],"explanation":"EV CALL é 99.5."}';
  const reply = await api('/api/analysis/doubt', { input: { variant: 'PLO4_HIGH', heroCards: ['As', 'Ks', '2d', '3d'], board: ['Qs', 'Js', 'Ts', '4c', '5h'], position: 'BTN', players: 2, potBeforeAction: 10, amountToCall: 1, effectiveStack: 100, assumeNoRake: true, unknownOpponentModel: 'UNIFORM', samples: 500 }, question: 'Qual o EV do call?' });
  assert.equal(reply.data.answer.fallback, true); assert.equal(reply.data.answer.grounding, 'REJECTED');
  assert.equal(reply.data.answer.answer.includes('99.5'), false);
});
