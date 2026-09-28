'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { CardKeyboardState, toCanonical } = require('../public/card-model');
const { parse, parseChips, resolveAction, RecognitionSession, qualityGate } = require('../public/card-voice');
const ranks = [['ás','ace','A'],['rei','king','K'],['dama','queen','Q'],['valete','jack','J'],['dez','ten','T'],
  ['nove','nine','9'],['oito','eight','8'],['sete','seven','7'],['seis','six','6'],['cinco','five','5'],['quatro','four','4'],['três','three','3'],['dois','two','2']];
const suits = [['espadas','spades','s'],['copas','hearts','h'],['ouros','diamonds','d'],['paus','clubs','c']];
for (const count of [4,5,6]) for (const locale of ['pt-BR','en-US']) test(`52 spoken cards, canonical input and undo in PLO${count} ${locale}`, () => {
  for (const [pt,en,rank] of ranks) for (const [ptSuit,enSuit,suit] of suits) {
    const state = new CardKeyboardState(count), before = state.snapshot();
    const proposal = parse(locale === 'pt-BR' ? `${pt} de ${ptSuit}` : `${en} of ${enSuit}`, locale);
    assert.deepEqual(proposal.cards, [rank+suit]); assert.equal(state.applyCommand(proposal), true, state.error);
    assert.equal(toCanonical(state.slots[0]), rank+suit); assert.equal(state.selected, 1);
    assert.equal(state.undoStack.length, 1); assert.equal(state.undo(), true); assert.deepEqual(state.snapshot(), before);
  }
});
test('accent, singular, numeric aliases preserve dame/ten and heart/club boundaries', () => {
  assert.deepEqual(parse('DAMA de ouro, DÉZ de copa, rainha de PAU').cards, ['Qd','Th','Qc']);
  assert.deepEqual(parse('10 espadas e 2 copas').cards, ['Ts','2h']);
  assert.deepEqual(parse('ten of heart and 2 clubs','en-US').cards, ['Th','2c']);
  const state = new CardKeyboardState(); state.applyCommand(parse('dama de copas, dez de paus'));
  assert.deepEqual(state.cards().hero, ['QC','TP']);
});
test('reject ambiguous numbers, mixed locales, out of domain and partially valid utterances', () => {
  for (const phrase of ['ás','ás de','ás de espadas e rei','flop ás de espadas, qualquer coisa','ás de espadas cancelar',
    'um de copas','c de copas','ás de espadas, ás de espadas','apostar dez','apagar tudo','dama de ouros e']) assert.throws(() => parse(phrase), phrase);
  for (const phrase of ['to of hearts','for of spades','ate of clubs','one of spades','ace of hearts, call', 'queen de ouros', 'ten of hearts and'])
    assert.throws(() => parse(phrase, 'en-US'), phrase);
  assert.throws(() => parse('ace of spades')); assert.throws(() => parse('ás de espadas', 'en-US'));
});
test('each whole phrase is atomic, destination bounded, duplicate failure preserves selection/undo', () => {
  for (const count of [4,5,6]) {
    const state = new CardKeyboardState(count); state.applyCommand(parse('ás de espadas'));
    const before = state.snapshot(), undo = state.undoStack.length;
    assert.equal(state.applyCommand(parse('rei de copas, ás de espadas')), false);
    assert.deepEqual(state.snapshot(), before); assert.equal(state.undoStack.length, undo);
    assert.equal(state.applyCommand(parse('flop dois de paus, três de ouros, quatro de copas, cinco de espadas')), false);
    assert.deepEqual(state.snapshot(), before); assert.equal(state.undoStack.length, undo);
    assert.equal(state.applyCommand(parse('flop dois de paus, três de ouros, quatro de copas')), true);
    assert.equal(state.selected, count+3); assert.equal(state.undoStack.length, undo+1);
    state.undo(); assert.deepEqual(state.snapshot(), before);
    state.select(count+2);
    const selected = state.snapshot();
    assert.equal(state.applyCommand(parse('dois de paus, três de ouros')), false);
    assert.deepEqual(state.snapshot(), selected);
  }
});
test('destination, selection, correction, remove and undo commands in both languages', () => {
  for (const count of [4,5,6]) for (const locale of ['pt-BR','en-US']) {
    const en = locale === 'en-US', state = new CardKeyboardState(count), apply = (pt,english) => state.applyCommand(parse(en ? english : pt,locale));
    assert.equal(apply('minhas cartas ás de espadas, rei de copas','my cards ace of spades, king of hearts'), true);
    assert.equal(apply('selecionar carta três','select card three'), true); assert.equal(state.selected, 2);
    const before = state.snapshot();
    assert.equal(apply('corrigir carta três para dama de ouros','correct card three to queen of diamonds'), true);
    assert.equal(state.slots[2], 'QO'); assert.equal(apply('desfazer','undo'), true); assert.deepEqual(state.snapshot(), before);
    assert.equal(apply('flop','flop'), true); assert.equal(state.selected, count);
    assert.equal(apply('corrigir carta três para dama de ouros','correct card three to queen of diamonds'), true); assert.equal(state.slots[count+2], 'QO');
    assert.equal(apply('remover carta selecionada','remove selected card'), true); assert.equal(state.slots[count+2], null);
    assert.equal(apply('desfazer','undo'), true); assert.equal(state.slots[count+2], 'QO');
    assert.equal(apply('selecionar carta seis do board','select card six on board'), false);
  }
});
test('full targets reject new batches, canonical command boundary never accepts keyboard notation', () => {
  const state = new CardKeyboardState(4); state.applyCommand(parse('minhas cartas ás de espadas, rei de copas, dama de ouros, valete de paus'));
  const before = state.snapshot(); assert.equal(state.applyCommand(parse('minhas cartas dez de ouros')), false); assert.deepEqual(state.snapshot(), before);
  assert.equal(state.applyCommand({type:'correct',target:'hero',index:0,card:'AC'}), true); // canonical c is clubs, never copas.
  assert.equal(state.slots[0], 'AP');
  assert.equal(state.applyCommand({type:'cards',target:'selected',cards:['AE']}), false);
});
test('interims never commit, repeated finals are idempotent, all final segments form one phrase', () => {
  const ctx = {locale:'pt-BR',revision:1}, session = new RecognitionSession(), state = new CardKeyboardState();
  const id = session.begin(ctx); session.accept(id,0,'ás de espadas',false); assert.equal(session.phase,'listening'); assert.deepEqual(state.cards().hero,[]);
  session.accept(id,0,'ás de espadas',true); session.accept(id,0,'ás de espadas',true); session.accept(id,1,'rei de copas',true);
  assert.deepEqual(session.finish(id,ctx).cards,['As','Kh']); assert.equal(state.applyCommand(session.take(ctx)),true); assert.equal(session.take(ctx),null);
  assert.equal(state.undoStack.length,1); state.undo(); assert.deepEqual(state.cards().hero,[]);
});
test('later ambiguous/final conflict/interim/missing segment rejects entire phrase', () => {
  const ctx = {locale:'pt-BR'};
  for (const variant of ['ambiguous','conflict','interim','missing']) {
    const session = new RecognitionSession(), id = session.begin(ctx); session.accept(id,0,'ás de espadas',true);
    if(variant==='ambiguous')session.accept(id,1,'rei',true);
    if(variant==='conflict')session.accept(id,0,'rei de copas',true);
    if(variant==='interim')session.accept(id,1,'rei de copas',false);
    if(variant==='missing')session.accept(id,2,'rei de copas',true);
    assert.equal(session.finish(id,ctx),null); assert.equal(session.take(ctx),null);
  }
});
test('cancel, stale selection, hand, variant, locale and user/session cannot consume', () => {
  const initial = {locale:'pt-BR',revision:1,hand:'a',variant:5,selection:0,user:'owner-a'};
  for (const [key,value] of [['revision',2],['hand','b'],['variant',4],['selection',3],['user','owner-b'],['locale','en-US']]) {
    const session = new RecognitionSession(),id=session.begin(initial);session.accept(id,0,'ás de espadas',true);
    assert.equal(session.finish(id,{...initial,[key]:value}),null);
    const next=session.begin(initial);session.accept(next,0,'ás de espadas',true);session.finish(next,initial);
    assert.equal(session.take({...initial,[key]:value}),null);
  }
  const session=new RecognitionSession(),id=session.begin(initial);session.cancel();
  assert.equal(session.accept(id,0,'ás de espadas',true),false);assert.equal(session.finish(id,initial),null);
  const id2=session.begin(initial);assert.notEqual(id2,id);assert.equal(session.accept(id,0,'ás de espadas',true),false);
  session.accept(id2,0,'ás de espadas',true);assert.ok(session.finish(id2,initial));
  assert.equal(qualityGate.autoApply,false);assert.equal(qualityGate.acoustic,'NOT_EXECUTED');
});
test('voice actions have explicit actors, total raises and exact localized amounts',()=>{
 for(const [pt,en,action,to] of [['eu desisto','hero fold','FOLD'],['herói passa','hero check','CHECK'],['eu paguei','hero call','CALL'],
  ['eu aposto dois vírgula cinquenta','hero bet two point five','BET',2.5],['herói aumenta para vinte e cinco fichas','hero raises to twenty-five chips','RAISE',25]]){
  // Past form is deliberately only the documented pagou; avoid silent morphology inference.
  const portuguese=pt==='eu paguei'?'eu pago':pt;
  for(const [text,locale]of[[portuguese,'pt-BR'],[en,'en-US']])assert.deepEqual(parse(text,locale),{type:'action',actor:{kind:'hero'},action,...(to===undefined?{}:{to})});
 }
 assert.deepEqual(parse('adversário dois aumenta para 12,50'),{type:'action',actor:{kind:'opponent',number:2},action:'RAISE',to:12.5});
 assert.deepEqual(parse('opponent two raises to 12.50','en-US'),{type:'action',actor:{kind:'opponent',number:2},action:'RAISE',to:12.5});
 assert.equal(parse('hero raises to, six','en-US').to,6);
 for(const [text,locale,amount]of[['cento e vinte e três vírgula zero cinco','pt-BR',123.05],['mil e dez','pt-BR',1010],['one thousand two hundred and thirty four point twenty five','en-US',1234.25],['zero point zero one','en-US',.01],['novecentos e noventa e nove mil novecentos e noventa e nove vírgula noventa e nove','pt-BR',999999.99]])assert.equal(parseChips(text,locale),amount);
});
test('action phrases reject ambiguous totals, incomplete numbers, increments and extra operations',()=>{
 for(const [text,locale]of[['hero raise five','en-US'],['hero raise by five','en-US'],['eu aumento cinco','pt-BR'],['adversário um call dez','pt-BR'],['opponent for call','en-US'],['hero bet -5','en-US'],['eu aposto menos cinco','pt-BR'],['hero bet 1,000','en-US'],['eu aposto 1.000','pt-BR'],['eu aposto cento e','pt-BR'],['hero bet one hundred and','en-US'],['hero bet one thousand and','en-US'],['hero bet two three','en-US'],['hero bet 2.555','en-US'],['hero call and opponent one check','en-US'],['eu passo, ás de espadas','pt-BR'],['hero bet all in','en-US'],['oponente dez paga','pt-BR']])assert.throws(()=>parse(text,locale),text);
});

