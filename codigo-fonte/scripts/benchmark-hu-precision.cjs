'use strict';
// LOCAL_REAL_SOLVER: real worker/service/ledger, synthetic declared river studies.
// No browser, microphone, cloud server, network latency or production SLA claim.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {createSolverService,BUDGETS,LIMITS}=require('../src/solver/job-service');
const {VERSION:solverVersion}=require('../src/solver/extensive-solver');
const {VERSION:certificateVersion}=require('../src/solver/action-conditioned');
const {riverMixedInput}=require('../test/helpers/solver-reference-fixtures.cjs');
const session=require('../src/multiway-session');

const SAMPLES=5,POLL_MS=2;
const output=process.argv[2]?path.resolve(process.argv[2]):path.resolve(__dirname,'../../validacao/hu-precision-performance.json');
const terminalPhases=new Set(['COMPLETE','FAILED','CANCELLED','UNSUPPORTED']);
const rounded=value=>Number.isFinite(value)?Math.round(value*1000)/1000:null;
const percentile=(values,p)=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);return sorted.length?sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]:null;};
const summary=values=>({count:values.filter(Number.isFinite).length,p50:rounded(percentile(values,.5)),p95:rounded(percentile(values,.95)),min:rounded(Math.min(...values.filter(Number.isFinite))),max:rounded(Math.max(...values.filter(Number.isFinite)))});

function terminalCallInput(tied=false){
  const hero=['As','Ah','Qd','Jc','Tc'],board=['2s','3h','4d','8c','9s'];
  let current=session.start({variant:'PLO5_HIGH',playerCount:2,heroPosition:'SB',startingStack:2,smallBlind:.5,bigBlind:1,heroCards:hero});
  while(current.state.street!=='RIVER')current=session.step(current.multiway,current.state.phase==='WAIT_BOARD'
    ?{type:'BOARD',cards:board.slice(0,{FLOP:3,TURN:4,RIVER:5}[current.state.nextStreet])}
    :{type:'ACT',actor:current.state.actor,action:current.state.legal.toCall?'CALL':'CHECK'});
  current=session.step(current.multiway,{type:'ACT',actor:1,action:'BET',to:1});
  assert.equal(current.state.actor,current.state.heroId);
  const opponents=[{cards:['Ks','Kh','6d','7c','8h'],weight:tied?.25:1}];
  if(tied)opponents.push({cards:['5h','6h','Kd','7c','8h'],weight:.75});
  return {multiway:current.multiway,ranges:[{seatId:0,complete:true,source:'EXPLICIT_LOCAL_BENCHMARK',combos:[{cards:hero,weight:1}]},
    {seatId:1,complete:true,source:'EXPLICIT_LOCAL_BENCHMARK',combos:opponents}],
    sizing:{type:'MIN_MID_MAX',maxAggressions:3},rake:{type:'NONE',basis:'BEFORE_FEES'}};
}

function validateResult(result){
  assert.ok(result?.actions?.length,'A real completed strategy is required.');
  assert.equal(result.source,'REFERENCE_SUBGAME_STRATEGY');
  assert.equal(result.qualification.gto,false);
  const certificate=result.actionPrecision;
  assert.equal(certificate.baseGameHash,result.gameHash);
  const contextKey=crypto.createHash('sha256').update(JSON.stringify([result.abstraction.key,result.abstraction.heroInformationSet,solverVersion,certificateVersion])).digest('hex');
  assert.equal(certificate.baseContextKey,contextKey);
  assert.deepEqual(certificate.actions.map(row=>row.id),result.actions.map(row=>row.id));
  for(const row of certificate.actions){
    assert.equal(row.baseContextKey,contextKey);assert.equal(row.baseGameHash,result.gameHash);
    assert.equal(row.version,certificateVersion);assert.equal(row.solverVersion,solverVersion);
    assert.equal(row.target,certificate.target);assert.equal(row.origin,certificate.origin);
    assert.equal(row.player,certificate.player);assert.equal(row.informationSet,certificate.informationSet);
    assert.deepEqual(row.utility,certificate.utility);
    if(row.certified){
      assert.ok(Number.isFinite(row.lowerBB)&&Number.isFinite(row.upperBB)&&row.lowerBB<=row.upperBB);
      assert.ok(row.estimateBB>=row.lowerBB&&row.estimateBB<=row.upperBB);
      assert.equal(row.fullPriorPreserved,true);assert.equal(row.originalHandActionEV,false);
      assert.equal(row.gameHash,row.conditionedHash);
    }
  }
  if(result.decisionPrecision.status==='CONCLUSIVE'){
    assert.ok(certificate.actions.every(row=>row.certified));
    const leader=certificate.actions.find(row=>row.id===result.decisionPrecision.bestActionId);
    assert.ok(leader,'Conclusion must identify an original action.');
    const tolerance=16*Number.EPSILON*Math.max(1,...certificate.actions.flatMap(row=>[Math.abs(row.lowerBB),Math.abs(row.upperBB)]));
    for(const rival of certificate.actions)if(rival.id!==leader.id)
      assert.ok(leader.lowerBB>rival.upperBB+tolerance,`Conclusion failed every-alternative domination: ${rival.id}`);
  }
  return true;
}

