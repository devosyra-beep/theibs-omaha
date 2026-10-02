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
