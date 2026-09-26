'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const current=require('../src/equity-engine'),reference=require('../test/fixtures/equity-v0.4.0.cjs');
const fast=require('../src/fast-evaluator'),{makeDeck,normalizeCards}=require('../src/cards');
const {evaluateFive,evaluateOmaha}=require('../src/evaluator');
const out=path.resolve(__dirname,'../../validacao/performance-v0.4.1');fs.mkdirSync(out,{recursive:true});
const report={version:require('../package.json').version,at:new Date().toISOString(),environment:'LOCAL_NODE_DIRECT',cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,node:process.version,checks:[],timings:[],status:'RUNNING'};
const timed=fn=>{const t=performance.now(),value=fn();return {value,ms:performance.now()-t};};
try{
 report.tableInitializationMs=timed(()=>fast.initialize()).ms;
 const deck=makeDeck();let count=0;
 if(process.argv.includes('--exhaustive')){
  for(let a=0;a<48;a++)for(let b=a+1;b<49;b++)for(let c=b+1;c<50;c++)for(let d=c+1;d<51;d++)for(let e=d+1;e<52;e++){
   const h=[deck[a],deck[b],deck[c],deck[d],deck[e]];assert.equal(fast.fiveScore(...h),fast.packScore(evaluateFive(h).score));count++;
  }
  report.checks.push({name:'Every five-card fast score equals reference',cases:count});console.log('PASS exhaustive fast scores',count);
 }
 const rng=new current.Lcg(12395);
 for(const n of [4,5,6])for(let i=0;i<1000;i++){
  const d=deck.slice();for(let k=d.length-1;k>0;k--){const j=Math.floor(rng.next()*(k+1));[d[k],d[j]]=[d[j],d[k]];}
  const h=d.slice(0,n),b=d.slice(n,n+5);assert.equal(fast.omahaScore(h,b),fast.packScore(evaluateOmaha(h,b).score));
 }
 report.checks.push({name:'Omaha score matches reference in 4/5/6',cases:3000});console.log('PASS 3000 Omaha scores');
 const hero=['As','Ks','Qh','Jh','Td','9d'];
 for(const n of [4,5,6])for(const opponents of [1,5])for(const board of [[],['2s','3h','4d','7c','8s']]){
  const input={variant:`PLO${n}_HIGH`,heroCards:hero.slice(0,n),board,opponentRanges:Array.from({length:opponents},()=>({kind:'UNIFORM'})),samples:1000,seed:428};
  const old=timed(()=>reference.monteCarloEquity(input)),now=timed(()=>current.monteCarloEquity(input));assert.deepEqual(now.value,old.value);
  const full=timed(()=>current.monteCarloEquity({...input,samples:50000}));
  report.timings.push({variant:input.variant,opponents,street:board.length?'RIVER':'PREFLOP',comparisonSamples:1000,oldMs:old.ms,newMs:now.ms,speedup:old.ms/now.ms,fullSamples:full.value.samples,fullMs:full.ms,simulationsPerSecond:50000/full.ms*1000});
  console.log('PASS identical sampling',n,opponents,board.length,`${(old.ms/now.ms).toFixed(1)}x`,`${full.ms.toFixed(0)}ms / 50000`);
 }
 for(const n of [4,5,6]){
  const base={variant:`PLO${n}_HIGH`,heroCards:hero.slice(0,n),board:['2s','3h','4d','7c'],opponentHands:[['Ac','Kc','Qc','Jc','Tc','9c'].slice(0,n)]};
  assert.deepEqual(current.exactEquity(base),reference.exactEquity(base));
  const input={...base,opponentHands:undefined,opponentRanges:[{hands:[base.opponentHands[0],['Ah','Kh','Qs','Js','Th','9h'].slice(0,n)],weights:[.2,.8]}],samples:500,seed:97};
  assert.deepEqual(current.monteCarloEquity(input),reference.monteCarloEquity(input));
 }
 report.checks.push({name:'Exact and weighted ranges unchanged',cases:6});report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.stack;process.exitCode=1;console.error(e);}
finally{fs.writeFileSync(path.join(out,'benchmark.json'),JSON.stringify(report,null,2));}