function quality(result){
  const precision=result.actionPrecision;
  return {status:result.status,comparisonStatus:result.decisionPrecision.status,comparisonTarget:result.decisionPrecision.target,
    reasonCode:result.decisionPrecision.reasonCode,bestActionId:result.decisionPrecision.bestActionId,deltaEVBB:result.decisionPrecision.deltaEVBB,
    nashConvBB:result.convergence.nashConv,globalThresholdBB:result.convergence.thresholdBB,globalThresholdMet:result.convergence.thresholdMet,
    stopReason:result.adaptation.stopReason,refinementRecommended:result.adaptation.refinementRecommended,
    totalWorkIterations:result.adaptation.workIterations,globalIterations:result.adaptation.globalIterations,actionIterations:result.adaptation.actionIterations,
    originalActions:result.actions,worlds:result.abstraction.compatibleWorlds,nodes:result.metrics?.nodes??result.metrics?.nodeCount??null,
    originalTreeUnchanged:precision.originalStrategyTreeUnchanged,contextValidated:true,
    actionBounds:precision.actions.map(row=>({id:row.id,certified:row.certified,estimateBB:row.estimateBB,lowerBB:row.lowerBB,upperBB:row.upperBB,
      widthBB:row.certified?row.upperBB-row.lowerBB:null,iterations:row.iterations,elapsedMs:row.elapsedMs,strategicDecisionCount:row.strategicDecisionCount??null,
      conditionedHash:row.conditionedHash,baseGameHash:row.baseGameHash,baseContextKey:row.baseContextKey})),
    survivingActionIds:precision.focus.survivingActionIds,dominatedActions:precision.focus.dominatedActions,
    rootDiagnostics:result.rootDiagnostics,stability:result.stability,costs:result.metrics.costs,actionCosts:result.metrics.actionCosts};
}

async function runSample(scenario,index){
  const service=createSolverService(),input=scenario.input(),owner=`benchmark-${scenario.id}-${index}`;
  const options={handId:input.multiway.handId,revisionKey:`benchmark-revision-${index}`};
  const started=performance.now(),baselineRSS=process.memoryUsage().rss;
  let peakRSS=baselineRSS,firstProfileMs=null,fullCertificateMs=null,last,firstValueReportedMs=null;
  const phases=[];
  function observe(state){
    peakRSS=Math.max(peakRSS,process.memoryUsage().rss);
    if(state.result?.actions?.length){firstProfileMs??=performance.now()-started;firstValueReportedMs??=state.timing.firstValueMs;}
    if(state.result?.actionPrecision?.actions?.length&&state.result.actionPrecision.actions.every(row=>row.certified))fullCertificateMs??=performance.now()-started;
  }
  try{
    for(const budget of ['FAST','STANDARD']){
      const phaseStarted=performance.now();let state=await service.start(owner,input,{...options,budget});observe(state);
      while(!terminalPhases.has(state.phase)){
        assert.ok(performance.now()-started<45000,'Adaptive benchmark timed out.');
        await delay(POLL_MS);state=service.get(owner,state.jobId);observe(state);
      }
      assert.equal(state.phase,'COMPLETE',JSON.stringify(state));last=state;
      phases.push({budget,elapsedMs:rounded(performance.now()-phaseStarted),cacheHit:state.cache.hit,timing:state.timing,
        status:state.result?.status,comparisonStatus:state.result?.decisionPrecision?.status,stopReason:state.result?.adaptation?.stopReason});
      if(!state.result?.adaptation?.refinementRecommended)break;
    }
    const completedMs=performance.now()-started;validateResult(last.result);scenario.check(last.result);
    const warmStarted=performance.now(),warm=await service.start(owner,input,{...options,budget:'FAST'}),warmElapsed=performance.now()-warmStarted;
    assert.equal(warm.phase,'COMPLETE');assert.equal(warm.cache.hit,true);validateResult(warm.result);
    assert.deepEqual(warm.result,last.result,'Warm reuse must preserve the exact same numerical result.');
    assert.equal(warm.timing.workerMs,0,'Warm read must not hide a fresh solve.');
    return {sample:index+1,cold:{firstProfileObservedMs:rounded(firstProfileMs),firstProfileServiceReportedMs:firstValueReportedMs,
      firstFullCertificateObservedMs:rounded(fullCertificateMs),completedObservedMs:rounded(completedMs),
      decisionComputeMs:rounded(last.timing.decisionComputeMs),decisionWorkIterations:last.timing.decisionWorkIterations,phases},
      warm:{readObservedMs:rounded(warmElapsed),firstProfileMs:rounded(warmElapsed),fullCertificateMs:warm.result.actionPrecision.actions.every(row=>row.certified)?rounded(warmElapsed):null,
        cachedResultIdentical:true,newWorkerComputeMs:warm.timing.workerMs},
      memory:{unit:'bytes',scope:'PROCESS_RSS_MAIN_AND_ALL_WORKER_THREADS_SAMPLED_EVERY_2MS_NOT_PER_WORKER',baselineRSS,peakRSS,peakIncreaseRSS:peakRSS-baselineRSS,
        lastWorkerReportedHeapBytes:last.result.metrics.heapUsedBytes??null},quality:quality(last.result)};
  }finally{await service.close();}
}

