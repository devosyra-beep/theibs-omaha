'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium,_electron}=require('playwright');
(async()=>{
 const version=require('../package.json').version,native=process.argv.includes('--electron'),mode=native?'electron':'edge';
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-shift-')),out=path.resolve(__dirname,'../../validacao/shift-v'+version);fs.mkdirSync(out,{recursive:true});
 Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json')});
 const keyboard={count:6,selected:0,slots:['AE','KE','2C','3O','4P','5P','QE','JE','TE',null,null]};
 fs.writeFileSync(process.env.THEIBS_WORKSPACE_PATH,JSON.stringify({revision:1,workspace:{schemaVersion:1,keyboard,fields:{players:'5',position:'BTN',potBeforeAction:'12',amountToCall:'4',effectiveStack:'100',samples:'500','auto-analysis':false},ui:{felt:'preto',deck:'cores',view:'analyze',cardDisplayVersion:2,workflowVersion:1},snapshots:[]}}));
 let server,browser,app,page;const report={version,mode,checks:[],errors:[],dialogs:0};
 const focus=()=>page.evaluate(()=>document.activeElement?.blur());
 const refill=async()=>{await page.evaluate(k=>theibsCardKeyboard.restore(k),keyboard);await focus();};
 const count=()=>page.evaluate(()=>theibsCardKeyboard.state.slots.filter(Boolean).length);
 const save=async()=>{await page.evaluate(()=>theibsApp.flushSave());await page.waitForFunction(()=>{const s=theibsApp.getState();return !s.saveBusy&&!s.saveDirty;});};
 try{
  if(native){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;app=await _electron.launch({executablePath:process.env.THEIBS_EXECUTABLE||path.resolve(__dirname,'../../THEIBS/THEIBS.exe'),args:['--user-data-dir='+path.join(temp,'profile')],env});page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>{w.webContents.setBackgroundThrottling(false);w.setIgnoreMouseEvents(true);w.setFocusable(false);}));}
  else{({server}=require('../server'));await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true,channel:'msedge'});page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);}
  page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',async d=>{report.dialogs++;await d.dismiss();});
  await page.waitForFunction(()=>!!window.theibsApp);await page.evaluate(()=>theibsApp.ready);await focus();
  const response=page.waitForResponse(r=>r.url().endsWith('/api/analyze'));await page.locator('#quick-analyze').click();assert.equal((await(await response).json()).status,'OK');await page.waitForFunction(()=>!theibsApp.getState().analysisBusy);assert.equal(await page.locator('#nuts-badge').isVisible(),true);await focus();
  await page.keyboard.down('ShiftLeft');assert.equal(await count(),9);await page.keyboard.up('ShiftLeft');assert.equal(await count(),0);assert.equal(await page.locator('#nuts-badge').isVisible(),false);assert.equal(await page.locator('#hero-equity').innerText(),'—');assert.equal(await page.locator('#ev-value').innerText(),'—');assert.equal(await page.locator('#potBeforeAction').inputValue(),'12');
  await refill();await page.keyboard.press('ShiftRight');assert.equal(await count(),0);
  report.checks.push('Either Shift alone clears private cards, board, EV, equity and NUTS on release, without confirmation, retaining Simple configuration');
  await refill();
  for(const key of ['Shift+Tab','Control+Shift','Alt+Shift','Meta+Shift']){await focus();await page.keyboard.press(key);assert.equal(await count(),9,key);}
  await focus();await page.keyboard.down('Shift');await page.keyboard.press('A');await page.keyboard.up('Shift');await page.keyboard.press('E');assert.equal(await count(),9);assert.equal(await page.evaluate(()=>theibsCardKeyboard.state.slots[0]),'AE');
  await focus();await page.keyboard.down('Shift');await page.locator('[data-slot="1"]').click();await page.keyboard.up('Shift');assert.equal(await count(),9);
  await focus();await page.keyboard.down('Shift');await page.keyboard.down('Shift');await page.keyboard.up('Shift');assert.equal(await count(),9);
  await focus();await page.keyboard.down('ShiftLeft');await page.keyboard.down('ShiftRight');await page.keyboard.up('ShiftLeft');await page.keyboard.up('ShiftRight');assert.equal(await count(),9);
  report.checks.push('Uppercase card entry, Shift+Tab, modifier chords, Shift+click, repeat and both Shift keys do not reset the hand');
  await page.locator('#open-settings').click();await page.locator('#seed').focus();await page.keyboard.press('Shift');assert.equal(await count(),9);await page.locator('#settings-dialog [data-close-dialog]').focus();await page.keyboard.press('Shift');assert.equal(await count(),9);await page.locator('#settings-dialog [data-close-dialog]').click();
  await page.evaluate(()=>{const input=document.createElement('input');input.id='qa-editor';document.body.append(input);input.focus();});await page.keyboard.press('Shift');assert.equal(await count(),9);await page.evaluate(()=>document.getElementById('qa-editor').remove());
  await page.locator('.nav-tab[data-view="train"]').click();await focus();await page.keyboard.press('Shift');assert.equal(await count(),9);await page.locator('.nav-tab[data-view="analyze"]').click();
  await focus();await page.keyboard.down('Shift');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('Shift');assert.equal(await count(),9);
  report.checks.push('Text inputs, dialogs, training tab and interrupted focus ignore the shortcut');
  await page.locator('#open-settings').click();await page.locator('#mw-setup-details>summary').click();await page.locator('#mw-start').click();await page.waitForFunction(()=>theibsApp.getState().multiway&&!theibsApp.getState().multiwayBusy);await focus();await page.keyboard.press('m');await page.waitForFunction(()=>theibsApp.getState().multiway.events.length===1&&!theibsApp.getState().multiwayBusy);
  const config=await page.evaluate(()=>theibsApp.getState().multiway.config);await focus();await page.keyboard.press('Shift');await page.waitForFunction(()=>theibsApp.getState().multiway?.events.length===0&&!theibsApp.getState().multiwayBusy);assert.equal(await count(),0);
  const after=await page.evaluate(()=>theibsApp.getState().multiway);assert.deepEqual(after.config,{...config,heroCards:[]});assert.equal(after.enabled,true);await save();await page.reload();await page.waitForFunction(()=>!!window.theibsApp);await page.evaluate(()=>theibsApp.ready);assert.equal(await count(),0);assert.equal(await page.evaluate(()=>theibsApp.getState().multiway.events.length),0);
  assert.equal(report.dialogs,0);assert.deepEqual(report.errors,[]);report.checks.push('Multiway Shift starts a clean preflop hand, preserves activation/positions/blinds/stacks, clears observed actions and survives reload');report.status='PASS';
 }catch(error){report.status='FAIL';report.failure=error.stack;throw error;}
 finally{fs.writeFileSync(path.join(out,mode+'-report.json'),JSON.stringify(report,null,2));if(browser)await browser.close();if(app){try{await app.evaluate(({app})=>app.exit(0));}catch{}await app.close();}if(server)await new Promise(r=>server.close(r));}
 console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
