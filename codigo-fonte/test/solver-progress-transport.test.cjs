'use strict';
// HARNESS: protocol/lifecycle tests, not solver speed or mathematical evidence.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {setTimeout:delay}=require('node:timers/promises');
const {createSolverService}=require('../src/solver/job-service');
const {riverMixedInput}=require('./helpers/solver-reference-fixtures.cjs');

async function fixture(t,{unfinished=false}={}){
  const parent=path.resolve(os.tmpdir()),dir=await fs.mkdtemp(path.join(parent,'theibs-progress-'));
  const workerFile=path.join(dir,'worker.cjs');
  await fs.writeFile(workerFile,`
    const {parentPort}=require('node:worker_threads');
    parentPort.on('message',({checkpoint})=>{
      const iterations=(checkpoint?.iterations||0)+1;
      const result={status:'APPROXIMATE',actions:[{id:'CHECK',evBB:2,frequency:1}],iterations,
        adaptation:{phase:'STOPPED',stopReason:'${unfinished?'TIME_RESOURCE_CEILING':'GLOBAL_CONVERGENCE_AND_CERTIFIED_SEPARATION'}',refinementRecommended:${unfinished}}};
      parentPort.postMessage({type:'progress',result:{...result,adaptation:{phase:'REFINING',refinementRecommended:true}},checkpoint:{iterations},workerMs:1});
      setTimeout(()=>parentPort.postMessage({type:'done',result,checkpoint:{iterations},workerMs:35}),35);
    });
  `);
  const service=createSolverService({workerFile}),input=riverMixedInput();
  t.after(async()=>{await service.close();assert.equal(path.dirname(path.resolve(dir)),parent);assert.ok(path.basename(dir).startsWith('theibs-progress-'));await fs.rm(dir,{recursive:true,force:true});});
  return {service,input,options:{budget:'STANDARD',automatic:true,handId:input.multiway.handId,revisionKey:'revision'}};
}
async function terminal(service,job){
  for(let i=0;i<20;i++){
    if(['COMPLETE','UNSUPPORTED','CANCELLED','FAILED'].includes(job.phase))return job;
    job=await service.wait('owner',job.jobId,{afterVersion:job.updateVersion,waitMs:500});
  }
  assert.fail('job did not complete');
}

test('automatic STANDARD reuses a stopped compatible result; explicit refinement still computes',async t=>{
  const {service,input,options}=await fixture(t);
  const cold=await terminal(service,await service.start('owner',input,options));
  assert.equal(cold.phase,'COMPLETE');assert.equal(cold.result.iterations,1);assert.equal(cold.cache.hit,false);
  const warm=await service.start('owner',input,options);
  assert.equal(warm.phase,'COMPLETE');assert.equal(warm.cache.hit,true);assert.equal(warm.timing.workerMs,0);
  assert.deepEqual(warm.result,cold.result);assert.equal(service.stats().completed,1);
  const explicit=await terminal(service,await service.start('owner',input,{...options,automatic:false}));
  assert.equal(explicit.result.iterations,2);assert.equal(service.stats().completed,2);
});

test('automatic cache reuse does not stop an unfinished certificate or strategy',async t=>{
  const {service,input,options}=await fixture(t,{unfinished:true});
  const cold=await terminal(service,await service.start('owner',input,options));
  const again=await service.start('owner',input,options);
  assert.equal(again.cache.hit,true);assert.notEqual(again.phase,'COMPLETE');
  assert.equal(again.result.iterations,cold.result.iterations);
  const refined=await terminal(service,again);assert.equal(refined.result.iterations,2);
});

test('bounded status wait wakes for new progress and terminal state, with immutable views',async t=>{
  const {service,input,options}=await fixture(t),release=service.prioritize();
  const queued=await service.start('owner',input,options);assert.equal(queued.phase,'QUEUED');
  const waiting=service.wait('owner',queued.jobId,{afterVersion:queued.updateVersion});
  release();const building=await waiting;assert.ok(building.updateVersion>queued.updateVersion);
  let next=building;
  while(!next.result)next=await service.wait('owner',queued.jobId,{afterVersion:next.updateVersion});
  assert.ok(next.timing.firstValueMs>=0);assert.equal(next.result.actions[0].evBB,2);
  next.result.actions[0].evBB=999;
  const done=await terminal(service,next);assert.equal(done.result.actions[0].evBB,2);
  const immediate=await service.wait('owner',done.jobId,{afterVersion:done.updateVersion});
  assert.equal(immediate.phase,'COMPLETE');assert.equal(immediate.timing.completionMs,done.timing.completionMs);
});

test('status waits isolate owners, bound resources, time out, and detach on HTTP abort',async t=>{
  const {service,input,options}=await fixture(t),release=service.prioritize();
  t.after(release);
  const job=await service.start('owner',input,options),opts={afterVersion:job.updateVersion,waitMs:20};
  await assert.rejects(service.wait('stranger',job.jobId,opts),{statusCode:404});
  await assert.rejects(service.wait('owner',job.jobId,{afterVersion:NaN}),/valid solver update/);
  const timed=await service.wait('owner',job.jobId,opts);assert.equal(timed.updateVersion,job.updateVersion);
  assert.equal(service.stats().statusWaitTimeouts,1);
  const controller=new AbortController();
  const aborted=service.wait('owner',job.jobId,{...opts,waitMs:1000,signal:controller.signal});
  controller.abort();await assert.rejects(aborted,{name:'AbortError'});
  const pending=Array.from({length:8},()=>service.wait('owner',job.jobId,{...opts,waitMs:1000}));
  await assert.rejects(service.wait('owner',job.jobId,{...opts,waitMs:1000}),{statusCode:429});
  service.cancel('owner',job.jobId);
  const cancelled=await Promise.all(pending);assert.ok(cancelled.every(x=>x.phase==='CANCELLED'));
  assert.ok(cancelled.every(x=>x.reason==='Cancelled by the user.'));
});

test('supersession wakes obsolete waits and never substitutes the new hand result',async t=>{
  const {service,input,options}=await fixture(t),release=service.prioritize();t.after(release);
  const first=await service.start('owner',input,options);
  const waiter=service.wait('owner',first.jobId,{afterVersion:first.updateVersion});
  const newer=await service.start('owner',input,{...options,revisionKey:'newer'});
  const old=await waiter;assert.equal(old.phase,'CANCELLED');assert.equal(old.revisionKey,'revision');
  assert.equal(old.result,null);assert.equal(newer.revisionKey,'newer');
});

test('expanded world ceiling is exclusive to two original seats and does not raise other resource caps',async t=>{
  const {service,input,options}=await fixture(t),release=service.prioritize();t.after(release);
  const hu=await service.start('owner',input,options);assert.equal(hu.limits.maxWorlds,require('../src/solver/plo-river-game').HU_SUPPORT.maxWorlds);
  assert.equal(hu.limits.maxBuildMs,750);assert.equal(hu.limits.maxMemoryBytes,48*1024*1024);
  hu.limits.maxNodes=1;
  const reread=service.get('owner',hu.jobId);assert.equal(reread.limits.maxNodes,12000);
  reread.limits.maxWorlds=1;
  assert.equal(service.get('owner',hu.jobId).limits.maxWorlds,require('../src/solver/plo-river-game').HU_SUPPORT.maxWorlds);
  const three=structuredClone(input);three.multiway.config.playerCount=3;
  const unchanged=await service.start('owner',three,{...options,revisionKey:'three'});
  assert.equal(unchanged.limits.maxWorlds,27);assert.equal(unchanged.limits.maxNodes,12000);
});
