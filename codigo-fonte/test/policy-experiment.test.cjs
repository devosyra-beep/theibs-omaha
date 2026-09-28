'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {outcomeCost}=require('../src/policy-experiment');
const cost={rate:.05,capBB:3,noFlopNoDrop:true};
test('uncalled twenty is refunded economically before charging rake on a twenty-chip contested pot',()=>{
  const state={result:{reason:'ALL_FOLDED',winners:[0],awards:[{player:0,amount:40}]},players:[{totalPaid:30},{totalPaid:10}]};
  assert.deepEqual(outcomeCost(state,3,cost,2),{grossAwards:40,uncalled:20,contestedPot:20,totalFee:1,heroFeeChips:1});
  assert.equal(outcomeCost(state,0,cost,2).totalFee,0);
});
test('split showdown shares capped rake and losing player pays no award fee',()=>{
  const split={result:{reason:'REPORTED_SHOWDOWN',winners:[0,1],awards:[{player:0,amount:100},{player:1,amount:100}]},players:[{totalPaid:100},{totalPaid:100}]};
  assert.equal(outcomeCost(split,5,cost,2).heroFeeChips,3);
  split.result.winners=[1];split.result.awards=[{player:1,amount:200}];
  assert.equal(outcomeCost(split,5,cost,2).heroFeeChips,0);
});
