'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8');
function shortcutHarness(){
  const handlers={},windowHandlers={},calls=[];
  class Element {constructor(editable=false){this.editable=editable;}closest(){return null;}}
  const commands=require('../public/keyboard-commands');
  const context={Element,loaded:true,activeView:'analyze',dialog:false,held:new Set(),shiftCandidate:false,typingUntil:0,performance,language:'en-US',rank:'',ten:false,
    document:{activeElement:new Element(),querySelector:()=>context.dialog,addEventListener:(key,fn)=>handlers[key]=fn,visibilityState:'visible'},
    window:{addEventListener:(key,fn)=>windowHandlers[key]=fn},
    allowed:()=>context.loaded&&['analyze','train','simulation'].includes(context.activeView),protectedInput:target=>target?.editable,
    clearRank(){},paint(){},resolveKey:commands.resolveKey,canHandleKey:commands.canHandleKey,
    dispatch:command=>{if(['RESET_HAND','NEW_GAME'].includes(command.type))calls.push(command.type);}};
  const controller=fs.readFileSync(require.resolve('../public/keyboard-controller'),'utf8');
  vm.runInNewContext(controller.slice(controller.indexOf("  document.addEventListener('keydown',event=>{"),controller.indexOf("  document.addEventListener('focusin',event=>{")),context);
  const event=(key,options={})=>({key,code:key==='Shift'?'ShiftLeft':key==="'"?'Quote':key,preventDefault(){this.prevented=true;},stopImmediatePropagation(){},target:context.document.activeElement,...options});
  return {context,handlers,windowHandlers,calls,event};
}
test('the central owner resets once on Shift release and starts a new hand on apostrophe',()=>{
  const h=shortcutHarness();h.handlers.keydown(h.event('Shift',{shiftKey:true}));assert.deepEqual(h.calls,[]);
  h.handlers.keyup(h.event('Shift'));assert.deepEqual(h.calls,['RESET_HAND']);
  h.calls.length=0;const quote=h.event("'");h.handlers.keydown(quote);
  assert.equal(quote.prevented,true);assert.deepEqual(h.calls,['NEW_GAME']);
  h.handlers.keydown(h.event("'",{repeat:true}));assert.equal(h.calls.length,1);
});
test('Shift chords, text fields, dialogs, composition, blur and inactive views cannot reset a hand',()=>{
  for(const chord of ['Tab','A','Control']){
    const h=shortcutHarness();h.handlers.keydown(h.event('Shift',{shiftKey:true}));h.handlers.keydown(h.event(chord,{shiftKey:true}));
    h.handlers.keyup(h.event(chord,{shiftKey:true}));h.handlers.keyup(h.event('Shift'));assert.deepEqual(h.calls,[]);
  }
  for(const change of [h=>h.context.document.activeElement.editable=true,h=>h.context.dialog=true,h=>h.context.activeView='history',h=>h.context.loaded=false]){
    const h=shortcutHarness();change(h);h.handlers.keydown(h.event('Shift',{shiftKey:true}));h.handlers.keyup(h.event('Shift'));h.handlers.keydown(h.event("'"));assert.deepEqual(h.calls,[]);
  }
  const h=shortcutHarness();h.handlers.keydown(h.event('Shift',{shiftKey:true}));h.windowHandlers.blur();h.handlers.keyup(h.event('Shift'));h.handlers.keydown(h.event("'",{isComposing:true}));assert.deepEqual(h.calls,[]);
});
test('the actual Multiway reset handler advances without a dialog; new game opens setup without mutating the hand',async()=>{
  const calls=[],record={handId:'active'},context={multiway:record,multiwayBusy:false,
    nextMultiwayHand:async()=>{calls.push('next');return true;},toast:text=>calls.push(text),
    window:{theibsMultiwayUI:{openSetup:settings=>calls.push(JSON.stringify(settings))}}};
  vm.runInNewContext(source.slice(source.indexOf('  async function newAnalysisHand'),source.indexOf('\n  function showView',source.indexOf('  async function newAnalysisHand'))),context);
  await context.newAnalysisHand(false);assert.equal(calls[0],'next');assert.equal(context.multiway,record);
  calls.length=0;await context.newAnalysisHand(true,true);assert.equal(calls[0],JSON.stringify({forNextHand:false,newGame:true}));assert.equal(context.multiway,record);
});

test('next-hand composition resets displayed cards and archives the old hand before publishing the new one',async()=>{
  const flow=require('../src/multiway-session'),{CardKeyboardState}=require('../public/card-model');
  const initial=flow.start({variant:'PLO5_HIGH',playerCount:3,heroPosition:'BTN',startingStack:100,smallBlind:.5,bigBlind:1,heroCards:['As','Kh','Qd','Jc','Ts']});
  const keyboard=new CardKeyboardState(5);keyboard.paste('AE KC QO JP TE');
  const calls=[],archive=[],context={multiway:initial.multiway,multiwayState:initial.state,JSON,snapshots:[1],syncingMultiway:false,
    cards:{discardDraft:()=>calls.push('discard'),reset:()=>keyboard.reset()},
    window:{theibsPlayersUI:{getOwnerKey:()=> 'owner',ready:()=>true,archiveHand:hand=>archive.push(hand)},
      theibsMultiwayUI:{cancelPendingAmount:()=>calls.push('amount'),acceptNextSetup:()=>calls.push('setup')},theibsCardPicker:{close:()=>calls.push('picker')},theibsVoiceSessionContext:()=>({ownerKey:'owner'})},
    syncPlayerObservations:async()=>{},postJson:async(url,body)=>flow.nextHand(body.multiway,body.options,body.expectedRevisionKey),
    runMultiway:async(op,before)=>{const data=await op();before(data);context.multiway=data.multiway;context.multiwayState=data.state;return true;}};
  vm.runInNewContext(source.slice(source.indexOf('  async function nextMultiwayHand'),source.indexOf('\n  async function previewMultiwaySequence',source.indexOf('  async function nextMultiwayHand'))),context);
  assert.equal(await context.nextMultiwayHand(),true);
  assert.ok(keyboard.slots.every(card=>card===null));assert.equal(keyboard.selected,0);
  assert.equal(archive[0].multiway.handId,initial.multiway.handId);assert.notEqual(context.multiway.handId,initial.multiway.handId);
  assert.deepEqual(context.snapshots,[]);assert.deepEqual(calls,['discard','amount','picker','setup']);
});
