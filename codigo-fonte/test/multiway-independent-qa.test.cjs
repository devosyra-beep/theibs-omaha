'use strict';
// Independent deterministic cases. These test economic/temporal invariants,
// not a snapshot of the evaluator's implementation or a real acoustic model.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeCards}=require('../src/cards');
const {replay}=require('../src/hand-flow');
const profiles=require('../src/player-profiles');
const evaluator=require('../src/multiway-evaluator');
const {Lcg}=require('../src/equity-engine');
const act=(actor,action,to)=>({type:'ACT',actor,action,...(to===undefined?{}:{to})});
const board=['2s','3h','4d','8c','9s'];
function riverCall(){
  return {handId:'qa-river-call',samples:32,assumeNoRake:true,
    config:{variant:'PLO4_HIGH',playerCount:2,heroPosition:'SB',startingStack:100,smallBlind:.5,bigBlind:1,
      heroCards:['As','Ah','Kd','Qc'],players:[{playerId:'qa-hero',name:'Hero'},{playerId:'qa-opponent',name:'Opponent'}]},
    events:[act(0,'CALL'),act(1,'CHECK'),{type:'BOARD',cards:board.slice(0,3)},act(1,'BET',2),act(0,'RAISE',6),act(1,'CALL'),
      {type:'BOARD',cards:board.slice(0,4)},act(1,'BET',3),act(0,'CALL'),{type:'BOARD',cards:board},act(1,'BET',10)]};
}
function world(context,opponent){const hands={[context.state.heroId]:context.config.heroCards,[1-context.state.heroId]:opponent};
  return{hands,parsed:Object.fromEntries(Object.entries(hands).map(([id,cards])=>[id,normalizeCards(cards)])),board,seed:17};}

test('independent terminal call worlds reproduce P30 C10 equity30% = +2 without charging prior chips twice',()=>{
  const context=evaluator._testing.normalize(riverCall());
  assert.equal(context.state.pot,30);assert.equal(context.state.legal.toCall,10);assert.equal(context.state.players[0].totalPaid,10);
  const won=world(context,['Ks','Kh','Jd','Tc']),lost=world(context,['2c','2h','Qd','Jh']);
  const win=evaluator._testing.rollout(context,{action:'CALL'},won,evaluator._testing.scoresFor(won));
  const loss=evaluator._testing.rollout(context,{action:'CALL'},lost,evaluator._testing.scoresFor(lost));
  assert.equal(win,30);assert.equal(loss,-10);
  assert.equal(evaluator._testing.weightedMean([win,loss],[.3,.7]),2);
  assert.equal(evaluator._testing.rollout(context,{action:'FOLD'},won,evaluator._testing.scoresFor(won)),0);
});

test('each joint world respects blockers including folded seats and never sees a future board in history likelihood',()=>{
  const input=riverCall();input.events=input.events.slice(0,4); // Hero faces a flop bet; turn/river are unknown.
  const context=evaluator._testing.normalize(input),rng=new Lcg(12345);
  assert.equal(context.state.board.length,3);
  for(let i=0;i<30;i++){
    const sample=evaluator._testing.drawWorld(context,rng),cards=[...Object.values(sample.hands).flat(),...sample.board];
    assert.equal(cards.length,new Set(cards).size);assert.deepEqual(sample.board.slice(0,3),board.slice(0,3));
    const weight=evaluator._testing.historyWeight(context,sample);
    const replaced=evaluator._testing.historyWeight(context,{...sample,board:['Ac','Ad','Kc','Qh','Js']});
    assert.equal(weight,replaced);
  }
});

test('unknown rake leaves aggressive and call EV unavailable while the fold reference stays exact',()=>{
  const input=riverCall();delete input.assumeNoRake;
  const result=evaluator.evaluateMultiway(input);
  assert.equal(result.ev.actions.FOLD.ev,0);assert.deepEqual(result.ev.actions.FOLD.numericalBounds,[0,0]);
  for(const item of result.ev.candidates.filter(item=>item.action!=='FOLD')){
    assert.equal(item.status,'NOT_MODELED');assert.equal(item.ev,null);assert.equal(item.evBB,null);
  }
  assert.equal(result.ev.globalBestSupported,false);assert.equal(result.recommendation.action,null);
});

test('profile updates retain exact opportunity denominators and exclude the current hand from its frozen prior',()=>{
  const input=riverCall(),store=profiles.createStore();input.events=[];
  const original=profiles.beginHand(store,input).profileSnapshot;
  input.events=[act(0,'CALL'),act(1,'CHECK')];profiles.syncHand(store,input);
  const now=profiles.beginHand(store,input).profileSnapshot;
  assert.deepEqual(now,original);
  const hero=profiles.summarizePlayer(store,'qa-hero');
  assert.equal(hero.observations,1);
  for(const estimate of Object.values(hero.contexts[0].estimates))assert.equal(estimate.opportunities,1);
  profiles.addNote(store,'qa-opponent','Possibly passive; this is a note, not an observed action.');
  assert.equal(profiles.summarizePlayer(store,'qa-opponent').observations,1);
  input.events=[];profiles.syncHand(store,input);
  assert.equal(profiles.summarizePlayer(store,'qa-opponent').observations,0);
  assert.deepEqual(profiles.beginHand(store,input).profileSnapshot,original);
});

