'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateActionEV } = require('../src/action-ev-engine');
const { enrichActionEV } = require('../src/action-ev-presentation');
const multiway = require('../src/multiway-session');
const { decide } = require('../src/decision-engine');

test('incremental call EV and bb gap retain unknown aggression as null', () => {
  const input = { equity: .2, players: 3, potBeforeAction: 20, amountToCall: 3,
    bigBlind: 2, assumeNoRake: true, legalActions: ['FOLD', 'CALL', 'RAISE'], raiseTo: 12 };
  const ev = calculateActionEV(input);
  assert.equal(ev.actions.FOLD.ev, 0);
  assert.ok(Math.abs(ev.actions.CALL.ev - 1.6) < 1e-9);
  assert.ok(Math.abs(ev.actions.CALL.evBB - .8) < 1e-9);
  assert.equal(ev.actions.RAISE.ev, null);
  assert.equal(ev.actions.RAISE.evBB, null);
  assert.equal(ev.actions.RAISE.size, 12);
  assert.equal(ev.actions.RAISE.sizeBasis, 'STREET_TOTAL');
  assert.equal(ev.bestModeledAction, 'CALL');
  assert.equal(ev.globalBestSupported, false);
  assert.equal(ev.comparisonStatus, 'PARTIAL');
  assert.ok(Math.abs(ev.gapBestSecondBB - .8) < 1e-9);
  assert.ok(Math.abs(ev.actions.FOLD.differenceToBestModeledBB - .8) < 1e-9);
});

test('a free check keeps showdown value rather than silently becoming zero', () => {
  const ev = calculateActionEV({ equity: .4, potBeforeAction: 10, amountToCall: 0,
    bigBlind: 2, assumeNoRake: true, futureStreetModel: { type: 'SHOWDOWN_ONLY' },
    legalActions: ['CHECK', 'BET'] });
  assert.equal(ev.actions.CHECK.ev, 4);
  assert.equal(ev.actions.CHECK.evBB, 2);
  assert.equal(ev.actions.BET.ev, null);
  assert.equal(ev.globalBestSupported, false);
});

test('a tie and overlapping precision never support a global leader', () => {
  const input = { equity: .2, potBeforeAction: 16, amountToCall: 4, bigBlind: 2,
    assumeNoRake: true, legalActions: ['FOLD', 'CALL'] };
  const ev = calculateActionEV(input);
  assert.equal(ev.actions.CALL.ev, 0);
  assert.equal(ev.gapBestSecondBB, 0);
  assert.equal(ev.leaderConclusive, false);
  assert.equal(ev.globalBestSupported, false);
  ev.actions.CALL.confidenceInterval95 = [-.1, .1];
  enrichActionEV(ev, input, { method: 'MONTE_CARLO', opponents: 1 });
  assert.equal(ev.actions.CALL.numericalQuality, 'SAMPLING_INTERVAL_95');
  assert.equal(ev.globalBestSupported, false);
});

test('missing opponent coverage suppresses action ranking even with numeric EV', () => {
  const input = { equity: .7, players: 3, potBeforeAction: 10, amountToCall: 2,
    bigBlind: 1, assumeNoRake: true, legalActions: ['FOLD', 'CALL'] };
  const ev = calculateActionEV(input);
  enrichActionEV(ev, input, { method: 'EXACT', opponents: 1 });
  assert.equal(ev.actions.CALL.status, 'MODELED');
  assert.equal(ev.bestModeledAction, null);
  assert.equal(ev.actions.CALL.differenceToBestModeledBB, null);
  assert.equal(ev.comparisonStatus, 'INCOMPARABLE_OPPONENT_COVERAGE');
  assert.equal(ev.globalBestSupported, false);
});

test('exact conditional enumeration can separate two complete legal actions', () => {
  const input = { equity: .7, players: 2, potBeforeAction: 10, amountToCall: 2,
    bigBlind: 2, assumeNoRake: true, legalActions: ['FOLD', 'CALL'] };
  const ev = calculateActionEV(input);
  enrichActionEV(ev, input, { method: 'EXACT', opponents: 1 });
  assert.ok(Math.abs(ev.actions.CALL.ev - 6.4) < 1e-9);
  assert.equal(ev.actions.CALL.numericalQuality, 'EXACT_ENUMERATION');
  assert.equal(ev.comparisonComplete, true);
  assert.equal(ev.leaderConclusive, true);
  assert.equal(ev.globalBestSupported, true);
});

test('malformed bounds never become exact precision by fallback', () => {
  const input = { equity: .7, potBeforeAction: 10, amountToCall: 2,
    bigBlind: 2, assumeNoRake: true, legalActions: ['FOLD', 'CALL'] };
  const ev = calculateActionEV(input);
  ev.actions.CALL.confidenceInterval95 = [100, 101];
  enrichActionEV(ev, input, { method: 'EXACT', opponents: 1 });
  assert.equal(ev.actions.CALL.numericalQuality, 'INVALID_INTERVAL');
  assert.equal(ev.actions.CALL.numericalBounds, null);
  assert.equal(ev.globalBestSupported, false);
});

