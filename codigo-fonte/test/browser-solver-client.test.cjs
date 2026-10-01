'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const {create,normalizeComparisonPolicy}=require('../public/browser-solver-client');
const comparison=require('../src/solver/decision-outcome');
const fingerprint='a'.repeat(64),manifest={schemaVersion:1,buildFingerprint:fingerprint,versions:{solver:'SAME_CORE_V1',rules:'SAME_RULES_V1'}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function input(hand='hand-1'){return {multiway:{handId:hand,config:{playerCount:2,heroCards:['As','Kh','Qd','Jc','9s']},events:[],editEpoch:0},ranges:[],sizing:{type:'MIN_MID_MAX',maxAggressions:1},rake:{type:'NONE',basis:'BEFORE_FEES'}};}
function result(refine=true){const actions=[{id:'CHECK',action:'CHECK',size:null,frequency:1,evBB:2}];return {status:'APPROXIMATE',method:'CFR_PLUS',solverVersion:'SAME_CORE_V1',source:'REFERENCE_SUBGAME_STRATEGY',actions,
  abstraction:{rootActions:actions.map(({frequency,evBB,...row})=>row)},convergence:{thresholdMet:false},decisionPrecision:{status:'INCONCLUSIVE',leaderConclusive:false},
  adaptation:{phase:'STOPPED',stopReason:refine?'TIME_RESOURCE_CEILING':'GLOBAL_CONVERGENCE_AND_CERTIFIED_SEPARATION',refinementRecommended:refine}};}
function harness(onSolve,extra={}){const workers=[];
  const client=create({manifest,crypto:webcrypto,createWorker:()=>{
    const worker={terminated:false,postMessage(message){this.solve=message;onSolve?.(worker,message,workers.length);},terminate(){this.terminated=true;},send(message){this.onmessage?.({data:message});}};
    workers.push(worker);queueMicrotask(()=>worker.send({type:'ready',schemaVersion:1,buildFingerprint:fingerprint}));return worker;
  },...extra});return {client,workers};}
function done(worker,message,{workerMs=message.budget.timeMs,iterations=message.budget.iterations,refine=true}={}){worker.send({type:'done',jobId:message.jobId,generation:message.generation,buildFingerprint:fingerprint,
  handId:message.input.multiway.handId,revisionKey:message.expectedRevisionKey,result:result(refine),checkpoint:{workIterations:(message.checkpoint?.workIterations||0)+iterations},workerMs});}
async function finish(client,owner,initial){let current=initial;for(let count=0;count<50 && !['COMPLETE','FAILED','UNSUPPORTED','CANCELLED'].includes(current.phase);count++)current=await client.wait(owner,current.jobId,{afterVersion:current.updateVersion,waitMs:1000});return current;}

test('automatic Browser compute uses the same result schema with one cumulative 3s to 5s continuation',async()=>{
  const {client,workers}=harness((worker,message)=>queueMicrotask(()=>done(worker,message)));
  try{const first=await client.start('owner-1',input(),{handId:'hand-1',revisionKey:'rev-1',budget:'STANDARD',automatic:true});
    const final=await finish(client,'owner-1',first);
    assert.equal(final.phase,'COMPLETE');assert.equal(final.runtime,'BROWSER');assert.equal(final.runtimeLabel,'Browser compute');
    assert.deepEqual(workers.map(worker=>worker.solve.budget),[{timeMs:3000,iterations:1000},{timeMs:2000,iterations:1000}]);
    assert.equal(final.timing.decisionComputeMs,5000);assert.equal(final.runtimeBudget.continuations,1);assert.equal(final.runtimeBudget.ceilingMs,5000);
    assert.equal(final.result.status,'APPROXIMATE');assert.equal(final.result.decisionPrecision.status,'INCONCLUSIVE');assert.ok(workers.every(worker=>worker.terminated));
    const returned=client.get('owner-1',final.jobId);returned.result.actions[0].evBB=999;assert.equal(client.get('owner-1',final.jobId).result.actions[0].evBB,2);
  }finally{client.close();}
});

test('a separated stopped snapshot is reused without an automatic continuation',async()=>{
  const {client,workers}=harness((worker,message)=>queueMicrotask(()=>done(worker,message,{refine:false,workerMs:10,iterations:1})));
  try{const first=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1',automatic:true});await finish(client,'owner',first);
    const warm=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1',automatic:true});
    assert.equal(warm.phase,'COMPLETE');assert.equal(warm.cache.hit,true);assert.equal(workers.length,1);
  }finally{client.close();}
});

test('explicit DEEP retains its 30s cumulative ceiling with worker slices no longer than 5s',async()=>{
  const {client,workers}=harness((worker,message)=>queueMicrotask(()=>done(worker,message,{iterations:100})));
  try{const initial=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1',budget:'DEEP'}),final=await finish(client,'owner',initial);
    assert.equal(final.phase,'COMPLETE');assert.equal(final.timing.decisionComputeMs,30000);assert.equal(final.runtimeBudget.ceilingMs,30000);
    assert.equal(workers.length,6);assert.ok(workers.every(worker=>worker.solve.budget.timeMs===5000));assert.ok(workers.slice(1).every(worker=>worker.solve.checkpoint?.workIterations>0));
  }finally{client.close();}
});

test('memory cache isolates exact hand, revision, owner, ranges, cards, sizes and fee basis',async()=>{
  const {client,workers}=harness((worker,message)=>queueMicrotask(()=>done(worker,message,{refine:false,workerMs:1,iterations:1})));
  try{const original=input();await finish(client,'owner',await client.start('owner',original,{handId:'hand-1',revisionKey:'rev-1'}));
    const warm=await client.start('owner',original,{handId:'hand-1',revisionKey:'rev-1',budget:'FAST'});assert.equal(warm.cache.hit,true);assert.equal(workers.length,1);
    const mutations=[{owner:'another-owner'}, {revisionKey:'rev-2'}, {handId:'hand-2',mutate:value=>{value.multiway.handId='hand-2';}},
      {mutate:value=>{value.rake.basis='NO_FEES';}}, {mutate:value=>{value.ranges=[{seatId:0,combos:[{cards:['2s','3s','4s','5s','6s'],weight:1}]}];}},
      {mutate:value=>{value.multiway.config.heroCards[0]='Ac';}}, {mutate:value=>{value.sizing.maxAggressions=2;}}, {mutate:value=>{value.multiway.editEpoch=1;}}];
    for(const change of mutations){const altered=structuredClone(original);change.mutate?.(altered);const owner=change.owner || 'owner';
      const started=await client.start(owner,altered,{handId:change.handId || 'hand-1',revisionKey:change.revisionKey || 'rev-1',budget:'FAST'});
      assert.equal(started.cache.hit,false);await finish(client,owner,started);}
    assert.throws(()=>client.get('another-owner',warm.jobId),/owner/);client.clearOwner('owner');
    const cold=await client.start('owner',original,{handId:'hand-1',revisionKey:'rev-1',budget:'FAST'});assert.equal(cold.cache.hit,false);await finish(client,'owner',cold);
  }finally{client.close();}
});

test('cancel and owner invalidation terminate immediately and reject delayed stale publication',async()=>{
  const {client,workers}=harness();
  try{const started=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1'});await tick();const worker=workers[0],late=worker.onmessage,message=worker.solve;
    client.cancel('owner',started.jobId);assert.equal(worker.terminated,true);late({data:{type:'done',jobId:message.jobId,generation:message.generation,
      buildFingerprint:fingerprint,handId:'hand-1',revisionKey:'rev-1',result:result(),workerMs:3000}});
    assert.equal(client.get('owner',started.jobId).phase,'CANCELLED');assert.equal(client.get('owner',started.jobId).result,null);
    const next=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1'});await tick();client.cancelOwner('owner');
    assert.equal(workers[1].terminated,true);assert.equal(client.get('owner',next.jobId).phase,'CANCELLED');
    const pending=client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1'});client.clearOwner('owner');await assert.rejects(pending,/superseded/);
  }finally{client.close();}
});

test('build identity and canonical decision binding are checked before accepting worker output',async()=>{
  const {client,workers}=harness((worker,message)=>queueMicrotask(()=>worker.send({type:'progress',jobId:message.jobId,generation:message.generation,
    buildFingerprint:fingerprint,handId:'hand-1',revisionKey:'wrong-revision',result:result(),workerMs:1})));
  try{const started=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1'}),final=await finish(client,'owner',started);
    assert.equal(final.phase,'FAILED');assert.match(final.reason,/does not match/);assert.equal(final.result,null);assert.equal(workers[0].terminated,true);
  }finally{client.close();}
  const wrong=create({manifest,crypto:webcrypto,createWorker:()=>{const worker={terminate(){},postMessage(){}};queueMicrotask(()=>worker.onmessage?.({data:{type:'ready',schemaVersion:1,buildFingerprint:'b'.repeat(64)}}));return worker;}});
  try{const started=await wrong.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1'}),final=await finish(wrong,'owner',started);assert.equal(final.phase,'FAILED');assert.match(final.reason,/build changed/);}finally{wrong.close();}
});

test('a host deadline retains the last coherent result and checkpoint without certifying precision',async()=>{
  let elapsed=0,timerId=0;const timers=new Map();
  const {client,workers}=harness((worker,message)=>queueMicrotask(()=>worker.send({type:'progress',jobId:message.jobId,generation:message.generation,
    buildFingerprint:fingerprint,handId:'hand-1',revisionKey:'rev-1',result:result(),checkpoint:{workIterations:1},workerMs:100})),
    {now:()=>elapsed,setTimeout:(callback,duration)=>{const id=++timerId;timers.set(id,{callback,duration});return id;},clearTimeout:id=>timers.delete(id)});
  try{const started=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1',automatic:false});await tick();
    assert.equal(client.get('owner',started.jobId).phase,'REFINING');elapsed=4000;const watchdog=[...timers.values()].find(timer=>timer.duration===4000);assert.ok(watchdog);watchdog.callback();
    const stopped=client.get('owner',started.jobId);assert.equal(stopped.phase,'COMPLETE');assert.match(stopped.reason,/time limit/);assert.equal(stopped.result.actions[0].evBB,2);
    assert.equal(stopped.result.decisionPrecision.status,'INCONCLUSIVE');assert.equal(workers[0].terminated,true);
    const warm=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1',budget:'FAST'});assert.equal(warm.cache.hit,true);assert.equal(warm.phase,'COMPLETE');
  }finally{client.close();}
});

test('feature detection and injected QA profiles preserve the app defaults',async()=>{
  const unavailable=create({Worker:null,crypto:{},manifest});assert.equal(unavailable.supported,false);await assert.rejects(unavailable.ready(),/unavailable/);unavailable.close();
  const {client,workers}=harness((worker,message)=>queueMicrotask(()=>done(worker,message,{refine:false})),{budgetProfiles:{STANDARD:{timeMs:4000,iterations:20000}}});
  try{const start=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1',automatic:false});await finish(client,'owner',start);assert.equal(workers[0].solve.budget.timeMs,4000);}finally{client.close();}
});

test('a worker crash charges elapsed compute before a same-decision retry',async()=>{
  let elapsed=0;const {client,workers}=harness(null,{now:()=>elapsed});
  try{const first=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1'});await tick();elapsed=2000;workers[0].onerror({message:'Worker crashed.'});
    assert.equal(client.get('owner',first.jobId).phase,'FAILED');assert.equal(client.get('owner',first.jobId).timing.decisionComputeMs,2000);
    const retry=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1'});await tick();assert.equal(workers[1].solve.budget.timeMs,1000);client.cancel('owner',retry.jobId);
  }finally{client.close();}
});

test('a result without its matching checkpoint cannot overwrite a coherent cached pair',async()=>{
  const {client,workers}=harness();
  try{const first=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1'});await tick();const worker=workers[0],message=worker.solve;
    const identity={jobId:message.jobId,generation:message.generation,buildFingerprint:fingerprint,handId:'hand-1',revisionKey:'rev-1'};
    worker.send({...identity,type:'progress',result:result(),checkpoint:{workIterations:1},workerMs:10});
    const incomplete=result();incomplete.actions[0].evBB=999;worker.send({...identity,type:'done',result:incomplete,workerMs:20});
    assert.equal(client.get('owner',first.jobId).result.actions[0].evBB,2);
    const warm=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1',budget:'FAST'});assert.equal(warm.cache.hit,true);assert.equal(warm.result.actions[0].evBB,2);
  }finally{client.close();}
});

test('progress telemetry separates first response, this job, worker slices and cumulative cached costs',async()=>{
  let elapsed=0;const {client,workers}=harness(null,{now:()=>elapsed});
  const costs=(total,action)=>({buildMs:10,globalSolveMs:total-action-10,globalEvaluationMs:0,actionSolveMs:action,actionCertificateMs:action/10,totalComputeMs:total});
  function publish(worker,type,time,runCosts,cumulativeCosts,iterations){
    elapsed=time;const message=worker.solve;
    worker.send({type,jobId:message.jobId,generation:message.generation,buildFingerprint:fingerprint,handId:'hand-1',revisionKey:'rev-1',
      result:{...result(),metrics:{runCosts,costs:cumulativeCosts}},checkpoint:{workIterations:iterations},workerMs:runCosts.totalComputeMs});
  }
  try{
    const initial=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1',automatic:true});await tick();
    assert.equal(client.get('owner',initial.jobId).timing.workerReadyMs,0);
    publish(workers[0],'progress',100,costs(100,60),costs(100,60),1);
    const early=client.get('owner',initial.jobId);assert.equal(early.timing.firstResponseMs,100);assert.equal(early.timing.firstValueMs,100);
    assert.equal(early.phase,'REFINING');assert.equal(early.result.decisionPrecision.status,'INCONCLUSIVE');assert.equal(early.cache.source,'NONE');
    publish(workers[0],'done',3000,costs(3000,2000),costs(3000,2000),1000);await tick();
    publish(workers[1],'progress',3100,costs(100,70),{...costs(3100,2070),buildMs:20,globalSolveMs:1010},1001);
    publish(workers[1],'done',5000,costs(2000,1500),{...costs(5000,3500),buildMs:20,globalSolveMs:1480},2000);
    const final=client.get('owner',initial.jobId);
    assert.equal(final.timing.jobElapsedMs,5000);assert.equal(final.timing.workerMs,5000);assert.equal(final.timing.decisionComputeMs,5000);
    assert.equal(final.timing.firstResponseMs,100);assert.equal(final.timing.firstValueMs,100);assert.equal(final.timing.currentRunCosts.totalComputeMs,2000);
    assert.equal(final.timing.jobCosts.totalComputeMs,5000);assert.equal(final.timing.jobCosts.actionSolveMs,3500);assert.equal(final.timing.jobCosts.buildMs,20);
    assert.equal(final.timing.currentRunCosts.actionCertificateMs,150);assert.equal(final.timing.jobCosts.actionCertificateMs,350);assert.equal(final.timing.cumulativeCosts.actionCertificateMs,350);
    assert.equal(final.timing.cumulativeCosts.totalComputeMs,5000);
    elapsed=7000;const later=client.get('owner',initial.jobId);assert.equal(later.timing.totalMs,7000);assert.equal(later.timing.jobElapsedMs,5000);
    const warm=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1',budget:'FAST'});
    assert.equal(warm.cache.source,'MEMORY');assert.equal(warm.cache.readOnly,true);assert.equal(warm.timing.jobElapsedMs,0);assert.equal(warm.timing.workerMs,0);
    assert.equal(warm.timing.firstValueMs,0);assert.equal(warm.timing.firstResponseMs,null);assert.equal(warm.timing.workerReadyMs,null);
    assert.equal(warm.timing.currentRunCosts,null);assert.equal(warm.timing.jobCosts,null);assert.equal(warm.timing.cumulativeCosts.totalComputeMs,5000);
    assert.deepEqual(warm.cache.originalTiming,{firstValueMs:100,snapshotMs:5000,workerMs:5000});assert.equal(workers.length,2);
    warm.cache.originalTiming.workerMs=999;warm.timing.cumulativeCosts.actionSolveMs=999;
    assert.equal(client.get('owner',warm.jobId).cache.originalTiming.workerMs,5000);assert.equal(client.get('owner',warm.jobId).timing.cumulativeCosts.actionSolveMs,3500);
  }finally{client.close();}
});

test('a worker response without a usable value is measured without claiming first value or accepting invalid costs',async()=>{
  let elapsed=0;const {client,workers}=harness(null,{now:()=>elapsed});
  try{
    const initial=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1'});await tick();elapsed=20;
    const message=workers[0].solve;workers[0].send({type:'done',jobId:message.jobId,generation:message.generation,buildFingerprint:fingerprint,
      handId:'hand-1',revisionKey:'rev-1',result:{status:'NOT_SOLVED',actions:[],metrics:{runCosts:{totalComputeMs:20,actionSolveMs:-1,notTiming:'text',globalSolveMs:Infinity},costs:{totalComputeMs:20}}},workerMs:20});
    const final=client.get('owner',initial.jobId);assert.equal(final.phase,'UNSUPPORTED');assert.equal(final.timing.firstResponseMs,20);assert.equal(final.timing.firstValueMs,null);
    assert.deepEqual(final.timing.jobCosts,{totalComputeMs:20});assert.deepEqual(final.timing.currentRunCosts,{totalComputeMs:20});assert.equal(final.cache.readOnly,false);
  }finally{client.close();}
});

test('a cached refinement measures new work separately from the original cached snapshot',async()=>{
  let elapsed=0;const {client,workers}=harness(null,{now:()=>elapsed});
  function send(worker,workerMs,cumulativeMs,iterations){const message=worker.solve;worker.send({type:'done',jobId:message.jobId,generation:message.generation,
    buildFingerprint:fingerprint,handId:'hand-1',revisionKey:'rev-1',result:{...result(false),metrics:{runCosts:{actionSolveMs:workerMs,totalComputeMs:workerMs},
      costs:{actionSolveMs:cumulativeMs,totalComputeMs:cumulativeMs}}},checkpoint:{workIterations:iterations},workerMs});}
  try{
    const cold=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1'});await tick();elapsed=100;send(workers[0],100,100,1);
    const warm=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1',budget:'DEEP'});await tick();
    assert.equal(warm.cache.hit,true);assert.equal(warm.cache.readOnly,false);assert.equal(warm.timing.firstValueMs,0);
    assert.equal(workers[1].solve.checkpoint.workIterations,1);elapsed=300;send(workers[1],200,300,2);
    const final=client.get('owner',warm.jobId);assert.equal(final.timing.firstValueMs,0);assert.equal(final.timing.firstResponseMs,200);
    assert.equal(final.timing.workerMs,200);assert.equal(final.timing.decisionComputeMs,300);assert.equal(final.timing.jobElapsedMs,200);
    assert.deepEqual(final.timing.currentRunCosts,{actionSolveMs:200,totalComputeMs:200});assert.deepEqual(final.timing.jobCosts,final.timing.currentRunCosts);
    assert.deepEqual(final.timing.cumulativeCosts,{actionSolveMs:300,totalComputeMs:300});assert.equal(final.cache.originalTiming.workerMs,100);
    assert.equal(client.get('owner',cold.jobId).timing.workerMs,100);
  }finally{client.close();}
});

test('delayed stale messages cannot alter cancellation timing or compute costs',async()=>{
  let elapsed=0;const {client,workers}=harness(null,{now:()=>elapsed});
  try{
    const initial=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1'});await tick();const worker=workers[0],late=worker.onmessage,message=worker.solve;
    elapsed=40;const stopped=client.cancel('owner',initial.jobId);elapsed=100;
    late({data:{type:'done',jobId:message.jobId,generation:message.generation,buildFingerprint:fingerprint,handId:'hand-1',revisionKey:'rev-1',
      result:{...result(),metrics:{runCosts:{totalComputeMs:3000,actionSolveMs:2000}}},checkpoint:{workIterations:1000},workerMs:3000}});
    const later=client.get('owner',initial.jobId);assert.equal(later.timing.jobElapsedMs,40);assert.equal(later.timing.workerMs,40);
    assert.equal(later.timing.firstResponseMs,null);assert.equal(later.timing.jobCosts,null);assert.equal(later.result,null);
    assert.equal(later.timing.completionMs,stopped.timing.completionMs);assert.equal(client.stats().staleMessages,1);
  }finally{client.close();}
});

test('comparison policy normalization agrees with the core and rejects explicit invalid thresholds',()=>{
  for(const value of [undefined,{}, {nearEquivalenceBB:0}, {nearEquivalenceBB:-0}, {nearEquivalenceBB:.02}])assert.deepEqual(normalizeComparisonPolicy(value),comparison.normalizePolicy(value));
  for(const nearEquivalenceBB of [null,'0.01',false,-1,NaN,Infinity])assert.throws(()=>normalizeComparisonPolicy({nearEquivalenceBB}));
  for(const value of [null,[],{version:'OTHER'},{unit:'CHIPS'},{scope:'CURRENT_HAND'}])assert.throws(()=>normalizeComparisonPolicy(value));
});

test('the normalized comparison policy isolates the cache without changing returned game identity',async()=>{
  const {client,workers}=harness((worker,message)=>queueMicrotask(()=>done(worker,message,{refine:false,workerMs:1,iterations:1})));
  try{
    const original=input(),first=await client.start('owner',original,{handId:'hand-1',revisionKey:'rev-1'});await finish(client,'owner',first);
    const equivalent={...original,comparisonPolicy:comparison.normalizePolicy({nearEquivalenceBB:.01})};
    const warm=await client.start('owner',equivalent,{handId:'hand-1',revisionKey:'rev-1',budget:'FAST'});assert.equal(warm.cache.hit,true);assert.equal(warm.policyKey,comparison.policyKey());
    const changed=await client.start('owner',{...original,comparisonPolicy:{nearEquivalenceBB:.02}},{handId:'hand-1',revisionKey:'rev-1',budget:'FAST'});
    assert.equal(changed.cache.hit,false);assert.notEqual(changed.policyKey,warm.policyKey);await finish(client,'owner',changed);
    assert.equal(workers.length,2);assert.deepEqual(workers[1].solve.input.comparisonPolicy,comparison.normalizePolicy({nearEquivalenceBB:.02}));
    assert.deepEqual(client.get('owner',changed.jobId).result.actions,client.get('owner',first.jobId).result.actions);
    const originalAgain=await client.start('owner',original,{handId:'hand-1',revisionKey:'rev-1',budget:'FAST'});assert.equal(originalAgain.cache.hit,true);
  }finally{client.close();}
});

test('a changed threshold cancels old work and mismatched policy output cannot publish or cache',async()=>{
  const {client,workers}=harness();
  try{
    const first=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1'});await tick();const old=workers[0],late=old.onmessage,oldMessage=old.solve;
    const second=await client.start('owner',{...input(),comparisonPolicy:{nearEquivalenceBB:.02}},{handId:'hand-1',revisionKey:'rev-1'});await tick();assert.equal(old.terminated,true);
    late({data:{type:'done',jobId:oldMessage.jobId,generation:oldMessage.generation,buildFingerprint:fingerprint,handId:'hand-1',revisionKey:'rev-1',result:result(),workerMs:3000}});
    assert.equal(client.get('owner',second.jobId).result,null);assert.equal(client.get('owner',first.jobId).phase,'CANCELLED');
    const current=workers[1].solve;workers[1].send({type:'done',jobId:current.jobId,generation:current.generation,buildFingerprint:fingerprint,handId:'hand-1',revisionKey:'rev-1',
      result:{...result(),decisionOutcome:{status:'NEAR_EQUIVALENT',policyKey:comparison.policyKey()}},checkpoint:{workIterations:1},workerMs:10});
    const failed=client.get('owner',second.jobId);assert.equal(failed.phase,'FAILED');assert.match(failed.reason,/comparison policy changed/);assert.equal(failed.result,null);
    assert.equal(failed.timing.workerMs,10);assert.equal(client.stats().writes,0);
  }finally{client.close();}
});

test('host time and iteration ceilings finalize only pending outcomes and cache the coherent retained snapshot',async()=>{
  for(const stop of ['WATCHDOG','TIME_BUDGET','ITERATIONS']){
    let elapsed=0,id=0;const timers=new Map(),{client,workers}=harness(null,{now:()=>elapsed,
      setTimeout:(callback,duration)=>{const key=++id;timers.set(key,{callback,duration});return key;},clearTimeout:key=>timers.delete(key)});
    try{
      const first=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1'});await tick();const worker=workers[0],message=worker.solve;
      const identity={jobId:message.jobId,generation:message.generation,buildFingerprint:fingerprint,handId:'hand-1',revisionKey:'rev-1'};
      const pending={...result(),decisionOutcome:{version:comparison.VERSION,status:'ESTIMATING',policy:comparison.normalizePolicy(),policyKey:comparison.policyKey(),
        diagnostics:{category:'TWO_ACTIONS_COMPETITIVE',categories:['TWO_ACTIONS_COMPETITIVE']}}};
      worker.send({...identity,type:'progress',result:pending,checkpoint:{workIterations:stop==='ITERATIONS'?1000:1},workerMs:100});
      let stopped;
      if(stop==='WATCHDOG'){elapsed=4000;[...timers.values()].find(timer=>timer.duration===4000).callback();stopped=client.get('owner',first.jobId);}
      else if(stop==='TIME_BUDGET'){worker.send({...identity,type:'error',code:'TIME_BUDGET',error:'Time budget reached.',workerMs:3000});stopped=client.get('owner',first.jobId);}
      else {client.cancel('owner',first.jobId);stopped=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1'});}
      assert.equal(stopped.phase,'COMPLETE');assert.equal(stopped.result.decisionOutcome.status,'INCONCLUSIVE');assert.equal(stopped.result.decisionPrecision.status,'INCONCLUSIVE');
      assert.deepEqual(stopped.result.actions,pending.actions);assert.equal(stopped.result.decisionOutcome.diagnostics.category,stop==='ITERATIONS'?'TWO_ACTIONS_COMPETITIVE':'TIME_BUDGET_EXHAUSTED');
      assert.equal(stopped.result.decisionOutcome.diagnostics.iterationBudgetExhausted,stop==='ITERATIONS');assert.ok(!stopped.result.decisionOutcome.diagnostics.categories.includes('ITERATION_BUDGET_EXHAUSTED'));
      const warm=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1',budget:'FAST'});assert.equal(warm.cache.hit,true);assert.deepEqual(warm.result,stopped.result);
    }finally{client.close();}
  }
});

test('host watchdog retains certified and near-equivalent proof metadata without promotion or demotion',async()=>{
  for(const status of ['CERTIFIED','NEAR_EQUIVALENT']){
    let elapsed=0,id=0;const timers=new Map(),{client,workers}=harness(null,{now:()=>elapsed,
      setTimeout:(callback,duration)=>{const key=++id;timers.set(key,{callback,duration});return key;},clearTimeout:key=>timers.delete(key)});
    try{
      const first=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1'});await tick();const worker=workers[0],message=worker.solve;
      const retained={...result(),decisionOutcome:{version:comparison.VERSION,status,policy:comparison.normalizePolicy(),policyKey:comparison.policyKey(),
        globalConverged:true,nearGroupActionIds:status==='NEAR_EQUIVALENT'?['CHECK','BET']:[],robustWorstDifferenceBB:.005,diagnostics:{category:'UNKNOWN',categories:['UNKNOWN']}}};
      worker.send({type:'progress',jobId:message.jobId,generation:message.generation,buildFingerprint:fingerprint,handId:'hand-1',revisionKey:'rev-1',
        result:retained,checkpoint:{workIterations:1},workerMs:100});
      elapsed=4000;[...timers.values()].find(timer=>timer.duration===4000).callback();const stopped=client.get('owner',first.jobId);
      assert.equal(stopped.phase,'COMPLETE');assert.deepEqual(stopped.result,retained);assert.equal(worker.terminated,true);
      const warm=await client.start('owner',input(),{handId:'hand-1',revisionKey:'rev-1',budget:'FAST'});assert.equal(warm.cache.hit,true);assert.deepEqual(warm.result,retained);
    }finally{client.close();}
  }
});
