'use strict';
const { replay, POSITIONS } = require('./hand-flow');
const { normalizeCards, cardCodes } = require('./cards');
const { holeCount } = require('./variants');
const { evaluateStrategy } = require('./strategy-engine');
const { applyExploit } = require('./exploit-engine');
const { hasOverrides, prepareOpponentOverrides } = require('./opponent-overrides');

const SOURCE = 'USER_OBSERVED_ACTIONS';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const MAX_PLAYERS = { PLO4_HIGH: 10, PLO5_HIGH: 6, PLO6_HIGH: 5 };

function canonicalConfig(raw) {
  if (!object(raw)) throw Error('Enter the Multiway table configuration.');
  const variant = raw.variant || 'PLO5_HIGH', count = holeCount(variant), playerCount = Number(raw.playerCount);
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > MAX_PLAYERS[variant]) {
    throw Error(`Multiway PLO${count} accepts 2 to ${MAX_PLAYERS[variant]} total players.`);
  }
  const heroPosition = String(raw.heroPosition || '').toUpperCase();
  if (!(POSITIONS[playerCount].includes(heroPosition) || (playerCount === 2 && heroPosition === 'BTN'))) throw Error('Hero position is incompatible with this table.');
  const heroCards = cardCodes(normalizeCards(raw.heroCards || []));
  if (heroCards.length && heroCards.length !== count) throw Error(`Enter all ${count} hole cards or leave the hand empty until complete.`);
  if (raw.stacks !== undefined && (!Array.isArray(raw.stacks) || raw.stacks.length !== playerCount)) throw Error('Enter a stack for each seat.');
  return { variant, playerCount, heroPosition, startingStack: raw.startingStack,
    smallBlind: raw.smallBlind, bigBlind: raw.bigBlind, heroCards,
    ...(raw.stacks ? { stacks: [...raw.stacks] } : {}) };
}

function canonicalEvent(raw) {
  if (!object(raw)) throw Error('Invalid Multiway event.');
  if (raw.type === 'BOARD') return { type: 'BOARD', cards: cardCodes(normalizeCards(raw.cards || [])) };
  if (raw.type === 'SETTLE') {
    if (!Array.isArray(raw.winners)) throw Error('Enter the winners of each pot.');
    return { type: 'SETTLE', winners: raw.winners.map(ids => {
      if (!Array.isArray(ids) || ids.some(id => !Number.isInteger(id))) throw Error('Invalid winning seats.');
      return [...ids];
    }), rake: raw.rake ?? 0 };
  }
  if (!['ACT', 'MARK_FOLD'].includes(raw.type) || !Number.isInteger(raw.actor)) throw Error('Invalid Multiway event or seat.');
  if (raw.type === 'MARK_FOLD') return { type: 'MARK_FOLD', actor: raw.actor };
  const action = String(raw.action || '').toUpperCase();
  if (!['FOLD', 'CALL', 'CHECK', 'BET', 'RAISE'].includes(action)) throw Error('Invalid Multiway action.');
  return { type: 'ACT', actor: raw.actor, action, ...(['BET', 'RAISE'].includes(action) ? { to: raw.to } : {}) };
}

function validateRecord(raw) {
  if (!object(raw) || raw.schemaVersion !== 1 || typeof raw.enabled !== 'boolean') throw Error('Invalid Multiway record.');
  if (!Array.isArray(raw.events) || raw.events.length > 500) throw Error('Multiway accepts up to 500 events per hand.');
  const record = { schemaVersion: 1, enabled: raw.enabled, config: canonicalConfig(raw.config), events: raw.events.map(canonicalEvent) };
  replay(record.config, record.events);
  return record;
}

