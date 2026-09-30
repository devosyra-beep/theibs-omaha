'use strict';

// Decorates calculated EV without changing the chip ledger or inventing an
// opponent response. A point estimate is not evidence of a strategic edge.
const ACTIONS = ['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE'];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const positive = value => finite(Number(value)) && Number(value) > 0 ? Number(value) : null;

function numericalEvidence(item, equity) {
  if (item.status !== 'MODELED' || !finite(item.ev)) return { quality: 'NOT_AVAILABLE', bounds: null, scope: null };
  if (item.action === 'FOLD') return { quality: 'DECISION_REFERENCE', bounds: [0, 0], scope: 'EXACT_REFERENCE' };
  for (const [field, quality] of [['conditionalEvEnvelope', 'CONDITIONAL_ENVELOPE'], ['confidenceInterval95', 'SAMPLING_INTERVAL_95']]) {
    const bounds = item[field];
    if (bounds === undefined || bounds === null) continue;
    if (Array.isArray(bounds) && bounds.length === 2 && bounds.every(finite) && bounds[0] <= item.ev && item.ev <= bounds[1]) {
      return { quality, bounds: [...bounds], scope: item.intervalScope || (quality === 'SAMPLING_INTERVAL_95' ? 'SAMPLING_ONLY_FIXED_MODEL' : 'MARGINAL_CONDITIONAL_INTERVALS') };
    }
    return { quality: 'INVALID_INTERVAL', bounds: null, scope: 'REPORTED_INTERVAL_DOES_NOT_CONTAIN_ESTIMATE' };
  }
  if (item.model === 'SHOWDOWN_ONLY' && equity?.method === 'EXACT') {
    return { quality: 'EXACT_ENUMERATION', bounds: [item.ev, item.ev], scope: 'EXACT_UNDER_FIXED_RANGES_AND_NO_FUTURE_BETS' };
  }
  if (item.model === 'FOLD_EQUITY_SHOWDOWN_ONLY' || (item.model === 'SCENARIO_SHOWDOWN_ONLY'
    && item.scenarioBreakdown?.length && item.scenarioBreakdown.every(branch =>
      branch.probability === 0 || !branch.callers?.length || branch.equitySource === 'USER_CONDITIONAL'))) {
    return { quality: 'FIXED_INPUT_ARITHMETIC', bounds: [item.ev, item.ev],
      scope: 'EXACT_ARITHMETIC_ONLY_RESPONSE_AND_RANGE_ASSUMPTIONS_UNVALIDATED' };
  }
  return { quality: 'NO_NUMERICAL_INTERVAL', bounds: null, scope: 'MODEL_AND_INPUT_UNCERTAINTY_NOT_QUANTIFIED' };
}

function actionSize(action, item, input) {
  if (action !== 'BET' && action !== 'RAISE') return null;
  if (positive(item.targetStreetTotal) !== null) return item.targetStreetTotal;
  const raw = action === 'BET' ? input.betSize : input.raiseTo;
  return positive(raw);
}

function declaredContext(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_:.\-]{0,119}$/.test(value) ? value : null;
}

function hasDistinctScenarioCost(model, input) {
  if (!Array.isArray(model?.scenarios)) return false;
  const common = input.rake !== undefined && input.rake !== null && input.rake !== ''
    ? Number(input.rake) : input.assumeNoRake === true ? 0 : null;
  return model.scenarios.some(branch => branch.rake !== undefined && branch.rake !== null && branch.rake !== ''
    && (common === null || Math.abs(Number(branch.rake) - common) > 1e-8));
}

function comparisonContext(action, item, input) {
  if (action === 'FOLD') return 'DECISION_POINT_REFERENCE';
  // The decision engine has the generated study models; the Multiway guard
  // later receives only the public input. Preserve that engine-issued scope.
  if (input.aggressionStudy?.enabled && typeof item.comparisonContext === 'string') return item.comparisonContext;
  const baseContext = declaredContext(input.comparisonContextId) || 'BASE_SHOWDOWN_PRIOR';
  if (item.model === 'SHOWDOWN_ONLY') return `SHOWDOWN:${baseContext}`;
  if (item.model === 'SCENARIO_SHOWDOWN_ONLY') {
    const model = input.actionResponseModels?.[action];
    if (hasDistinctScenarioCost(model, input)) return `ACTION_SPECIFIC_COST:${action}`;
    const context = declaredContext(model?.comparisonContextId);
    return context ? `SHOWDOWN:${context}` : `UNLINKED_SCENARIO:${action}`;
  }
  if (item.model === 'FOLD_EQUITY_SHOWDOWN_ONLY') {
    const context = declaredContext(input.opponentResponseModel?.comparisonContextId);
    return context ? `SHOWDOWN:${context}` : `UNLINKED_LEGACY_RESPONSE:${action}`;
  }
  return `UNLINKED_MODEL:${action}`;
}

