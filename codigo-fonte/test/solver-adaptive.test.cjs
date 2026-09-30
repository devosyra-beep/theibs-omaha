'use strict';
// HARNESS scheduler checks use synthetic clocks/certificates. The final test
// uses the real ledger, river adapter, CFR and outward-rounded certificates.
const test=require('node:test');
const assert=require('node:assert/strict');
const {execute,focusActions,chooseFocus}=require('../src/solver/job-worker');
const core=require('../src/solver/extensive-solver');
const certificate=require('../src/solver/action-conditioned');
const session=require('../src/multiway-session');

const bounded=(id,lowerBB,upperBB)=>({id,lowerBB,upperBB,certified:true,estimateBB:(lowerBB+upperBB)/2});
test('focused work preserves the third wide contender and only excludes strictly certified domination',()=>{
  const ids=['A','B','C','D'],rows=[bounded('A',5,6),bounded('B',5.5,7),bounded('C',-100,100),bounded('D',1,4)];
  const focus=focusActions(ids,rows);
  assert.deepEqual(focus.survivingActionIds,['A','B','C']);
  assert.equal(chooseFocus(ids,rows).id,'C');
  assert.equal(focus.dominatedActions[0].id,'D');
  assert.equal(focus.separated,false);
  assert.equal(focusActions(['A','B'],[bounded('A',1,2),bounded('B',0,1)]).separated,false,'touching intervals are unresolved');
  assert.equal(focusActions(['A','B'],[bounded('A',1,2),{id:'B',lowerBB:-5,upperBB:-4,certified:false}]).separated,false);
});

function harness({actionHook,solveHook}={}){
  let time=0,cancelled=false;const calls=[];
  const game={id:'scheduler-harness',playerCount:2,meta:{key:'mathematical-context',heroInformationSet:'Hero',heroSeat:0,
    originalSeats:2,constantSum:true,treeComplete:true,chanceSupportComplete:true,limitations:[],rootActions:['A','B','C'].map(id=>({id,action:id}))}};
  const engine={VERSION:core.VERSION,solve(_game,options){
    calls.push('global');time+=4;solveHook?.({options,setCancelled:()=>cancelled=true});
    const iterations=(options.checkpoint?.iterations||0)+1;
    return {strategy:[{},{}],checkpoint:{iterations},iterations,additionalIterations:1,gameHash:'original-game-hash',
      solverVersion:core.VERSION,method:'CFR_PLUS',convergence:{exact:true,nashConv:0},metrics:{}};
  },rootDiagnostics(){time++;return {actions:['A','B','C'].map((id,index)=>({id,ev:3-index,frequency:index?0:1})),
    oneStepRegret:0,profileValue:3,stability:{comparable:true,maxActionEVChange:0,maxFrequencyChange:0}};}};
  const certifier={...certificate,solveActionConditioned(_game,options){
    const id=options.actionIds[0];calls.push(id);time+=3;
    const hook=actionHook?.({id,options,setCancelled:()=>cancelled=true});if(hook)return hook;
    const iterations=(options.checkpoints[id]?.iterations||0)+1;
    const [lowerBB,upperBB]=id==='A'?[5,6]:id==='B'?[1,2]:iterations===1?[-100,100]:[-2,2];
    return {version:certificate.VERSION,baseGameHash:'original-game-hash',player:0,informationSet:'Hero',supportedGameClass:certificate.SUPPORTED_GAME_CLASS,
      actions:[{id,version:certificate.VERSION,target:certificate.TARGET,origin:certificate.ORIGIN,solverVersion:core.VERSION,
        player:0,informationSet:'Hero',gameHash:`conditioned-${id}`,baseGameHash:'original-game-hash',
        ...bounded(id,lowerBB,upperBB),iterations,additionalIterations:1,checkpoint:{iterations},
        utility:{unit:'BB',basis:'INCREMENTAL_TERMINAL_PAYOFF_FROM_ORIGINAL_DECISION',scope:'FULL_PRIOR_EX_ANTE'},
        originalHandActionEV:false,fullPriorPreserved:true}]};
  }};
  const dependencies={core:engine,actionConditioned:certifier,now:()=>time,
    build:()=>({status:'READY',game,metrics:{},coverage:{}}),qualify:()=>({status:'APPROXIMATE',qualification:{gto:false}})};
  return {calls,dependencies,shouldCancel:()=>cancelled,run(options={}){return execute({input:{},budget:{timeMs:100,iterations:100},shouldCancel:()=>cancelled,...options},dependencies);}};
}

test('publishes the original profile first, refines all contenders and preserves original actions',()=>{
  const fixture=harness(),progress=[];
  const output=fixture.run({onProgress:value=>progress.push(value)});
  assert.deepEqual(fixture.calls,['global','A','B','C','C']);
  assert.ok(progress[0].result.actionPrecision.actions.every(row=>row.certified===false));
  assert.deepEqual(output.result.actions.map(row=>row.id),['A','B','C']);
  assert.deepEqual(output.result.actions.map(row=>row.frequency),[1,0,0]);
  assert.deepEqual(output.result.actionPrecision.focus.survivingActionIds,['A']);
  assert.equal(output.result.adaptation.stopReason,'GLOBAL_CONVERGENCE_AND_CERTIFIED_SEPARATION');
  assert.equal(output.result.actionPrecision.supportedGameClass,true);
  assert.equal(output.result.actionPrecision.actions[2].iterations,2);
  assert.equal(output.result.metrics.costs.globalSolveMs,4);
  assert.equal(output.result.metrics.costs.actionSolveMs,12);
  assert.equal(output.result.metrics.costs.totalComputeMs,17);
});

