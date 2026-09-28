'use strict';
// Browser/application integration with controlled ASR events. No microphone,
// recorded voice, provider recognition, or hosted validation is represented.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const out=path.resolve(process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'../validacao/analyze-online-2026-09-27/voice');
fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-voice-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const report={at:new Date().toISOString(),source:'CONTROLLED_ASR_EVENTS',environment:'LOCAL_EXECUTED',acoustic:'NOT_EXECUTED',hosted:'NOT_EXECUTED',status:'RUNNING',cases:[],pageErrors:[]};
let server,browser,page;
async function check(name,fn){console.log('CHECK '+name);try{await fn();report.cases.push({name,status:'PASS'});}catch(error){report.cases.push({name,status:'FAIL',error:error.message});throw error;}}
async function state(){return page.evaluate(()=>theibsCardKeyboard.state.snapshot());}
async function start(){await page.locator('#voice-toggle').click();await page.waitForFunction(()=>theibsCardVoice.getStatus().listening);}
async function emit(segments){await page.evaluate(parts=>{const r=window.__asr.at(-1);const results=parts.map(p=>Object.assign([{transcript:p.text,confidence:.99}],{isFinal:p.final!==false}));r.onresult?.({resultIndex:0,results});},segments);}
async function finish(){await page.locator('#voice-toggle').click();}
async function speak(text){await start();await emit([{text}]);await finish();}
async function apply(){await page.locator('#voice-apply').click();await page.waitForFunction(()=>theibsCardVoice.getStatus().phase==='cancelled');}
(async()=>{
 try{
  ({server}=require('../server'));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({channel:'msedge',headless:true});report.browser=browser.version();
  page=await browser.newPage({viewport:{width:1366,height:1000},serviceWorkers:'block'});
  page.on('pageerror',e=>report.pageErrors.push(e.message));
  await page.addInitScript(()=>{
   window.__asr=[];window.__deferAsrStart=false;
   class ControlledRecognition{
    constructor(){window.__asr.push(this);}
    start(){if(!window.__deferAsrStart)setTimeout(()=>this.onstart?.(),0);}
    stop(){this.onend?.();}
    abort(){this.aborted=true;this.onend?.();}
   }
   window.SpeechRecognition=ControlledRecognition;
  });
  report.url=`http://127.0.0.1:${server.address().port}/app`;
  await page.goto(report.url);await page.evaluate(()=>theibsApp.ready);
  await page.locator('#card-voice-disclosure>summary').click();await page.locator('#voice-auto-apply').uncheck();
  await page.evaluate(()=>{document.querySelector('#auto-analysis').checked=false;theibsCardKeyboard.reset();});
  await check('explicit remote-processing permission required before ASR creation',async()=>{
   await page.locator('#voice-toggle').click();assert.equal(await page.evaluate(()=>__asr.length),0);
   assert.match(await page.locator('#voice-status').innerText(),/Autorize/);await page.locator('#voice-consent').check();
  });
  for(const count of [4,5,6])for(const locale of ['pt-BR','en-US'])await check(`PLO${count} ${locale}: batch -> canonical state -> one undo`,async()=>{
   await page.evaluate(n=>{theibsCardKeyboard.reset();document.querySelector('#variant-select').value=String(n);document.querySelector('#variant-select').dispatchEvent(new Event('change',{bubbles:true}));},count);
   await page.locator('#voice-language').selectOption(locale);const before=await state();
   await start();await emit([{text:locale==='pt-BR'?'ás de espadas':'ace of spades',final:false}]);assert.deepEqual(await state(),before);
   await emit([{text:locale==='pt-BR'?'ás de espadas':'ace of spades'},{text:locale==='pt-BR'?'rei de copas':'king of hearts'}]);
   await emit([{text:locale==='pt-BR'?'ás de espadas':'ace of spades'},{text:locale==='pt-BR'?'rei de copas':'king of hearts'}]);
   await finish();assert.deepEqual(await state(),before);await apply();assert.deepEqual((await state()).slots.slice(0,2),['AE','KC']);assert.equal((await state()).selected,2);
   await speak(locale==='pt-BR'?'desfazer':'undo');await apply();assert.deepEqual(await state(),before);
  });
  await page.locator('#voice-language').selectOption('pt-BR');
  await check('native-style ASR interim consolidation shrinks results without retaining obsolete words',async()=>{
   const before=await state();await start();await emit([{text:'ás de espadas dez de',final:false},{text:' copas',final:false}]);
   await emit([{text:'ás de espadas dez de copas'}]);await finish();await apply();assert.deepEqual((await state()).slots.slice(0,2),['AE','TC']);
   await speak('desfazer');await apply();assert.deepEqual(await state(),before);
  });
  await check('voice target selection changes selection without scheduling a card recalculation',async()=>{
   await page.evaluate(()=>{window.__voiceCardEvents=0;document.addEventListener('theibs:cards-changed',()=>window.__voiceCardEvents++);});
   const before=await state();await speak('flop');await apply();assert.deepEqual((await state()).slots,before.slots);
   assert.equal((await state()).selected,before.count);assert.equal(await page.evaluate(()=>__voiceCardEvents),0);
   await speak('minhas cartas');await apply();assert.equal((await state()).selected,0);assert.equal(await page.evaluate(()=>__voiceCardEvents),0);
  });
  await check('valid prefix plus ambiguous final segment changes nothing',async()=>{
   const before=await state();await start();await emit([{text:'ás de espadas'},{text:'rei'}]);await finish();assert.deepEqual(await state(),before);assert.equal(await page.locator('#voice-review').isVisible(),false);
  });
  await check('late result after keyboard edit cannot overwrite cards',async()=>{
   await start();await page.keyboard.press('2');await page.keyboard.press('p');const after=await state();
   await page.evaluate(()=>{const r=__asr.at(-1);r.onresult?.({resultIndex:0,results:[Object.assign([{transcript:'ás de espadas'}],{isFinal:true})]});r.onend?.();});
   assert.deepEqual(await state(),after);assert.equal(await page.locator('#voice-review').isVisible(),false);
  });
  await check('selection change cancels pending proposal, unchanged cards',async()=>{
   await speak('rei de copas');const before=await state();await page.locator('[data-slot="3"]').click();assert.deepEqual((await state()).slots,before.slots);assert.equal(await page.locator('#voice-review').isVisible(),false);
  });
  await check('release while microphone permission pending aborts late start',async()=>{
   await page.evaluate(()=>window.__deferAsrStart=true);await start();await finish();
   await page.evaluate(()=>__asr.at(-1).onstart?.());assert.equal(await page.evaluate(()=>__asr.at(-1).aborted),true);assert.equal(await page.evaluate(()=>theibsCardVoice.getStatus().listening),false);
   await page.evaluate(()=>window.__deferAsrStart=false);
  });
  await check('provider permission/network/silence errors do not alter state',async()=>{
   for(const code of ['not-allowed','network','no-speech','audio-capture']){const before=await state();await start();await page.evaluate(error=>__asr.at(-1).onerror?.({error}),code);assert.deepEqual(await state(),before);assert.equal(await page.evaluate(()=>theibsCardVoice.getStatus().listening),false);}
  });
  await check('network loss and navigation cancel queued speech',async()=>{
   const before=await state();await start();await page.evaluate(()=>window.dispatchEvent(new Event('offline')));assert.deepEqual(await state(),before);
   await start();await page.evaluate(()=>theibsApp.showView('train'));assert.equal(await page.evaluate(()=>theibsCardVoice.getStatus().listening),false);assert.equal(await page.locator('#card-voice').isVisible(),false);await page.evaluate(()=>theibsApp.showView('analyze'));
  });
  await check('session-expiry notification cancels speech and expired-session gate blocks restart',async()=>{
   await start();await page.evaluate(()=>document.dispatchEvent(new CustomEvent('theibs:voice-session-changed')));
   assert.equal(await page.evaluate(()=>theibsCardVoice.getStatus().listening),false);
   await page.evaluate(()=>{window.__originalVoiceSession=window.theibsVoiceSessionContext;window.theibsVoiceSessionContext=()=>({epoch:998,required:true,expired:true});});
   const n=await page.evaluate(()=>__asr.length);await page.locator('#voice-toggle').click();assert.equal(await page.evaluate(()=>__asr.length),n);
   await page.evaluate(()=>window.theibsVoiceSessionContext=window.__originalVoiceSession);
  });
  await check('device-only mode never silently uses remote recognizer',async()=>{
   await page.locator('#voice-processing').selectOption('device');const n=await page.evaluate(()=>__asr.length);await page.locator('#voice-toggle').click();assert.equal(await page.evaluate(()=>__asr.length),n);assert.match(await page.locator('#voice-status').innerText(),/dispositivo/);await page.locator('#voice-processing').selectOption('browser');
  });
  await check('typed voice state -> actual Analyze canonical request and workspace re-open',async()=>{
   await page.evaluate(()=>{theibsCardKeyboard.reset();document.querySelector('#variant-select').value='5';document.querySelector('#variant-select').dispatchEvent(new Event('change',{bubbles:true}));});
   await speak('minhas cartas ás de espadas, rei de copas, dama de ouros, valete de paus, dez de espadas');await apply();
   await speak('flop nove de ouros, oito de copas, sete de paus');await apply();
   await page.locator('#open-settings').click();await page.locator('#players').fill('2');await page.locator('#opponent-input-panel').evaluate(e=>e.open=true);await page.locator('#opponentRange').fill('');await page.locator('#opponentHand').fill('2P 3P 4P 5P 6P');await page.locator('#opponent-apply').click();await page.locator('#assumeNoRake').check();await page.locator('#settings-dialog [data-close-dialog]').click();
   const req=page.waitForRequest(r=>r.url().endsWith('/api/analyze'));
   await page.locator('#quick-analyze').click();const payload=(await req).postDataJSON();
   assert.deepEqual(payload.heroCards,['As','Kh','Qd','Jc','Ts']);assert.deepEqual(payload.board,['9d','8h','7c']);
   assert.deepEqual(payload.opponentOverrides[0].range.hands,[['2c','3c','4c','5c','6c']]);
   await page.waitForFunction(()=>!theibsApp.getState().analysisBusy,{timeout:30000});
   assert.ok(await page.evaluate(()=>theibsApp.getState().lastAnalysis?.data?.equity));
   const saved=await state();await page.evaluate(()=>theibsApp.flushSave());report.timingBeforeReload=await page.evaluate(()=>theibsCardVoice.getMetrics());await page.reload();await page.evaluate(()=>theibsApp.ready);assert.deepEqual(await state(),saved);
   await page.locator('#card-voice-disclosure>summary').click();await page.locator('#voice-auto-apply').uncheck();await page.locator('#voice-consent').check();
  });
  await check('multiway hero phrase survives server acknowledgement and one undo restores cards and selection',async()=>{
   await page.evaluate(()=>{document.querySelector('#auto-analysis').checked=false;theibsCardKeyboard.reset();theibsCardKeyboard.paste('AE KC QO JP TE');});
   await page.locator('#open-settings').click();await page.locator('#mw-setup-details>summary').click();await page.locator('#mw-player-count').selectOption('2');await page.locator('#mw-hero-position').selectOption('SB');await page.locator('#mw-start').click();
   await page.waitForFunction(()=>theibsApp.getState().multiway&&!theibsApp.getState().multiwayBusy);
   const before=await state();
   await speak('corrigir carta três para dama de paus');const ack=page.waitForResponse(r=>r.url().endsWith('/api/multiway/state'));await apply();await (await ack).finished();
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   assert.equal((await state()).slots[2],'QP');assert.ok(await page.evaluate(()=>theibsCardKeyboard.state.undoStack.length)>0);
   await speak('desfazer');const undoAck=page.waitForResponse(r=>r.url().endsWith('/api/multiway/state'));await apply();await (await undoAck).finished();
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.deepEqual(await state(),before);
   // Leave a new private-hand undo entry; the next genuine BOARD must clear it.
   await speak('corrigir carta três para dama de paus');const nextAck=page.waitForResponse(r=>r.url().endsWith('/api/multiway/state'));await apply();await (await nextAck).finished();
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  });
  await check('multiway board gated by phase, commits via ledger, invalidates prior hero undo and restores prior street',async()=>{
   await speak('flop nove de ouros, oito de copas, sete de paus');assert.equal(await page.locator('#voice-review').isVisible(),false);
   // Advance legally using the existing action controls. No direct ledger writes.
   for(let i=0;i<6;i++){
    if(await page.evaluate(()=>theibsApp.getState().multiwayState.phase==='WAIT_BOARD'))break;
    const action=await page.evaluate(()=>theibsApp.getState().multiwayState.legal.actions.includes('CALL')?'call':'leave');
    await page.locator(`[data-mw-command="${action}"]`).click();await page.waitForFunction(()=>!theibsApp.getState().multiwayBusy);
   }
   assert.equal(await page.evaluate(()=>theibsApp.getState().multiwayState.phase),'WAIT_BOARD');
   await speak('turn nove de ouros');assert.equal(await page.locator('#voice-review').isVisible(),false);
   await speak('flop nove de ouros, oito de copas, sete de paus');await apply();
   assert.deepEqual(await page.evaluate(()=>theibsApp.getState().multiwayState.board),['9d','8h','7c']);
   assert.equal(await page.evaluate(()=>theibsApp.getState().multiway.events.at(-1).type),'BOARD');
   assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.undoStack.length),0);
   await speak('desfazer');await apply();assert.deepEqual(await page.evaluate(()=>theibsApp.getState().multiwayState.board),[]);
  });
  await check('PLO5 six-player CO table shows stable Adv.N labels after Adv.1 folds',async()=>{
   await page.locator('#voice-language').selectOption('pt-BR');
   await page.locator('#open-settings').click();await page.locator('#mw-setup-details').evaluate(e=>e.open=true);
   await page.locator('#mw-player-count').selectOption('6');await page.locator('#mw-hero-position').selectOption('CO');await page.locator('#mw-start').click();
   await page.waitForFunction(()=>!theibsApp.getState().multiwayBusy);
   const initial=await page.evaluate(()=>theibsApp.getState().multiwayState),ids=initial.players.filter(p=>!p.hero).map(p=>p.id);
   for(let n=0;n<6;n++){
    const current=await page.evaluate(()=>theibsApp.getState().multiwayState);if(current.phase!=='BETTING')break;
    for(const player of current.players.filter(p=>!p.hero)){
     const label=await page.locator(`[data-multiway-player="${player.id}"] .opponent-name`).innerText();
     assert.ok(label.toLowerCase().includes(player.name.toLowerCase()),label);assert.ok(label.includes(player.position),label);
    }
    const actor=current.players.find(p=>p.id===current.actor),name=actor.hero?'eu':`adversário ${ids.indexOf(actor.id)+1}`;
    const action=actor.id===ids[0]?'desiste':current.legal.actions.includes('CALL')?'paga':'passa';
    await speak(`${name} ${action}`);await apply();
   }
   assert.equal(await page.evaluate(()=>theibsApp.getState().multiwayState.phase),'WAIT_BOARD');
   assert.ok(await page.locator(`[data-multiway-player="${ids[0]}"]`).evaluate(e=>e.classList.contains('folded')));
   await speak('flop nove de ouros, oito de copas, sete de paus');await apply();
   await speak('adversário um passa');assert.equal(await page.locator('#voice-review').isVisible(),false);
   await speak('adversário dois passa');const request=page.waitForRequest(r=>r.url().endsWith('/api/multiway/step'));await apply();
   assert.equal((await request).postDataJSON().event.actor,ids[1]);
   assert.match(await page.locator(`[data-multiway-player="${ids[0]}"] .opponent-name`).innerText(),/Adv\.\s*1/i);
  });
  for(const locale of ['pt-BR','en-US'])await check(`Observed actions ${locale}: actor, legality, decimal totals, ledger, one undo`,async()=>{
   const en=locale==='en-US';await page.locator('#voice-language').selectOption(locale);
   await page.locator('#open-settings').click();await page.locator('#mw-setup-details').evaluate(e=>e.open=true);await page.locator('#mw-player-count').selectOption('2');await page.locator('#mw-hero-position').selectOption('SB');await page.locator('#mw-start').click();
   await page.waitForFunction(()=>!theibsApp.getState().multiwayBusy);
   const before=await page.evaluate(()=>JSON.stringify(theibsApp.getState().multiway));
   await speak(en?'opponent one call':'adversário um paga');assert.equal(await page.locator('#voice-review').isVisible(),false);
   await speak(en?'hero raise to nine thousand':'eu aumento para nove mil');assert.equal(await page.locator('#voice-review').isVisible(),false);
   assert.equal(await page.evaluate(()=>JSON.stringify(theibsApp.getState().multiway)),before);
   await speak(en?'hero calls ten':'eu pago dez');assert.equal(await page.locator('#voice-review').isVisible(),false);assert.match(await page.locator('#voice-status').innerText(),en?/without a value/:/sem valor/);
   await speak(en?'hero raises to two point five':'eu aumento para dois vírgula cinco');
   assert.match(await page.locator('#voice-proposal').innerText(),/RAISE.*2[.,]5.*adicionar 2/);const request=page.waitForRequest(r=>r.url().endsWith('/api/multiway/step'));await apply();
   assert.deepEqual((await request).postDataJSON().event,{type:'ACT',actor:0,action:'RAISE',to:2.5});
   await speak(en?'undo':'desfazer');await apply();assert.equal(await page.evaluate(()=>JSON.stringify(theibsApp.getState().multiway)),before);
   await speak(en?'hero call':'eu pago');await apply();await speak(en?'opponent one checks':'adversário um passa');await apply();
   assert.equal(await page.evaluate(()=>theibsApp.getState().multiwayState.phase),'WAIT_BOARD');
   await speak(en?'flop nine of diamonds, eight of hearts, seven of clubs':'flop nove de ouros, oito de copas, sete de paus');await apply();
   await speak(en?'opponent one bets one point five':'adversário um aposta um vírgula cinco');await apply();
   assert.equal(await page.evaluate(()=>theibsApp.getState().multiwayState.players[1].streetPaid),1.5);
   await speak(en?'hero raise to three':'eu aumento para três');await apply();
   assert.equal(await page.evaluate(()=>theibsApp.getState().multiwayState.players[0].streetPaid),3);
   await speak(en?'opponent one folds':'adversário um desiste');await apply();assert.equal(await page.evaluate(()=>theibsApp.getState().multiwayState.players[1].folded),true);
   await speak(en?'undo':'desfazer');await apply();assert.equal(await page.evaluate(()=>theibsApp.getState().multiwayState.players[1].folded),false);
   await page.evaluate(()=>theibsApp.flushSave());
  });
  for(const interruption of ['navigation','session'])await check(`Confirmed action HTTP response discarded after ${interruption==='session'?'simulated session invalidation':interruption}`,async()=>{
   await page.locator('#voice-language').selectOption('en-US');await speak('opponent one call');
   const before=await page.evaluate(()=>({record:JSON.stringify(theibsApp.getState().multiway),cards:theibsCardKeyboard.state.snapshot()}));
   let release,received;const gate=new Promise(r=>release=r),arrived=new Promise(r=>received=r);
   await page.route('**/api/multiway/step',async route=>{const response=await route.fetch();received();await gate;await route.fulfill({response});});
   await page.locator('#voice-apply').click();await arrived;
   if(interruption==='navigation')await page.evaluate(()=>theibsApp.showView('history'));
   else await page.evaluate(()=>{
    // This broad input harness runs with optional authentication. Simulate the
    // documented epoch boundary here; qa-voice-session exercises real auth-ui
    // expiration, 401, account change and cross-tab removal with fake accounts.
    const previous=window.theibsVoiceSessionContext();window.theibsVoiceSessionContext=()=>({...previous,epoch:previous.epoch+1,required:true,expired:true});
    document.dispatchEvent(new CustomEvent('theibs:voice-session-changed'));
   });
   release();await page.waitForFunction(()=>!theibsApp.getState().multiwayBusy);
   assert.equal(await page.evaluate(()=>JSON.stringify(theibsApp.getState().multiway)),before.record);assert.deepEqual(await state(),before.cards);
   assert.doesNotMatch(await page.locator('#voice-status').textContent(),/Ação observada registrada/);
   await page.unroute('**/api/multiway/step');
   if(interruption==='navigation')await page.evaluate(()=>theibsApp.showView('analyze'));
  });
  await check('no automatic acoustic approval and timing contains no transcript or cards',async()=>{
   const status=await page.evaluate(()=>theibsCardVoice.getStatus());assert.equal(status.autoApply,false);assert.equal(status.acoustic,'NOT_EXECUTED');
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   report.timingSamples=await page.evaluate(()=>theibsCardVoice.getMetrics());
   assert.ok(report.timingSamples.every(row=>!('transcript'in row)&&!('cards'in row)));assert.deepEqual(report.pageErrors,[]);
  });
  await page.locator('#card-voice').screenshot({path:path.join(out,'voice-ui-local.png')});
  report.status='PASS';
 }catch(error){report.status='FAIL';report.error=error.stack;if(page)await page.screenshot({path:path.join(out,'voice-ui-failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'browser-qa.json'),JSON.stringify(report,null,2));await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());console.log(JSON.stringify({status:report.status,cases:report.cases.length,failed:report.cases.filter(c=>c.status==='FAIL'),report:path.join(out,'browser-qa.json')}));}
})().then(()=>process.exit(process.exitCode||0));
