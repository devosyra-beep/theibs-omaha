'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const profiles = require('../src/player-profiles');
const { replay } = require('../src/hand-flow');
const insights = require('../public/player-profile-insights');
const clone = structuredClone;
function record(handId) {
  return { handId, config: { variant: 'PLO5_HIGH', playerCount: 2, heroPosition: 'BB', startingStack: 30,
    smallBlind: .5, bigBlind: 1, heroCards: [], players: [{ playerId: 'opponent', name: 'Opponent' }, { playerId: 'hero', name: 'Hero' }] }, events: [] };
}
const context = profiles.contextFor(replay(record('context').config, []));
const time = number => new Date(Date.UTC(2026, 9, 1, 10, 0, number)).toISOString();
function hand(store, id, action, order, marked = true) {
  const value = record(id); profiles.beginHand(store, value);
  store.hands[id].profileSnapshot.frozenAt = time(order * 2);
  value.events = [{ type: 'ACT', actor: 0, action, eventId: 'action-1' }];
  profiles.syncHand(store, value);
  return { ...clone(store.hands[id]), ...(marked ? { forecastOrigin: { version: insights.FORECAST_ORIGIN_VERSION,
    status: 'FROZEN_BEFORE_FIRST_ACTION', createdAt: time(order * 2) } } : {}),
    archive: { multiway: { handId: id }, state: { phase: 'FINISHED' }, archivedAt: time(order * 2 + 1) } };
}
function history(actions) {
  const store = profiles.createStore(), hands = actions.map((action, index) => hand(store, 'hand-' + index, action, index));
  return { store, hands };
}
const options = hands => ({ hands, currentHandId: 'current', currentFrozenAt: time(50), playerIds: ['opponent'] });

test('exact contextual report reproduces untouched existing Dirichlet posterior and interval after confirmed actions', () => {
  const { hands } = history(['CALL', 'CALL', 'CALL']), snapshot = hands[2].profileSnapshot;
  const before = clone(snapshot), result = insights.report({ snapshot, playerId: 'opponent', context,
    binding: { ownerKey: 'owner', handId: snapshot.handId, revisionKey: 'revision', notes: 'PRIVATE' } });
  const expected = profiles.getPosterior(snapshot.players.opponent, context);
  assert.equal(result.status, 'READY'); assert.equal(result.opportunities, 2); assert.equal(result.evidence, 'CONFIRMED_ACTIONS');
  assert.deepEqual(result.prior, expected.prior); assert.equal(result.intervalMethod, expected.intervalMethod);
  for (const row of result.actions) {
    assert.equal(row.mean, expected.estimates[row.action].mean); assert.deepEqual(row.credibleInterval95, expected.estimates[row.action].credibleInterval95);
  }
  assert.equal(result.calibrationStatus, 'NOT_ESTABLISHED'); assert.equal(result.origin.scope, 'FROZEN_PRE_HAND');
  assert.deepEqual(snapshot, before); assert.equal('notes' in result.binding, false);
});

test('missing exact context stays unknown with the declared reference prior; no cross-context pooling or minimum-N threshold', () => {
  const { hands } = history(['CALL', 'CALL']);
  for (const other of [{ ...context, position: 'BB' }, { ...context, street: 'FLOP' },
    { ...context, variant: 'PLO4_HIGH' }, { ...context, priceBand: 'ABOVE_40_PERCENT' },
    { ...context, initialParticipants: 3, tableFormat: 'MULTIWAY_TABLE' }]) {
    const result = insights.report({ snapshot: hands[1].profileSnapshot, playerId: 'opponent', context: other });
    assert.equal(result.status, 'UNKNOWN'); assert.equal(result.evidence, 'REFERENCE_PRIOR_ONLY'); assert.equal(result.opportunities, 0);
    assert.ok(result.reasonCodes.includes('EXACT_CONTEXT_NOT_OBSERVED'));
    assert.deepEqual(result.actions.map(row => row.mean), other.legalActions.slice().sort().map(action => profiles.posterior(other).estimates[action].mean));
  }
  const one = insights.report({ snapshot: hands[1].profileSnapshot, playerId: 'opponent', context });
  assert.equal(one.status, 'READY'); assert.equal(one.opportunities, 1);
  assert.ok(one.actions.some(row => row.credibleInterval95[1] - row.credibleInterval95[0] > .5));
});

