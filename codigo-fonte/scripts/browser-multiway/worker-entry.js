'use strict';
const request = requireBrowserModule('src/multiway-compute-request.js');
const continuation = requireBrowserModule('src/continuation-strategy.js');
const fast = requireBrowserModule('src/fast-evaluator.js');
function execute(payload,{phase}={}) {
  const started=performance.now(), prepared=request.prepare(payload,phase);
  if(prepared.blocked)return {...prepared.blocked,performance:{workerExecutionMs:performance.now()-started,origin:'BROWSER_WEB_WORKER'}};
  // Warm tables once per reusable worker, before the short sampling slice.
  // This startup cost is measured in total latency, never hidden from metrics.
  const initializationStarted=performance.now();fast.initialize();
  const initializationMs=performance.now()-initializationStarted;
  const result=continuation.evaluateContinuation(prepared.input);
  const empty=result.multiwayEvaluation?.samples===0;
  result.analysisStage=prepared.phase==='PREVIEW'||empty?'PROVISIONAL':'FINAL';
  result.performance={workerExecutionMs:performance.now()-started,initializationMs,
    monteCarloSamples:result.multiwayEvaluation?.samples??0,origin:'BROWSER_WEB_WORKER',
    measurementScope:'THIS_DEVICE_EXECUTION_INCLUDING_TABLE_INITIALIZATION'};
  return result;
}
globalThis.TheibsBrowserMultiway=Object.freeze({manifest:browserMultiwayManifest,prepare:request.prepare,execute,
  evaluateContinuation:continuation.evaluateContinuation,crypto:browserNodeAdapters['node:crypto']});
if(typeof globalThis.addEventListener==='function'&&typeof globalThis.postMessage==='function') {
  const send=value=>globalThis.postMessage({...value,buildFingerprint:browserMultiwayManifest.buildFingerprint});
  globalThis.addEventListener('message',event=>{
    const message=event.data||{},context={jobId:message.jobId,generation:message.generation};
    try {
      if(message.type!=='analyze'||typeof message.jobId!=='string'||!message.jobId||!Number.isSafeInteger(message.generation)||message.generation<0)throw Error('Invalid calculation identity.');
      if(message.expectedBuildFingerprint!==browserMultiwayManifest.buildFingerprint)throw Error('The browser calculation build changed. Refresh the app.');
      const result=execute(message.payload,{phase:message.phase});
      const requestFingerprint=browserNodeAdapters['node:crypto'].createHash('sha256').update(JSON.stringify(message.payload)).digest('hex');
      send({type:'done',...context,requestFingerprint,result});
    }catch(error){send({type:'error',...context,error:error.message,code:'BROWSER_CALCULATION_ERROR'});}
  });
  send({type:'ready',schemaVersion:browserMultiwayManifest.schemaVersion});
}
