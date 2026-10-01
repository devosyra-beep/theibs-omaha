'use strict';
// QA artifact only: current Node pipeline and unchanged mathematical core.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const worker = require('../../src/solver/job-worker');
const fixtures = require('../../public/solver-validation-fixtures.json');
const session = require('../../src/multiway-session');
const { richRiverInput } = require('./solver-river-growth-reference.cjs');
const adapter = require('../../src/solver/plo-river-game');
const expandedLP = require('../../docs/benchmarks/river-hu-expanded-lp-reference.json');
const expandedContract = require('../../docs/benchmarks/river-hu-expanded-contract.json');
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key] ?? null]));
function mathematical(result, checkpoint) {
  return {
    ...pick(result, ['status', 'method', 'solverVersion', 'gameHash', 'scope', 'strategyScope', 'iterations']),
    actions: (result.actions || []).map(row => pick(row, ['id', 'action', 'size', 'frequency', 'evBB'])),
    convergence: pick(result.convergence, ['metric', 'exact', 'nashConv', 'maxUnilateralGain', 'unilateralGains', 'bestResponseValues', 'scope', 'thresholdMet', 'thresholdBB']),
    qualification: pick(result.qualification, ['gto', 'fullHandEquilibrium', 'solvedSubgame', 'strategyFrequenciesSupported']),
    actionPrecision: { ...pick(result.actionPrecision, ['version', 'target', 'origin', 'solverVersion', 'baseGameHash', 'baseContextKey', 'scope', 'utility', 'supportedGameClass', 'fullPriorPreserved', 'originalHandActionEV']),
      actions: (result.actionPrecision?.actions || []).map(row => pick(row, ['id', 'certified', 'estimateBB', 'lowerBB', 'upperBB', 'baseGameHash', 'baseContextKey', 'gameHash', 'conditionedHash', 'rootActionFixed', 'target', 'utility', 'iterations', 'strategicDecisionCount'])) },
    decisionPrecision: pick(result.decisionPrecision, ['status', 'target', 'bestActionId', 'secondActionId', 'leaderConclusive', 'globalBestSupported', 'reasonCode', 'separationToleranceBB', 'uncertaintyMethod', 'uncertaintyScope', 'confidenceLevel']),
    decisionOutcome: pick(result.decisionOutcome, ['version', 'status', 'scope', 'target', 'actualHandEVEquivalence', 'policy', 'policyKey', 'actionIds', 'strictLeaderActionId', 'nearGroupActionIds', 'robustWorstDifferenceBB', 'reasonCode']),
    adaptation: pick(result.adaptation, ['stopReason', 'workIterations', 'globalIterations', 'actionIterations']),
    checkpoint: pick(checkpoint, ['version', 'solverVersion', 'certificateVersion', 'comparisonPolicyKey', 'baseContextKey', 'baseGameHash', 'iterations', 'workIterations'])
  };
}
const budget = { timeMs: 5000, iterations: 512 };
const cases = fixtures.cases.map(scenario => {
  const variant = scenario.variants[0];
  const output = worker.execute({ input: variant.input, budget });
  if (output.result.adaptation?.stopReason === 'TIME_RESOURCE_CEILING') throw Error('Fixed-work reference reached time ceiling: ' + scenario.id);
  return { id: scenario.id, variantId: variant.id, expectedRevisionKey: variant.expectedRevisionKey, budget, independentExpectation: scenario.expectation,
    mathematical: mathematical(output.result, output.checkpoint), evidence: 'NODE_REFERENCE_NOT_BROWSER_EXECUTION' };
});
const lpInput = richRiverInput({ combos: 4, sizings: 5 });
// Fix synthetic IDs and ledger to the existing deterministic fixture. Math key
// is checked against the stored LP artifact before using any reference value.
lpInput.multiway = structuredClone(fixtures.invalidation[0].base.input.multiway);
const lpBuilt = adapter.buildPloRiverGame(lpInput);
const lpReference = expandedLP.cases.find(row => row.combos === 4 && row.sizings === 5);
if (lpBuilt.status !== 'READY' || lpBuilt.game.meta.key !== lpReference.key) throw Error('Expanded LP reference does not identify this exact declared game');
const lpOutput = worker.execute({ input: lpInput, budget });
if (lpOutput.result.adaptation?.stopReason === 'TIME_RESOURCE_CEILING') throw Error('4x4 LP fixed-work reference reached time ceiling');
cases.push({ id: 'lp_rich_4x4_5_sizes', variantId: 'lp-rich-4x4-fixed', input: lpInput,
  expectedRevisionKey: session.envelope(lpInput.multiway).state.revisionKey, budget,
  independentExpectation: { actionValues: Object.fromEntries(lpReference.actions.map(row => [row.id, row.referenceValueBB])),
    referenceToleranceBB: Math.max(...lpReference.actions.map(row => row.reference.validationTolerance)),
    referenceMethod: lpReference.reference.method, source: 'docs/benchmarks/river-hu-expanded-lp-reference.json', exactGameKey: lpReference.key,
    numericalReferenceOnly: true },
  mathematical: mathematical(lpOutput.result, lpOutput.checkpoint), evidence: 'NODE_REFERENCE_WITH_STORED_INDEPENDENT_LP_CONTAINMENT_NOT_BROWSER_EXECUTION' });
