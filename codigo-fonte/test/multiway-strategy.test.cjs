'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { evaluateContinuation, createStrategyService, selectSnapshot, STRATEGY_CONTRACT_VERSION } = require('../src/multiway-strategy');
const { evaluateMultiway } = require('../src/multiway-evaluator');
function reference(revisionKey = 'revision-current') {
  return { revisionKey, result: { status: 'APPROXIMATE', solverVersion: 'TEST_SOLVER_V1', method: 'CFR_PLUS',
    actions: [{ id: 'FOLD', frequency: .25, evBB: 0 }, { id: 'CALL', frequency: .75, evBB: 2 }],
    abstraction: { rootActions: [{ id: 'FOLD' }, { id: 'CALL' }], scope: 'DECLARED_TEST' },
    convergence: { exact: true, nashConv: .02 }, qualification: { gto: false } } };
}
function heuristic(revisionKey = 'revision-current') {
  return { status: 'OK', observedState: { revisionKey }, multiwayEvaluation: { revisionKey },
    ev: { status: 'MODELED', candidates: [{ optionId: 'FOLD', status: 'MODELED', ev: 0 }, { optionId: 'CALL', status: 'NOT_MODELED', ev: null }, { optionId: 'RAISE:20.00', status: 'MODELED', ev: 3 }] } };
}

test('a fresh solver replaces the whole table without appending fallback actions', () => {
  const solver = reference(), fallback = heuristic();
  const selected = selectSnapshot({ solver, heuristic: fallback, revisionKey: 'revision-current' });
  assert.equal(selected.source, 'REFERENCE_SUBGAME_STRATEGY');
  assert.equal(selected.fallback, false);
  assert.deepEqual(selected.actions, solver.result.actions);
  assert.equal(selected.actions.length, 2);
  assert.equal(selected.equilibrium, false);
  selected.actions[0].evBB = 99;
  assert.equal(solver.result.actions[0].evBB, 0);
});

test('stale or conflicting solver revisions select only the current heuristic table', () => {
  for (const solver of [reference('old'), { ...reference(), result: { ...reference().result, revisionKey: 'old' } }]) {
    const fallback = heuristic();
    const result = selectSnapshot({ solver, heuristic: fallback, revisionKey: 'revision-current' });
    assert.equal(result.source, 'LEGACY_CONTEXT_CONTINUATION');
    assert.deepEqual(result.actions, fallback.ev.candidates);
    assert.equal(result.actions[1].ev, null);
    assert.equal(result.actions[1].status, 'NOT_MODELED');
  }
});

test('invalid or incomplete strategic frequency/EV tables never mix with fallback rows', () => {
  const mutations = [
    result => { result.actions[1].evBB = null; },
    result => { result.actions[1].frequency = .5; },
    result => { result.actions[1].frequency = NaN; },
    result => { result.actions[1].id = 'FOLD'; },
    result => { result.actions = [result.actions[0]]; result.actions[0].frequency = 1; },
    result => { result.status = 'NOT_SOLVED'; },
    result => { result.status = 'PARTIAL'; },
    result => { result.status = 'SOLVED'; },
    result => { result.status = 'GTO'; },
    result => { delete result.abstraction; }
  ];
  for (const mutate of mutations) {
    const solver = reference(); mutate(solver.result);
    const result = selectSnapshot({ solver, heuristic: heuristic(), revisionKey: 'revision-current' });
    assert.equal(result.source, 'LEGACY_CONTEXT_CONTINUATION');
    assert.equal(result.actions.length, 3);
  }
});

