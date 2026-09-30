(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const runButton = $('run'), stopButton = $('stop'), exportButton = $('export');
  const terminal = new Set(['COMPLETE','UNSUPPORTED','FAILED','CANCELLED']);
  const allowed = new Set(['/solver-validation-fixtures.json','/api/public-config','/api/access','/api/multiway/state','/api/multiway/solver/start','/api/multiway/solver/cancel']);
  let manager = null, report = null, stopped = false, running = false, pollAbort = null;
  const owned = new Set();
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const clone = value => JSON.parse(JSON.stringify(value));

  function route(path) {
    const url = new URL(path, location.href);
    if (url.origin !== location.origin || (!allowed.has(url.pathname) && !/^\/api\/multiway\/solver\/jobs\/[\w-]+$/.test(url.pathname))) throw Error('A validation route was refused.');
    return url.pathname;
  }
  function status(message) { $('status').textContent = message; }
  function check(label, passed, detail = '') {
    const outcome = passed === null ? 'INFO' : passed ? 'PASS' : 'FAIL';
    report.checks.push({label,outcome,detail});
    render();
    return Boolean(passed);
  }
  function render() {
    if (!report) return;
    const counts = Object.fromEntries(['PASS','FAIL','INFO'].map(key => [key,report.checks.filter(item => item.outcome === key).length]));
    $('counter').textContent = `${counts.PASS} passed · ${counts.FAIL} failed · ${counts.INFO} noted`;
    $('summary').replaceChildren(...[
      ['Scenarios',`${report.scenarios.length}/3`],['Variants',String(report.scenarios.reduce((n,item) => n+item.variants.length,0))],
      ['Passed',String(counts.PASS)],['Failed',String(counts.FAIL)],['Cache changes',String(report.invalidation.length)]
    ].map(([label,value]) => { const node=document.createElement('div');node.className='metric';const strong=document.createElement('strong');strong.textContent=value;const small=document.createElement('small');small.textContent=label;node.append(strong,small);return node; }));
    $('checks').replaceChildren(...report.checks.map(item => { const li=document.createElement('li');li.className=item.outcome.toLowerCase();const span=document.createElement('span');span.textContent=item.label;if(item.detail){const small=document.createElement('small');small.textContent=item.detail;span.append(small);}li.append(span);return li; }));
    $('report-json').textContent=JSON.stringify(report,null,2);
    exportButton.disabled=false;
  }
  async function jsonRequest(path, options = {}, authenticated = true) {
    const target = route(path), response = await (authenticated ? manager.request(target,options) : fetch(target,options));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(`HTTP ${response.status} at ${target.replace(/\/jobs\/.+$/,'/jobs/:id')}`);
    return data;
  }
  function post(path, body, options = {}) { return jsonRequest(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),...options}); }
  async function initialize() {
    const [fixture, publicConfig] = await Promise.all([
      jsonRequest('/solver-validation-fixtures.json',{},false),jsonRequest('/api/public-config',{},false)
    ]);
    if (!fixture?.baselineCommit || fixture.cases?.length !== 3 || fixture.cases.some(item => item.variants?.length !== 5)) throw Error('The validation fixture is incomplete.');
    if (!publicConfig?.auth || !window.TheibsAuthSession) throw Error('Authentication configuration is unavailable.');
    report.authenticationRequired=publicConfig.auth.required!==false;
    const nativeFetch = window.fetch.bind(window);
    const withLock = navigator.locks?.request ? (task,options) => navigator.locks.request('theibs-auth-refresh-v1',{mode:'exclusive',signal:options.signal},task) : null;
    manager = window.TheibsAuthSession.create({config:publicConfig.auth,fetch:nativeFetch,storage:localStorage,baseUrl:location.href,withLock});
    manager.load();
    const response = await jsonRequest('/api/access');
    if (response.access?.allowed !== true) throw Error('Sign in with active access before running validation.');
    return fixture;
  }
  function identity(data, variant) {
    if (data?.revisionKey !== variant.expectedRevisionKey || data.handId !== variant.input.multiway.handId || typeof data.jobId !== 'string') throw Error('The solver returned a different synthetic decision.');
  }
  function safeResult(result) {
    if (!result) return null;
    const precision = result.decisionPrecision || {}, cert = result.actionPrecision || {};
    return {status:result.status,source:result.source,method:result.method,solverVersion:result.solverVersion,
      actions:(result.actions || []).map(({id,action,size,frequency,evBB}) => ({id,action,size,frequency,evBB})),
      convergence:result.convergence ? {exact:result.convergence.exact,nashConv:result.convergence.nashConv,thresholdMet:result.convergence.thresholdMet} : null,
      qualification:result.qualification ? {solvedSubgame:result.qualification.solvedSubgame,strategyFrequenciesSupported:result.qualification.strategyFrequenciesSupported} : null,
      comparison:{status:precision.status,reasonCode:precision.reasonCode,bestActionId:precision.bestActionId,leaderConclusive:precision.leaderConclusive,globalBestSupported:precision.globalBestSupported,
        bestBoundsBB:precision.bestBoundsBB,strongestAlternativeUpperBB:precision.strongestAlternativeUpperBB,separationToleranceBB:precision.separationToleranceBB},
      actionBounds:(cert.actions || []).map(({id,certified,estimateBB,lowerBB,upperBB}) => ({id,certified,estimateBB,lowerBB,upperBB})),
      iterations:result.iterations ?? null,
      resourceUse:{heapUsedBytes:result.metrics?.heapUsedBytes ?? null,workerMs:result.metrics?.workerMs ?? null,
        costs:result.metrics?.costs || null,runCosts:result.metrics?.runCosts || null,
        workIterations:result.adaptation?.workIterations ?? null,globalIterations:result.adaptation?.globalIterations ?? null,
        actionIterations:result.adaptation?.actionIterations ?? null,resourceCeiling:result.adaptation?.resourceCeiling || null},
      refinementRecommended:result.adaptation?.refinementRecommended ?? null};
  }
  function envelope(data, wall) {
    return {phase:data.phase,budget:data.budget,cacheHit:data.cache?.hit === true,
      elapsedMs:wall,serverAcknowledgementMs:data.timing?.acknowledgementMs ?? null,
      serverFirstValueMs:data.timing?.firstValueMs ?? null,serverCompletionMs:data.timing?.completionMs ?? null,
      serverAgeMsAtObservation:data.timing?.totalMs ?? null,
      workerMs:data.timing?.workerMs ?? null,decisionComputeMs:data.timing?.decisionComputeMs ?? null,
      decisionWorkIterations:data.timing?.decisionWorkIterations ?? null,
      limits:data.limits ? {maxNodes:data.limits.maxNodes,maxWorlds:data.limits.maxWorlds,maxMemoryBytes:data.limits.maxMemoryBytes,maxBuildMs:data.limits.maxBuildMs} : null,
      result:safeResult(data.result)};
  }
  async function start(variant,budget) {
    if (stopped) throw Error('Validation stopped.');
    const begun=performance.now();
    const data=await post('/api/multiway/solver/start',{...variant.input,expectedRevisionKey:variant.expectedRevisionKey,budget});
    identity(data,variant);owned.add(data.jobId);
    return {data,begun,ackWallMs:Math.round(performance.now()-begun)};
  }
  async function cancel(jobId) {
    if (!jobId || !manager) return null;
    try {const data=await post('/api/multiway/solver/cancel',{jobId},{keepalive:true});owned.delete(jobId);return data;}
    catch {return null;}
  }
  async function cancelOwned() { await Promise.allSettled([...owned].map(cancel)); }
  async function complete(variant,budget,label,{autoCancel=false}={}) {
    status(label);
    const {data:first,begun,ackWallMs}=await start(variant,budget);
    let latest=first,firstObservedMs=first.result?.actions?.length ? ackWallMs : null,observations=1;
    if (autoCancel && !terminal.has(first.phase)) {
      const cancelled=await cancel(first.jobId);
      if (cancelled) latest=cancelled;
    }
    while (!terminal.has(latest.phase) && !stopped) {
      await delay(350);
      if (stopped) break;
      pollAbort=new AbortController();
      try {latest=await jsonRequest(`/api/multiway/solver/jobs/${encodeURIComponent(first.jobId)}`,{signal:pollAbort.signal});}
      finally {pollAbort=null;}
      identity(latest,variant);observations++;
      if (firstObservedMs===null && latest.result?.actions?.length) firstObservedMs=Math.round(performance.now()-begun);
      if (performance.now()-begun>45000) {await cancel(first.jobId);throw Error(`The ${budget} solver job exceeded the validation wait ceiling.`);}
    }
    if (stopped) {await cancel(first.jobId);throw Error('Validation stopped.');}
    if (!terminal.has(first.phase) && latest.phase==='CANCELLED') owned.delete(first.jobId);
    if (terminal.has(latest.phase)) owned.delete(first.jobId);
    const fullWallMs=Math.round(performance.now()-begun);
    return {data:latest,ackData:first,summary:{...envelope(latest,fullWallMs),ackWallMs,firstObservedMs,pollObservations:observations,
      terminal:terminal.has(latest.phase)}};
  }
  function refineNeeded(data) {
    const budgetBeforeFirst=data.phase==='UNSUPPORTED' && data.result?.reasons?.some(reason => reason.code==='BUDGET_BEFORE_FIRST_STRATEGY');
    const recommended=data.result?.adaptation ? data.result.adaptation.refinementRecommended === true : data.result?.convergence?.thresholdMet !== true;
    return Boolean((data.phase==='COMPLETE' && data.result?.actions?.length || budgetBeforeFirst) && (budgetBeforeFirst || recommended));
  }
  async function digest(value) {
    const bytes=new TextEncoder().encode(JSON.stringify(value));
    const hash=await crypto.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2,'0')).join('');
  }
  function verifyMath(result,expectation) {
    const issues=[],actions=result?.actions || [],roots=result?.abstraction?.rootActions || [],certificate=result?.actionPrecision || {},cert=certificate.actions || [],precision=result?.decisionPrecision || {};
    if (!actions.length || new Set(actions.map(item => item.id)).size !== actions.length || actions.some(item => !finite(item.frequency) || item.frequency<0 || item.frequency>1 || !finite(item.evBB)) || Math.abs(actions.reduce((n,item) => n+item.frequency,0)-1)>1e-6) issues.push('Invalid or incomplete profile action table.');
    if (!cert.length || new Set(cert.map(item => item.id)).size !== cert.length || cert.length !== actions.length || cert.some(item => !actions.some(action => action.id===item.id))) issues.push('Certificate alternatives do not match all root actions.');
    if (roots.length!==actions.length || roots.some(root => !actions.some(action => action.id===root.id && action.action===root.action && action.size===root.size))) issues.push('Returned actions differ from the legal root abstraction.');
    for (const item of cert) {
      if (item.baseGameHash!==certificate.baseGameHash || item.baseContextKey!==certificate.baseContextKey || item.solverVersion!==result.solverVersion || item.target!==certificate.target || item.utility?.unit!=='BB' || item.utility?.scope!=='FULL_PRIOR_EX_ANTE') issues.push(`Certificate context differs for ${item.id}.`);
      if (item.certified===true && (!finite(item.lowerBB) || !finite(item.estimateBB) || !finite(item.upperBB) || item.lowerBB>item.estimateBB+1e-9 || item.estimateBB>item.upperBB+1e-9 || item.rootActionFixed!==item.id || item.conditionedHash!==item.gameHash)) issues.push(`Invalid certified bounds for ${item.id}.`);
    }
    if (precision.status==='CONCLUSIVE') {
      const leader=cert.find(item => item.id===precision.bestActionId),others=cert.filter(item => item.id!==precision.bestActionId),tolerance=precision.separationToleranceBB || 0;
      if (!leader?.certified || others.length!==cert.length-1 || others.some(item => !item.certified || !(leader.lowerBB>item.upperBB+tolerance))) issues.push('A conclusive leader does not dominate every certified alternative.');
      if (precision.leaderConclusive!==true || precision.globalBestSupported!==false) issues.push('Conclusive scope flags are inconsistent.');
    }
    if (expectation?.requireOverlap) {
      const sorted=cert.filter(item=>item.certified).sort((a,b)=>b.estimateBB-a.estimateBB);
      if (precision.status!=='INCONCLUSIVE' || sorted.length<2 || sorted[0].lowerBB>sorted[1].upperBB+(precision.separationToleranceBB||0)) issues.push('The required overlapping bounds were not observed.');
    }
    for (const [id,value] of Object.entries(expectation?.actionValues || {})) {
      const row=cert.find(item=>item.id===id);
      if (!row?.certified || !finite(row.lowerBB) || !finite(row.upperBB) || value<row.lowerBB-1e-7 || value>row.upperBB+1e-7) issues.push(`Independent value for ${id} is outside the certified interval.`);
    }
    if (expectation?.comparisonStatus && precision.status!==expectation.comparisonStatus) issues.push(`Comparison is ${precision.status || 'missing'}; expected ${expectation.comparisonStatus}.`);
    if (expectation?.bestActionId && precision.bestActionId!==expectation.bestActionId) issues.push(`Leader differs from ${expectation.bestActionId}.`);
    if (expectation?.globalStatus && result?.status!==expectation.globalStatus) issues.push(`Solver status is ${result?.status || 'missing'}; expected ${expectation.globalStatus}.`);
    return issues;
  }
  async function scenario(item) {
    const entry={id:item.id,label:item.label,expectation:item.expectation,variants:[],warm:[]};report.scenarios.push(entry);render();
    for (const [index,variant] of item.variants.entries()) {
      const cold=await complete(variant,'FAST',`${item.label || item.id} · cold ${index+1}/5`);
      const detail={id:variant.id,fast:cold.summary,standard:null,assertions:[]};entry.variants.push(detail);render();
      let final=cold.data;
      let finalBudget='FAST';
      if (refineNeeded(cold.data)) {
        const standard=await complete(variant,'STANDARD',`${item.label || item.id} · standard ${index+1}/5`);
        detail.standard=standard.summary;final=standard.data;finalBudget='STANDARD';
      }
      // FAST returns the completed certified snapshot already stored under the
      // same game key. STANDARD intentionally resumes work and is not a pure
      // warm-cache read, even when the cold result used STANDARD refinement.
      const warm=await complete(variant,'FAST',`${item.label || item.id} · certified warm ${index+1}/5`);
      const coldHash=final.result ? await digest(final.result) : null;
      const cachedHash=warm.ackData.result ? await digest(warm.ackData.result) : null;
      const terminalHash=warm.data.result ? await digest(warm.data.result) : null;
      detail.warm={...warm.summary,finalColdBudget:finalBudget,warmBudget:'FAST',coldResultDigest:coldHash,cachedSnapshotDigest:cachedHash,warmTerminalDigest:terminalHash,
        cachedSnapshotMatches:!!coldHash && coldHash===cachedHash,terminalResultMatches:!!coldHash && coldHash===terminalHash};
      entry.warm.push({id:variant.id,finalColdBudget:finalBudget,warmBudget:'FAST',cacheHit:warm.ackData.cache?.hit===true,elapsedMs:warm.summary.elapsedMs,
        cachedSnapshotMatches:detail.warm.cachedSnapshotMatches,terminalResultMatches:detail.warm.terminalResultMatches});
      check(`${item.id} / ${variant.id}: certified warm cache`,warm.ackData.cache?.hit===true && detail.warm.cachedSnapshotMatches && detail.warm.terminalResultMatches,
        `Cold ${finalBudget}, warm FAST; cache hit ${warm.ackData.cache?.hit===true}; cached digest ${detail.warm.cachedSnapshotMatches?'matches':'differs'}; terminal digest ${detail.warm.terminalResultMatches?'matches':'differs'}.`);
      const issues=verifyMath(final.result,item.expectation);
      if (final.phase!=='COMPLETE') issues.push(`Terminal phase ${final.phase}.`);
      detail.assertions=issues;
      check(`${item.id} / ${variant.id}: result and bounds`,issues.length===0,
        issues.length ? issues.join(' ') : `${final.result?.status}; ${final.result?.decisionPrecision?.status}; ${final.result?.actions?.length || 0} actions.`);
      render();
    }
    const warmTimes=entry.warm.map(item=>item.elapsedMs).sort((a,b)=>a-b);
    entry.warmStats={count:warmTimes.length,p50Ms:warmTimes[Math.ceil(warmTimes.length*.5)-1],
      p95Ms:warmTimes[Math.ceil(warmTimes.length*.95)-1],minMs:warmTimes[0],maxMs:warmTimes.at(-1),
      allCacheHits:entry.warm.every(item=>item.cacheHit),allDigestsMatch:entry.warm.every(item=>item.cachedSnapshotMatches && item.terminalResultMatches)};
    render();
  }
  async function invalidation(fixture) {
    const base=await complete(fixture.invalidation[0].base,'FAST','Cache invalidation · base');
    report.invalidationBase=base.summary;
    for (const item of fixture.invalidation) {
      status(`Cache invalidation · ${item.id}`);
      const {data,begun,ackWallMs}=await start(item.changed,'FAST');
      const summary={id:item.id,expected:item.expected,...envelope(data,Math.round(performance.now()-begun)),ackWallMs};
      report.invalidation.push(summary);
      check(`Cache invalidation / ${item.id}`,data.cache?.hit===false,`Actual cache hit ${data.cache?.hit===true}; expected cache miss.`);
      if (!terminal.has(data.phase)) await cancel(data.jobId);else owned.delete(data.jobId);
    }
  }
  async function cancellation(fixture) {
    const obsolete=fixture.cancellation.obsolete,replacement=fixture.cancellation.replacement;
    status('Cancellation · supersede an obsolete decision');
    const first=await start(obsolete,'DEEP');
    const next=await complete(replacement,'FAST','Cancellation · replacement decision');
    const old=await jsonRequest(`/api/multiway/solver/jobs/${encodeURIComponent(first.data.jobId)}`);
    identity(old,obsolete);owned.delete(first.data.jobId);
    const observed=first.data.phase!=='COMPLETE';
    const superseded=observed && old.phase==='CANCELLED' && next.data.phase==='COMPLETE' && next.data.revisionKey===replacement.expectedRevisionKey && next.data.handId===replacement.input.multiway.handId && next.data.result?.gameHash!==first.data.result?.gameHash;
    report.cancellation={supersede:{obsoleteInitialPhase:first.data.phase,obsoleteFinalPhase:old.phase,replacement:next.summary,observed,superseded},explicit:null};
    check('Superseded decision cancellation',observed ? superseded : null,observed ? `Old ${old.phase}; replacement ${next.data.phase}; no old state rendered.` : 'Old job completed before replacement; cancellation was not observable.');

    // A fresh synthetic hand gives the explicit cancellation its own decision identity.
    const fresh=clone(obsolete);fresh.input.multiway.handId=crypto.randomUUID();
    const observedState=await post('/api/multiway/state',{multiway:fresh.input.multiway});
    fresh.expectedRevisionKey=observedState.state?.revisionKey;
    if (typeof fresh.expectedRevisionKey!=='string') throw Error('Could not prepare a fresh synthetic cancellation state.');
    const explicit=await start(fresh,'DEEP');
    const cancelled=await cancel(explicit.data.jobId);
    const final=await jsonRequest(`/api/multiway/solver/jobs/${encodeURIComponent(explicit.data.jobId)}`);
    identity(final,fresh);
    const explicitObserved=explicit.data.phase!=='COMPLETE';
    report.cancellation.explicit={initialPhase:explicit.data.phase,cancelResponsePhase:cancelled?.phase || null,finalPhase:final.phase,observed:explicitObserved};
    check('Explicit job cancellation',explicitObserved ? cancelled?.phase==='CANCELLED' && final.phase==='CANCELLED' : null,
      explicitObserved ? `Cancel response ${cancelled?.phase || 'unavailable'}; final ${final.phase}.` : 'Fresh job completed before cancellation; cancellation was not observable.');
  }
  async function execute() {
    if (running) return;
    running=true;stopped=false;runButton.disabled=true;stopButton.disabled=false;exportButton.disabled=true;
    report={schemaVersion:1,origin:location.origin,environment:location.hostname==='127.0.0.1'||location.hostname==='localhost'?'LOCAL':'LIVE',
      startedAt:new Date().toISOString(),completedAt:null,baselineCommit:null,fixtureGeneratedAt:null,authenticationRequired:null,status:'RUNNING',
      checks:[],scenarios:[],invalidationBase:null,invalidation:[],cancellation:null,
      scope:{mode:'ISOLATED_SOLVER_API_WITH_EXISTING_ACCESS_CONTROLLER',syntheticFixtures:true,workspaceMutation:false,historyMutation:false,
        pollingMs:350,actionValueReference:'CERTIFIED_INTERVAL_CONTAINMENT_1E-7',warmDigest:'SHA256_COMPLETE_SERVER_RESULT',
        dynamicVersionOrUtilityMutation:'NOT_EXERCISED_BY_LIVE_API',warmRead:'FAST_CACHE_LOOKUP_AFTER_FINAL_CERTIFIED_FAST_OR_STANDARD'}};
    render();
    try {
      status('Checking access and synthetic fixtures…');
      const fixture=await initialize();report.baselineCommit=fixture.baselineCommit;report.fixtureGeneratedAt=fixture.generatedAt;
      check('Access gate',true,report.authenticationRequired?'The existing signed-in session and /api/access allowed the run.':'Local authentication is disabled; /api/access allowed the run.');
      for (const item of fixture.cases) await scenario(item);
      await invalidation(fixture);
      await cancellation(fixture);
      report.status=report.checks.some(item=>item.outcome==='FAIL')?'FAIL':'PASS';
      status(report.status==='PASS'?'Validation completed with no failed checks.':'Validation completed with failed checks. Review the report.');
    } catch (error) {
      report.status=stopped?'STOPPED':'ERROR';
      check(stopped?'Run stopped':'Validation could not complete',stopped?null:false,stopped?'Owned solver jobs were cancelled.':String(error?.message || 'Unexpected error.').slice(0,180));
      status(stopped?'Stopped. Owned jobs were cancelled.':'Validation stopped after an error. Review the report.');
    } finally {
      await cancelOwned();manager?.dispose();manager=null;
      report.completedAt=new Date().toISOString();render();
      running=false;runButton.disabled=false;stopButton.disabled=true;
    }
  }
  runButton.addEventListener('click',()=>{void execute();});
  stopButton.addEventListener('click',()=>{stopped=true;pollAbort?.abort();status('Stopping and cancelling owned jobs…');void cancelOwned();});
  exportButton.addEventListener('click',()=>{
    if (!report) return;
    const label=report.environment.toLowerCase(),utc=new Date().toISOString().replace(/[:.]/g,'-');
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=`theibs-solver-validation-${label}-${utc}.json`;anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  addEventListener('pagehide',()=>{stopped=true;pollAbort?.abort();void cancelOwned();manager?.dispose();});
})();
