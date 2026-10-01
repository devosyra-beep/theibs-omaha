'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const comparison=require('../src/solver/decision-outcome');
const codec=require('../public/browser-solver-checkpoint-codec');
const source=fs.readFileSync(path.join(__dirname,'../scripts/browser-solver/worker-entry.js'),'utf8'),fingerprint='a'.repeat(64);
function fixture(){
  const sent=[],calls=[];let receive;
  const modules={
    'src/solver/job-worker.js':{execute:(args,dependencies)=>{calls.push({args,dependencies});return {result:{status:'NOT_SOLVED'},workerMs:0};}},
    'src/multiway-session.js':{envelope:multiway=>({multiway,state:{revisionKey:'revision'}})},
    'src/solver/decision-outcome.js':comparison,'src/solver/plo-river-game.js':{HU_SUPPORT:require('../src/solver/plo-river-game').HU_SUPPORT},'src/solver/extensive-solver.js':{},'src/solver/action-conditioned.js':{},
  };
  vm.runInNewContext(source,{requireBrowserModule:name=>modules[name],TheibsBrowserSolverCheckpointCodec:codec,browserSolverManifest:{schemaVersion:1,buildFingerprint:fingerprint},
    browserNodeAdapters:{'node:crypto':{}},structuredClone,performance:{now:()=>0},addEventListener:(_name,handler)=>{receive=handler;},postMessage:message=>sent.push(message)});
  return {sent,calls,solve:input=>receive({data:{type:'solve',jobId:'job',generation:1,expectedBuildFingerprint:fingerprint,expectedRevisionKey:'revision',checkpointTransportVersion:codec.VERSION,
    budget:{timeMs:3000,iterations:1000},input:{multiway:{handId:'hand',config:{playerCount:2}},ranges:[],sizing:{},rake:{},...input}}})};
}
test('browser worker forwards only the normalized comparison policy and keeps compilation capability trusted',()=>{
  for(const value of [undefined,{}, {nearEquivalenceBB:.02}]){
    const worker=fixture();worker.solve({comparisonPolicy:value,compilationReuse:false,untrustedField:true});assert.equal(worker.calls.length,1);
    const {args,dependencies}=worker.calls[0];assert.deepEqual(args.input.comparisonPolicy,comparison.normalizePolicy(value));
    assert.equal(args.input.compilationReuse,undefined);assert.equal(args.input.untrustedField,undefined);assert.deepEqual({...dependencies},{compilationReuse:true});
    assert.equal(worker.sent.at(-1).type,'done');assert.equal(worker.sent.at(-1).revisionKey,'revision');
  }
});
test('invalid comparison policy is rejected before browser solver execution',()=>{
  for(const comparisonPolicy of [null,{nearEquivalenceBB:null},{nearEquivalenceBB:-1},{nearEquivalenceBB:Infinity},{scope:'CURRENT_HAND'}]){
    const worker=fixture();worker.solve({comparisonPolicy});assert.equal(worker.calls.length,0);assert.equal(worker.sent.at(-1).type,'error');
  }
});
