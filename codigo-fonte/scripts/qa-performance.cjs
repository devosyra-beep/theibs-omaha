'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium,_electron}=require('playwright');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-speed-'));process.env.THEIBS_DATA_PATH=path.join(temp,'events.jsonl');process.env.THEIBS_WORKSPACE_PATH=path.join(temp,'workspace.json');
 const native=process.argv.includes('--electron'),out=path.resolve(process.argv.find(arg=>arg.startsWith('--out='))?.slice(6)||path.resolve(__dirname,'../../validacao/performance-v'+require('../package.json').version));fs.mkdirSync(out,{recursive:true});
 const report={version:require('../package.json').version,environment:native?'PACKAGED_ELECTRON_HTTP':'EDGE_HTTP',requests:[],errors:[],status:'RUNNING'};let server,browser,electron,page;
 try{
  if(native){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;electron=await _electron.launch({executablePath:process.env.THEIBS_EXECUTABLE||path.resolve(__dirname,'../../THEIBS/THEIBS.exe'),args:['--user-data-dir='+path.join(temp,'profile')],env});page=await electron.firstWindow();}
  else{({server}=require('../server'));await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true,channel:'msedge'});page=await browser.newPage({viewport:{width:1366,height:768}});await page.goto(`http://127.0.0.1:${server.address().port}/app`);}
  page.on('pageerror',e=>report.errors.push(e.message));await page.waitForFunction(()=>Boolean(window.theibsApp));await page.evaluate(()=>theibsApp.ready);
  for(const n of [4,5,6])for(const opponents of [1,5])for(const board of [[],['2s','3h','4d']]){
   const input={variant:`PLO${n}_HIGH`,heroCards:['As','Ks','Qh','Jh','Td','9d'].slice(0,n),board,position:'BTN',players:opponents+1,potBeforeAction:12,amountToCall:4,effectiveStack:100,unknownOpponentModel:'UNIFORM',samples:50000,samplingMode:'ADAPTIVE',assumeNoRake:true,seed:428};
   const r=await page.evaluate(async input=>{const t=performance.now(),response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),data=await response.json();return {data,elapsedMs:performance.now()-t};},input);
   assert.equal(r.data.status,'OK',JSON.stringify(r.data));assert.equal(r.data.engineBuild,report.version);assert.equal(r.data.equity.samplingMode,'ADAPTIVE');
   const e=r.data.equity;report.requests.push({variant:input.variant,opponents,street:board.length?'FLOP':'PREFLOP',elapsedMs:r.elapsedMs,simulationMs:e.elapsedMs,samples:e.samples,stopReason:e.stopReason,equity:e.equity,interval:e.confidenceInterval95,within3s:r.elapsedMs<=3000,precisionOrDecisionReached:['PRECISION','CALL_EV_SIGN'].includes(e.stopReason)});
  }
  await page.locator('#open-settings').click();await page.locator('#samples').selectOption('adaptive');await page.locator('#settings-dialog [data-close-dialog]').click();await page.locator('[data-slot="0"]').click();await page.keyboard.type('aeke2p3p4o');
  await page.waitForFunction(()=>theibsApp.getState().lastAnalysis?.data.equity?.samplingMode==='ADAPTIVE');
  assert.match(await page.locator('#ev-assumption').textContent(),/sampling|sample|interval/i);assert.match(await page.locator('#ev-assumption').textContent(),/simulations/i);
  for(const [width,height]of [[1366,768],[1024,660]]){await page.setViewportSize({width,height});const s=await page.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight}));assert.ok(s.w<=width&&s.h<=height);}
  await page.setViewportSize({width:1366,height:768});await page.screenshot({path:path.join(out,`${native?'electron':'edge'}-adaptive.png`)});
  await page.evaluate(()=>theibsApp.flushSave());assert.deepEqual(report.errors,[]);
  report.latencyScope='BROWSER_FETCH_THROUGH_PARSED_JSON_EXCLUDES_INPUT_DEBOUNCE_AND_PAINT';
  report.limitations=['One observation per scenario is a smoke check, not a p95 or p99 SLA.'];
  report.latencyTargetPassed=report.requests.every(row=>row.within3s);
  report.resolutionTargetPassed=report.requests.every(row=>row.precisionOrDecisionReached);
  assert.ok(report.latencyTargetPassed,'At least one observed request exceeded 3 seconds.');
  assert.ok(report.resolutionTargetPassed,'At least one request stopped before precision or call-sign separation was reached.');
  report.status='PASS_FUNCTIONAL_AND_OBSERVED_TARGETS';
 }catch(e){report.status='FAIL';report.failure=e.stack;throw e;}
 finally{fs.writeFileSync(path.join(out,`${native?'electron':'edge'}-qa.json`),JSON.stringify(report,null,2));if(browser)await browser.close();if(electron){try{await electron.evaluate(({app})=>app.exit(0));}catch{}await electron.close();}if(server){await require('../src/analysis-worker').close();await new Promise(r=>server.close(r));}}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
