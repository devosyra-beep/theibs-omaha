'use strict';
// Independent adversarial cases for the decision-precision contract. These
// exercise statistical meaning and known game-theory counterexamples, rather
// than reproducing the comparison implementation.
const test=require('node:test'),assert=require('node:assert/strict');
const {compareDecisionValues,solverDecisionPrecision}=require('../src/decision-precision');
const solver=require('../src/solver/extensive-solver');
const fixed={source:'LEGACY_CONTEXT_CONTINUATION',resultStatus:'HEURISTIC',contextKey:'decision-range-rake-profile-17',
  target:'CONDITIONAL_CONTINUATION_EV',uncertainty:{method:'JOINT_WEIGHTED_RATIO_HOEFFDING_WITH_STOPPING_UNION_BOUND',scope:'FIXED_CONTINUATION_POLICY',confidenceLevel:.95,simultaneous:true}};
const row=(id,evBB,boundsBB)=>({id,evBB,...(boundsBB?{boundsBB}: {})});
function compare(actions,changes={}){return compareDecisionValues({...structuredClone(fixed),actions,...changes});}
function close(actual,expected){assert.ok(Math.abs(actual-expected)<1e-10,`${actual} differs from ${expected}`);}

test('independent precision: overlapping per-action intervals leave a nonzero point gap inconclusive',()=>{
  const result=compare([row('BET:10',1.1,[.9,1.3]),row('CHECK',1,[.8,1.2])]);
  assert.equal(result.status,'INCONCLUSIVE');assert.equal(result.leaderConclusive,false);close(result.deltaEVBB,.1);
  assert.equal(result.bestActionId,'BET:10');assert.equal(result.secondActionId,'CHECK');
  assert.ok(result.differenceBoundsBB[0]<=0&&result.differenceBoundsBB[1]>=0);
});

test('independent precision: strict separation supports only the declared fixed-policy comparison',()=>{
  const result=compare([row('BET:10',1.1,[1,1.2]),row('CHECK',.5,[.4,.6]),row('FOLD',0,[0,0])]);
  assert.equal(result.status,'CONCLUSIVE');assert.equal(result.leaderConclusive,true);close(result.deltaEVBB,.6);
  close(result.differenceBoundsBB[0],.4);close(result.differenceBoundsBB[1],.8);
});

test('independent precision: an uncertain third action prevents a false winner even when the top pair separates',()=>{
  const result=compare([row('BET:10',1.1,[1,1.2]),row('CHECK',.5,[.4,.6]),row('CALL',.3,[-2,2])]);
  assert.equal(result.secondActionId,'CHECK');assert.equal(result.status,'INCONCLUSIVE');assert.equal(result.leaderConclusive,false);
});

test('independent precision: ties and merely touching bounds do not establish superiority',()=>{
  for(const actions of [[row('CHECK',1,[1,1]),row('BET:10',1,[1,1])],
    [row('CHECK',1.1,[1,1.2]),row('BET:10',.9,[.8,1])]]){
    const result=compare(actions);assert.equal(result.status,'INCONCLUSIVE');assert.equal(result.leaderConclusive,false);
  }
});

test('independent precision: missing and malformed uncertainty cannot be replaced by a generic threshold',()=>{
  const actions=[row('CHECK',10,[9,11]),row('FOLD',0,[0,0])];
  for(const uncertainty of [null,{}, {...fixed.uncertainty,simultaneous:false},{...fixed.uncertainty,confidenceLevel:.9},
    {...fixed.uncertainty,method:'NASH_CONV'},{...fixed.uncertainty,scope:'EQUILIBRIUM_ACTION_EV'}]){
    const result=compare(actions,{uncertainty,nashConv:0,thresholdBB:0});assert.equal(result.status,'INCONCLUSIVE');assert.equal(result.leaderConclusive,false);
  }
  for(const bounds of [undefined,[11,9],[null,11],[9,Infinity],[10.1,11]]){
    const result=compare([row('CHECK',10,bounds),row('FOLD',0,[0,0])]);assert.equal(result.status,'INCONCLUSIVE');assert.equal(result.leaderConclusive,false);
  }
});

test('independent precision: source, numerical status and mathematical context cannot be mixed',()=>{
  for(const metadata of [{source:'REFERENCE_SUBGAME_STRATEGY'},{resultStatus:'APPROXIMATE'},{resultStatus:'SOLVED'},{contextKey:'different-ranges-or-rake'}]){
    const result=compare([row('CHECK',10,[9,11]),{...row('FOLD',0,[0,0]),...metadata}]);
    assert.equal(result.status,'INCONCLUSIVE');assert.equal(result.reasonCode,'INCOMPATIBLE_ORIGINS');assert.equal(result.deltaEVBB,null);assert.equal(result.leaderConclusive,false);
  }
});

