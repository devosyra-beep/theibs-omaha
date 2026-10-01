'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const comparison = require('../public/solver-study-comparison');
const job = require('../src/solver/job-worker');
const outcome = require('../src/solver/decision-outcome');
const builder = require('../src/solver/plo-river-game');
const { riverMixedInput, riverCallInput } = require('./helpers/solver-reference-fixtures.cjs');
const { richRiverInput } = require('./helpers/solver-river-growth-reference.cjs');
const clone = structuredClone;

function studyInput({ prior = 'A', tree = 'A' } = {}) {
  const input = riverMixedInput();
  input.multiway.handId = '33333333-3333-4333-8333-333333333333';
  const weights = prior === 'A' ? [[3, 1], [1, 4]] : [[.001, 5], [4, 1]];
  input.ranges.forEach((range, seat) => range.combos.forEach((combo, index) => { combo.weight = weights[seat][index]; }));
  input.sizing = { type: 'EXPLICIT_TOTALS', levels: tree === 'A' ? [1, 2] : [1, 1.5, 2], maxAggressions: 1 };
  return input;
}
function completeExamples() {
  const A = richRiverInput({ combos: 4, sizings: 2 });
  A.multiway.config.stacks = [2, 2]; A.sizing = { type: 'MIN_MID_MAX', maxAggressions: 1 };
  const B = richRiverInput({ combos: 4, sizings: 2 });
  B.ranges.forEach(range => { range.combos = range.combos.slice(0, 2); });
  B.multiway.config.stacks = [2.02, 2.02];
  B.sizing = { type: 'EXPLICIT_TOTALS', levels: [1, 1.01, 1.02], maxAggressions: 2 };
  const C = riverCallInput({ blockers: true }); C.multiway.config.stacks = [20, 20];
  return { A, B, C };
}
const memo = new Map();
function entry(id, input, iterations = 128) {
  const key = JSON.stringify([input, iterations]);
  if (!memo.has(key)) memo.set(key, job.execute({ input: clone(input), budget: { timeMs: 3000, iterations } },
    { compilationReuse: true, now: () => 0 }).result);
  return { id, name: `Study ${id}`, input: clone(input), result: clone(memo.get(key)), phase: 'COMPLETE',
    timing: { firstValueMs: 12, workerMs: 20 } };
}
const pair = (a, b) => comparison.compare([a, b]);
function refused(a, b, reason) {
  const result = pair(a, b);
  assert.equal(result.classification, 'INCOMPARABLE');
  if (reason) assert.ok(result.reasonCodes.includes(reason) || result.scenarios.some(row => row.reasonCodes.includes(reason)), JSON.stringify(result));
  assert.ok(result.comparisons[0].actionComparisons.every(row => row.deltaBB === null));
  return result;
}

test('same exact game preserves each original profile and commitment scope without mutating inputs/results', () => {
  const a = entry('a', studyInput()), b = entry('b', studyInput()), before = clone([a, b]);
  b.name = 'Display name only'; const original = clone([a, b]), result = pair(a, b);
  assert.equal(result.classification, 'SAME_GAME'); assert.deepEqual([a, b], original);
  for (const row of result.scenarios) {
    assert.equal(row.usable, true); assert.equal(row.currentHand.scope, 'CURRENT_HAND_COMBINATION_RETURNED_PROFILE');
    assert.equal(row.currentHand.certifiesEquilibriumActionValues, false); assert.equal(row.currentHand.certifiesConvergence, false);
    assert.equal(row.commitment.scope, 'FULL_PRIOR_COMMITMENT'); assert.equal(row.commitment.actualHandEVEquivalence, false);
    assert.equal(row.currentHand.actions.length, before[0].result.actions.length);
    assert.deepEqual(row.currentHand.actions.map(action => action.evBB), before[0].result.actions.map(action => action.evBB));
    assert.equal(row.heroWorldProbability, before[0].result.abstraction.heroWorldProbability);
  }
  assert.ok(result.comparisons[0].actionComparisons.every(row => row.deltaBB === 0));
});

