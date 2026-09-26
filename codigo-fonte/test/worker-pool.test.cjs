'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {EventEmitter}=require('node:events'),{execFileSync}=require('node:child_process');
const {createAnalysisPool}=require('../src/analysis-worker');
const {monteCarloEquity}=require('../src/equity-engine');
const fixture=path.resolve(__dirname,'fixtures/pool-worker.cjs');
const base={variant:'PLO5_HIGH',heroCards:['As','Ks','Qh','Jh','Td'],board:[],position:'BTN',players:6,potBeforeAction:12,amountToCall:4,effectiveStack:100,assumeNoRake:true,opponentRanges:Array.from({length:5},()=>({kind:'UNIFORM'})),samples:500,samplingMode:'FIXED',seed:428};
function response(){return Object.assign(new EventEmitter(),{writableEnded:false,destroyed:false});}

test('Real worker is reused and keeps seed results isolated between requests',async t=>{
 const pool=createAnalysisPool();t.after(()=>pool.close());const r=response();
 for(let i=0;i<3;i++){
  const input={...base,seed:base.seed+i},direct=monteCarloEquity(input),actual=await pool(input,r);
  assert.equal(actual.status,'OK');for(const key of ['samples','equity','winRate','tieRate'])assert.equal(actual.equity[key],direct[key]);
  assert.equal(actual.performance.workerReused,i>0);assert.equal(actual.performance.monteCarloSamples,500);
  assert.ok(actual.performance.requestElapsedMs>=actual.performance.workerExecutionMs);
  assert.equal(actual.performance.simulationsPerSecond,500000/actual.performance.requestElapsedMs);
  assert.equal(r.listenerCount('close'),0);
 }
 assert.deepEqual(pool.stats(),{workers:1,busy:0,closed:false});
});

test('Fixed and adaptive throughput uses actual completed samples and declared measurement scope',()=>{
 for(const samplingMode of ['FIXED','ADAPTIVE']){
  const result=monteCarloEquity({...base,samplingMode});
  assert.equal(result.samplingMode,samplingMode);assert.ok(result.elapsedMs>0);
  assert.equal(result.simulationsPerSecond,result.samples*1000/result.elapsedMs);
  assert.equal(result.measurementScope,'MONTE_CARLO_ENGINE_WALL_TIME');
 }
});

test('At most two workers run and overlapping replies stay with the correct request',async t=>{
 const pool=createAnalysisPool({workerFile:fixture});t.after(()=>pool.close());
 const a=pool({key:'slow',delay:70}),b=pool({key:'fast',delay:10});
 await assert.rejects(pool({key:'third'}),/ocupado/);assert.equal(pool.stats().busy,2);
 assert.equal((await b).key,'fast');assert.equal((await a).key,'slow');assert.deepEqual(pool.stats(),{workers:2,busy:0,closed:false});
});

test('Client cancellation retires only its worker and cannot leak a late reply',async t=>{
 const pool=createAnalysisPool({workerFile:fixture});t.after(()=>pool.close());const r=response();
 const a=pool({key:'cancelled',delay:100},r),rejected=assert.rejects(a,/cancelado/),b=pool({key:'survivor',delay:10});
 r.emit('close');await rejected;assert.equal((await b).key,'survivor');assert.equal(r.listenerCount('close'),0);
 const next=await pool({key:'after'});assert.equal(next.key,'after');assert.equal(next.performance.workerReused,true);assert.equal(pool.stats().workers,1);
});

test('Timeout destroys the busy worker and a later request starts cleanly',async t=>{
 const pool=createAnalysisPool({workerFile:fixture,fixedTimeoutMs:500});t.after(()=>pool.close());const r=response();
 await assert.rejects(pool({delay:3000},r),/excedeu/);assert.equal(r.listenerCount('close'),0);assert.equal(pool.stats().workers,0);
 const next=await pool({key:'recovered'});assert.equal(next.key,'recovered');assert.equal(next.performance.workerReused,false);
});

test('Completed HTTP responses do not cancel computation; disconnected clients never start one',async t=>{
 const pool=createAnalysisPool({workerFile:fixture});t.after(()=>pool.close());const r=response();
 r.writableEnded=true;const result=pool({key:'ended',delay:5},r);r.emit('close');assert.equal((await result).key,'ended');
 const disconnected=response();disconnected.destroyed=true;await assert.rejects(pool({},disconnected),/cancelado/);assert.equal(pool.stats().busy,0);
});

test('Worker crashes/exits and clone errors retire broken instances without poisoning pool',async t=>{
 const pool=createAnalysisPool({workerFile:fixture});t.after(()=>pool.close());
 await assert.rejects(pool({exit:true}),/encerrou/);assert.equal(pool.stats().workers,0);
 await assert.rejects(pool({throw:true}),/fixture crash/);assert.equal(pool.stats().workers,0);
 await assert.rejects(pool({invalid:()=>{}}),/clone/i);assert.equal(pool.stats().workers,0);
 assert.equal((await pool({key:'ok'})).key,'ok');
});

test('Input calculation errors keep a healthy worker; exact results never advertise Monte Carlo throughput',async t=>{
 const pool=createAnalysisPool({workerFile:fixture});t.after(()=>pool.close());
 await assert.rejects(pool({messageError:true}),/calculation error/);
 const exact=await pool({exact:true});assert.equal(exact.performance.workerReused,true);assert.equal(exact.performance.monteCarloSamples,null);assert.equal(exact.performance.simulationsPerSecond,null);
 const scenario=await pool({totalSamples:2500});assert.equal(scenario.performance.monteCarloSamples,2500);assert.equal(scenario.performance.simulationsPerSecond,2500000/scenario.performance.requestElapsedMs);
});

test('Explicit close rejects active and future requests and releases every worker',async()=>{
 const pool=createAnalysisPool({workerFile:fixture}),pending=pool({delay:1000}),rejected=assert.rejects(pending,/encerrado/);
 await pool.close();await rejected;assert.deepEqual(pool.stats(),{workers:0,busy:0,closed:true});await assert.rejects(pool({}),/encerrado/);await pool.close();
});

test('An idle persistent pool does not keep a Node process alive',()=>{
 const script=`const pool=require(${JSON.stringify(path.resolve(__dirname,'../src/analysis-worker'))});pool(${JSON.stringify(base)}).then(r=>{if(r.status!=='OK')process.exitCode=1;else process.stdout.write('finished');});`;
 const output=execFileSync(process.execPath,['-e',script],{timeout:5000,encoding:'utf8'});assert.equal(output,'finished');
});

test('Training jobs have a separate deadline and never label tree rollouts as showdown throughput',async t=>{
 const pool=createAnalysisPool({workerFile:fixture,trainingTimeoutMs:500,fixedTimeoutMs:5000});t.after(()=>pool.close());
 await assert.rejects(pool.training({delay:1000}),/excedeu/);
 const result=await pool.training({totalSamples:2500});
 assert.equal(result.performance.measurementScope,'TRAINING_WORKER_REQUEST_WALL_TIME');
 assert.equal(result.performance.monteCarloSamples,null);assert.equal(result.performance.simulationsPerSecond,null);
});
