'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const equity=require('../src/equity-engine'),analyze=require('../src/analysis-worker');
const tag=process.argv.find(a=>a.startsWith('--tag='))?.slice(6)||'current';
const report={at:new Date().toISOString(),version:require('../package.json').version,tag,environment:'LOCAL_NODE_DIRECT_AND_ANALYSIS_WORKER',cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,node:process.version,unit:'complete Monte Carlo simulations per second',samplesPerRequest:50000,repetitions:3,rows:[],limitations:['Three short runs are not a sustained-rate or p95 SLA','CPU clocks and temperature not controlled; user applications remain open','Uniform preflop, one fixed hero hand per variant, no aggression-study branches','Worker path includes decision/EV but excludes HTTP and UI'],status:'RUNNING'};
const cases=[[5,5],[6,4]].map(([n,opponents])=>({variant:`PLO${n}_HIGH`,heroCards:['As','Ks','Qh','Jh','Td','9d'].slice(0,n),board:[],players:opponents+1,opponentRanges:Array.from({length:opponents},()=>({kind:'UNIFORM'})),samples:50000,samplingMode:'FIXED',position:'BTN',potBeforeAction:12,amountToCall:4,effectiveStack:100,assumeNoRake:true,futureStreetModel:{type:'SHOWDOWN_ONLY'}}));
const median=a=>a.slice().sort((a,b)=>a-b)[Math.floor(a.length/2)];
(async()=>{try{
 for(const input of cases)equity.monteCarloEquity({...input,samples:2000,seed:781});
 for(let rep=0;rep<3;rep++)for(const input of cases){
  const seed=91381+rep*131,t=performance.now(),direct=equity.monteCarloEquity({...input,seed}),directMs=performance.now()-t;
  const w=performance.now(),result=await analyze({...input,seed}),workerMs=performance.now()-w;
  assert.equal(result.status,'OK');for(const key of ['equity','winRate','tieRate','samples'])assert.equal(result.equity[key],direct[key]);
  const row={variant:input.variant,opponents:input.players-1,totalPlayers:input.players,repetition:rep+1,seed,samples:result.equity.samples,directMs,directSimulationsPerSecond:direct.samples/directMs*1000,workerMs,workerSimulationsPerSecond:result.equity.samples/workerMs*1000,workerTiming:result.performance??null,equity:direct.equity};report.rows.push(row);console.log(JSON.stringify(row));
 }
 report.summary=cases.map(input=>{const rows=report.rows.filter(r=>r.variant===input.variant);return {variant:input.variant,opponents:input.players-1,totalPlayers:input.players,directMedianPerSecond:median(rows.map(r=>r.directSimulationsPerSecond)),directMinimumPerSecond:Math.min(...rows.map(r=>r.directSimulationsPerSecond)),workerMedianPerSecond:median(rows.map(r=>r.workerSimulationsPerSecond)),workerMinimumPerSecond:Math.min(...rows.map(r=>r.workerSimulationsPerSecond)),allDirectRunsMeet100k:rows.every(r=>r.directSimulationsPerSecond>=100000),allWorkerRunsMeet100k:rows.every(r=>r.workerSimulationsPerSecond>=100000)};});report.status='PASS_SAMPLING_EQUIVALENCE_AND_MEASUREMENT';
}catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;}
finally{await analyze.close?.();const out=path.resolve(__dirname,`../../validacao/worker-pool-${tag}-`+new Date().toISOString().replace(/[:.]/g,'-')+'.json');fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({report:out,status:report.status,summary:report.summary}));}
})();
