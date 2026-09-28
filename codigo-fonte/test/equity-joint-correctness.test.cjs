'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {monteCarloEquity,exactEquity,Lcg}=require('../src/equity-engine');
const {normalizeRange}=require('../src/range-engine');
const {enumerateJointRanges,sampleJoint}=require('../src/joint-range-sampler');
const oracle=require('../scripts/lib/numeric-oracle.cjs');
const {lowerBound,upperTail}=require('../scripts/lib/binomial-coverage.cjs');
const base={variant:'PLO4_HIGH',heroCards:['Ac','Kc','6h','7h'],board:['Qd','Jh','Ts','8h','9d'],samples:4000,seed:123456789};
const rare={...base,opponentRanges:[{hands:[['2c','3c','4c','5c'],['2d','3d','4d','5d'],['As','Ks','6d','7d']],weights:[.99999996,.00000001,.00000003]},{hands:[['2c','3c','9c','Tc']]}]};
test('rare legal weighted joints use exact fallback without declaring incompatibility',()=>{
  const expected=oracle.weightedEquity(rare),result=monteCarloEquity(rare);
  assert.equal(expected.equity,.625);assert.ok(Math.abs(result.equity-expected.equity)<.025);
  assert.equal(result.samplerDiagnostics.enumerationComplete,true);assert.equal(result.samplerDiagnostics.compatibleJoints,2);
  assert.equal(result.samplerDiagnostics.fallbackSamples,result.samples);
  assert.equal(result.winRateDefinition,'WIN_OR_TIE_LEGACY');
  assert.equal(result.winRate,result.outrightWinRate+result.tieRate);
  assert.equal(result.outrightWinRate+result.tieRate+result.lossRate,1);
  assert.equal(result.equity,result.outrightWinRate+result.tieRate/2);
});
test('reported rare-range reproduction is now equal to its single legal exact world',()=>{
  const input={variant:'PLO4_HIGH',heroCards:['As','Ks','Qh','Jh'],board:['2s','3h','4d','7c','8s'],samples:1,seed:123456789,opponentRanges:[{hands:[['2c','3c','4c','5c'],['2d','3d','5d','6d']],weights:[.99999,.00001]},{hands:[['2c','3c','9c','Tc']]}]};
  assert.equal(monteCarloEquity(input).equity,oracle.weightedEquity(input).equity);
});
test('incompatibility is proved by complete enumeration; budget failure is distinct',()=>{
  const invalid={...base,samples:1,opponentRanges:[{hands:[['2c','3c','4c','5c']]},{hands:[['2c','3c','9c','Tc']]}]};
  assert.throws(()=>monteCarloEquity(invalid),error=>error.code==='INCOMPATIBLE_RANGES'&&error.samplerDiagnostics.enumerationComplete);
  const ranges=[{valid:[{hand:Uint8Array.from([0]),weight:1},{hand:Uint8Array.from([1]),weight:1}]}];
  assert.throws(()=>enumerateJointRanges(ranges,new Uint8Array(52),{maxNodes:1}),error=>error.code==='JOINT_SAMPLING_BUDGET_EXCEEDED'&&!error.samplerDiagnostics.enumerationComplete);
});
test('joint fallback retains product weights, opponent exchangeability and tiny common scale',()=>{
  const ranges=[{valid:[{hand:Uint8Array.of(0),weight:1e-250},{hand:Uint8Array.of(1),weight:3e-250}]},{valid:[{hand:Uint8Array.of(0),weight:1e-250},{hand:Uint8Array.of(2),weight:2e-250}]}];
  const table=enumerateJointRanges(ranges,new Uint8Array(52));assert.equal(table.entries.length,3);
  const counts={},rng=new Lcg(548392);
  for(let i=0;i<20000;i++){const key=sampleJoint(table,rng).map(h=>h[0]).join(',');counts[key]=(counts[key]||0)+1;}
  for(const [key,p] of Object.entries({'0,2':2/11,'1,0':3/11,'1,2':6/11}))assert.ok(Math.abs(counts[key]/20000-p)<.015,key);
  const reverse=enumerateJointRanges([...ranges].reverse(),new Uint8Array(52));assert.equal(reverse.entries.length,table.entries.length);
});
test('win contract distinguishes a three-way tie from exclusive victory',()=>{
  const input={...base,opponentHands:[['As','Ks','2c','3c'],['Ah','Kh','2d','3d']]};
  for(const result of [exactEquity(input),monteCarloEquity({...input,opponentRanges:input.opponentHands.map(hand=>({hands:[hand]})),samples:10})]){
    assert.equal(result.winRate,1);assert.equal(result.tieRate,1);assert.equal(result.outrightWinRate,0);assert.equal(result.lossRate,0);assert.ok(Math.abs(result.equity-1/3)<1e-15);
  }
});
test('invalid weights, seed, sample mode and adaptive budgets fail explicitly',()=>{
  const hand=['2c','3c','4c','5c'];
  for(const weights of [null,{},'1',[null],[true],[''],[-1],[Infinity],[0]])assert.throws(()=>normalizeRange({hands:[hand],weights},0,4));
  assert.throws(()=>normalizeRange({hands:[hand,hand],weights:[Number.MAX_VALUE,Number.MAX_VALUE]},0,4));
  const input={...base,opponentRanges:[{hands:[hand]}]};
  for(const seed of [null,true,'',NaN,Infinity,-1,1.2])assert.throws(()=>monteCarloEquity({...input,seed}));
  for(const adaptiveBudget of [[],false,{maxSamples:255},{maxSamples:500001},{timeBudgetMs:0}])assert.throws(()=>monteCarloEquity({...input,adaptiveBudget}));
  assert.throws(()=>monteCarloEquity({...input,samplingMode:'TYPO'}));
  assert.throws(()=>exactEquity({...input,board:['Qs'],opponentHands:[hand]}),/board/);
});
test('bounded adaptive sample budget returns its actual stopping point and nondegenerate interval',()=>{
  const result=monteCarloEquity({...base,opponentRanges:[{hands:[['2c','3c','4c','5c']]}],samplingMode:'ADAPTIVE',adaptiveBudget:{maxSamples:512,timeBudgetMs:2000}});
  assert.equal(result.samples,512);assert.equal(result.requestedSamples,512);assert.equal(result.stopReason,'SAMPLE_LIMIT');assert.ok(result.confidenceInterval95[0]<result.confidenceInterval95[1]);
});
test('coverage lower bound inverts exact binomial probabilities including endpoint cases',()=>{
  assert.equal(lowerBound(0,100,.05),0);
  assert.ok(Math.abs(lowerBound(100,100,.05)-.05**.01)<1e-15);
  // Independent closed form: P(X >= 9), X ~ Binomial(10,p).
  const lower=lowerBound(9,10,.05);
  assert.ok(Math.abs((10*lower**9*(1-lower)+lower**10)-.05)<1e-12);
  assert.ok(Math.abs(upperTail(9,10,.6)-(10*.6**9*.4+.6**10))<1e-12);
  assert.ok(lowerBound(99,100,.05/12)<.93);
});
