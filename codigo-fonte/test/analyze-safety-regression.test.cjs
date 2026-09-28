'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {decide}=require('../src/decision-engine');
const {calculateActionEV}=require('../src/action-ev-engine');
const {calculatePotMath}=require('../src/pot-math');
const {calculateEquity}=require('../src/equity-engine');
const base={variant:'PLO4_HIGH',heroCards:['As','Ks','Qh','Jh'],board:['Ts','9s','2c'],players:2,unknownOpponentModel:'UNIFORM',samples:512,seed:41};
const price={...base,potBeforeAction:100,amountToCall:20,assumeNoRake:true};

test('whitespace price is unknown, never a zero-cost CHECK',()=>{
 const r=decide({...base,amountToCall:'   ',potBeforeAction:'\t'});
 assert.equal(r.status,'OK');assert.equal(r.state.amountToCall,null);
 assert.equal(r.continuationAssessment.status,'UNAVAILABLE');
 assert.equal(r.potMath.evCall,null);
});
test('price-only analysis respects explicit action availability and zero remaining stack',()=>{
 for(const extra of [{availableActions:['FOLD']},{effectiveStack:0,amountToCall:0}]){
  const r=decide({...price,...extra});
  assert.ok(!r.legalActions?.includes('CALL'));
  assert.ok(!['FAVORABLE','FREE_CHECK'].includes(r.continuationAssessment?.status));
 }
});
test('missing rake never claims that CALL EV was calculated',()=>{
 const r=decide({...price,assumeNoRake:false});assert.equal(r.status,'OK');
 assert.equal(r.ev.actions.CALL.ev,null);
 assert.ok(r.economicsAvailability.currentPriceMissing.some(x=>/rake/i.test(x)));
 assert.doesNotMatch(r.reason,/EV do CALL atual foram calculados/);
});
test('side pots do not fall through the simple whole-pot CALL formula',()=>{
 const r=decide({...price,sidePots:[{amount:50,eligible:['opponent']} ]});
 assert.equal(r.status,'OK');assert.equal(r.ev.actions.CALL.ev,null);
 assert.equal(r.continuationAssessment.status,'UNAVAILABLE');
});
test('fixed rake larger than final pot is not silently clipped to a plausible EV',()=>{
 const r=calculateActionEV({...price,equity:.5,assumeNoRake:false,rake:121,legalActions:['FOLD','CALL']});
 assert.equal(r.actions.CALL.status,'NOT_MODELED');assert.equal(r.actions.CALL.ev,null);
});
test('standalone pot math does not invent net CALL EV with unknown rake',()=>{
 assert.equal(calculatePotMath({potBeforeAction:100,amountToCall:20,effectiveStack:100,equity:.5}).evCall,null);
});
test('a declared dead card cannot duplicate a hero card',()=>{
 assert.throws(()=>calculateEquity({...base,opponentRanges:[{kind:'UNIFORM'}],deadCards:['As']}),/duplic|repeat/i);
});
test('dead cards are removed from exact remaining-card enumeration',()=>{
 const r=calculateEquity({...base,board:['Ts','9s','2c','3d'],opponentHands:[['Ah','Ad','Kc','Kd']],deadCards:['4s']});
 assert.equal(r.method,'EXACT');assert.equal(r.samples,39);
});
