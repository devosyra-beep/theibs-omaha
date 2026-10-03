'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {keyForPlayer,playerForKey,resolveWinnerKey,bind}=require('../public/multiway-result-keys');
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
test('Backspace returns through winner selections without changing the hand and leaves native editing alone',()=>{
  const listeners=new Map(),fields=[],changes=[];let back=0,busy=false,current={...state,handId:'hand-one'};
  const dispatch=(type,event={})=>{event.target??=dialog;for(const listener of listeners.get(type)||[])listener(event);};
  const dialog={open:true,ownerDocument:{defaultView:{Event:class{constructor(type){this.type=type;}}}},
    contains:field=>fields.includes(field),querySelector:()=>fields[0],querySelectorAll:()=>fields,
    addEventListener(type,listener){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(listener);},
    removeEventListener(type,listener){listeners.get(type)?.delete(listener);}};
  for(const player of state.players)fields.push({value:String(player.id),dataset:{mwPot:'0'},checked:false,disabled:false,tagName:'INPUT',type:'checkbox',
    closest(){return this;},focus(){dispatch('focusin',{target:this});},dispatchEvent(event){dispatch(event.type,{target:this});changes.push(this.value);}});
  const dispose=bind({dialog,getState:()=>current,isBusy:()=>busy,onBack:()=>back++});
  const key=(value,options={})=>{const event={key:value,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...options};dispatch('keydown',event);return event;};
  const winner=id=>fields.find(field=>Number(field.value)===id);
  key('1');key('0');assert.equal(winner(3).checked,true);assert.equal(winner(2).checked,true);
  key('Backspace',{repeat:true});assert.equal(winner(2).checked,true);
  const native={tagName:'INPUT',type:'number',closest(){return this;}};
  assert.equal(key('Backspace',{target:native}).defaultPrevented,undefined);assert.equal(winner(2).checked,true);
  busy=true;key('Backspace');busy=false;assert.equal(winner(2).checked,true);
  key('Backspace');assert.equal(winner(2).checked,false);assert.equal(winner(3).checked,true);
  key('Backspace');assert.equal(winner(3).checked,false);assert.equal(back,0);
  key('Backspace');assert.equal(back,1);assert.equal(current.handId,'hand-one');assert.equal(changes.length,4);
  key('1');current={...current,handId:'hand-two'};key('Backspace');assert.equal(back,2);assert.equal(winner(3).checked,true);
  dispose();key('0');assert.equal(winner(2).checked,false);
});
