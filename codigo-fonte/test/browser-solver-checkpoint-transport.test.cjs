'use strict';
// Transport ownership and schema tests only; no solver performance workload.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const codec=require('../public/browser-solver-checkpoint-codec');
const comparison=require('../src/solver/decision-outcome');
const versions={adaptive:'ADAPTIVE_TEST_V1',solver:'SOLVER_TEST_V1',certificate:'CERTIFICATE_TEST_V1'};
const policyKey=comparison.policyKey(),fingerprint='a'.repeat(64);
function checkpoint(){
  const cfr=()=>({version:versions.solver,gameHash:'b'.repeat(64),iterations:4,averagingDelay:0,
    regrets:[[0,-0,Number.MIN_VALUE],[Math.PI,Number.MAX_VALUE]],strategySums:[[1,2,3],[4,5]]});
  return {version:versions.adaptive,solverVersion:versions.solver,certificateVersion:versions.certificate,comparisonPolicyKey:policyKey,
    global:cfr(),actionCheckpoints:{'BET:4':cfr()},actionCertificates:{'BET:4':{certified:true,lowerBB:-2,upperBB:3,boundsBB:[-2,3]}},
    workIterations:8,iterations:4,costs:{totalComputeMs:17},lastDiagnostics:{actions:[{id:'BET:4',ev:-.5,frequency:1}]}};
}
const expected={adaptiveVersion:versions.adaptive,solverVersion:versions.solver,certificateVersion:versions.certificate,policyKey};
test('binary transport round-trips only numerical matrices with exact binary64 values and unchanged metadata',()=>{
  const source=checkpoint(),before=structuredClone(source),packet=codec.pack(source);
  assert.equal(packet.encoding,codec.VERSION);assert.equal(packet.matrices.length,4);assert.equal(packet.data.byteLength,160);
  assert.deepEqual(codec.unpack(packet,expected),before);assert.deepEqual(source,before);
  assert.ok(Object.is(codec.unpack(packet).global.regrets[0][1],-0));
  assert.deepEqual(packet.checkpoint.actionCertificates,source.actionCertificates);
  assert.deepEqual(packet.checkpoint.global.regrets,{transportMatrix:0});
  assert.equal(codec.byteLength(packet),packet.data.byteLength+new TextEncoder().encode(JSON.stringify({encoding:packet.encoding,checkpoint:packet.checkpoint,matrices:packet.matrices})).byteLength);
});
test('native transfers detach only owned transport buffers; cache and solver arrays survive repeated resume copies',()=>{
  const source=checkpoint(),outgoing=codec.pack(source),host=structuredClone(outgoing,{transfer:codec.transfers(outgoing)});
  assert.equal(outgoing.data.byteLength,0);assert.throws(()=>codec.validate(outgoing));
  assert.deepEqual(codec.unpack(host),source);assert.equal(source.global.regrets[1][0],Math.PI);
  for(let count=0;count<2;count++){
    const resume=codec.copyForTransfer(host),worker=structuredClone(resume.packet,{transfer:resume.transfer});
    assert.equal(resume.packet.data.byteLength,0);assert.equal(host.data.byteLength,160);assert.deepEqual(codec.unpack(worker),source);
    new Float64Array(worker.data)[0]=999;assert.equal(codec.unpack(host).global.regrets[0][0],0);
  }
  const decoded=codec.unpack(host);decoded.global.regrets[0][0]=888;decoded.actionCertificates['BET:4'].lowerBB=-100;
  assert.deepEqual(codec.unpack(host),source);
});
test('schema, lengths, offsets, duplicates, metadata and numerical corruption fail closed before decoding',()=>{
  const changes=[
    value=>{value.encoding='OLD';},value=>{value.data=new ArrayBuffer(7);},
    value=>{value.data=new ArrayBuffer(codec.MAX_DATA_BYTES+8);},value=>{value.data=new SharedArrayBuffer(160);},
    value=>{value.matrices.push(value.matrices[0]);},value=>{value.matrices[1].path=value.matrices[0].path;},
    value=>{value.matrices[0].path=['global','payoffs'];},value=>{value.matrices[0].offset=1;},
    value=>{value.matrices[0].length--;},value=>{value.matrices[0].rowLengths[0]=-1;},
    value=>{value.matrices[0].rowLengths=Array(codec.MAX_ROWS+1).fill(0);},
    value=>{value.checkpoint.global.regrets.transportMatrix=1;},value=>{value.checkpoint.global.regrets.extra=true;},
    value=>{delete value.checkpoint.global.strategySums;},value=>{value.checkpoint.workIterations=-1;},
    value=>{value.checkpoint.global.version='OTHER';},value=>{value.checkpoint.version='OTHER';},
    value=>{value.checkpoint.solverVersion='OTHER';},value=>{value.checkpoint.certificateVersion='OTHER';},
    value=>{value.checkpoint.comparisonPolicyKey='OTHER';},value=>{new Float64Array(value.data)[0]=NaN;},
    value=>{new Float64Array(value.data)[0]=Infinity;},value=>{new Float64Array(value.data)[0]=-1;},
    value=>{value.checkpoint.lastDiagnostics.actions[0].ev=Infinity;},
  ];
  for(const [index,change]of changes.entries()){
    const value=codec.pack(checkpoint());change(value);assert.throws(()=>codec.unpack(value,expected),/checkpoint transport/,String(index));
  }
  const cycle=checkpoint();cycle.lastDiagnostics.self=cycle;assert.throws(()=>codec.pack(cycle));
  const accessor=checkpoint();Object.defineProperty(accessor,'private',{get:()=>1,enumerable:true});assert.throws(()=>codec.pack(accessor));
});
test('aliased input matrices are encoded by path, without changing unrelated metadata or empty games',()=>{
  const source=checkpoint();source.global.strategySums=source.global.regrets;source.lastDiagnostics.sameValues=source.global.regrets;
  assert.deepEqual(codec.unpack(codec.pack(source)),source);
  const empty={version:versions.solver,iterations:0,regrets:[],strategySums:[]};assert.deepEqual(codec.unpack(codec.pack(empty)),empty);
  assert.deepEqual(codec.copyForTransfer(null),{packet:null,transfer:[]});assert.equal(codec.unpack(null),null);
});
test('worker entry transfers each coherent publication and decodes resume without exposing private state in the QA API',()=>{
  const sent=[],raw=checkpoint(),original=structuredClone(raw);let receive,executed;
  const source=fs.readFileSync(require.resolve('../scripts/browser-solver/worker-entry.js'),'utf8');
  const modules={
    'src/solver/job-worker.js':{execute:(args)=>{
      executed=args;assert.deepEqual(args.checkpoint,original);
      args.onProgress({type:'progress',result:{status:'APPROXIMATE',marker:1},checkpoint:raw,workerMs:10});
      args.onProgress({type:'progress',result:{status:'APPROXIMATE',marker:2},checkpoint:raw,workerMs:20});
      return {result:{status:'APPROXIMATE',marker:3},checkpoint:raw,workerMs:30};
    }},'src/multiway-session.js':{envelope:multiway=>({multiway,state:{revisionKey:'revision'}})},
    'src/solver/decision-outcome.js':comparison,'src/solver/plo-river-game.js':{HU_SUPPORT:{maxWorlds:1024}},
    'src/solver/extensive-solver.js':{},'src/solver/action-conditioned.js':{},
  };
  const surface={requireBrowserModule:name=>modules[name],TheibsBrowserSolverCheckpointCodec:codec,
    browserSolverManifest:{schemaVersion:1,buildFingerprint:fingerprint,versions},browserNodeAdapters:{'node:crypto':{}},
    structuredClone,performance:{now:()=>0},addEventListener:(_name,handler)=>{receive=handler;},
    postMessage:(message,transfer=[])=>{const delivered=structuredClone(message,{transfer});if(message.checkpoint)assert.equal(message.checkpoint.data.byteLength,0);sent.push(delivered);}};
  vm.runInNewContext(source,surface);
  const resume=codec.copyForTransfer(codec.pack(raw)),message=structuredClone({type:'solve',jobId:'job',generation:1,
    expectedBuildFingerprint:fingerprint,expectedRevisionKey:'revision',checkpointTransportVersion:codec.VERSION,
    budget:{timeMs:3000,iterations:1000},checkpoint:resume.packet,
    input:{multiway:{handId:'hand',config:{playerCount:2}},ranges:[],sizing:{},rake:{}}},{transfer:resume.transfer});
  receive({data:message});assert.equal(executed.shouldCancel(),false);
  assert.deepEqual(sent.map(item=>item.type),['ready','progress','progress','done']);
  for(const item of sent.slice(1)){
    assert.equal(item.handId,'hand');assert.equal(item.revisionKey,'revision');assert.equal(item.buildFingerprint,fingerprint);
    assert.deepEqual(codec.unpack(item.checkpoint,expected),original);
  }
  assert.deepEqual(raw,original);assert.equal(typeof surface.TheibsBrowserSolver.execute,'function');
});
