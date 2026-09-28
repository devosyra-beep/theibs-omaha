'use strict';
const { optionalNumber } = require('./input-number');
const { calculateActionEV } = require('./action-ev-engine');
const read = (value, label) => optionalNumber(value, label, { nonNegative:true });

// Display math consumes the same CALL model as the decision engine. It never
// publishes a second gross/no-rake EV under the guise of a net value.
function calculatePotMath(input) {
  const potBeforeAction = read(input.potBeforeAction ?? input.potBeforeCall, 'potBeforeAction');
  const amountToCall = read(input.amountToCall, 'amountToCall');
  const effectiveStack = read(input.effectiveStack, 'effectiveStack');
  let potAfterCall = potBeforeAction !== null && amountToCall !== null ? potBeforeAction + amountToCall : null;
  const potOddsBeforeCosts = amountToCall !== null && potAfterCall > 0 ? amountToCall / potAfterCall : null;
  let potOdds = null, evCall = null;
  let callMathScope = potAfterCall === null ? 'CURRENT_PRICE_INCOMPLETE' : 'CURRENT_PRICE_NO_FUTURE_CONTRIBUTIONS';
  const callModel = input.callModel || (amountToCall > 0
    ? calculateActionEV({ ...input, potBeforeAction, amountToCall, legalActions:['CALL'] }).actions.CALL : null);
  if (callModel?.status === 'MODELED') {
    evCall = callModel.ev;
    const branches = callModel.scenarioBreakdown?.filter(branch => branch.probability > 0);
    if (branches) {
      callMathScope = 'CONDITIONAL_RESPONSE_SCENARIOS';
      potAfterCall = branches.length === 1 ? branches[0].potAtShowdown : null;
      const net = branches.length === 1 ? potAfterCall - branches[0].rake : null;
      potOdds = net > 0 && amountToCall !== null ? amountToCall / net : null;
    } else if (Number.isFinite(callModel.netPot) && callModel.netPot > 0 && amountToCall !== null) {
      potOdds = amountToCall / callModel.netPot;
    }
  } else if (amountToCall === 0 && potBeforeAction !== null) {
    potOdds = 0; // Price only: CHECK is not a hand-strength signal.
  }
  const spr = potBeforeAction > 0 && effectiveStack !== null ? effectiveStack / potBeforeAction : null;
  const heroContribution = read(input.heroContribution, 'heroContribution');
  const maxRaiseTo = effectiveStack === null || potBeforeAction === null || amountToCall === null || heroContribution === null ? null
    : heroContribution + (input.potLimit === false ? effectiveStack : Math.min(effectiveStack, potBeforeAction + 2 * amountToCall));
  return { potBeforeAction, amountToCall, potAfterCall, potOdds, potOddsBeforeCosts, callMathScope, spr, evCall, evFold:0, maxRaiseTo };
}
module.exports = { calculatePotMath };