test('free-fold reference prior and current-library origins remain explicit rather than learned card evidence', () => {
  const { hands } = history(['CALL']), snapshot = clone(hands[0].profileSnapshot);
  snapshot.source = 'LIBRARY_OBSERVATIONS';
  const free = { ...context, priceBand: 'FREE', legalActions: ['CHECK', 'FOLD', 'BET'] };
  const result = insights.report({ snapshot, playerId: 'opponent', context: free });
  assert.equal(result.origin.scope, 'CURRENT_LIBRARY'); assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.prior.alphaByLegalAction.FOLD, .01); assert.equal(result.prior.alphaByLegalAction.CHECK, 1);
  assert.equal(result.actions.find(row => row.action === 'FOLD').mean, .01 / 2.01);
  assert.equal('ranges' in result, false); assert.equal('confidence' in result, false);
});

test('invalid snapshot/context has unavailable values instead of silent replacement by a reference prediction', () => {
  const { hands } = history(['CALL', 'CALL']);
  for (const poison of [snapshot => { snapshot.model = 'UNKNOWN'; }, snapshot => { snapshot.source = 'SHOWDOWN'; },
    snapshot => { snapshot.players.opponent.observations++; }, snapshot => { snapshot.players.opponent.contexts[profiles.contextKey(context)].counts.CALL = -1; }]) {
    const snapshot = clone(hands[1].profileSnapshot); poison(snapshot);
    const result = insights.report({ snapshot, playerId: 'opponent', context });
    assert.equal(result.status, 'UNAVAILABLE'); assert.equal(result.opportunities, null); assert.deepEqual(result.actions, []);
  }
  assert.equal(insights.report({ snapshot: hands[0].profileSnapshot, playerId: 'opponent', context: { ...context, legalActions: ['CALL', 'CALL'] } }).status, 'UNAVAILABLE');
  assert.throws(() => insights.contextKey({ ...context, legalActions: ['GTO'] }));
});

test('prequential forecasts use original prehand counts and correctly score a predictive action pattern against the same legal reference', () => {
  const { hands } = history(['CALL', 'CALL', 'CALL', 'CALL']), before = clone(hands), audit = insights.evaluatePrequential(options(hands));
  assert.equal(audit.status, 'READY'); assert.equal(audit.counts.eligibleHands, 4); assert.equal(audit.counts.forecasts, 4);
  assert.deepEqual(audit.forecasts.map(row => row.priorOpportunities), [0, 1, 2, 3]);
  assert.deepEqual(audit.forecasts.map(row => row.observedActionProbability), [1 / 3, 2 / 4, 3 / 5, 4 / 6]);
  const expectedLog = [1 / 3, 2 / 4, 3 / 5, 4 / 6].reduce((sum, probability) => sum - Math.log(probability), 0) / 4;
  assert.equal(audit.metrics.logLoss.model, expectedLog); assert.equal(audit.metrics.logLoss.reference, -Math.log(1 / 3));
  assert.ok(audit.metrics.logLoss.modelMinusReference < 0); assert.ok(audit.metrics.brier.modelMinusReference < 0);
  assert.equal(audit.byPlayer[0].forecasts, 4); assert.equal(audit.byContext[0].contextKey, insights.contextKey(context));
  assert.equal(audit.calibrationStatus, 'NOT_ESTABLISHED'); assert.equal(audit.brierDefinition, 'SUM_OVER_LEGAL_ACTIONS');
  assert.deepEqual(hands, before);
});

test('a changed action pattern can worsen model score; no automatic calibrated/adaptation gain is manufactured', () => {
  const { hands } = history(['CALL', 'CALL', 'CALL', 'FOLD']), audit = insights.evaluatePrequential(options(hands));
  const last = audit.byHand.at(-1);
  assert.ok(last.metrics.logLoss.modelMinusReference > 0); assert.ok(last.metrics.brier.modelMinusReference > 0);
  assert.equal(audit.forecasts.at(-1).observedActionProbability, 1 / 6);
  assert.equal(audit.metricScope, 'RECORDED_LEGAL_ACTION_OPPORTUNITIES_ONLY'); assert.equal('ev' in audit, false);
});

