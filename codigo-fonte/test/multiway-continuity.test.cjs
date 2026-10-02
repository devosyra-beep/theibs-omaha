'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const flow=require('../src/multiway-session');
const {replay}=require('../src/hand-flow');
const config={variant:'PLO5_HIGH',playerCount:4,heroPosition:'BB',startingStack:100,smallBlind:.5,bigBlind:1,heroCards:[]};
const act=(actor,action,to,eventId)=>({type:'ACT',actor,action,...(to===undefined?{}:{to}),...(eventId?{eventId}:{})});
const board=['2s','3h','4d','5c','9s'];
function untilShowdown(cfg=config) {
  let result=flow.start(cfg);
  for(let guard=0;guard<100 && result.state.phase!=='SHOWDOWN';guard++){
    const state=result.state;
    const event=state.phase==='WAIT_BOARD'?{type:'BOARD',cards:board.slice(0,{FLOP:3,TURN:4,RIVER:5}[state.nextStreet])}:act(state.actor,state.legal.toCall?'CALL':'CHECK');
    result=flow.step(result.multiway,event,state.revision,state.revisionKey);
  }
  assert.equal(result.state.phase,'SHOWDOWN');return result;
}
function conserved(state){assert.equal(Math.round((state.players.reduce((sum,p)=>sum+p.stack,0)+state.pot+state.rake)*100),Math.round(state.totalChips*100));}

test('Hero BB can record every preceding action and the BB option without cards',()=>{
  let r=flow.start(config);
  assert.equal(r.state.actor,2);assert.equal(r.state.heroId,1);
  for(const event of [act(2,'CALL'),act(3,'CALL'),act(0,'CALL')])r=flow.step(r.multiway,event);
  assert.equal(r.state.actor,1);assert.ok(r.state.legal.actions.includes('CHECK'));
  assert.equal(r.analysis.available,false);assert.ok(r.analysis.reasons.some(item=>item.code==='HERO_CARDS_INCOMPLETE'));
  r=flow.step(r.multiway,act(1,'CHECK'));
  assert.equal(r.state.phase,'WAIT_BOARD');assert.equal(r.state.cardTarget,'BOARD');assert.equal(r.state.cardsExpected,3);
  r=flow.step(r.multiway,{type:'BOARD',cards:board.slice(0,3)});
  assert.equal(r.state.actor,0);assert.equal(r.state.heroId,1);assert.equal(r.state.pot,4);conserved(r.state);
});

test('an empty Hero hand may fold without ending other players action',()=>{
  let r=flow.start({...config,heroPosition:'CO'});
  r=flow.step(r.multiway,act(2,'FOLD'));
  assert.equal(r.state.phase,'BETTING');assert.equal(r.state.actor,3);assert.equal(r.state.players[2].folded,true);
  assert.equal(r.state.pot,1.5);conserved(r.state);
});

test('confirmed event identities deduplicate delivery, never identical text',()=>{
  let r=flow.start(config),initialKey=r.state.revisionKey;
  r=flow.step(r.multiway,act(2,'CALL',undefined,'speech-1'),0,initialKey);
  const duplicate=flow.step(r.multiway,act(2,'CALL',undefined,'speech-1'),0,initialKey);
  assert.equal(duplicate.duplicate,true);assert.deepEqual(duplicate.multiway,r.multiway);assert.equal(duplicate.state.pot,2.5);
  assert.throws(()=>flow.step(r.multiway,act(2,'FOLD',undefined,'speech-1')),/different observation/);
  r=flow.step(r.multiway,act(3,'CALL',undefined,'speech-2'));
  assert.equal(r.multiway.events.length,2);assert.equal(r.state.pot,3.5);
  const origin={...act(0,'CALL'),eventId:'request-3',originEventId:'speech-3'};
  r=flow.step(r.multiway,origin);
  assert.equal(flow.step(r.multiway,{...origin,eventId:'request-retry'}).duplicate,true);
  const undone=flow.undo(r.multiway,r.state.revisionKey);
  assert.throws(()=>flow.step(undone.multiway,origin,2,r.state.revisionKey),/revision changed/);
});

