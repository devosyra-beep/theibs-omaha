'use strict';
// Independent small model/reference gate; browser interactivity is a separate gate.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const helper = require('./helpers/river-hu-expanded-contract-reference.cjs');
const benchmark = require('../scripts/benchmark-inconclusive-pipeline.cjs');
const outcome = require('../src/solver/decision-outcome'), worker = require('../src/solver/job-worker');
const precision = require('../src/decision-precision'), core = require('../src/solver/extensive-solver');
const adapter = require('../src/solver/plo-river-game');
const source = path.resolve(__dirname, '..'), before = benchmark.hashes(source);
const records = []; let passed = 0, declared = 0, nearReference;
const check = (name, fn) => { declared++; test(name, async () => { await fn(); passed++; }); };
function snapshot(bounds) {
  const solverVersion = core.VERSION, abstraction = { key: 'independent-adversarial-game', heroInformationSet: 'HERO', heroSeat: 0,
    originalSeats: 2, constantSum: true, treeComplete: true, chanceSupportComplete: true, rootActions: bounds.map(([id]) => ({ id })) };
  const baseContextKey = createHash('sha256').update(JSON.stringify([abstraction.key, abstraction.heroInformationSet, solverVersion, precision.ACTION_BOUND_VERSION || 'THEIBS_ACTION_CONDITIONED_V1'])).digest('hex');
  const common = { version: 'THEIBS_ACTION_CONDITIONED_V1', target: precision.COMMITMENT_TARGET, origin: precision.SOLVER_BOUND_METHOD,
    solverVersion, player: 0, informationSet: 'HERO', baseGameHash: 'a'.repeat(64), baseContextKey,
    utility: { unit: 'BB', basis: 'INCREMENTAL_TERMINAL_PAYOFF_FROM_ORIGINAL_DECISION', scope: 'FULL_PRIOR_EX_ANTE' },
    fullPriorPreserved: true, originalHandActionEV: false };
  return { source: 'REFERENCE_SUBGAME_STRATEGY', status: 'APPROXIMATE', solverVersion, gameHash: common.baseGameHash, abstraction,
    // Deliberately unrelated conditional profile EVs must never influence proof.
    actions: bounds.map(([id], index) => ({ id, evBB: index ? -999 : 999 })),
    convergence: { exact: true, thresholdMet: true, nashConv: 0 },
    actionPrecision: { ...common, supportedGameClass: true, actions: bounds.map(([id, lowerBB, upperBB]) => ({ ...common, id,
      certified: true, lowerBB, upperBB, estimateBB: lowerBB / 2 + upperBB / 2,
      gameHash: id + '-conditioned', conditionedHash: id + '-conditioned', rootActionFixed: id, rounding: 'IEEE754_BINARY64_NEXTAFTER_EACH_OPERATION' })) } };
}
check('near comparison uses full-prior endpoints, leaves strict precision unchanged, and never uses hand EV', () => {
  const s = snapshot([['A', 0, 0], ['B', .004, .004]]), original = structuredClone(s);
  const strict = precision.solverDecisionPrecision(s), result = outcome.decide(s);
  assert.equal(strict.status, 'CONCLUSIVE'); assert.equal(strict.bestActionId, 'B');
  assert.equal(result.status, 'NEAR_EQUIVALENT'); assert.deepEqual(result.nearGroupActionIds, ['A', 'B']);
  assert.equal(result.actualHandEVEquivalence, false); assert.equal(result.scope, 'FULL_PRIOR_COMMITMENT'); assert.deepEqual(s, original);
});
check('true equal action tie has a near proof but no strict leader', () => {
  const s = snapshot([['A', 0, 0], ['B', 0, 0]]);
  assert.equal(precision.solverDecisionPrecision(s).status, 'INCONCLUSIVE'); assert.equal(outcome.decide(s).status, 'NEAR_EQUIVALENT');
});
check('outward threshold guard accepts below epsilon and withholds a boundary rounded upward', () => {
  assert.equal(outcome.decide(snapshot([['A', 0, 0], ['B', .00999999, .00999999]])).status, 'NEAR_EQUIVALENT');
  const boundary = outcome.decide(snapshot([['A', 0, 0], ['B', .01, .01]]));
  assert.notEqual(boundary.status, 'NEAR_EQUIVALENT');
  const difference = outcome.outwardDifference(1, -.01), exact = helper.subtract(helper.fromNumber(1), helper.fromNumber(-.01));
  assert.ok(helper.compare(helper.fromNumber(difference), exact) >= 0, 'Difference must be rounded toward positive infinity.');
});
check('epsilon zero permits exactly equal supplied endpoints without inventing strict precision', () => {
  const s = snapshot([['A', 1, 1], ['B', 1, 1]]), r = outcome.decide(s, { policy: { nearEquivalenceBB: 0 } });
  assert.equal(r.status, 'NEAR_EQUIVALENT'); assert.equal(r.robustWorstDifferenceBB, 0); assert.equal(precision.solverDecisionPrecision(s).status, 'INCONCLUSIVE');
});
check('third wide or missing candidate prevents a two-row near conclusion', () => {
  const wide = snapshot([['A', 1, 1.002], ['B', 1, 1.003], ['C', -5, 4]]);
  assert.equal(outcome.decide(wide).status, 'INCONCLUSIVE');
  const missing = structuredClone(wide); missing.actionPrecision.actions[2].certified = false;
  assert.equal(outcome.decide(missing).status, 'INCONCLUSIVE');
  assert.equal(outcome.decide(missing, { refining: true }).status, 'ESTIMATING');
  const focus = worker.focusActions(['A', 'B', 'C'], wide.actionPrecision.actions);
  assert.ok(focus.survivingActionIds.includes('C'), 'Wide rival cannot be pruned using point EV or two-row overlap.');
  const dropped = structuredClone(wide); dropped.actions.pop(); dropped.actionPrecision.actions.pop();
  assert.ok(!['CERTIFIED', 'NEAR_EQUIVALENT'].includes(outcome.decide(dropped).status), 'Removing a declared competitor from both public arrays cannot fabricate proof.');
});
check('strictly dominated third action stays in all-alternative near proof and original rows', () => {
  const s = snapshot([['A', 1, 1.002], ['B', 1.001, 1.003], ['C', -4, -3]]);
  const r = outcome.decide(s); assert.equal(r.status, 'NEAR_EQUIVALENT'); assert.deepEqual(r.nearGroupActionIds, ['A', 'B']);
  assert.equal(r.diagnostics.counts.declared, 3); assert.equal(s.actions.length, 3);
});
check('epsilon pruning only changes extra refinement and fairness keeps a wide third candidate eligible', () => {
  const rows = snapshot([['A', 1, 1.002], ['B', .996, .998], ['C', -4, -3]]).actionPrecision.actions;
  const selected = worker.chooseFocus(['A', 'B', 'C'], rows, {}, { nearEquivalenceBB: .01 });
  assert.ok(selected.refinementActionIds.includes('B'), 'A strictly dominated action within epsilon still needs near-group refinement.');
  assert.equal(selected.refinementActionIds.includes('C'), false, 'A rigorously distant action may leave extra refinement only.');
  assert.equal(rows.length, 3, 'Original complete comparison still retains every action.');
  const wide = snapshot([['A', 1, 1.002], ['B', 1, 1.003], ['C', -5, 4]]).actionPrecision.actions;
  assert.equal(worker.chooseFocus(['A', 'B', 'C'], wide, { A: 2, B: 2, C: 0 }).id, 'C');
  assert.equal(worker.focusActions(['A', 'B'], snapshot([['A', 0, 0], ['B', 0, 0]]).actionPrecision.actions).separated, false);
});
check('global convergence is required separately from narrow action intervals', () => {
  for (const edit of [s => { s.convergence.thresholdMet = false; }, s => { s.convergence.exact = false; },
    s => { s.convergence.nashConv = .0100001; }, s => { s.convergence.nashConv = NaN; }, s => { s.convergence.nashConv = -1; }]) {
    const s = snapshot([['A', 0, 0], ['B', .001, .001]]); edit(s); assert.equal(outcome.decide(s).status, 'INCONCLUSIVE');
  }
});
check('unsupported result/source, duplicate identities, invalid origins, and non-commitment bounds cannot prove outcomes', () => {
  for (const edit of [s => { s.status = 'NOT_SOLVED'; }, s => { s.status = 'HEURISTIC'; },
    s => { s.source = 'LEGACY_CONTEXT_CONTINUATION'; }, s => { s.source = 'UNKNOWN_QUALIFICATION_SOURCE'; }, s => { s.actions[1].id = 'A'; },
    s => { s.actionPrecision.actions[1].baseGameHash = 'b'.repeat(64); }, s => { s.actionPrecision.actions[1].conditionedHash = 'other'; },
    s => { s.actionPrecision.originalHandActionEV = true; }, s => { s.actionPrecision.utility.scope = 'CURRENT_HAND'; },
    s => { s.actionPrecision.supportedGameClass = false; }, s => { s.actionPrecision.actions[1].estimateBB = 100; }]) {
    const s = snapshot([['A', 0, 0], ['B', .001, .001]]); edit(s); assert.ok(!['CERTIFIED', 'NEAR_EQUIVALENT'].includes(outcome.decide(s).status));
  }
});
check('policy identity isolates epsilon and rejects null, negative, and wrong scope', () => {
  assert.notEqual(outcome.policyKey({ nearEquivalenceBB: .01 }), outcome.policyKey({ nearEquivalenceBB: .005 }));
  for (const policy of [null, { nearEquivalenceBB: null }, { nearEquivalenceBB: -.1 }, { nearEquivalenceBB: Infinity }, { scope: 'CURRENT_HAND' }]) assert.throws(() => outcome.normalizePolicy(policy));
});
check('range-source and policy identity stay separate from conditional profile EV', () => {
  const base = structuredClone(helper.scenarios().find(row => row.id === 'joint_blockers_nonuniform_prior').input);
  const previous = adapter.coverage(base), changed = structuredClone(base); changed.ranges[1].source = 'DIFFERENT_EXPLICIT_STUDY';
  const next = adapter.coverage(changed); assert.equal(next.status, 'READY'); assert.notEqual(previous.key, next.key);
  base.comparisonPolicy = { nearEquivalenceBB: .005 }; assert.equal(adapter.coverage(base).key, previous.key, 'Comparison policy must not alter represented game math.');
});
check('required small independent LP reference for new near tie has exact rational endpoint witnesses', () => {
  const scenario = benchmark.selectedCases().find(row => row.id === 'marginal_near_action_tie');
  nearReference = benchmark.independentNearReference(scenario.input);
  const call = nearReference.actions.find(row => row.id === 'CALL'); assert.ok(Math.abs(call.numericalReferenceValueBB - .004) < 1e-12);
  assert.ok(nearReference.actions.every(row => row.exactLPFeasiblePolicyEnvelope.lower.numerator));
});
for (const scenario of benchmark.selectedCases().filter(row => !row.hard)) check('small retained pipeline certificate: ' + scenario.id, () => {
  const reference = scenario.referenceData || nearReference; assert.ok(reference, 'LP test must execute before near retained certificate.');
  const built = adapter.buildPloRiverGame(scenario.input); assert.equal(built.status, 'READY');
  assert.equal(core.validateGame(built.game).gameHash, reference.gameHash);
  const output = worker.execute({ input: scenario.input, budget: { timeMs: 3000, iterations: 1000 } }, { compilationReuse: true });
  const r = output.result, result = benchmark.verifyOutcome(r, source), containment = benchmark.checkReference(r, reference);
  assert.equal(r.actions.length, built.game.meta.rootActions.length); assert.equal(r.qualification.gto, false);
  assert.equal(containment.certifiedRowsChecked, r.actionPrecision.actions.length, 'Small cases require every outward bound.');
  if (scenario.id === 'marginal_true_action_tie') { assert.equal(result.status, 'NEAR_EQUIVALENT'); assert.equal(r.decisionPrecision.status, 'INCONCLUSIVE'); }
  if (scenario.id === 'marginal_near_action_tie') assert.equal(result.status, 'NEAR_EQUIVALENT');
  if (scenario.id === 'joint_blockers_nonuniform_prior') {
    const call = r.actions.find(row => row.id === 'CALL'), bound = r.actionPrecision.actions.find(row => row.id === 'CALL');
    assert.ok(Math.abs(call.evBB - bound.estimateBB) > .1, 'Conditional hand EV must remain separate from commitment target.');
  }
  if (scenario.id === 'rare_actual_hand_full_prior_commitment') {
    const fold = r.actions.find(row => row.id === 'FOLD'), bound = r.actionPrecision.actions.find(row => row.id === 'FOLD');
    assert.ok(Math.abs(fold.evBB - bound.estimateBB) > .1, 'Rare actual Hero hand must not turn the full-prior certificate into its conditional EV.');
    assert.equal(r.decisionOutcome.actualHandEVEquivalence, false);
  }
  records.push({ id: scenario.id, gameKey: r.abstraction.key, gameHash: r.gameHash, outcome: result.status, strictPrecision: r.decisionPrecision.status,
    globalNashConv: r.convergence.nashConv, allBounded: true, boundsAddedToleranceBB: 0, containment, stopReason: r.adaptation.stopReason });
});
check('percentage fee remains unqualified and cannot acquire a near proof', () => {
  const scenario = helper.scenarios().find(row => row.id === 'percentage_fee_not_constant_sum_qualified');
  const r = worker.execute({ input: scenario.input, budget: { timeMs: 3000, iterations: 1000 } }, { compilationReuse: true }).result;
  assert.equal(r.actionPrecision.status, 'UNSUPPORTED'); assert.equal(r.decisionPrecision.status, 'INCONCLUSIVE'); assert.equal(r.decisionOutcome.status, 'INCONCLUSIVE');
});
check('changed policy cannot reuse old adaptive certificate work, while mathematical game identity is retained', () => {
  const input = structuredClone(helper.scenarios().find(row => row.id === 'marginal_true_action_tie').input);
  const first = worker.execute({ input, budget: { timeMs: 3000, iterations: 1000 } }, { compilationReuse: true });
  const nextInput = structuredClone(input); nextInput.comparisonPolicy = { nearEquivalenceBB: .005 };
  const next = worker.execute({ input: nextInput, checkpoint: first.checkpoint, budget: { timeMs: 3000, iterations: 1000 } }, { compilationReuse: true });
  assert.equal(first.result.gameHash, next.result.gameHash); assert.equal(first.result.abstraction.key, next.result.abstraction.key);
  assert.notEqual(first.result.decisionOutcome.policyKey, next.result.decisionOutcome.policyKey);
  assert.notEqual(first.checkpoint.comparisonPolicyKey, next.checkpoint.comparisonPolicyKey);
  assert.ok(next.result.metrics.runCosts.actionCertificateMs > 0, 'Changed policy must not retain prior certificate work silently.');
});
test.after(() => {
  assert.equal(passed, declared, 'Do not publish a gate with failed tests.'); assert.deepEqual(benchmark.hashes(source), before, 'Source changed during independent gate.');
  const gate = { schemaVersion: 1, classification: 'INDEPENDENT_SMALL_LP_AND_EXACT_ENDPOINT_OUTCOME_GATE', generatedAt: new Date().toISOString(),
    sourceDigests: before, sourceStableThroughoutRun: true, sourceVersions: { adaptive: worker.VERSION, core: core.VERSION, outcome: outcome.VERSION },
    tests: { passed, failed: 0, skipped: 0 }, smallRetainedCases: records.length, records, nearReference,
    methodology: 'Stored exact-game independent LP feasible-policy rational envelopes plus two fresh conditioned LPs for the new near-tie game. Production outer endpoint containment has zero added tolerance. Adversarial pure classifier fixtures exercise all declared alternatives, outward epsilon, unsupported context and separate global convergence. These are commitment bounds, not current-hand EV uncertainty.',
    notExecuted: ['Actual browser main-thread responsiveness', 'Physical phone', 'Authenticated game', 'Population prior quality', 'LP reference for expanded hard benchmark'] };
  fs.mkdirSync(path.dirname(benchmark.gatePath), { recursive: true }); fs.writeFileSync(benchmark.gatePath, JSON.stringify(gate, null, 2) + '\n');
});
