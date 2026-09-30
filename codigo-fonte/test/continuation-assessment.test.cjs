'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-continuation-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const {server}=require('../server'),pool=require('../src/analysis-worker');
const {assessContinuation}=require('../src/continuation-assessment');
const {decide}=require('../src/decision-engine');
const {calculateActionEV}=require('../src/action-ev-engine');
const {attachAnalysisContract}=require('../src/analysis-contract');
const multiway=require('../src/multiway-session');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const base={variant:'PLO5_HIGH',heroCards:['As','Ah','Ks','Kh','Qd'],board:['2c','3d','4h'],position:'BTN',players:6,potBeforeAction:12,amountToCall:4,effectiveStack:100,unknownOpponentModel:'UNIFORM',assumeNoRake:true,futureStreetModel:{type:'SHOWDOWN_ONLY'},samples:500,seed:42};
const positive={...base,heroCards:['As','Ks','Qh','Jh','Td'],board:['Qs','Js','Ts','2c','3d']};
const exact={...base,players:2,heroCards:['Js','Ts','2c','3d','4h'],board:['As','Ks','Qs','Jh','Th'],opponentHands:[['2d','3h','4c','5c','7d']],unknownOpponentModel:undefined};
let origin;
test.before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{await pool.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
async function post(route,payload){const response=await fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});assert.equal(response.status,200);return response.json();}
function publicData(call,{q=.4,bounds=[.3,.5],method='MONTE_CARLO',amount=4,opponents=1}={}){return{status:'OK',analysisStage:'FINAL',state:{opponentCount:opponents,amountToCall:amount,street:'FLOP',board:['2c','3d','4h']},legalActions:['FOLD','CALL','RAISE'],equity:{equity:q,confidenceInterval95:bounds,method,opponents},ev:{actions:{CALL:call},comparisonComplete:false}};}
const simpleCall=(ev,bounds)=>({legal:true,status:'MODELED',model:'SHOWDOWN_ONLY',ev,netPot:16,confidenceInterval95:bounds,missingInputs:[]});

