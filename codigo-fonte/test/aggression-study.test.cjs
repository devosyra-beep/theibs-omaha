'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decide } = require('../src/decision-engine');
const { studySettings, buildStudyModels } = require('../src/aggression-scenarios');
const { decisionQuality } = require('../src/training-store');

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const uniformModel = (count = 2) => ({ ranges: Array.from({ length: count }, () => ({ kind: 'UNIFORM' })) });
function buttonBlinds() {
  return {
    variant: 'PLO6_HIGH', heroCards: ['As', 'Kd', 'Ks', 'Qd', 'Th', '8h'], board: [],
    position: 'BTN', players: 3, potBeforeAction: 1.5, amountToCall: 1,
    effectiveStack: 100, unknownOpponentModel: 'UNIFORM', assumeNoRake: true,
    futureStreetModel: { type: 'SHOWDOWN_ONLY' }, samples: 256, seed: 42, raiseTo: 3.5,
    aggressionStudy: {
      enabled: true, assumptionsAccepted: true, heroContribution: 0, minRaiseTo: 2,
      opponents: [{ contribution: 0.5, callProbability: 0.5 }, { contribution: 1, callProbability: 0.5 }]
    }
  };
}

test('BTN versus SB/BB compares fold, call and the stated raise under explicit assumptions', () => {
  const d = decide(buttonBlinds());
  assert.equal(d.status, 'OK', d.reason);
  assert.equal(d.ev.comparisonComplete, true);
  assert.equal(d.strategy.baseline.comparisonStatus, 'COMPLETE');
  assert.equal(d.strategy.finalSource, 'MODELED_ACTION_COMPARISON');
  assert.equal(d.strategy.baseline.score, null);
  assert.notEqual(d.confidence, 'HIGH');
  const call = d.ev.actions.CALL, raise = d.ev.actions.RAISE;
  assert.equal(call.model, 'SCENARIO_SHOWDOWN_ONLY');
  assert.equal(raise.modelScope, 'FIXED_RESPONSE_SHOWDOWN_ONLY');
  assert.equal(raise.scenarioBreakdown.length, 4);
  near(raise.scenarioBreakdown.reduce((sum, b) => sum + b.probability, 0), 1);
  near(raise.ev, raise.scenarioBreakdown.reduce((sum, b) => sum + b.probability * b.ev, 0));
  near(call.ev, d.equity.equity * 3 - 1);
  near(d.potMath.evCall, call.ev);
  near(d.potMath.potAfterCall, 3);
  near(d.potMath.potOdds, 1 / 3);
  assert.equal(d.scenarioSummary.source, 'EXPLICIT_INDEPENDENT_UNIFORM_HYPOTHESIS');
  assert.match(d.scenarioSummary.assumptions.join(' '), /independent.*cards/);
  const byCount = d.scenarioSummary.equitiesByCallerCount;
  assert.deepEqual(byCount.map(x => x.callers), [1, 2]);
  for (const branch of raise.scenarioBreakdown.filter(b => b.callers.length)) {
    near(branch.equity, byCount.find(e => e.callers === branch.callers.length).equity);
    near(branch.ev, branch.equity * (branch.potAtShowdown - branch.rake) - branch.heroCost);
  }
});

test('deterministic call scenario uses net showdown pot when rake is explicit', () => {
  const input = buttonBlinds(); input.rake = 0.1; input.assumeNoRake = false;
  const d = decide(input);
  assert.equal(d.status, 'OK', d.reason);
  near(d.ev.actions.CALL.ev, d.equity.equity * 2.9 - 1);
  near(d.potMath.evCall, d.ev.actions.CALL.ev);
  near(d.potMath.potOdds, 1 / 2.9);
});

test('all-fold response returns the uncalled raise and wins only the existing pot', () => {
  const input = buttonBlinds(); input.aggressionStudy.opponents.forEach(o => o.callProbability = 0);
  const d = decide(input);
  assert.equal(d.status, 'OK', d.reason);
  const raise = d.ev.actions.RAISE;
  assert.equal(raise.status, 'MODELED');
  assert.equal(raise.scenarioBreakdown.length, 1);
  near(raise.ev, 1.5);
  near(raise.scenarioBreakdown[0].heroCost, 1);
  near(raise.scenarioBreakdown[0].uncalledReturned, 2.5);
  assert.deepEqual(raise.scenarioBreakdown[0].callers, []);
});

test('all-call response charges each opponent only the outstanding contribution', () => {
  const input = buttonBlinds(); input.aggressionStudy.opponents.forEach(o => o.callProbability = 1);
  const d = decide(input);
  assert.equal(d.status, 'OK', d.reason);
  const raise = d.ev.actions.RAISE;
  assert.equal(raise.scenarioBreakdown.length, 1);
  const branch = raise.scenarioBreakdown[0];
  near(branch.opponentAdditional, 5.5);
  near(branch.potAtShowdown, 10.5);
  near(raise.ev, d.equity.equity * 10.5 - 3.5);
});

test('small-blind contribution is not paid a second time by call or raise', () => {
  const input = buttonBlinds();
  Object.assign(input, { position: 'SB', players: 2, amountToCall: 0.5, raiseTo: 3 });
  input.aggressionStudy.heroContribution = 0.5;
  input.aggressionStudy.opponents = [{ contribution: 1, callProbability: 1 }];
  const d = decide(input);
  assert.equal(d.status, 'OK', d.reason);
  assert.equal(d.ev.comparisonComplete, true);
  near(d.ev.actions.CALL.heroCost, 0.5);
  near(d.ev.actions.CALL.ev, d.equity.equity * 2 - 0.5);
  near(d.ev.actions.RAISE.heroCost, 2.5);
  near(d.ev.actions.RAISE.scenarioBreakdown[0].potAtShowdown, 6);
  near(d.ev.actions.RAISE.ev, d.equity.equity * 6 - 2.5);
});