test('shown cards are optional, may be partial, and never decide the winner',()=>{
  let r=untilShowdown();
  r=flow.step(r.multiway,{type:'REVEAL',actor:2,cards:['As','Kd']});
  assert.deepEqual(r.state.players[2].shownCards,['As','Kd']);assert.equal(r.state.phase,'SHOWDOWN');
  assert.throws(()=>flow.step(r.multiway,{type:'REVEAL',actor:3,cards:['As']}),/Duplicate/i);
  assert.throws(()=>flow.step(r.multiway,{type:'REVEAL',actor:3,cards:['2s']}),/Duplicate/i);
  r=flow.step(r.multiway,{type:'SETTLE',winners:[[0,2]],rake:.01});
  assert.equal(r.state.result.status,'RECONCILED');assert.deepEqual(r.state.result.winners,[0,2]);
  assert.equal(r.state.result.pots[0].amount,4);assert.equal(r.state.result.pots[0].rake,.01);
  assert.deepEqual(r.state.result.pots[0].awards,[{player:0,amount:2},{player:2,amount:1.99}]);
  r=flow.step(r.multiway,{type:'REVEAL',actor:2,cards:['As','Kd','Qh']});
  assert.deepEqual(r.state.players[2].shownCards,['As','Kd','Qh']);assert.equal(r.state.phase,'FINISHED');conserved(r.state);
});

test('partial shown Hero cards validate against known private cards and shown opponents',()=>{
  let r=untilShowdown({...config,heroCards:['As','Kh','Qd','Jc','Ts']});
  r=flow.step(r.multiway,{type:'REVEAL',actor:1,cards:['As','Qd']});
  assert.throws(()=>flow.step(r.multiway,{type:'REVEAL',actor:2,cards:['Kh']}),/Duplicate/i);
  assert.throws(()=>flow.step(r.multiway,{type:'REVEAL',actor:1,cards:['Ac']}),/match the recorded/);
  assert.throws(()=>flow.step(r.multiway,{type:'REVEAL',actor:2,cards:['Ac','Ad','Ah','Ks','Kc','Kd']}),/Too many/);
  let unknown=untilShowdown();
  unknown=flow.step(unknown.multiway,{type:'REVEAL',actor:1,cards:['Ac']});
  assert.throws(()=>flow.step(unknown.multiway,{type:'REVEAL',actor:2,cards:['Ac']}),/Duplicate/i);
});

test('unknown result keeps unallocated chips pending; explicit reconciliation permits immediate next hand',()=>{
  let r=untilShowdown();
  r=flow.step(r.multiway,{type:'SKIP_RESULT'});
  assert.equal(r.state.phase,'FINISHED');assert.equal(r.state.result.reason,'UNKNOWN');assert.equal(r.state.result.unresolvedPot,4);
  assert.deepEqual(r.state.result.awards,[]);assert.deepEqual(r.state.players.map(p=>p.stack),[99,99,99,99]);conserved(r.state);
  const estimated=flow.nextHand(r.multiway,{},r.state.revisionKey);
  assert.deepEqual(estimated.state.players.map(player=>player.startingStack),[100,100,100,100]);
  assert.ok(estimated.state.players.every(player=>player.stackEstimated));
  assert.equal(estimated.archivedHand.reconciliation.source,'PREVIOUS_STARTING_STACK_ESTIMATE');
  assert.deepEqual(estimated.archivedHand.state.result.awards,[]);
  assert.ok(estimated.analysis.warnings.some(text=>text.includes('Stacks are estimates')));
  const next=flow.nextHand(r.multiway,{stacks:[99,103,99,99]},r.state.revisionKey);
  assert.equal(next.state.phase,'BETTING');assert.equal(next.state.heroId,0);
  assert.equal(next.archivedHand.state.result.reason,'UNKNOWN');assert.equal(next.archivedHand.reconciliation.resultPending,true);
  assert.equal(next.archivedHand.reconciliation.source,'USER_CONFIRMED_STACKS');
  assert.equal(next.state.players.find(p=>p.hero).startingStack,103);assert.equal(next.state.pot,1.5);conserved(next.state);
  const settled=flow.step(r.multiway,{type:'SETTLE',winners:[[1]],rake:0});
  assert.equal(settled.state.result.reason,'REPORTED_SHOWDOWN');assert.equal(settled.state.players[1].stack,103);conserved(settled.state);
});

