function legalActions(input) {
  const amountToCall = Number(input.amountToCall || 0);
  const stack = Number(input.effectiveStack);
  if (!Number.isFinite(amountToCall) || amountToCall < 0) throw new Error('amountToCall must be valid.');
  if (!Number.isFinite(stack) || stack < 0) throw new Error('effectiveStack must be valid.');
  if (stack === 0) return [];
  const candidates = amountToCall > 0 ? ['FOLD', 'CALL', ...(stack > amountToCall ? ['RAISE'] : [])] : ['CHECK', Number(input.heroContribution) > 0 ? 'RAISE' : 'BET'];
  if (Array.isArray(input.availableActions)) return candidates.filter((action) => input.availableActions.includes(action));
  return candidates;
}

function validateRaise(input, raiseTo) {
  const actions = legalActions(input);
  if (!actions.includes('RAISE')) return { valid: false, reason: 'RAISE is not currently legal.' };
  const amount = Number(raiseTo);
  const minRaiseTo = Number(input.minRaiseTo || (Number(input.amountToCall || 0) * 2));
  const maxRaiseTo = Number(input.maxRaiseTo || (Number(input.effectiveStack) * 1));
  if (!Number.isFinite(amount) || amount < minRaiseTo || amount > maxRaiseTo) {
    return { valid: false, reason: `RAISE must be between ${minRaiseTo} and ${maxRaiseTo}.` };
  }
  return { valid: true, minRaiseTo, maxRaiseTo };
}

module.exports = { legalActions, validateRaise };
