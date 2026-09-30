'use strict';
// MODEL evidence: independent SciPy/HiGHS LP values vs THEIBS CFR saddle bounds.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const os = require('node:os');
const { available, reference, python } = require('../test/helpers/sequence-form-reference.cjs');
const fixtures = require('../test/helpers/solver-reference-fixtures.cjs');
const core = require('../src/solver/extensive-solver');
const actionCore = require('../src/solver/action-conditioned');
const { buildPloRiverGame } = require('../src/solver/plo-river-game');
const out = path.resolve(__dirname, '../../validacao/solver-sequence-form-reference.json');
function ready(input) { const built = buildPloRiverGame(input); assert.equal(built.status, 'READY', JSON.stringify(built.reasons)); return built; }
function compact(referenceResult) {
  return { values: referenceResult.values, residuals: referenceResult.residuals, validationTolerance: referenceResult.validationTolerance,
    method: referenceResult.method, runtime: referenceResult.runtime, metrics: referenceResult.metrics,
    referenceNashConv: referenceResult.reference.nashConv, symbolicallyExact: false };
}
function checkBounds(bounds, exact) {
  assert.equal(bounds.certified, true);
  assert.ok(bounds.lowerBB <= exact.values[0] + exact.validationTolerance && bounds.upperBB >= exact.values[0] - exact.validationTolerance,
    `LP value ${exact.values[0]} outside interval [${bounds.lowerBB}, ${bounds.upperBB}].`);
}
function run() {
  if (!available()) throw Error('Install the QA reference requirements and set THEIBS_REFERENCE_PYTHON; see scripts/reference/README.md.');
  const started = performance.now();
  const cases = [
    { name: 'known-kuhn-private-K-commitment', game: fixtures.kuhnGame(), informationSet: '2:root', actions: ['CHECK', 'BET'], unit: 'TOY_GAME_UTILITY' },
    ...[['plo5-river-four-joint-worlds', fixtures.riverMixedInput()], ['plo5-blockers-declared-fee', fixtures.riverCallInput({ blockers: true, fee: 2 })]]
      .map(([name, input]) => { const built = ready(input); return { name, game: built.game, informationSet: built.game.meta.heroInformationSet,
        actions: built.game.meta.rootActions.map(action => action.id), unit: 'BB', buildMetrics: built.metrics }; })
  ];
  const report = { classification: 'MODEL_INDEPENDENT_SEQUENCE_FORM_LP_REFERENCE', generatedAt: new Date().toISOString(),
    python, node: process.version, platform: `${process.platform}/${process.arch}`, cpu: os.cpus()[0]?.model, memoryBytes: os.totalmem(),
    method: 'Independent sparse sequence-form primal/dual LP with HiGHS dual simplex. Core CFR, best-response traversal and conditioning are not imported by the Python reference.',
    target: actionCore.TARGET, probabilitySemantics: 'NORMALIZED_SUPPLIED_BINARY64_WEIGHTS',
    limitations: ['Numerically validated LP reference, not a symbolic rational proof.', 'Containment is checked with the independent LP residual tolerance.',
      'Commitment values are full-prior ex ante values. They are not original current-hand conditional action EVs.',
      'Alternative equilibrium strategies may differ without changing attainable value. No equality of strategies is required.',
      'Local process measurements include no network, hosted service or real microphone. Native Python solver memory is not captured by tracemalloc.'],
    cases: [], pass: true };
  for (const scenario of cases) {
    const baseStarted = performance.now(), baseReference = reference({ game: scenario.game });
    const item = { name: scenario.name, unit: scenario.unit, build: scenario.buildMetrics || null,
      gameMetrics: core.validateGame(scenario.game), reference: compact(baseReference), referenceWallMs: performance.now() - baseStarted,
      actions: [] };
    for (const actionId of scenario.actions) {
      const condition = { player: 0, informationSet: scenario.informationSet, actionId };
      const referenceStarted = performance.now(), oracle = reference({ game: scenario.game, condition });
      const action = { actionId, referenceValue: oracle.values[0], reference: compact(oracle), referenceWallMs: performance.now() - referenceStarted, refinements: [] };
      const restricted = actionCore.buildActionConditionedGame(scenario.game, condition);
      let checkpoint, priorIterations = 0;
      for (const iterations of [1, 10, 100, 1000]) {
        const sampleStarted = performance.now(), memoryBefore = process.memoryUsage();
        const solved = core.solve(restricted, { iterations: iterations - priorIterations, checkpoint });
        const solveMs = performance.now() - sampleStarted;
        const verifyStarted = performance.now(), bounds = actionCore.evaluateActionConditioned(scenario.game, solved.strategy, condition);
        const verifyMs = performance.now() - verifyStarted;
        checkBounds(bounds, oracle);
        const midpoint = bounds.lowerBB / 2 + bounds.upperBB / 2;
        action.refinements.push({ iterations: solved.iterations, additionalIterations: solved.additionalIterations,
          profileValue: solved.values[0], midpoint, absoluteMidpointError: Math.abs(midpoint - oracle.values[0]),
          lower: bounds.lowerBB, upper: bounds.upperBB, width: bounds.upperBB - bounds.lowerBB,
          containsReferenceWithinResidualTolerance: true, certified: bounds.certified, nashConv: solved.convergence.nashConv,
          solveMs, verificationMs: verifyMs, totalMs: performance.now() - sampleStarted,
          estimatedWorkingBytes: solved.metrics.estimatedWorkingBytes, processRssBefore: memoryBefore.rss,
          processRssAfter: process.memoryUsage().rss, processHeapUsedAfter: process.memoryUsage().heapUsed });
        checkpoint = solved.checkpoint; priorIterations = solved.iterations;
      }
      item.actions.push(action);
      console.log(`${scenario.name} ${actionId}: LP=${oracle.values[0].toFixed(9)}, final width=${action.refinements.at(-1).width.toExponential(3)}`);
    }
    item.dominance = [1, 10, 100, 1000].map(iterations => {
      const rows = item.actions.map(action => ({ actionId: action.actionId, ...action.refinements.find(row => row.iterations === iterations) }));
      const leaders = rows.filter(row => rows.every(other => other.actionId === row.actionId || row.lower > other.upper));
      if (leaders.length) assert.ok(item.actions.every(other => other.actionId === leaders[0].actionId ||
        item.actions.find(action => action.actionId === leaders[0].actionId).referenceValue > other.referenceValue), 'Certified dominance must agree with every independent action reference.');
      return { iterations, status: leaders.length === 1 ? 'CONCLUSIVE' : 'INCONCLUSIVE', leader: leaders[0]?.actionId || null,
        rule: 'leader.lower > upper of every other comparable action' };
    });
    report.cases.push(item);
  }
  report.elapsedMs = performance.now() - started;
  report.sampleCount = report.cases.reduce((total, item) => total + item.actions.reduce((sum, action) => sum + action.refinements.length, 0), 0);
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, cases: report.cases.length, samples: report.sampleCount, elapsedMs: report.elapsedMs, report: out }));
}
if (require.main === module) run();
module.exports = { run };
