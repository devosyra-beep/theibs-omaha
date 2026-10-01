'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/multiway-solver-ui.js'),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function createUI(globals={}){const box={module:{exports:{}},setTimeout,clearTimeout,AbortController,...globals};vm.runInNewContext(source,box);return box.module.exports;}
function context(){return {multiway:{enabled:true,handId:'hand-1',config:{playerCount:2},events:[]},state:{handId:'hand-1',revisionKey:'revision-1'}};}
function payload(current){return {multiway:current.multiway,multiwayEvaluation:{assumeNoRake:true,feeBasis:'BEFORE_FEES',profileSnapshot:{private:'never-send'},ranges:['never-send']}};}
function study(){return {schemaVersion:1,handId:'hand-1',notation:'KEYBOARD',ranges:[0,1].map(seatId=>({seatId,complete:true,source:'USER_DEFINED_COMPLETE_STUDY',combos:[{cards:['As','Kh','Qd','Jc','9s'],weight:1}]})),sizing:{type:'MIN_MID_MAX',maxAggressions:1}};}
function result(status='APPROXIMATE'){const actions=[{id:'CHECK',action:'CHECK',size:null,frequency:1,evBB:2}];return {status,method:'ALTERNATING_CFR_PLUS_LINEAR_AVERAGE',actions,convergence:{thresholdMet:false},qualification:{gto:false,solvedSubgame:status==='SOLVED'},abstraction:{rootActions:actions.map(({frequency,evBB,...action})=>action)}};}
function response(budget='FAST',extra={}){return {jobId:'job-'+budget,handId:'hand-1',revisionKey:'revision-1',phase:'COMPLETE',budget,result:result(),...extra};}
const twelveLines='23456789TJQK'.split('').map(rank=>`${rank}E AC KO QP JP`).join('\n');

test('solver range parser uses an explicit notation, validates five cards and preserves relative weights',()=>{
  const api=createUI(),parse=api._testing.parseRange;
  assert.deepEqual(copy(parse('AE KC QO JP 9E | 2','KEYBOARD')),[{cards:['As','Kh','Qd','Jc','9s'],weight:2}]);
  assert.deepEqual(copy(parse('As Kh Qd Jc 9s','CANONICAL')),[{cards:['As','Kh','Qd','Jc','9s'],weight:1}]);
  assert.equal(parse('10E KC QO JP 9E','KEYBOARD')[0].cards[0],'Ts');
  for(const invalid of ['AE AE QO JP 9E','AE KC QO JP','AE KC QO JP 9E | 0','AE KC QO JP 9E extra','AE KC QO JP 9E\n9E JP QO KC AE'])assert.throws(()=>parse(invalid,'KEYBOARD'));
  assert.throws(()=>parse('As Kh Qd Jc 9s','KEYBOARD'));
  assert.equal(parse(twelveLines,'KEYBOARD',12).length,12);
  assert.throws(()=>parse(twelveLines,'KEYBOARD',3),/three|3/);
  assert.throws(()=>parse(`${twelveLines}\nAE AC KO QP JP`,'KEYBOARD',12),/12/);
});

test('solver starts with no invented ranges and does not send transcripts, profiles or heuristic ranges',async()=>{
  const api=createUI(),current=context(),calls=[];
  api.init({getContext:()=>current,request:async(url,options)=>{const body=options.body&&JSON.parse(options.body);calls.push({url,body});return response(body?.budget,{phase:'UNSUPPORTED',result:{status:'NOT_SOLVED',actions:[]}});}});
  await api.evaluate(payload(current));
  const sent=calls[0].body;assert.deepEqual(sent.ranges,[]);assert.equal(sent.sizing,null);assert.equal(sent.rake.basis,'BEFORE_FEES');assert.equal(JSON.stringify(sent).includes('never-send'),false);
  assert.equal(sent.budget,'STANDARD');assert.equal(sent.automatic,true);assert.equal(calls.filter(call=>call.url.endsWith('/start')).length,1);
  assert.equal(api.decisionSnapshot(),null);api.invalidate();
});

test('a stale start acknowledgement is discarded and its server job is cancelled',async()=>{
  const api=createUI(),current=context(),calls=[];let resolveStart;
  api.init({getContext:()=>current,request:(url,options)=>{calls.push({url,body:options.body&&JSON.parse(options.body)});return url.endsWith('/start')?new Promise(resolve=>resolveStart=resolve):Promise.resolve({});}});
  const running=api.evaluate(payload(current));await tick();
  current.state.revisionKey='revision-2';api.invalidate();resolveStart(response('STANDARD',{phase:'REFINING'}));await running;await tick();
  assert.equal(api.getState().phase,'IDLE');assert.equal(api.decisionSnapshot(),null);assert.ok(calls.some(call=>call.url.endsWith('/cancel')&&call.body.jobId==='job-STANDARD'));
});

