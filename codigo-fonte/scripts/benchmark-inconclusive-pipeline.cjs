'use strict';
// Bounded local diagnostic. The browser gate separately measures DOM responsiveness.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const assert = require('node:assert/strict');
const source = path.resolve(__dirname, '..'), root = path.resolve(source, '..');
const BASELINE = '54854da75944217765a9b09148b67a3f4e208937';
const local = path.join(root, 'validacao/inconclusive-pipeline');
const preparedPath = path.join(local, 'baseline-prepared.json');
const gatePath = path.join(local, 'independent-gate.json');
const outputPath = path.join(source, 'docs/benchmarks/inconclusive-pipeline.json');
const hash = data => createHash('sha256').update(data).digest('hex');
const files = ['src/solver/job-worker.js', 'src/solver/extensive-solver.js', 'src/solver/action-conditioned.js',
  'src/solver/plo-river-game.js', 'src/solver/versions.js', 'src/solver/decision-outcome.js', 'src/decision-precision.js'];
function hashes(directory) { return Object.fromEntries(files.map(file => [file, fs.existsSync(path.join(directory, file)) ? hash(fs.readFileSync(path.join(directory, file))) : null])); }
function stats(values) { const ordered = values.filter(Number.isFinite).sort((a, b) => a - b); return { count: ordered.length,
  p50: ordered[Math.max(0, Math.ceil(ordered.length * .5) - 1)] ?? null, p95: ordered[Math.max(0, Math.ceil(ordered.length * .95) - 1)] ?? null }; }
