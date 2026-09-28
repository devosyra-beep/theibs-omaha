'use strict';
// Isolated A/B in the shipped Electron/V8 runtime, using worker-backed analyses.
// No app archive, browser profile, user data or running process is modified.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
if(!process.argv.includes('--inside-electron')){
 const baseline=arg('baseline');if(!baseline)throw Error('--baseline=<isolated source snapshot> required');
 const candidate=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-hotpath-candidate-'));
 fs.cpSync(path.resolve(__dirname,'../src'),path.join(candidate,'src'),{recursive:true});
 fs.copyFileSync(path.resolve(__dirname,'../package.json'),path.join(candidate,'package.json'));
 const exe=process.env.THEIBS_EXECUTABLE||path.resolve(__dirname,'../../THEIBS/THEIBS.exe');
 const result=spawnSync(exe,[__filename,'--inside-electron',`--baseline=${baseline}`,`--candidate=${candidate}`],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
 process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');if(result.error)throw result.error;process.exitCode=result.status??1;
}else{
 const roots={baseline:arg('baseline'),candidate:arg('candidate')},pools=Object.fromEntries(Object.entries(roots).map(([name,root])=>[name,require(path.join(root,'src/analysis-worker'))]));
 const report={at:new Date().toISOString(),environment:'SHIPPED_ELECTRON_RUN_AS_NODE_ANALYSIS_WORKERS',versions:process.versions,cpu:os.cpus()[0].model,samplesPerRequest:50000,repetitions:3,warmupSamplesPerFormat:2000,unit:'complete Monte Carlo simulations per second',sourceHashes:Object.fromEntries(Object.entries(roots).map(([name,root])=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'src/fast-evaluator.js'))).digest('hex')])),rows:[],limitations:['Actual Electron/V8 runtime, isolated worker path; excludes Chromium renderer, HTTP and UI','Three paired repetitions per format are not a sustained-rate or p95 SLA','CPU clocks/temperature not controlled'],status:'RUNNING'};
 const cases=[[5,5],[6,4]].map(([n,opponents])=>({variant:`PLO${n}_HIGH`,heroCards:['As','Ks','Qh','Jh','Td','9d'].slice(0,n),board:[],position:'BTN',players:opponents+1,opponentRanges:Array.from({length:opponents},()=>({kind:'UNIFORM'})),samples:50000,samplingMode:'FIXED',potBeforeAction:12,amountToCall:4,effectiveStack:100,assumeNoRake:true,futureStreetModel:{type:'SHOWDOWN_ONLY'}}));
 const median=a=>a.slice().sort((a,b)=>a-b)[Math.floor(a.length/2)];
 (async()=>{try{
  for(const input of cases)for(const pool of Object.values(pools))await pool({...input,samples:2000,seed:1839});
  for(let rep=0;rep<3;rep++)for(const input of cases){
   const values={},seed=91381+rep*131;
   for(const name of rep%2?['candidate','baseline']:['baseline','candidate']){const started=performance.now(),result=await pools[name]({...input,seed});values[name]={result,ms:performance.now()-started};assert.equal(result.status,'OK');assert.equal(result.equity.samples,50000);}
   for(const key of ['equity','winRate','tieRate','samples'])assert.equal(values.baseline.result.equity[key],values.candidate.result.equity[key]);
   assert.deepEqual(values.baseline.result.ev,values.candidate.result.ev);
   const row={variant:input.variant,opponents:input.players-1,rep:rep+1,seed,samples:50000,baselineMs:values.baseline.ms,candidateMs:values.candidate.ms,baselinePerSecond:50000000/values.baseline.ms,candidatePerSecond:50000000/values.candidate.ms,speedup:values.baseline.ms/values.candidate.ms,identicalEquityAndEV:true};report.rows.push(row);console.log(JSON.stringify(row));
  }
  report.summary=cases.map(input=>{const rows=report.rows.filter(r=>r.variant===input.variant);return {variant:input.variant,opponents:input.players-1,baselineMedianPerSecond:median(rows.map(r=>r.baselinePerSecond)),candidateMedianPerSecond:median(rows.map(r=>r.candidatePerSecond)),candidateMinimumPerSecond:Math.min(...rows.map(r=>r.candidatePerSecond)),medianPairedSpeedup:median(rows.map(r=>r.speedup)),allCandidateRunsMeet100k:rows.every(r=>r.candidatePerSecond>=100000)};});report.status='PASS_IDENTICAL_NUMERICAL_RESULTS_AND_MEASUREMENT';
 }catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;}
 finally{await Promise.all(Object.values(pools).map(pool=>pool.close()));const out=path.resolve(__dirname,'../../validacao/electron-hotpath-ab-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({report:out,status:report.status,summary:report.summary}));}
 })();
}
