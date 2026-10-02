'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const review = require('../public/player-decision-review');
function payload() { return {seed:'42',multiway:{handId:'hand',config:{players:[{playerId:'a'},{playerId:'hero_x'}]},events:[{type:'ACT',actor:0,action:'CALL'}]},multiwayEvaluation:{revisionKey:'rev',assumeNoRake:true,ranges:[{seatId:0,range:{hands:[{cards:['As','Ks','Qs','Js','Ts'],weight:1}]}}],profileSnapshot:{handId:'hand',source:'PRE_HAND_OBSERVATIONS',players:{a:{observations:10,contexts:{context:{counts:{CALL:10}}}},hero_x:{observations:0,contexts:{}}}}}}; }
function result(values=[0,1]) { return {status:'OK',engineBuild:'0.14.10',observedState:{handId:'hand'},ev:{bigBlind:1,feeBasis:'BEFORE_FEES',comparisonScope:'FINITE_SIZE_GRID_FIXED_CONTEXTUAL_CONTINUATION_POLICY',candidates:values.map((evBB,index)=>({optionId:index?'CALL':'FOLD',action:index?'CALL':'FOLD',status:'MODELED',evBB}))},multiwayEvaluation:{revisionKey:'rev',model:'MULTIWAY_CONTEXT_POLICY_V1',profileSnapshotHash:'hash',samples:32,elapsedMs:100}}; }
test('same roster follows identities relative to Hero, without matching names',()=>{
  const config={players:[{playerId:'b',name:'Same'},{playerId:'hero_x'},{playerId:'a',name:'Same'}]},saved=[{playerId:'a'},{playerId:'b'}];
  assert.deepEqual(review.currentRoster(config,1,saved,3),['a','b']);
  assert.equal(review.currentRoster(config,1,saved,2),null);
  assert.equal(review.currentRoster(config,1,saved.slice(0,1),3),null);
  assert.equal(review.currentRoster({players:[{playerId:'a'},{playerId:'hero_x'},{playerId:'a'}]},1,saved,3),null);
});
test('reference contrast changes only frozen opponent evidence, never ranges, events or source storage',()=>{
  const input=payload(),before=structuredClone(input),reference=review.referencePayload(input);
  assert.deepEqual(input,before);
  assert.deepEqual(reference.multiway,input.multiway); assert.deepEqual(reference.multiwayEvaluation.ranges,input.multiwayEvaluation.ranges);
  assert.deepEqual(reference.multiwayEvaluation.profileSnapshot.players.a,{observations:0,contexts:{}});
  assert.deepEqual(reference.multiwayEvaluation.profileSnapshot.players.hero_x,input.multiwayEvaluation.profileSnapshot.players.hero_x);
  assert.throws(()=>review.referencePayload({...input,multiway:{handId:'other'}}),/match/);
});
test('comparison reports model sensitivity, preserves negative EV and does not certify adaptation gain',()=>{
  const report=review.compare(payload(),result([0,-1]),result([0,-2]));
  assert.equal(report.status,'READY');assert.equal(report.rows[1].changeBB,1);assert.equal(report.rows[1].profileEVBB,-1);
  assert.equal(report.precision,'NOT_CERTIFIED');assert.equal(report.uncertainty,'PROFILE_UNCERTAINTY_NOT_PROPAGATED');
});
test('stale hand, revision, utility basis, versions and solver provenance cannot be compared',()=>{
  for(const change of [r=>r.observedState.handId='other',r=>r.multiwayEvaluation.revisionKey='old',r=>r.multiwayEvaluation.model='CFR+',r=>r.engineBuild='new',r=>r.ev.bigBlind=2,r=>r.ev.feeBasis='NO_RAKE',r=>r.ev.comparisonScope='OTHER',r=>r.ev.candidates.pop()]){
    const ref=result();change(ref);assert.equal(review.compare(payload(),result(),ref).status,'UNAVAILABLE');
  }
});
test('missing sampled values remain absent; incompatible or duplicate action grids are rejected',()=>{
  const ref=result();ref.ev.candidates[1].status='NOT_MODELED';ref.ev.candidates[1].evBB=null;
  const report=review.compare(payload(),result(),ref);assert.equal(report.rows[1].profileEVBB,null);assert.equal(report.rows[1].changeBB,null);
  ref.ev.candidates[1].optionId='FOLD';assert.equal(review.compare(payload(),result(),ref).status,'UNAVAILABLE');
});
