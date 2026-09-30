'use strict';

// A point-value difference is separate from evidence that its sign is known.
// NashConv measures unilateral improvement of a strategy profile. It is not an
// error bar for an individual action's equilibrium value, even when it is zero.
const { createHash } = require('node:crypto');
const VERSION = 'THEIBS_DECISION_PRECISION_V2';
const LEGACY_METHOD = 'JOINT_WEIGHTED_RATIO_HOEFFDING_WITH_STOPPING_UNION_BOUND';
const SOLVER_BOUND_METHOD = 'OUTWARD_ROUNDED_INFORMATION_SET_BEST_RESPONSE_SADDLE_BOUNDS';
const COMMITMENT_TARGET = 'PRIVATE_INFORMATION_SET_COMMITMENT_VALUE';
const ACTION_BOUND_VERSION = 'THEIBS_ACTION_CONDITIONED_V1';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const numericBits = new DataView(new ArrayBuffer(8));
function outward(value, up) {
  if (value === (up ? Infinity : -Infinity)) return value;
  if (value === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE;
  numericBits.setFloat64(0, value);
  numericBits.setBigUint64(0, numericBits.getBigUint64(0) + ((value > 0) === up ? 1n : -1n));
  return numericBits.getFloat64(0);
}
const commitmentUtility = utility => utility?.unit === 'BB'
  && utility.basis === 'INCREMENTAL_TERMINAL_PAYOFF_FROM_ORIGINAL_DECISION' && utility.scope === 'FULL_PRIOR_EX_ANTE';
const REASONS = Object.freeze({
  COMPARISON_ORIGIN_MISSING: 'The comparison source, result status or decision context was not recorded.',
  INCOMPATIBLE_ORIGINS: 'These action values come from different sources, model versions, result statuses or decision contexts.',
  INVALID_ACTION_IDENTITIES: 'Every compared action needs a distinct identity.',
  INSUFFICIENT_COMPARABLE_ACTIONS: 'At least two comparable action values are needed to measure a difference.',
  MISSING_ACTION_VALUES: 'One or more alternatives have no modeled EV; a complete ranking is unavailable.',
  EQUILIBRIUM_ACTION_VALUE_UNCERTAINTY_UNAVAILABLE: 'No defensible bound is available for equilibrium action-value error. NashConv and exact evaluation of the current profile do not supply that bound.',
  DEFENSIBLE_UNCERTAINTY_UNAVAILABLE: 'No defensible uncertainty bound is available for this action-value comparison.',
  INVALID_OR_MISSING_ACTION_BOUNDS: 'A compared action is missing a valid uncertainty interval containing its EV.',
  INVALID_ACTION_BOUND_CONTEXT: 'Action bounds do not share the same state, ranges, fees, utility, tree, sizing or solver version.',
  ACTION_BOUNDS_PENDING: 'A certified action-conditioned value is not yet available for every alternative.',
  TIED_POINT_ESTIMATES: 'The best two point estimates are tied.',
  BEST_SECOND_INTERVALS_OVERLAP: 'The best and second-best point estimates are not separated at the available precision.',
  OTHER_ALTERNATIVE_INTERVAL_OVERLAPS: 'Another alternative can still exceed the point leader within its uncertainty interval.',
  SEPARATED_UNDER_FIXED_POLICY: 'The point leader is separated from every compared alternative under the fixed continuation policy. Model and profile uncertainty are not included.',
  SEPARATED_ACTION_COMMITMENT_BOUNDS: 'The lower value bound of this private-information-set commitment exceeds the upper bound of every other compared commitment in the same declared game. This is a range-level commitment value, not the current hand\'s EV against the original profile.'
});

function compareDecisionValues({ actions = [], source, originVersion, resultStatus, contextKey, target, uncertainty } = {}) {
  const result = { version: VERSION, status: 'INCONCLUSIVE', reasonCode: null, reason: null,
    source: source ?? null, originVersion: originVersion ?? null, resultStatus: resultStatus ?? null, contextKey: contextKey ?? null,
    target: target ?? null, unit: 'BB', leaderConclusive: false, globalBestSupported: false,
    bestActionId: null, secondActionId: null, bestEVBB: null, secondEVBB: null, deltaEVBB: null,
    differenceBoundsBB: null, bestBoundsBB: null, secondBoundsBB: null,
    strongestAlternativeUpperBB: null, bestSecondSeparated: false,
    confidenceLevel: null, uncertaintyMethod: null, uncertaintyScope: null,
    modelUncertaintyIncluded: false, separationToleranceBB: 0 };
  function finish(reasonCode) { return { ...result, reasonCode, reason: REASONS[reasonCode] }; }
  if (![source, resultStatus, contextKey].every(text)) return finish('COMPARISON_ORIGIN_MISSING');
  if (!Array.isArray(actions) || actions.some(action => !action || !text(action.id))
      || new Set(actions.map(action => action.id)).size !== actions.length) return finish('INVALID_ACTION_IDENTITIES');
  // Absent row-level tags inherit the enclosing snapshot. Explicit tags must
  // match exactly; a fold reference is not a bridge between unrelated models.
  if (actions.some(action => [['source', source], ['resultStatus', resultStatus], ['contextKey', contextKey]]
    .some(([key, expected]) => action[key] !== undefined && action[key] !== expected))) return finish('INCOMPATIBLE_ORIGINS');
  if (actions.some(action => ['originVersion', 'modelVersion', 'solverVersion'].some(key =>
    action[key] !== undefined && (!text(originVersion) || action[key] !== originVersion)))) return finish('INCOMPATIBLE_ORIGINS');
  if (uncertainty?.invalidContext === true) return finish('INVALID_ACTION_BOUND_CONTEXT');
  const ranked = actions.filter(action => finite(action.evBB)).slice().sort((a, b) => b.evBB - a.evBB);
  const best = ranked[0], second = ranked[1];
  result.bestActionId = best?.id ?? null; result.secondActionId = second?.id ?? null;
  result.bestEVBB = best?.evBB ?? null; result.secondEVBB = second?.evBB ?? null;
  result.deltaEVBB = second ? best.evBB - second.evBB : null;
  if (ranked.length < 2) return finish('INSUFFICIENT_COMPARABLE_ACTIONS');
  if (ranked.length !== actions.length) return finish('MISSING_ACTION_VALUES');
  if (target === 'EQUILIBRIUM_ACTION_EV') return finish('EQUILIBRIUM_ACTION_VALUE_UNCERTAINTY_UNAVAILABLE');
  // This is the only action-EV uncertainty construction implemented and
  // independently tested by the current Multiway continuation estimator.
  // A precision tolerance, exact arithmetic flag or convergence certificate
  // alone cannot enter this branch or create a synthetic interval.
  const legacyDefensible = source === 'LEGACY_CONTEXT_CONTINUATION' && resultStatus === 'HEURISTIC'
    && target === 'CONDITIONAL_CONTINUATION_EV' && uncertainty?.method === LEGACY_METHOD
    && uncertainty.scope === 'FIXED_CONTINUATION_POLICY' && uncertainty.simultaneous === true
    && uncertainty.confidenceLevel === .95;
  const solverDefensible = source === 'REFERENCE_SUBGAME_STRATEGY'
    && ['SOLVED', 'APPROXIMATE', 'REFINING'].includes(resultStatus) && target === COMMITMENT_TARGET
    && uncertainty?.method === SOLVER_BOUND_METHOD && uncertainty.scope === COMMITMENT_TARGET
    && uncertainty.contextValidated === true && uncertainty.deterministic === true;
  if (!legacyDefensible && !solverDefensible) return finish('DEFENSIBLE_UNCERTAINTY_UNAVAILABLE');
  result.confidenceLevel = legacyDefensible ? uncertainty.confidenceLevel : null;
  result.uncertaintyMethod = uncertainty.method; result.uncertaintyScope = uncertainty.scope;
  if (ranked.some(action => !Array.isArray(action.boundsBB) || action.boundsBB.length !== 2
      || !action.boundsBB.every(finite) || action.boundsBB[0] > action.evBB || action.boundsBB[1] < action.evBB)) return finish('INVALID_OR_MISSING_ACTION_BOUNDS');
  result.bestBoundsBB = [...best.boundsBB]; result.secondBoundsBB = [...second.boundsBB];
  result.differenceBoundsBB = [best.boundsBB[0] - second.boundsBB[1], best.boundsBB[1] - second.boundsBB[0]];
  if (solverDefensible) result.differenceBoundsBB = [outward(result.differenceBoundsBB[0], false), outward(result.differenceBoundsBB[1], true)];
  result.strongestAlternativeUpperBB = Math.max(...ranked.slice(1).map(action => action.boundsBB[1]));
  // Outward-rounded saddle bounds provide the numerical guarantee. This tiny
  // extra comparison guard can only withhold a conclusion, never create one.
  result.separationToleranceBB = solverDefensible
    ? 16 * Number.EPSILON * Math.max(1, ...ranked.flatMap(action => action.boundsBB.map(Math.abs))) : 0;
  result.bestSecondSeparated = best.boundsBB[0] > second.boundsBB[1] + result.separationToleranceBB;
  if (result.deltaEVBB === 0) return finish('TIED_POINT_ESTIMATES');
  if (!result.bestSecondSeparated) return finish('BEST_SECOND_INTERVALS_OVERLAP');
  if (!(best.boundsBB[0] > result.strongestAlternativeUpperBB + result.separationToleranceBB)) return finish('OTHER_ALTERNATIVE_INTERVAL_OVERLAPS');
  result.status = 'CONCLUSIVE'; result.leaderConclusive = true;
  return finish(solverDefensible ? 'SEPARATED_ACTION_COMMITMENT_BOUNDS' : 'SEPARATED_UNDER_FIXED_POLICY');
}

function solverDecisionPrecision(snapshot = {}) {
  // Do not map [EV - NashConv, EV + NashConv] to action intervals. Different
  // equilibrium opponent profiles can assign different EV to an unused action.
  const contextKey = snapshot.comparisonContext || snapshot.abstraction?.key || snapshot.gameHash || snapshot.revisionKey;
  const certificate = snapshot.actionPrecision;
  if (certificate?.target === COMMITMENT_TARGET && certificate.supportedGameClass === true) {
    const meta = snapshot.abstraction || {}, rows = certificate.actions;
    const expectedContext = createHash('sha256').update(JSON.stringify([
      meta.key, meta.heroInformationSet, snapshot.solverVersion, certificate.version
    ])).digest('hex');
    const validContext = snapshot.source === 'REFERENCE_SUBGAME_STRATEGY'
      && certificate.version === ACTION_BOUND_VERSION && text(certificate.baseGameHash)
      && certificate.baseGameHash === snapshot.gameHash
      && certificate.baseContextKey === expectedContext && certificate.solverVersion === snapshot.solverVersion
      && certificate.player === meta.heroSeat && certificate.informationSet === meta.heroInformationSet
      && commitmentUtility(certificate.utility) && certificate.fullPriorPreserved === true && certificate.originalHandActionEV === false
      && certificate.origin === SOLVER_BOUND_METHOD && meta.originalSeats === 2 && meta.constantSum === true
      && meta.treeComplete === true && meta.chanceSupportComplete === true
      && Array.isArray(rows) && Array.isArray(snapshot.actions) && rows.length === snapshot.actions.length
      && new Set(rows.map(row => row?.id)).size === rows.length
      && rows.every(row => snapshot.actions.some(action => action.id === row?.id)
        && row.baseGameHash === certificate.baseGameHash && row.baseContextKey === expectedContext
        && row.solverVersion === snapshot.solverVersion && row.origin === certificate.origin
        && row.version === certificate.version && row.target === certificate.target
        && (row.source === undefined || row.source === snapshot.source)
        && (row.resultStatus === undefined || row.resultStatus === snapshot.status)
        && row.player === certificate.player && row.informationSet === certificate.informationSet
        && commitmentUtility(row.utility) && row.fullPriorPreserved === true && row.originalHandActionEV === false
        && (row.certified !== true || text(row.conditionedHash) && row.conditionedHash === row.gameHash
          && row.rootActionFixed === row.id && row.rounding === 'IEEE754_BINARY64_NEXTAFTER_EACH_OPERATION'));
    // The estimate belongs to the conditioned commitment game. Never place
    // this bound around snapshot.actions[].evBB (original-profile hand EV).
    return compareDecisionValues({
      actions: (Array.isArray(rows) ? rows : []).map(row => ({ id: row.id,
        evBB: row.certified === true ? row.estimateBB : null,
        boundsBB: row.certified === true ? [row.lowerBB, row.upperBB] : null })),
      source: snapshot.source, originVersion: snapshot.solverVersion, resultStatus: snapshot.status,
      contextKey: certificate.baseContextKey, target: COMMITMENT_TARGET,
      uncertainty: { method: certificate.origin, scope: COMMITMENT_TARGET, deterministic: true,
        contextValidated: validContext, invalidContext: !validContext }
    });
  }
  return compareDecisionValues({
    actions: (Array.isArray(snapshot.actions) ? snapshot.actions : []).map(action => ({
      id: action.id, evBB: action.evBB,
      ...(action.source !== undefined ? { source: action.source } : {}),
      ...(action.originVersion !== undefined ? { originVersion: action.originVersion } : {}),
      ...(action.modelVersion !== undefined ? { modelVersion: action.modelVersion } : {}),
      ...(action.solverVersion !== undefined ? { solverVersion: action.solverVersion } : {}),
      ...(action.resultStatus !== undefined ? { resultStatus: action.resultStatus } : {}),
      ...(action.contextKey !== undefined ? { contextKey: action.contextKey } : {})
    })),
    source: snapshot.source, originVersion: snapshot.solverVersion, resultStatus: snapshot.status, contextKey,
    target: 'EQUILIBRIUM_ACTION_EV'
  });
}

module.exports = { VERSION, LEGACY_METHOD, SOLVER_BOUND_METHOD, COMMITMENT_TARGET, compareDecisionValues, solverDecisionPrecision };
