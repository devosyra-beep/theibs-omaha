'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium,_electron}=require('playwright');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-training-layout-'));
 process.env.THEIBS_DATA_PATH=path.join(dir,'events.jsonl');process.env.THEIBS_WORKSPACE_PATH=path.join(dir,'workspace.json');process.env.THEIBS_LLM_CONFIG_PATH=path.join(dir,'llm-config.json');
 const version=require('../package.json').version,out=path.resolve(__dirname,'../../validacao/training-layout-v'+version);fs.mkdirSync(out,{recursive:true});
 const native=process.argv.includes('--electron'),report={version,mode:native?'Windows packaged Electron':'Edge HTTP',checks:[],layouts:[],errors:[]};
 let server,browser,electron,page;
 try {
  if(native){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;electron=await _electron.launch({executablePath:process.env.THEIBS_EXECUTABLE||path.resolve(__dirname,'../../THEIBS/THEIBS.exe'),args:['--user-data-dir='+path.join(dir,'profile')],env});page=await electron.firstWindow();}
  else {({server}=require('../server'));await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true,channel:'msedge'});page=await browser.newPage({viewport:{width:1366,height:768}});await page.goto(`http://127.0.0.1:${server.address().port}`);}
  page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.waitForFunction(()=>Boolean(window.theibsApp));await page.evaluate(()=>theibsApp.ready);
  await page.evaluate(()=>window.theibsFocusUI?.restore(false));report.sidebar='expanded';
  if(electron)await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>{window.webContents.setBackgroundThrottling(false);window.setIgnoreMouseEvents(true);window.setFocusable(false);}));
  await page.locator('[data-slot="0"]').click();await page.keyboard.type('aekcqojpte');
  await page.locator('#clear').click();assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.slots.some(Boolean)),false);report.checks.push('Visible Limpar cartas clears analysis cards');
  await page.locator('[data-view="train"]').click();
  const inspect=async(stage)=>{
   for(const [width,height] of [[1702,980],[1440,900],[1366,768],[1024,660]]){
    await page.setViewportSize({width,height});
    const m=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,panels:[...document.querySelectorAll('.training-toolbar,#training-table,#training-actions,#training-feedback,#train-workspace .context-rail>.panel')].filter(el=>el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect();return {id:el.id||el.className,x:r.x,y:r.y,right:r.right,bottom:r.bottom};})}));
    report.layouts.push({stage,...m});assert.ok(m.scrollWidth<=width&&m.scrollHeight<=height,`page overflow ${stage} ${width}x${height}`);assert.ok(m.panels.every(r=>r.x>=0&&r.y>=0&&r.right<=width+.5&&r.bottom<=height+.5),`panel overflow ${stage} ${width}x${height}`);
    const separated=await page.evaluate(()=>{const board=document.querySelector('#training-table .board-cards'),hero=document.querySelector('#training-table .hero-cards');return !board||board.getBoundingClientRect().bottom+2<=hero.getBoundingClientRect().top;});assert.ok(separated,`cards overlap ${stage} ${width}x${height}`);
    await page.screenshot({path:path.join(out,`${native?'electron':'edge'}-${stage}-${width}.png`)});
   }
  };
  await inspect('empty');
  await page.locator('#open-training-settings').click();await page.locator('#training-street').selectOption('FLOP');await page.locator('#training-settings-dialog [data-close-dialog]').click();
  await page.locator('#training-start').click();await page.waitForFunction(()=>Boolean(theibsApp.getState().trainingSession)&&!theibsApp.getState().trainingBusy);
  await inspect('active');report.checks.push('Empty and active training fit all 4 desktop sizes');
  const legal=await page.evaluate(()=>theibsApp.getState().trainingSession.legalActions);
  await page.locator(`[data-action="${legal.includes('CHECK')?'CHECK':'CALL'}"]`).click();await page.waitForFunction(()=>!theibsApp.getState().trainingBusy);
  await inspect('feedback');await page.locator('#open-training-details').click();assert.ok(await page.locator('#training-details-dialog').isVisible());await page.locator('#training-details-dialog [data-close-dialog]').click();report.checks.push('Decision feedback and calculation dialog work without page overflow');
  for(let i=0;i<12&&!await page.evaluate(()=>theibsApp.getState().trainingSession.finished);i++){
   const legal=await page.evaluate(()=>theibsApp.getState().trainingSession.legalActions);
   await page.locator(`[data-action="${legal.includes('CHECK')?'CHECK':legal.includes('CALL')?'CALL':'FOLD'}"]`).click();await page.waitForFunction(()=>!theibsApp.getState().trainingBusy);
  }
  assert.equal(await page.evaluate(()=>theibsApp.getState().trainingSession.finished),true);await inspect('finished');report.checks.push('Showdown and result fit the desktop layout');
  const historyBefore=await page.evaluate(()=>fetch('/api/training/history').then(r=>r.json()));
  await page.locator('#training-clear').click();assert.equal(await page.evaluate(()=>theibsApp.getState().trainingSession),null);assert.equal(await page.locator('#training-table .playing-card:not(.vacant)').count(),0);
  const historyAfter=await page.evaluate(()=>fetch('/api/training/history').then(r=>r.json()));assert.deepEqual(historyAfter,historyBefore);
  await page.evaluate(()=>theibsApp.flushSave());await page.reload();await page.waitForFunction(()=>Boolean(window.theibsApp));await page.evaluate(()=>theibsApp.ready);assert.equal(await page.evaluate(()=>theibsApp.getState().trainingSession),null);report.checks.push('Limpar treino removes cards, preserves history, and persists after reload');
  await page.locator('#variant-select').selectOption('6');await page.locator('#training-start').click();await page.waitForFunction(()=>Boolean(theibsApp.getState().trainingSession)&&!theibsApp.getState().trainingBusy);
  assert.equal(await page.locator('#training-table .hero-cards .playing-card').count(),6);await inspect('plo6');
  await page.locator('#training-clear').click();assert.equal(await page.evaluate(()=>theibsApp.getState().trainingSession),null);report.checks.push('PLO6 fits with six cards; active training can be cleared');
  assert.deepEqual(report.errors,[]);report.checks.push('No JavaScript errors');
 }catch(e){report.failure=e.stack;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw e;}
 finally{fs.writeFileSync(path.join(out,`${native?'electron':'edge'}-report.json`),JSON.stringify(report,null,2));if(browser)await browser.close();if(electron){try{await electron.evaluate(({app})=>app.exit(0));}catch{}await electron.close();}if(server)await new Promise(r=>server.close(r));}
 console.log(report.checks.map(c=>'PASS '+c).join('\n'));
})().catch(e=>{console.error(e);process.exitCode=1;});
