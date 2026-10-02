'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const tools=require('../public/simulation-tools'),{createService}=require('../src/multiway-simulation');

test('transport retries the exact lost acknowledgement and never retries auth/domain errors',async()=>{
  const service=createService(),body=JSON.stringify({config:{playerCount:2,heroPosition:'SB'},requestId:'lost-ack'});
  let calls=0;const states=[];
  const send=tools.createTransport(async(_,options)=>{
    assert.equal(options.body,body);const payload=JSON.parse(options.body),session=service.start('owner',payload.config,payload.requestId);
    if(calls++===0)throw new TypeError('Failed to fetch');return {session};
  },{wait:async()=>{},onState:state=>states.push(state)});
  const result=await send('/start',{body});assert.equal(calls,2);assert.equal(service._testing.size(),1);
  assert.deepEqual(states,['RECONNECTING','CONNECTED']);assert.equal(result.session.revision,0);
  for(const failure of [Object.assign(Error('Sign in'),{status:401}),Object.assign(Error('Changed'),{status:409}),Object.assign(Error('Identity changed'),{code:'AUTH_SESSION_CHANGED'})]){
    calls=0;const failing=tools.createTransport(async()=>{calls++;throw failure;},{wait:async()=>{}});
    await assert.rejects(failing('/state',{}),error=>error===failure);assert.equal(calls,1);
  }
});

test('transport exhaustion is recoverable; explicit cancellation does not resend',async()=>{
  let calls=0;const send=tools.createTransport(async()=>{calls++;throw TypeError('Failed to fetch');},{wait:async()=>{}});
  await assert.rejects(send('/step',{body:'same'}),{code:'SIMULATION_TRANSPORT_UNCERTAIN',retryable:true});assert.equal(calls,2);
  const cancelled=new AbortController();cancelled.abort();await assert.rejects(send('/step',{signal:cancelled.signal}),{name:'AbortError'});assert.equal(calls,2);
});

test('transport enforces its deadline even if a dependency ignores the abort signal',async()=>{
  let calls=0;const send=tools.createTransport(async()=>{calls++;return new Promise(()=>{});},{timeoutMs:5,wait:async()=>{}});
  await assert.rejects(send('/step',{}),{retryable:true});assert.equal(calls,2);
});

test('export checker reconstructs the committed deal and verifies exact settlement, rejecting altered evidence',()=>{
  const {checkDataset}=require('../scripts/simulation-report-check.cjs');
  const service=createService(),owner='checker';let s=service.start(owner,{playerCount:2,heroPosition:'SB',startingStack:10});
  s=service.mutate(owner,{id:s.id,revision:s.revision,requestId:'finish',operation:'FINISH'});
  const report={id:s.id,publicRecord:s.multiway,deal:s.deal,audit:s.audit,outcome:s.outcome,validation:s.validation,decisions:[]};
  const dataset={schema:'THEIBS_SIMULATION_REPORT_V2',source:'SIMULATION_ONLY',reports:[report]};
  assert.equal(checkDataset(dataset).checks[0].status,'DEAL_AND_SETTLEMENT_VERIFIED');
  const altered=structuredClone(dataset);altered.reports[0].deal.commitment='false';assert.throws(()=>checkDataset(altered),/commitment mismatch/);
});

test('browser calculation projection equals the dealer public projection including custom sizing and excludes audit',()=>{
  const service=createService(),session=service.start('owner',{playerCount:2,heroPosition:'SB'});
  session.audit={seed:'private',hands:['hidden'],runout:['future']};
  assert.deepEqual(tools.evaluationInput(session,2.35),service.evaluation('owner',session.id,session.revision,2.35));
  assert.equal(JSON.stringify(tools.evaluationInput(session)).includes('private'),false);
});

