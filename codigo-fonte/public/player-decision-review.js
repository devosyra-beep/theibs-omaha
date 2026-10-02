(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TheibsPlayerDecisionReview = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 'PLAYER_DECISION_REVIEW_V1';
  const clone = value => JSON.parse(JSON.stringify(value));
  const finite = Number.isFinite;
  function currentRoster(config, heroId, savedPlayers, count) {
    if (!Array.isArray(config?.players) || config.players.length !== count || !Number.isInteger(heroId) || heroId < 0 || heroId >= count) return null;
    const saved = new Set(savedPlayers.map(player => player.playerId));
    const roster = Array.from({ length: count - 1 }, (_, index) => config.players[(heroId + index + 1) % count]?.playerId);
    return new Set(roster).size === roster.length && roster.every(id => saved.has(id)) ? roster : null;
  }
  function referencePayload(payload) {
    if (!payload?.multiway?.handId || !payload.multiwayEvaluation?.profileSnapshot?.players) throw Error('A frozen player profile is required.');
    const result = clone(payload), snapshot = result.multiwayEvaluation.profileSnapshot;
    if (snapshot.handId !== result.multiway.handId || snapshot.source !== 'PRE_HAND_OBSERVATIONS') throw Error('The player profile does not match this hand.');
    for (const [id, player] of Object.entries(snapshot.players)) if (!id.startsWith('hero_')) {
      player.contexts = {}; player.observations = 0;
    }
    return result;
  }
  function compare(payload, baseline, reference) {
    const reject = reason => ({ status: 'UNAVAILABLE', reason, rows: [] });
    const expected = payload.multiway?.handId;
    if ([baseline, reference].some(result => result?.status !== 'OK' || result.observedState?.handId !== expected || !result.multiwayEvaluation)) return reject('Matching contextual EV estimates are required.');
    const b = baseline.multiwayEvaluation, r = reference.multiwayEvaluation;
    if (b.revisionKey !== r.revisionKey || b.revisionKey !== payload.multiwayEvaluation?.revisionKey || !b.revisionKey ||
        !['MULTIWAY_CONTEXT_POLICY_V1','MULTIWAY_CONTEXT_POLICY_V2'].includes(b.model) || b.model !== r.model || !baseline.engineBuild || baseline.engineBuild !== reference.engineBuild ||
        baseline.ev?.feeBasis !== reference.ev?.feeBasis || baseline.ev?.bigBlind !== reference.ev?.bigBlind ||
        baseline.ev?.comparisonScope !== reference.ev?.comparisonScope) return reject('The state, model or calculation basis changed.');
    const original = baseline.ev?.candidates || b.candidates, alternative = reference.ev?.candidates || r.candidates;
    if (!Array.isArray(original) || !Array.isArray(alternative)) return reject('Action estimates are unavailable.');
    const ids = values => values.map(row => row.optionId || row.action);
    const bi = ids(original), ri = ids(alternative);
    if (new Set(bi).size !== bi.length || new Set(ri).size !== ri.length || bi.length !== ri.length || bi.some(id => !ri.includes(id))) return reject('The compared action sets differ.');
    const rows = original.map(row => {
      const id = row.optionId || row.action, other = alternative.find(item => (item.optionId || item.action) === id);
      const available = row.status === 'MODELED' && other.status === 'MODELED' && finite(row.evBB) && finite(other.evBB);
      return { id, action: row.action, size: row.size ?? null, status: available ? 'MODELED' : 'NOT_MODELED',
        profileEVBB: available ? row.evBB : null, referenceEVBB: available ? other.evBB : null,
        changeBB: available ? row.evBB - other.evBB : null };
    });
    const leaders = key => { const values = rows.filter(row => row.status === 'MODELED'); const best = Math.max(...values.map(row => row[key])); return values.filter(row => row[key] === best).map(row => row.id); };
    return { version: VERSION, status: rows.some(row => row.status === 'MODELED') ? 'READY' : 'UNAVAILABLE',
      scope: 'HEURISTIC_PROFILE_MODEL_SENSITIVITY', handId: expected, revisionKey: b.revisionKey, model: b.model,
      profileHash: b.profileSnapshotHash, referenceHash: r.profileSnapshotHash,
      priorRecordedActions: Object.entries(payload.multiwayEvaluation.profileSnapshot.players).filter(([id]) => !id.startsWith('hero_')).reduce((sum,[,player]) => sum + (player.observations || 0),0),
      rows, profileLeaders: leaders('profileEVBB'), referenceLeaders: leaders('referenceEVBB'),
      samples: { profile: b.samples, reference: r.samples }, elapsedMs: { profile: b.elapsedMs, reference: r.elapsedMs },
      precision: 'NOT_CERTIFIED', uncertainty: 'PROFILE_UNCERTAINTY_NOT_PROPAGATED' };
  }
  return Object.freeze({ VERSION, currentRoster, referencePayload, compare });
});