test('invalid contributions, probabilities and player counts are rejected before calculation', () => {
  const cases = [
    input => { input.aggressionStudy.heroContribution = -1; },
    input => { input.aggressionStudy.opponents[0].contribution = -0.5; },
    input => { input.aggressionStudy.opponents[0].contribution = 2; },
    input => { input.aggressionStudy.opponents[1].contribution = 0.5; },
    input => { input.potBeforeAction = 1; },
    input => { input.aggressionStudy.opponents[0].callProbability = -0.01; },
    input => { input.aggressionStudy.opponents[0].callProbability = 1.01; },
    input => { input.aggressionStudy.opponents.pop(); }
  ];
  for (const change of cases) {
    const input = buttonBlinds(); change(input);
    assert.throws(() => studySettings(input, uniformModel()));
    assert.equal(decide(input).status, 'NO_DECISION');
  }
});

test('study hypotheses require consent and uniform ranges for every opponent', () => {
  const input = buttonBlinds(); input.aggressionStudy.assumptionsAccepted = false;
  assert.throws(() => studySettings(input, uniformModel()), /assumptions/);
  assert.equal(decide(input).status, 'NO_DECISION');
  input.aggressionStudy.assumptionsAccepted = true;
  input.opponentHands = [['2s', '3s', '4s', '5s', '6s', '7s']];
  assert.equal(decide(input).status, 'NO_DECISION');
  assert.throws(() => studySettings(input, { ranges: [{ kind: 'UNIFORM' }, { kind: 'EXPLICIT' }] }), /random hands/);
});

test('study sizes must respect the explicit minimum, pot limit and remaining stack', () => {
  for (const values of [{ raiseTo: 1.9 }, { raiseTo: 3.51 }, { effectiveStack: 2, raiseTo: 3 }]) {
    const input = Object.assign(buttonBlinds(), values);
    assert.throws(() => studySettings(input, uniformModel()));
  }
});

test('a free action with an earlier contribution is not silently represented as an opening bet', () => {
  const input = buttonBlinds();
  Object.assign(input, { position: 'BB', players: 2, amountToCall: 0, potBeforeAction: 2, betSize: 2 });
  input.aggressionStudy.heroContribution = 1;
  input.aggressionStudy.minBet = 1;
  input.aggressionStudy.opponents = [{ contribution: 1, callProbability: 0.5 }];
  assert.throws(() => studySettings(input, uniformModel(1)));
  assert.equal(decide(input).status, 'NO_DECISION');
});

test('opening bets require a legal minimum and compare to check under the same study hypothesis', () => {
  const input = buttonBlinds();
  Object.assign(input, { amountToCall: 0, potBeforeAction: 10, betSize: 2 });
  input.aggressionStudy.opponents.forEach(o => o.contribution = 0);
  delete input.aggressionStudy.minBet;
  assert.throws(() => studySettings(input, uniformModel()), /minimum|minBet/i);
  input.aggressionStudy.minBet = 1;
  input.betSize = 0.5;
  assert.throws(() => studySettings(input, uniformModel()), /minimum|minBet/i);
  input.betSize = 2;
  const d = decide(input);
  assert.equal(d.status, 'OK', d.reason);
  assert.equal(d.ev.comparisonComplete, true);
  assert.equal(d.ev.actions.BET.status, 'MODELED');
  assert.equal(d.ev.actions.CHECK.status, 'MODELED');
});

test('call scenarios with different caller subsets do not present one universal pot-odds threshold', () => {
  const input = buttonBlinds(); delete input.aggressionStudy;
  input.actionResponseModels = { CALL: {
    type: 'SCENARIO_SHOWDOWN_ONLY', source: 'USER_PROVIDED', action: 'CALL', targetStreetTotal: 1, heroContribution: 0,
    opponents: [{ id: 'sb', contribution: 0.5, stackRemaining: 100 }, { id: 'bb', contribution: 1, stackRemaining: 100 }],
    scenarios: [
      { probability: 0.5, callers: [{ id: 'bb', additional: 0 }], equity: 0.6, equityOpponentIds: ['bb'], equitySource: 'USER_CONDITIONAL' },
      { probability: 0.5, callers: [{ id: 'sb', additional: 0.5 }, { id: 'bb', additional: 0 }], equity: 0.4, equityOpponentIds: ['sb', 'bb'], equitySource: 'USER_CONDITIONAL' }
    ]
  } };
  const d = decide(input);
  assert.equal(d.status, 'OK', d.reason);
  assert.equal(d.ev.actions.CALL.status, 'MODELED');
  near(d.ev.actions.CALL.ev, 0.35);
  near(d.potMath.evCall, 0.35);
  assert.equal(d.potMath.potOdds, null);
});

test('disabled study leaves inputs intact and incomplete training receives no EV-loss grade', () => {
  const input = buttonBlinds(); input.aggressionStudy.enabled = false;
  assert.equal(studySettings(input, uniformModel()), null);
  assert.deepEqual(buildStudyModels(input, null), { input, summary: null });
  const d = decide(input);
  assert.equal(d.status, 'OK', d.reason);
  assert.equal(d.ev.comparisonComplete, false);
  assert.equal(d.ev.actions.RAISE.status, 'NOT_MODELED');
  for (const action of d.legalActions) {
    const quality = decisionQuality(d, action);
    assert.equal(quality.evLoss, null);
    assert.equal(quality.label, 'INCOMPLETE_COMPARISON');
  }
});
