'use strict';
// Lifecycle harness with controlled ASR events; no physical microphone and no
// claims about acoustic recognition. Real parser/model/aggregate code is used.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const evaluation=require('../public/voice-evaluation');
const source=fs.readFileSync(path.join(__dirname,'../public/voice-evaluation-ui.js'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness({release=async()=>{},availability='available',audioStarts=true}={}) {
  const elements=new Map(), instances=[], tasks=new Map(); let clock=100, taskId=0, liveCommits=0;
  class Element {
    constructor(id=''){this.id=id;this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.open=true;this.textContent='';this.events=new Map();this.classes=new Set();this.classList={contains:name=>this.classes.has(name)};}
    set innerHTML(html){for(const match of html.matchAll(/<([a-z]+)([^>]*\bid="([^"]+)"[^>]*)>([\s\S]*?)(?=<\/(?:select|button|p|strong|label|div)>|$)/g)){const [all,tag,attrs,id,body]=match;const el=new Element(id);if(tag==='select'){const options=[...body.matchAll(/<option\s+value="([^"]+)"([^>]*)>/g)];el.value=(options.find(o=>o[2].includes('selected'))||options[0])?.[1]||'';}elements.set(id,el);}for(const match of html.matchAll(/\bid="([^"]+)"/g))if(!elements.has(match[1]))elements.set(match[1],new Element(match[1]));}
    append(){} querySelector(selector){return elements.get(selector.slice(1))||null;}
    addEventListener(name,fn){if(!this.events.has(name))this.events.set(name,[]);this.events.get(name).push(fn);}
    fire(name,event={}){for(const fn of this.events.get(name)||[])fn(event);}
    hasAttribute(name){return Boolean(this[name]);} click(){return this.onclick?.();}
  }
  for(const id of ['card-voice','card-voice-disclosure','voice-settings-dialog','analyze-workspace','app-shell','voice-language','voice-processing','voice-consent','voice-auto-apply','voice-pace'])elements.set(id,new Element(id));
  elements.get('voice-language').value='pt-BR';elements.get('voice-processing').value='browser';
  const document=new Element('document');Object.assign(document,{title:'THEIBS 0.14.5 · Omaha Lab',hidden:false,
    createElement:()=>new Element(),querySelector:selector=>selector.startsWith('#')?elements.get(selector.slice(1))||null:null,getElementById:id=>elements.get(id)||null});
  class Recognition {
    constructor(){this.stops=0;this.aborts=0;instances.push(this);}
    static async available(){return availability;}
    start(){this.started=true;this.onstart?.();if(audioStarts)this.onaudiostart?.();}stop(){this.stops++;}abort(){this.aborts++;}
    emit(text,final=true,index=0){const results=Array.from({length:index+1},()=>Object.assign([{transcript:'',confidence:.999}],{isFinal:false}));results[index]=Object.assign([{transcript:text,confidence:.999}],{isFinal:final});this.onresult?.({resultIndex:index,results});}
    end(){this.onend?.();}
  }
  Recognition.prototype.processLocally=false;
  const window=new Element('window');Object.assign(window,{TheibsVoiceEvaluation:evaluation,isSecureContext:true,SpeechRecognition:Recognition,
    theibsCardVoice:{releaseCaptureForEvaluation:release,getStatus:()=>({listening:false})},theibsCardKeyboard:{commitCommand:()=>{liveCommits++;throw Error('Live table must never be touched');}},theibsVoiceSessionContext:()=>({expired:false})});
  const setTimer=(fn,ms)=>{const id=++taskId;tasks.set(id,{fn,at:clock+ms});return id;};
  const context={window,document,navigator:{onLine:true},performance:{now:()=>clock},setTimeout:setTimer,clearTimeout:id=>tasks.delete(id),setInterval:()=>++taskId,clearInterval:()=>{},Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}}};
  vm.runInNewContext(source,context,{filename:'voice-evaluation-ui.js'});
  const $=suffix=>elements.get('voice-eval-'+suffix), consent=()=>{$('consent').checked=true;$('remote').checked=true;};
  function advance(ms){clock+=ms;for(const [id,task]of [...tasks])if(task.at<=clock){tasks.delete(id);task.fn();}}
  return {$,elements,window,document,instances,consent,advance,liveCommits:()=>liveCommits,status:()=>window.theibsVoiceEvaluation.getSummary(),start:async()=>{$('start').click();await flush();},active:()=>window.theibsVoiceEvaluation.isActive()};
}

test('evaluation never opens the microphone until an explicit click and both browser consents',async()=>{
  const h=harness();assert.equal(h.instances.length,0);assert.equal(h.active(),false);
  await h.start();assert.equal(h.instances.length,0);assert.match(h.$('status').textContent,/consent/);
  h.$('consent').checked=true;await h.start();assert.equal(h.instances.length,0);
  h.$('remote').checked=true;await h.start();assert.equal(h.instances.length,1);assert.equal(h.active(),true);
});

