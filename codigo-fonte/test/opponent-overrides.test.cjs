'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-seat-overrides-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const {server}=require('../server'),pool=require('../src/analysis-worker');
const {prepareOpponentOverrides}=require('../src/opponent-overrides');
const {decide}=require('../src/decision-engine');
const multiway=require('../src/multiway-session');
const base={variant:'PLO5_HIGH',heroCards:['As','Ks','Qh','Jh','Td'],board:['2c','3d','4h'],position:'BTN',players:3,potBeforeAction:12,amountToCall:2,effectiveStack:100,unknownOpponentModel:'UNIFORM',assumeNoRake:true,futureStreetModel:{type:'SHOWDOWN_ONLY'},samples:256,seed:42};
const range={hands:[['Ah','Ad','Kc','Qc','Jc']]};
let origin;
test.before(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{await pool.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
async function post(payload){const response=await fetch(origin+'/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});return{httpStatus:response.status,...await response.json()};}

test('new opt-in API with no overrides clears unscoped legacy hypotheses and keeps uniform equity/CALL',async()=>{
 const input={...base,opponentOverrides:[],opponentProfile:'MANIAC',opponentHands:[range.hands[0]],opponentRangeProfile:{position:'BTN'},foldEquity:.99,continuationEquity:.99,aggressionStudy:{enabled:true},actionResponseModels:{RAISE:{unsafe:true}}};
 const prepared=prepareOpponentOverrides(input);assert.equal(prepared.opponentProfile,undefined);assert.equal(prepared.foldEquity,undefined);assert.equal(prepared.opponentHands,undefined);assert.equal(prepared.aggressionStudy,undefined);assert.ok(prepared.opponentRanges.every(r=>r.kind==='UNIFORM'));
 const actual=await post(input),expected=decide(base);assert.equal(actual.status,'OK',actual.reason);assert.equal(actual.equity.equity,expected.equity.equity);assert.equal(actual.ev.actions.CALL.ev,expected.ev.actions.CALL.ev);assert.equal(actual.ev.actions.RAISE.status,'NOT_MODELED');
 assert.deepEqual(actual.opponentModelScope.unknownResponseSeatIds,[0,1]);assert.deepEqual(actual.opponentModelScope.unknownCardSeatIds,[0,1]);
});
test('range and response probability apply only to selected seat; unspecified seats remain unknown',async()=>{
 const actual=await post({...base,opponentOverrides:[{seatId:1,enabled:true,range,callProbability:.3}]});
 const expected=decide({...base,opponentRanges:[{kind:'UNIFORM'},range]});
 assert.equal(actual.status,'OK',actual.reason);assert.equal(actual.equity.equity,expected.equity.equity);assert.equal(actual.ev.actions.CALL.ev,expected.ev.actions.CALL.ev);
 assert.equal(actual.ranges[0].kind,'UNIFORM');assert.equal(actual.ranges[1].source,'USER_SUPPLIED_HYPOTHESIS');assert.equal(actual.ranges[1].id,'seat-1');
 assert.deepEqual(actual.opponentModelScope.unknownResponseSeatIds,[0]);assert.deepEqual(actual.opponentModelScope.unknownCardSeatIds,[0]);
 assert.equal(actual.opponentModelScope.seats[0].callProbability,undefined);assert.equal(actual.opponentModelScope.seats[1].callProbability,.3);assert.deepEqual(actual.provenance.opponents,actual.opponentModelScope);
});
test('seat hypothesis changes invalidate cache/provenance without changing unrelated equity or CALL',async()=>{
 const payload=probability=>({...base,opponentOverrides:[{seatId:1,enabled:true,range,callProbability:probability}]});
 const first=await post(payload(.21)),changed=await post(payload(.79)),cached=await post(payload(.79));
 assert.notEqual(first.provenance.inputHash,changed.provenance.inputHash);assert.equal(changed.performance.cacheHit,false);assert.equal(cached.performance.cacheHit,true);
 for(const field of['equity','samples','confidenceInterval95','seed'])assert.deepEqual(first.equity[field],changed.equity[field]);
 assert.deepEqual(first.ev,changed.ev);assert.equal(changed.opponentModelScope.seats[1].callProbability,.79);assert.deepEqual(cached.opponentModelScope,changed.opponentModelScope);
});
test('incomplete probabilities, acceptance or sizing do not block otherwise valid equity/CALL',async()=>{
 for(const extra of[
  {opponentOverrides:[{seatId:0,enabled:true,callProbability:.7}]},
  {opponentOverrides:[0,1].map(seatId=>({seatId,enabled:true,callProbability:.7}))},
  {opponentOverrides:[0,1].map(seatId=>({seatId,enabled:true,callProbability:.7})),opponentStudyAccepted:true},
 ]){const result=await post({...base,...extra});assert.equal(result.status,'OK',result.reason);assert.equal(result.ev.actions.CALL.status,'MODELED');assert.equal(result.ev.actions.RAISE.status,'NOT_MODELED');assert.equal(result.opponentModelScope.aggression.status,'NOT_MODELED');}
});
test('all explicit uniform probabilities plus complete legal contributions enable only the stated study',async()=>{
 const result=await post({...base,opponentOverrides:[{seatId:0,enabled:true,callProbability:0},{seatId:1,enabled:true,callProbability:1}],opponentStudyAccepted:true,heroContribution:0,minRaiseTo:4,raiseTo:6,opponentContributions:[{seatId:0,contribution:2},{seatId:1,contribution:2}]});
 assert.equal(result.status,'OK',result.reason);assert.equal(result.opponentModelScope.aggression.status,'READY');assert.equal(result.ev.actions.RAISE.status,'MODELED');assert.equal(result.scenarioSummary.source,'USER_SUPPLIED_HYPOTHESIS');
 assert.equal(result.ev.actions.RAISE.source,'USER_SUPPLIED_HYPOTHESIS');assert.deepEqual(result.ev.actions.RAISE.scenarioBreakdown[0].callers,['seat-1']);
});
test('specific ranges never reuse caller-count uniform aggression and do not erase CALL',async()=>{
 const result=await post({...base,opponentOverrides:[{seatId:0,enabled:true,range,callProbability:.5},{seatId:1,enabled:true,callProbability:.5}],opponentStudyAccepted:true,heroContribution:0,minRaiseTo:4,raiseTo:6,opponentContributions:[{seatId:0,contribution:2},{seatId:1,contribution:2}]});
 assert.equal(result.status,'OK',result.reason);assert.equal(result.ev.actions.CALL.status,'MODELED');assert.equal(result.ev.actions.RAISE.status,'NOT_MODELED');assert.equal(result.opponentModelScope.aggression.reasonCode,'SPECIFIC_RANGE_CONTINUATION_UNSUPPORTED');
});
test('invalid, duplicate, inactive seats and invalid range/probability fail explicitly',()=>{
 assert.throws(()=>prepareOpponentOverrides({...base,players:1000000000,opponentOverrides:[]}));
 for(const opponentOverrides of[
  [{seatId:2,enabled:true,range}],[{seatId:0,enabled:true},{seatId:'0',enabled:true}],
  [{seatId:0,enabled:true,callProbability:.0/0}],[{seatId:0,enabled:true,callProbability:'0.5'}],
  [{seatId:0,enabled:true,range:{hands:[['Ah','Ad']]}}],[{seatId:0,range}],
 ])assert.throws(()=>prepareOpponentOverrides({...base,opponentOverrides}));
});
test('disabled and subsequent empty overrides have no learned/persisted model',()=>{
 const one=prepareOpponentOverrides({...base,opponentOverrides:[{seatId:0,enabled:true,range,callProbability:.5}]});
 const two=prepareOpponentOverrides({...base,opponentOverrides:[]});
 const disabled=prepareOpponentOverrides({...base,opponentOverrides:[{seatId:0,enabled:false,range,callProbability:.9}]});
 assert.equal(one.opponentModelScope.seats[0].cardsModel,'USER_RANGE');assert.deepEqual(two.opponentModelScope,disabled.opponentModelScope);
 assert.deepEqual(two.opponentModelScope.unknownResponseSeatIds,[0,1]);
});
const config={variant:'PLO5_HIGH',playerCount:3,heroPosition:'BTN',startingStack:100,smallBlind:1,bigBlind:2,heroCards:base.heroCards};
test('Multiway mapping uses physical active IDs and refuses transfer after fold',async()=>{
 const record=multiway.start(config).multiway,folded=multiway.step(record,{type:'MARK_FOLD',actor:0}).multiway;
 const before=await post({...base,multiway:record,opponentOverrides:[{seatId:1,enabled:true,range}]});assert.equal(before.status,'OK');assert.equal(before.ranges[1].id,'seat-1');
 const after=await post({...base,multiway:folded,opponentOverrides:[{seatId:1,enabled:true,range}]});assert.equal(after.status,'OK');assert.equal(after.ranges[0].id,'seat-1');assert.deepEqual(after.observedOpponentIds,[1]);assert.equal(after.ev.actions.CALL.status,'MODELED');
 const stale=await post({...base,multiway:folded,opponentOverrides:[{seatId:0,enabled:true,range}]});assert.equal(stale.httpStatus,400);
 const hero=await post({...base,multiway:record,opponentOverrides:[{seatId:2,enabled:true,range}]});assert.equal(hero.httpStatus,400);
});
test('Multiway ledger supplies real contributions while unknown responses retain existing CALL guard',async()=>{
 const record=multiway.start(config).multiway;
 const partial=await post({...base,multiway:record,opponentOverrides:[{seatId:0,enabled:true,callProbability:.3}]});assert.equal(partial.status,'OK');assert.equal(partial.equity.opponents,2);assert.equal(partial.ev.actions.CALL.status,'NOT_MODELED');
 const all=await post({...base,multiway:record,opponentOverrides:[0,1].map(seatId=>({seatId,enabled:true,callProbability:.3})),opponentStudyAccepted:true,raiseTo:6,heroContribution:1000,opponentContributions:[{seatId:0,contribution:999},{seatId:1,contribution:999}]});
 assert.equal(all.status,'OK',all.reason);assert.equal(all.opponentModelScope.aggression.status,'READY');assert.equal(all.ev.actions.CALL.status,'MODELED');assert.equal(all.ev.actions.RAISE.status,'MODELED');assert.equal(all.state.potBeforeAction,3);
});
test('legacy direct callers without new opt-in field retain their original behavior',()=>{
 const input={...base,opponentRanges:[range]};assert.equal(prepareOpponentOverrides(input),input);
});
