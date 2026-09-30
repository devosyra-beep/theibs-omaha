const { normalizeCards, cardCodes } = require('./cards');

const { VARIANTS, holeCount } = require('./variants');
const VARIANT = 'PLO5_HIGH';
const STREETS = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'];
const POSITIONS = new Set(['UTG', 'UTG1', 'UTG2', 'UTG3', 'EP', 'LJ', 'HJ', 'MP', 'MP1', 'MP2', 'CO', 'BTN', 'SB', 'BB']);
const ACTIONS_WITHOUT_BET = new Set(['CHECK', 'BET']);
const ACTIONS_FACING_BET = new Set(['FOLD', 'CALL', 'RAISE']);

function optionalNumber(value, field, warnings, errors, defaultValue = null) {
  if (value === undefined || value === null || value === '') {
    if (defaultValue !== null) return defaultValue;
    warnings.push(`${field} was not entered.`);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    errors.push(`${field} must be a number greater than or equal to zero.`);
    return null;
  }
  return parsed;
}

function normalizePosition(value, warnings, errors) {
  if (value === undefined || value === null || String(value).trim() === '') {
    warnings.push('Hero position was not entered; position-based strategy is limited.');
    return null;
  }
  const position = String(value).trim().toUpperCase();
  if (!POSITIONS.has(position)) {
    errors.push(`Invalid position: ${value}.`);
    return position;
  }
  return position;
}

function inferStreet(boardLength) {
  return ({ 0: 'PREFLOP', 3: 'FLOP', 4: 'TURN', 5: 'RIVER' })[boardLength];
}

function normalizeStreet(value, boardLength, warnings, errors) {
  const inferred = inferStreet(boardLength);
  if (value === undefined || value === null || String(value).trim() === '') return inferred;
  const street = String(value).trim().toUpperCase();
  if (!STREETS.includes(street)) {
    errors.push(`Invalid street: ${value}.`);
    return inferred;
  }
  if (street !== inferred) {
    errors.push(`Street ${street} is incompatible with ${boardLength} board card(s); expected ${inferred}.`);
  }
  return street;
}

function normalizeActions(value, amountToCall, errors, heroContribution = 0) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    errors.push('availableActions must be a list.');
    return null;
  }
  const actions = [...new Set(value.map((action) => String(action).trim().toUpperCase()))];
  const allowed = amountToCall > 0 ? ACTIONS_FACING_BET : Number(heroContribution) > 0 ? new Set(['CHECK','RAISE']) : ACTIONS_WITHOUT_BET;
  const invalid = actions.filter((action) => !allowed.has(action));
  if (invalid.length > 0) errors.push(`Actions incompatible with the state: ${invalid.join(', ')}.`);
  return actions;
}

function normalizeHistory(value, errors) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push('actionHistory must be a list.');
    return [];
  }
  return value.map((action, index) => {
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      errors.push(`actionHistory[${index}] must be an object.`);
      return null;
    }
    return { ...action };
  }).filter(Boolean);
}

