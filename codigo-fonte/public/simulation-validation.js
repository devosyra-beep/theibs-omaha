(function(root){
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const pick = (value,keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key,value[key]]));
  function publicInput(record,chosenSize){
    const multiway = pick(record,['schemaVersion','enabled','handId','editEpoch']);
    multiway.config = pick(record.config,['variant','playerCount','heroPosition','startingStack','smallBlind','bigBlind','heroCards','stacks']);
    if(record.config?.players)multiway.config.players=record.config.players.map((player,index)=>({...pick(player,['playerId']),name:`Seat ${index+1}`}));
    multiway.events = (record.events||[]).map(event=>pick(event,['type','actor','action','to','cards']));
    return clone({multiway,multiwayEvaluation:{assumeNoRake:true,...(chosenSize==null?{}:{chosenSize})}});
  }
  function contexts(items,limit=5){
    const seen=new Set(), selected=[];
    for(const item of items){
      if(!item?.record?.config?.heroCards?.length || item.replayed)continue;
      const payload=publicInput(item.record,item.chosenSize), identity=JSON.stringify(payload);
      if(seen.has(identity))continue; seen.add(identity);
      if(JSON.stringify(payload).length>128000)continue;
      selected.push({label:String(item.label||'Hero decision').slice(0,100),payload,result:null});
    }
    return selected.slice(-limit);
  }
  function metrics(batch){
    const rows=(batch?.contexts||[]).flatMap(item=>item.result?.summary?.rows||[]).filter(row=>row.action!=='FOLD'&&Number.isFinite(row.differenceBB));
    return {comparedActions:rows.length,meanAbsoluteDifferenceBB:rows.length?rows.reduce((n,r)=>n+Math.abs(r.differenceBB),0)/rows.length:null,
      rmseBB:rows.length?Math.sqrt(rows.reduce((n,r)=>n+r.differenceBB**2,0)/rows.length):null,
      computeMs:(batch?.contexts||[]).reduce((n,item)=>n+(item.result?.computeMs||0),0),cancelledSlices:batch?.cancelledSlices||0,
      scope:'DESCRIPTIVE_NON_FOLD_ACTION_MEANS_NOT_POLICY_ACCURACY'};
  }
  function checkpointShape(value){
    const nonnegative=number=>Number.isFinite(number)&&number>=0,maybeFinite=number=>number==null||Number.isFinite(number);
    const interval=bounds=>bounds==null||Array.isArray(bounds)&&bounds.length===2&&bounds.every(Number.isFinite)&&bounds[0]<=bounds[1];
    const candidates=value?.prediction?.candidates;
    if(!Array.isArray(candidates)||!candidates.length||candidates.length>8||!Number.isInteger(value.prediction.samples)||value.prediction.samples<0||!Array.isArray(value.sums)||value.sums.length!==candidates.length||!value.sums.every(Number.isFinite)||
      !nonnegative(value.computeMs)||!nonnegative(value.predictionMs)||!nonnegative(value.sumWeight)||!nonnegative(value.sumWeightSquared)||
      !Number.isInteger(value.leaderChanges)||value.leaderChanges<0||!Array.isArray(value.checkpoints)||value.checkpoints.length>128||
      value.sumWeight>value.count+1e-8||value.sumWeightSquared>value.sumWeight+1e-8||value.sumWeight**2>value.count*value.sumWeightSquared+1e-8||
      value.count===0&&(value.sumWeight!==0||value.sumWeightSquared!==0||value.sums.some(number=>number!==0))||
      value.count>0&&!(value.sumWeight>0&&value.sumWeightSquared>0)||
      value.status==='COMPLETE'&&value.count!==value.requestedWorlds||value.status==='RUNNING'&&value.count>=value.requestedWorlds||
      value.status==='PARTIAL_BUDGET'&&value.computeMs<value.budgetMs)return false;
    const ids=new Set();
    if(!candidates.every(row=>row&&typeof row.optionId==='string'&&!ids.has(row.optionId)&&ids.add(row.optionId)&&
      typeof row.status==='string'&&maybeFinite(row.ev)&&(row.status!=='MODELED'||Number.isFinite(row.ev))&&interval(row.confidenceInterval95)))return false;
    if(value.lastLeader!=null&&!ids.has(value.lastLeader)||value.count>0&&!value.summary)return false;
    if(value.summary){
      const rows=value.summary.rows;
      if(!Array.isArray(rows)||rows.length!==candidates.length||!rows.every((row,index)=>row.optionId===candidates[index].optionId&&row.action===candidates[index].action&&row.size===candidates[index].size&&
        [row.meanBB,row.estimateBB,row.differenceBB].every(maybeFinite)&&[row.boundsBB,row.predictionBoundsBB,row.differenceBoundsBB].every(interval)))return false;
      const leader=rows.filter(row=>Number.isFinite(row.meanBB)).sort((a,b)=>b.meanBB-a.meanBB)[0];
      const certified=!!leader&&rows.length>1&&rows.every(row=>row.optionId===leader.optionId||row.boundsBB&&leader.boundsBB&&leader.boundsBB[0]>row.boundsBB[1]);
      if(value.summary.leader!==(leader?.optionId||null)||value.summary.leaderCertified!==certified||
        !nonnegative(value.summary.effectiveSamples)||value.summary.effectiveSamples>value.count+1e-8)return false;
    }
    return true;
  }
  function create(options={}){
    const WorkerClass=options.Worker||root.Worker, fetcher=options.fetch||root.fetch?.bind(root), storage=options.storage||root.localStorage;
    const schedule=options.setTimeout||root.setTimeout.bind(root), unschedule=options.clearTimeout||root.clearTimeout.bind(root), now=options.now||(()=>root.performance.now());
    const AUTO_WORLDS=512,AUTO_BUDGET=30000,QUEUE_LIMIT=5,HISTORY_LIMIT=5,STORE_LIMIT=1400000;
    let batch=null,owner=null,worker=null,generation=0,timer=null,watchdog=null,queueTimer=null,manifest=null,available=false,inFlight=false,launching=false,fetchAbort=null,requestId=null;
    let automatic=true,manualPaused=false,queue=[],history=[],dropped=0,storageWarning='';
    let counters={captured:0,deduplicated:0,ineligible:0,errors:0,completed:0,partial:0};
    const key=()=>`theibs.simulation.validation.v1.${owner}`;
    const autoKey=()=>`theibs.simulation.validation.auto.v1.${owner}`;
    const identity=row=>JSON.stringify(row.payload);
    const autoState=()=>({schema:'THEIBS_SIMULATION_AUTOMATION_V1',automatic,manualPaused,queue,history,dropped,counters});
    function trimHistory(){
      while(history.length>HISTORY_LIMIT||history.length&&JSON.stringify(autoState()).length>STORE_LIMIT)history.shift();
    }
    function notify(){
      trimHistory();
      try{if(owner){if(batch)storage?.setItem(key(),JSON.stringify(batch));storage?.setItem(autoKey(),JSON.stringify(autoState()));}}
      catch{storageWarning='Validation could not be saved locally. Download it before leaving.';if(batch)batch.storageWarning=storageWarning;}
      options.onChange?.(batch);
    }
    function terminate(){
      generation++;for(const pending of [timer,watchdog,queueTimer])if(pending)unschedule(pending);
      timer=null;watchdog=null;queueTimer=null;fetchAbort?.abort();fetchAbort=null;
      worker?.terminate();worker=null;inFlight=false;launching=false;requestId=null;
    }
    function pauseWork(reason,kind){
      if(batch?.status!=='RUNNING')return;
      batch.cancelledSlices=(batch.cancelledSlices||0)+(inFlight?1:0);
      terminate();batch.status='PAUSED';batch.reason=reason;batch.pauseKind=kind;notify();
    }
    function pause(reason='Paused by you.'){
      manualPaused=true;
      if(batch?.status==='RUNNING')pauseWork(reason,'MANUAL');
      else{if(batch?.status==='PAUSED'){batch.pauseKind='MANUAL';batch.reason=reason;}if(queueTimer)unschedule(queueTimer);queueTimer=null;notify();}
    }
    function archive(){
      if(!batch||history.some(value=>value.id===batch.id))return;
      const kept=clone(batch);
      if(kept.status==='RUNNING'){kept.status='STOPPED';kept.reason='Replaced by a new validation batch.';}
      history.push(kept);trimHistory();
    }
    function kick(){
      if(queueTimer||!available||!owner||manualPaused||worker||launching)return;
      queueTimer=schedule(()=>{queueTimer=null;drain();},150);
    }
    function fail(message,code='WORKER_ERROR'){
      terminate();if(batch){batch.status='ERROR';batch.reason=message;batch.errorCode=code;counters.errors++;notify();}
      if(batch?.mode==='AUTOMATIC')kick();
    }
    function checkpointMatches(row,result,value,index){
      if(!result||result.schema!=='SIMULATION_VALIDATION_V1'||result.source!=='SIMULATION_ONLY'||
        !Number.isInteger(result.count)||result.count<0||result.count>value.worlds||
        !['RUNNING','COMPLETE','PARTIAL_BUDGET'].includes(result.status)||
        result.seed!==`${value.seed}_${index}`||result.requestedWorlds!==value.worlds||result.budgetMs!==value.budgetMs||
        typeof result.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(result.fingerprint)||!checkpointShape(result))return false;
      const input=result.publicInput?.multiwayEvaluation;
      if(!input||input.assumeNoRake!==true||input.rake!=null||input.rakeSchedule!=null||input.profileSnapshot!=null||input.ranges?.length)return false;
      try{const captured=publicInput({schemaVersion:row.payload.multiway.schemaVersion,enabled:row.payload.multiway.enabled,
        handId:input.handId,editEpoch:result.editEpoch,config:input.config,events:input.events},input.chosenSize);
        return JSON.stringify(captured)===JSON.stringify(row.payload);
      }catch{return false;}
    }
    function validContext(row){
      if(!row||typeof row.label!=='string'||row.label.length>100||!row.payload?.multiway?.config?.heroCards?.length)return false;
      try{return JSON.stringify(row.payload)===JSON.stringify(publicInput(row.payload.multiway,row.payload.multiwayEvaluation?.chosenSize))&&JSON.stringify(row.payload).length<=128000;}catch{return false;}
    }
    function validBatch(value){
      const terminal=row=>row?.result&&['COMPLETE','PARTIAL_BUDGET'].includes(row.result.status);
      return value?.schema==='THEIBS_SIMULATION_BATCH_V1'&&value.source==='SIMULATION_ONLY'&&typeof value.id==='string'&&typeof value.seed==='string'&&
        /^[A-Za-z0-9_-]{8,100}$/.test(value.seed)&&[32,64,128,256,512].includes(value.worlds)&&Number.isFinite(value.budgetMs)&&value.budgetMs>=1000&&value.budgetMs<=60000&&
        Array.isArray(value.contexts)&&value.contexts.length>0&&value.contexts.length<=5&&
        ['RUNNING','PAUSED','ERROR','STOPPED','COMPLETE'].includes(value.status)&&Number.isInteger(value.index)&&value.index>=0&&value.index<=value.contexts.length&&
        (value.status!=='RUNNING'||value.index<value.contexts.length)&&(value.status!=='COMPLETE'||value.index===value.contexts.length&&value.contexts.every(terminal))&&
        value.contexts.every((row,index)=>validContext(row)&&(!row.result||checkpointMatches(row,row.result,value,index))&&
          (index<value.index?terminal(row):index===value.index?!row.result||row.result.status==='RUNNING':!row.result))&&
        JSON.stringify(value).length<STORE_LIMIT;
    }
    function cached(row){
      return manifest&&history.findLast(value=>value.mode==='AUTOMATIC'&&value.status==='COMPLETE'&&value.worlds===AUTO_WORLDS&&value.budgetMs===AUTO_BUDGET&&
        value.buildFingerprint===manifest.buildFingerprint&&value.contexts.some(item=>identity(item)===identity(row)));
    }
    function newBatch(selected,worlds,budgetMs,mode){
      return {schema:'THEIBS_SIMULATION_BATCH_V1',id:root.crypto.randomUUID(),seed:root.crypto.randomUUID(),
        source:'SIMULATION_ONLY',mode,createdAt:new Date().toISOString(),status:'RUNNING',reason:'',worlds,budgetMs,
        contexts:selected,index:0,startedTick:now(),elapsedMs:0};
    }
    function drain(){
      if(!available||!owner||manualPaused||worker||launching)return;
      if(batch?.mode==='AUTOMATIC'&&automatic&&batch.status==='PAUSED'&&['FOREGROUND','RESTORED','AUTOMATIC_OFF'].includes(batch.pauseKind)){
        batch.status='RUNNING';batch.reason='';batch.pauseKind=null;batch.startedTick=now()-(batch.elapsedMs||0);notify();launch();return;
      }
      if(batch?.status==='RUNNING'||batch?.status==='PAUSED'||batch?.mode==='MANUAL'&&batch.status==='ERROR'||!automatic||!queue.length)return;
      archive();batch=newBatch([queue.shift()],AUTO_WORLDS,AUTO_BUDGET,'AUTOMATIC');notify();launch();
    }
    function send(type){
      if(!worker||batch?.status!=='RUNNING'||!available)return;
      const row=batch.contexts[batch.index];if(!row)return;
      inFlight=true;
      if(type==='begin'||type==='resume')requestId=root.crypto.randomUUID();
      watchdog=schedule(()=>fail('The validation worker stopped responding. Completed checkpoints are retained.'),8000);
      worker.postMessage({type,jobId:batch.id,generation,requestId,expectedBuildFingerprint:manifest.buildFingerprint,
        ...(['begin','resume'].includes(type)?{payload:row.payload,options:{worlds:batch.worlds,budgetMs:batch.budgetMs,seed:`${batch.seed}_${batch.index}`}}:{}),
        ...(type==='resume'?{batch:row.result}:{})});
    }
    async function launch(){
      const stamp=generation,own=owner,id=batch?.id;
      launching=true;
      try{
        const abort=new AbortController(),timeout=schedule(()=>abort.abort(),5000);fetchAbort=abort;try{
          const response=await fetcher('/simulation-validation-manifest.json',{cache:'no-store',signal:abort.signal});
          if(!response.ok)throw Error('The validation build could not be loaded.');
          const loaded=await response.json();
          if(typeof loaded?.buildFingerprint!=='string'||!loaded.buildFingerprint)throw Error('The validation build identity is unavailable.');
          if(stamp!==generation||own!==owner)return;manifest=loaded;
        }finally{unschedule(timeout);if(fetchAbort===abort)fetchAbort=null;}
        if(stamp!==generation||own!==owner||id!==batch?.id||batch.status!=='RUNNING'||!available)return;
        if(batch.buildFingerprint&&batch.buildFingerprint!==manifest.buildFingerprint){fail('The validation build changed. Start a fresh batch; previous checkpoints retain their original build.','BUILD_CHANGED');return;}
        if(batch.mode==='AUTOMATIC'&&!batch.contexts[0].result){
          const previous=cached(batch.contexts[0]);
          if(previous){batch=clone(previous);batch.reason='Reused the completed validation for this frozen decision and build.';launching=false;notify();kick();return;}
        }
        batch.buildFingerprint=manifest.buildFingerprint;
        worker=new WorkerClass(`/simulation-validation-worker.js?build=${manifest.buildFingerprint}`);
        watchdog=schedule(()=>fail('The validation worker could not start.'),8000);
        worker.onerror=()=>{if(stamp===generation)fail('The validation worker failed. Completed checkpoints are retained.');};
        worker.onmessage=event=>{
          const message=event.data;
          if(stamp!==generation||own!==owner||id!==batch?.id||batch.status!=='RUNNING')return;
          if(message.buildFingerprint!==manifest.buildFingerprint){fail('The validation worker build changed. Start a fresh batch.','BUILD_CHANGED');return;}
          if(message.type!=='ready'&&(message.jobId!==batch.id||message.generation!==generation||message.requestId!==requestId))return;
          if(watchdog)unschedule(watchdog);watchdog=null;inFlight=false;
          if(message.type==='ready'){send(batch.contexts[batch.index].result?'resume':'begin');return;}
          if(message.type==='error'){fail(message.error);return;}
          if(message.type!=='checkpoint'||!message.batch)return;
          const current=batch.contexts[batch.index],previous=current.result;
          if(message.contextFingerprint!==message.batch.fingerprint||!checkpointMatches(current,message.batch,batch,batch.index)){
            fail('The validation checkpoint does not match its frozen decision. Start a fresh batch.','INVALID_CHECKPOINT');return;
          }
          if(previous&&message.batch.count<previous.count)return;
          current.result=message.batch;batch.elapsedMs=now()-batch.startedTick;
          if(message.batch.status!=='RUNNING'){
            if(message.batch.status==='PARTIAL_BUDGET')counters.partial++;else counters.completed++;
            batch.index++;
            if(batch.index===batch.contexts.length){terminate();batch.status='COMPLETE';batch.reason='All selected decisions were checked. Budget-limited decisions retain partial results.';notify();kick();return;}
            notify();timer=schedule(()=>{timer=null;send('begin');},150);return;
          }
          notify();timer=schedule(()=>{timer=null;send('step');},150);
        };
      }catch(error){if(stamp===generation)fail(error.message);}
      finally{if(stamp===generation)launching=false;}
    }
    return {
      get supported(){return !!(WorkerClass&&fetcher);},get state(){return batch;},get working(){return launching||!!worker||inFlight;},
      get automatic(){return automatic;},get history(){return clone(history);},
      get diagnostics(){return {automatic,queued:queue.length,history:history.length,manualPaused,mode:batch?.mode||null,
        requestedWorlds:AUTO_WORLDS,budgetMs:AUTO_BUDGET,queueLimit:QUEUE_LIMIT,historyLimit:HISTORY_LIMIT,dropped,storageWarning,...counters};},
      load(selectedOwner){
        terminate();owner=selectedOwner;manifest=null;batch=null;available=false;automatic=true;manualPaused=false;queue=[];history=[];dropped=0;storageWarning='';
        counters={captured:0,deduplicated:0,ineligible:0,errors:0,completed:0,partial:0};
        try{const saved=JSON.parse(storage?.getItem(autoKey())||'null');
          if(saved?.schema==='THEIBS_SIMULATION_AUTOMATION_V1'&&JSON.stringify(saved).length<STORE_LIMIT){
            automatic=saved.automatic!==false;manualPaused=saved.manualPaused===true;dropped=Number.isSafeInteger(saved.dropped)&&saved.dropped>=0?saved.dropped:0;
            for(const field of Object.keys(counters))if(Number.isSafeInteger(saved.counters?.[field])&&saved.counters[field]>=0)counters[field]=saved.counters[field];
            if(Array.isArray(saved.history))history=saved.history.filter(validBatch).slice(-HISTORY_LIMIT);
            if(Array.isArray(saved.queue)){const seen=new Set();queue=saved.queue.filter(row=>{if(!validContext(row)||row.result!=null||seen.has(identity(row)))return false;seen.add(identity(row));return true;}).slice(0,QUEUE_LIMIT);}
          }
          const value=JSON.parse(storage?.getItem(key())||'null');
          if(validBatch(value)){batch=value;batch.mode=batch.mode==='AUTOMATIC'?'AUTOMATIC':'MANUAL';
            if(batch.status==='RUNNING'){batch.status='PAUSED';batch.pauseKind='RESTORED';batch.reason='Restored checkpoints. Waiting for foreground work to finish.';}
          }else if(value)storageWarning='Stored validation checkpoints did not match their frozen decisions and were not resumed.';
        }catch{}notify();
      },
      setAvailable(value,reason='Paused for foreground gameplay or EV.'){
        available=!!value;
        if(!available){if(batch?.status==='RUNNING')pauseWork(reason,'FOREGROUND');else if(queueTimer){unschedule(queueTimer);queueTimer=null;}}
        else kick();
      },
      setAutomatic(value){automatic=!!value;if(!automatic&&batch?.mode==='AUTOMATIC'&&batch.status==='RUNNING')pauseWork('Automatic validation is off.','AUTOMATIC_OFF');else notify();if(automatic)kick();},
      hasDecision(record,chosenSize){
        if(!record?.config?.heroCards?.length)return false;
        let selected;try{selected=JSON.stringify(publicInput(record,chosenSize));}catch{return false;}
        return queue.some(row=>identity(row)===selected)||!!batch?.contexts.some(row=>identity(row)===selected)||history.some(value=>value.contexts.some(row=>identity(row)===selected));
      },
      enqueue(items){
        const outcome={added:0,deduplicated:0,dropped:0,ineligible:0};
        if(!automatic||!owner||!WorkerClass||!fetcher)return outcome;
        for(const item of Array.isArray(items)?items:[items]){
          let row;try{row=contexts([item])[0];}catch{}
          if(!row){outcome.ineligible++;counters.ineligible++;continue;}
          const selected=identity(row),current=batch&&['RUNNING','PAUSED','ERROR','STOPPED'].includes(batch.status)&&batch.contexts.some(item=>identity(item)===selected);
          const completed=batch?.mode==='AUTOMATIC'&&batch.status==='COMPLETE'&&manifest&&batch.buildFingerprint===manifest.buildFingerprint&&batch.contexts.some(item=>identity(item)===selected);
          const failed=history.some(value=>value.mode==='AUTOMATIC'&&['ERROR','STOPPED'].includes(value.status)&&(!manifest||value.buildFingerprint===manifest.buildFingerprint)&&value.contexts.some(item=>identity(item)===selected));
          if(current||completed||failed||queue.some(item=>identity(item)===selected)||cached(row)){outcome.deduplicated++;counters.deduplicated++;continue;}
          if(queue.length>=QUEUE_LIMIT){outcome.dropped++;dropped++;continue;}
          queue.push(row);outcome.added++;counters.captured++;
        }
        if(outcome.added||outcome.deduplicated||outcome.dropped||outcome.ineligible)notify();kick();return outcome;
      },
      start(items,settings={}){
        if(!available||!owner||!WorkerClass)throw Error('Wait for foreground EV to finish before starting validation.');
        const selected=contexts(items),worlds=Number(settings.worlds??128),budgetMs=Number(settings.budgetMs??30000);
        if(!selected.length)throw Error('Capture a pending Hero decision first, or select saved decisions.');
        if(![32,64,128,256,512].includes(worlds)||budgetMs<1000||budgetMs>60000)throw Error('Choose a supported validation budget.');
        terminate();archive();manualPaused=false;batch=newBatch(selected,worlds,budgetMs,'MANUAL');notify();launch();
      },
      pause,resume(){
        manualPaused=false;
        if(batch&&['PAUSED','ERROR'].includes(batch.status)){if(!available){batch.pauseKind='FOREGROUND';notify();return;}
          terminate();batch.status='RUNNING';batch.reason='';batch.pauseKind=null;batch.startedTick=now()-(batch.elapsedMs||0);notify();launch();
        }else{notify();kick();}
      },
      stop(){manualPaused=true;terminate();if(batch){batch.status='STOPPED';batch.pauseKind='MANUAL';batch.reason='Stopped. Completed checkpoints are retained.';}notify();},
      clearOwner(){terminate();batch=null;owner=null;available=false;queue=[];history=[];automatic=true;manualPaused=false;dropped=0;storageWarning='';counters={captured:0,deduplicated:0,ineligible:0,errors:0,completed:0,partial:0};options.onChange?.(null);},
      export(){return batch?clone({...batch,metrics:metrics(batch),automation:{...autoState(),requestedWorlds:AUTO_WORLDS,budgetMs:AUTO_BUDGET},exportedAt:new Date().toISOString()}):null;}
    };
  }
  const api={publicInput,contexts,metrics,create};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.TheibsSimulationValidation=api;
})(typeof globalThis==='object'?globalThis:this);
