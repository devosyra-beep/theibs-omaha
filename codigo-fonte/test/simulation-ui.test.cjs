'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/simulation-ui.js'),'utf8');
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture({stepFailures=0,decisionContract=null,stepGate=null,stateGate=null,statePatch={},sessionPatch={},stepResponse=null,validationFactory=null}={}){
  function node(){return {innerHTML:'',open:false,handlers:{},setAttribute(){},querySelector(){return null;},querySelectorAll(){return [];},addEventListener(type,fn){this.handlers[type]=fn;},close(){this.open=false;},showModal(){this.open=true;}};}
  const host=node(),local=new Map(),pending=[],requests=[];let owner='account-a';
  const state={heroId:0,actor:0,phase:'BETTING',street:'PREFLOP',revisionKey:'revision-a',board:[],bigBlind:1,pot:1.5,players:[{id:0,hero:true,position:'SB',name:'You',stack:9.5,streetPaid:.5},{id:1,position:'BB',name:'Bot 2',stack:9,streetPaid:1}],legal:{actions:['FOLD','CALL','RAISE'],toCall:.5,minTo:2,maxTo:3}};
  Object.assign(state,statePatch);
  const session={id:'session-a',revision:0,multiway:{handId:'hand-a',config:{variant:'PLO5_HIGH',heroCards:['As','Kh','Qd','Jc','2s']},events:[]},state,policy:{version:'MULTIWAY_CONTEXT_POLICY_V2'},deal:{commitment:'fixed'},finished:false};
  Object.assign(session,sessionPatch);
  const window={TheibsSimulationTools:require('../public/simulation-tools'),EssenceUI:{esc:s=>String(s??''),money:n=>n==null?'—':String(n),canonicalCard:c=>`<span>${c||'empty'}</span>`,multiwaySeats:()=>''},
    theibsMultiwayUI:{describeDecisionEV:decisionContract||((state,data)=>({rows:state.legal.actions.map(action=>({action,optionId:action,status:data?'MODELED':'PENDING',evBB:data?.ev.actions[action]?.ev??null})),stage:data?'FINAL':'PENDING'}))},
    TheibsBrowserMultiwayClient:{create:()=>({supported:true,close(){},analyze:(_,options)=>new Promise(resolve=>pending.push({resolve,options}))})}};
  if(validationFactory)window.TheibsSimulationValidation={...require('../public/simulation-validation'),create:validationFactory};
  const elements=[],document={handlers:{},createElement:tag=>{const element=node();element.tagName=tag.toUpperCase();elements.push(element);return element;},body:{append(){}},getElementById:()=>host,addEventListener(type,fn){this.handlers[type]=fn;},querySelector:selector=>selector==='dialog[open]'?elements.find(element=>element.tagName==='DIALOG'&&element.open)||null:null};
  document.activeElement=document.body;
  const localStorage={getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v)};
  local.set('theibs.simulation.v1.account-a',JSON.stringify({sessionId:session.id,reports:[],decisions:[]}));
  const request=async(url,options)=>{
    assert.equal(options.headers['Content-Type'],'application/json');const body=JSON.parse(options.body);requests.push({url,body});
    if(url.endsWith('/state')){if(stateGate)await stateGate;return {session:structuredClone(session)};}
    if(url.endsWith('/input'))return {input:{multiway:structuredClone(session.multiway),multiwayEvaluation:{revisionKey:state.revisionKey}}};
    if(url.endsWith('/step')||url.endsWith('/next')||url.endsWith('/restart')){if(stepGate)await stepGate;if(stepFailures-->0)throw new TypeError('Failed to fetch');if(stepResponse){const result=stepResponse(body,requests);return result.session?result:{session:result};}return {session:{...structuredClone(session),revision:1,finished:true,outcome:{heroNet:-.5},state:{...state,phase:'FINISHED',revisionKey:'revision-b',result:{pots:[{amount:1.5}]},legal:{actions:[]}}}};}
    throw Error('Unexpected simulation endpoint');
  };
  vm.runInNewContext(source,{window,document,localStorage,structuredClone,AbortController,crypto:require('node:crypto').webcrypto,performance,setTimeout,Blob,URL,FormData});
  window.TheibsSimulationUI.init({request,getOwner:()=>owner});
  const click=async op=>host.handlers.click({target:{closest:selector=>selector==='[data-sim-op]'?{dataset:{simOp:op,action:'FOLD'}}:null}});
  const keyboard=(options={})=>{
    const event={key:'Enter',target:document.body,prevented:false,preventDefault(){this.prevented=true;},...options};
    const interactive=node=>node?.isContentEditable||node?.closest?.('button,input,textarea,select,a[href],summary,[role="button"],[contenteditable]');
    const state=window.TheibsSimulationUI.getKeyboardState(),commands=require('../public/keyboard-commands');
    if(commands.canHandleKey(event,{enabled:state.active&&!state.busy&&!state.restoringSession&&!state.pendingIntent&&state.connection==='CONNECTED',hidden:document.hidden,dialog:document.querySelector('dialog[open]'),nativeControl:interactive(event.target)||interactive(document.activeElement)})){
      const command=commands.resolveKey(event,'en-US');if(command?.type==='CONFIRM'){event.preventDefault();void window.TheibsSimulationUI.keyboardCommand(command.type);}
    }
    return event;
  };
  const result={status:'OK',analysisStage:'FINAL',observedState:{revisionKey:state.revisionKey},ev:{actions:{FOLD:{ev:0},CALL:{ev:123},RAISE:{ev:456}}},equity:{equity:.9}};
  return {ui:window.TheibsSimulationUI,host,local,pending,requests,click,keyboard,result,state,session,document,dialogs:elements.filter(element=>element.tagName==='DIALOG'),setOwner:value=>{owner=value;}};
}
test('acting before EV finishes retains an unavailable decision snapshot and rejects a late result',async()=>{
  const f=fixture();await f.ui.enter();await settle();assert.equal(f.pending.length,1);assert.match(f.host.innerHTML,/Calculating/);
  assert.equal(f.requests.some(item=>item.url.endsWith('/input')),false,'Browser EV uses the public ledger without a dealer network round trip');
  await f.click('ACT');assert.equal(f.pending[0].options.signal.aborted,true);
  const saved=JSON.parse(f.local.get('theibs.simulation.v1.account-a'));assert.equal(saved.reports.length,1);
  assert.equal(saved.reports[0].decisions[0].evaluation,null);assert.equal(saved.reports[0].decisions[0].publicInput.events.length,0);
  f.pending[0].resolve(f.result);await settle();assert.doesNotMatch(f.host.innerHTML,/123|456|90%/);
  assert.equal(JSON.parse(f.local.get('theibs.simulation.v1.account-a')).reports[0].decisions[0].evaluation,null);
});

