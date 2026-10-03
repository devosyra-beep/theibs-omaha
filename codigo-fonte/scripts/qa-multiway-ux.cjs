'use strict';
// Scoped UX measurement. No user profile, account or workspace is opened.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-ux-measure-'));
process.env.THEIBS_WORKSPACE_PATH=path.join(temp,'workspace.json');
process.env.THEIBS_DATA_PATH=path.join(temp,'events.jsonl');
process.env.THEIBS_LLM_CONFIG_PATH=path.join(temp,'llm.json');process.env.THEIBS_LLM_PROVIDER='none';
const output=path.resolve(__dirname,'../../validacao/multiway-ux');fs.mkdirSync(output,{recursive:true});
const {server}=require('../server');
(async()=>{
  const final=process.argv.includes('--final');const report={status:'RUNNING',mode:final?'final verification':'baseline observation',timings:[],layouts:[],errors:[]};let browser,page;
  const state=()=>page.evaluate(()=>({app:theibsApp.getState(),keyboard:theibsKeyboard.getState(),cards:theibsCardKeyboard.state.slots}));
  const settle=async()=>{await page.evaluate(()=>theibsKeyboard.queue.idle());await page.waitForFunction(()=>!theibsApp.getState().multiwayBusy&&!theibsKeyboard.getState().actionPending);};
  const capture=()=>page.locator('#analyze-workspace .table-surface').evaluate(node=>{node.tabIndex=0;node.focus({preventScroll:true});});
  const start=async(playerCount=4,variant='PLO5_HIGH')=>{await page.evaluate(({playerCount,variant})=>theibsApp.keyboard.startTracking({variant,playerCount,heroPosition:'BTN',startingStack:100,smallBlind:.5,bigBlind:1,heroCards:[]}),{playerCount,variant});await settle();await capture();};
  const proxy=fail=>page.evaluate(fail=>{window.__qaOriginalAction??=theibsMultiwayUI.keyboardAction;window.__qaActions=[];theibsMultiwayUI.keyboardAction=async(...args)=>{__qaActions.push(args[0]);await new Promise(resolve=>setTimeout(resolve,450));return fail?false:__qaOriginalAction(...args);};},fail);
  const unproxy=()=>page.evaluate(()=>{theibsMultiwayUI.keyboardAction=__qaOriginalAction;});
  const measure=async(key,kind)=>{
    await page.evaluate(({key,kind})=>{
      const state=theibsApp.getState(),before={actor:state.multiwayState.actor,handId:state.multiway.handId,phase:state.multiwayState.phase,label:document.querySelector('#mw-actor').textContent};
      window.__qaTiming=new Promise(resolve=>{
        const onKey=event=>{if(event.key.toLowerCase()!==key.toLowerCase())return;window.removeEventListener('keydown',onKey,true);const started=performance.now();let accepted=null;
          const tick=()=>{const state=theibsApp.getState(),changed=kind==='hand'?state.multiway.handId!==before.handId:kind==='closing'?document.querySelector('#mw-completion-dialog').open:state.multiwayState.actor!==before.actor;
            if(changed&&accepted===null)accepted=performance.now()-started;
            if(changed&&((kind==='closing')||document.querySelector('#mw-actor').textContent!==before.label))requestAnimationFrame(()=>resolve({key,kind,acceptedMs:accepted,paintedMs:performance.now()-started,before,after:{actor:state.multiwayState.actor,handId:state.multiway.handId,phase:state.multiwayState.phase,label:document.querySelector('#mw-actor').textContent}}));
            else if(performance.now()-started>5000)resolve({key,kind,timeout:true,before});else requestAnimationFrame(tick);
          };requestAnimationFrame(tick);
        };window.addEventListener('keydown',onKey,true);
      });
    },{key,kind});if(kind==='hand'){await page.keyboard.down(key);await page.keyboard.down(key);await page.keyboard.up(key);}else await page.keyboard.press(key);const value=await page.evaluate(()=>window.__qaTiming);report.timings.push(value);console.log('TIMING',JSON.stringify(value));await settle();return value;
  };
  const geometry=()=>page.evaluate(()=>{
    const box=node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,visible:r.width>0&&r.height>0&&s.display!=='none',inside:r.x>=-1&&r.y>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1};};
    const nodes=[...document.querySelectorAll('#analysis-seats .multiway-seat,#hero-slots .playing-card,#board-slots .playing-card,.hero-seat,.table-pot-summary')].map(node=>({label:node.className,text:node.textContent.trim().slice(0,35),...box(node)})).filter(node=>node.visible),overlaps=[];
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j],width=Math.min(a.right,b.right)-Math.max(a.x,b.x),height=Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y);if(width>1&&height>1)overlaps.push({a:a.text,b:b.text,width,height});}
    return {viewport:{width:innerWidth,height:innerHeight},scrollHeight:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth,table:box(document.querySelector('.table-surface')),keyboard:box(document.querySelector('.card-keyboard')),footer:box(document.querySelector('.mw-secondary-footer')),outside:nodes.filter(node=>!node.inside),overlaps};
  });
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1020,height:760}});page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/app`);await page.evaluate(()=>theibsApp.ready);await start();
    await measure('g','actor');await measure('g','actor');await measure('g','actor');
    let before=await state();await page.keyboard.press('Enter');await settle();let after=await state();report.enter={eventsBefore:before.app.multiway.events.length,eventsAfter:after.app.multiway.events.length,actorBefore:before.app.multiwayState.actor,actorAfter:after.app.multiwayState.actor};
    before=after;await page.keyboard.press('Backspace');await settle();after=await state();report.backspace={eventsBefore:before.app.multiway.events.length,eventsAfter:after.app.multiway.events.length,selectionBefore:before.keyboard.selectedActionId,selectionAfter:after.keyboard.selectedActionId,actorBefore:before.app.multiwayState.actor,actorAfter:after.app.multiwayState.actor};console.log('KEYS',JSON.stringify({enter:report.enter,backspace:report.backspace}));
    assert.equal(report.enter.eventsBefore,report.enter.eventsAfter);assert.equal(report.backspace.eventsBefore,report.backspace.eventsAfter);assert.ok(after.keyboard.selectedActionId);await page.keyboard.press('Enter');await settle();assert.equal((await state()).keyboard.selectedActionId,null);
    await start();await proxy(false);
    before=await state();await capture();await page.keyboard.press('g');await page.waitForTimeout(40);await page.keyboard.press('g');await page.waitForTimeout(1100);await settle();after=await state();
    const requests=await page.evaluate(()=>__qaActions);report.delayedQueue={delayMs:450,keyGapMs:40,transport:'UI adapter proxy; authoritative ledger runs in browser worker',keysSent:2,requests:requests.length,actors:requests.map(item=>item.actor),eventsBefore:before.app.multiway.events.length,eventsAfter:after.app.multiway.events.length,actorAfter:after.app.multiwayState.actor};console.log('QUEUE',JSON.stringify(report.delayedQueue));assert.equal(requests.length,2);assert.equal(after.app.multiway.events.length-before.app.multiway.events.length,2);
    await measure('g','actor');await unproxy();
    await proxy(false);await page.keyboard.press('g');await page.waitForTimeout(40);await page.keyboard.press('g');await settle();report.streetBoundary={requests:await page.evaluate(()=>__qaActions.length),phase:(await state()).app.multiwayState.phase};assert.equal(report.streetBoundary.requests,1);assert.equal(report.streetBoundary.phase,'WAIT_BOARD');await unproxy();
    await start();await proxy(true);before=await state();await page.keyboard.press('g');await page.waitForTimeout(40);await page.keyboard.press('g');await settle();after=await state();report.failedQueue={requests:await page.evaluate(()=>__qaActions.length),eventsBefore:before.app.multiway.events.length,eventsAfter:after.app.multiway.events.length};assert.equal(report.failedQueue.requests,1);assert.equal(after.app.multiway.events.length,before.app.multiway.events.length);await unproxy();
    await start();await page.keyboard.press('h');await page.locator('#keyboard-amount').waitFor({state:'visible'});before=await state();await page.locator('#keyboard-amount').fill('23');await page.keyboard.press('Backspace');await page.keyboard.type('fgh');after=await state();report.native={value:await page.locator('#keyboard-amount').inputValue(),eventsBefore:before.app.multiway.events.length,eventsAfter:after.app.multiway.events.length,handUnchanged:before.app.multiway.handId===after.app.multiway.handId,selectedUnchanged:before.keyboard.selectedPlayerId===after.keyboard.selectedPlayerId};await page.locator('#keyboard-amount-close').click();
    assert.equal(report.native.eventsBefore,report.native.eventsAfter);assert.equal(report.native.value,'2');
    await start();await page.keyboard.press('f');await settle();await page.keyboard.press('f');await settle();await measure('f','closing');before=await state();await measure('Enter','hand');after=await state();report.nextHand={before:before.app.multiway.handNumber,after:after.app.multiway.handNumber,pot:after.app.multiwayState.pot};assert.equal(after.app.multiway.handNumber,before.app.multiway.handNumber+1);assert.equal(after.app.multiway.events.length,0);assert.equal(after.app.multiwayState.pot,1.5);
    for(const [playerCount,variant] of [[4,'PLO5_HIGH'],[6,'PLO5_HIGH'],[4,'PLO6_HIGH'],[5,'PLO6_HIGH']]){
      await start(playerCount,variant);await page.keyboard.press('m');await page.keyboard.type(variant==='PLO5_HIGH'?'AOKPQEJCDO':'AOKPQEJCDO9P');await settle();await page.keyboard.press('Control+2');await page.keyboard.type('2E3C4O');await settle();
      for(const viewport of [{width:1020,height:760},{width:1366,height:768},{width:1920,height:855}]){
        await page.setViewportSize(viewport);if(await page.locator('#open-card-picker').getAttribute('aria-expanded')!=='true')await page.locator('#open-card-picker').click();await page.evaluate(()=>{scrollTo(0,0);return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
        const item={playerCount,variant,...await geometry()};report.layouts.push(item);console.log('LAYOUT',JSON.stringify({playerCount,variant,width:viewport.width,height:item.scrollHeight,overlaps:item.overlaps.length,outside:item.outside.length,footerBottom:item.footer.bottom}));await page.screenshot({path:path.join(output,`${final?'final':'baseline'}-${playerCount}players-${variant}-${viewport.width}.png`),fullPage:false});
      }
    }
    if(final){for(const layout of report.layouts){assert.equal(layout.overlaps.length,0,`Overlap ${layout.playerCount}/${layout.variant}/${layout.viewport.width}`);assert.equal(layout.outside.length,0);assert.ok(layout.scrollHeight<=layout.viewport.height+1);assert.ok(layout.scrollWidth<=layout.viewport.width+1);}assert.ok(report.timings.every(item=>!item.timeout));assert.deepEqual(report.errors,[]);}report.status=final?'PASS':'OBSERVED';
  }catch(error){report.status='ERROR';report.failure=error.stack;if(page)await page.screenshot({path:path.join(output,'baseline-failure.png'),fullPage:true});throw error;}
  finally{fs.writeFileSync(path.join(output,final?'final.json':'baseline.json'),JSON.stringify(report,null,2));if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