function selectedCases() {
  const helper = require('../test/helpers/river-hu-expanded-contract-reference.cjs');
  const stored = require('../docs/benchmarks/river-hu-expanded-contract.json');
  const ids = ['royal_flush_nuts_facing_bet', 'marginal_true_action_tie', 'fixed_rake_changes_preferred_action',
    'joint_blockers_nonuniform_prior', 'rare_actual_hand_full_prior_commitment', 'short_stack_changes_legal_tree'];
  const cases = ids.map(id => { const scenario = helper.scenarios().find(row => row.id === id); return { ...scenario, referenceData: stored.cases.find(row => row.id === id) }; });
  const near = structuredClone(helper.scenarios().find(row => row.id === 'marginal_positive_call'));
  near.id = 'marginal_near_action_tie'; near.categories = ['NEAR_ACTION_TIE', 'NONUNIFORM_OPPONENT'];
  near.input.ranges[1].combos[0].weight = .2501; near.input.ranges[1].combos[1].weight = .7499;
  near.input.multiway.handId = '00000000-0000-4000-8000-000000009901'; near.expectation = { analyticalCallBB: .004 };
  cases.splice(2, 0, near);
  const growth = require('../public/solver-validation-growth-fixtures.json').cases;
  const hard = growth.find(row => row.id.includes('12x12')) || growth.at(-1);
  cases.push({ id: 'hard_' + hard.id, categories: ['HARD', 'EXPANDED_RANGES', 'MULTIPLE_SIZINGS'], input: hard.variants[0].input,
    reference: false, hard: true, referenceStatus: 'NOT_AVAILABLE_FOR_THIS_EXACT_GAME' });
  return cases;
}
const decode = endpoint => ({ n: BigInt(endpoint.numerator), d: BigInt(endpoint.denominator) });
function checkReference(result, referenceData) {
  if (!referenceData) return { status: 'NOT_AVAILABLE_FOR_THIS_EXACT_GAME', certifiedRowsChecked: 0, maximumMidpointErrorVsNumericLPBB: null };
  assert.equal(result.abstraction.key, referenceData.gameKey, 'Stored LP belongs to a different declared game.');
  assert.equal(result.gameHash, referenceData.gameHash, 'Stored LP tree hash differs.');
  const helper = require('../test/helpers/river-hu-expanded-contract-reference.cjs');
  let checked = 0, error = 0;
  for (const row of result.actionPrecision.actions.filter(row => row.certified)) {
    const expected = referenceData.actions.find(action => action.id === row.id); assert.ok(expected, 'Reference action missing.');
    const lower = decode(expected.exactLPFeasiblePolicyEnvelope.lower), upper = decode(expected.exactLPFeasiblePolicyEnvelope.upper);
    helper.assertOuterInterval(row.lowerBB, row.upperBB, helper.fraction(lower.n, lower.d), helper.fraction(upper.n, upper.d), 'New pipeline retained LP envelope');
    assert.ok(row.lowerBB <= expected.numericalReferenceValueBB && row.upperBB >= expected.numericalReferenceValueBB, 'Numeric LP point excluded.');
    error = Math.max(error, Math.abs(row.estimateBB - expected.numericalReferenceValueBB)); checked++;
  }
  return { status: 'EXACT_RATIONAL_ENVELOPE_AND_NUMERIC_LP_CONTAINMENT', certifiedRowsChecked: checked, boundsAddedToleranceBB: 0,
    maximumMidpointErrorVsNumericLPBB: checked ? error : null, errorTarget: 'FULL_PRIOR_COMMITMENT_INTERVAL_MIDPOINT_NOT_CURRENT_HAND_EV' };
}
function verifyOutcome(result, directory) {
  const { solverDecisionPrecision } = require(path.join(directory, 'src/decision-precision.js'));
  const strict = solverDecisionPrecision(result), c = result.actionPrecision;
  const converged = result.convergence?.exact === true && result.convergence.thresholdMet === true
    && Number.isFinite(result.convergence.nashConv) && result.convergence.nashConv >= 0 && result.convergence.nashConv <= .01;
  const all = c?.actions?.length >= 2 && c.actions.every(row => row.certified && Number.isFinite(row.lowerBB) && Number.isFinite(row.upperBB)
    && row.lowerBB <= row.estimateBB && row.estimateBB <= row.upperBB);
  const compatible = strict.reasonCode !== 'INVALID_ACTION_BOUND_CONTEXT' && ['SOLVED', 'APPROXIMATE', 'REFINING'].includes(result.status)
    && result.source === 'REFERENCE_SUBGAME_STRATEGY' && c?.supportedGameClass === true;
  const mapped = converged && compatible && all && strict.status === 'CONCLUSIVE' ? 'CERTIFIED' : 'INCONCLUSIVE';
  const outcome = result.decisionOutcome;
  if (!outcome) return { status: mapped, baselineMapping: 'ONLY_GLOBAL_THRESHOLD_AND_COMPATIBLE_ALL_ALTERNATIVE_STRICT_PROOF', strictStatus: strict.status };
  assert.equal(outcome.scope, 'FULL_PRIOR_COMMITMENT'); assert.equal(outcome.actualHandEVEquivalence, false);
  if (outcome.status === 'CERTIFIED') assert.equal(mapped, 'CERTIFIED');
  if (outcome.status === 'NEAR_EQUIVALENT') {
    assert.ok(converged && compatible && all, 'Near proof lacks compatible complete bounds or global convergence.');
    assert.ok(outcome.nearGroupActionIds.length >= 2 && new Set(outcome.nearGroupActionIds).size === outcome.nearGroupActionIds.length);
    const helper = require('../test/helpers/river-hu-expanded-contract-reference.cjs');
    const maxUpper = Math.max(...c.actions.map(row => row.upperBB));
    const minLower = Math.min(...outcome.nearGroupActionIds.map(id => { const row = c.actions.find(row => row.id === id); assert.ok(row); return row.lowerBB; }));
    const exactDifference = helper.subtract(helper.fromNumber(maxUpper), helper.fromNumber(minLower));
    assert.ok(helper.compare(exactDifference, helper.fromNumber(outcome.policy.nearEquivalenceBB)) <= 0, 'Near proof excludes a declared rival or exceeds epsilon.');
  }
  return { status: outcome.status, strictStatus: strict.status, nearGroupActionIds: outcome.nearGroupActionIds,
    robustWorstDifferenceBB: outcome.robustWorstDifferenceBB, policyKey: outcome.policyKey, diagnostics: outcome.diagnostics };
}
function independentNearReference(input) {
  const adapter = require('../src/solver/plo-river-game'), core = require('../src/solver/extensive-solver');
  const helper = require('../test/helpers/river-hu-expanded-contract-reference.cjs'), { available, reference, python } = require('../test/helpers/sequence-form-reference.cjs');
  assert.equal(available(), true, 'Required LP cannot be skipped. Set THEIBS_REFERENCE_PYTHON to the existing environment.');
  const built = adapter.buildPloRiverGame(input); assert.equal(built.status, 'READY');
  const game = built.game, actions = [];
  for (const action of game.meta.rootActions) {
    const condition = { player: game.meta.heroSeat, informationSet: game.meta.heroInformationSet, actionId: action.id };
    const lp = reference({ game, condition }), restricted = helper.restrictIndependently(game, condition);
    const envelope = helper.exactPolicyEnvelope(restricted, lp.strategy, game.meta.heroSeat);
    actions.push({ id: action.id, numericalReferenceValueBB: lp.values[game.meta.heroSeat], numericalResiduals: lp.residuals,
      exactLPFeasiblePolicyEnvelope: { lower: helper.encode(envelope.lower), upper: helper.encode(envelope.upper) } });
  }
  return { id: 'marginal_near_action_tie', input, gameKey: game.meta.key, gameHash: core.validateGame(game).gameHash,
    independentTerminalAudit: helper.terminalAudit(input, game), python, actions };
}
function prepare() {
  fs.mkdirSync(local, { recursive: true });
  const directory = fs.mkdtempSync(path.join(local, 'baseline-54854da-')), archive = path.join(directory, 'source.tar');
  execFileSync('git', ['archive', '--format=tar', '--output=' + archive, BASELINE, 'codigo-fonte/src', 'codigo-fonte/public', 'codigo-fonte/package.json'], { cwd: root, windowsHide: true });
  execFileSync('tar', ['-xf', archive, '-C', directory], { windowsHide: true });
  const data = { baselineCommit: BASELINE, baselineDirectory: path.join(directory, 'codigo-fonte'), archiveSHA256: hash(fs.readFileSync(archive)) };
  data.sourceDigests = hashes(data.baselineDirectory); fs.writeFileSync(preparedPath, JSON.stringify(data, null, 2) + '\n'); console.log(preparedPath);
}
function child() {
  const { directory, input } = workerData;
  const job = require(path.join(directory, 'src/solver/job-worker.js')), start = performance.now();
  const memoryBefore = process.memoryUsage(), cpuBefore = process.cpuUsage(); let sampledHeapMax = memoryBefore.heapUsed;
  const observe = result => {
    sampledHeapMax = Math.max(sampledHeapMax, process.memoryUsage().heapUsed);
    parentPort.postMessage({ progress: { childComputeMs: performance.now() - start, usableValue: !!result.actions?.length,
      allBounds: !!result.actionPrecision?.actions?.length && result.actionPrecision.actions.every(row => row.certified),
      outcome: verifyOutcome(result, directory).status, strictStatus: result.decisionPrecision?.status, nashConv: result.convergence?.nashConv,
      certifiedCount: result.actionPrecision?.actions.filter(row => row.certified).length || 0 } });
  };
  // Both arms use the same trusted browser execution route; this is not Node-default app latency.
  const output = job.execute({ input, budget: { timeMs: 3000, iterations: 1000 }, onProgress: event => observe(event.result) }, { compilationReuse: true });
  observe(output.result);
  const result = output.result, outcome = verifyOutcome(result, directory);
  return { computeWallMs: performance.now() - start, workerReportedMs: output.workerMs, cpuMicroseconds: process.cpuUsage(cpuBefore),
    memory: { before: memoryBefore, after: process.memoryUsage(), progressSampledHeapMax: sampledHeapMax,
      scope: 'Worker heap snapshots; RSS process-wide. Progress sampling is not a proven peak.' },
    result: { status: result.status, outcome, strictPrecision: result.decisionPrecision, actions: result.actions,
      commitmentBounds: result.actionPrecision.actions.map(row => ({ id: row.id, certified: row.certified, estimateBB: row.estimateBB,
        lowerBB: row.lowerBB, upperBB: row.upperBB, iterations: row.iterations })), gameHash: result.gameHash, gameKey: result.abstraction.key,
      treeNodes: result.metrics.nodeCount ?? result.metrics.nodes, workIterations: result.adaptation.workIterations, globalIterations: result.iterations,
      nashConv: result.convergence.nashConv, stopReason: result.adaptation.stopReason, costs: result.metrics.costs,
      actionCosts: result.metrics.actionCosts, compilation: result.metrics.compilation ?? null }, reference: checkReference(result, workerData.referenceData) };
}
async function arm(data) {
  const started = performance.now(), worker = new Worker(__filename, { workerData: data }), progression = [];
  let firstValueMs = null, firstAllBoundsMs = null, firstCertifiedMs = null, firstNearEquivalentMs = null;
  try {
    return await new Promise((resolve, reject) => {
      const watchdog = setTimeout(() => reject(Error('Bounded benchmark arm exceeded 8 seconds.')), 8000);
      worker.on('message', message => {
        if (message.progress) {
          const ms = performance.now() - started, p = message.progress; progression.push({ observedMs: ms, ...p });
          if (p.usableValue) firstValueMs ??= ms; if (p.allBounds) firstAllBoundsMs ??= ms;
          if (p.outcome === 'CERTIFIED') firstCertifiedMs ??= ms; if (p.outcome === 'NEAR_EQUIVALENT') firstNearEquivalentMs ??= ms;
        } else { clearTimeout(watchdog); message.error ? reject(Error(message.error)) : resolve({ ...message, totalObservedMs: performance.now() - started,
          firstValueMs, firstAllBoundsMs, firstCertifiedMs, firstNearEquivalentMs, progression }); }
      });
      worker.once('error', error => { clearTimeout(watchdog); reject(error); });
      worker.once('exit', code => { if (code) { clearTimeout(watchdog); reject(Error('Benchmark Worker exited ' + code)); } });
    });
  } finally { await worker.terminate(); }
}
function summarize(rows) {
  const statuses = ['CERTIFIED', 'NEAR_EQUIVALENT', 'INCONCLUSIVE', 'ESTIMATING'];
  return { denominator: rows.length, outcomes: Object.fromEntries(statuses.map(status => {
    const count = rows.filter(row => row.result.outcome.status === status).length; return [status, { count, denominator: rows.length, percentage: 100 * count / rows.length }]; })),
    ...Object.fromEntries(['totalObservedMs', 'computeWallMs', 'firstValueMs', 'firstAllBoundsMs', 'firstCertifiedMs', 'firstNearEquivalentMs'].map(key => [key, stats(rows.map(row => row[key]))])),
    costs: Object.fromEntries(['buildMs', 'globalSolveMs', 'globalEvaluationMs', 'actionSolveMs', 'actionCertificateMs', 'totalComputeMs'].map(key => [key, stats(rows.map(row => row.result.costs[key]))])) };
}
async function main() {
  if (process.argv.includes('--prepare')) return prepare();
  const prepared = JSON.parse(fs.readFileSync(preparedPath, 'utf8')), gate = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  const before = { baseline: hashes(prepared.baselineDirectory), candidate: hashes(source) };
  assert.deepEqual(before.baseline, prepared.sourceDigests); assert.deepEqual(before.candidate, gate.sourceDigests, 'Independent gate must match final candidate sources.');
  const report = { schemaVersion: 1, classification: 'LOCAL_BOUNDED_INCONCLUSIVE_PIPELINE_AB', baselineCommit: BASELINE,
    generatedAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, cpu: os.cpus()[0]?.model,
      logicalCores: os.cpus().length, thermalPowerState: 'NOT_MEASURED' }, sourceDigests: before,
    baselineArchiveSHA256: prepared.archiveSHA256, independentGate: gate, samplesPerArmPerCase: 3,
    budget: { timeMs: 3000, iterations: 1000, profile: 'APP_FIRST_PASS', optionalContinuation: false },
    methodology: 'Eight fixtures, three alternating paired samples each, sequential fresh real Node Workers and empty per-execution state. Same trusted browser compilation capability in both arms. No caps or math patched. Wall stopwatch starts before Worker construction; progress messages are observed on the parent event loop. Baseline CONCLUSIVE maps to CERTIFIED only after global threshold and all compatible strict bounds. Baseline overlap remains INCONCLUSIVE; no retrospective near classification.',
    metricDefinitions: { firstValueMs: 'Parent stopwatch to first progress with current-hand profile values.', firstCertifiedMs: 'First observed strict proof plus compatible complete bounds and global threshold.',
      firstNearEquivalentMs: 'First observed full-prior epsilon proof, only available in candidate.', actionSolveMs: 'Complete action refinement phase INCLUDING nested certificate evaluation.',
      actionCertificateMs: 'Nested outward bound evaluation subset; do not add again to actionSolveMs.', percentile: 'Nearest rank; descriptive small cohort only.' },
    limitations: ['Local Node diagnostics, not actual browser main-thread interactivity or production outcome rate.', 'No warm result cache, network, authenticated game, physical phone, microphone, full-hand equilibrium or population prior validation.',
      'The hard exact game has no independent LP reference; no reference coverage or error claim for that row.', 'Heap/RSS snapshots are not true peak or isolated Worker process RSS.', 'Different outcome stops may return different profile points; only original game identity and independent containment are compared.'], cases: [] };
  const started = performance.now();
  for (const scenario of selectedCases()) {
    const cell = { id: scenario.id, categories: scenario.categories, pairs: [] };
    const referenceData = scenario.id === 'marginal_near_action_tie' ? gate.nearReference : scenario.referenceData;
    for (let round = 0; round < 3; round++) {
      const order = round % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'], pair = { round: round + 1, order };
      for (const selected of order) pair[selected] = await arm({ directory: selected === 'baseline' ? prepared.baselineDirectory : source, input: scenario.input, referenceData });
      assert.equal(pair.baseline.result.gameHash, pair.candidate.result.gameHash); assert.equal(pair.baseline.result.gameKey, pair.candidate.result.gameKey);
      cell.pairs.push(pair); console.log(JSON.stringify({ id: scenario.id, round: round + 1,
        baselineMs: pair.baseline.totalObservedMs, candidateMs: pair.candidate.totalObservedMs,
        baselineOutcome: pair.baseline.result.outcome.status, candidateOutcome: pair.candidate.result.outcome.status }));
    }
    cell.baseline = summarize(cell.pairs.map(pair => pair.baseline)); cell.candidate = summarize(cell.pairs.map(pair => pair.candidate));
    cell.candidateMinusBaselineMs = Object.fromEntries(['totalObservedMs', 'firstValueMs'].map(key => [key, stats(cell.pairs.map(pair => pair.candidate[key] - pair.baseline[key]))]));
    report.cases.push(cell);
  }
  assert.deepEqual({ baseline: hashes(prepared.baselineDirectory), candidate: hashes(source) }, before, 'Source changed; discard benchmark.');
  report.sourceStableThroughoutRun = true; report.totalHarnessWallMs = performance.now() - started;
  report.summary = Object.fromEntries(['baseline', 'candidate'].map(selected => [selected, summarize(report.cases.flatMap(cell => cell.pairs.map(pair => pair[selected])))]));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n'); console.log(outputPath);
}
module.exports = { selectedCases, checkReference, verifyOutcome, independentNearReference, hashes, gatePath };
if (!isMainThread) { try { parentPort.postMessage(child()); } catch (error) { parentPort.postMessage({ error: error.stack }); } }
else if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
