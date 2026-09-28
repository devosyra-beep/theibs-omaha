'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const coach = require('../src/coach');
const llama = require('../src/llama-config');

const config = { provider: 'ollama', model: 'test-local', timeoutMs: 3000 };
function snapshot() {
  return { recommendation: 'CALL', recommendationStatus: 'CONDITIONAL', comparisonComplete: true,
    legalActions: ['FOLD', 'CALL'], leadership: { status: 'SEPARATED' }, amountToCall: 2,
    equity: { value: .6, method: 'MONTE_CARLO', samples: 1000 },
    ev: { FOLD: { status: 'MODELED', ev: 0 }, CALL: { status: 'MODELED', ev: 4 } } };
}

test('local answer is synchronous and never reads model configuration or calls a model', t => {
  t.mock.method(llama, 'runtimeConfig', () => { throw Error('Configuration must not be read'); });
  t.mock.method(llama, 'chat', () => { throw Error('Model must not be called'); });
  const answer = coach.localCoachAnswer(snapshot(), 'What is the equity?');
  assert.equal(answer instanceof Promise, false);
  assert.equal(answer.provider, 'none');
  assert.equal(answer.explanationSource, 'LOCAL_COMPUTED_FACTS');
  assert.match(answer.answer, /60\.0%/);
});

test('enrichment owns a snapshot copy and retains engine facts even if the live hand changes', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.mock.method(llama, 'chat', async () => { await gate; return { text: '{"factIds":["equity"]}', inference: { elapsedMs: 1 } }; });
  const live = snapshot();
  const pending = coach.enrichCoachAnswer(live, 'What is the equity?', config);
  live.equity.value = .01;
  release();
  const answer = await pending;
  assert.match(answer.answer, /60\.0%/);
  assert.doesNotMatch(answer.answer, /1\.0%/);
  assert.equal(answer.grounding, 'VALIDATED_FACT_SELECTION');
});

test('cancelled enrichment propagates cancellation instead of returning stale fallback', async t => {
  const controller = new AbortController();
  t.mock.method(llama, 'chat', async (settings, messages, { signal }) => {
    assert.equal(signal, controller.signal);
    controller.abort();
    throw signal.reason;
  });
  await assert.rejects(coach.enrichCoachAnswer(snapshot(), 'What is the equity?', config, [], { signal: controller.signal }), { name: 'AbortError' });
});

