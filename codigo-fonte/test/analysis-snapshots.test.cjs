'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const snapshots=require('../public/analysis-snapshots');
const input={variant:'PLO4_HIGH',heroCards:['As','Ks','Qh','Jh'],board:['2s','3h','4d'],street:'FLOP',players:2,rake:0,opponentRange:'uniform'};
const fixture={schemaVersion:2,engineBuild:'test',analysisId:'one',input,street:'FLOP',equity:.5};
test('board extension preserves prior street; changed board, opponents, rake, range and build invalidate',()=>{
  assert.equal(snapshots.compatible(fixture,{...input,board:[...input.board,'7c'],street:'TURN'},'test'),true);
  for(const patch of [{board:['2c','3h','4d']},{board:[]},{players:3},{rake:1},{opponentRange:'tight'},{heroCards:['Ac','Ks','Qh','Jh']}])
    assert.equal(snapshots.compatible(fixture,{...input,...patch},'test'),false,JSON.stringify(patch));
  assert.equal(snapshots.compatible(fixture,input,'new'),false);
  assert.equal(snapshots.compatible({...fixture,schemaVersion:1},input,'test'),false);
});
test('chronological streets and legacy records do not become current scientific evidence',()=>{
  assert.deepEqual(snapshots.ordered([{street:'RIVER'},{street:'PREFLOP'},{street:'FLOP'}]).map(x=>x.street),['PREFLOP','FLOP','RIVER']);
  const items=[{...fixture},{...fixture,schemaVersion:1}];
  snapshots.invalidate(items,input,'test');assert.equal(items[0].stale,undefined);assert.equal(items[1].stale,true);
  snapshots.invalidate(items,{...input,rake:2},'test');assert.equal(items[0].stale,true);
});