test('FAST automatically refines only once and duplicate evaluation does not restart the same decision',async()=>{
  const api=createUI(),current=context(),starts=[];
  api.init({getContext:()=>current,request:async(url,options)=>{if(!url.endsWith('/start'))return {};const body=JSON.parse(options.body);starts.push(body);return response(body.budget);}});
  api.restore(study());await api.evaluate(payload(current),{budget:'FAST'});await api.evaluate(payload(current),{budget:'FAST'});
  assert.deepEqual(starts.map(item=>item.budget),['FAST','STANDARD']);assert.ok(starts.every(item=>item.automatic===false));assert.equal(api.getState().phase,'COMPLETE');assert.equal(api.decisionSnapshot().status,'APPROXIMATE');api.invalidate();
});

test('automatic river study makes one bounded STANDARD to DEEP continuation and keeps explicit requests separate',async()=>{
  const api=createUI(),current=context(),starts=[];
  api.init({getContext:()=>current,request:async(url,options)=>{if(!url.endsWith('/start'))return {};const body=JSON.parse(options.body);starts.push(body);
    return response(body.budget,{result:{...result('SOLVED'),adaptation:{stopReason:'TIME_RESOURCE_CEILING',refinementRecommended:true}}});}});
  api.restore(study());await api.evaluate(payload(current));await api.evaluate(payload(current));
  assert.deepEqual(starts.map(item=>[item.budget,item.automatic]),[['STANDARD',true],['DEEP',true]]);
  assert.equal(api.getState().phase,'COMPLETE');api.invalidate();
  await api.evaluate(payload(current),{budget:'STANDARD',automatic:false});
  assert.deepEqual(starts.at(-1)&&[starts.at(-1).budget,starts.at(-1).automatic],['STANDARD',false]);api.invalidate();
});

test('automatic DEEP keeps the STANDARD snapshot visible and Stop prevents restarting it for the same study',async()=>{
  const api=createUI(),current=context(),starts=[];let resolveDeep;
  api.init({getContext:()=>current,request:(url,options)=>{if(url.endsWith('/cancel'))return Promise.resolve({});
    const body=JSON.parse(options.body);starts.push(body.budget);
    if(body.budget==='DEEP')return new Promise(resolve=>{resolveDeep=resolve;});
    return Promise.resolve(response('STANDARD',{result:{...result('SOLVED'),adaptation:{phase:'STOPPED',stopReason:'ITERATION_RESOURCE_CEILING',refinementRecommended:true}}}));}});
  api.restore(study());const run=api.evaluate(payload(current));await tick();
  assert.deepEqual(starts,['STANDARD','DEEP']);assert.equal(api.getState().phase,'QUEUED');assert.equal(api.decisionSnapshot().status,'SOLVED');
  api._testing.cancel();resolveDeep(response('DEEP'));await run;
  assert.equal(api.getState().phase,'CANCELLED');
  await api.evaluate(payload(current));
  assert.deepEqual(starts,['STANDARD','DEEP','STANDARD']);assert.equal(api.getState().phase,'COMPLETE');api.invalidate();
});

test('automatic DEEP requires a complete HU strategy and ordinary budget stop',async()=>{
  for(const reason of ['THREE_SEATS','MISSING_ACTION','FOREGROUND_PRIORITY_PAUSE','NO_REFINEMENT']){
    const api=createUI(),current=context(),declared=study(),starts=[];
    if(reason==='THREE_SEATS'){current.multiway.config.playerCount=3;declared.ranges.push({...copy(declared.ranges[1]),seatId:2});}
    api.init({getContext:()=>current,request:async(url,options)=>{if(!url.endsWith('/start'))return {};
      const body=JSON.parse(options.body);starts.push(body.budget);
      const value=result('SOLVED');
      if(reason==='MISSING_ACTION')value.abstraction.rootActions.push({id:'BET:2.00',action:'BET',size:2});
      return response(body.budget,{result:{...value,adaptation:{phase:'STOPPED',
        stopReason:reason==='FOREGROUND_PRIORITY_PAUSE'?'FOREGROUND_PRIORITY_PAUSE':'TIME_RESOURCE_CEILING',
        refinementRecommended:reason!=='NO_REFINEMENT'}}});}});
    api.restore(declared);await api.evaluate(payload(current));assert.deepEqual(starts,['STANDARD'],reason);api.invalidate();
  }
});

