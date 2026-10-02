'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const model=require('../public/player-profile-model'),helper=require('../public/player-profile-insights');
const owner='a'.repeat(64),otherOwner='b'.repeat(64),copy=value=>structuredClone(value);
const context=street=>({variant:'PLO5_HIGH',tableFormat:'HEADS_UP_TABLE',initialParticipants:2,street,position:'SB',
  participants:'HEADS_UP',priceBand:'UP_TO_20_PERCENT',legalActions:['CALL','FOLD','RAISE']});
function record(handId='hand-one',events=[]){return {handId,config:{playerCount:2,players:[{playerId:'opponent',name:'Opponent'},{playerId:'hero',name:'Hero'}]},events};}
function library(){
  const store=model.createStore();model.createPlayer(store,{playerId:'opponent',nickname:'<Opponent>'});model.createPlayer(store,{playerId:'second',nickname:'Second'});
  const player=store.players.opponent;
  for(const [index,street] of ['PREFLOP','FLOP','TURN','RIVER'].entries()){
    const ctx=context(street);player.contexts[model.contextKey(ctx)]={context:ctx,counts:{CALL:index+1}};player.observations+=index+1;
  }
  player.notes=[{id:'private',text:'PRIVATE_NOTE',createdAt:new Date().toISOString()}];
  return {schemaVersion:1,store,archive:{},decisions:{}};
}
class Node {
  constructor(){this.hidden=false;this.dataset={};this.innerHTML='';this.textContent='';this.value='';this.listeners={};this.open=false;this.classList={contains:()=>false};}
  addEventListener(name,fn){this.listeners[name]=fn;}
  setAttribute(){} focus(){} close(){this.open=false;} replaceChildren(){this.innerHTML='';} matches(){return false;}
  querySelector(selector){this.nodes ||= new Map();if(!this.nodes.has(selector))this.nodes.set(selector,new Node());return this.nodes.get(selector);}
}
function harness({initial=library(),visible=true}={}){
  const host=new Node(),dialog=new Node(),pending=[];host.hidden=!visible;
  let html='',insights=null,content=null;const message=new Node();
  Object.defineProperty(host,'innerHTML',{get:()=>html,set:value=>{
    html=value;insights=String(value).includes('data-player-insights')?new Node():null;content=insights?new Node():null;
    if(insights){let open=false;insights.dataset.playerDetail='insights';insights.matches=selector=>selector==='[data-player-insights]';
      Object.defineProperty(insights,'open',{get:()=>open,set:value=>{if(open!==value){open=value;pending.push(insights);}}});}
  }});
  host.querySelector=selector=>selector==='[data-player-insights]'?insights:selector==='[data-player-insight-content]'?content:selector==='#players-message'?message:new Node();
  host.querySelectorAll=selector=>insights && (selector==='details[data-player-detail]' || selector==='details[open][data-player-detail]'&&insights.open)?[insights]:[];
  const accounts=new Map([[owner,copy(initial)],[otherOwner,library()]]);let currentOwner,revision=0,failed=false;
  const storage={open:key=>{currentOwner=key;return {library:copy(accounts.get(key)),revision:'r'+revision};},
    commit:value=>{if(failed)throw Error('Storage quota exceeded');accounts.set(currentOwner,copy(value));return {revision:'r'+(++revision)};}};
  const calls={reports:[],diagnostics:[],removed:[]};
  const localStorage={};
  const window={TheibsPlayerProfiles:model,TheibsPlayersStorage:storage,localStorage,
    TheibsPlayerProfileInsights:{...helper,report:options=>{calls.reports.push(copy(options));return helper.report(options);},
      evaluatePrequential:options=>{calls.diagnostics.push(copy(options));return helper.evaluatePrequential(options);}},
    TheibsRangeTemplates:{removePlayer:(...args)=>calls.removed.push(args)}};
  const document={querySelector:()=>host,createElement:()=>dialog,body:{append(){}},dispatchEvent(){}};
  const source=fs.readFileSync(require.resolve('../public/players-ui'),'utf8').replace('window.theibsPlayersUI =',
    'window.__insightsTest={insightBundle,evaluateInsightDiagnostics,renderInsightReport};window.theibsPlayersUI =');
  vm.runInNewContext(source,{window,document,structuredClone,CustomEvent:class{},crypto:require('node:crypto').webcrypto,
    confirm:()=>true,setInterval:()=>1,clearInterval(){}});
  window.theibsPlayersUI.init(owner);
  const flush=()=>{while(pending.length)host.listeners.toggle?.({target:pending.shift()});};
  const click=selector=>host.listeners.click({target:{closest:value=>value===selector?{}:null}});
  return {api:window.theibsPlayersUI,testing:window.__insightsTest,window,host,calls,accounts,localStorage,message,
    get details(){return insights;},get content(){return content;},flush,click,failCommit:()=>{failed=true;}};
}

