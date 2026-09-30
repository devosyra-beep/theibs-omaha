'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {solverDecisionPrecision,COMMITMENT_TARGET,SOLVER_BOUND_METHOD} = require('../src/decision-precision');

function fixture() {
  const snapshot = {source:'REFERENCE_SUBGAME_STRATEGY',solverVersion:'CORE_TEST',status:'SOLVED',gameHash:'base-tree',
    abstraction:{key:'all-state-ranges-fees-utility-tree-sizings',heroInformationSet:'hand-root',heroSeat:0,
      originalSeats:2,constantSum:true,treeComplete:true,chanceSupportComplete:true},
    actions:[{id:'CHECK',evBB:20,frequency:.5},{id:'BET:2',evBB:30,frequency:.3},{id:'BET:4',evBB:50,frequency:.2}]};
  const c = snapshot.actionPrecision = {version:'THEIBS_ACTION_CONDITIONED_V1',target:COMMITMENT_TARGET,
    baseGameHash:snapshot.gameHash,solverVersion:snapshot.solverVersion,origin:SOLVER_BOUND_METHOD,
    supportedGameClass:true,player:0,informationSet:'hand-root',fullPriorPreserved:true,originalHandActionEV:false,
    utility:{unit:'BB',basis:'INCREMENTAL_TERMINAL_PAYOFF_FROM_ORIGINAL_DECISION',scope:'FULL_PRIOR_EX_ANTE'}};
  c.baseContextKey = createHash('sha256').update(JSON.stringify([snapshot.abstraction.key,'hand-root',snapshot.solverVersion,c.version])).digest('hex');
  c.actions = [[2,1.9,2.1],[1,.9,1.1],[0,-1,.5]].map(([estimateBB,lowerBB,upperBB],i)=>({
    id:snapshot.actions[i].id,estimateBB,lowerBB,upperBB,certified:true,
    baseGameHash:c.baseGameHash,baseContextKey:c.baseContextKey,origin:c.origin,solverVersion:c.solverVersion,
    conditionedHash:'conditioned-'+i,gameHash:'conditioned-'+i,iterations:100,elapsedMs:12
    ,version:c.version,target:c.target,player:c.player,informationSet:c.informationSet,
    fullPriorPreserved:true,originalHandActionEV:false,utility:{...c.utility},
    rootActionFixed:snapshot.actions[i].id,rounding:'IEEE754_BINARY64_NEXTAFTER_EACH_OPERATION'
  }));
  return snapshot;
}

test('saddle bounds rank commitment estimates, never original-profile EV or global NashConv',()=>{
  const s=fixture();s.convergence={nashConv:100};
  const p=solverDecisionPrecision(s);
  assert.equal(p.status,'CONCLUSIVE');assert.equal(p.bestActionId,'CHECK');
  assert.equal(p.target,COMMITMENT_TARGET);assert.equal(p.deltaEVBB,1);
  assert.equal(p.confidenceLevel,null);assert.equal(p.globalBestSupported,false);
  assert.equal(p.reasonCode,'SEPARATED_ACTION_COMMITMENT_BOUNDS');
  assert.deepEqual(p.bestBoundsBB,[1.9,2.1]);assert.equal(s.actions[2].evBB,50);
});

test('a third action with a low estimate but wide upper bound prevents a conclusion',()=>{
  const s=fixture();s.actionPrecision.actions[2].upperBB=3;
  const p=solverDecisionPrecision(s);
  assert.equal(p.bestSecondSeparated,true);assert.equal(p.strongestAlternativeUpperBB,3);
  assert.equal(p.status,'INCONCLUSIVE');assert.equal(p.reasonCode,'OTHER_ALTERNATIVE_INTERVAL_OVERLAPS');
});

test('touching bounds and tiny unprotected numerical gaps are inconclusive',()=>{
  const s=fixture();s.actionPrecision.actions[1].upperBB=1.9;
  assert.equal(solverDecisionPrecision(s).status,'INCONCLUSIVE');
  s.actionPrecision.actions[1].upperBB=1.9-Number.EPSILON;
  assert.equal(solverDecisionPrecision(s).status,'INCONCLUSIVE');
});

