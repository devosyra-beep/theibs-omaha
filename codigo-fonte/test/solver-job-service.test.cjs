'use strict';
// HARNESS: lifecycle/isolated-cache tests. Synthetic worker timings are not
// solver performance measurements and do not establish mathematical quality.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { createSolutionCache, keyFor } = require('../src/solver/solution-cache');
const { createSolverService } = require('../src/solver/job-service');
const session = require('../src/multiway-session');

function inputFixture() {
  let state = session.start({ variant: 'PLO5_HIGH', playerCount: 2, heroPosition: 'BB',
    startingStack: 20, smallBlind: .5, bigBlind: 1, heroCards: ['As', 'Ah', 'Kd', 'Qc', 'Tc'] });
  const events = [
    { type: 'ACT', actor: 0, action: 'CALL' }, { type: 'ACT', actor: 1, action: 'CHECK' },
    { type: 'BOARD', cards: ['2s', '3h', '4d'] },
    { type: 'ACT', actor: 1, action: 'CHECK' }, { type: 'ACT', actor: 0, action: 'CHECK' },
    { type: 'BOARD', cards: ['2s', '3h', '4d', '8c'] },
    { type: 'ACT', actor: 1, action: 'CHECK' }, { type: 'ACT', actor: 0, action: 'CHECK' },
    { type: 'BOARD', cards: ['2s', '3h', '4d', '8c', '9s'] }
  ];
  for (const event of events) state = session.step(state.multiway, event);
  return { multiway: state.multiway, sizing: { type: 'MIN_MID_MAX', maxAggressions: 0 },
    rake: { type: 'NONE', basis: 'BEFORE_FEES' },
    ranges: [
      { seatId: 0, complete: true, source: 'QA', combos: [{ cards: ['Ks', 'Kh', 'Jd', 'Qh', '6c'], weight: 1 }] },
      { seatId: 1, complete: true, source: 'QA', combos: [{ cards: ['As', 'Ah', 'Kd', 'Qc', 'Tc'], weight: 1 }] }
    ] };
}