test('Insights is collapsed, reports at most three exact contexts and renders broad posterior intervals without card inference',()=>{
  const h=harness();assert.equal(h.details.open,false);assert.equal(h.calls.diagnostics.length,0);assert.equal(h.calls.reports.length,0);
  h.details.open=true;h.flush();const html=h.content.innerHTML;
  assert.equal(h.calls.reports.length,3);assert.deepEqual(h.calls.reports.map(row=>row.context.street),['RIVER','TURN','FLOP']);
  assert.match(html,/Current library · confirmed recorded decisions/);assert.match(html,/95% posterior interval/);
  assert.match(html,/0\.0%–100\.0%/);assert.match(html,/No automatic card-range inference/);assert.match(html,/calibration is not established/);
  assert.doesNotMatch(html,/PRIVATE_NOTE/);assert.equal('notes' in h.calls.reports[0].snapshot.players.opponent,false);
  assert.equal(h.calls.reports.every(row=>row.context.position==='SB'),true);
});

test('history diagnostics run only on demand and are cached until the saved revision changes',()=>{
  const h=harness();h.api.beginHand(record());assert.equal(h.calls.diagnostics.length,0);
  h.details.open=true;h.flush();assert.equal(h.calls.diagnostics.length,0,'opening reports does not scan archived histories');
  h.click('[data-insights-evaluate]');assert.equal(h.calls.diagnostics.length,1);
  h.api.render();h.flush();assert.equal(h.calls.diagnostics.length,1);
  const observation={id:'hand-one:action-1',playerId:'opponent',source:'CONFIRMED_EVENT',seatId:0,action:'CALL',context:context('RIVER')};
  h.api.syncObservations({...record(),revisionKey:'next',observations:[observation]});h.flush();
  assert.equal(h.calls.diagnostics.length,1,'a recorded action does not rescan history');
  assert.match(h.content.innerHTML,/Evaluate recorded forecasts/);
  h.click('[data-insights-evaluate]');h.click('[data-insights-evaluate]');assert.equal(h.calls.diagnostics.length,2);
  assert.match(h.content.innerHTML,/Not evaluated: no eligible, measured forecasts/);assert.doesNotMatch(h.content.innerHTML,/>0<\/td>/);
});

test('seat entry uses the exact frozen stored profile and rejects mismatched data before changing the valid scope',()=>{
  const h=harness(),snapshot=h.api.beginHand(record());
  h.api.syncObservations({...record(),revisionKey:'observed',observations:[{id:'hand-one:action-1',playerId:'opponent',source:'CONFIRMED_EVENT',seatId:0,action:'CALL',context:context('RIVER')}]});
  h.api.openInsights('opponent',{profileSnapshot:snapshot,handId:'hand-one',revisionKey:'decision'});h.flush();
  const frozen=h.testing.insightBundle();assert.equal(frozen.binding.scope,'FROZEN_PRE_HAND');assert.equal(frozen.reports[0].opportunities,4);
  assert.equal(h.calls.diagnostics.length,0);h.click('[data-insights-evaluate]');
  assert.equal(h.calls.diagnostics.at(-1).currentHandId,'hand-one');assert.equal(h.calls.diagnostics.at(-1).currentFrozenAt,snapshot.frozenAt);
  assert.match(h.content.innerHTML,/Captured hand hand-one · evidence frozen before the first action/);
  const malformed=copy(snapshot);malformed.players.opponent.observations++;
  assert.throws(()=>h.api.openInsights('opponent',{profileSnapshot:malformed,handId:'hand-one',revisionKey:'decision'}),/does not match/);
  assert.equal(h.testing.insightBundle(),frozen);
  snapshot.players.opponent.contexts={};assert.equal(frozen.reports[0].opportunities,4,'caller mutation cannot change captured evidence');
  h.api.select('second');h.flush();assert.equal(h.testing.insightBundle().binding.scope,'CURRENT_LIBRARY');assert.match(h.content.innerHTML,/Unknown · no confirmed context evidence/);
});