test('versioned progress uses bounded server waits and one start; older servers keep interval polling',async()=>{
  for(const versioned of [true,false]){
    const api=createUI(),current=context(),calls=[];
    api.init({getContext:()=>current,request:async(url,options)=>{calls.push(url);
      if(url.endsWith('/start'))return response('STANDARD',{phase:'QUEUED',result:null,...(versioned?{updateVersion:0}:{})});
      const count=calls.filter(path=>path.includes('/jobs/')).length;
      return response('STANDARD',{phase:count===1?'REFINING':'COMPLETE',...(versioned?{updateVersion:count}:{}),result:result()});}});
    await api.evaluate(payload(current));
    const until=Date.now()+1200;
    while(api.getState().phase!=='COMPLETE'&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(api.getState().phase,'COMPLETE');
    assert.equal(calls.filter(path=>path.endsWith('/start')).length,1);
    const polls=calls.filter(path=>path.includes('/jobs/'));
    assert.equal(polls.length,2);
    if(versioned){assert.match(polls[0],/afterVersion=0&waitMs=1000/);assert.match(polls[1],/afterVersion=1&waitMs=1000/);}
    else assert.ok(polls.every(path=>!path.includes('afterVersion=')));
    api.invalidate();
  }
});

test('a versioned long poll cannot publish a stale revision after cancellation',async()=>{
  const api=createUI(),current=context(),calls=[];let resolvePoll;
  api.init({getContext:()=>current,request:(url,options)=>{calls.push({url,body:options.body&&JSON.parse(options.body)});
    if(url.endsWith('/start'))return Promise.resolve(response('STANDARD',{phase:'QUEUED',result:null,updateVersion:0}));
    if(url.includes('/jobs/'))return new Promise(resolve=>resolvePoll=resolve);
    return Promise.resolve({});}});
  await api.evaluate(payload(current));
  const until=Date.now()+200;
  while(!resolvePoll&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,5));
  assert.ok(resolvePoll);current.state.revisionKey='revision-2';api.invalidate();
  resolvePoll(response('STANDARD',{phase:'COMPLETE',updateVersion:1}));await tick();
  assert.equal(api.getState().phase,'IDLE');assert.equal(api.decisionSnapshot(),null);
  assert.ok(calls.some(call=>call.url.endsWith('/cancel')&&call.body.jobId==='job-STANDARD'));
});

test('action-bound refinement can continue after global convergence, or stop when certified separated',async()=>{
  for(const recommended of [true,false]){
    const api=createUI(),current=context(),budgets=[];
    api.init({getContext:()=>current,request:async(url,options)=>{if(!url.endsWith('/start'))return {};const body=JSON.parse(options.body);budgets.push(body.budget);
      return response(body.budget,{result:{...result('SOLVED'),convergence:{thresholdMet:true},adaptation:{refinementRecommended:recommended}}});}});
    api.restore(study());await api.evaluate(payload(current),{budget:'FAST'});
    assert.deepEqual(budgets,recommended?['FAST','STANDARD']:['FAST']);api.invalidate();
  }
});

test('in-flight duplicate FAST requests share the current request and retain no stale callbacks',async()=>{
  const api=createUI(),current=context();let count=0,resolveStart;
  api.init({getContext:()=>current,request:async(url)=>{if(url.endsWith('/cancel'))return {};count++;return new Promise(resolve=>resolveStart=resolve);}});
  const first=api.evaluate(payload(current),{budget:'FAST'});await tick();await api.evaluate(payload(current),{budget:'FAST'});assert.equal(count,1);
  resolveStart(response('FAST',{phase:'UNSUPPORTED',result:{status:'NOT_SOLVED',actions:[]}}));await first;api.invalidate();
});

test('a covered FAST build with no iteration budget receives one STANDARD refinement',async()=>{
  const api=createUI(),current=context(),budgets=[];
  api.init({getContext:()=>current,request:async(url,options)=>{if(!url.endsWith('/start'))return {};const body=JSON.parse(options.body);budgets.push(body.budget);
    return body.budget==='FAST'?response('FAST',{phase:'UNSUPPORTED',result:{status:'NOT_SOLVED',actions:[],reasons:[{code:'BUDGET_BEFORE_FIRST_STRATEGY'}]}}):response('STANDARD');}});
  api.restore(study());await api.evaluate(payload(current),{budget:'FAST'});assert.deepEqual(budgets,['FAST','STANDARD']);assert.equal(api.getState().phase,'COMPLETE');api.invalidate();
});