test('an ordinary pending action does not insert recovery controls or acknowledgement text',async()=>{
  let release;const f=fixture({stepGate:new Promise(resolve=>{release=resolve;})});
  await f.ui.enter();await settle();const acting=f.click('ACT');await settle();
  assert.doesNotMatch(f.host.innerHTML,/Retry last request|Last confirmed decision/);
  assert.ok(JSON.parse(f.local.get('theibs.simulation.v1.account-a')).pendingIntent,'Operation is still persisted for safe recovery');
  assert.match(f.host.innerHTML,/data-sim-op="ACT" disabled/);
  release();await acting;assert.equal(JSON.parse(f.local.get('theibs.simulation.v1.account-a')).pendingIntent,null);
});

test('an exhausted connection retains an uncertain intent, and manual retry reuses its identity and original snapshot once',async()=>{
  const f=fixture({stepFailures:2});await f.ui.enter();await settle();await f.click('ACT');
  let saved=JSON.parse(f.local.get('theibs.simulation.v1.account-a'));
  assert.equal(saved.session.id,'session-a');assert.equal(saved.decisions.length,0);assert.equal(saved.pendingIntent.operation,'ACT');
  assert.match(f.host.innerHTML,/Retry last request/);
  assert.match(f.host.innerHTML,/data-sim-op="RETRY" >Retry last request/,'The recovery button stays enabled while offline');
  const identity=saved.pendingIntent.body.requestId;await f.click('RETRY');
  saved=JSON.parse(f.local.get('theibs.simulation.v1.account-a'));assert.equal(saved.pendingIntent,null);
  assert.equal(saved.reports[0].decisions.length,1);assert.equal(saved.reports[0].decisions[0].evaluation,null);
  assert.equal(saved.progress.entries.filter(row=>row.kind==='SETTLED').length,1);assert.equal(saved.progress.entries[0].netCents,-50);
  const events=f.requests.filter(row=>row.url.endsWith('/step'));assert.equal(events.length,3);assert.ok(events.every(row=>row.body.requestId===identity));
});
test('leaving or clearing the account cancels evaluation without erasing or resurrecting a hand',async()=>{
  const f=fixture();await f.ui.enter();await settle();f.ui.leave();assert.equal(f.pending[0].options.signal.aborted,true);
  assert.equal(JSON.parse(f.local.get('theibs.simulation.v1.account-a')).sessionId,'session-a');
  f.ui.clearOwner();f.pending[0].resolve(f.result);await settle();assert.doesNotMatch(f.host.innerHTML,/123|456|<span>As<\/span>/);
  assert.match(f.host.innerHTML,/Start simulation/);assert.equal(f.requests.filter(item=>item.url.endsWith('/step')).length,0);
  assert.doesNotMatch(f.host.innerHTML,/-0.5 chips/);assert.match(f.host.innerHTML,/1,000.00/);
});

