'use strict';
const assert=require('node:assert/strict');
const {reference}=require('./sequence-form-reference.cjs');
const {expandedRiverInput}=require('./solver-river-growth-fixtures.cjs');
const {buildPloRiverGame}=require('../../src/solver/plo-river-game');
const core=require('../../src/solver/extensive-solver');
const conditioned=require('../../src/solver/action-conditioned');

function richRiverInput({combos=4,sizings=5}={}){
  assert.ok([4,5].includes(combos));const input=expandedRiverInput({combos,sizings});
  const hands=[[
    ['As','Ah','Qd','Jc','Tc'],['As','Ah','Qd','Jc','9c'],['5s','6s','Qd','Jc','Tc'],['5s','6s','Qd','Jc','9c'],['5s','6s','Qd','Jc','7h']
  ],[
    ['Ks','Kh','6d','7c','8h'],['Ks','Kh','6d','7c','9h'],['5h','6h','Kd','7c','8h'],['5h','6h','Kd','7c','9h'],['Ks','Kh','6d','7c','Th']
  ]];
  input.ranges=hands.map((rows,seatId)=>({seatId,complete:true,source:'EXPLICIT_PRIVATE_TYPE_LP_GROWTH_QA',
    combos:rows.slice(0,combos).map((cards,index)=>({cards,weight:index+1}))}));
  return input;
}
const scenarios=[{combos:4,sizings:5},{combos:5,sizings:8}];
function compact(oracle){return {values:oracle.values,validationTolerance:oracle.validationTolerance,residuals:oracle.residuals,
  method:oracle.method,runtime:oracle.runtime,metrics:oracle.metrics,symbolicallyExact:oracle.symbolicallyExact,referenceNashConv:oracle.reference.nashConv};}
function runReferenceScenario(options){
  const started=performance.now(),built=buildPloRiverGame(richRiverInput(options));assert.equal(built.status,'READY',JSON.stringify(built.reasons));
  const game=built.game,baseOracle=reference({game});
  assert.equal(game.meta.compatibleWorlds,options.combos**2);
  const original=core.solve(game,{iterations:500}),profileOracle=reference({game,strategy:original.strategy});
  assert.ok(Math.abs(profileOracle.profile.nashConv-original.convergence.nashConv)<1e-7);
  const result={...options,key:game.meta.key,heroInformationSet:game.meta.heroInformationSet,build:built.metrics,reference:compact(baseOracle),
    originalProfile:{iterations:original.iterations,values:original.values,nashConv:original.convergence.nashConv,
      independentProfileNashConv:profileOracle.profile.nashConv,absoluteValueErrorBB:Math.abs(original.values[0]-baseOracle.values[0])},actions:[]};
  for(const rootAction of game.meta.rootActions){
    const condition={player:0,informationSet:game.meta.heroInformationSet,actionId:rootAction.id},oracle=reference({game,condition});
    const restricted=conditioned.buildActionConditionedGame(game,condition),rows=[];let checkpoint,previous=0;
    for(const iterations of [1,100,500]){
      const begin=performance.now(),memoryBefore=process.memoryUsage();
      const solved=core.solve(restricted,{iterations:iterations-previous,checkpoint});
      const bounds=conditioned.evaluateActionConditioned(game,solved.strategy,condition);
      assert.equal(bounds.certified,true);
      assert.ok(bounds.lowerBB<=oracle.values[0]+oracle.validationTolerance&&bounds.upperBB>=oracle.values[0]-oracle.validationTolerance,
        `${options.combos}x${options.combos} ${rootAction.id}: LP value outside certified interval`);
      const midpoint=bounds.lowerBB/2+bounds.upperBB/2;
      rows.push({iterations:solved.iterations,lowerBB:bounds.lowerBB,upperBB:bounds.upperBB,widthBB:bounds.upperBB-bounds.lowerBB,
        estimateBB:midpoint,absoluteMidpointErrorBB:Math.abs(midpoint-oracle.values[0]),profileValueBB:solved.values[0],nashConv:solved.convergence.nashConv,
        elapsedMs:performance.now()-begin,containsLPWithinResidualTolerance:true,
        estimatedWorkingBytes:solved.metrics.estimatedWorkingBytes,processRSSBefore:memoryBefore.rss,processRSSAfter:process.memoryUsage().rss,
        processHeapUsedAfter:process.memoryUsage().heapUsed});
      checkpoint=solved.checkpoint;previous=solved.iterations;
    }
    const independent=reference({game,condition,strategy:core.solve(restricted,{iterations:0,checkpoint}).strategy});
    const last=rows.at(-1);assert.ok(Math.abs(last.lowerBB-independent.profile.lower[0])<1e-7);assert.ok(Math.abs(last.upperBB-independent.profile.upper[0])<1e-7);
    result.actions.push({id:rootAction.id,reference:compact(oracle),referenceValueBB:oracle.values[0],refinements:rows});
  }
  result.dominance=[1,100,500].map(iterations=>{
    const rows=result.actions.map(action=>({id:action.id,reference:action.referenceValueBB,...action.refinements.find(row=>row.iterations===iterations)}));
    const tolerance=16*Number.EPSILON*Math.max(1,...rows.flatMap(row=>[Math.abs(row.lowerBB),Math.abs(row.upperBB)]));
    const leaders=rows.filter(row=>rows.every(other=>row.id===other.id||row.lowerBB>other.upperBB+tolerance));
    if(leaders.length)assert.ok(rows.every(row=>row.id===leaders[0].id||leaders[0].reference>row.reference));
    return {iterations,status:leaders.length?'CONCLUSIVE':'INCONCLUSIVE',leader:leaders[0]?.id||null,comparedEveryAlternative:true};
  });
  result.elapsedMs=performance.now()-started;return result;
}
module.exports={richRiverInput,scenarios,runReferenceScenario};
