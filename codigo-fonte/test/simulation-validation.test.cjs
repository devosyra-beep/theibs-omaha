'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
const validation=require('../src/simulation-validation'), math=require('../src/multiway-evaluator')._testing;
const {generate,normalize}=require('../scripts/build-simulation-validation.cjs');
const clientSource=fs.readFileSync(require.resolve('../public/simulation-validation'),'utf8');
const api=require('../public/simulation-validation');
const options={worlds:32,budgetMs:30000,seed:'independent-validation-123'};
function payload({count=5,players=2,stacks}={}){
  const config={variant:`PLO${count}_HIGH`,playerCount:players,heroPosition:players===2?'SB':'BB',startingStack:20,smallBlind:.5,bigBlind:1,
    heroCards:['As','Ah','Kd','Qc','Jd','Tc'].slice(0,count),...(stacks?{stacks}:{})};
  const act=(actor,action,to)=>({type:'ACT',actor,action,...(to==null?{}:{to})});
  const events=players===2?[act(0,'CALL'),act(1,'CHECK')]:[act(2,'CALL'),act(0,'CALL'),act(1,'CHECK')];
  const board=['2s','3h','4d','8c','9s'];
  for(const n of [3,4,5]){events.push({type:'BOARD',cards:board.slice(0,n)});if(n<5)events.push(...(players===2?[act(1,'CHECK'),act(0,'CHECK')]:[act(0,'CHECK'),act(1,'CHECK'),act(2,'CHECK')]));}
  events.push(act(players===2?1:0,'BET',1));
  return {multiway:{schemaVersion:1,enabled:true,handId:'90000000-0000-4000-8000-000000000001',editEpoch:0,config,events},multiwayEvaluation:{assumeNoRake:true}};
}
function recordFor(index=1){const record=payload().multiway;record.handId=`90000000-0000-4000-8000-${String(index).padStart(12,'0')}`;return record;}
async function settlePromises(){for(let index=0;index<12;index++)await Promise.resolve();}
function harness({storage=new Map(),build='build-1'}={}){
  const workers=[],timers=new Map();let timerId=0,buildId=build;
  class Worker{
    constructor(url){this.url=url;workers.push(this);}
    terminate(){this.terminated=true;}
    postMessage(message){this.message=message;}
    emit(message){this.onmessage({data:{buildFingerprint:buildId,...message}});}
    ready(){this.emit({type:'ready'});}
    checkpoint(value,extra={}){this.emit({type:'checkpoint',jobId:this.message.jobId,generation:this.message.generation,requestId:this.message.requestId,contextFingerprint:value.fingerprint,batch:value,...extra});}
  }
  const root={Worker,fetch:async()=>({ok:true,json:async()=>({buildFingerprint:buildId})}),crypto:crypto.webcrypto,AbortController,performance:{now:()=>5},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(clientSource,{...root,globalThis:root});const runner=root.TheibsSimulationValidation.create();
  return {runner,workers,storage,timers,setBuild:value=>{buildId=value;},async next(){
    const pending=[...timers.entries()].find(([,value])=>value.ms===150);assert.ok(pending,'Scheduled idle work is pending');
    timers.delete(pending[0]);pending[1].fn();await settlePromises();
  }};
}
function checkpoint(message,count=4,status='RUNNING'){
  const ctx=validation._testing.context(message.payload,message.options);
  const value={schema:validation.VERSION,model:validation.MODEL,mathematicalStatus:'HEURISTIC',source:'SIMULATION_ONLY',
    fingerprint:ctx.fingerprint,publicInput:ctx.input,editEpoch:ctx.editEpoch,seed:ctx.seed,requestedWorlds:ctx.worlds,budgetMs:ctx.budgetMs,
    computeMs:status==='PARTIAL_BUDGET'?ctx.budgetMs:count,predictionMs:0,
    prediction:{samples:0,candidates:ctx.candidates.map(row=>({...row,status:'NOT_MODELED',ev:null})),precision:null},
    count,sumWeight:count,sumWeightSquared:count,sums:ctx.candidates.map(()=>0),status,checkpoints:[],lastLeader:null,leaderChanges:0};
  value.summary=validation._testing.result(ctx,value);return value;
}
test('all action branches agree with the authoritative ledger and fast showdown for independent worlds, variants and side pots',()=>{
  for(const count of [4,5,6])for(const players of [2,3]){
    const input=payload({count,players,stacks:players===3?[3,20,5]:undefined}),ctx=validation._testing.context(input,options),official=math.normalize(ctx.input);
    const response=state=>({action:state.legal.actions.includes('CALL')?'CALL':'CHECK'});
    for(let i=0;i<3;i++){
      const world=validation._testing.draw(ctx,i),parsed=Object.fromEntries(Object.entries(world.hands).map(([id,cards])=>[id,require('../src/cards').normalizeCards(cards)]));
      const scores=math.scoresFor({...world,parsed});
      const flat=[...Object.values(world.hands).flat(),...world.board];assert.equal(new Set(flat).size,flat.length);
      for(const action of ctx.candidates){const independent=validation._testing.simulate(ctx,action,world,i,response),expected=math.rollout(official,action,{...world,parsed,seed:123},scores,response);assert.equal(independent,expected,`${count}/${players}/${action.optionId}`);}
    }
  }
});
test('exact tie settlement measures incremental utility without charging past contributions twice',()=>{
  const input=payload({count:4});input.multiway.config.heroCards=['As','Kd','4c','5c'];
  for(const event of input.multiway.events)if(event.type==='BOARD')event.cards=['Qs','Jh','Tc','9d','2h'].slice(0,event.cards.length);
  const ctx=validation._testing.context(input,options),world={hands:{0:ctx.config.heroCards,1:['Ah','Kc','6c','7c']},board:['Qs','Jh','Tc','9d','2h']};
  const call=ctx.candidates.find(row=>row.action==='CALL');assert.equal(validation._testing.simulate(ctx,call,world,0),1);
  assert.equal(validation._testing.simulate(ctx,ctx.candidates[0],world,0),0);
});
test('checkpoint resume repeats exactly the same held-out samples, excludes incomplete worlds and retains missing forecasts',()=>{
  const input=payload(),batch=validation.begin(input,options),copy=structuredClone(batch);
  validation.step(batch,2,10000);assert.equal(batch.count,2);assert.equal(batch.sums.length,batch.prediction.candidates.length);
  validation.step(batch,2,10000);validation.step(copy,4,10000);
  assert.deepEqual(batch.sums,copy.sums);assert.equal(batch.sumWeight,copy.sumWeight);
  const unknown=structuredClone(copy);unknown.prediction.candidates[1].status='NOT_MODELED';unknown.prediction.candidates[1].ev=null;
  const ctx=validation._testing.context(input,options),summary=validation._testing.result(ctx,unknown);
  assert.equal(summary.rows[1].estimateBB,null);assert.equal(summary.rows[1].differenceBB,null);
  assert.equal(summary.rows[1].comparison,'UNAVAILABLE');assert.equal(summary.leaderCertified,false);
  assert.deepEqual(summary.rows.find(row=>row.action==='FOLD').boundsBB,[0,0]);
  const partial=structuredClone(batch);partial.computeMs=partial.budgetMs;validation.step(partial);assert.equal(partial.status,'PARTIAL_BUDGET');assert.equal(partial.count,batch.count);
});
test('the validation reference rejects incompatible fees, ranges, profiles and changed checkpoint identity',()=>{
  for(const addition of [{rake:1},{rakeSchedule:{}},{ranges:[{}]},{profileSnapshot:{}}])assert.throws(()=>validation.begin({...payload(),multiwayEvaluation:{assumeNoRake:true,...addition}},options),/supports Simulation/);
  const batch=validation.begin(payload(),options);batch.publicInput.multiwayEvaluation.config.startingStack=21;assert.throws(()=>validation.step(batch),/changed/);
  const free=payload();free.multiway.events.at(-1).action='CHECK';delete free.multiway.events.at(-1).to;const ctx=validation._testing.context(free,options);assert.equal(ctx.candidates.some(row=>row.action==='FOLD'),false);
});
test('public batch capture strips hidden cards, future runouts, seeds, notes and private identity data',()=>{
  const record=payload().multiway;Object.assign(record,{audit:{seed:'secret'},shownHands:{1:['Ks']},runout:['Ac'],token:'private'});
  record.config.players=[{playerId:'seat-0',name:'Private name',notes:'not public'}];
  const value=api.publicInput(record);assert.doesNotMatch(JSON.stringify(value),/secret|Private name|not public|shownHands|runout|token/);
  const selected=api.contexts([{record,label:'first'},{record,label:'duplicate'},{record,replayed:true}]);assert.equal(selected.length,1);
  record.config.heroCards[0]='2c';assert.equal(selected[0].payload.multiway.config.heroCards[0],'As','capture is frozen');
});
test('batch error diagnostics exclude exact folds and absent forecasts without implying policy accuracy',()=>{
  const value=api.metrics({contexts:[{result:{computeMs:100,summary:{rows:[{action:'FOLD',differenceBB:0},{action:'CALL',differenceBB:3},{action:'RAISE',differenceBB:-4},{action:'BET',differenceBB:null}]}}}]});
  assert.equal(value.comparedActions,2);assert.equal(value.meanAbsoluteDifferenceBB,3.5);assert.equal(value.rmseBB,Math.sqrt(12.5));assert.equal(api.metrics(null).rmseBB,null);
});
test('the generated browser validation graph matches Node checkpoints and is current',()=>{
  const built=generate();assert.equal(normalize(fs.readFileSync(require.resolve('../public/simulation-validation-worker.js'),'utf8')),built.source);
  const scope=vm.createContext({TextEncoder,TextDecoder,structuredClone,performance:{now:()=>0},crypto:crypto.webcrypto});vm.runInContext(built.source,scope);
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'performance');Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>0}});
  try{const a=validation.begin(payload(),options),b=scope.TheibsBatchValidation.begin(payload(),options);validation.step(a,2);scope.TheibsBatchValidation.step(b,2);assert.deepEqual(JSON.parse(JSON.stringify(b)),JSON.parse(JSON.stringify(a)));}
  finally{Object.defineProperty(globalThis,'performance',descriptor);}
});
test('foreground pause terminates the worker, ignores late messages and resumes only committed checkpoints with owner isolation',async()=>{
  const env=harness(),{runner,workers}=env;runner.load('owner-a');runner.setAvailable(true);runner.start([{record:payload().multiway}],{worlds:32});
  await settlePromises();workers[0].ready();const committed=checkpoint(workers[0].message);workers[0].checkpoint(committed);
  runner.setAvailable(false);assert.equal(workers[0].terminated,true);assert.equal(runner.state.status,'PAUSED');
  workers[0].checkpoint({...committed,status:'COMPLETE',count:32});assert.equal(runner.state.contexts[0].result.count,4);
  runner.resume();assert.equal(workers.length,1);runner.setAvailable(true);await env.next();assert.equal(workers.length,1,'Manual batches require explicit Resume after a foreground pause');
  runner.resume();await settlePromises();workers[1].ready();assert.equal(workers[1].message.type,'resume');assert.equal(workers[1].message.batch.count,4);
  assert.equal(workers[1].message.options.seed,committed.seed);assert.deepEqual(JSON.parse(JSON.stringify(workers[1].message.payload)),api.publicInput(payload().multiway));
  runner.clearOwner();assert.equal(workers[1].terminated,true);runner.load('owner-b');assert.equal(runner.state,null);runner.load('owner-a');assert.equal(runner.state.status,'PAUSED');assert.equal(runner.state.contexts[0].result.count,4);
});

