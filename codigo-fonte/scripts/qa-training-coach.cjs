'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium,_electron}=require('playwright');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-coach-')),version=require('../package.json').version;
 Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm-config.json')});
 const native=process.argv.includes('--electron'),live=process.argv.includes('--live');
 if(live)fs.writeFileSync(process.env.THEIBS_LLM_CONFIG_PATH,JSON.stringify({schemaVersion:1,provider:'ollama',model:'llama3.2:1b',baseUrl:'http://127.0.0.1:11434',timeoutMs:45000}));
 const out=path.resolve(__dirname,'../../validacao/training-coach-v'+version);fs.mkdirSync(out,{recursive:true});
 const report={version,mode:native?'PACKAGED_ELECTRON':'EDGE_HTTP',llama:live?'LIVE':'NOT_EXECUTED',checks:[],layouts:[],errors:[]};let server,browser,app,page;
 const ask=async question=>{await page.locator('#training-question').fill(question);const response=page.waitForResponse(r=>r.url().endsWith('/api/training/doubt'),{timeout:65000});await page.locator('#training-ask').click();const data=await(await response).json();await page.waitForFunction(()=>!theibsApp.getState().trainingBusy,null,{timeout:65000});assert.equal(data.status,'OK',data.reason);return data;};
 try{
  if(native){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;app=await _electron.launch({executablePath:process.env.THEIBS_EXECUTABLE||path.resolve(__dirname,'../../THEIBS/THEIBS.exe'),args:['--user-data-dir='+path.join(temp,'profile')],env});page=await app.firstWindow();}
  else{({server}=require('../server'));await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true,channel:'msedge'});page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);}
  page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.accept());await page.waitForFunction(()=>Boolean(window.theibsApp));await page.evaluate(()=>theibsApp.ready);
  if(app)await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>{window.webContents.setBackgroundThrottling(false);window.setIgnoreMouseEvents(true);window.setFocusable(false);}));
  await page.locator('#variant-select').selectOption('6');await page.locator('[data-view="train"]').click();await page.locator('#training-start').click();await page.waitForFunction(()=>theibsApp.getState().trainingSession&&!theibsApp.getState().trainingBusy);
  const s=await page.evaluate(()=>theibsApp.getState().trainingSession);assert.ok(s.legalActions.includes('RAISE'));assert.ok(Number.isInteger(s.revision));assert.ok(s.sizeCandidates.length>=2);
  const size=Math.round((s.minSize+(s.maxSize-s.minSize)*.625)*100)/100;
  await page.locator('#training-size').fill(String(size));const reply=await ask('Como jogar esta mão?');
  assert.equal(reply.context.comparisonComplete,true);assert.equal(reply.context.ev.RAISE.status,'MODELED');assert.ok(reply.context.trainingEvaluation.candidates.some(c=>c.action==='RAISE'&&c.size===size));
  assert.equal(reply.context.villainCards,undefined);assert.equal(reply.context.boardAll,undefined);assert.ok(reply.answer.summary.points.length<=3);
  assert.ok(reply.answer.answer.trim().split(/\s+/).length<=85,'Summary too verbose');assert.doesNotMatch(reply.answer.answer,/Faltam RAISE|MONTE_CARLO|incerteza do range/i);
  assert.match(reply.answer.answer,/EV/,'A general decision question must explain its comparison');
  assert.match(reply.answer.answer,/Aumentar/,'The summary must show the evaluated aggression');
  assert.equal(await page.locator('#training-coach>.coach-summary>.coach-calculation').getAttribute('open'),null);
  report.firstAnswer={summary:reply.answer.summary,provider:reply.answer.provider,comparisonComplete:reply.context.comparisonComplete,candidates:reply.context.trainingEvaluation.candidates};
  if(live)assert.equal(reply.answer.provider,'ollama');
  report.checks.push('Raise and custom sizing are evaluated; short structured answer does not dump technical limitations; hidden session cards are absent');
  for(const [width,height]of [[1440,900],[1366,768],[1024,660]]){
   await page.setViewportSize({width,height});const metrics=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,panels:[...document.querySelectorAll('#train-workspace .context-rail>.panel,#training-actions')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {right:r.right,bottom:r.bottom};})}));assert.ok(metrics.panels.length>=2,'Training must remain visible during layout QA');assert.ok(metrics.scrollWidth<=width&&metrics.scrollHeight<=height);assert.ok(metrics.panels.every(r=>r.right<=width+1&&r.bottom<=height+1));report.layouts.push(metrics);await page.screenshot({path:path.join(out,`${native?'electron':'edge'}-coach-${width}.png`)});
  }
  await page.setViewportSize({width:1366,height:768});assert.equal(await page.locator('#training-coach').evaluate(el=>el.scrollHeight<=el.clientHeight+1),true,'The short explanation must fit without internal scrolling at 1366×768');
  await page.locator('#training-coach>.coach-summary>.coach-calculation>summary').click();assert.match(await page.locator('#training-coach table').innerText(),new RegExp('Aumentar para '+size.toFixed(2).replace('.','\\.')));await page.locator('#training-coach>.coach-summary>.coach-calculation>summary').click();
  const response=page.waitForResponse(r=>r.url().endsWith('/api/training/act'));await page.locator('[data-action="RAISE"]').click();const action=await(await response).json();assert.equal(action.status,'OK',action.reason);await page.waitForFunction(()=>!theibsApp.getState().trainingBusy);
  assert.equal(action.feedback.chosenSize,size);assert.deepEqual(action.feedback.context.trainingEvaluation.candidates,reply.context.trainingEvaluation.candidates);assert.match(await page.locator('#training-feedback').innerText(),/Aumentar para/);assert.match(await page.locator('#training-review').innerText(),/Aumentar para/);
  await page.locator('#open-training-details').click();assert.equal(await page.locator('#training-details-text table').isVisible(),true);assert.doesNotMatch(await page.locator('#training-details-text').innerText(),/"equity":/);await page.locator('#training-details-dialog [data-close-dialog]').click();
  await page.setViewportSize({width:1366,height:768});await page.screenshot({path:path.join(out,`${native?'electron':'edge'}-raise-feedback.png`)});
  await page.locator('[data-view="history"]').click();await page.locator('.history-hand').first().waitFor();assert.match(await page.locator('.history-hand').first().innerText(),new RegExp('Aumentar para '+size.toFixed(2).replace('.','\\.')));await page.locator('[data-view="train"]').click();
  report.checks.push('Question and action share the same comparison; custom size survives feedback/review; calculation uses a readable table');
  report.checks.push('History displays the chosen raise and exact total in Portuguese');
  await page.locator('#open-training-settings').click();await page.locator('#training-mode').selectOption('CHALLENGE');await page.locator('#training-settings-dialog [data-close-dialog]').click();await page.locator('#training-start').click();await page.waitForFunction(()=>!theibsApp.getState().trainingBusy);
  const challenge=await page.evaluate(async()=>{const s=theibsApp.getState().trainingSession;return fetch('/api/training/doubt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s.id,revision:s.revision,question:'O que fazer?'})}).then(r=>r.json());});assert.equal(challenge.status,'LOCKED');report.checks.push('Challenge mode still withholds advice before the decision');
  await page.evaluate(()=>theibsApp.flushSave());assert.deepEqual(report.errors,[]);report.status='PASS';
 }catch(error){report.status='FAIL';report.failure=error.stack;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
 finally{fs.writeFileSync(path.join(out,`${native?'electron':'edge'}-${live?'live':'local'}-report.json`),JSON.stringify(report,null,2));if(browser)await browser.close();if(app){try{await app.evaluate(({app})=>app.exit(0));}catch{}await app.close();}if(server)await new Promise(r=>server.close(r));}
 console.log(JSON.stringify({status:report.status,checks:report.checks,firstAnswer:report.firstAnswer?.summary},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
