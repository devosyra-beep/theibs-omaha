'use strict';

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boardFactors(board = []) {
  const ranks = board.map((card) => String(card)[0]);
  const suits = board.map((card) => String(card)[1]);
  const paired = new Set(ranks).size < ranks.length;
  const suitCounts = suits.reduce((counts, suit) => ({ ...counts, [suit]: (counts[suit] || 0) + 1 }), {});
  const monotone = Object.values(suitCounts).some((count) => count >= 3);
  const rankValues = ranks.map((rank) => ({ A: 14, K: 13, Q: 12, J: 11, T: 10 }[rank] || Number(rank))).filter(Number.isFinite);
  const connected = rankValues.length >= 3 && Math.max(...rankValues) - Math.min(...rankValues) <= 5;
  return { paired, monotone, connected };
}

function actionBounds(action, item, equity) {
  const interval = item.conditionalEvEnvelope ?? item.confidenceInterval95;
  if (interval !== undefined && interval !== null) {
    if (!Array.isArray(interval) || interval.length !== 2 || !interval.every(Number.isFinite)
      || interval[0] > item.ev || interval[1] < item.ev || interval[0] > interval[1]) return null;
    return { lower: interval[0], upper: interval[1], source: item.conditionalEvEnvelope ? 'CONDITIONAL_ENVELOPE' : 'SAMPLING_INTERVAL' };
  }
  if (action === 'FOLD' && item.ev === 0) return { lower: 0, upper: 0, source: 'DECISION_POINT_REFERENCE' };
  if (item.model === 'SHOWDOWN_ONLY' && equity?.method === 'EXACT') return { lower: item.ev, upper: item.ev, source: 'EXACT_ENUMERATION_UNDER_ASSUMPTIONS' };
  // These are explicitly supplied fixed parameters, not empirical estimates.
  // Their arithmetic has no Monte Carlo noise; their validity remains assumed.
  if (item.model === 'FOLD_EQUITY_SHOWDOWN_ONLY') return { lower: item.ev, upper: item.ev, source: 'FIXED_INPUT_ARITHMETIC' };
  if (item.model === 'SCENARIO_SHOWDOWN_ONLY' && item.scenarioBreakdown?.length
    && item.scenarioBreakdown.every(branch => branch.probability === 0 || branch.callers?.length === 0 || branch.equitySource === 'USER_CONDITIONAL')) {
    return { lower: item.ev, upper: item.ev, source: 'FIXED_INPUT_ARITHMETIC' };
  }
  return null;
}

function assessLeadership(ranked, actions, equity, tiedActions) {
  const boundsByAction = Object.fromEntries(ranked.map(({ action }) => [action, actionBounds(action, actions[action], equity)]));
  const missingBoundsActions = ranked.filter(({ action }) => !boundsByAction[action]).map(({ action }) => action);
  const pointLeader = ranked[0]?.action || null;
  const leaderBounds = pointLeader ? boundsByAction[pointLeader] : null;
  let status;
  if (!ranked.length) status = 'UNAVAILABLE';
  else if (ranked.length === 1) status = 'SINGLE_MODELED_ACTION';
  else if (tiedActions.length > 1) status = 'TIED';
  else if (missingBoundsActions.length) status = 'MISSING_BOUNDS';
  else status = ranked.slice(1).every(({ action }) => leaderBounds.lower > boundsByAction[action].upper) ? 'SEPARATED' : 'OVERLAPPING';
  return {
    status, pointLeader,
    pointGap: ranked.length > 1 ? ranked[0].ev - ranked[1].ev : null,
    candidateActions: ranked.filter(({ action }) => !leaderBounds || !boundsByAction[action]
      || boundsByAction[action].upper >= leaderBounds.lower).map(({ action }) => action),
    boundsByAction, missingBoundsActions,
    scope: 'REPORTED_BOUNDS_UNDER_FIXED_ASSUMPTIONS',
    // Marginal intervals can be dependent and scenario envelopes do not carry
    // simultaneous coverage. Separation here is not a 95% optimality claim.
    simultaneousConfidenceLevel: null
  };
}

