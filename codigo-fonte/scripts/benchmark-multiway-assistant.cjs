'use strict';
// Explicit operator benchmark. This does not enable a model or mutate a hand.
const fs=require('node:fs'),path=require('node:path');
const assistant=require('../src/multiway-assistant'),mw=require('../src/multiway-session'),provider=require('../src/multiway-llm-provider');
const activate=process.argv.includes('--activate');
const output=process.argv.slice(2).find(value=>!value.startsWith('--'))||path.resolve(__dirname,'../../validacao/multiway-assistant-real.json');
const settings=process.env.THEIBS_MULTIWAY_LLM_PROVIDER==='cloudflare'?provider.runtimeConfig():{provider:'ollama',model:'llama3.2:3b',baseUrl:'http://127.0.0.1:11434',timeoutMs:8000};
const model=settings.model,remote=settings.provider==='cloudflare';
const pre=mw.start({variant:'PLO4_HIGH',playerCount:3,heroPosition:'BB',startingStack:100,smallBlind:.5,bigBlind:1,heroCards:[]});
let flop=pre;
while(flop.state.phase==='BETTING')flop=mw.step(flop.multiway,{type:'ACT',actor:flop.state.actor,action:flop.state.legal.toCall?'CALL':'CHECK'});
flop=mw.step(flop.multiway,{type:'BOARD',cards:['2s','3h','4d']});
const cases=[
 ['en-US','The player whose turn it is lets his cards go.','FOLD',pre],
 ['pt-BR','O jogador da vez vai completar o valor que falta.','CALL',pre],
 ['en-US','He makes it three big blinds total.','RAISE',pre,3],
 ['pt-BR','Quero registrar que ele desistiu da mão.','FOLD',pre],
 ['en-US','The highlighted player knocks the table without putting chips in.','CHECK',flop],
 ['pt-BR','O jogador da vez passou a vez sem apostar.','CHECK',flop],
 ['en-US','The player in turn bets a total of two chips.','BET',flop,2],
 ['pt-BR','O jogador da vez aumentou para um total de três big blinds.','RAISE',pre,3],
 ['en-US','He will fold or call.',null,pre],
 ['pt-BR','Talvez ele tenha aumentado, não tenho certeza.',null,pre],
 ['en-US','He puts a total of 12 chips in this street.',null,pre],
 ['en-US','The BB calls.',null,pre],
 ['en-US','He raised from two to three chips.',null,pre],
 ['en-US','He did not fold, he called.',null,pre],
 ['en-US','He went all in for five chips.',null,pre]
];
function percentile(values,p){const a=values.slice().sort((a,b)=>a-b);return a[Math.ceil(a.length*p)-1]??null;}
(async()=>{
 if(activate && (!remote || process.env.THEIBS_MULTIWAY_LLM_VALIDATE!=='true')){
   console.log('Multiway assistant gate skipped: explicit remote validation is not configured.');return;
 }
 const installed=remote?null:(await(await fetch(settings.baseUrl+'/api/tags')).json()).models.find(m=>m.name===model);
 const results=[];
 for(let repeat=0;repeat<2;repeat++)for(let i=0;i<cases.length;i++){
   // Respect the same provider rate limits used by normal requests. Synthetic
   // evaluation never uses audio, player libraries, or a user's current hand.
   if(remote && results.length)await new Promise(resolve=>setTimeout(resolve,10100));
   const [locale,text,expected,state,size]=cases[i],t=performance.now();let result;
   try{result=await assistant.interpret({multiway:state.multiway,revisionKey:state.state.revisionKey,text,locale,originEventId:`audit:${repeat}:${i}`,remoteTextConsent:remote},{owner:'operator-synthetic-validation',config:settings,allowUnvalidated:true});}
   catch(error){result={status:'BLOCKED',reason:error.message};}
   const pass=expected?result.status==='PROPOSED'&&result.event?.action===expected&&(size==null||result.event.to===size):result.status!=='PROPOSED';
   const row={repeat,case:i,expected,result,elapsedMs:performance.now()-t,pass};results.push(row);console.log(JSON.stringify({repeat,case:i,expected,actual:result.event?.action||result.status,ms:row.elapsedMs,pass}));
 }
 const real=results.filter(r=>['LOCAL_LLM_INTERPRETATION','REMOTE_LLM_INTERPRETATION'].includes(r.result.method)),warm=real.filter(r=>!(r.repeat===0&&r.case===0)).map(r=>r.elapsedMs);
 const report={evidence:remote?'REAL_REMOTE_MODEL_TEXT_INTERPRETATION_NOT_ACOUSTIC':'REAL_LOCAL_MODEL_TEXT_INTERPRETATION_NOT_ACOUSTIC',createdAt:new Date().toISOString(),provider:settings.provider,model,digest:installed?.digest,capabilities:installed?.capabilities,
  results,summary:{cases:results.length,passed:results.filter(r=>r.pass).length,modelProposals:real.length,modelP50Ms:percentile(warm,.5),modelP95Ms:percentile(warm,.95),firstRequestMs:results[0]?.elapsedMs},
  activationGate:{use:'ACTION_PROPOSAL',manualConfirmation:true,passed:results.every(r=>r.pass)&&real.length>=10,notAutomaticActionExecution:true}};
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary));
 if(activate){
   const validation={models:{},rule:'UNVALIDATED_USES_DISABLED'};
   if(report.activationGate.passed)validation.models[`${settings.provider}:${model}`]={passed:true,uses:['ACTION_PROPOSAL'],contractHash:assistant.contractFingerprint(),createdAt:report.createdAt,evidence:report.evidence,...report.summary,scope:'Thirty synthetic phrases; manual confirmation only. Not an acoustic or general accuracy estimate.'};
   fs.writeFileSync(path.resolve(__dirname,'../src/multiway-assistant-validation.json'),JSON.stringify(validation,null,2));
   console.log(JSON.stringify({assistantActivation:report.activationGate.passed?'PASSED':'DISABLED',provider:settings.provider,model}));
 }else if(!report.activationGate.passed)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1});
