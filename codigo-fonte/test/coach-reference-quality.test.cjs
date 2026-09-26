'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshotForCoach, coachSummary, fallbackAnswer, answerDoubt } = require('../src/coach');
const { decisionQuality, summarize, similarDecisions } = require('../src/training-store');

function fixture(status = 'SEPARATED') {
  return {
    status: 'OK', recommendedAction: 'CALL', legalActions: ['FOLD', 'CALL', 'RAISE'],
    state: { variant: 'PLO6_HIGH', position: 'SB', opponentCount: 2, effectiveStack: 100, amountToCall: 1, potBeforeAction: 5 },
    equity: { equity: 0.5, method: 'MONTE_CARLO', samples: 500, opponents: 2, confidenceInterval95: [0.45, 0.55] },
    potMath: { potAfterCall: 6, potOdds: 1 / 6 },
    ranges: [{ id: 'a', kind: 'UNIFORM', source: 'UNIFORM_UNKNOWN' }],
    ev: { comparisonComplete: true, actions: {
      FOLD: { status: 'MODELED', ev: 0, assumptions: [] },
      CALL: { status: 'MODELED', ev: 2, model: 'SHOWDOWN_ONLY', confidenceInterval95: [1.7, 2.3], assumptions: ['Sem apostas futuras.'] },
      RAISE: { status: 'MODELED', ev: 1.9, model: 'SCENARIO_SHOWDOWN_ONLY', targetStreetTotal: 4, conditionalEvEnvelope: [1.5, 2.4], assumptions: ['Respostas informadas.'] }
    } },
    strategy: { baseline: { leadership: { status, pointLeader: 'CALL', pointGap: 0.1, candidateActions: ['CALL', 'RAISE'] } } }
  };
}
function session() {
  return { variant: 'PLO6_HIGH', street: 'PREFLOP', heroCards: ['As', 'Kd', 'Ks', 'Qd', 'Th', '8h'], board: [],
    heroStack: 100, villainStack: 100, villainCards: ['2s', '3s', '4s', '5s', '6s', '7s'],
    pot: 5, amountToCall: 1, policyVersion: 'HEURISTIC_OPPONENT_V2' };
}

test('coach snapshot preserves supplied position, range origin and uncertainty without hidden cards', () => {
  const d = fixture('OVERLAPPING');
  d.ranges = [{ id: 'known', source: 'KNOWN_HAND' }];
  const snap = snapshotForCoach(d, session());
  assert.equal(snap.position, 'SB');
  assert.equal(snap.modeledOpponentCount, 2);
  assert.equal(snap.rangeModel, 'PROVIDED_HANDS_OR_RANGES');
  assert.doesNotMatch(snap.uncertainty, /mãos aleatórias/i);
  assert.equal(snap.leadership.status, 'OVERLAPPING');
  assert.deepEqual(snap.ev.RAISE.conditionalEvEnvelope, [1.5, 2.4]);
  assert.equal(snap.villainCards, undefined);
  assert.equal(snap.opponentCards, undefined);
  assert.equal(JSON.stringify(snap).includes('"2s"'), false);
});

test('snapshot does not trust aggregate completeness when one action has no finite EV', () => {
  const d = fixture(); d.ev.actions.RAISE.ev = null;
  const snap = snapshotForCoach(d, session());
  assert.equal(snap.comparisonComplete, false);
  assert.deepEqual(snap.missingLegalActions, ['RAISE']);
  assert.match(fallbackAnswer(snap, 'Qual ação?'), /Comparação parcial/);
});

test('coach distinguishes overlapping ranges, ties and separated conditional comparisons', () => {
  const overlapping = coachSummary(snapshotForCoach(fixture('OVERLAPPING'), session()), 'Qual o EV?');
  assert.match(overlapping.headline, /Sem vantagem clara/);
  assert.match(overlapping.details.join(' '), /faixas.*sobrepõem/);
  assert.match(overlapping.details.join(' '), /inconclusiva/);
  assert.match(overlapping.details.join(' '), /não é um erro comprovado/);
  const tied = coachSummary(snapshotForCoach(fixture('TIED'), session()), 'Qual ação?');
  assert.match(tied.headline, /empataram/);
  const separated = coachSummary(snapshotForCoach(fixture('SEPARATED'), session()), 'Qual ação?');
  assert.match(separated.details.join(' '), /sob as mesmas hipóteses e tamanhos/);
  assert.match(separated.details.join(' '), /não comprova uma estratégia ótima/);
});

test('learning questions explain memory and local calculation before discussing cards', async () => {
  const snap = snapshotForCoach(fixture('OVERLAPPING'), session());
  const reply = await answerDoubt(snap, 'O motor aprende com as minhas mãos?', {});
  assert.equal(reply.provider, 'none');
  assert.equal(reply.explanationSource, 'LOCAL_COMPUTED_FACTS');
  assert.equal(reply.automaticTraining, false);
  assert.match(reply.answer, /não treina pesos/);
  assert.match(reply.answer, /Você treina suas decisões/);
  assert.match(reply.answer, /não substitui os cálculos/);
});

