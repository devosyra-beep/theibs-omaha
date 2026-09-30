'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { replay, POSITIONS } = require('./hand-flow');
const { normalizeCards, cardCodes } = require('./cards');
const { holeCount } = require('./variants');
const { evaluateStrategy } = require('./strategy-engine');
const { applyExploit } = require('./exploit-engine');
const { hasOverrides, prepareOpponentOverrides } = require('./opponent-overrides');
const { enrichActionEV } = require('./action-ev-presentation');

const SOURCE = 'USER_OBSERVED_ACTIONS';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const MAX_PLAYERS = { PLO4_HIGH: 10, PLO5_HIGH: 6, PLO6_HIGH: 5 };
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[\w.:-]+$/.test(value);
const playerIdentity = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !['__proto__','constructor','prototype'].includes(value);

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
  let players;
  if (raw.players !== undefined) {
    if (!Array.isArray(raw.players) || raw.players.length !== playerCount) throw Error('Identify every player at the table.');
    players = raw.players.map(player => {
      if (!object(player) || !playerIdentity(player.playerId)) throw Error('Invalid player identity.');
      const name = String(player.name ?? '').trim();
      if (!name || name.length > 80 || /[\u0000-\u001f]/.test(name)) throw Error('Use a player name with 1 to 80 characters.');
      return {playerId:player.playerId,name};
    });
    if (new Set(players.map(player=>player.playerId)).size !== players.length) throw Error('The same player cannot occupy two seats.');
  }
  return { variant, playerCount, heroPosition, startingStack: raw.startingStack,
    smallBlind: raw.smallBlind, bigBlind: raw.bigBlind, heroCards,
    ...(raw.stacks ? { stacks: [...raw.stacks] } : {}), ...(players ? {players} : {}) };
}

function canonicalEvent(raw) {
  if (!object(raw)) throw Error('Invalid Multiway event.');
  const metadata = {};
  for (const key of ['eventId','originEventId']) if (raw[key] !== undefined) {
    if (!identity(raw[key])) throw Error('Invalid Multiway event identity.');
    metadata[key] = raw[key];
  }
  if (raw.type === 'BOARD') return { type: 'BOARD', cards: cardCodes(normalizeCards(raw.cards || [])), ...metadata };
  if (raw.type === 'REVEAL') {
    if (!Number.isInteger(raw.actor)) throw Error('Invalid shown-card seat.');
    return {type:'REVEAL',actor:raw.actor,cards:cardCodes(normalizeCards(raw.cards || [])),...metadata};
  }
  if (raw.type === 'SKIP_RESULT') return {type:'SKIP_RESULT',...metadata};
  if (raw.type === 'SETTLE') {
    if (!Array.isArray(raw.winners)) throw Error('Enter the winners of each pot.');
    return { type: 'SETTLE', winners: raw.winners.map(ids => {
      if (!Array.isArray(ids) || ids.some(id => !Number.isInteger(id))) throw Error('Invalid winning seats.');
      return [...ids];
    }), rake: raw.rake ?? 0, ...metadata };
  }
  if (!['ACT', 'MARK_FOLD'].includes(raw.type) || !Number.isInteger(raw.actor)) throw Error('Invalid Multiway event or seat.');
  if (raw.type === 'MARK_FOLD') return { type: 'MARK_FOLD', actor: raw.actor, ...metadata };
  const action = String(raw.action || '').toUpperCase();
  if (!['FOLD', 'CALL', 'CHECK', 'BET', 'RAISE'].includes(action)) throw Error('Invalid Multiway action.');
  return { type: 'ACT', actor: raw.actor, action, ...(['BET', 'RAISE'].includes(action) ? { to: raw.to } : {}), ...metadata };
}

