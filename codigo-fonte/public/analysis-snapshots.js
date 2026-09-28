/* Shared pure contract: charts and restored drafts cannot silently mix scenarios. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TheibsSnapshots = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const STREETS = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'];
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(item => stable(item) ?? 'null').join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined)
      .map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  function scenario(input) {
    const { board, street, analysisPhase, ...rest } = input;
    return stable(rest);
  }
  function compatible(snapshot, input, build) {
    if (snapshot.schemaVersion !== 2 || !snapshot.analysisId || !snapshot.input || snapshot.engineBuild !== build) return false;
    if (scenario(snapshot.input) !== scenario(input)) return false;
    const previous = snapshot.input.board || [], board = input.board || [];
    return previous.length <= board.length && previous.every((card, index) => card === board[index]);
  }
  function create(data, input) {
    return { schemaVersion: 2, analysisId: data.analysisId, engineBuild: data.engineBuild,
      provenance: data.provenance, input: JSON.parse(JSON.stringify(input)), street: input.street,
      equity: data.equity.equity, winRate: data.equity.winRate, tieRate: data.equity.tieRate,
      method: data.equity.method, samples: data.equity.samples, interval: data.equity.confidenceInterval95,
      action: data.recommendation?.action || null, recommendation: data.recommendation,
      continuationAssessment: data.continuationAssessment ? JSON.parse(JSON.stringify(data.continuationAssessment)) : null,
      unit: 'equity_fraction', stale: false, analysisStage: data.analysisStage || 'FINAL' };
  }
  function ordered(items) { return [...items].sort((a, b) => STREETS.indexOf(a.street) - STREETS.indexOf(b.street)); }
  function invalidate(items, input, build) {
    for (const item of items) if (!input || !compatible(item, input, build)) item.stale = true;
    return items;
  }
  return { stable, compatible, create, ordered, invalidate, STREETS };
});
