'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {monteCarloEquity}=require('../src/equity-engine'),{decide}=require('../src/decision-engine');
const base={variant:'PLO5_HIGH',heroCards:['As','Ks','Qh','Jh','Td'],board:['2s','3h','4d','7c'],opponentRanges:[{kind:'UNIFORM'}],samples:500,seed:9};
test('Adaptive stopping returns honest sample count, budget and nondegenerate bounded interval',()=>{
 const x=monteCarloEquity({...base,samplingMode:'ADAPTIVE'});
 assert.ok(x.samples>=256&&x.samples<=500000);assert.ok(x.elapsedMs>0);
 assert.ok(['PRECISION','TIME_BUDGET','SAMPLE_LIMIT'].includes(x.stopReason));
 assert.ok(x.confidenceInterval95[0]<=x.equity&&x.confidenceInterval95[1]>=x.equity);
 assert.ok(x.confidenceInterval95[1]>x.confidenceInterval95[0]);
 if(x.stopReason==='PRECISION')assert.ok((x.confidenceInterval95[1]-x.confidenceInterval95[0])/2<=.010000001);
 if(x.stopReason==='TIME_BUDGET')assert.ok(x.elapsedMs>=2000);
});
test('Adaptive deterministic winner retains uncertainty rather than a false zero-width CI',()=>{
 const x=monteCarloEquity({...base,heroCards:['As','Ks','2c','3c','4d'],board:['Qs','Js','Ts','8h','9d'],samplingMode:'ADAPTIVE'});
 assert.equal(x.equity,1);assert.equal(x.confidenceInterval95[1],1);assert.ok(x.confidenceInterval95[0]<1);
});
test('Call EV interval is exactly the equity interval transformed by pot, call and rake',()=>{
 const d=decide({...base,position:'BTN',players:2,potBeforeAction:100,amountToCall:25,effectiveStack:100,rake:5,futureStreetModel:{type:'SHOWDOWN_ONLY'}});
 assert.equal(d.status,'OK');assert.equal(d.ev.actions.CALL.ev,d.equity.equity*120-25);
 assert.deepEqual(d.ev.actions.CALL.confidenceInterval95,d.equity.confidenceInterval95.map(q=>q*120-25));
 assert.equal(d.ev.actions.RAISE.status,'NOT_MODELED');
});
test('Decision-aware stopping only resolves the sign of call EV, not optimal aggression',()=>{
 const d=decide({...base,samplingMode:'ADAPTIVE',position:'BTN',players:2,potBeforeAction:100,amountToCall:1,effectiveStack:100,assumeNoRake:true});
 assert.equal(d.status,'OK');assert.equal(d.equity.stopReason,'CALL_EV_SIGN');
 assert.ok(d.ev.actions.CALL.confidenceInterval95[0]>0);assert.equal(d.ev.actions.RAISE.status,'NOT_MODELED');
});
