'use strict';

const { normalizeGameState } = require('./game-state');
const { resolveOpponentRanges } = require('./range-engine');
const { calculateEquity } = require('./equity-engine');
const { describeHand } = require('./hand-insights');

// Reuse the same card and opponent models without requiring a fictitious pot.
function calculateQuickEquity(input) {
  const checked = normalizeGameState(input);
  if (!checked.valid) return {status:'NO_DECISION',reason:checked.errors[0] || 'Invalid cards.',errors:checked.errors,warnings:checked.warnings};
  const normalized = checked.normalizedInput;
  try {
    const model = resolveOpponentRanges(normalized);
    const equityInput = model.mode === 'KNOWN_HAND'
      ? normalized
      : {...normalized,opponentHands:undefined,opponentRanges:model.ranges};
    const equity = calculateEquity(equityInput);
    // Decision-only warnings about position, stack and betting do not apply to
    // this endpoint. Keep model limitations as assumptions for the disclosure.
    const warnings = [];
    const assumptions = [...model.assumptions,...model.warnings];
    if(normalized.players - 1 !== equity.opponents)
      warnings.push(`Equity calculated against ${equity.opponents} of ${normalized.players - 1} opponents; partial table coverage.`);
    const handInsights=[0,3,4,5].includes(normalized.board.length)?describeHand(normalized.heroCards,normalized.board):null;
    return {status:'OK',scope:'EQUITY_ONLY',equity,ranges:model.publicRanges,assumptions,warnings,handInsights};
  } catch(error) {
    return {status:'NO_DECISION',reason:error.message,warnings:[]};
  }
}

module.exports = { calculateQuickEquity };
