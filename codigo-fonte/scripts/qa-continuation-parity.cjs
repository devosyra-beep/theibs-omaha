'use strict';
// Deterministic numerical parity only. No financial experiment, real account,
// server, production request, benchmark, or mutation of the frozen source.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const current=path.resolve(__dirname,'..'),evidence=path.resolve(current,'../validacao/continuar-2026-09-28');
const baseline=path.resolve(process.argv.find(x=>x.startsWith('--baseline='))?.slice(11)||path.join(evidence,'baseline0141/codigo-fonte'));
const out=path.resolve(process.argv.find(x=>x.startsWith('--out='))?.slice(6)||path.join(evidence,'numeric-parity.json'));
const archive=path.resolve(current,'../validacao/analyze-online-2026-09-27/theibs-web-source-0.14.1.zip');
assert.equal(fs.existsSync(out),false,'Refusing to overwrite existing parity evidence.');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const archiveHashBefore=hash(archive);
const oldDecide=require(path.join(baseline,'src/decision-engine')).decide,newDecide=require(path.join(current,'src/decision-engine')).decide;
const oldPrepare=require(path.join(baseline,'src/opponent-overrides')).prepareOpponentOverrides,newPrepare=require(path.join(current,'src/opponent-overrides')).prepareOpponentOverrides;
const oldVersion=require(path.join(baseline,'package.json')).version,newVersion=require(path.join(current,'package.json')).version;
assert.equal(oldVersion,'0.14.1');
const sourceFiles=Object.keys(require.cache).filter(file=>[baseline,current].some(root=>file===path.join(root,'package.json')||file.startsWith(path.join(root,'src')+path.sep))).sort();
const hashesBefore=Object.fromEntries(sourceFiles.map(file=>[file,hash(file)]));
const omittedPaths=['engineBuild','analysisId','continuationAssessment','provenance.engineBuild','provenance.inputHash','provenance.outputHash','provenance.createdAt','equity.elapsedMs','equity.simulationsPerSecond','scenarioSummary.additionalCalculationMs'];
function normalized(value){const copy=structuredClone(value);for(const name of omittedPaths){const parts=name.split('.'),field=parts.pop();let parent=copy;for(const part of parts)parent=parent?.[part];if(parent&&typeof parent==='object')delete parent[field];}return copy;}
const groups=['equity','ev','potMath','legalActions','recommendation','strategy','state','ranges','scenarioSummary','provenance'];
function stable(value){if(Array.isArray(value))return'['+value.map(x=>stable(x)??'null').join(',')+']';if(value&&typeof value==='object')return'{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';return JSON.stringify(value);}
const valueHash=value=>crypto.createHash('sha256').update(stable(value)).digest('hex');
const fixtures=[];
for(const count of[4,5,6]){
 const hero=['As','Ah','Ks','Kh','Qd','Jd'].slice(0,count),opponent=['Ac','Ad','Kc','Kd','Qs','Js'].slice(0,count);
 const common={variant:`PLO${count}_HIGH`,heroCards:hero,position:'BTN',potBeforeAction:12,amountToCall:4,effectiveStack:100,assumeNoRake:true,unknownOpponentModel:'UNIFORM',samples:500,samplingMode:'FIXED',seed:42,futureStreetModel:{type:'SHOWDOWN_ONLY'}};
 for(const[street,board]of[['PREFLOP',[]],['FLOP',['2c','3d','4h']],['TURN',['2c','3d','4h','9s']],['RIVER',['2c','3d','4h','9s','Tc']]]){
  for(const model of['HU_UNIFORM','FIVE_UNIFORM_OPPONENTS','KNOWN_HU','FIVE_OPPONENTS_CAPPED_RAKE']){
   const input={...common,street,board,players:model==='HU_UNIFORM'||model==='KNOWN_HU'?2:6};
   if(model==='KNOWN_HU'){input.opponentHands=[opponent];delete input.unknownOpponentModel;}
   if(model==='FIVE_OPPONENTS_CAPPED_RAKE'){delete input.assumeNoRake;input.potBeforeAction=60;input.amountToCall=12;input.rakeSchedule={type:'PERCENT_CAPPED',rate:.075,cap:1.25,noFlopNoDrop:true,rounding:'FLOOR_CENT',source:'USER_PROVIDED',version:'1'};}
   fixtures.push({id:`PLO${count}_${street}_${model}`,input});
  }
 }
 fixtures.push({id:`PLO${count}_RIVER_FREE_CHECK`,input:{...common,players:2,street:'RIVER',board:['2c','3d','4h','9s','Tc'],amountToCall:0}});
 fixtures.push({id:`PLO${count}_FLOP_EXPLICIT_CALL_RESPONSE`,input:{...common,players:3,street:'FLOP',board:['2c','3d','4h'],amountToCall:2,heroContribution:0,raiseTo:6,minRaiseTo:4,aggressionStudy:{enabled:true,assumptionsAccepted:true,heroContribution:0,minRaiseTo:4,opponents:[{contribution:2,callProbability:.3},{contribution:2,callProbability:.7}]}}});
 fixtures.push({id:`PLO${count}_FLOP_SEAT_SPECIFIC_RANGE`,input:{...common,players:3,street:'FLOP',board:['2c','3d','4h'],opponentOverrides:[{seatId:1,enabled:true,range:{hands:[opponent]},callProbability:.3}]}});
}
const report={schemaVersion:1,scope:'LOCAL_PURE_DECISION_ENGINE_PARITY',createdAt:new Date().toISOString(),baselineVersion:oldVersion,currentVersion:newVersion,baselinePath:baseline,currentPath:current,archive:{path:archive,sha256:archiveHashBefore},notFinancialExperiment:true,notPerformanceBenchmark:true,networkRequests:0,fixtureCount:fixtures.length,commonMonteCarloBudget:{samples:500,samplingMode:'FIXED',seed:42},exactCases:'Known HU postflop enumerates every legal runout instead of imposing a500sample cap.',comparedFields:{equity:'Complete equity object, including estimate, method, samples, seed, intervals, interval method, sampling mode, sampler diagnostics, opponents and ranges; only elapsedMs/simulationsPerSecond excluded.',ev:'Complete EV object and every legal/illegal action, status, value, costs, net pot, bounds, response branches and assumptions.',potMath:'Entire object: pot/call, potAfterCall, potOdds, scope, SPR, EV and raise cap.',legalActions:'Entire ordered list.',recommendation:'Entire recommendation object, status, action, point leader, candidates, coverage and scope.',other:'Full normalized decision result additionally compared, including strategy/leadership, state, ranges, warnings, reasons, scenario summary and cost/future-policy provenance.'},exactOmissions:omittedPaths,groupPassCounts:Object.fromEntries(groups.map(name=>[name,0])),cases:[],status:'RUNNING'};
try{
 for(const fixture of fixtures){
  const oldInput=oldPrepare(structuredClone(fixture.input)),newInput=newPrepare(structuredClone(fixture.input));
  assert.deepEqual(newInput,oldInput,`${fixture.id}: adapter inputs differ`);
  const before=oldDecide(oldInput),after=newDecide(newInput),a=normalized(before),b=normalized(after);
  assert.equal(before.status,'OK',`${fixture.id}: baseline invalid: ${before.reason}`);assert.equal(after.status,'OK',`${fixture.id}: current invalid: ${after.reason}`);
  for(const name of groups){assert.deepEqual(b[name],a[name],`${fixture.id}: ${name}`);report.groupPassCounts[name]++;}
  assert.deepEqual(b,a,`${fixture.id}: full normalized result`);
  assert.equal(before.continuationAssessment,undefined,`${fixture.id}: baseline unexpectedly contains the new field`);
  assert.ok(after.continuationAssessment,`${fixture.id}: new assessment absent`);
  report.cases.push({id:fixture.id,status:'PASS',input:fixture.input,normalizedResultSHA256:valueHash(a),actualMethod:after.equity.method,samples:after.equity.samples,seed:after.equity.seed,equity:after.equity.equity,equityInterval:after.equity.confidenceInterval95,callEV:after.ev.actions.CALL.ev,callEVInterval:after.ev.actions.CALL.confidenceInterval95??after.ev.actions.CALL.conditionalEvEnvelope??null,legalActions:after.legalActions,recommendation:after.recommendation.status,newAssessment:after.continuationAssessment.status});
 }
 assert.equal(hash(archive),archiveHashBefore,'Frozen archive changed during verification.');
 const hashesAfter=Object.fromEntries(sourceFiles.map(file=>[file,hash(file)]));assert.deepEqual(hashesAfter,hashesBefore,'Loaded source changed during verification.');
 report.frozenArchiveUnchanged=true;report.loadedSourceUnchanged=true;report.loadedSourceSHA256=Object.entries(hashesAfter).map(([file,sha256])=>({source:file.startsWith(baseline+path.sep)?'BASELINE':'CURRENT',path:path.relative(file.startsWith(baseline+path.sep)?baseline:current,file).replaceAll('\\','/'),sha256}));report.status='PASS';
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;}
fs.writeFileSync(out,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({status:report.status,cases:report.cases.length,expected:fixtures.length,baselineVersion:oldVersion,currentVersion:newVersion,groupPassCounts:report.groupPassCounts,out,failure:report.failure}));
