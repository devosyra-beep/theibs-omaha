'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const multiway = require('../src/multiway-session');
const voice = require('../public/card-voice');
const config = {variant:'PLO5_HIGH',playerCount:3,heroPosition:'BB',startingStack:100,smallBlind:1,bigBlind:2,heroCards:[]};
const cmd = (action, extra = {}) => ({type:'action',actor:null,action,...extra});
const opts = state => ({expectedRevisionKey:state.revisionKey,originEventId:'speech-unique-001'});
function preview(initial, commands) { return multiway.previewSequence(initial.multiway,commands,opts(initial.state)); }
function commit(initial,commands,draft) { return multiway.batch(initial.multiway,commands,{...opts(initial.state),expectedPreviewKey:draft.previewKey}); }

test('known call call fold parses completely and stops before Hero without folding them', () => {
  const initial = multiway.start(config), before = JSON.stringify(initial.multiway);
  const commands = voice.parseActionSequence('call call fold','en-US',{enabled:true,phase:'BETTING'}).commands;
  const draft = preview(initial,commands);
  assert.equal(draft.appliedCount,2); assert.equal(draft.stopReason,'HERO_TURN');
  assert.equal(draft.previewState.actor,draft.previewState.heroId);
  assert.deepEqual(draft.remainingCommands,[cmd('FOLD')]);
  assert.equal(JSON.stringify(initial.multiway),before);
  const result = commit(initial,commands,draft);
  assert.equal(result.state.players[result.state.heroId].folded,false);
  assert.equal(result.state.pot,6); assert.equal(result.state.revision,2);
  assert.equal(result.multiway.events.some(event=>event.actor===result.state.heroId),false);
  assert.deepEqual(result.multiway.events.map(event=>event.originEventId),['speech-unique-001:0','speech-unique-001:1']);
});

test('known Portuguese call call aumento 30 applies three legal observed actions with no LLM', () => {
  const initial = multiway.start({...config,playerCount:6,heroPosition:'SB',startingStack:1000,smallBlind:5,bigBlind:10});
  const commands = voice.parseActionSequence('call call aumento 30','pt-BR',{enabled:true,phase:'BETTING'}).commands;
  const draft = preview(initial,commands), result = commit(initial,commands,draft);
  assert.equal(draft.appliedCount,3); assert.equal(draft.stopReason,'COMPLETE');
  assert.deepEqual(result.multiway.events.map(({actor,action,to})=>({actor,action,to})),[
    {actor:2,action:'CALL',to:undefined},{actor:3,action:'CALL',to:undefined},{actor:4,action:'RAISE',to:30}]);
  assert.equal(result.state.pot,65); assert.equal(result.state.actor,5);
});

test('illegal later action rejects the entire applicable prefix without mutating the ledger', () => {
  const initial = multiway.start(config), before = JSON.stringify(initial.multiway), commands = [cmd('CALL'),cmd('RAISE',{to:999})];
  assert.throws(()=>preview(initial,commands),/between/);
  assert.throws(()=>multiway.batch(initial.multiway,commands,{...opts(initial.state),expectedPreviewKey:'untrusted'}),/between/);
  assert.equal(JSON.stringify(initial.multiway),before); assert.equal(initial.multiway.events.length,0);
});

test('stale revisions after undo and changed previews reject with 409', () => {
  const initial=multiway.start(config), commands=[cmd('CALL'),cmd('CALL')], draft=preview(initial,commands), applied=commit(initial,commands,draft);
  const stale = fn => assert.throws(fn,error=>error.statusCode===409);
  stale(()=>multiway.batch(applied.multiway,commands,{...opts(initial.state),expectedPreviewKey:draft.previewKey}));
  stale(()=>multiway.batch(initial.multiway,[cmd('FOLD'),cmd('CALL')],{...opts(initial.state),expectedPreviewKey:draft.previewKey}));
  stale(()=>multiway.batch(initial.multiway,commands,opts(initial.state)));
  const undone=multiway.undo(multiway.undo(applied.multiway).multiway);
  assert.equal(undone.state.revision,0);
  stale(()=>multiway.previewSequence(undone.multiway,commands,opts(initial.state)));
});

