'use strict';
// Browser integration with exclusively synthetic credentials and provider routes.
// It validates web session behavior; no real Supabase account is contacted.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const out=path.resolve(process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'../validacao/analyze-online-2026-09-27/auth-refresh');
fs.mkdirSync(out,{recursive:true});assert.equal(fs.readdirSync(out).length,0,'Use a new evidence directory; previous reports are preserved.');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-auth-refresh-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const {server}=require('../server'),pool=require('../src/analysis-worker');
const report={scope:'LOCAL_BROWSER_HARNESS_SYNTHETIC_AUTH',version:require('../package.json').version,providerContacted:false,startedAt:new Date().toISOString(),cases:[],pageErrors:[],status:'RUNNING'};
const jwt=(nonce,sub='fixture-alice',sid='fixture-session')=>'fixture.'+Buffer.from(JSON.stringify({sub,session_id:sid,exp:Math.floor(Date.now()/1000)+3600,nonce})).toString('base64url')+'.fixture';
let browser;
async function boot({expired=false,refreshFailure=false,missingRefresh=false,shortTTL=false,accessBodyGate=false}={}){
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();let refreshes=0,probes=0,commits=0;const initial=jwt('old');
 const session={access_token:initial,expires_at:Date.now()+(expired?-1000:3600000),...(missingRefresh?{}:{refresh_token:'fixture-refresh-old'})};
 const attempts=new Map();
 await context.route('https://theibs-auth-refresh-fixture.supabase.co/**',async route=>{
  const headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'apikey, content-type, authorization'};
  if(route.request().method()==='OPTIONS'||!route.request().url().includes('/token?'))return route.fulfill({status:204,body:'',headers});
  refreshes++;
  if(refreshFailure)return route.fulfill({status:400,json:{error_description:'SENSITIVE_PROVIDER_FIXTURE'},headers});
  const n=refreshes;await new Promise(r=>setTimeout(r,25));
  return route.fulfill({json:{access_token:jwt('rotated-'+n),refresh_token:'fixture-refresh-'+n,expires_in:shortTTL?5:3600},headers});
 });
 await context.route('**/api/public-config',r=>r.fulfill({json:{auth:{required:true,providers:{google:true},billingEnabled:false,supabaseUrl:'https://theibs-auth-refresh-fixture.supabase.co',supabasePublishableKey:'fixture-public'}}}));
 await context.route('**/api/access',r=>r.fulfill({json:{access:{allowed:true,state:'LIFETIME'}}}));
 await context.route('**/api/workspace',r=>r.fulfill({json:r.request().method()==='GET'?{revision:0,workspace:null}:{revision:1}}));
 await context.route('**/api/auth-refresh-probe*',async r=>{
  probes++;const url=new URL(r.request().url()),key=url.searchParams.get('id')||'one',mode=url.searchParams.get('mode')||'once';
  const count=(attempts.get(key)||0)+1;attempts.set(key,count);
  if(mode==='always'||(mode==='once'&&count===1))return r.fulfill({status:401,json:{reason:'Synthetic unauthorized before handler'}});
  if(mode==='server-error')return r.fulfill({status:503,json:{reason:'Synthetic network ambiguity'}});
  if(r.request().method()==='POST'){assert.equal(r.request().postData(),'\{"mutation":"fixture"\}');commits++;}
  return r.fulfill({json:{ok:true}});
 });
 await context.addInitScript(({session,accessBodyGate})=>{
  localStorage.setItem('theibs.auth.session.v1',JSON.stringify(session));window.__sessionEvents=[];
  document.addEventListener('theibs:voice-session-changed',e=>__sessionEvents.push(e.detail?.reason||'unspecified'));
  if(accessBodyGate){
   const native=window.fetch.bind(window);window.__accessBodyReached=false;const gate=new Promise(r=>window.__releaseAccessBody=r);
   window.fetch=async(input,init)=>{const response=await native(input,init),url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.pathname==='/api/access'){const parse=response.json.bind(response);response.json=async()=>{const data=await parse();window.__accessBodyReached=true;await gate;return data;};}return response;};
  }
 },{session,accessBodyGate});
 page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/app`);
 if(!accessBodyGate)await page.evaluate(()=>theibsApp.ready);
 return {page,context,counts:()=>({refreshes,probes,commits})};
}
async function check(name,run){const details=await run();report.cases.push({name,status:'PASS',...details});console.log('PASS',name);}
async function locked(page){assert.equal(await page.locator('#login-screen').isVisible(),true);assert.equal(await page.locator('#app-shell').isHidden(),true);assert.equal(await page.locator('#app-shell').getAttribute('inert'),'');}
(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true,channel:'msedge'});report.browser=browser.version();
 await check('Expired cached login refreshes before opening application',async()=>{const h=await boot({expired:true});report.startupDiagnostic=await h.page.evaluate(()=>({status:document.getElementById('auth-status').textContent,context:theibsVoiceSessionContext(),events:window.__sessionEvents}));assert.equal(h.counts().refreshes,1);assert.equal(await h.page.locator('#app-shell').isVisible(),true);assert.equal(await h.page.evaluate(()=>theibsVoiceSessionContext().expired),false);await h.context.close();return h.counts();});
 await check('Parallel 401 responses share one refresh and preserve same-login epoch',async()=>{
  const h=await boot(),before=await h.page.evaluate(()=>({epoch:theibsVoiceSessionContext().epoch,events:__sessionEvents.length}));
  await h.page.evaluate(()=>Promise.all(Array.from({length:8},(_,i)=>fetch('/api/auth-refresh-probe?id='+i).then(r=>r.json()))));
  assert.deepEqual(h.counts(),{refreshes:1,probes:16,commits:0});assert.deepEqual(await h.page.evaluate(()=>({epoch:theibsVoiceSessionContext().epoch,events:__sessionEvents.length})),before);await h.context.close();return h.counts();
 });
 await check('Unauthorized POST retries once and commits exactly once',async()=>{const h=await boot();await h.page.evaluate(()=>fetch('/api/auth-refresh-probe',{method:'POST',body:JSON.stringify({mutation:'fixture'})}));assert.deepEqual(h.counts(),{refreshes:1,probes:2,commits:1});await h.context.close();return h.counts();});
 await check('Second 401 requires visible relogin with no retry loop',async()=>{const h=await boot();await h.page.evaluate(()=>fetch('/api/auth-refresh-probe?mode=always').catch(()=>{}));await locked(h.page);assert.deepEqual(h.counts(),{refreshes:1,probes:2,commits:0});assert.equal(await h.page.evaluate(()=>localStorage.getItem('theibs.auth.session.v1')),null);await h.context.close();return h.counts();});
 await check('Rejected refresh clears credentials and shows sanitized relogin message',async()=>{const h=await boot({refreshFailure:true});await h.page.evaluate(()=>fetch('/api/auth-refresh-probe').catch(()=>{}));await locked(h.page);assert.equal(h.counts().refreshes,1);assert.equal(h.counts().probes,1);assert.equal((await h.page.locator('#auth-status').textContent()).includes('SENSITIVE'),false);assert.equal(await h.page.evaluate(()=>localStorage.getItem('theibs.auth.session.v1')),null);await h.context.close();return h.counts();});
 await check('Missing refresh token cannot retry unauthorized operation',async()=>{const h=await boot({missingRefresh:true});await h.page.evaluate(()=>fetch('/api/auth-refresh-probe').catch(()=>{}));await locked(h.page);assert.deepEqual(h.counts(),{refreshes:0,probes:1,commits:0});await h.context.close();return h.counts();});
 await check('A 503 never repeats a mutation or refreshes',async()=>{const h=await boot();const status=await h.page.evaluate(()=>fetch('/api/auth-refresh-probe?mode=server-error',{method:'POST',body:JSON.stringify({mutation:'fixture'})}).then(r=>r.status));assert.equal(status,503);assert.deepEqual(h.counts(),{refreshes:0,probes:1,commits:0});await h.context.close();return h.counts();});
 await check('Healthy short token lifetime does not cause immediate refresh loop',async()=>{const h=await boot({expired:true,shortTTL:true});await h.page.waitForTimeout(250);assert.equal(h.counts().refreshes,1);await h.context.close();return h.counts();});
 await check('Background timer renews before expiry without changing login epoch',async()=>{
  const h=await boot({expired:true,shortTTL:true}),before=await h.page.evaluate(()=>({epoch:theibsVoiceSessionContext().epoch,events:__sessionEvents.length}));
  await h.page.waitForFunction(()=>{const saved=JSON.parse(localStorage.getItem('theibs.auth.session.v1'));return saved?.refresh_token==='fixture-refresh-2';},{timeout:7000});
  assert.equal(h.counts().refreshes,2);assert.deepEqual(await h.page.evaluate(()=>({epoch:theibsVoiceSessionContext().epoch,events:__sessionEvents.length})),before);
  assert.equal(await h.page.evaluate(()=>theibsVoiceSessionContext().expired),false);await h.context.close();return h.counts();
 });
 await check('Access body arriving after session removal cannot open application',async()=>{
  const h=await boot({accessBodyGate:true});await h.page.waitForFunction(()=>__accessBodyReached);
  await h.page.evaluate(()=>{localStorage.removeItem('theibs.auth.session.v1');window.dispatchEvent(new StorageEvent('storage',{key:'theibs.auth.session.v1'}));__releaseAccessBody();});
  await h.page.waitForTimeout(80);await locked(h.page);assert.equal(await h.page.evaluate(()=>theibsVoiceSessionContext().expired),true);await h.context.close();return h.counts();
 });
 assert.deepEqual(report.pageErrors,[]);report.status='PASS';
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;}
finally{
 await browser?.close();await pool.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 report.completedAt=new Date().toISOString();report.sources=Object.fromEntries(['public/auth-session.js','public/auth-ui.js','scripts/qa-auth-refresh.cjs','test/auth-session.test.cjs'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex')]));
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,cases:report.cases.length,failure:report.failure,out}));
}})();
