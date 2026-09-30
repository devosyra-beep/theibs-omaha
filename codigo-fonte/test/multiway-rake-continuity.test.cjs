'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const flow=require('../src/multiway-session');
const config={variant:'PLO4_HIGH',playerCount:2,heroPosition:'SB',smallBlind:.5,bigBlind:1,startingStack:100,heroCards:[]};
const act=(actor,action)=>({type:'ACT',actor,action});

test('uncontested carryover distinguishes gross automatic award from observed rake',()=>{
  let hand=flow.start(config);hand=flow.step(hand.multiway,act(0,'FOLD'));
  const original=JSON.stringify(hand.multiway),next=flow.nextHand(hand.multiway);
  assert.equal(next.archivedHand.reconciliation.source,'UNCONTESTED_POT_BEFORE_UNRECORDED_RAKE');
  assert.equal(next.archivedHand.reconciliation.rakeObserved,false);
  assert.equal(next.archivedHand.state.players.reduce((sum,player)=>sum+player.stack,0),200);
  const corrected=flow.nextHand(hand.multiway,{stacks:[99.5,100.25]});
  assert.equal(corrected.archivedHand.reconciliation.source,'USER_CONFIRMED_STACKS');
  assert.equal(corrected.archivedHand.reconciliation.rakeObserved,false);
  assert.equal(corrected.multiway.config.stacks.reduce((sum,stack)=>sum+stack,0),199.75);
  assert.equal(JSON.stringify(hand.multiway),original);
  assert.equal(corrected.archivedHand.state.result.reason,'ALL_FOLDED');
});

test('explicit zero-rake settlement is preserved, while balance corrections never become another award',()=>{
  let hand=flow.start(config);
  for(const event of [act(0,'CALL'),act(1,'CHECK')])hand=flow.step(hand.multiway,event);
  const board=['2s','3h','4d','8c','9s'];
  for(const count of [3,4,5])for(const event of [{type:'BOARD',cards:board.slice(0,count)},act(1,'CHECK'),act(0,'CHECK')])hand=flow.step(hand.multiway,event);
  hand=flow.step(hand.multiway,{type:'SETTLE',winners:[[0]],rake:0});
  const next=flow.nextHand(hand.multiway);
  assert.equal(next.archivedHand.reconciliation.source,'CONFIRMED_POT_RESULT');assert.equal(next.archivedHand.reconciliation.rakeObserved,true);
  assert.equal(next.archivedHand.multiway.events.at(-1).rake,0);
  const corrected=flow.nextHand(hand.multiway,{stacks:[100.75,99]});
  assert.equal(corrected.archivedHand.reconciliation.source,'USER_CONFIRMED_STACKS');
  assert.equal(corrected.multiway.config.stacks.reduce((sum,stack)=>sum+stack,0),199.75);
  assert.equal(corrected.archivedHand.multiway.events.filter(event=>event.type==='SETTLE').length,1);
});
