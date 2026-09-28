'use strict';

const validBounds = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && value[0] <= value[1];

// A reading of existing CALL evidence, not another simulation or a policy that
// chooses between all legal actions. Unmodeled aggression is irrelevant here.
function assessContinuation(data = {}) {
  if (data.trainingEvaluation) return null;
  const state = data.state || {}, call = data.ev?.actions?.CALL, q = data.equity;
  const amount = state.amountToCall ?? data.potMath?.amountToCall;
  const result = {
    schemaVersion: 1, status: 'UNAVAILABLE', action: null,
    scope: 'CURRENT_CALL_VS_FOLD_SHOWDOWN_ONLY', excludesBetRaise: true,
    identifiesBestAction: false, guaranteesWin: false, externallyValidated: false,
    amountToCall: Number.isFinite(amount) ? amount : null,
    equity: Number.isFinite(q?.equity) ? q.equity : null,
    equityBounds: validBounds(q?.confidenceInterval95) ? [...q.confidenceInterval95] : q?.method === 'EXACT' && Number.isFinite(q?.equity) ? [q.equity, q.equity] : null,
    evChips: null, evBounds: null, boundsKind: null, breakEvenEquity: null,
    equityMarginPP: null, conservativeMarginPP: null,
    reasonCodes: [], missingInputs: [...(call?.missingInputs || [])],
    handContext: { street: state.street || null, madeHand: data.handInsights?.made?.label || null,
      nutsOnCurrentBoard: data.handInsights?.nuts?.unbeaten === true,
      futureBoardCards: !Array.isArray(state.board) || state.board.length < 5 },
    limitations: ['CONDITIONAL_ON_CARD_MODEL', 'NO_FUTURE_BETTING', 'NOT_A_WIN_OR_PROFIT_GUARANTEE']
  };
  const stop = (status, reason) => ({ ...result, status, reasonCodes: [reason] });
  if (data.status !== 'OK') return stop('UNAVAILABLE', 'CALCULATION_UNAVAILABLE');
  if (data.analysisStage === 'PROVISIONAL') return stop('PROVISIONAL', 'WAIT_FOR_FINAL_RESULT');
  if (!Number.isInteger(state.opponentCount) || !Number.isInteger(q?.opponents) || state.opponentCount !== q.opponents) return stop('UNAVAILABLE', 'INCOMPLETE_OPPONENT_COVERAGE');
  if (state.knownInformation?.amountToCall === false) return stop('UNAVAILABLE', 'AMOUNT_TO_CALL_REQUIRED');
  if (amount === 0 && data.legalActions?.includes('CHECK')) {
    result.action = 'CHECK';
    return stop('FREE_CHECK', 'NO_CURRENT_CALL_COST');
  }
  if (!(amount > 0) || !data.legalActions?.includes('CALL') || call?.legal !== true) return stop('UNAVAILABLE', 'CALL_NOT_LEGAL');
  result.action = 'CALL';
  if (call.status !== 'MODELED' || !Number.isFinite(call.ev)) {
    const missing = call.missingInputs || [];
    if (missing.some(x => /potBeforeAction/i.test(x))) return stop('UNAVAILABLE', 'POT_REQUIRED');
    if (missing.some(x => /amountToCall/i.test(x))) return stop('UNAVAILABLE', 'AMOUNT_TO_CALL_REQUIRED');
    return stop('UNAVAILABLE', missing.some(x => /rake/i.test(x)) ? 'COSTS_REQUIRED' : 'CALL_MODEL_UNAVAILABLE');
  }
  if (!['SHOWDOWN_ONLY', 'SCENARIO_SHOWDOWN_ONLY'].includes(call.model)) return stop('UNAVAILABLE', 'UNSUPPORTED_CALL_MODEL');
  result.evChips = call.ev;
  if (validBounds(call.conditionalEvEnvelope)) {
    result.evBounds = [...call.conditionalEvEnvelope]; result.boundsKind = 'CONDITIONAL_ENVELOPE';
    result.limitations.push('CONDITIONAL_ON_RESPONSE_ASSUMPTIONS');
  } else if (validBounds(call.confidenceInterval95)) {
    result.evBounds = [...call.confidenceInterval95]; result.boundsKind = q.method === 'EXACT' ? 'EXACT_MODEL_VALUE' : 'SAMPLING_INTERVAL_95';
  } else if (q.method === 'EXACT' && call.model === 'SHOWDOWN_ONLY') {
    result.evBounds = [call.ev, call.ev]; result.boundsKind = 'EXACT_MODEL_VALUE';
  }
  // A shared equity threshold only exists for the simple fixed current pot.
  // Conditional response branches can have different equities and net pots.
  if (call.model === 'SHOWDOWN_ONLY' && Number.isFinite(call.netPot) && call.netPot > 0) {
    result.breakEvenEquity = amount / call.netPot;
    if (result.equity !== null) result.equityMarginPP = (result.equity - result.breakEvenEquity) * 100;
    if (result.equityBounds) result.conservativeMarginPP = (result.equityBounds[0] - result.breakEvenEquity) * 100;
  }
  const bounds = result.evBounds;
  if (!bounds) return stop('UNCERTAIN', 'EV_BOUNDS_UNAVAILABLE');
  const tolerance = 1e-10 * Math.max(1, Math.abs(amount), Math.abs(call.ev), ...bounds.map(Math.abs));
  if (call.ev < bounds[0] - tolerance || call.ev > bounds[1] + tolerance) return stop('UNCERTAIN', 'INCONSISTENT_EV_BOUNDS');
  if (bounds[0] > tolerance) return stop('FAVORABLE', 'CALL_EV_LOWER_BOUND_POSITIVE');
  if (bounds[1] < -tolerance) return stop('UNFAVORABLE', 'CALL_EV_UPPER_BOUND_NEGATIVE');
  return stop('UNCERTAIN', 'EV_INTERVAL_TOUCHES_ZERO');
}

module.exports = { assessContinuation };
