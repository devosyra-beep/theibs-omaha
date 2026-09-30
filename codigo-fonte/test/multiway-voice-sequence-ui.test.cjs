'use strict';
// HARNESS: deterministic speech finals and mocked interpretation transport.
// This does not establish microphone accuracy or real model latency.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const voice = require('../public/card-voice');
const mw = require('../src/multiway-session');
const { createController } = require('../public/multiway-assistant-ui');
const betting = { enabled: true, phase: 'BETTING' };
function table() { return mw.start({ variant:'PLO5_HIGH', playerCount:6, heroPosition:'BB', startingStack:100, smallBlind:.5, bigBlind:1, heroCards:[] }); }
function harness(t, { capability = { enabled:false }, post, timeoutMs, storage = new Map() } = {}) {
  let envelope = table(), enabled = true, active = true, sequence = 0;
  const calls = [], commits = [], views = [];
  const getContext = () => ({ enabled, active, phase:envelope.state.phase, pendingAmount:false, actor:envelope.state.actor,
    handId:envelope.multiway.handId, revisionKey:envelope.state.revisionKey, token:envelope.state.revisionKey,
    contextKey:'session-1', multiway:envelope.multiway, state:envelope.state });
  const resolve = (packet, captured) => {
    const command = packet.command || voice.parseContextual(packet.text, packet.locale, betting);
    const event = voice.resolveAction(command, captured.state);
    return { command, event, label:`Player ${event.actor} · ${event.action}` };
  };
  const controller = createController({ getContext, resolve, timeoutMs,
    storage:{ getItem:key=>storage.get(key), setItem:(key,value)=>storage.set(key,value) },
    request:async (url, options) => {
      calls.push({url,options});
      if (options.method === 'GET') return { assistant:capability };
      return post ? post(JSON.parse(options.body),options) : {status:'UNAVAILABLE'};
    },
    commit:async ({command,expectedToken,originEventId}) => {
      assert.equal(expectedToken,envelope.state.revisionKey,'confirmation binds the current revision');
      const event=voice.resolveAction(command,envelope.state);commits.push(event);
      envelope=mw.step(envelope.multiway,{type:'ACT',...event,originEventId},envelope.state.revision,envelope.state.revisionKey);
      return {ok:true};
    }, onChange:value=>views.push(value)
  });
  t.after(()=>controller.dispose());
  return {controller,calls,commits,views,storage,
    packet:(text,extra={})=>({text,locale:'en-US',originEventId:`harness-final-${++sequence}`,...extra}),
    get:()=>envelope, set:value=>{envelope=value;}, setEnabled:value=>{enabled=value;}, setActive:value=>{active=value;},
    manual:action=>{envelope=mw.step(envelope.multiway,{type:'ACT',actor:envelope.state.actor,action},envelope.state.revision,envelope.state.revisionKey);}
  };
}
const remote={enabled:true,provider:'cloudflare',model:'harness-only',processing:'REMOTE_TEXT_ONLY',validatedUses:['ACTION_PROPOSAL']};
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));

