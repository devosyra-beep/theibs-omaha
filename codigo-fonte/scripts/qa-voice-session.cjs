'use strict';
// Real auth-ui lifecycle with local, explicitly fake account/access responses.
// No authentication provider is contacted, and no personal session is read.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const out=path.resolve(process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'../validacao/analyze-online-2026-09-27/voice'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-voice-session-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const report={environment:'LOCAL_EXECUTED',authentication:'HARNESS_FAKE_ACCOUNT',recognition:'CONTROLLED_EVENTS',cases:[],browserErrors:[],status:'RUNNING'};
let server,browser;
async function boot(expiryMs=3600000,refreshable=false){
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/api/public-config',route=>route.fulfill({json:{auth:{required:true,providers:{google:true},billingEnabled:false,supabaseUrl:'https://theibs-voice-fixture.supabase.co',supabasePublishableKey:'fixture-public'}}}));
 await context.route('**/api/access',route=>route.fulfill({json:{access:{allowed:true,state:'LIFETIME'}}}));
 await context.route('https://theibs-voice-fixture.supabase.co/**',route=>route.fulfill({status:204,body:''}));
 await context.addInitScript(({ms,refreshable})=>{
  localStorage.setItem('theibs.auth.session.v1',JSON.stringify({access_token:'synthetic-session-for-local-tests-only',expires_at:Date.now()+ms,...(refreshable?{refresh_token:'synthetic-refresh-fixture',user:{id:'voice-fixture-user'}}:{})}));
  window.__asr=[];window.SpeechRecognition=class{constructor(){__asr.push(this);}start(){this.onstart?.();}stop(){this.onend?.();}abort(){this.aborted=true;this.onend?.();}};
 },{ms:expiryMs,refreshable});
 const page=await context.newPage();page.on('pageerror',error=>report.browserErrors.push(error.message));await page.goto(`http://127.0.0.1:${server.address().port}/app`);await page.evaluate(()=>theibsApp.ready);
 await page.locator('#card-voice-disclosure>summary').click();await page.locator('#voice-consent').check();await page.locator('#voice-toggle').click();
 assert.equal(await page.evaluate(()=>theibsCardVoice.getStatus().listening),true);
 return {page,context};
}
(async()=>{try{
 ({server}=require('../server'));await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({channel:'msedge',headless:true});
 {
  const {page,context}=await boot(2200);
  await page.waitForFunction(()=>theibsVoiceSessionContext().expired&&!theibsCardVoice.getStatus().listening,null,{timeout:5000});
  assert.equal(await page.evaluate(()=>__asr.at(-1).aborted),true);const n=await page.evaluate(()=>__asr.length);
  assert.equal(await page.locator('#login-screen').isVisible(),true);assert.equal(await page.locator('#app-shell').evaluate(e=>e.hidden&&e.inert),true);
  // The new recovery screen hides the app. Even a programmatic button click
  // must not bypass the expired-session guard or create another recognizer.
  await page.locator('#voice-toggle').evaluate(button=>button.click());assert.equal(await page.evaluate(()=>__asr.length),n);
  report.cases.push({name:'Actual expiry timer aborts recognition; expired session cannot restart',status:'PASS'});await context.close();
 }
 {
  const {page,context}=await boot();await page.route('**/api/voice-session-probe',route=>route.fulfill({status:401,json:{reason:'Fixture expired access'}}));
  await page.evaluate(()=>fetch('/api/voice-session-probe').catch(error=>({name:error.name,code:error.code})));assert.equal(await page.evaluate(()=>theibsVoiceSessionContext().expired),true);assert.equal(await page.evaluate(()=>theibsCardVoice.getStatus().listening),false);
  report.cases.push({name:'Actual protected-fetch 401 invalidates voice capability and aborts ASR',status:'PASS'});await context.close();
 }
 {
  const {page,context}=await boot();const peer=await context.newPage();await peer.goto(`http://127.0.0.1:${server.address().port}/api/status`);
  // Opening the peer may blur/cancel speech, so restart before the storage mutation.
  await page.bringToFront();await page.locator('#voice-toggle').click();
  if(!await page.evaluate(()=>theibsCardVoice.getStatus().listening))await page.locator('#voice-toggle').click();
  await peer.evaluate(()=>localStorage.removeItem('theibs.auth.session.v1'));
  await page.waitForFunction(()=>!theibsCardVoice.getStatus().listening);assert.equal(await page.evaluate(()=>theibsVoiceSessionContext().expired),true);
  report.cases.push({name:'Real cross-tab session removal aborts pending ASR and blocks restart',status:'PASS'});await context.close();
 }
 {
  const {page,context}=await boot();await page.locator('#voice-cancel').click();
  await page.evaluate(()=>{
   document.querySelector('#auto-analysis').checked=false;theibsCardKeyboard.reset();theibsCardKeyboard.paste('AE KC QO JP TE 9O 8C 7P');
   for(const [id,value] of [['players','2'],['opponentHand','2P 3P 4P 5P 6P']]){const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));}
   document.getElementById('opponentRange').value='';document.getElementById('opponent-apply').click();
   document.getElementById('assumeNoRake').checked=true;
  });
  await page.evaluate(()=>theibsApp.flushSave());await page.waitForFunction(()=>!theibsApp.getState().saveBusy);
  const savedBefore=fs.readFileSync(process.env.THEIBS_WORKSPACE_PATH,'utf8'),before=await page.evaluate(()=>theibsApp.getState().snapshots.length);
  let release,received;const gate=new Promise(r=>release=r),arrived=new Promise(r=>received=r);let lateSaves=0;
  await page.route('**/api/analyze',async route=>{const response=await route.fetch();received();await gate;await route.fulfill({response}).catch(()=>{});});
  await page.locator('#quick-analyze').click();await arrived;
  page.on('request',request=>{if(request.url().endsWith('/api/workspace')&&request.method()==='POST')lateSaves++;});
  await page.evaluate(()=>{localStorage.removeItem('theibs.auth.session.v1');window.dispatchEvent(new StorageEvent('storage',{key:'theibs.auth.session.v1',newValue:null}));});release();
  await page.waitForFunction(()=>!theibsApp.getState().analysisBusy);
  await page.waitForTimeout(400);await page.evaluate(()=>theibsApp.flushSave());
  assert.equal(await page.evaluate(()=>theibsVoiceSessionContext().expired),true);
  assert.equal(await page.evaluate(()=>theibsApp.getState().lastAnalysis),null);assert.equal(await page.evaluate(()=>theibsApp.getState().snapshots.length),before);
  assert.equal(lateSaves,0);assert.equal(fs.readFileSync(process.env.THEIBS_WORKSPACE_PATH,'utf8'),savedBefore);
  report.cases.push({name:'Delayed actual Analyze response after session change cannot create analysis, snapshot or persisted workspace',status:'PASS'});await context.close();
 }
 {
  const {page,context}=await boot(3600000,true);
  const before=await page.evaluate(()=>({session:theibsVoiceSessionContext(),cards:theibsCardKeyboard.state.snapshot(),recognitions:__asr.length}));
  let refreshes=0,requests=0;report.healthyRefresh={refreshes:0,protectedRequests:0,failedRequests:[]};
  page.on('requestfailed',request=>report.healthyRefresh.failedRequests.push({origin:new URL(request.url()).origin,failure:request.failure()?.errorText}));
  // Match the real provider's cross-origin contract, including a preflight.
  // All credentials here are deliberate fixtures, never a real account.
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
  await page.route('https://theibs-voice-fixture.supabase.co/**',route=>{
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors,body:''});
   refreshes++;report.healthyRefresh.refreshes=refreshes;
   return route.fulfill({headers:cors,json:{access_token:'synthetic-refreshed-fixture',refresh_token:'synthetic-refresh-next-fixture',expires_in:3600,user:{id:'voice-fixture-user'}}});
  });
  await page.route('**/api/voice-session-probe',route=>{requests++;report.healthyRefresh.protectedRequests=requests;return route.fulfill(requests===1?{status:401,json:{reason:'Synthetic expired token'}}:{json:{ok:true}});});
  assert.deepEqual(await page.evaluate(()=>fetch('/api/voice-session-probe').then(r=>r.json())),{ok:true});
  assert.equal(refreshes,1);assert.equal(requests,2);
  assert.deepEqual(await page.evaluate(()=>theibsVoiceSessionContext()),before.session);
  assert.equal(await page.evaluate(()=>theibsCardVoice.getStatus().listening),true);assert.equal(await page.evaluate(()=>__asr.length),before.recognitions);
  await page.evaluate(()=>__asr.at(-1).onresult({resultIndex:0,results:[Object.assign([{transcript:'selecionar carta três'}],{isFinal:true})]}));await page.locator('#voice-toggle').click();
  assert.equal(await page.locator('#voice-review').isVisible(),true);
  // A same-owner rotation is a real storage mutation delivered through the
  // storage hook. The separate logout case above exercises another page.
  await page.evaluate(()=>{const key='theibs.auth.session.v1',previous=JSON.parse(localStorage.getItem(key));const next=JSON.stringify({...previous,access_token:'synthetic-storage-rotation-fixture',expires_at:Date.now()+3600000});localStorage.setItem(key,next);window.dispatchEvent(new StorageEvent('storage',{key,newValue:next}));});
  await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(()=>theibsVoiceSessionContext()),before.session);
  assert.equal(await page.locator('#voice-review').isVisible(),true);assert.equal(await page.evaluate(()=>theibsCardVoice.getStatus().phase),'review');
  assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.snapshot()),before.cards);
  await page.locator('#voice-cancel').click();
  report.cases.push({name:'Successful same-identity refresh/retry preserves listening and same-owner storage rotation preserves the pending proposal',status:'PASS',refreshes,protectedRequests:requests});await context.close();
 }
 {
  const {page,context}=await boot(3600000,true),before=await page.evaluate(()=>({session:theibsVoiceSessionContext(),cards:theibsCardKeyboard.state.snapshot()}));
  await page.evaluate(()=>{const key='theibs.auth.session.v1',next=JSON.stringify({access_token:'synthetic-different-account',expires_at:Date.now()+3600000,user:{id:'voice-fixture-other-user'}});localStorage.setItem(key,next);window.dispatchEvent(new StorageEvent('storage',{key,newValue:next}));});
  assert.equal(await page.evaluate(()=>theibsVoiceSessionContext().expired),true);assert.ok(await page.evaluate(()=>theibsVoiceSessionContext().epoch)>before.session.epoch);
  assert.equal(await page.evaluate(()=>theibsCardVoice.getStatus().listening),false);assert.equal(await page.evaluate(()=>__asr.at(-1).aborted),true);
  await page.evaluate(()=>{const r=__asr.at(-1);r.onresult?.({resultIndex:0,results:[Object.assign([{transcript:'ás de espadas'}],{isFinal:true})]});r.onend?.();});
  assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.snapshot()),before.cards);assert.equal(await page.locator('#voice-review').isVisible(),false);
  report.cases.push({name:'Different-account storage change advances epoch, aborts ASR and rejects the late result',status:'PASS'});await context.close();
 }
 report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;}
finally{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'session-qa.json'),JSON.stringify(report,null,2));await browser?.close();await new Promise(r=>server?server.close(r):r());console.log(JSON.stringify(report));}
})().then(()=>process.exit(process.exitCode||0));
