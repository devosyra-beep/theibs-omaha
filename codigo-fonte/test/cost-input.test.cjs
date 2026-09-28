'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {collect,restoreZeroRake}=require('../public/cost-input');
const {decide}=require('../src/decision-engine');
const base={variant:'PLO4_HIGH',heroCards:['As','Kd','Qc','Jh'],board:[],players:2,unknownOpponentModel:'UNIFORM',samples:256,seed:42,potBeforeAction:10,amountToCall:2};
test('incomplete percent costs preserve equity without leaking fixed or zero rake',()=>{
 const costs=collect({mode:'PERCENT_CAPPED',rate:'',cap:'',rake:'0',assumeNoRake:true});
 assert.equal(costs.assumeNoRake,false);assert.equal(costs.rake,undefined);
 const r=decide({...base,...costs});assert.equal(r.status,'OK');assert.ok(Number.isFinite(r.equity.equity));
 assert.equal(r.ev.actions.CALL.ev,null);assert.deepEqual(r.continuationAssessment.missingInputs,['rakeSchedule.rate','rakeSchedule.cap']);
});
test('zero percent and zero cap are explicit numbers, not missing',()=>{
 const costs=collect({mode:'PERCENT_CAPPED',rate:'0',cap:'0',rounding:'FLOOR_CENT'});
 assert.equal(costs.rakeSchedule.rate,0);assert.equal(costs.rakeSchedule.cap,0);
 assert.equal(decide({...base,...costs}).ev.actions.CALL.status,'MODELED');
});
test('old automatic zero-rake drafts require a fresh explicit choice',()=>{
 assert.equal(restoreZeroRake({fields:{assumeNoRake:true},ui:{}}),false);
 assert.equal(restoreZeroRake({fields:{assumeNoRake:true},ui:{costInputsVersion:1}}),true);
 assert.equal(restoreZeroRake({fields:{assumeNoRake:false},ui:{costInputsVersion:1}}),false);
});