test('known action sequences use complete local grammar, preserving sizing and explicit actors',()=>{
  assert.deepEqual(voice.parseActionSequence('call call fold','en-US',betting).commands.map(c=>c.action),['CALL','CALL','FOLD']);
  const mixed=voice.parseActionSequence('call call aumento 30','pt-BR',betting);
  assert.equal(mixed.commands[2].to,30);
  const amounts=voice.parseActionSequence('raise to two point five bb call','en-US',betting);
  assert.equal(amounts.commands[0].to,2.5);assert.equal(amounts.commands[0].unit,'bb');
  const explicit=voice.parseActionSequence('A1 call then A2 fold','en-US',betting);
  assert.equal(explicit.commands[0].actor.number,1);assert.equal(explicit.commands[1].actor.number,2);
});
test('sequence parser rejects partial natural phrases, ambiguous amounts and unfinished raises as a whole',()=>{
  for(const text of ['call perhaps he folds','call I think fold','call raise','raise twenty thirty call','call fold unknown','call call call call call call call'])
    assert.equal(voice.parseActionSequence(text,'en-US',betting),null,text);
  assert.equal(voice.parseActionSequence('call','en-US',betting),null,'a single Hero action keeps the single-action path');
  assert.equal(voice.parseActionSequence('call fold','en-US',{...betting,pendingAmount:{action:'RAISE'}}),null);
});
test('amount corrections are deterministic and require an existing pending amount',()=>{
  for(const [text,locale] of [['corrigir, era 35','pt-BR'],['era trinta e cinco','pt-BR'],['correction thirty five','en-US'],['it was 35','en-US']])
    assert.deepEqual(voice.parseContextual(text,locale,{...betting,pendingAmount:{action:'RAISE'}}),{type:'amount',to:35});
  assert.throws(()=>voice.parseContextual('corrigir, era 35','pt-BR',betting));
});
test('shown-card editor is an explicit local destination, separate from Hero and the board',()=>{
  for(const phase of ['SHOWDOWN','FINISHED']){
    const context={enabled:true,phase,destination:'shown',shownTarget:{actor:2}};
    assert.deepEqual(voice.parseContextual('ace hearts ten clubs','en-US',context),{type:'cards',target:'shown',cards:['Ah','Tc']});
    assert.deepEqual(voice.parseContextual('ás copas dez paus','pt-BR',context),{type:'cards',target:'shown',cards:['Ah','Tc']});
    assert.equal(voice.parseContextual('my cards ace hearts','en-US',context).target,'hero','explicit words are retained so the UI can reject a wrong destination');
  }
});
test('an unresolved final blocks later actions with model disabled; manual resolution advances only explicit review',async t=>{
  const h=harness(t);await h.controller.refreshCapabilities();
  const initialActor=h.get().state.actor;
  h.controller.acceptFinal(h.packet('The current player did something unclear.'));
  h.controller.acceptFinal(h.packet('call'));
  h.controller.acceptFinal(h.packet('fold'));
  assert.equal(h.controller.getState().waiting,2);assert.equal(h.get().state.actor,initialActor);assert.equal(h.commits.length,0);
  assert.equal(h.calls.filter(c=>c.options.method==='POST').length,0);
  h.manual('CALL');h.controller.checkContext();
  assert.equal(h.controller.getState().phase,'proposed');assert.equal(h.commits.length,0);
  assert.match(h.controller.getState().message,/Player 3/);
  assert.equal(await h.controller.confirm(),true);assert.equal(h.commits[0].actor,3);
  assert.equal(h.controller.getState().phase,'proposed');assert.match(h.controller.getState().message,/Player 4/);
  assert.equal(await h.controller.confirm(),true);assert.equal(h.commits[1].actor,4);
  assert.equal(h.controller.getState().phase,'idle');
});
test('discard does not invent an action or advance the actor; repeats have distinct source IDs',async t=>{
  const h=harness(t), a=h.packet('unclear'), b=h.packet('call'), c=h.packet('call');
  h.controller.acceptFinal(a);h.controller.acceptFinal(b);h.controller.acceptFinal(c);
  assert.equal(h.controller.acceptFinal(b),false);
  const actor=h.get().state.actor;h.controller.discard();
  assert.match(h.controller.getState().message,new RegExp(`Player ${actor}`));
  await h.controller.confirm();assert.equal(h.commits[0].actor,actor);
  await h.controller.confirm();assert.equal(h.commits[1].actor,actor+1);
  assert.equal(h.get().multiway.events.length,2);
});
test('revision replacement or a new hand clears pending speech with an explicit notice',t=>{
  const h=harness(t);h.controller.acceptFinal(h.packet('unclear'));h.controller.acceptFinal(h.packet('call'));
  h.set(table());h.controller.checkContext();
  assert.equal(h.controller.hasBarrier(),false);assert.match(h.controller.getState().message,/2 pending phrases cleared/);
  assert.equal(h.commits.length,0);
});
test('waiting list is bounded in RAM and overflow is visible without reordering later phrases',t=>{
  const h=harness(t);h.controller.acceptFinal(h.packet('unclear'));
  for(let i=0;i<8;i++)h.controller.acceptFinal(h.packet('call'));
  assert.equal(h.controller.getState().waiting,6);assert.equal(h.controller.getState().overflow,2);
  assert.match(h.controller.getState().message,/not kept/);
  h.controller.discard();h.controller.acceptFinal(h.packet('fold'));
  assert.equal(h.controller.getState().waiting,5);assert.equal(h.controller.getState().overflow,3);
  assert.equal([...h.storage.values()].some(value=>/unclear|call|fold/.test(value)),false);
});
test('valid capability still requires separate opt-in; known queued commands never request interpretation',async t=>{
  const h=harness(t,{capability:remote});await h.controller.refreshCapabilities();
  h.controller.acceptFinal(h.packet('unclear'));await tick();assert.equal(h.calls.length,1);
  h.controller.clear();h.controller.setOptIn(true);
  h.controller.acceptFinal(h.packet('call'));await tick();assert.equal(h.calls.length,1);
  assert.equal(h.commits.length,0);assert.equal(h.controller.getState().phase,'proposed');
});
test('a known but illegal action remains manual and never invokes a model to reinterpret its amount',async t=>{
  const h=harness(t,{capability:remote});await h.controller.refreshCapabilities();h.controller.setOptIn(true);
  h.controller.acceptFinal(h.packet('raise to 99 chips',{command:{type:'action',actor:null,action:'RAISE',to:99}}));
  await tick();assert.equal(h.controller.getState().phase,'unresolved');assert.equal(h.calls.length,1);assert.equal(h.commits.length,0);
});
test('new speech aborts optional interpretation, preserving order instead of applying a following call to the old actor',async t=>{
  let resolveModel,signal;
  const h=harness(t,{capability:remote,post:(body,options)=>{signal=options.signal;return new Promise(resolve=>{resolveModel=()=>resolve({status:'PROPOSED',confirmationRequired:true,originEventId:body.originEventId,revisionKey:body.revisionKey,handId:body.multiway.handId,event:{type:'ACT',actor:2,action:'CALL'}});});}});
  await h.controller.refreshCapabilities();h.controller.setOptIn(true);
  h.controller.acceptFinal(h.packet('The current player matches the wager.'));
  assert.equal(h.controller.getState().phase,'loading');h.controller.newSpeech();
  h.controller.acceptFinal(h.packet('fold'));assert.equal(signal.aborted,true);
  resolveModel();await tick();assert.equal(h.controller.getState().phase,'unresolved');assert.equal(h.controller.getState().waiting,1);
  assert.equal(h.get().multiway.events.length,0);assert.equal(h.commits.length,0);
});
test('optional proposals bind revision and source, never execute automatically, and send consent in header and body',async t=>{
  const h=harness(t,{capability:remote,post:async body=>({status:'PROPOSED',confirmationRequired:true,originEventId:body.originEventId,revisionKey:body.revisionKey,handId:body.multiway.handId,event:{type:'ACT',actor:2,action:'CALL'}})});
  await h.controller.refreshCapabilities();h.controller.setOptIn(true);
  h.controller.acceptFinal(h.packet('The current player matches the wager.'));await tick();
  const sent=h.calls.find(call=>call.options.method==='POST');
  assert.equal(sent.options.headers['X-Theibs-Remote-Text-Consent'],'true');assert.equal(JSON.parse(sent.options.body).remoteTextConsent,true);
  assert.equal(h.commits.length,0);assert.equal(h.controller.getState().phase,'proposed');
  assert.equal(await h.controller.confirm(),true);assert.equal(h.get().multiway.events.length,1);
  assert.equal(await h.controller.confirm(),false);assert.equal(h.get().multiway.events.length,1);
});
test('timeouts disable optional interpretation persistently; explicit opt-in is required to reset the circuit',async t=>{
  const storage=new Map(),h=harness(t,{capability:remote,post:()=>new Promise(()=>{}),timeoutMs:5,storage});
  await h.controller.refreshCapabilities();h.controller.setOptIn(true);
  for(let i=0;i<2;i++){h.controller.acceptFinal(h.packet('The player matches the wager.'));await tick();h.controller.discard();}
  assert.equal(h.controller.getState().optedIn,false);
  assert.equal(JSON.parse([...storage.values()][0]).blocked,true);
  await h.controller.refreshCapabilities();assert.equal(h.controller.getState().optedIn,false);
  h.controller.setOptIn(true);assert.equal(h.controller.getState().optedIn,true);
  assert.equal(JSON.parse([...storage.values()][0]).blocked,false);
});
test('withdrawing optional text consent invalidates a model proposal while keeping the ordering barrier',async t=>{
  const h=harness(t,{capability:remote,post:async body=>({status:'PROPOSED',confirmationRequired:true,originEventId:body.originEventId,revisionKey:body.revisionKey,event:{type:'ACT',actor:2,action:'CALL'}})});
  await h.controller.refreshCapabilities();h.controller.setOptIn(true);h.controller.acceptFinal(h.packet('The player matches the wager.'));await tick();
  assert.equal(h.controller.getState().phase,'proposed');h.controller.setOptIn(false);
  assert.equal(h.controller.hasBarrier(),true);assert.equal(h.controller.getState().phase,'unresolved');
  assert.equal(await h.controller.confirm(),false);assert.equal(h.commits.length,0);
});
test('calculation preempts interpretation without losing the barrier or leaking an old proposal',async t=>{
  let response,signal;
  const h=harness(t,{capability:remote,post:(body,options)=>{signal=options.signal;return new Promise(resolve=>{response=()=>resolve({status:'PROPOSED',confirmationRequired:true,originEventId:body.originEventId,revisionKey:body.revisionKey,event:{type:'ACT',actor:2,action:'CALL'}});});}});
  await h.controller.refreshCapabilities();h.controller.setOptIn(true);h.controller.acceptFinal(h.packet('The player matches the wager.'));
  h.controller.prioritizeCalculation();assert.equal(signal.aborted,true);response();await tick();
  assert.equal(h.controller.getState().phase,'unresolved');assert.equal(h.controller.hasBarrier(),true);assert.equal(h.commits.length,0);
});
test('an old model response after a hand replacement cannot populate or confirm a new hand',async t=>{
  let response;
  const h=harness(t,{capability:remote,post:body=>new Promise(resolve=>{response=()=>resolve({status:'PROPOSED',confirmationRequired:true,originEventId:body.originEventId,revisionKey:body.revisionKey,event:{type:'ACT',actor:2,action:'CALL'}});})});
  await h.controller.refreshCapabilities();h.controller.setOptIn(true);h.controller.acceptFinal(h.packet('The player matches the wager.'));
  h.set(table());h.controller.checkContext();response();await tick();
  assert.equal(h.controller.getState().phase,'notice');assert.equal(await h.controller.confirm(),false);assert.equal(h.commits.length,0);
});
