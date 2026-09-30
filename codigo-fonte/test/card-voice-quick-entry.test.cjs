'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parse,parseContextual,withCardDestination,recognitionHints,resolveAction,RecognitionSession}=require('../public/card-voice');
const mw=require('../src/multiway-session');
const config={variant:'PLO5_HIGH',playerCount:2,heroPosition:'BTN',startingStack:100,smallBlind:1,bigBlind:2,heroCards:['As','Kh','Qd','Jc','Ts']};
const voiceContext={enabled:true,phase:'BETTING'};

test('quick entry accepts complete PT-BR and EN-US cards without a prefix or preposition',()=>{
  assert.deepEqual(parse('ás copas, dez paus, dama ouros').cards,['Ah','Tc','Qd']);
  assert.deepEqual(parse('ace hearts, ten clubs, queen diamonds','en-US').cards,['Ah','Tc','Qd']);
});

test('bare card phrases follow the confirmed Multiway destination, not the selected keyboard slot',()=>{
  const waitingHero={enabled:true,phase:'BETTING',destination:'hero'};
  const waitingBoard={enabled:true,phase:'WAIT_BOARD',destination:'board'};
  assert.deepEqual(parseContextual('ás copas, valete paus','pt-BR',waitingHero),
    {type:'cards',target:'hero',cards:['Ah','Jc']});
  assert.deepEqual(parseContextual('ace hearts, jack clubs','en-US',waitingBoard),
    {type:'cards',target:'board',cards:['Ah','Jc']});
  assert.equal(parseContextual('my cards ace hearts','en-US',waitingBoard).target,'hero',
    'an explicit destination must remain explicit');
  assert.equal(withCardDestination(parse('rei de copas'),waitingBoard).target,'board',
    'a completed rank/suit clarification uses the same destination');
  assert.equal(parseContextual('check','en-US',{enabled:true,phase:'BETTING'}).target,undefined);
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

test('spoken A1 forms resolve only through a stable seat identity',()=>{
  const state=mw.start({...config,playerCount:6,heroPosition:'HJ'}).state;
  const a1=state.players.find(player=>player.seatName==='A1');
  for(const [phrase,locale] of [['A1 fold','en-US'],['A 1 fold','en-US'],['A one fold','en-US'],['A um desistir','pt-BR']]){
    const command=parseContextual(phrase,locale,voiceContext);
    assert.equal(command.actor.number,1,phrase);
    assert.equal(resolveAction(command,{...state,actor:a1.id,legal:{actions:['FOLD']}}).actor,a1.id);
  }
  assert.throws(()=>resolveAction(parseContextual('A1 fold','en-US',voiceContext),
    {...state,actor:a1.id,players:state.players.map(player=>player.seatName==='A1'?{...player,seatName:'unknown',name:'unknown'}:player)}),
  /not at this table/,'a missing seat name must not fall back to positional arithmetic');
});

test('recognizer hints follow the legal turn and pending amount without claiming acoustic training',()=>{
  const legal={enabled:true,phase:'BETTING',actionState:{legal:{actions:['CHECK','BET']}}};
  const phrases=context=>recognitionHints('en-US',context).map(item=>item.phrase);
  assert.deepEqual(phrases(legal).filter(item=>['fold','check','call','bet','raise'].includes(item)),['check','bet']);
  assert.equal(phrases(legal).includes('ace of spades'),false);
  assert.equal(phrases({...legal,pendingAmount:{action:'BET'}}).includes('twenty'),true);
  assert.equal(phrases({...legal,pendingAmount:{action:'BET'}}).includes('bet'),false);
  assert.equal(phrases({enabled:true,phase:'WAIT_BOARD',destination:'board'}).includes('ace of spades'),true);
  assert.equal(recognitionHints('pt-BR',legal).some(item=>item.phrase==='passar'),true);
  assert.deepEqual(recognitionHints('fr-FR',legal),[]);
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

test('two consecutive final calls commit to two legal actors, while a repeated provider event does not',()=>{
  let record=mw.start({...config,playerCount:3,heroPosition:'BTN'});
  const session=new RecognitionSession(),parser=(text,locale)=>parseContextual(text,locale,voiceContext);
  let ctx={locale:'en-US',revisionKey:record.state.revisionKey};
  const id=session.begin(ctx),firstActor=record.state.actor;
  session.reconcileResultCount(id,1);session.accept(id,0,'call',true);
  const first=session.prepareNextFinal(id,ctx,parser);
  record=mw.step(record.multiway,{type:'ACT',...resolveAction(first,record.state)});
  assert.equal(session.take(ctx).action,'CALL');
  const secondActor=record.state.actor;
  assert.notEqual(secondActor,firstActor);
  ctx={locale:'en-US',revisionKey:record.state.revisionKey};
  assert.equal(session.resume(id,ctx),true);
  session.reconcileResultCount(id,2);session.accept(id,0,'call',true);session.accept(id,1,'call',true);
  const second=session.prepareNextFinal(id,ctx,parser);
  record=mw.step(record.multiway,{type:'ACT',...resolveAction(second,record.state)});
  assert.equal(session.take(ctx).action,'CALL');
  assert.equal(session.prepareNextFinal(id,ctx,parser),null);
  assert.deepEqual(record.multiway.events.filter(event=>event.type==='ACT').map(event=>event.actor),[firstActor,secondActor]);
});

test('ambiguous speech and an obsolete numeric follow-up cannot mutate the ledger',()=>{
  let record=mw.start({...config,playerCount:3,heroPosition:'BTN'});
  const before=JSON.stringify(record.multiway);
  assert.throws(()=>parseContextual('call and fold','en-US',voiceContext));
  assert.equal(JSON.stringify(record.multiway),before);
  const pending={...voiceContext,pendingAmount:{action:'RAISE',actor:record.state.actor}};
  assert.deepEqual(parseContextual('twenty five','en-US',pending),{type:'amount',to:25});
  const session=new RecognitionSession(),captured={locale:'en-US',revisionKey:record.state.revisionKey,pendingActor:record.state.actor};
  const id=session.begin(captured);
  session.accept(id,0,'twenty five',true);
  const reset=mw.start({...config,playerCount:3,heroPosition:'BTN'});
  const changed={...captured,revisionKey:reset.state.revisionKey+'-new-hand'};
  assert.equal(session.prepareNextFinal(id,changed,(text,locale)=>parseContextual(text,locale,pending)),null);
  assert.match(session.error,/context changed/);
  assert.equal(JSON.stringify(record.multiway),before);
});

test('a stale final cannot apply after reset, undo, or a different hand revision',()=>{
  const session=new RecognitionSession(),captured={locale:'pt-BR',revisionKey:'hand-1-event-2'};
  const id=session.begin(captured);
  session.accept(id,0,'pago',true);
  assert.equal(session.prepareNextFinal(id,{...captured,revisionKey:'hand-1-event-1'},(text,locale)=>parseContextual(text,locale,voiceContext)),null);
  assert.match(session.error,/context changed/);
});