test('IA status is factual local text, and strategy is not mistaken for the word IA', async (t) => {
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; throw new Error('unexpected'); });
  const snap = snapshotForCoach(fixture(), session());
  const reply = await answerDoubt(snap, 'Qual IA está ativa?', { THEIBS_LLM_PROVIDER: 'ollama', THEIBS_LLM_MODEL: 'configured-model' });
  assert.equal(fetches, 0);
  assert.equal(reply.provider, 'none');
  assert.match(reply.summary.details.join(' '), /configurado no Ollama/);
  assert.match(reply.summary.details.join(' '), /não confirma sua disponibilidade/);
  assert.doesNotMatch(fallbackAnswer(snap, 'Qual é a estratégia?'), /histórico guarda decisões/);
});

test('table explanation identifies only recorded positions and treats card backs as unknown hands', () => {
  const snap = snapshotForCoach(fixture(), session());
  const reply = coachSummary(snap, 'Quantos adversários são essas cartas fechadas?');
  assert.match(reply.points.join(' '), /considera 2 adversários/);
  assert.match(reply.points.join(' '), /mãos desconhecidas/);
  assert.match(reply.details.join(' '), /posição do herói é SB/);
  assert.match(reply.details.join(' '), /posições dos adversários.*quando fornecidas/);
});

test('complete but uncertain comparisons get no EV-loss grade', () => {
  for (const status of ['OVERLAPPING', 'TIED', 'MISSING_BOUNDS', 'SINGLE_MODELED_ACTION', 'UNAVAILABLE']) {
    const d = fixture(status);
    const quality = decisionQuality(d, 'RAISE');
    assert.equal(quality.label, 'INCONCLUSIVE_COMPARISON', status);
    assert.equal(quality.evLoss, null, status);
    assert.ok(Math.abs(quality.nominalEvDifference - 0.1) < 1e-9);
    assert.equal(quality.referenceScope, 'MODEL_SCENARIO_ONLY');
  }
  const legacy = fixture(); delete legacy.strategy.baseline.leadership;
  assert.equal(decisionQuality(legacy, 'CALL').evLoss, null);
});

test('separated model comparisons use EV values, not a stale recommended-action label', () => {
  const d = fixture(); d.recommendedAction = 'RAISE';
  const best = decisionQuality(d, 'CALL');
  assert.equal(best.label, 'MATCHED_MODELED');
  assert.equal(best.evLoss, 0);
  assert.equal(decisionQuality(d, 'RAISE').label, 'DIFFERENT_MODELED');
  assert.equal(decisionQuality(d, 'BET').label, 'UNVERIFIED');
  d.ev.actions.RAISE.ev = Infinity;
  assert.equal(decisionQuality(d, 'CALL').label, 'INCOMPLETE_COMPARISON');
});

test('historical grades without complete separated evidence stay outside the EV-loss average', () => {
  const evidence = { comparisonComplete: true, leadership: { status: 'SEPARATED' } };
  const events = [
    { type: 'DECISION', quality: 'MATCHED_MODELED', evLoss: 0, context: evidence },
    { type: 'DECISION', quality: 'DIFFERENT_MODELED', evLoss: 2, context: evidence },
    { type: 'DECISION', quality: 'DIFFERENT_MODELED', evLoss: 100 },
    { type: 'DECISION', quality: 'INCONCLUSIVE_COMPARISON', evLoss: 50, context: { comparisonComplete: true, leadership: { status: 'OVERLAPPING' } } },
    { type: 'DECISION', quality: 'INCOMPLETE_COMPARISON', evLoss: null }
  ];
  const summary = summarize(events);
  assert.equal(summary.decisions, 5);
  assert.equal(summary.modeledDecisions, 2);
  assert.equal(summary.ungradedDecisions, 3);
  assert.equal(summary.averageEvLoss, 1);
  assert.equal(summary.inconclusiveDecisions, 1);
  assert.equal(summary.incompleteDecisions, 1);
  assert.equal(summary.automaticTraining, false);
});

test('retrieved history declares limited similarity and no strategic ground truth', () => {
  const context = { variant: 'PLO6_HIGH', street: 'FLOP', amountToCall: 1 };
  const events = [
    { type: 'DECISION', timestamp: '2026-01-01', context, chosenAction: 'CALL', quality: 'MATCHED_HEURISTIC' },
    { type: 'DECISION', timestamp: '2026-01-02', context, chosenAction: 'FOLD', quality: 'INCOMPLETE_COMPARISON' }
  ];
  const results = similarDecisions(events, context);
  assert.equal(results[0].timestamp, '2026-01-02');
  assert.equal(results[0].referenceStatus, 'OWN_HISTORY_NOT_STRATEGIC_GROUND_TRUTH');
  assert.equal(results[0].similarityIsProbability, false);
  assert.equal(results[0].similarityBasis, 'VARIANT_STREET_AND_CALL_STATE_ONLY');
  assert.equal(results[0].leadershipStatus, null);
});