function enrichActionEV(ev, input = {}, equity = null) {
  if (!ev || !ev.actions) return ev;
  const legalActions = Array.isArray(input.legalActions) ? [...new Set(input.legalActions.filter(action => ACTIONS.includes(action)))]
    : ACTIONS.filter(action => ev.actions[action]?.legal);
  const bigBlind = positive(input.bigBlind);
  const potBeforeDecision = input.potBeforeAction != null && input.potBeforeAction !== '' && finite(Number(input.potBeforeAction)) && Number(input.potBeforeAction) >= 0 ? Number(input.potBeforeAction) : null;
  const callPrice = input.amountToCall != null && input.amountToCall !== '' && finite(Number(input.amountToCall)) && Number(input.amountToCall) >= 0 ? Number(input.amountToCall) : null;
  const opponentMismatch = input.players != null && input.players !== '' && Number.isInteger(Number(input.players)) && Number.isInteger(equity?.opponents)
    && Number(input.players) - 1 !== equity.opponents;
  const modeled = [];
  for (const action of ACTIONS) {
    const item = ev.actions[action];
    if (!item) continue;
    const evidence = numericalEvidence(item, equity);
    item.size = actionSize(action, item, input);
    item.sizeBasis = item.size === null ? null : 'STREET_TOTAL';
    item.sizeBB = item.size !== null && bigBlind !== null ? item.size / bigBlind : null;
    item.evBB = item.status === 'MODELED' && finite(item.ev) && bigBlind !== null ? item.ev / bigBlind : null;
    item.differenceToBestModeledBB = null;
    item.numericalBounds = evidence.bounds;
    item.numericalQuality = evidence.quality;
    item.numericalScope = evidence.scope;
    item.comparisonContext = item.status === 'MODELED' ? comparisonContext(action, item, input) : null;
    if (legalActions.includes(action) && item.status === 'MODELED' && finite(item.ev)) modeled.push(item);
  }
  const missingLegalActions = legalActions.filter(action => !modeled.some(item => item.action === action));
  const contexts = [...new Set(modeled.filter(item => item.action !== 'FOLD').map(item => item.comparisonContext))];
  const incompatibleAssumptions = input.multiwayComparison === true && contexts.length > 1;
  const comparable = opponentMismatch || incompatibleAssumptions ? [] : modeled;
  comparable.sort((left, right) => right.ev - left.ev || legalActions.indexOf(left.action) - legalActions.indexOf(right.action));
  const best = comparable[0] || null, second = comparable[1] || null;
  for (const item of comparable) if (bigBlind !== null) item.differenceToBestModeledBB = (best.ev - item.ev) / bigBlind;
  const gap = second ? best.ev - second.ev : null;
  const numericalSeparation = Boolean(best && second && best.numericalBounds && comparable.slice(1).every(item =>
    item.numericalBounds && best.numericalBounds[0] > item.numericalBounds[1]));
  // Coverage and comparability are separate facts: every legal action may
  // have a value while the opponent set still differs from the table.
  const complete = legalActions.length > 0 && missingLegalActions.length === 0;
  ev.unit = 'chips';
  ev.bigBlind = bigBlind;
  ev.potBeforeDecision = potBeforeDecision;
  ev.callPrice = callPrice;
  ev.callPriceBB = callPrice !== null && bigBlind !== null ? callPrice / bigBlind : null;
  ev.missingLegalActions = missingLegalActions;
  ev.comparisonComplete = complete;
  ev.comparisonStatus = opponentMismatch ? 'INCOMPARABLE_OPPONENT_COVERAGE'
    : incompatibleAssumptions ? 'INCOMPARABLE_ASSUMPTIONS' : complete ? 'COMPLETE' : modeled.length ? 'PARTIAL' : 'UNAVAILABLE';
  ev.comparisonContexts = contexts;
  ev.comparableActions = comparable.map(item => item.action);
  ev.bestModeledAction = best?.action || null;
  ev.bestModeledEVBB = best && bigBlind !== null ? best.ev / bigBlind : null;
  ev.gapBestSecond = gap;
  ev.gapBestSecondBB = gap !== null && bigBlind !== null ? gap / bigBlind : null;
  ev.leaderConclusive = complete && numericalSeparation;
  ev.globalBestSupported = ev.leaderConclusive;
  ev.precisionScope = 'NUMERICAL_ONLY_UNDER_FIXED_ASSUMPTIONS';
  if (opponentMismatch) ev.warnings = [...new Set([...(ev.warnings || []), 'Opponent coverage differs from the table; action values cannot be compared for this decision.'])];
  if (incompatibleAssumptions) ev.warnings = [...new Set([...(ev.warnings || []),
    'Action values use unlinked opponent priors, response assumptions or costs; no shared ranking is available.'])];
  return ev;
}

module.exports = { enrichActionEV, numericalEvidence };