test('range sensitivity changes only the explicit prior and reports conditional profile deltas, never interval deltas', () => {
  const a = entry('a', studyInput()), b = entry('b', studyInput({ prior: 'B' })), result = pair(a, b);
  assert.equal(result.classification, 'RANGE_SENSITIVITY');
  assert.notEqual(result.scenarios[0].heroWorldProbability, result.scenarios[1].heroWorldProbability);
  assert.notEqual(result.scenarios[0].gameHash, result.scenarios[1].gameHash);
  for (const row of result.comparisons[0].actionComparisons) assert.equal(row.deltaBB,
    b.result.actions.find(action => action.id === row.id).evBB - a.result.actions.find(action => action.id === row.id).evBB);
  assert.equal(result.comparisons[0].certifiesActualHandActionValues, false);
  assert.equal(result.comparisons[0].interpretation, 'RETURNED_PROFILE_MODEL_SENSITIVITY_NOT_UNCERTAINTY');
  assert.equal('differenceBoundsBB' in result.comparisons[0], false);
});

test('sizing sensitivity keeps every action and marks sizes missing in the baseline explicitly', () => {
  const a = entry('a', studyInput()), b = entry('b', studyInput({ tree: 'B' })), result = pair(a, b);
  assert.equal(result.classification, 'SIZING_SENSITIVITY');
  assert.equal(result.scenarios[0].heroWorldProbability, result.scenarios[1].heroWorldProbability);
  const additional = result.comparisons[0].actionComparisons.find(row => row.id === 'BET:1.50');
  assert.equal(additional.state, 'MISSING_IN_BASELINE'); assert.equal(additional.baselineEVBB, null); assert.equal(additional.deltaBB, null);
  assert.equal(result.comparisons[0].actionComparisons.length, b.result.actions.length);
  assert.equal(result.scenarios[0].coverage.fullLegalSizingCoverage, false);
  assert.ok(result.scenarios[0].coverage.omittedLegalSizeCount > 0);
});

test('simultaneous prior and sizing changes are incomparable, and distinct axes cannot form one three-study comparison', () => {
  const a = entry('a', studyInput());
  refused(a, entry('d', studyInput({ prior: 'B', tree: 'B' })), 'MULTIPLE_ASSUMPTIONS_CHANGED');
  const result = comparison.compare([a, entry('b', studyInput({ prior: 'B' })), entry('c', studyInput({ tree: 'B' }))]);
  assert.equal(result.classification, 'INCOMPARABLE'); assert.ok(result.reasonCodes.includes('MIXED_SCENARIO_AXES'));
});

test('ledger revision, actual Hero, fee, comparison policy and mathematical provenance cannot bridge studies', () => {
  const a = entry('a', studyInput());
  for (const [change, reason] of [
    [b => { b.input.multiway.editEpoch = (b.input.multiway.editEpoch || 0) + 1; }, 'RESULT_INPUT_CONTEXT_MISMATCH'],
    [b => { b.input.multiway.config.heroCards = [...b.input.ranges[0].combos[1].cards]; }, 'RESULT_INPUT_CONTEXT_MISMATCH'],
    [b => { b.input.rake = { type: 'FIXED', amount: .1 }; }, 'RESULT_ASSUMPTIONS_MISMATCH'],
    [b => { b.input.comparisonPolicy = { nearEquivalenceBB: .02 }; }, 'COMPARISON_POLICY_MISMATCH'],
    [b => { b.result.solverVersion = 'UNKNOWN'; }, 'UNUSABLE_PROFILE_RESULT'],
    [b => { b.result.source = 'HEURISTIC'; }, 'UNUSABLE_PROFILE_RESULT'],
    [b => { b.result.actionPrecision.utility.scope = 'CURRENT_HAND'; }, 'INVALID_PAYOFF_OR_SOLVER_PROVENANCE']
  ]) { const b = entry('b', studyInput()); change(b); refused(a, b, reason); }
  const ledger = entry('b', studyInput()); ledger.input.multiway.handId = '11111111-1111-4111-8111-111111111111';
  ledger.result.studyContext.ledger = comparison.ledgerFor(ledger.input);
  refused(a, ledger, 'DECISION_LEDGER_CHANGED');
});

