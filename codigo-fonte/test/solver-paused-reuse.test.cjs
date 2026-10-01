'use strict';
// Lifecycle/cache HARNESS except the first test, which interrupts the real
// river adapter and solver after their first complete strategy snapshot.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {setTimeout:delay}=require('node:timers/promises');
const {execute}=require('../src/solver/job-worker');
const {createSolverService}=require('../src/solver/job-service');
const {createSolutionCache,keyFor}=require('../src/solver/solution-cache');
const {coverage}=require('../src/solver/plo-river-game');
const {normalizePolicy}=require('../src/solver/decision-outcome');
const {riverMixedInput}=require('./helpers/solver-reference-fixtures.cjs');

const COMPLETE_STOP='GLOBAL_CONVERGENCE_AND_CERTIFIED_SEPARATION';
const PAUSE_STOP='FOREGROUND_PRIORITY_PAUSE';

test('a real interrupted strategy remains partial and recommends refinement until its certificates are complete',()=>{
  let paused=false;
  const input=riverMixedInput();
  const first=execute({input,budget:{timeMs:3000,iterations:1000},shouldCancel:()=>paused,onProgress:()=>{paused=true;}});
  assert.equal(first.paused,true);
  assert.equal(first.result.adaptation.phase,'PAUSED');
  assert.equal(first.result.adaptation.stopReason,PAUSE_STOP);
  assert.equal(first.result.adaptation.refinementRecommended,true);
  assert.ok(first.result.actions.every(action=>Number.isFinite(action.evBB)));
  assert.ok(first.result.actionPrecision.actions.some(action=>!action.certified));
  assert.ok(first.result.actionPrecision.actions.filter(action=>!action.certified).every(action=>action.lowerBB===null&&action.upperBB===null));
  const resumed=execute({input,checkpoint:first.checkpoint,budget:{timeMs:3000,iterations:1000}});
  assert.equal(resumed.paused,false);
  assert.equal(resumed.result.adaptation.phase,'STOPPED');
  assert.equal(resumed.result.adaptation.refinementRecommended,false);
  assert.equal(resumed.result.adaptation.stopReason,COMPLETE_STOP);
  assert.ok(resumed.result.actionPrecision.actions.every(action=>action.certified));
  assert.ok(resumed.checkpoint.workIterations>first.checkpoint.workIterations);
  assert.equal(resumed.result.gameHash,first.result.gameHash);
});

async function fixture(t){
  const parent=path.resolve(os.tmpdir()),directory=await fs.mkdtemp(path.join(parent,'theibs-paused-cache-'));
  const workerFile=path.join(directory,'worker.cjs'),cacheDirectory=path.join(directory,'cache');
  await fs.writeFile(workerFile,`
    const {parentPort}=require('node:worker_threads');
    parentPort.on('message',({checkpoint,cancel})=>{
      const flag=new Int32Array(cancel),iterations=(checkpoint?.iterations||0)+1;
      const result={status:'APPROXIMATE',actions:[{id:'CHECK',evBB:2,frequency:1}],iterations,
        actionPrecision:{actions:[{id:'CHECK',certified:iterations>1,lowerBB:iterations>1?2:null,upperBB:iterations>1?2:null}]}};
      const saved={iterations};
      if(iterations>1){parentPort.postMessage({type:'done',checkpoint:saved,workerMs:2,result:{...result,
        adaptation:{phase:'STOPPED',stopReason:'${COMPLETE_STOP}',refinementRecommended:false}}});return;}
      parentPort.postMessage({type:'progress',checkpoint:saved,workerMs:1,result:{...result,
        adaptation:{phase:'REFINING',stopReason:null,refinementRecommended:true}}});
      const timer=setInterval(()=>{
        if(!Atomics.load(flag,0))return;
        clearInterval(timer);parentPort.postMessage({type:'done',paused:true,checkpoint:saved,workerMs:2,result:{...result,
          adaptation:{phase:'PAUSED',stopReason:'${PAUSE_STOP}',refinementRecommended:true}}});
      },5);
    });
  `);
  t.after(async()=>{assert.equal(path.dirname(path.resolve(directory)),parent);assert.ok(path.basename(directory).startsWith('theibs-paused-cache-'));await fs.rm(directory,{recursive:true,force:true});});
  const input=riverMixedInput(),covered=coverage(input);
  assert.equal(covered.status,'READY');
  return {workerFile,cacheDirectory,input,key:keyFor({game:covered.key,heroInformationSet:covered.heroInformationSet,comparisonPolicy:normalizePolicy(input.comparisonPolicy)}),
    options:{budget:'STANDARD',automatic:true,handId:input.multiway.handId,revisionKey:'revision'}};
}
async function until(service,id,predicate){
  for(let count=0;count<200;count++){
    const value=service.get('owner',id);if(predicate(value))return value;await delay(5);
  }
  assert.fail('Expected solver lifecycle state was not reached.');
}