async function temporaryDirectory(t) {
  const parent = path.resolve(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'theibs-solver-qa-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), parent);
    assert.ok(path.basename(resolved).startsWith('theibs-solver-qa-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return directory;
}

async function mockWorker(t) {
  const directory = await temporaryDirectory(t), workerFile = path.join(directory, 'fixture-worker.cjs');
  await fs.writeFile(workerFile, `
    const {parentPort}=require('node:worker_threads');
    parentPort.on('message', ({checkpoint,cancel})=>{
      const flag=new Int32Array(cancel), iterations=(checkpoint?.iterations||0)+1;
      const result={status:'PARTIAL',actions:[{id:'CHECK',frequency:1,evBB:2}],iterations,qualification:{gto:false}};
      const saved={iterations,fixture:true};
      parentPort.postMessage({type:'progress',result,checkpoint:saved,workerMs:1});
      const timer=setInterval(()=>{
        if(Atomics.load(flag,0)!==0){clearInterval(timer);parentPort.postMessage({type:'done',paused:true,result,checkpoint:saved,workerMs:2});}
      },5);
      setTimeout(()=>{clearInterval(timer);parentPort.postMessage({type:'done',result,checkpoint:saved,workerMs:100});},100);
    });
  `);
  return workerFile;
}

async function until(read, accept, timeoutMs = 3000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const value = read();
    if (accept(value)) return value;
    await delay(10);
  }
  assert.fail(`Timed out waiting for solver lifecycle state: ${JSON.stringify(read())}`);
}

async function assertCompletionFrozen(service, owner, completed) {
  assert.ok(Number.isFinite(completed.timing.completionMs));
  assert.ok(completed.timing.completionMs >= 0);
  assert.ok(completed.timing.completionMs <= completed.timing.totalMs);
  await delay(30);
  const later = service.get(owner, completed.jobId);
  assert.equal(later.timing.completionMs, completed.timing.completionMs, 'polling must not increase time to completion');
  assert.ok(later.timing.totalMs > completed.timing.totalMs, 'totalMs remains job age for compatibility');
}

test('cache fingerprints ignore object-key order but invalidate mathematical input changes', () => {
  const original = { board: ['2s', '3h', '4d', '8c', '9s'], stack: 20, variant: 'PLO5_HIGH',
    positions: ['SB', 'BB'], sizing: [2, 4], rake: { type: 'NONE' }, ranges: [{ cards: ['As', 'Ah'], weight: .5 }] };
  const reversed = Object.fromEntries(Object.entries(original).reverse());
  assert.equal(keyFor(original), keyFor(reversed));
  for (const [key, value] of Object.entries({ board: ['2s', '3h', '4d', '8c', 'Ts'], stack: 20.01,
    variant: 'PLO4_HIGH', positions: ['BB', 'SB'], sizing: [2, 5], rake: { type: 'FIXED', amount: 1 },
    ranges: [{ cards: ['As', 'Ah'], weight: .6 }] })) {
    assert.notEqual(keyFor({ ...original, [key]: value }), keyFor(original), `${key} must invalidate the key`);
  }
});

test('cache isolates owners and snapshots both input and returned values', async () => {
  const cache = createSolutionCache(), key = keyFor({ fixture: 1 });
  const result = { actions: [{ evBB: 2 }] }, checkpoint = { regrets: [[1, 2]] };
  await cache.put('owner-a', key, result, checkpoint);
  result.actions[0].evBB = 999; checkpoint.regrets[0][0] = 999;
  assert.equal(await cache.get('owner-b', key), null);
  const first = await cache.get('owner-a', key);
  assert.equal(first.result.actions[0].evBB, 2); assert.equal(first.checkpoint.regrets[0][0], 1);
  first.result.actions[0].evBB = 888;
  assert.equal((await cache.get('owner-a', key)).result.actions[0].evBB, 2);
});

test('cache survives recreation, rejects oversized entries and stays bounded', async t => {
  const directory = await temporaryDirectory(t), options = { directory, maxBytes: 2048, maxEntryBytes: 1024, maxEntries: 2 };
  const cache = createSolutionCache(options), key = keyFor({ fixture: 'persistent' });
  await cache.put('owner', key, { status: 'PARTIAL', value: 7 }, { iterations: 10 });
  const recreated = createSolutionCache(options);
  assert.equal((await recreated.get('owner', key)).result.value, 7);
  assert.equal(recreated.stats().diskHits, 1);
  assert.equal(await recreated.get('different-owner', key), null);
  const oversized = await cache.put('owner', keyFor({ fixture: 'huge' }), { text: 'x'.repeat(2000) }, {});
  assert.equal(oversized.saved, false);
  for (let i = 0; i < 5; i++) await cache.put('owner', keyFor({ i }), { value: i }, {});
  assert.ok(cache.stats().entries <= 2); assert.ok(cache.stats().memoryBytes <= 2048);
  const sizes = await Promise.all((await fs.readdir(directory)).filter(name => name.endsWith('.json')).map(name => fs.stat(path.join(directory, name))));
  assert.ok(sizes.reduce((sum, info) => sum + info.size, 0) <= 2048);
});

test('concurrent starts admit only the latest owner generation after asynchronous cache lookup', async () => {
  const service = createSolverService();
  const release = service.prioritize();
  try {
    const one = inputFixture(), two = structuredClone(one); two.sizing.maxAggressions = 1;
    const results = await Promise.allSettled([
      service.start('owner', one, { revisionKey: 'older', handId: one.multiway.handId }),
      service.start('owner', two, { revisionKey: 'newer', handId: two.multiway.handId })
    ]);
    assert.equal(results[0].status, 'rejected'); assert.equal(results[0].reason.statusCode, 409);
    assert.equal(results[1].status, 'fulfilled'); assert.equal(results[1].value.revisionKey, 'newer');
    assert.equal(service.stats().queued, 1);
    assert.throws(() => service.get('different-owner', results[1].value.jobId), /not found/i);
  } finally { await service.close(); release(); }
});

test('active cancellation cannot be overwritten by a late worker result', async t => {
  const workerFile = await mockWorker(t), service = createSolverService({ workerFile });
  try {
    const input = inputFixture(), job = await service.start('owner', input, { revisionKey: 'revision-1', handId: input.multiway.handId });
    await until(() => service.get('owner', job.jobId), item => item.phase === 'REFINING');
    service.cancel('owner', job.jobId);
    await delay(180);
    const cancelled = service.get('owner', job.jobId);
    assert.equal(cancelled.phase, 'CANCELLED');
    await assertCompletionFrozen(service, 'owner', cancelled);
    assert.equal(service.stats().active, false);
    assert.equal(service.stats().completed, 0);
  } finally { await service.close(); }
});

test('foreground priority pauses background work and resumes its completed checkpoint', async t => {
  const workerFile = await mockWorker(t), service = createSolverService({ workerFile });
  let release;
  try {
    const input = inputFixture(), job = await service.start('owner', input, { revisionKey: 'revision-1', handId: input.multiway.handId });
    await until(() => service.get('owner', job.jobId), item => item.phase === 'REFINING');
    release = service.prioritize();
    const paused = await until(() => service.get('owner', job.jobId), item => item.phase === 'QUEUED');
    assert.equal(paused.result.iterations, 1);
    assert.equal(paused.timing.completionMs, null, 'a foreground pause is not completion');
    assert.equal(service.stats().active, false);
    release(); release = null;
    const finished = await until(() => service.get('owner', job.jobId), item => item.phase === 'COMPLETE');
    assert.equal(finished.result.iterations, 2);
    finished.result.actions[0].evBB = 999;
    assert.equal(service.get('owner', job.jobId).result.actions[0].evBB, 2);
  } finally { await service.close(); release?.(); }
});

test('immediate preemption before a cached refinement returns a strategy preserves the result and checkpoint', async t => {
  const directory = await temporaryDirectory(t), workerFile = path.join(directory, 'preempt-before-value.cjs');
  await fs.writeFile(workerFile, `
    const {parentPort}=require('node:worker_threads');
    parentPort.on('message', ({checkpoint,cancel})=>{
      const flag=new Int32Array(cancel);
      setTimeout(()=>{
        if(Atomics.load(flag,0)){
          parentPort.postMessage({type:'done',paused:true,result:{status:'NOT_SOLVED',actions:[],reasons:[{code:'BUDGET_BEFORE_FIRST_STRATEGY'}]},workerMs:7});
          return;
        }
        const iterations=(checkpoint?.iterations||0)+1;
        parentPort.postMessage({type:'done',result:{status:'APPROXIMATE',actions:[{id:'CHECK',frequency:1,evBB:2}],iterations},checkpoint:{iterations,fixture:true},workerMs:12});
      },30);
    });
  `);
  const service = createSolverService({ workerFile, cacheDirectory: path.join(directory, 'cache') });
  let release;
  try {
    const input = inputFixture(), options = { budget: 'STANDARD', revisionKey: 'revision', handId: input.multiway.handId };
    const seed = await service.start('owner', input, options);
    const original = await until(() => service.get('owner', seed.jobId), item => item.phase === 'COMPLETE');
    assert.equal(original.result.iterations, 1);
    const writes = service.stats().cache.writes;
    const refinement = await service.start('owner', input, options);
    assert.equal(refinement.cache.hit, true);
    release = service.prioritize();
    const paused = await until(() => service.get('owner', refinement.jobId), item => item.phase === 'QUEUED');
    assert.deepEqual(paused.result, original.result, 'an empty paused result must not replace the cached strategy');
    assert.equal(service.stats().cache.writes, writes, 'an empty paused result must not overwrite the cache');
    assert.ok(paused.timing.workerMs >= 7, 'the interrupted run still consumes its budget');
    release(); release = null;
    const resumed = await until(() => service.get('owner', refinement.jobId), item => item.phase === 'COMPLETE');
    assert.equal(resumed.result.iterations, 2, 'resume uses the retained checkpoint rather than starting over');

    // The same preservation rule applies when a worker exhausts its budget
    // before producing its first new strategy, without requesting a resume.
    await fs.writeFile(workerFile, `const {parentPort}=require('node:worker_threads');parentPort.on('message',()=>parentPort.postMessage({type:'done',result:{status:'NOT_SOLVED',actions:[]},workerMs:20}));`);
    const budgetJob = await service.start('owner', input, options);
    const budgetEnd = await until(() => service.get('owner', budgetJob.jobId), item => item.phase === 'COMPLETE');
    assert.equal(budgetEnd.result.iterations, 2);
    assert.equal(budgetEnd.result.actions[0].evBB, 2);
    assert.ok(budgetEnd.timing.workerMs >= 20);
  } finally { release?.(); await service.close(); }
});

test('save callbacks queued behind disk I/O cannot mutate or cache a cancelled generation', async t => {
  const directory = await temporaryDirectory(t), workerFile = path.join(directory, 'queued-results.cjs');
  const cacheDirectory = path.join(directory, 'cache');
  await fs.writeFile(workerFile, `
    const {parentPort}=require('node:worker_threads');
    parentPort.on('message',()=>{
      for(let iterations=1;iterations<=3;iterations++)parentPort.postMessage({
        type:iterations===3?'done':'progress',
        result:{status:'APPROXIMATE',actions:[{id:'CHECK',frequency:1,evBB:iterations}],iterations},
        checkpoint:{iterations,fixture:true},workerMs:iterations
      });
    });
  `);
  let announceBlocked, unblock;
  const blocked = new Promise(resolve => { announceBlocked = resolve; });
  const gate = new Promise(resolve => { unblock = resolve; });
  const mkdir = fs.mkdir;
  fs.mkdir = async function (location, ...args) {
    if (location === cacheDirectory) { announceBlocked(); await gate; }
    return mkdir.call(this, location, ...args);
  };
  const service = createSolverService({ workerFile, cacheDirectory });
  try {
    const input = inputFixture();
    const job = await service.start('owner', input, { revisionKey: 'old', handId: input.multiway.handId });
    await blocked;
    await delay(25); // Both later messages now wait behind the first cache write.
    assert.equal(service.get('owner', job.jobId).result.iterations, 1);
    service.cancel('owner', job.jobId);
    unblock();
    await delay(60);
    const cancelled = service.get('owner', job.jobId);
    assert.equal(cancelled.phase, 'CANCELLED');
    assert.equal(cancelled.result.iterations, 1);
    assert.equal(service.stats().cache.writes, 1, 'only the valid write started before cancellation is allowed');
    const files = (await fs.readdir(cacheDirectory)).filter(name => name.endsWith('.json'));
    assert.equal(files.length, 1);
    const saved = JSON.parse(await fs.readFile(path.join(cacheDirectory, files[0]), 'utf8'));
    assert.equal(saved.result.iterations, 1);
    assert.equal(saved.checkpoint.iterations, 1);
  } finally { unblock(); fs.mkdir = mkdir; await service.close(); }
});

test('FAST, STANDARD and DEEP share actual time and all global/action iterations for the same decision', async t => {
  const directory=await temporaryDirectory(t),workerFile=path.join(directory,'cumulative-budget.cjs');
  await fs.writeFile(workerFile, `
    const {parentPort}=require('node:worker_threads');
    parentPort.on('message',({checkpoint,budget})=>{
      const workIterations=(checkpoint?.workIterations||0)+budget.iterations;
      parentPort.postMessage({type:'done',workerMs:budget.timeMs,
        result:{status:'APPROXIMATE',actions:[{id:'CHECK',frequency:1,evBB:2}],receivedBudget:budget},
        checkpoint:{iterations:1,workIterations,fixture:true}});
    });
  `);
  const service=createSolverService({workerFile});
  try{
    const input=inputFixture(),options={revisionKey:'same-decision',handId:input.multiway.handId};
    const fast=await service.start('owner',input,{...options,budget:'FAST'});
    const initial=await until(()=>service.get('owner',fast.jobId),item=>item.phase==='COMPLETE');
    assert.deepEqual(initial.result.receivedBudget,{timeMs:500,iterations:50});
    const standard=await service.start('owner',input,{...options,budget:'STANDARD'});
    const refined=await until(()=>service.get('owner',standard.jobId),item=>item.phase==='COMPLETE');
    assert.deepEqual(refined.result.receivedBudget,{timeMs:2500,iterations:950});
    assert.equal(refined.timing.decisionComputeMs,3000);assert.equal(refined.timing.decisionWorkIterations,1000);
    const repeated=await service.start('owner',input,{...options,budget:'STANDARD'});
    assert.equal(repeated.phase,'COMPLETE');assert.match(repeated.reason,/Cumulative/);
    await assertCompletionFrozen(service,'owner',repeated);
    const deep=await service.start('owner',input,{...options,budget:'DEEP'});
    const completed=await until(()=>service.get('owner',deep.jobId),item=>item.phase==='COMPLETE');
    assert.deepEqual(completed.result.receivedBudget,{timeMs:27000,iterations:19000});
    assert.equal(completed.timing.decisionComputeMs,30000);
    assert.equal(completed.timing.decisionWorkIterations,20000);

    const newDecision=await service.start('owner',input,{budget:'STANDARD',revisionKey:'another-decision',handId:'another-hand'});
    const reused=await until(()=>service.get('owner',newDecision.jobId),item=>item.phase==='COMPLETE');
    assert.equal(reused.cache.hit,true);
    assert.deepEqual(reused.result.receivedBudget,{timeMs:3000,iterations:1000},'reusing exact cached mathematics from another decision consumes no new compute');
  }finally{await service.close();}
});

test('completion time freezes for cold worker results and warm FAST cache hits', async t => {
  const workerFile = await mockWorker(t), service = createSolverService({ workerFile });
  try {
    const input = inputFixture(), options = { budget: 'FAST', revisionKey: 'timed', handId: input.multiway.handId };
    const job = await service.start('owner', input, options);
    assert.equal(job.timing.completionMs, null);
    const completed = await until(() => service.get('owner', job.jobId), item => item.phase === 'COMPLETE');
    assert.ok(completed.timing.firstValueMs <= completed.timing.completionMs);
    await assertCompletionFrozen(service, 'owner', completed);
    const warm = await service.start('owner', input, { ...options, revisionKey: 'warm-revision' });
    assert.equal(warm.cache.hit, true); assert.equal(warm.phase, 'COMPLETE');
    assert.equal(warm.timing.workerMs, 0, 'a cache-only job did not run a worker');
    assert.ok(warm.timing.firstValueMs <= warm.timing.completionMs);
    await assertCompletionFrozen(service, 'owner', warm);
  } finally { await service.close(); }
});

test('unsupported inputs, full queues and queued cancellation all freeze terminal completion time', async () => {
  const service = createSolverService({ maxQueued: 1 }), release = service.prioritize();
  try {
    const input = inputFixture();
    const unsupported = await service.start('invalid-owner', { ...input, rake: null });
    assert.equal(unsupported.phase, 'UNSUPPORTED');
    await assertCompletionFrozen(service, 'invalid-owner', unsupported);
    const queued = await service.start('owner', input);
    assert.equal(queued.phase, 'QUEUED'); assert.equal(queued.timing.completionMs, null);
    const overflow = await service.start('other-owner', input);
    assert.equal(overflow.phase, 'UNSUPPORTED'); assert.match(overflow.reason, /queue is full/);
    await assertCompletionFrozen(service, 'other-owner', overflow);
    const cancelled = service.cancel('owner', queued.jobId);
    assert.equal(cancelled.phase, 'CANCELLED');
    await assertCompletionFrozen(service, 'owner', cancelled);
  } finally { await service.close(); release(); }
});

test('worker rejection, exception, unexpected exit and timeout freeze completion time', async t => {
  const directory = await temporaryDirectory(t);
  for (const [name, body, phase] of [
    ['reported-error', "parentPort.postMessage({type:'error',error:'Fixture failure'});", 'FAILED'],
    ['exception', "throw Error('Fixture exception');", 'FAILED'],
    ['exit', 'process.exit(7);', 'FAILED'],
    ['unsupported', "parentPort.postMessage({type:'done',result:{status:'NOT_SOLVED',actions:[]},workerMs:1});", 'UNSUPPORTED'],
    ['timeout', 'setInterval(()=>{},100);', 'COMPLETE']
  ]) await t.test(name, async () => {
    const workerFile = path.join(directory, name + '.cjs');
    await fs.writeFile(workerFile, `const {parentPort}=require('node:worker_threads');parentPort.on('message',()=>{${body}});`);
    const service = createSolverService({ workerFile });
    try {
      const job = await service.start('owner', inputFixture(), { budget: 'FAST' });
      const completed = await until(() => service.get('owner', job.jobId), item => item.phase === phase, 6000);
      if (name === 'timeout') assert.match(completed.reason, /Budget reached/);
      await assertCompletionFrozen(service, 'owner', completed);
    } finally { await service.close(); }
  });
});
