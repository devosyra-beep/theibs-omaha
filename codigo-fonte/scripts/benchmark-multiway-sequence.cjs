'use strict';
// Local deterministic grammar + ledger latency. This does not benchmark a
// microphone, acoustic accuracy, browser rendering, network or language model.
const fs=require('node:fs');
const voice=require('../public/card-voice'),multiway=require('../src/multiway-session');
const config={variant:'PLO5_HIGH',playerCount:3,heroPosition:'BB',startingStack:100,smallBlind:1,bigBlind:2,heroCards:[]};
const cases=[
  {name:'call_call_fold_hero_boundary',text:'call call fold',locale:'en-US',config,applied:2,stopReason:'HERO_TURN'},
  {name:'call_call_raise30_legal',text:'call call aumento 30',locale:'pt-BR',config:{...config,playerCount:6,heroPosition:'SB',startingStack:1000,smallBlind:5,bigBlind:10},applied:3,stopReason:'COMPLETE'},
  {name:'call_call_raise30_hero_boundary',text:'call call aumento 30',locale:'pt-BR',config,applied:2,stopReason:'HERO_TURN'},
  {name:'illegal_raise_atomic_rejection',text:'call aumento 999',locale:'pt-BR',config,reject:true}
].map(item=>({...item,initial:multiway.start(item.config)}));
function run(item,index){
  const started=performance.now();let error=null,correct=false;
  try{
    const sequence=voice.parseActionSequence(item.text,item.locale,{enabled:true,phase:'BETTING'});
    if(!sequence)throw Error('Sequence did not parse.');
    const options={expectedRevisionKey:item.initial.state.revisionKey,originEventId:`benchmark-speech-${index}`};
    const preview=multiway.previewSequence(item.initial.multiway,sequence.commands,options);
    const result=multiway.batch(item.initial.multiway,sequence.commands,{...options,expectedPreviewKey:preview.previewKey});
    correct=!item.reject&&preview.appliedCount===item.applied&&preview.stopReason===item.stopReason&&
      result.multiway.events.length===item.applied&&!result.multiway.events.some(event=>event.actor===result.state.heroId);
  }catch(caught){error=caught.message;correct=Boolean(item.reject&&/between/.test(error));}
  return {case:item.name,elapsedMs:performance.now()-started,correct,rejected:Boolean(error),error};
}
for(let i=0;i<8;i++)run(cases[i%cases.length],`warmup-${i}`);
const attempts=Array.from({length:200},(_,index)=>run(cases[index%cases.length],index));
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)];
function metrics(rows){const times=rows.map(row=>row.elapsedMs);return {attempts:rows.length,correctOutcomes:rows.filter(row=>row.correct).length,
  unexpectedFailures:rows.filter(row=>!row.correct).length,rejected:rows.filter(row=>row.rejected).length,
  p50Ms:percentile(times,.5),p95Ms:percentile(times,.95),maxMs:Math.max(...times)};}
const result={evidence:'MODEL',runtime:process.version,scope:'LOCAL_DIRECT_PARSER_PLUS_PREVIEW_PLUS_ATOMIC_BATCH',
  excludes:['acoustic recognition','browser rendering','network','language model'],llamaInvocations:0,
  trafficShareMeasured:false,percentiles:'Nearest rank, every attempt included; expected rejection cases also timed.',
  total:metrics(attempts),cases:cases.map(item=>({name:item.name,text:item.text,locale:item.locale,...metrics(attempts.filter(row=>row.case===item.name))})),
  unexpectedFailures:attempts.filter(row=>!row.correct)};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');
process.stdout.write(JSON.stringify(result,null,2)+'\n');
if(result.total.unexpectedFailures)process.exitCode=1;
