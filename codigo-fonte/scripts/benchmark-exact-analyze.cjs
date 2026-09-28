'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),os=require('node:os'),crypto=require('node:crypto');
const arg=(name,fallback)=>process.argv.find(x=>x.startsWith(name+'='))?.slice(name.length+1)||fallback;
const baseline=path.resolve(arg('--baseline','../validacao/analyze-online-2026-09-27/baseline-source'));
const out=path.resolve(arg('--out','../validacao/analyze-online-2026-09-27/performance-exact'));
fs.mkdirSync(out,{recursive:true});assert.equal(fs.readdirSync(out).length,0,'Use a new evidence directory.');
const baselineEngine=require(path.join(baseline,'src/equity-engine')),candidate=require('../src/equity-engine');
const fixtures=[4,5,6].flatMap(count=>[3,4,5].map(length=>({variant:`PLO${count}_HIGH`,heroCards:['As','Ks','Qh','Jh','Td','9d'].slice(0,count),opponentHands:[['Ac','Kc','Qs','Js','Tc','9c'].slice(0,count)],board:['2s','3h','4d','8c','7s'].slice(0,length)})));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const protocol={createdAt:new Date().toISOString(),fixtures,repeats:40,order:'ALTERNATING_BASELINE_CANDIDATE',gate:'EXACT_OUTPUT_EQUALITY_WITH_IDENTICAL_ENUMERATION',baselineHash:hash(path.join(baseline,'src/equity-engine.js')),candidateHash:hash(path.join(__dirname,'../src/equity-engine.js'))};
fs.writeFileSync(path.join(out,'protocol.json'),JSON.stringify(protocol,null,2));
const rows=[];
for(const [index,input]of fixtures.entries()) {
  // Initialization outside warm timings; both table sets independently created.
  assert.deepEqual(candidate.exactEquity(input),baselineEngine.exactEquity(input));
  for(let repeat=0;repeat<protocol.repeats;repeat++) {
    const values={};
    for(const id of repeat%2?['candidate','baseline']:['baseline','candidate']) {
      const started=performance.now(),result=(id==='candidate'?candidate:baselineEngine).exactEquity(input);
      values[id]={elapsedMs:performance.now()-started,result};
    }
    assert.deepEqual(values.candidate.result,values.baseline.result);
    rows.push({fixture:index,variant:input.variant,boardCards:input.board.length,repeat,samples:values.candidate.result.samples,baselineMs:values.baseline.elapsedMs,candidateMs:values.candidate.elapsedMs});
  }
}
const q=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
const groups=fixtures.map((f,i)=>{const group=rows.filter(r=>r.fixture===i);return {fixture:i,variant:f.variant,boardCards:f.board.length,n:group.length,baselineP50:q(group.map(r=>r.baselineMs),.5),candidateP50:q(group.map(r=>r.candidateMs),.5),baselineP95:q(group.map(r=>r.baselineMs),.95),candidateP95:q(group.map(r=>r.candidateMs),.95)};});
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({status:'PASS_EXACT_EQUALITY',execution:'LOCAL_EXECUTED',environment:{node:process.version,cpu:os.cpus()[0].model},protocol,groups,rows,limitations:['Warm exact-equity microbenchmark; excludes HTTP, paint and random-opponent Monte Carlo.','Identical runout counts and outcomes. Hardware and scheduling were not controlled.']},null,2));
console.log(JSON.stringify({status:'PASS_EXACT_EQUALITY',groups}));
