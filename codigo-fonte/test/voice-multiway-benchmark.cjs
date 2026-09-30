'use strict';
// Synthetic transcript/ledger benchmark. No microphone, browser ASR, or audio.
const {execFileSync}=require('node:child_process');
const Module=require('node:module');
const {performance}=require('node:perf_hooks');
const current=require('../public/card-voice');
const baselineText=execFileSync('git',['show','937de9b:codigo-fonte/public/card-voice.js'],{encoding:'utf8'});
function load(text){const loaded=new Module('card-voice-baseline.js',module);loaded.filename='card-voice-baseline.js';loaded.paths=module.paths;loaded._compile(text,loaded.filename);return loaded.exports;}
const baseline=load(baselineText);
const betting={enabled:true,phase:'BETTING'};
const amount={...betting,pendingAmount:{action:'RAISE',actor:0}};
const cases={
  consecutiveCalls(core){
    const s=new core.RecognitionSession(),one={locale:'en-US',revisionKey:'turn-1'},two={locale:'en-US',revisionKey:'turn-2'};
    const id=s.begin(one),parse=(text,locale)=>core.parseContextual(text,locale,betting);
    s.reconcileResultCount(id,1);s.accept(id,0,'call',true);
    if(s.prepareNextFinal(id,one,parse)?.action!=='CALL'||s.take(one)?.action!=='CALL'||!s.resume(id,two))return false;
    s.reconcileResultCount(id,2);s.accept(id,0,'call',true);s.accept(id,1,'call',true);
    return s.prepareNextFinal(id,two,parse)?.action==='CALL'&&s.take(two)?.action==='CALL'&&s.prepareNextFinal(id,two,parse)===null;
  },
  ambiguity(core){
    try{core.parseContextual('call and fold','en-US',betting);return false;}catch{return true;}
  },
  inlineAmount(core){
    const value=core.parseContextual('twenty five','en-US',amount);
    return value.type==='amount'&&value.to===25;
  },
  staleFinal(core){
    const s=new core.RecognitionSession(),old={locale:'en-US',revisionKey:'hand-1'},next={locale:'en-US',revisionKey:'hand-2'};
    const id=s.begin(old);s.reconcileResultCount(id,1);s.accept(id,0,'call',true);
    return s.prepareNextFinal(id,next,(text,locale)=>core.parseContextual(text,locale,betting))===null&&/context changed/.test(s.error);
  }
};
const iterations=5000,rounds=5,warmup=1000,report={layer:'NODE_SYNTHETIC_TEXT_AND_SESSION',asr:'NOT_EXECUTED',microphone:'NOT_EXECUTED',baseline:'937de9b',iterations,rounds,cases:{}};
for(const [name,scenario] of Object.entries(cases)){
  const rows={baseline:[],current:[]},errors={baseline:0,current:0};
  for(const [label,core] of [['baseline',baseline],['current',current]])for(let i=0;i<warmup;i++)if(!scenario(core))throw Error(`${label} ${name} failed warmup`);
  for(let round=0;round<rounds;round++)for(const [label,core] of round%2?[['current',current],['baseline',baseline]]:[['baseline',baseline],['current',current]]){
    const start=performance.now();
    for(let i=0;i<iterations;i++)if(!scenario(core))errors[label]++;
    rows[label].push((performance.now()-start)*1000/iterations);
  }
  const summarize=values=>{const ordered=[...values].sort((a,b)=>a-b);return {medianMicroseconds:ordered[2],minMicroseconds:ordered[0],maxMicroseconds:ordered[4]};};
  report.cases[name]={baseline:summarize(rows.baseline),current:summarize(rows.current),errors};
}
console.log(JSON.stringify(report,null,2));