test('logout and owner rebind clear frozen evidence and diagnostic cache, including hidden seat entry',()=>{
  const h=harness({visible:false}),snapshot=h.api.beginHand(record());
  h.api.openInsights('opponent',{profileSnapshot:snapshot,handId:'hand-one',revisionKey:'decision'});
  assert.equal(h.calls.diagnostics.length,0);h.host.hidden=false;h.api.render();h.flush();assert.equal(h.calls.diagnostics.length,0);
  h.click('[data-insights-evaluate]');assert.equal(h.calls.diagnostics.length,1);
  h.api.clearOwner();assert.equal(h.testing.insightBundle(),null);assert.throws(()=>h.api.openInsights('opponent'),/not available/);
  h.api.init(otherOwner);h.api.openInsights('opponent');h.flush();h.click('[data-insights-evaluate]');assert.equal(h.calls.diagnostics.length,2);
  assert.equal(h.testing.insightBundle().binding.scope,'CURRENT_LIBRARY');assert.equal(h.calls.diagnostics.at(-1).currentHandId,null);
  h.api.clearOwner();h.api.init(owner);h.api.openInsights('opponent');h.flush();h.click('[data-insights-evaluate]');assert.equal(h.calls.diagnostics.length,3);
});

test('forecast origin is auxiliary, immutable after first creation and conservative for late/reconstructed or legacy hands',()=>{
  const h=harness(),snapshot=h.api.beginHand(record());const before=copy(snapshot);
  const observed={...record(),revisionKey:'observed',observations:[{id:'hand-one:a',playerId:'opponent',source:'CONFIRMED_EVENT',seatId:0,action:'CALL',context:context('RIVER')}]};
  h.api.syncObservations(observed);const hand=h.api.getStore().hands['hand-one'];
  assert.equal(hand.forecastOrigin.status,'FROZEN_BEFORE_FIRST_ACTION');assert.equal(hand.forecastOrigin.createdAt,before.frozenAt);
  assert.deepEqual(h.api.beginHand(record('hand-one',[{type:'ACT'}])),before);assert.equal('forecastOrigin' in before,false);
  h.api.beginHand(record('late',[{type:'ACT',action:'CALL'}]));assert.equal(h.api.getStore().hands.late.forecastOrigin.status,'RECONSTRUCTED_AFTER_ACTION');
  const unknown=record('unknown');delete unknown.events;h.api.beginHand(unknown);
  assert.equal(h.api.getStore().hands.unknown.forecastOrigin.status,'RECONSTRUCTED_AFTER_ACTION');
  h.api.syncObservations({...record('sync-first'),revisionKey:'first',observations:[]});assert.equal(h.api.getStore().hands['sync-first'].forecastOrigin.status,'RECONSTRUCTED_AFTER_ACTION');
  const legacy=library();model.beginHand(legacy.store,record('legacy'));const l=harness({initial:legacy});
  l.api.beginHand(record('legacy'));assert.equal(l.api.getStore().hands.legacy.forecastOrigin,undefined);
  l.api.openInsights('opponent',{profileSnapshot:l.api.getStore().hands.legacy.profileSnapshot,handId:'legacy',revisionKey:'legacy-r'});l.flush();
  assert.match(l.content.innerHTML,/original forecast timing unverified/);assert.doesNotMatch(l.content.innerHTML,/evidence frozen before the first action/);
});

test('range template cleanup runs with native storage only after player deletion is saved',()=>{
  const h=harness();h.click('#players-delete');assert.equal(h.api.byId('opponent'),null);
  assert.equal(h.calls.removed.length,1);assert.equal(h.calls.removed[0][0],h.localStorage);assert.deepEqual(h.calls.removed[0].slice(1),[owner,'opponent']);
  const failed=harness();failed.failCommit();failed.click('#players-delete');assert.ok(failed.api.byId('opponent'));assert.equal(failed.calls.removed.length,0);
});

