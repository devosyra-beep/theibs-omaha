'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const flow=require('../src/multiway-session');
const config={variant:'PLO5_HIGH',playerCount:4,heroPosition:'BB',startingStack:100,smallBlind:.5,bigBlind:1,heroCards:[]};
const act=(actor,action,to)=>({type:'ACT',actor,action,...(to===undefined?{}:{to})});
const apply=(hand,event)=>flow.step(hand.multiway,event,undefined,hand.state.revisionKey);
const conserved=state=>assert.equal(Math.round((state.players.reduce((sum,p)=>sum+p.stack,0)+state.pot+state.rake)*100),Math.round(state.totalChips*100));

test('action identity selects its own previous state; correction preserves a compatible suffix',()=>{
  let hand=flow.start(config);
  for(const event of [act(2,'RAISE',3.5),act(3,'CALL'),act(0,'CALL'),act(1,'RAISE',10),act(2,'CALL'),act(3,'CALL'),act(0,'CALL')])hand=apply(hand,event);
  const before=structuredClone(hand), first=hand.multiway.events[0], repeated=hand.multiway.events[4];
  const original=flow.reviewAction(hand.multiway,{eventId:first.eventId},hand.state.revisionKey);
  const later=flow.reviewAction(hand.multiway,{eventId:repeated.eventId},hand.state.revisionKey);
  assert.equal(original.event.actor,later.event.actor);assert.equal(original.state.currentBet,1);assert.equal(later.state.currentBet,10);
  assert.equal(original.multiwayRevisionKey,hand.state.revisionKey);
  const corrected=flow.correctAction(hand.multiway,{eventId:first.eventId,actor:2,action:'RAISE',to:2},hand.state.revisionKey);
  assert.equal(corrected.multiway.events[0].to,2);assert.equal(corrected.correction.preservedSuffixCount,6);
  assert.equal(corrected.correction.stoppedAt,null);assert.deepEqual(corrected.correction.parkedEvents,[]);
  assert.equal(corrected.state.phase,'WAIT_BOARD');assert.deepEqual(corrected.previousVersion.multiway,hand.multiway);
  assert.deepEqual(hand,before);assert.notEqual(corrected.state.revisionKey,hand.state.revisionKey);conserved(corrected.state);
});

test('incompatible observations are parked from the first failure; invalid edits leave the hand intact',()=>{
  let hand=flow.start(config);
  for(const event of [act(2,'RAISE',3.5),act(3,'CALL'),act(0,'CALL'),act(1,'RAISE',10),act(2,'CALL')])hand=apply(hand,event);
  const snapshot=structuredClone(hand), selection={eventIndex:0,actor:2};
  const changed=flow.correctAction(hand.multiway,{...selection,action:'FOLD'},hand.state.revisionKey);
  assert.equal(changed.correction.stoppedAt.eventIndex,3);
  assert.deepEqual(changed.correction.parkedEvents,hand.multiway.events.slice(3));
  assert.equal(changed.state.actor,1);assert.equal(changed.multiway.events.length,3);
  assert.throws(()=>flow.correctAction(hand.multiway,{...selection,actor:3,action:'FOLD'},hand.state.revisionKey),/selected action/);
  assert.throws(()=>flow.correctAction(hand.multiway,{...selection,action:'RAISE',to:999},hand.state.revisionKey),/bet total/);
  assert.throws(()=>flow.reviewAction(hand.multiway,{eventIndex:0},changed.state.revisionKey),/revision changed/);
  assert.deepEqual(hand,snapshot);conserved(changed.state);
});

