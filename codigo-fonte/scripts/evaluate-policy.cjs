'use strict';
// Pilot/experiment harness. No real gambling, no private history and no learning updates.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const {createSession,publicSession,applyAction}=require('../src/training-simulator');
const candidateEngine=require('../src/training-evaluator');
const {outcomeCost}=require('../src/policy-experiment');
const BUILD=require('../package.json').version;
const args=process.argv.slice(2),option=(name,fallback)=>args.find(x=>x.startsWith(name+'='))?.slice(name.length+1)||fallback;
const output=path.resolve(option('--output','../validacao/execucao-2026-09-27/policy-pilot'));
const baselineRoot=option('--baseline-root',null);
const perCell=Number(option('--deals-per-cell','2'));
if(!Number.isInteger(perCell)||perCell<1||perCell>10000)throw Error('Invalid deal count');
if(!baselineRoot)throw Error('Supply --baseline-root with the frozen 0.12.2 codigo-fonte directory.');
const baselineEngine=require(path.join(path.resolve(baselineRoot),'src/training-evaluator.js'));
const baselineBuild=require(path.join(path.resolve(baselineRoot),'package.json')).version;
fs.mkdirSync(output,{recursive:true});
if(fs.readdirSync(output).length)throw Error('Output contains prior artifacts; preserve them and choose a new empty directory.');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function sourceHashes(root){
  const files=['package.json',...fs.readdirSync(path.join(root,'src')).filter(name=>name.endsWith('.js')).map(name=>'src/'+name)];
  return Object.fromEntries(files.sort().map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
}
const protocol={schemaVersion:1,kind:'PILOT_NOT_CONFIRMATORY',registeredAt:new Date().toISOString(),candidateBuild:BUILD,baselineBuild,
  variants:['PLO4_HIGH','PLO5_HIGH','PLO6_HIGH'],opponents:['PASSIVE','MIXED','AGGRESSIVE'],dealsPerCell:perCell,
  startingStack:100,bigBlind:2,position:'BTN',samplesPerDecision:256,maxActionsPerHand:60,
  seedBase:19730819,seedStep:104729,alphaFamily:.05,
  candidatePolicy:'CONDITIONAL_RECOMMENDATION_ELSE_CHECK_CALL',
  baselinePolicies:['FROZEN_PREVIOUS_POINT_LEADER','CHECK_CALL'],fallback:'CHECK_IF_LEGAL_ELSE_CALL_ELSE_FOLD',
  costs:[{id:'NO_RAKE',rate:0,capBB:0,noFlopNoDrop:true},{id:'RAKE_SENSITIVITY',rate:.05,capBB:3,noFlopNoDrop:true}],
  costsScope:'POSTHOC_POT_PROPORTIONAL_COST_SENSITIVITY_NOT_RAKE_AWARE_POLICY',
  inference:'Bounded Hoeffding intervals across independently seeded deal clusters, multiplicity allocated over every reported cell/metric. Assumes model IID deals; no population calibration.',
  confirmatoryPlan:{status:'NOT_EXECUTED',minimumRelevantGainBB100:1,alpha:.05,powerTarget:.8,
    sampleSize:'Must be frozen from a disjoint pilot variance estimate before opening an independent final holdout.',
    requiredExtensions:['Alternating positions','Held-out independently implemented/adaptive opponents','Calibrated ranges','Rake-aware decisions','External reference','Power-sized independent sample']},
  sourceHashes:{candidate:sourceHashes(path.resolve(__dirname,'..')),baseline:sourceHashes(path.resolve(baselineRoot)),harness:createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')},
  conclusionsAllowed:['Harness legality and reproducibility','Model-specific exploratory outcomes'],
  conclusionsProhibited:['Profit guarantee','External strategic validation','Learning efficacy','Universal positive winrate']};
fs.writeFileSync(path.join(output,'protocol.json'),JSON.stringify(protocol,null,2));
const protocolHash=hash(protocol);
const fallback=legal=>({action:legal.includes('CHECK')?'CHECK':legal.includes('CALL')?'CALL':'FOLD',size:null});
function play(policy,variant,opponentStyle,seed){
  const session=createSession({variant,opponentStyle,seed,startingStack:protocol.startingStack}),decisions=[];
  while(!session.finished){
    if(decisions.length>=protocol.maxActionsPerHand)throw Error('Hand did not terminate');
    const view=publicSession(session);let choice=fallback(view.legalActions),abstained=false,error=null,analysisId=null;
    if(policy!=='CHECK_CALL'){
      try {
        const engine=policy==='CANDIDATE'?candidateEngine:baselineEngine;
        const publicInput=engine.trainingEvaluationInput(session,{samples:protocol.samplesPerDecision});
        if('seed' in publicInput||'villainCards' in publicInput||'boardAll' in publicInput)throw Error('Private input escaped simulator');
        const result=engine.evaluateTraining(publicInput);analysisId=result.analysisId||result.trainingEvaluation.publicStateFingerprint;
        const supported=policy!=='CANDIDATE'||result.recommendation?.status==='CONDITIONAL';
        if(supported)choice={action:result.recommendedAction,size:result.recommendedSize};else abstained=true;
      }catch(caught){error=caught.message;abstained=true;}
    }
    if(!view.legalActions.includes(choice.action))throw Error('Policy supplied illegal action');
    decisions.push({revision:view.revision,street:view.street,action:choice.action,size:choice.size,abstained,error,analysisId});
    applyAction(session,choice.action,choice.size);
    if(Math.abs(session.heroStack+session.villainStack+session.pot-2*protocol.startingStack)>1e-8)throw Error('Chip conservation failed');
  }
  const costs=protocol.costs.map(cost=>{
    const charged=outcomeCost(session.state,session.board.length,cost,protocol.bigBlind);
    return {id:cost.id,...charged,netBB:(session.outcome.heroNet-charged.heroFeeChips)/protocol.bigBlind};
  });
  return {policy,variant,opponentStyle,seed,heroNetChips:session.outcome.heroNet,costs,decisions,
    errors:decisions.filter(d=>d.error).length,abstentions:decisions.filter(d=>d.abstained).length};
}
function estimate(values,span,alpha){
  const n=values.length,mean=values.reduce((a,b)=>a+b,0)/n;
  const variance=n>1?values.reduce((a,b)=>a+(b-mean)**2,0)/(n-1):null;
  const margin=span*Math.sqrt(Math.log(2/alpha)/(2*n));
  return {deals:n,meanBB100:mean*100,intervalBB100:[(mean-margin)*100,(mean+margin)*100],varianceBB2:variance,alpha,
    intervalMethod:'HOEFFDING_BOUNDED_DEAL_RETURNS',status:'EXPLORATORY'};
}
const started=performance.now(),rows=[];let sequence=0;
for(const variant of protocol.variants)for(const style of protocol.opponents)for(let i=0;i<perCell;i++){
  const seed=(protocol.seedBase+sequence++*protocol.seedStep)>>>0;
  for(const policy of ['CANDIDATE','PREVIOUS','CHECK_CALL'])rows.push(play(policy,variant,style,seed));
  fs.appendFileSync(path.join(output,'hands.jsonl'),rows.slice(-3).map(row=>JSON.stringify(row)).join('\n')+'\n');
  console.log(`Completed paired deal ${sequence}/${perCell*9}: ${variant}/${style}`);
}
const cells=[],alpha=protocol.alphaFamily/(protocol.variants.length*protocol.opponents.length*protocol.costs.length*3);
for(const variant of protocol.variants)for(const style of protocol.opponents)for(const cost of protocol.costs){
  const subset=rows.filter(row=>row.variant===variant&&row.opponentStyle===style),candidate=subset.filter(row=>row.policy==='CANDIDATE');
  const net=row=>row.costs.find(x=>x.id===cost.id).netBB;
  const span=2*protocol.startingStack/protocol.bigBlind;
  const comparisons=['PREVIOUS','CHECK_CALL'].map(policy=>({policy,...estimate(candidate.map(row=>net(row)-net(subset.find(x=>x.policy===policy&&x.seed===row.seed))),2*span,alpha)}));
  let running=0,peak=0,maxDrawdown=0;for(const row of candidate){running+=net(row);peak=Math.max(peak,running);maxDrawdown=Math.max(maxDrawdown,peak-running);}
  cells.push({variant,opponentStyle:style,costModel:cost.id,absolute:estimate(candidate.map(net),span,alpha),comparisons,
    maxObservedDrawdownBB:maxDrawdown,decisions:candidate.reduce((n,r)=>n+r.decisions.length,0),abstentions:candidate.reduce((n,r)=>n+r.abstentions,0),errors:candidate.reduce((n,r)=>n+r.errors,0)});
}
const report={evidence:'SIMULATION',status:'INCONCLUSIVE',technicalStatus:rows.some(r=>r.errors)?'COMPLETED_WITH_FALLBACK_ERRORS':'PASS',
  protocolHash,engineBuild:BUILD,baselineBuild,elapsedMs:performance.now()-started,environment:{node:process.version,cpu:os.cpus()[0].model},
  pairedDeals:sequence,totalPolicyHands:rows.length,cells,claim:'No demonstrated external advantage or absolute profitability. Pilot only.',
  limitations:['BTN heads-up only; no multiway or position alternation','Opponents are the same heuristic family used by the rollout model','Small exploratory sample not powered for profit inference','Rake is posthoc sensitivity; decisions/continuations still use the no-rake training model','Seeded simulator is not a real-player population','Fallback hands included; no selection by success']};
fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,technicalStatus:report.technicalStatus,pairedDeals:sequence,totalPolicyHands:rows.length,elapsedMs:report.elapsedMs}));
if(rows.some(r=>r.errors))process.exitCode=1;
