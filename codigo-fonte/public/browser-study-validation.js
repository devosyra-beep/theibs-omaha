(() => {
  'use strict';
  const $ = id => document.getElementById(id), clone = structuredClone;
  const owner = 'THEIBS_PUBLIC_STUDY_SENSITIVITY_QA';
  const terminal = new Set(['COMPLETE','FAILED','UNSUPPORTED','CANCELLED']);
  const active = new Map(), records = new Map();
  let manifest, cells, service, runner, report, running = false, consumed = false, stopped = false, bindingToken = 0;
  let taps = 0, typingEvents = 0, workerMessages = [], currentStarted = null, comparison = null;
  const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key] ?? null]));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function heap() {
    return performance.memory ? { source:'EXPOSED_PAGE_JS_HEAP_NONISOLATED_NOT_WORKER_PEAK', ...pick(performance.memory,['usedJSHeapSize','totalJSHeapSize','jsHeapSizeLimit']) }
      : { source:'NOT_MEASURED', usedJSHeapSize:null, totalJSHeapSize:null, jsHeapSizeLimit:null };
  }
  function metrics(result) {
    return result ? { ...pick(result,['status','gameHash','iterations','solverVersion']),
      qualification:clone(result.qualification), convergence:clone(result.convergence),
      decisionPrecision:clone(result.decisionPrecision), decisionOutcome:clone(result.decisionOutcome),
      stopReason:result.adaptation?.stopReason ?? null, workIterations:result.adaptation?.workIterations ?? null,
      actionIterations:clone(result.adaptation?.actionIterations ?? null),
      costs:clone(result.metrics?.costs ?? null), actionCosts:clone(result.metrics?.actionCosts ?? null),
      tree:{...pick(result.abstraction,['compatibleWorlds','productWorlds','heroWorldProbability','fullLegalSizingCoverage']),
        ...pick(result.metrics,['nodes','publicNodes','informationSets','estimatedWorkingBytes','omittedSizingNodes','omittedLegalSizeCount','aggressionCapNodes'])},
      workerHeap:{ source:'NOT_MEASURED', heapUsedBytes:result.metrics?.heapUsedBytes ?? null },
      profileActions:(result.actions || []).map(row => pick(row,['id','action','size','frequency','evBB'])),
      commitment:{ ...pick(result.actionPrecision,['target','scope','utility','baseGameHash','baseContextKey','supportedGameClass','fullPriorPreserved','originalHandActionEV']),
        actions:(result.actionPrecision?.actions || []).map(row => ({ ...pick(row,['id','certified','lowerBB','upperBB','estimateBB','iterations','gameHash','baseGameHash','baseContextKey']),
          widthBB:Number.isFinite(row.lowerBB) && Number.isFinite(row.upperBB) ? row.upperBB-row.lowerBB : null })) }
    } : null;
  }
  function check(label, pass, detail = '') { report.checks.push({label,pass:Boolean(pass),detail}); render(); }
  function render() {
    if (!report) return;
    report.summary = {passed:report.checks.filter(row=>row.pass).length, failed:report.checks.filter(row=>!row.pass).length, cold:report.runs.filter(row=>row.kind==='COLD').length,warm:report.runs.filter(row=>row.kind==='WARM_MEMORY_READ').length};
    report.interactions = {taps,typingEvents,value:$('typing').value,active:running};
    report.viewport = {innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth};
    $('qa-summary').textContent = JSON.stringify({classification:report.classification,buildFingerprint:manifest.buildFingerprint,...report.summary,
      latest:report.runs.slice(-2).map(row=>({cell:row.cell,kind:row.kind,...pick(row,['wallMs','firstObservedMs','phase','cache']),mathematical:pick(row.mathematical,['status','gameHash','stopReason','workIterations'])})),comparisonPhase:comparison?.phase ?? null},null,2);
    $('report').textContent = JSON.stringify(report,null,2);
    $('checks').innerHTML = report.checks.map(row=>`<li>${row.pass?'PASS':'FAIL'} · ${esc(row.label)}${row.detail?' · '+esc(row.detail):''}</li>`).join('') || '<li>No checks executed.</li>';
    $('download').disabled = !report.runs.length;
  }
  function show(result) {
    if (!result) return;
    $('current-result').textContent = `${result.status} · ${result.decisionPrecision?.status ?? 'Unavailable'} · ${result.decisionOutcome?.status ?? 'Unavailable'} · NashConv ${result.convergence?.nashConv ?? 'Unavailable'} BB`;
    $('actions').innerHTML = (result.actions || []).map(row=>{
      const bounds=result.actionPrecision?.actions?.find(item=>item.id===row.id), text=bounds?.certified?`[${bounds.lowerBB}, ${bounds.upperBB}]`:'Unavailable';
      return `<tr><td>${esc(row.id)}</td><td>${esc(row.evBB)}</td><td>${esc(text)}</td><td>${esc(row.frequency)}</td></tr>`;
    }).join('');
  }
  function issues(result) {
    const errors=[], rows=result?.actions || [], bounds=result?.actionPrecision?.actions || [];
    if (!rows.length || rows.some(row=>!Number.isFinite(row.evBB) || !Number.isFinite(row.frequency))) errors.push('Incomplete profile.');
    if (result?.qualification?.gto!==false || result?.qualification?.fullHandEquilibrium!==false) errors.push('Unsupported full-hand claim.');
    if (result?.actionPrecision?.fullPriorPreserved!==true || result?.actionPrecision?.originalHandActionEV!==false) errors.push('Commitment/current-hand scope mismatch.');
    if (bounds.length!==rows.length || bounds.some(row=>row.baseGameHash!==result.gameHash)) errors.push('Missing or wrong-game bounds.');
    if (result?.decisionPrecision?.status==='CONCLUSIVE') {
      const leader=bounds.find(row=>row.id===result.decisionPrecision.bestActionId), guard=result.decisionPrecision.separationToleranceBB || 0;
      if (!leader?.certified || bounds.some(row=>!row.certified || row.id!==leader.id && !(leader.lowerBB>row.upperBB+guard))) errors.push('Strict proof lacks every competitor.');
    }
    if (result?.decisionOutcome?.status==='NEAR_EQUIVALENT') {
      const outcome=result.decisionOutcome, group=bounds.filter(row=>outcome.nearGroupActionIds?.includes(row.id));
      if (group.length<2 || bounds.some(row=>!row.certified) || outcome.actualHandEVEquivalence!==false || result.convergence?.thresholdMet!==true || outcome.robustWorstDifferenceBB>outcome.policy?.nearEquivalenceBB) errors.push('Near outcome lacks its independent scope/proof.');
    }
    return errors;
  }
  async function complete(cell, budget) {
    const started=performance.now(), textBefore=$('typing').value, tapsBefore=taps;
    currentStarted=started; workerMessages=[];
    const initial=await service.start(owner,clone(cell.input),{budget,automatic:false,revisionKey:cell.revisionKey,handId:cell.input.multiway.handId});
    let job=initial, firstObservedMs=job.result?.actions?.length?performance.now()-started:null;
    active.set(job.jobId,job); const observations=[];
    function observe() { observations.push({observedMs:performance.now()-started,phase:job.phase,version:job.updateVersion,workIterations:job.result?.adaptation?.workIterations ?? null,outcome:job.result?.decisionOutcome?.status ?? null}); }
    observe();
    while(!terminal.has(job.phase)) {
      if(stopped || performance.now()-started>7000) { await service.cancel(owner,job.jobId); throw Error('Bounded matrix stopped.'); }
      job=await service.wait(owner,job.jobId,{afterVersion:job.updateVersion,waitMs:1000});active.set(job.jobId,job); observe();
      if(firstObservedMs===null && job.result?.actions?.length)firstObservedMs=performance.now()-started;
      show(job.result);
    }
    active.delete(job.jobId); currentStarted=null;
    if(job.handId!==cell.input.multiway.handId || job.revisionKey!==cell.revisionKey || job.buildFingerprint!==manifest.buildFingerprint)throw Error('Worker result changed fixture identity.');
    const row={kind:budget==='FAST'?'WARM_MEMORY_READ':'COLD',cell:cell.id,wallMs:performance.now()-started,firstObservedMs,acknowledgementMs:initial.timing?.acknowledgementMs ?? null,
      phase:job.phase,timing:clone(job.timing),cache:clone(job.cache),runtimeBudget:clone(job.runtimeBudget),
      cacheStats:service.stats(),mathematical:metrics(job.result),workerMessages:clone(workerMessages),observations,
      pageHeap:heap(),interaction:{textBefore,textAfter:$('typing').value,tapsDuring:taps-tapsBefore}};
    report.runs.push(row);show(job.result);render();return job;
  }
  function comparisonRender(state) {
    comparison=clone(state); let compared=null;
    try { compared=TheibsSolverStudyComparison.compare(state.entries); } catch(error) { compared={error:error.message}; }
    report.comparison={phase:state.phase,elapsedMs:state.elapsedMs,error:state.error,report:compared};
    const renderer=window.theibsMultiwayUI?._testing?.studyComparisonDetails;
    $('study-ui').innerHTML=renderer?renderer({...state,report:compared}):`<p>${esc(state.phase)} · ${esc(state.elapsedMs ?? 0)} ms</p><pre>${esc(JSON.stringify(compared,null,2))}</pre>`;
    render();
  }
  async function matrix() {
    if(consumed)return; consumed=true; running=true; stopped=false;
    $('matrix').disabled=true;$('stop').disabled=false;
    try {
      for(const cell of cells) {
        $('status').textContent=`${cell.name} · cold 3s / 1000 iterations, then warm memory read`;
        // Clear this isolated owner's memory before each cold model.
        service.clearOwner(owner);
        const cold=await complete(cell,'STANDARD'), before=JSON.stringify(cold.result), warm=await complete(cell,'FAST');
        records.set(cell.id,{...clone(cell),result:clone(cold.result),phase:cold.phase,timing:clone(cold.timing),cache:clone(cold.cache)});
        check(cell.id+': cold miss and native runtime',cold.runtime==='BROWSER' && cold.cache?.hit===false);
        check(cell.id+': coherent mathematical scopes',cold.phase==='COMPLETE' && issues(cold.result).length===0,issues(cold.result).join(' '));
        check(cell.id+': identical warm snapshot, no fresh solver work',warm.cache?.hit===true && warm.cache?.source==='MEMORY' && warm.cache?.readOnly===true && JSON.stringify(warm.result)===before && warm.timing?.workerMs===0 && warm.timing?.jobElapsedMs===0);
        check(cell.id+': standard only, no automatic continuation',cold.runtimeBudget?.continuations===0 && cold.runtimeBudget?.automatic===false);
        check(cell.id+': current decision retained',warm.handId===cold.handId && warm.revisionKey===cold.revisionKey);
      }
      const a=records.get('priorA-treeA'), b=records.get('priorB-treeA'), c=records.get('priorA-treeB');
      report.axisComparison={range:TheibsSolverStudyComparison.compare([a,b]),sizing:TheibsSolverStudyComparison.compare([a,c])};
      check('Range and sizing axes are classified separately',report.axisComparison.range.classification==='RANGE_SENSITIVITY' && report.axisComparison.sizing.classification==='SIZING_SENSITIVITY');
      check('Distinct prior and tree games have distinct hashes',new Set([a.result.gameHash,b.result.gameHash,c.result.gameHash]).size===3);
      $('compare').disabled=false;$('invalidate').disabled=false;
      $('status').textContent='Four cold and four warm samples completed. Retained scenario comparison is available.';
      comparisonRender({phase:'COMPLETE',elapsedMs:0,entries:[a,b,c],error:null});
    } catch(error) {check('Matrix completed without runtime errors',false,error.message);$('status').textContent=error.message;}
    finally {running=false;$('stop').disabled=true;render();}
  }
  async function retainedComparison() {
    if(running || !records.size)return;
    running=true;stopped=false;$('compare').disabled=true;$('stop').disabled=false;
    const token=String(++bindingToken), baseline=records.get('priorB-treeB'), binding={handId:baseline.input.multiway.handId,revisionKey:baseline.revisionKey,token};
    const alternatives=['priorA-treeB','priorB-treeA'].map(id=>{const row=records.get(id);return {id:row.id,name:row.name,input:clone(row.input)};});
    const untouched=JSON.stringify(baseline.result), started=performance.now();
    report.runnerExecution='RETAINED_NATIVE_RESULTS_UI_AND_WORKFLOW_ONLY_NO_NEW_SOLVER_WORK';
    try {
      const state=await runner.run({baseline:clone(baseline),entries:alternatives,binding});
      report.runner={observedWallMs:performance.now()-started,phase:state.phase,elapsedMs:state.elapsedMs,entries:state.entries.map(row=>({id:row.id,phase:row.phase,cache:row.cache,timing:row.timing,error:row.error,mathematical:metrics(row.result)}))};
      check('Comparison retains the original base snapshot',JSON.stringify(records.get('priorB-treeB').result)===untouched);
      check('Comparison runner exposes a bounded workflow',state.totalMs===6000 && state.perScenarioMs===3000 && report.runner.observedWallMs<6500,'Small local observation; no SLA.');
      $('status').textContent=`Scenario comparison ${state.phase.toLowerCase()}.`;
    } catch(error) {check('Scenario comparison completed without errors',false,error.message);}
    finally {running=false;$('compare').disabled=false;$('stop').disabled=true;render();}
  }
  $('tap').onclick=()=>{taps++;$('tap-count').textContent=taps+' taps';render();};
  $('typing').addEventListener('input',()=>{typingEvents++;render();});
  $('stop').onclick=()=>{stopped=true;for(const id of active.keys())void service?.cancel(owner,id);void runner?.cancel('Validation stopped.');};
  $('invalidate').onclick=()=>{bindingToken++;void runner?.cancel('Decision binding changed.');check('Decision edit was explicitly invalidated',true);};
  $('download').onclick=()=>{render();const anchor=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));anchor.href=url;anchor.download='browser-study-sensitivity.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const packageQA=new URLSearchParams(location.search).get('package')==='ev-coverage';
  Promise.all([fetch('./browser-solver-manifest.json',{cache:'no-store'}).then(row=>row.json()),fetch(packageQA?'./ev-coverage-fixtures.json':'./solver-validation-fixtures.json',{cache:'no-store'}).then(row=>row.json())]).then(([runtime,fixtures])=>{
    manifest=runtime;const source=packageQA?null:fixtures.cases.find(row=>row.id==='four_world_five_actions').variants[0];
    if(packageQA)cells=clone(fixtures.cells);
    else {
    cells=[];for(const prior of ['A','B'])for(const tree of ['A','B']){
      const input=clone(source.input),weights=prior==='A'?[[3,1],[1,4]]:[[.001,5],[4,1]];
      input.ranges.forEach((range,seat)=>range.combos.forEach((combo,index)=>{combo.weight=weights[seat][index];}));
      input.sizing={type:'EXPLICIT_TOTALS',levels:tree==='A'?[1,2]:[1,1.5,2],maxAggressions:1};
      cells.push({id:`prior${prior}-tree${tree}`,name:`Prior ${prior} / tree ${tree}`,input,revisionKey:source.expectedRevisionKey});
    }
    }
    report={schemaVersion:1,classification:packageQA?'PUBLIC_SYNTHETIC_RIVER_HU_PACKAGE_QA':'PUBLIC_SYNTHETIC_NATIVE_BROWSER_STUDY_QA',createdAt:new Date().toISOString(),url:location.href,buildFingerprint:manifest.buildFingerprint,
      matrix:'Two declared weighted priors × two declared sizing trees; four cold + four FAST reads; one small local cohort, no production rate or latency SLA.',
      notExecuted:['Authenticated gameplay','Physical phone','Human speech recognition','Population range accuracy','Worker heap or process peak memory'],
      inputs:cells.map(row=>({id:row.id,name:row.name,input:row.input,revisionKey:row.revisionKey})),runs:[],checks:[]};
    service=TheibsBrowserSolverClient.create({manifest,workerUrl:'./browser-solver-worker.js',createWorker:url=>{const worker=new Worker(url);worker.addEventListener('message',event=>{if(currentStarted!==null)workerMessages.push({type:event.data?.type,observedMs:performance.now()-currentStarted});});return worker;}});
    // The native matrix above owns exactly four cold + four warm samples.
    // This separate preview renders the real runner/UI with retained snapshots;
    // it does not add another solver computation or claim production auth.
    const retainedJobs=new Map();
    runner=TheibsSolverStudyRunner.create({start:async(input,settings)=>{
      const entry=[...records.values()].find(row=>JSON.stringify([row.input.ranges,row.input.sizing])===JSON.stringify([input.ranges,input.sizing]));
      if(!entry)throw Error('The retained public scenario is unavailable.');
      const id=crypto.randomUUID(),job={jobId:id,handId:settings.handId,revisionKey:settings.revisionKey,phase:'COMPLETE',updateVersion:1,
        result:clone(entry.result),timing:clone(entry.timing),cache:clone(entry.cache),buildFingerprint:manifest.buildFingerprint};
      retainedJobs.set(id,job);await new Promise(resolve=>setTimeout(resolve,300));return clone(job);
    },wait:id=>Promise.resolve(clone(retainedJobs.get(id))),cancel:id=>{
      const job=retainedJobs.get(id);if(job)job.phase='CANCELLED';return Promise.resolve(clone(job));
    },isCurrent:binding=>binding.token===String(bindingToken),onUpdate:comparisonRender});
    $('matrix').disabled=false;$('matrix').onclick=matrix;$('compare').onclick=retainedComparison;
    $('status').textContent='Ready. Run the matrix once, and type or tap while it computes.';render();
  }).catch(error=>{$('status').textContent=error.message;});
})();