test('a legal free fold remains recordable evidence and has positive declared likelihood',()=>{
  const cfg={variant:'PLO4_HIGH',playerCount:3,heroPosition:'BB',startingStack:30,smallBlind:.5,bigBlind:1,
    heroCards:['As','Ah','Kd','Qc'],players:[{playerId:'qa-a',name:'A'},{playerId:'qa-hero',name:'Hero'},{playerId:'qa-b',name:'B'}]};
  const prefix=[act(2,'CALL'),act(0,'CALL'),act(1,'CHECK'),{type:'BOARD',cards:board.slice(0,3)}];
  const before=replay(cfg,prefix);assert.equal(before.actor,0);assert.equal(before.legal.toCall,0);
  assert.ok(before.legal.actions.includes('FOLD'));
  const input={config:cfg,events:[...prefix,act(0,'FOLD')],handId:'qa-free-fold',samples:32,assumeNoRake:true};
  const derived=profiles.deriveObservations(input);
  assert.ok(derived.observations.some(item=>item.eventIndex===4&&item.action==='FOLD'));
  const context=evaluator._testing.normalize(input),sample=evaluator._testing.drawWorld(context,new Lcg(55));
  assert.ok(evaluator._testing.historyWeight(context,sample)>0);
});

test('later hidden-card metadata cannot alter the decision fingerprint or sampled worlds',()=>{
  const input=riverCall(),baseline=evaluator._testing.normalize(input);
  const poison={...input,opponentCards:['Ac','Ad','Kc','Qh'],futureBoard:['Ac','Ad','Kc','Qh','Js'],
    config:{...input.config,opponentCards:['Ac','Ad','Kc','Qh'],futureBoard:['Ac','Ad','Kc','Qh','Js'],
      players:input.config.players.map(player=>({...player,name:'Renamed after the hand'}))}};
  const revised=evaluator._testing.normalize(poison);
  assert.equal(revised.fingerprint,baseline.fingerprint);assert.equal(revised.seed,baseline.seed);
  assert.deepEqual(evaluator._testing.drawWorld(revised,new Lcg(revised.seed)),evaluator._testing.drawWorld(baseline,new Lcg(baseline.seed)));
  const extraEvents={...input,events:input.events.map(event=>({...event,laterShownCards:['Ac','Ad','Kc','Qh'],futureBoard:['Ac','Ad','Kc','Qh','Js']}))};
  assert.equal(evaluator._testing.normalize(extraEvents).fingerprint,baseline.fingerprint);
});

test('candidate and action gaps retain their own comparison set and use one common model',()=>{
  const result=evaluator.evaluateMultiway({...riverCall(),chosenSize:25,timeBudgetMs:2400});
  const ranked=result.ev.candidates.filter(item=>item.status==='MODELED').sort((a,b)=>b.ev-a.ev);
  const actions=Object.values(result.ev.actions).filter(item=>item.legal&&item.status==='MODELED').sort((a,b)=>b.ev-a.ev);
  assert.equal(result.ev.bestModeledOptionId,ranked[0].optionId);
  assert.equal(result.ev.gapBestSecondCandidateBB,(ranked[0].ev-ranked[1].ev)/result.ev.bigBlind);
  assert.equal(result.ev.gapBestSecondBB,(actions[0].ev-actions[1].ev)/result.ev.bigBlind);
  assert.equal(new Set(actions.filter(item=>item.action!=='FOLD').map(item=>item.comparisonContext)).size,1);
  assert.deepEqual([...new Set(ranked.filter(item=>item.action!=='FOLD').map(item=>item.samples))],[result.multiwayEvaluation.samples]);
  assert.equal(result.ev.globalBestSupported,false);assert.equal(result.recommendedAction,'NO_DECISION');
});

test('range sampling respects an expired calculation budget before drawing a world',()=>{
  const context=evaluator._testing.normalize(riverCall());context.deadline=performance.now()-1;
  assert.throws(()=>evaluator._testing.drawWorld(context,new Lcg(42)),error=>error.code==='TIME_BUDGET');
});

test('a multiway table reduced to two players cannot borrow an original heads-up policy',()=>{
  const cfg={variant:'PLO4_HIGH',playerCount:2,heroPosition:'BB',startingStack:30,smallBlind:.5,bigBlind:1,heroCards:['As','Ah','Kd','Qc']};
  const headsUp=replay(cfg,[act(0,'CALL'),act(1,'CHECK'),{type:'BOARD',cards:board.slice(0,3)},act(1,'CHECK')]);
  const reduced=replay({...cfg,playerCount:6},[act(2,'FOLD'),act(3,'FOLD'),act(4,'FOLD'),act(5,'FOLD'),act(0,'CALL'),act(1,'CHECK'),{type:'BOARD',cards:board.slice(0,3)}]);
  assert.equal(headsUp.activePlayers,2);assert.equal(reduced.activePlayers,2);
  assert.equal(headsUp.players[headsUp.actor].position,'SB');assert.equal(reduced.players[reduced.actor].position,'SB');
  const a=profiles.contextFor(headsUp),b=profiles.contextFor(reduced);
  assert.notEqual(profiles.contextKey(a),profiles.contextKey(b));
  const learned={contexts:{[profiles.contextKey(a)]:{context:a,counts:{CHECK:100}}}};
  assert.equal(profiles.getPosterior(learned,a).sampleSize,100);
  assert.equal(profiles.getPosterior(learned,b).sampleSize,0);
});