test('automatic capture freezes public decision plus sizing, excludes replay, bounds FIFO queue and exposes skips',async()=>{
  const env=harness(),{runner,workers}=env;runner.load('owner-a');assert.equal(runner.automatic,true);
  const record=recordFor(1);Object.assign(record,{audit:{seed:'hidden'},runout:['Ac'],shownHands:{1:['Ks']}});
  assert.equal(runner.enqueue([{record,chosenSize:2.5,label:'Original frozen decision'}]).added,1);
  record.config.startingStack=99;record.audit.seed='changed';
  assert.equal(runner.enqueue([{record:recordFor(1),chosenSize:2.5}]).deduplicated,1);
  assert.equal(runner.enqueue([{record:recordFor(1),chosenSize:2.51}]).added,1,'Distinct custom sizing has a distinct action grid');
  assert.equal(runner.hasDecision(recordFor(1),2.5),true);assert.equal(runner.hasDecision(recordFor(1),2.52),false);
  assert.equal(runner.enqueue([{record:recordFor(2),replayed:true}]).ineligible,1);
  const outcome=runner.enqueue([2,3,4,5,6].map(index=>({record:recordFor(index)})));
  assert.equal(outcome.added,3);assert.equal(outcome.dropped,2);assert.equal(runner.diagnostics.queued,5);assert.equal(runner.diagnostics.dropped,2);
  assert.equal(workers.length,0,'Foreground availability gates all worker launches');
  runner.setAvailable(true);await env.next();workers[0].ready();
  assert.equal(workers[0].message.options.worlds,512);assert.equal(workers[0].message.options.budgetMs,30000);
  assert.equal(workers[0].message.payload.multiway.config.startingStack,20);
  assert.equal(workers[0].message.payload.multiwayEvaluation.chosenSize,2.5);
  assert.doesNotMatch(JSON.stringify(workers[0].message.payload),/hidden|changed|shownHands|runout/);
});

