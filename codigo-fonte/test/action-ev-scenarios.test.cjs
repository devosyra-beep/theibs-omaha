'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateActionEV } = require('../src/action-ev-engine');

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
function branch(id, probability, callers, equity, equityInterval) {
  return { id, probability, callers, ...(equity == null ? {} : {
    equity, equityOpponentIds: callers.map(caller => caller.id), equitySource: 'CALCULATED_CONDITIONAL',
    ...(equityInterval ? { equityInterval, equityIntervalLevel: .95 } : {})
  }) };
}
function fixture() {
  return {
    equity: .12, players: 3, potBeforeAction: 20, amountToCall: 3, effectiveStack: 98,
    assumeNoRake: true, raiseTo: 12, legalActions: ['FOLD', 'CALL', 'RAISE'],
    actionResponseModels: { RAISE: {
      type: 'SCENARIO_SHOWDOWN_ONLY', source: 'USER_PROVIDED', action: 'RAISE',
      targetStreetTotal: 12, heroContribution: 2, minRaiseTo: 8,
      opponents: [{ id: 'a', contribution: 5, stackRemaining: 95 }, { id: 'b', contribution: 1, stackRemaining: 99 }],
      scenarios: [
        branch('fold', .2, []),
        branch('a', .3, [{ id: 'a', additional: 7 }], .6, [.55, .65]),
        branch('b', .1, [{ id: 'b', additional: 11 }], .5, [.45, .55]),
        branch('ab', .4, [{ id: 'a', additional: 7 }, { id: 'b', additional: 11 }], .35, [.3, .4])
      ]
    } }
  };
}
const raise = input => calculateActionEV(input).actions.RAISE;

test('multiway raise weights caller subsets with incremental costs and conditional equity', () => {
  const action = raise(fixture());
  assert.equal(action.status, 'MODELED');
  assert.equal(action.heroCost, 10);
  // fold:20; a:.6*37-10=12.2; b:.5*41-10=10.5; ab:.35*48-10=6.8.
  near(action.ev, .2 * 20 + .3 * 12.2 + .1 * 10.5 + .4 * 6.8);
  assert.deepEqual(action.scenarioBreakdown.map(scenario => scenario.potAtShowdown), [23, 37, 41, 48]);
  assert.equal(action.scenarioBreakdown[0].uncalledReturned, 7);
  assert.equal(action.scenarioBreakdown[0].heroCost, 3);
  assert.equal(action.modelScope, 'FIXED_RESPONSE_SHOWDOWN_ONLY');
  assert.match(action.certainty, /ASSUMPTIONS/);
});

test('scenario EV envelope does not claim joint 95% confidence', () => {
  const action = raise(fixture());
  near(action.conditionalEvEnvelope[0], .2 * 20 + .3 * (.55 * 37 - 10) + .1 * (.45 * 41 - 10) + .4 * (.3 * 48 - 10));
  near(action.conditionalEvEnvelope[1], .2 * 20 + .3 * (.65 * 37 - 10) + .1 * (.55 * 41 - 10) + .4 * (.4 * 48 - 10));
  assert.equal(action.confidenceInterval95, undefined);
  assert.match(action.intervalScope, /SEM_COBERTURA_CONJUNTA/);
  const missing = fixture(); delete missing.actionResponseModels.RAISE.scenarios[1].equityInterval;
  assert.equal(raise(missing).conditionalEvEnvelope, undefined);
});

test('rake is branch-specific, taken from the prize before equity weighting', () => {
  const input = fixture(); input.actionResponseModels.RAISE.scenarios.forEach(scenario => { scenario.rake = scenario.callers.length ? 2 : 0; });
  const action = raise(input);
  near(action.ev, .2 * 20 + .3 * (.6 * 35 - 10) + .1 * (.5 * 39 - 10) + .4 * (.35 * 46 - 10));
});

test('CALL resolves outstanding contributions and keeps already matched opponents', () => {
  const input = fixture();
  input.actionResponseModels.CALL = {
    ...input.actionResponseModels.RAISE, action: 'CALL', targetStreetTotal: 5,
    scenarios: [branch('ab', 1, [{ id: 'a', additional: 0 }, { id: 'b', additional: 4 }], .25)]
  };
  const result = calculateActionEV(input);
  near(result.actions.CALL.ev, .25 * (20 + 3 + 4) - 3);
  assert.equal(result.comparisonComplete, true);
  assert.deepEqual(result.missingLegalActions, []);
  assert.equal(result.confidence, 'MEDIUM');
  input.actionResponseModels.CALL.scenarios = [branch('b', 1, [{ id: 'b', additional: 4 }], .5)];
  assert.equal(calculateActionEV(input).actions.CALL.status, 'NOT_MODELED');
});

test('BET uses its incremental size, separately from the total already invested', () => {
  const input = {
    players: 2, potBeforeAction: 10, amountToCall: 0, effectiveStack: 90,
    betSize: 5, minBet: 1, assumeNoRake: true, legalActions: ['BET'],
    actionResponseModels: { BET: {
      type: 'SCENARIO_SHOWDOWN_ONLY', source: 'HEURISTIC_PRESET', action: 'BET',
      heroContribution: 2, targetStreetTotal: 7,
      opponents: [{ id: 'a', contribution: 2, stackRemaining: 90 }],
      scenarios: [branch('a', 1, [{ id: 'a', additional: 5 }], .6)]
    } }
  };
  const result = calculateActionEV(input).actions.BET;
  assert.equal(result.heroCost, 5); near(result.ev, .6 * 20 - 5);
  for (const minimum of [undefined, null, '', 0, -1, 6]) {
    const invalid = { ...input, minBet: minimum };
    assert.equal(calculateActionEV(invalid).actions.BET.status, 'NOT_MODELED', `minBet=${minimum}`);
  }
  assert.equal(calculateActionEV({ ...input, minBet: 5 }).actions.BET.status, 'MODELED');
});

