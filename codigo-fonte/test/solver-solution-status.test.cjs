'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const session = require('../src/multiway-session');
const adapter = require('../src/solver/plo-river-game');
const core = require('../src/solver/extensive-solver');
const { qualify, THRESHOLD_BB } = require('../src/solver/solution-status');

function genuineResult() {
  const hero = ['As', 'Ah', 'Kd', 'Qc', 'Tc'], villain = ['Ks', 'Kh', 'Jd', 'Qh', '6c'];
  let envelope = session.start({ variant: 'PLO5_HIGH', playerCount: 2, heroPosition: 'SB', startingStack: 2,
    smallBlind: .5, bigBlind: 1, heroCards: hero });
  const board = ['2s', '3h', '4d', '8c', '9s'];
  const events = [
    { type: 'ACT', actor: 0, action: 'CALL' }, { type: 'ACT', actor: 1, action: 'CHECK' },
    { type: 'BOARD', cards: board.slice(0, 3) },
    { type: 'ACT', actor: 1, action: 'CHECK' }, { type: 'ACT', actor: 0, action: 'CHECK' },
    { type: 'BOARD', cards: board.slice(0, 4) },
    { type: 'ACT', actor: 1, action: 'CHECK' }, { type: 'ACT', actor: 0, action: 'CHECK' },
    { type: 'BOARD', cards: board }, { type: 'ACT', actor: 1, action: 'BET', to: 1 }
  ];
  for (const event of events) envelope = session.step(envelope.multiway, event);
  const built = adapter.buildPloRiverGame({ multiway: envelope.multiway,
    ranges: [hero, villain].map((cards, seatId) => ({ seatId, complete: true, source: 'INDEPENDENT_QA', combos: [{ cards, weight: 1 }] })),
    sizing: { type: 'MIN_MID_MAX', maxAggressions: 3 }, rake: { type: 'NONE', basis: 'BEFORE_FEES' } });
  assert.equal(built.status, 'READY', JSON.stringify(built.reasons));
  assert.equal(built.coverage, 'FINITE_RIVER_SUBGAME');
  const solved = core.solve(built.game, { iterations: 300, checkEvery: 25, targetNashConv: THRESHOLD_BB });
  assert.equal(solved.convergence.exact, true);
  return { meta: built.game.meta, result: solved, coverage: built.coverage };
}

test('supported complete river subgame can be SOLVED while GTO and full-hand claims remain false', () => {
  const input = genuineResult(), qualified = qualify(input.meta, input.result, { coverage: input.coverage });
  assert.equal(qualified.status, 'SOLVED'); assert.equal(qualified.qualification.solvedSubgame, true);
  assert.equal(qualified.qualification.gto, false); assert.equal(qualified.qualification.fullHandEquilibrium, false);
  assert.equal(qualified.qualification.independentPokerReferenceValidated, false);
  assert.equal(qualified.qualification.gtoReason, 'INDEPENDENT_PLO_REFERENCE_VALIDATION_PENDING');
  assert.equal(qualified.quality.thresholdMet, true); assert.equal(qualified.quality.exact, true);
  assert.equal(qualified.quality.unit, 'BB');
});

test('every missing mathematical qualification blocks SOLVED without erasing valid strategy source', () => {
  for (const mutate of [
    meta => { meta.fullLegalSizingCoverage = false; }, meta => { delete meta.treeComplete; },
    meta => { delete meta.chanceSupportComplete; }, meta => { meta.chanceEnumeration = 'MONTE_CARLO'; },
    meta => { meta.ranges[0].complete = false; }, meta => { delete meta.ranges[0].source; },
    meta => { meta.productWorlds++; }, meta => { meta.compatiblePriorMass = 0; },
    meta => { meta.constantSum = false; }, meta => { meta.constantSumValue++; }
  ]) {
    const input = genuineResult(); mutate(input.meta);
    const qualified = qualify(input.meta, input.result, { coverage: input.coverage });
    assert.equal(qualified.status, 'APPROXIMATE'); assert.equal(qualified.qualification.gto, false);
    assert.equal(qualified.qualification.strategyFrequenciesSupported, true);
  }
});

