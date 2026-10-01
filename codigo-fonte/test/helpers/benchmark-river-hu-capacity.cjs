'use strict';

// Bounded local capacity evidence. This measures complete exact trees and the
// existing browser-capability job path, not Render, browser or an SLA.
const assert = require('node:assert/strict');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { capacityRiverInput } = require('./river-hu-capacity-fixtures.cjs');

const sourceRoot = path.resolve(__dirname, '../..');
const repositoryRoot = path.dirname(sourceRoot);
const adapterPath = path.join(sourceRoot, 'src/solver/plo-river-game.js');
const digest = text => crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');

function adapterFrom(source) {
  const loaded = new Module(adapterPath, module);
  loaded.filename = adapterPath;
  loaded.paths = Module._nodeModulePaths(path.dirname(adapterPath));
  loaded._compile(source, adapterPath);
  return loaded.exports;
}

if (!isMainThread) {
  try {
    const adapter = adapterFrom(workerData.source);
    const job = require('../../src/solver/job-worker');
    const heapBefore = process.memoryUsage().heapUsed;
    const began = performance.now();
    let firstValueMs = null;
    const finished = job.execute({ input: workerData.input, budget: { timeMs: 3000, iterations: 1000 },
      onProgress(message) {
        if (firstValueMs === null && message.result?.actions?.length) firstValueMs = performance.now() - began;
      }
    }, { compilationReuse: true, build: adapter.buildPloRiverGame });
    const result = finished.result;
    parentPort.postMessage({ status: result.status, reasons: result.reasons || [],
      firstValueMs, workerMs: finished.workerMs, buildMs: result.metrics?.buildMs ?? null,
      iterations: result.iterations, workIterations: result.workIterations,
      nashConv: result.convergence?.nashConv ?? null,
      decisionPrecision: result.decisionPrecision?.status ?? null,
      decisionOutcome: result.decisionOutcome?.status ?? null,
      stopReason: result.adaptation?.stopReason ?? null,
      refinementRecommended: result.adaptation?.refinementRecommended ?? null,
      completeChanceSupport: result.abstraction?.chanceSupportComplete ?? null,
      worlds: result.abstraction?.compatibleWorlds ?? null,
      nodes: result.metrics?.nodes ?? null, reservedMemoryBytes: result.metrics?.reservedMemoryBytes ?? null,
      estimatedWorkingBytes: result.metrics?.estimatedWorkingBytes ?? null,
      costs: result.metrics?.costs ?? null,
      actionCount: result.actions?.length || 0,
      certifiedActions: result.actionPrecision?.actions?.filter(row => row.certified).length || 0,
      commitmentBounds: result.actionPrecision?.actions?.map(row => ({ id: row.id, certified: row.certified,
        lowerBB: row.lowerBB ?? null, upperBB: row.upperBB ?? null })) || [],
      heapBeforeBytes: heapBefore, heapAfterBytes: process.memoryUsage().heapUsed,
      heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore });
  } catch (error) { parentPort.postMessage({ error: error.stack }); }
} else {
  async function run(source, input) {
    const beforeRSS = process.memoryUsage().rss;
    let peakRSS = beforeRSS;
    const began = performance.now();
    const worker = new Worker(__filename, { workerData: { source, input },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
    const poll = setInterval(() => { peakRSS = Math.max(peakRSS, process.memoryUsage().rss); }, 5);
    let timer;
    try {
      const result = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error('Capacity worker exceeded its eight-second wall watchdog.')), 8000);
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', code => { if (code) reject(Error(`Capacity worker exited ${code}.`)); });
      });
      if (result.error) throw Error(result.error);
      return { ...result, observedWallMs: performance.now() - began,
        processRSS: { beforeBytes: beforeRSS, sampledPeakBytes: peakRSS, deltaBytes: peakRSS - beforeRSS } };
    } finally { clearInterval(poll); clearTimeout(timer); await worker.terminate(); }
  }

  async function main() {
    const baseline = execFileSync('git', ['show', 'b62b0f1:codigo-fonte/src/solver/plo-river-game.js'],
      { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
    const prototype = process.argv.includes('--prototype');
    const candidate = prototype ? baseline.replace('maxCombosPerSeat: 12, maxSizingLevels: 12, maxWorlds: 144',
      'maxCombosPerSeat: 24, maxSizingLevels: 12, maxWorlds: 576') : fs.readFileSync(adapterPath, 'utf8');
    assert.ok(adapterFrom(candidate).HU_SUPPORT.maxCombosPerSeat >= 24);
    const report = { classification: 'LOCAL_BOUNDED_EXACT_RIVER_HU_CAPACITY', generatedAt: new Date().toISOString(),
      baselineCommit: 'b62b0f1', candidateMode: prototype ? 'IN_MEMORY_ADMISSION_PROTOTYPE' : 'CURRENT_WORKING_SOURCE',
      node: process.version, platform: process.platform, baselineSourceSHA256: digest(baseline), candidateSourceSHA256: digest(candidate),
      protocol: 'Three alternating fresh-worker pairs; baseline12x12 versus candidate24x24, both two declared sizes,3s/1000 total work and trusted browser compilation capability. Different ranges define different games; times are capacity comparisons, not identical-game speedups.',
      limits: { maxNodes: 12000, maxMemoryBytes: 48 * 1024 * 1024, maxBuildMs: 750, solverWorkingBytes: 64 * 1024 * 1024 },
      memoryScope: 'Worker heap before/after samples are not peak. Process RSS sampled every5ms includes parent and worker and retained allocator pages, not browser memory.',
      limitations: ['Synthetic explicit weighted ranges; no inferred cards or population distribution.',
        'Three samples per arm are descriptive, not a latency/convergence guarantee.',
        '576 compatible worlds admit only abstractions within unchanged conservative memory/tree guards.',
        'Node browser-capability execution is not a real browser measurement.'], pairs: [] };
    for (let round = 0; round < 3; round++) {
      const pair = {};
      for (const arm of round % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
        const input = capacityRiverInput({ combos: arm === 'baseline' ? 12 : 24, sizings: 2 });
        input.budget = { ...report.limits, maxWorlds: arm === 'baseline' ? 144 : 576 };
        delete input.budget.solverWorkingBytes;
        pair[arm] = await run(arm === 'baseline' ? baseline : candidate, input);
        assert.notEqual(pair[arm].status, 'NOT_SOLVED', JSON.stringify(pair[arm]));
        assert.equal(pair[arm].worlds, arm === 'baseline' ? 144 : 576);
        assert.equal(pair[arm].completeChanceSupport, true);
        assert.ok(pair[arm].reservedMemoryBytes <= report.limits.maxMemoryBytes);
      }
      report.pairs.push(pair);
      process.stdout.write(`Pair${round + 1}:12x12 ${pair.baseline.workerMs.toFixed(1)}ms/${pair.baseline.decisionOutcome};24x24 ${pair.candidate.workerMs.toFixed(1)}ms/${pair.candidate.decisionOutcome}\n`);
    }
    report.rejections = [3, 12].map(sizings => {
      const built = adapterFrom(candidate).buildPloRiverGame(capacityRiverInput({ sizings }));
      assert.equal(built.status, 'NOT_SOLVED');
      assert.equal(built.game, null);
      assert.equal(built.reasons[0].code, 'MEMORY_BUDGET');
      return { combosPerSeat: 24, sizings, reasons: built.reasons, buildMs: built.metrics.buildMs };
    });
    report.sourceStable = prototype || digest(fs.readFileSync(adapterPath, 'utf8')) === report.candidateSourceSHA256;
    assert.equal(report.sourceStable, true);
    const output = path.join(repositoryRoot, 'validacao/river-hu-capacity-24', prototype ? 'prototype.json' : 'bounded-local.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(`${output}\n`);
  }
  if (require.main === module) main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
}
