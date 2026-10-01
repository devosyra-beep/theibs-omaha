'use strict';
// Isolated, alternating same-device A/B measurement. No network or game mutation.
// Baseline must be a preserved source checkout; no baseline source is patched.
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const source = path.resolve(__dirname, '..');
const hashes = directory => Object.fromEntries(['job-worker.js', 'extensive-solver.js', 'action-conditioned.js', 'versions.js'].map(file =>
  [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, 'src/solver', file))).digest('hex')]));
const stats = values => { const a = values.filter(Number.isFinite).sort((x, y) => x - y); return { count: a.length, p50: a[Math.ceil(a.length * .5) - 1] ?? null, p95: a[Math.ceil(a.length * .95) - 1] ?? null }; };
function mathematical(result) {
  return { gameHash: result.gameHash, status: result.status, actions: result.actions,
    convergence: result.convergence,
    comparison: { status: result.decisionPrecision?.status, bestActionId: result.decisionPrecision?.bestActionId, reason: result.decisionPrecision?.reasonCode },
    certificates: result.actionPrecision?.actions.map(row => ({ id: row.id, certified: row.certified, lowerBB: row.lowerBB, upperBB: row.upperBB,
      estimateBB: row.estimateBB, gameHash: row.gameHash, iterations: row.iterations, strategicDecisionCount: row.strategicDecisionCount })),
    workIterations: result.adaptation?.workIterations, globalIterations: result.iterations, actionIterations: result.adaptation?.actionIterations };
}
function validate(result) {
  assert.ok(result.actions?.length && result.actions.every(row => Number.isFinite(row.evBB)));
  const c = result.actionPrecision;
  assert.equal(c.originalHandActionEV, false); assert.equal(c.fullPriorPreserved, true);
  assert.equal(c.utility.scope, 'FULL_PRIOR_EX_ANTE'); assert.equal(c.baseGameHash, result.gameHash);
  assert.equal(result.qualification.gto, false);
  for (const row of c.actions) if (row.certified) {
    assert.ok(Number.isFinite(row.lowerBB) && Number.isFinite(row.upperBB) && row.lowerBB <= row.estimateBB && row.estimateBB <= row.upperBB);
    assert.equal(row.baseGameHash, result.gameHash); assert.equal(row.baseContextKey, c.baseContextKey);
  }
  if (result.decisionPrecision.status === 'CONCLUSIVE') {
    const leader = c.actions.find(row => row.id === result.decisionPrecision.bestActionId), tolerance = result.decisionPrecision.separationToleranceBB;
    assert.ok(leader?.certified && c.actions.every(row => row.certified && (row.id === leader.id || leader.lowerBB > row.upperBB + tolerance)));
  }
}
function child() {
  const directory = workerData.directory, job = require(path.join(directory, 'src/solver/job-worker.js'));
  // Exercise the trusted browser capability under Node for diagnostics only.
  // Production Node jobs leave this off; browser latency is measured separately.
  let dependencies = workerData.arm === 'candidate' ? { compilationReuse: true } : {};
  if (workerData.mode === 'FIXED_WORK') {
    // Remove only per-batch wall stops in both arms. Preserve CFR+ iterations,
    // convergence and selection rules; this is a differential QA measurement.
    const core = require(path.join(directory, 'src/solver/extensive-solver.js'));
    const cert = require(path.join(directory, 'src/solver/action-conditioned.js'));
    dependencies = { ...dependencies, core: { ...core, solve: (game, options) => core.solve(game, { ...options, timeBudgetMs: Infinity }) },
      actionConditioned: { ...cert, solveActionConditioned: (game, options) => cert.solveActionConditioned(game, { ...options, timeBudgetMs: Infinity }) } };
  }
  const start = performance.now(); let firstProfileMs = null, firstAllBoundsMs = null;
  const cpu = process.cpuUsage(), memoryBefore = process.memoryUsage();
  const output = job.execute({ input: workerData.input, budget: workerData.mode === 'FIXED_WORK' ? { timeMs: 30000, iterations: 512 } : { timeMs: 3000, iterations: workerData.mode === 'APP_FIRST_PASS' ? 1000 : 20000 },
    onProgress: event => {
      if (event.result?.actions?.length) firstProfileMs ??= performance.now() - start;
      if (event.result?.actionPrecision?.actions.every(row => row.certified)) firstAllBoundsMs ??= performance.now() - start;
    } }, dependencies);
  validate(output.result);
  return { mode: workerData.mode, arm: workerData.arm, round: workerData.round,
    elapsedMs: performance.now() - start, firstProfileMs, firstAllBoundsMs,
    costs: output.result.metrics.costs, compilation: output.result.metrics.compilation ?? null,
    actionCosts: output.result.metrics.actionCosts, stopReason: output.result.adaptation.stopReason,
    cpuMicroseconds: process.cpuUsage(cpu), memoryBefore, memoryAfter: process.memoryUsage(), mathematical: mathematical(output.result) };
}
async function arm(data) {
  const started = performance.now(), worker = new Worker(__filename, { workerData: data });
  try {
    return await new Promise((resolve, reject) => {
      const watchdog = setTimeout(() => reject(Error('Benchmark arm exceeded 40 seconds.')), 40000);
      worker.once('message', result => { clearTimeout(watchdog); result.error ? reject(Error(result.error)) : resolve({ ...result, workerStartAndWallMs: performance.now() - started }); });
      worker.once('error', error => { clearTimeout(watchdog); reject(error); });
      worker.once('exit', code => { if (code) { clearTimeout(watchdog); reject(Error('Benchmark worker exited ' + code)); } });
    });
  } finally { await worker.terminate(); }
}
async function main() {
  const args = process.argv.slice(2), option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
  const baseline = path.resolve(option('--baseline', '')), output = path.resolve(option('--output', path.join(source, '../validacao/river-hu-optimization/local-ab.json')));
  if (!args.includes('--baseline') || !fs.existsSync(path.join(baseline, 'src/solver/job-worker.js'))) throw Error('Provide --baseline <preserved codigo-fonte directory>.');
  const count = Number(option('--samples', '5'));
  if (!Number.isSafeInteger(count) || count < 1 || count > 20) throw Error('Use 1 to 20 samples per arm.');
  const cases = require('../public/solver-validation-growth-fixtures.json').cases;
  const before = { baseline: hashes(baseline), candidate: hashes(source) };
  const report = { classification: 'LOCAL_INTERLEAVED_RIVER_HU_CERTIFICATE_AB', generatedAt: new Date().toISOString(), baselineCommit: '9392b539548c7b79a7128219d489d147230c1d37',
    platform: process.platform, node: process.version, cpu: os.cpus()[0]?.model, sourceHashes: before, samplesPerArm: count,
    methodology: 'Fresh real Node Worker per arm, alternating baseline/candidate order. Candidate explicitly enables the trusted browser compilation capability under Node for diagnostic comparison; production Node leaves it off. Same finite declared fixture. FIXED_WORK removes only per-batch wall stops in both arms and requires identical mathematical output. INTERACTIVE uses a3-second compute allowance and20000-iteration instrument cap; APP_FIRST_PASS uses the actual initial app3-second/1000-iteration cap (not its optional background continuation). No warm result cache in this A/B; browser cold/warm is measured separately.',
    limitations: ['Same-device local measurement, not hosted/server timing or SLA.', 'p95 is nearest rank of this small sample.', 'Worker memory before/after is not peak or isolated process RSS.', 'All growth fixtures retain explicit abstraction; certified commitment comparison is not actual-hand equilibrium EV.', 'No microphone or physical phone performance measurement.'], cases: [] };
  for (const scenario of cases) {
    const cell = { id: scenario.id, samples: [], fixedWorkEqual: true, summaries: {} };
    for (const mode of ['FIXED_WORK', 'INTERACTIVE', 'APP_FIRST_PASS']) for (let round = 0; round < count; round++) {
      const samples = {};
      for (const selected of round % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
        const row = await arm({ directory: selected === 'baseline' ? baseline : source, input: scenario.variants[round % scenario.variants.length].input, arm: selected, mode, round });
        samples[selected] = row; cell.samples.push(row);
      }
      if (mode === 'FIXED_WORK') assert.deepEqual(samples.candidate.mathematical, samples.baseline.mathematical, 'Fixed-work mathematical output changed: ' + scenario.id);
      console.log(JSON.stringify({ scenario: scenario.id, mode, round, baselineMs: samples.baseline.elapsedMs, candidateMs: samples.candidate.elapsedMs,
        candidateComparison: samples.candidate.mathematical.comparison.status, certified: samples.candidate.mathematical.certificates.filter(row => row.certified).length }));
    }
    for (const mode of ['FIXED_WORK', 'INTERACTIVE', 'APP_FIRST_PASS']) for (const selected of ['baseline', 'candidate']) {
      const rows = cell.samples.filter(row => row.mode === mode && row.arm === selected);
      cell.summaries[mode + '_' + selected] = { elapsedMs: stats(rows.map(row => row.elapsedMs)), firstProfileMs: stats(rows.map(row => row.firstProfileMs)),
        firstAllBoundsMs: stats(rows.map(row => row.firstAllBoundsMs)), actionRefinementMs: stats(rows.map(row => row.costs.actionSolveMs)), certificateMs: stats(rows.map(row => row.costs.actionCertificateMs)),
        conclusiveCount: rows.filter(row => row.mathematical.comparison.status === 'CONCLUSIVE').length,
        allCertifiedCount: rows.filter(row => row.mathematical.certificates.every(c => c.certified)).length };
    }
    report.cases.push(cell); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
  assert.deepEqual({ baseline: hashes(baseline), candidate: hashes(source) }, before, 'Source changed during the paired benchmark.');
  report.sourceStable = true; fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log(output);
}
if (isMainThread) main().catch(error => { console.error(error); process.exitCode = 1; });
else { try { parentPort.postMessage(child()); } catch (error) { parentPort.postMessage({ error: error.stack }); } }