test('evaluation holds ownership before waiting for the live recognizer release',async()=>{
  let resolve;const h=harness({release:()=>new Promise(r=>resolve=r)});h.consent();await h.start();
  assert.equal(h.active(),true);assert.equal(h.instances.length,0);await h.start();assert.equal(h.instances.length,0);
  resolve();await flush();assert.equal(h.instances.length,1);
});

test('failed release does not create a second recognizer and records the failure',async()=>{
  const h=harness({release:async()=>{throw Error('Native capture still active');}});h.consent();await h.start();
  assert.equal(h.instances.length,0);assert.equal(h.active(),false);assert.equal(h.status().total.startFailures,1);
});

test('a hanging release or device check times out before capture and late resolution cannot open it',async()=>{
  for(const phase of ['release','availability']) {
    let resolve;const pending=new Promise(r=>resolve=r);
    const h=harness(phase==='release'?{release:()=>pending}:{availability:pending});h.consent();
    if(phase==='availability'){h.$('processing').value='device';h.$('processing').fire('change');}
    await h.start();assert.equal(h.active(),true);assert.equal(h.instances.length,0);h.advance(15000);
    assert.equal(h.status().total.timeouts,1);assert.equal(h.active(),false);resolve('available');await flush();assert.equal(h.instances.length,0);
  }
});

test('listening is announced only after native audio capture starts',async()=>{
  const h=harness({audioStarts:false});h.consent();await h.start();const rec=h.instances[0];
  assert.doesNotMatch(h.$('status').textContent,/^Listening/);h.advance(20);rec.onaudiostart();assert.match(h.$('status').textContent,/^Listening/);
  rec.onaudioend();assert.match(h.$('status').textContent,/Audio capture ended/);rec.emit('ás de espadas');rec.end();assert.equal(h.status().total.timing.startupMs.p50,20);
});

test('partial results never score; a replayed final scores once without changing the actual hand',async()=>{
  const h=harness();h.consent();await h.start();const rec=h.instances[0];
  rec.emit('ás de espadas',false);assert.equal(h.status().total.attempts,0);
  rec.emit('ás de espadas');rec.emit('ás de espadas');assert.equal(h.status().total.attempts,0);rec.end();
  assert.equal(h.status().total.attempts,1);assert.equal(h.status().total.exact,1);assert.equal(h.liveCommits(),0);assert.equal(h.active(),false);
  rec.emit('rei de copas');rec.end();assert.equal(h.status().total.attempts,1);
});

test('cancel rejects late finals and keeps ownership until native end acknowledgment',async()=>{
  const h=harness();h.consent();await h.start();const rec=h.instances[0];h.$('cancel').click();
  assert.equal(rec.aborts,1);assert.equal(h.active(),true);assert.equal(h.status().total.cancellations,1);
  rec.emit('ás de espadas');h.advance(3100);assert.equal(h.active(),true);assert.match(h.$('status').textContent,/Reload/);
  await h.start();assert.equal(h.instances.length,1);rec.end();assert.equal(h.active(),false);assert.equal(h.status().total.exact,0);
});

test('session changes and hidden-page end events cannot accept a pending final',async()=>{
  for(const interrupted of ['session','hidden']) {
    const h=harness();h.consent();await h.start();const rec=h.instances[0];rec.emit('ás de espadas');
    if(interrupted==='session')h.document.fire('theibs:voice-session-changed');else h.document.hidden=true;
    rec.end();assert.equal(h.active(),false);assert.equal(h.status().total.exact,0);assert.equal(h.status().total.cancellations,1);
  }
});

test('timeout remains in accuracy denominator and never promotes a provisional card',async()=>{
  const h=harness();h.consent();await h.start();const rec=h.instances[0];rec.emit('ás de espadas',false);h.advance(15000);rec.end();
  assert.equal(h.status().total.attempts,1);assert.equal(h.status().total.timeouts,1);assert.equal(h.status().total.accuracy,0);
});

test('device mode checks availability and never falls back or installs',async()=>{
  const h=harness({availability:'downloadable'});h.$('consent').checked=true;h.$('processing').value='device';h.$('processing').fire('change');await h.start();
  assert.equal(h.instances.length,0);assert.equal(h.status().total.startFailures,1);assert.match(h.$('status').textContent,/No language package/);
  const ready=harness();ready.$('consent').checked=true;ready.$('processing').value='device';ready.$('processing').fire('change');await ready.start();
  assert.equal(ready.instances.length,1);assert.equal(ready.instances[0].processLocally,true);
});