test('Multiway records each opponent hypothesis with seat, position, situation and origin', () => {
  const config = { variant: 'PLO4_HIGH', playerCount: 3, heroPosition: 'BTN', startingStack: 100,
    smallBlind: 1, bigBlind: 2, heroCards: ['As', 'Ks', 'Qh', 'Jh'] };
  const record = multiway.start(config).multiway;
  const prepared = multiway.prepareAnalysis(record, { opponentOverrides: [
    { seatId: 0, enabled: true, callProbability: .25 },
    { seatId: 1, enabled: true, callProbability: .75 }
  ], opponentStudyAccepted: false });
  assert.equal(prepared.opponentHypotheses.length, 2);
  assert.deepEqual(prepared.opponentHypotheses.map(item => item.seat), ['A1', 'A2']);
  assert.deepEqual(prepared.opponentHypotheses.map(item => item.position), ['SB', 'BB']);
  assert.equal(prepared.opponentHypotheses[0].situation.street, 'PREFLOP');
  assert.equal(prepared.opponentHypotheses[0].cards.model, 'UNIFORM');
  assert.equal(prepared.opponentHypotheses[0].responses[0].origin, 'USER_SUPPLIED_HYPOTHESIS');
});

test('unlinked showdown and conditional scenario EVs remain visible but unranked', () => {
  const input = { multiwayComparison: true, equity: .4, players: 3, potBeforeAction: 20,
    amountToCall: 3, heroContribution: 2, effectiveStack: 98, bigBlind: 2,
    assumeNoRake: true, raiseTo: 12, minRaiseTo: 8,
    legalActions: ['FOLD', 'CALL', 'RAISE'], actionResponseModels: { RAISE: {
      type: 'SCENARIO_SHOWDOWN_ONLY', source: 'USER_PROVIDED', action: 'RAISE',
      targetStreetTotal: 12, heroContribution: 2, minRaiseTo: 8,
      opponents: [{ id: 'a', contribution: 5, stackRemaining: 95 },
        { id: 'b', contribution: 5, stackRemaining: 95 }],
      scenarios: [{ probability: 1, callers: [{ id: 'a', additional: 7 }, { id: 'b', additional: 7 }],
        equity: .3, equitySource: 'USER_CONDITIONAL', equityOpponentIds: ['a', 'b'] }]
    } } };
  const unlinked = calculateActionEV(input);
  assert.equal(unlinked.actions.CALL.status, 'MODELED');
  assert.equal(unlinked.actions.RAISE.status, 'MODELED');
  assert.equal(unlinked.comparisonComplete, true);
  assert.equal(unlinked.comparisonStatus, 'INCOMPARABLE_ASSUMPTIONS');
  assert.equal(unlinked.bestModeledAction, null);
  assert.equal(unlinked.gapBestSecondBB, null);
  assert.equal(unlinked.actions.CALL.differenceToBestModeledBB, null);
  const linked = calculateActionEV({ ...input, comparisonContextId: 'STUDY_1',
    actionResponseModels: { RAISE: { ...input.actionResponseModels.RAISE, comparisonContextId: 'STUDY_1' } } });
  assert.equal(linked.comparisonStatus, 'COMPLETE');
  assert.ok(linked.bestModeledAction);
  const differentCost = structuredClone(input.actionResponseModels.RAISE);
  differentCost.comparisonContextId = 'STUDY_1';
  differentCost.scenarios[0].rake = 1;
  const costMismatch = calculateActionEV({ ...input, comparisonContextId: 'STUDY_1',
    actionResponseModels: { RAISE: differentCost } });
  assert.equal(costMismatch.actions.RAISE.status, 'MODELED');
  assert.equal(costMismatch.comparisonStatus, 'INCOMPARABLE_ASSUMPTIONS');
});

test('the generated uniform response study keeps one comparison context through the Multiway guard', () => {
  const config = { variant: 'PLO4_HIGH', playerCount: 3, heroPosition: 'BTN', startingStack: 100,
    smallBlind: 1, bigBlind: 2, heroCards: ['As', 'Ks', 'Qh', 'Jh'] };
  const record = multiway.start(config).multiway;
  const prepared = multiway.prepareAnalysis(record, { unknownOpponentModel: 'UNIFORM',
    assumeNoRake: true, samples: 256, seed: 42, raiseTo: 6,
    aggressionStudy: { enabled: true, assumptionsAccepted: true,
      opponents: [{ seatId: 0, callProbability: .5 }, { seatId: 1, callProbability: .5 }] } });
  const result = multiway.guardResult(decide(prepared.input), prepared);
  assert.equal(result.status, 'OK');
  assert.equal(result.ev.actions.CALL.status, 'MODELED');
  assert.equal(result.ev.actions.RAISE.status, 'MODELED');
  assert.equal(result.ev.comparisonStatus, 'COMPLETE');
  assert.equal(result.ev.comparisonContexts.length, 1);
});

test('decision engine propagates showdown equity sampling bounds into incremental CALL and CHECK EV', () => {
  const base = { variant: 'PLO4_HIGH', heroCards: ['As', 'Ks', 'Qh', 'Jh'], board: [],
    position: 'BTN', players: 2, potBeforeAction: 10, effectiveStack: 100,
    bigBlind: 2, unknownOpponentModel: 'UNIFORM', assumeNoRake: true,
    samples: 256, seed: 42 };
  const call = decide({ ...base, amountToCall: 2 });
  assert.equal(call.status, 'OK');
  assert.equal(call.equity.method, 'MONTE_CARLO');
  assert.equal(call.ev.actions.CALL.numericalQuality, 'SAMPLING_INTERVAL_95');
  assert.deepEqual(call.ev.actions.CALL.numericalBounds,
    call.equity.confidenceInterval95.map(q => q * 12 - 2));
  const check = decide({ ...base, amountToCall: 0,
    futureStreetModel: { type: 'SHOWDOWN_ONLY' } });
  assert.equal(check.status, 'OK');
  assert.equal(check.ev.actions.CHECK.numericalQuality, 'SAMPLING_INTERVAL_95');
  assert.deepEqual(check.ev.actions.CHECK.numericalBounds,
    check.equity.confidenceInterval95.map(q => q * 10));
});
