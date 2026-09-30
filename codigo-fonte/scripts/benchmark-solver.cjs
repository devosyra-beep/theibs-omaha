'use strict';

// Local MODEL benchmark: no network, no production data and no real microphone.
// Fresh services model process/cold-cache startup; warm runs reuse exact input.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const mw = require('../src/multiway-session');
const core = require('../src/solver/extensive-solver');
const { buildPloRiverGame } = require('../src/solver/plo-river-game');
const { createSolverService, BUDGETS } = require('../src/solver/job-service');

const OUTPUT = path.resolve(__dirname, '../../validacao/solver-benchmark.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values, quantile) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] : null;
};
const summary = values => ({ count: values.filter(Number.isFinite).length, p50: percentile(values, .5), p95: percentile(values, .95), min: percentile(values, 0), max: percentile(values, 1) });
function fixture() {
  const hero = ['As', 'Ah', 'Qd', 'Jc', 'Tc'];
  const board = ['2s', '3h', '4d', '8c', '9s'];
  let current = mw.start({ variant: 'PLO5_HIGH', playerCount: 3, heroPosition: 'SB', startingStack: 20, smallBlind: .5, bigBlind: 1, heroCards: hero });
  while (current.state.street !== 'RIVER') {
    if (current.state.phase === 'WAIT_BOARD') current = mw.step(current.multiway, { type: 'BOARD', cards: board.slice(0, { FLOP: 3, TURN: 4, RIVER: 5 }[current.state.nextStreet]) });
    else current = mw.step(current.multiway, { type: 'ACT', actor: current.state.actor, action: current.state.legal.toCall ? 'CALL' : 'CHECK' });
  }
  if (current.state.actor !== current.state.heroId) throw Error('Benchmark fixture must begin at the Hero decision.');
  const combinations = [
    [hero, ['5s', '6s', 'Qd', 'Jc', 'Tc']],
    [['Ks', 'Kh', '6d', '7c', '8h'], ['5h', '6h', 'Kd', '7c', '8h']],
    [['Qs', 'Qh', '6c', '7d', '8d'], ['5c', '6c', 'Qc', '7d', '8d']]
  ];
  return {
    input: {
      multiway: current.multiway,
      ranges: combinations.map((cards, seatId) => ({ seatId, complete: true, source: 'SYNTHETIC_BENCHMARK_NOT_A_POPULATION_RANGE', combos: cards.map(cards => ({ cards, weight: 1 })) })),
      sizing: { type: 'MIN_MID_MAX', maxAggressions: 1 }, rake: { type: 'NONE' }
    },
    revisionKey: current.state.revisionKey, handId: current.multiway.handId
  };
}

async function runJob(service, owner, fixture, budget, condition, deadline, sample) {
  const started = performance.now(), before = service.stats();
  const parentEventLoopDelays = [];
  let heartbeatAt = started;
  const heartbeat = setInterval(() => {
    const now = performance.now();
    parentEventLoopDelays.push(Math.max(0, now - heartbeatAt - 10));
    heartbeatAt = now;
  }, 10);
  heartbeat.unref();
  const initial = await service.start(owner, fixture.input, { budget, revisionKey: fixture.revisionKey, handId: fixture.handId });
  const acknowledgedMs = performance.now() - started;
  let latest = initial, firstActionsObservedMs = initial.result?.actions?.length ? acknowledgedMs : null;
  let polls = 0, stopByHarness = false;
  const observations = [];
  while (!['COMPLETE', 'FAILED', 'CANCELLED', 'UNSUPPORTED'].includes(latest.phase)) {
    if (performance.now() >= deadline) { latest = service.cancel(owner, latest.jobId); stopByHarness = true; break; }
    await sleep(5);
    latest = service.get(owner, initial.jobId);
    polls++;
    if (latest.result?.actions?.length) {
      firstActionsObservedMs ??= performance.now() - started;
      const previous = observations[observations.length - 1];
      if (previous?.iterations !== latest.result.iterations) observations.push({ elapsedMs: performance.now() - started, iterations: latest.result.iterations, nashConvBB: latest.result.convergence?.nashConv ?? null });
    }
  }
  clearInterval(heartbeat);
  const finishedMs = performance.now() - started, after = service.stats(), result = latest.result;
  return {
    sample, budget, condition, phase: latest.phase, status: result?.status ?? latest.status, stopByHarness,
    acknowledgedMs, firstActionsObservedMs, firstValueReportedMs: latest.timing.firstValueMs,
    finishedMs, workerMs: latest.timing.workerMs, pollIntervalMs: 5, polls,
    cacheHit: latest.cache.hit, cacheHitsDelta: after.cache.hits - before.cache.hits, cacheMissesDelta: after.cache.misses - before.cache.misses,
    cacheDiskHitsDelta: after.cache.diskHits - before.cache.diskHits,
    iterations: result?.iterations ?? null, nashConvBB: result?.convergence?.nashConv ?? null,
    exactConvergenceEvaluation: result?.convergence?.exact ?? false,
    thresholdMet: result?.convergence?.thresholdMet ?? false, gto: result?.qualification?.gto ?? false,
    workerHeapUsedBytes: result?.metrics?.heapUsedBytes ?? null,
    workerHeapReadingReusedFromCache: condition !== 'COLD_WORKER_EMPTY_CACHE' && budget === 'FAST',
    parentEventLoopDelayMs: summary(parentEventLoopDelays),
    parentHeapUsedBytes: process.memoryUsage().heapUsed, nodeCount: result?.metrics?.nodeCount ?? null,
    worlds: result?.metrics?.worlds ?? null, actionCount: result?.actions?.length ?? 0,
    termination: result?.termination ?? latest.reason ?? null, observations
  };
}

