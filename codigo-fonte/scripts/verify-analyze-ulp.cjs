'use strict';
// Regression on previously failing public observations, not a new economic
// evaluation: no hands are replayed and no return counterfactual is computed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),readline=require('node:readline'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'../../validacao/analyze-online-2026-09-27/economics'),trial=path.join(base,'holdout-v2');
const out=path.resolve(process.argv.find(x=>x.startsWith('--out='))?.slice(6)||path.join(base,'posthoc-ulp-regression.json'));
assert.equal(fs.existsSync(out),false,'Preserve prior evidence.');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const protocol=JSON.parse(fs.readFileSync(path.join(trial,'protocol.json'),'utf8')),frozen=protocol.candidateRoot;
const protectedFiles=['protocol.json','completed.json','summary.json','frozen-candidate/src/aggression-scenarios.js'];
const protectedHashes=Object.fromEntries(protectedFiles.map(file=>[file,hash(fs.readFileSync(path.join(trial,file)))]));
const {buildAnalyzeInput}=require(path.join(frozen,'src/analyze-policy')),{fingerprint}=require(path.join(frozen,'src/analysis-contract'));
const frozenDecide=require(path.join(frozen,'src/decision-engine')).decide,currentDecide=require('../src/decision-engine').decide;
const report={classification:'POST_HOC_NUMERICAL_REGRESSION_NOT_ECONOMIC_VALIDATION',at:new Date().toISOString(),productVersion:require('../package.json').version,
  frozenVersion:protocol.candidateVersion,protocolHash:protectedHashes['protocol.json'],sourceHash:hash(fs.readFileSync(path.resolve(__dirname,'../src/aggression-scenarios.js'))),
  claim:'43 selected failures become valid zero-addition CALL models; no new complete-policy returns were computed. No profitability inference for the corrected product.',checks:[],cases:[]};
(async()=>{
  const lines=readline.createInterface({input:fs.createReadStream(path.join(trial,'hands.jsonl')),crlfDelay:Infinity});
  for await(const line of lines){
    if(!line.includes('MISSING_ACTION_MODEL'))continue;const row=JSON.parse(line);if(row.policy!=='candidate')continue;
    row.decisions.forEach((decision,index)=>{
      if(!decision.reasonCodes.includes('MISSING_ACTION_MODEL'))return;
      const input=buildAnalyzeInput(decision.observation,{...protocol.settings,assumeNoRake:!decision.observation.rakeSchedule,
        equitySeed:parseInt(hash(`analysis:${protocol.seedNamespace}:${row.scenario}:${row.block}:${row.hand}:${index}`).slice(0,8),16),selectionInference:'SHARED_EQUITY_PAIRED'});
      assert.equal(fingerprint(input),decision.inputHash);
      const before=frozenDecide(input),after=currentDecide(input);
      assert.equal(before.ev.actions.CALL.status,'NOT_MODELED');assert.equal(after.ev.actions.CALL.status,'MODELED');
      assert.equal(after.ev.comparisonComplete,true);assert.equal(after.analysisDiagnostics.reasonCodes.includes('MISSING_ACTION_MODEL'),false);
      for(const key of ['equity','confidenceInterval95','seed','samples','samplingMode','intervalMethod','stopReason'])assert.deepEqual(after.equity[key],before.equity[key]);
      for(const action of ['FOLD','RAISE'])assert.deepEqual(after.ev.actions[action],before.ev.actions[action]);
      const branch=after.ev.actions.CALL.scenarioBreakdown[0];assert.equal(branch.opponentAdditional,0);
      assert.ok(Math.abs(branch.heroCost-input.amountToCall)<1e-8);
      assert.ok(Math.abs(branch.potAtShowdown-input.potBeforeAction-input.amountToCall)<1e-8);
      report.cases.push({scenario:row.scenario,block:row.block,hand:row.hand,decision:index,inputHash:decision.inputHash,
        samples:after.equity.samples,seed:after.equity.seed,callAdditional:branch.opponentAdditional,callModelStatus:after.ev.actions.CALL.status,
        unchangedFields:['equity','confidenceInterval95','seed','samples','samplingMode','intervalMethod','stopReason','FOLD EV model','RAISE EV model']});
    });
  }
  assert.equal(report.cases.length,43);
  for(const[file,expected]of Object.entries(protectedHashes))assert.equal(hash(fs.readFileSync(path.join(trial,file))),expected);
  report.checks=['43/43 original public input hashes match','43/43 formerly invalid CALL models now have exactly zero opponent addition','43/43 equity, intervals, seed, budget, FOLD and RAISE models unchanged','43/43 pot and hero-cost conservation within existing1e-8 tolerance','Original protocol, summary, completed metadata and frozen model hashes unchanged'];
  report.protectedHashes=protectedHashes;report.status='PASS';fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({out,status:report.status,cases:report.cases.length,productVersion:report.productVersion,checks:report.checks},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