test('call with an explicit amount is rejected with an actionable instruction',()=>{
 assert.throws(()=>parse('eu pago dez','pt-BR'),/sem valor; o preço vem da mesa/);
 assert.throws(()=>parse('opponent two calls ten','en-US'),/without a value; the amount comes from the table/);
 for(const locale of ['pt-BR','en-US']){
  assert.equal(parseChips(locale==='pt-BR'?'0,01':'0.01',locale),0.01);
  assert.equal(parseChips(locale==='pt-BR'?'999999,99':'999999.99',locale),999999.99);
 }
});

test('empty provider final segments reject the whole phrase including a valid prefix',()=>{
 for(const parts of [[''],['ace of spades','']]){
  const session=new RecognitionSession(),context={locale:'en-US'},id=session.begin(context);
  parts.forEach((text,index)=>session.accept(id,index,text,true));
  assert.equal(session.finish(id,context),null);assert.match(session.error,/serviço.*texto vazio/);
 }
});

test('native ASR may shrink provisional result snapshots while final results remain immutable',()=>{
 const context={locale:'en-US'},session=new RecognitionSession();let id=session.begin(context);
 session.accept(id,0,'Ace of Spades 10 of',false);session.accept(id,1,' hearts',false);
 assert.equal(session.reconcileResultCount(id,1),true);session.accept(id,0,'Ace of Spades 10 of hearts',true);
 assert.deepEqual(session.finish(id,context).cards,['As','Th']);
 id=session.begin(context);session.accept(id,0,'ace of spades',true);session.accept(id,1,'ten of hearts',true);
 assert.equal(session.reconcileResultCount(id,1),false);assert.equal(session.finish(id,context),null);assert.match(session.error,/removeu.*final/);
 id=session.begin(context);session.accept(id,0,'ace of',false);assert.equal(session.reconcileResultCount(id,0),true);assert.equal(session.preview(),'');
 assert.equal(session.reconcileResultCount(id-1,2),false);
});