test('next hand archives complete ledger, rotates positions and preserves identity and reconciled stacks',()=>{
  const players=[0,1,2,3].map(id=>({playerId:`persistent-${id}`,name:id<2?'Same name':`Player ${id}`}));
  let r=flow.start({...config,players});
  for(const event of [act(2,'FOLD'),act(3,'FOLD'),act(0,'FOLD')])r=flow.step(r.multiway,event);
  const before=JSON.stringify(r.multiway),next=flow.nextHand(r.multiway,{},r.state.revisionKey);
  assert.equal(JSON.stringify(r.multiway),before);assert.notEqual(next.multiway.handId,r.multiway.handId);
  assert.deepEqual(next.archivedHand.multiway,r.multiway);assert.equal(next.archivedHand.state.result.reason,'ALL_FOLDED');
  assert.deepEqual(next.multiway.config.players.map(p=>p.playerId),['persistent-1','persistent-2','persistent-3','persistent-0']);
  assert.deepEqual(next.state.players.map(p=>p.playerId),next.multiway.config.players.map(p=>p.playerId));
  assert.equal(next.state.players[0].hero,true);assert.equal(next.state.players[0].position,'SB');
  assert.equal(next.state.players[0].startingStack,100.5);
  assert.deepEqual(next.state.players.map(p=>p.folded),[false,false,false,false]);
  assert.deepEqual(next.state.board,[]);assert.deepEqual(next.multiway.events,[]);assert.deepEqual(next.multiway.config.heroCards,[]);
  assert.equal(next.state.pot,1.5);assert.equal(next.state.log.length,2);conserved(next.state);
});

test('heads-up next hand swaps blinds; empty stacks are excluded without becoming a new identity',()=>{
  let r=untilShowdown({...config,playerCount:2,heroPosition:'BB',stacks:[1,1]});
  r=flow.step(r.multiway,{type:'SETTLE',winners:[[1]]});
  assert.throws(()=>flow.nextHand(r.multiway),/At least two/);
  const next=flow.nextHand(r.multiway,{stacks:[10,2]});
  assert.equal(next.state.heroId,0);assert.equal(next.state.actor,0);
  assert.equal(next.state.players[0].playerId,r.state.players[1].playerId);
  assert.equal(next.state.players[1].playerId,r.state.players[0].playerId);
});

test('fold terminal returns only the winning unmatched wager and distinguishes refund from prize',()=>{
  const events=[act(2,'RAISE',3.5),act(3,'FOLD'),act(0,'FOLD'),act(1,'FOLD')];
  const state=replay({...config,heroPosition:'CO'},events);
  assert.equal(state.phase,'FINISHED');assert.equal(state.log.at(-1).action,'RETURN');assert.equal(state.log.at(-1).amount,2.5);
  assert.equal(state.result.awards[0].amount,2.5);assert.equal(state.players[2].stack,101.5);conserved(state);
});

test('pending next-hand basics cannot mutate the current ledger and reject illegal blind values',()=>{
  let r=flow.start(config);
  const activeNext=flow.nextHand(r.multiway,{config:{smallBlind:1,bigBlind:2}});
  assert.equal(activeNext.state.bigBlind,2);assert.equal(activeNext.archivedHand.state.phase,'BETTING');
  for(const event of [act(2,'FOLD'),act(3,'FOLD'),act(0,'FOLD')])r=flow.step(r.multiway,event);
  const snapshot=JSON.stringify(r);
  const next=flow.nextHand(r.multiway,{config:{smallBlind:1,bigBlind:2,heroPosition:'BTN'}});
  assert.equal(next.state.heroPosition,'BTN');assert.equal(next.state.pot,3);assert.equal(next.state.bigBlind,2);
  assert.equal(JSON.stringify(r),snapshot);
  assert.throws(()=>flow.nextHand(r.multiway,{config:{smallBlind:2,bigBlind:1}}),/Small blind/);
});