test('chat abort stops an in-flight fetch and releases the inference lock', async () => {
  const controller = new AbortController();
  let notify;
  const started = new Promise(resolve => { notify = resolve; });
  const pending = llama.chat(config, [], { signal: controller.signal, fetchImpl: async (url, { signal }) => {
    notify();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  await started;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  const reply = await llama.chat(config, [], { fetchImpl: async () => ({ ok: true, json: async () => ({ message: { content: '{"factIds":["equity"]}' } }) }) });
  assert.match(reply.text, /factIds/);
});

test('an already aborted request does no inference work', async () => {
  const controller = new AbortController(); controller.abort();
  let fetched = false;
  await assert.rejects(llama.chat(config, [], { signal: controller.signal, fetchImpl: async () => { fetched = true; } }), { name: 'AbortError' });
  assert.equal(fetched, false);
});

test('provenance preserves identity, units and costs without arbitrary hidden payloads', () => {
  const result = { status: 'OK', analysisId: 'analysis-1', recommendedAction: 'CALL', recommendation: { status: 'INCONCLUSIVE', action: null },
    provenance: { schemaVersion: 2, inputHash: 'input-1', outputHash: 'output-1', unit: 'chips',
      rake: { mode: 'FIXED_INPUT', amount: 1 }, futurePolicy: { type: 'SHOWDOWN_ONLY', villainCards: ['secret-marker'] },
      rangeOrigin: [{ id: 'range', source: 'KNOWN_HAND', hands: ['secret-marker'] }], villainCards: ['secret-marker'] } };
  const context = coach.snapshotForCoach(result, { id: 'session-1', events: [{ type: 'ACT' }], config: { bigBlind: 2 }, startingStack: 100 });
  assert.equal(context.analysisId, 'analysis-1');
  assert.equal(context.recommendationStatus, 'INCONCLUSIVE');
  assert.equal(context.recommendation, 'CALL');
  assert.equal(context.provenance.inputHash, 'input-1');
  assert.equal(context.bigBlind, 2); assert.equal(context.revision, 1);
  assert.deepEqual(context.costModel, { mode: 'FIXED_INPUT', amount: 1 });
  assert.equal(JSON.stringify(context).includes('secret-marker'), false);
});

test('unsupported exploit adjustment never becomes a categorical coach recommendation', () => {
  const data = snapshot(); data.recommendationStatus = 'UNVERIFIED_ADJUSTMENT';
  const answer = coach.localCoachAnswer(data, 'Which action should I play?');
  assert.match(answer.summary.headline, /not a verified recommendation/);
  assert.match(answer.summary.details.join(' '), /no verified advantage/);
});

test('structured abstention overrides separated legacy leadership in every coach decision path', () => {
  for (const status of ['INCOMPLETE', 'PROVISIONAL', 'INCONCLUSIVE', 'UNAVAILABLE', 'UNVERIFIED_ADJUSTMENT', 'FUTURE_UNSUPPORTED_STATUS']) {
    const result = { status: 'OK', recommendedAction: 'CALL',
      recommendation: { status, action: null, missingOpponentModel: status === 'INCOMPLETE' },
      state: { opponentCount: 3 }, equity: { equity: .7, opponents: 1 },
      legalActions: ['FOLD', 'CALL', 'RAISE'],
      ev: { actions: { FOLD: { status: 'MODELED', ev: 0 }, CALL: { status: 'MODELED', ev: 7 }, RAISE: { status: 'MODELED', ev: 3 } } },
      strategy: { baseline: { leadership: { status: 'SEPARATED' } } },
      trainingEvaluation: { recommendedOptionId: 'CALL', chosenOptionId: 'RAISE:8', leadership: { status: 'SEPARATED' }, candidates: [
        { optionId: 'CALL', action: 'CALL', ev: 7 }, { optionId: 'RAISE:8', action: 'RAISE', size: 8, ev: 3 }
      ] }
    };
    const context = coach.snapshotForCoach(result);
    assert.equal(context.recommendation, 'CALL', 'legacy field remains compatible');
    assert.equal(context.supportedRecommendation, null);
    assert.equal(context.comparisonComplete, true, 'modeled actions alone cannot override structural abstention');
    assert.equal(context.missingOpponentModel, status === 'INCOMPLETE');
    const facts = coach.explanationFacts(context);
    for (const question of ['Which action should I play?', 'Why raise?', 'What is the equity?']) {
      const answer = coach.localCoachAnswer(context, question);
      assert.doesNotMatch(JSON.stringify(answer.summary), /Call is the recommendation|Call has an advantage|had the highest return|Highest calculated return|Highest EV among tested sizes|average profit/i, status + ': ' + question);
    }
    const selected = coach.composeFactSelection('{"factIds":["decision"]}', facts, context);
    assert.doesNotMatch(JSON.stringify(selected.summary), /Call is the recommendation|Call has an advantage|had the highest return|Highest calculated return|Highest EV among tested sizes/i, status);
    if (status === 'INCOMPLETE') {
      assert.match(selected.summary.headline, /Opponent coverage is incomplete/);
      assert.match(facts.equity, /partial opponent model/);
      assert.match(facts.opponents, /coverage is incomplete/);
    }
    if (status === 'PROVISIONAL') assert.match(selected.summary.headline, /Preliminary calculation/);
  }
});

test('legacy snapshots remain compatible while conditional contracts use their supported action', () => {
  const legacy = snapshot(); delete legacy.recommendationStatus;
  assert.match(coach.localCoachAnswer(legacy, 'What action?').summary.headline, /^Call is the recommendation/);
  const current = snapshot(); current.recommendation = 'FOLD'; current.supportedRecommendation = 'CALL';
  const answer = coach.localCoachAnswer(current, 'What action?');
  assert.match(answer.summary.headline, /^Call is the recommendation/);
  assert.match(answer.summary.details.join(' '), /Call has an advantage/);
});

test('profit guarantees are answered locally without treating positive incremental EV as a winning policy', async t => {
  t.mock.method(llama, 'chat', () => { throw Error('No model needed'); });
  for (const question of ['Me garanta lucro no longo prazo', 'Can you guarantee profit?']) {
    const answer = await coach.enrichCoachAnswer(snapshot(), question, config);
    assert.equal(answer.provider, 'none');
    assert.match(answer.answer, /No calculation guarantees profit/);
    assert.match(answer.answer, /complete strategy/);
  }
});
