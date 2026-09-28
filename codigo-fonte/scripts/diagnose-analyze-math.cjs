'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {decide}=require('../src/decision-engine'),{Lcg}=require('../src/equity-engine');
const {makeDeck}=require('../src/cards');
const args=Object.fromEntries(process.argv.slice(2).map(v=>v.replace(/^--/,'').split('=')));
const out=path.resolve(args.out||'../validacao/analyze-online-2026-09-27/math-diagnostic');
if(fs.existsSync(out))throw Error('Use diretório novo para preservar a tentativa anterior.');
fs.mkdirSync(out,{recursive:true});
const baselineRoot=path.resolve(args['baseline-root']||'../validacao/analyze-online-2026-09-27/baseline-source');
const baseline=require(path.join(baselineRoot,'src/decision-engine')).decide;
const schedule={type:'PERCENT_CAPPED',rate:.05,cap:6,noFlopNoDrop:true,rounding:'FLOOR_CENT',source:'SYNTHETIC_STUDY',version:'1'};
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const corpus=[];
for(const n of [4,5,6])for(const boardCount of [0,3,4,5])for(const position of ['BTN','BB'])for(const stackBB of [50,100])for(const cost of ['ZERO','SYNTHETIC'])for(const study of [false,true]){
  const fixture=corpus.length,rng=new Lcg(98317+fixture*919),deck=makeDeck().map(c=>c.code);
  for(let i=deck.length-1;i>0;i--){const j=Math.floor(rng.next()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
  const preflop=boardCount===0,H=preflop?(position==='BTN'?1:2):0,C=preflop?(position==='BTN'?1:0):(boardCount===4?2:0),P=preflop?(position==='BTN'?3:4):12;
  const raise=H+C>0,min=raise?2*(H+C):2,target=raise?Math.max(min,H+C+(P+C)/2):4;
  const input={variant:`PLO${n}_HIGH`,heroCards:deck.slice(0,n),board:deck.slice(12,12+boardCount),position,players:2,potBeforeAction:P,amountToCall:C,effectiveStack:2*stackBB-H,
    heroContribution:H,availableActions:C>0?['FOLD','CALL','RAISE']:['CHECK',raise?'RAISE':'BET'],minRaiseTo:raise?min:undefined,minBet:2,maxRaiseTo:H+Math.min(2*stackBB-H,P+2*C),
    ...(raise?{raiseTo:target}:{betSize:target}),unknownOpponentModel:'UNIFORM',futureStreetModel:{type:'SHOWDOWN_ONLY'},
    samples:256,samplingMode:'FIXED',seed:314159,practicalEquivalenceBB:.1,bigBlind:2,
    ...(cost==='ZERO'?{assumeNoRake:true}:{rakeSchedule:schedule}),
    ...(study?{aggressionStudy:{enabled:true,assumptionsAccepted:true,heroContribution:H,minRaiseTo:min,minBet:2,opponents:[{contribution:H+C,callProbability:.5}]}}:{})};
  corpus.push({fixture,dimensions:{variant:input.variant,street:({0:'PREFLOP',3:'FLOP',4:'TURN',5:'RIVER'})[boardCount],position,stackBB,cost,study},input});
}
const sources=['src/decision-engine.js','src/action-ev-engine.js','src/analyze-inference.js','src/rake-model.js','src/aggression-scenarios.js','src/analysis-contract.js','src/game-state.js','src/action-validator.js','src/equity-engine.js'];
const protocol={stage:'DEVELOPMENT_DIAGNOSTIC_NOT_CONFIRMATORY',source:'MODEL/SIMULATION',execution:'LOCAL_EXECUTED',createdAt:new Date().toISOString(),samples:256,seed:314159,fixtures:corpus.length,
  interpretation:'Synthetic state corpus, not hands, profitability or population-wide coverage. Equal samples and seed between candidate selection rules. Baseline has explicit zero cost in choices because 0.13.0 cannot read a rate schedule; costs are therefore a feature ablation, not identical cost information.',
  baselineRoot,baselineVersion:require(path.join(baselineRoot,'package.json')).version,candidateVersion:require('../package.json').version,
  hashes:Object.fromEntries(sources.map(name=>[name,hash(fs.readFileSync(path.resolve(__dirname,'..',name)))])),corpusHash:hash(JSON.stringify(corpus))};
fs.writeFileSync(path.join(out,'protocol.json'),JSON.stringify(protocol,null,2));
fs.writeFileSync(path.join(out,'inputs.json'),JSON.stringify(corpus,null,2));
const records=[];
for(const item of corpus){
  const before={...item.input,assumeNoRake:true};delete before.rakeSchedule;
  let previous;
  for(const [policy,engine,input] of [['BASELINE_0_13_0',baseline,before],['CANDIDATE_MARGINAL',decide,{...item.input,selectionInference:'MARGINAL'}],['CANDIDATE_PAIRED',decide,{...item.input,selectionInference:'SHARED_EQUITY_PAIRED'}]]){
    const start=performance.now();let result,error;
    try{result=engine(input);}catch(e){error=e.message;}
    const elapsedMs=performance.now()-start,rec=result?.recommendation,reasonCodes=result?.analysisDiagnostics?.reasonCodes||[result?.status!=='OK'?'UNAVAILABLE_MODEL':rec?.status==='INCOMPLETE'?'MISSING_ACTION_MODEL':result?.strategy?.baseline?.leadership?.status||rec?.status||'UNAVAILABLE'];
    const record={fixture:item.fixture,...item.dimensions,policy,status:result?.status||'ERROR',recommendationStatus:rec?.status||'UNAVAILABLE',abstained:rec?.status!=='CONDITIONAL',reasonCodes,
      action:rec?.action||null,pointLeader:rec?.pointLeader||null,error:error||null,reason:result?.reason,equity:result?.equity?.equity??null,samples:result?.equity?.samples??null,
      ev:Object.fromEntries(Object.entries(result?.ev?.actions||{}).filter(([,v])=>v.legal).map(([a,v])=>[a,v.ev])),selection:result?.strategy?.baseline?.leadership,elapsedMs};
    if(policy==='CANDIDATE_MARGINAL')previous=record;
    if(policy==='CANDIDATE_PAIRED'&&previous&&(previous.equity!==record.equity||previous.samples!==record.samples||JSON.stringify(previous.ev)!==JSON.stringify(record.ev)))throw Error('Selection changed the numerical calculation.');
    records.push(record);
  }
}
const summarize=rows=>({n:rows.length,abstentions:rows.filter(r=>r.abstained).length,abstentionPercent:100*rows.filter(r=>r.abstained).length/rows.length,
  reasons:Object.fromEntries([...new Set(rows.flatMap(r=>r.reasonCodes))].map(reason=>[reason,{count:rows.filter(r=>r.reasonCodes.includes(reason)).length,denominator:rows.length}])),errors:rows.filter(r=>r.error).length});
const summary={...protocol,policies:Object.fromEntries(['BASELINE_0_13_0','CANDIDATE_MARGINAL','CANDIDATE_PAIRED'].map(p=>[p,summarize(records.filter(r=>r.policy===p))])),
  strata:[...new Set(records.map(r=>JSON.stringify([r.policy,r.variant,r.street,r.position,r.stackBB,r.cost,r.study])))].map(key=>{const k=JSON.parse(key);return {policy:k[0],variant:k[1],street:k[2],position:k[3],stackBB:k[4],cost:k[5],study:k[6],...summarize(records.filter(r=>JSON.stringify([r.policy,r.variant,r.street,r.position,r.stackBB,r.cost,r.study])===key))};}),
  numericalParity:'PASS_EQUAL_EQUITY_SAMPLES_ACTION_EVS_BETWEEN_CANDIDATE_SELECTION_RULES',profitability:'NOT_EVALUATED_BY_STATE_CORPUS'};
fs.writeFileSync(path.join(out,'decisions.jsonl'),records.map(r=>JSON.stringify(r)).join('\n')+'\n');
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({out,fixtures:corpus.length,policies:summary.policies,numericalParity:summary.numericalParity}));