test('withdrawn consent or a changed setting aborts capture and discards stale results',async()=>{
  for(const change of ['consent','processing']) {
    const h=harness();h.consent();await h.start();const rec=h.instances[0];h.$(change).checked=false;h.$(change).fire('change');
    rec.emit('ás de espadas');rec.end();assert.equal(h.status().total.cancellations,1);assert.equal(h.status().total.exact,0);
  }
});

test('conflicting final revisions fail even if the first final happens to match the prompt',async()=>{
  const h=harness();h.consent();await h.start();const rec=h.instances[0];rec.emit('ás de espadas');rec.emit('ás de copas');rec.end();
  assert.equal(h.status().total.conflictingFinals,1);assert.equal(h.status().total.exact,0);
});

test('a removed or demoted final is not scored as an exact stable final',async()=>{
  for(const kind of ['removed','demoted']) {
    const h=harness();h.consent();await h.start();const rec=h.instances[0];rec.emit('ás de espadas');
    if(kind==='removed')rec.onresult({resultIndex:0,results:[]});else rec.emit('ás de espadas',false);
    rec.end();assert.equal(h.status().total.conflictingFinals,1);assert.equal(h.status().total.exact,0);
  }
});

test('reported latency uses the provider speechend event; final arriving before that event leaves metric absent',async()=>{
  const h=harness();h.consent();await h.start();const rec=h.instances[0];h.advance(100);rec.onspeechend();h.advance(25);rec.emit('ás de espadas');h.advance(5);rec.end();
  assert.equal(h.status().total.timing.speechEndEventToFinalMs.p50,25);assert.equal(h.status().total.timing.finalToScoreMs.p50,5);
  assert.equal(h.status().productionCardLatency,'NOT_MEASURED');
  await h.start();const next=h.instances[1];next.emit('ás de espadas');h.advance(10);next.onspeechend();next.end();
  assert.equal(h.status().total.timing.speechEndEventToFinalMs.n,1);assert.equal(h.status().total.timing.speechEndEventToFinalMs.missing,1);
});


test('practice advances through the checklist without reopening the microphone and permits review',async()=>{
  const h=harness();h.consent();
  const first=h.$('prompt').textContent;
  assert.equal(h.$('split').value,'practice');
  await h.start();h.instances[0].emit(first);h.instances[0].end();
  assert.equal(h.instances.length,1);assert.equal(h.active(),false);
  assert.notEqual(h.$('prompt').textContent,first);assert.match(h.$('progress').textContent,/1 of/);
  h.$('previous').click();assert.equal(h.$('prompt').textContent,first);assert.match(h.$('progress').textContent,/attempted/);
  h.$('phrase').value='7';h.$('phrase').fire('change');assert.match(h.$('progress').textContent,/Phrase 8/);
  assert.equal(h.instances.length,1);
});

test('closing options releases only the explicit phrase test and ignores late finals',async()=>{
  const h=harness();h.consent();await h.start();const rec=h.instances[0];
  h.elements.get('voice-settings-dialog').fire('close');
  assert.equal(rec.aborts,1);assert.equal(h.active(),true);
  rec.emit('ás de espadas');rec.end();
  assert.equal(h.active(),false);assert.equal(h.status().total.cancellations,1);assert.equal(h.status().total.exact,0);
});

test('failed recognition advances, but microphone startup failures retain the chosen phrase',async()=>{
  const h=harness();h.consent();const first=h.$('prompt').textContent;
  await h.start();h.instances[0].emit('not a valid command');h.instances[0].end();
  assert.notEqual(h.$('prompt').textContent,first);assert.equal(h.status().total.exact,0);
  const blocked=harness({release:async()=>{throw Error('No capture available');}});blocked.consent();
  const before=blocked.$('prompt').textContent;await blocked.start();assert.equal(blocked.$('prompt').textContent,before);
});

test('practice and benchmark progress and visible results remain separate',async()=>{
  const h=harness();h.consent();await h.start();h.instances[0].emit(h.$('prompt').textContent);h.instances[0].end();
  h.$('split').value='evaluation';h.$('split').fire('change');
  assert.match(h.$('summary').textContent,/No microphone tests for this selection/);
  assert.match(h.$('progress').textContent,/^0 of/);assert.equal(h.$('export').disabled,true);
  h.$('split').value='practice';h.$('split').fire('change');
  assert.match(h.$('summary').textContent,/1\/1 exact/);assert.equal(h.$('export').disabled,false);
  h.$('processing').value='device';h.$('processing').fire('change');
  assert.match(h.$('progress').textContent,/^0 of/);assert.equal(h.$('export').disabled,true);
});

test('practice follows main voice preferences until its own setting is explicitly chosen',()=>{
  const h=harness();const language=h.elements.get('voice-language');
  language.value='en-US';language.fire('change');assert.equal(h.$('language').value,'en-US');
  h.$('language').value='pt-BR';h.$('language').fire('change');
  language.value='en-US';language.fire('change');assert.equal(h.$('language').value,'pt-BR');
});