test('restored study survives initialization before the ledger and clears on the next hand',()=>{
  const api=createUI();let current={};api.init({getContext:()=>current,request:async()=>({})});api.restore(study());api.invalidate();
  assert.equal(api.serialize().handId,'hand-1');current=context();assert.equal(api.getState().configured,true);
  api.invalidate();assert.equal(api.serialize().handId,'hand-1');current.multiway.handId='hand-2';current.state.handId='hand-2';api.invalidate();assert.equal(api.serialize(),null);
});

test('restored study keeps expanded HU limits separate from three-seat limits',()=>{
  const api=createUI(),expanded=study();
  expanded.ranges[0].combos=api._testing.parseRange(twelveLines,'KEYBOARD',12);
  expanded.sizing={type:'EXPLICIT_TOTALS',maxAggressions:1,levels:Array.from({length:12},(_,index)=>index+1)};
  api.restore(expanded);assert.equal(api.serialize().ranges[0].combos.length,12);
  const three=copy(expanded);three.ranges.push({...copy(three.ranges[1]),seatId:2});three.ranges[0].combos=three.ranges[0].combos.slice(0,4);
  three.sizing.levels=three.sizing.levels.slice(0,8);api.restore(three);assert.equal(api.serialize().ranges.length,2);
  three.ranges[0].combos=three.ranges[0].combos.slice(0,3);three.sizing.levels=Array.from({length:9},(_,index)=>index+1);
  api.restore(three);assert.equal(api.serialize().ranges.length,2);
  three.sizing.levels=three.sizing.levels.slice(0,8);api.restore(three);assert.equal(api.serialize().ranges.length,3);
});

test('decision snapshots accept only complete valid strategy rows and qualified solved subgames',async()=>{
  const api=createUI(),current=context();let returned=result('SOLVED');
  api.init({getContext:()=>current,request:async()=>response('FAST',{result:returned})});
  await api.evaluate(payload(current));assert.equal(api.decisionSnapshot().status,'SOLVED');
  for(const mutate of [value=>{value.qualification.solvedSubgame=false;},value=>{value.actions[0].evBB=null;},value=>{value.actions[0].frequency=.8;},
    value=>{value.actions.push(copy(value.actions[0]));},value=>{value.actions[0].id='RAISE';},value=>{value.status='NOT_SOLVED';}]){
    api.invalidate();returned=result('SOLVED');mutate(returned);await api.evaluate(payload(current));assert.equal(api.decisionSnapshot(),null);
  }
  api.invalidate();
});

test('stale payloads do not schedule a solver and snapshots are immutable',async()=>{
  const api=createUI(),current=context();let count=0;
  api.init({getContext:()=>current,request:async()=>{count++;return response('FAST');}});
  const old=payload(copy(current));current.multiway.events.push({type:'ACT',actor:0,action:'CHECK'});current.state.revisionKey='revision-2';
  await api.evaluate(old);assert.equal(count,0);
  current.state.revisionKey='revision-1';await api.evaluate(payload(current));const snapshot=api.decisionSnapshot();snapshot.actions[0].evBB=999;
  assert.equal(api.decisionSnapshot().actions[0].evBB,2);api.invalidate();
});

test('available Browser compute is preferred and owns its bounded automatic continuation',async()=>{
  const api=createUI(),current=context(),starts=[],server=[];
  const browser={supported:true,start:async(owner,input,settings)=>{starts.push({owner,input,settings});return response(settings.budget,{runtime:'BROWSER',runtimeLabel:'Browser compute',
    runtimeBudget:{initialMs:3000,ceilingMs:5000,continuations:1},buildFingerprint:'a'.repeat(64),
    result:{...result('SOLVED'),adaptation:{stopReason:'TIME_RESOURCE_CEILING',refinementRecommended:true}}});},cancelOwner(){},clearOwner(){},cancel:async()=>({})};
  api.init({getContext:()=>current,getOwner:()=>JSON.stringify(['user-1','session-1']),browserClient:browser,request:async(url,options)=>{server.push(url);return response(JSON.parse(options.body).budget);}});
  api.restore(study());await api.evaluate(payload(current));
  assert.equal(starts.length,1);assert.equal(server.length,0);assert.equal(starts[0].settings.budget,'STANDARD');assert.equal(starts[0].settings.automatic,true);
  assert.equal(JSON.stringify(starts[0].input).includes('never-send'),false);
  assert.equal(api.getState().runtime,'BROWSER');assert.equal(api.decisionSnapshot().runtimeBudget.ceilingMs,5000);assert.equal(api.decisionSnapshot().buildFingerprint,'a'.repeat(64));
  api.setRuntime('SERVER');await api.evaluate(payload(current),{automatic:false});assert.equal(server.length,1);assert.equal(api.getState().runtime,'SERVER');api.invalidate();
});