test('legacy BET compatibility does not require the new explicit scenario minimum', () => {
  const result = calculateActionEV({ players: 2, potBeforeAction: 10, amountToCall: 0, effectiveStack: 90, betSize: 5, foldEquity: .2, continuationEquity: .6, assumeNoRake: true, legalActions: ['BET'] });
  assert.equal(result.actions.BET.status, 'MODELED');
  near(result.actions.BET.ev, .2 * 10 + .8 * (.6 * 20 - 5));
});

test('action comparisons cannot silently mix different pre-action contribution states', () => {
  const input = fixture();
  input.actionResponseModels.CALL = {
    ...structuredClone(input.actionResponseModels.RAISE), action: 'CALL', targetStreetTotal: 5,
    scenarios: [branch('ab', 1, [{ id: 'a', additional: 0 }, { id: 'b', additional: 4 }], .25)]
  };
  input.actionResponseModels.CALL.opponents[1].stackRemaining = 100;
  const result = calculateActionEV(input);
  assert.equal(result.actions.CALL.status, 'NOT_MODELED');
  assert.equal(result.actions.RAISE.status, 'NOT_MODELED');
  assert.equal(result.comparisonComplete, false);
  assert.deepEqual(result.missingLegalActions, ['CALL', 'RAISE']);
});

test('invalid probability, identity, amounts and unsupported side pots stay NOT_MODELED', () => {
  const changes = [
    input => { input.actionResponseModels.RAISE.scenarios[0].probability = .5; },
    input => { input.actionResponseModels.RAISE.scenarios.push(input.actionResponseModels.RAISE.scenarios[0]); },
    input => { input.actionResponseModels.RAISE.scenarios[1].equityOpponentIds = ['b']; },
    input => { delete input.actionResponseModels.RAISE.scenarios[1].equity; },
    input => { input.actionResponseModels.RAISE.scenarios[1].callers[0].additional = 12; },
    input => { input.actionResponseModels.RAISE.opponents[0].stackRemaining = 6; },
    input => { input.actionResponseModels.RAISE.opponents[0].stackRemaining = 0; },
    input => { input.actionResponseModels.RAISE.opponents[1].id = 'a'; },
    input => { input.actionResponseModels.RAISE.opponents[1].contribution = 6; },
    input => { input.potBeforeAction = 7; },
    input => { input.raiseTo = 13; },
    input => { input.actionResponseModels.RAISE.minRaiseTo = 13; },
    input => { input.effectiveStack = 9; },
    input => { input.maxRaiseTo = 11; },
    input => { input.actionResponseModels.RAISE.targetStreetTotal = 40; input.raiseTo = 40; },
    input => { input.actionResponseModels.RAISE.allowReRaises = true; },
    input => { input.actionResponseModels.RAISE.sidePots = true; },
    input => { input.actionResponseModels.RAISE.scenarios[1].equityInterval = [.8, .9]; },
    input => { input.actionResponseModels.RAISE.scenarios[1].rake = 100; },
    input => { input.actionResponseModels.RAISE.action = 'BET'; }
  ];
  for (const change of changes) {
    const input = fixture(); change(input); const result = calculateActionEV(input);
    assert.equal(result.actions.RAISE.status, 'NOT_MODELED', change.toString());
    assert.equal(result.actions.RAISE.ev, null);
    assert.equal(result.comparisonComplete, false);
    assert.deepEqual(result.missingLegalActions, ['RAISE']);
    assert.equal(result.confidence, 'LOW');
  }
});

test('incomplete comparison reports missing legal actions even when fold is modeled', () => {
  const result = calculateActionEV({ players: 3, equity: .2, potBeforeAction: 20, amountToCall: 3, assumeNoRake: true, legalActions: ['FOLD', 'CALL', 'RAISE'] });
  assert.equal(result.status, 'MODELED');
  assert.equal(result.comparisonComplete, false);
  assert.deepEqual(result.missingLegalActions, ['RAISE']);
  assert.equal(result.confidence, 'LOW');
  assert.equal(calculateActionEV({}).comparisonComplete, false);
});

test('legacy heads-up raiseTo deducts prior hero contribution, with warning when omitted', () => {
  const input = { players: 2, equity: .1, potBeforeAction: 10, amountToCall: 3, effectiveStack: 98, heroContribution: 2, raiseTo: 12, minRaiseTo: 8, foldEquity: .2, continuationEquity: .6, assumeNoRake: true, legalActions: ['FOLD', 'CALL', 'RAISE'] };
  const result = raise(input);
  near(result.ev, .2 * 10 + .8 * (.6 * (10 + 10 + 7) - 10));
  assert.equal(result.heroCost, 10);
  const omitted = { ...input }; delete omitted.heroContribution;
  assert.match(raise(omitted).warnings.join(' '), /assumida como zero/);
  const multiway = { ...input, players: 3, opponentResponseModel: { type: 'ALL_FOLD_OR_ONE_CALLER' } };
  assert.equal(raise(multiway).status, 'NOT_MODELED');
});
