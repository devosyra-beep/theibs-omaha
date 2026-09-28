'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{performance}=require('node:perf_hooks');
const voice=require('../public/card-voice'),{CardKeyboardState}=require('../public/card-model');
const fixtures=[];
for(const count of [4,5,6])for(const locale of ['pt-BR','en-US']){
 const ranks=locale==='pt-BR'?voice.RANKS:voice.EN_RANKS,suits=locale==='pt-BR'?voice.SUITS:voice.EN_SUITS;
 const values=[...new Map(Object.entries(ranks).filter(([text])=>!/^\d/.test(text)).map(([text,value])=>[value,text])).values()];
 const colors=[...new Map(Object.entries(suits).map(([text,value])=>[value,text])).values()];
 for(const rank of values)for(const suit of colors)fixtures.push({count,locale,text:`${rank} ${locale==='pt-BR'?'de':'of'} ${suit}`});
}
const samples=[];
for(let rep=0;rep<60;rep++)for(const f of fixtures){
 const state=new CardKeyboardState(f.count),start=performance.now(),proposal=voice.parse(f.text,f.locale),parsed=performance.now();
 if(!state.applyCommand(proposal))throw Error(state.error);
 const end=performance.now();if(rep>=10)samples.push({parserMs:parsed-start,typedCommitMs:end-parsed,totalMs:end-start});
}
function summary(key){const a=samples.map(x=>x[key]).sort((a,b)=>a-b);return {n:a.length,p50:a[Math.ceil(.5*a.length)-1],p95:a[Math.ceil(.95*a.length)-1],p99:a[Math.ceil(.99*a.length)-1],max:a.at(-1)};}
const report={at:new Date().toISOString(),environment:'LOCAL_EXECUTED',layer:'NODE_PARSER_AND_PURE_STATE',source:'DETERMINISTIC_TEXT',browserRender:'NOT_MEASURED',asr:'NOT_MEASURED',voiceAccuracy:'NOT_MEASURED',
 node:process.version,cpu:os.cpus()[0]?.model,fixtureCount:fixtures.length,warmupRepetitions:10,measuredRepetitions:50,parser:summary('parserMs'),typedCommit:summary('typedCommitMs'),total:summary('totalMs'),
 limitations:['Warm in-process measurements on one computer. Repeated deterministic text cases are not independent human voice examples.','No DOM, network, ASR, microphone or actual display latency is measured here.']};
const out=path.resolve('../validacao/analyze-online-2026-09-27/voice/parser-performance.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