test('automatic foreground pauses resume the same seed and checkpoint, while manual pause stays durable',async()=>{
  const env=harness(),{runner,workers}=env;runner.load('owner-a');runner.enqueue([{record:recordFor(1)}]);runner.setAvailable(true);await env.next();workers[0].ready();
  const first=workers[0].message,value=checkpoint(first);workers[0].checkpoint(value);
  runner.setAvailable(false,'Paused while this page is hidden.');assert.equal(runner.state.pauseKind,'FOREGROUND');assert.equal(workers[0].terminated,true);
  workers[0].checkpoint({...value,count:512,status:'COMPLETE'});assert.equal(runner.state.contexts[0].result.count,4);
  runner.setAvailable(true);await env.next();workers[1].ready();assert.equal(workers[1].message.type,'resume');
  assert.equal(workers[1].message.options.seed,first.options.seed);assert.equal(workers[1].message.batch.count,4);
  runner.pause();assert.equal(runner.diagnostics.manualPaused,true);runner.setAvailable(false);runner.setAvailable(true);runner.setAutomatic(false);runner.setAutomatic(true);
  assert.equal([...env.timers.values()].some(value=>value.ms===150),false,'Availability and preference changes cannot release manual pause');
  runner.clearOwner();runner.load('owner-a');assert.equal(runner.diagnostics.manualPaused,true);runner.setAvailable(true);assert.equal(workers.length,2);
  runner.resume();await settlePromises();workers[2].ready();assert.equal(workers[2].message.options.seed,first.options.seed);
});

