'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const out=path.resolve(process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'../validacao/continuar-2026-09-28/browser');
fs.mkdirSync(out,{recursive:true});assert.equal(fs.readdirSync(out).length,0,'Use new evidence directory.');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-continuation-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const {server}=require('../server'),pool=require('../src/analysis-worker');
const report={version:require('../package.json').version,scope:'LOCAL_BROWSER_REAL_HTTP',status:'RUNNING',checks:[],errors:[],requests:[]};
let page,browser,origin;
async function setup({players=6,call=4,hero=['As','Ah','Ks','Kh','Qd'],board=['2c','3d','4h'],samples='500',zero=true}={}){
 await page.evaluate(({players,call,hero,board,samples,zero})=>{
  document.getElementById('auto-analysis').checked=false;
  for(const[id,value]of Object.entries({players,amountToCall:call,potBeforeAction:12,effectiveStack:100,position:'BTN',samples,seed:42,rake:''}))document.getElementById(id).value=String(value);
  document.getElementById('assumeNoRake').checked=zero;theibsOpponentInputs.reset();
  theibsCardKeyboard.restore({count:5,slots:[...hero.map(TheibsCards.fromCanonical),...board.map(TheibsCards.fromCanonical),...Array(5-board.length).fill(null)],selected:5});
  document.getElementById('amountToCall').dispatchEvent(new Event('change',{bubbles:true}));theibsCardPicker.close();
 },{players,call,hero,board,samples,zero});
}
async function analyze(){const before=report.requests.length;await page.locator('#quick-analyze').click();await page.waitForFunction(()=>!theibsApp.getState().analysisBusy&&theibsApp.getState().lastAnalysis?.data.analysisStage==='FINAL');const data=await page.evaluate(()=>theibsApp.getState().lastAnalysis.data);return{data,requests:report.requests.length-before};}
async function check(name,fn){await fn();report.checks.push({name,status:'PASS'});console.log('PASS',name);}
(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true,channel:'msedge'});page=await browser.newPage({viewport:{width:1366,height:900},serviceWorkers:'block'});report.browser=browser.version();
 page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/api/analyze'))report.requests.push(r.postDataJSON());});
 await page.goto(origin+'/app');await page.waitForFunction(()=>window.theibsApp);await page.evaluate(()=>theibsApp.ready);
 await check('Favorable current CALL is visible despite missing RAISE, with no added calculation',async()=>{
  await setup({hero:['As','Ks','Qh','Jh','Td'],board:['Qs','Js','Ts','2c','3d']});const {data,requests}=await analyze();assert.equal(requests,1);assert.equal(data.continuationAssessment.status,'FAVORABLE');assert.equal(data.recommendation.status,'INCOMPLETE');assert.equal(data.recommendation.action,null);assert.equal(await page.locator('#ev-summary').getAttribute('data-tone'),'positive');assert.match(await page.locator('#analysis-next-title').innerText(),/Preço favorável/);assert.equal(await page.locator('#analysis-next-action').isVisible(),false);assert.match(await page.locator('#continuation-metrics').innerText(),/25.0%/);assert.match(await page.locator('#continuation-risk').innerText(),/Nuts.*empates/);report.favorable=data.continuationAssessment;await page.locator('#ev-summary').screenshot({path:path.join(out,'favorable.png')});
 });
 await check('Unfavorable and crossing-zero intervals get distinct labels and no green signal',async()=>{
  await setup();let {data}=await analyze();assert.equal(data.continuationAssessment.status,'UNFAVORABLE');assert.equal(await page.locator('#ev-summary').getAttribute('data-tone'),'negative');assert.match(await page.locator('#analysis-next-title').innerText(),/desfavorável/);
  await setup({players:2,call:9.052631578947368});({data}=await analyze());assert.equal(data.continuationAssessment.status,'UNCERTAIN');assert.equal(await page.locator('#ev-summary').getAttribute('data-tone'),'neutral');assert.match(await page.locator('#analysis-next-title').innerText(),/sem margem/);assert.match(await page.locator('#analysis-next-action').innerText(),/precisão/);report.uncertain=data.continuationAssessment;
 });
 await check('Same hand changes signal when the call price changes; previous signal clears immediately',async()=>{
  await setup({players:2,call:1});assert.equal((await analyze()).data.continuationAssessment.status,'FAVORABLE');
  await page.evaluate(()=>{const input=document.getElementById('amountToCall');input.value='60';input.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await page.locator('#ev-summary').getAttribute('data-tone'),'pending');assert.equal(await page.locator('#continuation-metrics').isVisible(),false);assert.equal((await analyze()).data.continuationAssessment.status,'UNFAVORABLE');
 });
 await check('Free CHECK is neutral even with positive CHECK EV; unknown costs block paid CALL',async()=>{
  await setup({call:0});let {data}=await analyze();assert.equal(data.continuationAssessment.status,'FREE_CHECK');assert.ok(data.ev.actions.CHECK.ev>0);assert.equal(await page.locator('#ev-summary').getAttribute('data-tone'),'neutral');assert.match(await page.locator('#analysis-next-title').innerText(),/CHECK sem pagar/);
  await setup({zero:false});({data}=await analyze());assert.equal(data.continuationAssessment.status,'UNAVAILABLE');assert.equal(await page.locator('#ev-summary').getAttribute('data-tone'),'pending');await page.locator('#analysis-next-action').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'rake-mode');await page.locator('#settings-dialog [data-close-dialog]').click();
 });
 await check('Preview never shows favorable and final uses only the two existing requests',async()=>{
  await setup({hero:['As','Ks','Qh','Jh','Td'],board:['Qs','Js','Ts','2c','3d'],samples:'10000'});
  let release,received;const gate=new Promise(r=>release=r),arrived=new Promise(r=>received=r);
  await page.route('**/api/analyze',async route=>{if(route.request().postDataJSON().analysisPhase!=='FINAL')return route.continue();const response=await route.fetch();received();await gate;await route.fulfill({response});});
  const before=report.requests.length;await page.locator('#quick-analyze').click();await arrived;assert.equal(await page.locator('#ev-summary').getAttribute('data-tone'),'pending');assert.match(await page.locator('#ev-state').innerText(),/Prévia/);release();await page.waitForFunction(()=>!theibsApp.getState().analysisBusy);assert.equal(await page.locator('#ev-summary').getAttribute('data-tone'),'positive');assert.equal(report.requests.length-before,2);await page.unroute('**/api/analyze');
 });
 await check('Coach and saved street snapshot use the same assessment, with stale-input invalidation',async()=>{
  const state=await page.evaluate(()=>({input:theibsApp.getAnalysisInput(),data:theibsApp.getState().lastAnalysis.data,snapshot:theibsApp.getState().snapshots.find(item=>item.analysisId===theibsApp.getState().lastAnalysis.data.analysisId)}));assert.deepEqual(state.snapshot.continuationAssessment,state.data.continuationAssessment);
  const response=await page.request.post(origin+'/api/analysis/doubt',{data:{input:state.input,question:'Posso seguir com essa mão?',responseMode:'LOCAL_FIRST'}});assert.equal(response.status(),200);const answer=await response.json();assert.deepEqual(answer.context.continuationAssessment,state.data.continuationAssessment);assert.match(answer.answer.answer,/Preço favorável/);assert.match(answer.answer.answer,/nenhuma aposta futura/);
  await page.evaluate(()=>theibsApp.flushSave());await page.waitForFunction(()=>!theibsApp.getState().saveBusy);await page.reload();await page.waitForFunction(()=>window.theibsApp);await page.evaluate(()=>theibsApp.ready);assert.equal(await page.locator('#ev-summary').getAttribute('data-tone'),'positive');
  await page.evaluate(()=>theibsCardKeyboard.reset());assert.equal(await page.locator('#ev-summary').getAttribute('data-tone'),'pending');assert.equal(await page.locator('#continuation-metrics').isVisible(),false);
 });
 await check('Assessment fits desktop and mobile without horizontal overflow',async()=>{
  await setup({players:2,call:1});await analyze();for(const width of[1366,390,320]){await page.setViewportSize({width,height:900});const bounds=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.ok(bounds.scroll<=bounds.width+2);assert.equal(await page.locator('#analysis-next-title').isVisible(),true);}await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
 });
 assert.deepEqual(report.errors,[]);report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;await page?.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}
finally{await browser?.close();await pool.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error}));}})();
