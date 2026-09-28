'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { decide } = require('../src/decision-engine');
const { recommendationFor, fingerprint } = require('../src/analysis-contract');
const base = { variant:'PLO4_HIGH',heroCards:['As','Ks','2c','3c'],board:['Qs','Js','Ts','8h','9d'],
  position:'BTN',players:2,potBeforeAction:10,amountToCall:1,effectiveStack:100,assumeNoRake:true,
  unknownOpponentModel:'UNIFORM',samples:1000,seed:42,futureStreetModel:{type:'SHOWDOWN_ONLY'} };
test('a sole or partial modeled leader is not a supported recommendation', () => {
  const result=decide(base);
  assert.equal(result.status,'OK');assert.equal(result.recommendation.status,'INCOMPLETE');
  assert.equal(result.recommendation.action,null);assert.equal(result.recommendation.pointLeader,'CALL');
  assert.match(result.analysisId,/^[a-f0-9]{64}$/);assert.equal(result.provenance.rake.amount,0);
  assert.equal(result.provenance.evReference,'INCREMENTAL_FROM_CURRENT_DECISION');
});
test('only a separated complete comparison supports a conditional choice; exploit adjustment stays unverified', () => {
  const result=decide({...base,availableActions:['FOLD','CALL']});
  assert.equal(result.recommendation.status,'CONDITIONAL');assert.equal(result.recommendation.action,'CALL');
  const adjusted={...result,strategy:{...result.strategy,finalSource:'EXPLOIT_ADJUSTMENT'}};
  assert.equal(recommendationFor(adjusted).action,null);
  assert.equal(recommendationFor({...result,analysisStage:'PROVISIONAL'}).action,null);
  assert.equal(recommendationFor({...result,analysisStage:'PROVISIONAL'}).status,'PROVISIONAL');
});
test('input identity ignores property order but distinguishes economic and range changes', () => {
  assert.equal(fingerprint({a:1,b:[2,3]}),fingerprint({b:[2,3],a:1}));
  const a=decide(base), b=decide({...base,rake:1,assumeNoRake:false});
  assert.notEqual(a.provenance.inputHash,b.provenance.inputHash);
  assert.notEqual(a.analysisId,b.analysisId);
  assert.equal(b.provenance.rake.amount,1);
});
