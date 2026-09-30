'use strict';

// Product qualification is separate from CFR execution and from job lifecycle.
// SOLVED is a numerical certificate for a supported declared subgame; it is not
// a GTO/full-hand label. New methods require their own validation before entry.
const { VERSION: CORE_VERSION } = require('./extensive-solver');
const { VERSION: PLO_VERSION, RULES_VERSION } = require('./plo-river-game');
const VERSION = 'THEIBS_SOLUTION_QUALIFICATION_V1';
const THRESHOLD_BB = .01;
const METHOD = 'ALTERNATING_CFR_PLUS_LINEAR_AVERAGE';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const near = (a, b) => finite(a) && finite(b) && Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(a), Math.abs(b));

function validStrategy(meta, result) {
  if (!Array.isArray(result?.strategy) || result.strategy.length !== meta?.originalSeats || !result.strategy.every(object)) return false;
  let rows = 0;
  for (const player of result.strategy) for (const row of Object.values(player)) {
    if (!object(row)) return false;
    const probabilities = Object.values(row);
    if (!probabilities.length || !probabilities.every(p => finite(p) && p >= 0 && p <= 1)
        || !near(probabilities.reduce((a, b) => a + b, 0), 1)) return false;
    rows++;
  }
  const root = result.strategy[meta.heroSeat]?.[meta.heroInformationSet];
  return rows > 0 && object(root) && Array.isArray(meta.rootActions) && meta.rootActions.length > 0
    && meta.rootActions.every(action => Object.prototype.hasOwnProperty.call(root, action.id))
    && Object.keys(root).length === meta.rootActions.length;
}

function exactMeasurement(meta, result) {
  const c = result?.convergence, count = meta?.originalSeats;
  if (c?.metric !== 'EXACT_NASH_CONV' || c.exact !== true || c.scope !== 'SUPPLIED_FINITE_GAME'
      || !finite(c.nashConv) || c.nashConv < 0 || !finite(c.maxUnilateralGain) || c.maxUnilateralGain < 0
      || !Array.isArray(c.unilateralGains) || c.unilateralGains.length !== count || !c.unilateralGains.every(v => finite(v) && v >= 0)
      || !Array.isArray(c.bestResponseValues) || c.bestResponseValues.length !== count || !c.bestResponseValues.every(finite)
      || !Array.isArray(result.values) || result.values.length !== count || !result.values.every(finite)) return false;
  if (!near(c.unilateralGains.reduce((a, b) => a + b, 0), c.nashConv)
      || !near(Math.max(...c.unilateralGains), c.maxUnilateralGain)) return false;
  return c.unilateralGains.every((gain, player) => c.bestResponseValues[player] >= result.values[player] - 1e-10
    && near(gain, Math.max(0, c.bestResponseValues[player] - result.values[player])));
}

function completeChance(meta) {
  if (meta?.treeComplete !== true || meta.chanceSupportComplete !== true
      || meta.chanceEnumeration !== 'EXACT_JOINT_RANGE_ENUMERATION'
      || !Array.isArray(meta.ranges) || meta.ranges.length !== meta.originalSeats) return false;
  const seats = new Set();
  for (const range of meta.ranges) {
    if (!Number.isSafeInteger(range.seatId) || range.seatId < 0 || range.seatId >= meta.originalSeats || seats.has(range.seatId)
        || range.complete !== true || typeof range.source !== 'string' || !range.source.trim()
        || !Array.isArray(range.combos) || !range.combos.length
        || !range.combos.every(combo => Array.isArray(combo.cards) && combo.cards.length === 5 && finite(combo.weight) && combo.weight > 0)) return false;
    seats.add(range.seatId);
  }
  const product = meta.ranges.reduce((count, range) => count * range.combos.length, 1);
  return meta.productWorlds === product && Number.isSafeInteger(meta.compatibleWorlds) && meta.compatibleWorlds > 0
    && meta.compatibleWorlds <= product && meta.excludedJointAssignments === product - meta.compatibleWorlds
    && finite(meta.compatiblePriorMass) && meta.compatiblePriorMass > 0 && meta.compatiblePriorMass <= 1 + 1e-12
    && finite(meta.heroWorldProbability) && meta.heroWorldProbability > 0 && meta.heroWorldProbability <= 1 + 1e-12;
}