test('the next button skips zero stacks and player identities survive a smaller table',()=>{
  let r=flow.start(config);
  for(const event of [act(2,'FOLD'),act(3,'FOLD'),act(0,'FOLD')])r=flow.step(r.multiway,event);
  const ids=r.state.players.map(p=>p.playerId);
  const next=flow.nextHand(r.multiway,{stacks:[10,20,0,30]});
  assert.equal(next.state.initialPlayerCount,3);
  assert.deepEqual(next.state.players.map(p=>p.playerId),[ids[1],ids[3],ids[0]]);
  assert.deepEqual(next.state.players.map(p=>p.startingStack),[20,30,10]);
  assert.equal(next.state.heroId,0);assert.equal(next.state.buttonId,2);conserved(next.state);
});

test('mid-hand continuation archives exact observations, resets folds/cards and never invents payouts',()=>{
  let r=flow.start({...config,heroCards:['As','Kh','Qd','Jc','Ts']});
  r=flow.step(r.multiway,act(2,'RAISE',3.5));r=flow.step(r.multiway,act(3,'FOLD'));
  const original=structuredClone(r),next=flow.nextHand(r.multiway,{},r.state.revisionKey);
  assert.deepEqual(r,original);assert.deepEqual(next.archivedHand.multiway,r.multiway);
  assert.deepEqual(next.archivedHand.state,r.state);assert.equal(next.archivedHand.state.result,null);
  assert.equal(next.archivedHand.state.pot,r.state.pot);assert.equal(next.archivedHand.reconciliation.resultPending,true);
  assert.deepEqual(next.multiway.events,[]);assert.deepEqual(next.multiway.config.heroCards,[]);
  assert.ok(next.state.players.every(p=>!p.folded && p.stackEstimated && p.startingStack===100));
  assert.deepEqual(new Set(next.multiway.config.players.map(p=>p.playerId)),new Set(r.multiway.config.players.map(p=>p.playerId)));
  assert.equal(next.state.pot,1.5);conserved(next.state);
  assert.throws(()=>flow.nextHand(r.multiway,{},next.state.revisionKey),/revision changed/);
});

test('unresolved all-in does not remove seats and estimate provenance survives subsequent known results',()=>{
  const r=untilShowdown({...config,playerCount:2,heroPosition:'BB',stacks:[1,1]});
  assert.deepEqual(r.state.players.map(p=>p.stack),[0,0]);
  let next=flow.nextHand(r.multiway);
  assert.equal(next.state.initialPlayerCount,2);assert.deepEqual(next.multiway.config.stacks,[1,1]);
  next=flow.step(next.multiway,act(next.state.actor,'FOLD'));
  const continued=flow.nextHand(next.multiway);
  assert.ok(continued.multiway.config.stackEstimates.every(Boolean));
  const confirmed=flow.nextHand(next.multiway,{stacks:[10,10]});
  assert.equal(confirmed.multiway.config.stackEstimates,undefined);
  assert.ok(confirmed.state.players.every(p=>!p.stackEstimated));
  assert.throws(()=>flow.nextHand(next.multiway,{stacks:[10,null]}),/non-negative stack/);
});

test('new game archives an unfinished hand, uses fresh table settings and rejects stale replacement',()=>{
  let r=flow.start(config);r=flow.step(r.multiway,act(2,'CALL'));
  const snapshot=structuredClone(r),fresh=flow.start({...config,heroPosition:'BTN',startingStack:50},r.multiway,r.state.revisionKey);
  assert.deepEqual(r,snapshot);assert.deepEqual(fresh.archivedHand.state,r.state);
  assert.equal(fresh.archivedHand.reconciliation.source,'NEW_GAME');
  assert.equal(fresh.archivedHand.reconciliation.resultPending,true);
  assert.notEqual(fresh.multiway.handId,r.multiway.handId);assert.deepEqual(fresh.multiway.events,[]);
  assert.ok(fresh.state.players.every(p=>p.startingStack===50 && !p.stackEstimated && !p.folded));
  assert.equal(fresh.state.heroPosition,'BTN');
  assert.ok(fresh.multiway.config.players.every(p=>!r.multiway.config.players.some(old=>old.playerId===p.playerId)));
  assert.throws(()=>flow.start(config,r.multiway,fresh.state.revisionKey),/revision changed/);
});

