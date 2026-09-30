'use strict';
// Reproduce from codigo-fonte, with baseline 1c9a91f available in Git objects:
//   node test/helpers/benchmark-river-small-ab.cjs --prepare
//   node test/helpers/benchmark-river-small-ab.cjs
// Preparation extracts the verbatim baseline into a preserved temporary
// directory and records its archive/file hashes in validacao. Run both arms
// without concurrent solver tests or browser calculations; no source is patched.
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'../../..'),source=path.join(root,'codigo-fonte');
const BASELINE='1c9a91fd1555297b50c3db5e092868516436b60e';
const manifestPath=path.join(root,'validacao/river-small-ab-prepared.json'),output=path.join(root,'validacao/river-small-ab-current.json');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const files=['src/solver/job-worker.js','src/solver/job-service.js','src/solver/plo-river-game.js','src/solver/extensive-solver.js','src/solver/action-conditioned.js','src/solver/solution-cache.js','src/decision-precision.js'];
const fileHashes=directory=>Object.fromEntries(files.map(name=>[name,hash(fs.readFileSync(path.join(directory,name)))]));
const statistics=values=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return {count:a.length,p50:a[Math.max(0,Math.ceil(a.length*.5)-1)]??null,p95:a[Math.max(0,Math.ceil(a.length*.95)-1)]??null};};

async function child(){
  const {createSolverService}=require(path.join(workerData.directory,'src/solver/job-service.js'));
  const service=createSolverService(),owner='interleaved-small-ab',input=workerData.input;
  const options={revisionKey:'fixed-benchmark-revision',handId:input.multiway.handId};
  const started=performance.now(),cpuBefore=process.cpuUsage();let firstProfileMs=null,firstAllBoundsMs=null,firstConclusiveMs=null;
  const phases=[];let last;
  const observe=state=>{
    if(state.result?.actions?.length)firstProfileMs??=performance.now()-started;
    if(state.result?.actionPrecision?.actions?.length&&state.result.actionPrecision.actions.every(row=>row.certified))firstAllBoundsMs??=performance.now()-started;
    if(state.result?.decisionPrecision?.status==='CONCLUSIVE')firstConclusiveMs??=performance.now()-started;
  };
  try{
    for(const budget of ['FAST','STANDARD']){
      const begin=performance.now();let state=await service.start(owner,input,{...options,budget});observe(state);
      while(!['COMPLETE','FAILED','UNSUPPORTED','CANCELLED'].includes(state.phase)){
        assert.ok(performance.now()-started<15000,'A/B arm exceeded its watchdog.');
        await delay(2);state=service.get(owner,state.jobId);observe(state);
      }
      assert.equal(state.phase,'COMPLETE',JSON.stringify(state));last=state;
      phases.push({budget,observedElapsedMs:performance.now()-begin,timing:state.timing,phase:state.phase,
        status:state.result.status,comparison:state.result.decisionPrecision.status,
        stopReason:state.result.adaptation.stopReason,costs:state.result.metrics.costs,
        workIterations:state.result.adaptation.workIterations,globalIterations:state.result.iterations,
        actionIterations:state.result.adaptation.actionIterations});
      if(!state.result.adaptation.refinementRecommended)break;
    }
    const completionMs=performance.now()-started;
    const result=last.result,certificate=result.actionPrecision;
    assert.equal(certificate.baseGameHash,result.gameHash);
    assert.equal(certificate.baseContextKey,hash(JSON.stringify([result.abstraction.key,result.abstraction.heroInformationSet,result.solverVersion,certificate.version])));
    assert.ok(certificate.actions.every(row=>row.certified&&row.baseContextKey===certificate.baseContextKey&&row.baseGameHash===result.gameHash));
    if(result.decisionPrecision.status==='CONCLUSIVE'){
      const leader=certificate.actions.find(row=>row.id===result.decisionPrecision.bestActionId);
      const tolerance=16*Number.EPSILON*Math.max(1,...certificate.actions.flatMap(row=>[Math.abs(row.lowerBB),Math.abs(row.upperBB)]));
      assert.ok(certificate.actions.every(row=>row.id===leader.id||leader.lowerBB>row.upperBB+tolerance));
    }
    assert.equal(result.decisionPrecision.status,workerData.expectedComparison);
    const cpu=process.cpuUsage(cpuBefore);
    const warmBegin=performance.now(),warm=await service.start(owner,input,{...options,budget:'FAST'});
    const warmMs=performance.now()-warmBegin;assert.equal(warm.cache.hit,true);assert.deepEqual(warm.result,result);
    assert.equal(warm.timing.workerMs,0);
    return {engine:workerData.engine,scenario:workerData.scenario,firstProfileMs,firstAllBoundsMs,firstConclusiveMs,completionMs,warmMs,phases,
      cumulativeDecisionComputeMs:last.timing.decisionComputeMs,cpuUsageMicroseconds:cpu,processMemory:process.memoryUsage(),
      numerical:{status:result.status,comparison:result.decisionPrecision.status,bestActionId:result.decisionPrecision.bestActionId,
        nashConv:result.convergence.nashConv,deltaEVBB:result.decisionPrecision.deltaEVBB,actions:result.actions,
        bounds:certificate.actions.map(row=>({id:row.id,estimateBB:row.estimateBB,lowerBB:row.lowerBB,upperBB:row.upperBB,iterations:row.iterations})),
        globalIterations:result.iterations,actionIterations:result.adaptation.actionIterations,allActionsCertified:true,contextsValid:true,
        everyAlternativeDominated:result.decisionPrecision.status==='CONCLUSIVE'}};
  }finally{await service.close();}
}

