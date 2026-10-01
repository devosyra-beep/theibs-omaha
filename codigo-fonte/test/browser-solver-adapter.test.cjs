'use strict';
// HARNESS: executes the generated static browser graph without Node require.
// Real browser Worker transport is verified separately by the browser QA gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {generate,normalize} = require('../scripts/build-browser-solver.cjs');
const core = require('../src/solver/extensive-solver');
const conditioned = require('../src/solver/action-conditioned');
const job = require('../src/solver/job-worker');
const session = require('../src/multiway-session');
const fixtures = require('./helpers/solver-reference-fixtures.cjs');
const root = path.resolve(__dirname,'..');
const plain = value=>JSON.parse(JSON.stringify(value));
function load({transport=false}={}) {
  const messages = [], listeners = {};
  const context = vm.createContext({TextEncoder,TextDecoder,structuredClone,crypto:crypto.webcrypto,performance:{now:()=>0},SharedArrayBuffer:undefined,Atomics:undefined,
    ...(transport?{postMessage:message=>messages.push(plain(message)),addEventListener:(type,callback)=>{listeners[type]=callback;}}:{})});
  vm.runInContext(fs.readFileSync(path.join(root,'public/browser-solver-worker.js'),'utf8'),context,{timeout:10000});
  return {api:context.TheibsBrowserSolver,messages,dispatch:data=>listeners.message({data})};
}
function withoutObservationalTiming(value) {
  if (Array.isArray(value)) return value.map(withoutObservationalTiming);
  if (value&&typeof value==='object') return Object.fromEntries(Object.entries(value)
    .filter(([key])=>!key.endsWith('Ms')&&key!=='heapUsedBytes').map(([key,item])=>[key,withoutObservationalTiming(item)]));
  return value;
}
test('generated artifacts are current, reproducible and use only audited Node adapters',()=>{
  const generated = generate();
  assert.equal(normalize(fs.readFileSync(path.join(root,'public/browser-solver-worker.js'),'utf8')),generated.source);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'public/browser-solver-manifest.json'),'utf8')),generated.manifest);
  assert.deepEqual(generated.manifest.nodeAdapters,['node:crypto','node:perf_hooks','node:worker_threads']);
  assert.ok(generated.manifest.sources.every(source=>source.id.startsWith('src/')||source.id==='public/card-voice.js'));
  assert.ok(!generated.manifest.sources.some(source=>/job-service|solution-cache/.test(source.id)));
  assert.doesNotMatch(generated.source,/\beval\s*\(|\bnew\s+Function\s*\(/);
  assert.equal(normalize('a\r\nb\rc\n'),'a\nb\nc\n');
  const check = spawnSync(process.execPath,['scripts/build-browser-solver.cjs','--check'],{cwd:root,encoding:'utf8'});
  assert.equal(check.status,0,check.stderr);
});
test('browser streaming SHA-256 equals Node for golden vectors, UTF-8 and all padding boundaries',()=>{
  const {api} = load();
  const vectors = ['', 'abc', 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', 'a'.repeat(1000000),
    'Omaha ♠ 🂡 中文 \ud800', ...Array.from({length:140},(_,index)=>'x'.repeat(index))];
  for (const input of vectors) {
    assert.equal(api.crypto.createHash('sha256').update(input).digest('hex'),crypto.createHash('sha256').update(input).digest('hex'));
    const browser = api.crypto.createHash('sha256'),node = crypto.createHash('sha256');
    for (let i=0;i<input.length;i+=17) {browser.update(input.slice(i,i+17));node.update(input.slice(i,i+17));}
    assert.equal(browser.digest('hex'),node.digest('hex'));
  }
  const bytes = crypto.randomBytes(513),browser = api.crypto.createHash('sha256'),node = crypto.createHash('sha256');
  for (let i=0;i<bytes.length;i+=31) {browser.update(bytes.subarray(i,i+31));node.update(bytes.subarray(i,i+31));}
  assert.equal(browser.digest('hex'),node.digest('hex'));
  assert.match(api.crypto.randomUUID(),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('original finite game hashes, CFR strategy/checkpoint and outward saddle bounds match in the generated graph',()=>{
  const {api} = load();
  for (const game of [fixtures.matrixGame([[1,-1],[-1,1]]),fixtures.kuhnGame(),fixtures.privateTypeGame()]) {
    const options = {iterations:64,timeBudgetMs:5000,checkEvery:10};
    const node = core.solve(game,options),browser = plain(api.core.solve(structuredClone(game),options));
    assert.deepEqual(withoutObservationalTiming(browser),withoutObservationalTiming(node));
    const nodeBounds = core.saddleBounds(game,node.strategy,0);
    const browserBounds = plain(api.core.saddleBounds(structuredClone(game),browser.strategy,0));
    assert.deepEqual(withoutObservationalTiming(browserBounds),withoutObservationalTiming(nodeBounds));
  }
  const game = fixtures.matrixGame([[2,-1],[1,0]]);
  const options = {player:0,informationSet:game.root.informationSet,actionIds:game.root.actions.map(action=>action.id),iterations:64,timeBudgetMs:5000};
  assert.deepEqual(withoutObservationalTiming(plain(api.actionConditioned.solveActionConditioned(game,options))),
    withoutObservationalTiming(conditioned.solveActionConditioned(game,options)));
});
test('real river ledger, action certificates and compatible resume preserve Node mathematics',()=>{
  const {api} = load();
  for (const source of [fixtures.riverCallInput(),fixtures.riverCallInput({blockers:true}),fixtures.riverMixedInput()]) {
    const input = structuredClone({...source,budget:plain(api.limits)}),budget = {timeMs:5000,iterations:128};
    const node = job.execute({input,budget}),browser = plain(api.execute({input:structuredClone(input),budget}));
    assert.deepEqual(withoutObservationalTiming(browser),withoutObservationalTiming(node));
    assert.equal(browser.result.gameHash,browser.result.actionPrecision.baseGameHash);
    assert.equal(browser.result.qualification.gto,false);
    const nodeResume = job.execute({input,budget,checkpoint:node.checkpoint});
    const browserResume = plain(api.execute({input:structuredClone(input),budget,checkpoint:browser.checkpoint}));
    assert.deepEqual(withoutObservationalTiming(browserResume),withoutObservationalTiming(nodeResume));
  }
});
test('worker transport binds build and canonical decision revisions, emits coherent original progress/done',()=>{
  const worker = load({transport:true}),input = fixtures.riverCallInput();
  const observed = session.envelope(input.multiway);
  assert.deepEqual(worker.messages[0],{type:'ready',schemaVersion:1,buildFingerprint:worker.api.manifest.buildFingerprint});
  worker.dispatch({type:'solve',jobId:'parity-job',generation:3,input,budget:{timeMs:5000,iterations:128},
    expectedBuildFingerprint:worker.api.manifest.buildFingerprint,expectedRevisionKey:observed.state.revisionKey});
  const progress = worker.messages.filter(message=>message.type==='progress'),done = worker.messages.at(-1);
  assert.ok(progress.length>0); assert.equal(done.type,'done'); assert.equal(done.paused,false);
  for (const message of [...progress,done]) {
    assert.equal(message.jobId,'parity-job');assert.equal(message.generation,3);
    assert.equal(message.handId,input.multiway.handId);assert.equal(message.revisionKey,observed.state.revisionKey);
    assert.equal(message.buildFingerprint,worker.api.manifest.buildFingerprint);
    assert.equal(message.result.gameHash,message.checkpoint.baseGameHash);
    assert.equal(message.result.iterations,message.checkpoint.global.iterations);
  }
  const node = job.execute({input:structuredClone({...input,budget:plain(worker.api.limits)}),budget:{timeMs:5000,iterations:128}});
  assert.deepEqual(withoutObservationalTiming(done.result),withoutObservationalTiming(node.result));
  assert.deepEqual(withoutObservationalTiming(done.checkpoint),withoutObservationalTiming(node.checkpoint));
  worker.dispatch({type:'solve'});assert.match(worker.messages.at(-1).error,/new solver worker/);
});
test('worker rejects stale revision/build, unsupported seats and caller memory budgets before emitting a value',()=>{
  const input = fixtures.riverCallInput(),revision = session.envelope(input.multiway).state.revisionKey;
  for (const change of [message=>{message.expectedRevisionKey='obsolete';},message=>{message.expectedBuildFingerprint='old-build';},
    message=>{message.budget.timeMs=5001;}]) {
    const worker = load({transport:true});
    const message = {type:'solve',jobId:'invalid-job',generation:1,input,budget:{timeMs:5000,iterations:128},
      expectedBuildFingerprint:worker.api.manifest.buildFingerprint,expectedRevisionKey:revision};
    change(message);worker.dispatch(message);
    assert.equal(worker.messages.at(-1).type,'error');assert.equal(worker.messages.filter(item=>item.result).length,0);
  }
  const unsupported = load({transport:true});
  const threeSeats = session.start({variant:'PLO5_HIGH',playerCount:3,heroPosition:'SB',startingStack:20,smallBlind:.5,bigBlind:1,heroCards:fixtures.heroCards});
  unsupported.dispatch({type:'solve',jobId:'three-seats',generation:1,input:{...input,multiway:threeSeats.multiway},budget:{timeMs:5000,iterations:128},
    expectedBuildFingerprint:unsupported.api.manifest.buildFingerprint,expectedRevisionKey:threeSeats.state.revisionKey});
  assert.match(unsupported.messages.at(-1).error,/heads-up river/);
  assert.equal(unsupported.messages.filter(item=>item.result).length,0);
  const worker = load({transport:true});
  const injected = {...input,budget:{maxNodes:1,maxWorlds:1,maxMemoryBytes:1,maxBuildMs:1}};
  worker.dispatch({type:'solve',jobId:'normalized',generation:1,input:injected,budget:{timeMs:5000,iterations:128},
    expectedBuildFingerprint:worker.api.manifest.buildFingerprint,expectedRevisionKey:revision});
  assert.equal(worker.messages.at(-1).type,'done');
  assert.equal(worker.messages.at(-1).result.abstraction.budget.maxNodes,12000);
});
