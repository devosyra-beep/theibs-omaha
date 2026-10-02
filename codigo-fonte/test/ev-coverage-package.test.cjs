'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const profiles=require('../src/player-profiles'),flow=require('../src/hand-flow'),mw=require('../src/multiway-session');
const builder=require('../src/solver/plo-river-game'),core=require('../src/solver/extensive-solver'),conditioned=require('../src/solver/action-conditioned');
const tools=require('../public/river-study-tools'),insights=require('../public/player-profile-insights'),ev=require('../src/multiway-evaluator');
const {Lcg}=require('../src/equity-engine');
const HERO=['As','Ah','Qd','Jc','Tc'],OPP=['Ks','Kh','6d','7c','8h'],BOARD=['2s','3h','4d','8c','9s'];
function record(id){return {handId:id,config:{variant:'PLO5_HIGH',playerCount:2,heroPosition:'BB',startingStack:30,smallBlind:.5,bigBlind:1,heroCards:[],players:[{playerId:'opponent'},{playerId:'hero'}]},events:[]};}
function small(orientation='SB'){
  let current=mw.start({variant:'PLO5_HIGH',playerCount:2,heroPosition:orientation,startingStack:.53,smallBlind:.1,bigBlind:.25,heroCards:HERO});
  while(current.state.street!=='RIVER' || current.state.actor!==current.state.heroId){
    if(current.state.phase==='WAIT_BOARD')current=mw.step(current.multiway,{type:'BOARD',cards:BOARD.slice(0,{FLOP:3,TURN:4,RIVER:5}[current.state.nextStreet])});
    else current=mw.step(current.multiway,{type:'ACT',actor:current.state.actor,action:current.state.legal.toCall?'CALL':'CHECK'});
  }
  return {multiway:current.multiway,ranges:current.state.players.map(p=>({seatId:p.id,complete:true,source:'INDEPENDENT_SYNTHETIC_TEST',combos:[{cards:p.hero?HERO:OPP,weight:1}]})),sizing:{type:'ALL_LEGAL_TOTALS',maxAggressions:3},rake:{type:'NONE'}};
}
test('all-legal river sizing exactly matches the full explicit cent tree in both orientations',()=>{
  for(const orientation of ['SB','BB']){
    const input=small(orientation),built=builder.buildPloRiverGame(input);
    assert.equal(built.status,'READY',JSON.stringify(built));assert.equal(built.game.meta.fullLegalSizingCoverage,true);
    const explicit=structuredClone(input);explicit.sizing={type:'EXPLICIT_TOTALS',levels:[.25,.26,.27,.28],maxAggressions:3};
    const compared=builder.buildPloRiverGame(explicit);assert.equal(compared.status,'READY');assert.deepEqual(built.game.root,compared.game.root);
    assert.notEqual(built.game.meta.key,compared.game.meta.key,'different declarations do not reuse an unproved cache identity');
  }
});
test('complete cent mode refuses an oversized reachable branch without returning a partial game',()=>{
  const input=small();input.multiway.config.startingStack=20;
  const refused=builder.buildPloRiverGame(input);assert.equal(refused.status,'NOT_SOLVED');assert.ok(refused.reasons.some(r=>r.code==='EXACT_SIZING_BUDGET'));assert.equal(refused.game,null);
  const capped=small();capped.sizing.maxAggressions=0;const result=builder.buildPloRiverGame(capped);
  assert.equal(result.status,'READY');assert.equal(result.game.meta.fullLegalSizingCoverage,false,'the aggression cap is never a completeness certificate');
});
test('range diagnostics independently preserve weighted joint blockers and actual Hero support',()=>{
  const ranges=[{seatId:0,source:'manual',combos:[{cards:HERO,weight:3},{cards:['Ac','Ad','6c','7d','8d'],weight:1}]},
    {seatId:1,source:'manual',combos:[{cards:OPP,weight:2},{cards:['Ac','Qh','Jd','Ts','9c'],weight:1}]}];
  const result=tools.diagnostics(ranges,BOARD,0,HERO);assert.equal(result.worlds,3);assert.equal(result.cartesianWorlds,4);
  assert.ok(Math.abs(result.compatiblePriorMass-11/12)<1e-14);assert.ok(Math.abs(result.heroMass-9/11)<1e-14);
  assert.equal(result.seats[0].effectiveCombinations,1.6);
  const snapshot=structuredClone(ranges);for(const power of [.5,2]){
    const transformed=tools.weightHypothesis(ranges,0,power);assert.deepEqual(transformed.ranges[0],ranges[0]);
    assert.deepEqual(transformed.ranges[1].combos.map(c=>c.cards),ranges[1].combos.map(c=>c.cards));assert.equal(transformed.learned,false);
    assert.equal(transformed.ranges[1].combos[0].weight/transformed.ranges[1].combos[1].weight,2**power);
  }assert.deepEqual(ranges,snapshot);
});
test('range tools reject blockers, duplicate hands, impossible Hero support and underflow',()=>{
  const input=small(),ranges=input.ranges;
  const blocked=structuredClone(ranges);blocked[0].combos[0].cards[0]='2s';assert.throws(()=>tools.diagnostics(blocked,BOARD,0,HERO),/board/);
  const duplicate=structuredClone(ranges);duplicate[0].combos.push(structuredClone(duplicate[0].combos[0]));assert.throws(()=>tools.diagnostics(duplicate,BOARD,0,HERO),/duplicate/);
  const extreme=structuredClone(ranges);extreme[1].combos.push({cards:['Ac','Ad','Qh','Jh','Th'],weight:1e-300});assert.throws(()=>tools.weightHypothesis(extreme,0,2),/underflows/);
});
test('confirmed aggressive sizes deduplicate, undo and freeze without fabricating legacy evidence',()=>{
  const store=profiles.createStore(),hand=record('size-1');const before=profiles.beginHand(store,hand).profileSnapshot;
  hand.events=[{type:'ACT',actor:0,action:'RAISE',to:3}];const synced=profiles.syncHand(store,hand);
  const observed=profiles.deriveObservations(hand).observations[0],context=observed.context;
  const result=profiles.getSizingPosterior(store.players.opponent,context,'RAISE',observed.legalMinTo,observed.legalMaxTo);
  assert.equal(result.sampleSize,1);assert.equal(before.players.opponent.contexts[profiles.contextKey(context)],undefined);
  assert.equal(profiles.syncHand(store,hand).observationsAdded,0);assert.equal(synced.observationsAdded,1);
  hand.events=[];profiles.syncHand(store,hand);assert.deepEqual(store.players.opponent.contexts,{});
  const old={contexts:{[profiles.contextKey(context)]:{context,counts:{RAISE:100}}}};
  assert.equal(profiles.getSizingPosterior(old,context,'RAISE',2,3.5).sampleSize,0);
});
test('size learning changes only compatible response contexts and respects every legal total',()=>{
  const store=profiles.createStore();for(let index=0;index<12;index++){
    const hand=record('size-learn-'+index);hand.events=[{type:'ACT',actor:0,action:'RAISE',to:3}];profiles.syncHand(store,hand);
  }
  const state=flow.replay(record('fresh').config,[]),context=profiles.contextFor(state),posterior=profiles.getSizingPosterior(store.players.opponent,context,'RAISE',state.legal.minTo,state.legal.maxTo);
  assert.equal(posterior.sampleSize,12);assert.ok(posterior.bins.find(b=>b.band==='HIGH').mean>.8);
  assert.equal(profiles.getSizingPosterior(store.players.opponent,{...context,position:'BB'},'RAISE',2,3.5).sampleSize,0);
  const rng=new Lcg(73);for(let n=0;n<80;n++){const to=ev._testing.chooseSizing(state,store.players.opponent,'RAISE',rng);assert.ok(to>=state.legal.minTo && to<=state.legal.maxTo);assert.ok(Math.abs(to*100-Math.round(to*100))<1e-7);}
  const input={...record('evaluation'),config:{...record().config,heroCards:HERO},events:[{type:'ACT',actor:0,action:'CALL'}],profileSnapshot:profiles.profileSnapshot(store,'evaluation',['opponent','hero']),assumeNoRake:true,samples:32};
  const normalized=ev._testing.normalize(input);assert.deepEqual(normalized.snapshot.players.opponent.contexts[profiles.contextKey(context)].sizingCounts,store.players.opponent.contexts[profiles.contextKey(context)].sizingCounts);
  const changed=structuredClone(input);changed.profileSnapshot.players.opponent.contexts[profiles.contextKey(context)].sizingCounts.RAISE.HIGH--;
  assert.notEqual(ev._testing.normalize(changed).fingerprint,normalized.fingerprint);
});
test('future sizing forecasts use only frozen snapshots and verified archived amounts',()=>{
  const store=profiles.createStore(),hands=[];
  for(let n=0;n<4;n++){
    const hand=record('forecast-size-'+n);profiles.beginHand(store,hand);const frozenAt=new Date(Date.UTC(2026,9,2,9,0,n*2)).toISOString();store.hands[hand.handId].profileSnapshot.frozenAt=frozenAt;
    hand.events=[{type:'ACT',actor:0,action:'RAISE',to:3,eventId:'raise'}];profiles.syncHand(store,hand);
    hands.push({...structuredClone(store.hands[hand.handId]),forecastOrigin:{version:insights.FORECAST_ORIGIN_VERSION,status:'FROZEN_BEFORE_FIRST_ACTION',createdAt:frozenAt},
      archive:{multiway:{handId:hand.handId,events:hand.events},state:{phase:'FINISHED'},archivedAt:new Date(Date.UTC(2026,9,2,9,0,n*2+1)).toISOString()}});
  }
  const scored=insights.evaluatePrequential({hands,playerIds:['opponent']});assert.equal(scored.sizing.forecasts,4);
  assert.ok(scored.sizing.metrics.logLoss.model<scored.sizing.metrics.logLoss.reference);assert.equal(scored.forecasts[0].sizing.priorOpportunities,0);assert.equal(scored.forecasts[3].sizing.priorOpportunities,3);
  const changed=structuredClone(hands);changed[3].archive.multiway.events[0].to=2.8;assert.equal(insights.evaluatePrequential({hands:changed,playerIds:['opponent']}).sizing.forecasts,3);
});
const oracle=require('./helpers/sequence-form-reference.cjs');
test('new complete cent trees and every conditioned action bound match independent sequence-form LP', {skip:oracle.available()?false:'QA LP environment unavailable'},()=>{
  for(const orientation of ['SB','BB']){
    const game=builder.buildPloRiverGame(small(orientation)).game,lp=oracle.reference({game}),solved=core.solve(game,{iterations:500});
    assert.ok(lp.reference.nashConv<1e-8);assert.ok(solved.convergence.nashConv<.01);
    for(const action of game.meta.rootActions){
      const condition={player:game.meta.heroSeat,informationSet:game.meta.heroInformationSet,actionId:action.id};
      const independent=oracle.reference({game,condition}),restricted=core.solve(conditioned.buildActionConditionedGame(game,condition),{iterations:500});
      const bounds=conditioned.evaluateActionConditioned(game,restricted.strategy,condition).boundsBB;
      const value=independent.values[game.meta.heroSeat];assert.ok(bounds[0]<=value && bounds[1]>=value,`${action.id}: ${bounds} vs ${value}`);
    }
  }
});
module.exports={small};