test('renderer keeps zero eligible diagnostics unknown, escapes receipts and caps their reported omissions',()=>{
  const h=harness(),bundle={binding:{scope:'CURRENT_LIBRARY'},origin:{libraryRevision:0},reports:[],diagnosticsEvaluated:true,
    diagnostics:{version:'v',counts:{forecasts:0},metrics:null,forecasts:[],exclusions:Array.from({length:25},()=>({reasonCode:'<script>bad</script>'}))}};
  const html=h.testing.renderInsightReport(bundle);assert.match(html,/Not evaluated/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
  assert.match(html,/&quot;exclusionsShown&quot;: 20/);assert.match(html,/&quot;totalExclusions&quot;: 25/);assert.doesNotMatch(html,/Profile model<\/th>/);
});

test('app captures canonical chronology before observations, then ACT and archive preserve forecast eligibility',async()=>{
  const h=harness({visible:false}),app=fs.readFileSync(require.resolve('../public/app'),'utf8');
  const source=app.slice(app.indexOf('  async function syncPlayerObservations(record)'),app.indexOf('  async function startMultiway(config)'));
  assert.ok(source.indexOf('.beginHand(record)')<source.indexOf("postJson('/api/multiway/observations'"));
  const hand=record(),state={revisionKey:'first'},contextVM={window:h.window,multiway:hand,multiwayState:state,JSON,
    postJson:async()=>{
      assert.equal(h.api.getStore().hands[hand.handId].forecastOrigin.status,'FROZEN_BEFORE_FIRST_ACTION');
      return {handId:hand.handId,config:hand.config,playerIds:hand.config.players.map(player=>player.playerId),sourceRevisionKey:state.revisionKey,
        revisionKey:state.revisionKey,observations:hand.events.filter(event=>event.type==='ACT').map(()=>({id:'hand-one:act',playerId:'opponent',seatId:0,
          source:'CONFIRMED_EVENT',action:'CALL',context:context('RIVER')}))};
    }};
  vm.createContext(contextVM);vm.runInContext(source+';globalThis.sync=syncPlayerObservations;',contextVM);
  await contextVM.sync(hand);hand.events.push({type:'ACT',action:'CALL'});state.revisionKey='acted';await contextVM.sync(hand);
  const snapshot=h.api.getStore().hands['hand-one'].profileSnapshot;
  h.api.archiveHand({multiway:hand,state:{phase:'FINISHED'}});h.api.openInsights('opponent');
  const bundle=h.testing.insightBundle();h.testing.evaluateInsightDiagnostics(bundle);
  assert.equal(bundle.diagnostics.counts.forecasts,1);assert.equal('forecasts' in bundle.diagnostics,false);
  assert.equal('byHand' in bundle.diagnostics,false);assert.equal('byPlayer' in bundle.diagnostics,false);assert.equal('byContext' in bundle.diagnostics,false);
  assert.equal(h.api.getStore().hands['hand-one'].forecastOrigin.createdAt,snapshot.frozenAt);
  const restored=record('restored',[{type:'ACT',action:'CALL'}]);contextVM.multiway=restored;state.revisionKey='restored';
  contextVM.postJson=async()=>({handId:restored.handId,config:restored.config,sourceRevisionKey:state.revisionKey,revisionKey:state.revisionKey,observations:[]});
  await contextVM.sync(restored);assert.equal(h.api.getStore().hands.restored.forecastOrigin.status,'RECONSTRUCTED_AFTER_ACTION');
});

test('on-demand cache retains aggregates and a bounded exclusion receipt, not duplicated histories',()=>{
  const h=harness();h.window.TheibsPlayerProfileInsights.evaluatePrequential=()=>({version:'v',status:'UNKNOWN',counts:{forecasts:0},metrics:null,
    forecasts:Array.from({length:1000},()=>({private:'discarded'})),byHand:[{}],byPlayer:[{}],byContext:[{}],exclusions:Array.from({length:1000},(_,i)=>({reasonCode:'SKIPPED',handId:'h'+i}))});
  h.api.openInsights('opponent');const bundle=h.testing.insightBundle();h.click('[data-insights-evaluate]');
  assert.equal(bundle.diagnostics.exclusions.length,20);assert.equal(bundle.diagnostics.totalExclusions,1000);
  assert.deepEqual(Object.keys(bundle.diagnostics).filter(key=>['forecasts','byHand','byPlayer','byContext'].includes(key)),[]);
  assert.match(h.content.innerHTML,/&quot;totalExclusions&quot;: 1000/);
});