test('exact emitted assumption verification follows builder summation order and ignores presentation metadata only', () => {
  const input = richRiverInput({ combos: 4, sizings: 2 });
  [1e12, .0001, .0001, 1].forEach((weight, index) => { input.ranges[0].combos[index].weight = weight; });
  input.ranges.forEach(range => { range.combos.reverse(); range.combos.forEach(combo => combo.cards.reverse()); });
  const a = entry('a', input), b = clone(a); b.id = 'b'; b.input.ranges.reverse();
  b.input.multiway.config.playerNames = ['PRIVATE_SENTINEL', 'PRIVATE_SENTINEL'];
  b.input.multiway.events.forEach(event => { event.notes = 'PRIVATE_SENTINEL'; });
  assert.equal(pair(a, b).classification, 'SAME_GAME');
  assert.equal(JSON.stringify(pair(a, b)).includes('PRIVATE_SENTINEL'), false);
  const tampered = clone(b); tampered.input.ranges[0].combos[0].weight *= 2;
  refused(a, tampered, 'RESULT_ASSUMPTIONS_MISMATCH');
});

test('initial pending certificates retain profile EV honestly while unfinished commitments have null values', () => {
  const a = entry('a', studyInput(), 1), b = entry('b', studyInput(), 1), result = pair(a, b);
  assert.equal(result.classification, 'SAME_GAME'); assert.equal(result.scenarios[0].usable, true);
  assert.ok(result.scenarios[0].currentHand.actions.every(row => Number.isFinite(row.evBB)));
  assert.ok(result.scenarios[0].commitment.rows.every(row => !row.certified && row.estimateBB === null && row.lowerBB === null && row.upperBB === null));
  const progressive = entry('b', studyInput(), 1); progressive.result.status = 'REFINING';
  progressive.result.decisionOutcome = outcome.decide(progressive.result, { refining: true, policy: progressive.result.comparisonPolicy });
  assert.equal(pair(a, progressive).scenarios[1].commitment.status, 'ESTIMATING');
});

test('missing actions, unknown values, unsupported results and incomplete declared trees cannot be ranked', () => {
  const a = entry('a', studyInput());
  for (const change of [b => { b.result.actions[0].evBB = null; }, b => { b.result.actions.pop(); },
    b => { b.result.actions = [null]; }, b => { b.result.status = 'NOT_SOLVED'; },
    b => { b.result.abstraction.treeComplete = false; }, b => { b.result.abstraction.chanceSupportComplete = false; }]) {
    const b = entry('b', studyInput()); change(b); const result = refused(a, b);
    assert.deepEqual(result.scenarios[1].currentHand.actions, []); assert.equal(result.scenarios[1].heroWorldProbability, null);
  }
});

test('outward certificates require exact enclosing origin, hash, information set and rounding tags', () => {
  const a = entry('a', studyInput());
  for (const change of [row => { row.baseContextKey = '0'.repeat(64); }, row => { row.conditionedHash = '0'.repeat(64); },
    row => { row.rounding = 'ROUNDED'; }, row => { row.informationSet = 'REVEALED_HERO'; },
    row => { row.originalHandActionEV = true; }]) {
    const b = entry('b', studyInput()), row = b.result.actionPrecision.actions.find(item => item.certified);
    assert.ok(row); change(row); refused(a, b, 'INVALID_COMMITMENT_BOUND_CONTEXT');
  }
});

