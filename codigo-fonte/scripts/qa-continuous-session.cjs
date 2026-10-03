'use strict';
// Short integration smoke only. Every write uses a fresh temporary workspace.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-continuous-smoke-'));
process.env.THEIBS_WORKSPACE_PATH=path.join(temp,'workspace.json');
process.env.THEIBS_DATA_PATH=path.join(temp,'events.jsonl');
process.env.THEIBS_LLM_CONFIG_PATH=path.join(temp,'llm.json');process.env.THEIBS_LLM_PROVIDER='none';
const output=path.resolve(__dirname,'../../validacao/continuous-session-smoke');fs.mkdirSync(output,{recursive:true});
const {server}=require('../server');
(async()=>{
  const visualOnly=Boolean(process.env.THEIBS_QA_VISUAL_ONLY);
  const report={status:'RUNNING',source:'Isolated local Edge; physical action keys; scoped flow, storage and responsive picker checks',visualOnly,observeOnly:Boolean(process.env.THEIBS_QA_LAYOUT_OBSERVE),checks:[],errors:[]};
  let browser,page;
  const state=()=>page.evaluate(()=>theibsApp.getState());
  const keys=()=>page.evaluate(()=>theibsKeyboard.getState());
  const settle=async()=>{await page.evaluate(()=>theibsKeyboard.queue.idle());await page.waitForFunction(()=>!theibsApp.getState().multiwayBusy&&!theibsKeyboard.getState().actionPending);await page.waitForTimeout(100);};
  const capture=()=>page.locator('#analyze-workspace .table-surface').evaluate(node=>{node.tabIndex=0;node.focus({preventScroll:true});});
  const geometry=()=>page.evaluate(()=>{
    const measure=selector=>{const node=document.querySelector(selector);if(!node)return null;const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,bottom:rect.bottom,right:rect.right,fontSize:style.fontSize,lineHeight:style.lineHeight,visible:rect.width>0&&rect.height>0&&rect.y>=0&&rect.bottom<=innerHeight&&rect.right<=innerWidth};};
    const cardGroups=['#board-slots','#hero-slots'].map(selector=>({selector,node:document.querySelector(selector)})).filter(item=>item.node);
    const overlaps=[];for(const seat of document.querySelectorAll('#analysis-seats .multiway-seat'))for(const group of cardGroups){const a=seat.getBoundingClientRect(),b=group.node.getBoundingClientRect();if(a.width&&b.width&&Math.min(a.right,b.right)>Math.max(a.left,b.left)&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top))overlaps.push({seat:seat.dataset.multiwayPlayer,group:group.selector});}
    return {viewport:{width:innerWidth,height:innerHeight},body:{scrollHeight:document.body.scrollHeight,clientHeight:document.body.clientHeight},document:{scrollHeight:document.documentElement.scrollHeight,clientHeight:document.documentElement.clientHeight},table:measure('#analyze-workspace .table-surface'),contextRail:measure('#analyze-workspace .context-rail'),keyboard:measure('.card-keyboard'),footer:measure('#analyze-workspace .mw-secondary-footer'),opponentName:measure('#analysis-seats .opponent-name'),opponentStack:measure('#analysis-seats .mw-seat-stack b'),opponentPaid:measure('#analysis-seats .mw-seat-paid'),heroCard:measure('#hero-slots .playing-card'),boardCard:measure('#board-slots .playing-card'),pot:measure('#table-pot'),equity:measure('#hero-equity'),ev:measure('#mw-decision-ev'),evValue:measure('#mw-decision-ev .mw-ev-option>b'),actionControls:measure('#mw-action-stage'),overlaps};
  });
  const check=async(name,run)=>{await run();report.checks.push(name);console.log('PASS',name);};
  const pickerGeometry=()=>page.evaluate(()=>{
    const box=node=>{if(!node)return null;const r=node.getBoundingClientRect(),s=getComputedStyle(node);return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,display:s.display,background:s.backgroundColor,position:s.position,visible:s.display!=='none'&&r.width>0&&r.height>0,inside:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1};};
    const panel=document.querySelector('.card-picker'),panelBox=box(panel),critical=['#analysis-seats .multiway-seat','#hero-slots .playing-card','#board-slots .playing-card','.hero-seat','#mw-action-stage','#mw-decision-ev','.insight-panel','.keyboard-heading'];
    const obscured=[];
    if(panelBox?.visible)for(const selector of critical)for(const node of document.querySelectorAll(selector)){
      const r=node.getBoundingClientRect(),s=getComputedStyle(node);if(!r.width||!r.height||s.display==='none')continue;
      const left=Math.max(r.left,panelBox.x),right=Math.min(r.right,panelBox.right),top=Math.max(r.top,panelBox.y),bottom=Math.min(r.bottom,panelBox.bottom);
      if(right<=left||bottom<=top)continue;
      const points=[[.5,.5],[.2,.2],[.8,.2],[.2,.8],[.8,.8]];
      const hit=points.some(([px,py])=>{const stack=document.elementsFromPoint(left+(right-left)*px,top+(bottom-top)*py),pickerIndex=stack.findIndex(item=>item===panel||panel.contains(item)),targetIndex=stack.findIndex(item=>item===node||node.contains(item));return pickerIndex>=0&&targetIndex>=0&&pickerIndex<targetIndex;});
      if(hit)obscured.push({selector,text:(node.textContent||'').trim().slice(0,50),intersection:{left,top,width:right-left,height:bottom-top}});
    }
    const deck=[...document.querySelectorAll('#card-picker [data-picker-rank],#card-picker [data-picker-suit]')].map(box);
    const tableContent=[...document.querySelectorAll('#analysis-seats .multiway-seat,#hero-slots .playing-card,#board-slots .playing-card,.hero-seat,.table-pot-summary')].map(node=>({label:node.className,text:(node.textContent||'').trim().slice(0,40),...box(node)})).filter(item=>item.visible),tableContentOverlaps=[];
    for(let i=0;i<tableContent.length;i++)for(let j=i+1;j<tableContent.length;j++){const a=tableContent[i],b=tableContent[j],width=Math.min(a.right,b.right)-Math.max(a.x,b.x),height=Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y);if(width>1&&height>1)tableContentOverlaps.push({a:a.text,b:b.text,width,height});}
    const children=selector=>[...(document.querySelector(selector)?.children||[])].map(node=>({tag:node.tagName,class:node.className,...box(node)})).filter(item=>item.visible);
    return {viewport:{width:innerWidth,height:innerHeight},scrollHeight:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth,picker:panelBox,keyboard:box(document.querySelector('.card-keyboard')),table:box(document.querySelector('.table-surface')),controls:box(document.querySelector('#multiway-controls')),rail:box(document.querySelector('#analyze-workspace .context-rail')),actions:box(document.querySelector('#mw-action-stage')),ev:box(document.querySelector('#mw-decision-ev')),evRows:children('#mw-decision-ev'),equityRows:children('#analyze-workspace .insight-panel'),keyboardRows:children('.card-keyboard'),footer:box(document.querySelector('.mw-secondary-footer')),rankCount:document.querySelectorAll('#card-picker [data-picker-rank]').length,suitCount:document.querySelectorAll('#card-picker [data-picker-suit]').length,deckOutside:deck.filter(item=>!item.inside).length,tableContentOutside:tableContent.filter(item=>!item.inside),tableContentOverlaps,obscured};
  });
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({channel:'msedge',headless:true});
    page=await browser.newPage({viewport:{width:1366,height:768}});
    page.on('pageerror',error=>report.errors.push(error.stack));
    await page.goto(`http://127.0.0.1:${server.address().port}/app`);await page.evaluate(()=>theibsApp.ready);
    if(!visualOnly){
    await page.keyboard.press('F2');await page.locator('#mw-player-count').selectOption('4');
    await page.locator('#mw-hero-position').selectOption('BB');
    await page.locator('#mw-small-blind').fill('0.5');await page.locator('#mw-big-blind').fill('1');await page.locator('#mw-starting-stack').fill('100');
    await page.locator('#mw-start').focus();await page.keyboard.press('Enter');await settle();await capture();
    await check('Current-street arrows and historical H correct the selected record; partial cards and future board stay independent',async()=>{
      let current=await state();assert.equal(current.multiwayState.actor,2);
      await page.keyboard.type('A');await page.keyboard.press('h');await page.waitForFunction(()=>document.querySelector('#keyboard-amount-dialog').open);
      assert.equal((await keys()).rank,'A');await page.locator('#keyboard-amount').fill('3');await page.keyboard.press('Enter');await settle();
      assert.equal((await state()).multiwayState.actor,3);assert.equal((await keys()).rank,'A');
      await page.keyboard.type('OK');await page.keyboard.press('g');await settle();assert.equal((await keys()).rank,'K');await page.keyboard.type('P');
      await page.keyboard.press('g');await settle();current=await state();assert.equal(current.multiwayState.actor,1);
      const events=current.multiway.events.filter(event=>event.type==='ACT');assert.equal(events.length,3);
      for(const actor of [0,3,2,2]){await page.keyboard.press('ArrowUp');assert.equal((await keys()).selectedPlayerId,actor);assert.equal((await state()).multiwayState.actor,1);}
      assert.equal((await keys()).selectedActionId,events[0].eventId);
      await page.keyboard.press('h');await page.waitForFunction(()=>document.querySelector('#keyboard-amount-dialog').open);
      assert.ok((await page.locator('#keyboard-amount-title').innerText()).includes(current.multiwayState.players.find(player=>player.id===2).name));
      assert.equal(await page.locator('#keyboard-amount').inputValue(),'3');await page.locator('#keyboard-amount').fill('2.5');
      await page.keyboard.press('Enter');await settle();current=await state();
      assert.equal(current.multiway.events.filter(event=>event.type==='ACT').length,3);assert.equal(current.multiway.events[0].to,2.5);
      assert.equal(current.multiway.events[0].eventId,events[0].eventId);assert.equal(current.multiwayState.actor,1);
      await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');
      assert.equal((await keys()).selectedActionId,null);assert.equal((await keys()).selectedPlayerId,1);
      await page.keyboard.press('Control+2');await page.keyboard.type('2E');
      assert.equal(await page.locator('#board-slots [data-slot="5"] .face-rank').textContent(),'2');
      assert.match(await page.locator('#board-slots [data-slot="5"]').getAttribute('aria-label'),/draft/i);
      assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.slots[5]),null);assert.deepEqual((await state()).multiwayState.board,[]);
      await page.keyboard.press('Control+2');await page.keyboard.press('Delete');assert.equal(await page.locator('#board-slots [data-slot="5"] .face-rank').count(),0);
      await page.keyboard.type('2E');
      await page.keyboard.type('3C4O');
      assert.deepEqual((await keys()).stagedBoard.slice(0,3),['2E','3C','4O']);assert.deepEqual((await state()).multiwayState.board,[]);
      assert.equal((await keys()).boardReady,true);assert.equal((await state()).multiwayState.actor,1);
      assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.slots.slice(0,2)),['AO','KP']);
      await page.keyboard.press('m');assert.equal((await keys()).cardTarget,'hero');
    });
    let finishedId,nextId,nextSnapshot;
    await check('Closing, numeric showdown winner and held Enter start one next hand with one payout and one set of blinds',async()=>{
      const keyboardTop=await page.locator('.card-keyboard').evaluate(node=>node.getBoundingClientRect().top);
      await page.keyboard.press('f');await settle();
      await page.waitForFunction(()=>theibsApp.getState().multiwayState.street==='FLOP');
      report.layoutTransitionDelta=(await page.locator('.card-keyboard').evaluate(node=>node.getBoundingClientRect().top))-keyboardTop;
      assert.equal(await page.locator('#board-slots .keyboard-board-draft-label').count(),0);
      assert.equal((await keys()).selectedActionId,null);await page.keyboard.press('ArrowUp');assert.equal((await keys()).selectedActionId,null);
      await page.keyboard.press('f');await settle();await page.keyboard.press('f');await settle();
      const finished=await state();finishedId=finished.multiway.handId;assert.equal(finished.multiwayState.phase,'FINISHED');
      assert.equal(finished.multiwayState.result.awards.reduce((sum,item)=>sum+item.amount,0),8.5);
      await page.waitForFunction(()=>document.querySelector('#mw-completion-dialog').open);
      await page.keyboard.down('Enter');
      await page.waitForFunction(id=>theibsApp.getState().multiway.handId!==id,finishedId);
      await page.keyboard.down('Enter');await page.waitForTimeout(100);await page.keyboard.up('Enter');await settle();
      const next=await state();nextId=next.multiway.handId;nextSnapshot={multiway:next.multiway,state:next.multiwayState};
      assert.equal(await page.locator('#board-slots .face-rank').count(),0);assert.equal(await page.locator('#board-slots .keyboard-board-draft-label').count(),0);
      assert.equal(next.multiway.handNumber,2);assert.equal(next.multiway.events.length,0);assert.equal(next.multiwayState.pot,1.5);
      assert.equal(next.multiwayState.log.filter(item=>['SB','BB'].includes(item.action)).length,2);
      assert.equal(next.multiwayState.players.reduce((sum,player)=>sum+player.stack,0)+next.multiwayState.pot,400);
      assert.equal((await page.evaluate(()=>theibsPlayersUI.archivedHands())).filter(hand=>hand.multiway.handId===finishedId).length,1);
      // One short SHOWDOWN fixture exercises numeric selection through the real
      // dialog. Setup uses the public app adapter; all actions/results use keys.
      await page.evaluate(()=>theibsApp.keyboard.startTracking({variant:'PLO5_HIGH',playerCount:2,heroPosition:'BTN',startingStack:10,smallBlind:.5,bigBlind:1,heroCards:[]}));
      await settle();await capture();await page.keyboard.press('Control+2');await page.keyboard.type('2E3C4O5P6E');await page.keyboard.press('m');
      for(let action=0;action<8;action++){
        await page.waitForFunction(()=>['BETTING','SHOWDOWN'].includes(theibsApp.getState().multiwayState.phase));
        if((await state()).multiwayState.phase==='SHOWDOWN')break;
        await page.keyboard.press('g');await settle();
      }
      await page.waitForFunction(()=>theibsApp.getState().multiwayState.phase==='SHOWDOWN'&&document.querySelector('#mw-completion-dialog').open);
      const showdown=await state(),showdownId=showdown.multiway.handId,hero=showdown.multiwayState.players.find(player=>player.hero),opponent=showdown.multiwayState.players.find(player=>!player.hero);
      const heroChoice=page.locator(`[data-mw-pot="0"][value="${hero.id}"]`),opponentChoice=page.locator(`[data-mw-pot="0"][value="${opponent.id}"]`);
      await page.keyboard.press('0');assert.equal(await heroChoice.isChecked(),true);await page.keyboard.press('0');assert.equal(await heroChoice.isChecked(),false);
      await page.keyboard.down('1');await page.keyboard.down('1');await page.keyboard.up('1');assert.equal(await opponentChoice.isChecked(),true);
      await page.keyboard.press('h');assert.equal(await heroChoice.isChecked(),false);assert.equal(await opponentChoice.isChecked(),true);
      await page.locator('#mw-result-rake').evaluate(node=>{node.closest('details').open=true;node.focus();});
      await page.keyboard.press('Control+a');await page.keyboard.type('1');assert.equal(await opponentChoice.isChecked(),true);
      await page.keyboard.press('Control+a');await page.keyboard.type('0');await opponentChoice.focus();
      await page.keyboard.press('Enter');await page.waitForFunction(id=>theibsApp.getState().multiway.handId!==id,showdownId);await settle();
      const afterNumbers=await state();nextId=afterNumbers.multiway.handId;nextSnapshot={multiway:afterNumbers.multiway,state:afterNumbers.multiwayState};
      assert.equal(afterNumbers.multiway.handNumber,2);assert.equal(afterNumbers.multiway.events.length,0);assert.equal(afterNumbers.multiwayState.pot,1.5);
      assert.equal(afterNumbers.multiwayState.players.reduce((sum,player)=>sum+player.stack,0)+afterNumbers.multiwayState.pot,20);
      const result=await page.evaluate(id=>theibsPlayersUI.archivedHands().filter(hand=>hand.multiway.handId===id),showdownId);
      assert.equal(result.length,1);assert.deepEqual(result[0].state.result.awards,[{player:opponent.id,amount:2}]);
    });
    await check('Reload restores the same hand, balances and one archived result',async()=>{
      await page.evaluate(()=>theibsApp.flushSave());await page.reload();await page.evaluate(()=>theibsApp.ready);
      const restored=await state();assert.equal(restored.multiway.handId,nextId);assert.deepEqual(restored.multiway,nextSnapshot.multiway);
      assert.deepEqual(restored.multiwayState.players,nextSnapshot.state.players);assert.equal(restored.multiwayState.pot,1.5);
      assert.equal((await page.evaluate(()=>theibsPlayersUI.archivedHands())).filter(hand=>hand.multiway.handId===finishedId).length,1);
    });
    await check('One interval filter updates both chart instances, counts and hand lists without changing the active table',async()=>{
      const handBefore=(await state()).multiway;
      // Fixture boundary dates are supplied through the component's public data adapter.
      // They do not rewrite persisted history or the active table.
      await page.evaluate(()=>{
        const real=theibsPlayersUI.archivedHands().find(hand=>hand.state.phase==='FINISHED');
        const older=structuredClone(real);older.multiway.handId=crypto.randomUUID();older.archivedAt=new Date(Date.now()-40*86400000).toISOString();
        TheibsMultiwayPerformance.init({getArchivedHands:()=>[real,older]});
        theibsApp.showView('history');document.querySelector('#multiway-performance').open=true;
      });
      await page.locator('#multiway-performance [data-performance-period]').selectOption('all');
      const read=()=>page.evaluate(()=>[...document.querySelectorAll('.mw-performance')].map(node=>({period:node.querySelector('[data-performance-period]').value,count:node.querySelectorAll('[data-performance-record]').length,dots:node.querySelectorAll('[data-performance-chart] circle').length,counts:node.querySelector('[data-performance-counts]').textContent})));
      let views=await read();assert.equal(views.length,2);assert.ok(views.every(view=>view.period==='all'&&view.count===2&&view.dots===2));assert.equal(views[0].counts,views[1].counts);
      await page.locator('#multiway-performance [data-performance-period]').selectOption('today');views=await read();
      assert.ok(views.every(view=>view.period==='today'&&view.count===1&&view.dots===1));assert.notEqual(views[0].counts,'');assert.equal(views[0].counts,views[1].counts);
      assert.deepEqual((await state()).multiway,handBefore);
      await page.evaluate(()=>theibsApp.showView('analyze'));
    });
    if(!process.env.THEIBS_QA_LAYOUT_OBSERVE)await check('Legacy player library migrates with full localStorage and persists in IndexedDB after reload',async()=>{
      const source=await page.evaluate(async()=>{const owner=theibsPlayersUI.getOwnerKey(),opened=await TheibsPlayersStorage.createStorage().openAsync(owner);return {owner,library:opened.library,backend:opened.backend};});
      assert.equal(source.backend,'indexeddb','Fresh UI saves must use IndexedDB');
      const context=await browser.newContext({viewport:{width:1020,height:760}}),migrationPage=await context.newPage();
      const migrationErrors=[];migrationPage.on('pageerror',error=>migrationErrors.push(error.message));
      try{
        await migrationPage.addInitScript(({owner,library})=>{
          const set=Storage.prototype.setItem,key=`theibs.multiway.players.v1:${owner}`;
          if(!sessionStorage.getItem('theibs-migration-seeded')){set.call(localStorage,key,JSON.stringify(library));set.call(sessionStorage,'theibs-migration-seeded','1');}
          window.__qaQuotaWrites=0;
          Storage.prototype.setItem=function(key,value){if(this===localStorage){window.__qaQuotaWrites++;throw new DOMException('Synthetic full localStorage for isolated migration QA','QuotaExceededError');}return set.call(this,key,value);};
          try{localStorage.setItem('__qa_probe','1');}catch(error){window.__qaQuotaVerified=error.name==='QuotaExceededError';}
        },source);
        await migrationPage.goto(`http://127.0.0.1:${server.address().port}/app`);await migrationPage.evaluate(()=>theibsApp.ready);
        const migrated=await migrationPage.evaluate(async()=>{const owner=theibsPlayersUI.getOwnerKey(),opened=await TheibsPlayersStorage.createStorage().openAsync(owner);return {owner,library:opened.library,backend:opened.backend,ready:theibsPlayersUI.ready(),legacy:localStorage.getItem(`theibs.multiway.players.v1:${owner}`),quotaVerified:window.__qaQuotaVerified,quotaWrites:window.__qaQuotaWrites};});
        assert.equal(migrated.owner,source.owner);assert.equal(migrated.ready,true);assert.equal(migrated.backend,'indexeddb');assert.equal(migrated.quotaVerified,true);
        assert.deepEqual(migrated.library,source.library,'Migration must preserve every player/hand/archive/decision');assert.equal(migrated.legacy,JSON.stringify(source.library),'Keep the original legacy recovery copy');
        const saved=await migrationPage.evaluate(async()=>{const adapter=TheibsPlayersStorage.createStorage(),opened=await adapter.openAsync(theibsPlayersUI.getOwnerKey()),playerId=Object.keys(opened.library.store.players)[0],nickname=`${opened.library.store.players[playerId].nickname} QA`;
          TheibsPlayerProfiles.renamePlayer(opened.library.store,playerId,nickname);const result=await adapter.commitAsync(opened.library,{expectedRevision:opened.revision,dirty:{players:[playerId]}});return {playerId,nickname,backend:result.backend};});
        assert.equal(saved.backend,'indexeddb');await migrationPage.reload();await migrationPage.evaluate(()=>theibsApp.ready);
        const restored=await migrationPage.evaluate(({playerId})=>({player:theibsPlayersUI.byId(playerId),archive:theibsPlayersUI.archivedHands(),legacy:localStorage.getItem(`theibs.multiway.players.v1:${theibsPlayersUI.getOwnerKey()}`),quotaVerified:window.__qaQuotaVerified}),saved);
        assert.equal(restored.player.nickname,saved.nickname);assert.equal(restored.quotaVerified,true);assert.equal(restored.legacy,JSON.stringify(source.library));assert.equal(restored.archive.length,Object.keys(source.library.archive).length);assert.deepEqual(migrationErrors,[]);
        report.storageMigration={backend:migrated.backend,quotaSynthetic:true,quotaVerified:migrated.quotaVerified,quotaWrites:migrated.quotaWrites,legacyPreserved:true,players:Object.keys(source.library.store.players).length,hands:Object.keys(source.library.store.hands).length,archive:restored.archive.length,reloadVerified:true};
      }finally{await context.close();}
    });
    }
    assert.deepEqual(report.errors,[]);
    report.geometry=await geometry();
    await page.screenshot({path:path.join(output,'local-1366.png'),fullPage:false});
    // Visual fixture only: use the same four-seat layout with real cards and a
    // real Hero decision. This is not an additional simulation/test suite.
    await page.evaluate(()=>{
      TheibsMultiwayPerformance.init({getArchivedHands:()=>theibsPlayersUI.archivedHands()});TheibsMultiwayPerformance.setFilter({period:'session'});
      return theibsApp.keyboard.startTracking({variant:'PLO5_HIGH',playerCount:4,heroPosition:'BTN',startingStack:100,smallBlind:.5,bigBlind:1,heroCards:[]});
    });
    await settle();await capture();await page.keyboard.press('Control+2');await page.keyboard.type('2E3C4O');await page.keyboard.press('m');
    for(let action=0;action<4;action++){await page.keyboard.press('g');await settle();}
    await page.waitForFunction(()=>theibsApp.getState().multiwayState.street==='FLOP');
    await page.keyboard.press('h');await page.waitForFunction(()=>document.querySelector('#keyboard-amount-dialog').open);await page.locator('#keyboard-amount').fill('2');await page.keyboard.press('Enter');await settle();
    await page.keyboard.press('g');await settle();await page.keyboard.press('g');await settle();
    await page.keyboard.press('m');await page.keyboard.type('AOKPQEJCDO');
    await page.waitForFunction(()=>{const state=theibsApp.getState();return !state.analysisBusy&&state.lastAnalysis?.data?.status==='OK'&&state.lastAnalysis.data.observedState?.revisionKey===state.multiwayState.revisionKey&&Number.isFinite(state.lastAnalysis.data.equity?.equity)&&document.querySelector('#mw-decision-ev .mw-ev-option>b');},{},{timeout:45000});
    await page.evaluate(()=>scrollTo(0,0));report.decisionGeometry=await geometry();
    report.decision=await page.evaluate(()=>{const state=theibsApp.getState();return {street:state.multiwayState.street,heroTurn:state.multiwayState.actor===state.multiwayState.heroId,analysisStage:state.lastAnalysis.data.analysisStage,equity:state.lastAnalysis.data.equity.equity,revisionMatches:state.lastAnalysis.data.observedState?.revisionKey===state.multiwayState.revisionKey,options:[...document.querySelectorAll('#mw-decision-ev .mw-ev-option')].map(node=>node.innerText)};});
    report.decisionLabels=await page.evaluate(()=>{const host=document.querySelector('#mw-decision-ev');return {options:[...host.querySelectorAll('.mw-ev-option')].map(node=>node.innerText),badge:host.querySelector('.mw-ev-badge')?.innerText,methods:host.querySelector('.mw-ev-details>summary')?.innerText,historyVisible:!!document.querySelector('#mw-history')?.getBoundingClientRect().height};});
    assert.ok(report.decisionLabels.options.length>0&&report.decisionLabels.options.every(text=>/\bbb\b/.test(text)),'EV units must remain visible');
    assert.ok(report.decisionLabels.options.every(text=>!/(?:Highest estimate|Estimate)/i.test(text)),'Redundant modeled labels must be removed');
    assert.ok(report.decisionLabels.badge&&/Methods & limits/.test(report.decisionLabels.methods),'Global badge and methods must remain');
    assert.equal(report.decisionLabels.historyVisible,false,'Recent actions must be removed from the footer');
    report.decisionFitsViewport=report.decisionGeometry.document.scrollHeight<=768&&report.decisionGeometry.ev?.visible&&report.decisionGeometry.actionControls?.visible&&report.decisionGeometry.keyboard?.visible&&report.decisionGeometry.footer?.visible&&!report.decisionGeometry.overlaps.length;
    await page.screenshot({path:path.join(output,'desktop-decision-1366.png'),fullPage:false});
    report.pickerLayouts=[];
    for(const viewport of [{width:1020,height:760},{width:1366,height:768}]){
      await page.setViewportSize(viewport);
      for(const open of [false,true,false]){
        const expanded=await page.locator('#open-card-picker').getAttribute('aria-expanded')==='true';
        if(expanded!==open)await page.locator('#open-card-picker').click();
        await page.evaluate(()=>{scrollTo(0,0);return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
        const layout={open,...await pickerGeometry()};report.pickerLayouts.push(layout);
        const stem=`picker-${viewport.width}-${open?'open':'closed'}`,suffix=process.env.THEIBS_QA_LAYOUT_OBSERVE?(fs.existsSync(path.join(output,`${stem}-baseline.png`))?'-diagnostic':'-baseline'):'';
        await page.screenshot({path:path.join(output,`${stem}${suffix}.png`),fullPage:false});
        console.log('PICKER',JSON.stringify({width:viewport.width,open,scrollHeight:layout.scrollHeight,pickerHeight:layout.picker.height,footerBottom:layout.footer.bottom,covered:layout.obscured.length,tableOverlaps:layout.tableContentOverlaps.length}));
        if(open&&viewport.width===1020&&!process.env.THEIBS_QA_LAYOUT_OBSERVE&&!visualOnly){
          const before=(await state()).multiwayState,selectedPlayer=(await keys()).selectedPlayerId;
          await capture();await page.keyboard.press('Control+3');
          await page.locator('[data-picker-rank="7"]').click();await page.locator('[data-picker-suit="C"]').click();
          assert.equal((await keys()).stagedBoard[3],'7C');
          await page.keyboard.press('Control+3');await page.keyboard.press('Delete');
          await page.keyboard.type('8');await page.locator('[data-picker-suit="P"]').click();assert.equal((await keys()).stagedBoard[3],'8P');
          await page.keyboard.press('Control+3');await page.keyboard.press('Delete');
          await page.locator('[data-picker-rank="9"]').click();await page.keyboard.type('O');assert.equal((await keys()).stagedBoard[3],'9O');
          assert.equal((await state()).multiwayState.actor,before.actor);assert.equal((await keys()).selectedPlayerId,selectedPlayer);assert.deepEqual((await state()).multiwayState.board,before.board);
          await page.keyboard.press('Control+3');await page.keyboard.press('Delete');await page.keyboard.press('m');
        }
      }
    }
    if(!process.env.THEIBS_QA_LAYOUT_OBSERVE&&!visualOnly){
      await page.setViewportSize({width:1020,height:760});
      if(await page.locator('#open-card-picker').getAttribute('aria-expanded')!=='true')await page.locator('#open-card-picker').click();
      await capture();await page.keyboard.press('h');await page.locator('#keyboard-amount').waitFor({state:'visible'});
      await page.evaluate(()=>{scrollTo(0,0);return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
      report.amountDialog=await page.locator('#keyboard-amount-dialog').evaluate(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right,inside:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,scrollHeight:document.documentElement.scrollHeight,focus:document.activeElement?.id,pickerOpen:document.querySelector('#card-picker').open};});
      assert.ok(report.amountDialog.inside&&report.amountDialog.scrollHeight<=760&&report.amountDialog.pickerOpen,'Physical H editor must fit with Cards open');assert.equal(report.amountDialog.focus,'keyboard-amount');
      await page.screenshot({path:path.join(output,'picker-1020-h-dialog.png'),fullPage:false});await page.locator('#keyboard-amount-close').click();
      if(!visualOnly){
        await capture();await page.keyboard.press('g');await settle();
        assert.equal((await state()).multiwayState.phase,'WAIT_BOARD');
        assert.equal(await page.locator('#mw-decision-feedback').isVisible(),true);assert.ok((await page.locator('#mw-decision-feedback').innerText()).trim());
        await page.evaluate(()=>scrollTo(0,0));report.postActionLayout={open:true,...await pickerGeometry()};
        await page.screenshot({path:path.join(output,'picker-1020-after-hero-action.png'),fullPage:false});
      }
      if(!visualOnly){
      await page.evaluate(()=>theibsApp.keyboard.startTracking({variant:'PLO6_HIGH',playerCount:4,heroPosition:'BTN',startingStack:100,smallBlind:.5,bigBlind:1,heroCards:[]}));
      await settle();await capture();await page.keyboard.press('m');await page.keyboard.type('AOKPQEJCDO9P');await settle();
      assert.equal(await page.locator('#hero-slots .playing-card').count(),6);
      if(await page.locator('#open-card-picker').getAttribute('aria-expanded')!=='true')await page.locator('#open-card-picker').click();
      await page.evaluate(()=>{scrollTo(0,0);return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
      report.plo6Layout=await pickerGeometry();
      await page.screenshot({path:path.join(output,'picker-1020-plo6-open.png'),fullPage:false});
      }
    }
    if(!process.env.THEIBS_QA_LAYOUT_OBSERVE)for(const layout of [...report.pickerLayouts,report.amountLayout,report.postActionLayout].filter(Boolean)){
      assert.ok(layout.scrollHeight<=layout.viewport.height,`Picker ${layout.viewport.width}/${layout.open}: vertical page overflow`);
      assert.ok(layout.scrollWidth<=layout.viewport.width,`Picker ${layout.viewport.width}/${layout.open}: horizontal page overflow`);
      assert.ok(layout.actions.inside&&layout.ev.inside&&layout.footer.inside,`Picker ${layout.viewport.width}/${layout.open}: essential controls outside viewport`);
      assert.deepEqual(layout.tableContentOutside,[],`Picker ${layout.viewport.width}/${layout.open}: table content outside viewport`);
      assert.deepEqual(layout.tableContentOverlaps,[],`Picker ${layout.viewport.width}/${layout.open}: cards, seats or pot overlap`);
      assert.deepEqual(layout.obscured,[],`Picker ${layout.viewport.width}/${layout.open}: picker covers essential content`);
      if(layout.open){assert.ok(layout.picker.visible&&layout.picker.inside,'Open picker must fit viewport');assert.equal(layout.rankCount,13);assert.equal(layout.suitCount,4);assert.equal(layout.deckOutside,0,'Every compact picker control must fit viewport');assert.ok(!['transparent','rgba(0, 0, 0, 0)'].includes(layout.picker.background),'Open picker must have an opaque surface');}
      else assert.equal(layout.picker.visible,false,'Closed picker must not cover the table');
    }
    if(!process.env.THEIBS_QA_LAYOUT_OBSERVE)for(const width of [1020,1366]){
      const layouts=report.pickerLayouts.filter(item=>item.viewport.width===width),baseline=layouts[0];
      for(const layout of layouts.slice(1))for(const region of ['table','actions','ev','keyboard'])assert.ok(Math.abs(layout[region].y-baseline[region].y)<=1,`${width}: ${region} moves when toggling Cards`);
    }
    if(!process.env.THEIBS_QA_LAYOUT_OBSERVE&&!visualOnly){const layout=report.plo6Layout;assert.ok(layout.scrollHeight<=760&&layout.scrollWidth<=1020&&layout.picker.inside&&layout.footer.inside,'PLO6 open picker must fit1020x760');assert.deepEqual(layout.tableContentOutside,[]);assert.deepEqual(layout.tableContentOverlaps,[],'PLO6 cards and seats must not overlap');assert.deepEqual(layout.obscured,[]);}
    if(!process.env.THEIBS_QA_LAYOUT_OBSERVE&&!visualOnly){
      await page.locator('#open-settings').click();await page.locator('#mw-exit').click();
      await page.waitForFunction(()=>!theibsApp.getState().multiway);await settle();report.exitVerified=true;
    }
    if(!process.env.THEIBS_QA_LAYOUT_OBSERVE){report.checks.push(visualOnly?'Clean EV labels and picker open/closed fit1020x760 and1366x768 without overlap or page scroll':'Compact picker open/closed at1020x760 and1366x768 keeps controls visible and card input independent');console.log('PASS',report.checks.at(-1));}
    assert.deepEqual(report.errors,[]);
    report.status=process.env.THEIBS_QA_LAYOUT_OBSERVE?'OBSERVED':'PASS';
    console.log('VISUAL',JSON.stringify({fitsViewport:report.decisionFitsViewport,documentHeight:report.decisionGeometry.document.scrollHeight,evBottom:report.decisionGeometry.ev?.bottom,keyboardBottom:report.decisionGeometry.keyboard?.bottom,footerBottom:report.decisionGeometry.footer?.bottom}));
  }catch(error){report.status='FAIL';report.failure=error.stack;if(page){report.context=await page.evaluate(()=>({focus:document.activeElement?.id,dialogs:[...document.querySelectorAll('dialog[open]')].map(node=>node.id),keyboard:window.theibsKeyboard?.getState(),state:window.theibsApp?.getState().multiwayState})).catch(()=>null);await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});}throw error;}
  finally{fs.writeFileSync(path.join(output,visualOnly?'report-visual.json':'report.json'),JSON.stringify(report,null,2));if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
