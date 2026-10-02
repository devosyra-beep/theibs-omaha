'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-simulation-http-'));
Object.assign(process.env,{THEIBS_AUTH_REQUIRED:'false',THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_USER_DATA_ROOT:path.join(temp,'users'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const {server}=require('../server'),pool=require('../src/analysis-worker');let origin;
test.before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;});
test.after(async()=>{await pool.close();await new Promise(resolve=>server.close(resolve));});
async function post(route,body){const response=await fetch(origin+'/api/simulation/'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {httpStatus:response.status,...await response.json()};}
test('simulation routes project public inputs, reject stale operations, and leave real history/workspace empty',async()=>{
  const started=await post('start',{config:{playerCount:2,heroPosition:'SB',variant:'PLO5_HIGH'}});assert.equal(started.httpStatus,200,started.reason);
  const s=started.session,input=await post('input',{id:s.id,revision:s.revision});assert.equal(input.httpStatus,200);
  assert.equal(input.input.seed,undefined);assert.equal(input.input.hands,undefined);assert.equal(input.input.boardAll,undefined);
  const ended=await post('step',{id:s.id,revision:s.revision,operation:'END',requestId:'end-event'});assert.equal(ended.httpStatus,200);
  assert.equal((await post('input',{id:s.id,revision:s.revision})).httpStatus,409);
  assert.equal((await post('next',{id:s.id,revision:ended.session.revision})).httpStatus,400);
  const revealed=await post('step',{id:s.id,revision:ended.session.revision,operation:'REVEAL',requestId:'reveal-event'});assert.equal(revealed.session.audit.hands.length,2);
  assert.equal((await post('release',{id:s.id})).httpStatus,200);assert.equal((await post('state',{id:s.id})).httpStatus,404);
  assert.equal(fs.existsSync(path.join(temp,'workspace.json')),false);assert.equal(fs.existsSync(path.join(temp,'events.jsonl')),false);
});
