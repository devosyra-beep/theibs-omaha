'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium,_electron}=require('playwright');
(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-workflow-'));
  process.env.THEIBS_DATA_PATH=path.join(temp,'events.jsonl');process.env.THEIBS_WORKSPACE_PATH=path.join(temp,'workspace.json');
  const out=path.resolve(__dirname,'../../validacao/workflow-v0.3.0');fs.mkdirSync(out,{recursive:true});
  const native=process.argv.includes('--electron'),report={mode:native?'Windows packaged Electron':'Windows Edge, real HTTP',checks:[],errors:[],layouts:[]};
  let server,browser,electron,page;
  const check=async(name,run)=>{await run();report.checks.push(name);console.log('PASS',name);};
  const flow=()=>page.evaluate(()=>TheibsFlow.getState());
  const act=async(action)=>{await page.locator(`[data-flow-action="${action}"]`).click();await page.waitForFunction(()=>!TheibsFlow.isBusy());};
  try{
    if(native){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;electron=await _electron.launch({executablePath:process.env.THEIBS_EXECUTABLE||path.resolve(__dirname,'../../THEIBS/THEIBS.exe'),args:['--user-data-dir='+path.join(temp,'profile')],env,timeout:20000});page=await electron.firstWindow();}
    else {({server}=require('../server'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true,channel:'msedge'});page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto(`http://127.0.0.1:${server.address().port}`);}
    page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.waitForFunction(()=>Boolean(window.theibsApp));await page.evaluate(()=>theibsApp.ready);
    await check('Cards calculate immediately against all 5 unknown opponents',async()=>{
      await page.locator('[data-slot="0"]').click();await page.keyboard.type('ac3pjo9e6e4o4p3o5p2o');
      await page.waitForFunction(()=>theibsApp.getState().lastAnalysis?.data.status==='OK');
      assert.equal(await page.evaluate(()=>theibsApp.getState().lastAnalysis.data.equity.opponents),5);
      assert.notEqual(await page.locator('#ev-value').innerText(),'—');assert.match(await page.locator('#ev-assumption').innerText(),/aleatórias/);
      await page.screenshot({path:path.join(out,native?'electron.png':'dashboard.png')});
    });
    await check('Dashboard fits without page scrolling at desktop sizes',async()=>{
      const sizes=native?[[1440,900]]:[[1702,980],[1440,900],[1366,768],[1024,700]];
      for(const [width,height]of sizes){await page.setViewportSize({width,height});const metric=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,panels:[...document.querySelectorAll('#analyze-workspace .table-surface,#flow-controls,.card-keyboard,#ev-summary,#flow-players,#flow-history')].map(el=>{const r=el.getBoundingClientRect();return {id:el.id||el.className,x:r.x,y:r.y,right:r.right,bottom:r.bottom};})}));report.layouts.push(metric);assert.ok(metric.scrollHeight<=height&&metric.scrollWidth<=width);assert.ok(metric.panels.every(r=>r.bottom<=height&&r.right<=width&&r.y>=0));if(!native)await page.screenshot({path:path.join(out,`layout-${width}.png`)});}
      await page.setViewportSize({width:1440,height:900});
    });
    await check('EV signs and colors use real win, loss and break-even calculations',async()=>{
      await page.locator('#open-settings').click();await page.locator('#auto-analysis').uncheck();await page.locator('#players').fill('2');await page.locator('#opponentModel').selectOption('EXPLICIT');await page.locator('#opponentHand').fill('ac kc 9p 9o 8o');
      await page.locator('#settings-dialog [data-close-dialog]').click();
      await page.evaluate(()=>theibsCardKeyboard.restore({count:5,selected:0,slots:['AE','KE','2O','3O','6C','QE','JE','TE','4P','5C']}));
      await page.locator('#quick-analyze').click();await page.waitForFunction(()=>!theibsApp.getState().analysisBusy);
      assert.equal(await page.locator('#ev-summary').getAttribute('data-tone'),'positive');
      await page.locator('#open-settings').click();await page.locator('#opponentHand').fill('ae ke 2o 3o 6c');await page.locator('#settings-dialog [data-close-dialog]').click();
      await page.evaluate(()=>theibsCardKeyboard.restore({count:5,selected:0,slots:['AC','KC','9P','9O','8O','QE','JE','TE','4P','5C']}));
      await page.locator('#quick-analyze').click();await page.waitForFunction(()=>!theibsApp.getState().analysisBusy);assert.equal(await page.locator('#ev-summary').getAttribute('data-tone'),'negative');
      await page.locator('#open-settings').click();await page.locator('#potBeforeAction').fill('4');await page.locator('#opponentHand').fill('ac kp 9p 9o 8c');await page.locator('#settings-dialog [data-close-dialog]').click();
      await page.evaluate(()=>theibsCardKeyboard.restore({count:5,selected:0,slots:['AE','KO','8E','7E','6E','QE','JC','TP','4P','5C']}));
      await page.locator('#quick-analyze').click();await page.waitForFunction(()=>!theibsApp.getState().analysisBusy);assert.equal(await page.locator('#ev-summary').getAttribute('data-tone'),'neutral');
    });
    await check('Start tracked hand; F never acts inside a field and undo restores a Fold',async()=>{
      await page.locator('#open-settings').click();await page.locator('#opponentHand').fill('');await page.locator('#opponentModel').selectOption('UNIFORM');await page.locator('#auto-analysis').check();await page.locator('#settings-dialog [data-close-dialog]').click();
      await page.evaluate(()=>theibsCardKeyboard.restore({count:5,selected:0,slots:['AE','KC','QO','JP','TE',null,null,null,null,null]}));
      await page.locator('#flow-start').click();await page.locator('#flow-count').selectOption('3');await page.locator('#flow-position').selectOption('BTN');await page.locator('#flow-confirm-start').click();await page.waitForFunction(()=>TheibsFlow.getState()?.actor===2&&!TheibsFlow.isBusy());
      assert.equal((await flow()).pot,1.5);assert.equal((await flow()).board.length,0);
      await page.locator('#open-settings').click();await page.locator('#opponentHand').focus();await page.keyboard.type('f');assert.equal((await flow()).heroFolded,false);await page.locator('#opponentHand').fill('');await page.locator('#settings-dialog [data-close-dialog]').click();
      await page.locator('[data-slot="0"]').click();await page.keyboard.press('f');await page.waitForFunction(()=>TheibsFlow.getState().heroFolded&&!TheibsFlow.isBusy());
      await page.locator('#flow-undo').click();await page.waitForFunction(()=>!TheibsFlow.getState().heroFolded&&!TheibsFlow.isBusy());assert.equal((await flow()).actor,2);
    });
    await check('Natural calls and BB check close preflop; entering flop advances the round',async()=>{
      await act('CALL');assert.equal((await flow()).actor,0);await act('CALL');await act('CHECK');assert.equal((await flow()).phase,'WAIT_BOARD');assert.equal((await flow()).pot,3);
      await page.locator('[data-slot="5"]').click();await page.keyboard.type('7e8c9o');await page.waitForFunction(()=>TheibsFlow.getState().street==='FLOP'&&!TheibsFlow.isBusy());assert.equal((await flow()).actor,0);
    });
    await check('Opponent bet, fold and hero call update pot, players and price',async()=>{
      await act('BET');await page.locator('#flow-size').fill('1');await page.locator('#flow-confirm-size').click();await page.waitForFunction(()=>TheibsFlow.getState().actor===1&&!TheibsFlow.isBusy());
      await act('FOLD');assert.equal((await flow()).actor,2);assert.equal((await flow()).heroToCall,1);assert.equal((await flow()).activePlayers,2);
      await act('CALL');assert.equal((await flow()).phase,'WAIT_BOARD');assert.equal((await flow()).pot,5);
    });
    await check('Tracked hand survives reload with the same actions and chips',async()=>{
      const before=await flow();await page.evaluate(()=>theibsApp.flushSave());await page.waitForFunction(()=>!theibsApp.getState().saveDirty&&!theibsApp.getState().saveBusy);
      await page.reload();await page.evaluate(()=>theibsApp.ready);assert.deepEqual(await flow(),before);
    });
    await check('Turn, river, showdown, settlement and historical save complete the hand',async()=>{
      await page.locator('[data-slot="8"]').click();await page.keyboard.type('5p');await page.waitForFunction(()=>TheibsFlow.getState().street==='TURN'&&!TheibsFlow.isBusy());await act('CHECK');await act('CHECK');
      await page.locator('[data-slot="9"]').click();await page.keyboard.type('2e');await page.waitForFunction(()=>TheibsFlow.getState().street==='RIVER'&&!TheibsFlow.isBusy());await act('CHECK');await act('CHECK');
      assert.equal((await flow()).phase,'SHOWDOWN');await page.locator('#flow-settle').click();await page.locator('[data-pot="0"][value="2"]').check();await page.locator('#flow-confirm-result').click();await page.waitForFunction(()=>TheibsFlow.getState().phase==='FINISHED'&&!TheibsFlow.isBusy());
      assert.equal((await flow()).players.reduce((sum,p)=>sum+p.stack,0),300);await page.locator('#flow-save').click();await page.waitForFunction(()=>TheibsFlow.serialize().archived);
      await page.locator('[data-view="history"]').click();await page.waitForFunction(()=>document.querySelector('#history-recent').textContent.includes('Mãos acompanhadas'));
      await page.locator('[data-view="analyze"]').click();
    });
    await check('No JavaScript errors',()=>assert.deepEqual(report.errors,[]));
    await check('Starting before receiving cards keeps keyboard entry on private cards',async()=>{
      await page.locator('#new-hand').click();await page.locator('#flow-start').click();await page.locator('#flow-count').selectOption('3');await page.locator('#flow-position').selectOption('BTN');await page.locator('#flow-confirm-start').click();await page.waitForFunction(()=>!TheibsFlow.isBusy()&&Boolean(TheibsFlow.getState()));
      assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.selected),0);
      await page.locator('[data-slot="0"]').focus();await page.keyboard.type('detcqoaejp');await page.waitForFunction(()=>!TheibsFlow.isBusy());
      assert.deepEqual(await page.evaluate(()=>theibsCardKeyboard.state.cards().hero),['TE','TC','QO','AE','JP']);assert.equal((await flow()).board.length,0);
      await page.waitForFunction(()=>theibsApp.getState().lastAnalysis?.data.status==='OK');
      await page.screenshot({path:path.join(out,native?'electron-active-hand.png':'active-hand.png')});
    });
    await page.evaluate(()=>theibsApp.flushSave());
  }catch(error){report.failure=error.stack;if(page)await page.screenshot({path:path.join(out,`failure-${native?'electron':'edge'}.png`)}).catch(()=>{});throw error;}
  finally{fs.writeFileSync(path.join(out,`${native?'electron':'edge'}-report.json`),JSON.stringify(report,null,2));if(browser)await browser.close();if(electron){try{await electron.evaluate(({app})=>app.exit(0));}catch{}await electron.close();}if(server)await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
