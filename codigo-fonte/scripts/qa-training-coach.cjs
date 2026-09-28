'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium,_electron}=require('playwright');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-coach-')),version=require('../package.json').version;
 Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm-config.json')});
 const native=process.argv.includes('--electron'),live=process.argv.includes('--live');
 if(!live)process.env.THEIBS_LLM_PROVIDER='none';
 if(live)fs.writeFileSync(process.env.THEIBS_LLM_CONFIG_PATH,JSON.stringify({schemaVersion:1,provider:'ollama',model:'llama3.2:1b',baseUrl:'http://127.0.0.1:11434',timeoutMs:45000}));
 const out=path.resolve(process.argv.find(arg=>arg.startsWith('--out='))?.slice(6)||process.env.THEIBS_QA_OUT||path.resolve(__dirname,'../../validacao/training-coach-v'+version));fs.mkdirSync(out,{recursive:true});
 const report={version,at:new Date().toISOString(),evidence:'LOCAL_EXECUTED',mode:native?'PACKAGED_ELECTRON':'EDGE_HTTP',llama:live?'LIVE_ATTEMPTED':'NOT_EXECUTED',checks:[],layouts:[],errors:[],questionTimings:[],status:'RUNNING',timingScope:{sample:'Three functional questions in one new session; first question and repeated same-state questions are separate observations, not p50/p95/p99 or an SLA',localDom:'Browser performance.now from the trusted click capture event until MutationObserver sees the matching coach summary with trainingBusy=false',paintProxy:'Second requestAnimationFrame after that DOM observation; a rendering opportunity proxy, not physical paint or INP',httpParsed:'Node performance.now from issuing Playwright click until response JSON is parsed in the harness; includes click automation and browser-to-harness overhead, uses a different clock from localDom',llm:'Optional enrichment HTTP and DOM timings are separate; no real provider is exercised without --live',cold:'FIRST_QUESTION_NEW_SESSION is the first question in a fresh browser/server session after app/training startup; it is not cold process startup. Numeric evaluation cacheHit is reported separately'}};let server,browser,app,page;
 const ask=async question=>{
  await page.locator('#training-question').fill(question);
  await page.evaluate(()=>{
   const target=document.querySelector('#training-coach');
   const timing={clickedAt:null,trustedClick:false,local:null,llm:null};
   const capture=event=>{if(event.target instanceof Element&&event.target.closest('#training-ask')){timing.clickedAt=performance.now();timing.trustedClick=event.isTrusted;}};
   const inspect=()=>{
    if(timing.clickedAt===null||theibsApp.getState().trainingBusy)return;
    const summary=target.querySelector(':scope>.coach-summary');if(!summary)return;
    const provider=document.querySelector('#coach-provider').textContent;
    const stage=provider.startsWith('Local coach')?'local':provider.startsWith('Llama')?'llm':null;
    if(!stage||timing[stage])return;
    const observation={questionClickToDomMs:performance.now()-timing.clickedAt,headline:summary.querySelector('.coach-headline')?.textContent,points:[...summary.querySelectorAll('.coach-points>li')].map(el=>el.textContent),provider,trainingBusy:false,visibility:document.visibilityState,questionClickToTwoRafProxyMs:null};
    timing[stage]=observation;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{observation.questionClickToTwoRafProxyMs=performance.now()-timing.clickedAt;}));
   };
   const observer=new MutationObserver(inspect);observer.observe(target,{childList:true,subtree:true,characterData:true});
   window.addEventListener('click',capture,true);
   window.__coachQaTiming={timing,cleanup:()=>{observer.disconnect();window.removeEventListener('click',capture,true);}};
  });
  let started,enrichmentStarted=null;
  const trackRequest=request=>{if(request.url().endsWith('/api/coach/enrich'))enrichmentStarted=performance.now();};page.on('request',trackRequest);
  const parsedResponse=async response=>{const data=await response.json();return {response,data,parsedAt:performance.now()};};
  const response=page.waitForResponse(r=>r.url().endsWith('/api/training/doubt'),{timeout:65000}).then(parsedResponse);
  const enrichment=live?page.waitForResponse(r=>r.url().endsWith('/api/coach/enrich'),{timeout:65000}).then(parsedResponse).catch(error=>error):null;
  started=performance.now();await page.locator('#training-ask').click();const localResponse=await response;assert.equal(localResponse.response.status(),200);const data=localResponse.data;
  await page.waitForFunction(()=>!theibsApp.getState().trainingBusy,null,{timeout:65000});assert.equal(data.status,'OK',data.reason);
  assert.equal(data.answer.provider,'none','First answer must use the local engine facts');
  await page.waitForFunction(()=>window.__coachQaTiming?.timing.local?.questionClickToTwoRafProxyMs!==null&&Boolean(window.__coachQaTiming?.timing.local),null,{timeout:65000});
  const observed=await page.evaluate(()=>window.__coachQaTiming.timing);
  assert.equal(observed.trustedClick,true,'Timing must start at a real browser click');
  assert.equal(observed.local.headline,data.answer.summary.headline,'Observed local DOM must match this response, not an old summary');
  assert.deepEqual(observed.local.points,data.answer.summary.points,'Observed points must match this question response');
  assert.equal(observed.local.trainingBusy,false);
  const timing={observation:report.questionTimings.length+1,phase:report.questionTimings.length?'REPEATED_QUESTION_SAME_STATE':'FIRST_QUESTION_NEW_SESSION',question,analysisId:data.context.analysisId,evaluationPerformance:data.context.evaluationPerformance||null,questionClickToLocalDomMs:observed.local.questionClickToDomMs,questionClickToLocalTwoRafProxyMs:observed.local.questionClickToTwoRafProxyMs,httpParsedResponseMs:localResponse.parsedAt-started,localDom:observed.local,llm:{status:'NOT_EXECUTED'}};report.questionTimings.push(timing);
  assert.ok(data.context.analysisId,'Coach facts must identify their numeric snapshot');
  assert.equal(await page.locator('#training-action-buttons [data-action="RAISE"]').isEnabled(),true,'Local numeric response must release the action controls');
  if(live){
   const extraResponse=await enrichment;if(extraResponse instanceof Error)throw extraResponse;const extra=extraResponse.data;
   assert.equal(extraResponse.response.status(),200);assert.equal(extra.status,'OK',extra.reason);assert.equal(extra.answer.provider,'ollama');assert.equal(extra.analysisId,data.context.analysisId);
   await page.waitForFunction(()=>window.__coachQaTiming?.timing.llm?.questionClickToTwoRafProxyMs!==null&&Boolean(window.__coachQaTiming?.timing.llm),null,{timeout:65000});
   const llm=await page.evaluate(()=>window.__coachQaTiming.timing.llm);assert.equal(llm.headline,extra.answer.summary.headline);assert.deepEqual(llm.points,extra.answer.summary.points);
   timing.llm={status:'LIVE',questionClickToLlmDomMs:llm.questionClickToDomMs,questionClickToLlmTwoRafProxyMs:llm.questionClickToTwoRafProxyMs,questionCommandToHttpParsedMs:extraResponse.parsedAt-started,enrichmentRequestToHttpParsedMs:enrichmentStarted===null?null:extraResponse.parsedAt-enrichmentStarted,dom:llm};data.answer=extra.answer;report.llama='LIVE';
  }
  page.off('request',trackRequest);await page.evaluate(()=>{window.__coachQaTiming.cleanup();delete window.__coachQaTiming;});
  return data;
 };
 try{
  if(native){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;app=await _electron.launch({executablePath:process.env.THEIBS_EXECUTABLE||path.resolve(__dirname,'../../THEIBS/THEIBS.exe'),args:['--user-data-dir='+path.join(temp,'profile')],env});page=await app.firstWindow();}
  else{({server}=require('../server'));await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true,channel:'msedge'});page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/app`);}
  page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.accept());await page.waitForFunction(()=>Boolean(window.theibsApp));await page.evaluate(()=>theibsApp.ready);
  if(app)await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>{window.webContents.setBackgroundThrottling(false);window.setIgnoreMouseEvents(true);window.setFocusable(false);}));
  await page.locator('#open-settings').click();
  assert.equal(await page.locator('#variant-select').isVisible(),true,'Variant selection must remain visible inside Settings with the sidebar collapsed');
  await page.locator('#variant-select').selectOption('6');await page.locator('#settings-dialog [data-close-dialog]').click();
  assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.count),6);
  await page.locator('[data-view="train"]').click();await page.locator('#training-start').click();await page.waitForFunction(()=>theibsApp.getState().trainingSession&&!theibsApp.getState().trainingBusy);
  const s=await page.evaluate(()=>theibsApp.getState().trainingSession);assert.ok(s.legalActions.includes('RAISE'));assert.ok(Number.isInteger(s.revision));assert.ok(s.sizeCandidates.length>=2);
  const size=Math.round((s.minSize+(s.maxSize-s.minSize)*.625)*100)/100;
  await page.locator('#training-size').fill(String(size));const reply=await ask('Como jogar esta mão?');
  assert.equal(reply.context.comparisonComplete,true);assert.equal(reply.context.ev.RAISE.status,'MODELED');assert.ok(reply.context.trainingEvaluation.candidates.some(c=>c.action==='RAISE'&&c.size===size));
  assert.equal(reply.context.villainCards,undefined);assert.equal(reply.context.boardAll,undefined);assert.ok(reply.answer.summary.points.length>=1&&reply.answer.summary.points.length<=3);
  assert.ok(reply.answer.answer.trim().split(/\s+/).length<=85,'Summary too verbose');assert.doesNotMatch(reply.answer.answer,/Faltam RAISE|MONTE_CARLO|HOEFFDING|POLICY_ROLLOUT|confidenceInterval95|incerteza do range/i);
  if(['INCONCLUSIVE','INCOMPLETE','UNSUPPORTED'].includes(reply.context.recommendationStatus)){
   // The legacy recommendation field may retain the point leader for review;
   // only supportedRecommendation can authorize advice in an inconclusive case.
   assert.equal(reply.context.supportedRecommendation,null);
   assert.match(reply.answer.summary.headline,/no (?:clear|action)|inconclusive|incomplete|not supported|insufficient/i,'An abstention must remain explicit in the main answer');
  }
  assert.match(reply.answer.answer,/EV/,'A general decision question must explain its comparison');
  assert.match(reply.answer.answer,/Raise/,'The English summary must show the evaluated aggression');
  assert.equal(await page.locator('#training-coach>.coach-summary>.coach-calculation').getAttribute('open'),null);
  report.firstAnswer={summary:reply.answer.summary,provider:reply.answer.provider,comparisonComplete:reply.context.comparisonComplete,candidates:reply.context.trainingEvaluation.candidates};
  if(live)assert.equal(reply.answer.provider,'ollama');
  report.checks.push('Raise and custom sizing are evaluated; short structured answer does not dump technical limitations; hidden session cards are absent');
  for(let repeat=0;repeat<2;repeat++){
   const repeated=await ask('Como jogar esta mão?');assert.equal(repeated.context.analysisId,reply.context.analysisId);assert.deepEqual(repeated.context.trainingEvaluation.candidates,reply.context.trainingEvaluation.candidates);
  }
  report.checks.push('First and repeated questions record matching local DOM, separate parsed HTTP timing and a two-frame rendering opportunity proxy; optional LLM timing is separate');
  for(const [width,height]of [[1440,900],[1366,768],[1024,660]]){
   await page.setViewportSize({width,height});const metrics=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,panels:[...document.querySelectorAll('#train-workspace .context-rail>.panel,#training-actions')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {id:e.id||e.className,left:r.left,top:r.top,right:r.right,bottom:r.bottom};})}));report.layouts.push(metrics);assert.ok(metrics.panels.length>=2,'Training must remain visible during layout QA');assert.ok(metrics.scrollWidth<=width&&metrics.scrollHeight<=height,`Page overflow at ${width}x${height}`);assert.ok(metrics.panels.every(r=>r.left>=-1&&r.top>=-1&&r.right<=width+1&&r.bottom<=height+1),`Panel clipped at ${width}x${height}`);await page.screenshot({path:path.join(out,`${native?'electron':'edge'}-coach-${width}.png`)});
  }
  await page.setViewportSize({width:1366,height:768});assert.equal(await page.locator('#training-coach').evaluate(el=>el.scrollHeight<=el.clientHeight+1),true,'The short explanation must fit without internal scrolling at 1366×768');
  await page.locator('#training-coach>.coach-summary>.coach-calculation>summary').click();assert.match(await page.locator('#training-coach table').innerText(),new RegExp('Raise to '+size.toFixed(2).replace('.','\\.')));await page.locator('#training-coach>.coach-summary>.coach-calculation>summary').click();
  const response=page.waitForResponse(r=>r.url().endsWith('/api/training/act'));await page.locator('[data-action="RAISE"]').click();const action=await(await response).json();assert.equal(action.status,'OK',action.reason);await page.waitForFunction(()=>!theibsApp.getState().trainingBusy);
  assert.equal(action.feedback.chosenSize,size);assert.deepEqual(action.feedback.context.trainingEvaluation.candidates,reply.context.trainingEvaluation.candidates);assert.match(await page.locator('#training-feedback').innerText(),/Raise to/);assert.match(await page.locator('#training-review').innerText(),/Raise to/);
  await page.locator('#open-training-details').click();assert.equal(await page.locator('#training-details-text table').isVisible(),true);assert.doesNotMatch(await page.locator('#training-details-text').innerText(),/"equity":/);await page.locator('#training-details-dialog [data-close-dialog]').click();
  await page.setViewportSize({width:1366,height:768});await page.screenshot({path:path.join(out,`${native?'electron':'edge'}-raise-feedback.png`)});
  await page.locator('[data-view="history"]').click();await page.locator('.history-hand').first().waitFor();assert.match(await page.locator('.history-hand').first().innerText(),new RegExp('Raise to '+size.toFixed(2).replace('.','\\.')));await page.locator('[data-view="train"]').click();
  report.checks.push('Question and action share the same comparison; custom size survives feedback/review; calculation uses a readable table');
  report.checks.push('History displays the chosen raise and exact total in the English interface');
  await page.locator('#open-training-settings').click();await page.locator('#training-mode').selectOption('CHALLENGE');await page.locator('#training-settings-dialog [data-close-dialog]').click();await page.locator('#training-start').click();await page.waitForFunction(()=>!theibsApp.getState().trainingBusy);
  const challenge=await page.evaluate(async()=>{const s=theibsApp.getState().trainingSession;return fetch('/api/training/doubt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s.id,revision:s.revision,question:'O que fazer?'})}).then(r=>r.json());});assert.equal(challenge.status,'LOCKED');report.checks.push('Challenge mode still withholds advice before the decision');
  await page.evaluate(()=>theibsApp.flushSave());assert.deepEqual(report.errors,[]);report.status='PASS';
 }catch(error){report.status='FAIL';report.failure=error.stack;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
 finally{fs.writeFileSync(path.join(out,`${native?'electron':'edge'}-${live?'live':'local'}-report.json`),JSON.stringify(report,null,2));if(browser)await browser.close();if(app){try{await app.evaluate(({app})=>app.exit(0));}catch{}await app.close();}if(server){await require('../src/analysis-worker').close();await new Promise(r=>server.close(r));}}
 console.log(JSON.stringify({status:report.status,checks:report.checks,firstAnswer:report.firstAnswer?.summary},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
