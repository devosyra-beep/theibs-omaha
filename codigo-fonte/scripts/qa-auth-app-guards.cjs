'use strict';
// Local browser integration. Synthetic account only; provider traffic is blocked.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const out=path.resolve(process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'../validacao/analyze-online-2026-09-27/auth-app-guards');
fs.mkdirSync(out,{recursive:true});assert.equal(fs.readdirSync(out).length,0,'Use a new evidence directory.');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-auth-guards-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const {server}=require('../server'),pool=require('../src/analysis-worker');
const report={scope:'LOCAL_BROWSER_HARNESS_SYNTHETIC_AUTH',version:require('../package.json').version,providerContacted:false,cases:[],errors:[],status:'RUNNING'};
let browser;
async function boot(delay=null){
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),requests=[];
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('request',r=>{if(r.url().includes('/api/'))requests.push({url:new URL(r.url()).pathname,method:r.method(),body:r.postDataJSON()});});
 await context.route('https://fixture-auth.invalid/**',r=>r.fulfill({status:500,json:{error:'PROVIDER_MUST_NOT_BE_CONTACTED'}}));
 await context.route('**/api/public-config',r=>r.fulfill({json:{auth:{required:true,providers:{google:true},billingEnabled:false,supabaseUrl:'https://fixture-auth.invalid',supabasePublishableKey:'synthetic-public'}}}));
 await context.route('**/api/access',r=>r.fulfill({json:{access:{allowed:true,state:'LIFETIME'}}}));
 await context.route('**/api/workspace',r=>r.request().method()==='GET'?r.fulfill({json:{revision:7,workspace:delay?{schemaVersion:1,keyboard:{count:5,slots:['As','Ah','Ks','Kh','Qd'].map(c=>({A:'A',K:'K',Q:'Q'})[c[0]]+({s:'E',h:'C',d:'O',c:'P'})[c[1]]).concat(Array(5).fill(null)),selected:5},fields:{'auto-analysis':false},ui:{view:'analyze',cardDisplayVersion:2,workflowVersion:1},snapshots:[]}:null}}):r.fulfill({json:{revision:8,updatedAt:new Date().toISOString()}}));
 await context.addInitScript(({delay})=>{
  const token='x.'+btoa(JSON.stringify({sub:'synthetic-user',session_id:'synthetic-session',exp:Math.floor(Date.now()/1000)+3600}))+'.x';
  localStorage.setItem('theibs.auth.session.v1',JSON.stringify({access_token:token,expires_at:Date.now()+3600000}));
  const native=window.fetch.bind(window);window.__jsonGateReached=false;
  const gate=new Promise(resolve=>window.__releaseJson=resolve);
  window.fetch=async(input,init)=>{
   const response=await native(input,init),url=new URL(typeof input==='string'?input:input.url,location.href);
   if(delay&&url.pathname===(delay==='workspace-body'?'/api/workspace':'/api/status')&&(!init?.method||init.method==='GET')){
    const parse=response.json.bind(response);response.json=async()=>{const data=await parse();window.__jsonGateReached=true;await gate;return data;};
   }
   return response;
  };
 },{delay});
 await page.goto(`http://127.0.0.1:${server.address().port}/app`);await page.waitForFunction(()=>window.theibsApp);
 return{context,page,requests};
}
async function check(name,fn){const details=await fn();report.cases.push({name,status:'PASS',...details});console.log('PASS',name);}
(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true,channel:'msedge'});report.browser=browser.version();
 for(const delay of['workspace-body','status-body'])await check(`Startup ${delay} arriving after logout cannot restore cards or save`,async()=>{
  const {context,page,requests}=await boot(delay);await page.waitForFunction(()=>__jsonGateReached);
  await page.evaluate(()=>{localStorage.removeItem('theibs.auth.session.v1');window.dispatchEvent(new StorageEvent('storage',{key:'theibs.auth.session.v1',newValue:null}));__releaseJson();});
  await page.evaluate(()=>theibsApp.ready);await page.waitForTimeout(350);
  const state=await page.evaluate(()=>({cards:theibsCardKeyboard.state.slots.filter(Boolean).length,...theibsApp.getState(),expired:theibsVoiceSessionContext().expired}));
  assert.equal(state.expired,true);assert.equal(state.cards,0);assert.equal(state.snapshots.length,0);assert.equal(state.lastAnalysis,null);assert.equal(state.saveDirty,false);
  assert.equal(requests.filter(r=>r.url==='/api/analyze'||r.url==='/api/workspace'&&r.method==='POST').length,0);
  await context.close();return{cardsRestored:0,analysesSent:0,savesSent:0};
 });
 for(const interruption of['navigation','auto-disabled'])await check(`Automatic Analyze waiting for session is discarded after ${interruption}`,async()=>{
  const {context,page,requests}=await boot();await page.evaluate(()=>theibsApp.ready);
  await page.evaluate(()=>{
   const original=window.theibsAuth.ensureSession.bind(window.theibsAuth);window.__ensureReached=false;
   const gate=new Promise(resolve=>window.__releaseEnsure=resolve);window.theibsAuth.ensureSession=async()=>{window.__ensureReached=true;await gate;return original();};
   document.getElementById('auto-analysis').checked=true;
   theibsCardKeyboard.restore({count:5,slots:['AE','AC','KE','KC','QO',null,null,null,null,null],selected:5});
  });
  await page.waitForFunction(()=>__ensureReached);
  await page.evaluate(interruption=>{if(interruption==='navigation')theibsApp.showView('history',false);else{const auto=document.getElementById('auto-analysis');auto.checked=false;auto.dispatchEvent(new Event('change',{bubbles:true}));}__releaseEnsure();},interruption);
  await page.waitForTimeout(450);await page.evaluate(()=>theibsApp.flushSave());await page.waitForFunction(()=>!theibsApp.getState().saveBusy);
  assert.equal(requests.filter(r=>r.url==='/api/analyze').length,0);
  const state=await page.evaluate(()=>theibsApp.getState());assert.equal(state.lastAnalysis,null);assert.equal(state.snapshots.length,0);assert.equal(state.analysisBusy,false);
  const saves=requests.filter(r=>r.url==='/api/workspace'&&r.method==='POST');for(const save of saves){assert.equal(save.body.workspace.lastAnalysis,null);assert.deepEqual(save.body.workspace.snapshots,[]);}
  await context.close();return{analysesSent:0,analysisSnapshotsSaved:0,legitimateInputDraftSaves:saves.length};
 });
 await check('An in-flight Analyze response cannot create snapshots after navigation',async()=>{
  const {context,page,requests}=await boot();await page.evaluate(()=>theibsApp.ready);
  await page.evaluate(()=>{document.getElementById('auto-analysis').checked=false;theibsCardKeyboard.restore({count:5,slots:['AE','AC','KE','KC','QO',null,null,null,null,null],selected:5});theibsCardPicker.close();});
  let release,received;const gate=new Promise(r=>release=r),arrived=new Promise(r=>received=r);
  await page.route('**/api/analyze',async route=>{const response=await route.fetch();received();await gate;await route.fulfill({response}).catch(()=>{});});
  await page.locator('#quick-analyze').click();await arrived;await page.evaluate(()=>theibsApp.showView('history',false));release();
  await page.waitForFunction(()=>!theibsApp.getState().analysisBusy);await page.waitForTimeout(350);
  const state=await page.evaluate(()=>theibsApp.getState());assert.equal(state.lastAnalysis,null);assert.equal(state.snapshots.length,0);
  for(const save of requests.filter(r=>r.url==='/api/workspace'&&r.method==='POST')){assert.equal(save.body.workspace.lastAnalysis,null);assert.deepEqual(save.body.workspace.snapshots,[]);}
  await context.close();return{obsoleteSnapshots:0,obsoleteAnalysisSaves:0};
 });
 assert.deepEqual(report.errors,[]);report.status='PASS';
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;}
finally{await browser?.close();await pool.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,cases:report.cases.length,failure:report.failure,out}));}})();
