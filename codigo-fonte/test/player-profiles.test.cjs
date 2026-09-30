'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const profiles = require('../src/player-profiles');
const { replay } = require('../src/hand-flow');
const { policyDistribution, _testing } = require('../src/multiway-evaluator');
function record(id = 'hand-one') { return { handId: id, config: { variant: 'PLO4_HIGH', playerCount: 2, heroPosition: 'BB', startingStack: 30,
  smallBlind: .5, bigBlind: 1, heroCards: [], players: [{ playerId: 'person-one', name: 'Same name' }, { playerId: 'person-two', name: 'Same name' }] }, events: [] }; }
test('stable identities survive names; identical nicknames never merge people', () => {
  const store = profiles.createStore(), hand = record(); profiles.beginHand(store, hand);
  profiles.renamePlayer(store, 'person-one', 'Renamed');
  assert.equal(Object.keys(store.players).length, 2); assert.equal(store.players['person-one'].playerId, 'person-one');
  assert.equal(store.players['person-two'].nickname, 'Same name');
  assert.throws(() => profiles.createPlayer(store, { playerId: '__proto__' }));
});
test('confirmed opportunities work without Hero cards, deduplicate and reverse on undo', () => {
  const store = profiles.createStore(), hand = record(); profiles.beginHand(store, hand);
  hand.events.push({ type: 'ACT', actor: 0, action: 'CALL', eventId: 'source-1' });
  assert.equal(profiles.syncHand(store, hand).observationsAdded, 1);
  assert.equal(profiles.syncHand(store, hand).observationsAdded, 0);
  const summary = profiles.summarizePlayer(store, 'person-one'), cell = summary.contexts[0];
  assert.equal(cell.sampleSize, 1); assert.equal(cell.estimates.CALL.observed, 1); assert.equal(cell.estimates.FOLD.opportunities, 1);
  assert.equal(cell.estimates.CHECK, undefined);
  hand.events.pop(); assert.equal(profiles.syncHand(store, hand).observationsRemoved, 1);
  assert.equal(profiles.summarizePlayer(store, 'person-one').observations, 0);
  hand.events.push({ type: 'ACT', actor: 0, action: 'RAISE', to: 2, eventId: 'source-1' });
  profiles.syncHand(store, hand); assert.equal(profiles.summarizePlayer(store, 'person-one').contexts[0].estimates.RAISE.observed, 1);
});
test('notes are separate; pre-hand snapshots remain frozen after same-hand evidence', () => {
  const store = profiles.createStore(), hand = record(); const before = profiles.beginHand(store, hand).profileSnapshot;
  profiles.addNote(store, 'person-one', 'May be aggressive');
  hand.events.push({ type: 'ACT', actor: 0, action: 'CALL' }); profiles.syncHand(store, hand);
  assert.deepEqual(profiles.beginHand(store, hand).profileSnapshot, before);
  assert.equal(before.players['person-one'].notes, undefined);
  assert.equal(before.players['person-one'].observations, 0);
  const next = record('hand-two'); assert.equal(profiles.beginHand(store, next).profileSnapshot.players['person-one'].observations, 1);
});
test('Beta marginals report reference prior and conservative posterior intervals', () => {
  const context = profiles.contextFor(replay(record().config, []));
  const p = profiles.posterior(context, { CALL: 7, FOLD: 2, RAISE: 1 });
  assert.equal(p.sampleSize, 10); assert.equal(p.estimates.CALL.mean, 8 / 13);
  assert.ok(p.estimates.CALL.credibleInterval95[0] <= p.estimates.CALL.mean);
  assert.ok(p.estimates.CALL.credibleInterval95[1] >= p.estimates.CALL.mean);
  const different = { ...context, variant: 'PLO5_HIGH' };
  const profile = { contexts: { [profiles.contextKey(context)]: { context, counts: { CALL: 100 } } } };
  assert.equal(profiles.getPosterior(profile, different).sampleSize, 0);
});
test('history changes future policy and action-conditioned range weights, without notes', () => {
  const store = profiles.createStore();
  for (let index = 0; index < 8; index++) { const hand = record(`learn-${index}`); profiles.beginHand(store, hand); hand.events = [{ type: 'ACT', actor: 0, action: 'FOLD' }]; profiles.syncHand(store, hand); }
  const state = replay(record().config, []), cards = ['As', 'Ah', 'Kd', 'Qc'];
  const reference = policyDistribution({ state, cards }).probabilities;
  const learned = policyDistribution({ state, cards, profile: store.players['person-one'] }).probabilities;
  assert.ok(learned.FOLD > reference.FOLD);
  const known = record('evaluation'); known.config.heroCards = ['2s', '3h', '4d', '5c']; known.events = [{ type: 'ACT', actor: 0, action: 'CALL' }];
  const snapshot = profiles.beginHand(store, known).profileSnapshot;
  const context = _testing.normalize({ ...known, profileSnapshot: snapshot, samples: 32, assumeNoRake: true });
  const weight = _testing.historyWeight(context, { hands: { 0: cards }, board: ['Ac','Ad','Ks','Qh','Jh'] });
  const anotherFuture = _testing.historyWeight(context, { hands: { 0: cards }, board: ['6c','7c','8c','9c','Tc'] });
  assert.equal(weight, anotherFuture);
  assert.ok(weight > 0 && weight < 1);
});
test('reset/delete do not resurrect old observations on a revised hand', () => {
  const store = profiles.createStore(), hand = record(); hand.events = [{ type: 'ACT', actor: 0, action: 'CALL' }]; profiles.syncHand(store, hand);
  profiles.resetPlayer(store, 'person-one'); hand.events.push({ type: 'ACT', actor: 1, action: 'CHECK' }); profiles.syncHand(store, hand);
  assert.equal(store.players['person-one'].observations, 0);
  profiles.deletePlayer(store, 'person-one'); profiles.syncHand(store, hand); assert.equal(store.players['person-one'], undefined);
});
test('browser model has no network/filesystem dependencies and applies derived ledger only', () => {
  const model = require('../public/player-profile-model'), store = model.createStore(), hand = record();
  const derived = profiles.deriveObservations(hand); model.applyObservations(store, derived);
  assert.equal(Object.keys(store.players).length, 2); assert.equal(model.syncHand, undefined);
});