test('cancelled empty action response preserves the complete original result and checkpoints',()=>{
  const fixture=harness({actionHook({setCancelled}){setCancelled();return {baseGameHash:null,actions:[],termination:'CANCELLED'};}});
  const output=fixture.run();
  assert.equal(output.paused,true);assert.equal(output.result.actions.length,3);
  assert.equal(output.checkpoint.global.iterations,1);
  assert.equal(output.result.adaptation.stopReason,'FOREGROUND_PRIORITY_PAUSE');
});

test('mismatched certificate context is rejected rather than compared',()=>{
  const fixture=harness({actionHook(){return {version:certificate.VERSION,baseGameHash:'wrong-game',player:0,informationSet:'Hero',actions:[]};}});
  assert.throws(()=>fixture.run(),/context does not match/);
});

test('fully evaluated forced continuations stop without falsely resolving overlapping bounds',()=>{
  const fixture=harness(),base=fixture.dependencies.actionConditioned.solveActionConditioned;
  fixture.dependencies.actionConditioned.solveActionConditioned=(game,options)=>{
    const response=base(game,options);
    response.actions.forEach(row=>Object.assign(row,{lowerBB:-Number.EPSILON,upperBB:Number.EPSILON,strategicDecisionCount:0}));
    return response;
  };
  const output=fixture.run();
  assert.equal(output.result.adaptation.stopReason,'FIXED_CONTINUATIONS_FULLY_EVALUATED');
  assert.equal(output.result.adaptation.refinementRecommended,false);
  assert.equal(output.result.actionPrecision.focus.separated,false);
  assert.equal(output.result.decisionPrecision.status,'INCONCLUSIVE');
  assert.deepEqual(fixture.calls,['global','A','B','C']);
});

test('compatible resume preserves certificate intervals and cumulative costs',()=>{
  const fixture=harness();
  const first=fixture.run({budget:{timeMs:13,iterations:100}});
  assert.equal(first.result.actionPrecision.actions[0].certified,true);
  const next=fixture.run({checkpoint:first.checkpoint});
  assert.equal(next.result.actionPrecision.actions[0].iterations,1,'already dominated competitors do not force the leader to repeat');
  assert.ok(next.result.metrics.costs.totalComputeMs>first.result.metrics.costs.totalComputeMs);
  assert.ok(next.checkpoint.workIterations>first.checkpoint.workIterations);
  const incompatible=structuredClone(first.checkpoint);incompatible.baseContextKey='different-query';
  const restarted=fixture.run({checkpoint:incompatible,budget:{timeMs:13,iterations:100}});
  assert.equal(restarted.checkpoint.global.iterations,1);
});

function riverFixture(){
  let state=session.start({variant:'PLO5_HIGH',playerCount:2,heroPosition:'BB',startingStack:20,smallBlind:.5,bigBlind:1,
    heroCards:['As','Ah','Kd','Qc','Tc']});
  for(const event of [{type:'ACT',actor:0,action:'CALL'},{type:'ACT',actor:1,action:'CHECK'},
    {type:'BOARD',cards:['2s','3h','4d']},{type:'ACT',actor:1,action:'CHECK'},{type:'ACT',actor:0,action:'CHECK'},
    {type:'BOARD',cards:['2s','3h','4d','8c']},{type:'ACT',actor:1,action:'CHECK'},{type:'ACT',actor:0,action:'CHECK'},
    {type:'BOARD',cards:['2s','3h','4d','8c','9s']}])state=session.step(state.multiway,event);
  return {multiway:state.multiway,sizing:{type:'MIN_MID_MAX',maxAggressions:0},rake:{type:'NONE',basis:'BEFORE_FEES'},ranges:[
    {seatId:0,complete:true,source:'QA',combos:[{cards:['Ks','Kh','Jd','Qh','6c'],weight:1}]},
    {seatId:1,complete:true,source:'QA',combos:[{cards:['As','Ah','Kd','Qc','Tc'],weight:1}]}]};
}

test('real finite river ledger produces comparable private commitment certificates without changing profile EV',()=>{
  const output=execute({input:riverFixture(),budget:{timeMs:3000,iterations:1000}});
  assert.equal(output.result.actionPrecision.supportedGameClass,true);
  assert.ok(output.result.actionPrecision.actions.every(row=>row.certified));
  assert.equal(output.result.gameHash,output.result.actionPrecision.baseGameHash);
  assert.equal(output.result.decisionPrecision.status,'CONCLUSIVE');
  assert.ok(output.result.actions.every(row=>Number.isFinite(row.evBB)&&Number.isFinite(row.frequency)));
  assert.equal(output.result.adaptation.stopReason,'GLOBAL_CONVERGENCE_AND_CERTIFIED_SEPARATION');
});