test('unsupported browser fallback is visible and browser runtime failure never silently sends study ranges',async()=>{
  const api=createUI(),current=context();let serverCalls=0;
  api.init({getContext:()=>current,browserClient:{supported:false},request:async()=>{serverCalls++;return response('STANDARD');}});
  await api.evaluate(payload(current));assert.equal(serverCalls,1);assert.equal(api.getState().runtime,'SERVER');assert.match(api.getState().runtimeReason,/Browser compute is unavailable/);api.invalidate();
  const available=createUI();available.init({getContext:()=>current,browserClient:{supported:true,start:async()=>{throw Error('Browser solver build changed.');},cancelOwner(){}},request:async()=>{serverCalls++;return response('STANDARD');}});
  await available.evaluate(payload(current));assert.equal(available.getState().phase,'FAILED');assert.equal(available.getState().runtime,'BROWSER');assert.match(available.getState().error,/build changed/);assert.equal(serverCalls,1);available.invalidate();
});

test('hand and owner changes synchronously cancel browser work and cannot publish stale progress',async()=>{
  const api=createUI(),current=context(),cancelled=[];let owner='owner-1',resolveStart;
  const browser={supported:true,start:()=>new Promise(resolve=>resolveStart=resolve),cancelOwner:value=>cancelled.push(value),clearOwner:value=>cancelled.push('clear:'+value),cancel:async()=>({})};
  api.init({getContext:()=>current,getOwner:()=>owner,browserClient:browser});
  const running=api.evaluate(payload(current));await tick();current.state.revisionKey='revision-2';api.getState();assert.ok(cancelled.includes('owner-1'));
  api.invalidate();resolveStart(response('STANDARD',{phase:'REFINING',runtime:'BROWSER'}));await running;assert.equal(api.getState().phase,'IDLE');assert.equal(api.decisionSnapshot(),null);
  current.state.revisionKey='revision-1';const next=api.evaluate(payload(current));await tick();owner='owner-2';api.getState();assert.equal(cancelled.at(-1),'clear:owner-1');
  api.clearOwner();resolveStart(response('STANDARD',{runtime:'BROWSER'}));await next;assert.ok(cancelled.includes('clear:owner-1'));assert.equal(api.decisionSnapshot(),null);
});

test('changing the fee basis cannot retain the previous decision value while a new study starts',async()=>{
  const api=createUI(),current=context();let resolveChanged;
  api.init({getContext:()=>current,request:async(url,options)=>{const body=options.body && JSON.parse(options.body);if(url.endsWith('/cancel'))return {};
    if(body.rake.basis==='NO_FEES')return new Promise(resolve=>resolveChanged=resolve);return response(body.budget);}});
  await api.evaluate(payload(current));assert.ok(api.decisionSnapshot());
  const changed=payload(current);changed.multiwayEvaluation.feeBasis='NO_FEES';const running=api.evaluate(changed);await tick();
  assert.equal(api.getState().phase,'QUEUED');assert.equal(api.getState().result,null);assert.equal(api.decisionSnapshot(),null);
  resolveChanged(response('STANDARD'));await running;api.invalidate();
});

test('AUTO preserves the existing three-seat server coverage while explicit Browser compute stays local',async()=>{
  const api=createUI(),current=context();current.multiway.config.playerCount=3;let browserCalls=0,serverCalls=0;
  const browser={supported:true,start:async()=>{browserCalls++;return response('STANDARD');},cancelOwner(){}};
  api.init({getContext:()=>current,browserClient:browser,request:async()=>{serverCalls++;return response('STANDARD');}});
  await api.evaluate(payload(current));assert.equal(browserCalls,0);assert.equal(serverCalls,1);assert.equal(api.getState().runtime,'SERVER');
  assert.equal(api.getState().runtimeReason,'Browser compute covers two original seats; using Server compute.');
  api.setRuntime('BROWSER');await api.evaluate(payload(current));assert.equal(api.getState().phase,'FAILED');assert.match(api.getState().error,/two original seats.*Choose Server/);
  assert.equal(browserCalls,0);assert.equal(serverCalls,1);api.invalidate();
});