function envelope(raw) {
  const multiway = validateRecord(raw), state = replay(multiway.config, multiway.events);
  const hero = state.players[state.heroId], opponents = state.players.filter(player => !player.hero && !player.folded);
  const reasons = [], warn = (code, message) => reasons.push({ code, message });
  if (!multiway.enabled) warn('DISABLED', 'Multiway mode is off.');
  if (state.phase === 'WAIT_BOARD') warn('WAIT_BOARD', 'The betting round ended. Enter the next street’s cards.');
  else if (state.phase === 'SHOWDOWN') warn('SHOWDOWN', 'The hand is at showdown; enter the pot results.');
  else if (state.phase === 'FINISHED') warn('FINISHED', 'The hand is complete. Start another table to analyze.');
  else if (state.actor !== state.heroId) warn('NOT_HERO_TURN', 'Record the current player’s action before analyzing your decision.');
  if (hero.folded) warn('HERO_FOLDED', 'You folded this hand.');
  if (state.hasSidePots) warn('SIDE_POTS_UNSUPPORTED', 'Side pots are recorded, but their EV is not yet calculated.');
  if (state.players.some(player => !player.folded && player.stack === 0)) warn('ALL_IN_UNSUPPORTED', 'An active player is all-in; the simplified calculation is blocked.');
  if (state.phase === 'BETTING' && state.actor === state.heroId && state.heroToCall > 0 && state.heroToCall >= hero.stack) {
    warn('CALL_REACHES_ALL_IN', 'Calling puts you all-in; the simplified calculation is blocked.');
  }
  if (multiway.config.heroCards.length !== holeCount(multiway.config.variant)) warn('HERO_CARDS_INCOMPLETE', 'Complete your hole cards before analyzing.');
  const availableActions = state.actor === state.heroId ? state.legal.actions.filter(action => action !== 'FOLD' || state.heroToCall > 0) : [];
  const input = { variant: multiway.config.variant, heroCards: [...multiway.config.heroCards], board: [...state.board],
    street: state.street, position: multiway.config.playerCount === 2 && multiway.config.heroPosition === 'BTN' ? 'BTN' : hero.position,
    players: state.activePlayers, potBeforeAction: state.pot, amountToCall: state.heroToCall,
    effectiveStack: hero.stack, heroContribution: hero.streetPaid,
    availableActions, minRaiseTo: state.legal.minTo, maxRaiseTo: state.legal.maxTo, minBet: state.bigBlind, bigBlind: state.bigBlind,
    actionHistory: state.log, sidePots: state.hasSidePots };
  const warnings = ['Actions and contributions were entered by the user. They do not determine opponent cards or response frequencies.'];
  if (multiway.events.some(event => event.type === 'MARK_FOLD')) warnings.push('An out-of-turn fold was recorded: the observed history is partial; no intervening action was invented.');
  return { status: 'OK', multiway, state: { ...state, revision: multiway.events.length, source: SOURCE },
    analysis: { available: reasons.length === 0, reasons, input, source: SOURCE,
      activeOpponentIds: opponents.map(player => player.id), warnings } };
}

function start(config) { return envelope({ schemaVersion: 1, enabled: true, config, events: [] }); }
function step(raw, rawEvent, expectedRevision) {
  const record = validateRecord(raw);
  if (expectedRevision !== undefined && expectedRevision !== record.events.length) {
    const error = Error('Multiway revision changed; refresh the state before recording.'); error.statusCode = 409; throw error;
  }
  if (!record.enabled) throw Error('Turn on Multiway to record actions.');
  return envelope({ ...record, events: [...record.events, canonicalEvent(rawEvent)] });
}

function sameSeats(ids, expected) {
  return Array.isArray(ids) && ids.every(Number.isInteger) && new Set(ids).size === ids.length &&
    ids.length === expected.length && [...ids].sort((a, b) => a - b).every((id, index) => id === [...expected].sort((a, b) => a - b)[index]);
}