test('progress survives reload separately from history without booking a payout twice',async()=>{
  const f=fixture();await f.ui.enter();await settle();await f.click('ACT');
  const original=JSON.parse(f.local.get('theibs.simulation.v1.account-a'));
  assert.equal(original.progress.entries[0].netCents,-50);
  original.reports=[];f.local.set('theibs.simulation.v1.account-a',JSON.stringify(original));
  f.ui.clearOwner();await f.ui.enter();await settle();
  const restored=JSON.parse(f.local.get('theibs.simulation.v1.account-a'));
  assert.equal(restored.progress.entries.length,1);assert.equal(restored.progress.entries[0].netCents,-50);
  assert.match(f.host.innerHTML,/-0.5 chips/);assert.match(f.host.innerHTML,/999.50/);
});

test('the leader remains informational and the raise control requires explicit sizing, while overlap stays inconclusive',async()=>{
  const f=fixture({decisionContract:(state,data)=>data?{stage:'INCONCLUSIVE',rows:[{action:'CALL',optionId:'CALL',status:'MODELED',evBB:2,differenceBB:1},{action:'RAISE',size:2.5,optionId:'RAISE:2.5',status:'MODELED',evBB:3,differenceBB:0}],precision:{bestActionId:'RAISE:2.5',status:'INCONCLUSIVE',reason:'Bounds overlap.'},gapBestSecondBB:1,missingLegalActions:[]}:null});
  await f.ui.enter();await settle();f.pending[0].resolve(f.result);await settle();f.pending[1].resolve(f.result);await settle();
  assert.match(f.host.innerHTML,/Current EV leader<\/span><strong>Raise to 2.5/);
  assert.match(f.host.innerHTML,/INCONCLUSIVE · Bounds overlap/);assert.doesNotMatch(f.host.innerHTML,/Best modeled action/);
  assert.match(f.host.innerHTML,/data-action="RAISE" data-estimate-leader="true"/);assert.doesNotMatch(f.host.innerHTML,/data-action="RAISE" data-to=/);assert.match(f.host.innerHTML,/EV shortfall · bb/);
});

const leaderContract=(action='RAISE',size=2.5,stage='INCONCLUSIVE')=>(state,data)=>data?{
  stage,rows:[{action, ...(size==null?{}:{size}),optionId:`${action}:${size}`,status:'MODELED',evBB:3,differenceBB:0}],
  precision:{bestActionId:`${action}:${size}`,status:'INCONCLUSIVE',reason:'Bounds overlap.'},missingLegalActions:[]
}:null;
async function finishEV(f){f.pending[0].resolve(f.result);await settle();f.pending[1].resolve(f.result);await settle();}

