'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {keyForPlayer,playerForKey,resolveWinnerKey}=require('../public/multiway-result-keys');
const state={heroId:2,players:[{id:0},{id:1},{id:2,hero:true},{id:3}],pots:[{eligible:[0,1,2,3]},{eligible:[0,1]}]};
test('result numbers match Hero-relative seats, not positional IDs or names',()=>{
  assert.deepEqual(state.players.map(player=>keyForPlayer(player,state)),['2','3','0','1']);
  assert.equal(playerForKey('1',state).id,3);assert.equal(playerForKey('0',state).id,2);
  assert.equal(playerForKey('9',state),null);assert.equal(playerForKey('H',state),null);
  const rotated={...state,heroId:1,players:[{id:0,playerId:'beforeHero'},{id:1,hero:true},{id:2,playerId:'sameA1'},{id:3}]};
  assert.equal(keyForPlayer(rotated.players[2],rotated),'1');
});
test('winner selection only toggles eligible players in the active pot',()=>{
  assert.deepEqual(resolveWinnerKey({key:'1'},{state}),{type:'TOGGLE_WINNER',key:'1',potIndex:0,playerId:3});
  assert.equal(resolveWinnerKey({key:'1'},{state,potIndex:1}).type,'REJECT_WINNER');
  assert.match(resolveWinnerKey({key:'1'},{state,potIndex:1}).message,/not eligible/);
  assert.deepEqual(resolveWinnerKey({key:'2'},{state,potIndex:1}),{type:'TOGGLE_WINNER',key:'2',potIndex:1,playerId:0});
  assert.equal(resolveWinnerKey({key:'9'},{state}).type,'REJECT_WINNER');
});
test('native amounts, repeat, composition and modified keys never choose winners; H and Enter remain separate',()=>{
  for(const event of [{key:'H'},{key:'Enter'},{key:'1',repeat:true},{key:'1',isComposing:true},{key:'1',keyCode:229},{key:'1',ctrlKey:true},{key:'1',altKey:true},{key:'1',metaKey:true},{key:'1',shiftKey:true},{key:'1',defaultPrevented:true},{key:'1',getModifierState:name=>name==='AltGraph'}])assert.equal(resolveWinnerKey(event,{state}),null);
  for(const context of [{editing:true},{busy:true},{enabled:false}])assert.equal(resolveWinnerKey({key:'1'},{state,...context}),null);
});