function prepareAnalysis(raw, supplied) {
  const observed = envelope(raw), { state } = observed, reasons = [...observed.analysis.reasons];
  if(hasOverrides(supplied)&&observed.analysis.available)supplied=prepareOpponentOverrides({...supplied,...observed.analysis.input},{observed:true,
    seats:state.players.filter(player=>!player.hero&&!player.folded).map(player=>({seatId:player.id,contribution:player.streetPaid,stackRemaining:player.stack}))});
  const input = { ...supplied, ...observed.analysis.input }, blockedActions = {}, warnings = [...observed.analysis.warnings];
  if (supplied.futureStreetModel?.type === 'SHOWDOWN_ONLY') {
    // With no future bets there are no new contributions. A manual what-if
    // pot cannot overwrite the observed ledger under this model.
    input.futureStreetModel = { type: 'SHOWDOWN_ONLY', potAtShowdown: state.pot };
  }
  const hero = state.players[state.heroId], opponents = state.players.filter(player => !player.hero && !player.folded);
  const activeIds = opponents.map(player => player.id);
  const hasSpecific = supplied.opponentHands?.length || supplied.opponentRanges?.length || supplied.opponentRangeProfile;
  if (hasSpecific) {
    const modelCount = supplied.opponentHands?.length || supplied.opponentRanges?.length || 1;
    if (!sameSeats(supplied.opponentSeatIds, activeIds) || supplied.opponentSeatIds.length !== modelCount) {
      reasons.push({ code: 'RANGE_SEAT_MAPPING_REQUIRED', message: 'Assign hands/ranges to active opponent IDs; the previous model cannot transfer after a fold.' });
    }
  }
  // Unscoped scalar response assumptions could silently transfer to a different
  // opponent after a fold. Only seat-bound response models are accepted here.
  delete input.foldEquity; delete input.continuationEquity; delete input.opponentResponseModel;
  input.actionResponseModels = {};
  for (const [action, model] of Object.entries(supplied.actionResponseModels || {})) {
    if (!sameSeats(model?.opponents?.map(player => player.seatId), activeIds)) {
      blockedActions[action] = 'The response model does not identify exactly the active opponent seats.';
      continue;
    }
    input.actionResponseModels[action] = { ...model, heroContribution: hero.streetPaid, minRaiseTo: state.legal.minTo,
      opponents: model.opponents.map(player => ({ ...player, contribution: state.players[player.seatId].streetPaid,
        stackRemaining: state.players[player.seatId].stack })) };
  }
  let studyValid = false;
  if (supplied.aggressionStudy?.enabled) {
    const rawStudy = supplied.aggressionStudy, action = state.heroToCall + hero.streetPaid > 0 ? 'RAISE' : 'BET';
    if (!sameSeats(rawStudy.opponents?.map(player => player.seatId), activeIds)) {
      blockedActions[action] = 'Response probabilities must identify each active seat; no association by index was assumed.';
      delete input.aggressionStudy;
    } else {
      const target = Number(action === 'RAISE' ? input.raiseTo : input.betSize);
      if (Number.isFinite(target) && opponents.some(player => target - player.streetPaid > player.stack + 1e-8)) {
        blockedActions[action] = 'The proposed size requires a partial payment or side pot; this simplified scenario does not cover that situation.';
        delete input.aggressionStudy;
      } else {
        const bySeat = new Map(rawStudy.opponents.map(player => [player.seatId, player]));
        input.aggressionStudy = { ...rawStudy, heroContribution: hero.streetPaid, minRaiseTo: state.legal.minTo, minBet: state.bigBlind,
          opponents: opponents.map(player => ({ ...bySeat.get(player.id), contribution: player.streetPaid })) };
        studyValid = true;
      }
    }
  }
  const unmatched = opponents.filter(player => player.streetPaid + 1e-8 < state.currentBet);
  if (state.heroToCall > 0 && unmatched.length && !studyValid && !input.actionResponseModels.CALL) {
    blockedActions.CALL = `Responses are not modeled for seats ${unmatched.map(player => player.position).join(', ')} that still owe chips; calling or folding was not assumed.`;
  }
  for (const [action, reason] of Object.entries(blockedActions)) warnings.push(`${action}: ${reason}`);
  return { observed, input, blockedActions, warnings, available: reasons.length === 0, reasons };
}

