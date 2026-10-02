'use strict';
const validation = requireBrowserModule('src/simulation-validation.js');
globalThis.TheibsBatchValidation = Object.freeze({manifest:browserMultiwayManifest,begin:validation.begin,step:validation.step});
if (typeof globalThis.addEventListener === 'function' && typeof globalThis.postMessage === 'function') {
  const send = value => globalThis.postMessage({...value,buildFingerprint:browserMultiwayManifest.buildFingerprint});
  let batch = null;
  globalThis.addEventListener('message', event => {
    const message = event.data || {}, identity = {jobId:message.jobId,generation:message.generation};
    try {
      if (typeof message.jobId !== 'string' || !Number.isSafeInteger(message.generation) ||
          message.expectedBuildFingerprint !== browserMultiwayManifest.buildFingerprint) throw Error('Validation identity or build changed. Start a new batch.');
      if (message.type === 'begin') batch = validation.begin(message.payload,message.options);
      else if (message.type === 'resume') {batch = message.batch; validation.step(batch,1);}
      else if (message.type === 'step' && batch) validation.step(batch);
      else throw Error('Invalid validation request.');
      send({type:'checkpoint',...identity,batch});
    } catch (error) {send({type:'error',...identity,error:error.message});}
  });
  send({type:'ready'});
}
