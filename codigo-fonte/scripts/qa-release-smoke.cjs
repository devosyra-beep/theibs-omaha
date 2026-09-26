'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {_electron}=require('playwright');
(async()=>{
 const manifest=require('../release-manifest.json'),root=path.resolve(manifest.verificationDirectory,'THEIBS'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-release-'));
 const env={...process.env,THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm-config.json')};delete env.ELECTRON_RUN_AS_NODE;
 const errors=[],report={version:manifest.version,executable:path.join(root,'THEIBS.exe'),checks:[]};let app;
 try{
  for(const entry of manifest.entryHashes){const hash=crypto.createHash('sha256').update(fs.readFileSync(path.resolve(manifest.verificationDirectory,entry.path))).digest('hex');assert.equal(hash,entry.sha256);}
  app=await _electron.launch({executablePath:report.executable,args:['--user-data-dir='+path.join(temp,'profile')],env});const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>Boolean(window.theibsApp));await page.evaluate(()=>theibsApp.ready);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>{window.webContents.setBackgroundThrottling(false);window.setIgnoreMouseEvents(true);window.setFocusable(false);}));
  const result=await page.evaluate(async()=>{
   const status=await fetch('/api/status').then(r=>r.json());
   const analysis=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({variant:'PLO6_HIGH',heroCards:['As','Ks','Qh','Jh','Td','9d'],board:[],players:5,position:'BTN',potBeforeAction:12,amountToCall:4,effectiveStack:100,samples:500,seed:1234,unknownOpponentModel:'UNIFORM',assumeNoRake:true,futureStreetModel:{type:'SHOWDOWN_ONLY'}})}).then(r=>r.json());
   const post=(url,body)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
   const training=await post('/api/training/start',{variant:'PLO6_HIGH',mode:'GUIDED',opponentStyle:'MIXED',targetStreet:'PREFLOP',seed:42,startingStack:100});
   const doubt=await post('/api/training/doubt',{sessionId:training.session.id,revision:training.session.revision,question:'Como jogar esta mão?',size:4.25});
   const action=await post('/api/training/act',{sessionId:training.session.id,revision:training.session.revision,action:'RAISE',size:4.25});
   const start=await post('/api/multiway/start',{config:{variant:'PLO6_HIGH',playerCount:5,heroPosition:'HJ',startingStack:100,smallBlind:.5,bigBlind:1,heroCards:['As','Ks','Qh','Jh','Td','9d']}});
   const call=await post('/api/multiway/step',{multiway:start.multiway,event:{type:'ACT',actor:2,action:'CALL'}});
   const fold=await post('/api/multiway/step',{multiway:call.multiway,event:{type:'MARK_FOLD',actor:4}});
   const blocked=await post('/api/analyze',{multiway:fold.multiway,unknownOpponentModel:'UNIFORM',samples:500,assumeNoRake:true});
   return {status,analysis,doubt,action,fold,blocked};
  });assert.equal(result.status.version,manifest.version);assert.equal(result.analysis.status,'OK');assert.equal(result.analysis.engineBuild,manifest.version);assert.equal(result.analysis.equity.opponents,4);assert.equal(result.analysis.equity.samples,500);assert.deepEqual(errors,[]);
  assert.equal(result.doubt.status,'OK');assert.equal(result.doubt.context.comparisonComplete,true);assert.match(result.doubt.answer.answer,/Aumentar/);assert.equal(result.action.status,'OK');assert.equal(result.action.feedback.chosenSize,4.25);assert.equal(result.action.feedback.context.trainingEvaluation.evaluationId,result.doubt.context.trainingEvaluation.evaluationId);
  assert.equal(result.fold.status,'OK');assert.equal(result.fold.state.actor,3);assert.equal(result.fold.state.pot,2.5);assert.equal(result.fold.state.activeOpponentCount,3);assert.equal(result.fold.state.players[4].folded,true);assert.equal(result.blocked.status,'NO_DECISION');
  report.checks=['All extracted files match the distributed ZIP manifest','Extracted executable starts with isolated user data','Local API exposes the new version and calculates PLO6 against four opponents','Extracted training runtime evaluates custom raise 4.25 and uses the same comparison for the action','No JavaScript errors'];report.status='PASS';
  report.checks.push('Extracted Multiway ledger records call and observed exit, preserves pot/physical actor and blocks decisions outside hero turn');
 }catch(error){report.status='FAIL';report.failure=error.stack;throw error;}
 finally{fs.writeFileSync(path.resolve(__dirname,'../../validacao/release-smoke-v'+manifest.version+'.json'),JSON.stringify(report,null,2));if(app){try{await app.evaluate(({app})=>app.exit(0));}catch{}await app.close();}}
 console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