test('SOLVED selection requires the finite-subgame qualification and consistent measured quality', () => {
  const { VERSION, THRESHOLD_BB } = require('../src/solver/solution-status');
  const solver = reference();
  Object.assign(solver.result, { status: 'SOLVED',
    qualification: { version: VERSION, solvedSubgame: true, strategyFrequenciesSupported: true, gto: false },
    quality: { numericalStatus: 'SOLVED', exact: true, metric: 'EXACT_NASH_CONV', unit: 'BB', thresholdBB: THRESHOLD_BB,
      thresholdMet: true, nashConv: .001, maxUnilateralGain: .0005, completeChanceSupport: true,
      perfectRecallVerified: true, fullLegalSizingCoverage: true, supportedGameClass: true },
    convergence: { exact: true, nashConv: .001 }
  });
  const selected = selectSnapshot({ solver, heuristic: heuristic(), revisionKey: 'revision-current' });
  assert.equal(selected.source, 'REFERENCE_SUBGAME_STRATEGY');
  assert.equal(selected.status, 'SOLVED');
  assert.equal(selected.equilibrium, false);
  solver.result.quality.fullLegalSizingCoverage = false;
  assert.equal(selectSnapshot({ solver, heuristic: heuristic(), revisionKey: 'revision-current' }).source, 'LEGACY_CONTEXT_CONTINUATION');
  solver.result.quality.fullLegalSizingCoverage = true;
  solver.result.convergence.nashConv = .1;
  assert.equal(selectSnapshot({ solver, heuristic: heuristic(), revisionKey: 'revision-current' }).source, 'LEGACY_CONTEXT_CONTINUATION');
});

test('no fresh inputs yields no decision values, never zeros from stale data', () => {
  const result = selectSnapshot({ solver: reference('old'), heuristic: heuristic('older'), revisionKey: 'revision-current' });
  assert.equal(result.status, 'NOT_SOLVED');
  assert.equal(result.snapshot, null);
  assert.deepEqual(result.actions, []);
  assert.equal(selectSnapshot({ solver: reference(), heuristic: heuristic() }).status, 'NOT_SOLVED');
});

test('a fresh NO_DECISION fallback retains its original absent-data contract', () => {
  const result = selectSnapshot({ heuristic: { status: 'NO_DECISION', observedState: { revisionKey: 'revision-current' }, ev: { status: 'NO_DECISION', actions: {} } }, revisionKey: 'revision-current' });
  assert.equal(result.snapshot.status, 'NO_DECISION');
  assert.equal(result.snapshot.ev.status, 'NO_DECISION');
  assert.deepEqual(result.actions, []);
});

test('continuation facade adds provenance while preserving exact MODELED/NOT_MODELED EV rows', () => {
  const config = { variant: 'PLO4_HIGH', playerCount: 2, heroPosition: 'BB', startingStack: 20, smallBlind: .5, bigBlind: 1, heroCards: ['As', 'Ah', 'Kd', 'Qc'] };
  const board = ['2s', '3h', '4d', '8c', '9s'];
  const events = [{ type: 'ACT', actor: 0, action: 'CALL' }, { type: 'ACT', actor: 1, action: 'CHECK' }];
  for (const length of [3, 4, 5]) {
    events.push({ type: 'BOARD', cards: board.slice(0, length) });
    if (length < 5) events.push({ type: 'ACT', actor: 1, action: 'CHECK' }, { type: 'ACT', actor: 0, action: 'CHECK' });
  }
  const input = { config, events, handId: 'facade-test', revisionKey: 'revision-current', samples: 32, seed: 1234 };
  const original = evaluateMultiway(input), wrapped = evaluateContinuation(input);
  assert.deepEqual(wrapped.ev, original.ev);
  assert.deepEqual(wrapped.strategy, original.strategy);
  assert.equal(wrapped.strategyMetadata.status, 'HEURISTIC');
  assert.equal(wrapped.strategyMetadata.fallback, true);
  assert.equal(wrapped.strategyMetadata.equilibrium, false);
  assert.equal(wrapped.strategyMetadata.quality.nashConv, null);
  assert.ok(wrapped.ev.candidates.some(row => row.status === 'NOT_MODELED' && row.ev === null));
});

test('strategy service exposes the common contract with the existing cancellable job API', async () => {
  const service = createStrategyService();
  assert.equal(service.contractVersion, STRATEGY_CONTRACT_VERSION);
  for (const operation of ['start', 'get', 'cancel', 'prioritize', 'stats', 'close']) assert.equal(typeof service[operation], 'function');
  await service.close();
});