test('imperfect recall, unavailable convergence and inconsistent exact metrics cannot qualify a solution', () => {
  for (const mutate of [
    result => { result.metrics.perfectRecall = false; }, result => { result.convergence.exact = false; },
    result => { result.convergence.nashConv = NaN; }, result => { result.convergence.nashConv = -1; },
    result => { result.convergence.unilateralGains[0] = 1; }, result => { result.convergence.bestResponseValues[0] = -999; },
    result => { result.values = null; }
  ]) {
    const input = genuineResult(); mutate(input.result);
    const qualified = qualify(input.meta, input.result, { coverage: input.coverage });
    assert.equal(qualified.status, 'APPROXIMATE'); assert.equal(qualified.qualification.solvedSubgame, false);
  }
});

test('an unverified or incompatible solver output remains NOT_SOLVED with no frequency authority', () => {
  for (const mutate of [
    result => { result.method = 'MONTE_CARLO'; }, result => { result.solverVersion = 'unverified'; },
    result => { result.iterations = 0; }, result => { result.strategy = null; },
    result => { result.checkpoint.gameHash = 'f'.repeat(64); },
    result => { result.strategy[0][Object.keys(result.strategy[0])[0]].CALL = NaN; }
  ]) {
    const input = genuineResult(); mutate(input.result);
    const qualified = qualify(input.meta, input.result, { coverage: input.coverage });
    assert.equal(qualified.status, 'NOT_SOLVED'); assert.equal(qualified.qualification.strategyFrequenciesSupported, false);
    assert.equal(qualified.quality.thresholdMet, false);
  }
});

test('threshold uses the unrounded current-profile deviation, never elapsed time or iteration count', () => {
  const input = genuineResult(), result = input.result;
  const nc = THRESHOLD_BB + 1e-6;
  result.convergence.nashConv = nc; result.convergence.maxUnilateralGain = nc;
  result.convergence.unilateralGains = [nc, 0];
  result.convergence.bestResponseValues = [result.values[0] + nc, result.values[1]];
  result.metrics.elapsedMs = 30000;
  const qualified = qualify(input.meta, result, { coverage: input.coverage });
  assert.equal(qualified.status, 'APPROXIMATE'); assert.equal(qualified.quality.thresholdMet, false);
  assert.equal(qualified.quality.nashConv, nc);
});

test('partial coverage and multiplayer remain APPROXIMATE even when measured NashConv meets threshold', () => {
  const input = genuineResult();
  assert.equal(qualify(input.meta, input.result, { coverage: 'PARTIAL' }).status, 'APPROXIMATE');
  input.meta.originalSeats = 3; input.meta.activeSeats = 3;
  input.meta.ranges.push({ seatId: 2, complete: true, source: 'INDEPENDENT_QA', combos: [{ cards: ['Ac', 'Ad', 'Jc', 'Th', '7s'], weight: 1 }] });
  input.result.strategy.push({}); input.result.values.push(0);
  input.result.convergence.bestResponseValues.push(0); input.result.convergence.unilateralGains.push(0);
  input.result.convergence.convergenceGuarantee = 'NONE_FOR_GENERAL_SUM_OR_MULTIPLAYER';
  const qualified = qualify(input.meta, input.result, { coverage: input.coverage });
  assert.equal(qualified.status, 'APPROXIMATE'); assert.equal(qualified.quality.thresholdMet, true);
  assert.equal(qualified.quality.supportedGameClass, false); assert.equal(qualified.qualification.gto, false);
});

test('REFINING reports pending work separately from the current numerical qualification', () => {
  const input = genuineResult(); input.meta.fullLegalSizingCoverage = false;
  const refining = qualify(input.meta, input.result, { coverage: 'PARTIAL', refining: true });
  assert.equal(refining.status, 'REFINING'); assert.equal(refining.quality.numericalStatus, 'APPROXIMATE');
  assert.equal(refining.qualification.gto, false);
  assert.equal(qualify(null, null, { coverage: 'NOT_SOLVED', refining: true }).status, 'NOT_SOLVED');
});

test('legacy fallback is explicitly HEURISTIC and cannot lend frequencies or NashConv to solver results', () => {
  const heuristic = qualify({ source: 'LEGACY_HEURISTIC' }, { method: 'MULTIWAY_CONTEXT_POLICY_V1',
    convergence: { exact: true, nashConv: 0 }, strategy: [{ CALL: 1 }] });
  assert.equal(heuristic.status, 'HEURISTIC'); assert.equal(heuristic.qualification.strategyFrequenciesSupported, false);
  assert.equal(heuristic.quality.nashConv, null); assert.equal(heuristic.quality.thresholdMet, false);
  assert.equal(heuristic.qualification.gto, false);
  assert.equal(qualify({}, { method: 'MULTIWAY_CONTEXT_POLICY_V1' }).status, 'NOT_SOLVED');
});
