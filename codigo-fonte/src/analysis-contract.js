'use strict';
const { createHash } = require('node:crypto');
const { statisticalSummary } = require('./statistical-summary');
const { isMissing } = require('./input-number');
const BUILD = require('../package.json').version;
const { analysisDiagnostics } = require('./analyze-inference');
const { assessContinuation } = require('./continuation-assessment');

function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(item => stableJSON(item) ?? 'null').join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const fingerprint = value => createHash('sha256').update(stableJSON(value)).digest('hex');

function recommendationFor(data) {
  const base = data.strategy?.baseline, leader = data.trainingEvaluation?.leadership || base?.leadership;
  const nominal = data.ev?.bestModeledAction || base?.bestModeledAction || data.recommendedAction;
  const pointLeader = nominal && nominal !== 'NO_DECISION' ? nominal : null;
  const expectedOpponents = data.state?.opponentCount;
  const missingOpponentModel = Number.isInteger(expectedOpponents) && Number.isInteger(data.equity?.opponents) && data.equity.opponents !== expectedOpponents;
  let status = 'UNAVAILABLE';
  if (data.status === 'OK' && pointLeader) {
    if (data.analysisStage === 'PROVISIONAL') status = 'PROVISIONAL';
    else if (missingOpponentModel || !data.ev?.comparisonComplete) status = 'INCOMPLETE';
    else if (leader?.status !== 'SEPARATED' || !data.legalActions?.includes(pointLeader)
      || data.ev?.actions?.[pointLeader]?.status !== 'MODELED') status = 'INCONCLUSIVE';
    else if (data.strategy?.finalSource === 'EXPLOIT_ADJUSTMENT') status = 'UNVERIFIED_ADJUSTMENT';
    else status = 'CONDITIONAL';
  }
  return { status, action: status === 'CONDITIONAL' ? pointLeader : null,
    size: status === 'CONDITIONAL' ? data.recommendedSize ?? data.ev?.actions?.[pointLeader]?.targetStreetTotal ?? null : null,
    pointLeader, adjustedAction: data.strategy?.finalSource === 'EXPLOIT_ADJUSTMENT' ? data.recommendedAction : null,
    candidates: leader?.candidateOptions || leader?.candidateActions || [],
    missingActions: data.ev?.missingLegalActions || [], missingOpponentModel,
    scope: 'EVALUATED_ACTIONS_AND_SIZES_UNDER_STATED_ASSUMPTIONS', externallyValidated: false };
}

function costProvenance(data, input) {
  if (data.trainingEvaluation) return { mode: 'EXPLICIT_ZERO_TRAINING_MODEL', amount: 0 };
  if(input.rakeSchedule)return {mode:'PERCENT_CAPPED_SCHEDULE',schedule:input.rakeSchedule,amount:null,scope:'ELIGIBLE_POT_BY_ACTION_RESPONSE'};
  const amount = isMissing(input.rake) ? null : Number(input.rake);
  const base = Number.isFinite(amount) ? { mode: 'FIXED_INPUT', amount }
    : input.assumeNoRake === true ? { mode: 'EXPLICIT_ZERO', amount: 0 } : { mode: 'UNKNOWN', amount: null };
  const byAction = Object.fromEntries(Object.entries(data.ev?.actions || {}).filter(([,item])=>item.scenarioBreakdown?.length)
    .map(([action,item])=>[action,item.scenarioBreakdown.map(branch=>({probability:branch.probability,rake:branch.rake,callers:branch.callers}))]));
  return Object.keys(byAction).length ? { mode: 'SCENARIO_SPECIFIC', amount: null, base, byAction } : base;
}

// Callers pass PUBLIC inputs only. No simulator deal or hidden session object.
function attachAnalysisContract(data, publicInput) {
  const continuationAssessment = assessContinuation(data);
  const statistics = statisticalSummary(data);
  const inputHash = fingerprint({ engineBuild: BUILD, publicInput });
  const outputHash = fingerprint({ equity: data.equity, ev: data.ev, trainingEvaluation: data.trainingEvaluation?.candidates, continuationAssessment, statistics });
  const recommendation = recommendationFor(data);
  return { ...data, ...(recommendation.missingOpponentModel ? { reason: 'Incomplete opponent coverage: these values describe only the modeled opponents and do not support a recommendation for this table.' } : {}), engineBuild: BUILD, analysisId: fingerprint({ inputHash, outputHash }),
    provenance: { schemaVersion: 2, engineBuild: BUILD, inputHash, outputHash,
      createdAt: new Date().toISOString(), source: data.trainingEvaluation ? 'SIMULATION' : 'LOCAL_CALCULATION',
      unit: 'chips', evReference: 'INCREMENTAL_FROM_CURRENT_DECISION',
      rangeOrigin: data.ranges || [], seed: data.equity?.seed ?? null,
      ...(publicInput.opponentModelScope?{opponents:publicInput.opponentModelScope}:{}),
      method: data.equity?.method ?? null, samples: data.equity?.samples ?? null,
      intervalMethod: data.equity?.intervalMethod ?? null,
      stopReason: data.equity?.stopReason ?? null,
      rake: costProvenance(data, publicInput),
      futurePolicy: data.trainingEvaluation?.policy || publicInput.futureStreetModel || null,
      assumptions: data.assumptions || [] },
    statistics, continuationAssessment, recommendation, analysisDiagnostics:analysisDiagnostics({...data,recommendation},publicInput) };
}

module.exports = { stableJSON, fingerprint, recommendationFor, attachAnalysisContract };
