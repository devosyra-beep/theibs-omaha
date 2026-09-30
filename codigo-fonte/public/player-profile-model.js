(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TheibsPlayerProfiles = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';
// Pure, serializable per-user data. The caller chooses its persistence location;
// this module never opens a file, sends a request, or stores audio/transcripts.
const randomUUID = () => globalThis.crypto.randomUUID();
const hash = value => JSON.stringify(value);
const clone = value => JSON.parse(JSON.stringify(value));
const VERSION = 'CONTEXT_DIRICHLET_V1';
const actions = ['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE'];
function createStore() { return { schemaVersion: 1, revision: 0, players: {}, hands: {} }; }
function validateStore(store) {
  if (!store || store.schemaVersion !== 1 || !Number.isSafeInteger(store.revision) || store.revision < 0
      || !store.players || Array.isArray(store.players) || !store.hands || Array.isArray(store.hands)) throw Error('Invalid player library.');
  for (const [id, player] of Object.entries(store.players)) {
    safeId(id);
    if (!player || player.playerId !== id || typeof player.nickname !== 'string' || player.nickname.length > 80
        || !Array.isArray(player.notes) || !player.contexts || !Number.isSafeInteger(player.observations) || player.observations < 0) throw Error('Invalid stored player.');
    let total = 0;
    for (const [key, cell] of Object.entries(player.contexts)) {
      if (!cell.context || !Array.isArray(cell.context.legalActions) || contextKey(cell.context) !== key || !cell.counts) throw Error('Invalid stored observation context.');
      for (const [action, count] of Object.entries(cell.counts)) {
        if (!actions.includes(action) || !cell.context.legalActions.includes(action) || !Number.isSafeInteger(count) || count < 0 || count > 1e9) throw Error('Invalid stored observation count.');
        total += count;
      }
    }
    if (total !== player.observations) throw Error('Stored observation totals do not match.');
  }
  return store;
}
function safeId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) throw Error('Invalid player identity.');
  return value;
}
function name(value) {
  const text = String(value || 'Unknown player').trim();
  if (!text || text.length > 80) throw Error('Use a player name with 1 to 80 characters.');
  return text;
}
function createPlayer(store, input = {}) {
  validateStore(store); const playerId = safeId(input.playerId || randomUUID());
  if (store.players[playerId]) throw Error('This player identity already exists.');
  const player = { playerId, nickname: name(input.nickname), notes: [], contexts: {}, observations: 0, createdAt: new Date().toISOString() };
  store.players[playerId] = player; store.revision++; return player;
}
function playerAt(store, id) { validateStore(store); const player = store.players[safeId(id)]; if (!player) throw Error('Player not found.'); return player; }
function renamePlayer(store, id, nickname) { const player = playerAt(store, id); player.nickname = name(nickname); store.revision++; return player; }
function addNote(store, id, text) {
  const player = playerAt(store, id), value = String(text || '').trim();
  if (!value || value.length > 2000) throw Error('Use a note with 1 to 2,000 characters.');
  const note = { id: randomUUID(), text: value, source: 'USER_NOTE', createdAt: new Date().toISOString(), statisticalObservation: false };
  player.notes.push(note); store.revision++; return note;
}
function removeNote(store, id, noteId) { const player = playerAt(store, id); player.notes = player.notes.filter(note => note.id !== noteId); store.revision++; }
function contextFor(state, actor = state.actor) {
  const player = state.players[actor];
  if (!player || actor !== state.actor || state.phase !== 'BETTING') throw Error('A current legal decision is required for an observation.');
  const legal = [...state.legal.actions].sort();
  const pressure = state.legal.toCall / Math.max(.01, state.pot + state.legal.toCall);
  return { variant: state.variant, street: state.street, position: player.position,
    tableFormat: state.initialPlayerCount === 2 ? 'HEADS_UP_TABLE' : 'MULTIWAY_TABLE',
    initialParticipants: state.initialPlayerCount || state.players.length,
    participants: state.activePlayers === 2 ? 'HEADS_UP' : state.activePlayers <= 4 ? 'MULTIWAY_3_4' : 'MULTIWAY_5_PLUS',
    priceBand: state.legal.toCall === 0 ? 'FREE' : pressure <= .2 ? 'UP_TO_20_PERCENT' : pressure <= .4 ? '20_TO_40_PERCENT' : 'ABOVE_40_PERCENT',
    legalActions: legal };
}
function contextKey(context) { return [context.variant, context.tableFormat, context.initialParticipants, context.street, context.position, context.participants, context.priceBand, context.legalActions.join(',')].join('|'); }
function posterior(context, counts = {}) {
  const legal = context.legalActions, observed = legal.reduce((sum, action) => sum + Number(counts[action] || 0), 0);
  // Dirichlet prior: one pseudo-observation per legal action, except 0.01 for
  // folding at no cost (legal but dominated by checking). A weak reference over
  // available. Every marginal is Beta(alpha_i, sum(alpha)-alpha_i). The interval
  // uses posterior variance and Chebyshev, guaranteeing >=95% posterior mass;
  // it is deliberately conservative and is not a frequentist confidence claim.
  const prior = Object.fromEntries(legal.map(action => [action, action === 'FOLD' && context.priceBand === 'FREE' ? .01 : 1]));
  const priorTotal = Object.values(prior).reduce((sum, alpha) => sum + alpha, 0);
  const total = observed + priorTotal;
  const estimates = Object.fromEntries(legal.map(action => {
    const alpha = prior[action] + Number(counts[action] || 0), mean = alpha / total;
    const variance = alpha * (total - alpha) / (total * total * (total + 1));
    const radius = Math.sqrt(variance / .05);
    return [action, { observed: Number(counts[action] || 0), opportunities: observed,
      mean, alpha, beta: total - alpha, credibleInterval95: [Math.max(0, mean - radius), Math.min(1, mean + radius)] }];
  }));
  return { model: VERSION, source: observed ? 'CONFIRMED_ACTIONS_WITH_REFERENCE_PRIOR' : 'REFERENCE_PRIOR_ONLY',
    context, sampleSize: observed, prior: { family: 'DIRICHLET', alphaByLegalAction: prior, effectiveSampleSize: priorTotal },
    intervalMethod: 'BETA_MARGINAL_CHEBYSHEV_AT_LEAST_95_PERCENT_POSTERIOR_MASS', estimates };
}
function getPosterior(profile, context) { return posterior(context, profile?.contexts?.[contextKey(context)]?.counts || {}); }
function profileSnapshot(store, handId, playerIds = Object.keys(store.players)) {
  validateStore(store);
  return { schemaVersion: 1, handId, source: 'PRE_HAND_OBSERVATIONS', model: VERSION,
    libraryRevision: store.revision, frozenAt: new Date().toISOString(),
    players: Object.fromEntries(Object.values(store.players).filter(player => playerIds.includes(player.playerId)).map(player => [player.playerId,
      { playerId: player.playerId, contexts: clone(player.contexts), observations: player.observations }])) };
}
function identities(record) {
  const ids = record.playerIds || record.config.players?.map(player => player.playerId);
  if (!Array.isArray(ids) || ids.length !== Number(record.config.playerCount) || new Set(ids).size !== ids.length) throw Error('Assign a distinct player identity to each seat.');
  return ids.map(safeId);
}
function beginHand(store, record) {
  validateStore(store);
  const handId = safeId(record.handId), playerIds = identities(record);
  if (!store.hands[handId]) {
    for (const [index, id] of playerIds.entries()) if (!store.players[id]) createPlayer(store, { playerId: id, nickname: record.config.players?.[index]?.name });
    store.hands[handId] = { handId, playerIds: [...playerIds], profileSnapshot: profileSnapshot(store, handId, playerIds), observations: [], fingerprint: null };
    store.revision++;
  }
  const hand = store.hands[handId];
  if (JSON.stringify(hand.playerIds) !== JSON.stringify(playerIds)) throw Error('Player identities cannot change within the same hand.');
  return { profileSnapshot: clone(hand.profileSnapshot), playerIds: [...hand.playerIds] };
}
function applyObservation(store, observation, delta) {
  const player = store.players[observation.playerId]; if (!player) return;
  const key = contextKey(observation.context);
  const cell = player.contexts[key] || { context: observation.context, counts: {} };
  cell.counts[observation.action] = Number(cell.counts[observation.action] || 0) + delta;
  if (cell.counts[observation.action] < 0) throw Error('Player observation ledger is inconsistent.');
  player.observations += delta;
  if (Object.values(cell.counts).some(value => value > 0)) player.contexts[key] = cell;
  else delete player.contexts[key];
}
function applyObservations(store, record) {
  const initial = beginHand(store, record), hand = store.hands[record.handId];
  if (!Array.isArray(record.observations)) throw Error('Confirmed observations are required.');
  const fingerprint = record.revisionKey || hash(record.observations);
  if (fingerprint === hand.fingerprint) return { store, ...initial, observationsAdded: 0, observationsRemoved: 0 };
  const observations = record.observations.filter(item => !hand.resetPlayerIds?.includes(item.playerId));
  for (const item of observations) {
    if (!initial.playerIds.includes(item.playerId) || item.source !== 'CONFIRMED_EVENT'
        || !item.context?.legalActions?.includes(item.action) || !actions.includes(item.action)) throw Error('Invalid confirmed observation.');
  }
  if (new Set(observations.map(item => item.id)).size !== observations.length) throw Error('Duplicate confirmed observation identity.');
  const previous = new Map(hand.observations.map(item => [item.id, item])), next = new Map(observations.map(item => [item.id, item]));
  let observationsRemoved = 0, observationsAdded = 0;
  for (const [id, item] of previous) if (!next.has(id) || hash(next.get(id)) !== hash(item)) { applyObservation(store, item, -1); observationsRemoved++; }
  for (const [id, item] of next) if (!previous.has(id) || hash(previous.get(id)) !== hash(item)) { applyObservation(store, item, 1); observationsAdded++; }
  hand.observations = observations; hand.fingerprint = fingerprint; store.revision++;
  return { store, ...initial, observationsAdded, observationsRemoved };
}
function summarizePlayer(store, id) {
  const player = playerAt(store, id);
  return { ...clone(player), contexts: Object.values(player.contexts).map(cell => posterior(cell.context, cell.counts)),
    handCount: Object.values(store.hands).filter(hand => hand.playerIds.includes(id)).length,
    limitations: ['Counts describe recorded opportunities, not every hand played.', 'Notes and shown cards do not create action observations.', 'Sparse contexts retain a broad reference prior; no GTO claim.'] };
}
function listPlayers(store) { validateStore(store); return Object.values(store.players).map(player => summarizePlayer(store, player.playerId)); }
function resetPlayer(store, id) {
  const player = playerAt(store, id); player.contexts = {}; player.observations = 0;
  // Keep already-reset historical events from being re-added on a later sync.
  for (const hand of Object.values(store.hands)) { hand.observations = hand.observations.filter(item => item.playerId !== id); hand.resetPlayerIds = [...new Set([...(hand.resetPlayerIds || []), id])]; }
  store.revision++; return player;
}
function deletePlayer(store, id) { resetPlayer(store, id); delete store.players[id]; store.revision++; }
return { VERSION, createStore, validateStore, createPlayer, renamePlayer, addNote, removeNote, beginHand, applyObservations,
  profileSnapshot, summarizePlayer, listPlayers, resetPlayer, deletePlayer, getPosterior, contextFor, contextKey, posterior };

});
