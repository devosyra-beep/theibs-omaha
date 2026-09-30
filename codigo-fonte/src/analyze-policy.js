'use strict';
const { decide } = require('./decision-engine');
const { fingerprint } = require('./analysis-contract');

// Public-only adapter shared by the complete-hand experiment and API fixtures.
// It deliberately selects fields; no simulator seed, future board, opponent
// cards, actual opponent style, or hidden session can enter the decision input.
function buildAnalyzeInput(observation, settings = {}) {
  const o=observation, legal=o.legal;
  if(!o||!legal||!Array.isArray(legal.actions))throw Error('Public observation and legal actions are required.');
  if(Number(o.players)!==2||!['BTN','BB'].includes(o.position))throw Error('This initial economic adapter requires heads-up play and BTN or BB position.');
  const H=Number(o.heroContribution),C=Number(o.amountToCall),P=Number(o.potBeforeAction);
  const actions=legal.actions.filter(a=>a!=='FOLD'||C>0);
  // A legal opening all-in can be smaller than the nominal big blind. The
  // observed betting rules, rather than the blind label, supply its minimum.
  const minBet=actions.includes('BET')?Math.round((Number(legal.minTo)-H)*100)/100:Number(o.bigBlind);
  const input={variant:o.variant||'PLO5_HIGH',heroCards:[...o.heroCards],board:[...o.board],position:o.position,players:2,
    potBeforeAction:P,amountToCall:C,effectiveStack:Number(o.effectiveStack),heroContribution:H,
    minRaiseTo:legal.minTo,minBet,maxRaiseTo:legal.maxTo,
    availableActions:actions,actionHistory:(o.actionHistory||[]).map(event=>({street:event.street,actor:event.actor,action:event.action,amount:event.amount,to:event.to})),
    unknownOpponentModel:'UNIFORM',futureStreetModel:{type:'SHOWDOWN_ONLY'},
    samples:settings.samples??5000,samplingMode:settings.samplingMode??'FIXED',seed:settings.equitySeed??42017,
    bigBlind:Number(o.bigBlind),selectionInference:settings.selectionInference??'SHARED_EQUITY_PAIRED'};
  if(settings.practicalEquivalenceBB!=null)input.practicalEquivalenceBB=settings.practicalEquivalenceBB;
  const schedule=settings.rakeSchedule??o.rakeSchedule;
  if(schedule)input.rakeSchedule={...schedule};
  else if(settings.rake!=null)input.rake=settings.rake;
  else if(settings.assumeNoRake===true)input.assumeNoRake=true;
  else throw Error('The experiment must declare costs; zero is not assumed.');
  const aggressive=actions.includes('RAISE')?'RAISE':actions.includes('BET')?'BET':null;
  if(settings.study===true&&aggressive){
    const probability=Number(settings.callProbability),fraction=Number(settings.sizeFraction);
    if(settings.callProbability==null||!Number.isFinite(probability)||probability<0||probability>1)throw Error('Specify the synthetic call probability.');
    if(settings.sizeFraction==null||!Number.isFinite(fraction)||fraction<=0||fraction>1)throw Error('Specify a pot fraction greater than zero and at most one.');
    const min=Number(legal.minTo),max=Number(legal.maxTo);
    const target=Math.min(max,Math.max(min,Math.round((H+C+(P+C)*fraction)*100)/100));
    if(aggressive==='RAISE')input.raiseTo=target;else input.betSize=target-H;
    if(!Array.isArray(o.opponents)||o.opponents.length!==1)throw Error('Public opponent contribution is required.');
    input.aggressionStudy={enabled:true,assumptionsAccepted:true,heroContribution:H,minRaiseTo:min,minBet,
      opponents:o.opponents.map(p=>({contribution:Number(p.contribution),callProbability:probability}))};
  }
  return input;
}

function fallbackAction(input, mode) {
  const actions=input.availableActions||[];
  if(actions.includes('CHECK'))return 'CHECK';
  if(mode==='CHECK_CALL'&&actions.includes('CALL'))return 'CALL';
  if(actions.includes('FOLD'))return 'FOLD';
  if(actions.includes('CALL'))return 'CALL';
  throw Error('No legal passive action is available for fallback.');
}

function decideAnalyzePolicy(input,{decideFn=decide,selection='SUPPORTED',fallback='CHECK_FOLD',deadlineMs=3000}={}){
  if(!['SUPPORTED','POINT_LEADER'].includes(selection)||!['CHECK_FOLD','CHECK_CALL'].includes(fallback)||!Number.isFinite(deadlineMs)||deadlineMs<=0)throw Error('Invalid Analyze policy configuration.');
  const start=performance.now();let result,error=null;
  try{result=decideFn(input);}catch(e){error=e.message;}
  const elapsedMs=performance.now()-start,timedOut=elapsedMs>deadlineMs;
  const contract=result?.recommendation;
  let action=!timedOut&&!error?(selection==='POINT_LEADER'?contract?.pointLeader:contract?.action):null;
  let to=action?contract?.size??result?.ev?.actions?.[action]?.targetStreetTotal:null;
  const reasons=[...(result?.analysisDiagnostics?.reasonCodes||[])];
  if(timedOut)reasons.push('DEADLINE');
  if(error)reasons.push('ERROR');
  if(!result||result.status!=='OK')reasons.push('UNAVAILABLE_MODEL');
  if(!action&&result?.status==='OK'&&!reasons.length)reasons.push(contract?.status||'ABSTENTION');
  if(action&&!input.availableActions.includes(action)){reasons.push('ILLEGAL_RECOMMENDATION');action=null;}
  if(['BET','RAISE'].includes(action)){
    const H=Number(input.heroContribution||0),min=Number(action==='BET'?input.minBet:input.minRaiseTo),max=Math.min(Number(input.maxRaiseTo),H+Number(input.effectiveStack));
    if(!Number.isFinite(to)||to<min-1e-8||to>max+1e-8){reasons.push('INVALID_SIZE');action=null;}
  }
  const source=action?(selection==='POINT_LEADER'?'POINT_LEADER_ABLATION':'SUPPORTED_CONDITIONAL'):'FALLBACK';
  if(!action){action=fallbackAction(input,fallback);to=null;}
  return {action,...(['BET','RAISE'].includes(action)?{to}:{}),source,
    recommendationStatus:contract?.status||'UNAVAILABLE',reasonCodes:[...new Set(reasons)],elapsedMs,timedOut,error,
    inputHash:fingerprint(input),analysisId:result?.analysisId||null,
    deadlineScope:'SYNCHRONOUS_ENGINE_RESULT_DISCARD_EXCLUDES_HTTP_QUEUE_AND_NETWORK',
    selectionMethod:result?.analysisDiagnostics?.selectionMethod||result?.strategy?.baseline?.leadership?.method||'MARGINAL_INTERVAL_SEPARATION',
    pointLeader:contract?.pointLeader||null,samples:result?.equity?.samples??null,
    policyScope:'REQUERY_ANALYZE_EACH_DECISION_WITH_DECLARED_FALLBACK; INTERNAL_ACTION_EV_IS_SHOWDOWN_ONLY'};
}

module.exports={buildAnalyzeInput,decideAnalyzePolicy,fallbackAction};