function report(){
  const config={variant:'PLO5_HIGH'},events=[{type:'ACT',actor:0,action:'CALL'}];
  return {id:'fair-deal',validation:{eligible:true,manualHeroEvents:[0]},publicRecord:{config,events},
    outcome:{stacks:[{id:0,stack:25}]},decisions:[{heroId:0,heroStack:10,bigBlind:2,street:'PREFLOP',
      chosen:{action:'CALL',size:null},publicInput:{config,events:[]},evaluation:{ev:{candidates:[{action:'CALL',size:null,status:'MODELED',ev:4,method:'REFERENCE',confidenceInterval95:[-10,20]}]}}}]};
}
test('held-out outcomes use incremental utility and exact action sizing, excluding incompatible continuations',()=>{
  const r=report(),row=tools.measurements(r)[0];assert.equal(row.realizedBB,7.5);assert.equal(row.estimateBB,2);assert.equal(row.residualBB,5.5);
  assert.deepEqual(row.boundsBB,[-5,10]);assert.equal(tools.summary([r]).count,1);
  for(const patch of [{abandoned:true},{replayed:true},{validation:{eligible:false}},{publicRecord:{config:{variant:'PLO4_HIGH'},events:r.publicRecord.events}}])assert.deepEqual(tools.measurements({...r,...patch}),[]);
  const custom=report();custom.decisions[0].chosen={action:'RAISE',size:7.37};custom.publicRecord.events[0]={type:'ACT',actor:0,action:'RAISE',to:7.37};
  custom.decisions[0].evaluation.ev.candidates=[{action:'RAISE',size:8,status:'MODELED',ev:99}];assert.deepEqual(tools.measurements(custom),[]);
});

test('history compaction retains quality and bounds, and bounds browser storage',()=>{
  const ev={status:'OK',observedState:{revisionKey:'r',handId:'h',board:['hidden?']},ev:{actions:{CALL:{ev:4,confidenceInterval95:[-1,8],assumptions:['duplicated']}},assumptions:['retained'],candidates:[{action:'CALL',ev:4}]} };
  const compact=tools.compactEvaluation(ev);assert.deepEqual(compact.ev.actions.CALL.confidenceInterval95,[-1,8]);assert.deepEqual(compact.ev.assumptions,['retained']);assert.equal(compact.observedState.board,undefined);
  assert.equal(ev.ev.actions.CALL.assumptions.length,1);
  assert.equal(tools.boundedHistory(Array.from({length:101},(_,i)=>({id:i}))).length,100);
  const rows=tools.boundedHistory(Array.from({length:100},(_,i)=>({id:i,large:'x'.repeat(100000)})));assert.ok(JSON.stringify(rows).length<=1400000);assert.equal(rows.at(-1).id,99);
});

test('practice progression books authoritative settled profit once, independently of refills and history trimming',()=>{
  const service=createService(),owner='progress',progress=tools.practiceProgress();
  let s=service.start(owner,{playerCount:2,heroPosition:'SB',startingStack:10});
  s=service.mutate(owner,{id:s.id,revision:s.revision,requestId:'settle-first',operation:'ACT',action:'FOLD'});
  assert.equal(s.outcome.heroNet,-.5);
  tools.recordProgress(progress,s);tools.recordProgress(progress,s);
  assert.equal(tools.progressSummary(progress).netChips,-.5);
  const continuation=service.next(owner,{id:s.id,revision:s.revision,requestId:'next'});
  assert.equal(continuation.session.state.players[continuation.session.state.heroId].startingStack,9.5);
  const refill=service.restart(owner,{id:continuation.session.id,revision:continuation.session.revision,requestId:'refill',config:{playerCount:2,heroPosition:'SB',startingStack:10}});
  tools.recordProgress(progress,refill.previous);
  assert.equal(refill.session.state.players[0].startingStack,10);
  assert.equal(tools.progressSummary(progress).balanceChips,999.5,'A table refill or unknown abandoned payout is not profit');
  const end=service.mutate(owner,{id:refill.session.id,revision:refill.session.revision,requestId:'settle-refill',operation:'ACT',action:'FOLD'});
  tools.recordProgress(progress,end);
  const restored=tools.practiceProgress(JSON.parse(JSON.stringify(progress)));
  tools.recordProgress(restored,end);assert.equal(tools.progressSummary(restored).netChips,-1);
  assert.equal(tools.progressSummary(restored).hands,2);assert.equal(tools.progressSummary(restored).unsettled,1);
  tools.boundedHistory([]);assert.equal(tools.progressSummary(restored).balanceChips,999);
});