test('independent precision: unknown EV is not zero and one available action is not a comparison',()=>{
  for(const missing of [null,undefined,NaN,Infinity]){
    const result=compare([row('CHECK',1,[.9,1.1]),row('RAISE:10',missing,[0,0])]);assert.equal(result.status,'INCONCLUSIVE');assert.equal(result.leaderConclusive,false);
  }
  const result=compare([row('FOLD',0,[0,0])]);assert.equal(result.status,'INCONCLUSIVE');assert.equal(result.deltaEVBB,null);assert.equal(result.leaderConclusive,false);
});

function degenerateGame(){
  const terminal=value=>({type:'terminal',payoffs:[value,-value]});
  return {id:'independent-equilibrium-action-value-counterexample',playerCount:2,root:{type:'decision',player:0,informationSet:'Hero',actions:[
    {id:'A',node:{type:'decision',player:1,informationSet:'Opponent',actions:[{id:'L',node:terminal(0)},{id:'R',node:terminal(0)}]}},
    {id:'B',node:{type:'decision',player:1,informationSet:'Opponent',actions:[{id:'L',node:terminal(1)},{id:'R',node:terminal(-1)}]}}
  ]}};
}
test('independent math counterexample: NashConv zero does not bound the EV of each equilibrium action',()=>{
  const game=degenerateGame(),profiles=[[{Hero:{A:1,B:0}},{Opponent:{L:0,R:1}}],[{Hero:{A:1,B:0}},{Opponent:{L:.5,R:.5}}]];
  const values=profiles.map(profile=>{
    const evaluated=solver.evaluate(game,profile);close(evaluated.convergence.nashConv,0);
    return solver.actionValues(game,profile,0,'Hero').actions.find(action=>action.id==='B').ev;
  });
  assert.deepEqual(values,[-1,0]);
  // Both profiles are exact equilibria, yet an unused action has different EV.
  // Consequently [EV - NashConv, EV + NashConv] cannot be an equilibrium-action
  // value interval; it would give two incompatible zero-width certificates.
});

test('independent math counterexample: a small global NashConv can conceal a large conditional decision loss',()=>{
  const terminal=value=>({type:'terminal',payoffs:[value,-value]});
  const game={id:'rare-information-set',playerCount:2,root:{type:'chance',outcomes:[
    {probability:1e-7,node:{type:'decision',player:0,informationSet:'Rare hand',actions:[{id:'A',node:terminal(10000)},{id:'B',node:terminal(-10000)}]}},
    {probability:1-1e-7,node:terminal(0)}
  ]}};
  const strategy=[{'Rare hand':{A:0,B:1}},{}],value=solver.evaluate(game,strategy);
  assert.ok(value.convergence.nashConv<.01);close(value.convergence.nashConv,.002);
  const actions=solver.actionValues(game,strategy,0,'Rare hand').actions;
  close(actions.find(action=>action.id==='A').ev-actions.find(action=>action.id==='B').ev,20000);
});

test('independent solver comparison: SOLVED and exact zero NashConv still do not supply action uncertainty',()=>{
  for(const status of ['SOLVED','APPROXIMATE','REFINING']){
    const snapshot={status,source:'REFERENCE_SUBGAME_STRATEGY',method:'ALTERNATING_CFR_PLUS_LINEAR_AVERAGE',handId:'hand-17',revisionKey:'revision-17',
      qualification:{solvedSubgame:status==='SOLVED',gto:false},abstraction:{key:'same-river-tree',heroInformationSet:'Hero'},
      convergence:{exact:true,nashConv:0,thresholdBB:.01,thresholdMet:true},
      actions:[{id:'A',action:'CHECK',size:null,frequency:1,evBB:0},{id:'B',action:'BET',size:10,frequency:0,evBB:-1}]};
    const comparison=solverDecisionPrecision(snapshot);assert.equal(comparison.status,'INCONCLUSIVE');assert.equal(comparison.leaderConclusive,false);
    assert.equal(comparison.reasonCode,'EQUILIBRIUM_ACTION_VALUE_UNCERTAINTY_UNAVAILABLE');close(comparison.deltaEVBB,1);
  }
});
