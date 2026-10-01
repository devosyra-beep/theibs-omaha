'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const outcome = require('../src/solver/decision-outcome');
const core = require('../src/solver/extensive-solver');
const certificate = require('../src/solver/action-conditioned');
const { solverDecisionPrecision } = require('../src/decision-precision');
const { execute, chooseFocus, focusActions, VERSION } = require('../src/solver/job-worker');
const fixtures = require('../public/solver-validation-fixtures.json');

function snapshot(bounds = [['A',10,10.001],['B',9.998,9.999],['C',0,1]]) {
  const abstraction = { key: 'declared-game', heroInformationSet: 'Hero', heroSeat: 0, originalSeats: 2,
    constantSum: true, treeComplete: true, chanceSupportComplete: true, rootActions: bounds.map(([id]) => ({id})) };
  const baseContextKey = createHash('sha256').update(JSON.stringify([abstraction.key,abstraction.heroInformationSet,core.VERSION,certificate.VERSION])).digest('hex');
  const common = { version: certificate.VERSION, solverVersion: core.VERSION, target: certificate.TARGET, origin: certificate.ORIGIN,
    baseGameHash: 'base-hash', baseContextKey, player: 0, informationSet: 'Hero', originalHandActionEV: false, fullPriorPreserved: true,
    utility: { unit: 'BB', basis: 'INCREMENTAL_TERMINAL_PAYOFF_FROM_ORIGINAL_DECISION', scope: 'FULL_PRIOR_EX_ANTE' } };
  return { status: 'APPROXIMATE', source: 'REFERENCE_SUBGAME_STRATEGY', solverVersion: core.VERSION, gameHash: 'base-hash', abstraction,
    convergence: { exact: true, thresholdMet: true, nashConv: 0 }, actions: bounds.map(([id],index) => ({id,evBB:index ? -1000 : 100})),
    actionPrecision: { ...common, supportedGameClass: true, status: 'SUPPORTED', actions: bounds.map(([id,lowerBB,upperBB]) => ({
      ...common, id, lowerBB, upperBB, estimateBB: lowerBB/2+upperBB/2, certified: true,
      gameHash: 'conditioned-'+id, conditionedHash: 'conditioned-'+id, rootActionFixed: id, rounding: 'IEEE754_BINARY64_NEXTAFTER_EACH_OPERATION' })) } };
}
function mathematical(result) {
  return { gameHash: result.gameHash, actions: result.actions, convergence: result.convergence,
    certificates: result.actionPrecision.actions.map(row => ({id:row.id,gameHash:row.gameHash,lower:row.lowerBB,upper:row.upperBB,certified:row.certified})),
    precision: result.decisionPrecision };
}

test('normalized comparison policy defaults only absent values and rejects malformed or mismatched semantics', () => {
  const expected = {version:'THEIBS_COMPARISON_POLICY_V1',nearEquivalenceBB:.01,unit:'BB',scope:'FULL_PRIOR_COMMITMENT'};
  assert.deepEqual(outcome.normalizePolicy(), expected); assert.deepEqual(outcome.normalizePolicy({}), expected);
  assert.equal(outcome.policyKey(),outcome.policyKey(expected));
  assert.equal(Object.is(outcome.normalizePolicy({nearEquivalenceBB:-0}).nearEquivalenceBB,-0),false);
  for (const value of [null,[],{nearEquivalenceBB:null},{nearEquivalenceBB:'0.01'},{nearEquivalenceBB:-1},
    {nearEquivalenceBB:Infinity},{nearEquivalenceBB:NaN},{version:'old'},{unit:'chips'},{scope:'ACTUAL_HAND_EV'}])
    assert.throws(() => outcome.normalizePolicy(value),/policy|nearEquivalence|comparisonPolicy/);
  assert.notEqual(outcome.policyKey({nearEquivalenceBB:.02}),outcome.policyKey());
});

test('near equivalence includes a strictly dominated epsilon-near commitment and takes precedence over strict precision', () => {
  const source = snapshot(), precision = solverDecisionPrecision(source), result = outcome.decide(source);
  assert.equal(precision.status,'CONCLUSIVE'); assert.equal(precision.bestActionId,'A');
  assert.equal(result.status,'NEAR_EQUIVALENT'); assert.deepEqual(result.nearGroupActionIds,['A','B']);
  assert.deepEqual(result.actionIds,['A','B','C']); assert.ok(result.robustWorstDifferenceBB > .003 && result.robustWorstDifferenceBB < .01);
  assert.equal(result.scope,'FULL_PRIOR_COMMITMENT'); assert.equal(result.actualHandEVEquivalence,false);
  assert.equal(result.coverage,'ALL_DECLARED_ALTERNATIVES_ONLY');
  assert.equal(result.diagnostics.pointEstimateScope,'FULL_PRIOR_COMMITMENT');
  assert.equal(result.diagnostics.originalProfilePointDeltaBB,1100);
  assert.deepEqual(focusActions(result.actionIds,source.actionPrecision.actions).dominatedActions.map(row=>row.id),['B','C']);
});

