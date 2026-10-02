'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/simulation-ui.js'),'utf8');
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture({stepFailures=0,decisionContract=null,stepGate=null}={}){
  function node(){return {innerHTML:'',open:false,handlers:{},setAttribute(){},querySelector(){return null;},querySelectorAll(){return [];},addEventListener(type,fn){this.handlers[type]=fn;},close(){this.open=false;},showModal(){this.open=true;}};}
  const host=node(),local=new Map(),pending=[],requests=[];let owner='account-a';
  const state={heroId:0,actor:0,phase:'BETTING',street:'PREFLOP',revisionKey:'revision-a',board:[],bigBlind:1,pot:1.5,players:[{id:0,hero:true,position:'SB',name:'You',stack:9.5,streetPaid:.5},{id:1,position:'BB',name:'Bot 2',stack:9,streetPaid:1}],legal:{actions:['FOLD','CALL','RAISE'],toCall:.5,minTo:2,maxTo:3}};
  const session={id:'session-a',revision:0,multiway:{handId:'hand-a',config:{variant:'PLO5_HIGH',heroCards:['As','Kh','Qd','Jc','2s']},events:[]},state,policy:{version:'MULTIWAY_CONTEXT_POLICY_V2'},deal:{commitment:'fixed'},finished:false};
  const window={TheibsSimulationTools:require('../public/simulation-tools'),EssenceUI:{esc:s=>String(s??''),money:n=>n==null?'—':String(n),canonicalCard:c=>`<span>${c||'empty'}</span>`,multiwaySeats:()=>''},
    theibsMultiwayUI:{describeDecisionEV:decisionContract||((state,data)=>({rows:state.legal.actions.map(action=>({action,optionId:action,status:data?'MODELED':'PENDING',evBB:data?.ev.actions[action]?.ev??null})),stage:data?'FINAL':'PENDING'}))},
    TheibsBrowserMultiwayClient:{create:()=>({supported:true,close(){},analyze:(_,options)=>new Promise(resolve=>pending.push({resolve,options}))})}};
  const document={createElement:()=>node(),body:{append(){}},getElementById:()=>host,addEventListener(){},querySelector:()=>null};
  const localStorage={getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v)};
  local.set('theibs.simulation.v1.account-a',JSON.stringify({sessionId:session.id,reports:[],decisions:[]}));
  const request=async(url,options)=>{
    assert.equal(options.headers['Content-Type'],'application/json');const body=JSON.parse(options.body);requests.push({url,body});
    if(url.endsWith('/state'))return {session:structuredClone(session)};
    if(url.endsWith('/input'))return {input:{multiway:structuredClone(session.multiway),multiwayEvaluation:{revisionKey:state.revisionKey}}};
    if(url.endsWith('/step')){if(stepGate)await stepGate;if(stepFailures-->0)throw new TypeError('Failed to fetch');return {session:{...structuredClone(session),revision:1,finished:true,outcome:{heroNet:-.5},state:{...state,phase:'FINISHED',revisionKey:'revision-b',result:{pots:[{amount:1.5}]},legal:{actions:[]}}}};}
    throw Error('Unexpected simulation endpoint');
  };
  vm.runInNewContext(source,{window,document,localStorage,structuredClone,AbortController,crypto:require('node:crypto').webcrypto,performance,setTimeout,Blob,URL,FormData});
  window.TheibsSimulationUI.init({request,getOwner:()=>owner});
  const click=async op=>host.handlers.click({target:{closest:selector=>selector==='[data-sim-op]'?{dataset:{simOp:op,action:'FOLD'}}:null}});
  const result={status:'OK',analysisStage:'FINAL',observedState:{revisionKey:state.revisionKey},ev:{actions:{FOLD:{ev:0},CALL:{ev:123},RAISE:{ev:456}}},equity:{equity:.9}};
  return {ui:window.TheibsSimulationUI,host,local,pending,requests,click,result,setOwner:value=>{owner=value;}};
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
  f.ui.clearOwner();f.pending[0].resolve(f.result);await settle();assert.doesNotMatch(f.host.innerHTML,/123|456|As/);
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

test('the leader is prominent and preselects only its legal sizing, while overlap stays inconclusive',async()=>{
  const f=fixture({decisionContract:(state,data)=>data?{stage:'INCONCLUSIVE',rows:[{action:'CALL',optionId:'CALL',status:'MODELED',evBB:2,differenceBB:1},{action:'RAISE',size:2.5,optionId:'RAISE:2.5',status:'MODELED',evBB:3,differenceBB:0}],precision:{bestActionId:'RAISE:2.5',status:'INCONCLUSIVE',reason:'Bounds overlap.'},gapBestSecondBB:1,missingLegalActions:[]}:null});
  await f.ui.enter();await settle();f.pending[0].resolve(f.result);await settle();f.pending[1].resolve(f.result);await settle();
  assert.match(f.host.innerHTML,/Current EV leader<\/span><strong>Raise to 2.5/);
  assert.match(f.host.innerHTML,/INCONCLUSIVE · Bounds overlap/);assert.doesNotMatch(f.host.innerHTML,/Best modeled action/);
  assert.match(f.host.innerHTML,/data-action="RAISE" data-to="2.5"/);assert.match(f.host.innerHTML,/EV shortfall · bb/);
});