async function main() {
  const started = performance.now(), globalDeadline = started + 55000;
  const example = fixture(), built = buildPloRiverGame(example.input);
  if (built.status !== 'READY') throw Error(JSON.stringify(built));
  const direct = [];
  for (let sample = 0; sample < 3; sample++) {
    const start = performance.now();
    const result = core.solve(built.game, { iterations: 1000, checkEvery: 50, timeBudgetMs: 1500, targetNashConv: .01 });
    direct.push({ sample, elapsedMs: performance.now() - start, iterations: result.iterations, nashConvBB: result.convergence.nashConv, exactConvergenceEvaluation: result.convergence.exact, termination: result.termination, nodeCount: result.metrics.nodeCount, estimatedWorkingBytes: result.metrics.estimatedWorkingBytes, parentHeapUsedBytes: process.memoryUsage().heapUsed });
  }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'theibs-solver-benchmark-'));
  const jobs = [];
  let aborted = false;
  for (const budget of ['FAST', 'STANDARD', 'DEEP']) {
    for (let sample = 0; sample < 3; sample++) {
      if (performance.now() >= globalDeadline - 2000) { aborted = true; break; }
      const cacheDirectory = path.join(temp, `${budget}-${sample}`), owner = `benchmark-owner-${budget}-${sample}`;
      let service = createSolverService({ cacheDirectory });
      try {
        // Harness ceiling preserves the requested bounded benchmark. A DEEP
        // run that exceeds this is marked censored, never successful/faster.
        jobs.push(await runJob(service, owner, example, budget, 'COLD_WORKER_EMPTY_CACHE', Math.min(globalDeadline, performance.now() + 5000), sample));
        jobs.push(await runJob(service, owner, example, budget, 'WARM_EXACT_MEMORY_CACHE', Math.min(globalDeadline, performance.now() + 5000), sample));
        if (sample === 0) {
          await service.close();
          service = createSolverService({ cacheDirectory });
          jobs.push(await runJob(service, owner, example, 'FAST', 'WARM_EXACT_DISK_CACHE_AFTER_SERVICE_RESTART', Math.min(globalDeadline, performance.now() + 1000), sample));
        }
      } finally { await service.close(); }
    }
    if (aborted) break;
  }
  const groups = Object.fromEntries([...new Set(jobs.map(job => `${job.budget}:${job.condition}`))].map(key => {
    const rows = jobs.filter(job => `${job.budget}:${job.condition}` === key);
    return [key, {
      samples: rows.length, completed: rows.filter(row => row.phase === 'COMPLETE').length, censored: rows.filter(row => row.stopByHarness).length,
      acknowledgedMs: summary(rows.map(row => row.acknowledgedMs)), firstActionsObservedMs: summary(rows.map(row => row.firstActionsObservedMs)),
      completedMs: summary(rows.filter(row => row.phase === 'COMPLETE').map(row => row.finishedMs)),
      workerHeapUsedBytes: summary(rows.map(row => row.workerHeapUsedBytes)), iterations: summary(rows.map(row => row.iterations)),
      nashConvBB: summary(rows.map(row => row.nashConvBB)), cacheHits: rows.reduce((sum, row) => sum + row.cacheHitsDelta, 0), cacheMisses: rows.reduce((sum, row) => sum + row.cacheMissesDelta, 0)
    }];
  }));
  const report = {
    evidence: 'MODEL', generatedAt: new Date().toISOString(), runtime: { node: process.version, platform: process.platform, arch: process.arch, cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model },
    elapsedMs: performance.now() - started, abortedForBenchmarkDeadline: aborted, budgets: BUDGETS,
    fixture: { variant: 'PLO5_HIGH', street: 'RIVER', players: 3, explicitCombosPerPlayer: 2, exactJointWorlds: built.game.meta.compatibleWorlds, rootPotBB: built.game.meta.rootPotBB, sizing: built.game.meta.sizing, feeModel: built.game.meta.feeModel, coverage: built.coverage, source: 'Synthetic study ranges; not inferred from actual opponents.' },
    directCore: { samples: direct, elapsedMs: summary(direct.map(row => row.elapsedMs)) }, groups, jobs,
    limitations: [
      'Local synthetic finite river study. This does not measure Render production, full PLO5, acoustic voice accuracy, Llama or a network round trip.',
      'Cold means a fresh Node worker and empty service cache; the operating system and JS module cache in the parent process may already be warm.',
      'Exact cache reuse requires identical versioned mathematical inputs and owner. Warm FAST can return without launching another worker.',
      'Three samples per principal condition do not establish a production SLA. The empirical p95 is the largest of three observations.',
      'Worker heap is a point-in-time reading, not peak RSS. Parent heap includes the benchmark and loaded modules.',
      'A 10 ms parent timer probes event-loop delay during worker jobs. This is not a browser voice, keyboard or simultaneous EV interaction test. FAST cache hits reuse the original worker heap reading.',
      'First actions are observed through 5 ms polling. Acknowledgement carries deterministic job status and does not prove a solved strategy.',
      'Harness cancellation caps any single observation at 5 seconds and the overall benchmark near 55 seconds. Censored runs are excluded from completion latency summaries.',
      'CFR+ multiplayer equilibrium convergence is not guaranteed. Exact NashConv evaluates only the reported finite profile; no result receives a GTO label.'
    ]
  };
  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output: OUTPUT, elapsedMs: report.elapsedMs, groups, failures: jobs.filter(job => ['FAILED', 'UNSUPPORTED'].includes(job.phase)) }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
