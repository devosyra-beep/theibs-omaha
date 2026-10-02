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
  function contexts(items){
    const seen=new Set(), selected=[];
    for(const item of items){
      if(!item?.record?.config?.heroCards?.length || item.replayed)continue;
      const payload=publicInput(item.record,item.chosenSize), identity=JSON.stringify(payload);
      if(seen.has(identity))continue; seen.add(identity);
      if(JSON.stringify(payload).length>128000)continue;
      selected.push({label:String(item.label||'Hero decision').slice(0,100),payload,result:null});
    }
    return selected.slice(-5);
  }
  function metrics(batch){
    const rows=(batch?.contexts||[]).flatMap(item=>item.result?.summary?.rows||[]).filter(row=>row.action!=='FOLD'&&Number.isFinite(row.differenceBB));
    return {comparedActions:rows.length,meanAbsoluteDifferenceBB:rows.length?rows.reduce((n,r)=>n+Math.abs(r.differenceBB),0)/rows.length:null,
      rmseBB:rows.length?Math.sqrt(rows.reduce((n,r)=>n+r.differenceBB**2,0)/rows.length):null,
      computeMs:(batch?.contexts||[]).reduce((n,item)=>n+(item.result?.computeMs||0),0),cancelledSlices:batch?.cancelledSlices||0,
      scope:'DESCRIPTIVE_NON_FOLD_ACTION_MEANS_NOT_POLICY_ACCURACY'};
  }
  function create(options={}){
    const WorkerClass=options.Worker||root.Worker, fetcher=options.fetch||root.fetch?.bind(root), storage=options.storage||root.localStorage;
    const schedule=options.setTimeout||root.setTimeout.bind(root), unschedule=options.clearTimeout||root.clearTimeout.bind(root), now=options.now||(()=>root.performance.now());
    let batch=null,owner=null,worker=null,generation=0,timer=null,watchdog=null,manifest=null,available=false,inFlight=false;
    const key=()=>`theibs.simulation.validation.v1.${owner}`;
    const notify=()=>{try{if(owner&&batch)storage?.setItem(key(),JSON.stringify(batch));}catch{if(batch)batch.storageWarning='This batch could not be saved locally. Download it before leaving.';}options.onChange?.(batch);};
    function terminate(){generation++;if(timer)unschedule(timer);if(watchdog)unschedule(watchdog);timer=null;watchdog=null;worker?.terminate();worker=null;inFlight=false;}
    function pause(reason='Paused by you.'){
      if(batch?.status!=='RUNNING')return;
      batch.cancelledSlices=(batch.cancelledSlices||0)+(inFlight?1:0);
      terminate();batch.status='PAUSED';batch.reason=reason;notify();
    }
    function fail(message){terminate();if(batch){batch.status='ERROR';batch.reason=message;notify();}}
    function send(type){
      if(!worker||batch?.status!=='RUNNING'||!available)return;
      const row=batch.contexts[batch.index];if(!row)return;
      inFlight=true;
      watchdog=schedule(()=>fail('The validation worker stopped responding. Completed checkpoints are retained.'),8000);
      worker.postMessage({type,jobId:batch.id,generation,expectedBuildFingerprint:manifest.buildFingerprint,
        ...(type==='begin'?{payload:row.payload,options:{worlds:batch.worlds,budgetMs:batch.budgetMs,seed:`${batch.seed}_${batch.index}`}}:{}),
        ...(type==='resume'?{batch:row.result}:{})});
    }
    async function launch(){
      const stamp=generation,own=owner,id=batch?.id;
      try{
        if(!manifest){const abort=new AbortController(),timeout=schedule(()=>abort.abort(),5000);try{
          const response=await fetcher('/simulation-validation-manifest.json',{cache:'no-store',signal:abort.signal});
          if(!response.ok)throw Error('The validation build could not be loaded.');manifest=await response.json();
        }finally{unschedule(timeout);}}
        if(stamp!==generation||own!==owner||id!==batch?.id||batch.status!=='RUNNING'||!available)return;
        if(batch.buildFingerprint&&batch.buildFingerprint!==manifest.buildFingerprint)throw Error('The validation model changed. Start a new batch to keep results comparable.');
        batch.buildFingerprint=manifest.buildFingerprint;
        worker=new WorkerClass(`/simulation-validation-worker.js?build=${manifest.buildFingerprint}`);
        watchdog=schedule(()=>fail('The validation worker could not start.'),8000);
        worker.onerror=()=>{if(stamp===generation)fail('The validation worker failed. Completed checkpoints are retained.');};
        worker.onmessage=event=>{
          const message=event.data;
          if(stamp!==generation||own!==owner||id!==batch?.id||batch.status!=='RUNNING'||message.buildFingerprint!==manifest.buildFingerprint)return;
          if(message.type!=='ready'&&(message.jobId!==batch.id||message.generation!==generation))return;
          if(watchdog)unschedule(watchdog);watchdog=null;inFlight=false;
          if(message.type==='ready'){send(batch.contexts[batch.index].result?'resume':'begin');return;}
          if(message.type==='error'){fail(message.error);return;}
          if(message.type!=='checkpoint'||!message.batch)return;
          const current=batch.contexts[batch.index],previous=current.result;
          if(previous&&message.batch.count<previous.count)return;
          current.result=message.batch;batch.elapsedMs=now()-batch.startedTick;
          if(message.batch.status!=='RUNNING'){
            batch.index++;
            if(batch.index===batch.contexts.length){terminate();batch.status='COMPLETE';batch.reason='All selected decisions were checked. Budget-limited decisions retain partial results.';notify();return;}
            notify();timer=schedule(()=>{timer=null;send('begin');},150);return;
          }
          notify();timer=schedule(()=>{timer=null;send('step');},150);
        };
      }catch(error){if(stamp===generation)fail(error.message);}
    }
    return {
      get supported(){return !!(WorkerClass&&fetcher);},get state(){return batch;},get working(){return !!worker||inFlight;},
      load(selectedOwner){terminate();owner=selectedOwner;manifest=null;batch=null;try{const value=JSON.parse(storage?.getItem(key())||'null');
        if(value?.schema==='THEIBS_SIMULATION_BATCH_V1'&&Array.isArray(value.contexts)&&value.contexts.length>0&&value.contexts.length<=5&&
          ['RUNNING','PAUSED','ERROR','STOPPED','COMPLETE'].includes(value.status)&&Number.isInteger(value.index)&&value.index>=0&&value.index<=value.contexts.length&&
          value.contexts.every(row=>row&&typeof row.label==='string'&&row.payload?.multiway?.config&&(!row.result||Number.isInteger(row.result.count)&&row.result.count>=0&&row.result.count<=value.worlds))&&
          JSON.stringify(value).length<1400000){batch=value;if(batch.status==='RUNNING'){batch.status='PAUSED';batch.reason='Restored checkpoints. Resume when gameplay is idle.';}}
      }catch{}notify();},
      setAvailable(value,reason='Paused for foreground gameplay or EV.'){available=!!value;if(!available)pause(reason);},
      start(items,settings={}){
        if(!available||!owner||!WorkerClass)throw Error('Wait for foreground EV to finish before starting validation.');
        const selected=contexts(items),worlds=Number(settings.worlds??128),budgetMs=Number(settings.budgetMs??30000);
        if(!selected.length)throw Error('Capture a pending Hero decision first, or select saved decisions.');
        if(![32,64,128,256,512].includes(worlds)||budgetMs<1000||budgetMs>60000)throw Error('Choose a supported validation budget.');
        terminate();batch={schema:'THEIBS_SIMULATION_BATCH_V1',id:root.crypto.randomUUID(),seed:root.crypto.randomUUID(),
          source:'SIMULATION_ONLY',createdAt:new Date().toISOString(),status:'RUNNING',reason:'',worlds,budgetMs,
          contexts:selected,index:0,startedTick:now(),elapsedMs:0};notify();launch();
      },
      pause,resume(){if(!available||!batch||!['PAUSED','ERROR'].includes(batch.status))return;terminate();batch.status='RUNNING';batch.reason='';batch.startedTick=now()-(batch.elapsedMs||0);notify();launch();},
      stop(){if(!batch)return;terminate();batch.status='STOPPED';batch.reason='Stopped. Completed checkpoints are retained.';notify();},
      clearOwner(){terminate();batch=null;owner=null;available=false;options.onChange?.(null);},
      export(){return batch?clone({...batch,metrics:metrics(batch),exportedAt:new Date().toISOString()}):null;}
    };
  }
  const api={publicInput,contexts,metrics,create};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.TheibsSimulationValidation=api;
})(typeof globalThis==='object'?globalThis:this);