test('scoring never learns from earlier actions of the same target hand', () => {
  const { hands } = history(['CALL', 'CALL']);
  const last = hands[1], second = clone(last.observations[0]); second.id = last.handId + ':action-2'; second.action = 'FOLD';
  last.observations.push(second);
  const audit = insights.evaluatePrequential(options([last]));
  assert.deepEqual(audit.forecasts.map(row => row.priorOpportunities), [1, 1]);
  assert.equal(audit.forecasts[0].observedActionProbability, 2 / 4); assert.equal(audit.forecasts[1].observedActionProbability, 1 / 4);
});

test('current/future and late-entered archived hands cannot change past forecast metrics', () => {
  const { hands } = history(['CALL', 'CALL', 'CALL']), baseline = insights.evaluatePrequential({ ...options(hands), currentFrozenAt: time(4) });
  assert.equal(baseline.counts.forecasts, 2);
  const current = clone(hands[2]); current.handId = 'current'; current.profileSnapshot.handId = 'current';
  current.archive.multiway.handId = 'current'; current.observations[0].id = 'current:action-1';
  const future = clone(hands[2]); future.observations[0].id = hands[0].observations[0].id; future.observations[0].action = 'FOLD';
  const late = clone(hands[1]); late.handId = 'late'; late.profileSnapshot.handId = 'late'; late.archive.multiway.handId = 'late';
  late.archive.archivedAt = time(20); late.observations[0].id = 'late:action-1';
  const audit = insights.evaluatePrequential({ ...options([hands[0], hands[1], current, future, late]), currentFrozenAt: time(4) });
  assert.deepEqual(audit.metrics, baseline.metrics);
  assert.ok(audit.exclusions.some(row => row.reasonCode === 'CURRENT_HAND_EXCLUDED'));
  assert.equal(audit.exclusions.filter(row => row.reasonCode === 'HAND_NOT_BEFORE_CURRENT_CUTOFF').length, 2);
});

test('unmarked/reconstructed histories remain descriptive evidence but cannot claim held-out forecasts', () => {
  const { hands } = history(['CALL', 'CALL']);
  delete hands[0].forecastOrigin; hands[1].forecastOrigin.status = 'RECONSTRUCTED_AFTER_ACTION';
  const audit = insights.evaluatePrequential(options(hands));
  assert.equal(audit.status, 'UNKNOWN'); assert.equal(audit.metrics, null); assert.equal(audit.counts.forecasts, 0);
  assert.equal(audit.exclusions.filter(row => row.reasonCode === 'UNKNOWN_FORECAST_ORIGIN').length, 2);
  assert.equal(insights.report({ snapshot: hands[1].profileSnapshot, playerId: 'opponent', context }).status, 'READY');
  delete hands[1].profileSnapshot.players.opponent;
  hands[1].forecastOrigin.status = 'FROZEN_BEFORE_FIRST_ACTION';
  assert.equal(insights.evaluatePrequential(options([hands[1]])).metrics, null, 'Missing player evidence cannot invent a historical forecast.');
});

test('archive identity, chronology and exact frozen snapshot origin are necessary for an eligible hand', () => {
  const { hands } = history(['CALL']);
  for (const [poison, reason] of [
    [value => { delete value.archive; }, 'HAND_NOT_ARCHIVED'], [value => { value.archive.state.phase = 'BETTING'; }, 'HAND_NOT_ARCHIVED'],
    [value => { value.archive.archivedAt = 'unknown'; }, 'INVALID_HAND_CHRONOLOGY'],
    [value => { value.profileSnapshot.source = 'LIBRARY_OBSERVATIONS'; }, 'INVALID_FROZEN_HAND_SNAPSHOT'],
    [value => { value.forecastOrigin.createdAt = time(30); }, 'UNKNOWN_FORECAST_ORIGIN'],
    [value => { value.profileSnapshot.handId = 'other'; }, 'INVALID_FROZEN_HAND_SNAPSHOT']
  ]) {
    const input = clone(hands[0]); poison(input); const audit = insights.evaluatePrequential(options([input]));
    assert.equal(audit.metrics, null); assert.ok(audit.exclusions.some(row => row.reasonCode === reason));
  }
});

