'use strict';
const { createHash } = require('node:crypto');
const { replay } = require('./hand-flow');
const model = require('../public/player-profile-model');
const { contextFor } = model;
function deriveObservations(record) {
  const playerIds = record.playerIds || record.config.players?.map(player => player.playerId);
  if (!Array.isArray(playerIds) || playerIds.length !== Number(record.config.playerCount) || new Set(playerIds).size !== playerIds.length) throw Error('Assign a distinct player identity to each seat.');
  if (typeof record.handId !== 'string' || !Array.isArray(record.events)) throw Error('Confirmed hand identity and events are required.');
  replay(record.config, record.events);
  const observations = [];
  for (let index = 0; index < record.events.length; index++) {
    const event = record.events[index];
    if (event.type !== 'ACT') continue; // Blind posts, notes, reveals and out-of-turn exits have no known decision denominator.
    const before = replay(record.config, record.events.slice(0, index));
    const context = contextFor(before, event.actor);
    if (!context.legalActions.includes(event.action)) continue;
    observations.push({ id: `${record.handId}:${event.eventId || event.originEventId || index}`,
      playerId: playerIds[event.actor], seatId: event.actor, action: event.action, context,
      amountToCall: before.legal.toCall, potBeforeDecision: before.pot,
      targetStreetTotal: ['BET', 'RAISE'].includes(event.action) ? Number(event.to) : null,
      source: 'CONFIRMED_EVENT', eventIndex: index });
  }

  return { handId: record.handId, config: { playerCount: record.config.playerCount, players: record.config.players }, playerIds,
    revisionKey: createHash('sha256').update(JSON.stringify({ config: record.config, events: record.events, playerIds })).digest('hex'), observations };
}
function syncHand(store, record) { return model.applyObservations(store, deriveObservations(record)); }
module.exports = { ...model, deriveObservations, syncHand };
