'use strict';
// Exact adapter-only benchmark. It does not measure CFR, per-action bound
// convergence, HTTP, foreground EV or voice responsiveness.
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const Module=require('node:module');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {expandedRiverInput}=require('./solver-river-growth-fixtures.cjs');
const current=require('../../src/solver/plo-river-game');
const BASELINE='1c9a91fd1555297b50c3db5e092868516436b60e';
const root=path.resolve(__dirname,'../../..'),output=path.join(root,'validacao/river-hu-expanded-tree-benchmark.json');
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const p=(values,q)=>values.slice().sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*q)-1)]??null;
const stats=values=>({count:values.length,p50:p(values,.5),p95:p(values,.95),min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null});

if(!isMainThread){
  try{
    let adapter=current;
    if(workerData.engine==='baseline'){
      const filename=path.resolve(__dirname,'../../src/solver/plo-river-baseline-inline.cjs');
      const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));
      loaded._compile(workerData.baselineCode,filename);adapter=loaded.exports;
    }
    const heapBefore=process.memoryUsage().heapUsed,start=performance.now(),built=adapter.buildPloRiverGame(workerData.input),elapsedMs=performance.now()-start;
    const heapAfter=process.memoryUsage().heapUsed;
    let valid=null,treeHash=null;
    if(built.status==='READY'){
      const seen=new Set();function walk(node){assert.ok(!seen.has(node),'Tree has shared node identity.');seen.add(node);if(node.type==='chance')node.outcomes.forEach(row=>walk(row.node));else if(node.type==='decision')node.actions.forEach(row=>walk(row.node));}
      walk(built.game.root);treeHash=digest(built.game.root);
      const check=require('../../src/solver/extensive-solver').validateGame(built.game);
      valid={perfectRecall:check.perfectRecall,constantSum:check.constantSum,treeNodes:seen.size,worlds:built.game.meta.compatibleWorlds,
        rootActions:built.game.meta.rootActions.length,fullLegalSizingCoverage:built.game.meta.fullLegalSizingCoverage,
        treeComplete:built.game.meta.treeComplete,chanceSupportComplete:built.game.meta.chanceSupportComplete};
    }
    parentPort.postMessage({engine:workerData.engine,status:built.status,reasons:built.reasons,elapsedMs,metrics:built.metrics,treeHash,validation:valid,
      heapBeforeBytes:heapBefore,heapAfterBytes:heapAfter,heapDeltaBytes:heapAfter-heapBefore});
  }catch(error){parentPort.postMessage({error:error.stack});}
}else{
  async function sample(engine,input,baselineCode){
    const baselineRSS=process.memoryUsage().rss;let peakRSS=baselineRSS;
    const worker=new Worker(__filename,{workerData:{engine,input,baselineCode},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4}});
    const poll=setInterval(()=>{peakRSS=Math.max(peakRSS,process.memoryUsage().rss);},2);
    try{
      const result=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code!==0)reject(Error(`Worker exited ${code}`));});});
      if(result.error)throw Error(result.error);
      return {...result,processRSS:{baselineBytes:baselineRSS,peakBytes:peakRSS,deltaBytes:peakRSS-baselineRSS}};
    }finally{clearInterval(poll);await worker.terminate();}
  }
  async function main(){
    const baselineCode=execFileSync('git',['show',`${BASELINE}:codigo-fonte/src/solver/plo-river-game.js`],{cwd:root,encoding:'utf8'});
    const report={classification:'LOCAL_EXACT_ADAPTER_BUILD_REAL_LEDGER_SYNTHETIC_HU_STUDIES',generatedAt:new Date().toISOString(),
      baselineCommit:BASELINE,currentCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),currentAdapter:current.VERSION,
      baselineScope:'Historical adapter source against unchanged authoritative ledger/cards/evaluator/rake dependencies; build-only comparison, not historical end-to-end runtime.',
      workingTreeChangesIncluded:true,samplesPerCell:5,platform:process.platform,node:process.version,cpu:os.cpus()[0]?.model,
      limits:{serviceBuildMemoryBytes:48*1024*1024,maxNodes:12000,maxBuildMs:750,currentHU:current.HU_SUPPORT},
      protocol:'Fresh worker for each measured build. Baseline/current order alternates by sample. Same exact fixture inputs and 750ms/48MiB/12k-node limits. Baseline world cap stays27; current cap144. No old code caps are relaxed.',
      memoryScope:'RSS samples include benchmark parent and worker; heap samples are before/after build, not peak memory. Reserved memory is the unchanged conservative8192B/node policy.',
      limitations:['Adapter build only; no CFR/convergence/precision/HTTP/audio timing claim.','New larger support is NOT_SOLVED by the historical adapter; its rejections are not solve performance comparisons.',
        'Five samples per case; nearest-rank p95 is maximum, not a production tail guarantee.','Windows local CPU; OS caches are not flushed.','No change to payoff, fees, odd chips, range probabilities or action-tree abstraction.'],cases:[]};
    for(const combos of [2,3,4,6,8,12])for(const sizings of [3,5,8,12]){
      const input=expandedRiverInput({combos,sizings}),baselineInput=structuredClone(input);
      input.budget={maxWorlds:144,maxNodes:12000,maxMemoryBytes:48*1024*1024,maxBuildMs:750};
      baselineInput.budget={...input.budget,maxWorlds:27};
      const runs=[];
      for(let index=0;index<5;index++){
        const entries={};for(const engine of index%2?['current','baseline']:['baseline','current'])entries[engine]=await sample(engine,engine==='baseline'?baselineInput:input,baselineCode);
        assert.equal(entries.current.status,'READY',JSON.stringify(entries.current));
        if(entries.baseline.status==='READY')assert.equal(entries.current.treeHash,entries.baseline.treeHash,'Exact nodes/infosets/chance/payoffs changed from1c9a');
        runs.push(entries);
      }
      report.cases.push({combosPerSeat:combos,declaredSizings:sizings,compatibleWorlds:combos*combos,runs,
        equivalenceToBaseline:runs[0].baseline.status==='READY'?'EXACT_STRUCTURAL_DIGEST_MATCH':'BASELINE_COVERAGE_REJECTED_NO_COMPARABLE_TREE',
        currentBuildMs:stats(runs.map(row=>row.current.elapsedMs)),baselineBuildMs:runs[0].baseline.status==='READY'?stats(runs.map(row=>row.baseline.elapsedMs)):null,
        currentHeapDeltaBytes:stats(runs.map(row=>row.current.heapDeltaBytes)),currentPeakProcessRSSBytes:stats(runs.map(row=>row.current.processRSS.peakBytes)),
        reservedMemoryBytes:runs[0].current.metrics.reservedMemoryBytes});
      process.stdout.write(`${combos}x${combos},${sizings} sizings: ${p(runs.map(row=>row.current.elapsedMs),.5).toFixed(2)}ms p50; baseline ${runs[0].baseline.status}\n`);
    }
    const stress=expandedRiverInput({combos:12,sizings:12,maxAggressions:3});stress.sizing.levels=[1,1.5,2,2.5,3,4,5,6,8,10,12,16];
    stress.budget={maxWorlds:144,maxNodes:12000,maxMemoryBytes:48*1024*1024,maxBuildMs:750};
    report.stress=await sample('current',stress,baselineCode);assert.equal(report.stress.status,'NOT_SOLVED');assert.equal(report.stress.treeHash,null);
    await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
    process.stdout.write(`Report: ${output}\n`);
  }
  if(require.main===module)main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
}