test('progress excludes replay and unknown results, preserves cents and stops explicitly at its storage limit',()=>{
  const progress=tools.practiceProgress({settings:{initialChips:100,chipValue:.01,currency:'USD'}});
  tools.recordProgress(progress,{id:'replay',replayed:true,outcome:{heroNet:100}});
  tools.recordProgress(progress,{id:'unknown',outcome:null});
  tools.recordProgress(progress,{id:'old',kind:'BASELINE',abandoned:true});
  for(let i=0;i<120;i++)tools.recordProgress(progress,{id:'cent-'+i,outcome:{heroNet:.01}});
  let totals=tools.progressSummary(progress);assert.equal(totals.netChips,1.2);assert.equal(totals.balanceChips,101.2);assert.equal(totals.replays,1);
  assert.equal(totals.unsettled,2);assert.equal(totals.lastNetChips,.01);assert.equal(totals.points.at(-1).netChips,1.2);
  for(let i=0;i<2100;i++)tools.recordProgress(progress,{id:'later-'+i,outcome:{heroNet:-.01}});
  totals=tools.progressSummary(progress);assert.equal(totals.full,true);assert.equal(progress.entries.length,2000);
  const net=totals.netChips;tools.recordProgress(progress,{id:'overflow',outcome:{heroNet:5000}});assert.equal(tools.progressSummary(progress).netChips,net);
  assert.equal(tools.practiceProgress({settings:{initialChips:-1,chipValue:0,currency:'arbitrary'}}).settings.currency,'BRL');
});

test('action guidance requires the current comparison contract, legal sizing and complete precision before claiming best',()=>{
  const state={legal:{actions:['CALL','RAISE','FOLD'],toCall:1,minTo:2,maxTo:5}};
  const decision={stage:'INCONCLUSIVE',rows:[{action:'CALL',optionId:'CALL',status:'MODELED',evBB:2},{action:'RAISE',optionId:'RAISE:3',size:3,status:'MODELED',evBB:4}],missingLegalActions:[],precision:{bestActionId:'RAISE:3',status:'INCONCLUSIVE',reason:'Another action overlaps.'}};
  let guide=tools.actionGuidance(decision,state);assert.equal(guide.heading,'Current EV leader');assert.equal(guide.row.size,3);assert.equal(guide.reason,'Another action overlaps.');
  for(const stage of ['PROVISIONAL','INCOMPARABLE','UNAVAILABLE','PENDING'])assert.equal(tools.actionGuidance({...decision,stage},state),null);
  assert.equal(tools.actionGuidance(decision,{legal:{...state.legal,maxTo:2.5}}),null);
  assert.equal(tools.actionGuidance({...decision,precision:{bestActionId:'missing'}},state),null);
  assert.equal(tools.actionGuidance({...decision,rows:[{action:'FOLD',optionId:'FOLD',status:'MODELED',evBB:0}],precision:{bestActionId:'FOLD'}},{legal:{actions:['FOLD','CHECK'],toCall:0}}),null);
  const certified={...decision,leaderConclusive:true,precision:{...decision.precision,status:'CONCLUSIVE',leaderConclusive:true}};
  assert.equal(tools.actionGuidance(certified,state).heading,'Best modeled action');
  assert.equal(tools.actionGuidance({...certified,missingLegalActions:['FOLD']},state).conclusive,false);
  assert.equal(tools.actionGuidance({...certified,rows:[...certified.rows,{action:'FOLD',status:'NOT_MODELED',evBB:null}]},state).conclusive,false);
});
