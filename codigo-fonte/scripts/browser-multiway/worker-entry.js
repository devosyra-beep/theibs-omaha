'use strict';
const request = requireBrowserModule('src/multiway-compute-request.js');
const continuation = requireBrowserModule('src/continuation-strategy.js');
const fast = requireBrowserModule('src/fast-evaluator.js');
const ledger = requireBrowserModule('src/multiway-session.js');
const profiles = requireBrowserModule('src/player-profiles.js');
function operate(operation,payload) {
  const calls={start:()=>ledger.start(payload.config,payload.previousMultiway,payload.expectedRevisionKey),
    state:()=>ledger.envelope(payload.multiway),step:()=>ledger.step(payload.multiway,payload.event,payload.expectedRevision,payload.expectedRevisionKey),
    undo:()=>ledger.undo(payload.multiway,payload.expectedRevisionKey),
    'review-action':()=>ledger.reviewAction(payload.multiway,payload.selection,payload.expectedRevisionKey),
    'correct-action':()=>ledger.correctAction(payload.multiway,payload.change,payload.expectedRevisionKey),
    'adjust-stack':()=>ledger.adjustStack(payload.multiway,payload.change,payload.expectedRevisionKey),
    'correct-button':()=>ledger.correctButton(payload.multiway,payload.change,payload.expectedRevisionKey),
    'restart-hand':()=>ledger.restartHand(payload.multiway,payload.options || {},payload.expectedRevisionKey),
    'next-hand':()=>ledger.nextHand(payload.multiway,payload.options || {},payload.expectedRevisionKey),
    'preview-sequence':()=>ledger.previewSequence(payload.multiway,payload.commands,payload),
    batch:()=>ledger.batch(payload.multiway,payload.commands,payload),
    observations:()=>{const observed=ledger.envelope(payload.multiway);return {status:'OK',...profiles.deriveObservations(observed.multiway),sourceRevisionKey:observed.state.revisionKey};}};
  if(!Object.hasOwn(calls,operation))throw Error('Invalid ledger operation.');
  const result=calls[operation]();
  if(result.multiway && result.state)result.playerObservations={status:'OK',...profiles.deriveObservations(result.multiway),sourceRevisionKey:result.state.revisionKey};
  return {...result,engineBuild:browserMultiwayManifest.engineBuild};
}
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
globalThis.TheibsBrowserMultiway=Object.freeze({manifest:browserMultiwayManifest,prepare:request.prepare,execute,operate,
  evaluateContinuation:continuation.evaluateContinuation,crypto:browserNodeAdapters['node:crypto']});
if(typeof globalThis.addEventListener==='function'&&typeof globalThis.postMessage==='function') {
  const send=value=>globalThis.postMessage({...value,buildFingerprint:browserMultiwayManifest.buildFingerprint});
  globalThis.addEventListener('message',event=>{
    const message=event.data||{},context={jobId:message.jobId,generation:message.generation};
    try {
      if(!['analyze','ledger'].includes(message.type)||typeof message.jobId!=='string'||!message.jobId||!Number.isSafeInteger(message.generation)||message.generation<0)throw Error('Invalid calculation identity.');
      if(message.expectedBuildFingerprint!==browserMultiwayManifest.buildFingerprint)throw Error('The browser calculation build changed. Refresh the app.');
      const result=message.type==='ledger'?operate(message.operation,message.payload):execute(message.payload,{phase:message.phase});
      const requestFingerprint=browserNodeAdapters['node:crypto'].createHash('sha256').update(JSON.stringify(message.type==='ledger'?{operation:message.operation,payload:message.payload}:message.payload)).digest('hex');
      send({type:'done',...context,requestFingerprint,result});
    }catch(error){send({type:'error',...context,error:error.message,code:'BROWSER_CALCULATION_ERROR'});}
  });
  send({type:'ready',schemaVersion:browserMultiwayManifest.schemaVersion});
}