test('robust proof compares against every declared alternative, never only a close pair of losing points', () => {
  const result = outcome.decide(snapshot([['BEST',100,100.001],['LOSE1',0,.001],['LOSE2',0,.001]]));
  assert.equal(result.status,'CERTIFIED'); assert.equal(result.strictLeaderActionId,'BEST'); assert.deepEqual(result.nearGroupActionIds,[]);
  const wide = snapshot([['A',-100,100],['B',-100,100],['C',-100,100]]);
  wide.actions.forEach(row => {row.evBB=2;});
  assert.equal(outcome.decide(wide).status,'INCONCLUSIVE');
  assert.equal(outcome.decide(wide,{refining:true}).status,'ESTIMATING');
});

test('pending or incomplete bounds estimate during work and remain inconclusive after stopping', () => {
  const source = snapshot(); source.actionPrecision.supportedGameClass=false; source.actionPrecision.status='PENDING';
  source.actionPrecision.actions.forEach(row => {row.certified=false;row.estimateBB=null;row.lowerBB=null;row.upperBB=null;});
  assert.equal(outcome.decide(source,{refining:true}).status,'ESTIMATING');
  assert.equal(outcome.decide(source).status,'INCONCLUSIVE');
  const incomplete = snapshot(); incomplete.actionPrecision.actions[2].certified=false;
  assert.equal(outcome.decide(incomplete,{refining:true}).status,'ESTIMATING');
  assert.equal(outcome.decide(incomplete).status,'INCONCLUSIVE');
});

test('global convergence is an independent required gate and never supplies an action bound', () => {
  for (const change of [source=>{source.convergence.nashConv=.02;},source=>{source.convergence.nashConv=-1;},
    source=>{source.convergence.exact=false;},source=>{source.convergence.thresholdMet=false;}]) {
    const source=snapshot();change(source);
    assert.equal(outcome.decide(source).status,'INCONCLUSIVE'); assert.equal(outcome.decide(source,{refining:true}).status,'ESTIMATING');
  }
  const source=snapshot();source.actionPrecision.actions.forEach(row=>{row.certified=false;});
  assert.equal(outcome.decide(source).status,'INCONCLUSIVE');
});

test('wrong result origin, status, identity, solver, utility or rounding cannot prove an outcome', () => {
  for (const change of [source=>{source.source='HEURISTIC';},source=>{source.status='NOT_SOLVED';},source=>{source.status='HEURISTIC';},
    source=>{source.solverVersion='old';},source=>{source.actions[1].id='A';},source=>{source.actionPrecision.baseContextKey='other';},
    source=>{source.actionPrecision.actions[0].utility.scope='ACTUAL_HAND_EV';},source=>{source.actionPrecision.actions[0].rounding='NONE';},
    source=>{source.actionPrecision.actions[0].rootActionFixed='B';},source=>{source.actionPrecision.actions[0].conditionedHash='other';}]) {
    const source=snapshot();change(source);source.decisionPrecision={status:'CONCLUSIVE',bestActionId:'A'};
    assert.equal(outcome.decide(source).status,'INCONCLUSIVE');
  }
  const omitted=snapshot();omitted.actions.pop();omitted.actionPrecision.actions.pop();
  assert.equal(outcome.decide(omitted).status,'INCONCLUSIVE','dropping a declared alternative cannot fabricate an all-alternatives proof');
});

test('upward arithmetic withholds a rounded boundary proof and zero only accepts an exact zero difference', () => {
  assert.ok(outcome.outwardDifference(.01,0)>.01);
  assert.equal(outcome.decide(snapshot([['A',0,.01],['B',0,.01]])).status,'INCONCLUSIVE');
  assert.equal(outcome.decide(snapshot([['A',0,0],['B',0,0]]),{policy:{nearEquivalenceBB:0}}).status,'NEAR_EQUIVALENT');
  assert.equal(outcome.decide(snapshot([['A',0,Number.MIN_VALUE],['B',0,Number.MIN_VALUE]]),{policy:{nearEquivalenceBB:0}}).status,'INCONCLUSIVE');
});