test('incoherent convergence and fabricated strict or near-equivalent labels fail closed', () => {
  const a = entry('a', studyInput());
  for (const change of [b => { b.result.convergence.nashConv = -1; },
    b => { b.result.convergence.nashConv = 1; b.result.convergence.thresholdMet = true; },
    b => { b.result.convergence.thresholdBB = 2; }, b => { b.result.decisionOutcome.globalConverged = !b.result.decisionOutcome.globalConverged; },
    b => { b.result.decisionOutcome.status = 'CERTIFIED'; b.result.decisionOutcome.strictLeaderActionId = 'FOLD'; },
    b => { b.result.decisionOutcome.status = 'NEAR_EQUIVALENT'; b.result.decisionOutcome.nearGroupActionIds = b.result.actions.map(row => row.id); b.result.decisionOutcome.robustWorstDifferenceBB = 0; }]) {
    const b = entry('b', studyInput()); change(b); refused(a, b);
  }
});

test('valid existing near-equivalence remains a full-prior claim despite rare Hero and unrelated hand profile EV', () => {
  const a = entry('a', studyInput({ prior: 'B' }), 1000), b = clone(a); b.id = 'b';
  assert.equal(a.result.decisionOutcome.status, 'NEAR_EQUIVALENT');
  const result = pair(a, b); assert.equal(result.classification, 'SAME_GAME');
  assert.equal(result.scenarios[0].commitment.status, 'NEAR_EQUIVALENT');
  assert.equal(result.scenarios[0].commitment.actualHandEVEquivalence, false);
  assert.ok(result.scenarios[0].heroWorldProbability < .001);
});

test('complete A/B/C examples are supported without omitted cents or aggression frontiers', () => {
  const expected = { A: [16, 3], B: [4, 5], C: [3, 2] };
  for (const [id, input] of Object.entries(completeExamples())) {
    const built = builder.buildPloRiverGame(input); assert.equal(built.status, 'READY', JSON.stringify(built.reasons));
    assert.equal(built.coverage, 'FINITE_RIVER_SUBGAME'); assert.equal(built.game.meta.fullLegalSizingCoverage, true);
    assert.equal(built.game.meta.compatibleWorlds, expected[id][0]); assert.equal(built.game.meta.rootActions.length, expected[id][1]);
    assert.equal(built.metrics.omittedSizingNodes, 0); assert.equal(built.metrics.aggressionCapNodes, 0);
  }
});

test('one-to-three bound and duplicate scenario identities fail closed; absent telemetry stays null', () => {
  assert.equal(comparison.compare([]).classification, 'INCOMPARABLE');
  assert.equal(comparison.compare(Array(4).fill({})).reasonCodes[0], 'ONE_TO_THREE_SCENARIOS_REQUIRED');
  assert.equal(comparison.compare([entry('a', studyInput())]).reasonCodes[0], 'INSUFFICIENT_SCENARIOS');
  const a = entry('a', studyInput()), b = clone(a); refused(a, b, 'DUPLICATE_SCENARIO_ID');
  b.id = 'b'; b.timing = { firstValueMs: null, workerMs: NaN };
  assert.deepEqual(pair(a, b).scenarios[1].timing, { acknowledgementMs: null, firstResponseMs: null, firstValueMs: null, completionMs: null, workerMs: null });
  const cyclic = {}; cyclic.multiway = cyclic;
  assert.equal(comparison.compare([{}, { input: cyclic }]).classification, 'INCOMPARABLE');
});

test('browser UMD has the same pure comparison contract without require, Node globals, eval or data leakage', () => {
  const source = fs.readFileSync(require.resolve('../public/solver-study-comparison'), 'utf8'), sandbox = {};
  vm.runInNewContext(source, sandbox);
  const entries = [entry('a', studyInput()), entry('b', studyInput({ tree: 'B' }))];
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.TheibsSolverStudyComparison.compare(clone(entries)))), comparison.compare(entries));
  assert.equal(sandbox.TheibsSolverStudyComparison.VERSION, comparison.VERSION);
  assert.equal(/\beval\s*\(|new\s+Function\b/.test(source), false);
});

module.exports = { studyInput, completeExamples };
