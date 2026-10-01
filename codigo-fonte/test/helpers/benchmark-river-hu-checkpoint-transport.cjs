'use strict';
// Bounded checkpoint-only comparison. This measures transport, not solver CPU,
// browser heap, hosting performance or an end-to-end latency guarantee.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MessageChannel } = require('node:worker_threads');
const codec = require('../../public/browser-solver-checkpoint-codec');
const { capacityRiverInput } = require('./river-hu-capacity-fixtures.cjs');
const job = require('../../src/solver/job-worker');
const { performance } = require('node:perf_hooks');
const encoder = new TextEncoder();
const root = path.resolve(__dirname,'../..');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n?/g,'\n')).digest('hex');
const percentile = (values,p) => values.toSorted((a,b)=>a-b)[Math.ceil(values.length*p)-1];
const distribution = values => ({n:values.length,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95)});
async function deliver(value,transfer=[]) {
  const {port1,port2} = new MessageChannel();
  try {
    return await new Promise((resolve,reject)=>{
      port2.once('message',resolve);port2.once('messageerror',reject);
      port1.postMessage(value,transfer);
    });
  } finally { port1.close();port2.close(); }
}
async function baseline(checkpoint) {
  const received = await deliver(checkpoint), began = performance.now();
  const privateJob = structuredClone(received), cache = structuredClone(privateJob);
  const accountedBytes = encoder.encode(JSON.stringify(cache)).byteLength;
  const resume = structuredClone(privateJob), mainThreadMs = performance.now()-began;
  assert.notEqual(privateJob,cache);assert.notEqual(privateJob.global.regrets,cache.global.regrets);
  const returned = await deliver(resume);assert.deepEqual(returned,checkpoint);
  return {mainThreadMs,accountedBytes,simultaneouslyRetainedNumericMatrixGraphs:2,
    explicitHostCheckpointClones:3,nativeStructuredCloneCrossings:2};
}
async function candidate(checkpoint) {
  const packBegan = performance.now(), outgoing = codec.pack(checkpoint), packMs = performance.now()-packBegan;
  const bytes = outgoing.data.byteLength, received = await deliver(outgoing,codec.transfers(outgoing));
  assert.equal(outgoing.data.byteLength,0);
  const began = performance.now();codec.validate(received);
  const accountedBytes = codec.byteLength(received), cache = received, privateJob = received;
  const resume = codec.copyForTransfer(privateJob), mainThreadMs = performance.now()-began;
  assert.equal(cache,privateJob);
  const returned = await deliver(resume.packet,resume.transfer);
  assert.equal(resume.packet.data.byteLength,0);assert.equal(cache.data.byteLength,bytes);
  const unpackBegan = performance.now(), decoded = codec.unpack(returned), unpackMs = performance.now()-unpackBegan;
  assert.deepEqual(decoded,checkpoint);assert.deepEqual(codec.unpack(cache),checkpoint);
  return {mainThreadMs,packMs,unpackMs,accountedBytes,binaryBufferBytes:bytes,
    simultaneouslyRetainedNumericMatrixGraphs:0,simultaneouslyRetainedCompactBuffers:1,
    explicitHostCheckpointClones:0,explicitResumeBufferCopies:1,nativeTransferredCrossings:2};
}
async function main() {
  const cases = [];
  for(const options of [{combos:24,sizings:2,maxAggressions:1},{combos:32,sizings:2,maxAggressions:0}]) {
    const output = job.execute({input:capacityRiverInput(options),budget:{timeMs:3000,iterations:1000}},{compilationReuse:true});
    assert.ok(output.checkpoint?.global?.regrets);const checkpoint = output.checkpoint, observations = [];
    for(let repeat=0;repeat<3;repeat++) observations.push({baseline:await baseline(checkpoint),candidate:await candidate(checkpoint)});
    cases.push({options,gameHash:output.result.gameHash,workIterations:checkpoint.workIterations,
      checkpointDigest:crypto.createHash('sha256').update(JSON.stringify(checkpoint)).digest('hex'),
      exactCheckpointEquality:true,observations,
      baselineHost:distribution(observations.map(row=>row.baseline.mainThreadMs)),
      candidateHost:distribution(observations.map(row=>row.candidate.mainThreadMs)),
      candidatePack:distribution(observations.map(row=>row.candidate.packMs)),
      candidateUnpack:distribution(observations.map(row=>row.candidate.unpackMs))});
  }
  const report = {generatedAt:new Date().toISOString(),baseline:'5ba76316efa7bd55557cb8e7fe7a807bb0442608',
    method:'REAL_CHECKPOINT_NATIVE_MESSAGECHANNEL_PAIRED_HOST_CACHE_RESUME_EMULATION',
    limitations:['Three pairs per checkpoint; p95 is the maximum observed, not a population percentile.',
      'Measured host checkpoint operations exclude public-result cloning and solver work. Pack/unpack run in workers in the app.',
      'Accounted serialized bytes are cache quota units, not JavaScript heap or browser memory. Binary may exceed sparse JSON.',
      'Full worker/import/network/UI latency is measured separately in the native browser fixtures.'],
    sourceDigests:Object.fromEntries(['public/browser-solver-checkpoint-codec.js','public/browser-solver-client.js',
      'scripts/browser-solver/worker-entry.js','src/solver/extensive-solver.js','src/solver/action-conditioned.js'].map(file=>[file,digest(file)])),cases};
  const destination=path.join(root,'docs/benchmarks/river-hu-checkpoint-transport.json');
  fs.writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({destination,cases:cases.map(({options,baselineHost,candidateHost,candidatePack,candidateUnpack,observations})=>
    ({options,baselineHost,candidateHost,candidatePack,candidateUnpack,bytes:observations[0]}))}));
}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
