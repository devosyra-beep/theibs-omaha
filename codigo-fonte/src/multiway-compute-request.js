'use strict';
const session = require('./multiway-session');
const {attachAnalysisContract} = require('./analysis-contract');
// Only the authoritative ledger supplies pot, stacks, cards, legality and
// revision. Caller budgets/config overrides never reach the math kernel.
function prepare(payload, phase = payload?.analysisPhase === 'PREVIEW' ? 'PREVIEW' : 'FINAL') {
  if (!payload || payload.multiway?.enabled !== true || !payload.multiwayEvaluation ||
      typeof payload.multiwayEvaluation !== 'object' || Array.isArray(payload.multiwayEvaluation)) throw Error('Choose a contextual Multiway decision.');
  if (!['PREVIEW','FINAL'].includes(phase)) throw Error('Choose a valid analysis phase.');
  const observed = session.envelope(payload.multiway), coverage = observed.continuationAnalysis;
  if (coverage.reasons.length) return {observed, phase, blocked:attachAnalysisContract(
    session.blockedResult({...coverage,available:false,observed,opponentHypotheses:[],warnings:[]}),
    {...coverage.input,multiway:observed.multiway})};
  const raw = payload.multiwayEvaluation;
  const input = {multiwayEvaluation:{
    profileSnapshot:raw.profileSnapshot, ranges:raw.ranges, chosenSize:raw.chosenSize,
    rake:raw.rake, rakeSchedule:raw.rakeSchedule, assumeNoRake:raw.assumeNoRake===true,
    feeBasis:raw.feeBasis==='BEFORE_FEES' && raw.assumeNoRake===true ? 'BEFORE_FEES' : undefined,
    config:observed.multiway.config, events:observed.multiway.events, handId:observed.multiway.handId,
    revisionKey:observed.state.revisionKey, samples:phase==='PREVIEW'?32:128,
    timeBudgetMs:phase==='PREVIEW'?350:1800
  }};
  return {observed, phase, input};
}
module.exports = {prepare};
