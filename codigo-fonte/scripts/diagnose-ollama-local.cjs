'use strict';
// Read-only inventory by default. --chat runs synthetic local inference;
// --impact additionally compares two short MC analyses with/without inference.
// This script never installs, starts, pulls a model, or contacts a remote API.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const base='http://127.0.0.1:11434',model=process.argv.find(a=>a.startsWith('--model='))?.slice(8)||'llama3.2:1b';
if(!['llama3.2:1b','llama3.2:3b'].includes(model))throw Error('This diagnostic only supports the explicitly installed local Llama 3.2 models.');
const report={at:new Date().toISOString(),environment:'LIVE_LOCAL_OLLAMA',endpoint:base,model,cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem(),freeMemoryBefore:os.freemem(),inferences:[],limitations:['Synthetic local inference; does not validate all coaching answers','Cold/warm and CPU-contention measurements are short observations, not an SLA'],status:'RUNNING'};
async function api(route,body){const r=await fetch(base+route,{method:body?'POST':'GET',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(`${route} HTTP${r.status}: ${await r.text()}`);return r.json();}
const options={temperature:0,seed:42,num_ctx:2048,num_thread:2,num_predict:128};
const messages=[{role:'system',content:'Responda em português com no máximo duas frases. Explique somente os fatos fornecidos pelo motor. Não recalcule valores, não invente números nem recomende ação cujo EV não foi calculado. Não prometa lucro.'},{role:'user',content:'O motor informa um cenário hipotético: PLO6 contra 4 adversários, equity de 28,23%, preço exige 40%, EV do call = -0,29 fichas, EV do raise não calculado. Explique por que ter uma mão acima da média não torna esse call positivo e qual conclusão ainda não podemos tirar.'}];
async function chat(label){const started=performance.now();const r=await api('/api/chat',{model,messages,stream:false,options,keep_alive:'2m'});const row={label,elapsedMs:performance.now()-started,model:r.model,done:r.done,doneReason:r.done_reason,text:r.message?.content,loadMs:r.load_duration/1e6,promptTokens:r.prompt_eval_count,promptMs:r.prompt_eval_duration/1e6,outputTokens:r.eval_count,generationMs:r.eval_duration/1e6,tokensPerSecond:r.eval_duration?r.eval_count*1e9/r.eval_duration:null};report.inferences.push(row);console.log(JSON.stringify(row));return row;}
(async()=>{let analyze;try{
 report.server=await api('/api/version');const tags=await api('/api/tags');report.installedModel=tags.models?.find(x=>x.name===model)||null;
 if(!report.installedModel)throw Error('Requested local model is not installed.');
 const info=await api('/api/show',{model});report.modelDetails=info.details;report.capabilities=info.capabilities;
 if(process.argv.includes('--chat')){
  await api('/api/generate',{model,keep_alive:0,stream:false});
  await chat('cold');await chat('warm');report.residentModels=await api('/api/ps');
  if(process.argv.includes('--impact')){
   analyze=require('../src/analysis-worker');const input={variant:'PLO6_HIGH',heroCards:['As','Ks','Qh','Jh','Td','9d'],board:[],players:5,position:'BTN',potBeforeAction:12,amountToCall:4,effectiveStack:100,assumeNoRake:true,unknownOpponentModel:'UNIFORM',samples:50000,samplingMode:'FIXED',seed:91381};
   await analyze({...input,samples:2000});
   const before=performance.now(),alone=await analyze(input),aloneMs=performance.now()-before;
   let inferenceDone=false;const pending=chat('concurrent-with-MC').finally(()=>{inferenceDone=true;});await new Promise(r=>setTimeout(r,150));
   const overlapAtStart=!inferenceDone,start=performance.now(),during=await analyze(input),duringMs=performance.now()-start,overlapAtEnd=!inferenceDone;
   await pending;
   report.impact={variant:input.variant,opponents:4,samples:alone.equity.samples,aloneMs,concurrentMs:duringMs,alonePerSecond:alone.equity.samples*1000/aloneMs,concurrentPerSecond:during.equity.samples*1000/duringMs,overlapAtStart,overlapAtEnd,identicalEquity:alone.equity.equity===during.equity.equity,scope:'One matched pair, same seed; no sustained performance claim'};
  }
 }
 report.freeMemoryAfter=os.freemem();report.status='PASS_CONNECTIVITY_AND_INFERENCE_ONLY';report.validationScope='Transport, model presence, completion and timing. A completed answer is not evidence of factual correctness.';
}catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;}
finally{await analyze?.close?.();const out=path.resolve(__dirname,'../../validacao/ollama-local-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({report:out,status:report.status,server:report.server,installedModel:report.installedModel,impact:report.impact,error:report.error}));}
})();