test('Enter keeps an available EV leader informational; an explicit action preserves its frozen decision snapshot',async()=>{
  const f=fixture({decisionContract:leaderContract()});await f.ui.enter();await settle();await finishEV(f);
  assert.doesNotMatch(f.host.innerHTML,/EV leader · Enter|data-to="2.5" data-sim-enter/);
  assert.equal(f.keyboard().prevented,true);await settle();
  assert.equal(f.requests.some(row=>row.url.endsWith('/step')),false,'Enter never applies the EV leader');
  assert.match(f.host.innerHTML,/Choose F, G or H for this turn/);
  assert.equal(f.dialogs.some(dialog=>dialog.open),false,'Enter does not open the sizing editor');
  await f.click('ACT');
  const step=f.requests.find(row=>row.url.endsWith('/step'));assert.equal(step.body.operation,'ACT');assert.equal(step.body.action,'FOLD');assert.equal(step.body.to,undefined);
  const saved=JSON.parse(f.local.get('theibs.simulation.v1.account-a'));
  assert.equal(saved.reports[0].decisions.length,1);assert.equal(saved.reports[0].decisions[0].chosen.action,'FOLD');assert.equal(saved.reports[0].decisions[0].chosen.size,null);
  assert.equal(saved.reports[0].decisions[0].revisionKey,'revision-a');assert.equal(saved.reports[0].decisions[0].publicInput.events.length,0);
});

test('Enter stays navigational while evaluation is pending, provisional, illegal, stale or fractional',async()=>{
  const pending=fixture();await pending.ui.enter();await settle();pending.keyboard();await settle();
  assert.equal(pending.requests.filter(row=>row.url.endsWith('/step')).length,0);assert.match(pending.host.innerHTML,/Choose F, G or H for this turn/);
  for(const [name,contract,stale] of [['provisional',leaderContract('RAISE',2.5,'PROVISIONAL')],['illegal action',leaderContract('BET',2.5)],['illegal total',leaderContract('RAISE',4)],['fractional cent',leaderContract('RAISE',2.505)],['stale revision',leaderContract(),true]]){
    const f=fixture({decisionContract:contract});await f.ui.enter();await settle();if(stale)f.result.observedState.revisionKey='old-revision';await finishEV(f);f.keyboard();await settle();
    assert.equal(f.requests.filter(row=>row.url.endsWith('/step')).length,0,name);assert.match(f.host.innerHTML,/Choose F, G or H for this turn/,name);
  }
});

test('Enter respects interactive target and focus, dialogs, IME, repeats, modifiers, hidden pages and cancellation',async()=>{
  for(const [name,options,prepare] of [
    ['input',{target:{closest:()=>({tagName:'INPUT'})}}],['button',{target:{closest:()=>({tagName:'BUTTON'})}}],
    ['editable',{target:{isContentEditable:true}}],['focused control',{},f=>{f.document.activeElement={closest:()=>({tagName:'SELECT'})};}],
    ['dialog',{},f=>{f.dialogs[0].open=true;}],['IME',{isComposing:true}],['legacy IME',{keyCode:229}],['repeat',{repeat:true}],
    ['control',{ctrlKey:true}],['alt',{altKey:true}],['meta',{metaKey:true}],['shift',{shiftKey:true}],['handled',{defaultPrevented:true}],
    ['hidden',{},f=>{f.document.hidden=true;}],['inactive',{},f=>f.ui.leave()]
  ]){
    const f=fixture({decisionContract:leaderContract()});await f.ui.enter();await settle();await finishEV(f);prepare?.(f);const event=f.keyboard(options);await settle();
    assert.equal(event.prevented,false,name);assert.equal(f.requests.filter(row=>row.url.endsWith('/step')).length,0,name);
  }
});

