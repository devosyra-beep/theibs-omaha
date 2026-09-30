'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parse,parseChips,resolveAction,getClarification,completeClarification,RecognitionSession}=require('../public/card-voice');
const {CardKeyboardState}=require('../public/card-model');
const mw=require('../src/multiway-session');
const config={variant:'PLO5_HIGH',playerCount:2,heroPosition:'BTN',startingStack:100,smallBlind:1,bigBlind:2,heroCards:['As','Kh','Qd','Jc','Ts']};
const complete=(source,reply,locale='pt-BR')=>{
 const pending=getClarification(source,locale);assert.ok(pending,source);
 const result=completeClarification(pending,reply,locale);assert.equal(result.error,null,source+' + '+reply);assert.ok(result.command,source+' + '+reply);
 return result.command;
};

test('raise to and raise by remain explicit and resolve to different ledger totals in both locales',()=>{
 const state=mw.start(config).state;
 for(const locale of ['pt-BR','en-US']){
  const en=locale==='en-US',to=parse(en?'hero raise to five':'eu aumento para cinco',locale),by=parse(en?'hero raise by five':'eu aumento em cinco',locale);
  assert.deepEqual(to,{type:'action',actor:{kind:'hero'},action:'RAISE',to:5});
  assert.deepEqual(by,{type:'action',actor:{kind:'hero'},action:'RAISE',by:5});
  assert.equal(resolveAction(to,state).to,5);
  assert.throws(()=>resolveAction(by,state),/between/,'2 + 5 exceeds this table pot limit 6; do not clamp');
  assert.equal(resolveAction({...by,by:3},state).to,5);
  assert.throws(()=>parse(en?'hero raise five':'eu aumento cinco',locale),/total/);
  assert.throws(()=>resolveAction({...by,to:5},state));
  assert.throws(()=>resolveAction({...by,by:0},state));
  assert.throws(()=>resolveAction(by,{...state,currentBet:undefined}));
 }
});

test('explicit chip and BB units convert using the observed big blind and preserve cents',()=>{
 const state=mw.start(config).state;
 for(const [text,locale,total]of[['eu aumento para duas BB','pt-BR',4],['hero raises to 2.5 big blinds','en-US',5],['eu aumento em duas big blinds','pt-BR',6],['hero raises to five chips','en-US',5],['eu aumento para cinco fichas','pt-BR',5]]){
  const command=parse(text,locale);assert.equal(resolveAction(command,state).to,total,text);
 }
 const command=parse('hero raise by two BB','en-US');assert.equal(command.unit,'bb');
 for(const bigBlind of [undefined,0,NaN,Infinity])assert.throws(()=>resolveAction(command,{...state,bigBlind}));
 assert.throws(()=>resolveAction({...command,by:.01},{...state,bigBlind:.25,legal:{actions:['RAISE'],minTo:2,maxTo:10}}),/decimal places/);
 for(const [text,locale]of[['hero raise to five dollars','en-US'],['hero raise to five blinds','en-US'],['eu aumento para cinco reais','pt-BR'],['eu aumento para cinco euros','pt-BR'],['eu aumento para dois 50','pt-BR']])assert.throws(()=>parse(text,locale),text);
 assert.throws(()=>parseChips('one','xx'));
});

test('all-in resolves a short or exact call without inventing a raise',()=>{
 for(const stack of [1.5,2])for(const locale of ['pt-BR','en-US']){
  const record=mw.start({...config,stacks:[stack,100]}),text=locale==='pt-BR'?'eu vou all-in':'hero goes all in';
  const command=parse(text,locale);assert.deepEqual(command,{type:'action',actor:{kind:'hero'},action:'ALL_IN'});
  const event=resolveAction(command,record.state);assert.deepEqual(event,{actor:0,action:'CALL'});
  const after=mw.step(record.multiway,{type:'ACT',...event});assert.equal(after.state.players[0].stack,0);assert.equal(after.state.players[0].allIn,true);
 }
});

