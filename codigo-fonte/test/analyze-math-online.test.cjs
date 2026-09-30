'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeRakeSchedule,calculateRake}=require('../src/rake-model');
const {calculateActionEV}=require('../src/action-ev-engine');
const {decide}=require('../src/decision-engine');
const {sharedEquityLeadership,analysisDiagnostics}=require('../src/analyze-inference');
const {buildAnalyzeInput,decideAnalyzePolicy}=require('../src/analyze-policy');
const schedule={type:'PERCENT_CAPPED',rate:.05,cap:6,noFlopNoDrop:true,rounding:'FLOOR_CENT',source:'SYNTHETIC_STUDY',version:'1'};
const base={variant:'PLO5_HIGH',heroCards:['As','Ks','Qh','Jh','Tc'],board:['Ts','9s','8d'],position:'BTN',players:2,potBeforeAction:10,amountToCall:2,effectiveStack:98,heroContribution:0,assumeNoRake:true,unknownOpponentModel:'UNIFORM',samples:256,seed:42,futureStreetModel:{type:'SHOWDOWN_ONLY'}};
test('shared contract diagnostics retain the different training continuation provenance',()=>{
  const data=analysisDiagnostics({status:'OK',trainingEvaluation:{policy:'TRAINING_PUBLIC_ROLLOUT'},recommendation:{status:'INCONCLUSIVE'}},base);
  assert.equal(data.decisionUnit,'ONE_TRAINING_REQUEST');assert.equal(data.futurePolicy,'TRAINING_PUBLIC_ROLLOUT');
});
test('rake schedule requires explicit provenance, precision and no-flop condition',()=>{
  assert.deepEqual(normalizeRakeSchedule(schedule),schedule);
  assert.equal(calculateRake({pot:1000,boardCount:5},schedule),6);
  assert.equal(calculateRake({pot:10.19,boardCount:3},schedule),.5);
  assert.equal(calculateRake({pot:10.19,boardCount:3},{...schedule,rounding:'NEAREST_CENT'}),.51);
  assert.equal(calculateRake({pot:1000,boardCount:0},schedule),0);
  assert.throws(()=>normalizeRakeSchedule({...schedule,cap:null}));
  assert.throws(()=>normalizeRakeSchedule({...schedule,rate:-.1}));
  assert.throws(()=>normalizeRakeSchedule({...schedule,source:undefined}));
  assert.throws(()=>calculateRake({pot:2,boardCount:2},schedule));
});
test('rake enters call/check EV before ranking and the displayed price is net of scheduled fees',()=>{
  const a=decide({...base,assumeNoRake:false,rakeSchedule:schedule,availableActions:['FOLD','CALL']});
  assert.equal(a.status,'OK');assert.equal(a.ev.actions.CALL.rake,.6);
  assert.ok(Math.abs(a.ev.actions.CALL.ev-(a.equity.equity*11.4-2))<1e-10);
  assert.ok(Math.abs(a.potMath.potOdds-2/11.4)<1e-10);
  assert.equal(a.provenance.rake.mode,'PERCENT_CAPPED_SCHEDULE');
  const ambiguous=decide({...base,rakeSchedule:schedule});
  assert.equal(ambiguous.status,'NO_DECISION');assert.match(ambiguous.reason,/only/);
});
test('folded aggression charges no-flop-no-drop and caller branch charges its own pot',()=>{
  const raw={...base,board:[],assumeNoRake:false,rakeSchedule:schedule,equity:.5,legalActions:['FOLD','CALL','RAISE'],raiseTo:6,foldEquity:.5,continuationEquity:.5,minRaiseTo:4};
  const a=calculateActionEV(raw).actions.RAISE;
  assert.equal(a.status,'MODELED');assert.deepEqual(a.rakeByResponse,{fold:0,call:1});
  // P=10, H=0, facing=2. Raise to 6 costs 6, other adds 4 => pot20.
  assert.equal(a.ev,.5*10+.5*(.5*19-6));
});
test('generated study applies the schedule per branch, including CALL price and conservation of returned raise',()=>{
  const input={...base,board:[],assumeNoRake:false,rakeSchedule:schedule,raiseTo:6,minRaiseTo:4,
    aggressionStudy:{enabled:true,assumptionsAccepted:true,heroContribution:0,minRaiseTo:4,opponents:[{contribution:2,callProbability:.5}]}};
  const result=decide(input),raise=result.ev.actions.RAISE;
  assert.equal(raise.status,'MODELED');
  assert.deepEqual(raise.scenarioBreakdown.map(s=>s.rake),[0,1]);
  assert.equal(raise.scenarioBreakdown[0].uncalledReturned,4);
  assert.equal(raise.scenarioBreakdown[0].heroCost,2);
  assert.equal(result.ev.actions.CALL.scenarioBreakdown[0].rake,.6);
  assert.ok(Math.abs(result.potMath.potOdds-2/11.4)<1e-12);
  assert.equal(result.analysisDiagnostics.selectionMethod,'SHARED_EQUITY_AFFINE_DIFFERENCES');
});
test('fold after facing a bet includes the matching call in eligible rake, but excludes the uncalled raise',()=>{
  const input={...base,potBeforeAction:15,amountToCall:5,assumeNoRake:false,rakeSchedule:schedule,raiseTo:15,minRaiseTo:10,
    aggressionStudy:{enabled:true,assumptionsAccepted:true,heroContribution:0,minRaiseTo:10,opponents:[{contribution:5,callProbability:0}]}};
  const result=decide(input),branch=result.ev.actions.RAISE.scenarioBreakdown[0];
  assert.equal(branch.eligibleRakePot,20);assert.equal(branch.uncalledReturned,10);assert.equal(branch.heroCost,5);assert.equal(branch.rake,1);assert.equal(branch.ev,14);
  const legacy=calculateActionEV({...input,aggressionStudy:undefined,foldEquity:1,continuationEquity:.5,legalActions:['FOLD','CALL','RAISE']}).actions.RAISE;
  assert.equal(legacy.rakeByResponse.fold,1);assert.equal(legacy.ev,14);
});
test('matched decimal contribution has zero CALL addition; real negative contributions remain invalid',()=>{
  const input={...base,potBeforeAction:125.39,amountToCall:46.19,effectiveStack:60.4,heroContribution:35.6,raiseTo:96,minRaiseTo:96,
    aggressionStudy:{enabled:true,assumptionsAccepted:true,heroContribution:35.6,minRaiseTo:96,opponents:[{contribution:81.79,callProbability:.5}]}};
  assert.ok(input.heroContribution+input.amountToCall-81.79<0,'fixture reproduces the negative ULP');
  const result=decide(input),call=result.ev.actions.CALL;
  assert.equal(result.status,'OK');assert.equal(call.status,'MODELED');assert.equal(result.ev.comparisonComplete,true);
  const branch=call.scenarioBreakdown[0];assert.equal(branch.opponentAdditional,0);
  assert.ok(Math.abs(branch.heroCost-46.19)<1e-10);assert.ok(Math.abs(branch.potAtShowdown-171.58)<1e-10);
  assert.ok(Math.abs(call.ev-(result.equity.equity*171.58-46.19))<1e-10);
  const invalid=decide({...input,aggressionStudy:{...input.aggressionStudy,opponents:[{contribution:81.80,callProbability:.5}]}});
  assert.equal(invalid.status,'NO_DECISION');assert.match(invalid.reason,/Contributions/);
  const {studySettings,buildStudyModels}=require('../src/aggression-scenarios');
  const settings=studySettings(input,{ranges:[{kind:'UNIFORM'}]});
  settings.opponents[0].contribution=81.80;
  const raw=buildStudyModels(input,settings,{method:'EXACT',equity:.5,samples:1}).input;
  assert.ok(raw.actionResponseModels.CALL.scenarios[0].callers[0].additional<-.009);
  const invalidCall=calculateActionEV({...raw,equity:.5,legalActions:['FOLD','CALL','RAISE']}).actions.CALL;
  assert.equal(invalidCall.status,'NOT_MODELED');assert.match(invalidCall.warnings.join(' '),/Contribution.*incompatible/);
});
test('HU BB option preserves real CHECK/RAISE with zero call and previously posted blind',()=>{
  const a=decide({...base,board:[],position:'BB',potBeforeAction:4,amountToCall:0,heroContribution:2,effectiveStack:98,
    availableActions:['CHECK','RAISE'],raiseTo:4,minRaiseTo:4,maxRaiseTo:6,
    aggressionStudy:{enabled:true,assumptionsAccepted:true,heroContribution:2,minRaiseTo:4,opponents:[{contribution:2,callProbability:.5}]}});
  assert.equal(a.status,'OK');assert.deepEqual(a.legalActions,['CHECK','RAISE']);
  assert.equal(a.ev.actions.RAISE.status,'MODELED');assert.equal(a.ev.actions.RAISE.heroCost,2);
  assert.equal(a.ev.actions.RAISE.targetStreetTotal,4);
  assert.equal(a.ev.actions.BET.legal,false);
});
test('observed Multiway HU permits BB option and retains the supplied rake schedule',()=>{
  const multiway=require('../src/multiway-session');
  const config={variant:'PLO5_HIGH',playerCount:2,heroPosition:'BB',startingStack:100,smallBlind:1,bigBlind:2,heroCards:base.heroCards};
  const record={schemaVersion:1,enabled:true,config,events:[{type:'ACT',actor:0,action:'CALL'}]};
  const prepared=multiway.prepareAnalysis(record,{...base,assumeNoRake:false,rakeSchedule:schedule,raiseTo:4,bigBlind:999,practicalEquivalenceBB:.1,
    aggressionStudy:{enabled:true,assumptionsAccepted:true,opponents:[{seatId:0,callProbability:.5}]}});
  assert.equal(prepared.available,true);assert.deepEqual(prepared.input.rakeSchedule,schedule);
  assert.equal(prepared.input.bigBlind,2);
  const result=decide(prepared.input);assert.equal(result.status,'OK');assert.equal(result.ev.actions.RAISE.status,'MODELED');
  assert.equal(result.strategy.baseline.leadership.practicalEquivalence.epsilonChips,.2);
});
test('paired shared equity eliminates marginal overlap without changing EV or hiding payoff amplitude',()=>{
  const ev={comparisonComplete:true,actions:{CHECK:{legal:true,status:'MODELED',model:'SHOWDOWN_ONLY',netPot:100,ev:60},BET:{legal:true,status:'MODELED',model:'SCENARIO_SHOWDOWN_ONLY',ev:64,
    scenarioBreakdown:[{callers:['v'],probability:1,equity:.6,equitySource:'CALCULATED_CONDITIONAL',potAtShowdown:140,rake:0,heroCost:20}]}}};
  const marginal={status:'OVERLAPPING',candidateActions:['BET','CHECK']};
  const x=sharedEquityLeadership({ev,equity:{method:'MONTE_CARLO',equity:.6,confidenceInterval95:[.53,.67]},study:{n:1,C:0},marginal,epsilonChips:.2});
  assert.equal(x.status,'SEPARATED');assert.equal(x.marginalStatus,'OVERLAPPING');assert.equal(x.simultaneousConfidenceLevel,.95);
  assert.equal(x.comparisons[0].rangeWidth,40);assert.deepEqual(x.comparisons[0].support,[-20,20]);
  assert.ok(Math.abs(x.comparisons[0].interval[0]-1.2)<1e-10);
  assert.equal(x.practicalEquivalence.actionable,false);
  assert.equal(sharedEquityLeadership({ev,equity:{},study:{n:2},marginal}),null);
});
test('paired differences retain negative slopes, exact ties and uncertainty; epsilon never creates separation',()=>{
  const ev={comparisonComplete:true,actions:{CHECK:{legal:true,status:'MODELED',model:'SHOWDOWN_ONLY',netPot:10,ev:5},BET:{legal:true,status:'MODELED',model:'SCENARIO_SHOWDOWN_ONLY',ev:5,
    scenarioBreakdown:[{callers:[],probability:.5,ev:10},{callers:['v'],probability:.5,equity:.5,equitySource:'CALCULATED_CONDITIONAL',potAtShowdown:4,rake:0,heroCost:2}]}}};
  const x=sharedEquityLeadership({ev,equity:{method:'MONTE_CARLO',equity:.5,confidenceInterval95:[.4,.6]},study:{n:1,C:0},marginal:{status:'TIED'},epsilonChips:1});
  assert.equal(x.status,'TIED');assert.equal(x.practicalEquivalence.status,'LEADER_WITHIN_EPSILON_IN_MODEL');
  assert.equal(x.practicalEquivalence.actionable,false);assert.equal(x.comparisons[0].rangeWidth,8);
});
test('candidate preserves samples, seed, equity and EV under marginal versus paired selection',()=>{
  const input={...base,raiseTo:6,minRaiseTo:4,aggressionStudy:{enabled:true,assumptionsAccepted:true,heroContribution:0,minRaiseTo:4,opponents:[{contribution:2,callProbability:.7}]}};
  const a=decide(input),b=decide({...input,selectionInference:'MARGINAL'});
  assert.equal(a.equity.samples,b.equity.samples);assert.equal(a.equity.seed,b.equity.seed);assert.equal(a.equity.equity,b.equity.equity);assert.deepEqual(a.ev,b.ev);
  assert.equal(a.analysisDiagnostics.selectionMethod,'SHARED_EQUITY_AFFINE_DIFFERENCES');
  assert.equal(b.analysisDiagnostics.selectionMethod,'MARGINAL_INTERVAL_SEPARATION');
  assert.deepEqual(decide(base).analysisDiagnostics.reasonCodes,['MISSING_ACTION_MODEL']);
});
test('public adapter does not copy hidden state and supports both physical seats',()=>{
  const observation={...base,opponents:[{id:1,contribution:2,stackRemaining:98}],legal:{actions:['FOLD','CALL','RAISE'],minTo:4,maxTo:14},bigBlind:2,
    futureBoard:['2c'],opponentCards:['Ah'],seed:9876,nested:{secret:'hidden'}};
  const settings={study:true,callProbability:.5,sizeFraction:.5,assumeNoRake:true,samples:256,equitySeed:314159};
  const a=buildAnalyzeInput(observation,settings),b=buildAnalyzeInput({...observation,futureBoard:['3c'],seed:1111,opponentCards:['Ad'],nested:{other:'world'}},settings);
  assert.deepEqual(a,b);assert.equal(a.seed,314159);assert.equal(a.opponentCards,undefined);
  assert.throws(()=>buildAnalyzeInput(observation,{...settings,assumeNoRake:false}),/declare costs/);
  const result=decideAnalyzePolicy(a,{fallback:'CHECK_FOLD',deadlineMs:3000});
  assert.ok(a.availableActions.includes(result.action));assert.match(result.inputHash,/^[a-f0-9]{64}$/);
});
test('public adapter preserves a legal short all-in bet below the nominal big blind',()=>{
  const observation={...base,potBeforeAction:196.04,amountToCall:0,effectiveStack:1.98,heroContribution:0,
    opponents:[{id:1,contribution:0,stackRemaining:1.98}],legal:{actions:['FOLD','CHECK','BET'],minTo:1.98,maxTo:1.98},bigBlind:2};
  const input=buildAnalyzeInput(observation,{study:true,callProbability:.5,sizeFraction:.5,assumeNoRake:true,samples:256});
  assert.equal(input.minBet,1.98);assert.equal(input.aggressionStudy.minBet,1.98);assert.equal(input.betSize,1.98);
  const result=decide(input);assert.equal(result.status,'OK');assert.equal(result.ev.actions.BET.status,'MODELED');assert.equal(result.ev.comparisonComplete,true);
});
test('deadline, error and incomplete-model fallbacks are included and cannot choose unsupported point leaders',()=>{
  const input={...base,availableActions:['FOLD','CALL','RAISE']};
  const incomplete=decideAnalyzePolicy(input,{fallback:'CHECK_FOLD'});assert.equal(incomplete.source,'FALLBACK');assert.equal(incomplete.action,'FOLD');
  const failed=decideAnalyzePolicy(input,{decideFn:()=>{throw Error('injected');}});assert.equal(failed.action,'FOLD');assert.ok(failed.reasonCodes.includes('ERROR'));
  const late=decideAnalyzePolicy(input,{decideFn:()=>{const t=performance.now();while(performance.now()-t<2){};return {status:'OK',recommendation:{status:'CONDITIONAL',action:'CALL',pointLeader:'CALL'}};},deadlineMs:.1});
  assert.equal(late.action,'FOLD');assert.ok(late.reasonCodes.includes('DEADLINE'));
});