function validateRecord(raw) {
  if (!object(raw) || raw.schemaVersion !== 1 || typeof raw.enabled !== 'boolean') throw Error('Invalid Multiway record.');
  if (!Array.isArray(raw.events) || raw.events.length > 500) throw Error('Multiway accepts up to 500 events per hand.');
  // Older saved workspaces have neither field. Keep them readable, then give
  // the hand an identity when it is next changed.
  if (raw.handId !== undefined && (typeof raw.handId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.handId))) throw Error('Invalid Multiway hand identity.');
  if (raw.editEpoch !== undefined && (!Number.isSafeInteger(raw.editEpoch) || raw.editEpoch < 0)) throw Error('Invalid Multiway edit epoch.');
  const record = { schemaVersion: 1, enabled: raw.enabled, config: canonicalConfig(raw.config), events: raw.events.map(canonicalEvent),
    ...(raw.handId ? { handId: raw.handId } : {}), ...(raw.editEpoch !== undefined ? { editEpoch: raw.editEpoch } : {}) };
  for (const key of ['eventId','originEventId']) {
    const ids=record.events.map(event=>event[key]).filter(Boolean);
    if (new Set(ids).size !== ids.length) throw Error('A confirmed event identity cannot be recorded twice.');
  }
  replay(record.config, record.events);
  return record;
}

function revisionKey(record) {
  return createHash('sha256').update(JSON.stringify({ handId: record.handId || null, editEpoch: record.editEpoch || 0,
    enabled: record.enabled, config: record.config, events: record.events })).digest('hex');
}

function requireRevision(record, expectedRevision, expectedRevisionKey) {
  if ((expectedRevision !== undefined && expectedRevision !== record.events.length) ||
      (expectedRevisionKey !== undefined && expectedRevisionKey !== revisionKey(record))) {
    const error = Error('Multiway revision changed; refresh the state before recording.'); error.statusCode = 409; throw error;
  }
}

function envelope(raw) {
  const multiway = validateRecord(raw), state = replay(multiway.config, multiway.events);
  const hero = state.players[state.heroId], opponents = state.players.filter(player => !player.hero && !player.folded);
  const reasons = [], warn = (code, message) => reasons.push({ code, message });
  if (!multiway.enabled) warn('DISABLED', 'Multiway mode is off.');
  if (state.phase === 'WAIT_BOARD') warn('WAIT_BOARD', 'The betting round ended. Enter the next street’s cards.');
  else if (state.phase === 'SHOWDOWN') warn('SHOWDOWN', 'The hand is at showdown; enter the pot results.');
  else if (state.phase === 'FINISHED') warn('FINISHED', state.result?.reason === 'UNKNOWN' ? 'Result pending. Confirm the pot result or reconcile stacks before the next hand.' : 'The hand is complete. Start the next hand to continue.');
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
  const continuationReasons = reasons.filter(item=>!['SIDE_POTS_UNSUPPORTED','ALL_IN_UNSUPPORTED','CALL_REACHES_ALL_IN'].includes(item.code));
  return { status: 'OK', multiway, state: { ...state, revision: multiway.events.length,
    revisionKey: revisionKey(multiway), handId: multiway.handId || null, source: SOURCE },
    analysis: { available: reasons.length === 0, reasons, input, source: SOURCE,
      activeOpponentIds: opponents.map(player => player.id), warnings },
    continuationAnalysis: { available: continuationReasons.length === 0, reasons: continuationReasons,
      input, source: SOURCE, activeOpponentIds: opponents.map(player=>player.id), warnings } };
}

function identifyPlayers(config) {
  if (config.players) return config;
  const state = replay(config, []);
  return {...config, players:state.players.map(player=>({playerId:randomUUID(),name:player.name}))};
}
function start(config) { return envelope({ schemaVersion: 1, enabled: true, config:identifyPlayers(canonicalConfig(config)), events: [], handId: randomUUID(), editEpoch: 0 }); }
function eventContent(event) {
  const {eventId,originEventId,...content}=event;
  return JSON.stringify(content);
}
function step(raw, rawEvent, expectedRevision, expectedRevisionKey) {
  const record = validateRecord(raw);
  const event = canonicalEvent(rawEvent);
  const duplicate = record.events.find(existing=>['eventId','originEventId'].some(key=>event[key] && event[key]===existing[key]));
  if (duplicate) {
    if (eventContent(duplicate)!==eventContent(event)) throw Error('This event identity was already used for a different observation.');
    return {...envelope(record),duplicate:true};
  }
  requireRevision(record, expectedRevision, expectedRevisionKey);
  if (!record.enabled) throw Error('Turn on Multiway to record actions.');
  return envelope({ ...record, config:identifyPlayers(record.config), handId: record.handId || randomUUID(), editEpoch: record.editEpoch || 0,
    events: [...record.events, {...event,eventId:event.eventId || randomUUID()}] });
}

