'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(process.argv[2]||path.join(__dirname,'../../validacao/voice-speed-2026-09-28'));
const files=['baseline-final/provider-speed.json','candidate-final/provider-speed.json'],[baseline,candidate]=files.map(f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8')));
assert.equal(baseline.status,'SYNTHETIC_EXACT_PASS');assert.equal(candidate.status,'SYNTHETIC_EXACT_PASS');assert.equal(baseline.rows.length,8);assert.equal(candidate.rows.length,8);
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length,summary=xs=>({n:xs.length,mean:mean(xs),min:Math.min(...xs),max:Math.max(...xs)}),groups=[];
for(const scenario of ['single','batch'])for(const locale of ['pt-BR','en-US']){
 const a=baseline.rows.filter(r=>r.scenario===scenario&&r.locale===locale),b=candidate.rows.filter(r=>r.scenario===scenario&&r.locale===locale);
 for(let i=0;i<a.length;i++){assert.equal(a[i].audioSha256,b[i].audioSha256);assert.equal(a[i].browser,b[i].browser);assert.equal(a[i].repeat,b[i].repeat);assert.deepEqual(a[i].expectedCards,b[i].expectedCards);assert.equal(a[i].exact,true);assert.equal(b[i].exact,true);assert.equal(a[i].pageErrors.length,0);assert.equal(b[i].pageErrors.length,0);}
 const group={scenario,locale,browser:a[0].browser,wavSha256:a[0].audioSha256,exact:{baseline:a.length,candidate:b.length},metrics:{}};
 for(const metric of ['waveVoicedEndToChipMs','firstValidCardInterimToFinalMs','startToFirstInterimMs','startToFinalMs','finalToChipMs','finalToSecondRafMs']){
  const av=a.map(r=>r.timing[metric]),bv=b.map(r=>r.timing[metric]);assert.ok([...av,...bv].every(Number.isFinite));group.metrics[metric]={baseline:summary(av),candidate:summary(bv),differenceMs:mean(bv)-mean(av),reductionPercent:100*(mean(av)-mean(bv))/mean(av)};
 }
 group.stopRequests={baseline:a.map(r=>r.stopRequests),candidate:b.map(r=>r.stopRequests)};groups.push(group);
}
const result={at:new Date().toISOString(),classification:'DESCRIPTIVE_SYNTHETIC_DEVELOPMENT_COMPARISON',status:'16_EXACT_EXAMPLES',samplesPerVersion:8,comparisonsPerCell:2,scope:'Local native Chrome AudioTrack; same WAVs/browser/source schedule; no concurrent test suites in final runs',humanAcoustic:'NOT_EXECUTED',hosted:'NOT_EXECUTED',SLA:'NOT_ESTABLISHED',confidenceIntervals:'NOT_ESTIMATED',limitations:['Sequential baseline then candidate; network/provider conditions not randomized.','Only two repetitions per cell and synthetic desktop TTS voices.','Waveform boundary uses amplitude threshold and an estimated scheduled playback timestamp.','Later product change refreshes on-device availability cache TTL; Browser path tested here does not use that cache.'],sources:files.map(f=>({path:f,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')})),groups};
const destination=path.join(root,'comparison.json');if(fs.existsSync(destination))throw Error('Preserve existing comparison; choose a new evidence root.');fs.writeFileSync(destination,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