test('all-in aggressive sizing is the entire stack, subject to pot limit and reopening',()=>{
 for(const locale of ['pt-BR','en-US']){
  const command=parse(locale==='pt-BR'?'eu all-in':'I am all-in',locale);
  const short=mw.start({...config,stacks:[6,100]});assert.deepEqual(resolveAction(command,short.state),{actor:0,action:'RAISE',to:6});
  const after=mw.step(short.multiway,{type:'ACT',...resolveAction(command,short.state)});assert.equal(after.state.players[0].stack,0);
  assert.throws(()=>resolveAction(command,mw.start(config).state),/between/,'full 100 exceeds max 6; must not silently bet max');
  assert.throws(()=>resolveAction(command,{...short.state,legal:{...short.state.legal,actions:['CALL','FOLD']}}),/legal/);
  assert.throws(()=>resolveAction({...command,to:6},short.state));assert.throws(()=>resolveAction({...command,unit:'bb'},short.state));
  assert.throws(()=>resolveAction(command,{...short.state,players:short.state.players.map(p=>({...p,stack:undefined}))}));
 }
});

test('all-in can become an opening bet or a legal short raise through actual ledger state',()=>{
 let record=mw.start({...config,stacks:[100,4]});
 record=mw.step(record.multiway,{type:'ACT',actor:0,action:'CALL'});
 record=mw.step(record.multiway,{type:'ACT',actor:1,action:'CHECK'});
 record=mw.step(record.multiway,{type:'BOARD',cards:['9s','8h','7d']});
 const bet=resolveAction(parse('opponent one all-in','en-US'),record.state);assert.deepEqual(bet,{actor:1,action:'BET',to:2});
 assert.equal(mw.step(record.multiway,{type:'ACT',...bet}).state.players[1].stack,0);
 const short=mw.start({...config,stacks:[3,100]});
 const raise=resolveAction(parse('eu all-in'),short.state);assert.deepEqual(raise,{actor:0,action:'RAISE',to:3});
 assert.equal(mw.step(short.multiway,{type:'ACT',...raise}).state.players[0].stack,0);
});

test('all-in still requires an explicit existing actor on turn and an active betting state',()=>{
 const state=mw.start({...config,stacks:[6,100]}).state;
 assert.throws(()=>parse('all-in'));assert.equal(getClarification('all-in').missing,'actor');
 assert.throws(()=>resolveAction(parse('adversário um all-in'),state),/turn/);
 assert.throws(()=>resolveAction(parse('adversário nove all-in'),state),/not at this table/);
 assert.throws(()=>resolveAction(parse('eu all-in'),{...state,phase:'WAIT_BOARD'}));
 for(const field of ['folded','allIn'])assert.throws(()=>resolveAction(parse('eu all-in'),{...state,players:state.players.map(p=>p.hero?{...p,[field]:true}:p)}));
 for(const text of ['eu all-in dez','eu all-in e pago','eu all-in BB'])assert.throws(()=>parse(text));
});

test('missing actor, opponent number, action and amount request only their specific complement',()=>{
 for(const [locale,source,missing,reply,expected]of[
  ['pt-BR','pago','actor','eu',{type:'action',actor:{kind:'hero'},action:'CALL'}],
  ['en-US','call','actor','opponent two',{type:'action',actor:{kind:'opponent',number:2},action:'CALL'}],
  ['pt-BR','adversário paga','opponentNumber','dois',{type:'action',actor:{kind:'opponent',number:2},action:'CALL'}],
  ['en-US','opponent calls','opponentNumber','two',{type:'action',actor:{kind:'opponent',number:2},action:'CALL'}],
  ['pt-BR','eu','action','aposto vinte',{type:'action',actor:{kind:'hero'},action:'BET',to:20}],
  ['en-US','opponent two','action','checks',{type:'action',actor:{kind:'opponent',number:2},action:'CHECK'}],
  ['pt-BR','eu aposto','amount','vinte fichas',{type:'action',actor:{kind:'hero'},action:'BET',to:20}],
  ['en-US','hero bets BB','amount','two point five',{type:'action',actor:{kind:'hero'},action:'BET',to:2.5,unit:'bb'}]
 ]){assert.equal(getClarification(source,locale).missing,missing);assert.deepEqual(complete(source,reply,locale),expected);}
});

test('missing raise basis never assumes a total or increment; known amount cannot be overwritten',()=>{
 for(const [locale,source,toWord,byWord]of[['pt-BR','eu aumento cinco','para','em'],['en-US','hero raises five','to','by']]){
  const pending=getClarification(source,locale);assert.equal(pending.missing,'raiseBasis');
  assert.equal(completeClarification(pending,toWord,locale).command.to,5);
  assert.equal(completeClarification(pending,byWord,locale).command.by,5);
  for(const reply of ['5',toWord+' 10']){const result=completeClarification(pending,reply,locale);assert.equal(result.command,null);assert.ok(result.error);}
 }
 let pending=getClarification('eu aumento');assert.equal(pending.missing,'raiseBasis');
 let result=completeClarification(pending,'em');assert.equal(result.command,null);assert.equal(result.clarification.missing,'amount');
 result=completeClarification(result.clarification,'duas BB');assert.deepEqual(result.command,{type:'action',actor:{kind:'hero'},action:'RAISE',by:2,unit:'bb'});
 assert.equal(complete('hero raises','to fifty','en-US').to,50);
});

