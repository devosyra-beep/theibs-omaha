'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createService,shuffled,DEAL_VERSION}=require('../src/multiway-simulation');
const multiway=require('../src/multiway-session');
const {evaluateOmaha,compareHands}=require('../src/evaluator');
const seed='ab'.repeat(32),owner='simulation-test-owner';
function step(service,s,operation,extra={}){return service.mutate(owner,{id:s.id,revision:s.revision,requestId:crypto.randomUUID(),operation,...extra});}
function play(service,s){
  for(let i=0;i<200&&!s.finished;i++){
    const state=s.state;
    s=step(service,s,state.phase==='WAIT_BOARD'?'DEAL':state.phase==='SHOWDOWN'?'SETTLE':state.actor!==state.heroId?'ADVANCE':'ACT',
      {action:state.legal.actions.includes('CHECK')?'CHECK':'CALL'});
    const total=state.players.reduce((sum,player)=>sum+player.stack,0)+state.pot;
    assert.ok(Math.abs(total-state.totalChips)<.011,'chip conservation during play');
  }
  assert.equal(s.finished,true);return s;
}
function seeded(service,options={},paused=false){const record=multiway.start({variant:'PLO5_HIGH',playerCount:2,heroPosition:'SB',startingStack:10,smallBlind:.5,bigBlind:1,heroCards:[],...options}).multiway;return service._testing.register(owner,record,seed,paused);}
test('deal is fixed before actions, unfiltered, unique, and hidden from the public calculation input',()=>{
  const service=createService(),s=seeded(service),privateState=service._testing.get(owner,s.id);
  assert.equal(new Set(shuffled(seed)).size,52);
  assert.equal(s.deal.commitment,crypto.createHash('sha256').update(DEAL_VERSION+'\n'+seed+'\n'+shuffled(seed).join(' ')).digest('hex'));
  assert.equal(s.audit,undefined);assert.equal(s.shownHands,undefined);assert.equal(s.seed,undefined);
  assert.equal(s.boardAll,undefined);assert.equal(s.hands,undefined);
  const before=service.evaluation(owner,s.id,s.revision);
  privateState.seed='cd'.repeat(32);privateState.hands[1]=['As','Ks','Qs','Js','Ts'];privateState.boardAll=['2c','3c','4c','5c','6c'];
  assert.deepEqual(service.evaluation(owner,s.id,s.revision),before);
  assert.deepEqual(Object.keys(before).sort(),['multiway','multiwayEvaluation']);
  assert.deepEqual(Object.keys(before.multiwayEvaluation).sort(),['assumeNoRake','revisionKey']);
  assert.deepEqual(before.multiway.config.heroCards,s.multiway.config.heroCards);
});
test('public starts ignore caller seed and hidden information; owners, duplicate requests and stale revisions are enforced',()=>{
  const service=createService(),s=service.start(owner,{playerCount:2,heroPosition:'SB',seed,hands:[['As']],boardAll:['2s']});
  assert.notEqual(service._testing.get(owner,s.id).seed,seed);
  assert.throws(()=>service.read('different-owner',s.id),{statusCode:404});
  const payload={id:s.id,revision:s.revision,requestId:'same-event',operation:'ACT',action:'CALL'};
  const first=service.mutate(owner,payload);assert.deepEqual(service.mutate(owner,payload),first);
  assert.throws(()=>service.mutate(owner,{...payload,action:'FOLD'}),{statusCode:409});
  assert.throws(()=>service.mutate(owner,{...payload,requestId:'new-event'}),{statusCode:409});
  assert.throws(()=>service.evaluation(owner,s.id,s.revision),{statusCode:409});
});
test('complete seeded game and replay are identical despite new ledger UUIDs and pause granularity',()=>{
  const service=createService(),initial=seeded(service),a=play(service,initial);
  assert.equal(a.outcome.stacks.reduce((sum,p)=>sum+p.stack,0),20);
  const replay=service.replay(owner,{id:a.id,revision:a.revision}).session;
  assert.notEqual(replay.multiway.handId,initial.multiway.handId);
  const paused=step(service,replay,'PACE',{paused:true}),b=play(service,paused);
  const semantic=s=>s.multiway.events.map(({eventId,originEventId,...event})=>event);
  assert.deepEqual(semantic(a),semantic(b));assert.deepEqual(a.outcome,b.outcome);
  assert.deepEqual(a.audit,b.audit);
});
test('showdown settles every side pot with exact Omaha winners and carries settled stacks only',()=>{
  const service=createService();let s=seeded(service,{playerCount:3,heroPosition:'BTN',stacks:[4,7,10]});
  // All contenders call/check the bots; short stacks can create side pots.
  s=play(service,s);const privateState=service._testing.get(owner,s.id);
  if(s.state.result.reason==='REPORTED_SHOWDOWN'){
    for(const pot of s.state.result.pots){const hands=pot.eligible.map(id=>({id,hand:evaluateOmaha(privateState.hands[id],s.state.board)}));
      for(const winner of pot.winners)for(const item of hands)assert.ok(compareHands(hands.find(item=>item.id===winner).hand,item.hand)>=0);
    }
  }
  assert.ok(Math.abs(s.outcome.stacks.reduce((sum,p)=>sum+p.stack,0)-21)<.011);
  const ended=step(service,s,'REVEAL');assert.deepEqual(ended.audit.hands,privateState.hands);
  if(s.state.players[s.state.heroId].stack>0 && s.state.players.filter(p=>p.stack>0).length>=2){
    const next=service.next(owner,{id:ended.id,revision:ended.revision}).session;
    assert.ok(Math.abs(next.state.players.reduce((sum,p)=>sum+p.startingStack,0)-21)<.011);
    assert.notEqual(next.deal.commitment,ended.deal.commitment);
  }
});
test('all supported variants and seat counts complete without collecting real player data',()=>{
  for(const variant of ['PLO4_HIGH','PLO5_HIGH','PLO6_HIGH'])for(const playerCount of [2,variant==='PLO6_HIGH'?5:6]){
    const service=createService(),s=play(service,seeded(service,{variant,playerCount,heroPosition:playerCount===2?'SB':'BTN'}));
    assert.equal(s.source,'SIMULATED_ACTIONS');assert.equal(s.policy.quality,'HEURISTIC');
    assert.ok(s.multiway.events.every(event=>event.type!=='REVEAL'));
    assert.equal(s.state.source,'USER_OBSERVED_ACTIONS'); // Ledger kernel unchanged; wrapper explicitly labels simulation.
  }
});
test('free folds, invalid sizes, early reveal and abandoned next-hand fail without changing the ledger',()=>{
  const service=createService();let s=seeded(service);s=step(service,s,'ACT',{action:'CALL'});
  assert.throws(()=>step(service,s,'REVEAL'));
  if(s.state.phase==='BETTING'&&s.state.actor===s.state.heroId&&s.state.legal.toCall===0)assert.throws(()=>step(service,s,'ACT',{action:'FOLD'}));
  assert.throws(()=>step(service,s,'ACT',{action:'RAISE',to:100000}));
  assert.deepEqual(service.read(owner,s.id),s);
  const end=step(service,s,'END');assert.equal(end.outcome,null);assert.equal(end.abandoned,true);assert.ok(end.audit.seed);
  assert.throws(()=>service.next(owner,{id:end.id,revision:end.revision}));
  assert.throws(()=>service.evaluation(owner,end.id,end.revision));
});
test('expired and released sessions are inaccessible; capacity bounds memory',()=>{
  let now=0;const service=createService({now:()=>now,maxSessions:2}),a=seeded(service),b=seeded(service);
  assert.throws(()=>seeded(service),{statusCode:503});service.release(owner,a.id);
  assert.throws(()=>service.read(owner,a.id),{statusCode:404});now=2*60*60*1000+1;
  assert.throws(()=>service.read(owner,b.id),{statusCode:404});assert.equal(service._testing.size(),0);
});
test('exact settlement supports a tied main pot and separate eligibility in side pots',()=>{
  const service=createService();let s=seeded(service,{playerCount:3,heroPosition:'BTN',stacks:[2,4,6]});
  const internal=service._testing.get(owner,s.id);
  internal.hands=[['Jc','Qc','2h','3h','4h'],['Jd','Qs','5h','6h','7h'],['9c','9d','2c','3c','4c']];
  internal.boardAll=['As','Kd','Qh','Js','Tc'];internal.record.config.heroCards=internal.hands[0];
  for(let i=0;i<100;i++){
    const state=multiway.envelope(internal.record).state;if(state.phase==='SHOWDOWN')break;
    const event=state.phase==='WAIT_BOARD'?{type:'BOARD',cards:internal.boardAll.slice(0,{FLOP:3,TURN:4,RIVER:5}[state.nextStreet])}:
      state.legal.actions.includes('RAISE')?{type:'ACT',actor:state.actor,action:'RAISE',to:state.legal.maxTo}:
      {type:'ACT',actor:state.actor,action:state.legal.actions.includes('CALL')?'CALL':'CHECK'};
    internal.record=multiway.step(internal.record,event,undefined,state.revisionKey).multiway;
  }
  s=service.read(owner,s.id);assert.equal(s.state.phase,'SHOWDOWN');assert.ok(s.state.hasSidePots);
  s=step(service,s,'SETTLE');assert.deepEqual(s.state.result.pots[0].winners,[0,1]);
  assert.deepEqual(s.state.result.pots[1].winners,[1]);
  assert.ok(Math.abs(s.outcome.stacks.reduce((sum,p)=>sum+p.stack,0)-12)<.011);
});
