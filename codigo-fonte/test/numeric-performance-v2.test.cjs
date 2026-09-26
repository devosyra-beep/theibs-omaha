'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const current=require('../src/equity-engine'),reference=require('./fixtures/equity-v0.4.1.cjs');
const fast=require('../src/fast-evaluator'),{makeDeck,normalizeCards}=require('../src/cards');
const {evaluateOmaha,evaluateFive}=require('../src/evaluator');
const hero=['As','Ks','Qh','Jh','Td','9d'];
const base=(n,opponents=1)=>({variant:`PLO${n}_HIGH`,heroCards:hero.slice(0,n),board:[],opponentRanges:Array.from({length:opponents},()=>({kind:'UNIFORM'})),samples:128,seed:7291});
function assertSameSampling(input){
 const a=current.monteCarloEquity(input),b=reference.monteCarloEquity(input);
 for(const key of ['method','samples','seed','winRate','tieRate','equity','opponents','ranges'])assert.deepEqual(a[key],b[key],`${input.variant}/${key}`);
 assert.equal(a.intervalMethod,'HOEFFDING_FIXED_N');
}
test('Numeric sampler preserves complete fixed-seed results across variants, streets and player counts',()=>{
 for(const n of [4,5,6])for(const opponents of [1,5])for(const board of [[],['2s','3h','4d'],['2s','3h','4d','7c'],['2s','3h','4d','7c','8s']])assertSameSampling({...base(n,opponents),board});
});
test('Joint weighted ranges retain collision rejection, blockers, zero weights and uniform opponents',()=>{
 for(const n of [4,5,6]){
  const handsA=[['2c','3c','4c','5c','6c','7c'],['2h','3h','4h','5h','6h','7h'],hero];
  const handsB=[['2c','3c','8c','9c','Tc','Jc'],['2d','3d','4d','5d','6d','7d'],['8h','9h','Th','Jd','Qd','Kd']];
  assertSameSampling({...base(n),samples:1000,opponentRanges:[{kind:'UNIFORM'},{hands:handsA.map(h=>h.slice(0,n)),weights:[.8,.2,.5]},{hands:handsB.map(h=>h.slice(0,n)),weights:[.7,.3,0]}]});
 }
});
test('Prepared numeric Omaha scores match independent readable evaluator including required 2+3',()=>{
 fast.initialize();const rng=new current.Lcg(394810),deck=makeDeck();
 for(const n of [4,5,6])for(let i=0;i<250;i++){
  const d=deck.slice();for(let j=0;j<n+5;j++){const k=j+Math.floor(rng.next()*(52-j));[d[j],d[k]]=[d[k],d[j]];}
  const hand=d.slice(0,n),board=d.slice(n,n+5),ids=Uint8Array.from(hand,fast.cardId),prepared=fast.prepareBoardIds(Uint8Array.from(board,fast.cardId));
  const expected=fast.packScore(evaluateOmaha(hand,board).score);
  assert.equal(fast.scoreHandIds(ids,prepared),expected);
  assert.equal(fast.scorePreparedPairs(fast.preparePairsIds(ids),prepared),expected);
 }
});
test('Compact numeric lookup covers all 7462 nonflush/flush rank classes against readable evaluator',()=>{
 fast.initialize();const selected=[],ranks='23456789TJQKA',suits='cdhs';let cases=0;
 function check(codes){const cards=normalizeCards(codes),ids=Uint8Array.from(cards,fast.cardId),board=fast.prepareBoardIds(ids.slice(2));assert.equal(fast.scoreHandIds(ids.slice(0,2),board),fast.packScore(evaluateFive(cards).score));cases++;}
 function visit(start){
  if(selected.length===5){
   const counts=Array(13).fill(0),cards=[];
   for(const r of selected){if(counts[r]===4)return;cards.push(ranks[r]+suits[counts[r]++]);}
   if(new Set(selected).size===5){check(selected.map(r=>ranks[r]+'c'));cards[0]=ranks[selected[0]]+'d';}
   check(cards);return;
  }
  for(let r=start;r<13;r++){selected.push(r);visit(r);selected.pop();}
 }
 visit(0);assert.equal(cases,7462);
});
test('Four matching private ranks never become quads without the required community cards',()=>{
 const hand=normalizeCards(['As','Ah','Ad','Ac']),board=normalizeCards(['Ks','Qh','Jd','9c','8s']);
 const prepared=fast.prepareBoardIds(Uint8Array.from(board,fast.cardId));
 assert.equal(fast.scoreHandIds(Uint8Array.from(hand,fast.cardId),prepared),fast.packScore(evaluateOmaha(hand,board).score));
  assert.equal(evaluateOmaha(hand,board).score[0],1);
});
test('Paired board compression preserves distinct flush possibilities and exact 2+3 scores',()=>{
 const cases=[
  {board:['As','Ah','Kd','Qc','Js'],triples:7,hand:['Ts','9s','4c','5d','6h','7c']},
  {board:['As','Ah','Ks','Qs','2d'],triples:8,hand:['Js','Ts','4c','5d','6h','7c']},
  {board:['As','Ah','Ad','Kc','Qs'],triples:4,hand:['Ks','Kh','4c','5d','6h','7c']},
  {board:['As','Ah','Ks','Kh','2d'],triples:5,hand:['Qs','Qh','4c','5d','6h','7c']},
  {board:['As','Ah','Ad','Ac','Ks'],triples:2,hand:['Kd','Kc','4c','5d','6h','7c']}
 ];
 const buffer=fast.createBoardBuffer();
 for(const item of cases){
  const hand=normalizeCards(item.hand),board=normalizeCards(item.board),ids=Uint8Array.from(hand,fast.cardId);
  fast.prepareBoardIds(Uint8Array.from(board,fast.cardId),buffer);assert.equal(buffer.length,item.triples);
  const expected=fast.packScore(evaluateOmaha(hand,board).score);
  assert.equal(fast.scoreHandIds(ids,buffer),expected);assert.equal(fast.scorePreparedPairs(fast.preparePairsIds(ids),buffer),expected);
 }
});
test('Fixed-N intervals are nondegenerate at observed zero and one and valid for split shares',()=>{
 const board=['Qs','Js','Ts','8h','9d'];
 const win=current.monteCarloEquity({...base(4),heroCards:['As','Ks','2c','3c'],board,samples:500});
 assert.equal(win.equity,1);assert.equal(win.confidenceInterval95[1],1);assert.ok(win.confidenceInterval95[0]<1);
 const loss=current.monteCarloEquity({...base(4),heroCards:['2c','3c','4d','5d'],board,opponentRanges:[{hands:[['As','Ks','6c','7c']]}],samples:500});
 assert.equal(loss.equity,0);assert.equal(loss.confidenceInterval95[0],0);assert.ok(loss.confidenceInterval95[1]>0);
 const tie=current.monteCarloEquity({...base(4),heroCards:['Ac','Kc','2c','3c'],board:['Qd','Jh','Ts','8h','9d'],opponentRanges:[{hands:[['As','Ks','6c','7c']]}],samples:500});
 assert.equal(tie.equity,.5);assert.ok(tie.confidenceInterval95[0]<.5&&tie.confidenceInterval95[1]>.5);
 assert.equal(loss.intervalMethod,'HOEFFDING_FIXED_N');
});
test('Every observed sample outcome including rare zero remains within the bounded-share interval',()=>{
 const input={...base(4),heroCards:['2c','3c','4d','5d'],board:['Qs','Js','Ts','8h','9d'],opponentRanges:[{hands:[['As','Ks','6c','7c'],['2h','3h','4c','5c']],weights:[.999,.001]}],samples:500};
 for(const seed of [42,93,971]){const r=current.monteCarloEquity({...input,seed});assert.ok(r.confidenceInterval95[1]>0);assert.ok(r.confidenceInterval95[0]<=r.equity&&r.confidenceInterval95[1]>=r.equity);}
});
