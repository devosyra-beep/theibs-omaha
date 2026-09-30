'use strict';
// HARNESS: deterministic text-model responses. No real microphone, speech
// recognition accuracy or Ollama latency is asserted by these checks.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const multiway=require('../src/multiway-session');
const assistant=require('../src/multiway-assistant');
const config={provider:'ollama',model:'qa-local-model',baseUrl:'http://127.0.0.1:11434',timeoutMs:3000};
let sequence=0;
function table(){return multiway.start({variant:'PLO5_HIGH',playerCount:6,heroPosition:'BB',startingStack:100,smallBlind:.5,bigBlind:1,heroCards:[]});}
function payload(state,text='The current player matches the amount already wagered.'){
  return{multiway:state.multiway,revisionKey:state.state.revisionKey,text,locale:'en-US',originEventId:`qa-final-${++sequence}`};
}
function mock(command,extra={}){return async()=>({ok:true,json:async()=>({message:{content:JSON.stringify({command,...extra})}})});}
const settings=fetchImpl=>({config,fetchImpl,allowUnvalidated:true,owner:'qa-harness'});
async function mustRefuse(task,pattern){
  let value,error;try{value=await task;}catch(caught){error=caught;}
  assert.ok(error || value?.status!=='PROPOSED','An invalid observation must not become a proposal.');
  if(pattern&&error)assert.match(error.message,pattern);
}

test('natural-language proposal uses current UTG without Hero cards and commits only through validated confirmation',async()=>{
  const state=table(),input=payload(state),before=JSON.stringify(state.multiway);
  const proposed=await assistant.interpret(input,settings(mock('call')));
  assert.equal(proposed.status,'PROPOSED');assert.equal(proposed.confirmationRequired,true);
  assert.equal(proposed.method,'LOCAL_LLM_INTERPRETATION');assert.deepEqual(proposed.event,{type:'ACT',actor:2,action:'CALL'});
  assert.equal(proposed.revisionKey,state.state.revisionKey);assert.equal(proposed.handId,state.multiway.handId);
  assert.equal(JSON.stringify(state.multiway),before);
  const applied=multiway.step(state.multiway,{...proposed.event,originEventId:proposed.originEventId},0,proposed.revisionKey);
  assert.equal(applied.state.actor,3);assert.equal(applied.state.pot,2.5);
  const repeated=multiway.step(applied.multiway,{...proposed.event,originEventId:proposed.originEventId},0,proposed.revisionKey);
  assert.equal(repeated.duplicate,true);assert.equal(repeated.multiway.events.length,1);
});

test('short direct commands need no text model and identical phrases with new origins are distinct actions',async()=>{
  let state=table();let calls=0;
  const fetchImpl=async()=>{calls++;throw Error('The direct parser must not call the model.');};
  for(let index=0;index<2;index++){
    const proposed=await assistant.interpret(payload(state,'call'),settings(fetchImpl));
    assert.equal(proposed.method,'DIRECT_PARSER');assert.equal(proposed.event.actor,index+2);
    state=multiway.step(state.multiway,{...proposed.event,originEventId:proposed.originEventId},state.state.revision,proposed.revisionKey);
  }
  assert.equal(calls,0);assert.equal(state.multiway.events.length,2);assert.equal(state.state.pot,3.5);
});

test('repeated source event reuses one interpretation and conflicting reuse is rejected',async()=>{
  const state=table(),input=payload(state);let calls=0;
  const fetchImpl=async()=>{calls++;return{ok:true,json:async()=>({message:{content:'{"command":"call"}'}})};};
  const a=await assistant.interpret(input,settings(fetchImpl));
  const b=await assistant.interpret(input,settings(fetchImpl));
  assert.deepEqual(a,b);assert.equal(calls,1);
  await assert.rejects(assistant.interpret({...input,text:'The current player throws his cards away.'},settings(mock('fold'))),/source event/);
});

test('stale proposals cannot be requested or applied to a newer decision',async()=>{
  const state=table(),input=payload(state),proposed=await assistant.interpret(input,settings(mock('call')));
  const next=multiway.step(state.multiway,{type:'ACT',actor:2,action:'CALL'});
  await assert.rejects(assistant.interpret({...input,multiway:next.multiway},settings(mock('call'))),/hand changed/);
  assert.throws(()=>multiway.step(next.multiway,{...proposed.event,originEventId:proposed.originEventId},0,proposed.revisionKey),/revision changed/);
});

test('ambiguous and explicitly wrong actors do not become guessed current-player actions',async()=>{
  const state=table();
  for(const text of ['Maybe he called or folded.','Hero throws his cards away.','The BB calls.','A99 throws his cards away.']){
    await mustRefuse(assistant.interpret(payload(state,text),settings(mock('call'))));
  }
});

test('model output cannot invent amounts, swap units, use multiple amounts or ignore negation',async()=>{
  const state=table();
  for(const [text,command] of [
    ['He makes it a total of two chips.','raise to 3 chips'],
    ['He makes it a total of two chips.','raise to 2 bb'],
    ['He raises from two to three chips.','raise to 2 chips'],
    ['He did not fold; he called.','fold'],
    ['He is all in for five chips.','all in']
  ])await mustRefuse(assistant.interpret(payload(state,text),settings(mock(command))));
});

test('English and Portuguese numeric words are validated without changing their unit',async()=>{
  const state=table();
  for(const [text,command] of [['He makes it a total of two chips.','raise to 2 chips'],['Ele aumentou para duas fichas.','raise to 2 chips'],
    ['He makes it a total of two bb.','raise to 2 bb'],['Ele aumentou para dois bb.','raise to 2 bb'],
    ['He makes it a total of two big blinds.','raise to 2 bb']]){
    const proposed=await assistant.interpret(payload(state,text),settings(mock(command)));
    assert.equal(proposed.status,'PROPOSED');assert.equal(proposed.event.to,2);
  }
  await mustRefuse(assistant.interpret(payload(state,'The big blind throws his cards away.'),settings(mock('fold'))));
  await mustRefuse(assistant.interpret(payload(state,'O BB desistiu.'),settings(mock('fold'))));
});

test('partial JSON, extra fields, empty output and unavailable models never record an action',async()=>{
  const state=table(),before=JSON.stringify(state.multiway);
  for(const content of ['{"command":"call"','{"command":"call","execute":true}','']){
    await mustRefuse(assistant.interpret(payload(state),settings(async()=>({ok:true,json:async()=>({message:{content}})}))));
  }
  const unavailable=await assistant.interpret(payload(state),{config,owner:'qa-unvalidated',fetchImpl:async()=>{throw Error('An unvalidated model must not run.');}});
  assert.equal(unavailable.status,'UNAVAILABLE');assert.equal(JSON.stringify(state.multiway),before);
});

test('table priority aborts a pending text request and releases the inference slot',async()=>{
  const state=table();let begin;const started=new Promise(resolve=>{begin=resolve;});
  const fetchImpl=async(_url,{signal})=>new Promise((_resolve,reject)=>{
    const stop=()=>reject(signal.reason||Error('aborted'));
    signal.addEventListener('abort',stop,{once:true});begin();if(signal.aborted)stop();
  });
  const pending=assistant.interpret(payload(state),settings(fetchImpl));
  await started;const release=assistant.prioritize();
  try{await assert.rejects(pending,/priority|abort|cancel/i);}finally{release();}
  const restored=await assistant.interpret(payload(state),settings(mock('call')));
  assert.equal(restored.status,'PROPOSED');
});