test('terminal browser progress preserves timing, cache provenance and original inconclusive precision',async()=>{
  const api=createUI(),current=context(),received=response('STANDARD',{runtime:'BROWSER',runtimeLabel:'Browser compute',reason:'Browser compute time limit reached; latest completed estimate retained.',
    timing:{acknowledgementMs:2,workerReadyMs:10,firstResponseMs:100,firstValueMs:100,completionMs:4002,jobElapsedMs:4000,workerMs:4000,
      currentRunCosts:{actionSolveMs:300},jobCosts:{actionSolveMs:300},cumulativeCosts:{actionSolveMs:300}},cache:{hit:false,source:'NONE',readOnly:false,originalTiming:null},
    result:{...result(),decisionPrecision:{status:'INCONCLUSIVE',leaderConclusive:false},adaptation:{phase:'REFINING',stopReason:null,refinementRecommended:true},metrics:{costs:{actionSolveMs:300}}}});
  api.init({getContext:()=>current,browserClient:{supported:true,start:async()=>copy(received),cancelOwner(){}}});
  await api.evaluate(payload(current),{automatic:false});const snapshot=api.decisionSnapshot();
  assert.equal(snapshot.phase,'COMPLETE');assert.equal(snapshot.adaptation.phase,'REFINING');assert.equal(snapshot.adaptation.stopReason,null);
  assert.equal(snapshot.decisionPrecision.status,'INCONCLUSIVE');assert.equal(snapshot.runtimeLabel,'Browser compute');assert.equal(snapshot.cache.source,'NONE');
  assert.deepEqual(copy(snapshot.timing),received.timing);assert.match(api.getState().error,/time limit/);
  snapshot.timing.jobCosts.actionSolveMs=999;assert.equal(api.decisionSnapshot().timing.jobCosts.actionSolveMs,300);api.invalidate();
});

test('timeout copy claims a retained estimate only when this decision has a usable prior result',async()=>{
  const aborted=()=>Object.assign(Error('Request aborted.'),{name:'AbortError'});
  const empty=createUI(),current=context();empty.init({getContext:()=>current,request:async()=>{throw aborted();}});
  await empty.evaluate(payload(current),{automatic:false});assert.equal(empty.getState().error,'Solver request timed out.');assert.equal(empty.decisionSnapshot(),null);empty.invalidate();
  const retained=createUI();let calls=0;
  retained.init({getContext:()=>current,request:async()=>{if(++calls===1)return response('STANDARD');throw aborted();}});
  await retained.evaluate(payload(current),{automatic:false});await retained.evaluate(payload(current),{budget:'DEEP',automatic:false});
  assert.equal(retained.getState().error,'Solver request timed out. Latest completed estimate retained.');assert.equal(retained.decisionSnapshot().status,'APPROXIMATE');retained.invalidate();
});

test('study comparison policy is restored and sent while a changed threshold clears the prior comparison',async()=>{
  const api=createUI(),current=context(),starts=[];let resolveChanged;
  const browser={supported:true,start:async(owner,input,settings)=>{starts.push(input);if(input.comparisonPolicy.nearEquivalenceBB===.02)return new Promise(resolve=>resolveChanged=resolve);return response(settings.budget);},cancelOwner(){}};
  api.init({getContext:()=>current,browserClient:browser});api.restore(study());await api.evaluate(payload(current),{automatic:false});
  assert.equal(starts[0].comparisonPolicy.nearEquivalenceBB,.01);const updated=study();updated.comparisonPolicy={nearEquivalenceBB:.02};api.restore(updated);
  const running=api.evaluate(payload(current),{automatic:false});await tick();assert.equal(api.decisionSnapshot(),null);assert.equal(api.getState().comparisonPolicy.nearEquivalenceBB,.02);
  assert.equal(api.serialize().comparisonPolicy.nearEquivalenceBB,.02);assert.deepEqual(copy(starts[1].ranges),updated.ranges);
  resolveChanged(response('STANDARD'));await running;assert.equal(api.decisionSnapshot().comparisonPolicy.nearEquivalenceBB,.02);api.invalidate();
});

