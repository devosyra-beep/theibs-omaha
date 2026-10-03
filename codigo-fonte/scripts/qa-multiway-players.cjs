'use strict';
// Browser component HARNESS using the real local ledger API. No real account,
// acoustic recognition, or external model is used by these checks.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-players-qa-'));
Object.assign(process.env,{THEIBS_AUTH_REQUIRED:'false',THEIBS_MULTIWAY_LLM_PROVIDER:'none',THEIBS_LLM_PROVIDER:'none',THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json')});
const {server}=require('../server'),mw=require('../src/multiway-session'),profiles=require('../src/player-profiles');
const out=path.resolve(__dirname,'../../validacao/multiway-players-qa');fs.mkdirSync(out,{recursive:true});
const report={scope:'BROWSER_COMPONENT_HARNESS_REAL_LOCAL_LEDGER_API',checks:[],errors:[]};
let browser;
(async()=>{try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1366,height:900}}),page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(origin);await page.setContent('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/multiway.css"><link rel="stylesheet" href="/players.css"></head><body data-felt="roxo" data-deck="cores"><main id="players-workspace" class="players-workspace"></main></body></html>');
  for(const name of ['card-model.js','player-profile-model.js','players-storage.js','players-ui.js'])await page.addScriptTag({url:`${origin}/${name}`});
  await page.evaluate(async()=>{
    window.theibsPlayersUI.configure({request:async(url,opts)=>{const response=await fetch(url,opts),data=await response.json();if(!response.ok)throw Error(data.reason);return data;}});
    await theibsPlayersUI.init('a'.repeat(64));
  });
  for(let i=0;i<2;i++){
    await page.locator('#players-new-name').fill('Same name');await page.locator('#players-create button').click();
    await page.waitForFunction(count=>theibsPlayersUI.list().length===count,i+1);
  }
  const saved=await page.evaluate(()=>theibsPlayersUI.list());assert.equal(saved.length,2);assert.notEqual(saved[0].playerId,saved[1].playerId);
  await page.locator('#players-note-text').fill('Pays small raises — a manual hypothesis only.');await page.locator('#players-add-note button').click();
  await page.waitForFunction(()=>theibsPlayersUI.list().some(player=>player.notes.some(note=>note.text==='Pays small raises — a manual hypothesis only.')));
  assert.equal((await page.evaluate(()=>theibsPlayersUI.list())).reduce((sum,p)=>sum+p.observations,0),0);
  let hand=mw.start({variant:'PLO4_HIGH',playerCount:2,heroPosition:'BB',startingStack:10,smallBlind:.5,bigBlind:1,heroCards:['As','Kh','Qd','Jc'],players:[{playerId:saved[0].playerId,name:'Same name'},{playerId:saved[1].playerId,name:'Same name'}]});
  const initial=hand.multiway;
  await page.evaluate(record=>theibsPlayersUI.beginHand(record),initial);
  const frozen=await page.evaluate(record=>theibsPlayersUI.profileSnapshot(record),initial);
  hand=mw.step(hand.multiway,{type:'ACT',actor:0,action:'CALL',eventId:'qa-call'});
  const before=hand.multiway;
  const decision={handId:before.handId,revisionKey:hand.state.revisionKey,action:'CHECK',feedback:{bigBlind:1},recordBefore:{config:before.config,events:before.events},analysis:{analysisId:'qa-original-estimate',ev:{bigBlind:1,leaderConclusive:false,candidates:[{action:'CHECK',status:'MODELED',ev:1.2,evBB:1.2,differenceToBestModeledBB:0,confidenceInterval95:[-2,4]}],assumptions:['Synthetic known decision snapshot for storage QA.']}}};
  hand=mw.step(hand.multiway,{type:'ACT',actor:1,action:'CHECK',eventId:'qa-check'});
  decision.committedEventId='qa-check';
  await page.evaluate(async snapshot=>{
    const writes=[theibsPlayersUI.recordDecision(snapshot.handId,snapshot),theibsPlayersUI.recordDecision(snapshot.handId,snapshot)];
    // A caller may later reuse/mutate its result object. The saved decision
    // must own an independent copy before the hand is eventually archived.
    snapshot.analysis.ev.candidates[0].ev=999;
    snapshot.recordBefore.config.heroCards=[];
    const exposed=theibsPlayersUI.getStore();exposed.revision=999999;
    await Promise.all(writes);
  },decision);
  const board=['2s','3h','4d','8c','9s'];
  while(hand.state.phase!=='SHOWDOWN')hand=mw.step(hand.multiway,hand.state.phase==='WAIT_BOARD'?{type:'BOARD',cards:board.slice(0,{FLOP:3,TURN:4,RIVER:5}[hand.state.nextStreet])}:{type:'ACT',actor:hand.state.actor,action:'CHECK'});
  hand=mw.step(hand.multiway,{type:'SETTLE',winners:[[1]],rake:0});
  const observations=profiles.deriveObservations(hand.multiway);
  await page.evaluate(async payload=>{await Promise.all([theibsPlayersUI.syncObservations(payload),theibsPlayersUI.syncObservations(payload)]);},observations);
  assert.deepEqual(await page.evaluate(record=>theibsPlayersUI.profileSnapshot(record),hand.multiway),frozen);
  assert.equal((await page.evaluate(()=>theibsPlayersUI.list())).reduce((sum,p)=>sum+p.observations,0),8);
  const next=mw.nextHand(hand.multiway,{},hand.state.revisionKey);
  await page.evaluate(async payload=>{
    const write=theibsPlayersUI.archiveHand(payload.archive);
    payload.archive.multiway.config.heroCards=[];
    await write;theibsPlayersUI.select(payload.id);
  },{archive:next.archivedHand,id:saved[0].playerId});
  const archived=await page.evaluate(id=>theibsPlayersUI.getArchivedHand(id),hand.multiway.handId);assert.equal(archived.decisions.length,1);
  assert.equal(archived.decisions[0].analysis.ev.candidates[0].ev,1.2);
  assert.deepEqual(archived.decisions[0].recordBefore.config.heroCards,initial.config.heroCards);
  assert.deepEqual(archived.multiway.config.heroCards,initial.config.heroCards,'caller mutation cannot change a queued archive');
  assert.notEqual(await page.evaluate(()=>theibsPlayersUI.getStore().revision),999999);
  await page.locator('.players-detail > details > summary').filter({hasText:'Observed actions'}).click();await page.locator('.players-contexts summary').first().click();
  assert.match(await page.locator('.players-observations-table').first().innerText(),/95% interval/);
  await page.screenshot({path:path.join(out,'players-desktop.png'),fullPage:true});
  await page.setViewportSize({width:393,height:852});
  await page.screenshot({path:path.join(out,'players-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'player library has no horizontal overflow');
  await page.setViewportSize({width:1366,height:900});
  await page.locator('[data-player-detail="history"] > summary').click();await page.locator('[data-player-detail^="hand-"] > summary').click();
  await page.locator('[data-archive-reveal]').click();
  await page.locator('#players-reveal-cards').fill('2E');await page.locator('#players-reveal-form [type=submit]').click();assert.match(await page.locator('#players-reveal-error').innerText(),/duplicates/);
  await page.locator('#players-reveal-cards').fill('AP');await page.locator('#players-reveal-form [type=submit]').click();await page.locator('#players-reveal-dialog').waitFor({state:'hidden'});
  const revealed=await page.evaluate(id=>theibsPlayersUI.getArchivedHand(id),hand.multiway.handId);
  assert.deepEqual(revealed.state.players[0].shownCards,['Ac']);assert.deepEqual(revealed.decisions,archived.decisions);assert.equal(revealed.multiway.events.length,archived.multiway.events.length+1);
  await page.evaluate(({id,seat})=>theibsPlayersUI.openArchivedReveal(id,seat),{id:hand.multiway.handId,seat:0});
  const proposal=await page.evaluate(()=>{const ctx=theibsPlayersUI.voiceRevealContext();return theibsPlayersUI.commitVoiceReveal({cards:['Ad','Kc'],expectedToken:ctx.token,originEventId:'synthetic-final-1'});});
  assert.equal(proposal.reviewRequired,true);assert.equal(await page.locator('#players-reveal-cards').inputValue(),'AP AO KP');
  assert.deepEqual((await page.evaluate(id=>theibsPlayersUI.getArchivedHand(id),hand.multiway.handId)).state.players[0].shownCards,['Ac'],'voice draft never saves automatically');
  // A new owner must also clear any open editor from the previous account.
  await page.evaluate(()=>theibsPlayersUI.init('b'.repeat(64)));assert.equal((await page.evaluate(()=>theibsPlayersUI.list())).length,0);
  assert.equal(await page.locator('#players-reveal-dialog').evaluate(node=>node.open),false);
  assert.equal(await page.locator('#players-reveal-cards').inputValue(),'');
  assert.equal(await page.locator('#players-reveal-player').textContent(),'');
  assert.equal(await page.evaluate(()=>theibsPlayersUI.voiceRevealContext()),null);
  await page.evaluate(()=>theibsPlayersUI.init('a'.repeat(64)));assert.equal((await page.evaluate(()=>theibsPlayersUI.list())).length,2);
  const revision=await page.evaluate(()=>theibsPlayersUI.getStore().revision);
  await page.evaluate(()=>{
    window.__originalIDBPut=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){
      if(this.name==='heads'){this.transaction.abort();throw new DOMException('Storage quota test','QuotaExceededError');}
      return window.__originalIDBPut.apply(this,args);
    };
  });
  await page.locator('#players-new-name').fill('Must not be silently saved');await page.locator('#players-create button').click();
  await page.waitForFunction(()=>document.querySelector('#players-message')?.textContent.includes('Durable player storage is full'));
  assert.equal(await page.evaluate(()=>theibsPlayersUI.getStore().revision),revision);assert.equal((await page.evaluate(()=>theibsPlayersUI.list())).length,2);
  assert.match(await page.locator('#players-message').innerText(),/Durable player storage is full/);
  await page.evaluate(()=>{IDBObjectStore.prototype.put=window.__originalIDBPut;});
  await page.evaluate(()=>theibsPlayersUI.init('a'.repeat(64),true));
  assert.equal(await page.evaluate(()=>theibsPlayersUI.getStore().revision),revision,'an aborted save is absent after durable reload');
  // Undo and an identical new action are distinct confirmed events. The old
  // analysis must not attach to the replacement action simply by matching text.
  let repeated=mw.start({...initial.config,heroPosition:'SB'});
  const originalDecision={handId:repeated.multiway.handId,revisionKey:repeated.state.revisionKey,
    action:'CALL',recordBefore:repeated.multiway,committedEventId:'qa-old-call',analysis:{analysisId:'undone',ev:{candidates:[]}}};
  repeated=mw.step(repeated.multiway,{type:'ACT',actor:0,action:'CALL',eventId:'qa-old-call'});
  repeated=mw.undo(repeated.multiway);
  const replacementDecision={...originalDecision,revisionKey:repeated.state.revisionKey,recordBefore:repeated.multiway,
    committedEventId:'qa-new-call',analysis:{analysisId:'replacement',ev:{candidates:[]}}};
  repeated=mw.step(repeated.multiway,{type:'ACT',actor:0,action:'CALL',eventId:'qa-new-call'});
  repeated=mw.step(repeated.multiway,{type:'ACT',actor:1,action:'FOLD',eventId:'qa-terminal-fold'});
  const repeatedArchive=mw.nextHand(repeated.multiway).archivedHand;
  const reviewIds=await page.evaluate(async({originalDecision,replacementDecision,repeatedArchive})=>{
    await theibsPlayersUI.beginHand(originalDecision.recordBefore);
    for(const decision of [originalDecision,replacementDecision])await theibsPlayersUI.recordDecision(decision.handId,decision);
    await theibsPlayersUI.archiveHand(repeatedArchive);
    return theibsPlayersUI.getArchivedHand(originalDecision.handId).decisions.map(item=>item.analysis.analysisId);
  },{originalDecision,replacementDecision,repeatedArchive});
  assert.deepEqual(reviewIds,['replacement']);
  await page.locator('#players-all-hands').click();
  assert.equal(await page.locator('.players-hand-list > li').count(),2);
  await page.locator('.players-hand-list > li > details > summary').first().click();
  assert.equal(await page.locator('.players-hand-list > li').first().locator('[data-archive-reveal]').count(),2);
  await page.setViewportSize({width:393,height:852});
  await page.screenshot({path:path.join(out,'all-hands-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.setViewportSize({width:1366,height:900});
  // Two browser tabs share IndexedDB but have independent in-memory stores.
  // A stale write must reload/report the conflict and preserve the first write.
  await page.evaluate(()=>theibsPlayersUI.init('c'.repeat(64)));
  const second=await page.context().newPage();second.on('pageerror',error=>report.errors.push(error.message));
  await second.goto(origin);await second.setContent('<main id="players-workspace" class="players-workspace"></main>');
  for(const name of ['card-model.js','player-profile-model.js','players-storage.js','players-ui.js'])await second.addScriptTag({url:`${origin}/${name}`});
  await second.evaluate(()=>theibsPlayersUI.init('c'.repeat(64)));
  await page.locator('#players-new-name').fill('First tab');await page.locator('#players-create button').click();
  await page.waitForFunction(()=>theibsPlayersUI.list().length===1);
  await second.locator('#players-new-name').fill('Second tab');await second.locator('#players-create button').click();
  await second.waitForFunction(()=>document.querySelector('#players-message')?.textContent.includes('another tab'));
  assert.match(await second.locator('#players-message').innerText(),/another tab/);
  assert.deepEqual(await second.evaluate(()=>theibsPlayersUI.list().map(player=>player.nickname)),['First tab']);
  await second.locator('#players-new-name').fill('Second tab');await second.locator('#players-create button').click();
  await second.waitForFunction(()=>theibsPlayersUI.list().length===2);
  assert.deepEqual((await second.evaluate(()=>theibsPlayersUI.list().map(player=>player.nickname))).sort(),['First tab','Second tab']);
  await second.close();
  assert.deepEqual(report.errors,[]);
  report.checks=['Duplicate nicknames retain separate IDs','Notes do not produce observations','Repeated updates do not double count','Original profile snapshot remains frozen','Decision storage is idempotent','Posterior intervals visible','Full ledger archived','Duplicate shown cards rejected','Later shown cards preserve original EV snapshot','Voice writes only a reviewable draft','Owner namespaces isolated','Aborted durable transaction leaves data and revisions unchanged after reload'];
  report.checks.push('Caller mutations cannot alter an original decision snapshot or queued archive','Owner switch clears the previous account editor',
    'Undo and identical replacement retain only the new confirmed decision','Stale second-tab writes preserve existing data and require review');
  report.checks.push('Global recorded hands expose each player card editor without horizontal overflow');
  report.status='PASS';
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;}
finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await require('../src/analysis-worker').close();console.log(JSON.stringify(report,null,2));}})();
