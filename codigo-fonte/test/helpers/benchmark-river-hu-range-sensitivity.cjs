'use strict';

// QA only: admission is raised in memory; every production resource guard and
// mathematical source remains unchanged. Different ranges are different games.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { capacityRiverInput } = require('./river-hu-capacity-fixtures.cjs');
const sourceRoot = path.resolve(__dirname, '../..'), repositoryRoot = path.dirname(sourceRoot);
const adapterPath = path.join(sourceRoot, 'src/solver/plo-river-game.js');
const budgets = Object.freeze({ maxWorlds: 2304, maxNodes: 12000, maxMemoryBytes: 48 * 1024 * 1024, maxBuildMs: 750 });
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value.replace(/\r\n/g, '\n') : JSON.stringify(value)).digest('hex');

function experimentalAdapter(source = fs.readFileSync(adapterPath, 'utf8')) {
  const original = 'maxCombosPerSeat: 24, maxSizingLevels: 12, maxWorlds: 576';
  assert.ok(source.includes(original), 'Experiment expects the production24/576 admission contract.');
  const loaded = new Module(adapterPath, module); loaded.filename = adapterPath;
  loaded.paths = Module._nodeModulePaths(path.dirname(adapterPath));
  loaded._compile(source.replace(original, 'maxCombosPerSeat: 48, maxSizingLevels: 12, maxWorlds: 2304'), adapterPath);
  assert.equal(loaded.exports.HU_SUPPORT.maxMemoryBytes, budgets.maxMemoryBytes);
  assert.equal(loaded.exports.LIMITS.maxNodes, budgets.maxNodes);
  return loaded.exports;
}

function compact(result) {
  const actions = result.actions || [], points = actions.filter(row => Number.isFinite(row.evBB));
  const maximum = points.length ? Math.max(...points.map(row => row.evBB)) : null;
  return { status: result.status, reasons: result.reasons || [], gameHash: result.gameHash || null,
    iterations: result.iterations ?? null, workIterations: result.adaptation?.workIterations ?? null,
    originalProfile: { scope: 'CURRENT_HAND_COMBINATION_RETURNED_PROFILE', actions,
      pointLeaderActionIds: points.filter(row => row.evBB === maximum).map(row => row.id) },
    commitment: { scope: 'FULL_PRIOR_COMMITMENT', actualHandEVEquivalence: false,
      actions: (result.actionPrecision?.actions || []).map(row => ({ id: row.id, certified: row.certified,
        estimateBB: row.estimateBB ?? null, lowerBB: row.lowerBB ?? null, upperBB: row.upperBB ?? null })),
      precision: result.decisionPrecision || null, outcome: result.decisionOutcome || null },
    convergence: result.convergence || null, stability: result.stability || null,
    stopReason: result.adaptation?.stopReason ?? null, refinementRecommended: result.adaptation?.refinementRecommended ?? null,
    costs: result.metrics?.costs || null, estimatedWorkingBytes: result.metrics?.estimatedWorkingBytes ?? null,
    compilation: result.metrics?.compilation || null };
}

function leaderIds(rows, field) {
  const finite = rows.filter(row => Number.isFinite(row[field]));
  const maximum = finite.length ? Math.max(...finite.map(row => row[field])) : null;
  return finite.filter(row => row[field] === maximum).map(row => row.id);
}

function summarize(report) {
  for (const cell of report.cells) if (cell.execution) {
    for (const row of cell.execution.fixed) {
      row.originalProfile.pointLeaderActionIds = leaderIds(row.originalProfile.actions, 'evBB');
      row.commitment.pointLeaderActionIds = leaderIds(row.commitment.actions, 'estimateBB');
      row.checkpointConclusion = 'CORE_FIXED_WORK_DIAGNOSTICS_NOT_A_JOB_QUALIFICATION';
    }
    const [cold, warm] = cell.execution.runs;
    cell.execution.coldWarmMathEqual = JSON.stringify([cold.final.originalProfile, cold.final.commitment.actions, cold.final.convergence])
      === JSON.stringify([warm.final.originalProfile, warm.final.commitment.actions, warm.final.convergence]);
  }
  report.sensitivity = [];
  for (const template of new Set(report.cells.map(cell => cell.template))) {
    const cells = report.cells.filter(cell => cell.template === template && cell.execution);
    for (let index = 1; index < cells.length; index++) {
      const before = cells[index - 1], after = cells[index];
      const old = before.execution.fixed.at(-1), current = after.execution.fixed.at(-1);
      report.sensitivity.push({ template, beforeCombos: before.combosPerSeat, afterCombos: after.combosPerSeat,
        workIterationsPerTree: current.perTreeWorkIterations,
        scope: 'DIFFERENT_EXPLICIT_RANGE_GAMES_UNDER_SAME_DECLARED_TEMPLATE_NOT_PRECISION_ERROR',
        currentHandProfileEVChangesBB: current.originalProfile.actions.map(row => ({ id: row.id,
          beforeBB: old.originalProfile.actions.find(prior => prior.id === row.id)?.evBB ?? null, afterBB: row.evBB,
          changeBB: row.evBB - old.originalProfile.actions.find(prior => prior.id === row.id).evBB })),
        commitmentMidpointChangesBB: current.commitment.actions.map(row => ({ id: row.id,
          beforeBB: old.commitment.actions.find(prior => prior.id === row.id)?.estimateBB ?? null, afterBB: row.estimateBB,
          changeBB: row.estimateBB - old.commitment.actions.find(prior => prior.id === row.id).estimateBB })),
        currentHandPointLeaderUnchanged: JSON.stringify(old.originalProfile.pointLeaderActionIds) === JSON.stringify(current.originalProfile.pointLeaderActionIds),
        commitmentPointLeaderUnchanged: JSON.stringify(old.commitment.pointLeaderActionIds) === JSON.stringify(current.commitment.pointLeaderActionIds) });
    }
  }
  report.threeWayEVStabilityEstablished = false;
  report.threeWayComparisonLimitation = '48x48 has no complete tree within unchanged guards, so its EV, strategy and commitment bounds are unknown. The24/32 minimal-tree comparison is separate from the larger two-size tree.';
  return report;
}

