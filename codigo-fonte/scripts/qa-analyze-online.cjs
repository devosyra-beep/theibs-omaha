'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const out=path.resolve(process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'../validacao/analyze-online-2026-09-27/analyze-ui');
fs.mkdirSync(out,{recursive:true});assert.equal(fs.readdirSync(out).length,0,'Use a new QA directory.');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-analyze-qa-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const {server}=require('../server'),pool=require('../src/analysis-worker');
const report={execution:'LOCAL_EXECUTED',scope:'ANALYZE_REAL_HTTP_WITH_SEPARATE_PANEL_FIXTURE',version:require('../package.json').version,checks:[],errors:[],status:'RUNNING'};
let browser,page;
const check=async(name,fn)=>{await fn();report.checks.push({name,status:'PASS'});console.log('PASS',name);};
(async()=>{try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true,channel:'msedge'});report.browser=browser.version();
  page=await browser.newPage({viewport:{width:1366,height:900}});page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/app`);await page.waitForFunction(()=>window.theibsApp);await page.evaluate(()=>theibsApp.ready);
  await check('BB option and percentage costs travel from Analyze form to the real engine',async()=>{
    await page.evaluate(()=>{
      document.getElementById('auto-analysis').checked=false;
      const fields={players:2,position:'BB',potBeforeAction:4,amountToCall:0,effectiveStack:98,samples:500,seed:821,opponentHand:'',opponentRange:'',opponentModel:'UNIFORM',
        'study-mode':'UNIFORM','study-hero-contribution':2,'study-min-raise':4,'study-min-bet':2,'study-contribution-0':2,'study-probability-0':55,raiseTo:4,
        'rake-mode':'PERCENT_CAPPED','rake-rate':5,'rake-cap':6,'analysis-big-blind':2,'analysis-equivalence':.1};
      for(const[id,value]of Object.entries(fields))document.getElementById(id).value=String(value);
      document.getElementById('rake-no-flop').checked=true;document.getElementById('study-accept').checked=true;
      theibsCardKeyboard.restore({count:5,slots:[...['As','Ks','Qh','Jh','Tc'].map(TheibsCards.fromCanonical),...Array(5).fill(null)],selected:5});
      document.getElementById('players').dispatchEvent(new Event('change',{bubbles:true}));
      theibsOpponentInputs.restore({...theibsOpponentInputs.snapshot(),opponents:[{seatId:0,enabled:true,callProbability:.55}],studyAccepted:true});theibsCardPicker.close();
    });
    const received=page.waitForResponse(r=>r.url().endsWith('/api/analyze')&&r.request().postDataJSON()?.analysisPhase==='FINAL');
    await page.locator('#quick-analyze').click();const responseData=await (await received).json();assert.equal(responseData.status,'OK',JSON.stringify(responseData));await page.waitForFunction(()=>!theibsApp.getState().analysisBusy&&theibsApp.getState().lastAnalysis?.data.status==='OK');
    const state=await page.evaluate(()=>({input:theibsApp.getAnalysisInput(),data:theibsApp.getState().lastAnalysis.data}));
    assert.deepEqual(state.data.legalActions,['CHECK','RAISE']);assert.equal(state.data.ev.actions.RAISE.status,'MODELED');assert.equal(state.input.rakeSchedule.rate,.05);
    assert.equal(state.data.analysisDiagnostics.selectionMethod,'SHARED_EQUITY_AFFINE_DIFFERENCES');
    report.analysisId=state.data.analysisId;
  });
  await check('changing cost assumptions invalidates the result and is persisted on reload',async()=>{
    await page.evaluate(()=>{const x=document.getElementById('rake-rate');x.value='7';x.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.evaluate(()=>theibsApp.getState().lastAnalysis),null);
    await page.evaluate(()=>theibsApp.flushSave());await page.waitForFunction(()=>!theibsApp.getState().saveBusy);
    await page.reload();await page.waitForFunction(()=>window.theibsApp);await page.evaluate(()=>theibsApp.ready);
    assert.equal(await page.evaluate(()=>theibsApp.getAnalysisInput().rakeSchedule.rate),.07);
  });
  await check('economic panel distinguishes mean, probability, reference capital and model evidence',async()=>{
    // Deliberately labeled UI fixture, never written into bundled evidence.
    const interval={lower:-20,upper:30,level:.95};
    const fixture={status:'OK',stale:false,report:{schemaVersion:1,evidenceOrigin:'SIMULATION',execution:'UI_FIXTURE_ONLY',protocolId:'QA_FIXTURE',protocolHash:'fixture',candidateVersion:report.version,baselineVersion:'0.13.0',createdAt:'QA',referenceCapitalBB:1000,
      scenarios:[{id:'qa',label:'QA FIXTURE',nBlocks:20,handsPerBlock:100,nHands:2000,opponentFamily:'SYNTHETIC',cost:{type:'ZERO_CONTROL'},policies:[{id:'candidate',version:report.version,meanBB100:5,meanCI:interval,deltaBB100:2,deltaCI:interval,referenceCapitalPercent:.5,referenceCapitalPercentCI:{...interval,lower:-2,upper:3},pPositive:.6,pPositiveCI:{lower:.3,upper:.8},pZero:0,pNegative:.4,quantiles100:{p05:-100,p50:7,p95:120},predictive100:{lower:-110,upper:130,coverage:.9,status:'FIXTURE'},coverage:{decisions:100,supported:30,abstentions:70,errors:0,timeouts:0,reasonCounts:{OVERLAPPING_INTERVALS:70}},maxDrawdownBB:50,claim:'INCONCLUSIVE'}]}],limitations:['QA fixture; not financial evidence.']}};
    await page.route('**/api/analysis/experiments',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)}));
    await page.locator('#analyze-economics > summary').click();await page.waitForSelector('#economic-report:not([hidden])');
    const text=await page.locator('#economic-report').innerText();assert.match(text,/0,5%/);assert.match(text,/60%/);assert.match(text,/IC da média/);assert.match(await page.locator('#economic-status').innerText(),/mão atual/);assert.match(text,/UI_FIXTURE_ONLY/);
    assert.equal(await page.evaluate(()=>theibsApp.getAnalysisInput().rakeSchedule.rate),.07);
    await page.screenshot({path:path.join(out,'analyze-economic-fixture.png'),fullPage:true});
    await page.unroute('**/api/analysis/experiments');
  });
  await check('Analyze additions fit tested desktop and narrow browser viewports',async()=>{
    for(const width of [1366,1024,390,320]){await page.setViewportSize({width,height:900});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      const size=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.width+2,JSON.stringify({width,...size}));
      for(const count of [4,5,6]) {
        const gap=await page.evaluate(count=>{
          theibsCardKeyboard.restore({count,slots:[...['As','Ks','Qh','Jh','Td','9d'].slice(0,count),...['2s','3h','4d','7c','8c']].map(TheibsCards.fromCanonical),selected:0});
          const board=[...document.querySelectorAll('#board-slots [data-slot]')].map(x=>x.getBoundingClientRect());
          const hero=[...document.querySelectorAll('#hero-slots [data-slot]')].map(x=>x.getBoundingClientRect());
          return Math.min(...hero.map(x=>x.top))-Math.max(...board.map(x=>x.bottom));
        },count);
        assert.ok(gap>=8,`Cards overlap with study panel expanded: ${width}/PLO${count}/${gap}`);
      }
    }
    await page.setViewportSize({width:1366,height:900});
  });
  await check('a stale server cannot interpret a newer interface silently',async()=>{
    let calculations=0; const countRequest=request=>{if(request.url().endsWith('/api/analyze'))calculations++;};
    await page.route('**/api/status',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'OK',version:'0.12.2',llmProvider:'none'})}));
    page.on('request',countRequest);await page.reload();await page.waitForFunction(()=>window.theibsApp);await page.evaluate(()=>theibsApp.ready);
    assert.equal(await page.locator('#engine-build-warning').isVisible(),true);
    assert.match(await page.locator('#engine-build-warning').innerText(),/0.12.2/);
    const blocked=await page.evaluate(()=>{try{theibsApp.getAnalysisInput();return false;}catch(error){return /incompatíveis/.test(error.message);}});
    assert.equal(blocked,true);await page.locator('#quick-analyze').click();assert.equal(calculations,0);
    page.off('request',countRequest);await page.unroute('**/api/status');
  });
  assert.deepEqual(report.errors,[]);report.status='PASS';
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;}
finally{await browser?.close();await pool.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}})();
