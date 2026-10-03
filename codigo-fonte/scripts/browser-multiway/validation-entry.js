'use strict';
const validation = requireBrowserModule('src/simulation-validation.js');
globalThis.TheibsBatchValidation = Object.freeze({manifest:browserMultiwayManifest,begin:validation.begin,step:validation.step});
if (typeof globalThis.addEventListener === 'function' && typeof globalThis.postMessage === 'function') {
  const send = value => globalThis.postMessage({...value,buildFingerprint:browserMultiwayManifest.buildFingerprint});
  function validCheckpoint(value,expected){
    const positive=number=>Number.isFinite(number)&&number>=0;
    if(!Number.isInteger(value.count)||value.count<0||value.count>expected.worlds||!positive(value.computeMs)||!positive(value.predictionMs)||
      !positive(value.sumWeight)||!positive(value.sumWeightSquared)||!Number.isInteger(value.leaderChanges)||value.leaderChanges<0||!Array.isArray(value.checkpoints)||value.checkpoints.length>128||
      value.sumWeight>value.count+1e-8||value.sumWeightSquared>value.sumWeight+1e-8||
      value.sumWeight**2>value.count*value.sumWeightSquared+1e-8||value.count===0&&(value.sumWeight!==0||value.sumWeightSquared!==0)||
      value.count>0&&!(value.sumWeight>0&&value.sumWeightSquared>0)||!['RUNNING','COMPLETE','PARTIAL_BUDGET'].includes(value.status)||
      value.status==='COMPLETE'&&value.count!==expected.worlds||value.status==='RUNNING'&&value.count>=expected.worlds||
      value.status==='PARTIAL_BUDGET'&&value.computeMs<expected.budgetMs||!Array.isArray(value.sums)||value.sums.length!==expected.candidates.length||
      !value.sums.every(number=>Number.isFinite(number)&&number>=expected.lower*value.sumWeight-1e-7&&number<=expected.upper*value.sumWeight+1e-7)||
      !Array.isArray(value.prediction?.candidates)||value.prediction.candidates.length!==expected.candidates.length)return false;
    return value.prediction.candidates.every((row,index)=>row?.optionId===expected.candidates[index].optionId&&row.action===expected.candidates[index].action&&
      row.size===expected.candidates[index].size&&typeof row.status==='string'&&(row.ev==null||Number.isFinite(row.ev))&&(row.status!=='MODELED'||Number.isFinite(row.ev))&&
      (row.confidenceInterval95==null||Array.isArray(row.confidenceInterval95)&&row.confidenceInterval95.length===2&&row.confidenceInterval95.every(Number.isFinite)&&row.confidenceInterval95[0]<=row.confidenceInterval95[1]));
  }
  let batch = null, binding = null;
  globalThis.addEventListener('message', event => {
    const message = event.data || {}, identity = {jobId:message.jobId,generation:message.generation,requestId:message.requestId};
    try {
      if (typeof message.jobId !== 'string' || !Number.isSafeInteger(message.generation) ||typeof message.requestId!=='string'||message.requestId.length<8||message.requestId.length>100||
          message.expectedBuildFingerprint !== browserMultiwayManifest.buildFingerprint) throw Error('Validation identity or build changed. Start a new batch.');
      if (message.type === 'begin') {batch = validation.begin(message.payload,message.options);binding={...identity,contextFingerprint:batch.fingerprint};}
      else if (message.type === 'resume') {
        const expected=validation._testing.context(message.payload,message.options),checkpoint=message.batch;
        if(!checkpoint||checkpoint.schema!==validation.VERSION||checkpoint.fingerprint!==expected.fingerprint||
          JSON.stringify(checkpoint.publicInput)!==JSON.stringify(expected.input)||checkpoint.editEpoch!==expected.editEpoch||
          checkpoint.seed!==expected.seed||checkpoint.requestedWorlds!==expected.worlds||checkpoint.budgetMs!==expected.budgetMs||!validCheckpoint(checkpoint,expected))throw Error('The validation checkpoint does not match its frozen decision, seed, budget or counters. Start a fresh batch.');
        batch=checkpoint;binding={...identity,contextFingerprint:expected.fingerprint};validation.step(batch,1);
      }
      else if (message.type === 'step' && batch&&binding&&message.jobId===binding.jobId&&message.generation===binding.generation&&message.requestId===binding.requestId) validation.step(batch);
      else throw Error('Invalid validation request.');
      send({type:'checkpoint',...identity,contextFingerprint:binding.contextFingerprint,batch});
    } catch (error) {send({type:'error',...identity,error:error.message});}
  });
  send({type:'ready'});
}
