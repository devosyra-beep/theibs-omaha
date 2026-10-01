'use strict';
const { createHash } = require('node:crypto');
const { solverDecisionPrecision, COMMITMENT_TARGET, SOLVER_BOUND_METHOD } = require('../decision-precision');
const { THRESHOLD_BB } = require('./solution-status');
const VERSION = 'THEIBS_DECISION_OUTCOME_V1';
const POLICY_VERSION = 'THEIBS_COMPARISON_POLICY_V1';
const SCOPE = 'FULL_PRIOR_COMMITMENT';
const finite = Number.isFinite;
const bits = new DataView(new ArrayBuffer(8));

function normalizePolicy(value) {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw Error('comparisonPolicy must be an object.');
  const nearEquivalenceBB = value?.nearEquivalenceBB === undefined ? .01 : value.nearEquivalenceBB;
  if (!finite(nearEquivalenceBB) || nearEquivalenceBB < 0) throw Error('nearEquivalenceBB must be a finite nonnegative BB amount.');
  for (const [key, expected] of [['version', POLICY_VERSION], ['unit', 'BB'], ['scope', SCOPE]])
    if (value?.[key] !== undefined && value[key] !== expected) throw Error(`Unsupported comparison policy ${key}.`);
  return Object.freeze({ version: POLICY_VERSION, nearEquivalenceBB: nearEquivalenceBB === 0 ? 0 : nearEquivalenceBB, unit: 'BB', scope: SCOPE });
}
function policyKey(value) {
  const policy = normalizePolicy(value);
  return createHash('sha256').update(JSON.stringify([policy.version, policy.nearEquivalenceBB, policy.unit, policy.scope])).digest('hex');
}
function outwardDifference(upper, lower) {
  if (upper === lower) return 0; // Equal supplied binary64 values subtract exactly.
  const difference = upper - lower;
  if (!finite(difference)) return difference;
  bits.setFloat64(0, difference);
  bits.setBigUint64(0, bits.getBigUint64(0) + (difference > 0 ? 1n : -1n));
  return bits.getFloat64(0);
}
const validBounds = row => row?.certified === true && finite(row.lowerBB) && finite(row.upperBB) && row.lowerBB <= row.upperBB;
const REASONS = Object.freeze({
  BOUNDS_PENDING: 'Compatible outward bounds are still being calculated for the declared commitments.',
  UNSUPPORTED_COMPARISON: 'A compatible full-prior commitment comparison is unavailable for this result.',
  MISSING_BOUNDS: 'At least one declared alternative has no compatible outward bounds.',
  GLOBAL_CONVERGENCE_PENDING: 'The existing global convergence criterion has not been met.',
  NEAR_EQUIVALENCE_PROVED: 'No declared commitment can exceed any commitment in this group by more than the configured BB amount, under the full original prior.',
  STRICT_LEADER_PROVED: 'One commitment has a lower bound above every other declared commitment upper bound.',
  COMPETITIVE_BOUNDS_OVERLAP: 'The available commitment bounds do not establish a strict leader or the configured near equivalence.',
  INSUFFICIENT_ALTERNATIVES: 'At least two declared commitments are required for a decision comparison.'
});

