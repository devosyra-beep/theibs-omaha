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
  return {createTransport,evaluationInput,measurements,summary,compactEvaluation,boundedHistory,networkFailure};
});
