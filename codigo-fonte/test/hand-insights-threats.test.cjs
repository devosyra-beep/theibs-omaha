'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {describeHand,bestCurrent}=require('../src/hand-insights');
const {compareScores}=require('../src/evaluator');

test('stronger examples are legal private pairs that beat the current Omaha hand',()=>{
 const hero=['As','Ah','2d','3c'],board=['Ad','Qh','Qs','Ks','4c'];
 const facts=describeHand(hero,board);
 assert.equal(facts.made.label,'full house');
 assert.ok(facts.nuts.strongerPrivatePairs>0);
 assert.ok(facts.nuts.strongerExamples.length>0);
 const seen=new Set([...hero,...board]);
 const labels=new Set();
 for(const example of facts.nuts.strongerExamples){
  assert.equal(example.privateCards.length,2);
  assert.ok(example.privateCards.every(card=>!seen.has(card)));
  assert.ok(compareScores(bestCurrent(example.privateCards,board).score,facts.made.score)>0);
  assert.equal(labels.has(example.label),false);
  labels.add(example.label);
 }
});

test('a current-board nuts hand has no stronger private-pair example',()=>{
 const facts=describeHand(['As','Ks','Qd','Jc'],['Qs','Js','Ts','2d','3c']);
 assert.equal(facts.nuts.unbeaten,true);
 assert.deepEqual(facts.nuts.strongerExamples,[]);
});
