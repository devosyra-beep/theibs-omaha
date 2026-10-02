(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./player-profile-model'));
  else root.TheibsPlayerProfileInsights = factory(root.TheibsPlayerProfiles);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (model) {
  'use strict';
  const VERSION = 'THEIBS_PLAYER_PROFILE_INSIGHTS_V1';
  const FORECAST_ORIGIN_VERSION = 'THEIBS_FORECAST_ORIGIN_V1';
  const ACTIONS = ['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE'];
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)
    && !['__proto__', 'prototype', 'constructor'].includes(value);
  const natural = value => Number.isSafeInteger(value) && value >= 0;
  const count = value => natural(value) && value <= 1e9;
  const copy = value => JSON.parse(JSON.stringify(value));
  function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
    const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null;
  }
  function normalizeContext(value) {
    if (!object(value) || !['PLO4_HIGH', 'PLO5_HIGH', 'PLO6_HIGH'].includes(value.variant)
        || !['PREFLOP', 'FLOP', 'TURN', 'RIVER'].includes(value.street)
        || !['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'].includes(value.position)
        || !Number.isSafeInteger(value.initialParticipants) || value.initialParticipants < 2 || value.initialParticipants > 9
        || value.tableFormat !== (value.initialParticipants === 2 ? 'HEADS_UP_TABLE' : 'MULTIWAY_TABLE')
        || !['HEADS_UP', 'MULTIWAY_3_4', 'MULTIWAY_5_PLUS'].includes(value.participants)
        || !['FREE', 'UP_TO_20_PERCENT', '20_TO_40_PERCENT', 'ABOVE_40_PERCENT'].includes(value.priceBand)
        || !Array.isArray(value.legalActions) || !value.legalActions.length
        || value.legalActions.some(action => !ACTIONS.includes(action)) || new Set(value.legalActions).size !== value.legalActions.length)
      throw Error('A valid recorded decision context is required.');
    return { variant: value.variant, street: value.street, position: value.position, tableFormat: value.tableFormat,
      initialParticipants: value.initialParticipants, participants: value.participants, priceBand: value.priceBand,
      legalActions: [...value.legalActions].sort() };
  }
  function contextKey(context) {
    if (!model || typeof model.contextKey !== 'function') throw Error('The player profile model is unavailable.');
    return model.contextKey(normalizeContext(context));
  }
  function validateSnapshot(snapshot, allowedSource) {
    if (!model || typeof model.getPosterior !== 'function' || !object(snapshot) || snapshot.schemaVersion !== 1
        || snapshot.model !== model.VERSION || !allowedSource.includes(snapshot.source)
        || !identifier(snapshot.handId) || !natural(snapshot.libraryRevision) || timestamp(snapshot.frozenAt) === null
        || !object(snapshot.players)) throw Error('A valid identified player snapshot is required.');
    for (const [id, profile] of Object.entries(snapshot.players)) {
      if (!identifier(id) || !object(profile) || profile.playerId !== id || !object(profile.contexts) || !natural(profile.observations))
        throw Error('Invalid player evidence in the snapshot.');
      let total = 0;
      for (const [key, cell] of Object.entries(profile.contexts)) {
        if (!object(cell) || !object(cell.counts) || contextKey(cell.context) !== key) throw Error('Invalid recorded context.');
        const legal = normalizeContext(cell.context).legalActions;
        for (const [action, value] of Object.entries(cell.counts)) {
          if (!legal.includes(action) || !count(value)) throw Error('Invalid confirmed action count.');
          total += value;
        }
      }
      if (!Number.isSafeInteger(total) || total !== profile.observations) throw Error('Snapshot observation totals do not match.');
    }
    return snapshot;
  }
  function bindingFor(value) {
    if (!object(value)) return null;
    const result = {};
    for (const key of ['ownerKey', 'handId', 'revisionKey']) if (typeof value[key] === 'string') result[key] = value[key];
    for (const key of ['editEpoch', 'libraryRevision', 'seatId']) if (Number.isSafeInteger(value[key]) && value[key] >= 0) result[key] = value[key];
    return result;
  }
  const LIMITATIONS = [
    'Counts describe confirmed recorded opportunities in this exact context, not every hand played.',
    'The reference prior is explicit. Marginal posterior intervals are not frequentist confidence intervals or joint action guarantees.',
    'Action rates do not identify private-card ranges, sizing distributions, a population strategy, GTO or profitability.',
    'An opponent report must use that opponent\'s recorded decision context, not Hero\'s legal actions.'
  ];
  function report(input = {}) {
    const { snapshot, playerId, context, binding } = object(input) ? input : {};
    const unavailable = reason => ({ version: VERSION, status: 'UNAVAILABLE', evidence: 'UNKNOWN', model: model?.VERSION || null,
      playerId: identifier(playerId) ? playerId : null, context: null, contextKey: null, binding: bindingFor(binding), origin: null,
      opportunities: null, prior: null, actions: [], contextScope: 'EXPLICIT_OPPORTUNITY_CONTEXT', uncertaintyScope: 'BETA_MARGINAL_POSTERIOR_ONLY',
      calibrationStatus: 'NOT_ESTABLISHED', reasonCodes: [reason], limitations: [...LIMITATIONS] });
    try {
      validateSnapshot(snapshot, ['PRE_HAND_OBSERVATIONS', 'LIBRARY_OBSERVATIONS']);
      if (!identifier(playerId)) return unavailable('INVALID_PLAYER_IDENTITY');
      const normalized = normalizeContext(context), key = contextKey(normalized), profile = snapshot.players[playerId];
      const posterior = model.getPosterior(profile, normalized), observed = posterior.sampleSize;
      const missing = !profile ? 'PLAYER_NOT_IN_SNAPSHOT' : !profile.contexts[key] ? 'EXACT_CONTEXT_NOT_OBSERVED' : observed === 0 ? 'NO_CONFIRMED_OPPORTUNITIES' : null;
      return { version: VERSION, status: observed > 0 ? 'READY' : 'UNKNOWN', evidence: observed > 0 ? 'CONFIRMED_ACTIONS' : 'REFERENCE_PRIOR_ONLY',
        model: posterior.model, playerId, context: normalized, contextKey: key, binding: bindingFor(binding),
        origin: { source: snapshot.source, scope: snapshot.source === 'PRE_HAND_OBSERVATIONS' ? 'FROZEN_PRE_HAND' : 'CURRENT_LIBRARY',
          handId: snapshot.handId, libraryRevision: snapshot.libraryRevision, frozenAt: snapshot.frozenAt },
        opportunities: observed, prior: copy(posterior.prior),
        actions: normalized.legalActions.map(action => ({ action, observed: posterior.estimates[action].observed,
          mean: posterior.estimates[action].mean, credibleInterval95: [...posterior.estimates[action].credibleInterval95] })),
        contextScope: 'EXPLICIT_OPPORTUNITY_CONTEXT', uncertaintyScope: 'BETA_MARGINAL_POSTERIOR_ONLY', intervalMethod: posterior.intervalMethod,
        calibrationStatus: 'NOT_ESTABLISHED', reasonCodes: missing ? [missing] : [], limitations: [...LIMITATIONS] };
    } catch (_) { return unavailable('INVALID_SNAPSHOT_OR_CONTEXT'); }
  }
  function metricAccumulator() { return { forecasts: 0, modelLog: 0, referenceLog: 0, modelBrier: 0, referenceBrier: 0 }; }
  function addScore(target, row) {
    target.forecasts++; target.modelLog += row.logLoss.model; target.referenceLog += row.logLoss.reference;
    target.modelBrier += row.brier.model; target.referenceBrier += row.brier.reference;
  }
  function metrics(accumulator) {
    if (!accumulator.forecasts) return null;
    const n = accumulator.forecasts;
    const logLoss = { model: accumulator.modelLog / n, reference: accumulator.referenceLog / n };
    const brier = { model: accumulator.modelBrier / n, reference: accumulator.referenceBrier / n };
    logLoss.modelMinusReference = logLoss.model - logLoss.reference;
    brier.modelMinusReference = brier.model - brier.reference;
    return { logLoss, brier };
  }
  const FORECAST_LIMITATIONS = [
    'Only archived hands with an explicit snapshot frozen before their first action are scored. Unknown origins are excluded.',
    'Predictions use each hand\'s original frozen snapshot, without learning that hand while scoring it.',
    'Log loss and multiclass Brier describe recorded action forecasts. A negative model-minus-reference score is lower loss on these observations.',
    'Multiple actions in one hand are correlated. These descriptive scores do not establish calibration, future performance, card ranges, EV or profit.',
    'Later shown cards, manual notes and outcomes do not enter these forecasts.'
  ];
  function archivedOpportunities(hand) {
    const archive = hand.archive;
    if (!archive || archive.multiway?.handId !== hand.handId) return false;
    if (archive.state?.phase === 'FINISHED') return true;
    // Fast continuation may archive an unfinished ledger. Its confirmed action
    // forecasts remain measurable without inventing payouts or later actions.
    if (!['BETTING','WAIT_BOARD','SHOWDOWN'].includes(archive.state?.phase) ||
        !['NEW_GAME','PREVIOUS_STARTING_STACK_ESTIMATE','USER_CONFIRMED_STACKS'].includes(archive.reconciliation?.source) ||
        archive.reconciliation.resultPending !== true || !Array.isArray(archive.multiway.events)) return false;
    return hand.observations.every(observation => {
      const event = archive.multiway.events[observation.eventIndex];
      return event?.type === 'ACT' && event.actor === observation.seatId && event.action === observation.action &&
        observation.id === `${hand.handId}:${event.eventId || event.originEventId || observation.eventIndex}`;
    });
  }
  function evaluatePrequential(input = {}) {
    const { hands, currentHandId = null, currentFrozenAt = null, playerIds } = object(input) ? input : {};
    const output = { version: VERSION, status: 'UNAVAILABLE', protocol: 'ORIGINAL_FROZEN_PRE_HAND_ACTION_FORECASTS',
      model: model?.VERSION || null, reference: 'SAME_LEGAL_ACTION_DIRICHLET_REFERENCE_PRIOR',
      cutoff: { currentHandId, currentFrozenAt }, calibrationStatus: 'NOT_ESTABLISHED',
      metricScope: 'RECORDED_LEGAL_ACTION_OPPORTUNITIES_ONLY', brierDefinition: 'SUM_OVER_LEGAL_ACTIONS',
      counts: { handsConsidered: Array.isArray(hands) ? hands.length : 0, eligibleHands: 0, scoredHands: 0, forecasts: 0,
        skippedHands: 0, skippedObservations: 0 }, metrics: null, byHand: [], byPlayer: [], byContext: [], forecasts: [],
      exclusions: [], reasonCodes: [], limitations: [...FORECAST_LIMITATIONS] };
    const cutoff = currentFrozenAt === null ? null : timestamp(currentFrozenAt);
    if (!Array.isArray(hands) || currentHandId !== null && !identifier(currentHandId)
        || currentFrozenAt !== null && cutoff === null || currentHandId !== null && cutoff === null
        || playerIds !== undefined && (!Array.isArray(playerIds) || !playerIds.length || playerIds.some(id => !identifier(id)) || new Set(playerIds).size !== playerIds.length)) {
      output.reasonCodes.push('INVALID_FORECAST_AUDIT_INPUT'); return output;
    }
    const chosen = playerIds === undefined ? null : new Set(playerIds), handCounts = new Map(), observationCounts = new Map();
    for (const hand of hands) {
      handCounts.set(hand?.handId, (handCounts.get(hand?.handId) || 0) + 1);
    }
    const total = metricAccumulator(), players = new Map(), contexts = new Map();
    const excludeHand = (handId, reasonCode) => { output.counts.skippedHands++; output.exclusions.push({ handId: identifier(handId) ? handId : null, reasonCode }); };
    const excludeObservation = (handId, observationId, reasonCode) => {
      output.counts.skippedObservations++; output.exclusions.push({ handId, observationId: typeof observationId === 'string' ? observationId : null, reasonCode });
    };
    const ordered = [...hands].sort((a, b) => (timestamp(a?.profileSnapshot?.frozenAt) ?? Infinity) - (timestamp(b?.profileSnapshot?.frozenAt) ?? Infinity)
      || String(a?.handId || '').localeCompare(String(b?.handId || '')));
    const eligible = [];
    for (const hand of ordered) {
      const id = hand?.handId;
      if (!identifier(id) || !Array.isArray(hand?.playerIds) || hand.playerIds.some(player => !identifier(player))
          || new Set(hand.playerIds).size !== hand.playerIds.length || !Array.isArray(hand.observations)) { excludeHand(id, 'INVALID_HAND_RECORD'); continue; }
      if (id === currentHandId) { excludeHand(id, 'CURRENT_HAND_EXCLUDED'); continue; }
      if (handCounts.get(id) !== 1) { excludeHand(id, 'DUPLICATE_HAND_IDENTITY'); continue; }
      if (!archivedOpportunities(hand)) { excludeHand(id, 'HAND_NOT_ARCHIVED'); continue; }
      const archivedAt = timestamp(hand.archive.archivedAt), frozenAt = timestamp(hand.profileSnapshot?.frozenAt);
      if (frozenAt === null || archivedAt === null || archivedAt < frozenAt) { excludeHand(id, 'INVALID_HAND_CHRONOLOGY'); continue; }
      if (cutoff !== null && (frozenAt >= cutoff || archivedAt >= cutoff)) { excludeHand(id, 'HAND_NOT_BEFORE_CURRENT_CUTOFF'); continue; }
      if (hand.forecastOrigin?.version !== FORECAST_ORIGIN_VERSION || hand.forecastOrigin.status !== 'FROZEN_BEFORE_FIRST_ACTION'
          || hand.forecastOrigin.createdAt !== hand.profileSnapshot?.frozenAt) { excludeHand(id, 'UNKNOWN_FORECAST_ORIGIN'); continue; }
      try {
        validateSnapshot(hand.profileSnapshot, ['PRE_HAND_OBSERVATIONS']);
        if (hand.profileSnapshot.handId !== id) throw Error('Snapshot belongs to another hand.');
      } catch (_) { excludeHand(id, 'INVALID_FROZEN_HAND_SNAPSHOT'); continue; }
      output.counts.eligibleHands++; eligible.push(hand);
      for (const observation of hand.observations) if (typeof observation?.id === 'string' && observation.id.startsWith(id + ':'))
        observationCounts.set(observation.id, (observationCounts.get(observation.id) || 0) + 1);
    }
    for (const hand of eligible) {
      const id = hand.handId;
      const perHand = metricAccumulator();
      for (const observation of hand.observations) {
        if (chosen && !chosen.has(observation?.playerId)) continue;
        if (!object(observation) || typeof observation.id !== 'string' || !observation.id.startsWith(id + ':')
            || observation.id.length <= id.length + 1 || observation.source !== 'CONFIRMED_EVENT' || !hand.playerIds.includes(observation.playerId)
            || !Number.isSafeInteger(observation.seatId) || hand.playerIds[observation.seatId] !== observation.playerId) {
          excludeObservation(id, observation?.id, 'INVALID_CONFIRMED_OBSERVATION'); continue;
        }
        if (observationCounts.get(observation.id) !== 1) { excludeObservation(id, observation.id, 'DUPLICATE_OBSERVATION_IDENTITY'); continue; }
        const forecast = report({ snapshot: hand.profileSnapshot, playerId: observation.playerId, context: observation.context });
        if (forecast.status === 'UNAVAILABLE' || forecast.reasonCodes.includes('PLAYER_NOT_IN_SNAPSHOT')
            || !forecast.context.legalActions.includes(observation.action)) {
          excludeObservation(id, observation.id, 'INVALID_FORECAST_CONTEXT'); continue;
        }
        const reference = model.posterior(forecast.context), observed = observation.action;
        const modelProbability = forecast.actions.find(row => row.action === observed).mean, referenceProbability = reference.estimates[observed].mean;
        if (!(modelProbability > 0) || !(referenceProbability > 0)) { excludeObservation(id, observation.id, 'UNSCORABLE_ACTION_PROBABILITY'); continue; }
        const modelBrier = forecast.actions.reduce((sum, row) => sum + (row.mean - Number(row.action === observed)) ** 2, 0);
        const referenceBrier = forecast.actions.reduce((sum, row) => sum + (reference.estimates[row.action].mean - Number(row.action === observed)) ** 2, 0);
        const row = { handId: id, observationId: observation.id, playerId: observation.playerId, contextKey: forecast.contextKey,
          context: forecast.context, origin: forecast.origin, evidence: forecast.evidence, priorOpportunities: forecast.opportunities,
          observedAction: observed, actions: forecast.actions, observedActionProbability: modelProbability, referenceActionProbability: referenceProbability,
          logLoss: { model: -Math.log(modelProbability), reference: -Math.log(referenceProbability) }, brier: { model: modelBrier, reference: referenceBrier } };
        output.forecasts.push(row); addScore(total, row); addScore(perHand, row);
        if (!players.has(row.playerId)) players.set(row.playerId, metricAccumulator()); addScore(players.get(row.playerId), row);
        const groupKey = JSON.stringify([row.playerId, row.contextKey]);
        if (!contexts.has(groupKey)) contexts.set(groupKey, { playerId: row.playerId, contextKey: row.contextKey, context: row.context, accumulator: metricAccumulator() });
        addScore(contexts.get(groupKey).accumulator, row);
      }
      if (perHand.forecasts) { output.counts.scoredHands++; output.byHand.push({ handId: id, forecasts: perHand.forecasts, metrics: metrics(perHand) }); }
      else output.exclusions.push({ handId: id, reasonCode: 'NO_ELIGIBLE_PLAYER_OBSERVATIONS' });
    }
    output.counts.forecasts = total.forecasts; output.metrics = metrics(total);
    output.byPlayer = [...players].map(([playerId, accumulator]) => ({ playerId, forecasts: accumulator.forecasts, metrics: metrics(accumulator) }));
    output.byContext = [...contexts.values()].map(row => ({ playerId: row.playerId, contextKey: row.contextKey, context: row.context,
      forecasts: row.accumulator.forecasts, metrics: metrics(row.accumulator) }));
    output.status = total.forecasts ? 'READY' : 'UNKNOWN';
    if (!total.forecasts) output.reasonCodes.push('NO_ELIGIBLE_ACTION_FORECASTS');
    return output;
  }
  return Object.freeze({ VERSION, FORECAST_ORIGIN_VERSION, contextKey, report, evaluatePrequential });
});