test('pause to persisted cache to automatic continuation retains the partial snapshot and exact final reuse',async t=>{
  const f=await fixture(t),service=createSolverService(f);let release;
  try{
    const first=await service.start('owner',f.input,f.options);
    await until(service,first.jobId,x=>x.phase==='REFINING');
    release=service.prioritize();
    const paused=await until(service,first.jobId,x=>x.phase==='QUEUED');
    assert.equal(paused.result.adaptation.phase,'PAUSED');
    assert.equal(paused.result.adaptation.refinementRecommended,true);
    assert.equal(paused.result.actionPrecision.actions[0].certified,false);
    assert.equal(paused.timing.completionMs,null);
    const disk=await createSolutionCache({directory:f.cacheDirectory}).get('owner',f.key);
    assert.equal(disk.result.adaptation.phase,'PAUSED');
    const next=await service.start('owner',f.input,{...f.options,revisionKey:'revisited'});
    assert.equal(next.cache.hit,true);assert.equal(next.phase,'QUEUED');
    assert.equal(next.result.adaptation.phase,'PAUSED');
    assert.deepEqual(next.result,paused.result);
    assert.equal(service.get('owner',first.jobId).phase,'CANCELLED');
    release();release=null;
    const done=await until(service,next.jobId,x=>x.phase==='COMPLETE');
    assert.equal(done.result.iterations,2);assert.equal(done.result.actionPrecision.actions[0].certified,true);
    assert.equal(done.result.adaptation.refinementRecommended,false);
    const warm=await service.start('owner',f.input,{...f.options,revisionKey:'revisited'});
    assert.equal(warm.phase,'COMPLETE');assert.equal(warm.timing.workerMs,0);
    assert.deepEqual(warm.result,done.result);assert.equal(service.stats().completed,1);
  }finally{await service.close();release?.();}
});

test('disk snapshots incorrectly marked stopped and final never bypass continuation after interruption',async t=>{
  const f=await fixture(t);
  for(const stopReason of [PAUSE_STOP,'TIME_RESOURCE_CEILING','UNKNOWN_STOP',null]){
    const result={status:'APPROXIMATE',actions:[{id:'CHECK',evBB:2,frequency:1}],iterations:5,
      adaptation:{phase:'STOPPED',stopReason,refinementRecommended:false}};
    await createSolutionCache({directory:f.cacheDirectory}).put('owner',f.key,result,{iterations:5});
    const service=createSolverService(f),release=service.prioritize();
    try{
      const job=await service.start('owner',f.input,f.options);
      assert.equal(job.cache.diskHits,1);assert.equal(job.cache.hit,true);
      assert.equal(job.phase,'QUEUED',`Interrupted or unknown stop must not be reused as final: ${stopReason}`);
      assert.deepEqual(job.result,result,'the last valid numeric snapshot remains visible');
      release();
      const done=await until(service,job.jobId,x=>x.phase==='COMPLETE');
      assert.equal(done.result.iterations,6);
    }finally{await service.close();release();}
  }
});

test('only known mathematical terminal stops retain automatic final cache reuse',async t=>{
  const f=await fixture(t);
  for(const stopReason of [COMPLETE_STOP,'GLOBAL_CONVERGENCE_AND_CERTIFIED_NEAR_EQUIVALENCE','FIXED_CONTINUATIONS_FULLY_EVALUATED','GLOBAL_CONVERGENCE_ACTION_CERTIFICATES_NOT_COVERED']){
    const result={status:'APPROXIMATE',actions:[{id:'CHECK',evBB:2,frequency:1}],iterations:5,
      adaptation:{phase:'STOPPED',stopReason,refinementRecommended:false}};
    await createSolutionCache({directory:f.cacheDirectory}).put('owner',f.key,result,{iterations:5});
    const service=createSolverService(f);
    try{
      const job=await service.start('owner',f.input,f.options);
      assert.equal(job.phase,'COMPLETE');assert.equal(job.timing.workerMs,0);assert.equal(job.cache.diskHits,1);
      assert.deepEqual(job.result,result);assert.equal(service.stats().completed,0);
    }finally{await service.close();}
  }
});
