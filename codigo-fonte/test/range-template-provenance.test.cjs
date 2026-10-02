'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/multiway-solver-ui.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
function ui(){const box={module:{exports:{}},setTimeout,clearTimeout,AbortController};vm.runInNewContext(source,box);return box.module.exports;}
function study(){const ranges=[0,1].map(seatId=>({seatId,complete:true,source:'USER_DEFINED_COMPLETE_STUDY',combos:[{cards:seatId===0?['As','Kh','Qd','Jc','9s']:['Ah','Kd','Qc','Js','9h'],weight:2}]}));
 return {schemaVersion:1,handId:'hand-1',notation:'CANONICAL',ranges,sizing:{type:'MIN_MID_MAX',maxAggressions:1},activeScenarioId:'scenario-1',scenarios:[{id:'scenario-1',name:'Reviewed',treeName:'Tree',rationaleBySeat:{},ranges,sizing:{type:'MIN_MID_MAX',maxAggressions:1},rangeOriginsBySeat:{1:{model:'REVIEWED_DECISION_RANGE_V1',conditioningScope:'CONDITIONAL_AT_DECISION',playerId:'opponent',sourceHandId:'source-hand',sourceRevisionKey:'source-revision',sourceScenarioId:'source-scenario',sourceBoard:['2s','3h','4d','5c','6s'],sourceContextKey:'coarse-context',sourceCombos:clone(ranges[1].combos)}}}]};}
test('approved template origin survives restore, records edits, and stays outside solver requests',async()=>{
 const api=ui(),current={multiway:{enabled:true,handId:'hand-1',config:{playerCount:2},events:[]},state:{handId:'hand-1',revisionKey:'revision-1'}},calls=[];
 const actions=[{id:'CHECK',action:'CHECK',size:null,frequency:1,evBB:2}];
 api.init({getContext:()=>current,request:async(url,options)=>{calls.push(JSON.parse(options.body));return {jobId:'job-1',handId:'hand-1',revisionKey:'revision-1',phase:'COMPLETE',budget:'STANDARD',result:{status:'APPROXIMATE',method:'ALTERNATING_CFR_PLUS_LINEAR_AVERAGE',actions,abstraction:{rootActions:[{id:'CHECK',action:'CHECK',size:null}]}}};}});
 api.restore(study());assert.equal(api.serialize().scenarios[0].rangeOriginsBySeat[1].edited,false);
 await api.evaluate({multiway:current.multiway,multiwayEvaluation:{assumeNoRake:true,feeBasis:'BEFORE_FEES'}});
 assert.equal(calls.length,1);assert.equal(JSON.stringify(calls).includes('source-hand'),false);assert.equal(JSON.stringify(calls).includes('source-revision'),false);
 assert.equal(api.decisionSnapshot().studyProvenance.rangeOriginsBySeat[1].sourceHandId,'source-hand');api.invalidate();
 const changed=study();changed.scenarios[0].ranges[1].combos[0].weight=.125;changed.ranges=changed.scenarios[0].ranges;
 api.restore(changed);assert.equal(api.serialize().scenarios[0].rangeOriginsBySeat[1].edited,true);
 assert.equal(api.serialize().scenarios[0].rangeOriginsBySeat[1].sourceCombos[0].weight,2);
});
test('invalid template metadata is rejected before a reviewed study can be persisted',()=>{
 const api=ui();for(const mutate of [origin=>{origin.sourceRevisionKey='';},origin=>{origin.sourceCombos[0].weight=0;},origin=>{origin.conditioningScope='PRE_HAND';},origin=>{origin.sourceBoard=['hidden'];}]){
  const input=study();mutate(input.scenarios[0].rangeOriginsBySeat[1]);assert.throws(()=>api._testing.normalizeScenarios(input),/origin/);
 }
});
