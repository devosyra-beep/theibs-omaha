'use strict';
// Scoped capture/reload fixture. All writes use a temporary server workspace
// and a fresh browser context. It never opens the user's active tab or data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-capture-qa-'));
Object.assign(process.env,{THEIBS_AUTH_REQUIRED:'false',THEIBS_MULTIWAY_LLM_PROVIDER:'none',THEIBS_LLM_PROVIDER:'none',THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json')});
const {server}=require('../server');
(async()=>{
  let browser;const report={scope:'ISOLATED_CANONICAL_LEDGER_CAPTURE_AND_CRASH_RECOVERY',pureHttpRequests:0,checks:[]};
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({channel:'msedge',headless:true});
    const page=await browser.newPage({viewport:{width:1366,height:768}}),origin=`http://127.0.0.1:${server.address().port}`;
    const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.route(/\/api\/multiway\/(start|state|step|undo|review-action|correct-action|adjust-stack|correct-button|restart-hand|next-hand|observations|preview-sequence|batch)$/ ,async route=>{
      report.pureHttpRequests++;await new Promise(resolve=>setTimeout(resolve,450));await route.continue();
    });
    await page.goto(origin+'/app');await page.evaluate(()=>theibsApp.ready);
    await page.keyboard.press('F2');await page.locator('#mw-player-count').selectOption('4');await page.locator('#mw-hero-position').selectOption('BB');
    await page.locator('#mw-start').click();
    const idle=()=>page.evaluate(async()=>{await theibsKeyboard.queue.idle();while(theibsApp.getState().multiwayBusy || theibsKeyboard.getState().actionPending)await new Promise(resolve=>setTimeout(resolve,10));});
    await idle();await page.waitForFunction(()=>theibsApp.getState().multiway?.enabled);
    assert.equal(await page.evaluate(()=>theibsApp.flushSave()),true);
    const base=await page.evaluate(()=>theibsApp.getState().multiway);
    const failWorkspace=route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({reason:'Isolated crash fixture keeps the remote draft unchanged.'})}):route.continue();
    await page.route('**/api/workspace',failWorkspace);
    await page.locator('#analyze-workspace .table-surface').evaluate(node=>{node.tabIndex=0;node.focus();});
    await page.evaluate(()=>{
      window.__capturePut=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){if(this.name==='heads'){this.transaction.abort();throw new DOMException('Isolated quota failure','QuotaExceededError');}return window.__capturePut.apply(this,args);};
    });
    await page.keyboard.press('g');await idle();
    assert.deepEqual(await page.evaluate(()=>theibsApp.getState().multiway),base,'a failed durable write cannot advance the visible actor or ledger');
    assert.equal(await page.evaluate(()=>theibsPlayersUI.ledgerCheckpoint(theibsApp.getState().multiway.handId).multiway.events.length),0);
    assert.equal(await page.evaluate(()=>theibsPlayersUI.getStore().hands[theibsApp.getState().multiway.handId].observations.length),0);
    await page.evaluate(()=>{IDBObjectStore.prototype.put=window.__capturePut;});
    report.checks.push('IDB quota abort leaves actor, ledger, checkpoint and observations unchanged; retry remains the same player');
    const durations=[];
    for(let index=0;index<2;index++){
      const started=performance.now();await page.keyboard.press('g');await idle();durations.push(performance.now()-started);
    }
    const captured=await page.evaluate(()=>({record:theibsApp.getState().multiway,state:theibsApp.getState().multiwayState,
      checkpoint:theibsPlayersUI.ledgerCheckpoint(theibsApp.getState().multiway.handId),metrics:theibsMetrics}));
    assert.equal(captured.record.events.length,2);assert.equal(captured.state.actor,0);
    assert.deepEqual(captured.checkpoint.multiway,captured.record);assert.equal(captured.checkpoint.sourceRevisionKey,captured.state.revisionKey);
    assert.equal(JSON.parse(fs.readFileSync(process.env.THEIBS_WORKSPACE_PATH,'utf8')).workspace.multiway.events.length,base.events.length);
    await page.reload();await page.evaluate(()=>theibsApp.ready);
    const recovered=await page.evaluate(()=>theibsApp.getState());
    assert.equal(recovered.multiwayState.revisionKey,captured.state.revisionKey);assert.deepEqual(recovered.multiway.events,captured.record.events);
    assert.equal(await page.evaluate(()=>theibsPlayersUI.getStore().hands[theibsApp.getState().multiway.handId].observations.length),2);
    report.checks.push('Crash before remote debounce recovers the exact newer durable append and counts once');
    await page.unroute('**/api/workspace',failWorkspace);assert.equal(await page.evaluate(()=>theibsApp.flushSave()),true);
    await page.route('**/api/workspace',failWorkspace);
    const corrected=await page.evaluate(async()=>{
      const current=theibsApp.getState();try{await theibsApp.keyboard.correctAction({eventId:current.multiway.events[0].eventId,actor:2,action:'FOLD',expectedRevisionKey:current.multiwayState.revisionKey});}catch(error){if(!error.message.includes('saving is pending'))throw error;}
      return {record:theibsApp.getState().multiway,checkpoint:theibsPlayersUI.ledgerCheckpoint(current.multiway.handId)};
    });
    assert.equal(corrected.record.events[0].action,'FOLD');assert.notEqual(corrected.checkpoint.branchId,captured.checkpoint.branchId);
    await page.reload();await page.evaluate(()=>theibsApp.ready);
    assert.equal(await page.evaluate(()=>theibsApp.getState().saveBlocked),true);
    assert.deepEqual(await page.evaluate(id=>theibsPlayersUI.ledgerCheckpoint(id),base.handId),corrected.checkpoint);
    report.checks.push('Older remote correction branch cannot overwrite or reactivate the saved corrected ledger');
    // Restore the deliberate correction in this temporary service fixture,
    // then interrupt the next-hand ACK before its remote workspace write.
    const currentDraft=JSON.parse(fs.readFileSync(process.env.THEIBS_WORKSPACE_PATH,'utf8'));
    currentDraft.workspace.multiway=corrected.record;
    currentDraft.workspace.multiwayCheckpoint={version:corrected.checkpoint.version,ownerKey:corrected.checkpoint.ownerKey,handId:corrected.record.handId,branchId:corrected.checkpoint.branchId,revisionKey:corrected.checkpoint.revisionKey};
    fs.writeFileSync(process.env.THEIBS_WORKSPACE_PATH,JSON.stringify(currentDraft));
    await page.reload();await page.evaluate(()=>theibsApp.ready);
    await page.locator('#analyze-workspace .table-surface').evaluate(node=>{node.tabIndex=0;node.focus();});
    for(let n=0;n<3 && await page.evaluate(()=>theibsApp.getState().multiwayState.phase==='BETTING');n++){await page.keyboard.press('f');await idle();}
    assert.equal(await page.evaluate(()=>theibsApp.getState().multiwayState.phase),'FINISHED');
    await page.waitForFunction(()=>document.querySelector('#mw-completion-dialog').open);await page.keyboard.press('Enter');await idle();
    const continued=await page.evaluate(()=>({record:theibsApp.getState().multiway,state:theibsApp.getState().multiwayState,archives:theibsPlayersUI.archivedHands().length}));
    assert.notEqual(continued.record.handId,base.handId);assert.equal(continued.record.events.length,0);assert.equal(continued.archives,1);
    await page.reload();await page.evaluate(()=>theibsApp.ready);
    assert.equal(await page.evaluate(()=>theibsApp.getState().multiwayState.revisionKey),continued.state.revisionKey);
    assert.equal(await page.evaluate(()=>theibsPlayersUI.archivedHands().length),1);
    report.checks.push('Crash after durable next-hand ACK follows the verified transition once, preserving balances, blinds and one archive');
    report.actionElapsedMs=durations;report.workerRequests=captured.metrics.ledgerRequests;report.actionStages=captured.metrics.capturedActions;
    assert.equal(report.pureHttpRequests,0,'capture/review/recovery never wait for the injected 450ms pure-ledger HTTP delay');assert.deepEqual(errors,[]);
    report.checks.push('No pure-ledger HTTP roundtrips; authenticated workspace persistence remains on the service');
    report.status='PASS';console.log(JSON.stringify(report,null,2));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
