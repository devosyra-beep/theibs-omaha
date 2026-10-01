'use strict';

// One migration boundary for Multiway strategy. The existing continuation
// estimator remains a labeled fallback while finite solver coverage expands.
// Selection replaces a whole decision table; it never fills solver gaps with
// heuristic rows or turns absent values into zero.
const { STRATEGY_CONTRACT_VERSION, FALLBACK_SOURCE, fallbackMetadata, evaluateContinuation } = require('./continuation-strategy');
const { createSolverService } = require('./solver/job-service');
const { VERSION: QUALIFICATION_VERSION, THRESHOLD_BB } = require('./solver/solution-status');
const { solverDecisionPrecision } = require('./decision-precision');

const SOLVER_SOURCE = 'REFERENCE_SUBGAME_STRATEGY';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clone = value => structuredClone(value);

function createStrategyService(options) {
  return { ...createSolverService(options), contractVersion: STRATEGY_CONTRACT_VERSION };
}

function unpack(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const snapshot = candidate.result && typeof candidate.result === 'object' ? candidate.result : candidate;
  return { envelope: candidate, snapshot };
}

function isFresh(candidate, revisionKey) {
  if (!candidate || typeof revisionKey !== 'string' || !revisionKey.length) return false;
  const { envelope, snapshot } = candidate;
  const revisions = [envelope.revisionKey, snapshot.revisionKey, snapshot.observedState?.revisionKey, snapshot.multiwayEvaluation?.revisionKey]
    .filter(value => value !== undefined && value !== null);
  return revisions.length > 0 && revisions.every(value => value === revisionKey);
}

function validSolverTable(snapshot) {
  if (!['SOLVED', 'APPROXIMATE', 'REFINING'].includes(snapshot.status)) return false;
  if (snapshot.status === 'SOLVED') {
    const qualification = snapshot.qualification, quality = snapshot.quality, convergence = snapshot.convergence;
    if (qualification?.version !== QUALIFICATION_VERSION || qualification.solvedSubgame !== true
      || qualification.strategyFrequenciesSupported !== true || quality?.numericalStatus !== 'SOLVED'
      || quality.metric !== 'EXACT_NASH_CONV' || quality.unit !== 'BB' || quality.exact !== true
      || quality.thresholdMet !== true || quality.thresholdBB !== THRESHOLD_BB
      || quality.completeChanceSupport !== true || quality.perfectRecallVerified !== true
      || quality.fullLegalSizingCoverage !== true || quality.supportedGameClass !== true
      || !finite(quality.nashConv) || quality.nashConv < 0 || quality.nashConv > THRESHOLD_BB
      || !finite(quality.maxUnilateralGain) || quality.maxUnilateralGain < 0 || quality.maxUnilateralGain > quality.nashConv + 1e-10
      || convergence?.exact !== true || !finite(convergence.nashConv)
      || Math.abs(convergence.nashConv - quality.nashConv) > 1e-10) return false;
  }
  if (typeof snapshot.solverVersion !== 'string' || !snapshot.solverVersion || typeof snapshot.method !== 'string' || !snapshot.method) return false;
  const rows = snapshot.actions;
  if (!Array.isArray(rows) || !rows.length) return false;
  const ids = new Set();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id.length || ids.has(row.id) || !finite(row.evBB)
      || !finite(row.frequency) || row.frequency < 0 || row.frequency > 1) return false;
    ids.add(row.id);
  }
  if (Math.abs(rows.reduce((sum, row) => sum + row.frequency, 0) - 1) > 1e-8) return false;
  // The adapter identifies every root action in its declared abstraction. This
  // prevents a truncated response from appearing to be its complete strategy.
  const rootActions = snapshot.abstraction?.rootActions;
  if (!Array.isArray(rootActions) || !rootActions.length || rootActions.length !== rows.length
    || rootActions.some(action => !ids.has(action.id))) return false;
  return new Set(rootActions.map(action => action.id)).size === rows.length;
}

function selectSnapshot({ solver, heuristic, revisionKey } = {}) {
  const reference = unpack(solver), fallback = unpack(heuristic);
  if (isFresh(reference, revisionKey) && validSolverTable(reference.snapshot)) {
    const snapshot = clone(reference.snapshot);
    snapshot.decisionPrecision = solverDecisionPrecision(snapshot);
    return {
      contractVersion: STRATEGY_CONTRACT_VERSION, revisionKey,
      source: SOLVER_SOURCE, status: snapshot.status, version: snapshot.solverVersion,
      fallback: false, equilibrium: false, snapshot, actions: snapshot.actions,
      quality: {
        numericalScope: 'DECLARED_FINITE_SUBGAME_AVERAGE_STRATEGY',
        convergence: snapshot.convergence || null, qualification: snapshot.qualification || null,
        abstraction: snapshot.abstraction || null
      }, selectionReason: 'FRESH_COMPLETE_SOLVER_TABLE'
    };
  }
  if (isFresh(fallback, revisionKey)) {
    const snapshot = clone(fallback.snapshot), metadata = fallbackMetadata(snapshot);
    snapshot.strategyMetadata = metadata;
    return {
      contractVersion: STRATEGY_CONTRACT_VERSION, revisionKey,
      source: FALLBACK_SOURCE, status: 'HEURISTIC', version: metadata.version,
      fallback: true, equilibrium: false, snapshot,
      actions: Array.isArray(snapshot.ev?.candidates) ? snapshot.ev.candidates : Object.values(snapshot.ev?.actions || {}),
      quality: metadata.quality,
      selectionReason: isFresh(reference, revisionKey) ? 'SOLVER_TABLE_UNAVAILABLE_OR_INVALID' : 'SOLVER_RESULT_MISSING_OR_STALE'
    };
  }
  return {
    contractVersion: STRATEGY_CONTRACT_VERSION,
    revisionKey: typeof revisionKey === 'string' ? revisionKey : null,
    source: null, status: 'NOT_SOLVED', version: null, fallback: false,
    equilibrium: false, snapshot: null, actions: [], quality: null,
    selectionReason: 'NO_FRESH_DECISION_SNAPSHOT'
  };
}

module.exports = { STRATEGY_CONTRACT_VERSION, evaluateContinuation, createStrategyService, selectSnapshot };
