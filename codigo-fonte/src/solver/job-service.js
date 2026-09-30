'use strict';
const path=require('node:path'),crypto=require('node:crypto');
const {Worker}=require('node:worker_threads');
const {createSolutionCache,keyFor}=require('./solution-cache');
const BUDGETS={FAST:{timeMs:500,iterations:50},STANDARD:{timeMs:3000,iterations:1000},DEEP:{timeMs:30000,iterations:20000}};
const LIMITS={maxNodes:12000,maxWorlds:27,maxMemoryBytes:48*1024*1024,maxBuildMs:750};
const HU_LIMITS=Object.freeze({...LIMITS,maxWorlds:144});
const TERMINAL_PHASES=new Set(['COMPLETE','FAILED','UNSUPPORTED','CANCELLED']);
const workIterations=checkpoint=>Number.isSafeInteger(checkpoint?.workIterations)?checkpoint.workIterations:Number.isSafeInteger(checkpoint?.iterations)?checkpoint.iterations:0;
function createSolverService({cacheDirectory,maxJobs=24,maxQueued=2,workerFile=path.join(__dirname,'job-worker.js')}={}){
  const jobs=new Map(),generations=new Map(),decisions=new Map(),cache=createSolutionCache({directory:cacheDirectory});let active=null,priority=0,closed=false,cacheWriteTail=Promise.resolve();
  const metrics={started:0,completed:0,cancelled:0,workerErrors:0,statusWaits:0,statusWaitTimeouts:0};
  function view(job){return {status:job.result?.status || (['COMPLETE','FAILED','CANCELLED','UNSUPPORTED'].includes(job.phase)?'NOT_SOLVED':'REFINING'),jobId:job.id,revisionKey:job.revisionKey,handId:job.handId,budget:job.budget,phase:job.phase,
    updateVersion:job.updateVersion||0,result:job.result ? structuredClone(job.result) : null,reason:job.reason || null,cache:{hit:job.cacheHit,...cache.stats()},timing:{acknowledgementMs:job.ackMs,firstValueMs:job.firstValueMs??null,completionMs:job.completionMs??null,totalMs:Math.round(performance.now()-job.started),workerMs:job.workerMs||0,decisionComputeMs:job.decision?.consumedMs||0,decisionWorkIterations:job.decision?.workIterations||0},limits:{...job.input.budget}};}
  function changed(job){job.updateVersion=(job.updateVersion||0)+1;for(const wake of [...(job.waiters||[])])wake();}
  function setPhase(job,phase){
    job.phase=phase;
    // Time to the logical terminal state, frozen before later polling. Worker
    // teardown may finish later; this is not a worker-exit/cancellation latency.
    if(TERMINAL_PHASES.has(phase)&&job.completionMs==null)job.completionMs=Math.max(0,Math.round(performance.now()-job.started));
    changed(job);
  }
  function account(job,reported){
    if(!Number.isFinite(reported))return;
    const delta=Math.max(0,reported-job.runReportedMs);job.runReportedMs=Math.max(job.runReportedMs,reported);
    job.consumedMs+=delta;job.workerMs=job.consumedMs;job.decision.consumedMs+=delta;
  }
  function ownerJob(owner,id){const job=jobs.get(id);if(!job||job.owner!==owner){const error=Error('Solver job was not found.');error.statusCode=404;throw error;}return job;}
  async function wait(owner,id,{afterVersion=-1,waitMs=1000,signal}={}){
    const job=ownerJob(owner,id);
    if(!Number.isSafeInteger(afterVersion)||afterVersion<0||!Number.isFinite(waitMs)||waitMs<0)throw Error('Use a valid solver update version and wait duration.');
    if(signal?.aborted)throw Object.assign(Error('Solver status request cancelled.'),{name:'AbortError'});
    const timeoutMs=Math.min(1000,Math.floor(waitMs));
    if((job.updateVersion||0)>afterVersion||TERMINAL_PHASES.has(job.phase)||!timeoutMs)return view(job);
    job.waiters??=new Set();
    if(job.waiters.size>=8)throw Object.assign(Error('Too many pending solver status requests.'),{statusCode:429});
    metrics.statusWaits++;
    await new Promise((resolve,reject)=>{
      const finish=()=>{clearTimeout(timer);job.waiters.delete(wake);signal?.removeEventListener('abort',abort);};
      const wake=()=>{finish();resolve();};
      const abort=()=>{finish();reject(Object.assign(Error('Solver status request cancelled.'),{name:'AbortError'}));};
      const timer=setTimeout(()=>{metrics.statusWaitTimeouts++;wake();},timeoutMs);
      job.waiters.add(wake);signal?.addEventListener('abort',abort,{once:true});
    });
    return view(job);
  }
  function cancelJob(job,reason='State changed'){
    if(['COMPLETE','CANCELLED','FAILED','UNSUPPORTED'].includes(job.phase))return;
    setPhase(job,'CANCELLED');job.reason=reason;metrics.cancelled++;
    if(active?.job===job){account(job,performance.now()-active.started);Atomics.store(active.cancel,0,1);void active.worker.terminate();active=null;kick();}
  }
  function current(job,slot){return !closed&&active===slot&&job.phase!=='CANCELLED'&&generations.get(job.owner)===job.generation;}
  function hasStrategy(result){
    const rows=result?.actions;
    return ['SOLVED','APPROXIMATE','REFINING','PARTIAL'].includes(result?.status)&&Array.isArray(rows)&&rows.length>0&&
      new Set(rows.map(row=>row?.id)).size===rows.length&&rows.every(row=>typeof row?.id==='string'&&row.id.length&&
        Number.isFinite(row.evBB)&&Number.isFinite(row.frequency)&&row.frequency>=0&&row.frequency<=1)&&
      Math.abs(rows.reduce((sum,row)=>sum+row.frequency,0)-1)<=1e-8;
  }
  async function save(job,message,slot){
    // A message can wait behind an earlier disk write. Recheck its identity
    // when executing, not only when the worker originally posted the message.
    if(!current(job,slot))return;
    const reported=Number.isFinite(message.workerMs)?Math.max(0,message.workerMs):job.runReportedMs;
    account(job,reported);
    if(!message.result)return;
    const usable=hasStrategy(message.result);
    // A resumed worker may be preempted while rebuilding, before producing any
    // new strategy. Keep the original complete result/checkpoint pair intact.
    if(!usable&&hasStrategy(job.result))return;
    job.result=message.result;
    if(!usable){job.checkpoint=null;changed(job);return;}
    if(message.checkpoint){
      const nextWork=workIterations(message.checkpoint);
      job.decision.workIterations+=Math.max(0,nextWork-job.lastWorkIterations);job.lastWorkIterations=nextWork;
      job.checkpoint=message.checkpoint;
    }
    job.firstValueMs ??= Math.round(performance.now()-job.started);
    changed(job);
    if(message.checkpoint){
      const result=job.result,checkpoint=job.checkpoint;
      // Serialized writes cannot let an older in-flight disk operation finish
      // after and replace a newer compatible entry. Queued stale writes skip.
      cacheWriteTail=cacheWriteTail.catch(()=>{}).then(()=>current(job,slot)?cache.put(job.owner,job.key,result,checkpoint):null);
      await cacheWriteTail;
    }
  }
  function kick(){
    if(closed||active||priority)return;
    const job=[...jobs.values()].filter(item=>item.phase==='QUEUED'&&generations.get(item.owner)===item.generation).sort((a,b)=>b.started-a.started)[0];if(!job)return;
    const remaining={timeMs:BUDGETS[job.budget].timeMs-job.decision.consumedMs,iterations:BUDGETS[job.budget].iterations-job.decision.workIterations};
    if(remaining.timeMs<=0||remaining.iterations<=0){setPhase(job,'COMPLETE');job.reason='Cumulative calculation budget reached.';kick();return;}
    setPhase(job,'BUILDING');job.runReportedMs=0;const cancel=new Int32Array(new SharedArrayBuffer(4));
    const worker=new Worker(workerFile,{resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4}});
    const slot=active={job,worker,cancel,started:performance.now()};
    const finish=()=>{if(active===slot)active=null;void worker.terminate();kick();};
    const timer=setTimeout(()=>{if(active!==slot)return;account(job,performance.now()-slot.started);setPhase(job,'COMPLETE');job.reason='Budget reached; retained the last completed refinement.';Atomics.store(cancel,0,1);finish();},remaining.timeMs+LIMITS.maxBuildMs+2000);timer.unref();
    worker.on('message',async message=>{
      if(!current(job,slot))return;
      if(message.type==='progress'){job.phase='REFINING';job.saveChain=job.saveChain.then(()=>save(job,message,slot));await job.saveChain;return;}
      clearTimeout(timer);
      if(message.type==='error'){setPhase(job,'FAILED');job.reason=message.error;metrics.workerErrors++;}
      else {job.saveChain=job.saveChain.then(()=>save(job,message,slot));await job.saveChain;if(!current(job,slot))return;setPhase(job,message.paused?'QUEUED':job.result?.status==='NOT_SOLVED'?'UNSUPPORTED':'COMPLETE');if(!message.paused)metrics.completed++;}
      finish();
    });
    worker.on('error',error=>{if(active!==slot)return;clearTimeout(timer);setPhase(job,'FAILED');job.reason=error.code==='ERR_WORKER_OUT_OF_MEMORY'?'Solver memory limit reached.':error.message;metrics.workerErrors++;finish();});
    worker.on('exit',code=>{if(active!==slot)return;clearTimeout(timer);setPhase(job,'FAILED');job.reason=`Solver worker stopped (${code}).`;finish();});
    worker.postMessage({input:job.input,budget:remaining,checkpoint:job.checkpoint,cancel:cancel.buffer});
  }
  async function start(owner,input,{budget='STANDARD',revisionKey,handId,automatic=false}={}){
    if(closed)throw Error('Solver service is closed.');if(!BUDGETS[budget])throw Error('Choose FAST, STANDARD or DEEP.');
    const started=performance.now(),generation=(generations.get(owner)||0)+1;generations.set(owner,generation);
    // The API supplies a validated canonical ledger. Profiles/exploit data and
    // client memory/time budgets never enter this reference-strategy input.
    // Queueing/cache I/O can outlive the caller's object. Fingerprint and run
    // the same detached snapshot, including nested ranges and ledger events.
    const normalized=structuredClone({multiway:input.multiway,ranges:input.ranges,sizing:input.sizing,rake:input.rake,
      budget:input.multiway?.config?.playerCount===2?HU_LIMITS:LIMITS});
    const coverage=require('./plo-river-game').coverage(normalized);
    const key=keyFor(coverage.status==='READY' ? {game:coverage.key,heroInformationSet:coverage.heroInformationSet} : normalized);
    const existing=[...jobs.values()].find(job=>job.owner===owner&&job.key===key&&job.revisionKey===revisionKey&&job.handId===handId&&['QUEUED','BUILDING','REFINING'].includes(job.phase));
    if(existing&&existing.budget===budget){existing.generation=generation;return view(existing);}
    for(const job of jobs.values())if(job.owner===owner&&['QUEUED','BUILDING','REFINING'].includes(job.phase))cancelJob(job,'Superseded by the current decision.');
    while(jobs.size>=maxJobs){const old=[...jobs.values()].find(job=>!['QUEUED','BUILDING','REFINING'].includes(job.phase));if(!old){const error=Error('Solver queue is full. The table remains available.');error.statusCode=429;throw error;}jobs.delete(old.id);}
    let found=await cache.get(owner,key);const id=crypto.randomUUID();
    if(generations.get(owner)!==generation){const error=Error('The solver request was superseded.');error.statusCode=409;throw error;}
    // The same decision shares its safety ceiling across FAST, STANDARD and
    // foreground pauses. An exact cache hit from another hand adds no cost.
    const decisionKey=crypto.createHash('sha256').update(JSON.stringify([owner,handId,revisionKey,key])).digest('hex');
    let decision=decisions.get(decisionKey);
    if(!decision){decision={consumedMs:0,workIterations:0};decisions.set(decisionKey,decision);}
    for(const previous of jobs.values())if(previous.owner===owner&&previous.key===key&&previous.checkpoint&&hasStrategy(previous.result)&&workIterations(previous.checkpoint)>workIterations(found?.checkpoint))
      found={result:previous.result,checkpoint:previous.checkpoint};
    while(decisions.size>maxJobs*2){const old=[...decisions.keys()].find(value=>![...jobs.values()].some(item=>item.decisionKey===value&&['QUEUED','BUILDING','REFINING'].includes(item.phase)));if(!old)break;decisions.delete(old);}
    // Reuse a fully stopped compatible result for automatic display. Explicit
    // refinement retains its existing budget semantics.
    const reusable=automatic===true&&hasStrategy(found?.result)&&found.result.adaptation?.phase==='STOPPED'&&found.result.adaptation.refinementRecommended===false;
    const job={id,owner,key,input:normalized,budget,revisionKey,handId,started,generation,decisionKey,decision,saveChain:Promise.resolve(),consumedMs:0,runReportedMs:0,lastWorkIterations:workIterations(found?.checkpoint),result:found?.result||null,checkpoint:found?.checkpoint,cacheHit:Boolean(found),updateVersion:0,waiters:new Set(),phase:found&&(budget==='FAST'||reusable)?'COMPLETE':'QUEUED'};
    if(coverage.status!=='READY'){job.phase='UNSUPPORTED';job.result={status:'NOT_SOLVED',actions:[],reasons:coverage.reasons,qualification:{gto:false},metrics:coverage.metrics};}
    jobs.set(id,job);metrics.started++;
    if(job.phase==='QUEUED'&&[...jobs.values()].filter(item=>item.phase==='QUEUED').length>maxQueued){job.phase='UNSUPPORTED';job.reason='Solver queue is full; retry refinement later.';}
    job.ackMs=Math.round(performance.now()-started);if(found)job.firstValueMs=job.ackMs;setPhase(job,job.phase);kick();return view(job);
  }
  function prioritize(){priority++;if(active)Atomics.store(active.cancel,0,1);let released=false;return()=>{if(released)return;released=true;priority=Math.max(0,priority-1);kick();};}
  return {start,wait,get:(owner,id)=>view(ownerJob(owner,id)),cancel:(owner,id)=>{const job=ownerJob(owner,id);cancelJob(job,'Cancelled by the user.');return view(job);},prioritize,
    stats:()=>({...metrics,active:Boolean(active),queued:[...jobs.values()].filter(item=>item.phase==='QUEUED').length,cache:cache.stats()}),
    close:async()=>{closed=true;for(const job of jobs.values())cancelJob(job,'Service closed.');if(active)await active.worker.terminate();active=null;await Promise.allSettled([...jobs.values()].map(job=>job.saveChain));await cacheWriteTail.catch(()=>{});}};
}
module.exports={createSolverService,BUDGETS,LIMITS,HU_LIMITS};
