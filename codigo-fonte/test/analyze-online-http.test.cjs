'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-analyze-online-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const {server}=require('../server'),pool=require('../src/analysis-worker');
const {decide}=require('../src/decision-engine');
const {buildAnalyzeInput}=require('../src/analyze-policy');
let origin;
test.before(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{await pool.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
async function post(route,payload){const r=await fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});assert.equal(r.status,200);return r.json();}
const cost={type:'PERCENT_CAPPED',rate:.05,cap:6,noFlopNoDrop:true,rounding:'FLOOR_CENT',source:'SYNTHETIC_STUDY',version:'1'};
const observation={variant:'PLO5_HIGH',heroCards:['As','Ks','Qh','Jh','Tc'],board:[],position:'BB',players:2,potBeforeAction:4,amountToCall:0,effectiveStack:98,heroContribution:2,
  opponents:[{contribution:2}],bigBlind:2,legal:{actions:['CHECK','RAISE'],minTo:4,maxTo:6},actionHistory:[]};

test('Analyze HTTP matches the public policy adapter, including the big-blind option and paired inference',async()=>{
  for (const position of ['BB','BTN']) {
    const obs=position==='BB'?observation:{...observation,position:'BTN',heroContribution:1,amountToCall:1,potBeforeAction:3,legal:{actions:['FOLD','CALL','RAISE'],minTo:4,maxTo:6}};
    const input=buildAnalyzeInput(obs,{study:true,callProbability:.55,sizeFraction:.5,samples:512,rakeSchedule:cost});
    const direct=decide(input),http=await post('/api/analyze',input);
    assert.equal(http.status,'OK');assert.deepEqual(http.legalActions,direct.legalActions);
    for(const key of ['equity','samples','confidenceInterval95'])assert.deepEqual(http.equity[key],direct.equity[key]);
    assert.deepEqual(http.ev,direct.ev);assert.deepEqual(http.recommendation,direct.recommendation);
    assert.equal(http.analysisDiagnostics.selectionMethod,'SHARED_EQUITY_AFFINE_DIFFERENCES');
    assert.deepEqual(http.provenance.rake.schedule,cost);
    const nestedOnly={...input};delete nestedOnly.heroContribution;
    const nestedResult=await post('/api/analyze',nestedOnly);assert.deepEqual(nestedResult.legalActions,direct.legalActions);assert.deepEqual(nestedResult.ev,direct.ev);
    const answer=await post('/api/analysis/doubt',{input,question:'Explain the decision and costs',responseMode:'LOCAL_FIRST'});
    assert.equal(answer.context.analysisId,http.analysisId);
    assert.deepEqual(answer.context.costModel,http.provenance.rake);
    assert.deepEqual(answer.context.analysisDiagnostics,http.analysisDiagnostics);
  }
});

test('cost schedule and inference are part of the cache identity; preview remains non-actionable',async()=>{
  const input=buildAnalyzeInput(observation,{study:true,callProbability:.55,sizeFraction:.5,samples:512,rakeSchedule:cost});
  const first=await post('/api/analyze',input),cached=await post('/api/analyze',input);
  assert.equal(cached.performance.cacheHit,true);assert.equal(cached.performance.monteCarloSamples,0);
  const changed=await post('/api/analyze',{...input,rakeSchedule:{...cost,rate:.1}});
  assert.notEqual(first.analysisId,changed.analysisId);assert.equal(changed.performance.cacheHit,false);
  const marginal=await post('/api/analyze',{...input,selectionInference:'MARGINAL'});
  assert.notEqual(first.analysisId,marginal.analysisId);assert.deepEqual(first.ev,marginal.ev);
  const preview=await post('/api/analyze',{...input,analysisPhase:'PREVIEW'});
  assert.equal(preview.recommendation.status,'PROVISIONAL');assert.equal(preview.recommendation.action,null);
  assert.equal(preview.analysisDiagnostics.abstained,true);
  assert.ok(preview.analysisDiagnostics.reasonCodes.includes('PROVISIONAL'));
});

test('experiment endpoint serves aggregate model evidence separately from a hand',async()=>{
  const r=await fetch(origin+'/api/analysis/experiments');assert.equal(r.status,200);
  const data=await r.json();assert.ok(['OK','NOT_EXECUTED'].includes(data.status));
  if(data.report){assert.equal(data.report.evidenceOrigin,'SIMULATION');assert.ok(Array.isArray(data.report.scenarios));assert.equal(data.report.rawHands,undefined);}
});

test('basic HTTP analysis separates missing price, explicit CHECK, costs and dead-card identity',async()=>{
 const input={variant:'PLO4_HIGH',heroCards:['As','Kd','Qc','Jh'],board:['2s','3d','4c'],players:2,unknownOpponentModel:'UNIFORM',opponentOverrides:[],samples:512,seed:913};
 const blank=await post('/api/analyze',{...input,amountToCall:'  '});
 assert.equal(blank.status,'OK');assert.equal(blank.state.amountToCall,null);
 assert.equal(blank.continuationAssessment.status,'UNAVAILABLE');assert.equal(blank.statistics.equity.share,blank.equity.equity);
 assert.equal(blank.statistics.model.kind,'UNIFORM_LEGAL_HANDS');assert.equal(blank.provenance.rake.mode,'UNKNOWN');
 const check=await post('/api/analyze',{...input,amountToCall:0});assert.equal(check.continuationAssessment.status,'FREE_CHECK');
 const noCosts=await post('/api/analyze',{...input,potBeforeAction:100,amountToCall:10,costInputMissing:['rakeSchedule.rate']});
 assert.deepEqual(noCosts.continuationAssessment.missingInputs,['rakeSchedule.rate']);assert.equal(noCosts.ev.actions.CALL.ev,null);
 const dead=await post('/api/analyze',{...input,deadCards:['7s']});
 assert.notEqual(dead.provenance.inputHash,blank.provenance.inputHash);assert.equal(dead.handInsights.nextCard.unseenCards,44);
 const repeat=await post('/api/analyze',{...input,deadCards:['As']});assert.equal(repeat.status,'NO_DECISION');
 const coach=await post('/api/analysis/doubt',{input,question:'Explain this hand',responseMode:'LOCAL_FIRST'});
 assert.equal(coach.context.statistics.equity.share,blank.equity.equity);
});