const scenarios=[
  {id:'separated_terminal_call',input:()=>terminalCallInput(false),check(result){assert.equal(result.decisionPrecision.status,'CONCLUSIVE');assert.equal(result.decisionPrecision.bestActionId,'CALL');}},
  {id:'tied_terminal_call',input:()=>terminalCallInput(true),check(result){assert.equal(result.decisionPrecision.status,'INCONCLUSIVE');assert.equal(result.adaptation.stopReason,'FIXED_CONTINUATIONS_FULLY_EVALUATED');}},
  {id:'four_world_five_action_river',input:riverMixedInput,check(result){assert.equal(result.abstraction.compatibleWorlds,4);assert.equal(result.actions.length,5);}}
];

async function main(){
  const report={classification:'LOCAL_REAL_SOLVER_WORKER_SYNTHETIC_DECLARED_HU_RIVER_STUDIES',generatedAt:new Date().toISOString(),
    environment:{platform:process.platform,release:os.release(),architecture:process.arch,node:process.version,cpu:os.cpus()[0]?.model,logicalCPUCount:os.cpus().length,totalMemoryBytes:os.totalmem()},
    solverVersion,certificateVersion,budgets:BUDGETS,limits:LIMITS,samplesPerScenario:SAMPLES,pollIntervalMs:POLL_MS,
    percentileMethod:'nearest rank; p95 of 5 is sample maximum',
    coldDefinition:'Empty service cache and a fresh real worker thread per FAST/STANDARD job; OS file caches and the parent Node process are not flushed.',
    warmDefinition:'Exact in-memory compatible FAST cache read after the adaptive run; no worker launched and numerical result unchanged.',
    precisionPolicy:'The same production budgets, bounds and qualification apply to every run. Resource stops remain inconclusive when bounds overlap; precision is never weakened to meet latency.',
    limitations:['Windows local measurements, not a Render or network SLA.','Five samples give descriptive p50/p95 only, not a tail-latency guarantee.',
      'Synthetic explicit finite ranges and bounded river sizing; no broader PLO, streets or multiplayer claim.',
      'No concurrent EV, microphone, browser or audio recognition load is included.',
      'Polling timestamps upper-bound publication visibility by scheduling/polling delay; the service first-value timestamp is also recorded.',
      'RSS covers the entire benchmark Node process and worker threads, can retain allocator/JIT memory across samples, and is not per-worker peak memory.'],scenarios:[]};
  for(const scenario of scenarios){
    const samples=[];
    for(let index=0;index<SAMPLES;index++){
      samples.push(await runSample(scenario,index));
      const sample=samples.at(-1);process.stdout.write(`${scenario.id} ${index+1}/${SAMPLES}: ${sample.cold.completedObservedMs} ms, ${sample.quality.comparisonStatus}\n`);
    }
    report.scenarios.push({id:scenario.id,samples,summary:{
      coldFirstProfileMs:summary(samples.map(sample=>sample.cold.firstProfileObservedMs)),
      coldFullCertificateMs:summary(samples.map(sample=>sample.cold.firstFullCertificateObservedMs)),
      coldCompletionMs:summary(samples.map(sample=>sample.cold.completedObservedMs)),
      cumulativeComputeMs:summary(samples.map(sample=>sample.cold.decisionComputeMs)),
      warmCacheMs:summary(samples.map(sample=>sample.warm.readObservedMs)),
      globalComputeMs:summary(samples.map(sample=>sample.quality.costs.globalSolveMs+sample.quality.costs.globalEvaluationMs)),
      actionComputeMs:summary(samples.map(sample=>sample.quality.costs.actionSolveMs)),
      peakProcessRSSBytes:summary(samples.map(sample=>sample.memory.peakRSS)),
      globalIterations:summary(samples.map(sample=>sample.quality.globalIterations)),
      actionIterations:summary(samples.map(sample=>sample.quality.actionIterations)),
      conclusiveSamples:samples.filter(sample=>sample.quality.comparisonStatus==='CONCLUSIVE').length,
      stoppingReasons:[...new Set(samples.map(sample=>sample.quality.stopReason))]}});
  }
  await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
  process.stdout.write(`Report: ${output}\n`);
}
if(require.main===module)main().catch(error=>{process.stderr.write(`${error.stack}\n`);process.exitCode=1;});
module.exports={terminalCallInput,runSample,validateResult};
