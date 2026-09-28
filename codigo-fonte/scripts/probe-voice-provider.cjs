'use strict';
// Integration probe using generated WAVs and Chromium's fake capture devices.
// This is synthetic DEVELOPMENT audio, never a held-out human accuracy study.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const channel=process.argv.find(x=>x.startsWith('--channel='))?.slice(10)||'msedge';
const audioSource=process.argv.includes('--source=track')?'track':'fake-device';
const scenario=process.argv.includes('--scenario=action')?'action':'cards';
const preflight=process.argv.includes('--preflight=enumerate')?'enumerate':'capture';
const out=path.resolve(process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'../validacao/analyze-online-2026-09-27/voice');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-synthetic-asr-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const report={at:new Date().toISOString(),source:'SYNTHETIC_AUDIO',split:'DEVELOPMENT',environment:'LOCAL_EXECUTED',humanAcousticGate:'NOT_EXECUTED',hosted:'NOT_EXECUTED',rows:[],status:'RUNNING'};
let server,browser;
(async()=>{
try{
 ({server}=require('../server'));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 for(const locale of ['pt-BR','en-US']){
  const wav=path.join(out,`synthetic-${scenario==='action'?'action-':''}${locale}.wav`);if(!fs.existsSync(wav))throw Error('Generate synthetic WAV fixtures before probing.');
  browser=await chromium.launch({channel,headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${wav}%noloop`]});
  const row={locale,browser:browser.version(),audioSource,wavSha256:crypto.createHash('sha256').update(fs.readFileSync(wav)).digest('hex'),reference:locale==='pt-BR'?'ás de espadas, dez de copas':'ace of spades, ten of hearts',expectedCards:['As','Th'],status:'RUNNING'};
  row.scenario=scenario;row.preflight=preflight;
  if(scenario==='action'){row.reference=locale==='pt-BR'?'eu aumento para dois vírgula cinco':'I raise to two point five';row.expectedEvent={type:'ACT',actor:0,action:'RAISE',to:2.5};delete row.expectedCards;}
  const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1366,height:1000},...(preflight==='enumerate'?{permissions:['microphone']}:{})});
  await page.route('**/__synthetic-audio.wav',route=>route.fulfill({contentType:'audio/wav',body:fs.readFileSync(wav)}));
  await page.addInitScript(sourceMode=>{
   window.__nativeVoiceEvents=[];const Native=window.SpeechRecognition||window.webkitSpeechRecognition;
   if(!Native)return;window.__NativeSpeechRecognition=Native;
   window.SpeechRecognition=class extends Native{
    constructor(){super();for(const name of ['start','audiostart','speechstart','speechend','audioend','end','error','result'])this.addEventListener(name,event=>{
     window.__nativeVoiceEvents.push({event:name,at:performance.now(),...(event.error?{error:event.error}:{}),...(event.results?{results:Array.from(event.results).map(r=>({text:r[0].transcript,final:r.isFinal}))}:{})});
    });}
    start(){
     if(sourceMode==='track'){
      const prepared=window.__preparedSyntheticTrack;if(!prepared)throw Error('Synthetic AudioTrack not prepared; microphone fallback forbidden.');
      prepared.context.resume();prepared.source.onended=()=>setTimeout(()=>this.stop(),500);
      window.__nativeVoiceEvents.push({event:'explicit-audio-track',kind:prepared.track.kind,readyState:prepared.track.readyState,at:performance.now()});
      super.start(prepared.track);prepared.source.start(prepared.context.currentTime+1);
     }else super.start();
    }
   };
  },audioSource);
  const url=`http://127.0.0.1:${server.address().port}/app`;await page.goto(url);await page.evaluate(()=>theibsApp.ready);
  if(scenario==='action'){
   await page.evaluate(()=>{document.querySelector('#auto-analysis').checked=false;theibsCardKeyboard.reset();theibsCardKeyboard.paste('AE KC QO JP TE');});
   await page.locator('#open-settings').click();await page.locator('#mw-setup-details').evaluate(e=>e.open=true);await page.locator('#mw-player-count').selectOption('2');await page.locator('#mw-hero-position').selectOption('SB');await page.locator('#mw-start').click();await page.waitForFunction(()=>!theibsApp.getState().multiwayBusy);
  }
  row.capability=await page.evaluate(()=>theibsCardVoice.capability());
  row.availability=await page.evaluate(async locale=>{
   const Native=window.__NativeSpeechRecognition,values={processLocallyProperty:Boolean(Native&&'processLocally' in Native.prototype)};
   for(const local of [false,true]){
    try{values[local?'device':'browser']=typeof Native?.available==='function'?await Promise.race([Native.available({langs:[locale],processLocally:local}),new Promise(r=>setTimeout(()=>r('CHECK_TIMEOUT'),3000))]):'API_ABSENT';}
    catch(error){values[local?'device':'browser']=error.name+': '+error.message;}
   }
   return values;
  },locale);
  // Assert the OS microphone is not the capture device before starting ASR.
  row.fakeCapture=preflight==='enumerate'?await page.evaluate(async()=>{
   const devices=await navigator.mediaDevices.enumerateDevices(),device=devices.find(d=>d.kind==='audioinput'&&/fake.*default|default.*fake/i.test(d.label));
   return {label:device?.label||'',kind:device?.kind||'',captureOpened:false};
  }):await page.evaluate(async()=>{
   const media=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
   const track=media.getAudioTracks()[0],value={label:track.label,kind:track.kind};media.getTracks().forEach(t=>t.stop());return value;
  });
  if(!/fake/i.test(row.fakeCapture.label))throw Error('Fake capture was not confirmed; refusing to start ASR.');
  if(audioSource==='track')row.decodedAudio=await page.evaluate(async()=>{
   const context=new AudioContext(),buffer=await context.decodeAudioData(await(await fetch('/__synthetic-audio.wav')).arrayBuffer());
   const source=context.createBufferSource();source.buffer=buffer;const destination=context.createMediaStreamDestination();source.connect(destination);
   window.__preparedSyntheticTrack={context,source,track:destination.stream.getAudioTracks()[0]};
   const values=buffer.getChannelData(0);return {duration:buffer.duration,sampleRate:buffer.sampleRate,peak:values.reduce((m,x)=>Math.max(m,Math.abs(x)),0),channels:buffer.numberOfChannels};
  });
  await page.locator('#card-voice-disclosure>summary').click();await page.locator('#voice-language').selectOption(locale);await page.locator('#voice-consent').check();await page.locator('#voice-toggle').click();
  // A provider may emit empty/early segments while audio is still playing.
  // Do not terminate the waveform merely because the first result arrived.
  await page.waitForFunction(()=>__nativeVoiceEvents.some(e=>e.event==='error'||e.event==='end'),null,{timeout:12000}).catch(()=>{});
  if(await page.evaluate(()=>theibsCardVoice.getStatus().listening))await page.locator('#voice-toggle').click();
  await page.waitForFunction(()=>!theibsCardVoice.getStatus().listening,null,{timeout:5000}).catch(()=>{});
  row.events=await page.evaluate(()=>__nativeVoiceEvents);row.userMessage=await page.locator('#voice-status').innerText();
  row.proposal=await page.locator('#voice-proposal').innerText();row.reviewVisible=await page.locator('#voice-review').isVisible();
  row.status=row.events.some(e=>e.results?.some(r=>r.text.trim()))?'TEXT_RECEIVED':row.events.some(e=>e.event==='result')?'EMPTY_TRANSCRIPTION':'PROVIDER_UNAVAILABLE';
  // Never apply a card from synthetic audio without the same explicit review.
  if(row.reviewVisible){
   await page.locator('#voice-apply').click();await page.waitForFunction(()=>theibsCardVoice.getStatus().phase==='cancelled');
   if(scenario==='action'){row.appliedEvent=await page.evaluate(()=>theibsApp.getState().multiway.events.at(-1));row.exactDevelopmentExample=Object.entries(row.expectedEvent).every(([key,value])=>row.appliedEvent?.[key]===value);}
   else{row.appliedCards=await page.evaluate(()=>theibsCardKeyboard.state.cards().hero.map(TheibsCards.toCanonical));row.exactDevelopmentExample=JSON.stringify(row.appliedCards)===JSON.stringify(row.expectedCards);}
  }
  else row.exactDevelopmentExample=null;
  report.rows.push(row);await browser.close();browser=null;
 }
 report.status=report.rows.every(r=>r.exactDevelopmentExample===true)?'SYNTHETIC_SMOKE_PASS':'INCONCLUSIVE_PROVIDER_INTEGRATION';
}catch(error){report.status='PROBE_ERROR';report.error=error.stack;process.exitCode=1;}
finally{fs.writeFileSync(path.join(out,`provider-probe-${channel}${audioSource==='track'?'-track':''}${scenario==='action'?'-actions':''}${preflight==='enumerate'?'-enumerate':''}.json`),JSON.stringify(report,null,2));await browser?.close();await new Promise(r=>server?server.close(r):r());console.log(JSON.stringify(report));}
})().then(()=>process.exit(process.exitCode||0));
