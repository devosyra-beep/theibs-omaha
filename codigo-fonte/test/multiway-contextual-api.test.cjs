'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-multiway-contextual-api-'));
Object.assign(process.env,{THEIBS_AUTH_REQUIRED:'false',THEIBS_LLM_PROVIDER:'none',THEIBS_MULTIWAY_LLM_PROVIDER:'none',
  THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json')});
const {server}=require('../server'),pool=require('../src/analysis-worker'),mw=require('../src/multiway-session');
const config={variant:'PLO5_HIGH',playerCount:3,heroPosition:'BTN',startingStack:100,smallBlind:1,bigBlind:2,heroCards:['As','Ks','Qh','Jh','Td']};
const act=(actor,action,to)=>({type:'ACT',actor,action,...(to===undefined?{}:{to})});
const command=action=>({type:'action',actor:null,action});
let origin;
test.before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{await pool.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
async function post(route,payload){const response=await fetch(origin+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});return {httpStatus:response.status,...await response.json()};}
function analysis(record,model={},extra={}){return post('/api/analyze',{multiway:record,multiwayEvaluation:model,...extra});}

test('HTTP contextual guard allows empty-hand observations but blocks EV without cards or Hero turn',async()=>{
  let envelope=mw.start({...config,heroPosition:'BB',heroCards:[]});
  const observations=await post('/api/multiway/observations',{multiway:envelope.multiway});
  assert.equal(observations.sourceRevisionKey,envelope.state.revisionKey);
  assert.equal(typeof observations.revisionKey,'string');
  let response=await analysis(envelope.multiway,{assumeNoRake:true});
  assert.equal(response.httpStatus,200,response.reason);assert.equal(response.status,'NO_DECISION');
  assert.ok(response.reasonCodes.includes('NOT_HERO_TURN'));assert.ok(response.reasonCodes.includes('HERO_CARDS_INCOMPLETE'));
  for(const event of [act(2,'CALL'),act(0,'CALL')]){
    envelope=await post('/api/multiway/step',{multiway:envelope.multiway,event,expectedRevisionKey:envelope.state.revisionKey});
    assert.equal(envelope.httpStatus,200,envelope.reason);
  }
  response=await analysis(envelope.multiway,{assumeNoRake:true});
  assert.equal(response.status,'NO_DECISION');assert.deepEqual(response.reasonCodes,['HERO_CARDS_INCOMPLETE']);
  assert.equal(response.observedState.pot,6);assert.equal(response.recommendation.action,null);
  const checked=await post('/api/multiway/step',{multiway:envelope.multiway,event:act(1,'CHECK'),expectedRevisionKey:envelope.state.revisionKey});
  assert.equal(checked.httpStatus,200,checked.reason);assert.equal(checked.state.phase,'WAIT_BOARD');
  assert.ok((await analysis(checked.multiway,{assumeNoRake:true})).reasonCodes.includes('WAIT_BOARD'));
});

test('HTTP contextual model uses authoritative facts, bounded samples and legal custom sizes without choosing an action',async()=>{
  const initial=mw.start(config),before=JSON.stringify(initial.multiway);
  const response=await analysis(initial.multiway,{assumeNoRake:true,feeBasis:'BEFORE_FEES',chosenSize:4.37,samples:1000000000,timeBudgetMs:999999,
    config:{...config,heroCards:['2s','3s','4s','5s','6s']},events:[act(2,'FOLD')]},
    {potBeforeAction:99999,amountToCall:99,players:9,heroCards:['2s','3s','4s','5s','6s'],effectiveStack:1});
  assert.equal(response.httpStatus,200,response.reason);assert.equal(response.status,'OK',response.reason);
  assert.equal(response.ev.feeBasis,'BEFORE_FEES');assert.ok(response.ev.assumptions.some(text=>text.includes('before room fees')));
  assert.equal(response.state.potBeforeAction,3);assert.equal(response.state.amountToCall,2);assert.equal(response.state.players,3);
  assert.deepEqual(response.state.heroCards,config.heroCards);
  assert.equal(response.multiwayEvaluation.requestedSamples,128);assert.ok(response.multiwayEvaluation.samples<=128);
  assert.ok(response.ev.candidates.some(candidate=>candidate.action==='RAISE'&&candidate.size===4.37&&candidate.status==='MODELED'));
  assert.ok(response.ev.candidates.every(candidate=>Number.isFinite(candidate.ev)&&candidate.confidenceInterval95.length===2));
  assert.equal(response.ev.globalBestSupported,false);assert.equal(response.recommendedAction,'NO_DECISION');
  assert.equal(response.recommendation.action,null);assert.equal(response.multiwayEvaluation.policy.externallyValidated,false);
  assert.equal(response.multiwayEvaluation.revisionKey,initial.state.revisionKey);assert.equal(response.observedState.actor,2);
  assert.equal(response.equity.opponents,2);assert.equal(response.performance.measurementScope,'MULTIWAY_CONTINUATION_WORKER_REQUEST_WALL_TIME');
  assert.equal(JSON.stringify(initial.multiway),before);
});

test('HTTP rake uncertainty is explicit null coverage and does not promote free checks to zero',async()=>{
  const initial=mw.start(config),response=await analysis(initial.multiway);
  assert.equal(response.status,'OK',response.reason);
  assert.equal(response.ev.actions.FOLD.ev,0);
  for(const candidate of response.ev.candidates.filter(item=>item.action!=='FOLD')){
    assert.equal(candidate.status,'NOT_MODELED');assert.equal(candidate.ev,null);assert.equal(candidate.confidenceInterval95,null);
  }
  assert.equal(response.ev.comparisonComplete,false);assert.equal(response.recommendation.action,null);
  let bb=mw.start({...config,heroPosition:'BB'});
  for(const event of [act(2,'CALL'),act(0,'CALL')])bb=mw.step(bb.multiway,event);
  const checked=await analysis(bb.multiway,{assumeNoRake:true});
  assert.equal(checked.status,'OK',checked.reason);assert.equal(checked.ev.actions.CHECK.status,'MODELED');
  assert.notEqual(checked.ev.actions.CHECK.method,'DECISION_REFERENCE');assert.ok(checked.ev.actions.CHECK.samples>0);
});

test('HTTP all-in call and side-pot readiness reach the contextual worker while illegal size/snapshot is rejected',async()=>{
  let initial=mw.start({...config,heroPosition:'SB',smallBlind:.5,bigBlind:1,stacks:[5,10,10]});
  for(const event of [act(2,'RAISE',3),act(0,'CALL'),act(1,'RAISE',10),act(2,'CALL')])initial=mw.step(initial.multiway,event);
  const result=await analysis(initial.multiway,{assumeNoRake:true});
  assert.equal(result.status,'OK',result.reason);assert.equal(result.ev.actions.CALL.status,'MODELED');
  assert.equal(result.observedState.heroToCall,2);assert.equal(result.state.effectiveStack,2);
  const decision=mw.start(config);
  const badSize=await analysis(decision.multiway,{assumeNoRake:true,chosenSize:999});
  assert.equal(badSize.httpStatus,400);assert.match(badSize.reason,/legal/);
  const stale=await analysis(decision.multiway,{assumeNoRake:true,profileSnapshot:{schemaVersion:1,source:'PRE_HAND_OBSERVATIONS',handId:'wrong-hand',players:{}}});
  assert.equal(stale.httpStatus,400);assert.match(stale.reason,/pre-hand/);
});

test('HTTP preview bounds samples and cache cannot cross a changed decision revision',async()=>{
  const initial=mw.start(config),model={assumeNoRake:true};
  const preview=await analysis(initial.multiway,model,{analysisPhase:'PREVIEW'});
  assert.equal(preview.status,'OK',preview.reason);assert.equal(preview.analysisStage,'PROVISIONAL');
  assert.equal(preview.multiwayEvaluation.requestedSamples,32);assert.equal(preview.recommendation.action,null);
  const again=await analysis(initial.multiway,model,{analysisPhase:'PREVIEW'});
  assert.equal(again.performance.cacheHit,true);assert.deepEqual(again.ev.candidates,preview.ev.candidates);
  const acted=mw.step(initial.multiway,act(2,'CALL'));
  const changed=await analysis(acted.multiway,model,{analysisPhase:'PREVIEW'});
  assert.equal(changed.status,'NO_DECISION');assert.ok(changed.reasonCodes.includes('NOT_HERO_TURN'));
});

test('HTTP sequence dry run, atomic batch, Hero barrier and stale/duplicate guards agree',async()=>{
  const initial=mw.start({...config,heroPosition:'BB',heroCards:[]}),commands=[command('CALL'),command('CALL'),command('FOLD')];
  const payload={multiway:initial.multiway,commands,expectedRevisionKey:initial.state.revisionKey,originEventId:'qa-http-speech-123'};
  const preview=await post('/api/multiway/preview-sequence',payload);
  assert.equal(preview.httpStatus,200,preview.reason);assert.equal(preview.appliedCount,2);assert.equal(preview.stopReason,'HERO_TURN');
  assert.equal(preview.multiway,undefined);assert.equal(initial.multiway.events.length,0);
  const result=await post('/api/multiway/batch',{...payload,expectedPreviewKey:preview.previewKey});
  assert.equal(result.httpStatus,200,result.reason);assert.equal(result.multiway.events.length,2);assert.equal(result.state.players[result.state.heroId].folded,false);
  assert.equal(result.sequence.remainingCommands.length,1);
  const stale=await post('/api/multiway/batch',{...payload,multiway:result.multiway,expectedPreviewKey:preview.previewKey});assert.equal(stale.httpStatus,409);
  const bad=await post('/api/multiway/preview-sequence',{...payload,commands:[command('CALL'),{...command('RAISE'),to:999}]});
  assert.equal(bad.httpStatus,400);assert.equal(initial.multiway.events.length,0);
});

test('HTTP Train remains isolated and conceals future cards, opponent cards and feedback before choice',async()=>{
  const started=await post('/api/training/start',{variant:'PLO6_HIGH',seed:31,mode:'CHALLENGE'});
  assert.equal(started.httpStatus,200,started.reason);assert.equal(started.session.variant,'PLO6_HIGH');
  assert.equal(started.session.heroCards.length,6);assert.deepEqual(started.session.board,[]);
  assert.equal(started.session.opponentCards,undefined);assert.equal(started.session.boardAll,undefined);
  assert.equal(started.session.trainingEvaluation,undefined);assert.equal(started.session.multiwayEvaluation,undefined);
  const review=await post('/api/training/review',{sessionId:started.session.id});
  assert.deepEqual(review.decisions,[]);assert.deepEqual(review.session,started.session);
  const locked=await post('/api/training/doubt',{sessionId:started.session.id,question:'What should I do?'});
  assert.equal(locked.status,'LOCKED');
});

test('contextual jobs use their short worker deadline even with FIXED sampling; late results cannot survive cancellation',async t=>{
  const isolated=pool.createAnalysisPool({maxWorkers:1,workerFile:path.join(__dirname,'fixtures/pool-worker.cjs'),fixedTimeoutMs:5000,adaptiveTimeoutMs:100});
  t.after(()=>isolated.close());
  const spy=Object.assign(new EventEmitter(),{writableEnded:false,destroyed:false});
  await assert.rejects(isolated({multiwayEvaluation:{},samplingMode:'FIXED',delay:500,key:'deadline'},spy),/timed out/);
  assert.equal(spy.listenerCount('close'),0);assert.equal(isolated.stats().workers,0);
  const pending=isolated({multiwayEvaluation:{},delay:500,key:'old'},spy),rejected=assert.rejects(pending,/cancelled/);
  spy.emit('close');await rejected;assert.equal(isolated.stats().busy,0);assert.equal(spy.listenerCount('close'),0);
  const next=await isolated({key:'new'});assert.equal(next.key,'new');
});
