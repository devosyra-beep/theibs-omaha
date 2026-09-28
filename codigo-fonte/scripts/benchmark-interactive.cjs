'use strict';
// Auto-analysis through real HTTP and two animation frames. This measures a
// display opportunity, not physical paint/INP. Every seed misses the cache.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-interactive-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const arg=(key,fallback)=>process.argv.find(x=>x.startsWith(key+'='))?.slice(key.length+1)||fallback;
const repeats=Number(arg('--per-variant','120')),out=path.resolve(arg('--out','../validacao/execucao-2026-09-27/interactive'));
assert.ok(Number.isInteger(repeats)&&repeats>=10);fs.mkdirSync(out,{recursive:true});assert.equal(fs.readdirSync(out).length,0,'Preserve prior evidence; use an empty output directory.');
const {server}=require('../server'),pool=require('../src/analysis-worker');
const multiOpponent=process.argv.includes('--multi-opponent');
const playersByVariant=multiOpponent?{4:6,5:6,6:5}:{4:2,5:2,6:2};
const boards=[['2s','3h','4d'],['Ac','6c','8d'],['Qc','Ts','7h']];
const protocol={registeredAt:new Date().toISOString(),variants:[4,5,6],repeats,boards,playersByVariant,seedBase:371228,sampling:'ADAPTIVE_DEFAULT_BUDGET',rake:'EXPLICIT_ZERO',autoAnalysis:true,
  targets:{previewP95Ms:500,finalP95Ms:3000,finalResolution:'PRECISION_OR_CALL_EV_SIGN'},cache:'UNIQUE_SEEDS',
  files:Object.fromEntries(['public/app.js','public/card-keyboard.js','public/card-voice-ui.js','public/economic-panel.css','src/equity-engine.js','src/analysis-contract.js','server.js','package.json'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex')]))};
fs.writeFileSync(path.join(out,'protocol.json'),JSON.stringify(protocol,null,2));
const report={evidence:'LOCAL_EXECUTED',build:require('../package.json').version,protocol,environment:{node:process.version,os:os.release(),cpu:os.cpus()[0].model,logicalCPUs:os.cpus().length,memoryBytes:os.totalmem(),headed:process.argv.includes('--headed')},rows:[],pageErrors:[],status:'RUNNING',
  scope:'AUTO_INPUT_EVENT_THROUGH_DEBOUNCE_PREVIEW_HTTP_FINAL_HTTP_AND_SECOND_RAF',
  limitations:['Three predefined flop fixtures per variant and declared player counts; no real opponent calibration.','p99 is descriptive, with too few observations for a p99 gate.','Within-run quantiles do not establish multi-machine/day or physical display latency.','Call-sign separation does not imply a complete supported strategy recommendation.','First observation per variant retained separately; subsequent observations have warmed workers, all cache misses.']};
const quantile=(v,p)=>[...v].sort((a,b)=>a-b)[Math.max(0,Math.ceil(v.length*p)-1)];
const stats=v=>({count:v.length,p50:quantile(v,.5),p95:quantile(v,.95),p99:quantile(v,.99),max:Math.max(...v)});
let browser,page;
(async()=>{try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:!report.environment.headed,channel:'msedge'});report.environment.browser=browser.version();
  page=await browser.newPage({viewport:{width:1366,height:768}});page.on('pageerror',e=>report.pageErrors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/app`);await page.waitForFunction(()=>window.theibsApp);await page.evaluate(()=>theibsApp.ready);
  for(const count of protocol.variants){
    await page.evaluate(players=>{document.querySelector('#auto-analysis').checked=false;const fields={samples:'adaptive',players:String(players),position:'BTN',potBeforeAction:'12',amountToCall:'4',effectiveStack:'100',rake:'',opponentHand:'',opponentRange:'',opponentModel:'UNIFORM'};for(const[id,value]of Object.entries(fields))document.getElementById(id).value=value;document.querySelector('#assumeNoRake').checked=true;},playersByVariant[count]);
    for(let index=0;index<repeats;index++){
      const seed=protocol.seedBase+count*10000+index;
      await page.evaluate(({count,seed,board})=>{
        window.theibsMetrics.analyses.length=0;document.querySelector('#seed').value=String(seed);document.querySelector('#auto-analysis').checked=true;
        theibsCardKeyboard.restore({count,slots:[...['As','Ks','Qh','Jh','Td','9d'].slice(0,count),...board].map(TheibsCards.fromCanonical).concat([null,null]),selected:0});
      },{count,seed,board:boards[index%boards.length]});
      await page.waitForFunction(()=>!theibsApp.getState().analysisBusy&&theibsMetrics.analyses.some(x=>x.phase==='FINAL'),null,{timeout:30000});
      const result=await page.evaluate(()=>({data:theibsApp.getState().lastAnalysis?.data,metrics:theibsMetrics.analyses}));
      assert.equal(result.data.status,'OK',JSON.stringify(result.data));assert.equal(result.data.performance.cacheHit,false);
      const preview=result.metrics.find(x=>x.phase==='PREVIEW'),final=result.metrics.find(x=>x.phase==='FINAL');assert.ok(preview&&final);
      const e=result.data.equity,row={variant:`PLO${count}`,index,fixture:index%boards.length,seed,firstInVariant:index===0,preview,final,samples:e.samples,stopReason:e.stopReason,interval:e.confidenceInterval95,halfWidth:e.confidenceInterval95?(e.confidenceInterval95[1]-e.confidenceInterval95[0])/2:null,recommendationStatus:result.data.recommendation.status,workerMs:result.data.performance.workerExecutionMs,cacheHit:false};
      report.rows.push(row);fs.appendFileSync(path.join(out,'observations.jsonl'),JSON.stringify(row)+'\n');
      if((index+1)%30===0)console.log(`PLO${count}: ${index+1}/${repeats}`);
    }
  }
  assert.deepEqual(report.pageErrors,[]);
  report.groups=protocol.variants.map(count=>{const rows=report.rows.filter(x=>x.variant===`PLO${count}`),warm=rows.filter(x=>!x.firstInVariant);const preview=stats(warm.map(x=>x.preview.inputToFrameMs)),final=stats(warm.map(x=>x.final.inputToFrameMs));const resolutionFailures=rows.filter(x=>!['PRECISION','CALL_EV_SIGN'].includes(x.stopReason)).length;return {variant:`PLO${count}`,first:rows[0],preview,final,resolutionFailures,latencyGate:preview.p95<=500&&final.p95<=3000?'PASS':'FAIL',precisionAndLatencyGate:preview.p95<=500&&final.p95<=3000&&resolutionFailures===0?'PASS':'FAIL',abstentions:rows.filter(x=>x.recommendationStatus!=='CONDITIONAL').length};});
  report.status=report.groups.every(x=>x.precisionAndLatencyGate==='PASS')?'PASS_SCOPED_TARGETS':'FAIL_SCOPED_TARGETS';
}catch(error){report.status='FAIL_EXECUTION';report.failure=error.stack;process.exitCode=1;}
finally{if(browser)await browser.close();await pool.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,groups:report.groups?.map(({first,...rest})=>rest),failure:report.failure}));if(report.status.startsWith('FAIL'))process.exitCode=1;}})();
