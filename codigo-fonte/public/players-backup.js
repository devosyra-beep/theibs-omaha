(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./player-profile-model'));
  else root.TheibsPlayersBackup = factory(root.TheibsPlayerProfiles);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (model) {
'use strict';
// This is a recovery format, not a new data model or a numerical verifier.
// SHA-256 detects inconsistent file contents; anyone can create a new digest.
// Stored forecasts, solver certificates and EV are never recalculated here.
const VERSION = 'THEIBS_PLAYERS_BACKUP_V1';
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DEPTH = 64, MAX_VALUES = 500000;
const FORMAT = 'THEIBS_PLAYER_LIBRARY_BACKUP', SCOPE = 'LOCAL_PLAYER_LIBRARY_ONLY';
const ORIGIN_LABEL = 'Restored backup · file origin not authenticated';
const KINDS = ['players', 'hands', 'archive', 'decisions'];
const ACTIONS = ['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE'];
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
function fail(code, message, conflicts) { const error = Error(message); error.code = code; if (conflicts) error.conflicts = conflicts; throw error; }
function requireThat(ok, message) { if (!ok) fail('BACKUP_INVALID_DATA', message); }
function id(value) { requireThat(typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !FORBIDDEN.has(value), 'Invalid saved identity.'); return value; }
function eventId(value) { requireThat(typeof value === 'string' && /^[\w.:-]{1,128}$/.test(value), 'Invalid saved event identity.'); }
function integer(value, max = Number.MAX_SAFE_INTEGER) { requireThat(Number.isSafeInteger(value) && value >= 0 && value <= max, 'Invalid saved count or revision.'); }
function time(value) { requireThat(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'Invalid saved timestamp.'); }
function hash(value) { requireThat(typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value), 'Invalid saved hash.'); }
function owner(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) fail('BACKUP_INVALID_OWNER', 'A verified account key is required.'); return value; }
function numeric(value, max = 10000000) {
  // canonicalConfig keeps numeric strings. Validate them without changing them.
  requireThat((finite(value) || typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) && Number(value) >= 0 && Number(value) <= max, 'Invalid saved chip amount.');
}
function keysOnly(value, keys, code = 'BACKUP_INVALID_DATA') {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail(code, 'Unsupported saved structure or backup scope.');
}
function plainCopy(value) {
  let visited = 0; const active = new Set();
  function walk(item, depth, arrayEntry) {
    if (++visited > MAX_VALUES || depth > MAX_DEPTH) fail('BACKUP_STRUCTURE_LIMIT', 'The backup contains too much nested data.');
    if (item === undefined && !arrayEntry) return undefined; // Same omission as local JSON storage.
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') { requireThat(Number.isFinite(item), 'Saved numbers must be finite or explicitly null.'); return item; }
    requireThat(item && typeof item === 'object', 'Only plain JSON data can be backed up.');
    const proto = Object.getPrototypeOf(item);
    const constructor = proto && Object.getOwnPropertyDescriptor(proto, 'constructor');
    requireThat(Array.isArray(item) || proto === null || Object.getPrototypeOf(proto) === null && constructor && own(constructor,'value') && typeof constructor.value === 'function' && constructor.value.name === 'Object', 'Only plain saved objects are supported.');
    requireThat(!active.has(item), 'Cyclic saved data cannot be backed up.'); active.add(item);
    const result = Array.isArray(item) ? [] : {};
    for (const key of Reflect.ownKeys(item)) {
      requireThat(typeof key === 'string' && !FORBIDDEN.has(key), 'Unsafe saved property name.');
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      requireThat(descriptor && own(descriptor, 'value'), 'Saved data cannot contain accessors.');
      if (Array.isArray(item) && key === 'length') continue;
      requireThat(descriptor.enumerable, 'Saved data cannot contain hidden properties.');
      if (Array.isArray(item)) requireThat(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < item.length, 'Saved arrays cannot contain custom properties.');
      const copied = walk(descriptor.value, depth + 1, Array.isArray(item));
      if (copied !== undefined) result[key] = copied;
    }
    if (Array.isArray(item)) requireThat(result.length === item.length && Object.keys(result).length === item.length, 'Sparse saved arrays are not supported.');
    active.delete(item); return result;
  }
  return walk(value, 0, false);
}
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
}
const equal = (a, b) => stable(a) === stable(b);
function cards(value, allowedLengths) {
  requireThat(Array.isArray(value) && (!allowedLengths || allowedLengths.includes(value.length)) && new Set(value).size === value.length && value.every(card => typeof card === 'string' && /^[2-9TJQKA][cdhs]$/.test(card)), 'Invalid saved cards.');
}
function context(value) {
  requireThat(object(value) && ['PLO4_HIGH', 'PLO5_HIGH', 'PLO6_HIGH'].includes(value.variant) && ['PREFLOP', 'FLOP', 'TURN', 'RIVER'].includes(value.street)
    && ['SB','BB','UTG','UTG1','UTG2','UTG3','MP','MP1','MP2','LJ','HJ','CO','BTN'].includes(value.position)
    && ['HEADS_UP_TABLE','MULTIWAY_TABLE'].includes(value.tableFormat)
    && ['HEADS_UP','MULTIWAY_3_4','MULTIWAY_5_PLUS'].includes(value.participants)
    && ['FREE','UP_TO_20_PERCENT','20_TO_40_PERCENT','ABOVE_40_PERCENT'].includes(value.priceBand), 'Invalid saved observation context.');
  integer(value.initialParticipants, {PLO4_HIGH:10,PLO5_HIGH:6,PLO6_HIGH:5}[value.variant]);
  requireThat(value.initialParticipants >= 2 && (value.tableFormat === 'HEADS_UP_TABLE') === (value.initialParticipants === 2), 'Inconsistent saved table context.');
  requireThat(Array.isArray(value.legalActions) && value.legalActions.length > 0 && new Set(value.legalActions).size === value.legalActions.length && value.legalActions.every(action => ACTIONS.includes(action)), 'Invalid saved legal actions.');
  return model.contextKey(value);
}
function profile(value, identity) {
  requireThat(object(value) && value.playerId === identity && object(value.contexts), 'Invalid saved player profile.'); integer(value.observations);
  let total = 0;
  for (const [key, cell] of Object.entries(value.contexts)) {
    requireThat(object(cell) && context(cell.context) === key && object(cell.counts), 'Invalid saved context identity.');
    for (const [action, count] of Object.entries(cell.counts)) { requireThat(cell.context.legalActions.includes(action), 'A saved count is outside its legal actions.'); integer(count, 1e9); total += count; }
  }
  requireThat(Number.isSafeInteger(total) && total === value.observations, 'Stored observation totals do not match.');
}
function snapshot(value, hand) {
  requireThat(object(value) && value.schemaVersion === 1 && value.handId === hand.handId && value.source === 'PRE_HAND_OBSERVATIONS' && value.model === model.VERSION && object(value.players), 'Invalid frozen profile snapshot.');
  integer(value.libraryRevision); if (value.frozenAt !== undefined) time(value.frozenAt);
  for (const [key, item] of Object.entries(value.players)) { id(key); requireThat(hand.playerIds.includes(key), 'A frozen profile is outside its original roster.'); profile(item, key); }
}
function record(value, hand) {
  requireThat(object(value) && value.schemaVersion === 1 && typeof value.enabled === 'boolean' && value.handId === hand.handId && object(value.config) && Array.isArray(value.events) && value.events.length <= 500, 'Invalid saved hand ledger.');
  if (value.editEpoch !== undefined) integer(value.editEpoch);
  const cfg = value.config, max = {PLO4_HIGH:10,PLO5_HIGH:6,PLO6_HIGH:5}[cfg.variant], count = Number(cfg.playerCount), hole = Number(cfg.variant?.[3]);
  requireThat(max && Number.isInteger(count) && count >= 2 && count <= max && count === hand.playerIds.length && typeof cfg.heroPosition === 'string', 'Invalid saved table configuration.');
  if (cfg.startingStack !== undefined) numeric(cfg.startingStack); numeric(cfg.smallBlind); numeric(cfg.bigBlind); requireThat(Number(cfg.smallBlind) > 0 && Number(cfg.smallBlind) < Number(cfg.bigBlind), 'Invalid saved blinds.');
  cards(cfg.heroCards, [0,hole]);
  if (cfg.stacks !== undefined) { requireThat(Array.isArray(cfg.stacks) && cfg.stacks.length === count, 'Invalid saved seat stacks.'); cfg.stacks.forEach(value => numeric(value)); }
  requireThat(cfg.stacks !== undefined || cfg.startingStack !== undefined, 'The saved ledger has no starting stacks.');
  requireThat(Array.isArray(cfg.players) && cfg.players.length === count, 'A saved ledger must identify each seat.');
  cfg.players.forEach((player, index) => requireThat(object(player) && player.playerId === hand.playerIds[index] && typeof player.name === 'string' && player.name.length > 0 && player.name.length <= 80, 'A saved ledger has a different player roster.'));
  const identities = {eventId:new Set(),originEventId:new Set()};
  for (const event of value.events) {
    requireThat(object(event) && ['ACT','BOARD','REVEAL','SETTLE','SKIP_RESULT','MARK_FOLD'].includes(event.type), 'Invalid saved ledger event.');
    for (const key of Object.keys(identities)) if (event[key] !== undefined) { eventId(event[key]); requireThat(!identities[key].has(event[key]), 'Duplicate saved event identity.'); identities[key].add(event[key]); }
    if (['ACT','REVEAL','MARK_FOLD'].includes(event.type)) { integer(event.actor, count - 1); }
    if (event.type === 'ACT') { requireThat(ACTIONS.includes(event.action), 'Invalid saved action.'); if (['BET','RAISE'].includes(event.action)) numeric(event.to); }
    if (event.type === 'BOARD') cards(event.cards, [3,4,5]);
    if (event.type === 'REVEAL') cards(event.cards, [hole]);
    if (event.type === 'SETTLE') { requireThat(Array.isArray(event.winners) && event.winners.length > 0, 'Invalid saved pot winners.'); event.winners.forEach(winners => { requireThat(Array.isArray(winners) && winners.length > 0 && new Set(winners).size === winners.length, 'Invalid saved winning seats.'); winners.forEach(seat => integer(seat, count - 1)); }); numeric(event.rake ?? 0); }
  }
}
function nullableNumber(value) { requireThat(value === null || finite(value), 'Saved EV must be a number or explicitly null.'); }
function evaluation(value) {
  if (value == null) return;
  requireThat(object(value), 'Invalid saved analysis.');
  if (value.ev?.candidates !== undefined) {
    requireThat(Array.isArray(value.ev.candidates), 'Invalid saved action estimates.'); const seen = new Set();
    for (const row of value.ev.candidates) {
      requireThat(object(row) && ACTIONS.includes(row.action) && typeof row.status === 'string', 'Invalid saved action estimate.');
      const key = row.optionId || row.id || JSON.stringify([row.action,row.size ?? null]); requireThat(!seen.has(key), 'Duplicate saved action estimate.'); seen.add(key);
      for (const field of ['ev','evBB','differenceToBestModeledBB','standardError','standardErrorBB']) if (own(row,field)) nullableNumber(row[field]);
      if (row.status === 'MODELED') requireThat(finite(row.ev) || finite(row.evBB), 'A modeled action has no saved EV.');
    }
  }
}
function solver(value, decision) {
  if (value == null) return;
  requireThat(object(value) && value.handId === decision.handId && value.revisionKey === decision.revisionKey && typeof value.status === 'string', 'The saved solver snapshot does not match its decision.');
  if (value.gameHash !== undefined) hash(value.gameHash);
  if (value.actions !== undefined) {
    requireThat(Array.isArray(value.actions), 'Invalid saved solver actions.'); const ids = new Set(); let sum = 0;
    for (const row of value.actions) {
      requireThat(object(row) && typeof row.id === 'string' && row.id.length > 0 && !ids.has(row.id), 'Duplicate or invalid saved solver action.'); ids.add(row.id);
      if (own(row,'evBB')) nullableNumber(row.evBB); if (own(row,'frequency')) { nullableNumber(row.frequency); if (row.frequency !== null) { requireThat(row.frequency >= 0 && row.frequency <= 1, 'Invalid saved strategy frequency.'); sum += row.frequency; } }
    }
    if (['SOLVED','APPROXIMATE','REFINING','PARTIAL'].includes(value.status) && value.actions.length) requireThat(value.actions.every(row=>finite(row.evBB) && finite(row.frequency)) && Math.abs(sum - 1) <= 1e-8, 'The saved strategy is incomplete or its frequencies do not match.');
    if (value.abstraction?.rootActions) requireThat(Array.isArray(value.abstraction.rootActions) && value.abstraction.rootActions.length === ids.size && value.abstraction.rootActions.every(row=>ids.has(row.id)), 'The saved solver action set does not match its tree.');
    const bounds = value.actionPrecision;
    if (bounds) {
      requireThat(object(bounds) && Array.isArray(bounds.actions), 'Invalid saved commitment bounds.'); const boundIds = new Set();
      for (const row of bounds.actions) {
        requireThat(object(row) && ids.has(row.id) && !boundIds.has(row.id), 'The saved commitment action set does not match its strategy.'); boundIds.add(row.id);
        for (const field of ['estimateBB','lowerBB','upperBB']) if (own(row,field)) nullableNumber(row[field]);
        if (row.certified === true) requireThat(finite(row.lowerBB) && finite(row.upperBB) && finite(row.estimateBB) && row.lowerBB <= row.estimateBB && row.estimateBB <= row.upperBB && row.baseContextKey === bounds.baseContextKey && row.baseGameHash === bounds.baseGameHash, 'Inconsistent saved commitment certificate.');
      }
    }
  }
  if (value.convergence?.nashConv != null) requireThat(finite(value.convergence.nashConv) && value.convergence.nashConv >= 0, 'Invalid saved convergence measurement.');
  if (value.status === 'SOLVED') requireThat(value.qualification?.solvedSubgame === true && value.quality?.numericalStatus === 'SOLVED' && value.quality.exact === true && value.quality.thresholdMet === true, 'Inconsistent saved solved-subgame qualification.');
}
function decision(value, hand) {
  requireThat(object(value) && value.handId === hand.handId && ACTIONS.includes(value.action), 'Invalid saved decision history.'); hash(value.revisionKey);
  if (value.to != null) numeric(value.to); requireThat(value.key === JSON.stringify([value.revisionKey,value.action,value.to ?? null]), 'Invalid saved decision identity.');
  if (value.recordedAt !== undefined) time(value.recordedAt); if (value.committedEventId !== undefined) eventId(value.committedEventId);
  record(value.recordBefore, hand); solver(value.solver, value); evaluation(value.analysis);
}
function archived(value, hand, decisions) {
  requireThat(object(value) && object(value.state), 'Invalid saved hand archive.'); record(value.multiway, hand);
  if (value.archivedAt !== undefined) time(value.archivedAt);
  const state = value.state;
  requireThat(state.schema === 'THEIBS_OBSERVED_HAND_V1' && state.phase === 'FINISHED' && state.variant === value.multiway.config.variant && Array.isArray(state.players) && state.players.length === hand.playerIds.length, 'The saved archive state does not match its ledger.');
  if (state.handId !== undefined) requireThat(state.handId === hand.handId, 'The saved archive has a different hand identity.');
  if (state.revisionKey !== undefined) hash(state.revisionKey);
  if (state.revision !== undefined) requireThat(state.revision === value.multiway.events.length, 'The saved archive event count does not match.');
  cards(state.board,[0,3,4,5]);
  for (const [index, player] of state.players.entries()) {
    requireThat(object(player) && player.id === index && player.playerId === hand.playerIds[index], 'The saved archive seat identities do not match.');
    for (const key of ['stack','startingStack','streetPaid','totalPaid']) { requireThat(finite(player[key]) && player[key] >= 0, 'Invalid saved player balances.'); }
    cards(player.shownCards,[0,Number(state.variant[3])]);
  }
  for (const field of ['pot','bigBlind','rake','totalChips']) requireThat(finite(state[field]) && state[field] >= 0, 'Invalid saved pot or balances.');
  requireThat(Array.isArray(state.log) && object(state.result), 'The saved archive has no event log or result.');
  if (value.reconciliation !== undefined) {
    const item = value.reconciliation;
    requireThat(object(item) && ['USER_CONFIRMED_STACKS','UNCONTESTED_POT_BEFORE_UNRECORDED_RAKE','CONFIRMED_POT_RESULT'].includes(item.source) && typeof item.rakeObserved === 'boolean' && typeof item.resultPending === 'boolean' && Array.isArray(item.stacks) && item.stacks.length === hand.playerIds.length, 'Invalid saved balance reconciliation.');
    item.stacks.forEach((row,index)=>requireThat(row.playerId === hand.playerIds[index] && finite(row.stack) && row.stack >= 0, 'Invalid saved reconciled seat balance.'));
  }
  if (value.decisions !== undefined) {
    requireThat(Array.isArray(value.decisions), 'Invalid archived decision histories.'); const seen = new Set();
    for (const item of value.decisions) {
      decision(item, hand); requireThat(!seen.has(item.key), 'Duplicate archived decision.'); seen.add(item.key);
      requireThat(decisions.some(row=>row.key===item.key && equal(row,item)), 'An archived decision has no identical history record.');
      const before = item.recordBefore.events, event = value.multiway.events[before.length];
      requireThat(equal(before,value.multiway.events.slice(0,before.length)) && event?.type === 'ACT' && event.action === item.action && (item.to == null || Number(event.to) === Number(item.to)) && (!item.committedEventId || event.eventId === item.committedEventId), 'An archived decision does not match its committed event.');
    }
  }
}
function validateLibrary(raw) {
  const library = plainCopy(raw); keysOnly(library,['schemaVersion','store','archive','decisions','backupOrigins'],'BACKUP_UNSUPPORTED_SCOPE');
  requireThat(library.schemaVersion === 1 && object(library.store) && object(library.archive) && (library.decisions === undefined || object(library.decisions)), 'Invalid player library schema.');
  keysOnly(library.store,['schemaVersion','revision','players','hands']);
  requireThat(library.store.schemaVersion === 1 && object(library.store.players) && object(library.store.hands), 'Invalid player store schema.'); integer(library.store.revision);
  if (!model) fail('BACKUP_DEPENDENCY_UNAVAILABLE','The player library validator is unavailable.');
  try { model.validateStore(library.store); } catch { fail('BACKUP_INVALID_DATA','Invalid saved player aggregates.'); }
  const totals = {}, seenObservations = new Set();
  for (const [key, player] of Object.entries(library.store.players)) {
    id(key); profile(player,key); requireThat(typeof player.nickname === 'string' && player.nickname.length <= 80 && Array.isArray(player.notes), 'Invalid saved player.');
    if (player.createdAt !== undefined) time(player.createdAt); const notes = new Set();
    for (const note of player.notes) { requireThat(object(note) && typeof note.id === 'string' && note.id.length > 0 && !notes.has(note.id) && typeof note.text === 'string' && note.text.length > 0 && note.text.length <= 2000 && note.source === 'USER_NOTE' && note.statisticalObservation === false, 'Invalid saved note.'); notes.add(note.id); if (note.createdAt !== undefined) time(note.createdAt); }
    totals[key] = {};
  }
  for (const [key, hand] of Object.entries(library.store.hands)) {
    id(key); requireThat(object(hand) && hand.handId === key && Array.isArray(hand.playerIds) && hand.playerIds.length >= 2 && hand.playerIds.length <= 10 && new Set(hand.playerIds).size === hand.playerIds.length && Array.isArray(hand.observations), 'Invalid saved hand record.'); hand.playerIds.forEach(id);
    if (hand.fingerprint !== undefined) requireThat(hand.fingerprint === null || typeof hand.fingerprint === 'string', 'Invalid saved hand fingerprint.');
    if (hand.resetPlayerIds !== undefined) { requireThat(Array.isArray(hand.resetPlayerIds) && new Set(hand.resetPlayerIds).size === hand.resetPlayerIds.length,'Invalid reset observation markers.'); hand.resetPlayerIds.forEach(id); }
    if (hand.profileSnapshot !== undefined) snapshot(hand.profileSnapshot,hand);
    if (hand.forecastOrigin !== undefined) {
      const origin = hand.forecastOrigin;
      requireThat(object(origin) && origin.version === 'THEIBS_FORECAST_ORIGIN_V1' && ['FROZEN_BEFORE_FIRST_ACTION','RECONSTRUCTED_AFTER_ACTION'].includes(origin.status) && origin.createdAt === hand.profileSnapshot?.frozenAt, 'Invalid saved forecast origin.'); time(origin.createdAt);
    }
    for (const item of hand.observations) {
      requireThat(object(item) && typeof item.id === 'string' && item.id.startsWith(key+':') && item.id.length <= key.length + 129 && !seenObservations.has(item.id) && item.source === 'CONFIRMED_EVENT' && hand.playerIds.includes(item.playerId) && !hand.resetPlayerIds?.includes(item.playerId) && ACTIONS.includes(item.action), 'Invalid or duplicate confirmed observation.');
      eventId(item.id.slice(key.length+1)); seenObservations.add(item.id); context(item.context); requireThat(item.context.legalActions.includes(item.action), 'A saved observation was not a legal action.');
      integer(item.seatId, hand.playerIds.length - 1); requireThat(hand.playerIds[item.seatId] === item.playerId, 'A saved observation has a different seat identity.'); integer(item.eventIndex,499);
      for (const field of ['amountToCall','potBeforeDecision']) requireThat(finite(item[field]) && item[field] >= 0, 'Invalid saved observation amount.');
      if (item.targetStreetTotal !== undefined && item.targetStreetTotal !== null) requireThat(finite(item.targetStreetTotal) && item.targetStreetTotal >= 0, 'Invalid saved observed action size.');
      requireThat(own(totals,item.playerId), 'A removed player still has counted observations.');
      const ck = model.contextKey(item.context); totals[item.playerId][ck] ||= {}; totals[item.playerId][ck][item.action] = (totals[item.playerId][ck][item.action] || 0) + 1;
    }
  }
  for (const [key, player] of Object.entries(library.store.players)) {
    const actual = Object.fromEntries(Object.entries(player.contexts).map(([ck,cell])=>[ck,Object.fromEntries(Object.entries(cell.counts).filter(([,count])=>count>0))]).filter(([,counts])=>Object.keys(counts).length));
    requireThat(equal(actual,totals[key]), 'Saved action counts do not match the confirmed hand observations.');
  }
  for (const [key, rows] of Object.entries(library.decisions || {})) {
    id(key); const hand = library.store.hands[key]; requireThat(hand && Array.isArray(rows), 'A decision history has no saved hand record.'); const seen = new Set();
    for (const row of rows) { decision(row,hand); requireThat(!seen.has(row.key),'Duplicate saved decision identity.'); seen.add(row.key); }
  }
  for (const [key,value] of Object.entries(library.archive)) { id(key); requireThat(own(library.store.hands,key),'An archive has no saved hand record.'); archived(value,library.store.hands[key],library.decisions?.[key] || []); }
  if (library.backupOrigins !== undefined) {
    keysOnly(library.backupOrigins,['schemaVersion','handIds']); const marker = library.backupOrigins;
    requireThat(marker.schemaVersion === 1 && Array.isArray(marker.handIds) && new Set(marker.handIds).size === marker.handIds.length,'Invalid backup origin metadata.');
    marker.handIds.forEach(key=>{id(key);requireThat(own(library.store.hands,key),'A backup origin has no saved hand record.');});
  }
  return library;
}
function summary(library) {
  const totals = {players:Object.keys(library.store.players).length,hands:Object.keys(library.store.hands).length,archive:Object.keys(library.archive).length,decisions:Object.keys(library.decisions || {}).length};
  return {totals,decisionSnapshots:Object.values(library.decisions || {}).reduce((sum,rows)=>sum+rows.length,0),notes:Object.values(library.store.players).reduce((sum,player)=>sum+player.notes.length,0)};
}
function encode(text) { return new TextEncoder().encode(text); }
async function sha256(text) {
  if (!globalThis.crypto?.subtle) fail('BACKUP_CRYPTO_UNAVAILABLE','Secure SHA-256 is unavailable. Open the app using HTTPS.');
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',encode(text)));
  return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
}
function payload(document) { return {format:document.format,version:document.version,schemaVersion:document.schemaVersion,ownerKey:document.ownerKey,createdAt:document.createdAt,scope:document.scope,library:document.library}; }
function provenance(document) { return {label:ORIGIN_LABEL,authenticated:false,integrityChecked:true,sha256:document.integrity.sha256,createdAt:document.createdAt}; }
async function verifyRevisions(library) {
  // Hash the same selective canonical ledger as multiway-session, without
  // replaying poker or changing any saved data. Hand fingerprints can describe
  // an earlier ledger; later shown-card edits legitimately change the archive.
  async function check(record, expected) {
    if (expected === undefined) return;
    const cfg = record.config;
    const canonical = {variant:cfg.variant,playerCount:Number(cfg.playerCount),heroPosition:cfg.heroPosition.toUpperCase(),startingStack:cfg.startingStack,smallBlind:cfg.smallBlind,bigBlind:cfg.bigBlind,heroCards:cfg.heroCards,
      ...(cfg.stacks?{stacks:cfg.stacks}:{}),...(cfg.players?{players:cfg.players.map(player=>({playerId:player.playerId,name:player.name.trim()}))}:{})};
    const events = record.events.map(event=>{
      const metadata = Object.fromEntries(['eventId','originEventId'].filter(key=>own(event,key)).map(key=>[key,event[key]]));
      if(event.type==='BOARD')return {type:'BOARD',cards:event.cards,...metadata};
      if(event.type==='REVEAL')return {type:'REVEAL',actor:event.actor,cards:event.cards,...metadata};
      if(event.type==='SKIP_RESULT')return {type:'SKIP_RESULT',...metadata};
      if(event.type==='SETTLE')return {type:'SETTLE',winners:event.winners,rake:event.rake??0,...metadata};
      return {type:event.type,actor:event.actor,...(event.type==='ACT'?{action:event.action,...(['BET','RAISE'].includes(event.action)?{to:event.to}:{})}:{}),...metadata};
    });
    const observed = await sha256(JSON.stringify({handId:record.handId || null,editEpoch:record.editEpoch || 0,enabled:record.enabled,config:canonical,events}));
    requireThat(observed === expected,'A saved revision does not match its original decision ledger.');
  }
  for (const rows of Object.values(library.decisions || {})) for (const row of rows) await check(row.recordBefore,row.revisionKey);
  for (const archive of Object.values(library.archive)) await check(archive.multiway,archive.state.revisionKey);
}
async function create({ownerKey,library,now} = {}) {
  owner(ownerKey); const value = validateLibrary(library); await verifyRevisions(value);
  const createdAt = now === undefined ? new Date().toISOString() : typeof now === 'function' ? now() : now; time(createdAt);
  const document = {format:FORMAT,version:VERSION,schemaVersion:1,ownerKey,createdAt,scope:SCOPE,library:value};
  const body = stable(payload(document)); if (encode(body).byteLength > MAX_BYTES) fail('BACKUP_TOO_LARGE','The backup exceeds the 10 MiB file limit.');
  document.integrity = {algorithm:'SHA-256',sha256:await sha256(body)};
  const text = JSON.stringify(document), bytes = encode(text).byteLength;
  if (bytes > MAX_BYTES) fail('BACKUP_TOO_LARGE','The backup exceeds the 10 MiB file limit.');
  return {document,library:value,text,bytes,summary:summary(value),provenance:provenance(document)};
}
function checkJson(text) {
  // JSON.parse silently overwrites duplicate keys. Inspect decoded keys first.
  let cursor = 0, values = 0;
  const whitespace = () => { while (/[\t\n\r ]/.test(text[cursor] || '!')) cursor++; };
  function string() {
    const start = cursor++; let escaped = false;
    while (cursor < text.length) { const char = text[cursor++]; if (char === '"' && !escaped) return JSON.parse(text.slice(start,cursor)); if (char === '\\' && !escaped) escaped = true; else escaped = false; }
    throw Error('Unterminated string');
  }
  function value(depth) {
    if (++values > MAX_VALUES || depth > MAX_DEPTH) fail('BACKUP_STRUCTURE_LIMIT','The backup contains too much nested data.'); whitespace();
    if (text[cursor] === '{') {
      cursor++; whitespace(); const seen = new Set(); if (text[cursor] === '}') {cursor++;return;}
      while (true) {
        requireThat(text[cursor] === '"','Invalid JSON object.'); const key = string();
        if (FORBIDDEN.has(key)) fail('BACKUP_INVALID_DATA','Unsafe saved property name.');
        if (seen.has(key)) fail('BACKUP_DUPLICATE_KEY','The backup contains duplicate JSON property names.'); seen.add(key);
        whitespace(); requireThat(text[cursor++] === ':','Invalid JSON object.'); value(depth+1); whitespace();
        const char = text[cursor++]; if (char === '}') return; requireThat(char === ',','Invalid JSON object.'); whitespace();
      }
    }
    if (text[cursor] === '[') {
      cursor++; whitespace(); if (text[cursor] === ']') {cursor++;return;}
      while (true) {value(depth+1);whitespace();const char=text[cursor++];if(char===']')return;requireThat(char===',','Invalid JSON array.');}
    }
    if (text[cursor] === '"') {string();return;}
    const start=cursor; while(cursor<text.length && !/[\t\n\r ,}\]]/.test(text[cursor]))cursor++;
    requireThat(cursor>start,'Invalid JSON value.'); JSON.parse(text.slice(start,cursor));
  }
  try { value(0);whitespace();requireThat(cursor===text.length,'Unexpected data after the backup.'); }
  catch(error) { if(error.code)throw error;fail('BACKUP_INVALID_JSON','The backup is not valid JSON.'); }
}
async function parse(text, {ownerKey} = {}) {
  owner(ownerKey); if (typeof text !== 'string') fail('BACKUP_INVALID_JSON','Select a JSON backup file.');
  if(text.length > MAX_BYTES || encode(text).byteLength > MAX_BYTES)fail('BACKUP_TOO_LARGE','The backup exceeds the 10 MiB file limit.');
  checkJson(text); let document;try{document=JSON.parse(text);}catch{fail('BACKUP_INVALID_JSON','The backup is not valid JSON.');}
  keysOnly(document,['format','version','schemaVersion','ownerKey','createdAt','scope','library','integrity']);
  if(document.format!==FORMAT || document.version!==VERSION || document.schemaVersion!==1)fail('BACKUP_UNSUPPORTED_VERSION','This backup format or version is not supported.');
  if(document.scope!==SCOPE)fail('BACKUP_UNSUPPORTED_SCOPE','This file is not a local player library backup.');
  owner(document.ownerKey);if(document.ownerKey!==ownerKey)fail('BACKUP_OWNER_MISMATCH','This backup belongs to another account.');time(document.createdAt);
  keysOnly(document.integrity,['algorithm','sha256']);requireThat(document.integrity.algorithm==='SHA-256','Unsupported backup integrity method.');hash(document.integrity.sha256);
  document.library=validateLibrary(document.library);
  if(await sha256(stable(payload(document)))!==document.integrity.sha256)fail('BACKUP_INTEGRITY_MISMATCH','The backup contents do not match its SHA-256 checksum.');
  await verifyRevisions(document.library);
  return {document,library:document.library,text,bytes:encode(text).byteLength,summary:summary(document.library),provenance:provenance(document)};
}
function planImport({current,incoming} = {}) {
  // Untrusted files must first pass parse(text,{ownerKey}). This synchronous
  // plan checks structural consistency and never writes or authenticates data.
  const wrapper = object(incoming) && own(incoming,'library') ? incoming : null;
  const next = validateLibrary(current), source = validateLibrary(wrapper ? wrapper.library : incoming);
  const dirty=Object.fromEntries(KINDS.map(kind=>[kind,[]])),added=Object.fromEntries(KINDS.map(kind=>[kind,0])),identical={...added},conflicts=[];
  const map=(library,kind)=>['players','hands'].includes(kind)?library.store[kind]:library[kind] || {};
  for(const kind of KINDS) for(const [key,value] of Object.entries(map(source,kind))) {
    const target=map(next,kind);
    if(own(target,key)){if(equal(target[key],value))identical[kind]++;else conflicts.push({kind,id:key});}
    else {dirty[kind].push(key);added[kind]++;}
  }
  if(conflicts.length)fail('BACKUP_CONFLICT','Conflicting saved identities were found. The entire restore was blocked.',conflicts);
  // Deletion intentionally leaves historical rosters and reset tombstones.
  // Those identities are still part of this library: a disjoint import cannot
  // resurrect them or create fresh counts for their already-reset history.
  const currentIdentities=new Set(Object.keys(next.store.players));
  for(const hand of Object.values(next.store.hands))for(const playerId of [...hand.playerIds,...(hand.resetPlayerIds || [])])currentIdentities.add(playerId);
  const overlaps=[...dirty.hands.filter(key=>source.store.hands[key].playerIds.some(playerId=>currentIdentities.has(playerId))).map(key=>({kind:'hands',id:key})),
    ...dirty.players.filter(key=>currentIdentities.has(key)).map(key=>({kind:'players',id:key}))];
  if(overlaps.length)fail('BACKUP_OVERLAPPING_PLAYER','New hands overlap existing player records. Restore into an empty library to avoid double-counting.',overlaps);
  for(const kind of KINDS) {
    if(kind==='decisions' && dirty[kind].length)next.decisions ||= {};
    const target=map(next,kind);for(const key of dirty[kind])target[key]=map(source,kind)[key];
  }
  const restored = new Set([...(next.backupOrigins?.handIds || []),...(source.backupOrigins?.handIds || []),...dirty.hands,...dirty.archive,...dirty.decisions]);
  const previous = next.backupOrigins?.handIds || [], union = [...previous,...[...restored].filter(key=>!previous.includes(key)).sort()];
  const provenanceChanged=!equal(previous,union);
  if(provenanceChanged)next.backupOrigins={schemaVersion:1,handIds:union};
  const recordsChanged=Object.values(added).reduce((sum,count)=>sum+count,0);
  if(recordsChanged || provenanceChanged){const revision=Math.max(next.store.revision,source.store.revision)+1;integer(revision);next.store.revision=revision;}
  const library=validateLibrary(next);
  return {library,dirty,summary:{added,identical,mode:recordsChanged?Object.values(summary(current).totals).every(count=>count===0)?'EMPTY_RESTORE':'DISJOINT_ADDITIVE':'IDENTICAL_ONLY',recordsChanged,provenanceChanged,statsRecomputed:false},provenance:wrapper?.provenance ? plainCopy(wrapper.provenance) : null};
}
return {VERSION,MAX_BYTES,create,parse,planImport};
});
