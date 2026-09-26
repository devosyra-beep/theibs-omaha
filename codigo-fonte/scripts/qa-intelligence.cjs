'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium,_electron}=require('playwright');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-intelligence-'));process.env.THEIBS_DATA_PATH=path.join(temp,'events.jsonl');process.env.THEIBS_WORKSPACE_PATH=path.join(temp,'workspace.json');
 const out=path.resolve(__dirname,'../../validacao/intelligence-v'+require('../package.json').version);fs.mkdirSync(out,{recursive:true});const native=process.argv.includes('--electron'),report={mode:native?'Windows packaged Electron':'Edge HTTP',checks:[],errors:[],layouts:[]};let server,browser,electron,page;
 try{
  if(native){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;electron=await _electron.launch({executablePath:process.env.THEIBS_EXECUTABLE||path.resolve(__dirname,'../../THEIBS/THEIBS.exe'),args:['--user-data-dir='+path.join(temp,'profile')],env,timeout:20000});page=await electron.firstWindow();}
  else{({server}=require('../server'));await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true,channel:'msedge'});page=await browser.newPage({viewport:{width:1366,height:768}});await page.goto(`http://127.0.0.1:${server.address().port}`);}
  page.setDefaultTimeout(30000);page.on('dialog',d=>d.accept());page.on('pageerror',e=>report.errors.push(e.message));await page.waitForFunction(()=>Boolean(window.theibsApp));await page.evaluate(()=>theibsApp.ready);
  assert.equal(await page.locator('#flow-controls,#flow-start').count(),0);assert.equal(await page.evaluate(()=>Boolean(window.TheibsFlow)),false);
  assert.match(await page.locator('#opponent-total').innerText(),/5 adversários = 6 jogadores/);
  await page.locator('#opponent-count').selectOption('2');assert.equal(await page.locator('#players').inputValue(),'3');
  for(const count of [4,6]){
   await page.locator('#variant-select').selectOption(String(count));
   await page.locator('#opponent-count').selectOption('2');
   await page.locator('.variant-help>summary').click();
   assert.match(await page.locator('#variant-warning').innerText(),new RegExp(`PLO${count} ativo`));
   await page.locator('.variant-help>summary').click();
   await page.locator('[data-slot="0"]').click();await page.keyboard.type(count===4?'aeke2p3p':'aeke2p3p4o5o');
   await page.waitForFunction(()=>theibsApp.getState().lastAnalysis?.data.status==='OK');
   assert.equal(await page.evaluate(()=>theibsApp.getState().lastAnalysis.data.equity.opponents),2);
   await page.locator('#clear').click();
  }
  report.checks.push('Visible opponent count drives PLO4 and PLO6 calculations');
  await page.locator('#variant-select').selectOption('5');
  await page.locator('[data-slot="0"]').click();await page.keyboard.type('aeke2p3p4oqejet e8c9o'.replace(/ /g,''));
  await page.waitForFunction(()=>theibsApp.getState().lastAnalysis?.data.status==='OK');assert.equal(await page.evaluate(()=>theibsApp.getState().lastAnalysis.data.handInsights.made.category),'STRAIGHT_FLUSH');
  const before=await page.evaluate(()=>theibsCardKeyboard.state.snapshot());await page.keyboard.press('f');assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.snapshot()),before);report.checks.push('Analysis works without action recording and F has no Fold side effect');
  // Simulate a pre-update saved draft: keep its ledger as archival data, not active UI.
  await page.evaluate(()=>theibsApp.flushSave());await page.waitForFunction(()=>!theibsApp.getState().saveBusy&&!theibsApp.getState().saveDirty);
  await page.evaluate(async()=>{const x=await fetch('/api/workspace').then(r=>r.json());x.workspace.handFlow={config:{variant:'PLO5_HIGH',playerCount:2,heroPosition:'BTN',startingStack:100,smallBlind:1,bigBlind:2},events:[]};await fetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace:x.workspace,expectedRevision:x.revision})});});
  await page.reload();await page.waitForFunction(()=>Boolean(window.theibsApp));await page.evaluate(()=>theibsApp.ready);assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.snapshot().slots),before.slots);assert.equal(await page.locator('#flow-controls').count(),0);
  await page.locator('#open-settings').click();assert.equal(await page.locator('#potBeforeAction').isEnabled(),true);await page.locator('#settings-dialog [data-close-dialog]').click();report.checks.push('Legacy tracked draft preserves cards and no longer blocks analysis');
  for(const view of ['analyze','train']){
   await page.locator(`.nav-tab[data-view="${view}"]`).click();
   for(const [width,height] of [[1440,900],[1366,768],[1024,660]]){
    await page.setViewportSize({width,height});const size=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight}));assert.ok(size.scrollWidth<=width&&size.scrollHeight<=height);report.layouts.push({view,...size});
   }
  }report.checks.push('Analysis and training keep a fixed desktop page');
  await page.locator('#open-training-settings').click();await page.locator('#training-street').selectOption('FLOP');await page.locator('#training-settings-dialog [data-close-dialog]').click();await page.locator('#training-start').click();await page.waitForFunction(()=>Boolean(theibsApp.getState().trainingSession)&&!theibsApp.getState().trainingBusy);
  let answers=[];for(const question of ['Quais outs e draws eu tenho?','Quais blockers eu tenho?','Por que pagar?']){
   await page.locator('#training-question').fill(question);const reply=page.waitForResponse(r=>r.url().endsWith('/api/training/doubt'));await page.locator('#training-ask').click();const body=await(await reply).json();assert.equal(body.status,'OK');assert.ok(body.context.handInsights);assert.equal(body.context.villainCards,undefined);assert.equal(body.context.opponentHands,undefined);answers.push(body.answer.answer);await page.waitForFunction(()=>!theibsApp.getState().trainingBusy);
  }
  assert.match(answers[0],/próxima carta/);assert.match(answers[1],/bloqueador|retira esse ás/);assert.match(answers[2],/EV CHECK/);report.checks.push('Coach answers draws, blockers and EV with calculated facts');
  for(let i=0;i<40&&!await page.evaluate(()=>theibsApp.getState().trainingSession.finished);i++){
   const session=await page.evaluate(()=>theibsApp.getState().trainingSession),aggressive=session.legalActions.find(a=>a==='BET'||a==='RAISE');const action=i===0&&aggressive?aggressive:session.legalActions.includes('CALL')?'CALL':'CHECK';
   if(action===aggressive)await page.locator('#training-size').fill(String(session.minSize));
   await page.locator(`[data-action="${action}"]`).click();await page.waitForFunction(()=>!theibsApp.getState().trainingBusy);
  }
  assert.equal(await page.evaluate(()=>theibsApp.getState().trainingSession.finished),true);assert.ok(await page.locator('#training-feedback').isVisible());report.checks.push('Automatic opponent completes the hand and produces decision feedback');
  await page.setViewportSize({width:1366,height:768});await page.screenshot({path:path.join(out,`${native?'electron':'edge'}-training.png`)});
  await page.locator('#training-clear').click();assert.equal(await page.evaluate(()=>theibsApp.getState().trainingSession),null);await page.locator('.nav-tab[data-view="analyze"]').click();await page.screenshot({path:path.join(out,`${native?'electron':'edge'}-analysis.png`)});await page.locator('#clear').click();assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.slots.some(Boolean)),false);
  report.checks.push('Both clear buttons remain usable');assert.deepEqual(report.errors,[]);report.checks.push('No JavaScript errors');await page.evaluate(()=>theibsApp.flushSave());
 }catch(error){report.failure=error.stack;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
 finally{fs.writeFileSync(path.join(out,`${native?'electron':'edge'}-report.json`),JSON.stringify(report,null,2));if(browser)await browser.close();if(electron){try{await electron.evaluate(({app})=>app.exit(0));}catch{}await electron.close();}if(server)await new Promise(r=>server.close(r));}
 console.log(report.checks.map(c=>'PASS '+c).join('\n'));
})().catch(e=>{console.error(e);process.exitCode=1;});
