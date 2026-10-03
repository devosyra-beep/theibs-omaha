(function(root){
  'use strict';
  const LIMITS=Object.freeze({maxCacheEntries:8,maxCacheBytes:8*1024*1024,cacheTTL:60000,maxInputBytes:512000,watchdogMs:5000});
  const failure=(message,code)=>Object.assign(new Error(message),{code});
  const abortError=()=>Object.assign(new Error('The calculation was cancelled.'),{name:'AbortError',code:'ABORTED'});
  const pick=(value,keys)=>!value||typeof value!=='object'||Array.isArray(value)?value:Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
  function publicRecord(raw){
    const record=pick(raw,['schemaVersion','enabled','config','events','handId','editEpoch','sessionId','handNumber','attemptNumber','startedAt']);
    if(!record||typeof record!=='object'||Array.isArray(record))return record;
    record.config=pick(record.config,['variant','playerCount','heroPosition','startingStack','smallBlind','bigBlind','heroCards','stacks','players','stackEstimates']);
    if(Array.isArray(record.config?.players))record.config.players=record.config.players.map(player=>pick(player,['playerId','name']));
    if(Array.isArray(record.events))record.events=record.events.map(event=>pick(event,['type','actor','action','to','cards','winners','rake','eventId','originEventId']));
    return record;
  }
  function publicSnapshot(raw){
    if(raw==null)return raw;
    const snapshot=pick(raw,['schemaVersion','handId','source','players']);
    if(snapshot?.players&&typeof snapshot.players==='object')snapshot.players=Object.fromEntries(Object.entries(snapshot.players).map(([id,player])=>[id,{
      contexts:player?.contexts&&typeof player.contexts==='object'?Object.fromEntries(Object.entries(player.contexts).map(([key,cell])=>[key,pick(cell,['counts','sizingCounts'])])):player?.contexts
    }]));
    return snapshot;
  }
  function stable(value){
    if(Array.isArray(value))return '['+value.map(item=>stable(item)??'null').join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
    return JSON.stringify(value);
  }
  // Recovery compares canonical public ledgers, never timestamps or event
  // counts alone. An edit is a new branch even when it has more events.
  function extendsLedger(before,after){
    const a=publicRecord(before),b=publicRecord(after);
    if(!a || !b || !Array.isArray(a.events) || !Array.isArray(b.events) || a.events.length>b.events.length)return false;
    const {events:first,...left}=a,{events:second,...right}=b;
    return stable(left)===stable(right) && stable(first)===stable(second.slice(0,first.length));
  }
  function recoverLedger({ownerKey,workspace,revisionKey,marker,checkpoint}){
    if(!checkpoint)return {record:workspace,recovered:false};
    if(checkpoint.version!=='THEIBS_ACTIVE_LEDGER_V1' || checkpoint.ownerKey!==ownerKey || checkpoint.multiway?.handId!==workspace?.handId ||
      checkpoint.revisionKey!==checkpoint.sourceRevisionKey)throw failure('The saved hand checkpoint has a different account or identity. Saved copies were preserved.','CHECKPOINT_INVALID');
    if(!checkpoint.active)throw failure('This hand was already replaced in local storage. The older draft was preserved; review recorded hands before continuing.','CHECKPOINT_BRANCH');
    if(checkpoint.revisionKey===revisionKey)return {record:workspace,recovered:false,marker:{version:checkpoint.version,ownerKey,handId:workspace.handId,branchId:checkpoint.branchId,revisionKey}};
    if(marker && (marker.ownerKey!==ownerKey || marker.handId!==workspace.handId || marker.branchId!==checkpoint.branchId) ||
      !checkpoint.ancestorRevisionKeys?.includes(revisionKey) || !extendsLedger(workspace,checkpoint.multiway))
      throw failure('A different hand correction is saved locally. Both versions were preserved; review the draft before continuing.','CHECKPOINT_BRANCH');
    return {record:checkpoint.multiway,recovered:true,marker:{version:checkpoint.version,ownerKey,handId:workspace.handId,branchId:checkpoint.branchId,revisionKey:checkpoint.revisionKey}};
  }
  function successorCheckpoints({ownerKey,workspace,revisionKey,checkpoint,lookup}){
    if(!checkpoint || checkpoint.active)return [];
    if(checkpoint.ownerKey!==ownerKey || checkpoint.multiway?.handId!==workspace.handId ||
      !(checkpoint.revisionKey===revisionKey || checkpoint.ancestorRevisionKeys?.includes(revisionKey) && extendsLedger(workspace,checkpoint.multiway)))
      throw failure('A different saved hand branch replaced this draft. Saved copies were preserved.','CHECKPOINT_BRANCH');
    const chain=[],seen=new Set([workspace.handId]);let prior=checkpoint;
    while(!prior.active){
      const next=lookup(prior.supersededBy);
      if(!next || seen.has(next.multiway?.handId) || next.version!=='THEIBS_ACTIVE_LEDGER_V1' || next.ownerKey!==ownerKey ||
        next.previousHandId!==prior.multiway.handId || next.previousRevisionKey!==prior.revisionKey || next.sourceRevisionKey!==next.revisionKey)
        throw failure('The saved hand continuation could not be verified. Both hand copies were preserved.','CHECKPOINT_BRANCH');
      seen.add(next.multiway.handId);chain.push(next);prior=next;
    }
    return chain;
  }
  function create(options={}){
    const WorkerCtor=options.Worker||root.Worker, fetcher=options.fetch||root.fetch?.bind(root);
    const now=options.now||(()=>root.performance.now()), clock=options.clock||Date.now;
    const clone=value=>root.structuredClone(value);
    let manifest=null, manifestPromise=null, worker=null, readyPromise=null, readyCancel=null, active=null, starting=null;
    let generation=0, sequence=0, owner=null, closed=false, cacheBytes=0, workerUses=0;
    const cache=new Map();
    const supported=Boolean(WorkerCtor&&fetcher&&root.structuredClone&&root.TextEncoder&&root.performance&&root.crypto?.subtle);
    const metrics={cacheHit:0,cacheMiss:0,cancelledJobs:0,completedJobs:0,workerStarts:0};
    function clearCache(){cache.clear();cacheBytes=0;}
    function retire(){const cancelReady=readyCancel;readyCancel=null;cancelReady?.();worker?.terminate();worker=null;readyPromise=null;workerUses=0;generation++;}
    function settle(error,result){
      const job=active;if(!job)return;
      active=null;root.clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.onAbort);
      if(error)job.reject(error);else job.resolve(result);
    }
    function cancel(){if(starting){metrics.cancelledJobs++;starting.reject(abortError());starting=null;}if(active){metrics.cancelledJobs++;settle(abortError());}retire();}
    async function loadManifest(){
      if(manifest)return manifest;
      if(!manifestPromise)manifestPromise=(async()=>{
        const controller=new AbortController();let timer;
        let value;try{value=await Promise.race([(async()=>{
          let response;try{response=await fetcher('/browser-multiway-manifest.json',{cache:'no-store',signal:controller.signal});}catch{throw failure('Browser calculation runtime unavailable.','BROWSER_RUNTIME_UNAVAILABLE');}
          if(!response.ok)throw failure('Browser calculation runtime unavailable.','BROWSER_RUNTIME_UNAVAILABLE');
          try{return await response.json();}catch{throw failure('The browser calculation manifest is invalid. Refresh the app.','BUILD_MISMATCH');}
        })(),new Promise((_,reject)=>{timer=root.setTimeout(()=>{controller.abort();reject(failure('Browser calculation runtime unavailable.','BROWSER_RUNTIME_UNAVAILABLE'));},LIMITS.watchdogMs);})]);}finally{root.clearTimeout(timer);}
        if(value.schemaVersion!==1||value.runtimeVersion!=='THEIBS_BROWSER_MULTIWAY_V1'||!/^([a-f0-9]{64})$/.test(value.buildFingerprint||''))throw failure('The browser calculation build changed. Refresh the app.','BUILD_MISMATCH');
        manifest=value;return value;
      })().finally(()=>{manifestPromise=null;});
      return manifestPromise;
    }
    async function ensureWorker(){
      if(worker&&readyPromise)return readyPromise;
      const build=await loadManifest(), createdGeneration=generation;
      try{worker=new WorkerCtor('/browser-multiway-worker.js?build='+build.buildFingerprint);}catch{throw failure('Browser workers are unavailable.','BROWSER_RUNTIME_UNAVAILABLE');}
      const currentWorker=worker; metrics.workerStarts++;
      readyPromise=new Promise((resolve,reject)=>{
        let ready=false;
        const timer=root.setTimeout(()=>{if(!ready){readyCancel=null;retire();reject(failure('The browser calculation runtime did not start.','BROWSER_RUNTIME_UNAVAILABLE'));}},LIMITS.watchdogMs);
        readyCancel=()=>{root.clearTimeout(timer);if(!ready)reject(abortError());};
        currentWorker.onmessage=event=>{
          if(worker!==currentWorker||generation!==createdGeneration)return;
          const message=event.data||{};
          if(message.buildFingerprint!==build.buildFingerprint){
            root.clearTimeout(timer);settle(failure('The browser calculation build changed. Refresh the app.','BUILD_MISMATCH'));retire();
            if(!ready)reject(failure('The browser calculation build changed. Refresh the app.','BUILD_MISMATCH'));return;
          }
          if(message.type==='ready'&&!ready){ready=true;readyCancel=null;root.clearTimeout(timer);resolve();return;}
          const job=active;
          if(!job||message.jobId!==job.id||message.generation!==job.generation)return;
          if(message.type==='error'){settle(failure(message.error||'Calculation unavailable.',message.code||'BROWSER_CALCULATION_ERROR'));return;}
          if(message.type!=='done')return;
          const result=message.result;
          if(!result||typeof result!=='object'||result.engineBuild!==build.engineBuild){settle(failure('Invalid browser calculation result.','BUILD_MISMATCH'));retire();return;}
          if(job.kind==='ledger'){
            const observations=result.playerObservations || (job.operation==='observations'?result:null);
            if(message.requestFingerprint!==job.requestFingerprint || result.multiway &&
                (!result.state?.revisionKey || result.state.handId!==result.multiway.handId || !observations || observations.handId!==result.multiway.handId || observations.sourceRevisionKey!==result.state.revisionKey)){
              settle(failure('The captured hand identity changed.','STALE_RESULT'));retire();return;
            }
            result.captureTiming={elapsedMs:now()-job.started,startupMs:job.startupMs,runtime:'BROWSER_LEDGER_WORKER'};
            workerUses++;metrics.completedJobs++;settle(null,result);return;
          }
          if(message.requestFingerprint!==job.requestFingerprint||result.observedState?.handId!==job.handId||
              !result.observedState?.revisionKey||
              (job.revisionKey&&result.observedState.revisionKey!==job.revisionKey)||
              (result.multiwayEvaluation&&result.multiwayEvaluation.revisionKey!==result.observedState.revisionKey)){
            settle(failure('The calculation decision changed.','STALE_RESULT'));retire();return;
          }
          const reused=workerUses++>0, elapsed=now()-job.started;
          result.performance={...result.performance,requestElapsedMs:elapsed,runtimeStartupMs:job.startupMs,workerReused:reused,
            cacheHit:false,buildFingerprint:build.buildFingerprint,origin:'BROWSER_WEB_WORKER',
            cancelledJobs:metrics.cancelledJobs,measurementScope:'THIS_DEVICE_REQUEST_INCLUDING_STARTUP'};
          const complete=result.status==='OK'&&result.multiwayEvaluation?.samples>0&&result.multiwayEvaluation?.stopReason!=='TIME_BUDGET'&&result.refinement?.status!=='TIME_BUDGET';
          if(complete){
            const copy=clone(result), bytes=new root.TextEncoder().encode(JSON.stringify(copy)).length+new root.TextEncoder().encode(job.key).length;
            if(bytes<=LIMITS.maxCacheBytes){
              while(cache.size&&(cache.size>=LIMITS.maxCacheEntries||cacheBytes+bytes>LIMITS.maxCacheBytes)){
                const first=cache.keys().next().value;cacheBytes-=cache.get(first).bytes;cache.delete(first);
              }
              cache.set(job.key,{result:copy,bytes,createdAt:clock()});cacheBytes+=bytes;
            }
          }
          metrics.completedJobs++;settle(null,result);
        };
        currentWorker.onerror=()=>{root.clearTimeout(timer);readyCancel=null;settle(failure('Browser calculation failed.','WORKER_FAILED'));retire();if(!ready)reject(failure('The browser calculation runtime failed.','BROWSER_RUNTIME_UNAVAILABLE'));};
      });
      return readyPromise;
    }
    async function operate(operation,payload,{signal,owner:requestOwner}={}){
      if(closed)throw failure('The browser ledger client is closed.','CLIENT_CLOSED');
      if(!supported)throw failure('Browser workers are unavailable.','BROWSER_RUNTIME_UNAVAILABLE');
      if(signal?.aborted)throw abortError();
      if(typeof requestOwner!=='string'||!requestOwner||requestOwner.length>256)throw failure('Choose the signed-in workspace owner.','OWNER_REQUIRED');
      const allowed=['start','state','step','undo','review-action','correct-action','adjust-stack','correct-button','restart-hand','next-hand','preview-sequence','batch','observations'];
      if(!allowed.includes(operation))throw failure('Invalid ledger operation.','INVALID_INPUT');
      if(active||starting)throw failure('Wait for the current captured action.','LEDGER_BUSY');
      if(owner!==requestOwner){cancel();clearCache();owner=requestOwner;}
      const input=clone(pick(payload,['multiway','previousMultiway','config','event','expectedRevision','expectedRevisionKey','selection','change','options','commands','originEventId','expectedPreviewKey']));
      for(const key of ['multiway','previousMultiway'])if(input[key])input[key]=publicRecord(input[key]);
      if(input.config)input.config=publicRecord({config:input.config}).config;
      if(input.event)input.event=publicRecord({events:[input.event]}).events[0];
      if(input.change)input.change=pick(input.change,['eventId','eventIndex','actor','action','to','stack','buttonId','expectedRevisionKey']);
      if(input.selection)input.selection=pick(input.selection,['eventId','eventIndex']);
      if(input.options){input.options=pick(input.options,['config','stacks','originEventId']);if(input.options.config)input.options.config=publicRecord({config:input.options.config}).config;}
      const serialized=JSON.stringify({operation,payload:input});
      if(new root.TextEncoder().encode(serialized).length>LIMITS.maxInputBytes)throw failure('Captured hand input is too large.','INVALID_INPUT');
      const started=now(),startGeneration=generation;let cancelledStart;
      const cancelled=new Promise((_,reject)=>{cancelledStart={reject};});starting=cancelledStart;
      const onAbort=()=>{if(starting===cancelledStart)cancel();};signal?.addEventListener('abort',onAbort,{once:true});
      let requestFingerprint;
      try{
        await Promise.race([(async()=>{
          await loadManifest();
          if(signal?.aborted||owner!==requestOwner||generation!==startGeneration||closed)throw abortError();
          const digest=await root.crypto.subtle.digest('SHA-256',new root.TextEncoder().encode(serialized));
          requestFingerprint=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
          if(signal?.aborted||owner!==requestOwner||generation!==startGeneration||closed)throw abortError();
          await ensureWorker();
        })(),cancelled]);
      }finally{signal?.removeEventListener('abort',onAbort);if(starting===cancelledStart)starting=null;}
      if(signal?.aborted||owner!==requestOwner||generation!==startGeneration||closed)throw abortError();
      return new Promise((resolve,reject)=>{
        const job={kind:'ledger',operation,id:'ledger-'+(++sequence),generation,started,startupMs:now()-started,requestFingerprint,signal,resolve,reject};
        job.onAbort=()=>{if(active===job)cancel();};active=job;signal?.addEventListener('abort',job.onAbort,{once:true});
        job.timer=root.setTimeout(()=>{if(active===job){settle(failure('The captured action reached its device time budget.','WORKER_TIMEOUT'));retire();}},LIMITS.watchdogMs);
        try{worker.postMessage({type:'ledger',operation,jobId:job.id,generation:job.generation,payload:input,expectedBuildFingerprint:manifest.buildFingerprint});}
        catch{settle(failure('Unable to capture the action.','WORKER_FAILED'));retire();}
      });
    }
    async function analyze(payload,{phase='FINAL',signal,owner:requestOwner}={}){
      if(closed)throw failure('The browser calculation client is closed.','CLIENT_CLOSED');
      if(!supported)throw failure('Browser workers are unavailable.','BROWSER_RUNTIME_UNAVAILABLE');
      if(signal?.aborted)throw abortError();
      if(typeof requestOwner!=='string'||!requestOwner||requestOwner.length>256)throw failure('Choose the signed-in workspace owner.','OWNER_REQUIRED');
      if(!['PREVIEW','FINAL'].includes(phase))throw failure('Invalid calculation phase.','INVALID_INPUT');
      if(owner!==requestOwner){cancel();clearCache();owner=requestOwner;}
      // Send public ledger and frozen math observations only. No notes, voice
      // transcripts, authentication tokens or UI/session objects enter workers.
      const raw=payload?.multiwayEvaluation||{};
      const input=clone({multiway:publicRecord(payload?.multiway),multiwayEvaluation:{profileSnapshot:publicSnapshot(raw.profileSnapshot),ranges:raw.ranges,
        chosenSize:raw.chosenSize,rake:raw.rake,rakeSchedule:raw.rakeSchedule,assumeNoRake:raw.assumeNoRake,feeBasis:raw.feeBasis}});
      const serialized=stable(input);
      if(new root.TextEncoder().encode(serialized).length>LIMITS.maxInputBytes)throw failure('Calculation input is too large.','INVALID_INPUT');
      if(active||starting)cancel();
      const started=now(), startGeneration=generation;
      let cancelledStart;
      const cancelled=new Promise((_,reject)=>{cancelledStart={reject};});
      starting=cancelledStart;
      const onStartAbort=()=>{if(starting===cancelledStart)cancel();};
      signal?.addEventListener('abort',onStartAbort,{once:true});
      let key, requestFingerprint;
      try {
        await Promise.race([(async()=>{
          await loadManifest();
          if(signal?.aborted||owner!==requestOwner||generation!==startGeneration||closed)throw abortError();
          key=stable({owner:requestOwner,build:manifest.buildFingerprint,phase,input});
          const digest=await root.crypto.subtle.digest('SHA-256',new root.TextEncoder().encode(JSON.stringify(input)));
          requestFingerprint=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
          if(signal?.aborted||owner!==requestOwner||generation!==startGeneration||closed)throw abortError();
          const prior=cache.get(key);
          if(!prior||clock()-prior.createdAt>=LIMITS.cacheTTL)await ensureWorker();
        })(),cancelled]);
      } finally {signal?.removeEventListener('abort',onStartAbort);if(starting===cancelledStart)starting=null;}
      if(signal?.aborted||owner!==requestOwner||generation!==startGeneration||closed)throw abortError();
      const cached=cache.get(key);
      if(cached&&clock()-cached.createdAt<LIMITS.cacheTTL){
        if(payload.multiwayEvaluation?.revisionKey&&cached.result.observedState?.revisionKey!==payload.multiwayEvaluation.revisionKey)throw failure('The calculation decision changed.','STALE_RESULT');
        metrics.cacheHit++;const result=clone(cached.result);
        result.performance={...result.performance,cacheHit:true,cacheAgeMs:clock()-cached.createdAt,
          cachedCalculationMs:result.performance.requestElapsedMs,requestElapsedMs:now()-started,monteCarloSamples:0};return result;
      }
      if(cached){cacheBytes-=cached.bytes;cache.delete(key);}metrics.cacheMiss++;
      if(signal?.aborted||owner!==requestOwner||generation!==startGeneration||closed)throw abortError();
      return new Promise((resolve,reject)=>{
        const job={id:'multiway-'+(++sequence),generation,started,startupMs:now()-started,key,requestFingerprint,
          handId:input.multiway?.handId,revisionKey:payload.multiwayEvaluation?.revisionKey,signal,resolve,reject};
        job.onAbort=()=>{if(active===job)cancel();};
        active=job;signal?.addEventListener('abort',job.onAbort,{once:true});
        job.timer=root.setTimeout(()=>{if(active===job){settle(failure('The calculation reached its device time budget.','WORKER_TIMEOUT'));retire();}},LIMITS.watchdogMs);
        try{worker.postMessage({type:'analyze',jobId:job.id,generation:job.generation,phase,payload:input,expectedBuildFingerprint:manifest.buildFingerprint});}
        catch{settle(failure('Unable to start the browser calculation.','WORKER_FAILED'));retire();}
      });
    }
    function clearOwner(value){if(value===undefined||value===owner){cancel();clearCache();owner=null;}}
    function close(){clearOwner();closed=true;}
    return Object.freeze({supported,analyze,operate,clearOwner,close,metrics:()=>({...metrics,cacheBytes,cacheEntries:cache.size}),limits:LIMITS});
  }
  root.TheibsBrowserMultiwayClient=Object.freeze({create,limits:LIMITS,extendsLedger,recoverLedger,successorCheckpoints});
})(typeof window==='object'?window:globalThis);
