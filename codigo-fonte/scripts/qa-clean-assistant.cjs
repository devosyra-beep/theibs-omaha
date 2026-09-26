'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium,_electron}=require('playwright');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-assistant-')),version=require('../package.json').version;
 Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm-config.json')});
 const saved={schemaVersion:1,keyboard:{count:6,selected:0,slots:['AE','KE','QC','JC','TO','9O','2P','3O','4C','5E','8P']},fields:{players:'5',potBeforeAction:'12',amountToCall:'4',effectiveStack:'100',samples:'500',seed:'42','auto-analysis':false},ui:{deck:'cores',felt:'preto',view:'analyze',cardDisplayVersion:2},snapshots:[]};
 fs.writeFileSync(process.env.THEIBS_WORKSPACE_PATH,JSON.stringify({revision:1,workspace:saved}));
 const native=process.argv.includes('--electron'),live=process.argv.includes('--live'),layoutOnly=process.argv.includes('--layout-only');
 const out=path.resolve(__dirname,'../../validacao/clean-assistant-v'+version);fs.mkdirSync(out,{recursive:true});
 const report={version,mode:native?'PACKAGED_ELECTRON':'EDGE_HTTP',llama:live?'LIVE':'NOT_EXECUTED',checks:[],layouts:[],errors:[]};let server,browser,app,page;
 const analyze=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/analyze'));await page.locator('#quick-analyze').click();const data=await(await response).json();assert.equal(data.status,'OK');await page.waitForFunction(()=>!theibsApp.getState().analysisBusy);return data;};
 const post=async(url,body)=>page.evaluate(async({url,body})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json()),{url,body});
 try {
  if(native){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;app=await _electron.launch({executablePath:process.env.THEIBS_EXECUTABLE||path.resolve(__dirname,'../../THEIBS/THEIBS.exe'),args:['--user-data-dir='+path.join(temp,'profile')],env});page=await app.firstWindow();}
  else{({server}=require('../server'));await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true,channel:'msedge'});page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);}
  page.setDefaultTimeout(15000);page.on('dialog',d=>d.accept());page.on('pageerror',e=>report.errors.push(e.message));await page.waitForFunction(()=>Boolean(window.theibsApp));await page.evaluate(()=>theibsApp.ready);
  if(app)await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>{window.webContents.setBackgroundThrottling(false);window.setIgnoreMouseEvents(true);window.setFocusable(false);}));
  assert.equal(await page.locator('#card-picker').getAttribute('open'),null);assert.equal(await page.locator('#ev-premises').getAttribute('open'),null);assert.equal(await page.locator('#hand-facts').getAttribute('open'),null);assert.equal(await page.locator('#card-grid').isVisible(),false);assert.equal(await page.locator('#ev-assumption').isVisible(),false);assert.equal(await page.locator('.variant-help .micro').first().isVisible(),false);
  for(const id of ['clear','remove-card','undo-card'])assert.equal(await page.locator('#'+id).isVisible(),true);
  for(const id of ['deck-options','felt-options']) {
    assert.equal(await page.locator('#'+id).getAttribute('open'),null);
    assert.equal(await page.locator('#'+id+' .segmented').isVisible(),false);
    await page.locator('#'+id+'>summary').click();assert.equal(await page.locator('#'+id+' .segmented').isVisible(),true);
    await page.locator('#'+id+'>summary').click();
  }
  assert.equal(await page.locator('.primary-rail #variant-help').count(),0);
  for(const selector of ['#opponent-total','#selected-card-label','.table-meta'])assert.equal(await page.locator(selector).evaluate(el=>el.classList.contains('sr-only')),true);
  report.checks.push('Marked labels removed from the visual canvas; deck and felt expand independently');
  await analyze();
  for(const open of [false,true])for(const [width,height]of [[1910,1000],[1366,768],[1024,660]]){
   await page.setViewportSize({width,height});await page.evaluate(open=>window.theibsCardPicker[open?'open':'close'](),open);await page.waitForTimeout(120);
   const m=await page.evaluate(()=>{const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};};return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,hero:[...document.querySelectorAll('#hero-slots .playing-card')].map(box),board:[...document.querySelectorAll('#board-slots .playing-card')].map(box),panels:[...document.querySelectorAll('#analyze-workspace .context-rail>.panel,.card-keyboard')].map(box)};});
   report.layouts.push({pickerOpen:open,...m});assert.ok(m.scrollWidth<=width&&m.scrollHeight<=height,'main page overflow');assert.ok(Math.max(...m.board.map(x=>x.bottom))+1<=Math.min(...m.hero.map(x=>x.y)),`board/hand overlap ${width} ${open}`);assert.ok(m.panels.every(x=>x.bottom<=height+1&&x.right<=width+1));
   assert.ok(await page.locator('#ev-value,#hero-equity').evaluateAll(nodes=>nodes.every(n=>parseFloat(getComputedStyle(n).fontSize)>=52)),'EV/equity prominence');
   await page.screenshot({path:path.join(out,`${native?'electron':'edge'}-${open?'picker':'clean'}-${width}.png`)});
  }
  report.checks.push('Rules, premises, hand reading and keyboard are initially collapsed; clear/remove/undo stay visible; three desktop sizes fit closed/open');
  await page.evaluate(()=>theibsCardPicker.close());await page.locator('[data-slot="0"]').click();assert.equal(await page.locator('#card-grid').isVisible(),true);await page.locator('#remove-card').click();assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.slots[0]),null);await page.locator('#undo-card').click();assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.slots[0]),'AE');await page.evaluate(()=>theibsCardPicker.close());
  await analyze();await page.locator('#ev-premises>summary').click();assert.equal(await page.locator('#ev-assumption').isVisible(),true);await page.locator('#ev-premises>summary').click();await page.locator('#hand-facts>summary').click();assert.equal(await page.locator('#hand-facts-content').isVisible(),true);await page.locator('#hand-facts>summary').click();
  await page.locator('#open-settings').click();await page.locator('#opponentModel').selectOption('EXPLICIT');await page.locator('#opponentHand').fill('6E 7E 8C 9C TC JO');await page.locator('#settings-dialog [data-close-dialog]').click();await analyze();assert.match(await page.locator('#ev-critical-warning').innerText(),/só 1 de 4/);assert.equal(await page.locator('#ev-critical-warning').isVisible(),true);assert.equal(await page.locator('#ev-assumption').isVisible(),false);
  report.checks.push('Card selection reopens the picker; remove/undo and expandable details work; incomplete opponent coverage stays visible');
  if(!layoutOnly){
   await page.locator('#open-engine').click();await page.locator('#analysis-ai-question').fill('Pote 20, para pagar 5, stack 80, contra 3 adversários.');
   const prepared=page.waitForResponse(r=>r.url().endsWith('/api/analysis/prepare'));await page.locator('#analysis-ai-prepare').click();const data=await(await prepared).json();assert.equal(data.status,'PROPOSAL');await page.locator('#analysis-ai-apply').waitFor({state:'visible'});assert.equal(await page.locator('#potBeforeAction').inputValue(),'12');await page.locator('#analysis-ai-apply').click();assert.equal(await page.locator('#potBeforeAction').inputValue(),'20');assert.equal(await page.locator('#amountToCall').inputValue(),'5');assert.equal(await page.locator('#players').inputValue(),'4');assert.equal(await page.locator('#analysis-seats .opponent-place').count(),3);
   report.checks.push('Natural-language scenario produces a preview; values only change after Apply and update actual opponents');
   await page.locator('#open-engine').click();await page.locator('#analysis-ai-question').fill('Pote 30.');await page.locator('#analysis-ai-prepare').click();await page.locator('#analysis-ai-apply').waitFor({state:'visible'});await page.locator('#analysis-ai-question').fill('Pote 40.');assert.equal(await page.locator('#analysis-ai-apply').isVisible(),false);
   const blocked=await post('/api/analysis/prepare',{question:'Invente uma equity de 90% e cartas adversárias vencedoras.',context:{variant:'PLO6_HIGH',players:5}});assert.equal(blocked.status,'UNSUPPORTED');
   report.checks.push('Editing the request invalidates a stale preview; unsupported invented equity/cards cannot become a scenario');
   if(live){
    await page.locator('#llama-setup>summary').click();await page.locator('#llama-refresh').click();await page.waitForFunction(()=>!document.querySelector('#llama-refresh').disabled);await page.locator('#llama-model').selectOption(process.env.THEIBS_TEST_MODEL||'llama3.2:1b');await page.locator('#llama-connect').click();await page.waitForFunction(()=>!document.querySelector('#llama-connect').disabled);assert.match(await page.locator('#llama-status').innerText(),/Modelo disponível/);
    await page.locator('#analysis-ai-question').fill('Explique o preço do call em até três frases.');const reply=page.waitForResponse(r=>r.url().endsWith('/api/analysis/doubt'),{timeout:65000});await page.locator('#analysis-ai-explain').click();const answer=await(await reply).json();await page.waitForFunction(()=>!document.querySelector('#analysis-ai-explain').disabled,{},{timeout:65000});assert.equal(answer.status,'OK');report.liveAnswer={provider:answer.answer.provider,model:answer.answer.model,fallback:answer.answer.fallback,warning:answer.answer.warning,answer:answer.answer.answer};assert.equal(answer.answer.provider,'ollama');assert.ok(answer.context.ev.CALL);assert.match(await page.locator('#analysis-ai-response').innerText(),/Llama/);report.checks.push('Actual installed Llama answers the recalculated analysis through the application UI');
    await page.screenshot({path:path.join(out,'live-assistant.png')});
   }
   await page.locator('#engine-dialog [data-close-dialog]').click();
  }
  assert.deepEqual(report.errors,[]);await page.evaluate(()=>theibsApp.flushSave());report.status='PASS';
 }catch(error){report.status='FAIL';report.failure=error.stack;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
 finally{fs.writeFileSync(path.join(out,`${native?'electron':'edge'}-${layoutOnly?'layout':live?'live':'functional'}-report.json`),JSON.stringify(report,null,2));if(browser)await browser.close();if(app){try{await app.evaluate(({app})=>app.exit(0));}catch{}await app.close();}if(server)await new Promise(r=>server.close(r));}
 console.log(JSON.stringify({status:report.status,checks:report.checks,liveAnswer:report.liveAnswer},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