function decide(snapshot = {}, { policy, refining = false, costs = {}, firstValueMs = null, attempts = {}, stopReason = null } = {}) {
  const normalized = normalizePolicy(policy), epsilon = normalized.nearEquivalenceBB;
  // Reuse the existing independent origin/identity validator. A supplied
  // decisionPrecision field cannot bypass that validation.
  const precision = solverDecisionPrecision(snapshot), certificate = snapshot.actionPrecision;
  const ids = Array.isArray(snapshot.actions) ? snapshot.actions.map(row => row.id) : [];
  const suppliedRows = Array.isArray(certificate?.actions) ? certificate.actions : [];
  const supported = certificate?.target === COMMITMENT_TARGET && certificate.supportedGameClass === true;
  const pending = certificate?.target === COMMITMENT_TARGET && certificate.status === 'PENDING';
  const checked = pending && !supported ? solverDecisionPrecision({ ...snapshot, actionPrecision: { ...certificate, supportedGameClass: true } }) : precision;
  const declaredIds = Array.isArray(snapshot.abstraction?.rootActions) ? snapshot.abstraction.rootActions.map(row => row.id) : [];
  const validOrigin = snapshot.source === 'REFERENCE_SUBGAME_STRATEGY' && ['SOLVED','APPROXIMATE','REFINING'].includes(snapshot.status)
    && ids.every(id => typeof id === 'string' && id.length > 0) && new Set(ids).size === ids.length
    && declaredIds.length === ids.length && new Set(declaredIds).size === declaredIds.length && declaredIds.every(id => ids.includes(id));
  const validatedReasons = ['MISSING_ACTION_VALUES','INSUFFICIENT_COMPARABLE_ACTIONS','INVALID_OR_MISSING_ACTION_BOUNDS',
    'TIED_POINT_ESTIMATES','BEST_SECOND_INTERVALS_OVERLAP','OTHER_ALTERNATIVE_INTERVAL_OVERLAPS','SEPARATED_ACTION_COMMITMENT_BOUNDS'];
  const compatible = (supported || pending) && validOrigin && validatedReasons.includes(checked.reasonCode);
  const rows = ids.map(id => {
    const row = suppliedRows.find(item => item.id === id), valid = compatible && validBounds(row)
      && finite(row.estimateBB) && row.estimateBB >= row.lowerBB && row.estimateBB <= row.upperBB;
    return { id, certified: valid, estimateBB: valid ? row.estimateBB : null, lowerBB: valid ? row.lowerBB : null, upperBB: valid ? row.upperBB : null,
      widthBB: valid ? row.upperBB - row.lowerBB : null, attempts: attempts[id] || 0 };
  });
  const bounded = rows.filter(row => row.certified), allBounded = supported && compatible && ids.length >= 2 && bounded.length === ids.length
    && precision.uncertaintyMethod === SOLVER_BOUND_METHOD && precision.uncertaintyScope === COMMITMENT_TARGET;
  const toleranceBB = 16 * Number.EPSILON * Math.max(1, ...bounded.flatMap(row => [Math.abs(row.lowerBB), Math.abs(row.upperBB)]));
  const leader = bounded.slice().sort((a, b) => b.lowerBB - a.lowerBB || ids.indexOf(a.id) - ids.indexOf(b.id))[0];
  const competitive = rows.filter(row => !row.certified || !leader || row.upperBB + toleranceBB >= leader.lowerBB);
  const possibleNear = rows.filter(row => !row.certified || !leader || row.upperBB + epsilon + toleranceBB >= leader.lowerBB);
  const maxUpper = allBounded ? Math.max(...bounded.map(row => row.upperBB)) : null;
  const nearGroup = allBounded ? bounded.filter(row => outwardDifference(maxUpper, row.lowerBB) <= epsilon) : [];
  const worstDifference = nearGroup.length >= 2 ? outwardDifference(maxUpper, Math.min(...nearGroup.map(row => row.lowerBB))) : null;
  const globalConverged = snapshot.convergence?.exact === true && snapshot.convergence.thresholdMet === true
    && finite(snapshot.convergence.nashConv) && snapshot.convergence.nashConv >= 0 && snapshot.convergence.nashConv <= THRESHOLD_BB;
  const nearProved = globalConverged && allBounded && nearGroup.length >= 2 && finite(worstDifference) && worstDifference <= epsilon;
  const strictProved = globalConverged && allBounded && precision.status === 'CONCLUSIVE';
  let status = refining && compatible ? 'ESTIMATING' : 'INCONCLUSIVE';
  let reasonCode = !compatible ? 'UNSUPPORTED_COMPARISON' : ids.length < 2 ? 'INSUFFICIENT_ALTERNATIVES'
    : !allBounded ? refining ? 'BOUNDS_PENDING' : 'MISSING_BOUNDS' : !globalConverged ? 'GLOBAL_CONVERGENCE_PENDING' : 'COMPETITIVE_BOUNDS_OVERLAP';
  if (nearProved) { status = 'NEAR_EQUIVALENT'; reasonCode = 'NEAR_EQUIVALENCE_PROVED'; }
  else if (strictProved) { status = 'CERTIFIED'; reasonCode = 'STRICT_LEADER_PROVED'; }

  const costFields = ['buildMs','globalSolveMs','globalEvaluationMs','actionSolveMs','actionCertificateMs','totalComputeMs'];
  const available = costFields.filter(key => finite(costs[key]) && costs[key] >= 0), missing = costFields.filter(key => !available.includes(key));
  const measured = key => available.includes(key) ? costs[key] : null;
  const baseMs = ['buildMs','globalSolveMs','globalEvaluationMs'].every(key => available.includes(key))
    ? costs.buildMs + costs.globalSolveMs + costs.globalEvaluationMs : null;
  const boundsMs = measured('actionCertificateMs'), actionRefinementMs = measured('actionSolveMs'), totalMs = measured('totalComputeMs');
  const categories = [];
  if (stopReason === 'TIME_RESOURCE_CEILING') categories.push('TIME_BUDGET_EXHAUSTED');
  if (bounded.some(row => row.widthBB > epsilon)) categories.push('BOUNDS_TOO_WIDE');
  if (competitive.length === 2) categories.push('TWO_ACTIONS_COMPETITIVE');
  else if (competitive.length > 2) categories.push('MULTIPLE_ACTIONS_COMPETITIVE');
  if (possibleNear.length >= 2 && compatible) categories.push('POSSIBLE_NEAR_EQUIVALENCE');
  if (!globalConverged && baseMs !== null && actionRefinementMs !== null && baseMs > actionRefinementMs) categories.push('BASE_SOLVER_BOTTLENECK');
  if (!nearProved && !strictProved && baseMs !== null && actionRefinementMs !== null && actionRefinementMs > baseMs) categories.push('CERTIFICATION_BOTTLENECK');
  if (!categories.length) categories.push('UNKNOWN');
  const second = bounded.filter(row => row.id !== leader?.id).sort((a, b) => b.upperBB - a.upperBB || ids.indexOf(a.id) - ids.indexOf(b.id))[0];
  const gap = leader && second ? leader.lowerBB - second.upperBB : null;
  const points = bounded.slice().sort((a,b) => b.estimateBB - a.estimateBB || ids.indexOf(a.id) - ids.indexOf(b.id));
  const profilePoints = (Array.isArray(snapshot.actions) ? snapshot.actions : []).filter(row => finite(row.evBB)).slice().sort((a,b) => b.evBB - a.evBB);
  return { version: VERSION, status, reasonCode, reason: REASONS[reasonCode], scope: SCOPE, target: COMMITMENT_TARGET,
    coverage: 'ALL_DECLARED_ALTERNATIVES_ONLY', actualHandEVEquivalence: false, policy: normalized, policyKey: policyKey(normalized),
    actionIds: ids, globalConverged, strictLeaderActionId: strictProved ? precision.bestActionId : null,
    nearGroupActionIds: nearProved ? nearGroup.map(row => row.id) : [], robustWorstDifferenceBB: nearProved ? worstDifference : null,
    diagnostics: { category: categories[0], categories, stopReason, iterationBudgetExhausted: stopReason === 'ITERATION_RESOURCE_CEILING', reasonCode, globalConverged,
      counts: { declared: ids.length, certified: bounded.length, missing: ids.length - bounded.length,
        competitive: competitive.length, possibleNearEquivalent: possibleNear.length, attempted: rows.filter(row => row.attempts > 0).length,
        refinementBatches: rows.reduce((sum,row) => sum + row.attempts,0) },
      leaderActionId: leader?.id || null, secondActionId: second?.id || null, separationGapBB: finite(gap) ? gap : null,
      pointLeaderActionId: points[0]?.id || null, pointSecondActionId: points[1]?.id || null,
      pointDeltaBB: points.length >= 2 ? points[0].estimateBB - points[1].estimateBB : null, pointEstimateScope: SCOPE,
      originalProfilePointLeaderActionId: profilePoints[0]?.id || null, originalProfilePointSecondActionId: profilePoints[1]?.id || null,
      originalProfilePointDeltaBB: profilePoints.length >= 2 ? profilePoints[0].evBB - profilePoints[1].evBB : null,
      originalProfilePointScope: 'CURRENT_HAND_COMBINATION_RETURNED_PROFILE',
      competitiveActionIds: competitive.map(row => row.id), possibleNearGroupActionIds: possibleNear.map(row => row.id),
      possibleNearEquivalence: compatible && possibleNear.length >= 2, rows,
      costs: { scope: 'CUMULATIVE_COMPATIBLE_EXECUTIONS', computeOnly: true, totalMs, firstValueMs: finite(firstValueMs) ? firstValueMs : null,
        baseMs, boundsMs, actionRefinementMs, buildMs: measured('buildMs'), globalSolveMs: measured('globalSolveMs'),
        globalEvaluationMs: measured('globalEvaluationMs'),
        unattributedMs: totalMs !== null && baseMs !== null && actionRefinementMs !== null ? Math.max(0, totalMs - baseMs - actionRefinementMs) : null,
        available, missing, bottleneckBasis: 'MEASURED_BASE_VS_ACTION_REFINEMENT_PHASE_COSTS' } } };
}
module.exports = { VERSION, POLICY_VERSION, SCOPE, normalizePolicy, policyKey, outwardDifference, decide };