test('automatic preferences, pending work and committed checkpoints restore per owner without hidden inputs',async()=>{
  const env=harness(),{runner,workers}=env;runner.load('owner-a');runner.enqueue([{record:recordFor(1)},{record:recordFor(2)}]);runner.setAvailable(true);await env.next();workers[0].ready();
  workers[0].checkpoint(checkpoint(workers[0].message));const seed=workers[0].message.options.seed;
  runner.clearOwner();runner.load('owner-b');assert.equal(runner.diagnostics.queued,0);runner.setAutomatic(false);
  runner.load('owner-a');assert.equal(runner.automatic,true);assert.equal(runner.state.status,'PAUSED');assert.equal(runner.diagnostics.queued,1);
  runner.setAvailable(true);await env.next();workers[1].ready();assert.equal(workers[1].message.type,'resume');assert.equal(workers[1].message.options.seed,seed);
  runner.load('owner-b');assert.equal(runner.automatic,false);runner.enqueue([{record:recordFor(3)}]);assert.equal(runner.diagnostics.queued,0);
});

test('manual batch errors and Stop remain durable while queued automatic decisions wait',async()=>{
  const env=harness(),{runner,workers}=env;runner.load('owner-a');runner.enqueue([{record:recordFor(2)}]);runner.setAvailable(true);
  runner.start([{record:recordFor(1)}],{worlds:32});await settlePromises();workers[0].ready();
  workers[0].emit({type:'error',jobId:workers[0].message.jobId,generation:workers[0].message.generation,requestId:workers[0].message.requestId,error:'Manual batch error.'});
  runner.setAvailable(false);runner.setAvailable(true);await env.next();assert.equal(workers.length,1);assert.equal(runner.state.status,'ERROR');assert.equal(runner.diagnostics.queued,1);
  runner.resume();await settlePromises();workers[1].ready();assert.equal(workers[1].message.options.worlds,32);
  runner.stop();runner.setAvailable(false);runner.setAvailable(true);runner.setAutomatic(false);runner.setAutomatic(true);assert.equal(workers.length,2);assert.equal(runner.diagnostics.manualPaused,true);
  runner.resume();await env.next();assert.equal(workers.length,3);assert.equal(runner.state.mode,'AUTOMATIC');
});