function evaluateStrategy(context = {}) {
  const input = context.input || context;
  const suppliedActions = context.legalActions || input.legalActions;
  const legalActions = Array.isArray(suppliedActions)
    ? [...new Set(suppliedActions.map((action) => String(action).toUpperCase()))]
    : [];
  const equity = context.equity ?? input.equity;
  const potMath = context.potMath || input.potMath || {};
  const ev = context.ev || input.ev || {};
  const position = String(input.position || '').toUpperCase() || null;
  const players = numeric(input.players);
  const effectiveStack = numeric(input.effectiveStack);
  const equityValue = numeric(equity?.equity ?? equity);
  const boardState = boardFactors(input.board || context.state?.board || []);
  const factors = [];
  const reasonCodes = [];
  const missingFactors = [];
  const warnings = [...(ev.warnings || [])];
  const assumptions = [...(ev.assumptions || [])];

  // A modeled fold must not make an incomplete comparison look complete.
  // Only finite EVs of the currently legal actions participate in this ranking.
  const comparedActions = legalActions.filter((action) =>
    ev.actions?.[action]?.status === 'MODELED' && Number.isFinite(ev.actions[action].ev));
  const missingLegalActions = legalActions.filter((action) => !comparedActions.includes(action));
  const comparisonComplete = legalActions.length > 0 && missingLegalActions.length === 0;
  const comparisonStatus = comparisonComplete ? 'COMPLETE' : comparedActions.length ? 'PARTIAL' : 'UNAVAILABLE';
  const ranked = comparedActions.map((action) => ({ action, ev: ev.actions[action].ev })).sort((left, right) => right.ev - left.ev);
  const bestEV = ranked[0]?.ev;
  const tiedActions = bestEV === undefined ? [] : comparedActions.filter((action) => ev.actions[action].ev === bestEV);
  const action = tiedActions[0] || 'NO_DECISION';
  const leadership = assessLeadership(ranked, ev.actions || {}, equity, tiedActions);

  if (!position) missingFactors.push('position');
  if (players === null) missingFactors.push('players');
  if (effectiveStack === null) missingFactors.push('effectiveStack');
  if (equityValue === null) missingFactors.push('equity');
  if (!comparisonComplete) missingFactors.push('completeActionEV');

  if (boardState.paired) factors.push({ code: 'PAIRED_BOARD', value: true, detail: 'Paired board; the hand category depends on available combinations.' });
  if (boardState.monotone) factors.push({ code: 'MONOTONE_BOARD', value: true, detail: 'Three board cards share a suit; check possible flushes and blockers.' });
  if (boardState.connected) factors.push({ code: 'CONNECTED_BOARD', value: true, detail: 'Connected board; check possible straights.' });
  if (position) factors.push({ code: 'POSITION', value: position, detail: `Entered position: ${position}. Relative position depends on active opponents.` });
  if (players !== null && players > 2) factors.push({ code: 'MULTIWAY', value: players, detail: `${players} players entered; participants and responses are scenario assumptions.` });
  const potOdds = numeric(potMath.potOdds);
  if (equityValue !== null && potOdds !== null && Number(input.amountToCall) > 0) {
    factors.push({ code: 'POT_ODDS_COMPARISON', value: equityValue - potOdds, detail: 'Compares the price with showdown equity; this alone does not compare raise EV.' });
  }

  if (action === 'NO_DECISION') {
    reasonCodes.push(legalActions.length ? 'NO_MODELED_ACTION' : 'NO_LEGAL_ACTION');
    warnings.push('No legal action has calculated EV for comparison.');
  } else {
    reasonCodes.push(comparisonComplete ? 'BEST_MODELED_EV' : 'BEST_AVAILABLE_MODELED_EV');
    factors.push({ code: 'MODELED_EV', value: bestEV, detail: `${action} has the highest EV among actions calculated in this scenario.` });
    for (const candidate of comparedActions) assumptions.push(...(ev.actions[candidate].assumptions || []));
  }
  if (!comparisonComplete) {
    reasonCodes.push('EV_MODEL_INCOMPLETE');
    if (missingLegalActions.length) warnings.push(`Partial comparison: ${missingLegalActions.join(', ')} still needs calculation. The leader among calculated actions does not establish the best overall action.`);
  }
  if (tiedActions.length > 1) {
    reasonCodes.push('MODELED_EV_TIE');
    warnings.push(`EV tie between ${tiedActions.join(', ')}; display order is not a strategic preference.`);
  }
  if (leadership.status === 'OVERLAPPING') {
    reasonCodes.push('EV_LEADERSHIP_OVERLAP');
    warnings.push(`Nominal lead by ${action} is inconclusive: EV intervals overlap or touch alternatives. More samples may reduce sampling uncertainty, but not assumption error.`);
  } else if (leadership.status === 'MISSING_BOUNDS') {
    reasonCodes.push('EV_LEADERSHIP_UNASSESSED');
    warnings.push(`The nominal leader's separation was not verified: valid EV intervals are missing for ${leadership.missingBoundsActions.join(', ')}.`);
  } else if (leadership.status === 'SEPARATED') {
    reasonCodes.push('EV_LEADER_SEPARATED_WITHIN_BOUNDS');
    assumptions.push('The leader is separated within the supplied intervals under fixed assumptions; this does not assign joint 95% confidence or validate the opponent model.');
  }
  assumptions.push('Comparison is limited to evaluated actions and sizes under the entered assumptions.');
  warnings.push('The result is not a solver solution or a validated optimal strategy.');

  return {
    action,
    source: comparisonComplete ? 'MODELED_ACTION_COMPARISON' : comparedActions.length ? 'PARTIAL_ACTION_COMPARISON' : 'NO_ACTION_COMPARISON',
    decisionBasis: 'EV_COMPARISON',
    comparisonComplete,
    comparisonStatus,
    comparedActions,
    missingLegalActions,
    bestModeledAction: action === 'NO_DECISION' ? null : action,
    tiedActions,
    leadership,
    optimalityScope: comparisonComplete ? 'EVALUATED_ACTIONS_AND_SIZES_UNDER_ASSUMPTIONS' : comparedActions.length ? 'MODELED_ACTIONS_ONLY' : 'NONE',
    // Exact equity is not evidence that the opponent model or strategy is exact.
    confidence: comparisonComplete && missingFactors.length === 0 && ev.confidence !== 'LOW' && leadership.status === 'SEPARATED' ? 'MEDIUM' : 'LOW',
    score: null,
    reasonCodes: [...new Set(reasonCodes)],
    factors,
    alternatives: legalActions.filter((candidate) => candidate !== action),
    assumptions: [...new Set(assumptions)],
    missingFactors: [...new Set(missingFactors)],
    warnings: [...new Set(warnings)]
  };
}

module.exports = { evaluateStrategy, boardFactors };
