(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TheibsBrowserSolverClient = api;
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  'use strict';
  const SCHEMA_VERSION = 1, VERSION = 'THEIBS_BROWSER_SOLVER_CLIENT_V1';
  const BUDGETS = Object.freeze({ FAST: Object.freeze({timeMs:500,iterations:50}),
    STANDARD: Object.freeze({timeMs:3000,iterations:1000}), DEEP: Object.freeze({timeMs:30000,iterations:20000}) });
  const END_PHASES = new Set(['COMPLETE','FAILED','UNSUPPORTED','CANCELLED']);
  const REUSABLE_STOPS = new Set(['GLOBAL_CONVERGENCE_AND_CERTIFIED_SEPARATION','FIXED_CONTINUATIONS_FULLY_EVALUATED','GLOBAL_CONVERGENCE_ACTION_CERTIFICATES_NOT_COVERED']);
  const clone = value => value == null ? value : typeof root.structuredClone === 'function' ? root.structuredClone(value) : JSON.parse(JSON.stringify(value));
  const workIterations = checkpoint => Number.isSafeInteger(checkpoint?.workIterations) ? checkpoint.workIterations : Number.isSafeInteger(checkpoint?.iterations) ? checkpoint.iterations : 0;
  function stable(value) {
    if (Array.isArray(value)) return '[' + Array.from(value,stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',') + '}';
    if (typeof value === 'number' && !Number.isFinite(value)) throw Error('Solver inputs must contain finite numbers.');
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw Error('Solver inputs contain an unsupported value.');
    return encoded;
  }
  function hasStrategy(result) {
    const rows=result?.actions, expected=result?.abstraction?.rootActions;
    return ['SOLVED','APPROXIMATE','REFINING','PARTIAL'].includes(result?.status) && Array.isArray(rows) && rows.length > 0 &&
      Array.isArray(expected) && expected.length === rows.length && new Set(rows.map(row=>row?.id)).size === rows.length &&
      rows.every(row=>typeof row?.id==='string' && expected.some(action=>action.id===row.id && action.action===row.action && action.size===row.size) &&
        Number.isFinite(row.evBB) && Number.isFinite(row.frequency) && row.frequency>=0 && row.frequency<=1) &&
      Math.abs(rows.reduce((sum,row)=>sum+row.frequency,0)-1)<=1e-8;
  }
  function create(options = {}) {
    const WorkerClass=options.Worker || root.Worker, makeWorker=options.createWorker || (url=>new WorkerClass(url));
    const crypto=options.crypto || root.crypto, Encoder=options.TextEncoder || root.TextEncoder;
    const fetchManifest=options.fetch || root.fetch?.bind(root), now=options.now || (()=>root.performance?.now?.() ?? Date.now());
    const delay=options.setTimeout || root.setTimeout.bind(root), clearDelay=options.clearTimeout || root.clearTimeout.bind(root);
    const supported=Boolean((options.createWorker || typeof WorkerClass==='function') && crypto?.subtle?.digest && Encoder && (options.manifest || fetchManifest));
    const jobs=new Map(), generations=new Map(), cache=new Map(), decisions=new Map();
    const maxEntries=16,maxBytes=32*1024*1024,maxEntryBytes=4*1024*1024,maxJobs=24;
    const profiles=Object.fromEntries(Object.entries(BUDGETS).map(([name,value])=>[name,{...value,...options.budgetProfiles?.[name]}]));
    for (const value of Object.values(profiles)) if (!Number.isFinite(value.timeMs) || value.timeMs<1 || value.timeMs>30000 ||
      !Number.isSafeInteger(value.iterations) || value.iterations<1 || value.iterations>20000) throw Error('Invalid browser solver budget profile.');
    const adaptiveCeilingMs=options.adaptiveCeilingMs ?? 5000;
    if (!Number.isFinite(adaptiveCeilingMs) || adaptiveCeilingMs<profiles.STANDARD.timeMs || adaptiveCeilingMs>30000) throw Error('Invalid adaptive browser solver ceiling.');
    const workerUrl=options.workerUrl || '/browser-solver-worker.js', manifestUrl=options.manifestUrl || '/browser-solver-manifest.json';
    let manifestPromise=null,closed=false,bytes=0,sequence=0;
    const metrics={started:0,completed:0,cancelled:0,workerErrors:0,hits:0,misses:0,writes:0,evictions:0,staleMessages:0};
    const encoder=Encoder ? new Encoder() : null;
    async function digest(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),byte=>byte.toString(16).padStart(2,'0')).join(''); }
    async function manifest() {
      if (!supported) throw Error('Browser compute is unavailable in this browser. Choose Server compute.');
      if (!manifestPromise) manifestPromise=(async()=>{
        const value=options.manifest || await (async()=>{const response=await fetchManifest(manifestUrl,{cache:'no-store',credentials:'same-origin'});if(!response.ok)throw Error('Browser solver manifest is unavailable.');return response.json();})();
        if (value?.schemaVersion!==SCHEMA_VERSION || !/^[a-f0-9]{64}$/.test(value.buildFingerprint || '') || !value.versions || typeof value.versions!=='object') throw Error('Browser solver build identity is invalid.');
        if (options.buildFingerprint && value.buildFingerprint!==options.buildFingerprint) throw Error('Browser solver build changed. Reload this page.');
        return clone(value);
      })();
      return manifestPromise;
    }
    function ownerId(owner) { if (typeof owner!=='string' || !owner.length || owner.length>240) throw Error('A current isolated solver owner is required.');return owner; }
    function stats() {return {...metrics,memoryBytes:bytes,entries:cache.size,maxBytes,active:[...jobs.values()].filter(job=>!END_PHASES.has(job.phase)).length};}
    function view(job) {
      return {status:job.result?.status || (END_PHASES.has(job.phase)?'NOT_SOLVED':'REFINING'),jobId:job.id,revisionKey:job.revisionKey,handId:job.handId,
        budget:job.budget,phase:job.phase,updateVersion:job.updateVersion,result:clone(job.result),reason:job.reason || null,runtime:'BROWSER',runtimeLabel:'Browser compute',
        buildFingerprint:job.buildFingerprint,cache:{hit:job.cacheHit,...stats()},
        timing:{acknowledgementMs:job.ackMs,firstValueMs:job.firstValueMs ?? null,completionMs:job.completionMs ?? null,totalMs:Math.max(0,Math.round(now()-job.started)),
          workerMs:job.workerMs,decisionComputeMs:job.decision.consumedMs,decisionWorkIterations:job.decision.workIterations},
        runtimeBudget:{initialMs:profiles[job.budget].timeMs,ceilingMs:job.ceilingMs,continuations:job.continuations,automatic:job.automatic},
        limits:{maxNodes:12000,maxWorlds:144,maxMemoryBytes:48*1024*1024,maxBuildMs:750}};
    }
    function changed(job) {job.updateVersion++;for(const wake of [...job.waiters])wake();options.onChange?.(view(job));}
    function setPhase(job,phase) {job.phase=phase;if(END_PHASES.has(phase) && job.completionMs==null)job.completionMs=Math.max(0,Math.round(now()-job.started));changed(job);}
    function ownerJob(owner,id) {ownerId(owner);const job=jobs.get(id);if(!job || job.owner!==owner)throw Error('Solver job was not found for this owner.');return job;}
    function current(job,slot) {return !closed && !END_PHASES.has(job.phase) && job.worker===slot && generations.get(job.owner)===job.generation;}
    function stopWorker(job) {if(job.watchdog!=null)clearDelay(job.watchdog);job.watchdog=null;const worker=job.worker;job.worker=null;if(worker){worker.onmessage=null;worker.onerror=null;worker.terminate();}}
    function account(job,reported) {
      if(!Number.isFinite(reported) || reported<0)return;
      const delta=Math.max(0,reported-job.runReportedMs);job.runReportedMs=Math.max(job.runReportedMs,reported);
      job.workerMs+=delta;job.decision.consumedMs+=delta;
    }
    function remember(job) {
      if(!job.checkpoint || !hasStrategy(job.result))return;
      const value={owner:job.owner,key:job.key,result:clone(job.result),checkpoint:clone(job.checkpoint)},size=encoder.encode(JSON.stringify(value)).byteLength;
      if(size>maxEntryBytes)return;
      const id=job.ownerHash+'.'+job.key;if(cache.has(id)){bytes-=cache.get(id).size;cache.delete(id);}
      cache.set(id,{...value,size});bytes+=size;metrics.writes++;
      while(cache.size>maxEntries || bytes>maxBytes){const first=cache.keys().next().value;bytes-=cache.get(first).size;cache.delete(first);metrics.evictions++;}
    }
    function save(job,message) {
      account(job,message.workerMs);
      if(!message.result)return;
      const usable=hasStrategy(message.result);
      if(!usable && hasStrategy(job.result))return;
      if(usable && !message.checkpoint && job.checkpoint && hasStrategy(job.result))return;
      job.result=clone(message.result);
      if(!usable){job.checkpoint=null;return;}
      if(message.checkpoint){const next=workIterations(message.checkpoint);job.decision.workIterations+=Math.max(0,next-job.lastWorkIterations);job.lastWorkIterations=next;job.checkpoint=clone(message.checkpoint);}
      else job.checkpoint=null;
      job.firstValueMs ??= Math.max(0,Math.round(now()-job.started));remember(job);
    }
    function cancelJob(job,reason='Cancelled by the user.') {
      if(END_PHASES.has(job.phase))return;
      if(job.runStarted!=null)account(job,Math.max(job.runReportedMs,now()-job.runStarted));
      stopWorker(job);job.reason=reason;metrics.cancelled++;setPhase(job,'CANCELLED');
    }
    function needsContinuation(job,hostStop=false) {
      const stopped=hostStop || ['TIME_RESOURCE_CEILING','ITERATION_RESOURCE_CEILING'].includes(job.result?.adaptation?.stopReason);
      if(!hasStrategy(job.result) || !stopped || job.result?.adaptation?.refinementRecommended!==true)return false;
      if(job.budget==='DEEP')return job.decision.consumedMs<profiles.DEEP.timeMs && job.decision.workIterations<profiles.DEEP.iterations;
      return job.budget==='STANDARD' && job.automatic && job.continuations===0 && job.decision.consumedMs<adaptiveCeilingMs;
    }
    function continueJob(job) {
      job.continuations++;if(job.budget==='STANDARD')job.ceilingMs=adaptiveCeilingMs;run(job);
    }
    function fail(job,message,code='WORKER_FAILED') {
      if(END_PHASES.has(job.phase))return;
      stopWorker(job);metrics.workerErrors++;job.reason=message || 'Browser solver unavailable.';
      // A host resource stop does not establish precision or discard a completed checkpoint.
      if(code==='TIME_BUDGET' && hasStrategy(job.result)){metrics.completed++;setPhase(job,'COMPLETE');}
      else setPhase(job,'FAILED');
    }
    function run(job) {
      if(closed || generations.get(job.owner)!==job.generation || END_PHASES.has(job.phase))return;
      const iterationsCeiling=job.budget==='STANDARD' && job.continuations ? Math.min(20000,profiles.STANDARD.iterations*2) : profiles[job.budget].iterations;
      const remaining={timeMs:Math.min(5000,Math.max(0,job.ceilingMs-job.decision.consumedMs)),iterations:Math.max(0,iterationsCeiling-job.decision.workIterations)};
      if(remaining.timeMs<=0 || remaining.iterations<=0){job.reason='Cumulative calculation budget reached; latest estimate retained.';setPhase(job,'COMPLETE');return;}
      job.runReportedMs=0;job.runStarted=null;setPhase(job,'BUILDING');
      let worker;
      try{worker=makeWorker(workerUrl);job.worker=worker;}catch(error){fail(job,error.message);return;}
      const handshake=delay(()=>{if(current(job,worker))fail(job,'Browser solver initialization timed out. Reload or choose Server compute.');},3000);
      job.watchdog=handshake;
      worker.onerror=event=>{if(current(job,worker)){if(job.runStarted!=null)account(job,now()-job.runStarted);fail(job,event.message || 'Browser solver worker stopped.');}};
      worker.onmessage=event=>{
        const message=event.data;
        if(!current(job,worker)){metrics.staleMessages++;return;}
        if(message?.type==='ready'){
          if(message.schemaVersion!==SCHEMA_VERSION || message.buildFingerprint!==job.buildFingerprint){fail(job,'Browser solver build changed. Reload this page.');return;}
          clearDelay(job.watchdog);job.runStarted=now();
          job.watchdog=delay(()=>{
            if(!current(job,worker))return;account(job,now()-job.runStarted);stopWorker(job);
            if(needsContinuation(job,true)){continueJob(job);}
            else {job.reason='Browser compute time limit reached; latest completed estimate retained.';if(hasStrategy(job.result)){metrics.completed++;setPhase(job,'COMPLETE');}else setPhase(job,'UNSUPPORTED');}
          },remaining.timeMs+1000);
          worker.postMessage({type:'solve',jobId:job.id,generation:job.generation,input:clone(job.input),budget:remaining,checkpoint:clone(job.checkpoint),
            expectedRevisionKey:job.revisionKey,expectedBuildFingerprint:job.buildFingerprint});
          return;
        }
        if(message?.jobId!==job.id || message.generation!==job.generation || message.buildFingerprint!==job.buildFingerprint){metrics.staleMessages++;return;}
        if(message.type==='error'){account(job,message.workerMs);fail(job,message.error,message.code);return;}
        if(message.handId!==job.handId || message.revisionKey!==job.revisionKey){fail(job,'Browser solver response does not match this decision.');return;}
        if(message.type!=='progress' && message.type!=='done')return;
        save(job,message);
        if(message.type==='progress'){job.phase='REFINING';changed(job);return;}
        stopWorker(job);
        if(needsContinuation(job)){continueJob(job);return;}
        metrics.completed++;setPhase(job,job.result?.status==='NOT_SOLVED'?'UNSUPPORTED':'COMPLETE');
      };
    }
    async function start(owner,input,{budget='STANDARD',revisionKey,handId,automatic=false}={}) {
      ownerId(owner);if(closed)throw Error('Browser solver service is closed.');if(!profiles[budget])throw Error('Choose FAST, STANDARD or DEEP.');
      if(typeof revisionKey!=='string' || !revisionKey || typeof handId!=='string' || !handId || input?.multiway?.handId!==handId)throw Error('A current hand and decision revision are required.');
      const detached=clone({multiway:input.multiway,ranges:input.ranges,sizing:input.sizing,rake:input.rake});
      const exactInput=stable(detached),started=now();
      const duplicate=[...jobs.values()].find(job=>job.owner===owner && job.exactInput===exactInput && job.revisionKey===revisionKey && job.handId===handId &&
        job.budget===budget && !END_PHASES.has(job.phase));
      if(duplicate)return view(duplicate);
      const generation=(generations.get(owner)||0)+1;generations.set(owner,generation);
      for(const previous of jobs.values())if(previous.owner===owner && !END_PHASES.has(previous.phase))cancelJob(previous,'Superseded by the current decision.');
      const build=await manifest(),ownerHash=await digest(owner),key=await digest(stable({schemaVersion:SCHEMA_VERSION,clientVersion:VERSION,
        buildFingerprint:build.buildFingerprint,versions:build.versions,handId,revisionKey,input:detached}));
      if(closed || generations.get(owner)!==generation)throw Error('The browser solver request was superseded.');
      while(jobs.size>=maxJobs){const old=[...jobs.values()].find(job=>END_PHASES.has(job.phase));if(!old)throw Error('Browser solver queue is full.');jobs.delete(old.id);}
      const cacheId=ownerHash+'.'+key,found=cache.get(cacheId);
      if(found){cache.delete(cacheId);cache.set(cacheId,found);metrics.hits++;}else metrics.misses++;
      const decisionKey=ownerHash+'.'+key+'.'+revisionKey+'.'+handId;
      let decision=decisions.get(decisionKey);if(!decision){decision={owner,consumedMs:0,workIterations:0};decisions.set(decisionKey,decision);}
      while(decisions.size>maxJobs*2){const old=[...decisions.keys()].find(id=>![...jobs.values()].some(job=>job.decisionKey===id && !END_PHASES.has(job.phase)));if(!old)break;decisions.delete(old);}
      const reusable=automatic && hasStrategy(found?.result) && found.result.adaptation?.phase==='STOPPED' && found.result.adaptation.refinementRecommended===false && REUSABLE_STOPS.has(found.result.adaptation.stopReason);
      const job={id:crypto.randomUUID?.() || `browser-${Date.now()}-${++sequence}`,owner,ownerHash,key,exactInput,input:detached,generation,handId,revisionKey,budget,automatic:automatic===true,
        decisionKey,decision,started,ackMs:Math.max(0,Math.round(now()-started)),buildFingerprint:build.buildFingerprint,ceilingMs:profiles[budget].timeMs,continuations:0,
        result:clone(found?.result || null),checkpoint:clone(found?.checkpoint || null),lastWorkIterations:workIterations(found?.checkpoint),cacheHit:Boolean(found),workerMs:0,runReportedMs:0,
        phase:found && (budget==='FAST' || reusable)?'COMPLETE':'QUEUED',updateVersion:0,waiters:new Set(),worker:null,watchdog:null};
      if(found)job.firstValueMs=job.ackMs;jobs.set(job.id,job);metrics.started++;changed(job);
      if(job.phase==='COMPLETE')setPhase(job,'COMPLETE');else run(job);
      return view(job);
    }
    async function wait(owner,id,{afterVersion=0,waitMs=1000,signal}={}) {
      const job=ownerJob(owner,id);if(!Number.isSafeInteger(afterVersion) || afterVersion<0 || !Number.isFinite(waitMs) || waitMs<0)throw Error('Use a valid solver update version and wait duration.');
      const abortError=()=>Object.assign(Error('Solver status request cancelled.'),{name:'AbortError'});
      if(signal?.aborted)throw abortError();
      if(job.updateVersion>afterVersion || END_PHASES.has(job.phase) || !waitMs)return view(job);
      if(job.waiters.size>=8)throw Error('Too many pending browser solver status requests.');
      await new Promise((resolve,reject)=>{
        const finish=()=>{clearDelay(timer);job.waiters.delete(wake);signal?.removeEventListener('abort',abort);};
        const wake=()=>{finish();resolve();},abort=()=>{finish();reject(abortError());};
        const timer=delay(wake,Math.min(1000,Math.floor(waitMs)));job.waiters.add(wake);signal?.addEventListener('abort',abort,{once:true});
      });
      return view(job);
    }
    function cancel(owner,id) {const job=ownerJob(owner,id);cancelJob(job);return view(job);}
    function cancelOwner(owner) {ownerId(owner);generations.set(owner,(generations.get(owner)||0)+1);for(const job of jobs.values())if(job.owner===owner)cancelJob(job,'Solver context changed.');}
    function clearOwner(owner) {cancelOwner(owner);
      for(const [id,entry] of cache)if(entry.owner===owner){bytes-=entry.size;cache.delete(id);}for(const [id,decision] of decisions)if(decision.owner===owner)decisions.delete(id);for(const [id,job] of jobs)if(job.owner===owner)jobs.delete(id);}
    function close() {closed=true;for(const job of jobs.values())cancelJob(job,'Browser solver service closed.');cache.clear();decisions.clear();jobs.clear();generations.clear();bytes=0;}
    return {supported,ready:manifest,start,get:(owner,id)=>view(ownerJob(owner,id)),wait,cancel,cancelOwner,clearOwner,close,stats,version:VERSION,schemaVersion:SCHEMA_VERSION};
  }
  return {create,VERSION,SCHEMA_VERSION,BUDGETS,_testing:{stable,hasStrategy}};
});