test('queue proceeds after partial or failed decisions, retains bounded history and never silently reseeds a failed snapshot',async()=>{
  const env=harness(),{runner,workers}=env;runner.load('owner-a');runner.setAvailable(true);
  for(let index=1;index<=8;index++){
    runner.enqueue([{record:recordFor(index)}]);await env.next();const active=workers.at(-1);active.ready();
    if(index===1)active.emit({type:'error',jobId:active.message.jobId,generation:active.message.generation,requestId:active.message.requestId,error:'Reference history cannot be represented.'});
    else active.checkpoint(checkpoint(active.message,index===2?4:512,index===2?'PARTIAL_BUDGET':'COMPLETE'));
    if(index===1){const recaptured=runner.enqueue([{record:recordFor(1)}]);assert.equal(recaptured.deduplicated,1);assert.equal(recaptured.added,0);}
  }
  assert.equal(runner.diagnostics.history,5);assert.equal(runner.diagnostics.errors,1);assert.equal(runner.diagnostics.partial,1);assert.equal(runner.diagnostics.completed,6);
  assert.equal(runner.history.length,5);assert.equal(runner.diagnostics.queued,0);
  assert.ok(env.storage.get('theibs.simulation.validation.auto.v1.owner-a').length<1400000);
});

test('completed cache is bound to exact snapshot, sizing and build; changed builds retain old provenance',async()=>{
  const env=harness(),{runner,workers}=env;runner.load('owner-a');runner.enqueue([{record:recordFor(1),chosenSize:2.5}]);runner.setAvailable(true);await env.next();workers[0].ready();
  workers[0].checkpoint(checkpoint(workers[0].message,512,'COMPLETE'));const savedId=runner.state.id;
  const restored=harness({storage:env.storage});restored.runner.load('owner-a');restored.runner.enqueue([{record:recordFor(1),chosenSize:2.5}]);restored.runner.setAvailable(true);await restored.next();
  assert.equal(restored.workers.length,0);assert.equal(restored.runner.state.id,savedId);assert.match(restored.runner.state.reason,/Reused/);
  const changed=harness({storage:env.storage,build:'build-2'});changed.runner.load('owner-a');changed.runner.enqueue([{record:recordFor(1),chosenSize:2.5}]);changed.runner.setAvailable(true);await changed.next();
  assert.equal(changed.workers.length,1);changed.workers[0].ready();assert.equal(changed.workers[0].message.type,'begin');
  assert.equal(changed.runner.state.buildFingerprint,'build-2');assert.ok(changed.runner.history.some(value=>value.buildFingerprint==='build-1'&&value.id===savedId));
});

test('restored old-build checkpoints fail closed and preserve their seed and results',async()=>{
  const env=harness(),{runner,workers}=env;runner.load('owner-a');runner.enqueue([{record:recordFor(1)}]);runner.setAvailable(true);await env.next();workers[0].ready();workers[0].checkpoint(checkpoint(workers[0].message));
  const restored=harness({storage:env.storage,build:'build-2'});restored.runner.load('owner-a');const seed=restored.runner.state.seed;
  restored.runner.setAvailable(true);await restored.next();assert.equal(restored.workers.length,0);assert.equal(restored.runner.state.errorCode,'BUILD_CHANGED');
  assert.equal(restored.runner.state.seed,seed);assert.equal(restored.runner.state.contexts[0].result.count,4);assert.equal(restored.runner.state.buildFingerprint,'build-1');
});

