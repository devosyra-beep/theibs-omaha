'use strict';

// Bounded same-game/same-work comparison. The baseline is loaded from Git;
// no production admission/resource guard is raised for this experiment.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync, fork } = require('node:child_process');
const { createHash } = require('node:crypto');
const { capacityRiverInput } = require('./river-hu-capacity-fixtures.cjs');
const root = path.resolve(__dirname, '../..');
const BASELINE = 'c86abe284a4d56f62a1a6fac12e3b1558521a6bf';
function baselineModule(name, core) {
  const filename = path.join(root, 'src/solver', name + '.js');
  const source = execFileSync('git', ['show', BASELINE + ':codigo-fonte/src/solver/' + name + '.js'], { cwd: root, encoding: 'utf8' });
  const loaded = new Module(filename, module); loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const ordinaryRequire = loaded.require.bind(loaded);
  loaded.require = id => id === './extensive-solver' && core ? core : ordinaryRequire(id);
  loaded._compile(source, filename); return loaded.exports;
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const strip = value => Array.isArray(value) ? value.map(strip) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !['elapsedMs','certificateElapsedMs','traversalVisits','metrics'].includes(key)).map(([key, child]) => [key, strip(child)])) : value;
function graphObjects(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return seen;
  seen.add(value); for (const child of Object.values(value)) graphObjects(child, seen); return seen;
}

