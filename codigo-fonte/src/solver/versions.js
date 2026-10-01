'use strict';

// Shared, side-effect-free identity for worker checkpoints and cached results.
// Bump when the adaptive refinement/certificate contract becomes incompatible.
// V6 binds the decision comparison policy and fair refinement/outcome contract.
// CFR, game hashes, certificates and qualification are unchanged.
module.exports = { ADAPTIVE_VERSION: 'THEIBS_HU_ADAPTIVE_V6' };
