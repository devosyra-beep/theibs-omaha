'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-keyboard-flows-'));
process.env.THEIBS_WORKSPACE_PATH=path.join(temp,'workspace.json');
process.env.THEIBS_DATA_PATH=path.join(temp,'events.jsonl');
process.env.THEIBS_LLM_CONFIG_PATH=path.join(temp,'llm.json');process.env.THEIBS_LLM_PROVIDER='none';
const output=path.resolve(__dirname,'../../validacao/keyboard-2026-10-03/sequential-ev');fs.mkdirSync(output,{recursive:true});
const {server}=require('../server');
(async()=>{
  const report={source:'Local Edge headless, real HTTP, isolated storage; user flows use physical keys without mouse',checks:[],errors:[],screenshots:[]};
  let browser,page;
  const check=async(name,run)=>{await run();report.checks.push(name);console.log('PASS',name);};
  const keys=()=>page.evaluate(()=>theibsKeyboard.getState());
  const state=()=>page.evaluate(()=>theibsApp.getState());
  const settle=async()=>{await page.evaluate(()=>theibsKeyboard.queue.idle());await page.waitForTimeout(250);await page.waitForFunction(()=>!theibsApp.getState().multiwayBusy&&!theibsApp.getState().trainingBusy&&!theibsApp.getState().analysisBusy,{},{timeout:90000});};
  const tabTo=async(selector)=>{
    if(await page.evaluate(s=>document.activeElement?.matches(s),selector)){await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');}
    for(let n=0;n<250;n++){
      if(await page.evaluate(s=>document.activeElement?.matches(s),selector))return;
      await page.keyboard.press('Tab');
    }
    console.log('TAB DEBUG',selector,await page.evaluate(s=>{const node=document.querySelector(s);return {activeView:theibsApp.getState().activeView,enabled:!!theibsApp.getState().multiway,busy:theibsMultiwayUI.getState().busy,focus:document.activeElement.id,dialogs:[...document.querySelectorAll('dialog[open]')].map(e=>e.id),target:node?.outerHTML,display:node&&getComputedStyle(node).display,rect:node?.getBoundingClientRect().toJSON()};},selector));
    throw Error('Tab could not reach '+selector);
  };
  const field=async(selector,value)=>{await tabTo(selector);await page.keyboard.press('Control+a');await page.keyboard.type(String(value));};
  const select=async(selector,delta)=>{await tabTo(selector);for(let n=0;n<Math.abs(delta);n++)await page.keyboard.press(delta>0?'ArrowDown':'ArrowUp');await page.keyboard.press('Tab');};
  const pickSimulationPlayer=async id=>{
    assert.equal((await state()).activeView,'simulation');
    for(let n=0;n<12;n++){if((await keys()).selectedPlayer===id)return;await page.keyboard.press('ArrowDown');}
    throw Error('Player not reachable '+id);
  };
  const assertActor=async id=>{
    assert.equal((await state()).multiwayState.actor,id);
    assert.equal((await keys()).selectedPlayer,id);
  };
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    browser=await chromium.launch({channel:'msedge',headless:true});
    page=await browser.newPage({viewport:{width:1515,height:1000}});
    page.on('pageerror',e=>report.errors.push(e.stack));page.on('dialog',d=>d.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}/app`);await page.evaluate(()=>theibsApp.ready);
    await check('new hand and rapid rank/suit entry with the deck closed',async()=>{
      await page.keyboard.press("'");await page.keyboard.type('A O K P Q E J C D O');
      assert.deepEqual((await page.evaluate(()=>theibsCardKeyboard.state.snapshot())).slots.slice(0,5),['AO','KP','QE','JC','TO']);
      assert.equal(await page.locator('#card-picker').evaluate(e=>e.open),false);
    });
    await check('duplicate feedback, correction and board navigation',async()=>{
      await page.keyboard.type('AO');assert.match(await page.locator('#keyboard-feedback').innerText(),/Duplicate/);
      await page.keyboard.press('Control+1');await page.keyboard.press('Backspace');await page.keyboard.type('AE');
      assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.slots[0]),'AE');
      await page.keyboard.press('Control+2');assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.selected),5);
      await page.keyboard.type('2E3C4O');await page.keyboard.press('Control+3');await page.keyboard.type('5P');await page.keyboard.press('Control+4');await page.keyboard.type('6E');
      assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.cards().board),['2E','3C','4O','5P','6E']);
    });
    await check('PT-BR names and Ten binding follow the chosen interface language',async()=>{
      await tabTo('#keyboard-language');await page.keyboard.press('ArrowDown');await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(()=>document.documentElement.lang),'pt-BR');
      assert.match(await page.locator('[data-card="AO"]').getAttribute('aria-label'),/Ás de Ouros/);
      assert.match(await page.locator('[data-card="TO"]').getAttribute('aria-label'),/Dez.*D O/);
    });
    await check('settings and Multiway setup are reachable and usable exclusively with Tab and Enter',async()=>{
      await tabTo('#open-settings');await page.keyboard.press('Enter');
      await tabTo('#mw-setup-open');await page.keyboard.press('Enter');
      await tabTo('#mw-hero-position');await page.keyboard.press('End');await page.keyboard.press('Tab');await field('#mw-small-blind',20);await field('#mw-big-blind',40);await field('#mw-starting-stack',1000);
      await tabTo('#mw-start');await page.keyboard.press('Enter');await settle();
      assert.equal((await state()).multiwayState.actor,2);assert.equal((await state()).multiwayState.heroId,5);
      assert.equal(await page.locator('dialog[open]').count(),0);
    });
    await check('reset does not fire for Shift+letter, Shift+Tab or text editing',async()=>{
      const before=await page.evaluate(()=>theibsCardKeyboard.state.snapshot());
      await page.keyboard.press('Shift+Tab');await page.keyboard.press('Shift+q');
      assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.slots),before.slots);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Shift');await settle();
      assert.equal((await state()).multiway.events.length,0);assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.slots.some(Boolean)),false);
    });
    await check('native player-popover Fold follows the current actor and its handler rejects an out-of-turn seat',async()=>{
      await assertActor(2);await tabTo('[data-multiway-player="2"]');await page.keyboard.press('Enter');
      assert.equal(await page.locator('#multiway-seat-dialog').evaluate(dialog=>dialog.open),true);
      assert.equal(await page.locator('#mw-seat-fold').isDisabled(),false);
      await tabTo('#mw-seat-fold');await page.keyboard.press('Enter');await settle();await assertActor(3);
      const before=(await state()).multiway.events;
      assert.equal(before.length,1);assert.equal(before[0].type,'ACT');assert.equal(before[0].actor,2);assert.equal(before[0].action,'FOLD');
      // Developer fixture: an arbitrary seat cannot be selected through the
      // sequential keyboard, so open its existing native popover directly.
      await page.evaluate(()=>theibsMultiwayUI.openPlayer(4));
      assert.equal(await page.locator('#multiway-seat-dialog').evaluate(dialog=>dialog.open),true);
      assert.equal(await page.locator('#mw-seat-fold').isDisabled(),true);
      const mutations=[],watch=request=>{if(request.method()==='POST'&&/\/api\/multiway\/(step|state)$/.test(request.url()))mutations.push(request.url());};
      page.on('request',watch);
      // Invoke the guarded handler itself to verify that disabled styling is
      // not the only protection against an out-of-turn action.
      await page.evaluate(()=>document.querySelector('#mw-seat-fold').onclick());await settle();page.off('request',watch);
      assert.deepEqual(mutations,[]);assert.deepEqual((await state()).multiway.events,before);assert.equal((await state()).multiwayState.players[4].folded,false);
      for(let n=0;n<20&&await page.locator('#multiway-seat-dialog').evaluate(dialog=>dialog.open);n++)await page.keyboard.press('Tab');
      assert.equal(await page.locator('#multiway-seat-dialog').evaluate(dialog=>dialog.open),false);
      await tabTo('[data-multiway-player="3"]');
      await page.keyboard.press("'");await settle();await assertActor(2);assert.equal((await state()).multiway.events.length,0);
    });
    await check('opponent actions work without Hero cards and arrows cannot skip the authoritative actor',async()=>{
      await assertActor(2);
      for(const key of ['ArrowUp','ArrowUp','ArrowDown','ArrowDown']){await page.keyboard.press(key);await assertActor(2);}
      assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.cards().hero),[]);
      await page.keyboard.press('f');await settle();await assertActor(3);
      assert.ok((await state()).multiway.events.some(event=>event.actor===2&&event.action==='FOLD'));
      assert.equal((await state()).lastAnalysis,null);
      await page.keyboard.press('ArrowUp');assert.equal((await keys()).selectedPlayer,2);
      await page.keyboard.press('ArrowUp');assert.equal((await keys()).selectedPlayer,2);
      const before=(await state()).multiway.events.length;
      for(const key of ['f','g','h'])await page.keyboard.press(key);
      await settle();assert.equal((await state()).multiway.events.length,before);
      assert.equal((await state()).multiwayState.actor,3);assert.equal((await keys()).observations.length,0);
      assert.equal(await page.locator('#keyboard-amount-dialog').evaluate(e=>e.open),false);
      await page.keyboard.press('ArrowDown');await assertActor(3);
      await page.keyboard.press('ArrowDown');await assertActor(3);
      await page.keyboard.press('Control+1');await page.keyboard.type('AO');await assertActor(3);
      await page.keyboard.press('g');await settle();await assertActor(4);
      assert.equal((await state()).multiway.events.length,before+1);
      assert.equal((await state()).lastAnalysis,null);
    });
    await check('Backspace on the previous action undoes one confirmed action and resumes that player',async()=>{
      await page.keyboard.press('ArrowUp');assert.equal((await keys()).selectedPlayer,3);
      await page.keyboard.press('Backspace');await settle();await assertActor(3);
      assert.equal((await state()).multiway.events.length,1);
      await page.keyboard.press('g');await settle();await assertActor(4);
      assert.equal((await keys()).observations.length,0);
    });
    await check('a partial correction of synchronized Hero cards never changes the action revision or blocks an opponent',async()=>{
      await page.keyboard.press("'");await settle();await page.keyboard.press('Control+1');await page.keyboard.type('AOKPQEJCDO');await settle();await assertActor(2);
      const confirmed=(await state()).multiway.config.heroCards;
      assert.equal(confirmed.length,5);
      await page.keyboard.press('Control+1');await page.keyboard.press('Backspace');await settle();await assertActor(2);
      assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.slots[0]),null);
      await page.keyboard.press('g');await settle();await assertActor(3);
      assert.equal((await state()).multiway.events.length,1);
      assert.deepEqual((await state()).multiway.config.heroCards,confirmed);
      assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.slots[0]),null);
      assert.equal((await state()).lastAnalysis,null);assert.equal((await state()).analysisBusy,false);
    });
    await check('a rapid burst cannot apply two actions or open sizing while confirmation is pending',async()=>{
      await page.keyboard.press("'");await settle();await assertActor(2);
      await page.route('**/api/multiway/step',async route=>{await new Promise(r=>setTimeout(r,400));await route.continue();});
      await page.keyboard.press('g');await page.keyboard.press('g');await page.keyboard.press('ArrowDown');await page.keyboard.press('h');
      assert.equal((await keys()).selectedPlayer,2);assert.equal(await page.locator('#keyboard-amount-dialog').evaluate(e=>e.open),false);
      await settle();await page.unroute('**/api/multiway/step');
      assert.equal((await state()).multiway.events.length,1);assert.equal((await keys()).selectedPlayer,3);
      await page.keyboard.press('h');await page.keyboard.type('120');await page.keyboard.press('Enter');await settle();
      assert.ok((await state()).multiway.events.some(e=>e.actor===3&&e.action==='RAISE'&&e.to===120));assert.equal((await keys()).selectedPlayer,4);
    });
    await check('a failed confirmation keeps the same actor and can be retried without duplicate or pending actions',async()=>{
      await page.keyboard.press("'");await settle();await assertActor(2);
      await page.route('**/api/multiway/step',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Keyboard QA: confirmation unavailable'})}));
      await page.keyboard.press('g');await settle();await assertActor(2);
      assert.equal((await state()).multiway.events.length,0);assert.equal((await keys()).actionPending,false);assert.equal((await keys()).observations.length,0);
      await page.unroute('**/api/multiway/step');await page.keyboard.press('g');await settle();await assertActor(3);
      assert.equal((await state()).multiway.events.length,1);
    });
    await check('typing Hero cards during confirmation preserves input and advances only after acceptance',async()=>{
      await page.keyboard.press("'");await settle();
      await page.route('**/api/multiway/step',async route=>{await new Promise(r=>setTimeout(r,400));await route.continue();});
      await assertActor(2);await page.keyboard.press('g');await page.keyboard.press('Control+1');await page.keyboard.type('AOKPQEJCDO');
      assert.equal((await keys()).selectedPlayer,2);
      await settle();
      assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.cards().hero),['AO','KP','QE','JC','TO']);assert.equal((await keys()).selectedPlayer,3);
      await page.unroute('**/api/multiway/step');
    });
    await check('missing Hero cards block calculation, while each opponent can act and card focus leaves the actor unchanged',async()=>{
      await page.keyboard.press("'");await settle();await page.keyboard.press('Control+1');await page.keyboard.type('AO');await settle();
      assert.equal((await state()).analysisBusy,false);assert.equal((await state()).lastAnalysis,null);
      for(const actor of [2,3,4]){
        await assertActor(actor);
        for(const key of ['Control+2','Control+3','Control+4','Control+1']){await page.keyboard.press(key);await assertActor(actor);}
        await tabTo('[data-keyboard-slot="0"]');await page.keyboard.press('Enter');await assertActor(actor);
        await page.keyboard.press('g');await settle();
      }
      await assertActor(5);assert.equal((await state()).multiway.events.length,3);
      assert.equal((await state()).lastAnalysis,null);assert.equal((await state()).analysisBusy,false);
    });
    await check('equity and finite EV calculate automatically when the confirmed Hero decision has all required cards',async()=>{
      await page.keyboard.press('Control+1');await page.keyboard.type('AOKPQEJCDO');await settle();await assertActor(5);
      await page.waitForFunction(()=>theibsApp.getState().lastAnalysis&&!theibsApp.getState().analysisBusy,{},{timeout:90000});
      const current=await state(),analysis=current.lastAnalysis.data;
      if(analysis.status!=='OK')throw Error('Real calculation failed: '+JSON.stringify(analysis));
      assert.equal(current.multiwayState.actor,5);assert.equal(current.multiway.events.length,3);
      assert.equal(analysis.observedState.revisionKey,current.multiwayState.revisionKey);
      assert.ok(Number.isFinite(analysis.equity.equity));
      const candidates=analysis.ev.candidates||Object.values(analysis.ev.actions);
      assert.ok(candidates.some(row=>row.action!=='FOLD'&&row.status==='MODELED'&&Number.isFinite(row.ev)));
      report.automaticEV={street:current.multiwayState.street,revision:current.multiwayState.revisionKey,stage:analysis.analysisStage,equity:analysis.equity.equity,estimates:candidates.filter(row=>row.status==='MODELED').map(({action,ev})=>({action,ev})),runtime:analysis.performance?.runtime};
      await page.screenshot({path:path.join(output,'automatic-equity-ev.png'),fullPage:true});report.screenshots.push('automatic-equity-ev.png');
    });
    await check('an action remains independent of a pending EV calculation and cancels stale results',async()=>{
      await assertActor(5);const before=await state();
      let delayed=false;
      await page.route('**/api/multiway/capabilities',async route=>{delayed=true;await new Promise(resolve=>setTimeout(resolve,800));await route.continue().catch(()=>{});});
      await page.keyboard.press('Enter');await page.waitForFunction(()=>theibsApp.getState().analysisBusy);
      await page.waitForTimeout(50);assert.equal(delayed,true);
      await page.keyboard.press('g');await settle();
      const after=await state();assert.equal(after.multiway.events.length,before.multiway.events.length+1);
      assert.notEqual(after.multiwayState.revisionKey,before.multiwayState.revisionKey);assert.notEqual(after.multiwayState.actor,5);
      await page.waitForTimeout(850);assert.equal((await state()).lastAnalysis,null);
      await page.unroute('**/api/multiway/capabilities');
    });
    await check('an entered flop needs exactly three board cards even when Hero cards are still empty',async()=>{
      await page.keyboard.press("'");await settle();
      for(let n=0;n<12&&(await state()).multiwayState.phase==='BETTING';n++){
        await assertActor((await state()).multiwayState.actor);await page.keyboard.press('g');await settle();
      }
      assert.equal((await state()).multiwayState.phase,'WAIT_BOARD');assert.equal((await state()).multiwayState.board.length,0);
      assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.cards().hero),[]);
      const eventsBefore=(await state()).multiway.events.length;
      for(const [index,card]of ['2E','3C','4O'].entries()){
        await page.keyboard.type(card);await settle();
        if(index<2){assert.equal((await state()).multiwayState.phase,'WAIT_BOARD');assert.equal((await state()).multiway.events.length,eventsBefore);}
      }
      assert.equal((await state()).multiwayState.street,'FLOP');assert.equal((await state()).multiwayState.board.length,3);
      assert.equal((await state()).multiway.events.length,eventsBefore+1);assert.equal((await state()).lastAnalysis,null);
      assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.cards().hero),[]);
    });
    await check('an all-in runout waits for user-entered flop, turn and river, advancing only the input cursor',async()=>{
      await page.keyboard.press("'");await settle();
      for(let n=0;n<20&&(await state()).multiwayState.phase==='BETTING';n++){
        const current=(await state()).multiwayState;await assertActor(current.actor);
        if(current.legal.actions.includes('RAISE')){
          await page.keyboard.press('h');await page.keyboard.type(String(current.legal.maxTo));await page.keyboard.press('Enter');
        }else await page.keyboard.press('g');
        await settle();
      }
      assert.equal((await state()).multiwayState.phase,'WAIT_BOARD');assert.ok((await state()).multiwayState.players.every(player=>player.allIn));
      for(const [entry,street,size,next]of [['2E3C4O','FLOP',3,'TURN'],['5P','TURN',4,'RIVER'],['6E','RIVER',5,null]]){
        const before=(await state()).multiway.events.length;
        await page.keyboard.type(entry);await settle();const current=(await state()).multiwayState;
        assert.equal(current.street,street);assert.equal(current.board.length,size);assert.equal((await state()).multiway.events.length,before+1);
        if(next){assert.equal(current.phase,'WAIT_BOARD');assert.equal(current.nextStreet,next);assert.equal((await keys()).cursor,size);await page.waitForTimeout(100);assert.equal((await state()).multiwayState.board.length,size);}
        else assert.equal(current.phase,'SHOWDOWN');
      }
      assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.cards().hero),[]);
    });
    await check('all streets advance through keyboard-only actions and staged community cards',async()=>{
      await page.keyboard.press("'");await settle();await page.keyboard.press('Control+1');await page.keyboard.type('AOKPQEJCDO');
      for(const [street,entry]of [['FLOP','2E3C4O'],['TURN','5P'],['RIVER','6E']]){
        for(let n=0;n<30&&(await state()).multiwayState.phase==='BETTING';n++){
          await assertActor((await state()).multiwayState.actor);await page.keyboard.press('g');await settle();
        }
        assert.equal((await state()).multiwayState.phase,'WAIT_BOARD');
        assert.equal((await keys()).scope,'board');
        const boardBefore=(await state()).multiwayState.board.length,eventsBefore=(await state()).multiway.events.length;
        assert.equal(boardBefore,{FLOP:0,TURN:3,RIVER:4}[street]);
        await page.waitForTimeout(150);assert.equal((await state()).multiwayState.phase,'WAIT_BOARD');assert.equal((await state()).multiwayState.board.length,boardBefore);
        const entered=entry.match(/.{2}/g);
        for(const [index,card]of entered.entries()){
          await page.keyboard.type(card);await settle();
          if(index<entered.length-1){
            assert.equal((await state()).multiwayState.phase,'WAIT_BOARD');assert.equal((await state()).multiwayState.board.length,boardBefore);
            assert.equal((await state()).multiway.events.length,eventsBefore);assert.equal((await keys()).stagedBoard.filter(Boolean).length,index+1);
          }
        }
        assert.equal((await state()).multiwayState.street,street);
        assert.equal((await state()).multiwayState.board.length,{FLOP:3,TURN:4,RIVER:5}[street]);
        assert.equal((await state()).multiway.events.length,eventsBefore+1);
        assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.cards().hero),['AO','KP','QE','JC','TO']);
      }
    });
    await check('a committed board card can be corrected without changing streets or actions',async()=>{
      const before=(await state()).multiway.events.filter(e=>e.type==='ACT');
      await page.keyboard.press('Control+2');await page.keyboard.press('Backspace');await page.keyboard.type('7E');await settle();
      assert.equal((await state()).multiwayState.board[0],'7s');assert.equal((await state()).multiwayState.street,'RIVER');
      assert.deepEqual((await state()).multiway.events.filter(e=>e.type==='ACT'),before);
    });
    await check('a failed board correction keeps the draft and blocks stale calculation until the correction is confirmed',async()=>{
      for(let n=0;n<12&&(await state()).multiwayState.actor!==5;n++){
        await assertActor((await state()).multiwayState.actor);await page.keyboard.press('g');await settle();
      }
      await assertActor(5);assert.ok((await state()).lastAnalysis);
      const boardBefore=[...(await state()).multiwayState.board];
      await page.route('**/api/multiway/state',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Keyboard QA: board confirmation unavailable'})}));
      await page.keyboard.press('Control+2');await page.keyboard.press('Backspace');await page.keyboard.type('8E');await settle();
      assert.deepEqual((await state()).multiwayState.board,boardBefore);assert.equal((await keys()).stagedBoard[0],'8E');assert.equal((await keys()).boardReady,false);
      assert.equal((await state()).lastAnalysis,null);assert.equal((await state()).analysisBusy,false);
      await page.keyboard.press('Enter');await settle();assert.equal((await state()).lastAnalysis,null);
      assert.equal((await keys()).stagedBoard[0],'8E');assert.equal((await keys()).boardReady,false);
      await page.unroute('**/api/multiway/state');
      await page.keyboard.press('Control+2');await page.keyboard.press('Backspace');await page.keyboard.type('8E');await settle();
      assert.equal((await state()).multiwayState.board[0],'8s');assert.equal((await keys()).boardReady,true);
      const current=await state();assert.ok(current.lastAnalysis);assert.equal(current.lastAnalysis.data.observedState.revisionKey,current.multiwayState.revisionKey);
    });
    await check('selecting an opponent never routes Card entry to that opponent',async()=>{
      await page.keyboard.press("'");await settle();await page.keyboard.press('Control+1');await page.keyboard.type('AOKPQEJCDO');await assertActor(2);
      await page.keyboard.press('Control+1');for(let n=0;n<3;n++)await page.keyboard.press('ArrowRight');await page.keyboard.type('8P9P');await settle();await assertActor(2);
      const overrides=await page.evaluate(()=>theibsOpponentInputs.payload().opponentOverrides);
      assert.equal(overrides.some(e=>e.range),false);
      assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.cards().hero),['AO','KP','QE','8P','9P']);
      await page.keyboard.press('Control+1');await page.keyboard.press('ArrowRight');await page.keyboard.type('AO');assert.match(await page.locator('#keyboard-feedback').innerText(),/duplicada/);
      await page.keyboard.press('Escape');await page.keyboard.press('Backspace');
      await assertActor(2);
      assert.equal((await page.evaluate(()=>theibsOpponentInputs.payload().opponentOverrides)).some(e=>e.range),false);
    });
    await check('amount cancellation and unrelated text fields do not trigger global actions',async()=>{
      await assertActor(2);await page.keyboard.press('h');await page.keyboard.type('120');await page.keyboard.press('Escape');
      assert.equal(await page.locator('#keyboard-amount-dialog').evaluate(e=>e.open),false);
      await tabTo('#open-settings');await page.keyboard.press('Enter');await tabTo('#seed');
      const events=(await state()).multiway.events.length;await page.keyboard.press('Control+a');await page.keyboard.type('120');await page.keyboard.press('Shift');
      assert.equal((await state()).multiway.events.length,events);assert.equal(await page.locator('#seed').inputValue(),'120');await page.keyboard.press('Escape');
    });
    await check('partial Hero cards survive reload, restore the current actor and never replay an action',async()=>{
      await page.keyboard.press("'");await settle();await assertActor(2);await page.keyboard.press('g');await settle();await assertActor(3);
      await page.keyboard.press('ArrowUp');assert.equal((await keys()).selectedPlayer,2);
      await page.keyboard.press('Control+1');await page.keyboard.press('ArrowRight');await page.keyboard.type('8P');assert.equal((await keys()).selectedPlayer,2);
      const before=await page.evaluate(()=>theibsKeyboard.snapshot());
      await page.evaluate(()=>theibsApp.flushSave());await page.reload();await page.evaluate(()=>theibsApp.ready);await settle();
      const restored=await page.evaluate(()=>theibsKeyboard.snapshot());
      assert.deepEqual(restored.observations,before.observations);assert.deepEqual(restored.opponentCards,before.opponentCards);
      await assertActor(3);assert.equal(restored.scope,'hero');assert.equal(restored.cursor,before.cursor);
      assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.slots[1]),'8P');
      assert.equal((await state()).multiway.events.length,1);
    });
    await check('an illegal amount stays in the focused dialog and can be corrected before any action is recorded',async()=>{
      await page.keyboard.press("'");await settle();await assertActor(2);await page.keyboard.press('h');await page.keyboard.type('1200');await page.keyboard.press('Enter');await settle();
      assert.equal(await page.locator('#keyboard-amount-dialog').evaluate(e=>e.open),true);assert.equal((await state()).multiway.events.length,0);assert.equal((await keys()).selectedPlayer,2);
      await page.keyboard.press('Control+a');await page.keyboard.type('120');await page.keyboard.press('Enter');await settle();
      assert.ok((await state()).multiway.events.some(e=>e.actor===2&&e.to===120));assert.equal((await keys()).observations.length,0);
      await assertActor(3);await page.keyboard.press('g');await settle();assert.ok((await state()).multiway.events.some(e=>e.actor===3&&e.action==='CALL'));
    });
    await check('current and previous actor review keep the keyboard stationary at desktop and mobile widths',async()=>{
      const geometry=()=>page.evaluate(()=>{
        const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {y:r.y,height:r.height};};
        return {panel:rect('.card-keyboard'),strip:rect('#keyboard-context-slots'),heading:rect('.card-keyboard .keyboard-heading'),legend:rect('.keyboard-command-legend'),scrollY,overflow:document.documentElement.scrollWidth>innerWidth};
      });
      for(const width of [1515,1024,390,320])for(const expanded of [false,true]){
        await page.setViewportSize({width,height:1000});
        if(await page.locator('#card-picker').evaluate(e=>e.open)!==expanded){await tabTo('#open-card-picker');await page.keyboard.press('Enter');}
        await tabTo('[data-keyboard-slot="0"]');await page.keyboard.press('Enter');await page.keyboard.press('ArrowDown');await assertActor(4);
        const baseline=await geometry();assert.equal(baseline.strip.height,38);assert.equal(baseline.overflow,false);
        for(const key of ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','Control+2','Control+3','Control+4','Control+1']){
          await page.keyboard.press(key);assert.deepEqual(await geometry(),baseline,JSON.stringify({width,expanded,key}));
          assert.equal((await state()).multiwayState.actor,4);
          assert.equal((await keys()).selectedPlayer,key==='ArrowUp'?3:4);
        }
      }
      await page.setViewportSize({width:1515,height:1000});
    });
    await check('simulation starts, acts, opens sizing and finishes with no mouse',async()=>{
      await tabTo('.nav-tab[data-view="train"]');await page.keyboard.press('Enter');await page.keyboard.press("'");await settle();
      assert.ok((await state()).trainingSession);
      let session=(await state()).trainingSession;
      if(session.legalActions.some(a=>['BET','RAISE'].includes(a))){
        await page.keyboard.press('h');assert.equal(await page.evaluate(()=>document.activeElement.id),'keyboard-amount');await page.keyboard.type(String(session.minSize));await page.keyboard.press('Enter');await settle();
      }
      for(let n=0;n<10&&!(await state()).trainingSession.finished;n++){await page.keyboard.press('g');await settle();}
      assert.equal((await state()).trainingSession.finished,true);
      await page.keyboard.press("'");await settle();await page.keyboard.press('f');await settle();assert.equal((await state()).trainingSession.finished,true);
    });
    await check('English labels, deck touch targets and layout at desktop / mobile widths',async()=>{
      await tabTo('.nav-tab[data-view="analyze"]');await page.keyboard.press('Enter');
      await tabTo('#keyboard-language');await page.keyboard.press('ArrowUp');await page.keyboard.press('Tab');
      await tabTo('#open-card-picker');await page.keyboard.press('Enter');
      for(const width of [1515,1024,390,320]){
        await page.setViewportSize({width,height:1000});
        const dimensions=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,cardWidth:document.querySelector('[data-card]').getBoundingClientRect().width}));
        assert.equal(dimensions.overflow,false,JSON.stringify({width,...dimensions}));assert.ok(dimensions.cardWidth>=30);
        const name=`keyboard-${width}.png`;await page.locator('.card-keyboard').screenshot({path:path.join(output,name)});report.screenshots.push(name);
      }
      assert.match(await page.locator('[data-card="TO"]').getAttribute('aria-label'),/Ten.*T O/);
    });
    await check('52 physical card combinations, all variants, Tab selection and modifier aliases',async()=>{
      await page.setViewportSize({width:1515,height:1000});
      await tabTo('#open-settings');await page.keyboard.press('Enter');await tabTo('#mw-exit');await page.keyboard.press('Enter');await settle();await page.keyboard.press('Escape');
      for(const count of [4,5,6]){
        await tabTo('#open-settings');await page.keyboard.press('Enter');await tabTo('#variant-select');await page.keyboard.press('Home');for(let i=4;i<count;i++)await page.keyboard.press('ArrowDown');await page.keyboard.press('Tab');await page.keyboard.press('Escape');
        for(const suit of 'ECOP')for(const rank of 'AKQJT98765432'){
          await page.keyboard.press('Shift');await page.keyboard.type((rank==='T'?'10':rank.toLowerCase())+suit.toLowerCase());
          assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.slots[0]),rank+suit);
          assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.count),count);
        }
      }
      await page.keyboard.press('Shift');await tabTo('[data-slot="0"]');await page.keyboard.press('Tab');await page.keyboard.type('AE');
      assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.slots[1]),'AE');assert.equal(await page.evaluate(()=>document.activeElement.dataset.slot),'2');
    });
    await check('player and card navigation keep the card strip and toolbar stationary at every layout',async()=>{
      const geometry=()=>page.evaluate(()=>{
        const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {y:r.y,height:r.height};};
        return {panel:rect('.card-keyboard'),strip:rect('#keyboard-context-slots'),heading:rect('.card-keyboard .keyboard-heading'),legend:rect('.keyboard-command-legend'),scrollY,overflow:document.documentElement.scrollWidth>innerWidth};
      });
      for(const count of [4,5,6]){
        await page.setViewportSize({width:1515,height:1000});
        await tabTo('#open-settings');await page.keyboard.press('Enter');await tabTo('#variant-select');await page.keyboard.press('Home');
        for(let i=4;i<count;i++)await page.keyboard.press('ArrowDown');await page.keyboard.press('Tab');await page.keyboard.press('Escape');
        await page.keyboard.press('Shift');await page.keyboard.type(['AO','TP','KC','QE','JP','9C'].slice(0,count).join(''));await page.keyboard.press('Control+1');
        for(const width of [1515,1024,390,320])for(const expanded of [false,true]){
          await page.setViewportSize({width,height:1000});
          if(await page.locator('#card-picker').evaluate(e=>e.open)!==expanded){await tabTo('#open-card-picker');await page.keyboard.press('Enter');}
          await tabTo('[data-keyboard-slot="0"]');await page.keyboard.press('Enter');
          assert.equal((await keys()).scope,'hero');assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.selected),0);
          const baseline=await geometry();assert.equal(baseline.strip.height,38);assert.equal(baseline.overflow,false);
          for(const key of ['ArrowDown','ArrowDown','ArrowUp','ArrowUp','ArrowRight','ArrowLeft','Control+2','Control+3','Control+4','Control+1']){
            await page.keyboard.press(key);const actual=await geometry();
            assert.deepEqual(actual,baseline,JSON.stringify({count,width,expanded,key,actual,baseline}));
            assert.equal(await page.locator('#keyboard-context-slots').isVisible(),true);
            assert.equal(await page.locator('#keyboard-context-slots [aria-pressed="true"]').count(),1);
          }
          const group=await page.locator('#keyboard-context-slots').getAttribute('aria-label');assert.match(group,/You/);
        }
      }
      await page.setViewportSize({width:1515,height:1000});
      await page.locator('.card-keyboard').screenshot({path:path.join(output,'keyboard-stable.png')});report.screenshots.push('keyboard-stable.png');
    });
    await check('standalone actions never silently start Multiway or alter the calculation mode',async()=>{
      await page.keyboard.press('Shift');
      await page.keyboard.press('f');await page.keyboard.press('g');await page.keyboard.press('h');await page.keyboard.press('Control+1');await page.keyboard.type('AOKPQEJCDO8P2E3C4O');await settle();
      assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.cards().hero),['AO','KP','QE','JC','TO','8P']);
      assert.equal((await state()).multiway,null);assert.equal(await page.locator('#keyboard-amount-dialog').evaluate(e=>e.open),false);
      assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.cards().board),['2E','3C','4O']);
    });
    await check('current Simulation uses F/G/H, selected opponents, immediate sizing and protected form controls',async()=>{
      await tabTo('[data-view="simulation"]');await page.keyboard.press('Enter');
      await page.waitForFunction(()=>theibsApp.getState().activeView==='simulation');
      await page.keyboard.press("'");await page.evaluate(()=>theibsKeyboard.queue.idle());
      await tabTo('#sim-setup-form [name="playerCount"]');await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Tab');
      await tabTo('#sim-setup-form [name="heroPosition"]');await page.keyboard.press('Home');await page.keyboard.press('Tab');
      await tabTo('#sim-setup-form [type="submit"]');await page.keyboard.press('Enter');
      await page.waitForFunction(()=>TheibsSimulationUI.getKeyboardState().session&&!TheibsSimulationUI.getKeyboardState().busy);
      const initial=await page.evaluate(()=>TheibsSimulationUI.getKeyboardState().session);
      const other=initial.state.players.find(p=>p.id!==initial.state.actor&&!p.folded&&!p.allIn);
      await pickSimulationPlayer(other.id);await page.keyboard.press('f');await page.evaluate(()=>theibsKeyboard.queue.idle());
      assert.ok((await page.evaluate(()=>TheibsSimulationUI.getKeyboardState().observations)).some(item=>item.actor===other.id&&item.kind==='FOLD'));
      assert.match(await page.locator('.sim-actions').innerText(),/pending flow/);
      await page.keyboard.press('Backspace');await page.evaluate(()=>theibsKeyboard.queue.idle());
      let current=await page.evaluate(()=>TheibsSimulationUI.getKeyboardState().session);
      await pickSimulationPlayer(current.state.actor);await page.keyboard.press('h');
      assert.equal(await page.locator('#keyboard-amount').evaluate(e=>document.activeElement===e),true);
      await page.keyboard.type(String(current.state.legal.minTo));await page.keyboard.press('Enter');await page.evaluate(()=>theibsKeyboard.queue.idle());
      assert.equal(await page.locator('#keyboard-amount-dialog').evaluate(e=>e.open),false);
      current=await page.evaluate(()=>TheibsSimulationUI.getKeyboardState().session);assert.ok(current.revision>initial.revision);
      const prior=current.revision;await pickSimulationPlayer(current.state.actor);await page.keyboard.press('g');await page.evaluate(()=>theibsKeyboard.queue.idle());
      assert.ok((await page.evaluate(()=>TheibsSimulationUI.getKeyboardState().session)).revision>prior);
      await tabTo('#sim-control');await page.keyboard.press('Shift+Tab');
      assert.equal(await page.locator('dialog[open]').count(),0);
      await page.keyboard.press("'");await page.evaluate(()=>theibsKeyboard.queue.idle());
      await tabTo('#sim-setup-form [name="startingStack"]');await page.keyboard.press('Control+a');await page.keyboard.type('120');await page.keyboard.press('Shift');
      assert.equal(await page.locator('#sim-setup-form [name="startingStack"]').inputValue(),'120');await page.keyboard.press('Escape');
    });
    assert.deepEqual(report.errors,[]);report.status='PASS';
  }catch(error){report.status='FAIL';report.failure=error.stack;if(page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});throw error;}
  finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