const overlappingInput = structuredClone(lpInput);
overlappingInput.ranges[0].combos[0].weight = 0.001;
const overlappingOutput = worker.execute({ input: overlappingInput, budget });
if (overlappingOutput.result.decisionPrecision?.status !== 'INCONCLUSIVE' || !(overlappingOutput.result.decisionPrecision.deltaEVBB > 0)
    || !overlappingOutput.result.actionPrecision?.actions.every(row => row.certified)) throw Error('Non-tied overlap fixture did not reproduce its declared condition');
cases.push({ id: 'non_tied_overlapping_4x4', variantId: 'non-tied-overlap-fixed', input: overlappingInput,
  expectedRevisionKey: session.envelope(overlappingInput.multiway).state.revisionKey, budget,
  independentExpectation: { comparisonStatus: 'INCONCLUSIVE', requireOverlap: true, requireNonTiedPointEstimates: true, referenceKind: 'MATCHED_NODE_PARITY_AND_CERTIFICATE_SELF_CONSISTENCY_ONLY' },
  mathematical: mathematical(overlappingOutput.result, overlappingOutput.checkpoint), evidence: 'NODE_REFERENCE_NOT_INDEPENDENT_LP_FOR_CHANGED_WEIGHTS_NOT_BROWSER_EXECUTION' });
// The independent LP/rational witness is generated by the separate QA oracle.
// Verify its source graph and exact game identity before publishing browser checks.
for (const [file, digest] of Object.entries(expandedContract.sourceDigests)) {
  const actualDigest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'src/solver', file))).digest('hex');
  if (actualDigest !== digest) throw Error('Expanded independent reference source changed: ' + file);
}
for (const scenario of expandedContract.cases.filter(row => row.actions?.length && row.originalGameReference)) {
  const built = adapter.buildPloRiverGame(scenario.input);
  if (built.status !== 'READY' || built.game.meta.key !== scenario.gameKey) throw Error('Expanded reference game identity changed: ' + scenario.id);
  const output = worker.execute({ input: scenario.input, budget });
  if (output.result.gameHash !== scenario.gameHash || output.result.adaptation?.stopReason === 'TIME_RESOURCE_CEILING') throw Error('Expanded reference fixed-work identity/ceiling failed: ' + scenario.id);
  cases.push({ id: 'contract_' + scenario.id, variantId: 'contract-' + scenario.id, input: scenario.input,
    expectedRevisionKey: scenario.expectedRevisionKey, budget,
    independentExpectation: {
      numericalLPValuesBB: Object.fromEntries(scenario.actions.map(row => [row.id, row.numericalReferenceValueBB])),
      referenceToleranceBB: 0,
      exactActionEnvelopes: Object.fromEntries(scenario.actions.map(row => [row.id, row.exactLPFeasiblePolicyEnvelope])),
      conditionedGameHashes: Object.fromEntries(scenario.actions.map(row => [row.id, row.conditionedGameHash])),
      exactBaseContextKey: scenario.fixedWork.baseContextKey,
      comparisonStatus: scenario.fixedWork.decisionStatus,
      referenceMethod: 'INDEPENDENT_SEQUENCE_FORM_LP_AND_EXACT_RATIONAL_FEASIBLE_POLICY_ENVELOPE',
      source: 'docs/benchmarks/river-hu-expanded-contract.json', exactGameKey: scenario.gameKey,
      numericalReferenceOnly: true
    },
    mathematical: mathematical(output.result, output.checkpoint), evidence: 'NODE_REFERENCE_WITH_INDEPENDENT_LP_AND_ZERO_TOLERANCE_RATIONAL_CONTAINMENT_NOT_BROWSER_EXECUTION' });
}
const report = {
  schemaVersion: 1,
  classification: 'NODE_MATH_REFERENCE',
  releaseVersion: require('../../package.json').version,
  methodology: 'Current Node adaptive pipeline, unchanged mathematical core, fixed maximum 512 work iterations and 5000 ms. Cases must stop before a time ceiling. Browser comparison requires identical game/context hashes, comparison policy, action identities, stopped work count, and numeric values within 1e-10. The richer 4x4 input is checked against the stored LP game key before extracting containment values; LP residual tolerance never declares dominance. Timed benchmarks do not require identical point values across different stopping work.',
  independentReference: fixtures.reference,
  sourceJobWorkerSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'src/solver/job-worker.js'), 'utf8').replace(/\r\n?/g, '\n')).digest('hex'),
  sourceBuildFingerprint: require('../../public/browser-solver-manifest.json').buildFingerprint,
  cases
};
const destination = path.join(root, 'public/browser-solver-reference.json');
fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ destination, cases: cases.map(row => ({ id: row.id, workIterations: row.mathematical.adaptation.workIterations, stopReason: row.mathematical.adaptation.stopReason, status: row.mathematical.status, precision: row.mathematical.decisionPrecision.status })) }, null, 2));
module.exports = { mathematical };
