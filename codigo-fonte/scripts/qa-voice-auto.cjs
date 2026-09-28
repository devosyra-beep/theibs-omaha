'use strict';
// Local real HTTP + controlled browser SpeechRecognition events. This is not
// acoustic accuracy, a real microphone, a provider test or hosted validation.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const out=path.resolve(process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'../validacao/voice-auto-2026-09-28/browser-final');
if(fs.existsSync(out)&&fs.readdirSync(out).length)throw Error('Evidence destination must be new or empty; preserve prior attempts: '+out);
fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-voice-auto-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'..',file))).digest('hex');
const files=['public/card-voice.js','public/card-voice-ui.js','public/card-keyboard.js','public/app.js','scripts/qa-voice-auto.cjs'];
const report={at:new Date().toISOString(),version:require('../package.json').version,source:'CONTROLLED_ASR_EVENTS',http:'LOCAL_REAL_SERVER',acoustic:'NOT_EXECUTED',microphone:'NOT_EXECUTED',provider:'NOT_EXECUTED',hosted:'NOT_EXECUTED',status:'RUNNING',sourceHashes:Object.fromEntries(files.map(f=>[f,hash(f)])),cases:[],pageErrors:[]};
let server,pool,browser,page,origin;
async function check(name,fn){console.log('CHECK '+name);try{await fn();report.cases.push({name,status:'PASS'});}catch(error){report.cases.push({name,status:'FAIL',error:error.message});throw error;}}
async function state(){return page.evaluate(()=>theibsCardKeyboard.state.snapshot());}
async function settle(){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function listening(){return page.evaluate(()=>theibsCardVoice.getStatus().listening);}
async function stop(){if(await listening())await page.locator('#voice-toggle').click();await page.waitForFunction(()=>!theibsCardVoice.getStatus().listening);}
async function start(){if(!await listening())await page.locator('#voice-toggle').click();await page.waitForFunction(()=>theibsCardVoice.getStatus().listening&&__asr.at(-1)?.started&&!__asr.at(-1)?.aborted&&!__asr.at(-1)?.stopped);await settle();}
async function emit(segments,{index=null,resultIndex=0}={}){await page.evaluate(({parts,index,resultIndex})=>{const r=index===null?__asr.at(-1):__asr[index];r.onresult?.({resultIndex,results:parts.map(p=>Object.assign([{transcript:p.text,confidence:.99}],{isFinal:p.final!==false}))});},{parts:segments,index,resultIndex});await settle();}
async function late(index,text='ás de espadas'){await emit([{text}],{index});await page.evaluate(i=>{__asr[i].onend?.();__asr[i].onstart?.();},index);await settle();}
async function nAsr(){return page.evaluate(()=>__asr.length);}
async function reset(count=5,locale='pt-BR'){
 await stop();await page.evaluate(()=>theibsApp.showView('analyze',false));
 await page.evaluate(n=>{document.querySelectorAll('dialog[open]').forEach(e=>e.close());document.querySelector('#auto-analysis').checked=false;theibsCardKeyboard.reset();const e=document.querySelector('#variant-select');e.value=String(n);e.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#card-voice-disclosure').open=true;},count);
 await page.locator('#voice-language').selectOption(locale);await page.locator('#voice-auto-apply').check();await page.locator('#voice-consent').check();await settle();
}
async function say(text){await start();await emit([{text}]);}
async function ledgerSay(text){await start();const n=await nAsr();await emit([{text}]);await page.waitForFunction(()=>!theibsApp.getState().multiwayBusy);await page.waitForFunction(n=>__asr.length>n&&theibsCardVoice.getStatus().listening&&!__asr.at(-1)?.aborted&&!__asr.at(-1)?.stopped,n);await settle();}
async function setupMw(locale='pt-BR'){
 await reset(5,locale);await page.evaluate(()=>theibsCardKeyboard.paste('AE KC QO JP TE'));
 await page.locator('#open-settings').click();await page.locator('#mw-setup-details').evaluate(e=>e.open=true);
 await page.locator('#mw-player-count').selectOption('2');await page.locator('#mw-hero-position').selectOption('SB');
 await page.locator('#mw-small-blind').fill('0.5');await page.locator('#mw-big-blind').fill('1');await page.locator('#mw-starting-stack').fill('100');await page.locator('#mw-start').click();
 await page.waitForFunction(()=>theibsApp.getState().multiway&&!theibsApp.getState().multiwayBusy);await settle();
}
async function delayStep(){let release,arrive;const gate=new Promise(r=>release=r),arrived=new Promise(r=>arrive=r);let requests=0;
 await page.route('**/api/multiway/step',async route=>{requests++;const response=await route.fetch();arrive();await gate;await route.fulfill({response}).catch(()=>{});});
 return {arrived,release,requests:()=>requests,clear:()=>page.unroute('**/api/multiway/step')};
}
(async()=>{try{
 ({server}=require('../server'));pool=require('../src/analysis-worker');await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,channel:'msedge'});report.browser=browser.version();page=await browser.newPage({viewport:{width:1440,height:1200},serviceWorkers:'block'});page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.addInitScript(()=>{window.__asr=[];window.__deferAsrStart=false;class ControlledRecognition{constructor(){__asr.push(this);this.started=false;}start(){this.started=true;if(!__deferAsrStart)setTimeout(()=>this.onstart?.(),0);}stop(){this.stopped=true;this.onend?.();}abort(){this.aborted=true;this.onend?.();}}window.SpeechRecognition=ControlledRecognition;});
 report.url=origin+'/app';await page.goto(report.url);await page.evaluate(()=>theibsApp.ready);await page.locator('#card-voice-disclosure').evaluate(e=>e.open=true);
 await page.evaluate(()=>{document.querySelector('#auto-analysis').checked=false;theibsCardKeyboard.reset();});
 await check('default automatic mode still requires explicit browser-service consent',async()=>{assert.equal(await page.locator('#voice-auto-apply').isChecked(),true);await page.locator('#voice-toggle').click();assert.equal(await nAsr(),0);assert.match(await page.locator('#voice-status').innerText(),/Autorize/);await page.locator('#voice-consent').check();});
 await check('screenshot case: final oito de paus immediately fills 8P, advances and keeps same recognizer',async()=>{
  await start();const n=await nAsr();await emit([{text:'oito de paus',final:false}]);assert.equal((await state()).slots[0],null);
  await emit([{text:'oito de paus'}]);assert.equal((await state()).slots[0],'8P');assert.equal((await state()).selected,1);assert.equal(await nAsr(),n);assert.equal(await listening(),true);assert.equal(await page.locator('#voice-review').isVisible(),false);
  await page.locator('#analyze-workspace').screenshot({path:path.join(out,'eight-of-clubs-auto.png')});
 });
 await check('cumulative final replay is idempotent; next result index inserts next card',async()=>{
  const before=await state(),n=await nAsr();await emit([{text:'oito de paus'}]);assert.deepEqual(await state(),before);
  await emit([{text:'oito de paus'},{text:'rei de copas'}],{resultIndex:1});assert.deepEqual((await state()).slots.slice(0,2),['8P','KC']);assert.equal((await state()).selected,2);assert.equal(await nAsr(),n);
 });
 for(const count of [4,5,6])for(const locale of ['pt-BR','en-US'])await check(`PLO${count} ${locale}: interim untouched, final batch automatic, spoken undo atomic`,async()=>{
  await reset(count,locale);const before=await state(),en=locale==='en-US',phrase=en?'ace of spades king of hearts':'ás de espadas rei de copas';await start();const n=await nAsr();
  await emit([{text:phrase,final:false}]);assert.deepEqual(await state(),before);await emit([{text:phrase}]);assert.deepEqual((await state()).slots.slice(0,2),['AE','KC']);assert.equal((await state()).selected,2);
  await emit([{text:phrase},{text:en?'undo':'desfazer'}],{resultIndex:1});assert.deepEqual(await state(),before);assert.equal(await nAsr(),n);assert.equal(await listening(),true);
 });
 await check('final plus interim in same event waits for whole pending batch; consolidated final applies once',async()=>{
  await reset();const before=await state();await start();await emit([{text:'ás de espadas'},{text:'rei de',final:false}]);assert.deepEqual(await state(),before);
  await emit([{text:'ás de espadas'},{text:'rei de copas'}],{resultIndex:1});assert.deepEqual((await state()).slots.slice(0,2),['AE','KC']);const once=await state();await emit([{text:'ás de espadas'},{text:'rei de copas'}]);assert.deepEqual(await state(),once);
 });
 await check('unconsumed interim snapshots can merge without obsolete trailing words',async()=>{await reset();await start();await emit([{text:'ás de espadas dez de',final:false},{text:'copas',final:false}]);await emit([{text:'ás de espadas dez de copas'}]);assert.deepEqual((await state()).slots.slice(0,2),['AE','TC']);});
 await check('missing suit holds whole batch and accepts only the requested complement atomically',async()=>{await reset();const before=await state();await say('ás de espadas rei');assert.deepEqual(await state(),before);assert.equal(await page.evaluate(()=>theibsCardVoice.getStatus().needsClarification),true);await emit([{text:'ás de espadas rei'},{text:'copas'}],{resultIndex:1});assert.deepEqual((await state()).slots.slice(0,2),['AE','KC']);assert.equal(await page.evaluate(()=>theibsCardVoice.getStatus().needsClarification),false);});
 for(const phrase of ['ás de espadas banana','ás de espadas ás de espadas'])await check(`invalid pending batch is atomic: ${phrase}`,async()=>{await reset();const before=await state();await say(phrase);assert.deepEqual(await state(),before);assert.equal(await listening(),false);assert.equal(await page.locator('#voice-review').isVisible(),false);});
 await check('duplicate against committed card rejected, earlier card retained',async()=>{await reset();await say('oito de paus');const before=await state();await emit([{text:'oito de paus'},{text:'oito de paus'}],{resultIndex:1});assert.deepEqual(await state(),before);assert.equal(await listening(),false);});
 for(const mutation of ['revision','downgrade','removal'])await check(`provider ${mutation} of consumed final cancels without reapplying`,async()=>{await reset();await say('oito de paus');const before=await state();const parts=mutation==='revision'?[{text:'oito de copas'}]:mutation==='downgrade'?[{text:'oito de paus',final:false}]:[];await emit(parts);assert.deepEqual(await state(),before);assert.equal(await listening(),false);});
 await check('optional review mode keeps final pending until stop and explicit Apply',async()=>{await reset();await page.locator('#voice-auto-apply').uncheck();const before=await state();await say('oito de paus');assert.deepEqual(await state(),before);await stop();assert.equal(await page.locator('#voice-review').isVisible(),true);assert.deepEqual(await state(),before);await page.locator('#voice-apply').click();assert.equal((await state()).slots[0],'8P');assert.equal(await listening(),false);await page.locator('#voice-auto-apply').check();});
 for(const edit of ['keyboard','selection','price','undo','navigation','session'])await check(`late ASR discarded after ${edit} context change`,async()=>{
  await reset();await page.evaluate(()=>theibsCardKeyboard.paste('2P'));await start();await emit([{text:'ás de espadas',final:false}]);const index=(await nAsr())-1;
  if(edit==='keyboard'){await page.keyboard.press('3');await page.keyboard.press('p');}
  if(edit==='selection')await page.locator('[data-slot="3"]').click();
  if(edit==='price')await page.evaluate(()=>{const e=document.querySelector('#amountToCall');e.value=String(Number(e.value)+1);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));});
  if(edit==='undo')await page.keyboard.press('Backspace');
  if(edit==='navigation')await page.evaluate(()=>theibsApp.showView('history',false));
  if(edit==='session')await page.evaluate(()=>{window.__originalVoiceSession=theibsVoiceSessionContext;const prior=theibsVoiceSessionContext();window.theibsVoiceSessionContext=()=>({...prior,epoch:prior.epoch+1,expired:true,required:true});document.dispatchEvent(new CustomEvent('theibs:voice-session-changed'));});
  const after=await state(),n=await nAsr();await late(index);assert.deepEqual(await state(),after);assert.equal(await listening(),false);assert.equal(await nAsr(),n);
  if(edit==='session')await page.evaluate(()=>window.theibsVoiceSessionContext=window.__originalVoiceSession);
 });
 for(const command of ['stop','cancel'])await check(`${command} ends capture; late final/start/end cannot restart`,async()=>{await reset();await start();await emit([{text:'oito de paus',final:false}]);const before=await state(),index=(await nAsr())-1;if(command==='stop')await stop();else await page.locator('#voice-cancel').click();await late(index);assert.deepEqual(await state(),before);assert.equal(await listening(),false);assert.equal(await nAsr(),index+1);});
 await check('stop after applied card retains card and suppresses natural provider restart',async()=>{await reset();await say('oito de paus');const before=await state(),index=(await nAsr())-1;await stop();await late(index,'rei de copas');assert.deepEqual(await state(),before);assert.equal(await listening(),false);assert.equal(await nAsr(),index+1);});
 await check('natural provider end restarts only with active intent and next capture inserts next card',async()=>{await reset();await say('oito de paus');const n=await nAsr();await page.evaluate(()=>__asr.at(-1).onend?.());await page.waitForFunction(n=>__asr.length===n+1&&theibsCardVoice.getStatus().listening,n);await emit([{text:'rei de copas'}]);assert.deepEqual((await state()).slots.slice(0,2),['8P','KC']);});
 await check('context edit inside provider restart delay prevents microphone reopening',async()=>{await reset();await say('oito de paus');const n=await nAsr();await page.evaluate(()=>{__asr.at(-1).onend?.();const e=document.querySelector('#amountToCall');e.value=String(Number(e.value)+1);e.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForTimeout(180);assert.equal(await nAsr(),n);assert.equal(await listening(),false);assert.equal((await state()).slots[0],'8P');});
 await check('stop during pending permission aborts late recognizer start',async()=>{await reset();await page.evaluate(()=>__deferAsrStart=true);await start();const index=(await nAsr())-1;await stop();await late(index);assert.equal(await page.evaluate(i=>__asr[i].aborted,index),true);assert.equal(await listening(),false);await page.evaluate(()=>__deferAsrStart=false);});
 await check('voice cards use real Analyze canonical payload, cache and workspace persistence',async()=>{
  await reset();await say('minhas cartas ás de espadas rei de copas dama de ouros valete de paus dez de espadas');await emit([{text:'minhas cartas ás de espadas rei de copas dama de ouros valete de paus dez de espadas'},{text:'flop nove de ouros oito de copas sete de paus'}],{resultIndex:1});await stop();
  await page.locator('#open-settings').click();await page.locator('#players').fill('2');await page.locator('#assumeNoRake').check();await page.locator('#settings-dialog [data-close-dialog]').click();
  const request=page.waitForRequest(r=>r.url().endsWith('/api/analyze'));await page.locator('#quick-analyze').click();const payload=(await request).postDataJSON();assert.deepEqual(payload.heroCards,['As','Kh','Qd','Jc','Ts']);assert.deepEqual(payload.board,['9d','8h','7c']);
  await page.waitForFunction(()=>!theibsApp.getState().analysisBusy&&theibsApp.getState().lastAnalysis?.data?.equity);const first=await page.evaluate(()=>theibsApp.getState().lastAnalysis.data);
  const response=page.waitForResponse(r=>r.url().endsWith('/api/analyze'));await page.locator('#quick-analyze').click();const second=await (await response).json();await page.waitForFunction(()=>!theibsApp.getState().analysisBusy);assert.deepEqual(second.equity,first.equity);assert.equal(second.performance?.cacheHit??second.cacheHit,true);
  const saved=await state();await page.evaluate(()=>theibsApp.flushSave());await page.waitForFunction(()=>!theibsApp.getState().saveBusy);report.timingBeforeReload=await page.evaluate(()=>theibsCardVoice.getMetrics());await page.reload();await page.evaluate(()=>theibsApp.ready);assert.deepEqual(await state(),saved);
 });
 for(const locale of ['pt-BR','en-US'])await check(`automatic Multiway ${locale}: actor, legal totals, HTTP ledger, board and spoken undo`,async()=>{
  const en=locale==='en-US';await setupMw(locale);const before=await page.evaluate(()=>JSON.stringify(theibsApp.getState().multiway));
  for(const text of en?['opponent one call','hero raise to nine thousand','hero calls ten']:['adversário um paga','eu aumento para nove mil','eu pago dez']){await say(text);assert.equal(await listening(),false);assert.equal(await page.evaluate(()=>JSON.stringify(theibsApp.getState().multiway)),before);}
  const request=page.waitForRequest(r=>r.url().endsWith('/api/multiway/step'));await ledgerSay(en?'hero raises to two point five':'eu aumento para dois vírgula cinco');assert.deepEqual((await request).postDataJSON().event,{type:'ACT',actor:0,action:'RAISE',to:2.5});
  await ledgerSay(en?'undo':'desfazer');assert.equal(await page.evaluate(()=>JSON.stringify(theibsApp.getState().multiway)),before);
  await ledgerSay(en?'hero call':'eu pago');await ledgerSay(en?'opponent one checks':'adversário um passa');assert.equal(await page.evaluate(()=>theibsApp.getState().multiwayState.phase),'WAIT_BOARD');
  for(const text of en?['turn nine of diamonds','flop nine of diamonds eight of hearts']:['turn nove de ouros','flop nove de ouros oito de copas']){await say(text);assert.equal(await listening(),false);assert.deepEqual(await page.evaluate(()=>theibsApp.getState().multiwayState.board),[]);}
  await ledgerSay(en?'flop nine of diamonds eight of hearts seven of clubs':'flop nove de ouros oito de copas sete de paus');assert.deepEqual(await page.evaluate(()=>theibsApp.getState().multiwayState.board),['9d','8h','7c']);
  await ledgerSay(en?'opponent one bets one point five':'adversário um aposta um vírgula cinco');assert.equal(await page.evaluate(()=>theibsApp.getState().multiwayState.players[1].streetPaid),1.5);
  await ledgerSay(en?'hero raises to three':'eu aumento para três');assert.equal(await page.evaluate(()=>theibsApp.getState().multiwayState.players[0].streetPaid),3);
  await ledgerSay(en?'opponent one folds':'adversário um desiste');assert.equal(await page.evaluate(()=>theibsApp.getState().multiwayState.players[1].folded),true);await ledgerSay(en?'undo':'desfazer');assert.equal(await page.evaluate(()=>theibsApp.getState().multiwayState.players[1].folded),false);
 });
 await check('HTTP action suspends recognizer; old callbacks cannot queue actions before/after acknowledgement',async()=>{
  await setupMw();const delay=await delayStep();try{await say('eu pago');await delay.arrived;const n=await nAsr(),index=n-1;assert.equal(await page.evaluate(i=>__asr[i].aborted,index),true);await late(index,'adversário um passa');assert.equal(await nAsr(),n);assert.equal(delay.requests(),1);
   delay.release();await page.waitForFunction(()=>!theibsApp.getState().multiwayBusy);await page.waitForFunction(n=>__asr.length>n&&theibsCardVoice.getStatus().listening,n);assert.equal(await page.evaluate(()=>theibsApp.getState().multiway.events.length),1);await late(index,'adversário um passa');assert.equal(delay.requests(),1);assert.equal(await page.evaluate(()=>theibsApp.getState().multiway.events.length),1);
  }finally{delay.release();await delay.clear();}
 });
 await check('card controls and keyboard are locked while action HTTP is pending; one restart follows acknowledgement',async()=>{
  await setupMw();const delay=await delayStep();try{await say('eu pago');await delay.arrived;const before=await state(),n=await nAsr();assert.equal(await page.locator('#hero-slots').evaluate(e=>e.inert),true);await page.keyboard.press('2');await page.keyboard.press('p');assert.deepEqual(await state(),before);assert.equal(delay.requests(),1);delay.release();await page.waitForFunction(()=>!theibsApp.getState().multiwayBusy);await page.waitForFunction(n=>__asr.length===n+1,n);assert.equal(await page.locator('#hero-slots').evaluate(e=>e.inert),false);assert.deepEqual((await state()).slots,before.slots);assert.equal(await page.evaluate(()=>theibsApp.getState().multiway.events.length),1);
  }finally{delay.release();await delay.clear();}
 });
 for(const interruption of ['stop','cancel','escape','navigation','session'])await check(`${interruption} during HTTP prevents automatic restart and late queued action`,async()=>{
  await setupMw();const before=await page.evaluate(()=>JSON.stringify(theibsApp.getState().multiway));const delay=await delayStep();try{await say('eu pago');await delay.arrived;const index=(await nAsr())-1,n=await nAsr();
   if(interruption==='stop')await page.locator('#voice-toggle').click();if(interruption==='cancel')await page.locator('#voice-cancel').click();
   if(interruption==='escape')await page.keyboard.press('Escape');
   if(interruption==='navigation')await page.evaluate(()=>theibsApp.showView('history',false));
   if(interruption==='session')await page.evaluate(()=>{window.__originalVoiceSession=theibsVoiceSessionContext;const prior=theibsVoiceSessionContext();window.theibsVoiceSessionContext=()=>({...prior,epoch:prior.epoch+1,expired:true,required:true});document.dispatchEvent(new CustomEvent('theibs:voice-session-changed'));});
   await late(index,'adversário um passa');delay.release();await page.waitForFunction(()=>!theibsApp.getState().multiwayBusy);await page.waitForTimeout(180);assert.equal(await nAsr(),n);assert.equal(await listening(),false);assert.equal(delay.requests(),1);
   if(['navigation','session'].includes(interruption))assert.equal(await page.evaluate(()=>JSON.stringify(theibsApp.getState().multiway)),before);
   if(interruption==='session')await page.evaluate(()=>window.theibsVoiceSessionContext=window.__originalVoiceSession);
  }finally{delay.release();await delay.clear();}
 });
 await check('metrics remain transcript-free; no browser runtime errors',async()=>{await settle();report.timing=await page.evaluate(()=>theibsCardVoice.getMetrics());assert.ok(report.timing.every(row=>!('transcript'in row)&&!('cards'in row)));assert.deepEqual(report.pageErrors,[]);const rows=[...(report.timingBeforeReload||[]),...report.timing].filter(row=>row.automatic);report.timingSummary={scope:'DESCRIPTIVE_CONTROLLED_FINAL_EVENT_TO_SECOND_RAF_NOT_ACOUSTIC_OR_HOSTED',samples:rows.length};for(const field of ['finalToAppliedSecondRafMs','commitMs','parserMs']){const values=rows.map(row=>row[field]).filter(Number.isFinite).sort((a,b)=>a-b);report.timingSummary[field]={n:values.length,median:values[Math.ceil(values.length*.5)-1],p95:values[Math.ceil(values.length*.95)-1],max:values.at(-1)};}});
 report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.stack;if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();report.finalSourceHashes=Object.fromEntries(files.map(f=>[f,hash(f)]));report.sourceChangedDuringRun=JSON.stringify(report.sourceHashes)!==JSON.stringify(report.finalSourceHashes);fs.writeFileSync(path.join(out,'browser-qa.json'),JSON.stringify(report,null,2));await browser?.close();await pool?.close();server?.closeAllConnections?.();await new Promise(resolve=>server?server.close(resolve):resolve());console.log(JSON.stringify({status:report.status,cases:report.cases.length,failed:report.cases.filter(c=>c.status==='FAIL'),report:path.join(out,'browser-qa.json')}));}
})().then(()=>process.exit(process.exitCode||0));
