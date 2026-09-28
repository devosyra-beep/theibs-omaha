'use strict';
// POST HOC explanation only. Never rewrites the trial, changes outcomes,
// replays hands or recommends a policy tuned on holdout results.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),readline=require('node:readline'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'../../validacao/analyze-online-2026-09-27/economics');
const trial=path.join(base,'holdout-v2'),out=path.resolve(process.argv.find(x=>x.startsWith('--out='))?.slice(6)||path.join(base,'posthoc-abstention-diagnostic.json'));
assert.equal(fs.existsSync(out),false,'Do not overwrite prior diagnostics.');
const protocol=JSON.parse(fs.readFileSync(path.join(trial,'protocol.json'),'utf8'));
const completed=JSON.parse(fs.readFileSync(path.join(trial,'completed.json'),'utf8'));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
assert.equal(hash(fs.readFileSync(path.join(trial,'protocol.json'))),completed.protocolHash);
const frozen=protocol.candidateRoot,{buildAnalyzeInput}=require(path.join(frozen,'src/analyze-policy'));
const {decide}=require(path.join(frozen,'src/decision-engine')),{fingerprint}=require(path.join(frozen,'src/analysis-contract'));
const report={classification:'POST_HOC_EXPLANATORY_REQUERY_FROZEN_MODEL',at:new Date().toISOString(),protocolHash:completed.protocolHash,
  claim:'Explains recorded abstentions only. No new hands, altered actions, outcome adjustment, strategy tuning, profitability or timing inference.',
  requeryIdentity:'Exact public-input hash; analysisId is not replay-stable because outputHash includes calculation elapsed time. Compare recorded reason codes, recommendation status, samples and point leader instead.',
  cases:[],reasonCounts:{},inputHashMatches:0,semanticDecisionMatches:0};
(async()=>{
  const stream=fs.createReadStream(path.join(trial,'hands.jsonl')),lines=readline.createInterface({input:stream,crlfDelay:Infinity});
  for await(const line of lines){
    if(!line.includes('MISSING_ACTION_MODEL'))continue;
    const row=JSON.parse(line);if(row.policy!=='candidate')continue;
    row.decisions.forEach((decision,index)=>{
      if(!decision.reasonCodes.includes('MISSING_ACTION_MODEL'))return;
      const settings={...protocol.settings,assumeNoRake:!decision.observation.rakeSchedule,
        equitySeed:parseInt(hash(`analysis:${protocol.seedNamespace}:${row.scenario}:${row.block}:${row.hand}:${index}`).slice(0,8),16),selectionInference:'SHARED_EQUITY_PAIRED'};
      const input=buildAnalyzeInput(decision.observation,settings);assert.equal(fingerprint(input),decision.inputHash);report.inputHashMatches++;
      const result=decide(input);
      assert.deepEqual(result.analysisDiagnostics.reasonCodes,decision.reasonCodes);
      assert.equal(result.recommendation.status,decision.recommendationStatus);assert.equal(result.equity.samples,decision.samples);assert.equal(result.recommendation.pointLeader,decision.pointLeader);report.semanticDecisionMatches++;
      const missing=result.analysisDiagnostics.missingInputsByAction;
      for(const[action,inputs]of Object.entries(missing))for(const name of inputs){const key=action+': '+name;report.reasonCounts[key]=(report.reasonCounts[key]||0)+1;}
      report.cases.push({scenario:row.scenario,block:row.block,hand:row.hand,decision:index,street:decision.street,position:decision.position,
        actionTaken:decision.action,inputHash:decision.inputHash,analysisId:decision.analysisId,reasonCodes:decision.reasonCodes,
        publicNumbers:{pot:input.potBeforeAction,call:input.amountToCall,stack:input.effectiveStack,heroContribution:input.heroContribution,raiseTo:input.raiseTo,minRaiseTo:input.minRaiseTo,minBet:input.minBet},
        missingInputsByAction:missing,actions:Object.fromEntries(Object.entries(result.ev.actions).filter(([,action])=>action.legal).map(([action,item])=>[action,{status:item.status,ev:item.ev,missingInputs:item.missingInputs,warnings:item.warnings}]))});
    });
  }
  report.count=report.cases.length;fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({out,count:report.count,inputHashMatches:report.inputHashMatches,semanticDecisionMatches:report.semanticDecisionMatches,reasonCounts:report.reasonCounts},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
