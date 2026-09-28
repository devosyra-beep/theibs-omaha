'use strict';
// Real web UI with controlled recognizer events; no physical microphone or ASR.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const out=path.resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6)||'../validacao/voice-quality-2026-09-28/evaluation-browser');
assert.ok(!fs.existsSync(out),'Preserve previous evidence');fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-eval-qa-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'data.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const files=['card-voice.js','card-voice-ui.js','voice-evaluation.js','voice-evaluation-ui.js'];
const hashes=()=>Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../public',f))).digest('hex')]));
const report={at:new Date().toISOString(),layer:'REAL_BROWSER_CONTROLLED_EVENTS',human:'NOT_EXECUTED',microphone:'NOT_OPENED',cases:[],pageErrors:[],sourceHashes:hashes(),status:'RUNNING'};
let server,pool,browser,page;
const snap=()=>page.evaluate(()=>theibsCardKeyboard.state.snapshot());
const check=async(name,fn)=>{await fn();report.cases.push({name,status:'PASS'});console.log('PASS '+name);};
const count=()=>page.evaluate(()=>__asr.length);
async function startEval(){const before=await count();await page.locator('#voice-eval-start').click();await page.waitForFunction(n=>__asr.length>n&&__asr.at(-1).started,before);}
async function endEval(text){await page.evaluate(text=>{const r=__asr.at(-1);r.onresult?.({resultIndex:0,results:[Object.assign([{transcript:text}],{isFinal:true})]});r.onaudioend?.();r.onend?.();},text);}
(async()=>{try{
 ({server}=require('../server'));pool=require('../src/analysis-worker');await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({serviceWorkers:'block',viewport:{width:1440,height:1150}});page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.addInitScript(()=>{window.__asr=[];window.__delayEnd=false;window.SpeechRecognition=class{constructor(){__asr.push(this);}start(){this.started=true;this.onstart?.();this.onaudiostart?.();}stop(){this.stopped=true;}abort(){this.aborted=true;if(!__delayEnd)this.onend?.();}};});
 await page.goto(`http://127.0.0.1:${server.address().port}/app`);await page.evaluate(()=>theibsApp.ready);
 await page.evaluate(()=>{document.querySelector('#auto-analysis').checked=false;theibsCardKeyboard.paste('8P TE QC KO AO');});
 const initial=await snap();await page.locator('#card-voice-disclosure>summary').click();await page.locator('#voice-evaluation>summary').click();
 await check('opening evaluation or clicking without consent never opens a recognizer',async()=>{await page.locator('#voice-eval-start').click();assert.equal(await count(),0);assert.deepEqual(await snap(),initial);});
 await page.locator('#voice-eval-consent').check();await page.locator('#voice-eval-remote').check();await page.locator('#voice-consent').check();
 await check('evaluation waits for table recognizer release and blocks table restart',async()=>{
  await page.locator('#voice-toggle').click();await page.waitForFunction(()=>theibsCardVoice.getStatus().audioReady);
  const n=await count();await page.evaluate(()=>window.__delayEnd=true);await page.locator('#voice-eval-start').click();
  assert.equal(await count(),n);assert.equal(await page.evaluate(()=>theibsVoiceEvaluation.isActive()),true);
  assert.equal(await page.evaluate(()=>__asr.at(-1).aborted),true);await page.locator('#voice-toggle').click();assert.equal(await count(),n);
  await page.evaluate(()=>__asr.at(-1).onend());await page.waitForFunction(n=>__asr.length===n+1&&__asr.at(-1).started,n);
  await page.locator('#voice-toggle').click();assert.equal(await count(),n+1);assert.match(await page.locator('#voice-eval-status').innerText(),/Ouvindo/);
 });
 await check('final evaluation scores once without changing actual cards and selection',async()=>{
  const phrase=await page.locator('#voice-eval-prompt').innerText();await endEval(phrase);
  const result=await page.evaluate(()=>theibsVoiceEvaluation.getSummary());assert.equal(result.total.attempts,1);assert.equal(result.total.exact,1);assert.deepEqual(await snap(),initial);
  assert.equal(await page.evaluate(()=>theibsVoiceEvaluation.isActive()),false);assert.equal(JSON.stringify(result).includes(phrase),false);assert.equal(result.privacy.audioStored,false);assert.equal(result.privacy.transcriptsStored,false);
 });
 await check('cancelled evaluation keeps microphone ownership until native end',async()=>{
  await startEval();const n=await count();await page.locator('#voice-eval-cancel').click();assert.equal(await page.evaluate(()=>theibsVoiceEvaluation.isActive()),true);
  await page.locator('#voice-toggle').click();assert.equal(await count(),n);
  await page.evaluate(()=>__asr.at(-1).onend());assert.equal(await page.evaluate(()=>theibsVoiceEvaluation.isActive()),false);
  assert.equal((await page.evaluate(()=>theibsVoiceEvaluation.getSummary())).total.cancellations,1);assert.deepEqual(await snap(),initial);
 });
 await page.evaluate(()=>window.__delayEnd=false);
 await check('revoking evaluation consent aborts and late results cannot score twice',async()=>{
  await startEval();const n=await count();await page.locator('#voice-eval-consent').uncheck();const before=await page.evaluate(()=>theibsVoiceEvaluation.getSummary());
  await page.evaluate(i=>{const r=__asr[i-1];r.onresult({resultIndex:0,results:[Object.assign([{transcript:'ás de espadas'}],{isFinal:true})]});r.onend();},n);
  assert.deepEqual(await page.evaluate(()=>theibsVoiceEvaluation.getSummary()),before);assert.deepEqual(await snap(),initial);await page.locator('#voice-eval-consent').check();
 });
 await check('session change cancels evaluation and retains failed attempt',async()=>{
  await startEval();await page.evaluate(()=>document.dispatchEvent(new CustomEvent('theibs:voice-session-changed')));
  assert.equal(await page.evaluate(()=>theibsVoiceEvaluation.isActive()),false);assert.deepEqual(await snap(),initial);assert.equal((await page.evaluate(()=>theibsVoiceEvaluation.getSummary())).total.cancellations,3);
 });
 await check('English evaluation uses selected language and isolated scoring',async()=>{
  await page.locator('#voice-eval-language').selectOption('en-US');await startEval();assert.equal(await page.evaluate(()=>__asr.at(-1).lang),'en-US');
  await endEval(await page.locator('#voice-eval-prompt').innerText());const result=await page.evaluate(()=>theibsVoiceEvaluation.getSummary());assert.equal(result.total.exact,2);assert.deepEqual(await snap(),initial);
 });
 await check('unsupported device mode never opens remote recognition or installs a model',async()=>{
  await page.locator('#voice-eval-processing').selectOption('device');const n=await count();await page.locator('#voice-eval-start').click();
  await page.waitForFunction(()=>!theibsVoiceEvaluation.isActive());assert.equal(await count(),n);assert.equal((await page.evaluate(()=>theibsVoiceEvaluation.getSummary())).total.startFailures,1);assert.deepEqual(await snap(),initial);
 });
 await check('normal table voice is available again after evaluation ends',async()=>{
  const n=await count();await page.locator('#voice-toggle').click();await page.waitForFunction(n=>__asr.length===n+1&&theibsCardVoice.getStatus().audioReady,n);await page.locator('#voice-cancel').click();assert.deepEqual(await snap(),initial);
 });
 await check('expanded evaluation remains usable on a narrow screen without horizontal overflow',async()=>{
  await page.setViewportSize({width:390,height:844});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);await page.screenshot({path:path.join(out,'evaluation-mobile.png'),fullPage:true});
 });
 await page.setViewportSize({width:1440,height:1150});await page.screenshot({path:path.join(out,'evaluation-desktop.png'),fullPage:true});
 assert.deepEqual(report.pageErrors,[]);report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;await page?.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}
finally{report.finalSourceHashes=hashes();report.sourceChangedDuringRun=JSON.stringify(report.sourceHashes)!==JSON.stringify(report.finalSourceHashes);fs.writeFileSync(path.join(out,'browser-qa.json'),JSON.stringify(report,null,2));await browser?.close();await pool?.close();server?.closeAllConnections?.();await new Promise(r=>server?server.close(r):r());console.log(JSON.stringify({status:report.status,cases:report.cases.length,error:report.error}));}})().then(()=>process.exit(process.exitCode||0));
