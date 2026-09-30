'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMultiway, candidatesFor, _testing } = require('../src/multiway-evaluator');
const { replay } = require('../src/hand-flow');
const { normalizeCards } = require('../src/cards');
const { calculateActionEV } = require('../src/action-ev-engine');
function river(hero = ['As','Ah','Kd','Qc'], board = ['2s','3h','4d','8c','9s']) {
  const config = { variant: 'PLO4_HIGH', playerCount: 2, heroPosition: 'BB', startingStack: 20, smallBlind: .5, bigBlind: 1, heroCards: hero };
  const events = [{type:'ACT',actor:0,action:'CALL'},{type:'ACT',actor:1,action:'CHECK'}];
  for (const length of [3,4,5]) { events.push({ type:'BOARD',cards:board.slice(0,length) }); if (length<5) events.push({type:'ACT',actor:1,action:'CHECK'},{type:'ACT',actor:0,action:'CHECK'}); }
  return { config, events, handId:'river-test', samples:32, assumeNoRake:true };
}
function world(context, opponents, board) { const hands = { [context.state.heroId]: context.config.heroCards, ...opponents }; return { hands, parsed:Object.fromEntries(Object.entries(hands).map(([id,cards])=>[id,normalizeCards(cards)])),board,seed:42 }; }
const passive = state => ({action:state.legal.toCall?'CALL':'CHECK'});
test('incremental reference formula: P30 C10 equity30% returns +2', () => {
  const result = calculateActionEV({ legalActions:['FOLD','CALL'],potBeforeAction:30,amountToCall:10,equity:.3,assumeNoRake:true,bigBlind:1 });
  assert.equal(result.actions.CALL.ev,2); assert.equal(result.actions.FOLD.ev,0);
});
test('terminal river checks return the prior pot and bets debit only incremental contributions', () => {
  const input=river(),context=_testing.normalize(input), w=world(context,{0:['Ks','Kh','Jd','Tc']},input.events.at(-1).cards), scores=_testing.scoresFor(w);
  assert.equal(_testing.rollout(context,{action:'CHECK',size:null},w,scores,passive),2);
  assert.equal(_testing.rollout(context,{action:'BET',size:1.5},w,scores,passive),3.5);
});
test('rake excludes an uncalled bet when opponents fold', () => {
  const input=river(); delete input.assumeNoRake; input.rake=.5;
  const context=_testing.normalize(input),w=world(context,{0:['Ks','Kh','Jd','Tc']},input.events.at(-1).cards);
  assert.equal(_testing.rollout(context,{action:'BET',size:2},w,_testing.scoresFor(w),()=>({action:'FOLD'})),1.5);
});
test('PLO5 all-in call retains eligibility in main pot and settles side pot separately', () => {
  const config={variant:'PLO5_HIGH',playerCount:3,heroPosition:'SB',startingStack:10,stacks:[5,10,10],smallBlind:.5,bigBlind:1,heroCards:['As','Ah','Qd','Jc','Tc']};
  const events=[{type:'ACT',actor:2,action:'RAISE',to:3},{type:'ACT',actor:0,action:'CALL'},{type:'ACT',actor:1,action:'RAISE',to:10},{type:'ACT',actor:2,action:'CALL'}];
  const context=_testing.normalize({config,events,handId:'pots',samples:32,assumeNoRake:true});
  const w=world(context,{1:['Ks','Kd','9d','8c','7h'],2:['Qs','Qh','8d','7s','6h']},['Ad','Ac','Kh','2d','3s']);
  assert.equal(_testing.rollout(context,{action:'CALL'},w,_testing.scoresFor(w),passive),13);
  context.costs={schedule:{type:'PERCENT_CAPPED',rate:.1,cap:100,noFlopNoDrop:false,rounding:'NEAREST_CENT',source:'USER_PROVIDED',version:'1'}};
  assert.equal(_testing.rollout(context,{action:'CALL'},w,_testing.scoresFor(w),passive),10.5);
});
test('ties split pot using the same settlement ledger', () => {
  const input=river(['As','Kd','4c','5c'],['Qs','Jh','Tc','9d','2h']),context=_testing.normalize(input),w=world(context,{0:['Ah','Kc','6c','7c']},input.events.at(-1).cards);
  assert.equal(_testing.rollout(context,{action:'CHECK'},w,_testing.scoresFor(w),passive),1);
});
test('all legal sizing candidates including custom are modeled under declared continuation', () => {
  const input=river();input.chosenSize=1.37; const result=evaluateMultiway(input);
  assert.equal(result.status,'OK'); assert.ok(result.ev.candidates.some(item=>item.size===1.37));
  assert.ok(result.ev.candidates.every(item=>item.status==='MODELED'&&Number.isFinite(item.ev)));
  assert.equal(result.ev.globalBestSupported,false); assert.equal(result.recommendedAction,'NO_DECISION');
  for(const item of result.ev.candidates) assert.ok(item.confidenceInterval95[0]<=item.ev&&item.confidenceInterval95[1]>=item.ev);
  assert.ok(result.multiwayEvaluation.elapsedMs<3000);
});
test('rake absence is null, never invented net EV; invalid size/range/context rejected', () => {
  const input=river();delete input.assumeNoRake;
  const result=evaluateMultiway(input); assert.ok(result.ev.candidates.filter(item=>item.action!=='FOLD').every(item=>item.status==='NOT_MODELED'&&item.ev===null));
  assert.throws(()=>evaluateMultiway({...input,chosenSize:500}),/legal/);
  assert.throws(()=>evaluateMultiway({...input,ranges:[{seatId:0,range:{hands:[['As','Ah','Kd','Qc','Jh']]}}]}),/4 cards/);
  assert.throws(()=>evaluateMultiway({...input,profileSnapshot:{schemaVersion:1,source:'PRE_HAND_OBSERVATIONS',handId:'other',players:{}}}),/pre-hand/);
});
test('insufficient numeric support cannot become a conclusive global action', () => {
  const input=river(),result=evaluateMultiway(input);
  assert.equal(result.ev.globalBestSupported,false); assert.equal(result.recommendation.status,'INCONCLUSIVE');
  const precision=result.ev.decisionPrecision;
  assert.equal(precision.source,'LEGACY_CONTEXT_CONTINUATION');
  assert.equal(precision.originVersion,result.multiwayEvaluation.model);
  assert.equal(precision.resultStatus,'HEURISTIC');
  assert.equal(precision.contextKey,result.multiwayEvaluation.fingerprint);
  assert.equal(precision.status,'INCONCLUSIVE');
  assert.equal(precision.leaderConclusive,false);
  assert.equal(result.ev.leaderConclusive,false);
  assert.equal(precision.modelUncertaintyIncluded,false);
  const ranked=result.ev.candidates.slice().sort((a,b)=>b.evBB-a.evBB);
  assert.equal(precision.deltaEVBB,ranked[0].evBB-ranked[1].evBB);
  assert.equal(result.ev.gapBestSecondCandidateBB,precision.deltaEVBB);
  const interval=_testing.weightedBounds([1,1],[.001,.001],0,10,5,32); assert.deepEqual(interval,[0,10]);
});
test('cards/board identity is validated and future revealed cards are not accepted as current facts', () => {
  const input=river();input.config.heroCards=['As','As','Kd','Qc'];assert.throws(()=>evaluateMultiway(input),/Duplicate/);
  const context=_testing.normalize(river());assert.equal(context.state.board.length,5);
  assert.throws(()=>candidatesFor(replay(river().config,[]),1000),/legal/);
});