function qualify(meta, result, { coverage, refining = false } = {}) {
  const source = meta?.source === 'LEGACY_HEURISTIC' && result?.method === 'MULTIWAY_CONTEXT_POLICY_V1'
    ? 'LEGACY_HEURISTIC' : 'REFERENCE_SUBGAME_STRATEGY';
  const reasons = [];
  const baseQualification = { version: VERSION, source, gto: false, fullHandEquilibrium: false,
    independentPokerReferenceValidated: false, gtoReason: 'INDEPENDENT_PLO_REFERENCE_VALIDATION_PENDING',
    scope: source === 'LEGACY_HEURISTIC' ? 'DECLARED_HEURISTIC_CONTINUATION' : 'DECLARED_FINITE_RIVER_SUBGAME' };
  if (source === 'LEGACY_HEURISTIC') return {
    status: 'HEURISTIC', qualification: { ...baseQualification, solvedSubgame: false, strategyFrequenciesSupported: false,
      reason: 'LEGACY_POLICY_MODEL', reasons: ['LEGACY_POLICY_MODEL'] },
    quality: { source, numericalStatus: 'HEURISTIC', exact: false, metric: null, unit: 'BB', nashConv: null,
      maxUnilateralGain: null, thresholdBB: THRESHOLD_BB, thresholdMet: false, completeChanceSupport: false }
  };

  const identified = meta?.version === PLO_VERSION && meta.rulesVersion === RULES_VERSION
    && meta.variant === 'PLO5_HIGH' && meta.street === 'RIVER' && meta.scope === 'FINITE_RIVER_SUBGAME'
    && meta.payoffUnit === 'BB' && meta.payoffBasis === 'INCREMENTAL_FROM_CURRENT_DECISION'
    && Number.isSafeInteger(meta.originalSeats) && meta.originalSeats >= 2 && meta.originalSeats <= 3;
  const supportedResult = result?.solverVersion === CORE_VERSION && result.method === METHOD
    && Number.isSafeInteger(result.iterations) && result.iterations > 0
    && typeof result.gameHash === 'string' && /^[a-f0-9]{64}$/.test(result.gameHash)
    && result.checkpoint?.gameHash === result.gameHash && result.checkpoint?.iterations === result.iterations;
  const strategyValid = identified && supportedResult && validStrategy(meta, result);
  const exact = strategyValid && exactMeasurement(meta, result);
  const thresholdMet = exact && result.convergence.nashConv <= THRESHOLD_BB;
  const chanceComplete = identified && completeChance(meta);
  const perfectRecall = result?.metrics?.perfectRecall === true;
  const supportedClass = identified && meta.originalSeats === 2 && meta.constantSum === true
    && finite(meta.constantSumValue) && near(result?.metrics?.constantSum, meta.constantSumValue)
    && result?.convergence?.convergenceGuarantee === 'TWO_PLAYER_CONSTANT_SUM_PERFECT_RECALL';
  const allLegalSizes = meta?.fullLegalSizingCoverage === true && coverage === 'FINITE_RIVER_SUBGAME';

  if (!identified) reasons.push('SUBGAME_NOT_IDENTIFIED');
  if (!supportedResult) reasons.push('SUPPORTED_SOLVER_RESULT_REQUIRED');
  if (!strategyValid) reasons.push('VALID_AVERAGE_STRATEGY_REQUIRED');
  if (!perfectRecall) reasons.push('PERFECT_RECALL_NOT_VERIFIED');
  if (!chanceComplete) reasons.push('COMPLETE_CHANCE_AND_TREE_REQUIRED');
  if (!allLegalSizes) reasons.push('LEGAL_SIZING_ABSTRACTION_PARTIAL');
  if (!supportedClass) reasons.push('GAME_CLASS_NOT_QUALIFIED_FOR_SOLVED');
  if (!exact) reasons.push('EXACT_DEVIATION_MEASUREMENT_REQUIRED');
  else if (!thresholdMet) reasons.push('DEVIATION_THRESHOLD_NOT_MET');

  const solvedSubgame = strategyValid && perfectRecall && chanceComplete && allLegalSizes && supportedClass && thresholdMet;
  const numericalStatus = solvedSubgame ? 'SOLVED' : strategyValid ? 'APPROXIMATE' : 'NOT_SOLVED';
  // REFINING is an actual lifecycle indication, not a quality upgrade or SLA.
  const status = refining && !solvedSubgame && coverage !== 'NOT_SOLVED' ? 'REFINING' : numericalStatus;
  return {
    status,
    qualification: { ...baseQualification, solvedSubgame, strategyFrequenciesSupported: strategyValid,
      reason: solvedSubgame ? 'CONVERGED_SUPPORTED_SUBGAME' : reasons[0], reasons },
    quality: { source, numericalStatus, exact, metric: 'EXACT_NASH_CONV', unit: 'BB', thresholdBB: THRESHOLD_BB,
      thresholdMet, nashConv: exact ? result.convergence.nashConv : null,
      maxUnilateralGain: exact ? result.convergence.maxUnilateralGain : null,
      completeChanceSupport: chanceComplete, perfectRecallVerified: perfectRecall,
      fullLegalSizingCoverage: allLegalSizes, supportedGameClass: supportedClass,
      iterations: supportedResult ? result.iterations : null,
      convergenceGuarantee: result?.convergence?.convergenceGuarantee || null }
  };
}

module.exports = { VERSION, THRESHOLD_BB, qualify };