test('a response using a different outcome policy cannot render a new study comparison',async()=>{
  const api=createUI(),current=context();api.init({getContext:()=>current,request:async()=>response('STANDARD',{result:{...result(),decisionOutcome:{policy:{nearEquivalenceBB:.02}}}})});
  await api.evaluate(payload(current),{automatic:false});assert.equal(api.getState().phase,'FAILED');assert.match(api.getState().error,/comparison policy does not match/);assert.equal(api.decisionSnapshot(),null);api.invalidate();
});

function withScenarios(api,count=2){
  const saved=study(),base=api._testing.normalizeScenarios(saved)[0];
  saved.scenarios=Array.from({length:count},(_,index)=>({...copy(base),id:'scenario-'+(index+1),name:'Hypothesis '+(index+1),treeName:'Tree '+(index+1),rationaleBySeat:{0:'Explicit user hypothesis'},
    ranges:base.ranges.map(range=>({...copy(range),combos:range.combos.map(combo=>({...copy(combo),weight:index+1}))}))}));
  saved.activeScenarioId='scenario-1';return saved;
}

test('legacy study migration retains active aliases and rejects oversized or incomplete scenario collections',()=>{
  const api=createUI();api.restore(study());let saved=api.serialize();
  assert.equal(saved.schemaVersion,1);assert.equal(saved.scenarios.length,1);assert.equal(saved.activeScenarioId,'scenario-1');
  assert.deepEqual(copy(saved.ranges),study().ranges);assert.deepEqual(copy(saved.sizing),study().sizing);
  api.restore(withScenarios(api,3));assert.equal(api.serialize().scenarios.length,3);
  api.restore(withScenarios(api,4));assert.equal(api.serialize().scenarios.length,3);
  const invalid=withScenarios(api);invalid.scenarios[1].ranges[0].combos=[];api.restore(invalid);assert.equal(api.serialize().scenarios.length,3);
  const selected=withScenarios(api);selected.activeScenarioId='scenario-2';api.restore(selected);saved=api.serialize();assert.equal(saved.ranges[0].combos[0].weight,2);
  saved.scenarios[1].ranges[0].combos[0].weight=999;assert.equal(api.serialize().ranges[0].combos[0].weight,2);
});

test('metadata-only saves retain the active estimate and keep names, rationale and owner out of solver payloads',async()=>{
  const api=createUI(),current=context(),sent=[];
  api.init({getContext:()=>current,getOwner:()=>JSON.stringify(['verified-user',1]),browserClient:{supported:true,start:async(owner,input,settings)=>{sent.push(input);return response(settings.budget);},cancelOwner(){}}});
  api.restore(withScenarios(api));await api.evaluate(payload(current),{automatic:false});const before=api.decisionSnapshot();
  const renamed=api.serialize();renamed.scenarios[0].name='Reviewed hypothesis';renamed.scenarios[0].treeName='Specific tree';renamed.scenarios[0].rationaleBySeat[1]='Private rationale';
  api._testing.saveStudy(renamed,api._testing.binding(current));await api.evaluate(payload(current),{automatic:false});
  assert.equal(sent.length,1);assert.equal(api.decisionSnapshot().actions[0].evBB,before.actions[0].evBB);
  assert.equal(api.decisionSnapshot().studyProvenance.name,'Reviewed hypothesis');assert.match(JSON.stringify(api.serialize()),/Private rationale/);
  assert.doesNotMatch(JSON.stringify(sent),/Reviewed hypothesis|Specific tree|Private rationale|verified-user|scenarioId/);
  api.invalidate();
});

test('saving a changed active model clears old values and full binding guards reject revision or owner races',async()=>{
  const api=createUI(),current=context();let owner='owner-1',release;
  api.init({getContext:()=>current,getOwner:()=>owner,browserClient:{supported:true,start:async(value,input,settings)=>input.ranges[0].combos[0].weight===2?new Promise(resolve=>release=resolve):response(settings.budget),cancelOwner(){},clearOwner(){}}});
  api.restore(withScenarios(api));await api.evaluate(payload(current),{automatic:false});const bound=api._testing.binding(current),saved=api.serialize();
  current.state.revisionKey='new';assert.throws(()=>api._testing.saveStudy(saved,bound),/decision or session changed/);current.state.revisionKey='revision-1';
  owner='owner-2';assert.throws(()=>api._testing.saveStudy(saved,bound),/decision or session changed/);owner='owner-1';
  saved.activeScenarioId='scenario-2';api._testing.saveStudy(saved,bound);await tick();assert.equal(api.decisionSnapshot(),null);
  release(response('STANDARD'));await tick();assert.equal(api.decisionSnapshot().studyProvenance.scenarioId,'scenario-2');api.invalidate();
});