if (!isMainThread) {
  try {
    const adapter = experimentalAdapter(workerData.source), job = require('../../src/solver/job-worker');
    const core = require('../../src/solver/extensive-solver'), conditioned = require('../../src/solver/action-conditioned');
    const runs = [];
    for (const temperature of ['COLD_RUNTIME', 'WARM_RUNTIME_FRESH_JOB']) {
      const began = performance.now(), heapBefore = process.memoryUsage().heapUsed;
      let firstValueMs = null; const progress = [];
      const finished = job.execute({ input: workerData.input, budget: { timeMs: 3000, iterations: 1000 }, onProgress(message) {
        if (message.result?.actions?.length) firstValueMs ??= performance.now() - began;
        progress.push({ atMs: performance.now() - began, ...compact(message.result) });
      } }, { compilationReuse: true, build: adapter.buildPloRiverGame });
      runs.push({ temperature, cacheHit: false, firstValueMs, elapsedMs: finished.workerMs,
        heapBeforeBytes: heapBefore, heapAfterBytes: process.memoryUsage().heapUsed,
        progress, final: compact(finished.result) });
    }
    const built = adapter.buildPloRiverGame(workerData.input); assert.equal(built.status, 'READY');
    const game = built.game, fixed = []; let checkpoint, previous = 0;
    const actionCheckpoints = new Map();
    for (const work of [16, 32, 64]) {
      const began = performance.now(), solved = core.solve(game, { iterations: work - previous, checkpoint });
      checkpoint = solved.checkpoint;
      const profile = core.rootDiagnostics(game, solved.strategy, game.meta.heroSeat, game.meta.heroInformationSet);
      const commitments = game.meta.rootActions.map(action => {
        const condition = { player: game.meta.heroSeat, informationSet: game.meta.heroInformationSet, actionId: action.id };
        const restricted = conditioned.buildActionConditionedGame(game, condition);
        const result = core.solve(restricted, { iterations: work - previous, checkpoint: actionCheckpoints.get(action.id) });
        actionCheckpoints.set(action.id, result.checkpoint);
        const bounds = conditioned.evaluateActionConditioned(game, result.strategy, condition);
        return { id: action.id, certified: bounds.certified, lowerBB: bounds.lowerBB, upperBB: bounds.upperBB,
          estimateBB: bounds.lowerBB / 2 + bounds.upperBB / 2, iterations: result.iterations };
      });
      fixed.push({ perTreeWorkIterations: work, elapsedMs: performance.now() - began,
        originalProfile: { scope: 'CURRENT_HAND_COMBINATION_RETURNED_PROFILE', values: solved.values,
          actions: profile.actions.map(row => ({ id: row.id, evBB: row.ev, frequency: row.frequency })) },
        convergence: solved.convergence,
        commitment: { scope: 'FULL_PRIOR_COMMITMENT', actualHandEVEquivalence: false, actions: commitments } });
      previous = work;
    }
    parentPort.postMessage({ runs, fixed });
  } catch (error) { parentPort.postMessage({ error: error.stack }); }
} else {
  async function run(source, input) {
    let peakRSS = process.memoryUsage().rss; const beforeRSS = peakRSS, began = performance.now();
    const worker = new Worker(__filename, { workerData: { source, input },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
    const poll = setInterval(() => { peakRSS = Math.max(peakRSS, process.memoryUsage().rss); }, 5); let timer;
    try {
      const result = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error('Sensitivity worker exceeded its8s wall watchdog.')), 8000);
        worker.once('message', resolve); worker.once('error', reject);
        worker.once('exit', code => { if (code) reject(Error(`Sensitivity worker exited${code}.`)); });
      });
      if (result.error) throw Error(result.error);
      return { ...result, wallMs: performance.now() - began, processRSS: { beforeBytes: beforeRSS, sampledPeakBytes: peakRSS } };
    } finally { clearInterval(poll); clearTimeout(timer); await worker.terminate(); }
  }

  async function main() {
    const source = fs.readFileSync(adapterPath, 'utf8'), adapter = experimentalAdapter(source);
    const sourceHashes = Object.fromEntries(['plo-river-game.js', 'extensive-solver.js', 'action-conditioned.js', 'job-worker.js', 'versions.js']
      .map(name => [name, hash(fs.readFileSync(path.join(sourceRoot, 'src/solver', name), 'utf8'))]));
    const report = { classification: 'QA_ONLY_NESTED_EXPLICIT_RANGE_SENSITIVITY', generatedAt: new Date().toISOString(), node: process.version,
      sourceHashes, productionHUAdmission: { combos: 24, worlds: 576 }, experimentHUAdmission: { combos: 48, worlds: 2304 }, budgets,
      solverBudget: { timeMs: 3000, iterations: 1000 }, fixedCheckpointsPerTree: [16, 32, 64],
      protocol: 'One cold-runtime and one warm-runtime fresh job per admitted cell, then16/32/64 cumulative fixed-work checkpoints on the same original and conditioned trees. Warm reuses loaded modules only; no result cache or checkpoint continuation. Each template uses the same board, utility, fees, sizes and aggression cap across nested24/32/48 ranges.',
      limitations: ['Different ranges change the game/prior;48is not numerical truth or population coverage.',
        'A one-sample runtime comparison is descriptive, not a3s latency guarantee.',
        'Minimal zero-aggression subgame is a different tree from the two-size aggressive subgame; its EV is not interchangeable.',
        'No external LP reference for24/32/48. No browser, hosted or mobile performance measurement.',
        'Sampled parent+worker RSS and final heap are not per-worker/browser peak memory.'], cells: [] };
    let computeMs = 0;
    for (const [template, maxAggressions] of [['TWO_SIZES_ONE_AGGRESSION', 1], ['NO_ADDITIONAL_AGGRESSION', 0]]) {
      for (const combos of [24, 32, 48]) {
        const input = { ...capacityRiverInput({ combos, sizings: 2, maxAggressions }), budget: { ...budgets } };
        const coverage = adapter.coverage(input); assert.equal(coverage.status, 'READY'); assert.equal(coverage.worlds, combos * combos);
        const singleton = structuredClone(input); singleton.ranges.forEach(range => { range.combos = [range.combos[0]]; });
        const shape = adapter.buildPloRiverGame(singleton); assert.equal(shape.status, 'READY');
        const built = adapter.buildPloRiverGame(input), nodes = 1 + shape.metrics.publicNodes * coverage.worlds;
        const cell = { template, combosPerSeat: combos, input, inputSHA256: hash(input), contextKey: coverage.key,
          productWorlds: combos * combos, compatibleWorlds: coverage.worlds, publicNodes: shape.metrics.publicNodes,
          requiredNodes: nodes, requiredReservationBytes: nodes * 8192, status: built.status,
          reasons: built.reasons, buildMs: built.metrics.buildMs,
          completeTreeBuilt: built.status === 'READY', currentHandEVAvailable: built.status === 'READY' };
        if (built.status === 'READY') {
          cell.execution = await run(source, input);
          computeMs += cell.execution.runs.reduce((sum, row) => sum + row.elapsedMs, 0)
            + cell.execution.fixed.reduce((sum, row) => sum + row.elapsedMs, 0);
          assert.ok(computeMs < 30000, 'Experiment compute exceeded30s.');
        } else { assert.equal(built.game, null); cell.execution = null; }
        report.cells.push(cell);
        process.stdout.write(`${template} ${combos}x${combos}:${cell.status} ${cell.reasons[0]?.code || cell.execution.runs[0].final.commitment.outcome.status}\n`);
      }
    }
    report.totalMeasuredComputeMs = computeMs;
    summarize(report);
    report.sourceStable = Object.entries(sourceHashes).every(([name, sha]) => hash(fs.readFileSync(path.join(sourceRoot, 'src/solver', name), 'utf8')) === sha);
    assert.equal(report.sourceStable, true);
    const output = path.join(sourceRoot, 'docs/benchmarks/river-hu-range-sensitivity.json');
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); process.stdout.write(`${output}\n`);
  }
  if (require.main === module) main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
}

module.exports = { experimentalAdapter, budgets, summarize };
