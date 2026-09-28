'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {decide}=require('../src/decision-engine');

// A royal flush is exact against the declared known opponent, so this checks
// economic units and contract wiring without stochastic leadership changes.
const terminal={variant:'PLO4_HIGH',heroCards:['As','Ks','2c','3c'],
  board:['Qs','Js','Ts','8h','9d'],opponentHands:[['4c','5c','6d','7d']],
  position:'BTN',players:2,effectiveStack:100,assumeNoRake:true,
  futureStreetModel:{type:'SHOWDOWN_ONLY'},continuationEquity:1};

test('conditional legacy raise carries the street total, distinct from incremental hero cost',()=>{
  const result=decide({...terminal,potBeforeAction:30,amountToCall:5,
    heroContribution:5,raiseTo:25,minRaiseTo:20,foldEquity:.25});
  assert.equal(result.status,'OK');assert.equal(result.ev.comparisonComplete,true);
  assert.equal(result.ev.actions.RAISE.ev,41.25);
  assert.equal(result.ev.actions.RAISE.heroCost,20);
  assert.equal(result.ev.actions.RAISE.heroContribution,5);
  assert.equal(result.ev.actions.RAISE.targetStreetTotal,25);
  assert.equal(result.recommendation.status,'CONDITIONAL');
  assert.equal(result.recommendation.action,'RAISE');
  assert.equal(result.recommendation.size,25);
  assert.notEqual(result.recommendation.size,result.ev.actions.RAISE.heroCost);
  assert.equal(result.provenance.unit,'chips');
});

test('conditional legacy bet carries the evaluated size and exact modeled EV',()=>{
  const result=decide({...terminal,potBeforeAction:10,amountToCall:0,
    heroContribution:0,betSize:6,minBet:2,foldEquity:.2});
  assert.equal(result.ev.comparisonComplete,true);
  assert.ok(Math.abs(result.ev.actions.BET.ev-14.8)<1e-12);
  assert.equal(result.ev.actions.BET.heroCost,6);
  assert.equal(result.ev.actions.BET.targetStreetTotal,6);
  assert.equal(result.recommendation.status,'CONDITIONAL');
  assert.equal(result.recommendation.action,'BET');
  assert.equal(result.recommendation.size,6);
});

test('absent aggression assumptions keep both actionable recommendation and size empty',()=>{
  const result=decide({...terminal,potBeforeAction:30,amountToCall:5,
    heroContribution:5,raiseTo:25,minRaiseTo:20});
  assert.equal(result.ev.actions.RAISE.status,'NOT_MODELED');
  assert.equal(result.recommendation.status,'INCOMPLETE');
  assert.equal(result.recommendation.action,null);assert.equal(result.recommendation.size,null);
});

test('an all-in call against only one of two opponents remains a partial opponent model',()=>{
  const result=decide({variant:'PLO4_HIGH',heroCards:['As','Ad','2c','3c'],
    board:['Ks','Kh','Qd','8h','9d'],opponentHands:[['4c','5c','6d','7d']],
    position:'BTN',players:3,potBeforeAction:10,amountToCall:1,effectiveStack:1,
    assumeNoRake:true});
  assert.equal(result.status,'OK');
  assert.equal(result.state.opponentCount,2);assert.equal(result.equity.opponents,1);
  // Legal-action arithmetic is complete, but the opponents are not complete.
  assert.equal(result.ev.comparisonComplete,true);
  assert.equal(result.recommendation.status,'INCOMPLETE');
  assert.ok(result.recommendation.missingOpponentModel);
  assert.equal(result.recommendation.action,null);assert.equal(result.recommendation.size,null);
  assert.match(result.reason,/opponent|partial|oponente|adversário|parcial/i);
});