test('logout and session epoch changes discard scenario notes and comparison provenance',()=>{
  const api=createUI(),current=context();let owner=JSON.stringify(['user-1',1]);
  api.init({getContext:()=>current,getOwner:()=>owner});api.restore(withScenarios(api));assert.match(JSON.stringify(api.serialize()),/Explicit user hypothesis/);
  owner=JSON.stringify(['user-1',2]);assert.equal(api.serialize(),null);assert.equal(api.getState().configured,false);assert.equal(api.getComparisonState().entries.length,0);
  api.restore(withScenarios(api));owner=null;assert.equal(api.getState().configured,false);assert.equal(api.serialize(),null);
  api.restore(withScenarios(api));assert.equal(api.serialize(),null);
});

test('sequential comparisons use the same Browser client and retain the primary result',async()=>{
  const Runner=require('../public/solver-study-runner.js'),api=createUI(),current=context(),starts=[];
  api.init({getContext:()=>current,studyRunnerFactory:settings=>Runner.create({...settings,perScenarioMs:50,totalMs:100}),browserClient:{supported:true,
    start:async(owner,input,settings)=>{starts.push({input,settings});return response(settings.budget,{jobId:'job-'+starts.length});},cancelOwner(){},cancel:async()=>response('STANDARD')}});
  api.restore(withScenarios(api,3));await api.evaluate(payload(current),{automatic:false});const base=api.decisionSnapshot();
  await api.runComparison();assert.equal(starts.length,3);assert.equal(api.getComparisonState().phase,'COMPLETE');assert.equal(api.getComparisonState().entries.length,3);
  assert.ok(starts.slice(1).every(item=>item.settings.budget==='STANDARD' && item.settings.automatic===false));
  assert.equal(api.decisionSnapshot().jobId,base.jobId);assert.deepEqual(copy(api.decisionSnapshot().actions),copy(base.actions));
  assert.doesNotMatch(JSON.stringify(starts.map(item=>item.input)),/Hypothesis|Explicit user hypothesis|treeName/);api.invalidate();
});

test('server and running base studies cannot start a comparison',async()=>{
  const Runner=require('../public/solver-study-runner.js'),api=createUI(),current=context();let starts=0;
  api.init({getContext:()=>current,studyRunnerFactory:Runner.create,request:async()=>{starts++;return response('STANDARD');}});
  api.restore(withScenarios(api));await api.evaluate(payload(current),{automatic:false});await api.runComparison();assert.equal(starts,1);assert.match(api.getComparisonState().error,/Browser compute/);api.invalidate();
  const running=createUI();running.init({getContext:()=>current,studyRunnerFactory:Runner.create,browserClient:{supported:true,start:async()=>{starts++;return response('STANDARD',{phase:'REFINING'});},cancelOwner(){},cancel:async()=>({})}});
  running.restore(withScenarios(running));await running.evaluate(payload(current),{automatic:false});await running.runComparison();assert.equal(starts,2);assert.match(running.getComparisonState().error,/Finish or stop/);running.invalidate();
});

test('replacement compute waits for late comparison acknowledgement cancellation',async()=>{
  const Runner=require('../public/solver-study-runner.js'),api=createUI(),current=context(),events=[];let release;
  const browser={supported:true,start:async(owner,input,settings)=>{events.push('start:'+settings.budget);if(events.filter(value=>value.startsWith('start')).length===2)return new Promise(resolve=>release=resolve);return response(settings.budget,{jobId:'job-'+events.length});},
    cancelOwner(){},cancel:async(owner,id)=>{events.push('cancel:'+id);return response('STANDARD',{jobId:id,phase:'CANCELLED'});}};
  api.init({getContext:()=>current,studyRunnerFactory:settings=>Runner.create({...settings,perScenarioMs:500,totalMs:500}),browserClient:browser});
  api.restore(withScenarios(api));await api.evaluate(payload(current),{automatic:false});const comparing=api.runComparison();await tick();
  const replacement=api.evaluate(payload(current),{budget:'DEEP',automatic:false});await tick();assert.equal(events.filter(value=>value.startsWith('start')).length,2);
  release(response('STANDARD',{jobId:'late-comparison',phase:'REFINING'}));await comparing;await replacement;
  assert.ok(events.indexOf('cancel:late-comparison')<events.indexOf('start:DEEP'));assert.equal(api.getState().budget,'DEEP');api.invalidate();
});