test('an explicit pending action and an offline uncertain intent cannot be resubmitted by Enter',async()=>{
  let release;const f=fixture({decisionContract:leaderContract(),stepGate:new Promise(resolve=>{release=resolve;})});
  await f.ui.enter();await settle();await finishEV(f);const acting=f.click('ACT');await settle();
  assert.equal(f.keyboard().prevented,false);assert.equal(f.keyboard().prevented,false);await settle();
  assert.equal(f.requests.filter(row=>row.url.endsWith('/step')).length,1);release();await acting;await settle();
  const offline=fixture({decisionContract:leaderContract(),stepFailures:2});await offline.ui.enter();await settle();await finishEV(offline);await offline.click('ACT');await settle();
  const before=offline.requests.filter(row=>row.url.endsWith('/step')).length;assert.match(offline.host.innerHTML,/Retry last request/);
  assert.equal(offline.keyboard().prevented,false);await settle();assert.equal(offline.requests.filter(row=>row.url.endsWith('/step')).length,before);
});

test('Enter advances only the highlighted contextual operation outside Hero turns',async()=>{
  for(const [name,statePatch,sessionPatch,operation] of [
    ['opponents',{actor:1},{paused:true},'ADVANCE'],['deal',{phase:'WAIT_BOARD',nextStreet:'FLOP'},{},'DEAL'],
    ['showdown',{phase:'SHOWDOWN'},{},'SETTLE'],['next hand',{phase:'FINISHED'},{finished:true,outcome:{heroNet:0}},'NEXT']
  ]){
    const f=fixture({statePatch,sessionPatch});await f.ui.enter();await settle();assert.match(f.host.innerHTML,/data-sim-enter/);f.keyboard();await settle();
    const step=f.requests.find(row=>row.url.endsWith('/step')||row.url.endsWith('/next'));assert.equal(step.body.operation,operation,name);
  }
  const manual=fixture({statePatch:{actor:1},sessionPatch:{manualOpponents:true}});await manual.ui.enter();await settle();manual.keyboard();await settle();
  assert.equal(manual.requests.filter(row=>row.url.endsWith('/step')).length,0,'Unselected manual opponent action is never guessed');
});

test('finished busted or abandoned hands can restart with Enter without double payout or losing progress',async()=>{
  for(const abandoned of [false,true]){
    const statePatch={phase:'FINISHED',players:[{id:0,hero:true,position:'SB',name:'You',stack:0,startingStack:10,streetPaid:.5},{id:1,position:'BB',name:'Bot 2',stack:20,streetPaid:1}]};
    const f=fixture({statePatch,sessionPatch:{finished:true,abandoned,outcome:{heroNet:-10}},stepResponse:()=>({
      previous:structuredClone(f.session),session:{...structuredClone(f.session),id:'new-hand',revision:0,finished:false,abandoned:false,outcome:null,
        state:{...structuredClone(f.state),phase:'WAIT_BOARD',nextStreet:'FLOP',revisionKey:'new-hand-r0',players:f.state.players.map(player=>({...player,stack:10}))}}
    })});
    await f.ui.enter();await settle();const before=JSON.parse(f.local.get('theibs.simulation.v1.account-a'));
    assert.match(f.host.innerHTML,/New deal · fresh stacks/);f.keyboard();await settle();
    const restart=f.requests.find(row=>row.url.endsWith('/restart'));assert.equal(restart.body.operation,'RESTART');
    const after=JSON.parse(f.local.get('theibs.simulation.v1.account-a'));
    assert.deepEqual(after.progress,before.progress);assert.equal(after.reports.length,1);assert.equal(after.session.id,'new-hand');
  }
  const live=fixture();await live.ui.enter();await settle();live.keyboard();await settle();assert.equal(live.requests.some(row=>row.url.endsWith('/restart')),false);
});