test('partial numeric amounts retain their spoken prefix instead of replacing it',()=>{
 for(const [source,reply,locale,to]of[['eu aposto cento e','vinte','pt-BR',120],['eu aposto vinte e','dois','pt-BR',22],['hero bets one hundred and','twenty','en-US',120],['hero bets two point','five','en-US',2.5],['eu aposto dois vírgula','zero cinco','pt-BR',2.05]]){
  assert.equal(getClarification(source,locale).missing,'amountTail');assert.equal(complete(source,reply,locale).to,to);
 }
 for(const [text,locale]of[['hero bets two three','en-US'],['hero raises to -5','en-US'],['eu aposto menos cinco','pt-BR'],['hero bet 1,000','en-US'],['eu aposto 1.000','pt-BR'],['hero call ten','en-US']]){
  assert.throws(()=>parse(text,locale));assert.equal(getClarification(text,locale),null);
 }
});

test('unknown object property names are never accepted as card or action vocabulary',()=>{
 for(const text of ['constructor clubs','ace constructor','toString hearts','hero constructor','opponent constructor call']){
  assert.throws(()=>parse(text,'en-US'));assert.equal(getClarification(text,'en-US'),null,text);
 }
});

test('all 52 cards can receive a suit complement in both languages and all three variants',()=>{
 const ranks=[['ás','ace','A'],['dois','two','2'],['três','three','3'],['quatro','four','4'],['cinco','five','5'],['seis','six','6'],['sete','seven','7'],['oito','eight','8'],['nove','nine','9'],['dez','ten','T'],['valete','jack','J'],['dama','queen','Q'],['rei','king','K']];
 const suits=[['espadas','spades','s'],['copas','hearts','h'],['ouros','diamonds','d'],['paus','clubs','c']];
 for(const count of [4,5,6])for(const locale of ['pt-BR','en-US'])for(const rank of ranks)for(const suit of suits){
  const en=locale==='en-US',source=rank[en?1:0]+(en?' of':' de'),reply=suit[en?1:0];
  const pending=getClarification(source,locale);assert.equal(pending.missing,'suit');
  const command=complete(source,reply,locale);assert.deepEqual(command.cards,[rank[2]+suit[2]]);
  const state=new CardKeyboardState(count);assert.equal(state.applyCommand(command),true);assert.equal(state.selected,1);assert.equal(state.undoStack.length,1);
 }
});

test('partial card batches retain every known card and target; rank complements remain explicit',()=>{
 const pt=complete('flop ás de espadas, rei de copas, oito de','paus');assert.equal(pt.target,'flop');assert.deepEqual(pt.cards,['As','Kh','8c']);
 const en=complete('my cards ace of spades, ten of','hearts','en-US');assert.equal(en.target,'hero');assert.deepEqual(en.cards,['As','Th']);
 assert.deepEqual(complete('turn de paus','oito'),{type:'cards',target:'turn',cards:['8c']});
 assert.deepEqual(complete('clubs','eight','en-US'),{type:'cards',target:'selected',cards:['8c']});
 for(const [source,reply,locale]of[['ás de','copas e rei de ouros','pt-BR'],['ace of','for','en-US'],['clubs','ate','en-US']])assert.equal(completeClarification(getClarification(source,locale),reply,locale).command,null);
 for(const [source,locale]of[['one of spades','en-US'],['for of hearts','en-US'],['dois três','pt-BR'],['barulho ás de','pt-BR'],['rainha de qualquer coisa','pt-BR']])assert.equal(getClarification(source,locale),null,source);
});