test('settling different side pots does not require revealed cards and undo restores unallocated chips',()=>{
  const cfg={...config,playerCount:3,heroPosition:'BTN',stacks:[10,20,30]};
  let r=flow.start(cfg);
  for(const event of [act(2,'RAISE',3.5),act(0,'RAISE',10),act(1,'RAISE',20),act(2,'CALL'),
    ...[3,4,5].map(count=>({type:'BOARD',cards:board.slice(0,count)}))])r=flow.step(r.multiway,event);
  assert.deepEqual(r.state.pots,[{amount:30,eligible:[0,1,2]},{amount:20,eligible:[1,2]}]);
  assert.throws(()=>flow.step(r.multiway,{type:'SETTLE',winners:[[0],[0]]}),/ineligible/);
  const before=r;
  r=flow.step(r.multiway,{type:'SETTLE',winners:[[0],[1,2]],rake:.01});
  assert.equal(r.state.result.pots.length,2);assert.deepEqual(r.state.players.map(p=>p.stack),[29.99,10,20]);
  assert.deepEqual(r.state.players.map(p=>p.shownCards),[[],[],[]]);conserved(r.state);
  const undo=flow.undo(r.multiway,r.state.revisionKey);
  assert.equal(undo.state.phase,'SHOWDOWN');assert.equal(undo.state.pot,50);
  assert.deepEqual(undo.state.players,before.state.players);assert.notEqual(undo.state.revisionKey,before.state.revisionKey);
  assert.throws(()=>flow.step(undo.multiway,{type:'SETTLE',winners:[[0],[1]]},undefined,before.state.revisionKey),/revision changed/);
});

test('short raises accumulate to reopen action and a hand does not finish after one orbit',()=>{
  const cfg={...config,playerCount:5,heroPosition:'HJ',stacks:[100,100,100,4,5]};
  const events=[act(2,'RAISE',3),act(3,'RAISE',4),act(4,'RAISE',5),act(0,'CALL'),act(1,'CALL')];
  const state=replay(cfg,events);
  assert.equal(state.actor,2);assert.equal(state.phase,'BETTING');assert.equal(state.legal.toCall,2);
  assert.ok(state.legal.actions.includes('RAISE'));conserved(state);
});

test('continuation readiness permits all-ins and side pots while preserving legacy guards',()=>{
  const cfg={...config,playerCount:3,heroPosition:'BTN',stacks:[10,20,30],heroCards:['As','Kh','Qd','Jc','Ts']};
  let r=flow.start(cfg);
  for(const event of [act(2,'RAISE',3.5),act(0,'RAISE',10),act(1,'RAISE',20)])r=flow.step(r.multiway,event);
  assert.equal(r.analysis.available,false);assert.ok(r.analysis.reasons.some(item=>item.code==='SIDE_POTS_UNSUPPORTED'));
  assert.equal(r.continuationAnalysis.available,true);assert.deepEqual(r.continuationAnalysis.reasons,[]);
  assert.deepEqual(r.continuationAnalysis.input,r.analysis.input);
  const noCards=flow.envelope({...r.multiway,config:{...r.multiway.config,heroCards:[]}});
  assert.equal(noCards.continuationAnalysis.available,false);
  assert.deepEqual(noCards.continuationAnalysis.reasons.map(item=>item.code),['HERO_CARDS_INCOMPLETE']);
});

test('persistent player IDs share the profile-library domain without changing event ID syntax',()=>{
  const players=[0,1,2,3].map(id=>({playerId:`person-${id}`,name:`Player ${id}`}));
  for(const playerId of ['__proto__','constructor','prototype','person:remote','person.with.dot','x'.repeat(101)]){
    assert.throws(()=>flow.start({...config,players:players.map((player,index)=>index===0?{...player,playerId}:player)}),/player identity/);
  }
  const r=flow.start({...config,players});
  assert.equal(flow.step(r.multiway,act(2,'CALL',undefined,'browser:session.1')).multiway.events[0].eventId,'browser:session.1');
});
