'use strict';
// Short interleaved audit. Complete simulations include legal draws and showdown;
// internal five-card evaluations are never counted as separate simulations.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const current=require('../src/equity-engine'),previous=require('../test/fixtures/equity-v0.4.1.cjs');
const fast=require('../src/fast-evaluator');
const currentOnly=process.argv.includes('--current-only');
const report={at:new Date().toISOString(),version:require('../package.json').version,environment:'LOCAL_NODE_DIRECT_INTERLEAVED',cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,node:process.version,unit:'complete showdown simulations per second',samplesPerRun:100000,lotsPerRun:2,samplesPerLot:50000,repetitions:3,rangeModel:'UNIFORM',street:'PREFLOP',rows:[],limitations:['Six fixed hands/player-count scenarios, three repetitions each; not a sustained-rate SLA','User applications remained open; CPU frequency and temperature not measured','Does not measure HTTP/UI or strategy scenario tree construction'],status:'RUNNING'};
const cases=[4,5,6].flatMap(n=>[1,5].map(opponents=>({variant:`PLO${n}_HIGH`,heroCards:['As','Ks','Qh','Jh','Td','9d'].slice(0,n),board:[],opponentRanges:Array.from({length:opponents},()=>({kind:'UNIFORM'})),samples:50000,samplingMode:'FIXED'})));
const timed=fn=>{const t=performance.now(),value=fn();return {value,ms:performance.now()-t};};
const median=a=>a.slice().sort((a,b)=>a-b)[Math.floor(a.length/2)];
const started=performance.now();
try{
 fast.initialize();
 report.baselineIncluded=!currentOnly;
 for(const engine of currentOnly?[current]:[current,previous])for(const input of cases)engine.monteCarloEquity({...input,samples:1000,seed:993});
 for(let repetition=0;repetition<3;repetition++)for(let i=0;i<cases.length;i++){
  const input=cases[(i+repetition*2)%cases.length],seeds=[87411+repetition*100,98245+repetition*100];
  const values={};
  for(const [label,engine]of currentOnly?[['current',current]]:repetition%2?[['current',current],['previous',previous]]:[['previous',previous],['current',current]])values[label]=timed(()=>seeds.map(seed=>engine.monteCarloEquity({...input,seed})));
  if(!currentOnly)for(let lot=0;lot<2;lot++)for(const key of ['samples','equity','winRate','tieRate'])assert.equal(values.current.value[lot][key],values.previous.value[lot][key]);
  const row={variant:input.variant,opponents:input.opponentRanges.length,repetition:repetition+1,seeds,samples:100000,previousMs:values.previous?.ms??null,currentMs:values.current.ms,previousPerSecond:values.previous?100000/values.previous.ms*1000:null,currentPerSecond:100000/values.current.ms*1000,samplingIdentical:currentOnly?null:true};
  report.rows.push(row);console.log(JSON.stringify(row));
 }
 report.summary=cases.map(input=>{const rows=report.rows.filter(r=>r.variant===input.variant&&r.opponents===input.opponentRanges.length),rate=median(rows.map(r=>r.currentPerSecond)),old=currentOnly?null:median(rows.map(r=>r.previousPerSecond));return {variant:input.variant,opponents:input.opponentRanges.length,previousMedianPerSecond:old,currentMedianPerSecond:rate,speedup:old?rate/old:null,minPerSecond:Math.min(...rows.map(r=>r.currentPerSecond)),maxPerSecond:Math.max(...rows.map(r=>r.currentPerSecond)),meets100kMedian:rate>=100000,meets100kEveryRun:rows.every(r=>r.currentPerSecond>=100000)};});
 report.status=currentOnly?'PASS_MEASUREMENT':'PASS_NUMERIC_EQUIVALENCE_AND_MEASUREMENT';
}catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;}
finally{
 report.elapsedMs=performance.now()-started;
 const out=path.resolve(__dirname,'../../validacao/numeric-v2-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({report:out,status:report.status,summary:report.summary,elapsedMs:report.elapsedMs}));
}
