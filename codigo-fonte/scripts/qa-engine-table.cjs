'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron}=require('playwright');
(async()=>{
 const version=require('../package.json').version,temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-engine-table-'));
 const out=path.resolve(__dirname,'../../validacao/engine-table-v'+version);fs.mkdirSync(out,{recursive:true});
 const env={...process.env,THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json')};delete env.ELECTRON_RUN_AS_NODE;
 fs.writeFileSync(env.THEIBS_WORKSPACE_PATH,JSON.stringify({revision:1,workspace:{schemaVersion:1,keyboard:{count:6,selected:0,slots:['AE','KE','QC','JC','DO','9O',null,null,null,null,null]},fields:{players:'5',potBeforeAction:'12',amountToCall:'4',effectiveStack:'100',samples:'50000',seed:'42','auto-analysis':false},ui:{deck:'cores',felt:'preto',view:'analyze',cardDisplayVersion:2},snapshots:[]}}));
 const report={version,environment:'PACKAGED_ELECTRON_HTTP',unit:'complete Monte Carlo simulations per second',samplesPerRequest:50000,checks:[],layouts:[],benchmark:[],errors:[],limitations:['Three repetitions per format; no sustained-rate SLA','Uniform preflop; explicit ranges and aggression branches can take longer','Timings include HTTP round trip and JSON to the renderer, not screen paint']};
 let app,page;
 const analyze=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/analyze'));await page.locator('#quick-analyze').click();const data=await(await response).json();assert.equal(data.status,'OK');await page.waitForFunction(()=>!theibsApp.getState().analysisBusy);return data;};
 try {
  app=await _electron.launch({executablePath:process.env.THEIBS_EXECUTABLE||path.resolve(__dirname,'../../THEIBS/THEIBS.exe'),args:['--user-data-dir='+path.join(temp,'profile')],env});page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.accept());await page.waitForFunction(()=>Boolean(window.theibsApp));await page.evaluate(()=>theibsApp.ready);
  report.engineStatus=await page.evaluate(async()=>fetch('/api/status').then(r=>r.json()));assert.equal(report.engineStatus.version,version);assert.equal(report.engineStatus.learning.automaticTraining,false);assert.equal(report.engineStatus.calculation.llmAccelerated,false);assert.equal(report.engineStatus.llmAvailability,'NOT_PROBED');
  await page.locator('#open-engine').click();assert.match(await page.locator('#engine-details').innerText(),/Não há treinamento automático/);await page.locator('#engine-dialog [data-close-dialog]').click();
  report.checks.push('Versioned status declares history retrieval, no automatic training, no LLM acceleration or unverified availability');
  // Benchmark before screenshots and interaction checks, with no other test suite running.
  report.benchmark=await page.evaluate(async()=>{
   const rows=[];
   for(let rep=0;rep<3;rep++)for(const [n,opponents]of [[5,5],[6,4]]){
    const input={variant:`PLO${n}_HIGH`,heroCards:['As','Ks','Qh','Jh','Td','9d'].slice(0,n),board:[],players:opponents+1,position:'BTN',potBeforeAction:12,amountToCall:4,effectiveStack:100,samples:50000,seed:91381+rep*131,unknownOpponentModel:'UNIFORM',assumeNoRake:true,futureStreetModel:{type:'SHOWDOWN_ONLY'}};
    const t=performance.now(),data=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}).then(r=>r.json()),elapsedMs=performance.now()-t;
    if(data.status!=='OK')throw Error(JSON.stringify(data));
    rows.push({variant:input.variant,opponents,repetition:rep+1,samples:data.equity.samples,elapsedMs,simulationsPerSecond:data.equity.samples*1000/elapsedMs,equity:data.equity.equity,performance:data.performance});
   }return rows;
  });
  report.performanceSummary=[5,6].map(n=>{const rows=report.benchmark.filter(r=>r.variant===`PLO${n}_HIGH`),rates=rows.map(r=>r.simulationsPerSecond).sort((a,b)=>a-b);return {variant:`PLO${n}`,opponents:rows[0].opponents,medianPerSecond:rates[1],minimumPerSecond:rates[0],allRunsMeet100k:rates.every(r=>r>=100000)};});
  assert.ok(report.benchmark.every(r=>r.samples===50000&&r.performance.monteCarloSamples===50000));assert.ok(report.benchmark.slice(1).every(r=>r.performance.workerReused));
  report.checks.push('Native application benchmark measures 50k completed simulations, correct opponents, HTTP latency and persistent worker reuse');
  for(const n of [6,5,4]){
   await page.locator('#variant-select').selectOption(String(n));
   const opponents=n===6?4:5;
   assert.equal(await page.locator('#analysis-seats .opponent-place').count(),opponents);assert.equal(await page.locator('#analysis-seats .card-back').count(),n*opponents);assert.equal(await page.locator('#players').inputValue(),String(opponents+1));
   for(const [width,height]of [[1440,900],[1366,768],[1024,660]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(160);
    const geometry=await page.evaluate(()=>{
     const box=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};},overlap=(a,b)=>a.x<b.right&&a.right>b.x&&a.y<b.bottom&&a.bottom>b.y;
     const seats=[...document.querySelectorAll('.opponent-place')].map(box),cards=[...document.querySelectorAll('#hero-slots .playing-card,#board-slots .playing-card')].map(box),pot=box(document.querySelector('#table-pot'));
     return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,seats,overlaps:seats.some((s,i)=>cards.some(c=>overlap(s,c))||overlap(s,pot)||seats.slice(i+1).some(t=>overlap(s,t)))};
    });report.layouts.push({variant:n,...geometry});assert.equal(geometry.overlaps,false,`seat overlap PLO${n} ${width}`);assert.ok(geometry.scrollHeight<=height&&geometry.scrollWidth<=width);await page.screenshot({path:path.join(out,`plo${n}-${width}.png`)});
   }
  }
  report.checks.push('PLO4/5/6 have accurate visible seats and card backs with no overlap at three desktop sizes');
  await page.locator('#variant-select').selectOption('6');await page.locator('#opponent-count').selectOption('1');assert.equal(await page.locator('#analysis-seats .opponent-place').count(),1);assert.equal(await page.locator('#players').inputValue(),'2');await page.locator('#opponent-count').selectOption('4');
  await page.locator('#clear').click();await page.locator('[data-slot="0"]').click();await page.keyboard.type('aekeqcjcdo9o');await analyze();
  await page.locator('#open-engine').click();assert.match(await page.locator('#engine-details').innerText(),/50\.000/);assert.match(await page.locator('#engine-details').innerText(),/PLO6_HIGH · 4/);assert.match(await page.locator('#engine-details').innerText(),/Simulações completas/);await page.screenshot({path:path.join(out,'motor-e-ia.png')});await page.locator('#engine-dialog [data-close-dialog]').click();
  report.checks.push('Motor e IA panel displays actual analyzed format, 50k simulations, UI timing and worker reuse');
  await page.locator('#open-settings').click();await page.locator('#opponentModel').selectOption('EXPLICIT');await page.locator('#opponentHand').fill('2E 3E 4C 5C 6O 7O');await page.locator('#settings-dialog [data-close-dialog]').click();const partial=await analyze();assert.equal(partial.equity.opponents,1);assert.equal(await page.locator('#analysis-seats .opponent-place').count(),4);assert.match(await page.locator('#ev-assumption').innerText(),/calculado contra 1 dos 4 adversários/);
  report.checks.push('An explicit range for one opponent cannot silently masquerade as equity against the four displayed players');
  await page.evaluate(()=>theibsApp.flushSave());assert.deepEqual(report.errors,[]);report.status='PASS';
 }catch(error){report.status='FAIL';report.failure=error.stack;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
 finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));if(app){try{await app.evaluate(({app})=>app.exit(0));}catch{}await app.close();}}
 console.log(JSON.stringify({status:report.status,checks:report.checks,performance:report.performanceSummary},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