function sequenceConflict(message) {
  const error = Error(message); error.statusCode = 409; return error;
}

function sequenceCommands(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 6) throw Error('Use one to six complete actions in a sequence.');
  return raw.map(command => {
    if (!object(command) || command.type !== 'action' || Object.keys(command).some(key => !['type','actor','action','to','by','unit'].includes(key)) ||
        !['FOLD','CHECK','CALL','BET','RAISE','ALL_IN'].includes(command.action)) throw Error('Invalid action sequence command.');
    let actor = null;
    if (command.actor != null) {
      if (!object(command.actor)) throw Error('Invalid action sequence player.');
      if (command.actor.kind === 'hero' && Object.keys(command.actor).length === 1) actor = {kind:'hero'};
      else if (command.actor.kind === 'opponent' && Number.isInteger(command.actor.number) && command.actor.number >= 1 && command.actor.number <= 9 &&
          Object.keys(command.actor).every(key => ['kind','number'].includes(key))) actor = {kind:'opponent',number:command.actor.number};
      else throw Error('Invalid action sequence player.');
    }
    const aggressive = ['BET','RAISE'].includes(command.action), hasTo = command.to !== undefined, hasBy = command.by !== undefined;
    if (aggressive ? hasTo === hasBy : hasTo || hasBy || command.unit !== undefined) throw Error('Use one complete total or raise increment for each bet.');
    if (hasBy && command.action !== 'RAISE') throw Error('Only a raise accepts an increment.');
    if (command.unit !== undefined && !['bb','chips'].includes(command.unit)) throw Error('Use chips or BB for action amounts.');
    const amount = hasTo ? command.to : command.by;
    if (aggressive && (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 10000000 ||
        Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7)) throw Error('Use a positive amount with at most two decimal places.');
    return {type:'action',actor,action:command.action,...(hasTo ? {to:command.to} : hasBy ? {by:command.by} : {}),
      ...(command.unit === undefined ? {} : {unit:command.unit})};
  });
}