test('automatic validation receives frozen public inputs before actions, follows foreground availability and retains its owner preference',async()=>{
  const captured=[],availability=[],preferences=new Map();let scheduler,selectedOwner,automatic=true;
  const f=fixture({decisionContract:leaderContract(),sessionPatch:{dealerSeed:'private-seed',futureRunout:['2d','3d','4d'],multiway:{handId:'hand-a',config:{variant:'PLO5_HIGH',heroCards:['As','Kh','Qd','Jc','2s'],hiddenHands:[['Ac','Ad','Ah','Ks','Kd']]},events:[]}},
    validationFactory:options=>(scheduler={supported:true,state:null,history:[],get automatic(){return automatic;},get diagnostics(){return {queued:captured.length,manualPaused:false};},load(owner){selectedOwner=owner;automatic=preferences.get(owner)??true;},
      setAvailable(value){availability.push({value});},enqueue(items){captured.push(...structuredClone(items));return {added:items.length};},hasDecision:()=>true,
      setAutomatic(value){automatic=value;preferences.set(selectedOwner,value);options.onChange();},clearOwner(){selectedOwner=null;},pause(){},resume(){},stop(){},export(){return null;}})
  });
  await f.ui.enter();await settle();assert.equal(captured.length,1);assert.equal(availability.at(-1).value,false);
  assert.equal(captured[0].record.config.hiddenHands,undefined);assert.equal(captured[0].record.dealerSeed,undefined);assert.equal(captured[0].record.futureRunout,undefined);
  assert.match(captured[0].label,/hand sion-a · revision 0 · frozen decision/);assert.match(f.host.innerHTML,/id="sim-validation-auto" type="checkbox" checked/);
  await finishEV(f);assert.equal(availability.at(-1).value,true);
  f.host.handlers.change({target:{id:'sim-validation-auto',checked:false}});assert.equal(scheduler.automatic,false);assert.doesNotMatch(f.host.innerHTML,/id="sim-validation-auto" type="checkbox" checked/);
  f.keyboard();await settle();assert.equal(captured.length,1,'Navigational Enter does not create a played-decision validation');
  await f.click('ACT');await settle();assert.equal(captured.length,2);assert.equal(captured[1].chosenSize,null);assert.equal(captured[1].record.events.length,0);
  assert.equal(captured[0].record.events.length,0,'Later streets and actions do not mutate the captured decision');
  f.ui.clearOwner();await f.ui.enter();await settle();assert.equal(scheduler.automatic,false,'Automatic preference survives reload for the same owner');
});

test('Enter cannot act on a cached finished phase while authoritative session restoration is unresolved',async()=>{
  let release;const f=fixture({stateGate:new Promise(resolve=>{release=resolve;}),statePatch:{phase:'FINISHED'},sessionPatch:{finished:true,outcome:{heroNet:0}}});
  f.local.set('theibs.simulation.v1.account-a',JSON.stringify({sessionId:f.session.id,session:f.session,reports:[],decisions:[]}));
  const entering=f.ui.enter();await settle();assert.equal(f.keyboard().prevented,false);await settle();
  assert.equal(f.requests.some(row=>row.url.endsWith('/next')||row.url.endsWith('/restart')),false);
  release();await entering;await settle();f.keyboard();await settle();assert.equal(f.requests.find(row=>row.url.endsWith('/next')).body.operation,'NEXT');
});

test('a real-turn opponent keyboard action uses one atomic ACT without a separate PACE request',async()=>{
  const f=fixture({statePatch:{actor:1},sessionPatch:{manualOpponents:false}});await f.ui.enter();await settle();
  assert.equal(await f.ui.keyboardAction('MATCH',null,{id:f.session.id,street:'PREFLOP'}),true);
  const steps=f.requests.filter(row=>row.url.endsWith('/step'));assert.equal(steps.length,1);
  assert.equal(steps[0].body.operation,'ACT');assert.equal(steps[0].body.action,'CALL');assert.equal(steps[0].body.actor,1);assert.equal(steps[0].body.manualOpponents,true);
});

test('keyboard action rejects stale hand/street and does not duplicate an in-flight transport',async()=>{
  let release;const f=fixture({statePatch:{actor:1},stepGate:new Promise(resolve=>{release=resolve;})});await f.ui.enter();await settle();
  assert.equal(await f.ui.keyboardAction('MATCH',null,{id:'different-hand',street:'PREFLOP'}),false);
  assert.equal(await f.ui.keyboardAction('MATCH',null,{id:f.session.id,street:'FLOP'}),false);
  const pending=f.ui.keyboardAction('MATCH',null,{id:f.session.id,street:'PREFLOP'});await settle();
  assert.equal(await f.ui.keyboardAction('MATCH',null,{id:f.session.id,street:'PREFLOP'}),false);
  assert.equal(f.requests.filter(row=>row.url.endsWith('/step')).length,1);release();assert.equal(await pending,true);
});
