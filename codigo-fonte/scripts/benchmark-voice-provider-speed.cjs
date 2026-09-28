'use strict';
// Synthetic DEVELOPMENT AudioTrack through the browser's existing recognizer.
// No microphone fallback, account, model installation or paid service.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const option=(key,fallback)=>process.argv.find(x=>x.startsWith(`--${key}=`))?.slice(key.length+3)||fallback;
const base=path.resolve(__dirname,'../../validacao/voice-speed-2026-09-28');
const out=path.resolve(option('out',path.join(base,'baseline-native'))),fixtures=path.resolve(option('fixtures',path.join(base,'fixtures')));
const assets=option('assets',''),channel=option('channel','chrome'),repeats=Number(option('repeats','2')),label=option('label','baseline-0.14.3');
if(fs.existsSync(out)&&fs.readdirSync(out).length)throw Error('Preserve existing evidence; choose a new output directory.');fs.mkdirSync(out,{recursive:true});
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-asr-speed-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const report={at:new Date().toISOString(),label,appVersion:require('../package.json').version,channel,source:'SYNTHETIC_DEVELOPMENT_WAV_THROUGH_NATIVE_AUDIO_TRACK',environment:'LOCAL_REAL_APP_HTTP',microphone:'NOT_OPENED',humanAcousticGate:'NOT_EXECUTED',hosted:'NOT_EXECUTED',newService:'NONE',samplePlan:{repeats,scenarios:['single','batch'],locales:['pt-BR','en-US'],fixedAudioScheduleDelayMs:1000,forcedStopAfterWaveEndMs:500,timeoutMs:15000,collectUntil:'FIRST_PROVIDER_END_OR_ERROR',extraAutomaticCaptures:'SUPPRESSED_BY_PROBE_AFTER_FIRST_UTTERANCE'},assets:{},rows:[],status:'RUNNING'};
for(const name of ['card-voice.js','card-voice-ui.js','card-voice-fast.js']){const file=assets?path.join(path.resolve(assets),name):path.resolve(__dirname,'../public',name);if(!fs.existsSync(file)&&name==='card-voice-fast.js')continue;report.assets[name]={path:file,sha256:sha(fs.readFileSync(file))};}
let server,pool,browser;
const save=()=>fs.writeFileSync(path.join(out,'provider-speed.json'),JSON.stringify(report,null,2));
function summarize(row){
 const first=(type,test=()=>true)=>row.events.find(e=>e.event===type&&test(e))?.at??null;
 const start=first('start-request'),interim=first('result',e=>e.results.some(r=>!r.final&&r.text.trim())),valid=first('valid-card-interim'),final=first('result',e=>e.results.some(r=>r.final&&r.text.trim())),end=first('end'),chip=first('cards-applied'),paint=first('cards-second-raf'),speech=first('speechstart'),play=first('playback-scheduled');
 const delta=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?a-b:null;
 row.timing={startRequestAt:start,firstInterimAt:interim,firstValidCardInterimAt:valid,firstFinalAt:final,firstChipAt:chip,firstChipSecondRafAt:paint,recognizerEndAt:end,providerSpeechStartAt:speech,playbackAt:play,startToFirstInterimMs:delta(interim,start),startToFinalMs:delta(final,start),startToChipMs:delta(chip,start),firstInterimToFinalMs:delta(final,interim),firstValidCardInterimToFinalMs:delta(final,valid),finalToChipMs:delta(chip,final),finalToSecondRafMs:delta(paint,final),waveVoicedEndToChipMs:delta(chip,play===null?null:play+row.audio.lastVoicedSecond*1000),waveVoicedStartToChipMs:delta(chip,play===null?null:play+row.audio.firstVoicedSecond*1000)};
 row.stopRequests=row.events.filter(e=>e.event==='stop-request').map(e=>({afterStartMs:delta(e.at,start),sourceEnded:e.sourceEnded}));
 row.exact=JSON.stringify(row.appliedCards)===JSON.stringify(row.expectedCards);
 row.status=row.exact?'EXACT_SYNTHETIC_EXAMPLE':row.events.some(e=>e.event==='error')?'PROVIDER_ERROR':row.appliedCards.length?'TRANSCRIPTION_OR_APPLICATION_MISMATCH':'NO_APPLICATION';
}
(async()=>{try{
 ({server}=require('../server'));pool=require('../src/analysis-worker');await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 for(let repeat=1;repeat<=repeats;repeat++)for(const scenario of ['single','batch'])for(const locale of ['pt-BR','en-US']){
  const wav=path.join(fixtures,`${scenario}-${locale}.wav`),audio=fs.readFileSync(wav),row={repeat,scenario,locale,pace:scenario==='single'?'fast':'batch',audioPath:wav,audioSha256:sha(audio),expectedCards:scenario==='single'?['8c']:['As','Th'],events:[],pageErrors:[],status:'RUNNING'};
  console.log(`PROBE ${label} ${repeat}/${repeats} ${scenario} ${locale}`);
  browser=await chromium.launch({channel,headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});row.browser=browser.version();
  const page=await browser.newPage({viewport:{width:1440,height:1100},serviceWorkers:'block',permissions:['microphone']});page.on('pageerror',error=>row.pageErrors.push(error.message));
  if(assets)for(const name of Object.keys(report.assets))await page.route(`**/${name}`,route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(report.assets[name].path)}));
  await page.route('**/__speed-audio.wav',route=>route.fulfill({contentType:'audio/wav',body:audio}));
  await page.addInitScript(()=>{
   window.__speedEvents=[];window.__speedNative=window.SpeechRecognition||window.webkitSpeechRecognition;
   const record=(event,data={})=>__speedEvents.push({event,at:performance.now(),...data});window.__speedRecord=record;
   // A real microphone is never opened by this harness, even if a browser or
   // app attempts fallback. The native recognizer receives an explicit track.
   navigator.mediaDevices.getUserMedia=()=>Promise.reject(Error('Physical microphone forbidden in synthetic benchmark'));
   const Native=window.__speedNative;if(!Native)return;
   window.SpeechRecognition=class extends Native{
    constructor(){super();for(const name of ['start','audiostart','speechstart','speechend','audioend','end','error','result'])this.addEventListener(name,event=>{
     const results=event.results?Array.from(event.results).map(r=>({text:r[0].transcript,final:r.isFinal})):null;
     record(name,{...(event.error?{error:event.error}:{}),...(results?{results}:{}),recognizer:this.__speedId});
     if(results?.some(r=>!r.final)){try{const phrase=results.map(r=>r.text).join(' '),parsed=TheibsCardVoice.parse(phrase,this.lang);if(parsed.type==='cards')record('valid-card-interim',{cards:parsed.cards,phrase});}catch{}}
    });}
    start(){const prepared=window.__speedAudio;if(!prepared)throw Error('AudioTrack must be prepared; microphone fallback forbidden');this.__speedId=(window.__speedStarts=(window.__speedStarts||0)+1);if(this.__speedId>1){record('probe-extra-capture-suppressed');return;}
     prepared.context.resume();const source=prepared.context.createBufferSource(),destination=prepared.context.createMediaStreamDestination();source.buffer=prepared.buffer;source.connect(destination);this.__speedSource=source;this.__speedEnded=false;
     source.onended=()=>{this.__speedEnded=true;record('wave-ended');setTimeout(()=>{if(!window.__speedFinished){record('fixture-stop-fallback');this.stop();}},500);};
     record('start-request',{trackKind:destination.stream.getAudioTracks()[0].kind});super.start(destination.stream.getAudioTracks()[0]);const delay=1;record('playback-scheduled',{at:performance.now()+delay*1000});source.start(prepared.context.currentTime+delay);
    }
    stop(){record('stop-request',{sourceEnded:this.__speedEnded});return super.stop();}
    abort(){record('abort-request');return super.abort();}
   };
   document.addEventListener('theibs:cards-changed',()=>{if(!window.__speedCapture)return;record('cards-applied',{snapshot:theibsCardKeyboard.state.snapshot()});requestAnimationFrame(()=>requestAnimationFrame(()=>record('cards-second-raf',{snapshot:theibsCardKeyboard.state.snapshot()})));});
  });
  await page.goto(origin+'/app');await page.evaluate(()=>theibsApp.ready);await page.evaluate(()=>{document.querySelector('#auto-analysis').checked=false;theibsCardKeyboard.reset();});
  row.availability=await page.evaluate(async locale=>{const N=__speedNative,result={processLocally:Boolean(N&&'processLocally'in N.prototype)};for(const local of [false,true])try{result[local?'device':'browser']=typeof N?.available==='function'?await Promise.race([N.available({langs:[locale],processLocally:local}),new Promise(r=>setTimeout(()=>r('CHECK_TIMEOUT'),3000))]):'API_ABSENT';}catch(e){result[local?'device':'browser']=e.name+': '+e.message;}return result;},locale);
  row.fakeCaptureInventory=await page.evaluate(async()=>{const devices=await navigator.mediaDevices.enumerateDevices();return devices.filter(d=>d.kind==='audioinput').map(d=>({label:d.label,kind:d.kind}));});
  if(!row.fakeCaptureInventory.some(d=>/fake/i.test(d.label)))throw Error('Fake input inventory not confirmed; ASR refused.');
  row.audio=await page.evaluate(async()=>{const context=new AudioContext(),buffer=await context.decodeAudioData(await(await fetch('/__speed-audio.wav')).arrayBuffer()),values=buffer.getChannelData(0);let first=-1,last=-1,peak=0;for(let i=0;i<values.length;i++){peak=Math.max(peak,Math.abs(values[i]));if(Math.abs(values[i])>.015){if(first<0)first=i;last=i;}}window.__speedAudio={context,buffer};return {duration:buffer.duration,sampleRate:buffer.sampleRate,channels:buffer.numberOfChannels,peak,firstVoicedSecond:first/buffer.sampleRate,lastVoicedSecond:last/buffer.sampleRate,voiceBoundaryMethod:'abs(firstChannel)>0.015; descriptive waveform boundary, not human annotation'};});
  await page.locator('#card-voice-disclosure').evaluate(e=>e.open=true);await page.locator('#voice-language').selectOption(locale);await page.locator('#voice-auto-apply').check();if(await page.locator('#voice-pace').count())await page.locator('#voice-pace').selectOption(row.pace);await page.locator('#voice-consent').check();
  await page.evaluate(()=>{window.__speedCapture=true;__speedRecord('user-start');});await page.locator('#voice-toggle').click();
  await page.waitForFunction(()=>__speedEvents.some(e=>['error','end'].includes(e.event)),null,{timeout:15000}).catch(()=>{row.timeout=true;});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  row.appliedCards=await page.evaluate(()=>theibsCardKeyboard.state.cards().hero.map(TheibsCards.toCanonical));row.userMessage=await page.locator('#voice-status').innerText();row.uiMetrics=await page.evaluate(()=>theibsCardVoice.getMetrics());row.events=await page.evaluate(()=>__speedEvents);row.uiStatus=await page.evaluate(()=>theibsCardVoice.getStatus());
  await page.evaluate(()=>{window.__speedFinished=true;theibsCardVoice.cancel('Synthetic measurement complete');__speedAudio.context.close();});
  summarize(row);report.rows.push(row);save();console.log(JSON.stringify({scenario,locale,repeat,status:row.status,timing:row.timing}));await browser.close();browser=null;
 }
 report.status=report.rows.every(r=>r.exact&&!r.pageErrors.length)?'SYNTHETIC_EXACT_PASS':'INCONCLUSIVE_OR_MISMATCH';
}catch(error){report.status='PROBE_ERROR';report.error=error.stack;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();save();await browser?.close();await pool?.close();server?.closeAllConnections?.();await new Promise(r=>server?server.close(r):r());console.log(JSON.stringify({status:report.status,rows:report.rows.length,report:path.join(out,'provider-speed.json')}));}
})().then(()=>process.exit(process.exitCode||0));