function sequenceDigest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function sequenceUuid(value) {
  const digest = sequenceDigest(value);
  return `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
}

// Dry replay and commit share the exact same validation. The caller receives
// nothing to apply until every action before the next decision boundary passes.
function prepareSequence(raw, rawCommands, options = {}) {
  if (!object(options) || typeof options.expectedRevisionKey !== 'string') throw sequenceConflict('Refresh the hand before preparing an action sequence.');
  const original = validateRecord(raw), initialKey = revisionKey(original);
  requireRevision(original, undefined, options.expectedRevisionKey);
  if (!original.enabled) throw Error('Turn on Multiway to record actions.');
  const origin = options.originEventId;
  if (!identity(origin) || origin.length > 124) throw Error('A source event identifier with at most 124 characters is required.');
  const commands = sequenceCommands(rawCommands);
  if (original.events.some(event => event.originEventId === origin || event.originEventId?.startsWith(`${origin}:`))) {
    throw sequenceConflict('This source event was already recorded. Review the current hand before continuing.');
  }
  // Legacy records get deterministic identities so preview and commit agree.
  const legacyPlayers = replay(original.config, []).players;
  const record = {...original,handId:original.handId || sequenceUuid(['hand',initialKey,origin]),editEpoch:original.editEpoch || 0,
    config:{...original.config,players:original.config.players || legacyPlayers.map(player => ({
      playerId:sequenceUuid(['player',initialKey,player.id]),name:player.name}))}};
  const {resolveAction} = require('../public/card-voice');
  let current = envelope(record), stopReason = 'COMPLETE';
  const events = [];
  for (let index = 0; index < commands.length; index++) {
    if (current.state.phase !== 'BETTING') { stopReason = current.state.phase; break; }
    if (current.state.actor === current.state.heroId) { stopReason = 'HERO_TURN'; break; }
    const event = {type:'ACT',...resolveAction(commands[index],current.state),
      originEventId:`${origin}:${index}`,eventId:`seq:${sequenceDigest([record.handId,origin,index])}`};
    current = step(current.multiway,event,current.state.revision,current.state.revisionKey);
    if (current.duplicate) throw sequenceConflict('This sequence event was already recorded.');
    events.push(event);
  }
  const preview = {status:'PROPOSED',revisionKey:initialKey,
    previewKey:sequenceDigest({revisionKey:initialKey,originEventId:origin,commands,events,stopReason}),
    originEventId:origin,events,appliedCount:events.length,remainingCommands:commands.slice(events.length),stopReason,
    previewState:current.state};
  return {preview,current};
}

function previewSequence(raw, commands, options) { return prepareSequence(raw,commands,options).preview; }
function batch(raw, commands, options = {}) {
  const {preview,current} = prepareSequence(raw,commands,options);
  if (typeof options.expectedPreviewKey !== 'string' || options.expectedPreviewKey !== preview.previewKey) {
    throw sequenceConflict('The sequence preview changed. Review it before recording.');
  }
  const {previewState,...sequence} = preview;
  // A boundary-only preview must not upgrade or alter even a legacy record.
  return {...(preview.appliedCount ? current : envelope(raw)),sequence};
}

function undo(raw, expectedRevisionKey) {
  const record = validateRecord(raw);
  requireRevision(record, undefined, expectedRevisionKey);
  if (!record.events.length) throw Error('There is no confirmed event to undo.');
  return envelope({ ...record, handId: record.handId || randomUUID(), editEpoch: (record.editEpoch || 0) + 1,
    events: record.events.slice(0, -1) });
}

function sameSeats(ids, expected) {
  return Array.isArray(ids) && ids.every(Number.isInteger) && new Set(ids).size === ids.length &&
    ids.length === expected.length && [...ids].sort((a, b) => a - b).every((id, index) => id === [...expected].sort((a, b) => a - b)[index]);
}

function prepareAnalysis(raw, supplied) {
  const observed = envelope(raw), { state } = observed, reasons = [...observed.analysis.reasons];
  if(hasOverrides(supplied)&&observed.analysis.available)supplied=prepareOpponentOverrides({...supplied,...observed.analysis.input},{observed:true,
    seats:state.players.filter(player=>!player.hero&&!player.folded).map(player=>({seatId:player.id,contribution:player.streetPaid,stackRemaining:player.stack}))});
  const input = { ...supplied, ...observed.analysis.input, multiwayComparison: true }, blockedActions = {}, warnings = [...observed.analysis.warnings];
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
  const scopedSeats = new Map((input.opponentModelScope?.seats || []).map(seat => [String(seat.seatId), seat]));
  const opponentHypotheses = opponents.map(player => {
    const scope = scopedSeats.get(String(player.id));
    const responses = Object.entries(input.actionResponseModels || {}).filter(([, model]) =>
      model.opponents?.some(opponent => String(opponent.seatId) === String(player.id)))
      .map(([action, model]) => ({ action, model: model.type, origin: model.source }));
    if (input.aggressionStudy?.enabled && input.aggressionStudy.opponents?.some(opponent => String(opponent.seatId) === String(player.id))) {
      responses.push({ action: state.heroToCall ? 'RAISE' : 'BET', model: 'INDEPENDENT_CALL_STUDY',
        origin: input.aggressionStudy.source || 'USER_SUPPLIED_HYPOTHESIS' });
    }
    return { playerId: player.id, seat: player.seatName, position: player.position,
      situation: { street: state.street, currentBet: state.currentBet, streetContribution: player.streetPaid,
        toCall: Math.max(0, state.currentBet - player.streetPaid), stackRemaining: player.stack },
      cards: { model: scope?.cardsModel || 'UNIFORM_UNKNOWN', origin: scope?.cardsSource || 'UNIFORM_UNKNOWN' },
      responses: responses.length ? responses : [{ action: null, model: scope?.responseModel || 'UNKNOWN',
        origin: scope?.responseSource || 'UNKNOWN' }] };
  });
  return { observed, input, blockedActions, warnings, opponentHypotheses, available: reasons.length === 0, reasons };
}

function nextHand(raw, options = {}, expectedRevisionKey) {
  const previous = envelope(raw), {state} = previous;
  requireRevision(previous.multiway, undefined, expectedRevisionKey);
  if (state.phase !== 'FINISHED') throw Error('Finish the current hand before starting the next one.');
  if (!object(options)) throw Error('Invalid next-hand configuration.');
  const cfg = identifyPlayers(previous.multiway.config), overrides = object(options.config) ? options.config : {};
  if (overrides.variant && overrides.variant !== cfg.variant) throw Error('Keep the current variant when continuing this table.');
  let stacks = state.players.map(player=>player.stack);
  if (options.stacks !== undefined) {
    if (!Array.isArray(options.stacks) || options.stacks.length !== state.players.length || options.stacks.some(value=>
      typeof value !== 'number' || !Number.isFinite(value) || value<0 || value>10000000 || Math.abs(value*100-Math.round(value*100))>0.00001)) throw Error('Confirm a non-negative stack with up to two decimals for every current seat.');
    stacks = [...options.stacks];
  } else if (state.result?.reason === 'UNKNOWN') {
    const error = Error('The previous pot result is unknown. Confirm every remaining stack before starting the next hand.');
    error.code = 'STACKS_UNRECONCILED'; error.statusCode = 409; throw error;
  }
  const eligible = state.players.filter(player=>stacks[player.id]>0).map(player=>player.id);
  if (!eligible.includes(state.heroId)) throw Error('Confirm a positive Hero stack before continuing this table.');
  if (eligible.length < 2) throw Error('At least two players need positive stacks to start the next hand.');
  if (overrides.playerCount !== undefined && Number(overrides.playerCount) !== eligible.length) throw Error('Continue with the eligible players; changing the roster requires an explicit new table.');
  // Advance the button in physical order, skipping empty stacks. Position IDs
  // are rebuilt; persistent player identities and Hero-relative seats are not.
  const nextButton = Array.from({length:state.players.length},(_,index)=>(state.buttonId+index+1)%state.players.length).find(id=>eligible.includes(id));
  const aroundButton = Array.from({length:state.players.length},(_,index)=>(nextButton+index+1)%state.players.length).filter(id=>eligible.includes(id));
  let order = eligible.length === 2 ? [nextButton,aroundButton[0]] : aroundButton;
  if (overrides.heroPosition !== undefined) {
    const position = eligible.length===2 && overrides.heroPosition==='BTN' ? 'SB' : overrides.heroPosition;
    const desired = POSITIONS[eligible.length].indexOf(position);
    if (desired<0) throw Error('Hero position is incompatible with the next hand.');
    const shift=(order.indexOf(state.heroId)-desired+order.length)%order.length;
    order=order.slice(shift).concat(order.slice(0,shift));
  }
  const nextConfig = {...cfg,heroCards:[],playerCount:order.length,heroPosition:POSITIONS[order.length][order.indexOf(state.heroId)],
    smallBlind:overrides.smallBlind ?? cfg.smallBlind,bigBlind:overrides.bigBlind ?? cfg.bigBlind,
    players:order.map(id=>({...cfg.players[id]})),stacks:order.map(id=>stacks[id])};
  const result = start(nextConfig);
  const archived = envelope({...previous.multiway,config:cfg});
  result.archivedHand = {multiway:archived.multiway,state:archived.state,
    reconciliation:{source:options.stacks ? 'USER_CONFIRMED_STACKS' : state.result?.reason === 'ALL_FOLDED'
      ? 'UNCONTESTED_POT_BEFORE_UNRECORDED_RAKE' : 'CONFIRMED_POT_RESULT',
      // Model rake is an assumption for EV, never an observation of money
      // taken from this hand. Corrected balances alone do not identify rake.
      rakeObserved:archived.multiway.events.some(event=>event.type==='SETTLE'),
      stacks:state.players.map(player=>({playerId:cfg.players[player.id].playerId,stack:stacks[player.id]})),
      resultPending:state.result?.reason==='UNKNOWN'}};
  return result;
}

function blockedResult(prepared) {
  return { status: 'NO_DECISION', contractVersion: 'THEIBS_DECISION_V1',
    reason: prepared.reasons.map(item => item.message).join(' '), reasonCodes: prepared.reasons.map(item => item.code),
    state: prepared.observed.analysis.input, observedState: prepared.observed.state,
    observedSource: SOURCE, opponentHypotheses: prepared.opponentHypotheses, warnings: prepared.warnings };
}

function guardResult(result, prepared) {
  result.observedState = prepared.observed.state;
  result.observedSource = SOURCE;
  result.observedOpponentIds = prepared.observed.analysis.activeOpponentIds;
  result.opponentHypotheses = prepared.opponentHypotheses;
  result.warnings = [...new Set([...(result.warnings || []), ...prepared.warnings])];
  if (result.status !== 'OK') return result;
  if (!Object.keys(prepared.blockedActions).length) {
    enrichActionEV(result.ev, { ...prepared.input, legalActions: result.legalActions }, result.equity);
    if (!result.ev.globalBestSupported) {
      result.recommendedAction = 'NO_DECISION';
      result.strategy.finalAction = 'NO_DECISION';
      result.strategy.exploit.finalAction = 'NO_DECISION';
    }
    if (result.ev.comparisonStatus === 'INCOMPARABLE_ASSUMPTIONS') {
      result.reason = 'Action EVs use unlinked opponent ranges, response assumptions or costs. Their values are shown separately; no shared ranking is available.';
    }
    return result;
  }
  for (const [action, reason] of Object.entries(prepared.blockedActions)) if (result.legalActions.includes(action)) {
    result.ev.actions[action] = { action, legal: true, status: 'NOT_MODELED', ev: null, model: null,
      missingInputs: [reason], assumptions: [], warnings: [reason] };
  }
  enrichActionEV(result.ev, { ...prepared.input, legalActions: result.legalActions }, result.equity);
  const modeled = result.ev.comparableActions.map(action => result.ev.actions[action]);
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
  if (!result.ev.comparisonComplete || !result.ev.leaderConclusive) {
    // A nominal or partial leader is useful for the table, but does not
    // establish a globally preferred play for this decision.
    result.recommendedAction = 'NO_DECISION';
    result.strategy.finalAction = 'NO_DECISION';
    result.strategy.exploit.finalAction = 'NO_DECISION';
  }
  result.confidence = exploit.confidence;
  result.potMath.evCall = result.ev.actions.CALL.status === 'MODELED' ? result.ev.actions.CALL.ev : null;
  result.reason = result.ev.comparisonStatus === 'INCOMPARABLE_ASSUMPTIONS'
    ? 'Action EVs use unlinked opponent ranges, response assumptions or costs. Their values are shown separately; no shared ranking is available.'
    : result.ev.comparisonComplete ? result.reason : `Partial comparison: ${result.ev.missingLegalActions.join(', ')} remain unavailable because the necessary responses were not modeled. ${modeled.length ? 'The leader among calculated actions does not establish the best overall play.' : 'No action can be recommended.'}`;
  result.warnings = [...new Set([...result.warnings, ...baseline.warnings, ...exploit.warnings])];
  return result;
}

module.exports = { SOURCE, validateRecord, envelope, start, step, undo, nextHand, previewSequence, batch, applySequence:batch, prepareAnalysis, blockedResult, guardResult };
