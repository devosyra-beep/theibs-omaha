'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-immediate-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json')});
const {server}=require('../server'),pool=require('../src/analysis-worker'),llama=require('../src/llama-config');
let origin,pending=null,chats=0;
const fake=http.createServer(async(req,res)=>{for await(const _ of req){} chats++;pending=res;});
test.before(async()=>{await new Promise(r=>fake.listen(0,'127.0.0.1',r));llama.saveConfig({provider:'ollama',model:'test:1b',baseUrl:`http://127.0.0.1:${fake.address().port}`});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{pending?.end('{}');await pool.close();fake.closeAllConnections();server.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>fake.close(r))]);});
async function post(route,body){const r=await fetch(origin+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {code:r.status,...await r.json()};}
const input={variant:'PLO4_HIGH',heroCards:['As','Ks','2c','3c'],board:['Qs','Js','Ts','8h','9d'],position:'BTN',players:2,potBeforeAction:10,amountToCall:1,effectiveStack:100,assumeNoRake:true,unknownOpponentModel:'UNIFORM',samples:1000,seed:42};
test('preview is bounded, labeled and never recommended; cache identity includes complete economic inputs',async()=>{
  const preview=await post('analyze',{...input,analysisPhase:'PREVIEW'});
  assert.equal(preview.equity.samples,512);assert.equal(preview.analysisStage,'PROVISIONAL');assert.equal(preview.recommendation.action,null);
  const final=await post('analyze',input);assert.equal(final.equity.samples,1000);assert.equal(final.performance.cacheHit,false);
  const reused=await post('analyze',input);assert.equal(reused.analysisId,final.analysisId);assert.equal(reused.performance.cacheHit,true);assert.equal(reused.performance.monteCarloSamples,0);
  const changed=await post('analyze',{...input,rake:1,assumeNoRake:false});assert.notEqual(changed.analysisId,final.analysisId);assert.equal(changed.performance.cacheHit,false);
});
test('local answer sends no LLM request and enrichment cannot accept client-supplied numbers',async()=>{
  const answer=await post('analysis/doubt',{input,question:'What is the equity?',responseMode:'LOCAL_FIRST'});
  assert.equal(answer.code,200);assert.equal(answer.answer.provider,'none');assert.equal(chats,0);assert.ok(answer.enrichment.ticket);
  assert.equal(answer.context.equity.value,1);assert.ok(answer.context.analysisId);
  assert.equal((await post('coach/enrich',{ticket:'invented',context:{equity:999}})).code,410);
});
test('optional inference does not lock training; changed revision rejects its late answer',async()=>{
  const start=await post('training/start',{variant:'PLO4_HIGH',seed:42});
  const local=await post('training/doubt',{sessionId:start.session.id,revision:start.session.revision,responseMode:'LOCAL_FIRST',question:'Explain this hand'});
  assert.equal(local.code,200);assert.equal(chats,0);assert.ok(local.enrichment.ticket);
  const inFlight=post('coach/enrich',{ticket:local.enrichment.ticket});
  for(let n=0;n<100&&!pending;n++)await new Promise(r=>setTimeout(r,10));
  assert.ok(pending,'mock LLM received optional request');
  const action=await post('training/act',{sessionId:start.session.id,revision:start.session.revision,action:'FOLD'});
  assert.equal(action.code,200);assert.equal(action.session.finished,true);
  pending.end(JSON.stringify({message:{content:JSON.stringify({factIds:['equity','limitations']})}}));pending=null;
  assert.equal((await inFlight).code,409);
  assert.equal((await post('coach/enrich',{ticket:local.enrichment.ticket})).code,410);
});
