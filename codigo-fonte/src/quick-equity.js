'use strict';

const { normalizeGameState } = require('./game-state');
const { resolveOpponentRanges } = require('./range-engine');
const { calculateEquity } = require('./equity-engine');

// Reuse the same card and opponent models without requiring a fictitious pot.
function calculateQuickEquity(input) {
  const checked = normalizeGameState(input);
  if (!checked.valid) return {status:'NO_DECISION',reason:checked.errors[0] || 'Cartas inválidas.',errors:checked.errors,warnings:checked.warnings};
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
      warnings.push(`Equidade calculada contra ${equity.opponents} de ${normalized.players - 1} adversários; cobertura parcial da mesa.`);
    return {status:'OK',scope:'EQUITY_ONLY',equity,ranges:model.publicRanges,assumptions,warnings};
  } catch(error) {
    return {status:'NO_DECISION',reason:error.message,warnings:[]};
  }
}

module.exports = { calculateQuickEquity };