test('duplicate, noncanonical, illegal and unconfirmed observations never get opportunistically counted', () => {
  const { hands } = history(['CALL']);
  const duplicate = clone(hands[0].observations[0]); hands[0].observations.push(duplicate);
  let audit = insights.evaluatePrequential(options(hands));
  assert.equal(audit.counts.forecasts, 0); assert.equal(audit.counts.skippedObservations, 2);
  assert.ok(audit.exclusions.every(row => row.reasonCode === 'DUPLICATE_OBSERVATION_IDENTITY' || row.reasonCode === 'NO_ELIGIBLE_PLAYER_OBSERVATIONS'));
  for (const poison of [observation => { observation.id = 'other:action'; }, observation => { observation.action = 'CHECK'; },
    observation => { observation.source = 'USER_NOTE'; }, observation => { observation.seatId = 1; }]) {
    const value = clone(hands[0]); value.observations.pop(); poison(value.observations[0]);
    audit = insights.evaluatePrequential(options([value])); assert.equal(audit.metrics, null); assert.equal(audit.counts.skippedObservations, 1);
  }
  audit = insights.evaluatePrequential(options([hands[0], clone(hands[0]) ]));
  assert.equal(audit.counts.skippedHands, 2); assert.equal(audit.counts.forecasts, 0);
});

test('zero eligible forecasts, missing selected player and invalid cutoff report unavailable metrics, not zeros', () => {
  assert.equal(insights.evaluatePrequential(options([])).metrics, null);
  assert.equal(insights.report(null).status, 'UNAVAILABLE');
  assert.equal(insights.evaluatePrequential(null).status, 'UNAVAILABLE');
  const { hands } = history(['CALL']), absent = insights.evaluatePrequential({ ...options(hands), playerIds: ['unseen'] });
  assert.equal(absent.status, 'UNKNOWN'); assert.equal(absent.metrics, null);
  for (const input of [{ hands, currentHandId: 'current' }, { hands, currentFrozenAt: 'bad' }, { hands, playerIds: ['opponent', 'opponent'] }]) {
    const audit = insights.evaluatePrequential(input); assert.equal(audit.status, 'UNAVAILABLE'); assert.equal(audit.metrics, null);
  }
});

test('names, notes, shown cards and outcomes cannot change forecasts or leak into pure diagnostic output', () => {
  const { hands } = history(['CALL', 'CALL']), original = insights.evaluatePrequential(options(hands));
  const secret = 'PRIVATE_NARRATIVE_SENTINEL';
  hands.forEach(value => {
    value.notes = secret; value.archive.multiway.config = { heroCards: [secret], players: [{ name: secret }] };
    value.archive.state.players = [{ shownCards: [secret] }]; value.archive.state.result = { outcome: secret };
    value.profileSnapshot.players.opponent.notes = [secret]; value.observations.forEach(observation => { observation.transcript = secret; });
  });
  const after = insights.evaluatePrequential(options(hands)); assert.deepEqual(after, original);
  assert.equal(JSON.stringify(after).includes(secret), false);
});

test('browser UMD and Node share one pure model without eval, network or persistence effects', () => {
  const sandbox = { crypto: require('node:crypto').webcrypto }, modelSource = fs.readFileSync(require.resolve('../public/player-profile-model'), 'utf8');
  const source = fs.readFileSync(require.resolve('../public/player-profile-insights'), 'utf8');
  vm.runInNewContext(modelSource, sandbox); vm.runInNewContext(source, sandbox);
  const { hands } = history(['CALL', 'CALL']);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.TheibsPlayerProfileInsights.evaluatePrequential(clone(options(hands))))), insights.evaluatePrequential(options(hands)));
  assert.equal(/\beval\s*\(|new\s+Function\b|\bfetch\s*\(|localStorage/.test(source), false);
});