test('six-player CO table keeps opponent numbers after Adv.1 folds in both languages',()=>{
 const mw=require('../src/multiway-session');
 for(const locale of ['pt-BR','en-US']){
  const en=locale==='en-US';let record=mw.start({variant:'PLO5_HIGH',playerCount:6,heroPosition:'CO',startingStack:100,smallBlind:1,bigBlind:2,heroCards:['As','Kh','Qd','Jc','Ts']});
  const opponents=record.state.players.filter(p=>!p.hero),ids=opponents.map(p=>p.id);
  for(let n=0;n<6&&record.state.phase==='BETTING';n++){
   const actor=record.state.players.find(p=>p.id===record.state.actor),ordinal=ids.indexOf(actor.id)+1;
   const action=actor.id===ids[0]?'FOLD':record.state.legal.actions.includes('CALL')?'CALL':'CHECK';
   const name=actor.hero?(en?'hero':'eu'):(en?`opponent ${ordinal}`:`adversário ${ordinal}`);
   const word=en?action.toLowerCase():({FOLD:'desiste',CALL:'paga',CHECK:'passa'})[action];
   record=mw.step(record.multiway,{type:'ACT',...resolveAction(parse(`${name} ${word}`,locale),record.state)});
  }
  assert.equal(record.state.phase,'WAIT_BOARD');assert.equal(record.state.players.find(p=>p.id===ids[0]).folded,true);
  record=mw.step(record.multiway,{type:'BOARD',cards:['9d','8h','7c']});
  assert.equal(record.state.actor,ids[1]);
  assert.throws(()=>resolveAction(parse(en?'opponent one check':'adversário um passa',locale),record.state));
  assert.equal(resolveAction(parse(en?'opponent two check':'adversário dois passa',locale),record.state).actor,ids[1]);
  assert.deepEqual(record.state.players.filter(p=>!p.hero).map(p=>p.id),ids);
 }
});
test('voice actions use actual actor/legal sizing and produce canonical ledger events in both languages',()=>{
 const mw=require('../src/multiway-session');
 const config={variant:'PLO5_HIGH',playerCount:2,heroPosition:'BTN',startingStack:100,smallBlind:1,bigBlind:2,heroCards:['As','Kh','Qd','Jc','Ts']};
 for(const locale of ['pt-BR','en-US']){
  const en=locale==='en-US';let record=mw.start(config),before=JSON.stringify(record);
  const heroRaise=parse(en?'hero raise to six':'eu aumento para seis',locale);assert.deepEqual(resolveAction(heroRaise,record.state),{actor:0,action:'RAISE',to:6});
  assert.throws(()=>resolveAction(parse(en?'opponent one call':'adversário um paga',locale),record.state),/vez/);assert.equal(JSON.stringify(record),before);
  assert.throws(()=>resolveAction(parse(en?'hero check':'eu passo',locale),record.state),/legal/);
  for(const n of [0,3,1000])assert.throws(()=>resolveAction({...heroRaise,to:n},record.state));
  record=mw.step(record.multiway,{type:'ACT',...resolveAction(parse(en?'hero call':'eu pago',locale),record.state)});
  record=mw.step(record.multiway,{type:'ACT',...resolveAction(parse(en?'opponent one check':'adversário um passa',locale),record.state)});
  record=mw.step(record.multiway,{type:'BOARD',cards:['9d','8h','7c']});
  const bet=resolveAction(parse(en?'opponent one bets two point five':'adversário um aposta dois vírgula cinco',locale),record.state);
  assert.equal(bet.to,2.5);record=mw.step(record.multiway,{type:'ACT',...bet});assert.equal(record.state.players[1].streetPaid,2.5);
  const raise=resolveAction(parse(en?'hero raise to five':'eu aumento para cinco',locale),record.state);record=mw.step(record.multiway,{type:'ACT',...raise});assert.equal(record.state.players[0].streetPaid,5);
  const folded=mw.step(record.multiway,{type:'ACT',...resolveAction(parse(en?'opponent one folds':'adversário um desiste',locale),record.state)});assert.equal(folded.state.players[1].folded,true);
  assert.throws(()=>resolveAction(heroRaise,{...record.state,phase:'WAIT_BOARD'}));
 }
});
