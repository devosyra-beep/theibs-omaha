'use strict';
// Pure migration boundary shared by Node and browser workers. The evaluator
// and its provenance are identical; the transport cannot upgrade its status.
const {evaluateMultiway, MODEL} = require('./multiway-evaluator');
const STRATEGY_CONTRACT_VERSION = 'THEIBS_MULTIWAY_STRATEGY_V1';
const FALLBACK_SOURCE = 'LEGACY_CONTEXT_CONTINUATION';
function fallbackMetadata(result) {
  return {
    contractVersion: STRATEGY_CONTRACT_VERSION,
    source: FALLBACK_SOURCE, status: 'HEURISTIC', version: MODEL,
    model: result.multiwayEvaluation?.model || MODEL,
    fallback: true, equilibrium: false,
    quality: {
      numericalScope: 'SAMPLING_UNCERTAINTY_CONDITIONAL_ON_DECLARED_CONTINUATION_POLICY',
      intervalMethod: result.multiwayEvaluation?.intervalMethod || result.equity?.intervalMethod || null,
      samples: result.multiwayEvaluation?.samples ?? result.equity?.samples ?? null,
      effectiveSamples: result.multiwayEvaluation?.effectiveSamples ?? result.equity?.effectiveSamples ?? null,
      profileUncertaintyPropagated: false, strategyConvergenceMeasured: false,
      nashConv: null, externallyValidated: false
    }
  };
}
function evaluateContinuation(input) {
  const result = evaluateMultiway(input);
  return {...result, strategyMetadata: fallbackMetadata(result)};
}
module.exports = {STRATEGY_CONTRACT_VERSION, FALLBACK_SOURCE, fallbackMetadata, evaluateContinuation};