test('same source and original payload have deterministic IDs; already consumed sources cannot apply twice', () => {
  const initial=multiway.start(config), commands=[cmd('CALL'),cmd('CALL')], draft=preview(initial,commands);
  assert.deepEqual(preview(initial,commands),draft);
  assert.deepEqual(commit(initial,commands,draft),commit(initial,commands,draft));
  const result=commit(initial,commands,draft);
  assert.throws(()=>multiway.previewSequence(result.multiway,commands,opts(result.state)),error=>error.statusCode===409);
});

test('a sequence starting on Hero never executes even an explicit Hero command', () => {
  const initial=multiway.start({...config,heroPosition:'BTN'}),commands=[cmd('CALL',{actor:{kind:'hero'}}),cmd('CALL')],draft=preview(initial,commands);
  assert.equal(draft.appliedCount,0);assert.equal(draft.stopReason,'HERO_TURN');
  assert.deepEqual(commit(initial,commands,draft).multiway,initial.multiway);
});

test('round and hand boundaries retain unapplied commands without inventing a board or new hand', () => {
  let initial=multiway.start({...config,heroPosition:'BTN'});
  initial=multiway.step(initial.multiway,{type:'ACT',actor:2,action:'CALL'});
  const commands=[cmd('CALL'),cmd('CHECK'),cmd('CHECK')],draft=preview(initial,commands);
  assert.equal(draft.appliedCount,2);assert.equal(draft.stopReason,'WAIT_BOARD');assert.equal(draft.remainingCommands.length,1);
  assert.deepEqual(commit(initial,commands,draft).state.board,[]);
  const end=multiway.start({...config,playerCount:6,heroPosition:'BB'}),folds=Array.from({length:6},()=>cmd('FOLD')),last=preview(end,folds);
  assert.equal(last.appliedCount,5);assert.equal(last.stopReason,'FINISHED');assert.equal(last.remainingCommands.length,1);
  assert.equal(commit(end,folds,last).state.players[1].folded,false);
});

test('actor, unit, increment, full syntax and length validation cannot silently reinterpret commands', () => {
  const initial=multiway.start(config);
  assert.throws(()=>preview(initial,[cmd('CALL',{actor:{kind:'opponent',number:2}})]),/turn/);
  for(const commands of [[],Array.from({length:7},()=>cmd('CALL')),[cmd('CALL',{to:2})],[cmd('RAISE')],
    [cmd('CALL'),cmd('CALL'),cmd('RAISE',{to:3,by:1})],[cmd('CALL'),cmd('CALL'),cmd('BET',{by:1})],
    [cmd('CALL',{extra:'ignored'})],[cmd('RAISE',{to:2,unit:'dollars'})],[cmd('RAISE',{to:NaN})]]) {
    assert.throws(()=>preview(initial,commands));
  }
  const inBb=preview(initial,[cmd('RAISE',{to:3,unit:'bb'})]);assert.equal(inBb.events[0].to,6);
  const byBb=preview(initial,[cmd('RAISE',{by:2,unit:'bb'})]);assert.equal(byBb.events[0].to,6);
  assert.equal(initial.multiway.events.length,0);
});

test('legacy hand and player identities are stable between preview and commit', () => {
  const initial=multiway.start(config);delete initial.multiway.handId;delete initial.multiway.editEpoch;delete initial.multiway.config.players;
  const legacy=multiway.envelope(initial.multiway),commands=[cmd('CALL')],draft=preview(legacy,commands),result=commit(legacy,commands,draft);
  assert.deepEqual(preview(legacy,commands),draft);
  assert.deepEqual(result.state,draft.previewState);
  assert.equal(result.multiway.config.players.length,3);assert.equal(initial.multiway.handId,undefined);
});