test('diagnostic costs distinguish measured phases, missing fields, point scope and time versus iteration ceilings', () => {
  const source=snapshot([['A',-1,1],['B',-1,1]]), costs={buildMs:2,globalSolveMs:3,globalEvaluationMs:1,actionSolveMs:15,actionCertificateMs:4,totalComputeMs:30};
  const result=outcome.decide(source,{costs,firstValueMs:6,attempts:{A:2,B:1},stopReason:'TIME_RESOURCE_CEILING'});
  assert.equal(result.diagnostics.category,'TIME_BUDGET_EXHAUSTED');
  assert.ok(result.diagnostics.categories.includes('CERTIFICATION_BOTTLENECK'));
  assert.equal(result.diagnostics.costs.baseMs,6);assert.equal(result.diagnostics.costs.boundsMs,4);assert.equal(result.diagnostics.costs.unattributedMs,9);
  assert.equal(result.diagnostics.counts.refinementBatches,3);
  const missing=outcome.decide(source,{costs:{totalComputeMs:30,actionSolveMs:15},stopReason:'ITERATION_RESOURCE_CEILING'});
  assert.equal(missing.diagnostics.costs.baseMs,null);assert.equal(missing.diagnostics.costs.boundsMs,null);
  assert.equal(missing.diagnostics.iterationBudgetExhausted,true);
  assert.ok(!missing.diagnostics.categories.includes('TIME_BUDGET_EXHAUSTED'));
  assert.ok(missing.diagnostics.costs.missing.includes('buildMs'));
  const empty=outcome.decide({status:'NOT_SOLVED',actions:[]});
  assert.equal(empty.status,'INCONCLUSIVE');assert.equal(empty.diagnostics.category,'UNKNOWN');assert.equal(empty.diagnostics.costs.firstValueMs,null);
});

test('all unknown alternatives get an initial attempt; later frontier work cannot starve a third wide contender', () => {
  const ids=['A','B','C','D'], attempts={}, rows=ids.map(id=>({id,certified:false}));
  for(let i=0;i<ids.length;i++) {const selected=chooseFocus(ids,rows,attempts);assert.equal(selected.phase,'INITIAL_ALL_ACTIONS');attempts[selected.id]=(attempts[selected.id]||0)+1;}
  assert.deepEqual(attempts,{A:1,B:1,C:1,D:1});
  const known=ids.map((id,index)=>({id,certified:true,lowerBB:index?0:4,upperBB:index===2?100:6}));
  for(let i=0;i<80;i++) {const selected=chooseFocus(ids,known,attempts);attempts[selected.id]++;const counts=ids.map(id=>attempts[id]);assert.ok(Math.max(...counts)-Math.min(...counts)<=2);}
  assert.ok(ids.every(id=>attempts[id]>=19));
  const near=snapshot().actionPrecision.actions, selection=chooseFocus(['A','B','C'],near,{A:1,B:1,C:1});
  assert.ok(selection.refinementActionIds.includes('B'));assert.ok(!selection.refinementActionIds.includes('C'));
  assert.deepEqual(chooseFocus(['A','B','C'],near,{A:1,B:1,C:1},{nearEquivalenceBB:0}).refinementActionIds,['A']);
});

test('real tied terminal commitments close Near while preserving legacy INCONCLUSIVE precision and mathematical tree', () => {
  const source=fixtures.cases.find(row=>row.id==='terminal_call_fold_tie') || fixtures.cases.find(row=>row.expectation?.comparisonStatus==='INCONCLUSIVE');
  assert.ok(source,'fixture needs a real terminal tie');
  const input=structuredClone(source.variants[0].input), original=structuredClone(input), progress=[];
  const near=execute({input,budget:{timeMs:3000,iterations:1000},onProgress:event=>progress.push(event.result)});
  assert.equal(progress[0].decisionOutcome.status,'ESTIMATING');
  assert.equal(near.result.decisionOutcome.status,'NEAR_EQUIVALENT');assert.equal(near.result.decisionPrecision.status,'INCONCLUSIVE');
  assert.equal(near.result.adaptation.stopReason,'GLOBAL_CONVERGENCE_AND_CERTIFIED_NEAR_EQUIVALENCE');
  assert.equal(near.result.adaptation.refinementRecommended,false);assert.ok(near.result.decisionOutcome.diagnostics.costs.firstValueMs>=0);
  assert.deepEqual(input,original);
  const exact=execute({input:{...input,comparisonPolicy:{nearEquivalenceBB:0}},budget:{timeMs:3000,iterations:1000}});
  assert.equal(exact.result.decisionOutcome.status,'INCONCLUSIVE');assert.deepEqual(mathematical(exact.result),mathematical(near.result));
});

test('policy binds adaptive resume without changing game hash or inheriting old-threshold certificates', () => {
  const input=fixtures.cases[0].variants[0].input, first=execute({input,budget:{timeMs:3000,iterations:1000}});
  const changed=execute({input:{...input,comparisonPolicy:{nearEquivalenceBB:.02}},budget:{timeMs:3000,iterations:1},checkpoint:first.checkpoint});
  assert.equal(VERSION,'THEIBS_HU_ADAPTIVE_V6');assert.equal(changed.result.gameHash,first.result.gameHash);
  assert.notEqual(changed.checkpoint.comparisonPolicyKey,first.checkpoint.comparisonPolicyKey);
  assert.equal(changed.checkpoint.global.iterations,1);assert.deepEqual(changed.checkpoint.actionCheckpoints,{});
  assert.equal(changed.result.decisionOutcome.status,'INCONCLUSIVE');
  const bad=structuredClone(first.checkpoint);bad.comparisonPolicyKey='wrong';
  const restarted=execute({input,budget:{timeMs:3000,iterations:1},checkpoint:bad});assert.equal(restarted.checkpoint.global.iterations,1);
});
