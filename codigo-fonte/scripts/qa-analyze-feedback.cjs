'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const out=path.resolve(process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'../validacao/analyze-online-2026-09-27/analyze-feedback');
fs.mkdirSync(out,{recursive:true});assert.equal(fs.readdirSync(out).length,0,'Use a new evidence directory.');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-feedback-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const {server}=require('../server'),pool=require('../src/analysis-worker');
const report={scope:'LOCAL_REAL_HTTP_DEFAULTS_AND_INPUT_FEEDBACK',version:require('../package.json').version,notAPerformanceBenchmark:true,checks:[],requests:[],errors:[],status:'RUNNING'};
let browser,page;
async function check(name,fn){await fn();report.checks.push({name,status:'PASS'});console.log('PASS',name);}
const hero=['As','Ah','Ks','Kh','Qd'];
async function hand(board){await page.evaluate(({hero,board})=>theibsCardKeyboard.restore({count:5,slots:[...hero,...board].map(TheibsCards.fromCanonical).concat(Array(5-board.length).fill(null)),selected:5+Math.min(board.length,4)}),{hero,board});}
async function done(){await page.waitForFunction(()=>theibsApp.getState().lastAnalysis?.data.status==='OK'&&!theibsApp.getState().analysisBusy);return page.evaluate(()=>theibsApp.getState().lastAnalysis.data);}
(async()=>{try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true,channel:'msedge'});report.browser=browser.version();
  page=await browser.newPage({viewport:{width:1366,height:900},serviceWorkers:'block'});page.on('pageerror',e=>report.errors.push(e.message));
  page.on('request',request=>{if(request.url().endsWith('/api/analyze'))report.requests.push(request.postDataJSON());});
  await page.goto(`http://127.0.0.1:${server.address().port}/app`);await page.waitForFunction(()=>window.theibsApp);await page.evaluate(()=>theibsApp.ready);
  await check('fresh runtime defaults are Fast500, six players, uniform opponents, explicit zero rake',async()=>{
    report.defaults=await page.evaluate(()=>Object.fromEntries(['samples','players','potBeforeAction','amountToCall','effectiveStack','opponentModel','study-mode','assumeNoRake','auto-analysis'].map(id=>{const el=document.getElementById(id);return[id,el.type==='checkbox'?el.checked:el.value];})));
    assert.deepEqual(report.defaults,{samples:'500',players:'6',potBeforeAction:'12',amountToCall:'4',effectiveStack:'100',opponentModel:'UNIFORM','study-mode':'OFF',assumeNoRake:true,'auto-analysis':true});
  });
  await check('one/two flop cards display the exact remainder and make no calculation request',async()=>{
    for(const[board,remaining]of[[['2c'],2],[['2c','3d'],1]]){
      await hand(board);await page.waitForTimeout(140);
      assert.match(await page.locator('#analysis-next-detail').innerText(),new RegExp(`Add ${remaining} board card`));
      assert.equal(await page.locator('#ev-state').innerText(),'Waiting for cards');assert.equal(report.requests.length,0);
    }
    await hand(['2c']);await page.screenshot({path:path.join(out,'partial-flop.png'),fullPage:true});
  });
  await check('completing the flop starts the same500sample calculation automatically',async()=>{
    await hand(['2c','3d','4h']);const data=await done();assert.equal(data.equity.samples,500);assert.equal(data.equity.opponents,5);
    assert.equal(report.requests.length,1);assert.equal(report.requests[0].samples,'500');
    assert.equal(await page.locator('#analysis-next-title').innerText(),require('../public/continuation-view').describe(data.continuationAssessment).title);
    assert.equal(data.recommendation.status,'INCOMPLETE');
    assert.equal(data.continuationAssessment.status,'UNFAVORABLE');
    assert.equal(await page.locator('#ev-state').isVisible(),true);
    report.completedFlop={input:report.requests[0],equity:data.equity.equity,interval:data.equity.confidenceInterval95,ev:data.ev,recommendation:data.recommendation};
    await page.screenshot({path:path.join(out,'completed-flop.png'),fullPage:true});
  });
  await check('current CALL assessment does not require BET/RAISE assumptions',async()=>{
    assert.equal(await page.locator('#analysis-next-action').isVisible(),false);
    assert.equal(await page.locator('#study-mode').inputValue(),'OFF');
    assert.match(await page.locator('#ev-scope').innerText(),/sem comparar BET\/RAISE/);
  });
  await check('an explicitly removed cost assumption gets a cost link rather than a negative-EV label',async()=>{
    await page.evaluate(()=>{const el=document.getElementById('assumeNoRake');el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
    const data=await done();assert.notEqual(data.ev.actions.CALL.status,'MODELED');
    assert.equal(await page.locator('#analysis-next-title').innerText(),'Faltam dados para avaliar este preço');assert.equal(await page.locator('#ev-state').innerText(),'Sem avaliação do CALL');
    await page.locator('#analysis-next-action').click();assert.equal(await page.locator('#settings-dialog').isVisible(),true);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'rake-mode');await page.locator('#settings-dialog [data-close-dialog]').click();
  });
  await check('new visible feedback fits desktop and narrow layouts',async()=>{
    for(const width of[1366,390,320]){await page.setViewportSize({width,height:900});const size=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.width+2,JSON.stringify(size));}
    await page.screenshot({path:path.join(out,'feedback-mobile.png'),fullPage:true});
  });
  assert.deepEqual(report.errors,[]);report.status='PASS';
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;}
finally{await browser?.close();await pool.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure,out}));}})();
