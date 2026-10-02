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
  const workers=[],storage=new Map(),timers=new Map();let id=0;
  class Worker{constructor(){workers.push(this);}terminate(){this.terminated=true;}postMessage(value){this.message=value;}emit(message){this.onmessage({data:{buildFingerprint:'build-1',...message}});}}
  const root={Worker,fetch:async()=>({ok:true,json:async()=>({buildFingerprint:'build-1'})}),crypto:crypto.webcrypto,AbortController,performance:{now:()=>5},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:n=>timers.delete(n)};
  vm.runInNewContext(clientSource,{...root,globalThis:root});const runner=root.TheibsSimulationValidation.create();runner.load('owner-a');runner.setAvailable(true);runner.start([{record:payload().multiway}],{worlds:32});
  for(let i=0;i<8;i++)await Promise.resolve();workers[0].emit({type:'ready'});
  const identity=workers[0].message;workers[0].emit({type:'checkpoint',jobId:identity.jobId,generation:identity.generation,batch:{status:'RUNNING',count:4}});
  runner.setAvailable(false);assert.equal(workers[0].terminated,true);assert.equal(runner.state.status,'PAUSED');
  workers[0].emit({type:'checkpoint',jobId:identity.jobId,generation:identity.generation,batch:{status:'COMPLETE',count:32}});assert.equal(runner.state.contexts[0].result.count,4);
  runner.resume();assert.equal(workers.length,1);runner.setAvailable(true);runner.resume();for(let i=0;i<4;i++)await Promise.resolve();workers[1].emit({type:'ready'});assert.equal(workers[1].message.type,'resume');assert.equal(workers[1].message.batch.count,4);
  runner.clearOwner();assert.equal(workers[1].terminated,true);runner.load('owner-b');assert.equal(runner.state,null);runner.load('owner-a');assert.equal(runner.state.status,'PAUSED');assert.equal(runner.state.contexts[0].result.count,4);
});
