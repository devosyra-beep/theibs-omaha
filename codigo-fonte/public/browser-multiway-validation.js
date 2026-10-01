(() => {
  'use strict';
  const $=id=>document.getElementById(id),owner='PUBLIC_SYNTHETIC_COMPUTE_QA';
  let fixtures,inputs=0,busy=false;
  $('interaction').addEventListener('input',()=>inputs++);
  const plain=value=>structuredClone(value),percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];};
  const distribution=rows=>({n:rows.length,p50Ms:percentile(rows,.5),p95Ms:percentile(rows,.95)});
  function report(value){$('report').textContent=JSON.stringify({...value,inputEvents:inputs},null,2);$('status').textContent=value.status;}
  function show(result){
    $('summary').textContent=`${result.strategyMetadata?.status||result.status} · ${result.ev?.decisionPrecision?.status||'No decision'} · ${result.multiwayEvaluation?.samples||0} complete worlds · Browser compute`;
    $('actions').replaceChildren(...(result.ev?.candidates||[]).map(row=>{const tr=document.createElement('tr');for(const value of [row.optionId,row.evBB,row.differenceToBestModeledBB]){const td=document.createElement('td');td.textContent=typeof value==='number'?value.toFixed(3):value??'Unavailable';tr.append(td);}return tr;}));
  }
  async function run(task){if(busy)return;busy=true;for(const id of ['normal','river','cancel'])$(id).disabled=true;$('status').textContent='Calculating…';try{await task();}catch(error){report({status:'FAIL',reason:error.message,code:error.code});}finally{busy=false;for(const id of ['normal','river','cancel'])$(id).disabled=false;}}
  $('normal').onclick=()=>run(async()=>{
    const rows=[];let latest;
    for(let i=0;i<3;i++){
      const client=TheibsBrowserMultiwayClient.create();
      try{
        const start=performance.now(),preview=await client.analyze(fixtures.normal,{phase:'PREVIEW',owner});show(preview);
        const firstMs=performance.now()-start,final=await client.analyze(fixtures.normal,{phase:'FINAL',owner});show(final);const resolutionMs=performance.now()-start;
        if(final.strategyMetadata?.status!=='HEURISTIC'||final.observedState.revisionKey!==fixtures.expected.revisionKey)throw Error('Provenance/revision mismatch.');
        // Cross-runtime libm can differ in last-bit policy weights. This is a
        // QA comparison threshold only; no solver/sampling bound is widened.
        let referenceErrorBB=null;
        if(final.multiwayEvaluation.samples===128){
          if(final.multiwayEvaluation.fingerprint!==fixtures.expected.fingerprint)throw Error('Fixed-work input/seed mismatch.');
          referenceErrorBB=0;for(const expected of fixtures.expected.candidates){const actual=final.ev.candidates.find(row=>row.optionId===expected.optionId);if(!actual)throw Error('Fixed-work action missing.');referenceErrorBB=Math.max(referenceErrorBB,Math.abs(actual.evBB-expected.evBB));}
          if(referenceErrorBB>1e-12||Math.abs(final.equity.equity-fixtures.expected.equity)>1e-12)throw Error('Fixed-work EV/equity mismatch.');
        }
        const cached=await client.analyze(fixtures.normal,{phase:'FINAL',owner});
        rows.push({firstMs,resolutionMs,preview:preview.performance,final:final.performance,warm:cached.performance,samples:final.multiwayEvaluation.samples,referenceErrorBB,precision:final.ev.decisionPrecision.status,metrics:client.metrics()});latest=final;
      }finally{client.close();}
    }
    report({status:'PASS',scope:'NORMAL_CONTEXTUAL_HEURISTIC_SAME_SOURCE',sourceFingerprint:latest.performance.buildFingerprint,first:distribution(rows.map(row=>row.firstMs)),resolution:distribution(rows.map(row=>row.resolutionMs)),warm:distribution(rows.map(row=>row.warm.requestElapsedMs)),rows});
  });
  async function finish(client,input,budget='STANDARD'){
    let result=await client.start(owner,input.input,{budget,revisionKey:input.revisionKey,handId:input.input.multiway.handId,automatic:true});
    while(!['COMPLETE','FAILED','UNSUPPORTED','CANCELLED'].includes(result.phase))result=await client.wait(owner,result.jobId,{afterVersion:result.updateVersion,waitMs:500});
    return result;
  }
  $('river').onclick=()=>run(async()=>{
    const rows=[];
    for(const fixture of fixtures.solver){for(let i=0;i<(fixture.expectedRefusal?1:3);i++){
      const client=TheibsBrowserSolverClient.create();
      try{const result=await finish(client,fixture);
        if(fixture.expectedRefusal){
          if(result.phase!=='UNSUPPORTED'||result.result?.status!=='NOT_SOLVED'||result.result?.actions?.length||result.result?.reasons?.[0]?.code!==fixture.expectedRefusal)throw Error('Atomic refusal contract failed: '+fixture.id);
          rows.push({fixtureId:fixture.id,combos:fixture.combos,maxAggressions:fixture.maxAggressions,phase:result.phase,status:result.result.status,refusal:fixture.expectedRefusal,timing:result.timing,buildFingerprint:result.buildFingerprint,metrics:client.stats()});
          continue;
        }
        const warm=await finish(client,fixture,'FAST');
        if(!result.result?.actions?.length||result.result.abstraction?.compatibleWorlds!==fixture.combos**2)throw Error('River capacity incomplete.');
        if(result.result.qualification.gto!==false||result.result.qualification.fullHandEquilibrium!==false)throw Error('Invalid scope upgrade.');
        rows.push({fixtureId:fixture.id,combos:fixture.combos,maxAggressions:fixture.maxAggressions,buildFingerprint:result.buildFingerprint,phase:result.phase,status:result.result.status,precision:result.result.decisionPrecision?.status,outcome:result.result.decisionOutcome?.status,
          worlds:result.result.abstraction.compatibleWorlds,timing:result.timing,costs:result.result.metrics?.costs,nashConv:result.result.convergence?.nashConv,
          bounds:result.result.actionPrecision?.actions.map(({id,lowerBB,upperBB,certified})=>({id,lowerBB,upperBB,certified})),warm:{cache:warm.cache,timing:warm.timing},metrics:client.stats()});
      }finally{client.close();}
    }}
    report({status:'PASS',scope:'RIVER_HU_EXACT_DECLARED_TREES_48MIB',policy:{initialTimeMs:3000,initialWorkIterations:1000,adaptiveTimeMs:5000},groups:fixtures.solver.filter(fixture=>!fixture.expectedRefusal).map(fixture=>{const data=rows.filter(row=>row.fixtureId===fixture.id);return {fixtureId:fixture.id,combos:fixture.combos,maxAggressions:fixture.maxAggressions,first:distribution(data.map(row=>row.timing.firstValueMs)),resolution:distribution(data.map(row=>row.timing.completionMs)),bounds:distribution(data.map(row=>row.costs?.actionCertificateMs||0))};}),refusals:rows.filter(row=>row.refusal),rows});
  });
  $('cancel').onclick=()=>run(async()=>{
    const client=TheibsBrowserMultiwayClient.create(),controller=new AbortController();
    try{const pending=client.analyze(fixtures.normal,{owner,signal:controller.signal});controller.abort();let cancelled=false;try{await pending;}catch(error){cancelled=error.name==='AbortError';}
      const recovered=await client.analyze(fixtures.normal,{owner});if(!cancelled||recovered.status!=='OK')throw Error('Cancellation/recovery failed.');show(recovered);report({status:'PASS',scope:'CANCELLED_OBSOLETE_REQUEST_AND_RECOVERED',metrics:client.metrics()});
    }finally{client.close();}
  });
  fetch('/browser-multiway-fixtures.json',{cache:'no-store'}).then(response=>response.json()).then(value=>{fixtures=value;$('status').textContent='Ready';}).catch(error=>report({status:'FAIL',reason:error.message}));
})();
