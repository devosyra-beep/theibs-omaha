'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parse,parseContextual,resolveAction,RecognitionSession}=require('../public/card-voice');
const mw=require('../src/multiway-session');
const config={variant:'PLO5_HIGH',playerCount:2,heroPosition:'BTN',startingStack:100,smallBlind:1,bigBlind:2,heroCards:['As','Kh','Qd','Jc','Ts']};
const voiceContext={enabled:true,phase:'BETTING'};

test('quick entry accepts complete PT-BR and EN-US cards without a prefix or preposition',()=>{
  assert.deepEqual(parse('ás copas, dez paus, dama ouros').cards,['Ah','Tc','Qd']);
  assert.deepEqual(parse('ace hearts, ten clubs, queen diamonds','en-US').cards,['Ah','Tc','Qd']);
});

test('short actions bind to the confirmed next actor and explicit seats cannot skip a turn',()=>{
  const state=mw.start(config).state;
  for(const [phrase,locale,action] of [['pago','pt-BR','CALL'],['call','en-US','CALL'],['desistir','pt-BR','FOLD'],['fold','en-US','FOLD']]){
    const command=parseContextual(phrase,locale,voiceContext);
    assert.deepEqual(command,{type:'action',actor:null,action});
    assert.equal(resolveAction(command,state).actor,state.actor);
  }
  const wrongSeat=parseContextual('A1 fold','en-US',voiceContext);
  assert.equal(wrongSeat.actor.number,1);
  assert.throws(()=>resolveAction(wrongSeat,state),/turn/);
});

test('A1 always names the first seat after Hero even when Hero is not the final array entry',()=>{
  const state=mw.start({...config,playerCount:6,heroPosition:'HJ'}).state;
  const a1=state.players.find(player=>player.seatName==='A1');
  assert.ok(a1);
  assert.notEqual(a1.id,state.players.filter(player=>!player.hero)[0].id);
  const event=resolveAction(parseContextual('A1 fold','en-US',voiceContext),
    {...state,actor:a1.id,legal:{...state.legal,actions:['FOLD']}});
  assert.deepEqual(event,{actor:a1.id,action:'FOLD'});
});

test('raise without amount remains pending; spoken numeric follow-up is a total this street',()=>{
  assert.deepEqual(parseContextual('raise','en-US',voiceContext),{type:'action',actor:null,action:'RAISE'});
  assert.deepEqual(parseContextual('aumento','pt-BR',voiceContext),{type:'action',actor:null,action:'RAISE'});
  assert.deepEqual(parseContextual('raise twenty five','en-US',voiceContext),{type:'action',actor:null,action:'RAISE',to:25});
  assert.deepEqual(parseContextual('aumento vinte e cinco','pt-BR',voiceContext),{type:'action',actor:null,action:'RAISE',to:25});
  assert.deepEqual(parseContextual('25','en-US',{...voiceContext,pendingAmount:{action:'RAISE'}}),{type:'amount',to:25});
  assert.deepEqual(parseContextual('vinte e cinco','pt-BR',{...voiceContext,pendingAmount:{action:'RAISE'}}),{type:'amount',to:25});
  assert.throws(()=>parseContextual('call and fold','en-US',voiceContext));
  assert.deepEqual(parseContextual('my turn','en-US',voiceContext),{type:'context'});
  assert.deepEqual(parseContextual('minha vez','pt-BR',voiceContext),{type:'context'});
});

test('final events with identical text remain separate after a confirmed context transition',()=>{
  const session=new RecognitionSession();
  const first={locale:'en-US',revisionKey:'hand-1-event-1'};
  const id=session.begin(first);
  session.reconcileResultCount(id,1);
  session.accept(id,0,'call',true);
  const parser=(text,locale)=>parseContextual(text,locale,voiceContext);
  assert.equal(session.prepareNextFinal(id,first,parser).action,'CALL');
  assert.equal(session.take(first).action,'CALL');
  const next={locale:'en-US',revisionKey:'hand-1-event-2'};
  assert.equal(session.resume(id,next),true);
  session.reconcileResultCount(id,2);
  session.accept(id,0,'call',true);
  session.accept(id,1,'call',true);
  assert.equal(session.prepareNextFinal(id,next,parser).action,'CALL');
  assert.equal(session.take(next).action,'CALL');
  assert.equal(session.hasPending(),false);
  assert.equal(session.prepareNextFinal(id,next,parser),null);
});

test('a stale final cannot apply after reset, undo, or a different hand revision',()=>{
  const session=new RecognitionSession(),captured={locale:'pt-BR',revisionKey:'hand-1-event-2'};
  const id=session.begin(captured);
  session.accept(id,0,'pago',true);
  assert.equal(session.prepareNextFinal(id,{...captured,revisionKey:'hand-1-event-1'},(text,locale)=>parseContextual(text,locale,voiceContext)),null);
  assert.match(session.error,/context changed/);
});