test('worker checkpoints cannot cross-wire a frozen row or bypass its request receipt',async()=>{
  const env=harness(),{runner,workers}=env;runner.load('owner-a');runner.enqueue([{record:recordFor(1)}]);runner.setAvailable(true);await env.next();workers[0].ready();
  const value=checkpoint(workers[0].message);workers[0].checkpoint(value,{requestId:'wrong-row-receipt'});assert.equal(runner.state.contexts[0].result,null);
  const foreign=checkpoint({...workers[0].message,payload:api.publicInput(recordFor(2))});workers[0].checkpoint(foreign);
  assert.equal(runner.state.errorCode,'INVALID_CHECKPOINT');assert.equal(runner.state.contexts[0].result,null);assert.equal(workers[0].terminated,true);
});

test('malformed or mismatched restored checkpoints are not displayed under a decision or resumed',async()=>{
  const env=harness(),{runner,workers}=env;runner.load('owner-a');runner.enqueue([{record:recordFor(1)}]);runner.setAvailable(true);await env.next();workers[0].ready();workers[0].checkpoint(checkpoint(workers[0].message));
  const serialized=env.storage.get('theibs.simulation.validation.v1.owner-a');
  for(const alter of [value=>value.seed='different-seed',value=>value.contexts[0].result.publicInput.multiwayEvaluation.config.startingStack=99,
    value=>value.contexts[0].result.sums[0]=null,value=>value.contexts[0].result.sumWeightSquared=-1,value=>value.contexts[0].result.prediction.candidates[0].optionId='OTHER',
    value=>value.contexts[0].result.summary.leader='OTHER',value=>value.contexts[0].result.leaderChanges='invalid',
    value=>value.status='COMPLETE',value=>value.index=1]){
    const changed=JSON.parse(serialized);alter(changed);const storage=new Map(env.storage);storage.set('theibs.simulation.validation.v1.owner-a',JSON.stringify(changed));
    const restored=harness({storage});restored.runner.load('owner-a');assert.equal(restored.runner.state,null);assert.match(restored.runner.diagnostics.storageWarning,/did not match/);
  }
});

test('worker resume independently binds public input, seed, budget and valid accumulators before adopting a checkpoint',()=>{
  const built=generate(),messages=[];let listener;
  const scope=vm.createContext({TextEncoder,TextDecoder,structuredClone,performance:{now:()=>0},crypto:crypto.webcrypto,
    addEventListener:(type,fn)=>{if(type==='message')listener=fn;},postMessage:message=>messages.push(message)});
  vm.runInContext(built.source,scope);const buildFingerprint=scope.TheibsBatchValidation.manifest.buildFingerprint;
  const input=payload(),settings={...options,seed:'bound-resume-seed'},original=scope.TheibsBatchValidation.begin(input,settings);
  const base={type:'resume',jobId:'bound-worker-job',generation:1,requestId:'bound-request-1',expectedBuildFingerprint:buildFingerprint,payload:input,options:settings};
  for(const alter of [value=>value.publicInput.multiwayEvaluation.config.startingStack=21,value=>value.seed='different-seed',value=>value.budgetMs=1000,
    value=>value.count=-1,value=>value.sums[0]=NaN,value=>value.sumWeightSquared=-1,value=>value.prediction.candidates[0].optionId='OTHER']){
    const changed=structuredClone(original);alter(changed);listener({data:{...base,batch:changed}});assert.equal(messages.at(-1).type,'error');assert.match(messages.at(-1).error,/does not match/);
  }
  listener({data:{...base,batch:structuredClone(original)}});assert.equal(messages.at(-1).type,'checkpoint');assert.equal(messages.at(-1).batch.count,1);
  assert.equal(messages.at(-1).requestId,base.requestId);assert.equal(messages.at(-1).contextFingerprint,original.fingerprint);
  listener({data:{type:'step',jobId:base.jobId,generation:base.generation,requestId:'other-request-1',expectedBuildFingerprint:buildFingerprint}});assert.equal(messages.at(-1).type,'error');
});
