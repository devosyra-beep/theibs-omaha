(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TheibsSimulationTools=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const networkFailure=error=>error?.code!=='AUTH_SESSION_CHANGED'&&error?.name!=='AbortError'&&
    ([408,429,502,503,504].includes(error?.status)||error?.retryable===true||error instanceof TypeError||
      /failed to fetch|networkerror|network request|load failed|invalid response.*HTTP 50[234]/i.test(error?.message||''));
  function createTransport(send,{timeoutMs=20000,delayMs=400,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onState=()=>{}}={}){
    return async function(url,options={}){
      const ownerSignal=options.signal;
      for(let attempt=0;attempt<2;attempt++){
        if(ownerSignal?.aborted)throw Object.assign(Error('Request cancelled.'),{name:'AbortError'});
        const controller=new AbortController(),abort=()=>controller.abort();let timer;
        ownerSignal?.addEventListener('abort',abort,{once:true});
        try{
          const result=await Promise.race([send(url,{...options,signal:controller.signal}),new Promise((_,reject)=>{
            timer=setTimeout(()=>{abort();reject(Object.assign(Error('Request deadline reached.'),{retryable:true}));},timeoutMs);
          })]);onState('CONNECTED');return result;
        }catch(error){
          if(ownerSignal?.aborted)throw Object.assign(Error('Request cancelled.'),{name:'AbortError'});
          const timedOut=controller.signal.aborted;
          if(!timedOut&&!networkFailure(error))throw error;
          if(attempt===0){onState('RECONNECTING');await wait(delayMs);continue;}
          onState('OFFLINE');
          throw Object.assign(Error(timedOut?'The server is taking longer than expected. Retry this request; the same operation identity will be reused.':'The connection was interrupted. Retry this request; your current hand is retained.'),{retryable:true,code:'SIMULATION_TRANSPORT_UNCERTAIN'});
        }finally{clearTimeout(timer);ownerSignal?.removeEventListener('abort',abort);}
      }
    };
  }
  function evaluationInput(session,chosenSize){
    // Only the already public ledger crosses into the mathematical worker.
    // The completed audit, dealer seed and future board are never projected.
    return {multiway:structuredClone(session.multiway),multiwayEvaluation:{assumeNoRake:true,revisionKey:session.state.revisionKey,
      ...(chosenSize==null||chosenSize===''?{}:{chosenSize:Number(chosenSize)})}};
  }
  function measurements(report){
    const final=report.publicRecord,validation=report.validation;
    if(report.abandoned||report.replayed||!validation?.eligible||!report.outcome||!final)return [];
    const index=validation.manualHeroEvents?.at(-1);
    if(!Number.isInteger(index))return [];
    return (report.decisions||[]).filter(item=>item.publicInput?.events?.length===index).flatMap(item=>{
      if(!Number.isFinite(item.heroStack)||!Number.isFinite(item.bigBlind)||item.bigBlind<=0)return [];
      if(JSON.stringify(final.events.slice(0,index))!==JSON.stringify(item.publicInput.events)||
        JSON.stringify(final.config)!==JSON.stringify(item.publicInput.config))return [];
      const action=final.events[index];
      if(action?.type!=='ACT'||action.action!==item.chosen.action||
        (item.chosen.size!=null&&action.to!==item.chosen.size))return [];
      const candidate=(item.evaluation?.ev?.candidates||[]).find(row=>row.action===item.chosen.action&&
        (row.size==null?item.chosen.size==null:Math.abs(row.size-item.chosen.size)<1e-8));
      if(candidate?.status!=='MODELED'||!Number.isFinite(candidate.ev))return [];
      const finalStack=report.outcome.stacks?.find(row=>row.id===item.heroId)?.stack;
      if(!Number.isFinite(finalStack))return [];
      const realizedBB=(finalStack-item.heroStack)/item.bigBlind,estimateBB=candidate.ev/item.bigBlind;
      return [{handId:report.id,street:item.street,chosen:item.chosen,estimateBB,realizedBB,residualBB:realizedBB-estimateBB,
        method:candidate.method,boundsBB:candidate.confidenceInterval95?.map(value=>value/item.bigBlind)||null,
        scope:'ONE_HELD_OUT_DEAL_UNDER_REFERENCE_CONTINUATION_NOT_ACTION_EV_GROUND_TRUTH'}];
    });
  }
  function summary(reports){
    const rows=reports.flatMap(measurements),n=rows.length;
    return {rows,count:n,meanResidualBB:n?rows.reduce((sum,row)=>sum+row.residualBB,0)/n:null,
      rmseBB:n?Math.sqrt(rows.reduce((sum,row)=>sum+row.residualBB**2,0)/n):null,
      eligibleHands:reports.filter(report=>report.validation?.eligible&&!report.replayed).length,
      scope:'DESCRIPTIVE_SELECTED_DECISIONS_NO_CALIBRATION_OR_GTO_CLAIM'};
  }
  function compactEvaluation(value){
    if(!value)return null;
    const result=structuredClone(value);
    if(result.observedState)result.observedState={handId:result.observedState.handId,revisionKey:result.observedState.revisionKey,revision:result.observedState.revision};
    for(const key of ['opponentHypotheses','state','potMath','strategy','coach','solver','multiway'])delete result[key];
    if(result.ev?.actions)for(const row of Object.values(result.ev.actions)){delete row.assumptions;delete row.warnings;}
    return result;
  }
  function boundedHistory(reports){
    const kept=reports.slice(-100);
    const lengths=kept.map(report=>JSON.stringify(report).length+1);let total=1+lengths.reduce((sum,length)=>sum+length,0);
    while(kept.length>1&&total>1400000){kept.shift();total-=lengths.shift();}
    return kept;
  }
  const PROGRESS_LIMIT=2000;
  const cents=value=>Math.round(value*100);
  function practiceProgress(saved){
    const settings=saved?.settings||{};
    const entries=[],seen=new Set();
    for(const row of (Array.isArray(saved?.entries)?saved.entries:[]).slice(0,PROGRESS_LIMIT)){
      if(typeof row?.id!=='string'||seen.has(row.id)||!['SETTLED','REPLAY','UNSETTLED','BASELINE'].includes(row.kind))continue;
      if(row.kind==='SETTLED'&&!Number.isSafeInteger(row.netCents))continue;
      seen.add(row.id);entries.push({id:row.id,kind:row.kind,netCents:row.kind==='SETTLED'?row.netCents:null});
    }
    return {schema:'SIMULATION_PROGRESS_V1',settings:{
      initialChips:Number.isFinite(settings.initialChips)&&settings.initialChips>=0&&settings.initialChips<=1e9?cents(settings.initialChips)/100:1000,
      chipValue:Number.isFinite(settings.chipValue)&&settings.chipValue>0&&settings.chipValue<=1e6?settings.chipValue:1,
      currency:['BRL','USD','EUR','GBP'].includes(settings.currency)?settings.currency:'BRL'
    },entries};
  }
  function recordProgress(progress,report){
    // The dealer owns payouts. Repeated acknowledgements, reveal and export
    // must never book the same hand twice. Refills are not earnings.
    if(!report?.id||progress.entries.some(row=>row.id===report.id))return;
    if(progress.entries.length>=PROGRESS_LIMIT)return;
    const known=Number.isFinite(report.outcome?.heroNet)&&Number.isSafeInteger(cents(report.outcome.heroNet));
    const kind=report.replayed?'REPLAY':report.abandoned||!known?'UNSETTLED':'SETTLED';
    progress.entries.push({id:report.id,kind,netCents:kind==='SETTLED'?cents(report.outcome.heroNet):null});
  }
  function progressSummary(progress){
    const settled=progress.entries.filter(row=>row.kind==='SETTLED');
    let netCents=0;const points=[{hand:0,netChips:0}];
    for(const row of settled){netCents+=row.netCents;points.push({hand:points.length,netChips:netCents/100});}
    return {hands:settled.length,netChips:netCents/100,balanceChips:(cents(progress.settings.initialChips)+netCents)/100,
      lastNetChips:settled.length?settled.at(-1).netCents/100:null,points,
      replays:progress.entries.filter(row=>row.kind==='REPLAY').length,
      unsettled:progress.entries.filter(row=>row.kind==='UNSETTLED').length,
      full:progress.entries.length>=PROGRESS_LIMIT};
  }
  function actionGuidance(decision,state){
    if(!decision||['PENDING','IDLE','WAITING_CARDS','UNAVAILABLE','NO_DECISION','INCOMPARABLE','PROVISIONAL'].includes(decision.stage))return null;
    const row=decision.rows?.find(item=>item.optionId===decision.precision?.bestActionId);
    if(row?.status!=='MODELED'||!Number.isFinite(row.evBB)||!state.legal?.actions?.includes(row.action)||
      row.action==='FOLD'&&!(state.legal.toCall>0))return null;
    if(['BET','RAISE'].includes(row.action)&&(!Number.isFinite(row.size)||row.size<state.legal.minTo-1e-8||row.size>state.legal.maxTo+1e-8))return null;
    const complete=!decision.missingLegalActions?.length&&decision.rows.every(item=>item.status==='MODELED'&&Number.isFinite(item.evBB));
    const conclusive=complete&&decision.leaderConclusive===true&&decision.precision?.status==='CONCLUSIVE'&&decision.precision.leaderConclusive===true;
    return {row,conclusive,heading:conclusive?'Best modeled action':'Current EV leader',
      reason:!complete?'Some legal alternatives have no comparable estimate.':decision.precision?.reason||'The available uncertainty does not certify a superior action.'};
  }
  return {createTransport,evaluationInput,measurements,summary,compactEvaluation,boundedHistory,networkFailure,
    practiceProgress,recordProgress,progressSummary,actionGuidance};
});