function blockedResult(prepared) {
  return { status: 'NO_DECISION', contractVersion: 'THEIBS_DECISION_V1',
    reason: prepared.reasons.map(item => item.message).join(' '), reasonCodes: prepared.reasons.map(item => item.code),
    state: prepared.observed.analysis.input, observedState: prepared.observed.state,
    observedSource: SOURCE, warnings: prepared.warnings };
}

function guardResult(result, prepared) {
  result.observedState = prepared.observed.state;
  result.observedSource = SOURCE;
  result.observedOpponentIds = prepared.observed.analysis.activeOpponentIds;
  result.warnings = [...new Set([...(result.warnings || []), ...prepared.warnings])];
  if (result.status !== 'OK' || !Object.keys(prepared.blockedActions).length) return result;
  for (const [action, reason] of Object.entries(prepared.blockedActions)) if (result.legalActions.includes(action)) {
    result.ev.actions[action] = { action, legal: true, status: 'NOT_MODELED', ev: null, model: null,
      missingInputs: [reason], assumptions: [], warnings: [reason] };
  }
  const modeled = result.legalActions.map(action => result.ev.actions[action]).filter(item => item.status === 'MODELED' && Number.isFinite(item.ev));
  modeled.sort((a, b) => b.ev - a.ev);
  result.ev.missingLegalActions = result.legalActions.filter(action => result.ev.actions[action].status !== 'MODELED');
  result.ev.comparisonComplete = result.ev.missingLegalActions.length === 0;
  result.ev.bestModeledAction = modeled[0]?.action || null;
  result.ev.positiveEvAction = modeled.find(item => item.ev > 0)?.action || null;
  result.ev.status = modeled.length ? 'MODELED' : 'NOT_MODELED';
  result.ev.confidence = 'LOW';
  const baseline = evaluateStrategy({ input: prepared.input, equity: result.equity, potMath: result.potMath,
    ev: result.ev, legalActions: result.legalActions, state: result.state });
  const exploit = applyExploit({ input: prepared.input, baseline, equity: result.equity, ev: result.ev, legalActions: result.legalActions });
  result.strategy = { baseline, exploit, finalAction: exploit.finalAction, finalSource: exploit.finalSource,
    confidence: exploit.confidence, conflicts: exploit.conflicts, warnings: [...new Set([...baseline.warnings, ...exploit.warnings])] };
  result.baselineAction = baseline.action;
  result.recommendedAction = exploit.finalAction;
  if (modeled.length === 1 && modeled[0].action === 'FOLD' && result.ev.missingLegalActions.includes('CALL')) {
    // Fold's zero is a reference point, not evidence to recommend abandoning a
    // hand when no continuing action has been modeled at all.
    result.recommendedAction = 'NO_DECISION';
    result.strategy.finalAction = 'NO_DECISION';
    result.strategy.exploit.finalAction = 'NO_DECISION';
  }
  result.confidence = exploit.confidence;
  result.potMath.evCall = result.ev.actions.CALL.status === 'MODELED' ? result.ev.actions.CALL.ev : null;
  result.reason = result.ev.comparisonComplete ? result.reason : `Partial comparison: ${result.ev.missingLegalActions.join(', ')} remain unavailable because the necessary responses were not modeled. ${modeled.length ? 'The leader among calculated actions does not establish the best overall play.' : 'No action can be recommended.'}`;
  result.warnings = [...new Set([...result.warnings, ...baseline.warnings, ...exploit.warnings])];
  return result;
}

module.exports = { SOURCE, validateRecord, envelope, start, step, prepareAnalysis, blockedResult, guardResult };