test('clarification is pure, reentrant, serializable and never replaces explicit actor/action fields',()=>{
 const pending=getClarification('adversário dois aposta'),snapshot=JSON.stringify(pending);
 const first=completeClarification(pending,'vinte'),second=completeClarification(pending,'trinta');
 assert.equal(first.command.to,20);assert.equal(second.command.to,30);assert.equal(JSON.stringify(pending),snapshot);
 assert.deepEqual(completeClarification(JSON.parse(snapshot),'vinte'),first);
 assert.equal(completeClarification(pending,'eu pago').command,null);
 assert.equal(completeClarification(pending,'twenty','en-US').command,null);
 assert.equal(completeClarification({...pending,missing:'actor'},'eu').command,null);
 assert.equal(completeClarification(null,'vinte').command,null);
 assert.deepEqual(completeClarification(pending,'cancelar'),{command:{type:'cancel'},clarification:null,error:null});
 assert.equal(completeClarification(pending,'desfazer').command,null);
 assert.deepEqual(completeClarification(getClarification('hero bets','en-US'),'cancel','en-US').command,{type:'cancel'});
});

test('multi-stage clarification can request actor then basis then amount without inferring any of them',()=>{
 let pending=getClarification('raise','en-US');assert.equal(pending.missing,'actor');
 let result=completeClarification(pending,'opponent two','en-US');assert.equal(result.clarification.missing,'raiseBasis');
 result=completeClarification(result.clarification,'by','en-US');assert.equal(result.clarification.missing,'amount');
 result=completeClarification(result.clarification,'five chips','en-US');assert.deepEqual(result.command,{type:'action',actor:{kind:'opponent',number:2},action:'RAISE',by:5});
 pending=getClarification('adversário');result=completeClarification(pending,'dois');assert.equal(result.clarification.missing,'action');
 result=completeClarification(result.clarification,'all-in');assert.equal(result.command.action,'ALL_IN');assert.equal(result.command.actor.number,2);
});

test('RecognitionSession optional parser handles final clarification exactly once and never sees interim text',()=>{
 const session=new RecognitionSession(),ctx={locale:'pt-BR',revision:0},id=session.begin(ctx);let calls=0,pending=null;
 const parser=(text,locale)=>{calls++;if(pending){const result=completeClarification(pending,text,locale);if(result.error)throw Error(result.error);return result.command;}
  const clarification=getClarification(text,locale);return clarification?{type:'clarify',clarification}:parse(text,locale);};
 session.accept(id,0,'ás de',false);assert.equal(session.prepareReady(id,ctx,parser),null);assert.equal(calls,0);
 session.accept(id,0,'ás de',true);const proposal=session.prepareReady(id,ctx,parser);assert.equal(proposal.type,'clarify');assert.equal(calls,1);
 pending=session.take(ctx).clarification;assert.equal(session.resume(id,ctx),true);
 session.accept(id,0,'ás de',true);assert.equal(session.prepareReady(id,ctx,parser),null);assert.equal(calls,1);
 session.accept(id,1,'espadas',true);assert.deepEqual(session.prepareReady(id,ctx,parser).cards,['As']);assert.equal(calls,2);
 const state=new CardKeyboardState();assert.equal(state.applyCommand(session.take(ctx)),true);assert.equal(state.undoStack.length,1);
 assert.equal(session.resume(id,{...ctx,revision:1}),true);assert.equal(session.finish(id,{...ctx,revision:1},parser),null);assert.equal(calls,2);
});

test('optional parser keeps manual finish, context guards, error rejection and default parsing intact',()=>{
 const ctx={locale:'en-US'},session=new RecognitionSession();let id=session.begin(ctx),calls=0;
 const callback=()=>{calls++;return {type:'clarify',clarification:{missing:'suit'}};};
 session.accept(id,0,'ace of',true);assert.equal(session.finish(id,ctx,callback).type,'clarify');assert.equal(calls,1);assert.ok(session.take(ctx));
 session.cancel();assert.equal(session.finish(id,ctx,callback),null);assert.equal(calls,1);
 id=session.begin(ctx);session.accept(id,0,'ace of',true);assert.equal(session.prepareReady(id,{locale:'pt-BR'},callback),null);assert.equal(calls,1);
 id=session.begin(ctx);session.accept(id,0,'ace of',true);assert.equal(session.prepareReady(id,ctx,()=>{throw Error('must reject');}),null);assert.equal(session.error,'must reject');
 id=session.begin(ctx);session.accept(id,0,'ace of',true);assert.equal(session.finish(id,ctx),null);
 id=session.begin(ctx);session.accept(id,0,'ace of spades',true);assert.deepEqual(session.prepareReady(id,ctx).cards,['As']);
});