function normalizeGameState(input = {}) {
  const warnings = [];
  const errors = [];
  const variant = input.variant || VARIANT;
  const supported = Object.hasOwn(VARIANTS, variant);
  if (!supported) errors.push(`Unsupported variant: ${variant}.`);
  const count = supported ? holeCount(variant) : 5;
  if (supported) warnings.push(`PLO${count} active. Study recommendations are heuristic and have not been validated against an external strategy reference.`);

  let heroCards = [];
  let board = [];
  try {
    heroCards = normalizeCards(input.heroCards || [], 'heroCards');
    board = normalizeCards(input.board || [], 'board');
  } catch (error) {
    errors.push(error.message);
  }
  if (heroCards.length !== count) errors.push(count === 5 ? 'PLO5 requires exactly five hero hole cards.' : `PLO${count} requires exactly ${count} hero hole cards.`);
  if (![0, 3, 4, 5].includes(board.length)) errors.push('The board must contain 0, 3, 4 or 5 cards.');
  const knownCodes = [...cardCodes(heroCards), ...cardCodes(board)];
  if (new Set(knownCodes).size !== knownCodes.length) errors.push('Duplicate card between the hand and board.');

  const position = normalizePosition(input.position, warnings, errors);
  const players = input.players === undefined || input.players === null || input.players === ''
    ? null
    : Number(input.players);
  if (players !== null && (!Number.isInteger(players) || players < 2 || players > 10)) {
    errors.push('players must be an integer between 2 and 10.');
  }
  if (players === null) warnings.push('Player count was not entered.');
  if(Number.isInteger(players)&&players*count+5>52) errors.push(`PLO${count} allows at most ${Math.floor(47/count)} players (${Math.floor(47/count)-1} opponents) while reserving five board cards.`);

  const hasPot = input.potBeforeAction !== undefined && input.potBeforeAction !== null && input.potBeforeAction !== '';
  const hasAmountToCall = input.amountToCall !== undefined && input.amountToCall !== null && input.amountToCall !== '';
  const potBeforeAction = optionalNumber(input.potBeforeAction, 'potBeforeAction', warnings, errors, 0);
  const amountToCall = optionalNumber(input.amountToCall, 'amountToCall', warnings, errors, 0);
  const effectiveStack = optionalNumber(input.effectiveStack, 'effectiveStack', warnings, errors);
  if(effectiveStack!==null && amountToCall>effectiveStack) errors.push('The amount to call exceeds your stack. Enter the amount actually paid in the all-in; EV with side pots is not yet modeled.');
  if (effectiveStack === null) warnings.push('Effective stack was not entered; actions and SPR may be unavailable.');

  const street = normalizeStreet(input.street, board.length, warnings, errors);
  const availableActions = normalizeActions(input.availableActions, amountToCall || 0, errors, input.heroContribution);
  const actionHistory = normalizeHistory(input.actionHistory, errors);
  const previousAction = input.previousAction === undefined ? null : input.previousAction;
  if (previousAction !== null && typeof previousAction !== 'object') {
    errors.push('previousAction must be an object or null.');
  }

  const opponentModelProvided = (Array.isArray(input.opponentHands) && input.opponentHands.length > 0)
    || (Array.isArray(input.opponentRanges) && input.opponentRanges.length > 0)
    || Boolean(input.opponentRangeProfile) || input.unknownOpponentModel === 'UNIFORM';

  const state = {
    variant,
    holeCardCount: count,
    street,
    heroCards: cardCodes(heroCards),
    board: cardCodes(board),
    position,
    players,
    opponentCount: players === null ? null : players - 1,
    potBeforeAction,
    amountToCall,
    effectiveStack,
    previousAction,
    actionHistory,
    availableActions,
    knownInformation: {
      heroCards: true,
      boardCards: board.length,
      position: position !== null,
      players: players !== null,
      pot: hasPot,
      amountToCall: hasAmountToCall,
      effectiveStack: effectiveStack !== null,
      previousAction: previousAction !== null,
      opponentModel: opponentModelProvided
    },
    unknownInformation: [
      ...(players === null ? ['players'] : []),
      ...(position === null ? ['position'] : []),
      ...(effectiveStack === null ? ['effectiveStack'] : []),
      ...(opponentModelProvided ? [] : ['opponentModel'])
    ]
  };

  return {
    valid: errors.length === 0,
    state,
    errors,
    warnings,
    normalizedInput: {
      ...input,
      variant,
      heroCards: state.heroCards,
      board: state.board,
      position,
      players,
      potBeforeAction,
      amountToCall,
      effectiveStack,
      street,
      previousAction,
      actionHistory,
      ...(availableActions ? { availableActions } : {})
    }
  };
}

module.exports = {
  VARIANT,
  STREETS,
  POSITIONS,
  normalizeGameState,
  inferStreet
};
