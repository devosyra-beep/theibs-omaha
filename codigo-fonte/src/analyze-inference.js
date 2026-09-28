'use strict';

// This comparison is intentionally narrow: one HU uniform showdown variable,
// reused by buildStudyModels for every continuation. A single confidence event
// for q then covers ALL affine differences simultaneously; no extra sampling
// or independent-marginal assumption is introduced. Never apply to arbitrary
// user response trees or independently estimated conditional ranges.
function sharedEquityLeadership({ ev, equity, study, marginal, epsilonChips = null }) {
  if (!study || study.n !== 1 || !ev.comparisonComplete) return null;
  const qBounds = equity.method === 'EXACT' ? [equity.equity,equity.equity] : equity.confidenceInterval95;
  if (!Array.isArray(qBounds) || qBounds.length !== 2 || !qBounds.every(Number.isFinite)) return null;
  const coefficients = {};
  for (const [action,item] of Object.entries(ev.actions)) {
    if (!item.legal) continue;
    if (item.status !== 'MODELED') return null;
    if (action === 'FOLD') coefficients[action] = { slope:0, intercept:0 };
    else if (item.model === 'SHOWDOWN_ONLY' && Number.isFinite(item.netPot)) coefficients[action] = { slope:item.netPot, intercept:action === 'CALL' ? -study.C : 0 };
    else if (item.model === 'SCENARIO_SHOWDOWN_ONLY' && item.scenarioBreakdown?.length) {
      let slope = 0, intercept = 0;
      for (const branch of item.scenarioBreakdown) {
        if (!branch.callers.length) intercept += branch.probability * branch.ev;
        else {
          if (branch.callers.length !== 1 || branch.equitySource !== 'CALCULATED_CONDITIONAL' || Math.abs(branch.equity-equity.equity)>1e-12) return null;
          slope += branch.probability * (branch.potAtShowdown-branch.rake);
          intercept -= branch.probability * branch.heroCost;
        }
      }
      coefficients[action] = {slope,intercept};
    } else return null;
    const a=coefficients[action];
    if (Math.abs(a.slope*equity.equity+a.intercept-item.ev)>1e-7) return null;
  }
  const ranked=Object.keys(coefficients).sort((a,b)=>ev.actions[b].ev-ev.actions[a].ev), pointLeader=ranked[0];
  if(ranked.length<2)return null;
  const comparisons=[];
  for(let i=0;i<ranked.length;i++)for(let j=i+1;j<ranked.length;j++){
    const a=ranked[i],b=ranked[j],slope=coefficients[a].slope-coefficients[b].slope,intercept=coefficients[a].intercept-coefficients[b].intercept;
    const endpoints=qBounds.map(q=>slope*q+intercept),support=[intercept,intercept+slope].sort((x,y)=>x-y);
    comparisons.push({actions:[a,b],difference:ev.actions[a].ev-ev.actions[b].ev,interval:[Math.min(...endpoints),Math.max(...endpoints)],support,rangeWidth:Math.abs(slope),sharedVariable:'SHOWDOWN_POT_SHARE'});
  }
  const againstLeader=comparisons.filter(pair=>pair.actions[0]===pointLeader);
  const tied=ranked.filter(a=>Math.abs(ev.actions[a].ev-ev.actions[pointLeader].ev)<1e-12);
  const status=tied.length>1?'TIED':againstLeader.every(p=>p.interval[0]>0)?'SEPARATED':'OVERLAPPING';
  const regretUpper=Math.max(0,...againstLeader.map(p=>-p.interval[0]));
  return {...marginal,status,pointLeader,pointGap:ev.actions[ranked[0]].ev-ev.actions[ranked[1]].ev,
    candidateActions:ranked.filter(a=>a===pointLeader||againstLeader.find(p=>p.actions[1]===a)?.interval[0]<=0),
    method:'SHARED_EQUITY_AFFINE_DIFFERENCES',comparisons,coefficients,
    marginalStatus:marginal.status,marginalCandidateActions:marginal.candidateActions,
    scope:'ONE_COMMON_SHOWDOWN_EQUITY_UNDER_FIXED_UNIFORM_RESPONSE_ASSUMPTIONS',
    simultaneousConfidenceLevel:equity.method==='EXACT'?1:0.95,
    confidenceAssumptions:'Coverage inherited from the one bounded-share equity interval; excludes opponent and future-policy model error.',
    practicalEquivalence:epsilonChips===null?null:{epsilonChips,leaderRegretUpper:regretUpper,status:regretUpper<=epsilonChips?'LEADER_WITHIN_EPSILON_IN_MODEL':'NOT_ESTABLISHED',actionable:false}};
}

function analysisDiagnostics(data, input) {
  const recommendation=data.recommendation, leader=data.strategy?.baseline?.leadership;
  const reasons=[];
  if(recommendation?.status==='PROVISIONAL')reasons.push('PROVISIONAL');
  if(data.status!=='OK')reasons.push('INVALID_OR_UNAVAILABLE_MODEL');
  if(recommendation?.missingOpponentModel)reasons.push('MISSING_OPPONENTS');
  if(data.ev?.missingLegalActions?.length)reasons.push('MISSING_ACTION_MODEL');
  if(leader?.status==='TIED')reasons.push('EXACT_POINT_TIE');
  if(leader?.status==='OVERLAPPING')reasons.push('OVERLAPPING_INTERVALS');
  if(leader?.status==='MISSING_BOUNDS')reasons.push('MISSING_INTERVALS');
  if(leader?.status==='SINGLE_MODELED_ACTION')reasons.push('SINGLE_MODELED_ACTION');
  if(leader?.status!=='SEPARATED'&&leader?.practicalEquivalence?.status==='LEADER_WITHIN_EPSILON_IN_MODEL')reasons.push('PRACTICAL_EQUIVALENCE');
  if(data.strategy?.finalSource==='EXPLOIT_ADJUSTMENT')reasons.push('UNVERIFIED_HEURISTIC_ADJUSTMENT');
  if(data.equity?.stopReason==='TIME_BUDGET')reasons.push('SAMPLING_TIME_BUDGET');
  return {schemaVersion:1,decisionUnit:data.trainingEvaluation?'ONE_TRAINING_REQUEST':'ONE_ANALYZE_REQUEST',abstained:recommendation?.status!=='CONDITIONAL',reasonCodes:reasons,
    dimensions:{variant:input.variant,street:data.state?.street,position:input.position,players:input.players,effectiveStack:input.effectiveStack},
    missingInputsByAction:Object.fromEntries(Object.entries(data.ev?.actions||{}).filter(([,x])=>x.legal&&x.missingInputs?.length).map(([a,x])=>[a,x.missingInputs])),
    selectionMethod:leader?.method||'MARGINAL_INTERVAL_SEPARATION',samples:data.equity?.samples??null,
    stopReason:data.equity?.stopReason??null,practicalEquivalence:leader?.practicalEquivalence??null,
    futurePolicy:data.trainingEvaluation?.policy||'SHOWDOWN_ONLY_CONDITIONAL_ACTION_VALUE_NOT_COMPLETE_POLICY_RETURN'};
}

module.exports={sharedEquityLeadership,analysisDiagnostics};
