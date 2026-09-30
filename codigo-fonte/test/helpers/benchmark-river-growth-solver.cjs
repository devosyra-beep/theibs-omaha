'use strict';
// LOCAL_REAL_SOLVER: production service and workers, finite synthetic studies.
// Reproduce from codigo-fonte, with THEIBS_REFERENCE_PYTHON pointing to Python
// with SciPy installed:
//   node test/helpers/benchmark-river-growth-reference.cjs
//   node test/helpers/benchmark-river-growth-solver.cjs
// The first command generates validacao/river-hu-expanded-lp-reference.json.
// The historical baseline below is preserved repository evidence; rerun the
// interleaved benchmark-river-small-ab.cjs for a same-host version comparison.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createSolverService,BUDGETS}=require('../../src/solver/job-service');
const {expandedRiverInput}=require('./solver-river-growth-fixtures.cjs');
const {richRiverInput,scenarios:referenceScenarios}=require('./solver-river-growth-reference.cjs');
const {riverMixedInput}=require('./solver-reference-fixtures.cjs');
const {validateResult,terminalCallInput,runSample}=require('../../scripts/benchmark-hu-precision.cjs');
const {VERSION:adapterVersion}=require('../../src/solver/plo-river-game');
const {ADAPTIVE_VERSION:adaptiveVersion}=require('../../src/solver/versions');
const dir=path.resolve(__dirname,'../../../validacao'),output=path.join(dir,'river-hu-expanded-solver-performance.json');
const terminal=new Set(['COMPLETE','FAILED','CANCELLED','UNSUPPORTED']);
const stats=values=>{const items=values.filter(Number.isFinite).sort((a,b)=>a-b);return {count:items.length,p50:items[Math.max(0,Math.ceil(items.length*.5)-1)]??null,p95:items[Math.max(0,Math.ceil(items.length*.95)-1)]??null};};
function quality(result,oracle){
  if(!result?.actions?.length)return {status:result?.status||'NOT_SOLVED',reasons:result?.reasons||[],referenceChecked:false};
  validateResult(result);
  if(oracle){assert.equal(result.abstraction.key,oracle.key);assert.equal(result.abstraction.heroInformationSet,oracle.heroInformationSet);}
  const rows=result.actionPrecision.actions.map(row=>{
    const exact=oracle?.actions.find(item=>item.id===row.id),tolerance=exact?.reference.validationTolerance;
    const contains=exact&&row.certified?row.lowerBB<=exact.referenceValueBB+tolerance&&row.upperBB>=exact.referenceValueBB-tolerance:null;
    if(contains!==null)assert.equal(contains,true,'Live service certificate missed independent LP value.');
    return {id:row.id,certified:row.certified,estimateBB:row.estimateBB,lowerBB:row.lowerBB,upperBB:row.upperBB,widthBB:row.certified?row.upperBB-row.lowerBB:null,
      referenceValueBB:exact?.referenceValueBB??null,referenceTolerance:tolerance??null,containsReference:contains,
      absoluteMidpointErrorBB:exact&&row.certified?Math.abs(row.estimateBB-exact.referenceValueBB):null,
      iterations:row.iterations,elapsedMs:row.elapsedMs,strategicDecisionCount:row.strategicDecisionCount,
      baseContextKey:row.baseContextKey,baseGameHash:row.baseGameHash,conditionedHash:row.conditionedHash};
  });
  return {status:result.status,comparison:result.decisionPrecision,convergence:result.convergence,originalProfileActions:result.actions,
    worlds:result.abstraction.compatibleWorlds,nodes:result.metrics.nodes,reservedMemoryBytes:result.metrics.reservedMemoryBytes,
    actionBounds:rows,allCertified:rows.every(row=>row.certified),maximumBoundWidthBB:Math.max(...rows.filter(row=>row.certified).map(row=>row.widthBB)),
    costs:result.metrics.costs,actionCosts:result.metrics.actionCosts,adaptation:result.adaptation,rootDiagnostics:result.rootDiagnostics,stability:result.stability,
    originalTreeUnchanged:result.actionPrecision.originalStrategyTreeUnchanged,workerHeapSampleBytes:result.metrics.heapUsedBytes,
    referenceChecked:Boolean(oracle),independentOriginalValueBB:oracle?.reference.values[0]??null};
}
async function run(input,{deepIfNeeded=false,oracle=null}={}){
  const service=createSolverService(),owner='expanded-solver-benchmark',options={revisionKey:'frozen-decision',handId:input.multiway.handId};
  const started=performance.now(),baselineRSS=process.memoryUsage().rss;let peakRSS=baselineRSS,firstProfileMs=null,firstAllBoundsMs=null;
  const memory=setInterval(()=>{peakRSS=Math.max(peakRSS,process.memoryUsage().rss);},5),phases=[];
  try{
    for(const budget of ['STANDARD','DEEP']){
      const begin=performance.now();let state=await service.start(owner,input,{...options,budget});
      while(true){
        if(state.result?.actions?.length)firstProfileMs??=performance.now()-started;
        if(state.result?.actionPrecision?.actions?.length&&state.result.actionPrecision.actions.every(row=>row.certified))firstAllBoundsMs??=performance.now()-started;
        if(terminal.has(state.phase))break;
        assert.ok(performance.now()-started<45000,'Worker benchmark timed out.');
        state=await service.wait(owner,state.jobId,{afterVersion:state.updateVersion,waitMs:1000});
      }
      assert.notEqual(state.phase,'FAILED',JSON.stringify(state));
      phases.push({budget,phase:state.phase,observedElapsedMs:performance.now()-begin,timing:state.timing,quality:quality(state.result,oracle)});
      if(!deepIfNeeded||!state.result?.adaptation?.refinementRecommended)break;
    }
    const final=phases.at(-1),warmStart=performance.now(),warm=await service.start(owner,input,{...options,budget:'FAST'});
    assert.equal(warm.cache.hit,Boolean(final.quality.originalProfileActions?.length));
    return {firstProfileMs,firstAllBoundsMs,totalObservedMs:performance.now()-started,phases,
      warmCache:{observedMs:performance.now()-warmStart,hit:warm.cache.hit,newWorkerMs:warm.timing.workerMs},
      memory:{scope:'NODE_PROCESS_RSS_PARENT_AND_WORKER_SAMPLED_EVERY_5MS_NOT_PER_WORKER',baselineRSS,peakRSS,deltaRSS:peakRSS-baselineRSS}};
  }finally{clearInterval(memory);await service.close();}
}
async function main(){
  const reference=JSON.parse(await fs.readFile(path.join(dir,'river-hu-expanded-lp-reference.json'),'utf8'));
  const report={classification:'LOCAL_REAL_WORKER_EXPANDED_RIVER_HU',generatedAt:new Date().toISOString(),platform:process.platform,node:process.version,cpu:os.cpus()[0]?.model,
    adapterVersion,adaptiveVersion,budgets:BUDGETS,standardSamplesPerCell:3,
    protocol:'Fresh empty-cache service; STANDARD production3s/1000-iteration safety cap. Third sample in8x8/12sizes and12x12/12sizes may continue DEEP with the same decision ceiling. Service change notification measures visibility; no fixed350ms HTTP polling.',
    limitations:['Windows local real worker, not hosted latency or SLA.','Three samples per growth cell; p95 is sample maximum.','No concurrent foreground EV, browser or microphone work.',
      'Reported commitment bounds concern full-prior private-information-set commitments, not original hand action EV.','Resource exhaustion is not convergence or a reason to narrow uncertainty.',
      'Independent LP errors are available only for the explicit4x4/5sizes and5x5/8sizes reference scenarios.','RSS samples include benchmark process and worker; final worker heap is a sample, not peak.'],cases:[],referenceCases:[],smallBaselineComparison:[]};
  for(const combos of [4,6,8,12])for(const sizings of [5,8,12]){
    const samples=[];
    for(let i=0;i<3;i++){
      samples.push(await run(expandedRiverInput({combos,sizings}),{deepIfNeeded:i===2&&sizings===12&&[8,12].includes(combos)}));
      const final=samples.at(-1).phases.at(-1);console.log(`${combos}x${combos}/${sizings} sample${i+1}: ${final.quality.status} ${final.quality.comparison?.status} ${final.quality.adaptation?.stopReason}`);
    }
    report.cases.push({combos,sizings,samples,standardSummary:{firstProfileMs:stats(samples.map(row=>row.firstProfileMs)),firstAllBoundsMs:stats(samples.map(row=>row.phases[0].quality.allCertified?row.firstAllBoundsMs:null)),
      completionMs:stats(samples.map(row=>row.phases[0].observedElapsedMs)),decisionComputeMs:stats(samples.map(row=>row.phases[0].timing.decisionComputeMs)),
      globalComputeMs:stats(samples.map(row=>row.phases[0].quality.costs?.globalSolveMs)),actionComputeMs:stats(samples.map(row=>row.phases[0].quality.costs?.actionSolveMs)),
      allPhasesPeakProcessRSSBytes:stats(samples.map(row=>row.memory.peakRSS)),conclusiveSamples:samples.filter(row=>row.phases[0].quality.comparison?.status==='CONCLUSIVE').length}});
  }
  for(const scenario of referenceScenarios){
    const oracle=reference.cases.find(row=>row.combos===scenario.combos&&row.sizings===scenario.sizings);
    report.referenceCases.push({...scenario,result:await run(richRiverInput(scenario),{oracle,deepIfNeeded:true})});
  }
  const historicalPath=path.resolve(__dirname,'../../docs/benchmarks/hu-precision-1c9a91f.json');
  const historical=JSON.parse(await fs.readFile(historicalPath,'utf8'));
  for(const scenario of [{id:'separated_terminal_call',input:()=>terminalCallInput(false),check:()=>{}},
    {id:'tied_terminal_call',input:()=>terminalCallInput(true),check:()=>{}},{id:'four_world_five_action_river',input:riverMixedInput,check:()=>{}}]){
    const samples=[];for(let index=0;index<5;index++)samples.push(await runSample(scenario,index));
    report.smallBaselineComparison.push({id:scenario.id,baselineCommit:'1c9a91fd1555297b50c3db5e092868516436b60e',historicalReport:'codigo-fonte/docs/benchmarks/hu-precision-1c9a91f.json',
      protocol:'Same prior real-worker FAST→STANDARD helper,5samples; historical baseline is not rerun concurrently.',
      baseline:historical.scenarios.find(row=>row.id===scenario.id)?.summary,current:{firstProfileMs:stats(samples.map(row=>row.cold.firstProfileObservedMs)),
        firstAllBoundsMs:stats(samples.map(row=>row.cold.firstFullCertificateObservedMs)),completionMs:stats(samples.map(row=>row.cold.completedObservedMs)),
        warmCacheMs:stats(samples.map(row=>row.warm.readObservedMs)),samples}});
  }
  await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(output);
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