test('stack correction keeps recorded payments and button correction keeps identities and recovery',()=>{
  let hand=apply(flow.start(config),act(2,'CALL'));
  const adjusted=flow.adjustStack(hand.multiway,{actor:3,stack:125},hand.state.revisionKey);
  assert.equal(adjusted.state.players[3].stack,125);assert.equal(adjusted.state.pot,hand.state.pot);
  assert.equal(adjusted.adjustment.delta,25);assert.equal(adjusted.adjustment.pokerResult,false);
  assert.deepEqual(adjusted.state.log,hand.state.log);assert.deepEqual(adjusted.previousVersion.multiway,hand.multiway);conserved(adjusted.state);
  const estimated=flow.start({...config,stackEstimates:[true,false,false,true]});
  const confirmed=flow.adjustStack(estimated.multiway,{actor:3,stack:100},estimated.state.revisionKey);
  assert.equal(confirmed.adjustment.delta,0);assert.equal(confirmed.adjustment.unchanged,false);
  assert.equal(confirmed.state.players[3].stackEstimated,false);assert.equal(confirmed.state.players[0].stackEstimated,true);
  assert.notEqual(confirmed.state.revisionKey,estimated.state.revisionKey);
  const buttonPlayerId=hand.state.players[2].playerId,heroPlayerId=hand.state.players[hand.state.heroId].playerId;
  const moved=flow.correctButton(hand.multiway,{buttonId:2},hand.state.revisionKey);
  assert.equal(moved.state.players[moved.state.buttonId].playerId,buttonPlayerId);
  assert.equal(moved.state.players[moved.state.heroId].playerId,heroPlayerId);
  assert.equal(moved.buttonCorrection.stoppedAt.eventIndex,0);assert.equal(moved.buttonCorrection.parkedEvents.length,1);
  assert.deepEqual(moved.previousVersion.multiway,hand.multiway);conserved(moved.state);
});

test('manual restart archives an interrupted attempt without moving the button or completed hand number',()=>{
  const hand=apply(flow.start(config),act(2,'CALL')), options={originEventId:'restart-key-1'};
  const restarted=flow.restartHand(hand.multiway,options,hand.state.revisionKey);
  const retried=flow.restartHand(hand.multiway,options,hand.state.revisionKey);
  assert.equal(restarted.multiway.handId,retried.multiway.handId);assert.equal(restarted.state.revisionKey,retried.state.revisionKey);
  assert.equal(restarted.multiway.sessionId,hand.multiway.sessionId);assert.equal(restarted.multiway.handNumber,hand.multiway.handNumber);
  assert.equal(restarted.multiway.attemptNumber,2);assert.equal(restarted.state.players[restarted.state.buttonId].playerId,hand.state.players[hand.state.buttonId].playerId);
  assert.deepEqual(restarted.multiway.events,[]);assert.equal(restarted.state.pot,1.5);
  assert.equal(restarted.archivedHand.reconciliation.status,'INTERRUPTED');assert.equal(restarted.archivedHand.state.result,null);
  assert.deepEqual(restarted.archivedHand.multiway,hand.multiway);conserved(restarted.state);
});

test('next hand retries use one identity, award and blind posting; incomplete references remain estimates',()=>{
  let completed=flow.start(config);
  for(const event of [act(2,'FOLD'),act(3,'FOLD'),act(0,'FOLD')])completed=apply(completed,event);
  const next=flow.nextHand(completed.multiway,{},completed.state.revisionKey), retry=flow.nextHand(completed.multiway,{},completed.state.revisionKey);
  assert.equal(next.multiway.handId,retry.multiway.handId);assert.equal(next.state.revisionKey,retry.state.revisionKey);
  assert.equal(next.multiway.sessionId,completed.multiway.sessionId);assert.equal(next.multiway.handNumber,2);assert.equal(next.multiway.attemptNumber,1);
  assert.equal(next.state.pot,1.5);assert.equal(next.archivedHand.reconciliation.status,'SETTLED');
  assert.equal(next.multiway.config.stacks.reduce((a,b)=>a+b,0),400);conserved(next.state);
  const unfinished=apply(flow.start(config),act(2,'CALL'));
  const continuation=flow.nextHand(unfinished.multiway,{},unfinished.state.revisionKey);
  assert.ok(continuation.multiway.config.stackEstimates.every(Boolean));assert.ok(continuation.multiway.config.stacks.every(stack=>stack===100));
  assert.equal(continuation.archivedHand.reconciliation.status,'INCOMPLETE');assert.equal(continuation.archivedHand.state.pot,unfinished.state.pot);
  assert.equal(continuation.state.pot,1.5);conserved(continuation.state);
});
