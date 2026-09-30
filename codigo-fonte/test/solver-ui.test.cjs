'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/multiway-solver-ui.js'),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function createUI(){const box={module:{exports:{}},setTimeout,clearTimeout,AbortController};vm.runInNewContext(source,box);return box.module.exports;}
function context(){return {multiway:{enabled:true,handId:'hand-1',config:{playerCount:2},events:[]},state:{handId:'hand-1',revisionKey:'revision-1'}};}
function payload(current){return {multiway:current.multiway,multiwayEvaluation:{assumeNoRake:true,feeBasis:'BEFORE_FEES',profileSnapshot:{private:'never-send'},ranges:['never-send']}};}
function study(){return {schemaVersion:1,handId:'hand-1',notation:'KEYBOARD',ranges:[0,1].map(seatId=>({seatId,complete:true,source:'USER_DEFINED_COMPLETE_STUDY',combos:[{cards:['As','Kh','Qd','Jc','9s'],weight:1}]})),sizing:{type:'MIN_MID_MAX',maxAggressions:1}};}
function result(status='APPROXIMATE'){const actions=[{id:'CHECK',action:'CHECK',size:null,frequency:1,evBB:2}];return {status,method:'ALTERNATING_CFR_PLUS_LINEAR_AVERAGE',actions,convergence:{thresholdMet:false},qualification:{gto:false,solvedSubgame:status==='SOLVED'},abstraction:{rootActions:actions.map(({frequency,evBB,...action})=>action)}};}
function response(budget='FAST',extra={}){return {jobId:'job-'+budget,handId:'hand-1',revisionKey:'revision-1',phase:'COMPLETE',budget,result:result(),...extra};}

test('solver range parser uses an explicit notation, validates five cards and preserves relative weights',()=>{
  const api=createUI(),parse=api._testing.parseRange;
  assert.deepEqual(copy(parse('AE KC QO JP 9E | 2','KEYBOARD')),[{cards:['As','Kh','Qd','Jc','9s'],weight:2}]);
  assert.deepEqual(copy(parse('As Kh Qd Jc 9s','CANONICAL')),[{cards:['As','Kh','Qd','Jc','9s'],weight:1}]);
  assert.equal(parse('10E KC QO JP 9E','KEYBOARD')[0].cards[0],'Ts');
  for(const invalid of ['AE AE QO JP 9E','AE KC QO JP','AE KC QO JP 9E | 0','AE KC QO JP 9E extra','AE KC QO JP 9E\n9E JP QO KC AE'])assert.throws(()=>parse(invalid,'KEYBOARD'));
  assert.throws(()=>parse('As Kh Qd Jc 9s','KEYBOARD'));
});

test('solver starts with no invented ranges and does not send transcripts, profiles or heuristic ranges',async()=>{
  const api=createUI(),current=context(),calls=[];
  api.init({getContext:()=>current,request:async(url,options)=>{const body=options.body&&JSON.parse(options.body);calls.push({url,body});return response(body?.budget,{phase:'UNSUPPORTED',result:{status:'NOT_SOLVED',actions:[]}});}});
  await api.evaluate(payload(current));
  const sent=calls[0].body;assert.deepEqual(sent.ranges,[]);assert.equal(sent.sizing,null);assert.equal(sent.rake.basis,'BEFORE_FEES');assert.equal(JSON.stringify(sent).includes('never-send'),false);
  assert.equal(api.decisionSnapshot(),null);api.invalidate();
});

test('a stale start acknowledgement is discarded and its server job is cancelled',async()=>{
  const api=createUI(),current=context(),calls=[];let resolveStart;
  api.init({getContext:()=>current,request:(url,options)=>{calls.push({url,body:options.body&&JSON.parse(options.body)});return url.endsWith('/start')?new Promise(resolve=>resolveStart=resolve):Promise.resolve({});}});
  const running=api.evaluate(payload(current));await tick();
  current.state.revisionKey='revision-2';api.invalidate();resolveStart(response('FAST',{phase:'REFINING'}));await running;await tick();
  assert.equal(api.getState().phase,'IDLE');assert.equal(api.decisionSnapshot(),null);assert.ok(calls.some(call=>call.url.endsWith('/cancel')&&call.body.jobId==='job-FAST'));
});

test('FAST automatically refines only once and duplicate evaluation does not restart the same decision',async()=>{
  const api=createUI(),current=context(),starts=[];
  api.init({getContext:()=>current,request:async(url,options)=>{if(!url.endsWith('/start'))return {};const body=JSON.parse(options.body);starts.push(body);return response(body.budget);}});
  api.restore(study());await api.evaluate(payload(current));await api.evaluate(payload(current));
  assert.deepEqual(starts.map(item=>item.budget),['FAST','STANDARD']);assert.equal(api.getState().phase,'COMPLETE');assert.equal(api.decisionSnapshot().status,'APPROXIMATE');api.invalidate();
});

test('action-bound refinement can continue after global convergence, or stop when certified separated',async()=>{
  for(const recommended of [true,false]){
    const api=createUI(),current=context(),budgets=[];
    api.init({getContext:()=>current,request:async(url,options)=>{if(!url.endsWith('/start'))return {};const body=JSON.parse(options.body);budgets.push(body.budget);
      return response(body.budget,{result:{...result('SOLVED'),convergence:{thresholdMet:true},adaptation:{refinementRecommended:recommended}}});}});
    api.restore(study());await api.evaluate(payload(current));
    assert.deepEqual(budgets,recommended?['FAST','STANDARD']:['FAST']);api.invalidate();
  }
});

test('in-flight duplicate FAST requests share the current request and retain no stale callbacks',async()=>{
  const api=createUI(),current=context();let count=0,resolveStart;
  api.init({getContext:()=>current,request:async(url)=>{if(url.endsWith('/cancel'))return {};count++;return new Promise(resolve=>resolveStart=resolve);}});
  const first=api.evaluate(payload(current));await tick();await api.evaluate(payload(current));assert.equal(count,1);
  resolveStart(response('FAST',{phase:'UNSUPPORTED',result:{status:'NOT_SOLVED',actions:[]}}));await first;api.invalidate();
});

test('a covered FAST build with no iteration budget receives one STANDARD refinement',async()=>{
  const api=createUI(),current=context(),budgets=[];
  api.init({getContext:()=>current,request:async(url,options)=>{if(!url.endsWith('/start'))return {};const body=JSON.parse(options.body);budgets.push(body.budget);
    return body.budget==='FAST'?response('FAST',{phase:'UNSUPPORTED',result:{status:'NOT_SOLVED',actions:[],reasons:[{code:'BUDGET_BEFORE_FIRST_STRATEGY'}]}}):response('STANDARD');}});
  api.restore(study());await api.evaluate(payload(current));assert.deepEqual(budgets,['FAST','STANDARD']);assert.equal(api.getState().phase,'COMPLETE');api.invalidate();
});

test('restored study survives initialization before the ledger and clears on the next hand',()=>{
  const api=createUI();let current={};api.init({getContext:()=>current,request:async()=>({})});api.restore(study());api.invalidate();
  assert.equal(api.serialize().handId,'hand-1');current=context();assert.equal(api.getState().configured,true);
  api.invalidate();assert.equal(api.serialize().handId,'hand-1');current.multiway.handId='hand-2';current.state.handId='hand-2';api.invalidate();assert.equal(api.serialize(),null);
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