if (process.argv.includes('--cell')) {
  try {
    const baseline = process.argv.includes('--baseline');
    const core = baseline ? baselineModule('extensive-solver') : require('../../src/solver/extensive-solver');
    const conditioned = baseline ? baselineModule('action-conditioned', core) : require('../../src/solver/action-conditioned');
    const adapter = require('../../src/solver/plo-river-game');
    const built = adapter.buildPloRiverGame(capacityRiverInput({ combos: 24, sizings: 2, maxAggressions: 1 }));
    assert.equal(built.status, 'READY', JSON.stringify(built.reasons));
    const game = built.game, compilationContext = core.createCompilationContext(game);
    const options = { compilationContext, iterations: 64, checkEvery: 16, player: game.meta.heroSeat,
      informationSet: game.meta.heroInformationSet, actionIds: game.meta.rootActions.map(row => row.id) };
    core.validateGame(game, options);
    global.gc(); const heapBefore = process.memoryUsage().heapUsed;
    const began = performance.now(), solved = core.solve(game, options);
    const profileMs = performance.now() - began;
    const diagnostics = core.rootDiagnostics(game, solved.strategy, options.player, options.informationSet, options);
    const certificates = conditioned.solveActionConditioned(game, options);
    assert.equal(certificates.termination, 'COMPLETE');
    assert.equal(certificates.actions.length, options.actionIds.length);
    assert.ok(certificates.actions.every(row => row.certified && row.iterations === 64));
    const coldMs = performance.now() - began;
    const checkpoints = Object.fromEntries(certificates.actions.map(row => [row.id, row.checkpoint]));
    const warm = conditioned.solveActionConditioned(game, { ...options, iterations: 0, checkpoints });
    assert.deepEqual(strip(warm.actions.map(row => ({...row, additionalIterations: 64}))), strip(certificates.actions));
    global.gc(); const heapAfter = process.memoryUsage().heapUsed;
    const metrics = core.validateGame(game, options);
    // Count actual allocations of the trusted conditioned builder through a
    // solve wrapper; never compare every action graph retained simultaneously.
    let retainedGame, treeObjects;
    const originalSolve = core.solve;
    core.solve = (source, opts) => { retainedGame = source; treeObjects = graphObjects(source); return originalSolve(source, opts); };
    let construction;
    try { construction = conditioned.solveActionConditioned(game, { ...options, iterations: 0, checkpoints, actionIds: [options.actionIds.at(-1)] }); }
    finally { core.solve = originalSolve; }
    const baseObjects = graphObjects(game);
    const shared = [...treeObjects].filter(object => baseObjects.has(object)).length;
    const math = { gameHash: solved.gameHash, strategy: solved.strategy, checkpoint: solved.checkpoint,
      values: solved.values, convergence: solved.convergence, diagnostics,
      certificates: certificates.actions.map(row => ({ id: row.id, gameHash: row.gameHash, checkpoint: row.checkpoint,
        lowerBB: row.lowerBB, upperBB: row.upperBB, profileValueBB: row.profileValueBB,
        convergence: row.convergence, bestResponseBounds: row.bestResponseBounds })) };
    core.releaseCompilationContext(compilationContext);
    process.send({ implementation: baseline ? 'BASELINE_C86ABE2' : 'CANDIDATE', gameHash: solved.gameHash, mathematicalDigest: digest(math),
      exactTree: { nodes: metrics.nodeCount, infosets: metrics.informationSetCount, worlds: game.meta.exactWorlds,
        reservationBytes: built.metrics.reservedMemoryBytes, conservativeWorkingEstimateBytes: metrics.estimatedWorkingBytes },
      profileMs, coldAllActionsMs: coldMs, boundsCosts: certificates.metrics.costs,
      warmSameCheckpointBoundsMs: warm.metrics.elapsedMs, warmBoundsCosts: warm.metrics.costs,
      construction: { objectCount: treeObjects.size, sharedBaseObjects: shared, newObjects: treeObjects.size - shared,
        metrics: construction.metrics.treeConstruction || null },
      compilation: certificates.metrics.compilation,
      memory: { heapBeforeBytes: heapBefore, heapAfterLiveResultsBytes: heapAfter, liveResultDeltaBytes: heapAfter - heapBefore,
        processLifetimeMaxRSSBytes: process.resourceUsage().maxRSS * 1024,
        interpretation: 'Isolated Node process. GC snapshots retain the base compiled game and completed outputs. RSS includes runtime; neither is browser peak heap.' },
      scratch: baseline ? { perNodeExpectedValueArrays: metrics.nodeCount, perNodeReachIntervalArrays: metrics.nodeCount,
        cfrChildVectorAllocationsPerSweep: (metrics.nodeCount - metrics.terminalCount) * 2 }
        : { expectedValueBufferBytes: metrics.nodeCount * (2 * 8 + 1), reachIntervalBufferBytesPerBestResponse: metrics.nodeCount * 2 * 8,
          cfrChildVectors: 'Reusable by own-decision recursion depth only; no chance/opponent child vectors.' } });
    retainedGame = null;
  } catch (error) { process.send({ error: error.stack }); process.exitCode = 1; }
} else {
  async function cell(baseline) {
    const child = fork(__filename, ['--cell', ...(baseline ? ['--baseline'] : [])], { cwd: root,
      execArgv: ['--expose-gc'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let timer; try { return await new Promise((resolve, reject) => {
      timer = setTimeout(() => { child.kill(); reject(Error('Bounded storage benchmark exceeded its15s watchdog.')); }, 15000);
      child.once('message', result => result.error ? reject(Error(result.error)) : resolve(result));
      child.once('error', reject); child.once('exit', code => { if (code) reject(Error('Benchmark child exited: ' + code)); });
    }); } finally { clearTimeout(timer); child.disconnect(); }
  }
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)];
  (async () => {
    const runs = [];
    for (let index = 0; index < 3; index++) for (const baseline of index % 2 ? [false, true] : [true, false]) {
      const result = await cell(baseline); runs.push({ index, ...result });
      console.log(JSON.stringify({ index, implementation: result.implementation, coldMs: result.coldAllActionsMs, newObjects: result.construction.newObjects }));
    }
    assert.equal(new Set(runs.map(row => row.mathematicalDigest)).size, 1, 'Same-work strategies, EV, bounds and checkpoints must match exactly.');
    const summary = ['BASELINE_C86ABE2', 'CANDIDATE'].map(implementation => {
      const rows = runs.filter(row => row.implementation === implementation);
      const measured = field => ({ p50: percentile(rows.map(field), .5), p95: percentile(rows.map(field), .95) });
      return { implementation, samples: rows.length, coldAllActionsMs: measured(row => row.coldAllActionsMs),
        profileMs: measured(row => row.profileMs), certificateMs: measured(row => row.boundsCosts.certificateMs),
        treeBuildMs: measured(row => row.boundsCosts.treeBuildMs), warmSameCheckpointBoundsMs: measured(row => row.warmSameCheckpointBoundsMs),
        liveResultHeapDeltaBytes: measured(row => row.memory.liveResultDeltaBytes), maxRSSBytes: measured(row => row.memory.processLifetimeMaxRSSBytes),
        newConditionedObjects: rows[0].construction.newObjects, sharedConditionedObjects: rows[0].construction.sharedBaseObjects };
    });
    const report = { baseline: BASELINE, scope: 'EXISTING_RIVER_HU_24X24_TWO_SIZES_SAME_GAME_SAME64_ITERATIONS_PER_TREE',
      equivalence: 'BIT_IDENTICAL_STRATEGY_PROFILE_EV_CFR_CHECKPOINT_NASHCONV_ACTION_BOUNDS',
      samples: 3, percentileNote: 'Three bounded runs: p95 is the slowest observed sample, not a population SLA.', summary, runs };
    const output = process.argv[2] || path.join(root, 'docs/benchmarks/river-hu-storage.json');
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ output: path.relative(root, output), summary }, null, 2));
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
