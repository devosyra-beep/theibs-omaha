'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-keyboard-flows-'));
process.env.THEIBS_WORKSPACE_PATH=path.join(temp,'workspace.json');
process.env.THEIBS_DATA_PATH=path.join(temp,'events.jsonl');
process.env.THEIBS_LLM_CONFIG_PATH=path.join(temp,'llm.json');process.env.THEIBS_LLM_PROVIDER='none';
const output=path.resolve(__dirname,'../../validacao/keyboard-2026-10-03');fs.mkdirSync(output,{recursive:true});
const {server}=require('../server');
(async()=>{
  const report={source:'Local Edge headless, real HTTP, isolated storage; user flows use physical keys without mouse',checks:[],errors:[],screenshots:[]};
  let browser,page;
  const check=async(name,run)=>{await run();report.checks.push(name);console.log('PASS',name);};
  const keys=()=>page.evaluate(()=>theibsKeyboard.getState());
  const state=()=>page.evaluate(()=>theibsApp.getState());
  const settle=async()=>{await page.evaluate(()=>theibsKeyboard.queue.idle());await page.waitForFunction(()=>!theibsApp.getState().multiwayBusy&&!theibsApp.getState().trainingBusy);};
  const tabTo=async(selector)=>{
    for(let n=0;n<250;n++){
      if(await page.evaluate(s=>document.activeElement?.matches(s),selector))return;
      await page.keyboard.press('Tab');
    }
    console.log('TAB DEBUG',selector,await page.evaluate(s=>{const node=document.querySelector(s);return {activeView:theibsApp.getState().activeView,enabled:!!theibsApp.getState().multiway,busy:theibsMultiwayUI.getState().busy,focus:document.activeElement.id,dialogs:[...document.querySelectorAll('dialog[open]')].map(e=>e.id),target:node?.outerHTML,display:node&&getComputedStyle(node).display,rect:node?.getBoundingClientRect().toJSON()};},selector));
    throw Error('Tab could not reach '+selector);
  };
  const field=async(selector,value)=>{await tabTo(selector);await page.keyboard.press('Control+a');await page.keyboard.type(String(value));};
  const select=async(selector,delta)=>{await tabTo(selector);for(let n=0;n<Math.abs(delta);n++)await page.keyboard.press(delta>0?'ArrowDown':'ArrowUp');await page.keyboard.press('Tab');};
  const pickPlayer=async id=>{
    for(let n=0;n<12;n++){if((await keys()).selectedPlayer===id)return;await page.keyboard.press('ArrowDown');}
    throw Error('Player not reachable '+id);
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
    await check('out-of-turn opponent Fold, manual return to Hero and uninterrupted private-card entry',async()=>{
      await pickPlayer(4);await page.keyboard.press('f');await settle();
      assert.equal((await state()).multiwayState.players[4].folded,true);assert.equal((await state()).multiwayState.actor,2);
      await pickPlayer(5);await page.keyboard.press('ArrowLeft');await page.keyboard.type('A O K P Q E J C D O');
      assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.cards().hero),['AO','KP','QE','JC','TO']);
      await page.waitForTimeout(300);assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.cards().hero),['AO','KP','QE','JC','TO']);
    });
    await check('out-of-turn Hero Fold is accepted as a pending observation and can be removed',async()=>{
      await pickPlayer(5);await page.keyboard.press('f');await settle();
      assert.ok((await keys()).observations.some(i=>i.actor===5&&i.kind==='FOLD'));
      await pickPlayer(5);await page.keyboard.press('Backspace');assert.equal((await keys()).observations.length,0);
    });
    await check('rapid ↓ F ↓ G ↓ H 120 Enter ↑ ↑ preserves actor, amount and later manual navigation',async()=>{
      await page.keyboard.press("'");await settle();await pickPlayer(5);
      await page.keyboard.press('ArrowDown');await page.keyboard.press('f');await page.keyboard.press('ArrowDown');await page.keyboard.press('g');await page.keyboard.press('ArrowDown');await page.keyboard.press('h');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'keyboard-amount');
      await page.keyboard.type('120');await page.keyboard.press('Enter');await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');
      const selected=(await keys()).selectedPlayer;await settle();assert.equal((await keys()).selectedPlayer,selected);
      assert.equal((await state()).multiwayState.players[0].folded,true);
      assert.ok((await state()).multiway.events.some(e=>e.actor===2&&e.action==='CALL'));
      assert.ok((await keys()).observations.some(e=>e.actor===4&&e.to===120));
      await pickPlayer(3);await page.keyboard.press('g');await settle();
      assert.ok((await state()).multiway.events.some(e=>e.actor===4&&e.action==='RAISE'&&e.to===120));
    });
    await check('typing cards during a delayed action response never rolls back input or steals selection',async()=>{
      await page.keyboard.press("'");await settle();
      await page.route('**/api/multiway/step',async route=>{await new Promise(r=>setTimeout(r,200));await route.continue();});
      await pickPlayer(2);await page.keyboard.press('g');await pickPlayer(5);await page.keyboard.press('ArrowLeft');await page.keyboard.type('AOKPQEJCDO');await page.keyboard.press('ArrowUp');
      const selected=(await keys()).selectedPlayer;await settle();await page.waitForTimeout(500);
      assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.cards().hero),['AO','KP','QE','JC','TO']);assert.equal((await keys()).selectedPlayer,selected);
      await page.unroute('**/api/multiway/step');
    });
    await check('all streets advance through keyboard-only actions and staged community cards',async()=>{
      await page.keyboard.press("'");await settle();await page.keyboard.type('AOKPQEJCDO');
      for(const [street,entry]of [['FLOP','2E3C4O'],['TURN','5P'],['RIVER','6E']]){
        for(let n=0;n<30&&(await state()).multiwayState.phase==='BETTING';n++){
          await pickPlayer((await state()).multiwayState.actor);await page.keyboard.press('g');await settle();
        }
        assert.equal((await state()).multiwayState.phase,'WAIT_BOARD');
        await page.keyboard.press('Control+'+({FLOP:2,TURN:3,RIVER:4})[street]);await page.keyboard.type(entry);await settle();
        assert.equal((await state()).multiwayState.street,street);
      }
    });
    await check('a committed board card can be corrected without changing streets or actions',async()=>{
      const before=(await state()).multiway.events.filter(e=>e.type==='ACT');
      await page.keyboard.press('Control+2');await page.keyboard.press('Backspace');await page.keyboard.type('7E');await settle();
      assert.equal((await state()).multiwayState.board[0],'7s');assert.equal((await state()).multiwayState.street,'RIVER');
      assert.deepEqual((await state()).multiway.events.filter(e=>e.type==='ACT'),before);
    });
    await check('opponent known-card entry, global duplicate prevention and partial correction',async()=>{
      await page.keyboard.press("'");await settle();await page.keyboard.type('AOKPQEJCDO');
      await pickPlayer(2);await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');await page.keyboard.type('2P3P4P5P6P');
      const overrides=await page.evaluate(()=>theibsOpponentInputs.payload().opponentOverrides);
      assert.deepEqual(overrides.find(e=>e.seatId===2).range.hands[0],['2c','3c','4c','5c','6c']);
      await page.keyboard.press('ArrowLeft');await page.keyboard.type('AO');assert.match(await page.locator('#keyboard-feedback').innerText(),/duplicada/);
      await page.keyboard.press('Escape');await page.keyboard.press('Backspace');
      assert.equal((await page.evaluate(()=>theibsOpponentInputs.payload().opponentOverrides)).some(e=>e.seatId===2&&e.range),false);
    });
    await check('amount cancellation and unrelated text fields do not trigger global actions',async()=>{
      await pickPlayer(3);await page.keyboard.press('h');await page.keyboard.type('120');await page.keyboard.press('Escape');
      assert.equal(await page.locator('#keyboard-amount-dialog').evaluate(e=>e.open),false);
      await tabTo('#open-settings');await page.keyboard.press('Enter');await tabTo('#seed');
      const events=(await state()).multiway.events.length;await page.keyboard.press('Control+a');await page.keyboard.type('120');await page.keyboard.press('Shift');
      assert.equal((await state()).multiway.events.length,events);assert.equal(await page.locator('#seed').inputValue(),'120');await page.keyboard.press('Escape');
    });
    await check('pending out-of-order actions and partial opponent cards survive saving and reload',async()=>{
      await page.keyboard.press("'");await settle();await pickPlayer(4);await page.keyboard.press('g');await settle();
      await pickPlayer(3);await page.keyboard.press('ArrowRight');await page.keyboard.type('8P');
      const before=await page.evaluate(()=>theibsKeyboard.snapshot());
      await page.evaluate(()=>theibsApp.flushSave());await page.reload();await page.evaluate(()=>theibsApp.ready);await settle();
      const restored=await page.evaluate(()=>theibsKeyboard.snapshot());
      assert.deepEqual(restored.observations,before.observations);assert.deepEqual(restored.opponentCards,before.opponentCards);
      assert.equal(restored.selectedPlayer,3);assert.equal(restored.scope,'opponent');assert.equal(restored.cursor,before.cursor);
    });
    await check('an invalid amount is retained for correction, and valid later commands still execute',async()=>{
      await page.keyboard.press("'");await settle();await pickPlayer(2);await page.keyboard.press('h');await page.keyboard.type('1200');await page.keyboard.press('Enter');await settle();
      assert.ok((await keys()).observations.some(item=>item.actor===2&&item.error));assert.equal((await state()).multiway.events.length,0);
      await pickPlayer(2);await page.keyboard.press('h');await page.keyboard.type('120');await page.keyboard.press('Enter');await settle();
      assert.ok((await state()).multiway.events.some(e=>e.actor===2&&e.to===120));assert.equal((await keys()).observations.length,0);
      await pickPlayer(3);await page.keyboard.press('g');await settle();assert.ok((await state()).multiway.events.some(e=>e.actor===3&&e.action==='CALL'));
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
    await check('private and board cards typed during delayed automatic tracking startup are retained',async()=>{
      await page.keyboard.press('Shift');
      await page.route('**/api/multiway/start',async route=>{await new Promise(r=>setTimeout(r,250));await route.continue();});
      await page.keyboard.press('f');await page.keyboard.press('Control+1');await page.keyboard.type('AOKPQEJCDO8P2E3C4O');await settle();
      assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.cards().hero),['AO','KP','QE','JC','TO','8P']);
      assert.deepEqual((await keys()).stagedBoard.slice(0,3),['2E','3C','4O']);await page.unroute('**/api/multiway/start');
      assert.equal((await keys()).scope,'board');
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
      await pickPlayer(other.id);await page.keyboard.press('f');await page.evaluate(()=>theibsKeyboard.queue.idle());
      assert.ok((await page.evaluate(()=>TheibsSimulationUI.getKeyboardState().observations)).some(item=>item.actor===other.id&&item.kind==='FOLD'));
      assert.match(await page.locator('.sim-actions').innerText(),/pending flow/);
      await page.keyboard.press('Backspace');await page.evaluate(()=>theibsKeyboard.queue.idle());
      let current=await page.evaluate(()=>TheibsSimulationUI.getKeyboardState().session);
      await pickPlayer(current.state.actor);await page.keyboard.press('h');
      assert.equal(await page.locator('#keyboard-amount').evaluate(e=>document.activeElement===e),true);
      await page.keyboard.type(String(current.state.legal.minTo));await page.keyboard.press('Enter');await page.evaluate(()=>theibsKeyboard.queue.idle());
      assert.equal(await page.locator('#keyboard-amount-dialog').evaluate(e=>e.open),false);
      current=await page.evaluate(()=>TheibsSimulationUI.getKeyboardState().session);assert.ok(current.revision>initial.revision);
      const prior=current.revision;await pickPlayer(current.state.actor);await page.keyboard.press('g');await page.evaluate(()=>theibsKeyboard.queue.idle());
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
