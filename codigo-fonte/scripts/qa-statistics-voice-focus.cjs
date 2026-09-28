'use strict';
// Browser integration with real local HTTP and controlled ASR only. No audio is
// recorded, synthesized or sent to a provider; human acoustic gates remain open.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const out=path.resolve(process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'../validation-output/statistics-browser');
fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-statistics-browser-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const {server}=require('../server'),pool=require('../src/analysis-worker');
const report={version:require('../package.json').version,layer:'LOCAL_HTTP_BROWSER_CONTROLLED_ASR',human:'NOT_EXECUTED',production:'NOT_EXECUTED',cases:[],pageErrors:[]};
let browser,page;
async function test(name,fn){try{await fn();report.cases.push({name,status:'PASS'});}catch(e){report.cases.push({name,status:'FAIL',error:e.stack});await page.screenshot({path:path.join(out,`failure-${report.cases.length}.png`),fullPage:true}).catch(()=>{});}}
async function fields(values){await page.evaluate(values=>{for(const [id,value]of Object.entries(values)){const el=document.getElementById(id);if(el.type==='checkbox')el.checked=value;else el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}},values);}
async function analyze(){await page.locator('#quick-analyze').click();await page.waitForFunction(()=>!theibsApp.getState().analysisBusy&&theibsApp.getState().lastAnalysis?.data?.analysisStage==='FINAL');return page.evaluate(()=>theibsApp.getState().lastAnalysis.data);}
async function voiceStart(){await page.evaluate(()=>document.querySelector('#voice-toggle').click());await page.waitForFunction(()=>__asr.at(-1)?.started&&!__asr.at(-1)?.aborted);}
async function emit(parts,index=null){await page.evaluate(({parts,index})=>{const rec=index===null?__asr.at(-1):__asr[index];rec.onresult?.({resultIndex:0,results:parts.map(text=>Object.assign([{transcript:text,confidence:.99}],{isFinal:true}))});},{parts,index});}
(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({headless:true,...(process.env.THEIBS_CHROMIUM_PATH?{executablePath:process.env.THEIBS_CHROMIUM_PATH}:{})});
 page=await browser.newPage({serviceWorkers:'block',viewport:{width:1440,height:1100}});page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.addInitScript(()=>{window.__asr=[];window.SpeechRecognition=class{constructor(){__asr.push(this);}start(){this.started=true;this.onstart?.();this.onaudiostart?.();}stop(){this.onend?.();}abort(){this.aborted=true;this.onend?.();}};});
 await page.goto(`http://127.0.0.1:${server.address().port}/app`);await page.evaluate(()=>theibsApp.ready);await fields({'auto-analysis':false});
 await test('fresh defaults have no cost, price or position; voice defaults to continuous phrases',async()=>{
  for(const id of ['potBeforeAction','amountToCall','effectiveStack','position','players'])assert.equal(await page.locator('#'+id).inputValue(),'');
  assert.equal(await page.locator('#assumeNoRake').isChecked(),false);assert.equal(await page.locator('#voice-pace').inputValue(),'batch');
 });
 for(const count of [4,5,6])for(const street of [0,3,4,5])await test(`PLO${count} board ${street}: statistics without economics`,async()=>{
  await fields({'variant-select':count,players:2,samples:500,potBeforeAction:'',amountToCall:'',effectiveStack:'',position:'',assumeNoRake:false});
  await page.evaluate(({count,street})=>{theibsCardKeyboard.reset();theibsCardKeyboard.paste(['AE','KE','QC','JC','TO','9O'].slice(0,count).join(' ')+(street?' | '+['2E','3O','4P','5C','7E'].slice(0,street).join(' '):''));},{count,street});
  const r=await analyze();assert.equal(r.status,'OK');assert.ok(Number.isFinite(r.equity.equity));assert.equal(r.continuationAssessment.status,'UNAVAILABLE');
  assert.match(await page.locator('#statistics-model').innerText(),/cartas aleatórias/);assert.equal(await page.locator('#ev-value').innerText(),'—');
 });
 await test('incomplete percent costs do not block cards/equity and name the missing cap',async()=>{
  await fields({'rake-mode':'PERCENT_CAPPED','rake-rate':'5','rake-cap':'',potBeforeAction:100,amountToCall:10});
  const r=await analyze();assert.equal(r.status,'OK');assert.deepEqual(r.continuationAssessment.missingInputs,['rakeSchedule.cap']);
  assert.match(await page.locator('#analysis-next-detail').innerText(),/teto do rake/);
 });
 await test('explicit free CHECK has neutral tone; blank price does not become CHECK',async()=>{
  await fields({'rake-mode':'FIXED',amountToCall:0});const r=await analyze();assert.equal(r.continuationAssessment.status,'FREE_CHECK');
  assert.equal(await page.locator('#ev-summary').getAttribute('data-tone'),'neutral');
  await fields({amountToCall:''});assert.equal((await analyze()).continuationAssessment.status,'UNAVAILABLE');
 });
 await test('explicit Turn destination handles omitted prefix without guessing and cancels late old finals',async()=>{
  await page.evaluate(()=>{theibsCardVoice.cancel();theibsCardKeyboard.reset();document.querySelector('#card-voice-disclosure').open=true;});
  await fields({'voice-language':'pt-BR','voice-consent':true});
  await page.locator('[data-voice-target="turn"]').click();assert.match(await page.locator('#voice-destination-label').innerText(),/Turn/);
  await voiceStart();await emit(['oito de paus']);
  assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.slots[theibsCardKeyboard.state.count+3]),'8P');
  const old=await page.evaluate(()=>__asr.length-1);await page.locator('[data-voice-target="hero"]').click();
  const before=await page.evaluate(()=>JSON.stringify(theibsCardKeyboard.state.snapshot()));await emit(['oito de paus','rei de copas'],old);
  assert.equal(await page.evaluate(()=>JSON.stringify(theibsCardKeyboard.state.snapshot())),before);
 });
 await test('a clubs asks only rank; nothing is silently converted to ace or eight',async()=>{
  await page.evaluate(()=>{theibsCardVoice.cancel();theibsCardKeyboard.reset();});await fields({'voice-language':'en-US'});await voiceStart();
  await emit(['a clubs']);assert.equal(await page.evaluate(()=>theibsCardVoice.getStatus().needsClarification),true);
  assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.slots.filter(Boolean).length),0);
  await emit(['a clubs','eight']);assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.slots[0]),'8P');
 });
 await test('new destination controls fit a 390px viewport without horizontal overflow',async()=>{
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 });
 await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
 await test('no uncaught JavaScript errors',async()=>assert.deepEqual(report.pageErrors,[]));
 report.status=report.cases.every(x=>x.status==='PASS')?'PASS':'FAIL';
}catch(e){report.status='HARNESS_ERROR';report.error=e.stack;}finally{
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();await pool.close();server.closeAllConnections();if(server.listening)await new Promise(r=>server.close(r));
 console.log(JSON.stringify({status:report.status,tests:report.cases.length,failed:report.cases.filter(x=>x.status!=='PASS').map(x=>x.name)}));process.exit(report.status==='PASS'?0:1);
}})();