test('real positive, negative and uncertain CALL fixtures work despite an unmodeled RAISE',()=>{
 const cases=[[positive,'FAVORABLE',12],[base,'UNFAVORABLE',-2.656],[{...base,players:2,amountToCall:9.052631578947368},'UNCERTAIN',0]];
 for(const[input,status,ev]of cases){const result=decide(input),a=result.continuationAssessment;assert.equal(result.status,'OK');assert.equal(result.recommendation.status,'INCOMPLETE');assert.equal(result.ev.actions.RAISE.status,'NOT_MODELED');assert.equal(a.status,status);near(a.evChips,ev);assert.deepEqual(a.evBounds,result.ev.actions.CALL.confidenceInterval95);assert.equal(a.boundsKind,'SAMPLING_INTERVAL_95');assert.equal(result.equity.samples,500);assert.equal(result.equity.seed,42);assert.equal(a.identifiesBestAction,false);assert.equal(a.guaranteesWin,false);assert.equal(a.externallyValidated,false);assert.equal(a.excludesBetRaise,true);}
});
test('reading continuation is immutable and does not create samples or change strategy/EV',()=>{
 const result=decide(positive),before=JSON.stringify(result);const first=assessContinuation(result),second=assessContinuation(result);
 assert.equal(JSON.stringify(result),before);assert.deepEqual(first,second);assert.equal(result.equity.samples,500);assert.equal(result.recommendation.action,null);
 first.evBounds[0]=-999;assert.notEqual(result.ev.actions.CALL.confidenceInterval95[0],-999);
});
test('exact showdown CALL can be classified without pretending to have a sampling interval',()=>{
 for(const[input,status,ev]of[[exact,'FAVORABLE',12],[{...exact,heroCards:exact.opponentHands[0],opponentHands:[exact.heroCards]},'UNFAVORABLE',-4]]){const result=decide(input),a=result.continuationAssessment;assert.equal(result.equity.method,'EXACT');assert.equal(result.equity.confidenceInterval95,null);assert.equal(a.status,status);assert.equal(a.boundsKind,'EXACT_MODEL_VALUE');assert.deepEqual(a.evBounds,[ev,ev]);}
});
test('a free legal check stays neutral even without a future betting or cost model',()=>{
 const result=decide({...positive,amountToCall:0,futureStreetModel:undefined,assumeNoRake:false}),a=result.continuationAssessment;
 assert.equal(result.ev.actions.CHECK.status,'NOT_MODELED');assert.equal(a.status,'FREE_CHECK');assert.equal(a.action,'CHECK');assert.equal(a.evChips,null);assert.equal(a.evBounds,null);assert.equal(a.breakEvenEquity,null);assert.equal(a.equityMarginPP,null);assert.equal(a.guaranteesWin,false);
 const weak=decide({...base,amountToCall:0,futureStreetModel:undefined,assumeNoRake:false});assert.equal(weak.continuationAssessment.status,'FREE_CHECK');
});
test('missing cost, incomplete opponent coverage, unavailable calculation and illegal CALL cannot become favorable',()=>{
 const missing=decide({...positive,assumeNoRake:false});assert.equal(missing.continuationAssessment.status,'UNAVAILABLE');assert.deepEqual(missing.continuationAssessment.reasonCodes,['COSTS_REQUIRED']);
 const coverage=decide({...exact,players:3});assert.equal(coverage.status,'OK');assert.equal(coverage.continuationAssessment.status,'UNAVAILABLE');assert.deepEqual(coverage.continuationAssessment.reasonCodes,['INCOMPLETE_OPPONENT_COVERAGE']);
 const available=decide(positive);
 assert.equal(assessContinuation({...available,status:'NO_DECISION'}).status,'UNAVAILABLE');
 assert.equal(assessContinuation({...available,legalActions:['FOLD','RAISE']}).status,'UNAVAILABLE');
 assert.equal(assessContinuation({...available,trainingEvaluation:{}}),null);
});
test('zero-touching, absent, reversed and inconsistent bounds retain uncertainty; floating residue cannot create a signal',()=>{
 const cases=[simpleCall(.5,[0,1]),simpleCall(-.5,[-1,0]),simpleCall(1e-12,[1e-12,1e-12]),simpleCall(1,undefined),simpleCall(1,[2,0]),simpleCall(10,[1,2]),simpleCall(.5,[NaN,1])];
 for(const call of cases)assert.equal(assessContinuation(publicData(call)).status,'UNCERTAIN');
 assert.deepEqual(assessContinuation(publicData(simpleCall(10,[1,2]))).reasonCodes,['INCONSISTENT_EV_BOUNDS']);
});
test('time-budget metadata never overrides the supplied valid uncertainty interval',()=>{
 const data=publicData(simpleCall(.1,[-1,1]));data.equity.stopReason='TIME_BUDGET';assert.equal(assessContinuation(data).status,'UNCERTAIN');
 data.ev.actions.CALL=simpleCall(2,[1,3]);assert.equal(assessContinuation(data).status,'FAVORABLE');
 assert.equal(assessContinuation({...data,analysisStage:'PROVISIONAL'}).status,'PROVISIONAL');
});
test('current price margins use net pot after percent/cap costs and do not invent a maximum call',()=>{
 const schedule={type:'PERCENT_CAPPED',rate:.05,cap:1,noFlopNoDrop:true,rounding:'FLOOR_CENT',source:'USER_PROVIDED',version:'1'};
 const input={potBeforeAction:12,amountToCall:4,effectiveStack:100,equity:.25,legalActions:['FOLD','CALL'],rakeSchedule:schedule,board:[]};
 const call=calculateActionEV(input).actions.CALL;call.confidenceInterval95=[.24*call.netPot-4,.26*call.netPot-4];
 const a=assessContinuation(publicData(call,{q:.25,bounds:[.24,.26]}));
 near(call.rake,.8);near(call.netPot,15.2);near(a.evChips,-.2);near(a.breakEvenEquity,4/15.2);near(a.equityMarginPP,(.25-4/15.2)*100);near(a.conservativeMarginPP,(.24-4/15.2)*100);assert.equal(a.status,'UNFAVORABLE');
 assert.equal(a.maxCall,undefined);assert.equal(a.maximumCall,undefined);
});
test('a zero net pot has no finite break-even equity and cannot be presented as a zero price threshold',()=>{
 const result=decide({...positive,assumeNoRake:false,rake:16}),a=result.continuationAssessment;
 assert.equal(result.ev.actions.CALL.netPot,0);assert.equal(a.status,'UNFAVORABLE');assert.equal(a.evChips,-4);assert.equal(a.breakEvenEquity,null);assert.equal(a.equityMarginPP,null);assert.equal(a.conservativeMarginPP,null);
});
function scenarioCall(withBounds=true){
 const branch=(id,probability,callers,equity,bounds)=>({id,probability,callers,equity,equityOpponentIds:callers.map(c=>c.id),equitySource:'CALCULATED_CONDITIONAL',...(withBounds?{equityInterval:bounds,equityIntervalLevel:.95}:{})});
 return calculateActionEV({players:3,potBeforeAction:20,amountToCall:3,effectiveStack:98,equity:.12,assumeNoRake:true,legalActions:['FOLD','CALL','RAISE'],actionResponseModels:{CALL:{type:'SCENARIO_SHOWDOWN_ONLY',source:'USER_PROVIDED',action:'CALL',targetStreetTotal:5,heroContribution:2,opponents:[{id:'a',contribution:5,stackRemaining:95},{id:'b',contribution:1,stackRemaining:99}],scenarios:[branch('a',.4,[{id:'a',additional:0}],.6,[.55,.65]),branch('ab',.6,[{id:'a',additional:0},{id:'b',additional:4}],.25,[.2,.3])]}}}).actions.CALL;
}
test('conditional response envelopes are labeled separately and never borrow a global equity margin',()=>{
 const call=scenarioCall(),a=assessContinuation(publicData(call,{q:.12,bounds:[.08,.16],amount:3,opponents:2}));
 assert.equal(call.status,'MODELED');assert.equal(a.status,'FAVORABLE');assert.equal(a.boundsKind,'CONDITIONAL_ENVELOPE');assert.deepEqual(a.evBounds,call.conditionalEvEnvelope);assert.ok(a.limitations.includes('CONDITIONAL_ON_RESPONSE_ASSUMPTIONS'));assert.equal(a.breakEvenEquity,null);assert.equal(a.equityMarginPP,null);assert.equal(a.conservativeMarginPP,null);
 const unsupported=assessContinuation(publicData(scenarioCall(false),{q:.12,bounds:null,method:'EXACT',amount:3,opponents:2}));assert.equal(unsupported.status,'UNCERTAIN');assert.equal(unsupported.evBounds,null);assert.equal(unsupported.boundsKind,null);
});
test('contract hashes the final assessment and a preview can never inherit the final favorable signal',()=>{
 const result=decide(positive),final=attachAnalysisContract({...result,analysisStage:'FINAL'},positive),preview=attachAnalysisContract({...result,analysisStage:'PROVISIONAL'},positive);
 assert.equal(final.continuationAssessment.status,'FAVORABLE');assert.equal(preview.continuationAssessment.status,'PROVISIONAL');assert.equal(preview.continuationAssessment.evChips,null);assert.equal(preview.continuationAssessment.evBounds,null);assert.notEqual(final.provenance.outputHash,preview.provenance.outputHash);assert.notEqual(final.analysisId,preview.analysisId);assert.deepEqual(final.ev,preview.ev);
});
test('HTTP final/preview/cache and coach retain the same scope, uncertainty and current result identity',async()=>{
 const input={...positive,opponentOverrides:[]},final=await post('/api/analyze',input),cached=await post('/api/analyze',input),preview=await post('/api/analyze',{...input,analysisPhase:'PREVIEW'});
 assert.equal(final.continuationAssessment.status,'FAVORABLE');assert.equal(final.recommendation.status,'INCOMPLETE');assert.equal(cached.performance.cacheHit,true);assert.equal(cached.performance.monteCarloSamples,0);assert.deepEqual(cached.continuationAssessment,final.continuationAssessment);assert.equal(cached.analysisId,final.analysisId);assert.equal(preview.continuationAssessment.status,'PROVISIONAL');assert.equal(preview.recommendation.action,null);assert.notEqual(preview.analysisId,final.analysisId);
 for(const key of['equity','samples','confidenceInterval95','seed'])assert.deepEqual(final.equity[key],preview.equity[key]);
 const answer=await post('/api/analysis/doubt',{input,question:'Posso continuar pelo preço atual?',responseMode:'LOCAL_FIRST'});assert.equal(answer.context.analysisId,final.analysisId);assert.deepEqual(answer.context.continuationAssessment,final.continuationAssessment);
 // The coach deliberately computes/loads the FINAL budget, even if a caller
 // supplies PREVIEW. It must match that final identity, never relabel preview.
 const preliminary=await post('/api/analysis/doubt',{input:{...input,analysisPhase:'PREVIEW'},question:'Posso continuar?',responseMode:'LOCAL_FIRST'});assert.deepEqual(preliminary.context.continuationAssessment,final.continuationAssessment);assert.equal(preliminary.context.analysisId,final.analysisId);assert.notEqual(preliminary.context.analysisId,preview.analysisId);
 assert.match(preliminary.answer.summary.headline,/favorable/i);
 const follow=await post('/api/analysis/doubt',{input,question:'Vale seguir nesta mão?',responseMode:'LOCAL_FIRST'});assert.match(follow.answer.summary.headline,/favorable/i);assert.match(follow.answer.summary.points.join(' '),/does not compare BET\/RAISE/);
});
test('HTTP Multiway unmodeled outstanding contributions remain blocked after worker calculation and in coach',async()=>{
 const config={variant:'PLO5_HIGH',playerCount:3,heroPosition:'BTN',startingStack:100,smallBlind:1,bigBlind:2,heroCards:positive.heroCards};
 const multiwayRecord=multiway.start(config).multiway,input={...positive,board:[],multiway:multiwayRecord,opponentOverrides:[]};
 const result=await post('/api/analyze',input);assert.equal(result.status,'OK');assert.equal(result.ev.actions.CALL.status,'NOT_MODELED');assert.equal(result.continuationAssessment.status,'UNAVAILABLE');assert.deepEqual(result.continuationAssessment.reasonCodes,['CALL_MODEL_UNAVAILABLE']);assert.equal(result.continuationAssessment.evChips,null);assert.equal(result.continuationAssessment.breakEvenEquity,null);
 const answer=await post('/api/analysis/doubt',{input,question:'É favorável pagar?',responseMode:'LOCAL_FIRST'});assert.deepEqual(answer.context.continuationAssessment,result.continuationAssessment);
 const folded=multiway.step(multiwayRecord,{type:'MARK_FOLD',actor:0}).multiway,available=await post('/api/analyze',{...input,multiway:folded});assert.equal(available.ev.actions.CALL.status,'MODELED');assert.notEqual(available.continuationAssessment.status,'UNAVAILABLE');
});
test('HTTP early Multiway guards and invalid card state expose an unavailable assessment explicitly',async()=>{
 const config={variant:'PLO5_HIGH',playerCount:3,heroPosition:'BTN',startingStack:100,smallBlind:1,bigBlind:2,heroCards:positive.heroCards};
 const start=multiway.start(config).multiway,outOfTurn=multiway.step(start,{type:'ACT',actor:2,action:'CALL'}).multiway;
 const blocked=await post('/api/analyze',{...base,multiway:outOfTurn,opponentOverrides:[]});assert.equal(blocked.status,'NO_DECISION');assert.ok(blocked.reasonCodes.includes('NOT_HERO_TURN'));assert.equal(blocked.continuationAssessment.status,'UNAVAILABLE');assert.equal(blocked.continuationAssessment.evChips,null);
 const incomplete=await post('/api/analyze',{...base,heroCards:['As'],opponentOverrides:[]});assert.equal(incomplete.status,'NO_DECISION');assert.equal(incomplete.continuationAssessment.status,'UNAVAILABLE');assert.equal(incomplete.continuationAssessment.evBounds,null);
});
