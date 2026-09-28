'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),voice=require('../public/card-voice');
test('a clubs asks for rank, without silently becoming eight or ace',()=>{
 assert.throws(()=>voice.parse('a clubs','en-US'));
 const request=voice.getClarification('a clubs','en-US');assert.equal(request.missing,'rank');
 assert.equal(voice.completeClarification(request,'eight').command.cards[0],'8c');
 assert.equal(voice.completeClarification(request,'ace').command.cards[0],'Ac');
 assert.equal(voice.completeClarification(request,'cancel').command.type,'cancel');
 assert.equal(voice.completeClarification(request,'to').command,null);
});
test('ambiguous rank clarification preserves only an explicitly recognized destination',()=>{
 const request=voice.getClarification('turn a clubs','en-US');
 const command=voice.completeClarification(request,'eight').command;
 assert.equal(command.target,'turn');assert.deepEqual(command.cards,['8c']);
 const selected=voice.completeClarification(voice.getClarification('a clubs','en-US'),'eight').command;
 assert.equal(selected.target,'selected');
});
test('concatenated correction and damaged flop prefix still do not guess cards or targets',()=>{
 for(const [text,locale]of [['correct card 328 of Clubs','en-US'],['por causa de espadas','pt-BR']]){
  assert.throws(()=>voice.parse(text,locale));assert.equal(voice.getClarification(text,locale),null);
 }
});