test('state, range, fee, utility, tree, sizing, query and version fingerprints must agree',()=>{
  const mutations = [s=>{s.gameHash='another-tree';},s=>{s.abstraction.key='another-rake';},
    s=>{s.abstraction.heroInformationSet='another-hand';},s=>{s.actionPrecision.player=1;},
    s=>{s.actionPrecision.actions[1].baseGameHash='other-range';},
    s=>{s.actionPrecision.actions[1].baseContextKey='other-utility';},
    s=>{s.actionPrecision.actions[1].solverVersion='OLD';},
    s=>{s.actionPrecision.actions[1].origin='EV_PLUS_NASHCONV';},
    s=>{s.actionPrecision.actions[1].conditionedHash='wrong-conditioned-tree';},
    s=>{s.actionPrecision.actions[1].target='CONDITIONAL_HAND_EV';},
    s=>{s.actionPrecision.actions[1].utility.scope='HERO_HAND_ONLY';},
    s=>{s.actionPrecision.actions[1].utility.unit='CHIPS';},
    s=>{s.actionPrecision.actions[1].fullPriorPreserved=false;},
    s=>{s.actionPrecision.actions[1].originalHandActionEV=true;},
    s=>{s.actionPrecision.actions[1].version='UNVALIDATED';},
    s=>{s.actionPrecision.actions[1].rootActionFixed='FOLD';},
    s=>{s.actionPrecision.actions[1].rounding='NEAREST';},
    s=>{s.actionPrecision.actions[1].source='LEGACY_CONTEXT_CONTINUATION';}];
  for(const mutate of mutations){const s=fixture();mutate(s);const p=solverDecisionPrecision(s);
    assert.equal(p.status,'INCONCLUSIVE');assert.equal(p.reasonCode,'INVALID_ACTION_BOUND_CONTEXT');
    assert.equal(p.deltaEVBB,null);assert.equal(p.bestActionId,null);}
});

test('an unresolved action remains unavailable and prevents complete ranking',()=>{
  const s=fixture();Object.assign(s.actionPrecision.actions[2],{certified:false,estimateBB:null,lowerBB:null,upperBB:null,conditionedHash:null,gameHash:null});
  const p=solverDecisionPrecision(s);assert.equal(p.status,'INCONCLUSIVE');
  assert.equal(p.reasonCode,'MISSING_ACTION_VALUES');assert.equal(p.deltaEVBB,1);
});

test('missing or duplicate alternatives cannot certify the root action set',()=>{
  for(const mutate of [s=>s.actionPrecision.actions.pop(),s=>{s.actionPrecision.actions[2].id='CHECK';}]){
    const s=fixture();mutate(s);assert.equal(solverDecisionPrecision(s).status,'INCONCLUSIVE');
  }
});

test('nonconstant sum, incomplete chance or multiplayer cannot use this certificate',()=>{
  for(const mutate of [s=>{s.abstraction.constantSum=false;},s=>{s.abstraction.originalSeats=3;},
    s=>{s.abstraction.treeComplete=false;},s=>{s.abstraction.chanceSupportComplete=false;}]){
    const s=fixture();mutate(s);const p=solverDecisionPrecision(s);assert.equal(p.status,'INCONCLUSIVE');
    assert.equal(p.reasonCode,'INVALID_ACTION_BOUND_CONTEXT');
  }
});

test('numerical solution status remains separate from ranking precision',()=>{
  const s=fixture();s.status='APPROXIMATE';assert.equal(solverDecisionPrecision(s).status,'CONCLUSIVE');
  assert.equal(s.status,'APPROXIMATE');s.status='SOLVED';s.actionPrecision.actions[2].upperBB=9;
  assert.equal(solverDecisionPrecision(s).status,'INCONCLUSIVE');assert.equal(s.status,'SOLVED');
});