function prepare(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-small-ab-'));
  const archive=path.join(directory,'historical-source.tar');
  execFileSync('git',['archive','--format=tar',`--output=${archive}`,BASELINE,'codigo-fonte/src','codigo-fonte/public','codigo-fonte/package.json'],{cwd:root,windowsHide:true});
  execFileSync('tar',['-xf',archive,'-C',directory],{windowsHide:true});
  const historical=path.join(directory,'codigo-fonte');
  const manifest={createdAt:new Date().toISOString(),baselineCommit:BASELINE,baselineDirectory:historical,currentDirectory:source,
    baselineArchiveSHA256:hash(fs.readFileSync(archive)),baselineFileHashes:fileHashes(historical),currentFileHashes:fileHashes(source)};
  fs.mkdirSync(path.dirname(manifestPath),{recursive:true});fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  console.log(manifestPath);
}
async function arm(manifest,engine,scenario,input){
  const worker=new Worker(__filename,{workerData:{directory:engine==='baseline'?manifest.baselineDirectory:manifest.currentDirectory,
    engine,scenario:scenario.id,input,expectedComparison:scenario.expected}});
  try{
    const result=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code)reject(Error(`Benchmark harness exited ${code}`));});});
    if(result.error)throw Error(result.error);return result;
  }finally{await worker.terminate();}
}
async function main(){
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  assert.deepEqual(fileHashes(manifest.baselineDirectory),manifest.baselineFileHashes,'Historical source was modified.');
  assert.deepEqual(fileHashes(source),manifest.currentFileHashes,'Current source changed after preparation; prepare again.');
  const {terminalCallInput}=require('../../scripts/benchmark-hu-precision.cjs');
  const {riverMixedInput}=require('./solver-reference-fixtures.cjs');
  const scenarios=[{id:'separated_terminal_call',input:()=>terminalCallInput(false),expected:'CONCLUSIVE'},
    {id:'tied_terminal_call',input:()=>terminalCallInput(true),expected:'INCONCLUSIVE'},
    {id:'four_world_five_action_river',input:riverMixedInput,expected:'CONCLUSIVE'}];
  const report={classification:'LOCAL_INTERLEAVED_REAL_SERVICE_WORKER_AB',generatedAt:new Date().toISOString(),manifest,
    environment:{node:process.version,platform:process.platform,architecture:process.arch,cpu:os.cpus()[0]?.model,logicalCores:os.cpus().length,
      powerState:'NOT_MEASURED',externalLoad:'NOT_MEASURED_NO_ATTRIBUTION',cpuUsageScope:'process.cpuUsage deltas include all threads in the benchmark process; sampled per isolated arm'},
    protocol:'Five paired samples per scenario. Baseline/current order alternates each pair. Exact same synthetic input goes to both. Empty service cache and fresh solver workers. Both use get polling every2ms and FAST then STANDARD only if recommended. No HTTP/auth/browser transport. Baseline source is extracted verbatim; no caps or mathematics patched.',
    metricDefinitions:{firstProfileMs:'Continuous stopwatch from before first start to first observed complete original-profile rows.',
      firstAllBoundsMs:'Same continuous stopwatch to first observed certified bound for every root action, irrespective of conclusiveness.',
      completionMs:'Same continuous stopwatch until final adaptive job is observed COMPLETE. Includes gap between FAST and STANDARD; excludes warm read.',
      phaseTiming:'Old totalMs is age-at-poll, current completionMs freezes terminal time; direct comparison uses observedElapsedMs for both.',
      costs:'Worker-reported compute, independent of outer observed stopwatch; global/action costs remain separately recorded.'},
    limitations:['Local Windows only; not a Render/network SLA.','Five pairs give descriptive p50/p95, not statistical attribution.',
      'No OS-cache flush or measured CPU power/thermal control.','RSS snapshots cover parent and benchmark/solver worker threads, not isolated per-worker peak.'],cases:[]};
  for(const scenario of scenarios){
    const pairs=[];
    for(let index=0;index<5;index++){
      const order=index%2?['current','baseline']:['baseline','current'],input=scenario.input(),pair={index:index+1,order};
      for(const engine of order){pair[engine]=await arm(manifest,engine,scenario,input);await delay(20);}
      assert.equal(pair.current.numerical.status,pair.baseline.numerical.status);
      assert.equal(pair.current.numerical.comparison,pair.baseline.numerical.comparison);
      pairs.push(pair);console.log(`${scenario.id} pair${index+1}: old${pair.baseline.completionMs.toFixed(1)}ms new${pair.current.completionMs.toFixed(1)}ms`);
    }
    const summaries={};for(const engine of ['baseline','current'])summaries[engine]=Object.fromEntries(['firstProfileMs','firstAllBoundsMs','completionMs','warmMs','cumulativeDecisionComputeMs'].map(metric=>[metric,statistics(pairs.map(pair=>pair[engine][metric]))]));
    report.cases.push({id:scenario.id,pairs,summaries,pairedCurrentMinusBaselineMs:Object.fromEntries(['firstProfileMs','firstAllBoundsMs','completionMs','cumulativeDecisionComputeMs'].map(metric=>[metric,statistics(pairs.map(pair=>pair.current[metric]-pair.baseline[metric]))]))});
  }
  assert.deepEqual(fileHashes(source),manifest.currentFileHashes,'Current source changed during A/B.');
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(output);
}
if(!isMainThread)child().then(value=>parentPort.postMessage(value)).catch(error=>parentPort.postMessage({error:error.stack}));
else if(process.argv.includes('--prepare'))prepare();
else if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
