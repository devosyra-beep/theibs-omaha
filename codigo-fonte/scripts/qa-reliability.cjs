'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-reliability-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const {server}=require('../server'),pool=require('../src/analysis-worker'),llama=require('../src/llama-config');
const out=path.resolve(process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'../validacao/execucao-2026-09-27/integration');
fs.mkdirSync(out,{recursive:true});
const report={evidence:'LOCAL_EXECUTED',engineBuild:require('../package.json').version,environment:'EDGE_HTTP',at:new Date().toISOString(),checks:[],errors:[],status:'RUNNING'};
let browser,page,pendingLLM=null;
const fake=http.createServer(async(req,res)=>{for await(const _ of req){} pendingLLM=res;});
const check=async(name,run)=>{await run();report.checks.push({name,status:'PASS'});console.log('PASS',name);};
async function setup(board=['2s','3h','4d']){
  await page.evaluate(board=>{
    document.querySelector('#auto-analysis').checked=false;
    const fields={players:'2',position:'BTN',potBeforeAction:'10',amountToCall:'1',effectiveStack:'100',samples:'10000',seed:'42',opponentHand:'',opponentRange:'',rake:'',opponentModel:'UNIFORM'};
    for(const[id,value]of Object.entries(fields))document.getElementById(id).value=value;
    document.querySelector('#assumeNoRake').checked=true;
    theibsCardKeyboard.restore({count:4,slots:[...['As','Ks','Qh','Jh',...board].map(TheibsCards.fromCanonical),...Array(5-board.length).fill(null)],selected:0});
    document.querySelector('#players').dispatchEvent(new Event('change',{bubbles:true}));
    theibsCardPicker.close();
  },board);
}
async function analyze(){await page.locator('#quick-analyze').click();await page.waitForFunction(()=>theibsApp.getState().lastAnalysis?.data.analysisStage==='FINAL'&&!theibsApp.getState().analysisBusy);return page.evaluate(()=>theibsApp.getState().lastAnalysis);}
(async()=>{
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));await new Promise(r=>fake.listen(0,'127.0.0.1',r));
    browser=await chromium.launch({headless:!process.argv.includes('--headed'),channel:'msedge'});
    page=await browser.newPage({viewport:{width:1366,height:900}});page.setDefaultTimeout(20000);
    page.on('pageerror',error=>report.errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    const origin=`http://127.0.0.1:${server.address().port}`;
    await page.goto(origin+'/app');await page.waitForFunction(()=>window.theibsApp);await page.evaluate(()=>theibsApp.ready);
    await check('provisional and final calculations share current input, never give unsupported imperative advice',async()=>{
      await setup();const data=await analyze();
      assert.equal(data.data.recommendation.action,null);assert.equal(await page.locator('#quick-action').innerText(),require('../public/continuation-view').describe(data.data.continuationAssessment).shortTitle);
      const m=await page.evaluate(()=>theibsMetrics.analyses);assert.ok(m.some(x=>x.phase==='PREVIEW'));assert.ok(m.some(x=>x.phase==='FINAL'));
      assert.equal(data.data.provenance.schemaVersion,2);assert.ok(data.data.clientTiming.inputToFrameMs>0);
      report.firstAnalysisTiming=data.data.clientTiming;
    });
    await check('board extension preserves prior compatible street; range or rake edits invalidate charts',async()=>{
      await setup(['2s','3h','4d','7c']);await analyze();
      let items=await page.evaluate(()=>theibsApp.getState().snapshots.filter(x=>!x.stale));assert.deepEqual(items.map(x=>x.street),['FLOP','TURN']);
      await page.evaluate(()=>{document.querySelector('#rake').value='1';document.querySelector('#rake').dispatchEvent(new Event('input',{bubbles:true}));});
      assert.equal(await page.evaluate(()=>theibsApp.getState().snapshots.filter(x=>!x.stale).length),0);
      assert.equal(await page.locator('#timeline-range').innerText(),'—');
    });
    await check('invalid manual draft invalidates every former snapshot',async()=>{
      await setup();await analyze();
      await page.evaluate(()=>{const field=document.querySelector('#heroCards');field.value='AE AE';field.dispatchEvent(new Event('input',{bubbles:true}));});
      assert.equal(await page.evaluate(()=>theibsCardKeyboard.isManualInvalid()),true);
      assert.equal(await page.evaluate(()=>theibsApp.getState().snapshots.filter(x=>!x.stale).length),0);
      assert.equal(await page.evaluate(()=>theibsApp.getState().lastAnalysis),null);
    });
    await check('versioned snapshot and draft restore exactly without the old hardcoded version',async()=>{
      await setup(['2s','3h','4d','7c','8c']);const before=await analyze();
      await page.evaluate(()=>theibsApp.flushSave());await page.waitForFunction(()=>!theibsApp.getState().saveBusy);
      await page.reload();await page.waitForFunction(()=>window.theibsApp);await page.evaluate(()=>theibsApp.ready);
      const after=await page.evaluate(()=>theibsApp.getState().lastAnalysis);assert.equal(after?.data.analysisId,before.data.analysisId);
      await page.screenshot({path:path.join(out,'analysis.png')});
    });
    await check('a delayed real response cannot paint or save results after card changes',async()=>{
      await setup();let release,received;
      const gate=new Promise(r=>release=r),seen=new Promise(r=>received=r);
      await page.route('**/api/analyze',async route=>{const response=await route.fetch();received();await gate;try{await route.fulfill({response});}catch{}});
      await page.locator('#quick-analyze').click();await seen;
      await page.evaluate(()=>{theibsCardKeyboard.select(0);});await page.locator('[data-slot="0"]').focus();await page.keyboard.press('Delete');
      release();await page.waitForFunction(()=>!theibsApp.getState().analysisBusy);await page.unroute('**/api/analyze');
      assert.equal(await page.evaluate(()=>theibsApp.getState().lastAnalysis),null);assert.equal(await page.locator('#nuts-badge').isVisible(),false);
    });
    await check('local coach is visible and actions remain usable while optional mock LLM is stalled',async()=>{
      llama.saveConfig({provider:'ollama',model:'qa:1b',baseUrl:`http://127.0.0.1:${fake.address().port}`});
      await page.evaluate(()=>theibsApp.showView('train'));await page.locator('#training-start').click();
      await page.waitForFunction(()=>theibsApp.getState().trainingSession&&!theibsApp.getState().trainingBusy);
      await page.locator('#training-question').fill('Explain this hand');await page.locator('#training-ask').click();
      await page.locator('#training-coach .coach-summary').waitFor();await page.waitForFunction(()=>!theibsApp.getState().trainingBusy);
      for(let i=0;i<100&&!pendingLLM;i++)await new Promise(r=>setTimeout(r,10));assert.ok(pendingLLM);
      assert.equal(await page.locator('#training-action-buttons [data-action="FOLD"]').isEnabled(),true);
      await page.locator('#training-action-buttons [data-action="FOLD"]').click();await page.waitForFunction(()=>theibsApp.getState().trainingSession.finished);
      pendingLLM.end(JSON.stringify({message:{content:'{"factIds":["equity","limitations"]}'}}));pendingLLM=null;
      assert.equal(await page.locator('#training-coach').innerText(),'');
    });
    await check('history API/UI preserve missing results and declare aggregation/window/cohort',async()=>{
      const response=await fetch(origin+'/api/training/history');const data=await response.json();
      assert.equal(data.historyScope.storageRead,'WORKER_THREAD');assert.ok(data.outcomeTimeline[0].cohortId);
      await page.evaluate(()=>theibsApp.showView('history'));await page.locator('#history-outcomes svg').waitFor();
      assert.match(await page.locator('#history-outcomes').innerText(),/latest cohort/);
      require('../src/training-store').appendEvent({type:'HAND_COMPLETE',sessionId:'missing',outcome:{}},process.env.THEIBS_DATA_PATH);
      const next=await(await fetch(origin+'/api/training/history')).json();assert.equal(next.outcomeTimeline.at(-1).net,null);
      assert.equal(next.summary.unknownNetResults,1);
    });
    await check('main views remain usable at desktop and small viewport widths',async()=>{
      await page.evaluate(()=>theibsApp.showView('analyze'));
      for(const [width,height]of [[1366,768],[1024,768],[390,844],[320,844]]){
        await page.setViewportSize({width,height});
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
        assert.equal(overflow,false,`horizontal overflow at ${width}`);
        for(const count of [4,5,6]){
          const separation=await page.evaluate(count=>{theibsCardKeyboard.restore({count,slots:[...['As','Ks','Qh','Jh','Td','9d'].slice(0,count),...['2s','3h','4d','7c','8c']].map(TheibsCards.fromCanonical),selected:0});const board=[...document.querySelectorAll('#board-slots [data-slot]')].map(x=>x.getBoundingClientRect());const hero=[...document.querySelectorAll('#hero-slots [data-slot]')].map(x=>x.getBoundingClientRect());return Math.min(...hero.map(x=>x.top))-Math.max(...board.map(x=>x.bottom));},count);
          assert.ok(separation>=8,`board/hole cards overlap or lack clearance: ${width}/PLO${count}/${separation}`);
        }
      }
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:path.join(out,'small-viewport.png')});
    });
    assert.deepEqual(report.errors,[]);report.status='PASS';
  }catch(error){report.status='FAIL';report.failure=error.stack;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;}
  finally{
    pendingLLM?.end('{}');if(browser)await browser.close();await pool.close();fake.closeAllConnections();server.closeAllConnections();
    await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>fake.close(r))]);
    fs.writeFileSync(path.join(out,'qa-reliability.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure}));
  }
})();
