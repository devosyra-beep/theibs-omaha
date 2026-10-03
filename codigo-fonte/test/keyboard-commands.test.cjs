'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {resolveKey,BINDINGS,CommandQueue}=require('../public/keyboard-commands');
const key=(value,lang='pt-BR',pending={})=>resolveKey({key:value},lang,pending);
test('one semantic map keeps ranks, actions and suit boundaries in both languages',()=>{
  for(const lang of Object.keys(BINDINGS)){
    assert.deepEqual(key('q',lang),{type:'CARD_RANK',rank:'Q'});
    assert.deepEqual(key('D',lang),{type:'CARD_RANK',rank:'T'});
    assert.deepEqual(key('T',lang),{type:'CARD_RANK',rank:'T'});
    for(const suit of 'ECOP')assert.deepEqual(key(suit,lang,{rank:'A'}),{type:'CARD_SUIT',suit});
    for(const [k,type]of [['f','FOLD'],['g','MATCH'],['h','AGGRESSIVE']])assert.deepEqual(key(k,lang,{rank:'A'}),{type});
    assert.equal(key('m',lang),null);assert.equal(key(';',lang),null);
  }
  assert.equal(BINDINGS['pt-BR'].ten,'D');assert.equal(BINDINGS['en-US'].ten,'T');
});
test('navigation, editing and native modifiers remain distinct commands',()=>{
  for(const [k,type] of [['ArrowUp','PREVIOUS_PLAYER'],['ArrowDown','NEXT_PLAYER'],['ArrowLeft','PREVIOUS_CARD'],['ArrowRight','NEXT_CARD'],['Enter','CONFIRM'],['Backspace','BACKSPACE'],["'",'NEW_GAME']])assert.deepEqual(key(k),{type});
  assert.equal(key('Shift'),null);
  assert.deepEqual(key('0','pt-BR',{ten:true}),{type:'CARD_RANK',rank:'T'});
  assert.equal(resolveKey({key:'f',isComposing:true},'pt-BR'),null);
  assert.equal(resolveKey({key:'f',altKey:true},'pt-BR'),null);
  assert.equal(resolveKey({key:'f',ctrlKey:true},'pt-BR'),null);
});
test('serialized commands preserve bursts and recover after a failed operation',async()=>{
  const applied=[],errors=[],queue=new CommandQueue(error=>errors.push(error.message));
  const first=queue.push(async()=>{await new Promise(r=>setTimeout(r,20));applied.push('fold');});
  const failure=queue.push(async()=>{throw Error('invalid size');});
  const last=queue.push(async()=>applied.push('call'));
  await Promise.allSettled([first,failure,last]);await queue.idle();
  assert.deepEqual(applied,['fold','call']);assert.deepEqual(errors,['invalid size']);assert.equal(queue.size,0);
});
