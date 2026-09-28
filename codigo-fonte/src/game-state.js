const { normalizeCards, cardCodes } = require('./cards');
const { isMissing, optionalNumber: readNumber } = require('./input-number');

const { VARIANTS, holeCount } = require('./variants');
const VARIANT = 'PLO5_HIGH';
const STREETS = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'];
const POSITIONS = new Set(['UTG', 'UTG1', 'UTG2', 'UTG3', 'EP', 'LJ', 'HJ', 'MP', 'MP1', 'MP2', 'CO', 'BTN', 'SB', 'BB']);
const ACTIONS_WITHOUT_BET = new Set(['CHECK', 'BET']);
const ACTIONS_FACING_BET = new Set(['FOLD', 'CALL', 'RAISE']);

function optionalNumber(value, field, warnings, errors) {
  try {
    const parsed = readNumber(value, field, { nonNegative: true });
    if (parsed === null) warnings.push(`${field} não informado.`);
    return parsed;
  } catch (error) { errors.push(error.message); return null; }
}

function normalizePosition(value, warnings, errors) {
  if (value === undefined || value === null || String(value).trim() === '') {
    warnings.push('Posição do herói não informada; a estratégia por posição fica limitada.');
    return null;
  }
  const position = String(value).trim().toUpperCase();
  if (!POSITIONS.has(position)) {
    errors.push(`Posição inválida: ${value}.`);
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
    errors.push(`Street inválida: ${value}.`);
    return inferred;
  }
  if (street !== inferred) {
    errors.push(`Street ${street} incompatível com ${boardLength} carta(s) no board; esperado ${inferred}.`);
  }
  return street;
}

function normalizeActions(value, amountToCall, errors, heroContribution = 0) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    errors.push('availableActions deve ser uma lista.');
    return null;
  }
  const actions = [...new Set(value.map((action) => String(action).trim().toUpperCase()))];
  const allowed = amountToCall > 0 ? ACTIONS_FACING_BET : Number(heroContribution) > 0 ? new Set(['CHECK','RAISE']) : ACTIONS_WITHOUT_BET;
  const invalid = actions.filter((action) => !allowed.has(action));
  if (invalid.length > 0) errors.push(`Ações incompatíveis com o estado: ${invalid.join(', ')}.`);
  return actions;
}

function normalizeHistory(value, errors) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push('actionHistory deve ser uma lista.');
    return [];
  }
  return value.map((action, index) => {
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      errors.push(`actionHistory[${index}] deve ser um objeto.`);
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
  if (!supported) errors.push(`Variante não suportada: ${variant}.`);
  const count = supported ? holeCount(variant) : 5;
  if (supported) warnings.push(`PLO${count} ativo. Recomendações de estudo são heurísticas; ainda não validadas contra uma referência estratégica externa.`);

  let heroCards = [];
  let board = [];
  let deadCards = [];
  try {
    heroCards = normalizeCards(input.heroCards || [], 'heroCards');
    board = normalizeCards(input.board || [], 'board');
    deadCards = normalizeCards(input.deadCards || [], 'deadCards');
  } catch (error) {
    errors.push(error.message);
  }
  if (heroCards.length !== count) errors.push(count === 5 ? 'PLO5 exige exatamente cinco cartas privadas do herói.' : `PLO${count} exige exatamente ${count} cartas privadas do herói.`);
  if (![0, 3, 4, 5].includes(board.length)) errors.push('O board deve conter 0, 3, 4 ou 5 cartas.');
  const knownCodes = [...cardCodes(heroCards), ...cardCodes(board), ...cardCodes(deadCards)];
  if (new Set(knownCodes).size !== knownCodes.length) errors.push('Carta duplicada entre a mão, o board ou as cartas mortas.');

  const position = normalizePosition(input.position, warnings, errors);
  const players = isMissing(input.players)
    ? null
    : Number(input.players);
  if (players !== null && (!['number','string'].includes(typeof input.players) || !Number.isInteger(players) || players < 2 || players > 10)) {
    errors.push('players deve ser um número inteiro entre 2 e 10.');
  }
  if (players === null) warnings.push('Número de jogadores não informado.');
  if(Number.isInteger(players)&&players*count+5+deadCards.length>52) errors.push(`PLO${count} comporta no máximo ${Math.floor(47/count)} jogadores (${Math.floor(47/count)-1} adversários) reservando cinco cartas para o board.`);

  const hasPot = !isMissing(input.potBeforeAction);
  const hasAmountToCall = !isMissing(input.amountToCall);
  const potBeforeAction = optionalNumber(input.potBeforeAction, 'potBeforeAction', warnings, errors);
  const amountToCall = optionalNumber(input.amountToCall, 'amountToCall', warnings, errors);
  const effectiveStack = optionalNumber(input.effectiveStack, 'effectiveStack', warnings, errors);
  if(effectiveStack!==null && amountToCall!==null && amountToCall>effectiveStack) errors.push('O valor para pagar excede seu stack. Informe o valor efetivamente pago no all-in; EV com potes laterais ainda não está modelado.');
  if (effectiveStack === null) warnings.push('Stack efetivo não informado; ações e SPR podem ficar indisponíveis.');

  const street = normalizeStreet(input.street, board.length, warnings, errors);
  const availableActions = normalizeActions(input.availableActions, amountToCall, errors, input.heroContribution);
  const actionHistory = normalizeHistory(input.actionHistory, errors);
  const previousAction = input.previousAction === undefined ? null : input.previousAction;
  if (previousAction !== null && typeof previousAction !== 'object') {
    errors.push('previousAction deve ser um objeto ou nulo.');
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
    ...(deadCards.length ? { deadCards: cardCodes(deadCards) } : {}),
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
      ...(!hasPot ? ['potBeforeAction'] : []),
      ...(!hasAmountToCall ? ['amountToCall'] : []),
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
